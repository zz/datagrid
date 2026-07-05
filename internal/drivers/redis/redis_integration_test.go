package redis

// Integration test against a local Redis/Valkey, gated on
// DATAGRID_TEST_REDIS=1 so CI stays hermetic. To stay clear of any real
// data, the fixture lives in database 15 under the datagrid:test:* prefix
// and is removed on cleanup — db0 is never touched.
//
// Run:
//
//	DATAGRID_TEST_REDIS=1 go test ./internal/drivers/redis/
//
// Honors REDIS_HOST/REDIS_PORT/REDIS_PASSWORD.

import (
	"context"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"datagrid/internal/drivers"
)

const testDB = 15
const prefix = "datagrid:test:"

func testSession(t *testing.T) (*session, *goredis.Client) {
	t.Helper()
	if os.Getenv("DATAGRID_TEST_REDIS") != "1" {
		t.Skip("set DATAGRID_TEST_REDIS=1 to run Redis integration tests")
	}
	host := os.Getenv("REDIS_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := 6379
	if p := os.Getenv("REDIS_PORT"); p != "" {
		port, _ = strconv.Atoi(p)
	}

	d, err := drivers.Get(drivers.EngineRedis)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := d.Connect(context.Background(), &drivers.ConnectionConfig{
		Engine:   drivers.EngineRedis,
		Host:     host,
		Port:     port,
		Database: strconv.Itoa(testDB),
	}, drivers.ConnectOptions{Password: os.Getenv("REDIS_PASSWORD")})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	s := sess.(*session)

	// Raw client for seeding/cleanup, bound to the isolated test DB.
	raw := goredis.NewClient(&goredis.Options{
		Addr:     host + ":" + strconv.Itoa(port),
		Password: os.Getenv("REDIS_PASSWORD"),
		DB:       testDB,
	})
	ctx := context.Background()
	cleanup(ctx, t, raw)
	seed(ctx, t, raw)

	t.Cleanup(func() {
		cleanup(context.Background(), t, raw)
		raw.Close()
		sess.Close()
	})
	return s, raw
}

func seed(ctx context.Context, t *testing.T, c *goredis.Client) {
	t.Helper()
	must := func(err error) {
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	must(c.Set(ctx, prefix+"str", "hello world", 0).Err())
	must(c.Expire(ctx, prefix+"str", time.Hour).Err())
	must(c.RPush(ctx, prefix+"list", "a", "b", "c").Err())
	must(c.SAdd(ctx, prefix+"set", "x", "y", "z").Err())
	must(c.HSet(ctx, prefix+"hash", "f1", "v1", "f2", "v2").Err())
	must(c.ZAdd(ctx, prefix+"zset", goredis.Z{Score: 1, Member: "one"}, goredis.Z{Score: 2, Member: "two"}).Err())
}

func cleanup(ctx context.Context, t *testing.T, c *goredis.Client) {
	t.Helper()
	// Delete only our prefixed keys; never FLUSHDB.
	var cursor uint64
	for {
		keys, cur, err := c.Scan(ctx, cursor, prefix+"*", 100).Result()
		if err != nil {
			t.Fatalf("cleanup scan: %v", err)
		}
		if len(keys) > 0 {
			c.Del(ctx, keys...)
		}
		cursor = cur
		if cursor == 0 {
			break
		}
	}
}

func TestListDatabases(t *testing.T) {
	s, _ := testSession(t)
	dbs, err := s.ListDatabases(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(dbs) != maxDatabases {
		t.Fatalf("want %d databases, got %d", maxDatabases, len(dbs))
	}
	if dbs[testDB].Keys < 5 {
		t.Errorf("db%d should have our 5+ seeded keys, got %d", testDB, dbs[testDB].Keys)
	}
}

func TestScanKeysAndTypeFilter(t *testing.T) {
	s, _ := testSession(t)
	ctx := context.Background()

	res, err := s.ScanKeys(ctx, drivers.ScanRequest{DB: testDB, Pattern: prefix + "*", Count: 100})
	if err != nil {
		t.Fatal(err)
	}
	types := map[string]string{}
	for _, k := range res.Keys {
		types[k.Key] = k.Type
	}
	if types[prefix+"hash"] != "hash" || types[prefix+"zset"] != "zset" {
		t.Errorf("type detection wrong: %v", types)
	}
	// The string key carries a ~1h TTL.
	for _, k := range res.Keys {
		if k.Key == prefix+"str" && (k.TTL < 3500 || k.TTL > 3600) {
			t.Errorf("str TTL out of expected range: %d", k.TTL)
		}
	}

	// Type filter narrows to just the set.
	setRes, err := s.ScanKeys(ctx, drivers.ScanRequest{DB: testDB, Pattern: prefix + "*", TypeFilter: "set", Count: 100})
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range setRes.Keys {
		if k.Type != "set" {
			t.Errorf("type filter leaked a %s key", k.Type)
		}
	}
	found := false
	for _, k := range setRes.Keys {
		if k.Key == prefix+"set" {
			found = true
		}
	}
	if !found {
		t.Error("type-filtered scan missed the set key")
	}
}

func TestGetValueByType(t *testing.T) {
	s, _ := testSession(t)
	ctx := context.Background()

	str, err := s.GetValue(ctx, testDB, prefix+"str")
	if err != nil || str.Type != "string" || str.String != "hello world" {
		t.Fatalf("string: %+v err=%v", str, err)
	}
	list, err := s.GetValue(ctx, testDB, prefix+"list")
	if err != nil || !slices.Equal(list.List, []string{"a", "b", "c"}) {
		t.Fatalf("list: %+v err=%v", list, err)
	}
	set, err := s.GetValue(ctx, testDB, prefix+"set")
	if err != nil || len(set.Set) != 3 {
		t.Fatalf("set: %+v err=%v", set, err)
	}
	hash, err := s.GetValue(ctx, testDB, prefix+"hash")
	if err != nil || hash.Hash["f1"] != "v1" || hash.Hash["f2"] != "v2" {
		t.Fatalf("hash: %+v err=%v", hash, err)
	}
	zset, err := s.GetValue(ctx, testDB, prefix+"zset")
	if err != nil || len(zset.ZSet) != 2 || zset.ZSet[0].Member != "one" || zset.ZSet[0].Score != 1 {
		t.Fatalf("zset: %+v err=%v", zset, err)
	}
}

func TestSetStringAndTTLAndDelete(t *testing.T) {
	s, raw := testSession(t)
	ctx := context.Background()
	key := prefix + "edit"

	if err := s.SetString(ctx, testDB, key, "v1"); err != nil {
		t.Fatal(err)
	}
	if got := raw.Get(ctx, key).Val(); got != "v1" {
		t.Errorf("set string: got %q", got)
	}

	if err := s.SetTTL(ctx, testDB, key, 120); err != nil {
		t.Fatal(err)
	}
	if ttl := raw.TTL(ctx, key).Val(); ttl < 100*time.Second || ttl > 120*time.Second {
		t.Errorf("set ttl: got %v", ttl)
	}
	if err := s.SetTTL(ctx, testDB, key, -1); err != nil { // persist
		t.Fatal(err)
	}
	// go-redis reports "no expiry" as a negative duration (-1ns).
	if ttl := raw.TTL(ctx, key).Val(); ttl >= 0 {
		t.Errorf("persist: expected no expiry, got %v", ttl)
	}

	if err := s.DeleteKey(ctx, testDB, key); err != nil {
		t.Fatal(err)
	}
	if raw.Exists(ctx, key).Val() != 0 {
		t.Error("key should be deleted")
	}
}

func TestRawCommand(t *testing.T) {
	s, _ := testSession(t)
	ctx := context.Background()

	reply, err := s.RawCommand(ctx, testDB, []string{"LLEN", prefix + "list"})
	if err != nil {
		t.Fatal(err)
	}
	if reply.Error != "" || reply.Text != "(integer) 3" {
		t.Errorf("LLEN reply: %+v", reply)
	}

	// An unknown command surfaces as a reply error, not a Go error.
	bad, err := s.RawCommand(ctx, testDB, []string{"NOTACOMMAND"})
	if err != nil {
		t.Fatalf("unexpected go error: %v", err)
	}
	if bad.Error == "" {
		t.Error("expected a reply error for an unknown command")
	}
}

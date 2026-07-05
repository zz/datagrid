// Package redis implements the drivers.Driver interface for Redis and
// Valkey on go-redis v9. It provides the base Session plus the optional
// drivers.KeyValue capability (design §4).
package redis

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"datagrid/internal/drivers"
)

func init() {
	drivers.Register(drivers.EngineRedis, &redisDriver{})
}

// maxDatabases is the conventional Redis logical-DB count (databases 0–15).
const maxDatabases = 16

// collectionCap bounds how many elements of a large collection cross IPC.
const collectionCap = 1000

type redisDriver struct{}

func (d *redisDriver) Capabilities() drivers.Capabilities {
	return drivers.Capabilities{SQL: false, KV: true, MultipleDatabases: true}
}

func (d *redisDriver) Connect(ctx context.Context, cfg *drivers.ConnectionConfig, opts drivers.ConnectOptions) (drivers.Session, error) {
	port := cfg.Port
	if port == 0 {
		port = 6379
	}
	base := &goredis.Options{
		Addr:        fmt.Sprintf("%s:%d", cfg.Host, port),
		Username:    cfg.User, // ACL user; empty is fine for default
		Password:    opts.Password,
		PoolSize:    4,
		DialTimeout: 10 * time.Second, // fail fast if unreachable
	}
	// When an SSH tunnel is configured, route go-redis through its dialer.
	if opts.Dialer != nil {
		base.Dialer = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return opts.Dialer(ctx, network, addr)
		}
	}
	switch cfg.TLSMode {
	case "require", "verify-full", "verify-ca":
		base.TLSConfig = &tls.Config{ServerName: cfg.Host}
		if cfg.TLSMode == "require" {
			base.TLSConfig.InsecureSkipVerify = true //nolint:gosec // explicit, warned in UI
		}
	}

	s := &session{base: base, clients: map[int]*goredis.Client{}}
	// Probe connectivity on the configured/default DB.
	def := defaultDB(cfg)
	client, err := s.client(def)
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx).Err(); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

func defaultDB(cfg *drivers.ConnectionConfig) int {
	if n, err := strconv.Atoi(strings.TrimSpace(cfg.Database)); err == nil && n >= 0 && n < maxDatabases {
		return n
	}
	return 0
}

type session struct {
	base *goredis.Options

	mu      sync.Mutex
	clients map[int]*goredis.Client // one client per logical DB, created lazily
}

// client returns (creating if needed) a client bound to a specific DB.
func (s *session) client(db int) (*goredis.Client, error) {
	if db < 0 || db >= maxDatabases {
		return nil, fmt.Errorf("database index %d out of range 0–%d", db, maxDatabases-1)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.clients[db]; ok {
		return c, nil
	}
	opt := *s.base
	opt.DB = db
	c := goredis.NewClient(&opt)
	s.clients[db] = c
	return c, nil
}

func (s *session) Ping(ctx context.Context) error {
	c, err := s.client(0)
	if err != nil {
		return err
	}
	return c.Ping(ctx).Err()
}

func (s *session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for db, c := range s.clients {
		_ = c.Close()
		delete(s.clients, db)
	}
	return nil
}

// Cancel is a no-op: Redis commands are short and cancellation rides on the
// request context. The method exists to satisfy the Session interface.
func (s *session) Cancel(context.Context, drivers.QueryID) error { return nil }

// Introspect returns the logical databases with non-zero key counts as
// schema nodes for the sidebar.
func (s *session) Introspect(ctx context.Context, _ drivers.IntrospectScope) (*drivers.SchemaTree, error) {
	dbs, err := s.ListDatabases(ctx)
	if err != nil {
		return nil, err
	}
	tree := &drivers.SchemaTree{}
	for _, db := range dbs {
		tree.Nodes = append(tree.Nodes, drivers.SchemaNode{
			Kind:   "database",
			Name:   fmt.Sprintf("db%d", db.Index),
			Detail: fmt.Sprintf("%d keys", db.Keys),
		})
	}
	return tree, nil
}

// Execute runs a single raw command against the request's default DB (db0)
// so the generic query path still works; the REPL uses RawCommand directly.
func (s *session) Execute(ctx context.Context, req drivers.QueryRequest, sink drivers.RowSink) (*drivers.QuerySummary, error) {
	start := time.Now()
	summary := &drivers.QuerySummary{QueryID: req.QueryID}
	args := splitArgs(req.Statement)
	if len(args) == 0 {
		summary.DurationMs = time.Since(start).Milliseconds()
		return summary, nil
	}
	reply, err := s.RawCommand(ctx, 0, args)
	summary.DurationMs = time.Since(start).Milliseconds()
	if err != nil {
		summary.Error = err.Error()
		return summary, nil
	}
	if reply.Error != "" {
		summary.Error = reply.Error
		return summary, nil
	}
	sink(drivers.RowBatch{
		QueryID: req.QueryID,
		Columns: []drivers.Column{{Name: "reply", TypeName: "text"}},
		Rows:    [][]any{{drivers.Value{T: "str", V: reply.Text}}},
		Seq:     0,
	})
	summary.RowsReturned = 1
	return summary, nil
}

// --- drivers.KeyValue ---------------------------------------------------

func (s *session) ListDatabases(ctx context.Context) ([]drivers.RedisDB, error) {
	// Prefer INFO keyspace (one round trip) for key counts.
	c, err := s.client(0)
	if err != nil {
		return nil, err
	}
	info, err := c.Info(ctx, "keyspace").Result()
	counts := map[int]int64{}
	if err == nil {
		for _, line := range strings.Split(info, "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "db") {
				continue
			}
			// dbN:keys=K,expires=...
			colon := strings.IndexByte(line, ':')
			if colon < 0 {
				continue
			}
			idx, err := strconv.Atoi(line[2:colon])
			if err != nil {
				continue
			}
			for _, part := range strings.Split(line[colon+1:], ",") {
				if strings.HasPrefix(part, "keys=") {
					if k, err := strconv.ParseInt(part[len("keys="):], 10, 64); err == nil {
						counts[idx] = k
					}
				}
			}
		}
	}
	out := make([]drivers.RedisDB, maxDatabases)
	for i := 0; i < maxDatabases; i++ {
		out[i] = drivers.RedisDB{Index: i, Keys: counts[i]}
	}
	return out, nil
}

func (s *session) ScanKeys(ctx context.Context, req drivers.ScanRequest) (*drivers.ScanResult, error) {
	c, err := s.client(req.DB)
	if err != nil {
		return nil, err
	}
	pattern := req.Pattern
	if pattern == "" {
		pattern = "*"
	}
	count := req.Count
	if count <= 0 {
		count = 200
	}

	var keys []string
	var cursor uint64
	if req.TypeFilter != "" {
		keys, cursor, err = c.ScanType(ctx, req.Cursor, pattern, int64(count), req.TypeFilter).Result()
	} else {
		keys, cursor, err = c.Scan(ctx, req.Cursor, pattern, int64(count)).Result()
	}
	if err != nil {
		return nil, err
	}

	result := &drivers.ScanResult{Cursor: cursor}
	// Pipeline TYPE + TTL for the page.
	pipe := c.Pipeline()
	typeCmds := make([]*goredis.StatusCmd, len(keys))
	ttlCmds := make([]*goredis.DurationCmd, len(keys))
	for i, k := range keys {
		typeCmds[i] = pipe.Type(ctx, k)
		ttlCmds[i] = pipe.TTL(ctx, k)
	}
	if _, err := pipe.Exec(ctx); err != nil && err != goredis.Nil {
		return nil, err
	}
	for i, k := range keys {
		result.Keys = append(result.Keys, drivers.RedisKey{
			Key:  k,
			Type: typeCmds[i].Val(),
			TTL:  ttlSeconds(ttlCmds[i].Val()),
		})
	}
	return result, nil
}

func (s *session) GetValue(ctx context.Context, db int, key string) (*drivers.RedisValue, error) {
	c, err := s.client(db)
	if err != nil {
		return nil, err
	}
	typ, err := c.Type(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	if typ == "none" {
		return nil, fmt.Errorf("key %q does not exist", key)
	}
	ttl := ttlSeconds(c.TTL(ctx, key).Val())
	v := &drivers.RedisValue{Key: key, Type: typ, TTL: ttl}

	switch typ {
	case "string":
		v.String, err = c.Get(ctx, key).Result()
	case "list":
		var items []string
		items, err = c.LRange(ctx, key, 0, collectionCap).Result()
		if len(items) > collectionCap {
			items, v.Truncated = items[:collectionCap], true
		}
		v.List = items
	case "set":
		v.Set, v.Truncated, err = scanSet(ctx, c, key)
	case "hash":
		v.Hash, v.Truncated, err = scanHash(ctx, c, key)
	case "zset":
		var zs []goredis.Z
		zs, err = c.ZRangeWithScores(ctx, key, 0, collectionCap).Result()
		if len(zs) > collectionCap {
			zs, v.Truncated = zs[:collectionCap], true
		}
		for _, z := range zs {
			v.ZSet = append(v.ZSet, drivers.ZMember{Member: fmt.Sprint(z.Member), Score: z.Score})
		}
	case "stream":
		var msgs []goredis.XMessage
		msgs, err = c.XRangeN(ctx, key, "-", "+", collectionCap).Result()
		for _, m := range msgs {
			fields := map[string]string{}
			for fk, fv := range m.Values {
				fields[fk] = fmt.Sprint(fv)
			}
			v.Stream = append(v.Stream, drivers.StreamEntry{ID: m.ID, Fields: fields})
		}
	default:
		return nil, fmt.Errorf("unsupported type %q", typ)
	}
	if err != nil {
		return nil, err
	}
	return v, nil
}

func (s *session) SetString(ctx context.Context, db int, key, value string) error {
	c, err := s.client(db)
	if err != nil {
		return err
	}
	// Preserve any existing TTL when overwriting a string value.
	return c.Set(ctx, key, value, goredis.KeepTTL).Err()
}

func (s *session) SetTTL(ctx context.Context, db int, key string, seconds int64) error {
	c, err := s.client(db)
	if err != nil {
		return err
	}
	if seconds < 0 {
		return c.Persist(ctx, key).Err()
	}
	return c.Expire(ctx, key, time.Duration(seconds)*time.Second).Err()
}

func (s *session) DeleteKey(ctx context.Context, db int, key string) error {
	c, err := s.client(db)
	if err != nil {
		return err
	}
	return c.Del(ctx, key).Err()
}

func (s *session) RawCommand(ctx context.Context, db int, args []string) (*drivers.RedisReply, error) {
	c, err := s.client(db)
	if err != nil {
		return nil, err
	}
	iargs := make([]any, len(args))
	for i, a := range args {
		iargs[i] = a
	}
	res, err := c.Do(ctx, iargs...).Result()
	if err != nil {
		if err == goredis.Nil {
			return &drivers.RedisReply{Text: "(nil)"}, nil
		}
		return &drivers.RedisReply{Error: err.Error()}, nil
	}
	return &drivers.RedisReply{Text: formatReply(res, 0)}, nil
}

// --- helpers ------------------------------------------------------------

func ttlSeconds(d time.Duration) int64 {
	if d < 0 {
		return -1 // no expiry (or missing key); TTL of -2 collapses to -1
	}
	return int64(d / time.Second)
}

func scanSet(ctx context.Context, c *goredis.Client, key string) ([]string, bool, error) {
	var out []string
	var cursor uint64
	for {
		members, cur, err := c.SScan(ctx, key, cursor, "*", 256).Result()
		if err != nil {
			return nil, false, err
		}
		out = append(out, members...)
		cursor = cur
		if cursor == 0 || len(out) >= collectionCap {
			break
		}
	}
	if len(out) > collectionCap {
		return out[:collectionCap], true, nil
	}
	return out, false, nil
}

func scanHash(ctx context.Context, c *goredis.Client, key string) (map[string]string, bool, error) {
	out := map[string]string{}
	var cursor uint64
	truncated := false
	for {
		pairs, cur, err := c.HScan(ctx, key, cursor, "*", 256).Result()
		if err != nil {
			return nil, false, err
		}
		for i := 0; i+1 < len(pairs); i += 2 {
			out[pairs[i]] = pairs[i+1]
		}
		cursor = cur
		if cursor == 0 {
			break
		}
		if len(out) >= collectionCap {
			truncated = true
			break
		}
	}
	return out, truncated, nil
}

// splitArgs does minimal shell-like splitting for the REPL, honoring
// double-quoted segments.
func splitArgs(s string) []string {
	var args []string
	var cur strings.Builder
	inQuote := false
	for _, r := range s {
		switch {
		case r == '"':
			inQuote = !inQuote
		case r == ' ' && !inQuote:
			if cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}

// formatReply renders a RESP reply as indented text.
func formatReply(v any, depth int) string {
	indent := strings.Repeat("  ", depth)
	switch x := v.(type) {
	case nil:
		return "(nil)"
	case string:
		return x
	case int64:
		return "(integer) " + strconv.FormatInt(x, 10)
	case []any:
		if len(x) == 0 {
			return "(empty)"
		}
		lines := make([]string, len(x))
		for i, item := range x {
			lines[i] = fmt.Sprintf("%s%d) %s", indent, i+1, formatReply(item, depth+1))
		}
		return strings.Join(lines, "\n")
	case map[any]any:
		keys := make([]string, 0, len(x))
		vals := map[string]any{}
		for k, val := range x {
			ks := fmt.Sprint(k)
			keys = append(keys, ks)
			vals[ks] = val
		}
		sort.Strings(keys)
		lines := make([]string, len(keys))
		for i, k := range keys {
			lines[i] = fmt.Sprintf("%s%s => %s", indent, k, formatReply(vals[k], depth+1))
		}
		return strings.Join(lines, "\n")
	default:
		return fmt.Sprint(x)
	}
}

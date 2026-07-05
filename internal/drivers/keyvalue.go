package drivers

import "context"

// RedisDB is one logical database (0–15) with its key count.
type RedisDB struct {
	Index int   `json:"index"`
	Keys  int64 `json:"keys"`
}

// ScanRequest drives cursor-based key listing. Listing always uses SCAN,
// never KEYS, so it stays safe on large production instances (design §4).
type ScanRequest struct {
	DB         int    `json:"db"`
	Pattern    string `json:"pattern"`    // glob; empty means "*"
	TypeFilter string `json:"typeFilter"` // string|list|set|zset|hash|stream; empty = all
	Cursor     uint64 `json:"cursor"`
	Count      int    `json:"count"`
}

// RedisKey is one key with its type and TTL (seconds; -1 = no expiry).
type RedisKey struct {
	Key  string `json:"key"`
	Type string `json:"type"`
	TTL  int64  `json:"ttl"`
}

// ScanResult is one page of SCAN output; Cursor 0 means iteration is done.
type ScanResult struct {
	Keys   []RedisKey `json:"keys"`
	Cursor uint64     `json:"cursor"`
}

// ZMember is a sorted-set member with its score.
type ZMember struct {
	Member string  `json:"member"`
	Score  float64 `json:"score"`
}

// StreamEntry is one entry of a stream.
type StreamEntry struct {
	ID     string            `json:"id"`
	Fields map[string]string `json:"fields"`
}

// RedisValue is a type-tagged view of a key's value plus its TTL. Only the
// field matching Type is populated.
type RedisValue struct {
	Key    string            `json:"key"`
	Type   string            `json:"type"`
	TTL    int64             `json:"ttl"`
	String string            `json:"string,omitempty"`
	Hash   map[string]string `json:"hash,omitempty"`
	List   []string          `json:"list,omitempty"`
	Set    []string          `json:"set,omitempty"`
	ZSet   []ZMember         `json:"zset,omitempty"`
	Stream []StreamEntry     `json:"stream,omitempty"`
	// Truncated is set when a large collection/string was capped for display.
	Truncated bool `json:"truncated"`
}

// RedisReply is the formatted result of a raw REPL command.
type RedisReply struct {
	// Text is a human-readable rendering (RESP-aware).
	Text  string `json:"text"`
	Error string `json:"error,omitempty"`
}

// KeyValue is implemented by Redis-style sessions to power the key browser
// and REPL. It is an optional capability alongside the base Session, mirroring
// how TableEditor extends SQL sessions.
type KeyValue interface {
	ListDatabases(ctx context.Context) ([]RedisDB, error)
	ScanKeys(ctx context.Context, req ScanRequest) (*ScanResult, error)
	GetValue(ctx context.Context, db int, key string) (*RedisValue, error)
	SetString(ctx context.Context, db int, key, value string) error
	// SetTTL sets an expiry in seconds; a negative value persists the key.
	SetTTL(ctx context.Context, db int, key string, seconds int64) error
	DeleteKey(ctx context.Context, db int, key string) error
	// RawCommand runs an arbitrary command for the REPL tab.
	RawCommand(ctx context.Context, db int, args []string) (*RedisReply, error)
}

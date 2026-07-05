# DataGrid — Design Document

A native macOS (Apple Silicon) database GUI tool in the spirit of DataGrip / TablePlus.

- **Status:** v0.3 (2026-07-05) — Go implementation; milestones M0–M5 built (Postgres, MySQL/MariaDB, Redis/Valkey; editing, history, EXPLAIN, cell inspector, prod/read-only labels). Release signing/notarization/auto-update pending Apple credentials (see [RELEASE.md](RELEASE.md)).
- **Target platform:** macOS 13+ on ARM64 (Apple Silicon) first; architecture keeps the door open for Intel macOS, Linux, and Windows later.
- **Initial database support:** MySQL / MariaDB, PostgreSQL, Redis / Valkey.

---

## 1. Goals

1. Fast, low-memory desktop app for browsing schemas, running queries, and editing data.
2. First-class support for the three engine families above behind one consistent UI.
3. Safe by default: credentials in the macOS Keychain, read-only mode per connection, confirmation on destructive statements.
4. Handle large result sets (100k+ rows) without freezing the UI.
5. SSH tunnel and TLS support out of the box (most real-world connections are remote).

### Non-goals (v1)

- Database administration features (user management, replication setup, backup scheduling).
- ER diagrams, schema diff/migration tooling.
- Other engines (SQLite, MongoDB, ClickHouse, etc.) — the driver layer must make adding them cheap, but none ship in v1.
- Windows/Linux builds (keep code portable, don't test or package).

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| App shell | **Wails v2** | Native ARM64 binary, uses the system WKWebView, low RAM vs Electron; Go-native equivalent of Tauri |
| Core / backend | **Go** (goroutines + `context`) | Excellent, battle-tested DB drivers; built-in pooling via `database/sql`; SSH tunneling in the stdlib ecosystem; all off the UI thread |
| Frontend | **React + TypeScript + Vite** | Mature ecosystem for the two hard UI pieces: editor and grid |
| SQL editor | **CodeMirror 6** (`@codemirror/lang-sql`) | Lightweight in a webview, dialect-aware highlighting, extensible autocomplete |
| Results grid | **Glide Data Grid** | Canvas-rendered, virtualized — smooth with millions of cells, supports inline editing |
| SQL drivers | **`database/sql`** with **go-sql-driver/mysql** and **pgx v5** (stdlib mode) | One row/column/type metadata model across both SQL engines; drop to native pgx / mysql protocol per-operation where fidelity demands it |
| Redis driver | **go-redis v9** | Mature; RESP2/RESP3; works unchanged against Valkey |
| SSH tunnel | **golang.org/x/crypto/ssh** | Pure-Go SSH2 client, no OpenSSH subprocess management |
| Credentials | **keybase/go-keychain** | Direct macOS Keychain access; swap in a cross-platform keyring wrapper for other OSes later |
| State/store | Zustand (frontend), SQLite via **modernc.org/sqlite** (backend, for app metadata) | Pure-Go (cgo-free) SQLite keeps cross-compilation simple; app metadata = saved connections, query history, window layout |

Why not the alternatives, briefly: SwiftUI would give the most Mac-native feel but lacks solid async MySQL/Postgres drivers and makes a spreadsheet-grade editable grid a large custom project. Electron is fastest to prototype but ships a ~150 MB runtime and 3–5× the memory footprint, which conflicts with goal 1. Tauri/Rust produces slightly smaller binaries, but Go's database driver ecosystem (`database/sql`, pgx, go-redis) is more mature for this exact problem domain, and Go's concurrency model maps naturally onto per-query goroutines with `context`-based cancellation.

---

## 3. Architecture Overview

```
┌───────────────────────────────────────────────────────────┐
│ WKWebView (React/TS)                                      │
│  Sidebar (connections, schema tree)                       │
│  Tabs: SQL editor + results grid │ table data │ redis kv  │
└───────────────▲───────────────────────────▲───────────────┘
        Wails bound methods (request/resp)  │ Wails runtime events (streams)
┌───────────────┴───────────────────────────┴───────────────┐
│ Go core (goroutines)                                      │
│  ConnectionManager ── Driver interface ─┬─ sqlDriver      │
│  QueryRunner (cancel, stream, page)     ├─ MySQL/MariaDB  │
│  SchemaIntrospector                     ├─ PostgreSQL     │
│  TunnelManager (x/crypto/ssh)           └─ redisDriver    │
│  SecretStore (go-keychain)                                │
│  MetaStore (sqlite: history, saved connections)           │
└───────────────────────────────────────────────────────────┘
```

Principles:

- **All I/O in Go.** The webview never talks to a database or the network; it only calls bound Go methods. This keeps secrets and sockets out of JS and keeps the UI responsive.
- **Request/response for small things, events for streams.** Fetching a schema tree is a bound-method call; a `SELECT` result streams to the frontend in row batches via Wails runtime events so first rows appear immediately.
- **Every long operation is cancellable.** Each running query gets an ID and its own `context.Context`; the UI can issue `CancelQuery(id)`, which cancels the context and triggers driver-level cancellation (`KILL QUERY` / `pg_cancel_backend` / close the Redis connection).

---

## 4. Driver Layer

The core abstraction is a pair of interfaces so the UI code never branches on engine type except where the feature genuinely differs (Redis has no SQL editor; SQL engines have no key browser).

```go
type Driver interface {
    Connect(ctx context.Context, cfg *ConnectionConfig) (Session, error)
    Capabilities() Capabilities // sql, kv, multiple_databases, ...
}

type Session interface {
    Ping(ctx context.Context) error
    Introspect(ctx context.Context, scope IntrospectScope) (*SchemaTree, error)
    Execute(ctx context.Context, req QueryRequest, sink RowSink) (*QuerySummary, error)
    Cancel(ctx context.Context, queryID QueryID) error
    Close() error
}
```

- **MySQL/MariaDB and PostgreSQL** share a `sqlSession` built on `database/sql`, parameterized by a small per-engine dialect object. Introspection queries `information_schema` (MySQL family) and `pg_catalog` (Postgres). MariaDB is treated as MySQL with a version/vendor probe at connect time to gate dialect differences (e.g. `RETURNING`, sequence objects).
- **Redis/Valkey** implements the same interfaces but `Introspect` returns databases 0–15 + key-pattern groups, and `Execute` accepts raw commands (for a REPL tab) while the key browser uses typed operations (`SCAN`-based listing, never `KEYS`; type-aware viewers for string/hash/list/set/zset/stream; TTL display and editing).
- **Values cross IPC as tagged JSON** (`{"t":"i64","v":...}`, `{"t":"bytes","v":"<base64>"}`, `{"t":"null"}` …) so the grid can render/edit type-faithfully. Oversized cells (BLOB/long TEXT/JSON) are truncated in the batch with a `ref` handle; a cell inspector fetches the full value on demand.

### Result streaming

`Execute` pushes `RowBatch { query_id, columns?, rows, seq }` events (~500 rows or 256 KB per batch, whichever first). The backend keeps the full result of the current page in a memory-bounded buffer; beyond a cap (default 10k rows) the UI switches to explicit paging (`LIMIT/OFFSET` or keyset when a usable key exists) rather than accumulating unbounded rows in the webview.

---

## 5. Connection Management

- **ConnectionConfig** (stored in the SQLite MetaStore, secrets stripped): engine, host, port, database, user, TLS mode, SSH tunnel config, color tag, read-only flag, environment label (`dev`/`staging`/`prod`).
- **Secrets** (DB password, SSH passphrase/key password) live only in the Keychain under a per-connection key; the MetaStore row holds a reference, never the value.
- **SSH tunnels:** TunnelManager opens one `x/crypto/ssh` client per (ssh host, credentials) and multiplexes local forwards across connections that share it. Auth: agent, key file, password. Tunnel lifecycle is tied to the connection pool — last pool closed tears the tunnel down.
- **Pooling:** one small `database/sql` pool (`SetMaxOpenConns(5)`) per open SQL connection; one multiplexed go-redis client for Redis. Idle disconnect after a configurable timeout (`SetConnMaxIdleTime`) with transparent reconnect.
- **Prod safety:** connections labeled `prod` default to read-only; leaving read-only and running DML/DDL requires a per-session confirmation. Destructive statements without a WHERE clause (`UPDATE`/`DELETE`) get a warning modal regardless of label.

---

## 6. UI Design

Layout mirrors DataGrip conventions: left sidebar, tabbed center, bottom status bar.

- **Sidebar:** connection list grouped by folder/color; expanding a connection lazily introspects databases → schemas → tables/views/routines (or Redis DBs → key groups). Search box filters the tree.
- **SQL editor tab:** CodeMirror with dialect set per connection; autocomplete fed by the cached `SchemaTree` (tables, columns, keywords); multiple statements per tab with "run statement at cursor" (⌘⏎) and "run all"; each run appends a result sub-tab. EXPLAIN shortcut renders plan as an indented tree.
- **Table data tab:** opens any table as an editable grid — filter row, sort by column, page controls. Edits accumulate as a pending changeset shown as a generated SQL preview; nothing hits the database until the user applies (wrapped in a transaction). Requires a PK or unique key to enable editing; otherwise read-only with an explanatory banner.
- **Redis tab:** key browser (SCAN with pattern + type filter, cursor-based infinite scroll), type-specific value editors, TTL column, and a raw command REPL sub-tab with RESP-aware output formatting.
- **Query history:** every executed statement recorded in MetaStore (connection, duration, row count, error) with full-text search.
- **macOS integration:** native menu bar with standard shortcuts, dark/light mode following the system, ⌘T new tab / ⌘W close tab, window state restore.

---

## 7. Security Considerations

- Secrets never serialize into MetaStore, logs, or the frontend; the webview receives only a connection ID.
- Webview locked down: assets served only from the bundled Wails asset server, strict CSP, no remote content loaded.
- TLS: system trust store by default; per-connection options for custom CA, client cert, or (explicit, warned) skip-verify.
- Query history stores statement text — add a per-connection "don't record history" toggle for sensitive environments.

---

## 8. Project Structure

```
datagrid/
├── docs/                  # this document, ADRs
├── main.go                # Wails entry point
├── internal/              # Go core
│   ├── drivers/           # Driver/Session interfaces + mysql/, postgres/, redis/
│   ├── tunnel/            # x/crypto/ssh tunnel manager
│   ├── meta/              # SQLite metadata store
│   ├── secrets/           # keychain wrapper
│   └── api/               # Wails bound methods (thin; logic lives above)
├── frontend/              # React frontend
│   └── src/
│       ├── components/    # grid, editor, sidebar, inspector
│       ├── features/      # connections/, query/, tabledata/, redis/, history/
│       └── ipc/           # typed wrappers over Wails bindings/events
└── e2e/                   # WebDriver tests against dockerized databases
```

IPC payload types are defined once in Go; Wails generates TypeScript models for all bound structs, so the two sides can't drift. Event payloads not covered by the generator are typed via a small `tygo`-generated module.

---

## 9. Milestones

| Milestone | Scope | Exit criteria |
|---|---|---|
| **M0 — Skeleton** | Wails v2 + React scaffold, CI (gofmt/go vet/golangci-lint/eslint/build), signed dev build on ARM | App opens, empty shell renders |
| **M1 — Postgres MVP** | Connect (incl. SSH tunnel + Keychain), schema tree, SQL editor, streaming read-only results, cancel | Run ad-hoc queries against a remote Postgres comfortably |
| **M2 — MySQL/MariaDB** | Second SQL driver through the same interface; dialect probe; autocomplete | Feature parity with M1 on MySQL and MariaDB |
| **M3 — Editing & history** | Editable table-data grid with changeset/transaction apply, query history, destructive-statement guards | Day-to-day CRUD workflows replace TablePlus for SQL |
| **M4 — Redis/Valkey** | Key browser, type editors, TTL, REPL | Browse and edit a production-style Redis safely |
| **M5 — Polish & release** | Cell inspector, EXPLAIN view, read-only/prod labels, notarized .dmg, auto-update | Public 0.1 release |

M1 before M2 deliberately: proving the streaming/cancel/introspection pipeline end-to-end on one engine is the risky part; the second SQL engine then validates that the driver abstraction actually abstracts.

---

## 10. Risks & Open Questions

- **`database/sql` fit:** the common interface flattens some engine-specific type information and doesn't cover multi-statement scripts or protocol features (e.g. MySQL `LOAD DATA LOCAL`, Postgres `COPY`). The `Session` interface isolates the decision to drop to native pgx or the raw mysql protocol per driver. Decide during M1/M2.
- **Wails version:** Wails v2 is stable but its successor v3 changes the binding/event APIs. Keep the `ipc/` wrapper layer thin so a v3 migration is contained; re-evaluate once v3 is stable.
- **Grid editing edge cases:** binary data, enum/set types, timezone handling for temporal types — needs a type-mapping matrix per engine before M3.
- **WKWebView quirks:** canvas performance and clipboard APIs differ from Chromium; validate Glide Data Grid on WKWebView in M0, with a fallback plan (TanStack Virtual + DOM grid).
- **Open:** app name ("DataGrid" collides with generic term and AG Grid branding — pick a distinct product name before release); license (OSS vs proprietary); auto-update channel (Wails updater story is thin — likely Sparkle or a custom check-and-download).

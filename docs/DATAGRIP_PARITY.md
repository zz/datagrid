# DataGrip Parity Ledger

This ledger tracks workflow parity, not visual imitation. "Complete" means the
workflow is implemented for its supported engines and covered by automated
tests. "Partial" means the core workflow exists with known scope differences.

Last reviewed: 2026-07-17.

## Data Sources and Navigation

| Workflow | Status | DataGrid coverage |
|---|---|---|
| Saved data sources | Complete | PostgreSQL, MySQL/MariaDB, Redis/Valkey; Keychain secrets; TLS and SSH tunneling |
| Database explorer | Complete | Lazy schemas, tables, views, routines, sequences, triggers, columns, favorites, search |
| Connection operations | Complete | Health checks, diagnostics, reconnect, database switching, color/environment/read-only state |
| Sessions and security | Partial | Session inspection/cancel and principals/privileges for supported SQL engines; no server configuration editor |
| Object source editing | Complete | View, routine, trigger, and sequence source workflows with engine-specific DDL |
| Additional engines | Not started | No SQLite, SQL Server, Oracle, CockroachDB, ClickHouse, or MongoDB drivers |

## Query Console

| Workflow | Status | DataGrid coverage |
|---|---|---|
| SQL editor | Complete | Dialect highlighting, schema/column autocomplete, statement-at-cursor and script execution |
| Console context | Complete | Schema/database context, row limits, timeouts, fetch size, saved console revisions |
| Productivity | Complete | Formatting, inspections/quick fixes, snippets, bookmarks, parameters, local and global history |
| Transactions | Complete | Manual begin/commit/rollback and transaction-aware result editing |
| Explain and benchmark | Complete | Estimated/actual plans, plan snapshots/comparison, repeated query benchmarks and baselines |
| Database debugger | Not started | No stored procedure debugger or breakpoint support |
| Query profiler | Partial | Plans and benchmark statistics exist; no live server flame graph or wait-event profiler |

## Result and Data Editing

| Workflow | Status | DataGrid coverage |
|---|---|---|
| Virtualized result grid | Complete | Large streamed results, paging, cancellation, column resize/reorder/hide/pin and named layouts |
| Filtering and sorting | Complete | Multi-sort, simple and grouped filters, distinct-value facets, saved filters, server-side projection |
| Result presentation | Complete | Grid, record, chart, pivot, snapshot comparison, per-column number/date/boolean/text formats |
| Selection tools | Complete | Range copy, statistics, find/replace, CSV/TSV/JSON/SQL export |
| Editable query results | Complete | Single-table detection, typed editors, FK lookup/navigation, insert/duplicate/delete, undo/redo |
| Safe apply | Complete | SQL preview, transactional changesets, optimistic conflict detection and overwrite/discard paths |
| Import/export | Complete | Delimited import mapping plus CSV/JSON/SQL exports; large values use full-cell retrieval |
| Native bulk protocols | Not started | No PostgreSQL COPY or MySQL LOAD DATA fast path |

## Schema and Operations

| Workflow | Status | DataGrid coverage |
|---|---|---|
| Table structure | Complete | Columns, keys, indexes, constraints, foreign keys, generated migration SQL |
| Schema comparison | Complete | Database/schema/table comparison, object synchronization, migration previews |
| Diagrams and dependencies | Complete | ER layout, virtual foreign keys, inbound/outbound dependency analysis |
| Data movement | Complete | Cross-connection table transfer, test-data generation and reusable presets |
| Maintenance | Partial | Explain, analyze/vacuum/optimize-style actions, backup/restore command orchestration; no scheduler |
| Version control integration | Not started | No database project model, migration VCS panel, or Git changelist integration |

## Redis and Valkey

| Workflow | Status | DataGrid coverage |
|---|---|---|
| Key navigation | Complete | Database list, SCAN pagination, pattern/type filtering, TTL and metadata |
| Value editing | Complete | String, hash, list, set, sorted set, and stream-aware inspection/editing |
| Command console | Complete | Raw command execution and history |
| Cluster administration | Not started | No topology, slot migration, memory analysis, or slow-log dashboard |

## UX and Platform

| Workflow | Status | DataGrid coverage |
|---|---|---|
| Workbench shell | Complete | Persistent tabs, explorer and history tool windows, command/go-to palettes, shortcuts, themes |
| Startup performance | Complete | Query, table, grid, CodeMirror, and secondary dialogs are demand-loaded |
| macOS distribution | Partial | Wails app and DMG build exist; Developer ID signing, notarization, and updater require release credentials |
| Accessibility and visual regression | Partial | Semantic controls and keyboard workflows exist; automated WKWebView screenshot coverage is still missing |
| Other desktop platforms | Not started | Windows and Linux are not packaged or tested |

## Next Priorities

1. Add automated native-webview smoke tests for connection, query, edit/apply,
   result formatting, and schema comparison workflows.
2. Add PostgreSQL COPY and MySQL LOAD DATA adapters for large imports/exports.
3. Add database project and migration-file workflows with Git-aware changes.
4. Complete signed/notarized macOS release automation and choose an updater.
5. Add the next SQL driver only after the shared capability contract and
   integration matrix can express its dialect differences.

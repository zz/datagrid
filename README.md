# DataGrid

## About

DataGrid is a native Wails database workbench for PostgreSQL, MySQL/MariaDB,
and Redis/Valkey. It provides database navigation, SQL consoles, editable
result grids, schema tools, query plans, data transfer, and operational tools
in a DataGrip-style desktop interface.

The application uses Go for database access and React/TypeScript for the
frontend. Project metadata and Wails build settings are in `wails.json`.

## Live Development

Install Go, Node.js 22, and Wails v2, then run:

```sh
cd frontend && npm ci && cd ..
wails dev
```

`wails dev` starts the native shell and Vite hot reload. The browser-compatible
development endpoint is `http://localhost:34115`.

## Verification

Run the regular hermetic checks with:

```sh
make check
cd frontend && npm test -- --run && npm run build
```

The driver integration fixtures require Docker Compose and use local ports
15432, 13306, and 16379:

```sh
make integration-up
make integration-test
make integration-down
```

Override `POSTGRES_IMAGE`, `MYSQL_IMAGE`, or `REDIS_IMAGE` to test another
compatible server version. The scheduled CI matrix covers PostgreSQL 15-17,
MySQL 8.0/8.4, MariaDB 10.11/11.4, Redis 7.2/7.4, and Valkey 8.

## Building

To build a redistributable production package, run `wails build`. See
`docs/RELEASE.md` for signing, notarization, and packaging steps.

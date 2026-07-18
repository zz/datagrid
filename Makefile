# DataGrid — native macOS database GUI (Wails v2 + React/TypeScript + Go).
#
# Common targets:
#   make dev           run the app with hot reload (localhost:34115)
#   make build         build the .app (ad-hoc signed by Wails)
#   make build-signed  build, then re-sign with a stable identity so the
#                      Keychain "Always Allow" grant sticks across rebuilds
#   make dmg           build the .app and package it into a drag-to-install .dmg
#   make check         run the full check suite (fmt, vet, go test, tsc, eslint)
#   make test          run Go tests
#   make clean         remove build artifacts

WAILS   ?= $(HOME)/go/bin/wails
APP      = build/bin/datagrid.app
DMG      = build/bin/DataGrid.dmg
VOLNAME  = DataGrid
GO_PACKAGES = . ./internal/...
# Stable self-signed code-signing identity (create once in Keychain Access:
# Certificate Assistant -> Create a Certificate -> Self-Signed Root, Code Signing).
# Override on the command line: make build-signed IDENTITY="My Identity"
IDENTITY ?= DataGrid Dev

.PHONY: dev build build-signed sign dmg generate check release-check fmt vet test tsc lint frontend-build integration-up integration-test integration-down clean

dev:
	$(WAILS) dev

build:
	$(WAILS) build

# Build then re-sign with a stable identity. Ad-hoc signatures (Wails' default)
# get a new cdhash every build, so macOS forgets the Keychain grant and
# re-prompts for the login password. A stable identity keeps the grant.
build-signed: build sign

sign:
	codesign --force --deep --sign "$(IDENTITY)" "$(APP)"
	@echo "Signed $(APP) with \"$(IDENTITY)\". Launch it and click \"Always Allow\" once."

# Package the built .app into a compressed, drag-to-install .dmg using the
# built-in hdiutil (no extra tooling). Run `make build` (or build-signed) first.
dmg:
	@test -d "$(APP)" || { echo "no $(APP); run 'make build' first"; exit 1; }
	@rm -f "$(DMG)"
	@staging=$$(mktemp -d) && \
	  cp -R "$(APP)" "$$staging/" && \
	  ln -s /Applications "$$staging/Applications" && \
	  hdiutil create -volname "$(VOLNAME)" -srcfolder "$$staging" -ov -format UDZO "$(DMG)" >/dev/null && \
	  rm -rf "$$staging" && \
	  echo "Built $(DMG) ($$(du -h "$(DMG)" | cut -f1))"

# Regenerate the TypeScript bindings for the Go bound methods.
generate:
	$(WAILS) generate module

check: fmt tsc lint frontend-build vet test

release-check: check
	go build $(GO_PACKAGES)
	cd frontend && npm test -- --run
	git diff --check

fmt:
	@echo "== gofmt ==" && test -z "$$(gofmt -l internal/)" || (gofmt -l internal/ && exit 1)

vet: frontend-build
	@echo "== go vet ==" && go vet $(GO_PACKAGES)

test: frontend-build
	@echo "== go test ==" && go test $(GO_PACKAGES)

tsc:
	@echo "== tsc ==" && cd frontend && npx tsc --noEmit

lint:
	@echo "== eslint ==" && cd frontend && npx eslint src --ext .ts,.tsx

frontend-build:
	@echo "== frontend build ==" && cd frontend && npm run build

integration-up:
	docker compose -f integration/compose.yml up -d --wait

integration-test:
	DATAGRID_TEST_PG=1 PGHOST=127.0.0.1 PGPORT=15432 PGUSER=datagrid PGPASSWORD=datagrid PGDATABASE=datagrid_test go test ./internal/drivers/postgres
	DATAGRID_TEST_MYSQL=1 MYSQL_HOST=127.0.0.1 MYSQL_PORT=13306 MYSQL_USER=root MYSQL_PASSWORD=datagrid MYSQL_DATABASE=datagrid_test go test ./internal/drivers/mysql
	DATAGRID_TEST_REDIS=1 REDIS_HOST=127.0.0.1 REDIS_PORT=16379 go test ./internal/drivers/redis

integration-down:
	docker compose -f integration/compose.yml down -v

clean:
	rm -rf build/bin

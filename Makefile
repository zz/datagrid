# DataGrid — native macOS database GUI (Wails v2 + React/TypeScript + Go).
#
# Common targets:
#   make dev           run the app with hot reload (localhost:34115)
#   make build         build the .app (ad-hoc signed by Wails)
#   make build-signed  build, then re-sign with a stable identity so the
#                      Keychain "Always Allow" grant sticks across rebuilds
#   make check         run the full check suite (fmt, vet, go test, tsc, eslint)
#   make test          run Go tests
#   make clean         remove build artifacts

WAILS   ?= $(HOME)/go/bin/wails
APP      = build/bin/datagrid.app
# Stable self-signed code-signing identity (create once in Keychain Access:
# Certificate Assistant -> Create a Certificate -> Self-Signed Root, Code Signing).
# Override on the command line: make build-signed IDENTITY="My Identity"
IDENTITY ?= DataGrid Dev

.PHONY: dev build build-signed sign generate check fmt vet test tsc lint clean

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

# Regenerate the TypeScript bindings for the Go bound methods.
generate:
	$(WAILS) generate module

check: fmt vet test tsc lint

fmt:
	@echo "== gofmt ==" && test -z "$$(gofmt -l internal/)" || (gofmt -l internal/ && exit 1)

vet:
	@echo "== go vet ==" && go vet ./...

test:
	@echo "== go test ==" && go test ./...

tsc:
	@echo "== tsc ==" && cd frontend && npx tsc --noEmit

lint:
	@echo "== eslint ==" && cd frontend && npx eslint src --ext .ts,.tsx

clean:
	rm -rf build/bin

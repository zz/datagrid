# Releasing DataGrid

This documents the macOS release pipeline (design milestone M5). The build
itself is reproducible with `wails build`; **signing, notarization, and
auto-update require an Apple Developer account and signing certificates that
are not in this repo.** Those steps are called out below and must be run by a
maintainer with the credentials.

## 1. Build (no credentials needed)

Run the release gate from a clean worktree before packaging:

```sh
make check
go build ./...
cd frontend && npm test -- --run && npm run build && cd ..
make integration-up
make integration-test
make integration-down
git diff --check
```

The driver integration CI workflow repeats the database suite across the
versions listed in [DATAGRIP_PARITY.md](DATAGRIP_PARITY.md). Confirm its latest
scheduled or manually dispatched run is green before tagging.

```sh
wails build              # dev/self-signed .app in build/bin/DataGrid.app
wails build -clean       # clean rebuild
```

The output is `build/bin/DataGrid.app`. The bundle identifier is
`com.datagrid.app`; product name/version come from `wails.json` → `info`.
Bump `productVersion` there for each release.

Before the final build, also verify:

- `docs/DATAGRIP_PARITY.md` reflects the shipped scope and known gaps.
- The release notes call out schema/storage migrations and driver changes.
- A fresh install and an upgrade from the previous release both open saved
  connections without exposing credentials or losing workspace state.
- Query, table edit/apply, Redis edit, backup command preview, and read-only
  safety workflows pass a native WKWebView smoke test.

## 2. Code signing — requires Apple Developer ID (maintainer only)

Signing needs a **"Developer ID Application"** certificate in the login
keychain and its team identity. Then:

```sh
wails build -platform darwin/arm64 \
  -webview2 embed \
  -ldflags "-X datagrid/internal/api.Version=0.1.0"

codesign --deep --force --options runtime --timestamp \
  --sign "Developer ID Application: <NAME> (<TEAMID>)" \
  build/bin/DataGrid.app
```

`--options runtime` (the hardened runtime) is required for notarization.

## 3. Notarization — requires Apple credentials (maintainer only)

Store an app-specific password once with `xcrun notarytool store-credentials`,
then:

```sh
ditto -c -k --keepParent build/bin/DataGrid.app DataGrid.zip
xcrun notarytool submit DataGrid.zip \
  --keychain-profile "datagrid-notary" --wait
xcrun stapler staple build/bin/DataGrid.app
```

`--wait` blocks until Apple returns accepted/invalid. Once stapled, the app
launches on other Macs without the Gatekeeper warning.

## 4. Package the .dmg

```sh
# create-dmg (brew install create-dmg) — layout only, no credentials
create-dmg --volname "DataGrid" --window-size 540 380 \
  --icon "DataGrid.app" 140 190 --app-drop-link 400 190 \
  DataGrid-0.1.0.dmg build/bin/DataGrid.app
```

Sign and notarize the `.dmg` the same way as the `.app` (steps 2–3) so the
disk image itself passes Gatekeeper.

## 5. Auto-update — decision pending

Two viable paths (see design §10 open question):

- **Sparkle** (`github.com/abemedia/appcast` + a Sparkle bridge): the mature
  macOS updater. Needs an EdDSA signing key and an appcast XML feed hosted
  somewhere stable.
- **Custom check-and-download**: a small `GET /latest.json` the app polls on
  launch; on a newer version, download the notarized `.dmg` and prompt. Wails
  v2 has no built-in updater, so this is hand-rolled.

Neither is wired up yet. When chosen, the update-check call belongs behind a
bound method in `internal/api` so the webview never fetches release artifacts
directly.

## CI note

`.github/workflows/ci.yml` builds unsigned on every push (no secrets). A
signed/notarized release job would run only on tags and needs these repo
secrets: the Developer ID cert (base64 `.p12` + password) imported into a
temporary keychain, and the notarytool app-specific password. Add that job
when the signing identity is available.

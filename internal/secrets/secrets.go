// Package secrets stores per-connection secrets (DB password, SSH
// passphrase) in the macOS Keychain (design §5). The MetaStore only ever
// holds a reference key, never the value.
package secrets

// Store reads and writes connection secrets. Callers never handle raw
// secrets outside this package; everything else passes refs. The macOS
// implementation is the Keychain (keychain_darwin.go).
type Store interface {
	Set(ref string, secret []byte) error
	Get(ref string) ([]byte, error)
	Delete(ref string) error
}

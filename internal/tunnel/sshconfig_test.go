package tunnel

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	ssh_config "github.com/kevinburke/ssh_config"

	"datagrid/internal/drivers"
)

func decode(t *testing.T, text string) *lookup {
	t.Helper()
	c, err := ssh_config.Decode(strings.NewReader(text))
	if err != nil {
		t.Fatalf("decode config: %v", err)
	}
	return configLookup(c)
}

const sampleConfig = `
Host db-bastion
    HostName bastion.example.com
    User deploy
    Port 2222
    IdentityFile ~/.ssh/deploy_key

Host prod-db
    HostName 10.0.0.5
    User dbadmin
    ProxyJump db-bastion
`

func TestResolveAlias(t *testing.T) {
	lk := decode(t, sampleConfig)
	// User enters just the alias "db-bastion"; everything else inherited.
	r := resolve(lk, &drivers.SSHCfg{Host: "db-bastion"})
	if r.Host != "bastion.example.com" {
		t.Errorf("HostName: got %q", r.Host)
	}
	if r.Port != 2222 {
		t.Errorf("Port: got %d", r.Port)
	}
	if r.User != "deploy" {
		t.Errorf("User: got %q", r.User)
	}
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, ".ssh", "deploy_key")
	if !slices.Contains(r.IdentityFiles, want) {
		t.Errorf("IdentityFiles: got %v, want to contain %q", r.IdentityFiles, want)
	}
}

func TestExplicitValuesWin(t *testing.T) {
	lk := decode(t, sampleConfig)
	// Explicit User/Port override the config for the same alias.
	r := resolve(lk, &drivers.SSHCfg{Host: "db-bastion", User: "override", Port: 9999})
	if r.User != "override" || r.Port != 9999 {
		t.Errorf("explicit values not honored: user=%q port=%d", r.User, r.Port)
	}
	if r.Host != "bastion.example.com" {
		t.Errorf("HostName should still resolve from config: %q", r.Host)
	}
}

func TestResolveProxyJump(t *testing.T) {
	lk := decode(t, sampleConfig)
	r := resolve(lk, &drivers.SSHCfg{Host: "prod-db"})
	if r.Host != "10.0.0.5" || r.User != "dbadmin" {
		t.Errorf("target resolution: host=%q user=%q", r.Host, r.User)
	}
	if !slices.Equal(r.ProxyJump, []string{"db-bastion"}) {
		t.Errorf("ProxyJump: got %v", r.ProxyJump)
	}
}

func TestProxyJumpChain(t *testing.T) {
	lk := decode(t, "Host t\n    ProxyJump a, user@b:2200 ,c\n")
	r := resolve(lk, &drivers.SSHCfg{Host: "t"})
	if !slices.Equal(r.ProxyJump, []string{"a", "user@b:2200", "c"}) {
		t.Errorf("chain parse: got %v", r.ProxyJump)
	}
}

func TestParseJump(t *testing.T) {
	cases := map[string]drivers.SSHCfg{
		"host":           {Host: "host"},
		"user@host":      {Host: "host", User: "user"},
		"host:2200":      {Host: "host", Port: 2200},
		"user@host:2200": {Host: "host", User: "user", Port: 2200},
		"bastion-alias":  {Host: "bastion-alias"},
	}
	for spec, want := range cases {
		got := parseJump(spec)
		if got.Host != want.Host || got.User != want.User || got.Port != want.Port {
			t.Errorf("parseJump(%q) = %+v, want %+v", spec, *got, want)
		}
	}
}

func TestDefaultIdentityFilesAppended(t *testing.T) {
	// A host with no explicit IdentityFile should still be offered the
	// standard OpenSSH default keys (the library only returns a stale
	// ~/.ssh/identity default, which is why real keys were missing before).
	lk := decode(t, "Host plain\n    HostName example.com\n")
	r := resolve(lk, &drivers.SSHCfg{Host: "plain"})
	home, _ := os.UserHomeDir()
	for _, want := range []string{
		filepath.Join(home, ".ssh", "id_rsa"),
		filepath.Join(home, ".ssh", "id_ed25519"),
	} {
		if !slices.Contains(r.IdentityFiles, want) {
			t.Errorf("default key %q not offered; got %v", want, r.IdentityFiles)
		}
	}
}

func TestUnknownAliasFallsThrough(t *testing.T) {
	lk := decode(t, sampleConfig)
	// A host not in the config keeps its literal values (+ default port 22).
	r := resolve(lk, &drivers.SSHCfg{Host: "192.168.1.1", User: "me"})
	if r.Host != "192.168.1.1" || r.User != "me" || r.Port != 22 {
		t.Errorf("passthrough: host=%q user=%q port=%d", r.Host, r.User, r.Port)
	}
	if len(r.ProxyJump) != 0 {
		t.Errorf("no ProxyJump expected, got %v", r.ProxyJump)
	}
}

package tunnel

import (
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"

	ssh_config "github.com/kevinburke/ssh_config"

	"datagrid/internal/drivers"
)

// lookup abstracts an ssh_config source so the resolver can be tested against
// a decoded in-memory config without touching ~/.ssh/config.
type lookup struct {
	get    func(alias, key string) string
	getAll func(alias, key string) []string
}

// userConfigLookup reads the real ~/.ssh/config (+ system config) via the
// library's default settings, which also applies ssh's built-in defaults.
func userConfigLookup() *lookup {
	return &lookup{
		get:    ssh_config.Get,
		getAll: ssh_config.GetAll,
	}
}

// configLookup wraps a decoded config (used in tests).
func configLookup(c *ssh_config.Config) *lookup {
	return &lookup{
		get: func(alias, key string) string {
			v, _ := c.Get(alias, key)
			return v
		},
		getAll: func(alias, key string) []string {
			v, _ := c.GetAll(alias, key)
			return v
		},
	}
}

// resolved is the effective connection settings after merging an explicit
// SSHCfg with anything found in ~/.ssh/config for that host alias.
type resolved struct {
	Host          string
	Port          int
	User          string
	IdentityFiles []string
	ProxyJump     []string // ordered hop chain; empty for a direct connection
}

// resolve merges explicit SSHCfg values with ~/.ssh/config. Explicit values
// always win; blanks are filled from the config for the host alias. This is
// what lets a user enter just a Host alias (e.g. "bastion") and inherit
// HostName / User / Port / IdentityFile / ProxyJump from their ssh config.
func resolve(lk *lookup, sc *drivers.SSHCfg) resolved {
	alias := sc.Host
	r := resolved{Host: sc.Host, Port: sc.Port, User: sc.User}

	if hn := lk.get(alias, "HostName"); hn != "" {
		r.Host = hn
	}
	if r.Port == 0 {
		if p := lk.get(alias, "Port"); p != "" {
			if n, err := strconv.Atoi(p); err == nil {
				r.Port = n
			}
		}
	}
	if r.Port == 0 {
		r.Port = 22
	}
	if r.User == "" {
		r.User = lk.get(alias, "User")
	}
	if r.User == "" {
		if u, err := user.Current(); err == nil {
			r.User = u.Username
		}
	}

	// Explicit key file wins; otherwise take IdentityFile(s) from config.
	if sc.KeyPath != "" {
		r.IdentityFiles = []string{expandHome(sc.KeyPath)}
	} else {
		for _, id := range lk.getAll(alias, "IdentityFile") {
			if id != "" {
				r.IdentityFiles = append(r.IdentityFiles, expandHome(id))
			}
		}
	}

	if pj := lk.get(alias, "ProxyJump"); pj != "" && !strings.EqualFold(pj, "none") {
		for part := range strings.SplitSeq(pj, ",") {
			if part = strings.TrimSpace(part); part != "" {
				r.ProxyJump = append(r.ProxyJump, part)
			}
		}
	}
	return r
}

// parseJump turns a ProxyJump spec ("[user@]host[:port]" or a config alias)
// into an SSHCfg whose blanks resolve() will fill from ~/.ssh/config.
func parseJump(spec string) *drivers.SSHCfg {
	cfg := &drivers.SSHCfg{}
	if at := strings.LastIndex(spec, "@"); at >= 0 {
		cfg.User = spec[:at]
		spec = spec[at+1:]
	}
	if colon := strings.LastIndex(spec, ":"); colon >= 0 {
		if p, err := strconv.Atoi(spec[colon+1:]); err == nil {
			cfg.Port = p
			spec = spec[:colon]
		}
	}
	cfg.Host = spec
	return cfg
}

// expandHome resolves a leading ~ to the user's home directory.
func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, strings.TrimPrefix(p, "~"))
		}
	}
	return p
}

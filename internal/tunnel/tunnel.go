// Package tunnel manages SSH tunnels (design §5). One SSH client per
// (host, port, user), multiplexing forwards across connections that share
// it; a client is torn down when its last lease is released.
package tunnel

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"datagrid/internal/drivers"
)

// Auth carries resolved SSH credentials. Secrets are fetched from the
// secret store by the caller (internal/api) so this package never sees refs.
type Auth struct {
	Password      string // SSH password (password auth)
	KeyPassphrase string // passphrase for the key file, if encrypted
}

// Manager owns all live SSH clients, keyed by endpoint+user.
type Manager struct {
	mu      sync.Mutex
	clients map[string]*sharedClient
}

type sharedClient struct {
	client *ssh.Client
	leases int
}

// NewManager creates an empty tunnel manager.
func NewManager() *Manager {
	return &Manager{clients: map[string]*sharedClient{}}
}

func key(cfg *drivers.SSHCfg) string {
	return fmt.Sprintf("%s@%s:%d", cfg.User, cfg.Host, cfg.Port)
}

// Lease returns a dialer that tunnels through the SSH host in cfg,
// opening the SSH client on first use. Call Release with the same cfg
// when the database pool using it closes.
func (m *Manager) Lease(ctx context.Context, cfg *drivers.SSHCfg, auth Auth) (func(ctx context.Context, network, addr string) (net.Conn, error), error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	k := key(cfg)
	sc, ok := m.clients[k]
	if !ok {
		client, err := dial(ctx, cfg, auth)
		if err != nil {
			return nil, err
		}
		sc = &sharedClient{client: client}
		m.clients[k] = sc
	}
	sc.leases++

	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		// ssh.Client.Dial has no context variant; guard with a deadline
		// goroutine only if the context carries one.
		type res struct {
			c   net.Conn
			err error
		}
		ch := make(chan res, 1)
		go func() {
			c, err := sc.client.Dial(network, addr)
			ch <- res{c, err}
		}()
		select {
		case r := <-ch:
			return r.c, r.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, nil
}

// Release drops one lease on the SSH client for cfg, closing it when the
// last lease is gone.
func (m *Manager) Release(cfg *drivers.SSHCfg) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(cfg)
	sc, ok := m.clients[k]
	if !ok {
		return
	}
	sc.leases--
	if sc.leases <= 0 {
		sc.client.Close()
		delete(m.clients, k)
	}
}

// Close tears down every client (app shutdown).
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, sc := range m.clients {
		sc.client.Close()
		delete(m.clients, k)
	}
}

// dial opens an SSH client to cfg's host. Settings are resolved from the
// user's ~/.ssh/config (HostName, User, Port, IdentityFile, ProxyJump), so a
// user can enter just a host alias, and connections chain through any
// configured ProxyJump bastions.
func dial(ctx context.Context, cfg *drivers.SSHCfg, auth Auth) (*ssh.Client, error) {
	return connect(ctx, userConfigLookup(), cfg, auth, nil, 0)
}

// connect establishes an SSH client to sc, tunneling the underlying TCP
// through `via` (a previous ProxyJump hop) when non-nil. It recurses to build
// the jump chain resolved from ~/.ssh/config.
func connect(ctx context.Context, lk *lookup, sc *drivers.SSHCfg, auth Auth, via *ssh.Client, depth int) (*ssh.Client, error) {
	if depth > 10 {
		return nil, fmt.Errorf("ssh ProxyJump chain too deep")
	}
	r := resolve(lk, sc)

	// Establish each jump host in order; the last jump carries the TCP to sc.
	for _, hop := range r.ProxyJump {
		jc, err := connect(ctx, lk, parseJump(hop), auth, via, depth+1)
		if err != nil {
			return nil, fmt.Errorf("ssh proxy jump %q: %w", hop, err)
		}
		via = jc
	}

	methods, tried := authMethods(r, auth)
	if len(methods) == 0 {
		return nil, fmt.Errorf("no usable SSH auth method for %s (no ssh-agent keys, no readable identity file, no password)", r.Host)
	}
	clientCfg := &ssh.ClientConfig{
		User: r.User,
		Auth: methods,
		// TODO(M5): verify against known_hosts with a trust-on-first-use
		// prompt instead of accepting any host key.
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec
		Timeout:         15 * time.Second,
	}

	addr := net.JoinHostPort(r.Host, strconv.Itoa(r.Port))
	var conn net.Conn
	var err error
	if via == nil {
		d := net.Dialer{Timeout: clientCfg.Timeout}
		conn, err = d.DialContext(ctx, "tcp", addr)
	} else {
		// Tunnel the TCP for this hop through the previous jump's SSH client.
		conn, err = via.Dial("tcp", addr)
	}
	if err != nil {
		return nil, fmt.Errorf("dial ssh host %s: %w", addr, err)
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, clientCfg)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("ssh handshake with %s (tried: %s): %w", addr, strings.Join(tried, ", "), err)
	}
	return ssh.NewClient(c, chans, reqs), nil
}

// authMethods builds the SSH auth list: ssh-agent first, then each identity
// file that exists and parses, then a password. Missing/unparseable identity
// files are skipped so config defaults don't hard-fail the connection. It also
// returns a human-readable list of what was actually offered, for errors.
func authMethods(r resolved, auth Auth) (methods []ssh.AuthMethod, tried []string) {
	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		if conn, err := net.Dial("unix", sock); err == nil {
			signers, _ := agent.NewClient(conn).Signers()
			if len(signers) > 0 {
				methods = append(methods, ssh.PublicKeysCallback(agent.NewClient(conn).Signers))
				tried = append(tried, fmt.Sprintf("agent(%d keys)", len(signers)))
			}
		}
	}
	for _, path := range r.IdentityFiles {
		pem, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var signer ssh.Signer
		if auth.KeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(pem, []byte(auth.KeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(pem)
		}
		if err != nil {
			// Note passphrase-protected keys explicitly rather than silently
			// dropping them — a common source of confusing auth failures.
			var need *ssh.PassphraseMissingError
			if errors.As(err, &need) {
				tried = append(tried, filepath.Base(path)+" (needs passphrase, skipped)")
			}
			continue
		}
		methods = append(methods, ssh.PublicKeys(signer))
		tried = append(tried, filepath.Base(path))
	}
	if auth.Password != "" {
		methods = append(methods, ssh.Password(auth.Password))
		tried = append(tried, "password")
	}
	return methods, tried
}

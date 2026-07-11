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
	cfg  *drivers.SSHCfg
	auth Auth

	mu     sync.Mutex
	client *ssh.Client // nil after the transport died; re-dialed on next use
	leases int
	closed bool
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
// when the database pool using it closes. The dialer survives transport
// loss: a client whose TCP dies (NAT timeout, server restart) is replaced
// on the next dial instead of failing every connection until app restart.
func (m *Manager) Lease(ctx context.Context, cfg *drivers.SSHCfg, auth Auth) (func(ctx context.Context, network, addr string) (net.Conn, error), error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	k := key(cfg)
	sc, ok := m.clients[k]
	if !ok {
		sc = &sharedClient{cfg: cfg, auth: auth}
		// Dial eagerly so a bad host/auth fails the connect, not the first query.
		if _, err := sc.live(ctx); err != nil {
			return nil, err
		}
		m.clients[k] = sc
	}
	sc.leases++
	return sc.dialThrough, nil
}

// live returns the current SSH client, re-dialing if the previous transport
// died. Dialing holds the lock so concurrent callers share one attempt.
func (sc *sharedClient) live(ctx context.Context) (*ssh.Client, error) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	if sc.closed {
		return nil, errors.New("ssh tunnel closed")
	}
	if sc.client != nil {
		return sc.client, nil
	}
	client, err := dial(ctx, sc.cfg, sc.auth)
	if err != nil {
		return nil, err
	}
	sc.client = client
	go sc.watch(client)
	return client, nil
}

// invalidate drops client if it is still current, so the next dial rebuilds.
func (sc *sharedClient) invalidate(client *ssh.Client) {
	sc.mu.Lock()
	if sc.client == client {
		sc.client = nil
	}
	sc.mu.Unlock()
	client.Close()
}

func (sc *sharedClient) shutdown() {
	sc.mu.Lock()
	sc.closed = true
	client := sc.client
	sc.client = nil
	sc.mu.Unlock()
	if client != nil {
		client.Close()
	}
}

// watch keeps the transport healthy for the client's lifetime: periodic
// keepalives stop NAT/firewall idle timeouts from silently dropping the
// mapping, and detect a dead transport within a minute instead of on the
// next failed query. Ends when the transport closes (Wait returns).
func (sc *sharedClient) watch(client *ssh.Client) {
	done := make(chan struct{})
	go func() {
		_ = client.Wait()
		close(done)
	}()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			sc.invalidate(client)
			return
		case <-ticker.C:
			if !alive(client) {
				client.Close() // Wait returns; the done case invalidates
			}
		}
	}
}

// alive reports whether the SSH transport still answers a keepalive request.
// A NAT-dropped socket accepts the write but never replies, so no answer
// within the timeout means dead.
func alive(client *ssh.Client) bool {
	ch := make(chan error, 1)
	go func() {
		_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
		ch <- err
	}()
	select {
	case err := <-ch:
		return err == nil
	case <-time.After(3 * time.Second):
		return false
	}
}

// dialThrough opens a connection to the database through the tunnel. If the
// dial fails because the SSH transport died since the last keepalive, the
// client is rebuilt and the dial retried once.
func (sc *sharedClient) dialThrough(ctx context.Context, network, addr string) (net.Conn, error) {
	client, err := sc.live(ctx)
	if err != nil {
		return nil, err
	}
	conn, err := dialVia(ctx, client, network, addr)
	if err == nil {
		return conn, nil
	}
	if alive(client) {
		return nil, err // live tunnel; the DB endpoint itself failed
	}
	sc.invalidate(client)
	client, rerr := sc.live(ctx)
	if rerr != nil {
		return nil, rerr
	}
	return dialVia(ctx, client, network, addr)
}

// dialVia runs client.Dial under ctx: ssh.Client.Dial has no context
// variant, so guard it with a goroutine and reap the conn if abandoned.
func dialVia(ctx context.Context, client *ssh.Client, network, addr string) (net.Conn, error) {
	type res struct {
		c   net.Conn
		err error
	}
	ch := make(chan res, 1)
	go func() {
		c, err := client.Dial(network, addr)
		ch <- res{c, err}
	}()
	select {
	case r := <-ch:
		return r.c, r.err
	case <-ctx.Done():
		go func() {
			if r := <-ch; r.c != nil {
				r.c.Close()
			}
		}()
		return nil, ctx.Err()
	}
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
		sc.shutdown()
		delete(m.clients, k)
	}
}

// Close tears down every client (app shutdown).
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, sc := range m.clients {
		sc.shutdown()
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

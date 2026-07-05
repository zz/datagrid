// Package tunnel manages SSH tunnels (design §5). One SSH client per
// (host, port, user), multiplexing forwards across connections that share
// it; a client is torn down when its last lease is released.
package tunnel

import (
	"context"
	"fmt"
	"net"
	"os"
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

// dial opens an SSH client trying, in order: ssh-agent, key file, password.
func dial(ctx context.Context, cfg *drivers.SSHCfg, auth Auth) (*ssh.Client, error) {
	var methods []ssh.AuthMethod

	if sock := os.Getenv("SSH_AUTH_SOCK"); sock != "" {
		if conn, err := net.Dial("unix", sock); err == nil {
			methods = append(methods, ssh.PublicKeysCallback(agent.NewClient(conn).Signers))
		}
	}
	if cfg.KeyPath != "" {
		pem, err := os.ReadFile(cfg.KeyPath)
		if err != nil {
			return nil, fmt.Errorf("read ssh key: %w", err)
		}
		var signer ssh.Signer
		if auth.KeyPassphrase != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(pem, []byte(auth.KeyPassphrase))
		} else {
			signer, err = ssh.ParsePrivateKey(pem)
		}
		if err != nil {
			return nil, fmt.Errorf("parse ssh key: %w", err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}
	if auth.Password != "" {
		methods = append(methods, ssh.Password(auth.Password))
	}
	if len(methods) == 0 {
		return nil, fmt.Errorf("no usable SSH auth method (agent, key file, or password)")
	}

	port := cfg.Port
	if port == 0 {
		port = 22
	}
	clientCfg := &ssh.ClientConfig{
		User: cfg.User,
		Auth: methods,
		// TODO(M5): verify against known_hosts with a trust-on-first-use
		// prompt instead of accepting any host key.
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec
		Timeout:         15 * time.Second,
	}

	d := net.Dialer{Timeout: clientCfg.Timeout}
	conn, err := d.DialContext(ctx, "tcp", fmt.Sprintf("%s:%d", cfg.Host, port))
	if err != nil {
		return nil, fmt.Errorf("dial ssh host: %w", err)
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, conn.RemoteAddr().String(), clientCfg)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("ssh handshake: %w", err)
	}
	return ssh.NewClient(c, chans, reqs), nil
}

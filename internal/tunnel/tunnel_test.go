package tunnel

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"datagrid/internal/drivers"
)

// testSSHServer is an in-process SSH server that answers direct-tcpip
// channels with a fixed banner, standing in for the database endpoint.
type testSSHServer struct {
	addr net.Addr
	ln   net.Listener

	mu    sync.Mutex
	conns []net.Conn // raw TCP conns, so tests can kill the transport
}

func startSSHServer(t *testing.T) *testSSHServer {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &ssh.ServerConfig{NoClientAuth: true}
	cfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &testSSHServer{addr: ln.Addr(), ln: ln}
	t.Cleanup(func() { ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.conns = append(s.conns, conn)
			s.mu.Unlock()
			go s.serve(conn, cfg)
		}
	}()
	return s
}

func (s *testSSHServer) serve(conn net.Conn, cfg *ssh.ServerConfig) {
	sconn, chans, reqs, err := ssh.NewServerConn(conn, cfg)
	if err != nil {
		return
	}
	defer sconn.Close()
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		if nc.ChannelType() != "direct-tcpip" {
			nc.Reject(ssh.UnknownChannelType, "unsupported")
			continue
		}
		ch, chReqs, err := nc.Accept()
		if err != nil {
			continue
		}
		go ssh.DiscardRequests(chReqs)
		go func() {
			ch.Write([]byte("banner"))
			ch.Close()
		}()
	}
}

// killConns closes the raw TCP transports, simulating a dropped connection.
func (s *testSSHServer) killConns() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.conns {
		c.Close()
	}
	s.conns = nil
}

func dialAndRead(t *testing.T, dialer func(ctx context.Context, network, addr string) (net.Conn, error)) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := dialer(ctx, "tcp", "db.internal:3306")
	if err != nil {
		t.Fatalf("dial through tunnel: %v", err)
	}
	defer conn.Close()
	b, err := io.ReadAll(conn)
	if err != nil {
		t.Fatalf("read through tunnel: %v", err)
	}
	return string(b)
}

// TestDialerReconnectsAfterTransportLoss covers the day-idle scenario: the
// SSH transport dies underneath a leased dialer (NAT timeout, server
// restart) and the next database dial must transparently rebuild the tunnel
// instead of failing with broken pipe until app restart.
func TestDialerReconnectsAfterTransportLoss(t *testing.T) {
	srv := startSSHServer(t)
	port := srv.addr.(*net.TCPAddr).Port

	m := NewManager()
	defer m.Close()
	cfg := &drivers.SSHCfg{Host: "127.0.0.1", Port: port, User: "test"}
	dialer, err := m.Lease(context.Background(), cfg, Auth{Password: "unused"})
	if err != nil {
		t.Fatalf("lease: %v", err)
	}
	defer m.Release(cfg)

	if got := dialAndRead(t, dialer); got != "banner" {
		t.Fatalf("first dial: got %q, want %q", got, "banner")
	}

	srv.killConns()
	// Give the client's Wait a moment to observe the close and invalidate;
	// dialThrough also handles the not-yet-noticed case via its alive probe.
	time.Sleep(100 * time.Millisecond)

	if got := dialAndRead(t, dialer); got != "banner" {
		t.Fatalf("dial after transport loss: got %q, want %q", got, "banner")
	}
}

// blackholeProxy forwards TCP to target until blackholed, after which it
// keeps connections open but discards all traffic — the failure mode of a
// NAT/firewall dropping an idle mapping: writes succeed, replies never come.
type blackholeProxy struct {
	ln        net.Listener
	target    string
	blackhole bool
	mu        sync.Mutex
}

func startBlackholeProxy(t *testing.T, target string) *blackholeProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &blackholeProxy{ln: ln, target: target}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			up, err := net.Dial("tcp", target)
			if err != nil {
				conn.Close()
				continue
			}
			go p.pump(conn, up)
			go p.pump(up, conn)
		}
	}()
	return p
}

func (p *blackholeProxy) pump(dst, src net.Conn) {
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if err != nil {
			return
		}
		p.mu.Lock()
		dead := p.blackhole
		p.mu.Unlock()
		if dead {
			continue // swallow silently, like a dropped NAT mapping
		}
		if _, err := dst.Write(buf[:n]); err != nil {
			return
		}
	}
}

func (p *blackholeProxy) setBlackhole(v bool) {
	p.mu.Lock()
	p.blackhole = v
	p.mu.Unlock()
}

// TestDialerRecoversFromSilentDrop covers the NAT-timeout scenario: traffic
// is silently discarded without the transport closing. The dial that hits
// the dead tunnel fails (nothing can know sooner), but it must detect the
// dead transport via the keepalive probe and rebuild, so the next dial works.
func TestDialerRecoversFromSilentDrop(t *testing.T) {
	if testing.Short() {
		t.Skip("waits out the 3s keepalive probe timeout")
	}
	srv := startSSHServer(t)
	proxy := startBlackholeProxy(t, srv.addr.String())
	port := proxy.ln.Addr().(*net.TCPAddr).Port

	m := NewManager()
	defer m.Close()
	cfg := &drivers.SSHCfg{Host: "127.0.0.1", Port: port, User: "test"}
	dialer, err := m.Lease(context.Background(), cfg, Auth{Password: "unused"})
	if err != nil {
		t.Fatalf("lease: %v", err)
	}
	defer m.Release(cfg)

	if got := dialAndRead(t, dialer); got != "banner" {
		t.Fatalf("first dial: got %q, want %q", got, "banner")
	}

	proxy.setBlackhole(true)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	if _, err := dialer(ctx, "tcp", "db.internal:3306"); err == nil {
		t.Fatal("dial over silently-dropped transport should fail")
	}
	cancel()

	// The failed dial invalidated the dead client; new connections through
	// the proxy work again, so the rebuilt tunnel must succeed.
	proxy.setBlackhole(false)
	if got := dialAndRead(t, dialer); got != "banner" {
		t.Fatalf("dial after rebuild: got %q, want %q", got, "banner")
	}
}

// TestLeaseSharedAcrossConnections checks the lease accounting still holds
// with the reconnect-capable client: two leases share one client, and the
// tunnel stays usable until the last release.
func TestLeaseSharedAcrossConnections(t *testing.T) {
	srv := startSSHServer(t)
	port := srv.addr.(*net.TCPAddr).Port

	m := NewManager()
	defer m.Close()
	cfg := &drivers.SSHCfg{Host: "127.0.0.1", Port: port, User: "test"}
	d1, err := m.Lease(context.Background(), cfg, Auth{Password: "unused"})
	if err != nil {
		t.Fatalf("lease 1: %v", err)
	}
	d2, err := m.Lease(context.Background(), cfg, Auth{Password: "unused"})
	if err != nil {
		t.Fatalf("lease 2: %v", err)
	}

	m.Release(cfg) // drop lease 1; lease 2 keeps the client alive
	if got := dialAndRead(t, d2); got != "banner" {
		t.Fatalf("dial on remaining lease: got %q, want %q", got, "banner")
	}

	m.Release(cfg) // last lease gone: client shut down
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := d1(ctx, "tcp", "db.internal:3306"); err == nil {
		t.Fatal("dial after final release should fail")
	}
}

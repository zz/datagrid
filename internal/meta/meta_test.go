package meta

import (
	"path/filepath"
	"testing"
	"time"

	"datagrid/internal/drivers"
)

func openTemp(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "meta.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestConnectionRoundTrip(t *testing.T) {
	s := openTemp(t)
	cfg := drivers.ConnectionConfig{ID: "c1", Name: "Test", Engine: drivers.EnginePostgres, Host: "h", Port: 5432}
	if err := s.SaveConnection(cfg); err != nil {
		t.Fatal(err)
	}
	cfg.Name = "Renamed"
	if err := s.SaveConnection(cfg); err != nil { // upsert
		t.Fatal(err)
	}
	list, err := s.Connections()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Name != "Renamed" {
		t.Fatalf("want 1 renamed connection, got %+v", list)
	}
	if err := s.DeleteConnection("c1"); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.Connections(); len(list) != 0 {
		t.Errorf("want 0 after delete, got %d", len(list))
	}
}

func TestHistorySearch(t *testing.T) {
	s := openTemp(t)
	now := time.Now()
	_ = s.RecordHistory("c1", "SELECT * FROM users", now, 12*time.Millisecond, 25000, "")
	_ = s.RecordHistory("c1", "UPDATE users SET active = false", now, 3*time.Millisecond, 0, "")
	_ = s.RecordHistory("c2", "SELECT now()", now, 1*time.Millisecond, 1, "boom")

	all, err := s.History("", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("want 3 entries, got %d", len(all))
	}
	// Newest first.
	if all[0].Statement != "SELECT now()" {
		t.Errorf("newest first broken: %s", all[0].Statement)
	}
	if all[0].Error != "boom" {
		t.Errorf("error not recorded: %q", all[0].Error)
	}

	byConn, _ := s.History("c1", "", 10)
	if len(byConn) != 2 {
		t.Errorf("filter by conn: want 2, got %d", len(byConn))
	}

	search, _ := s.History("", "UPDATE", 10)
	if len(search) != 1 || search[0].RowCount != 0 {
		t.Errorf("search UPDATE: want 1 entry, got %d", len(search))
	}
}

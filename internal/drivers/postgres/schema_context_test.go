package postgres

import "testing"

func TestQuoteSearchPathItem(t *testing.T) {
	if got, want := quoteSearchPathItem(`tenant"east`), `"tenant""east"`; got != want {
		t.Fatalf("quoteSearchPathItem() = %q, want %q", got, want)
	}
}

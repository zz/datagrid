package mysql

import "testing"

func TestQuoteDatabase(t *testing.T) {
	if got, want := quoteDatabase("shop`archive"), "`shop``archive`"; got != want {
		t.Fatalf("quoteDatabase() = %q, want %q", got, want)
	}
}

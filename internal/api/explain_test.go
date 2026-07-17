package api

import "testing"

func TestIsAnalyzableStatement(t *testing.T) {
	tests := []struct {
		statement string
		want      bool
	}{
		{"SELECT * FROM users", true},
		{" ( SELECT 1", true},
		{"TABLE users", true},
		{"VALUES (1)", true},
		{"WITH removed AS (DELETE FROM users RETURNING *) SELECT * FROM removed", false},
		{"UPDATE users SET active = false", false},
		{"EXPLAIN SELECT 1", false},
	}
	for _, test := range tests {
		if got := isAnalyzableStatement(test.statement); got != test.want {
			t.Errorf("isAnalyzableStatement(%q) = %v, want %v", test.statement, got, test.want)
		}
	}
}

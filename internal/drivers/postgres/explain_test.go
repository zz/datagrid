package postgres

import (
	"strings"
	"testing"
)

func TestPGPlanNodeIncludesActualMetrics(t *testing.T) {
	node := pgPlanNode(map[string]any{
		"Node Type":          "Seq Scan",
		"Relation Name":      "users",
		"Actual Total Time":  1.25,
		"Actual Rows":        12.0,
		"Actual Loops":       2.0,
		"Shared Hit Blocks":  8.0,
		"Shared Read Blocks": 3.0,
	})
	for _, expected := range []string{"actual time=1.25 ms", "actual rows=12", "loops=2", "cache hits=8", "disk reads=3"} {
		if !strings.Contains(node.Detail, expected) {
			t.Errorf("plan detail %q does not contain %q", node.Detail, expected)
		}
	}
}

package mysql

import (
	"slices"
	"testing"
)

func TestIntrospectGroups(t *testing.T) {
	tree := (&session{}).introspectGroups()
	got := make([]string, 0, len(tree.Nodes))
	for _, node := range tree.Nodes {
		if node.Kind != "group" || !node.HasChildren || node.Scope == "" {
			t.Fatalf("invalid lazy group: %#v", node)
		}
		got = append(got, node.Name)
	}
	for _, want := range []string{"Tables", "Views", "Routines", "Triggers"} {
		if !slices.Contains(got, want) {
			t.Errorf("missing group %q in %v", want, got)
		}
	}
}

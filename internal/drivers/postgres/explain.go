package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"datagrid/internal/drivers"
)

// Explain runs EXPLAIN (FORMAT JSON) and normalizes the plan into a tree.
func (s *session) Explain(ctx context.Context, statement string) (*drivers.PlanNode, error) {
	return s.explain(ctx, statement, false)
}

func (s *session) Analyze(ctx context.Context, statement string) (*drivers.PlanNode, error) {
	return s.explain(ctx, statement, true)
}

func (s *session) explain(ctx context.Context, statement string, analyze bool) (*drivers.PlanNode, error) {
	var raw string
	prefix := "EXPLAIN (FORMAT JSON) "
	if analyze {
		prefix = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "
	}
	err := s.pool.QueryRow(ctx, prefix+statement).Scan(&raw)
	if err != nil {
		return nil, err
	}

	// EXPLAIN (FORMAT JSON) returns [{"Plan": {...}}].
	var plans []struct {
		Plan map[string]any `json:"Plan"`
	}
	if err := json.Unmarshal([]byte(raw), &plans); err != nil {
		return nil, fmt.Errorf("parse plan: %w", err)
	}
	if len(plans) == 0 {
		return &drivers.PlanNode{Label: "(empty plan)"}, nil
	}
	node := pgPlanNode(plans[0].Plan)
	return &node, nil
}

func pgPlanNode(m map[string]any) drivers.PlanNode {
	node := drivers.PlanNode{Label: str(m, "Node Type")}
	if node.Label == "" {
		node.Label = "Node"
	}
	// Append the target relation/index to the label when present.
	if rel := str(m, "Relation Name"); rel != "" {
		node.Label += " on " + rel
		if alias := str(m, "Alias"); alias != "" && alias != rel {
			node.Label += " " + alias
		}
	}
	if idx := str(m, "Index Name"); idx != "" {
		node.Label += " using " + idx
	}

	var details []string
	if v, ok := m["Startup Cost"]; ok {
		details = append(details, fmt.Sprintf("cost=%v..%v", v, m["Total Cost"]))
	}
	if v, ok := m["Plan Rows"]; ok {
		details = append(details, fmt.Sprintf("rows=%v", v))
	}
	if v, ok := m["Plan Width"]; ok {
		details = append(details, fmt.Sprintf("width=%v", v))
	}
	if v, ok := m["Actual Total Time"]; ok {
		details = append(details, fmt.Sprintf("actual time=%v ms", v))
	}
	if v, ok := m["Actual Rows"]; ok {
		details = append(details, fmt.Sprintf("actual rows=%v", v))
	}
	if v, ok := m["Actual Loops"]; ok {
		details = append(details, fmt.Sprintf("loops=%v", v))
	}
	if v, ok := m["Shared Hit Blocks"]; ok {
		details = append(details, fmt.Sprintf("cache hits=%v", v))
	}
	if v, ok := m["Shared Read Blocks"]; ok {
		details = append(details, fmt.Sprintf("disk reads=%v", v))
	}
	if cond := str(m, "Index Cond"); cond != "" {
		details = append(details, "index: "+cond)
	}
	if filter := str(m, "Filter"); filter != "" {
		details = append(details, "filter: "+filter)
	}
	node.Detail = strings.Join(details, "  ")

	if children, ok := m["Plans"].([]any); ok {
		for _, c := range children {
			if cm, ok := c.(map[string]any); ok {
				node.Children = append(node.Children, pgPlanNode(cm))
			}
		}
	}
	return node
}

func str(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

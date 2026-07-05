package drivers

import "context"

// PlanNode is one node of a normalized query plan tree (design §6).
type PlanNode struct {
	Label    string     `json:"label"`
	Detail   string     `json:"detail,omitempty"`
	Children []PlanNode `json:"children,omitempty"`
}

// Explainer is implemented by SQL sessions that can produce a query plan.
type Explainer interface {
	Explain(ctx context.Context, statement string) (*PlanNode, error)
}

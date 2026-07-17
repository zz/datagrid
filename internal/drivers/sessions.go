package drivers

import "context"

// DatabaseSession is one server-side SQL connection visible to the current user.
type DatabaseSession struct {
	ID         string `json:"id"`
	User       string `json:"user"`
	Database   string `json:"database"`
	State      string `json:"state"`
	Client     string `json:"client"`
	Query      string `json:"query"`
	DurationMs int64  `json:"durationMs"`
	Own        bool   `json:"own"`
}

type SessionInspector interface {
	ListDatabaseSessions(ctx context.Context) ([]DatabaseSession, error)
	CancelDatabaseSession(ctx context.Context, id string) error
}

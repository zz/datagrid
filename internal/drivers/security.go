package drivers

import "context"

type DatabasePrincipal struct {
	Name       string   `json:"name"`
	Host       string   `json:"host"`
	Login      bool     `json:"login"`
	Admin      bool     `json:"admin"`
	Attributes []string `json:"attributes"`
	Grants     []string `json:"grants"`
}

type SecurityInspector interface {
	ListDatabasePrincipals(ctx context.Context) ([]DatabasePrincipal, error)
}

type PrivilegeChange struct {
	Action    string `json:"action"`
	Principal string `json:"principal"`
	Host      string `json:"host"`
	Privilege string `json:"privilege"`
	Scope     string `json:"scope"`
	Schema    string `json:"schema"`
	Object    string `json:"object"`
}

type PrivilegeEditor interface {
	ChangePrivilege(ctx context.Context, change PrivilegeChange, apply bool) (string, error)
}

type PrincipalChange struct {
	Action   string `json:"action"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Login    bool   `json:"login"`
	Password string `json:"password"`
	Role     string `json:"role"`
	RoleHost string `json:"roleHost"`
}

type PrincipalEditor interface {
	ChangePrincipal(ctx context.Context, change PrincipalChange, apply bool) (string, error)
}

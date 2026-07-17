package backup

import (
	"fmt"
	"path/filepath"
	"strings"

	"datagrid/internal/drivers"
)

type Command struct {
	Tool      string
	Args      []string
	Env       []string
	StdinPath string
}

func Dump(cfg drivers.ConnectionConfig, password, path, format string) (Command, error) {
	switch cfg.Engine {
	case "postgres":
		args := []string{"--host", cfg.Host, "--port", fmt.Sprint(cfg.Port), "--username", cfg.User, "--dbname", cfg.Database, "--no-password", "--file", path}
		if format == "custom" {
			args = append(args, "--format", "custom")
		} else {
			args = append(args, "--format", "plain", "--no-owner", "--no-privileges")
		}
		return Command{Tool: "pg_dump", Args: args, Env: []string{"PGPASSWORD=" + password}}, nil
	case "mysql":
		args := []string{"--host", cfg.Host, "--port", fmt.Sprint(cfg.Port), "--user", cfg.User, "--single-transaction", "--routines", "--triggers", "--result-file", path, cfg.Database}
		return Command{Tool: "mysqldump", Args: args, Env: []string{"MYSQL_PWD=" + password}}, nil
	default:
		return Command{}, fmt.Errorf("backup is not supported for %s", cfg.Engine)
	}
}

func Restore(cfg drivers.ConnectionConfig, password, path string, clean bool) (Command, error) {
	switch cfg.Engine {
	case "postgres":
		common := []string{"--host", cfg.Host, "--port", fmt.Sprint(cfg.Port), "--username", cfg.User, "--dbname", cfg.Database, "--no-password"}
		if strings.EqualFold(filepath.Ext(path), ".dump") || strings.EqualFold(filepath.Ext(path), ".backup") {
			if clean {
				common = append(common, "--clean", "--if-exists")
			}
			return Command{Tool: "pg_restore", Args: append(common, "--no-owner", "--no-privileges", path), Env: []string{"PGPASSWORD=" + password}}, nil
		}
		args := append(common, "--file", path, "--set", "ON_ERROR_STOP=on")
		return Command{Tool: "psql", Args: args, Env: []string{"PGPASSWORD=" + password}}, nil
	case "mysql":
		args := []string{"--host", cfg.Host, "--port", fmt.Sprint(cfg.Port), "--user", cfg.User, "--database", cfg.Database}
		return Command{Tool: "mysql", Args: args, Env: []string{"MYSQL_PWD=" + password}, StdinPath: path}, nil
	default:
		return Command{}, fmt.Errorf("restore is not supported for %s", cfg.Engine)
	}
}

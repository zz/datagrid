package drivers

import (
	"fmt"
	"strings"
)

// CompileNamedParameters replaces :name parameters outside SQL strings and
// comments with engine placeholders and returns bound values in occurrence order.
func CompileNamedParameters(statement string, engine Engine, values map[string]string) (string, []any, error) {
	var out strings.Builder
	var args []any
	state := byte(0) // quote character, or c=line comment, b=block comment
	dollarTag := ""

	for i := 0; i < len(statement); {
		ch := statement[i]
		if dollarTag != "" {
			if strings.HasPrefix(statement[i:], dollarTag) {
				out.WriteString(dollarTag)
				i += len(dollarTag)
				dollarTag = ""
			} else {
				out.WriteByte(ch)
				i++
			}
			continue
		}
		if state == 'c' {
			out.WriteByte(ch)
			i++
			if ch == '\n' {
				state = 0
			}
			continue
		}
		if state == 'b' {
			out.WriteByte(ch)
			i++
			if ch == '*' && i < len(statement) && statement[i] == '/' {
				out.WriteByte('/')
				i++
				state = 0
			}
			continue
		}
		if state != 0 {
			out.WriteByte(ch)
			i++
			if ch == '\\' && i < len(statement) {
				out.WriteByte(statement[i])
				i++
				continue
			}
			if ch == state {
				if i < len(statement) && statement[i] == state {
					out.WriteByte(statement[i])
					i++
					continue
				}
				state = 0
			}
			continue
		}
		if ch == '-' && i+1 < len(statement) && statement[i+1] == '-' {
			out.WriteString("--")
			i += 2
			state = 'c'
			continue
		}
		if ch == '#' && engine == EngineMySQL {
			out.WriteByte(ch)
			i++
			state = 'c'
			continue
		}
		if ch == '/' && i+1 < len(statement) && statement[i+1] == '*' {
			out.WriteString("/*")
			i += 2
			state = 'b'
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			state = ch
			out.WriteByte(ch)
			i++
			continue
		}
		if ch == '$' && engine == EnginePostgres {
			if end := strings.IndexByte(statement[i+1:], '$'); end >= 0 {
				tag := statement[i : i+end+2]
				valid := true
				for j := 1; j < len(tag)-1; j++ {
					if !isParamPart(tag[j]) {
						valid = false
						break
					}
				}
				if valid {
					dollarTag = tag
					out.WriteString(tag)
					i += len(tag)
					continue
				}
			}
		}
		if ch == ':' && (i == 0 || statement[i-1] != ':') && i+1 < len(statement) && isParamStart(statement[i+1]) {
			end := i + 2
			for end < len(statement) && isParamPart(statement[end]) {
				end++
			}
			name := statement[i+1 : end]
			value, ok := values[name]
			if !ok {
				return "", nil, fmt.Errorf("missing query parameter %q", name)
			}
			args = append(args, value)
			if engine == EnginePostgres {
				fmt.Fprintf(&out, "$%d", len(args))
			} else {
				out.WriteByte('?')
			}
			i = end
			continue
		}
		out.WriteByte(ch)
		i++
	}
	return out.String(), args, nil
}

func isParamStart(ch byte) bool { return ch == '_' || ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' }
func isParamPart(ch byte) bool  { return isParamStart(ch) || ch >= '0' && ch <= '9' }

// SplitSQLStatements splits a script on top-level semicolons while preserving
// semicolons in quoted strings, identifiers, comments, and dollar-quoted bodies.
func SplitSQLStatements(script string, engine Engine) []string {
	var out []string
	start := 0
	state := byte(0)
	dollarTag := ""
	for i := 0; i < len(script); i++ {
		ch := script[i]
		if dollarTag != "" {
			if strings.HasPrefix(script[i:], dollarTag) {
				i += len(dollarTag) - 1
				dollarTag = ""
			}
			continue
		}
		if state == 'c' {
			if ch == '\n' {
				state = 0
			}
			continue
		}
		if state == 'b' {
			if ch == '*' && i+1 < len(script) && script[i+1] == '/' {
				i++
				state = 0
			}
			continue
		}
		if state != 0 {
			if ch == '\\' {
				i++
				continue
			}
			if ch == state {
				if i+1 < len(script) && script[i+1] == state {
					i++
				} else {
					state = 0
				}
			}
			continue
		}
		if ch == '-' && i+1 < len(script) && script[i+1] == '-' {
			i++
			state = 'c'
			continue
		}
		if ch == '#' && engine == EngineMySQL {
			state = 'c'
			continue
		}
		if ch == '/' && i+1 < len(script) && script[i+1] == '*' {
			i++
			state = 'b'
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			state = ch
			continue
		}
		if ch == '$' && engine == EnginePostgres {
			if matchEnd := strings.IndexByte(script[i+1:], '$'); matchEnd >= 0 {
				tag := script[i : i+matchEnd+2]
				valid := true
				for j := 1; j < len(tag)-1; j++ {
					if !isParamPart(tag[j]) {
						valid = false
						break
					}
				}
				if valid {
					dollarTag = tag
					i += len(tag) - 1
					continue
				}
			}
		}
		if ch == ';' {
			if statement := strings.TrimSpace(script[start:i]); statement != "" {
				out = append(out, statement)
			}
			start = i + 1
		}
	}
	if statement := strings.TrimSpace(script[start:]); statement != "" {
		out = append(out, statement)
	}
	return out
}

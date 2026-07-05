package drivers

import "fmt"

var registry = map[Engine]Driver{}

// Register makes a driver available by engine name. Drivers register
// themselves from their package init (mysql/, postgres/, redis/).
func Register(engine Engine, d Driver) {
	registry[engine] = d
}

// Get returns the driver for an engine.
func Get(engine Engine) (Driver, error) {
	d, ok := registry[engine]
	if !ok {
		return nil, fmt.Errorf("no driver registered for engine %q", engine)
	}
	return d, nil
}

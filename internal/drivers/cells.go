package drivers

import (
	"container/list"
	"fmt"
	"sync"
)

// CellTruncateAt is the per-cell size beyond which the full value is kept
// server-side (CellCache) and only a prefix crosses IPC, with a ref handle
// for the cell inspector.
const CellTruncateAt = 8 * 1024

// CellCache is a small LRU of oversized cell values, keyed by ref.
// Shared by all SQL drivers.
type CellCache struct {
	mu    sync.Mutex
	cap   int
	order *list.List // front = most recent; values are refs
	items map[string]cellEntry
}

type cellEntry struct {
	val  Value
	elem *list.Element
}

// NewCellCache creates a cache holding at most capacity values.
func NewCellCache(capacity int) *CellCache {
	return &CellCache{cap: capacity, order: list.New(), items: map[string]cellEntry{}}
}

// Put stores a full value and returns its ref.
func (c *CellCache) Put(queryID QueryID, n int, v Value) string {
	ref := fmt.Sprintf("%s/%d", queryID, n)
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.items[ref]; ok {
		c.order.MoveToFront(e.elem)
		c.items[ref] = cellEntry{val: v, elem: e.elem}
		return ref
	}
	elem := c.order.PushFront(ref)
	c.items[ref] = cellEntry{val: v, elem: elem}
	if c.order.Len() > c.cap {
		last := c.order.Back()
		c.order.Remove(last)
		delete(c.items, last.Value.(string))
	}
	return ref
}

// Get resolves a ref to the full value.
func (c *CellCache) Get(ref string) (*Value, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[ref]
	if !ok {
		return nil, false
	}
	c.order.MoveToFront(e.elem)
	v := e.val
	return &v, true
}

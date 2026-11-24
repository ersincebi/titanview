package api

import (
	"sync"
	"time"
)

// ttlCache is a tiny bounded response cache for expensive, read-only analytics
// (full-catalog daily scans). A nil *ttlCache is valid and caches nothing.
type ttlCache struct {
	mu  sync.Mutex
	ttl time.Duration
	max int
	m   map[string]cacheEntry
	now func() time.Time
}

type cacheEntry struct {
	at  time.Time
	val interface{}
}

func newTTLCache(ttl time.Duration, max int) *ttlCache {
	return &ttlCache{ttl: ttl, max: max, m: map[string]cacheEntry{}, now: time.Now}
}

func (c *ttlCache) get(key string) (interface{}, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[key]
	if !ok || c.now().Sub(e.at) > c.ttl {
		delete(c.m, key)
		return nil, false
	}
	return e.val, true
}

func (c *ttlCache) set(key string, val interface{}) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) >= c.max {
		c.m = map[string]cacheEntry{} // bounded: drop everything rather than track LRU
	}
	c.m[key] = cacheEntry{at: c.now(), val: val}
}

func (c *ttlCache) clear() {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m = map[string]cacheEntry{}
}

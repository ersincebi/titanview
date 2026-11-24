package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/analytics"
)

func TestInsightsEndpoint(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	var resp struct {
		Insights  analytics.Insights `json:"insights"`
		Benchmark string             `json:"benchmark"`
	}
	getJSON(t, h, "/api/insights?symbol=THYAO.IS", http.StatusOK, &resp)
	if resp.Insights.Bars < analytics.MinInsightBars || resp.Insights.Bias == "" {
		t.Fatalf("bad insights: %+v", resp.Insights)
	}
	if resp.Benchmark != "XU100.IS" {
		t.Fatalf("benchmark: %q", resp.Benchmark)
	}
	getJSON(t, h, "/api/insights", http.StatusBadRequest, nil)
}

func TestInsightsNoHistory(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{fail: map[string]bool{"THYAO.IS": true}})
	getJSON(t, h, "/api/insights?symbol=THYAO.IS", http.StatusBadGateway, nil)
}

func TestIdeasSortedAndOmitsFailed(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{fail: map[string]bool{"THYAO.IS": true}})
	var resp struct {
		Rows []IdeaRow `json:"rows"`
	}
	getJSON(t, h, "/api/ideas?market=BIST", http.StatusOK, &resp)
	if len(resp.Rows) == 0 {
		t.Fatal("expected rows")
	}
	for i, r := range resp.Rows {
		if r.Symbol == "THYAO.IS" {
			t.Fatal("failed symbol must be omitted")
		}
		if i > 0 && r.Score > resp.Rows[i-1].Score {
			t.Fatalf("not sorted desc at %d", i)
		}
		if len(r.Signals) > 3 {
			t.Fatalf("signals not capped: %d", len(r.Signals))
		}
	}
}

func TestTTLCache(t *testing.T) {
	c := newTTLCache(time.Minute, 2)
	now := time.Unix(1000, 0)
	c.now = func() time.Time { return now }
	if _, ok := c.get("a"); ok {
		t.Fatal("miss expected")
	}
	c.set("a", 1)
	if v, ok := c.get("a"); !ok || v.(int) != 1 {
		t.Fatal("hit expected")
	}
	now = now.Add(2 * time.Minute)
	if _, ok := c.get("a"); ok {
		t.Fatal("expired entry must miss")
	}
	c.set("a", 1)
	c.set("b", 2)
	c.set("c", 3) // exceeds max: reset, c survives
	if _, ok := c.get("a"); ok {
		t.Fatal("bounded cache must drop old entries")
	}
	if _, ok := c.get("c"); !ok {
		t.Fatal("newest must survive")
	}
	var nilCache *ttlCache
	nilCache.set("x", 1)
	if _, ok := nilCache.get("x"); ok {
		t.Fatal("nil cache caches nothing")
	}
}

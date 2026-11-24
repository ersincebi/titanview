package api

import (
	"net/http"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/analytics"
)

func TestAnalysisEndpoint(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	var resp struct {
		Analysis  analytics.Analysis  `json:"analysis"`
		MTF       []analytics.TFTrend `json:"mtf"`
		Agreement string              `json:"mtfAgreement"`
		Benchmark string              `json:"benchmark"`
	}
	getJSON(t, h, "/api/analysis?symbol=THYAO.IS", http.StatusOK, &resp)
	if len(resp.Analysis.Votes) < 8 || resp.Analysis.Bias == "" || resp.Analysis.Projection == nil {
		t.Fatalf("thin analysis: votes=%d bias=%q", len(resp.Analysis.Votes), resp.Analysis.Bias)
	}
	if resp.Analysis.Gaps == nil {
		t.Fatal("stock must carry gap stats")
	}
	if len(resp.MTF) != 5 || resp.Agreement == "" || resp.Benchmark != "XU100.IS" {
		t.Fatalf("mtf=%d agree=%q bench=%q", len(resp.MTF), resp.Agreement, resp.Benchmark)
	}
	getJSON(t, h, "/api/analysis", http.StatusBadRequest, nil)
}

func TestAnalysisCryptoHasNoGapsAndNoHistoryFails(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	var resp struct {
		Analysis analytics.Analysis `json:"analysis"`
	}
	getJSON(t, h, "/api/analysis?symbol=ETHUSDT", http.StatusOK, &resp)
	if resp.Analysis.Gaps != nil {
		t.Fatal("crypto trades 24/7: no gap stats")
	}
	h2 := newAnalyticsHandler(t, &stubUpstream{fail: map[string]bool{"THYAO.IS": true}})
	getJSON(t, h2, "/api/analysis?symbol=THYAO.IS", http.StatusBadGateway, nil)
}

func TestAnalysisRelated(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	var resp struct {
		Positive  []analytics.RelatedItem `json:"positive"`
		Negative  []analytics.RelatedItem `json:"negative"`
		Cross     []analytics.RelatedItem `json:"cross"`
		Beta      *float64                `json:"beta"`
		Benchmark string                  `json:"benchmark"`
	}
	getJSON(t, h, "/api/analysis/related?symbol=THYAO.IS", http.StatusOK, &resp)
	if len(resp.Positive)+len(resp.Negative) == 0 || len(resp.Cross) == 0 || resp.Benchmark != "XU100.IS" || resp.Beta == nil {
		t.Fatalf("related: %+v", resp)
	}
	for _, it := range resp.Positive {
		if it.Symbol == "THYAO.IS" {
			t.Fatal("subject must not correlate with itself")
		}
	}
	getJSON(t, h, "/api/analysis/related", http.StatusBadRequest, nil)
}

func TestAnalysisFlowTone(t *testing.T) {
	h := newAnalyticsHandler(t, &stubUpstream{})
	var resp struct {
		Tone analytics.ToneSummary `json:"tone"`
	}
	getJSON(t, h, "/api/analysis/flow?symbol=THYAO.IS", http.StatusOK, &resp)
	if len(resp.Tone.Items) != 1 || resp.Tone.Label == "" {
		t.Fatalf("tone %+v", resp.Tone)
	}
	getJSON(t, h, "/api/analysis/flow", http.StatusBadRequest, nil)
}

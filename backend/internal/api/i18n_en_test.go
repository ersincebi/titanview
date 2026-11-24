package api

import "testing"

func TestTranslateENAnalysisPhrases(t *testing.T) {
	cases := map[string]string{
		"Zirveden -51.3% aşağıda, zirve 412 bar önce":           "-51.3% below peak, peak 412 bars ago",
		"Fiyat SMA200 (72382.19) altında ama kısa vade karışık": "Price below SMA200 (72382.19) but short term mixed",
		"Fiyat EMA20 altında (-10.5%)":                          "Price below EMA20 (-10.5%)",
		"Güçlü düşüş eğilimi":                                   "Strong downtrend bias",
		"RSI(14) 24.6 — düşüş trendinde aşırı satım uzayabilir": "RSI(14) 24.6 — oversold can persist in a downtrend",
		"Nötr":    "Neutral",
		"BTCUSDT": "BTCUSDT",
	}
	for in, want := range cases {
		if got := translateEN(in); got != want {
			t.Errorf("translateEN(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLocalizeValueSkipsHeadlines(t *testing.T) {
	v := map[string]interface{}{"title": "Hisseler düştü", "note": "Nötr", "items": []interface{}{map[string]interface{}{"label": "Güçlü düşüş eğilimi"}}}
	out := localizeValue(v, "").(map[string]interface{})
	if out["title"] != "Hisseler düştü" {
		t.Fatalf("haber başlığı çevrilmemeli: %v", out["title"])
	}
	if out["note"] != "Neutral" {
		t.Fatalf("note çevrilmeli: %v", out["note"])
	}
	if out["items"].([]interface{})[0].(map[string]interface{})["label"] != "Strong downtrend bias" {
		t.Fatalf("iç içe etiket çevrilmeli: %v", out["items"])
	}
}

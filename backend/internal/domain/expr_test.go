package domain

import (
	"math"
	"testing"
)

func TestParseSymbolExpr(t *testing.T) {
	tests := []struct {
		raw       string
		isComplex bool
		legs      []string
		vars      map[string]float64
		want      float64
	}{
		{
			raw:       "BTCUSDT",
			isComplex: false,
			legs:      []string{"BTCUSDT"},
			vars:      map[string]float64{"BTCUSDT": 60000},
			want:      60000,
		},
		{
			raw:       "DX-Y.NYB",
			isComplex: false,
			legs:      []string{"DX-Y.NYB"},
			vars:      map[string]float64{"DX-Y.NYB": 104.5},
			want:      104.5,
		},
		{
			raw:       "BTCUSDT/ETHUSDT",
			isComplex: true,
			legs:      []string{"BTCUSDT", "ETHUSDT"},
			vars:      map[string]float64{"BTCUSDT": 60000, "ETHUSDT": 3000},
			want:      20.0,
		},
		{
			raw:       "THYAO.IS*USDTRY",
			isComplex: true,
			legs:      []string{"THYAO.IS", "USDTRY=X"},
			vars:      map[string]float64{"THYAO.IS": 300, "USDTRY=X": 34.5},
			want:      10350.0,
		},
		{
			raw:       "THYAO.IS/USDTRY",
			isComplex: true,
			legs:      []string{"THYAO.IS", "USDTRY=X"},
			vars:      map[string]float64{"THYAO.IS": 345, "USDTRY=X": 34.5},
			want:      10.0,
		},
		{
			raw:       "AAPL-MSFT",
			isComplex: true,
			legs:      []string{"AAPL", "MSFT"},
			vars:      map[string]float64{"AAPL": 220, "MSFT": 420},
			want:      -200.0,
		},
		{
			raw:       "0.5*BTCUSDT+0.5*ETHUSDT",
			isComplex: true,
			legs:      []string{"BTCUSDT", "ETHUSDT"},
			vars:      map[string]float64{"BTCUSDT": 60000, "ETHUSDT": 3000},
			want:      31500.0,
		},
		{
			raw:       "(THYAO.IS+GARAN.IS+ASELS.IS)/3",
			isComplex: true,
			legs:      []string{"THYAO.IS", "GARAN.IS", "ASELS.IS"},
			vars:      map[string]float64{"THYAO.IS": 300, "GARAN.IS": 120, "ASELS.IS": 90},
			want:      170.0,
		},
	}

	for _, tc := range tests {
		expr, err := ParseSymbolExpr(tc.raw)
		if err != nil {
			t.Fatalf("ParseSymbolExpr(%q) unexpected error: %v", tc.raw, err)
		}
		if expr.IsComplex != tc.isComplex {
			t.Fatalf("ParseSymbolExpr(%q) IsComplex=%v, want %v", tc.raw, expr.IsComplex, tc.isComplex)
		}
		gotLegs := expr.Symbols()
		if len(gotLegs) != len(tc.legs) {
			t.Fatalf("ParseSymbolExpr(%q) legs=%v, want %v", tc.raw, gotLegs, tc.legs)
		}
		for i := range gotLegs {
			if gotLegs[i] != tc.legs[i] {
				t.Fatalf("ParseSymbolExpr(%q) leg[%d]=%q, want %q", tc.raw, i, gotLegs[i], tc.legs[i])
			}
		}
		val, ok := expr.Eval(tc.vars)
		if !ok || math.Abs(val-tc.want) > 1e-6 {
			t.Fatalf("ParseSymbolExpr(%q).Eval()=(%v, %v), want %v", tc.raw, val, ok, tc.want)
		}
	}
}

func TestMergeExpressionCandlesAndCurrency(t *testing.T) {
	expr, err := ParseSymbolExpr("BTCUSDT/ETHUSDT")
	if err != nil {
		t.Fatal(err)
	}
	series := map[string][]Candle{
		"BTCUSDT": {
			{Timestamp: 1000, Open: 60000, High: 63000, Low: 57000, Close: 61500, Volume: 100},
			{Timestamp: 2000, Open: 61500, High: 64000, Low: 60000, Close: 64000, Volume: 150},
		},
		"ETHUSDT": {
			{Timestamp: 1000, Open: 3000, High: 3150, Low: 2850, Close: 3075, Volume: 500},
			{Timestamp: 2000, Open: 3075, High: 3200, Low: 3000, Close: 3200, Volume: 600},
		},
	}
	merged := MergeExpressionCandles(expr, series, "1h")
	if len(merged) != 2 {
		t.Fatalf("expected 2 merged candles, got %d", len(merged))
	}
	if math.Abs(merged[0].Open-20.0) > 1e-6 || math.Abs(merged[0].Close-20.0) > 1e-6 {
		t.Fatalf("unexpected merged[0]: %+v", merged[0])
	}

	// Test TRY -> USD conversion
	fxSym, inv, needed, ok := ResolveCurrencyConversion("TRY", "USD")
	if !ok || !needed || !inv || fxSym != "USDTRY=X" {
		t.Fatalf("unexpected ResolveCurrencyConversion(TRY, USD): %s inv=%v needed=%v ok=%v", fxSym, inv, needed, ok)
	}
	thyao := []Candle{{Symbol: "THYAO.IS", Timeframe: "1d", Timestamp: 86400 * 10, Open: 340, High: 357, Low: 323, Close: 340, Volume: 1000}}
	usdtry := []Candle{{Symbol: "USDTRY=X", Timeframe: "1d", Timestamp: 86400 * 10, Open: 34, High: 34, Low: 34, Close: 34, Volume: 0}}
	conv := ConvertCandlesWithFx(thyao, usdtry, inv, "USD")
	if len(conv) != 1 || math.Abs(conv[0].Close-10.0) > 1e-6 || math.Abs(conv[0].High-10.5) > 1e-6 {
		t.Fatalf("unexpected converted candle: %+v", conv)
	}
}

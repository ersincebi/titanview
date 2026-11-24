package analytics

import (
	"math"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

func series(start int64, closes []float64) []domain.Candle {
	out := make([]domain.Candle, len(closes))
	for i, c := range closes {
		out[i] = domain.Candle{Timestamp: start + int64(i)*86400, Open: c, High: c * 1.01, Low: c * 0.99, Close: c}
	}
	return out
}

func walk(n int, seed int) []float64 {
	out := make([]float64, n)
	p := 100.0
	for i := range out {
		p *= 1 + float64((i*seed)%7-3)*0.004
		out[i] = p
	}
	return out
}

func TestPearsonKnown(t *testing.T) {
	r, ok := Pearson([]float64{1, 2, 3, 4}, []float64{2, 4, 6, 8})
	if !ok || math.Abs(r-1) > 1e-12 {
		t.Fatalf("want 1, got %v %v", r, ok)
	}
	r, _ = Pearson([]float64{1, 2, 3, 4}, []float64{8, 6, 4, 2})
	if math.Abs(r+1) > 1e-12 {
		t.Fatalf("want -1, got %v", r)
	}
	if _, ok := Pearson([]float64{1, 1, 1}, []float64{1, 2, 3}); ok {
		t.Fatal("zero variance must be undefined")
	}
	if _, ok := Pearson([]float64{1}, []float64{1}); ok {
		t.Fatal("len<2 undefined")
	}
}

func TestCorrelationMatrix(t *testing.T) {
	base := walk(80, 3)
	inv := make([]float64, len(base)) // price = 10000/base -> log returns exactly negated
	for i, v := range base {
		inv[i] = 10000 / v
	}
	short := walk(10, 5)
	s := map[string][]domain.Candle{
		"A": series(0, base),
		"B": series(0, base),
		"C": series(0, inv),
		"D": series(0, short),
	}
	syms := []string{"A", "B", "C", "D"}
	m := CorrelationMatrix(syms, s)
	for i := range syms {
		if m[i][i] == nil || *m[i][i] != 1 {
			t.Fatalf("diag %d", i)
		}
	}
	if m[0][1] == nil || *m[0][1] != 1 {
		t.Fatalf("A~B want 1 got %v", m[0][1])
	}
	if m[0][2] == nil || *m[0][2] != -1 {
		t.Fatalf("A~C want -1 got %v", m[0][2])
	}
	if m[0][3] != nil {
		t.Fatalf("short overlap must be nil")
	}
	if m[2][0] != m[0][2] {
		t.Fatal("not symmetric")
	}
}

func TestCorrelationDateAlignment(t *testing.T) {
	base := walk(90, 3)
	// B has the same data but starts 10 days later; overlap days must still match by date, not index.
	a := series(0, base)
	b := series(10*86400, base[10:])
	m := CorrelationMatrix([]string{"A", "B"}, map[string][]domain.Candle{"A": a, "B": b})
	if m[0][1] == nil || *m[0][1] != 1 {
		t.Fatalf("date alignment broken: %v", m[0][1])
	}
}

func TestBeta(t *testing.T) {
	bench := walk(80, 3)
	lev := make([]float64, len(bench))
	lev[0] = 100
	for i := 1; i < len(bench); i++ {
		lev[i] = lev[i-1] * math.Pow(bench[i]/bench[i-1], 2) // log returns doubled
	}
	b, ok := Beta(series(0, lev), series(0, bench))
	if !ok || math.Abs(b-2) > 1e-9 {
		t.Fatalf("beta want 2 got %v", b)
	}
}

func TestComputeStats(t *testing.T) {
	// 300 days: rises 1 per day from 100, then ends with a drop.
	closes := make([]float64, 300)
	for i := range closes {
		closes[i] = 100 + float64(i)
	}
	closes[299] = closes[298] * 0.9
	// start 2023-01-01 UTC
	st, ok := ComputeStats(series(1672531200, closes))
	if !ok || st.Bars != 300 {
		t.Fatal("stats")
	}
	if st.Change1D == nil || math.Abs(*st.Change1D+10) > 0.01 {
		t.Fatalf("1d %v", st.Change1D)
	}
	if st.Change1W == nil || st.Change1Y == nil {
		t.Fatal("windows missing")
	}
	if st.MaxDrawdown > -9.9 || st.MaxDrawdown < -10.1 {
		t.Fatalf("mdd %v", st.MaxDrawdown)
	}
	if st.FromHigh > -10.8 || st.FromHigh < -11 {
		t.Fatalf("fromHigh %v", st.FromHigh)
	}
	// 300 days from 2023-01-01 ends 2023-10-27: YTD base is nil (no previous-year bar).
	if st.ChangeYTD != nil {
		t.Fatalf("ytd should be nil, got %v", *st.ChangeYTD)
	}
	if st.VolAnnual == nil || st.ATR14Pct == nil {
		t.Fatal("vol/atr")
	}
	short, _ := ComputeStats(series(0, []float64{1, 2, 3}))
	if short.Change1W != nil || short.Change1M != nil || short.VolAnnual != nil {
		t.Fatal("short history must yield nil")
	}
	if _, ok := ComputeStats(nil); ok {
		t.Fatal("empty must be !ok")
	}
}

func TestYTD(t *testing.T) {
	// 2023-12-29 close 100, 2024-01-02 close 110 -> YTD +10
	c := []domain.Candle{
		{Timestamp: 1703808000, Close: 100, High: 100, Low: 100}, // 2023-12-29
		{Timestamp: 1704153600, Close: 110, High: 110, Low: 110}, // 2024-01-02
	}
	st, _ := ComputeStats(c)
	if st.ChangeYTD == nil || *st.ChangeYTD != 10 {
		t.Fatalf("ytd %v", st.ChangeYTD)
	}
}

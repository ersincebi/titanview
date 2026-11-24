package provider

import (
	"context"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

// rangeUpstream her istenen aralık için kesintisiz 1m mum döndürür (Binance 7/24 gibi). Test-only.
type rangeUpstream struct{ calls atomic.Int32 }

func (m *rangeUpstream) FetchHistory(ctx context.Context, symbol, timeframe string, fromSec, toSec int64) ([]domain.Candle, error) {
	m.calls.Add(1)
	step := domain.TimeframeSeconds(domain.NormalizeTimeframe(timeframe))
	var out []domain.Candle
	for ts := (fromSec / step) * step; ts <= toSec; ts += step {
		out = append(out, domain.Candle{Symbol: symbol, Timeframe: domain.NormalizeTimeframe(timeframe), Timestamp: ts, Open: 1, High: 2, Low: 0.5, Close: 1.5, Volume: 1})
	}
	return out, nil
}

// Faz 30: [min, max] içindeki boşluk (yarıda kalmış eski çekim) yeniden çekilmeli; boş pencere "son 400 mum"a düşmemeli.
func TestInteriorHoleIsRefetchedForContinuousMarkets(t *testing.T) {
	ctx := context.Background()
	store, err := storage.NewSQLiteStore(filepath.Join(t.TempDir(), "hole.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const step = 60
	base := int64(1_789_000_020)
	var seed []domain.Candle
	add := func(from, n int64) {
		for i := int64(0); i < n; i++ {
			seed = append(seed, domain.Candle{Symbol: "BTCUSDT", Timeframe: "1m", Timestamp: base + (from+i)*step, Open: 1, High: 2, Low: 0.5, Close: 1.5, Volume: 1})
		}
	}
	add(0, 500)    // eski blok
	add(9000, 500) // yeni blok; aradaki 8500 dakika boş
	if err := store.BatchUpsertCandles(ctx, seed); err != nil {
		t.Fatal(err)
	}
	_ = store.RecordFetchedRangeHistoric(ctx, "BTCUSDT", "1m", base, base+9500*step)

	up := &rangeUpstream{}
	coord := NewCacheCoordinator(store, up, nil)
	// pencere tamamen geçmişte (toSec << maxTs): eski kod effectiveTo'yu maxTs'ye uzatıp boşluğu kaçırıyordu
	from := base + 3000*step
	to := from + 999*step
	res, err := coord.GetHistory(ctx, "BTCUSDT", "1m", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if up.calls.Load() == 0 {
		t.Fatal("iç boşluk upstream'den çekilmeliydi")
	}
	if len(res.Candles) < 990 || res.Candles[0].Timestamp < from || res.Candles[len(res.Candles)-1].Timestamp > to {
		t.Fatalf("pencere doldurulmadı: %d mum", len(res.Candles))
	}
	// Doldu: ikinci istek önbellekten gelir
	before := up.calls.Load()
	if _, err := coord.GetHistory(ctx, "BTCUSDT", "1m", from, to); err != nil {
		t.Fatal(err)
	}
	if up.calls.Load() != before {
		t.Fatal("dolu pencere yeniden çekilmemeli")
	}
}

package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
	"github.com/ersincebi/titanview/backend/internal/hub"
	"github.com/ersincebi/titanview/backend/internal/provider"
	"github.com/ersincebi/titanview/backend/internal/storage"
)

// Faz 30 denetimi: "ETH" sorgusu "Tether US" adı yüzünden BTCUSDT'yi başa koyuyordu.
func TestSymbolsSearchRanksSymbolPrefixFirst(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	coord := provider.NewCacheCoordinator(store, nil, nil)
	h := NewServer(coord, hub.NewLiveHub(coord, 10*time.Second), "").Routes()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/symbols?market=CRYPTO&q=eth", nil))
	var resp struct {
		Symbols []SymbolQuoteSummary `json:"symbols"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if len(resp.Symbols) < 2 || resp.Symbols[0].Symbol != "ETHUSDT" {
		t.Fatalf("ETHUSDT ilk olmalı, gelen %+v", resp.Symbols)
	}
}

// Yalnız 1d mum varken değişim önceki günün kapanışına göre olmalı; 32 günlük değil.
func TestQuoteSummaryDailyFallbackUsesPreviousClose(t *testing.T) {
	store, err := storage.NewSQLiteStore(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	day := int64(86400)
	end := time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC).Unix()
	var cs []domain.Candle
	for i := 0; i < 40; i++ {
		px := 2500.0 - float64(i)*20 // 40 günde 2500 → 1720
		cs = append(cs, domain.Candle{Symbol: "ETHUSDT", Timeframe: "1d", Timestamp: end - int64(39-i)*day, Open: px + 5, High: px + 10, Low: px - 10, Close: px, Volume: 1})
	}
	if err := store.BatchUpsertCandles(context.Background(), cs); err != nil {
		t.Fatal(err)
	}
	coord := provider.NewCacheCoordinator(store, nil, nil)
	srv := NewServer(coord, hub.NewLiveHub(coord, 10*time.Second), "")
	sum := srv.quoteSummary(context.Background(), domain.SymbolInfo{Symbol: "ETHUSDT", Market: domain.MarketCrypto})
	if sum.ChangePercent == nil || *sum.ChangePercent < -1.5 || *sum.ChangePercent > 0 {
		t.Fatalf("günlük değişim ~-%%1.1 olmalı, gelen %v", sum.ChangePercent)
	}
	if sum.High24h == nil || *sum.High24h != 1730 {
		t.Fatalf("24s yüksek son günün yükseği olmalı (1730), gelen %v", sum.High24h)
	}
}

package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

const tape = `[
{"a":1,"p":"100.0","q":"2.0","T":1700000001000,"m":false},
{"a":2,"p":"100.0","q":"50","T":1700000002000,"m":true},
{"a":3,"p":"101.0","q":"10","T":1700000003000,"m":false},
{"a":4,"p":"bad","q":"1","T":1700000004000,"m":false},
{"a":5,"p":"100","q":"0","T":1700000005000,"m":false}
]`

func TestBuildWhaleReport(t *testing.T) {
	rep, err := buildWhaleReport("BTCUSDT", []byte(tape), 2)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Sampled != 3 {
		t.Fatalf("invalid rows must be dropped: sampled=%d", rep.Sampled)
	}
	if len(rep.Trades) != 2 || rep.Trades[0].Notional != 5000 || rep.Trades[0].Side != "SELL" || rep.Trades[1].Notional != 1010 {
		t.Fatalf("largest-first with taker side (m=true => SELL): %+v", rep.Trades)
	}
	if rep.BuyVolume != 200+1010 || rep.SellVolume != 5000 {
		t.Errorf("pressure: buy=%v sell=%v", rep.BuyVolume, rep.SellVolume)
	}
	if rep.FromTime != 1700000001 || rep.ToTime != 1700000003 {
		t.Errorf("window: %d..%d", rep.FromTime, rep.ToTime)
	}
	if _, err := buildWhaleReport("X", []byte("{nope"), 5); err == nil {
		t.Error("bad json must error")
	}
}

func TestFetchWhalesFallsBackAcrossMirrors(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(451) }))
	defer bad.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("symbol") != "ETHUSDT" {
			t.Errorf("symbol not upper-cased: %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(tape))
	}))
	defer good.Close()
	b := NewBinanceProvider(nil)
	b.BaseURLs = []string{bad.URL, good.URL}
	rep, err := b.FetchWhales(context.Background(), " ethusdt ", 0)
	if err != nil || rep.Sampled != 3 {
		t.Fatalf("rep=%+v err=%v", rep, err)
	}
	b.BaseURLs = []string{bad.URL}
	if _, err := b.FetchWhales(context.Background(), "ETHUSDT", 5); err == nil {
		t.Error("all mirrors failing must error")
	}
	if _, err := b.FetchWhales(context.Background(), " ", 5); err == nil {
		t.Error("blank symbol must error")
	}
}

// Binance sends both "m" (buyer is maker) and "M" (best match). The side must come from "m" only.
func TestAggTradeSideIgnoresBestMatchField(t *testing.T) {
	body := []byte(`[{"a":1,"p":"100","q":"1","T":1000,"m":false,"M":true},{"a":2,"p":"100","q":"2","T":1001,"m":true,"M":true}]`)
	list, err := ParseAggTrades(body)
	if err != nil || len(list) != 2 {
		t.Fatalf("parse: %v %d", err, len(list))
	}
	if list[0].Sell || !list[1].Sell {
		t.Fatalf("side from m: got %v %v", list[0].Sell, list[1].Sell)
	}
	rep, err := buildWhaleReport("BTCUSDT", body, 5)
	if err != nil {
		t.Fatal(err)
	}
	if rep.BuyVolume != 100 || rep.SellVolume != 200 {
		t.Fatalf("whale buy/sell %v/%v", rep.BuyVolume, rep.SellVolume)
	}
}

package provider

import "testing"

func TestParseYahooQuote(t *testing.T) {
	body := []byte(`{"chart":{"result":[{"meta":{"regularMarketPrice":110,"chartPreviousClose":100}}]}}`)
	q, err := parseYahooQuote("AAPL", body)
	if err != nil || q.Last != 110 || q.ChangePct < 9.99 || q.ChangePct > 10.01 {
		t.Fatalf("got %+v err %v", q, err)
	}
	if _, err := parseYahooQuote("X", []byte(`{"chart":{"result":[]}}`)); err == nil {
		t.Fatal("empty result must error")
	}
	if _, err := parseYahooQuote("X", []byte(`{"chart":{"result":[{"meta":{}}]}}`)); err == nil {
		t.Fatal("zero price must error")
	}
	// 5d range response: chartPreviousClose is 5 trading days ago, true previous session close is closes[n-2]
	body5d := []byte(`{"chart":{"result":[{"meta":{"regularMarketPrice":342.56,"chartPreviousClose":356.27,"regularMarketVolume":80460000,"postMarketPrice":343.10,"postMarketChangePercent":0.16},"indicators":{"quote":[{"close":[355.0,353.0,350.5,349.21,342.56]}]}}]}}`)
	q5, err := parseYahooQuote("AAPL", body5d)
	if err != nil {
		t.Fatalf("5d parse err: %v", err)
	}
	if q5.PrevClose != 349.21 || q5.ChangePct > -1.89 || q5.ChangePct < -1.92 {
		t.Fatalf("expected 1d change vs 349.21 (-1.90%%), got prev=%.2f pct=%.2f", q5.PrevClose, q5.ChangePct)
	}
	if q5.Volume == nil || *q5.Volume != 80460000 || q5.ExtPrice == nil || *q5.ExtPrice != 343.10 || q5.ExtSession != "post" {
		t.Fatalf("expected volume and post-market ext quote, got %+v", q5)
	}
}

func TestParseBinanceTicker(t *testing.T) {
	q, err := parseBinanceTicker("BTCUSDT", []byte(`{"lastPrice":"50500.0","openPrice":"50000.0"}`))
	if err != nil || q.Last != 50500 || q.ChangePct < 0.99 || q.ChangePct > 1.01 {
		t.Fatalf("got %+v err %v", q, err)
	}
}

func TestBuildDepthReport(t *testing.T) {
	body := []byte(`{"bids":[["100","10"],["99.5","5"],["90","100"]],"asks":[["100.2","2"],["100.8","3"],["110","50"]]}`)
	r, err := buildDepthReport("X", body)
	if err != nil {
		t.Fatal(err)
	}
	// mid 100.1: 1% band = [99.099,101.101] -> bids 1000+497.5, asks 200.4+302.4
	if r.Bid1Pct < 1497 || r.Bid1Pct > 1498 || r.Imbalance1 <= 0 || r.Bid5Pct <= r.Bid1Pct-1 {
		t.Fatalf("%+v", r)
	}
	if r.LargestBid != 90 || r.LargestAsk != 110 {
		t.Fatalf("walls %+v", r)
	}
	if _, err := buildDepthReport("X", []byte(`{"bids":[],"asks":[]}`)); err == nil {
		t.Fatal("empty book must error")
	}
}

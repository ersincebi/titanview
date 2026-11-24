package domain

import "testing"

func TestResolveSymbolInfo(t *testing.T) {
	bist := ResolveSymbolInfo("thyao.is")
	if bist.Provider != ProviderYahoo || bist.Market != MarketBIST || bist.DelayMinutes != 15 {
		t.Fatalf("expected BIST Yahoo with 15m delay, got %+v", bist)
	}

	customBist := ResolveSymbolInfo("ASTOR.IS")
	if customBist.Provider != ProviderYahoo || customBist.Market != MarketBIST || customBist.Currency != "TRY" {
		t.Fatalf("expected custom BIST symbol to route to Yahoo/TRY, got %+v", customBist)
	}

	crypto := ResolveSymbolInfo("btcusdt")
	if crypto.Provider != ProviderBinance || crypto.Market != MarketCrypto || crypto.DelayMinutes != 0 {
		t.Fatalf("expected Crypto Binance with 0m delay, got %+v", crypto)
	}

	customCrypto := ResolveSymbolInfo("PEPEUSDT")
	if customCrypto.Provider != ProviderBinance || customCrypto.Market != MarketCrypto {
		t.Fatalf("expected custom USDT pair to route to Binance, got %+v", customCrypto)
	}

	us := ResolveSymbolInfo("AAPL")
	if us.Provider != ProviderYahoo || us.Market != MarketUS || us.Currency != "USD" {
		t.Fatalf("expected US stock to route to Yahoo/USD, got %+v", us)
	}

	dxy := ResolveSymbolInfo("DX-Y.NYB")
	if dxy.Provider != ProviderYahoo || dxy.Market != MarketForex {
		t.Fatalf("expected DX-Y.NYB to route to Yahoo/Forex, got %+v", dxy)
	}

	vakbn := ResolveSymbolInfo("VAKBN.IS")
	if vakbn.Provider != ProviderYahoo || vakbn.Market != MarketBIST {
		t.Fatalf("expected VAKBN.IS to route to Yahoo/BIST, got %+v", vakbn)
	}
}

func TestDetectProvider(t *testing.T) {
	if got := DetectProvider("THYAO.IS"); got != ProviderYahoo {
		t.Fatalf("DetectProvider(THYAO.IS) = %v, want %v", got, ProviderYahoo)
	}
	if got := DetectProvider("BTCUSDT"); got != ProviderBinance {
		t.Fatalf("DetectProvider(BTCUSDT) = %v, want %v", got, ProviderBinance)
	}
	if got := DetectProvider("AAPL"); got != ProviderYahoo {
		t.Fatalf("DetectProvider(AAPL) = %v, want %v", got, ProviderYahoo)
	}
}

func TestValidateAndRepairCandle(t *testing.T) {
	c := &Candle{
		Symbol:    "BTCUSDT",
		Timeframe: "15m",
		Timestamp: 1731283200,
		Open:      100,
		High:      95,  // broken high < open
		Low:       105, // broken low > close
		Close:     102,
		Volume:    500,
	}
	if err := ValidateAndRepairCandle(c); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.High != 102 || c.Low != 100 {
		t.Fatalf("expected repaired High=102 Low=100, got High=%v Low=%v", c.High, c.Low)
	}

	invalid := &Candle{Timestamp: 1731283200, Open: 0, High: 10, Low: 5, Close: 8}
	if err := ValidateAndRepairCandle(invalid); err == nil {
		t.Fatalf("expected error for non-positive Open price")
	}
}

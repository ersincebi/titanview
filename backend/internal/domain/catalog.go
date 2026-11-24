package domain

import "strings"

// DefaultSymbolCatalog contains the built-in Crypto (Binance), BIST (.IS Yahoo), US (Yahoo) and Forex/Commodities instruments.
var DefaultSymbolCatalog = []SymbolInfo{
	// CRYPTO (Binance Public API - 0m delay, real-time WS)
	{Symbol: "BTCUSDT", DisplayName: "Bitcoin / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "ETHUSDT", DisplayName: "Ethereum / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "SOLUSDT", DisplayName: "Solana / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "BNBUSDT", DisplayName: "BNB / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "XRPUSDT", DisplayName: "XRP / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "AVAXUSDT", DisplayName: "Avalanche / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "DOGEUSDT", DisplayName: "Dogecoin / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "LINKUSDT", DisplayName: "Chainlink / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "SUIUSDT", DisplayName: "Sui / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "ADAUSDT", DisplayName: "Cardano / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "RENDERUSDT", DisplayName: "Render / Tether US", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},
	{Symbol: "FETUSDT", DisplayName: "Artificial Superintelligence / USDT", Market: MarketCrypto, Exchange: "BINANCE", Currency: "USDT", Provider: ProviderBinance, DelayMinutes: 0},

	// BIST - Borsa İstanbul (Yahoo Finance .IS - 15m delayed & free)
	{Symbol: "XU100.IS", DisplayName: "BIST 100 Endeksi", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "THYAO.IS", DisplayName: "Türk Hava Yolları A.O.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "ASELS.IS", DisplayName: "Aselsan Elektronik Sanayi", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "GARAN.IS", DisplayName: "Garanti BBVA", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "EREGL.IS", DisplayName: "Ereğli Demir ve Çelik", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "KCHOL.IS", DisplayName: "Koç Holding A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "TUPRS.IS", DisplayName: "Tüpraş Türkiye Petrol Rafinerileri", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "AKBNK.IS", DisplayName: "Akbank T.A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "ISCTR.IS", DisplayName: "Türkiye İş Bankası (C)", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "SISE.IS", DisplayName: "Türkiye Şişe ve Cam Fabrikaları", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "BIMAS.IS", DisplayName: "BİM Birleşik Mağazalar A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "FROTO.IS", DisplayName: "Ford Otomotiv Sanayi A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "SAHOL.IS", DisplayName: "Hacı Ömer Sabancı Holding", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "PGSUS.IS", DisplayName: "Pegasus Hava Taşımacılığı", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "TCELL.IS", DisplayName: "Turkcell İletişim Hizmetleri", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "YKBNK.IS", DisplayName: "Yapı ve Kredi Bankası A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "SASA.IS", DisplayName: "SASA Polyester Sanayi A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "ASTOR.IS", DisplayName: "Astor Enerji A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "KONTR.IS", DisplayName: "Kontrolmatik Teknoloji Enerji", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "KOZAL.IS", DisplayName: "Koza Altın İşletmeleri A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "PETKM.IS", DisplayName: "Petkim Petrokimya Holding", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "TOASO.IS", DisplayName: "Tofaş Türk Otomobil Fabrikası", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "ARCLK.IS", DisplayName: "Arçelik A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "EKGYO.IS", DisplayName: "Emlak Konut GYO A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "ENKAI.IS", DisplayName: "Enka İnşaat ve Sanayi A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "MGROS.IS", DisplayName: "Migros Ticaret A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "DOAS.IS", DisplayName: "Doğuş Otomotiv Servis ve Ticaret", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "GUBRF.IS", DisplayName: "Gübre Fabrikaları T.A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "HEKTS.IS", DisplayName: "Hektaş Ticaret T.A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "VAKBN.IS", DisplayName: "Türkiye Vakıflar Bankası T.A.O.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "HALKB.IS", DisplayName: "Türkiye Halk Bankası A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "TTKOM.IS", DisplayName: "Türk Telekomünikasyon A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "OYAKC.IS", DisplayName: "OYAK Çimento Fabrikaları A.Ş.", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "CIMSA.IS", DisplayName: "Çimsa Çimento Sanayi ve Ticaret", Market: MarketBIST, Exchange: "BIST", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 15},

	// US Stocks & ETFs (Yahoo Finance - NASDAQ / NYSE)
	{Symbol: "NVDA", DisplayName: "NVIDIA Corporation", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "AAPL", DisplayName: "Apple Inc.", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "TSLA", DisplayName: "Tesla, Inc.", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "MSFT", DisplayName: "Microsoft Corporation", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "AMZN", DisplayName: "Amazon.com, Inc.", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "META", DisplayName: "Meta Platforms, Inc.", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "GOOGL", DisplayName: "Alphabet Inc.", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "AMD", DisplayName: "Advanced Micro Devices, Inc.", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "PLTR", DisplayName: "Palantir Technologies Inc.", Market: MarketUS, Exchange: "NYSE", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "NFLX", DisplayName: "Netflix, Inc.", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "SPY", DisplayName: "SPDR S&P 500 ETF Trust", Market: MarketUS, Exchange: "NYSE", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},
	{Symbol: "QQQ", DisplayName: "Invesco QQQ Trust (Nasdaq 100)", Market: MarketUS, Exchange: "NASDAQ", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 15},

	// FOREX & COMMODITIES (Döviz, Altın, Gümüş, Petrol, DXY - Yahoo Finance)
	{Symbol: "USDTRY=X", DisplayName: "ABD Doları / Türk Lirası", Market: MarketForex, Exchange: "FX", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 0},
	{Symbol: "EURTRY=X", DisplayName: "Euro / Türk Lirası", Market: MarketForex, Exchange: "FX", Currency: "TRY", Provider: ProviderYahoo, DelayMinutes: 0},
	{Symbol: "GC=F", DisplayName: "Ons Altın (Gold Futures XAU/USD)", Market: MarketForex, Exchange: "COMEX", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 10},
	{Symbol: "SI=F", DisplayName: "Ons Gümüş (Silver Futures XAG/USD)", Market: MarketForex, Exchange: "COMEX", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 10},
	{Symbol: "BZ=F", DisplayName: "Brent Ham Petrol (Brent Crude)", Market: MarketForex, Exchange: "ICE", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 10},
	{Symbol: "DX-Y.NYB", DisplayName: "DXY Dolar Endeksi (US Dollar Index)", Market: MarketForex, Exchange: "NYBOT", Currency: "USD", Provider: ProviderYahoo, DelayMinutes: 10},
}

// ResolveSymbolInfo finds a symbol in the catalog or dynamically classifies custom symbols
// (e.g., any *.IS -> BIST/Yahoo, *USDT/*USDC/*BUSD -> Crypto/Binance, *=X/*=F -> Forex/Yahoo, otherwise US/Yahoo).
func ResolveSymbolInfo(rawSymbol string) SymbolInfo {
	sym := NormalizeAliasSymbol(rawSymbol)
	if expr, err := ParseSymbolExpr(sym); err == nil && expr != nil && expr.IsComplex && len(expr.legs) > 0 {
		primary := ResolveSymbolInfo(expr.legs[0])
		rawUp := strings.ToUpper(strings.TrimSpace(rawSymbol))
		return SymbolInfo{
			Symbol:       rawUp,
			DisplayName:  rawUp + " (Sentetik İfade)",
			Market:       primary.Market,
			Exchange:     "EXPR",
			Currency:     primary.Currency,
			Provider:     primary.Provider,
			DelayMinutes: primary.DelayMinutes,
		}
	}
	for _, item := range DefaultSymbolCatalog {
		if item.Symbol == sym {
			return item
		}
	}

	if strings.HasSuffix(sym, ".IS") {
		return SymbolInfo{
			Symbol:       sym,
			DisplayName:  strings.TrimSuffix(sym, ".IS") + " (BIST)",
			Market:       MarketBIST,
			Exchange:     "BIST",
			Currency:     "TRY",
			Provider:     ProviderYahoo,
			DelayMinutes: 15,
		}
	}

	if strings.HasSuffix(sym, "USDT") || strings.HasSuffix(sym, "FDUSD") || strings.HasSuffix(sym, "USDC") || strings.HasSuffix(sym, "BTC") {
		return SymbolInfo{
			Symbol:       sym,
			DisplayName:  sym + " Spot",
			Market:       MarketCrypto,
			Exchange:     "BINANCE",
			Currency:     "USDT",
			Provider:     ProviderBinance,
			DelayMinutes: 0,
		}
	}

	if strings.HasSuffix(sym, "=X") || strings.HasSuffix(sym, "=F") || strings.HasSuffix(sym, ".NYB") || sym == "DXY" {
		cur := "USD"
		if strings.HasSuffix(sym, "TRY=X") {
			cur = "TRY"
		} else if strings.HasSuffix(sym, "EUR=X") {
			cur = "EUR"
		}
		return SymbolInfo{
			Symbol:       sym,
			DisplayName:  sym + " (FX/Emtia)",
			Market:       MarketForex,
			Exchange:     "FX",
			Currency:     cur,
			Provider:     ProviderYahoo,
			DelayMinutes: 10,
		}
	}

	return SymbolInfo{
		Symbol:       sym,
		DisplayName:  sym + " (US Equity)",
		Market:       MarketUS,
		Exchange:     "NASDAQ/NYSE",
		Currency:     "USD",
		Provider:     ProviderYahoo,
		DelayMinutes: 15,
	}
}

// DetectProvider returns the upstream ProviderType (BINANCE or YAHOO) for any given symbol.
func DetectProvider(rawSymbol string) ProviderType {
	return ResolveSymbolInfo(rawSymbol).Provider
}

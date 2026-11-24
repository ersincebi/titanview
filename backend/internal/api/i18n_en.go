package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

// Faz 30 — analiz uçlarının (insights/analysis/related/flow) ürettiği Türkçe metinler için
// `?lang=en` çeviri katmanı. Hesap kodu dokunulmadan, yanıt JSON'undaki dizgi değerleri çevrilir.
// Haber başlıkları, sembol/ad, kaynak ve bağlantı alanları çevrilmez.

var enExact = map[string]string{
	"Nötr": "Neutral", "boğa": "bull", "ayı": "bear", "karışık": "mixed", "geniş": "wide", "sıkışma": "squeeze",
	"Hacim": "Volume", "Trend": "Trend", "Momentum": "Momentum", "Oynaklık": "Volatility", "normal": "normal",
	"Yeterli veri yok": "Not enough data", "MA dizilimi": "MA alignment", "yukarı uyumlu": "aligned up",
	"aşağı uyumlu": "aligned down", "Olumlu ağırlıklı": "Mostly positive", "Olumsuz ağırlıklı": "Mostly negative",
	"Karışık / nötr": "Mixed / neutral", "Düşen trend": "Downtrend", "Yükselen trend": "Uptrend", "Yatay": "Range",
	"Destek": "Support", "Direnç": "Resistance",
}

// Uzun ifadeler önce uygulanır (alt dizgi değişimi). Sayılar fmt ile araya girdiği için kalıplar ayrı.
var enPhrases = map[string]string{
	"Güçlü yükseliş eğilimi": "Strong uptrend bias", "Güçlü düşüş eğilimi": "Strong downtrend bias",
	"Yükseliş eğilimi": "Uptrend bias", "Düşüş eğilimi": "Downtrend bias", "Yatay / kararsız": "Sideways / undecided",
	"Güçlü yükseliş trendi": "Strong uptrend", "Güçlü düşüş trendi": "Strong downtrend",
	"Uzun vadeli trend yukarı": "Long-term trend up", "Uzun vadeli trend aşağı": "Long-term trend down",
	"Kısa vadeli trend yukarı": "Short-term trend up", "Kısa vadeli trend aşağı": "Short-term trend down",
	"ama kısa vade karışık": "but short term mixed", "(SMA200 için yeterli veri yok)": "(not enough data for SMA200)",
	"Altın kesişim (yakın)": "Golden cross (recent)", "Ölüm kesişimi (yakın)": "Death cross (recent)",
	"bar önce yukarı kesti": "bars ago crossed above", "bar önce aşağı kesti": "bars ago crossed below",
	"Güçlü 12-1 ay momentumu": "Strong 12-1 month momentum", "Zayıf 12-1 ay momentumu": "Weak 12-1 month momentum",
	"Güçlü 3 aylık momentum": "Strong 3-month momentum", "Zayıf 3 aylık momentum": "Weak 3-month momentum",
	"Son 21 gün hariç 1 yıllık getiri": "1-year return excluding the last 21 days", "3 aylık getiri": "3-month return",
	"Endeksten güçlü": "Stronger than index", "Endeksten zayıf": "Weaker than index",
	"puan fazla getiri": "pts excess return", "puan düşük getiri": "pts lower return", "3 ayda benchmark'a göre": "Over 3 months vs benchmark",
	"önceki 20 kapanışın tepesi": "previous 20-close high", "önceki 20 kapanışın dibi": "previous 20-close low",
	"20 günlük tepe kırılımı": "20-day high breakout", "20 günlük dip kırılımı": "20-day low breakdown",
	"RSI aşırı alım": "RSI overbought", "RSI aşırı satım": "RSI oversold",
	"güçlü trendde uzayabilir, kâr alma riski artar": "can extend in a strong trend, profit-taking risk rises",
	"tepki yükselişi ihtimali":                       "chance of a relief bounce", "düşüş trendinde aşırı satım uzayabilir": "oversold can persist in a downtrend",
	"Yükseliş trendinde geri çekilme":                             "Pullback in uptrend",
	"trend yukarıyken zayıflamış fiyat (geri çekilme alım adayı)": "weakened price while trend is up (pullback buy candidate)",
	"Bollinger sıkışması":                                         "Bollinger squeeze", "Band genişliği son 120 barın en düşük": "Band width in the lowest",
	"diliminde — oynaklık patlaması yaklaşıyor olabilir, yön belirsiz": "percentile of the last 120 bars — a volatility expansion may be near, direction unclear",
	"Yüksek oynaklık rejimi": "High volatility regime", "Düşük oynaklık rejimi": "Low volatility regime",
	"kendi 1 yıllık dağılımının":                   "in its own 1-year distribution at the",
	"diliminde — pozisyonu küçült, stopu genişlet": "percentile — size down, widen stops",
	"diliminde — sakin dönem, genişleme riski":     "percentile — calm period, expansion risk",
	"Ortalamadan aşırı uzak (üst)":                 "Far above the mean", "Ortalamadan aşırı uzak (alt)": "Far below the mean",
	"standart sapma üstünde": "std. dev. above", "standart sapma altında": "std. dev. below", "20g ortalamanın": "20d mean by",
	"Hacim patlaması": "Volume spike", "Son bar hacmi 20g ortalamanın": "Last bar volume is", "katı": "× the 20d average",
	"Negatif ıraksama (OBV)": "Negative divergence (OBV)", "Pozitif ıraksama (OBV)": "Positive divergence (OBV)",
	"yükseldi ama hacim akışı (OBV) düştü — yükseliş zayıf":                  "rose but volume flow (OBV) fell — rally is weak",
	"düştü ama hacim akışı (OBV) yükseldi — satış baskısı azalıyor olabilir": "fell but volume flow (OBV) rose — selling pressure may be easing",
	"Fiyat 20 günde":     "Price over 20 days",
	"Derin düşüş içinde": "In a deep drawdown", "bar önce": "bars ago",
	"Üst üste yükselen kapanışlar": "Consecutive higher closes", "Üst üste düşen kapanışlar": "Consecutive lower closes",
	"gün aynı yönde kapanış":                     "days closing in the same direction",
	"20 > 50 > 100 > 200: tam yükseliş dizilimi": "20 > 50 > 100 > 200: full bullish alignment",
	"20 < 50 < 100 < 200: tam düşüş dizilimi":    "20 < 50 < 100 < 200: full bearish alignment",
	"Dizilim karışık":                            "Alignment mixed", "zayıf trend": "weak trend", "güçlü trend": "strong trend",
	"Yükseliş: fiyat destek çizgisinin üstünde": "Bullish: price above the support line",
	"Düşüş: fiyat direnç çizgisinin altında":    "Bearish: price below the resistance line",
	"Fiyat bulutun içinde":                      "Price inside the cloud", "Fiyat bulutun üstünde": "Price above the cloud", "Fiyat bulutun altında": "Price below the cloud",
	"Nötr bölge (30–70)": "Neutral zone (30–70)", "Aşırı alım (≥70): düzeltme riski": "Overbought (≥70): correction risk",
	"Aşırı satım (≤30): tepki ihtimali": "Oversold (≤30): bounce likely",
	"Dipte, %K %D'yi yukarı kesiyor":    "At the low, %K crossing above %D", "Tepede, %K %D'yi aşağı kesiyor": "At the high, %K crossing below %D",
	"10 bar fiyat değişimi": "10-bar price change",
	"Hacim akışının 20 barlık eğimi (ort. günlük hacme göre)":                                                                "20-bar slope of volume flow (vs. avg. daily volume)",
	"Chaikin para akışı: >+0.10 alım, <−0.10 satım baskısı":                                                                  "Chaikin money flow: >+0.10 buying, <−0.10 selling pressure",
	"Sürüklenmesiz (drift=0) log-normal koni; son 60 günlük gerçekleşen oynaklık. Yön tahmini değil, olasılıksal aralıktır.": "Driftless (drift=0) log-normal cone; last 60 days of realized volatility. Not a directional forecast, a probabilistic range.",
	"Fib 1.272 uzantı": "Fib 1.272 extension", "Fib 1.618 uzantı": "Fib 1.618 extension", "geri çekilme": "retracement",
	"Geçmişte benzer durumlarda sonraki getiri dağılımı. Örnekler ardışık barlar olduğundan birbirine bağımlıdır; olasılık değil bağlamdır.":      "Distribution of subsequent returns in similar past setups. Samples are consecutive bars and therefore dependent; context, not probability.",
	"Günlük log getiri, ortak işlem günlerinde Pearson (son 90 / 30 gün). Farklı piyasaların takvimi farklıdır; korelasyon nedensellik değildir.": "Daily log returns, Pearson on common trading days (last 90 / 30 days). Markets have different calendars; correlation is not causation.",
	"Başlıklardaki anahtar kelime sayımı (TR/EN). Duygu analizi değil; hangi kelimenin tetiklediği görünür.":                                      "Keyword count in headlines (TR/EN). Not sentiment analysis; you can see which word triggered.",
	"Bu piyasa için ücretsiz işlem akışı (tape) yok; yalnız kripto.":                                                                              "No free trade tape for this market; crypto only.",
	"Fiyat EMA20": "Price vs EMA20", "Fiyat SMA50": "Price vs SMA50", "Fiyat SMA100": "Price vs SMA100", "Fiyat SMA200": "Price vs SMA200",
	"fiyat SMA50": "price vs SMA50", "Kapanış": "Close", "üzerinde": "above", "üstünde": "above", "altında": "below",
}

// Sayı içeren kalıplar ifade değişiminden önce uygulanır.
var enRegex = []struct {
	re   *regexp.Regexp
	repl string
}{
	{regexp.MustCompile(`Zirveden (-?[\d.]+)% aşağıda, zirve (\d+) bar önce`), "${1}% below peak, peak ${2} bars ago"},
	{regexp.MustCompile(`Fiyat (SMA\d+|EMA\d+) \(([-\d.e+]+)\) (üzerinde|altında) ama kısa vade karışık`), "Price ${3} ${1} (${2}) but short term mixed"},
	{regexp.MustCompile(`Fiyat (SMA\d+|EMA\d+) \(([-\d.e+]+)\) (üzerinde|altında) \(SMA200 için yeterli veri yok\)`), "Price ${3} ${1} (${2}) (not enough data for SMA200)"},
	{regexp.MustCompile(`Fiyat (SMA\d+|EMA\d+) (üstünde|altında) \(([-+\d.]+%)\)`), "Price ${2} ${1} (${3})"},
}

var enPhraseKeys = func() []string {
	ks := make([]string, 0, len(enPhrases))
	for k := range enPhrases {
		ks = append(ks, k)
	}
	sort.Slice(ks, func(i, j int) bool { return len(ks[i]) > len(ks[j]) })
	return ks
}()

var trCharRe = regexp.MustCompile(`[çğıöşüÇĞİÖŞÜ]`)

// Çevrilmeyecek alanlar: haber/akış metinleri ve kimlikler.
var enSkipKeys = map[string]bool{
	"title": true, "headline": true, "source": true, "url": true, "link": true, "symbol": true,
	"displayName": true, "name": true, "publisher": true, "summary": true, "hits": true, "words": true, "id": true,
}

func translateEN(s string) string {
	if s == "" {
		return s
	}
	if v, ok := enExact[s]; ok {
		return v
	}
	if !trCharRe.MatchString(s) && !strings.Contains(s, "Fiyat") && !strings.Contains(s, "Kapanış") {
		return s
	}
	out := s
	for _, rr := range enRegex {
		out = rr.re.ReplaceAllString(out, rr.repl)
	}
	for _, k := range enPhraseKeys {
		if strings.Contains(out, k) {
			out = strings.ReplaceAll(out, k, enPhrases[k])
		}
	}
	return out
}

func localizeValue(v interface{}, key string) interface{} {
	switch t := v.(type) {
	case string:
		if enSkipKeys[key] {
			return t
		}
		return translateEN(t)
	case []interface{}:
		for i := range t {
			t[i] = localizeValue(t[i], key)
		}
		return t
	case map[string]interface{}:
		for k, x := range t {
			t[k] = localizeValue(x, k)
		}
		return t
	default:
		return v
	}
}

// writeJSONLang `?lang=en` ise yanıt metinlerini İngilizceye çevirip yazar; değilse writeJSON ile aynı.
func writeJSONLang(w http.ResponseWriter, r *http.Request, status int, payload interface{}) {
	if r.URL.Query().Get("lang") != "en" {
		writeJSON(w, status, payload)
		return
	}
	b, err := json.Marshal(payload)
	if err != nil {
		writeJSON(w, status, payload)
		return
	}
	var generic interface{}
	if err := json.Unmarshal(b, &generic); err != nil {
		writeJSON(w, status, payload)
		return
	}
	writeJSON(w, status, localizeValue(generic, ""))
}

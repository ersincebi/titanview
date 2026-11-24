package analytics

import (
	"math"
	"sort"
	"strings"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// CorrOver is the Pearson correlation of day-aligned log returns over the most recent lastN paired
// returns (lastN<=0 = all). ok=false below MinOverlap pairs or zero variance. n = pairs used.
func CorrOver(a, b []domain.Candle, lastN int) (r float64, n int, ok bool) {
	ra, rb := alignedReturns(a, b)
	if lastN > 0 && len(ra) > lastN {
		ra, rb = ra[len(ra)-lastN:], rb[len(rb)-lastN:]
	}
	if len(ra) < MinOverlap {
		return 0, len(ra), false
	}
	r, ok = Pearson(ra, rb)
	return math.Round(r*1000) / 1000, len(ra), ok
}

// RelatedItem is one instrument's correlation with the subject.
type RelatedItem struct {
	Symbol      string   `json:"symbol"`
	DisplayName string   `json:"displayName"`
	Market      string   `json:"market"`
	R90         float64  `json:"r90"`
	R30         *float64 `json:"r30,omitempty"`
	Delta       *float64 `json:"delta,omitempty"` // r30 - r90: is the link strengthening?
	N           int      `json:"n"`
}

// RankRelated sorts items by r90 and returns the strongest positive and negative k.
func RankRelated(items []RelatedItem, k int) (pos, neg []RelatedItem) {
	s := append([]RelatedItem(nil), items...)
	sort.SliceStable(s, func(i, j int) bool { return s[i].R90 > s[j].R90 })
	for _, it := range s {
		if it.R90 > 0 && len(pos) < k {
			pos = append(pos, it)
		}
	}
	for i := len(s) - 1; i >= 0; i-- {
		if s[i].R90 < 0 && len(neg) < k {
			neg = append(neg, s[i])
		}
	}
	return
}

// ---- news tone

var posWords = []string{
	"surge", "soar", "rally", "record high", "beat", "beats", "upgrade", "upgraded", "gain", "gains", "jump", "jumps", "rise", "rises", "bullish", "profit", "growth", "strong", "outperform", "buy rating", "approval", "approved", "breakout", "recover",
	"yükseldi", "yükseliş", "rekor", "artış", "arttı", "kâr", "kar artışı", "temettü", "güçlü", "olumlu", "alım", "hedef fiyat yükselt", "onay", "büyüme", "toparlan", "ralli", "zirve", "pozitif",
}
var negWords = []string{
	"plunge", "plunges", "crash", "slump", "fall", "falls", "drop", "drops", "downgrade", "downgraded", "miss", "misses", "loss", "losses", "bearish", "lawsuit", "probe", "investigation", "fraud", "recall", "cut", "cuts", "warning", "warns", "sell-off", "selloff", "hack", "bankrupt", "layoff",
	"düştü", "düşüş", "çöktü", "zarar", "dava", "soruşturma", "ceza", "uyarı", "satış baskısı", "negatif", "iflas", "geriledi", "kayıp", "değer kaybı", "olumsuz", "hack", "yaptırım",
}

// ItemTone is one headline's keyword tone: +1 / -1 / 0 with the matched words (so it is auditable).
type ItemTone struct {
	Title   string   `json:"title"`
	Tone    int      `json:"tone"`
	Matched []string `json:"matched,omitempty"`
}

type ToneSummary struct {
	Pos     int        `json:"pos"`
	Neg     int        `json:"neg"`
	Neutral int        `json:"neutral"`
	Score   int        `json:"score"` // -100..100
	Label   string     `json:"label"`
	Items   []ItemTone `json:"items"`
	Note    string     `json:"note"`
}

func trLower(s string) string {
	return strings.ToLower(strings.NewReplacer("İ", "i", "I", "ı").Replace(s))
}

// NewsTone counts positive/negative keywords per headline. Transparent and crude on purpose: it shows
// which words fired. Not sentiment AI.
func NewsTone(titles []string) ToneSummary {
	ts := ToneSummary{Note: "Başlıklardaki anahtar kelime sayımı (TR/EN). Duygu analizi değil; hangi kelimenin tetiklediği görünür."}
	for _, t := range titles {
		low := trLower(t)
		var m []string
		p, n := 0, 0
		for _, w := range posWords {
			if strings.Contains(low, w) {
				p++
				m = append(m, "+"+w)
			}
		}
		for _, w := range negWords {
			if strings.Contains(low, w) {
				n++
				m = append(m, "−"+w)
			}
		}
		it := ItemTone{Title: t, Matched: m}
		switch {
		case p > n:
			it.Tone = 1
			ts.Pos++
		case n > p:
			it.Tone = -1
			ts.Neg++
		default:
			ts.Neutral++
		}
		ts.Items = append(ts.Items, it)
	}
	if total := ts.Pos + ts.Neg + ts.Neutral; total > 0 {
		ts.Score = int(math.Round(float64(ts.Pos-ts.Neg) / float64(total) * 100))
	}
	switch {
	case len(titles) == 0:
		ts.Label = "Haber yok"
	case ts.Score >= 25:
		ts.Label = "Olumlu ağırlıklı"
	case ts.Score <= -25:
		ts.Label = "Olumsuz ağırlıklı"
	default:
		ts.Label = "Karışık / nötr"
	}
	return ts
}

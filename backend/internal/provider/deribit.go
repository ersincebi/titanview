package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// OptionContractQuote holds pricing, IV, volume, open interest, and Black-Scholes Greeks for one Call or Put.
type OptionContractQuote struct {
	Instrument   string  `json:"instrument"`
	Type         string  `json:"type"` // "C" | "P"
	Strike       float64 `json:"strike"`
	MarkCoin     float64 `json:"markCoin"`
	MarkUSD      float64 `json:"markUsd"`
	BidUSD       float64 `json:"bidUsd"`
	AskUSD       float64 `json:"askUsd"`
	LastUSD      float64 `json:"lastUsd"`
	MarkIV       float64 `json:"markIv"` // percentage, e.g. 54.2
	OpenInterest float64 `json:"openInterest"`
	Volume       float64 `json:"volume"`
	VolumeUSD    float64 `json:"volumeUsd"`
	Delta        float64 `json:"delta"`
	Gamma        float64 `json:"gamma"`
	Theta        float64 `json:"theta"` // USD per day
	Vega         float64 `json:"vega"`  // USD per 1% IV
	ITM          bool    `json:"itm"`
}

// OptionChainStrikeRow pairs the Call and Put at a single strike price for one expiration date.
type OptionChainStrikeRow struct {
	Strike      float64              `json:"strike"`
	DistancePct float64              `json:"distancePct"`
	Call        *OptionContractQuote `json:"call,omitempty"`
	Put         *OptionContractQuote `json:"put,omitempty"`
}

// OptionExpirySummary describes one available expiration date on Deribit.
type OptionExpirySummary struct {
	Code         string  `json:"code"`         // e.g. "29JAN27"
	Date         string  `json:"date"`         // e.g. "2027-01-29"
	ExpiryTime   int64   `json:"expiryTime"`   // unix seconds (08:00 UTC)
	DaysToExpiry float64 `json:"daysToExpiry"` // fractional days
	StrikeCount  int     `json:"strikeCount"`
	TotalOI      float64 `json:"totalOi"`
}

// OptionChainStats summarizes open interest, Put/Call ratio, ATM IV, and Max Pain strike for the selected expiry.
type OptionChainStats struct {
	TotalCallOI    float64 `json:"totalCallOi"`
	TotalPutOI     float64 `json:"totalPutOi"`
	PutCallOIRatio float64 `json:"putCallOiRatio"`
	TotalVolumeUSD float64 `json:"totalVolumeUsd"`
	AtmIV          float64 `json:"atmIv"`
	MaxPainStrike  float64 `json:"maxPainStrike"`
}

// OptionChainResponse is returned by GET /api/options.
type OptionChainResponse struct {
	Supported      bool                   `json:"supported"`
	Reason         string                 `json:"reason,omitempty"`
	Market         string                 `json:"market"`
	Symbol         string                 `json:"symbol"`
	Underlying     string                 `json:"underlying,omitempty"` // "BTC" | "ETH"
	Provider       string                 `json:"provider,omitempty"`   // "DERIBIT"
	SpotPrice      float64                `json:"spotPrice"`
	Expiries       []OptionExpirySummary  `json:"expiries"`
	SelectedExpiry string                 `json:"selectedExpiry"`
	DaysToExpiry   float64                `json:"daysToExpiry"`
	Summary        OptionChainStats       `json:"summary"`
	Rows           []OptionChainStrikeRow `json:"rows"`
}

// DeribitProvider queries Deribit Public API v2 for live BTC and ETH option chains.
type DeribitProvider struct {
	BaseURLs   []string
	HTTPClient *http.Client
}

// NewDeribitProvider creates a Deribit public option chain provider with automatic fallback across Deribit mirrors.
func NewDeribitProvider(client *http.Client) *DeribitProvider {
	if client == nil {
		client = &http.Client{Timeout: 6 * time.Second}
	}
	return &DeribitProvider{
		BaseURLs: []string{
			"https://test.deribit.com",
			"https://www.deribit.com",
		},
		HTTPClient: client,
	}
}

// ResolveDeribitUnderlying maps a symbol (e.g. "BTCUSDT", "BTC", "ETHUSDT", "ETH") to Deribit's currency code.
func ResolveDeribitUnderlying(rawSymbol string) (string, bool) {
	s := strings.ToUpper(strings.TrimSpace(rawSymbol))
	if idx := strings.IndexAny(s, "/*+-()"); idx > 0 {
		s = strings.TrimSpace(s[:idx])
	}
	switch {
	case s == "BTC" || strings.HasPrefix(s, "BTCUSD"):
		return "BTC", true
	case s == "ETH" || strings.HasPrefix(s, "ETHUSD"):
		return "ETH", true
	}
	return "", false
}

// FetchOptionChain retrieves all active option book summaries for currency ("BTC" or "ETH") from Deribit Public API v2
// and structures the T-table option chain for selectedExpiry (or the nearest liquid expiry if empty).
func (d *DeribitProvider) FetchOptionChain(ctx context.Context, currency, selectedExpiry string, now time.Time) (OptionChainResponse, error) {
	cur := strings.ToUpper(strings.TrimSpace(currency))
	if cur != "BTC" && cur != "ETH" {
		return OptionChainResponse{
			Supported: false,
			Symbol:    cur,
			Reason:    fmt.Sprintf("Deribit Public API yalnız BTC ve ETH kripto opsiyon zincirini destekler (%s için açık opsiyon verisi yok).", cur),
			Expiries:  []OptionExpirySummary{},
			Rows:      []OptionChainStrikeRow{},
		}, nil
	}

	params := url.Values{}
	params.Set("currency", cur)
	params.Set("kind", "option")

	var lastErr error
	for _, base := range d.BaseURLs {
		ep := fmt.Sprintf("%s/api/v2/public/get_book_summary_by_currency?%s", strings.TrimRight(base, "/"), params.Encode())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", "TitanView/4.0")
		resp, err := d.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, rerr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK || rerr != nil {
			lastErr = fmt.Errorf("deribit status %d from %s", resp.StatusCode, base)
			continue
		}
		chain, perr := ParseDeribitBookSummaries(cur, selectedExpiry, body, now)
		if perr == nil {
			return chain, nil
		}
		lastErr = perr
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("deribit option chain unavailable for %s", cur)
	}
	return OptionChainResponse{}, lastErr
}

type deribitBookSummary struct {
	InstrumentName string   `json:"instrument_name"`
	Underlying     float64  `json:"underlying_price"`
	EstDelivery    float64  `json:"estimated_delivery_price"`
	MarkPrice      float64  `json:"mark_price"`
	MarkIV         float64  `json:"mark_iv"`
	BidPrice       *float64 `json:"bid_price"`
	AskPrice       *float64 `json:"ask_price"`
	Last           *float64 `json:"last"`
	OpenInterest   float64  `json:"open_interest"`
	Volume         float64  `json:"volume"`
	VolumeUSD      float64  `json:"volume_usd"`
}

// ParseDeribitInstrument parses "BTC-29JAN27-56000-C" into (currency, expiryCode, expiryTime, expiryISO, strike, optType, ok).
func ParseDeribitInstrument(name string) (cur, expCode string, expTime int64, expISO string, strike float64, optType string, ok bool) {
	parts := strings.Split(strings.ToUpper(strings.TrimSpace(name)), "-")
	if len(parts) != 4 {
		return "", "", 0, "", 0, "", false
	}
	cur = parts[0]
	expCode = parts[1]
	optType = parts[3]
	if optType != "C" && optType != "P" {
		return "", "", 0, "", 0, "", false
	}
	st, err := strconv.ParseFloat(parts[2], 64)
	if err != nil || st <= 0 {
		return "", "", 0, "", 0, "", false
	}
	strike = st

	// Parse DDMMMYY or DMMMYY (e.g. "29JAN27" or "6DEC26")
	if len(expCode) < 6 || len(expCode) > 7 {
		return "", "", 0, "", 0, "", false
	}
	dayLen := len(expCode) - 5
	day, err1 := strconv.Atoi(expCode[:dayLen])
	monStr := expCode[dayLen : dayLen+3]
	yr2, err2 := strconv.Atoi(expCode[dayLen+3:])
	if err1 != nil || err2 != nil || day < 1 || day > 31 {
		return "", "", 0, "", 0, "", false
	}
	months := map[string]time.Month{
		"JAN": time.January, "FEB": time.February, "MAR": time.March, "APR": time.April,
		"MAY": time.May, "JUN": time.June, "JUL": time.July, "AUG": time.August,
		"SEP": time.September, "OCT": time.October, "NOV": time.November, "DEC": time.December,
	}
	mon, mok := months[monStr]
	if !mok {
		return "", "", 0, "", 0, "", false
	}
	t := time.Date(2000+yr2, mon, day, 8, 0, 0, 0, time.UTC)
	return cur, expCode, t.Unix(), t.Format("2006-01-02"), strike, optType, true
}

// ParseDeribitBookSummaries transforms Deribit's get_book_summary_by_currency JSON into an OptionChainResponse.
func ParseDeribitBookSummaries(currency, selectedExpiry string, body []byte, now time.Time) (OptionChainResponse, error) {
	var env struct {
		Result []deribitBookSummary `json:"result"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return OptionChainResponse{}, fmt.Errorf("parse deribit json: %w", err)
	}
	if len(env.Result) == 0 {
		return OptionChainResponse{}, fmt.Errorf("empty deribit option list for %s", currency)
	}

	nowSec := now.Unix()
	type parsedItem struct {
		raw     deribitBookSummary
		expCode string
		expTime int64
		expISO  string
		strike  float64
		optType string
	}

	var items []parsedItem
	var spot float64
	expMap := map[string]*OptionExpirySummary{}
	expStrikes := map[string]map[float64]bool{}

	for _, r := range env.Result {
		_, expCode, expTime, expISO, strike, optType, ok := ParseDeribitInstrument(r.InstrumentName)
		if !ok {
			continue
		}
		// Keep active/upcoming expiries (allow 12h grace)
		if expTime < nowSec-43200 {
			continue
		}
		if spot <= 0 {
			if r.EstDelivery > 0 {
				spot = r.EstDelivery
			} else if r.Underlying > 0 {
				spot = r.Underlying
			}
		}
		dte := math.Max(0.01, float64(expTime-nowSec)/86400.0)
		sum, exists := expMap[expCode]
		if !exists {
			sum = &OptionExpirySummary{
				Code:         expCode,
				Date:         expISO,
				ExpiryTime:   expTime,
				DaysToExpiry: math.Round(dte*10) / 10,
			}
			expMap[expCode] = sum
			expStrikes[expCode] = map[float64]bool{}
		}
		if !expStrikes[expCode][strike] {
			expStrikes[expCode][strike] = true
			sum.StrikeCount++
		}
		sum.TotalOI += r.OpenInterest
		items = append(items, parsedItem{
			raw:     r,
			expCode: expCode,
			expTime: expTime,
			expISO:  expISO,
			strike:  strike,
			optType: optType,
		})
	}

	if len(expMap) == 0 {
		return OptionChainResponse{}, fmt.Errorf("no active option expiries for %s", currency)
	}

	expiries := make([]OptionExpirySummary, 0, len(expMap))
	for _, e := range expMap {
		e.TotalOI = math.Round(e.TotalOI*10) / 10
		expiries = append(expiries, *e)
	}
	sort.Slice(expiries, func(i, j int) bool { return expiries[i].ExpiryTime < expiries[j].ExpiryTime })

	chosen := strings.ToUpper(strings.TrimSpace(selectedExpiry))
	if _, ok := expMap[chosen]; !ok {
		// Default to the first expiry with at least 6 strikes (or the very first expiry).
		chosen = expiries[0].Code
		for _, e := range expiries {
			if e.StrikeCount >= 6 {
				chosen = e.Code
				break
			}
		}
	}
	chosenExp := expMap[chosen]

	rowMap := map[float64]*OptionChainStrikeRow{}
	var stats OptionChainStats
	bestAtmDist := math.MaxFloat64

	for _, it := range items {
		if it.expCode != chosen {
			continue
		}
		r := it.raw
		fwd := r.Underlying
		if fwd <= 0 {
			fwd = spot
		}
		if spot <= 0 && fwd > 0 {
			spot = fwd
		}
		T := math.Max(1.0/3650.0, float64(it.expTime-nowSec)/(86400.0*365.0))
		iv := r.MarkIV
		if iv <= 0 {
			iv = 55.0
		}
		delta, gamma, theta, vega := BlackScholesGreeks(fwd, it.strike, T, iv/100.0, it.optType == "C")

		var bidUSD, askUSD, lastUSD float64
		if r.BidPrice != nil && *r.BidPrice > 0 {
			bidUSD = *r.BidPrice * fwd
		}
		if r.AskPrice != nil && *r.AskPrice > 0 {
			askUSD = *r.AskPrice * fwd
		}
		if r.Last != nil && *r.Last > 0 {
			lastUSD = *r.Last * fwd
		}
		markUSD := r.MarkPrice * fwd
		itm := (it.optType == "C" && fwd > it.strike) || (it.optType == "P" && fwd < it.strike)

		q := &OptionContractQuote{
			Instrument:   r.InstrumentName,
			Type:         it.optType,
			Strike:       it.strike,
			MarkCoin:     math.Round(r.MarkPrice*10000) / 10000,
			MarkUSD:      math.Round(markUSD*100) / 100,
			BidUSD:       math.Round(bidUSD*100) / 100,
			AskUSD:       math.Round(askUSD*100) / 100,
			LastUSD:      math.Round(lastUSD*100) / 100,
			MarkIV:       math.Round(iv*100) / 100,
			OpenInterest: math.Round(r.OpenInterest*10) / 10,
			Volume:       math.Round(r.Volume*100) / 100,
			VolumeUSD:    math.Round(r.VolumeUSD*100) / 100,
			Delta:        math.Round(delta*1000) / 1000,
			Gamma:        math.Round(gamma*1000000) / 1000000,
			Theta:        math.Round(theta*100) / 100,
			Vega:         math.Round(vega*100) / 100,
			ITM:          itm,
		}

		row, ok := rowMap[it.strike]
		if !ok {
			distPct := 0.0
			if spot > 0 {
				distPct = math.Round(((it.strike-spot)/spot)*10000) / 100
			}
			row = &OptionChainStrikeRow{
				Strike:      it.strike,
				DistancePct: distPct,
			}
			rowMap[it.strike] = row
		}
		if it.optType == "C" {
			row.Call = q
			stats.TotalCallOI += r.OpenInterest
		} else {
			row.Put = q
			stats.TotalPutOI += r.OpenInterest
		}
		stats.TotalVolumeUSD += r.VolumeUSD
		if spot > 0 {
			if d := math.Abs(it.strike - spot); d < bestAtmDist && r.MarkIV > 0 {
				bestAtmDist = d
				stats.AtmIV = math.Round(r.MarkIV*100) / 100
			}
		}
	}

	rows := make([]OptionChainStrikeRow, 0, len(rowMap))
	for _, r := range rowMap {
		rows = append(rows, *r)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Strike < rows[j].Strike })

	stats.TotalCallOI = math.Round(stats.TotalCallOI*10) / 10
	stats.TotalPutOI = math.Round(stats.TotalPutOI*10) / 10
	stats.TotalVolumeUSD = math.Round(stats.TotalVolumeUSD)
	if stats.TotalCallOI > 0 {
		stats.PutCallOIRatio = math.Round((stats.TotalPutOI/stats.TotalCallOI)*100) / 100
	}
	stats.MaxPainStrike = ComputeMaxPainStrike(rows)

	return OptionChainResponse{
		Supported:      true,
		Market:         "CRYPTO",
		Symbol:         currency + "USDT",
		Underlying:     currency,
		Provider:       "DERIBIT",
		SpotPrice:      math.Round(spot*100) / 100,
		Expiries:       expiries,
		SelectedExpiry: chosenExp.Code,
		DaysToExpiry:   chosenExp.DaysToExpiry,
		Summary:        stats,
		Rows:           rows,
	}, nil
}

// ComputeMaxPainStrike finds the strike price at which total intrinsic value paid to option holders at expiration is minimized.
func ComputeMaxPainStrike(rows []OptionChainStrikeRow) float64 {
	if len(rows) == 0 {
		return 0
	}
	minPain := math.MaxFloat64
	bestStrike := rows[0].Strike
	for _, cand := range rows {
		S := cand.Strike
		pain := 0.0
		for _, r := range rows {
			if r.Call != nil && S > r.Strike {
				pain += (S - r.Strike) * r.Call.OpenInterest
			}
			if r.Put != nil && S < r.Strike {
				pain += (r.Strike - S) * r.Put.OpenInterest
			}
		}
		if pain < minPain {
			minPain = pain
			bestStrike = S
		}
	}
	return bestStrike
}

// BlackScholesGreeks computes Black-76 option Greeks (Delta, Gamma, Theta/day in USD, Vega/1%IV in USD).
func BlackScholesGreeks(F, K, T, sigma float64, isCall bool) (delta, gamma, theta, vega float64) {
	if F <= 0 || K <= 0 || T <= 0 || sigma <= 0 {
		if isCall && F > K {
			return 1, 0, 0, 0
		}
		if !isCall && F < K {
			return -1, 0, 0, 0
		}
		return 0, 0, 0, 0
	}
	sqrtT := math.Sqrt(T)
	d1 := (math.Log(F/K) + 0.5*sigma*sigma*T) / (sigma * sqrtT)
	nd1 := normPDF(d1)
	if isCall {
		delta = normCDF(d1)
	} else {
		delta = normCDF(d1) - 1.0
	}
	gamma = nd1 / (F * sigma * sqrtT)
	vega = (F * nd1 * sqrtT) / 100.0
	theta = -(F * nd1 * sigma) / (2.0 * sqrtT * 365.0)
	return delta, gamma, theta, vega
}

func normPDF(x float64) float64 {
	return math.Exp(-0.5*x*x) / math.Sqrt(2.0*math.Pi)
}

func normCDF(x float64) float64 {
	return 0.5 * (1.0 + math.Erf(x/math.Sqrt2))
}

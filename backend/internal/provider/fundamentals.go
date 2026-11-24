package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ersincebi/titanview/backend/internal/domain"
)

// FinancialPeriodRow holds one annual or quarterly period across Income Statement, Balance Sheet, and Cash Flow.
// Any field not reported by the upstream source remains nil (never fabricated).
type FinancialPeriodRow struct {
	Period string `json:"period"` // e.g. "2024", "2025-Q3"
	Date   string `json:"date"`   // e.g. "2024-12-31"

	// Income Statement (Gelir Tablosu)
	TotalRevenue    *float64 `json:"totalRevenue,omitempty"`
	GrossProfit     *float64 `json:"grossProfit,omitempty"`
	OperatingIncome *float64 `json:"operatingIncome,omitempty"`
	EBITDA          *float64 `json:"ebitda,omitempty"`
	PretaxIncome    *float64 `json:"pretaxIncome,omitempty"`
	NetIncome       *float64 `json:"netIncome,omitempty"`
	DilutedEPS      *float64 `json:"dilutedEps,omitempty"`

	// Balance Sheet (Bilanço)
	TotalAssets           *float64 `json:"totalAssets,omitempty"`
	CurrentAssets         *float64 `json:"currentAssets,omitempty"`
	CashAndEquivalents    *float64 `json:"cashAndEquivalents,omitempty"`
	NonCurrentAssets      *float64 `json:"nonCurrentAssets,omitempty"`
	TotalLiabilities      *float64 `json:"totalLiabilities,omitempty"`
	CurrentLiabilities    *float64 `json:"currentLiabilities,omitempty"`
	NonCurrentLiabilities *float64 `json:"nonCurrentLiabilities,omitempty"`
	TotalDebt             *float64 `json:"totalDebt,omitempty"`
	NetDebt               *float64 `json:"netDebt,omitempty"`
	StockholdersEquity    *float64 `json:"stockholdersEquity,omitempty"`

	// Cash Flow Statement (Nakit Akışı)
	OperatingCashFlow  *float64 `json:"operatingCashFlow,omitempty"`
	CapitalExpenditure *float64 `json:"capitalExpenditure,omitempty"`
	FreeCashFlow       *float64 `json:"freeCashFlow,omitempty"`
	InvestingCashFlow  *float64 `json:"investingCashFlow,omitempty"`
	FinancingCashFlow  *float64 `json:"financingCashFlow,omitempty"`
}

// FinancialRatios holds key valuation multiples, profitability margins, and balance-sheet health ratios.
type FinancialRatios struct {
	MarketCap          *float64 `json:"marketCap,omitempty"`
	EnterpriseValue    *float64 `json:"enterpriseValue,omitempty"`
	TrailingPE         *float64 `json:"trailingPe,omitempty"`
	ForwardPE          *float64 `json:"forwardPe,omitempty"`
	PriceToBook        *float64 `json:"priceToBook,omitempty"`
	PriceToSales       *float64 `json:"priceToSales,omitempty"`
	EnterpriseToEbitda *float64 `json:"enterpriseToEbitda,omitempty"`
	TrailingEPS        *float64 `json:"trailingEps,omitempty"`
	DividendYieldPct   *float64 `json:"dividendYieldPct,omitempty"`
	DividendRate       *float64 `json:"dividendRate,omitempty"`
	GrossMarginPct     *float64 `json:"grossMarginPct,omitempty"`
	OperatingMarginPct *float64 `json:"operatingMarginPct,omitempty"`
	ProfitMarginPct    *float64 `json:"profitMarginPct,omitempty"`
	ROEPct             *float64 `json:"roePct,omitempty"`
	ROAPct             *float64 `json:"roaPct,omitempty"`
	DebtToEquity       *float64 `json:"debtToEquity,omitempty"`
	CurrentRatio       *float64 `json:"currentRatio,omitempty"`
	QuickRatio         *float64 `json:"quickRatio,omitempty"`
	Beta               *float64 `json:"beta,omitempty"`
}

// FundamentalsReport bundles statements, ratios, and calendar dates for an equity symbol.
type FundamentalsReport struct {
	Symbol           string               `json:"symbol"`
	DisplayName      string               `json:"displayName"`
	Market           string               `json:"market"`
	Currency         string               `json:"currency"`
	Supported        bool                 `json:"supported"`
	Reason           string               `json:"reason,omitempty"`
	Source           string               `json:"source"`
	Ratios           FinancialRatios      `json:"ratios"`
	Annual           []FinancialPeriodRow `json:"annual"`
	Quarterly        []FinancialPeriodRow `json:"quarterly"`
	Earnings         []EarningsEvent      `json:"earnings,omitempty"`
	NextEarningsTime *int64               `json:"nextEarningsTime,omitempty"`
	ExDividendTime   *int64               `json:"exDividendTime,omitempty"`
}

// FundamentalsFetcher is implemented by providers that can fetch corporate financial statements & ratios.
type FundamentalsFetcher interface {
	FetchFundamentals(ctx context.Context, symbol string) (FundamentalsReport, error)
}

var (
	yahooCrumbMu      sync.Mutex
	yahooCrumbVal     string
	yahooCrumbExpires time.Time
	yahooCrumbClient  *http.Client
)

// IsYatirimBaseURL can be overridden in unit tests.
var IsYatirimBaseURL = "https://www.isyatirim.com.tr"

func floatPtr(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	r := math.Round(v*10000) / 10000
	return &r
}

func (y *YahooProvider) getCrumbClient(ctx context.Context) (*http.Client, string) {
	// If unit tests supplied a custom mock transport on y.HTTPClient, use it directly without hitting fc.yahoo.com.
	if y.HTTPClient != nil && y.HTTPClient.Transport != nil {
		return y.HTTPClient, "test-crumb"
	}
	yahooCrumbMu.Lock()
	defer yahooCrumbMu.Unlock()
	if yahooCrumbClient != nil && yahooCrumbVal != "" && time.Now().Before(yahooCrumbExpires) {
		return yahooCrumbClient, yahooCrumbVal
	}
	jar, _ := cookiejar.New(nil)
	timeout := 8 * time.Second
	if y.HTTPClient != nil && y.HTTPClient.Timeout > 0 {
		timeout = y.HTTPClient.Timeout
	}
	client := &http.Client{Timeout: timeout, Jar: jar}

	req1, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://fc.yahoo.com", nil)
	if err == nil {
		req1.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
		if resp, err := client.Do(req1); err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
			_ = resp.Body.Close()
		}
	}

	crumbURL := "https://query2.finance.yahoo.com/v1/test/getcrumb"
	if len(y.BaseURLs) > 0 && !strings.Contains(y.BaseURLs[0], "finance.yahoo.com") {
		crumbURL = strings.TrimRight(y.BaseURLs[0], "/") + "/v1/test/getcrumb"
	}
	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, crumbURL, nil)
	if err == nil {
		req2.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
		if resp, err := client.Do(req2); err == nil {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
			_ = resp.Body.Close()
			c := strings.TrimSpace(string(b))
			if resp.StatusCode == http.StatusOK && len(c) > 0 && len(c) < 64 && !strings.Contains(c, "<") {
				yahooCrumbClient = client
				yahooCrumbVal = c
				yahooCrumbExpires = time.Now().Add(25 * time.Minute)
				return client, c
			}
		}
	}
	return y.HTTPClient, ""
}

// FetchFundamentals retrieves real income statement, balance sheet, cash flow, and valuation ratios.
// For BIST (.IS) equities, combines official KAP / İş Yatırım UFRS statements with Yahoo Finance ratios/timeseries.
func (y *YahooProvider) FetchFundamentals(ctx context.Context, symbol string) (FundamentalsReport, error) {
	info := domain.ResolveSymbolInfo(symbol)
	if info.Market == domain.MarketCrypto || info.Market == domain.MarketForex || domain.IsSymbolExpression(symbol) {
		return FundamentalsReport{
			Symbol:      info.Symbol,
			DisplayName: info.DisplayName,
			Market:      string(info.Market),
			Currency:    info.Currency,
			Supported:   false,
			Reason:      "Kripto varlıklar, döviz/emtia çiftleri ve sentetik ifadeler için kurumsal finansal tablo (gelir tablosu / bilanço / nakit akışı) bulunmaz.",
			Annual:      []FinancialPeriodRow{},
			Quarterly:   []FinancialPeriodRow{},
		}, nil
	}

	rep := FundamentalsReport{
		Symbol:      info.Symbol,
		DisplayName: info.DisplayName,
		Market:      string(info.Market),
		Currency:    info.Currency,
		Supported:   true,
		Source:      "Yahoo Finance",
		Annual:      []FinancialPeriodRow{},
		Quarterly:   []FinancialPeriodRow{},
	}

	var wg sync.WaitGroup
	var tsAnnual, tsQuarterly []FinancialPeriodRow
	var tsErr error
	var qsRatios FinancialRatios
	var qsEarnings []EarningsEvent
	var qsNextEarn, qsExDiv *int64
	var qsAnnual, qsQuarterly []FinancialPeriodRow
	var qsErr error
	var isAnnual, isQuarterly []FinancialPeriodRow
	var isOk bool

	// 1. Yahoo fundamentals-timeseries (annual + quarterly)
	wg.Add(1)
	go func() {
		defer wg.Done()
		tsAnnual, tsQuarterly, tsErr = y.fetchYahooTimeseries(ctx, info.Symbol)
	}()

	// 2. Yahoo quoteSummary (ratios, multiples, earnings history, calendar dates)
	wg.Add(1)
	go func() {
		defer wg.Done()
		qsRatios, qsAnnual, qsQuarterly, qsEarnings, qsNextEarn, qsExDiv, qsErr = y.fetchYahooQuoteSummary(ctx, info.Symbol)
	}()

	// 3. BIST: İş Yatırım official KAP UFRS financial statements
	if info.Market == domain.MarketBIST && strings.HasSuffix(info.Symbol, ".IS") {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code := strings.TrimSuffix(info.Symbol, ".IS")
			if code != "XU100" && code != "XU030" {
				isAnnual, isQuarterly, isOk = y.fetchIsYatirimStatements(ctx, code)
			}
		}()
	}

	wg.Wait()

	rep.Ratios = qsRatios
	rep.Earnings = qsEarnings
	rep.NextEarningsTime = qsNextEarn
	rep.ExDividendTime = qsExDiv

	// Merge statements: prefer İş Yatırım KAP statements for BIST when available, enriched with Yahoo timeseries/quoteSummary.
	if isOk && (len(isAnnual) > 0 || len(isQuarterly) > 0) {
		rep.Source = "KAP / İş Yatırım + Yahoo Finance"
		rep.Annual = mergePeriodRows(isAnnual, tsAnnual)
		rep.Quarterly = mergePeriodRows(isQuarterly, tsQuarterly)
	} else if len(tsAnnual) > 0 || len(tsQuarterly) > 0 {
		rep.Annual = mergePeriodRows(tsAnnual, qsAnnual)
		rep.Quarterly = mergePeriodRows(tsQuarterly, qsQuarterly)
	} else {
		rep.Annual = qsAnnual
		rep.Quarterly = qsQuarterly
	}

	// Fill derived accounting ratios from the latest real annual statement only when Yahoo quoteSummary left them nil.
	if len(rep.Annual) > 0 {
		enrichAccountingRatios(&rep.Ratios, rep.Annual[0])
	}

	if len(rep.Annual) == 0 && len(rep.Quarterly) == 0 && !hasAnyRatio(rep.Ratios) {
		if tsErr != nil && qsErr != nil {
			return rep, tsErr
		}
		rep.Supported = false
		rep.Reason = fmt.Sprintf("%s için Yahoo Finance veya KAP kaynağında yayınlanmış finansal tablo bulunamadı.", info.Symbol)
	}

	return rep, nil
}

func hasAnyRatio(r FinancialRatios) bool {
	return r.MarketCap != nil || r.TrailingPE != nil || r.PriceToBook != nil || r.ProfitMarginPct != nil || r.ROEPct != nil
}

func enrichAccountingRatios(r *FinancialRatios, latest FinancialPeriodRow) {
	if latest.TotalRevenue != nil && *latest.TotalRevenue > 0 {
		rev := *latest.TotalRevenue
		if r.GrossMarginPct == nil && latest.GrossProfit != nil {
			r.GrossMarginPct = floatPtr((*latest.GrossProfit / rev) * 100)
		}
		if r.OperatingMarginPct == nil && latest.OperatingIncome != nil {
			r.OperatingMarginPct = floatPtr((*latest.OperatingIncome / rev) * 100)
		}
		if r.ProfitMarginPct == nil && latest.NetIncome != nil {
			r.ProfitMarginPct = floatPtr((*latest.NetIncome / rev) * 100)
		}
	}
	if r.ROEPct == nil && latest.NetIncome != nil && latest.StockholdersEquity != nil && *latest.StockholdersEquity > 0 {
		r.ROEPct = floatPtr((*latest.NetIncome / *latest.StockholdersEquity) * 100)
	}
	if r.ROAPct == nil && latest.NetIncome != nil && latest.TotalAssets != nil && *latest.TotalAssets > 0 {
		r.ROAPct = floatPtr((*latest.NetIncome / *latest.TotalAssets) * 100)
	}
	if r.CurrentRatio == nil && latest.CurrentAssets != nil && latest.CurrentLiabilities != nil && *latest.CurrentLiabilities > 0 {
		r.CurrentRatio = floatPtr(*latest.CurrentAssets / *latest.CurrentLiabilities)
	}
	if r.DebtToEquity == nil && latest.TotalDebt != nil && latest.StockholdersEquity != nil && *latest.StockholdersEquity > 0 {
		r.DebtToEquity = floatPtr((*latest.TotalDebt / *latest.StockholdersEquity) * 100)
	}
}

func mergePeriodRows(primary, secondary []FinancialPeriodRow) []FinancialPeriodRow {
	if len(primary) == 0 {
		return secondary
	}
	if len(secondary) == 0 {
		return primary
	}
	out := make([]FinancialPeriodRow, len(primary))
	copy(out, primary)
	secByYear := map[string]FinancialPeriodRow{}
	for _, s := range secondary {
		secByYear[s.Period] = s
		if len(s.Date) >= 4 {
			secByYear[s.Date[:4]] = s
		}
	}
	for i := range out {
		s, ok := secByYear[out[i].Period]
		if !ok && len(out[i].Date) >= 4 {
			s, ok = secByYear[out[i].Date[:4]]
		}
		if !ok {
			continue
		}
		fillNil(&out[i].TotalRevenue, s.TotalRevenue)
		fillNil(&out[i].GrossProfit, s.GrossProfit)
		fillNil(&out[i].OperatingIncome, s.OperatingIncome)
		fillNil(&out[i].EBITDA, s.EBITDA)
		fillNil(&out[i].PretaxIncome, s.PretaxIncome)
		fillNil(&out[i].NetIncome, s.NetIncome)
		fillNil(&out[i].DilutedEPS, s.DilutedEPS)
		fillNil(&out[i].TotalAssets, s.TotalAssets)
		fillNil(&out[i].CurrentAssets, s.CurrentAssets)
		fillNil(&out[i].CashAndEquivalents, s.CashAndEquivalents)
		fillNil(&out[i].NonCurrentAssets, s.NonCurrentAssets)
		fillNil(&out[i].TotalLiabilities, s.TotalLiabilities)
		fillNil(&out[i].CurrentLiabilities, s.CurrentLiabilities)
		fillNil(&out[i].NonCurrentLiabilities, s.NonCurrentLiabilities)
		fillNil(&out[i].TotalDebt, s.TotalDebt)
		fillNil(&out[i].NetDebt, s.NetDebt)
		fillNil(&out[i].StockholdersEquity, s.StockholdersEquity)
		fillNil(&out[i].OperatingCashFlow, s.OperatingCashFlow)
		fillNil(&out[i].CapitalExpenditure, s.CapitalExpenditure)
		fillNil(&out[i].FreeCashFlow, s.FreeCashFlow)
		fillNil(&out[i].InvestingCashFlow, s.InvestingCashFlow)
		fillNil(&out[i].FinancingCashFlow, s.FinancingCashFlow)
	}
	return out
}

func fillNil(dst **float64, src *float64) {
	if *dst == nil && src != nil {
		*dst = src
	}
}

var yahooTimeseriesTypes = []string{
	"annualTotalRevenue", "annualGrossProfit", "annualOperatingIncome", "annualEBITDA", "annualPretaxIncome", "annualNetIncome", "annualDilutedEPS",
	"annualTotalAssets", "annualCurrentAssets", "annualCashAndCashEquivalents", "annualTotalNonCurrentAssets",
	"annualTotalLiabilitiesNetMinorityInterest", "annualCurrentLiabilities", "annualTotalNonCurrentLiabilitiesNetMinorityInterest",
	"annualTotalDebt", "annualNetDebt", "annualStockholdersEquity",
	"annualOperatingCashFlow", "annualCapitalExpenditure", "annualFreeCashFlow", "annualInvestingCashFlow", "annualFinancingCashFlow",
	"quarterlyTotalRevenue", "quarterlyGrossProfit", "quarterlyOperatingIncome", "quarterlyEBITDA", "quarterlyPretaxIncome", "quarterlyNetIncome", "quarterlyDilutedEPS",
	"quarterlyTotalAssets", "quarterlyCurrentAssets", "quarterlyCashAndCashEquivalents", "quarterlyTotalNonCurrentAssets",
	"quarterlyTotalLiabilitiesNetMinorityInterest", "quarterlyCurrentLiabilities", "quarterlyTotalNonCurrentLiabilitiesNetMinorityInterest",
	"quarterlyTotalDebt", "quarterlyNetDebt", "quarterlyStockholdersEquity",
	"quarterlyOperatingCashFlow", "quarterlyCapitalExpenditure", "quarterlyFreeCashFlow", "quarterlyInvestingCashFlow", "quarterlyFinancingCashFlow",
}

func (y *YahooProvider) fetchYahooTimeseries(ctx context.Context, sym string) (annual, quarterly []FinancialPeriodRow, err error) {
	params := url.Values{}
	params.Set("type", strings.Join(yahooTimeseriesTypes, ","))
	params.Set("period1", strconv.FormatInt(time.Now().Unix()-86400*365*5, 10))
	params.Set("period2", strconv.FormatInt(time.Now().Unix()+86400, 10))

	var lastErr error
	for _, base := range y.BaseURLs {
		ep := fmt.Sprintf("%s/ws/fundamentals-timeseries/v1/finance/timeseries/%s?%s", strings.TrimRight(base, "/"), url.PathEscape(sym), params.Encode())
		req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
		if rerr != nil {
			lastErr = rerr
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json")
		resp, derr := y.HTTPClient.Do(req)
		if derr != nil {
			lastErr = derr
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("yahoo timeseries status %d", resp.StatusCode)
			continue
		}
		a, q, perr := ParseYahooTimeseries(body)
		if perr == nil && (len(a) > 0 || len(q) > 0) {
			return a, q, nil
		}
		lastErr = perr
	}
	return nil, nil, lastErr
}

// ParseYahooTimeseries parses Yahoo's fundamentals-timeseries JSON into sorted annual and quarterly rows.
func ParseYahooTimeseries(body []byte) (annual, quarterly []FinancialPeriodRow, err error) {
	var env struct {
		Timeseries struct {
			Result []map[string]json.RawMessage `json:"result"`
		} `json:"timeseries"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, nil, err
	}
	type tsEntry struct {
		AsOfDate      string `json:"asOfDate"`
		ReportedValue struct {
			Raw *float64 `json:"raw"`
		} `json:"reportedValue"`
	}

	annMap := map[string]*FinancialPeriodRow{}
	qtrMap := map[string]*FinancialPeriodRow{}

	getRow := func(m map[string]*FinancialPeriodRow, date string, isQuarterly bool) *FinancialPeriodRow {
		if r, ok := m[date]; ok {
			return r
		}
		period := date
		if len(date) >= 7 {
			yr := date[:4]
			if !isQuarterly {
				period = yr
			} else {
				mo, _ := strconv.Atoi(date[5:7])
				q := (mo-1)/3 + 1
				period = fmt.Sprintf("%s-Q%d", yr, q)
			}
		}
		r := &FinancialPeriodRow{Period: period, Date: date}
		m[date] = r
		return r
	}

	for _, item := range env.Timeseries.Result {
		for key, rawMsg := range item {
			if key == "meta" || key == "timestamp" {
				continue
			}
			isAnn := strings.HasPrefix(key, "annual")
			isQtr := strings.HasPrefix(key, "quarterly")
			if !isAnn && !isQtr {
				continue
			}
			field := strings.TrimPrefix(strings.TrimPrefix(key, "annual"), "quarterly")
			var entries []tsEntry
			if err := json.Unmarshal(rawMsg, &entries); err != nil {
				continue
			}
			targetMap := annMap
			if isQtr {
				targetMap = qtrMap
			}
			for _, e := range entries {
				if e.AsOfDate == "" || e.ReportedValue.Raw == nil {
					continue
				}
				val := floatPtr(*e.ReportedValue.Raw)
				row := getRow(targetMap, e.AsOfDate, isQtr)
				applyTimeseriesField(row, field, val)
			}
		}
	}

	finalize := func(m map[string]*FinancialPeriodRow) []FinancialPeriodRow {
		rows := make([]FinancialPeriodRow, 0, len(m))
		for _, r := range m {
			if r.NetDebt == nil && r.TotalDebt != nil && r.CashAndEquivalents != nil {
				r.NetDebt = floatPtr(*r.TotalDebt - *r.CashAndEquivalents)
			}
			if r.FreeCashFlow == nil && r.OperatingCashFlow != nil && r.CapitalExpenditure != nil {
				// Yahoo CapEx is negative; if positive, subtract
				capex := *r.CapitalExpenditure
				if capex < 0 {
					r.FreeCashFlow = floatPtr(*r.OperatingCashFlow + capex)
				} else {
					r.FreeCashFlow = floatPtr(*r.OperatingCashFlow - capex)
				}
			}
			rows = append(rows, *r)
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].Date > rows[j].Date })
		if len(rows) > 5 {
			rows = rows[:5]
		}
		return rows
	}

	return finalize(annMap), finalize(qtrMap), nil
}

func applyTimeseriesField(row *FinancialPeriodRow, field string, val *float64) {
	switch field {
	case "TotalRevenue":
		row.TotalRevenue = val
	case "GrossProfit":
		row.GrossProfit = val
	case "OperatingIncome":
		row.OperatingIncome = val
	case "EBITDA":
		row.EBITDA = val
	case "PretaxIncome":
		row.PretaxIncome = val
	case "NetIncome":
		row.NetIncome = val
	case "DilutedEPS":
		row.DilutedEPS = val
	case "TotalAssets":
		row.TotalAssets = val
	case "CurrentAssets":
		row.CurrentAssets = val
	case "CashAndCashEquivalents":
		row.CashAndEquivalents = val
	case "TotalNonCurrentAssets":
		row.NonCurrentAssets = val
	case "TotalLiabilitiesNetMinorityInterest":
		row.TotalLiabilities = val
	case "CurrentLiabilities":
		row.CurrentLiabilities = val
	case "TotalNonCurrentLiabilitiesNetMinorityInterest":
		row.NonCurrentLiabilities = val
	case "TotalDebt":
		row.TotalDebt = val
	case "NetDebt":
		row.NetDebt = val
	case "StockholdersEquity":
		row.StockholdersEquity = val
	case "OperatingCashFlow":
		row.OperatingCashFlow = val
	case "CapitalExpenditure":
		row.CapitalExpenditure = val
	case "FreeCashFlow":
		row.FreeCashFlow = val
	case "InvestingCashFlow":
		row.InvestingCashFlow = val
	case "FinancingCashFlow":
		row.FinancingCashFlow = val
	}
}

type rawVal struct {
	Raw *float64 `json:"raw"`
	Fmt string   `json:"fmt"`
}

func (r rawVal) ptr() *float64 {
	if r.Raw == nil {
		return nil
	}
	return floatPtr(*r.Raw)
}

func (r rawVal) pctPtr() *float64 {
	if r.Raw == nil {
		return nil
	}
	return floatPtr(*r.Raw * 100.0)
}

func (r rawVal) int64Ptr() *int64 {
	if r.Raw == nil || *r.Raw <= 0 {
		return nil
	}
	v := int64(*r.Raw)
	return &v
}

func (y *YahooProvider) fetchYahooQuoteSummary(ctx context.Context, sym string) (
	ratios FinancialRatios,
	annual, quarterly []FinancialPeriodRow,
	earnings []EarningsEvent,
	nextEarn, exDiv *int64,
	err error,
) {
	client, crumb := y.getCrumbClient(ctx)
	params := url.Values{}
	params.Set("modules", "summaryDetail,defaultKeyStatistics,financialData,calendarEvents,earningsHistory,incomeStatementHistory,incomeStatementHistoryQuarterly,balanceSheetHistory,balanceSheetHistoryQuarterly,cashflowStatementHistory,cashflowStatementHistoryQuarterly")
	if crumb != "" {
		params.Set("crumb", crumb)
	}

	var lastErr error
	for _, base := range y.BaseURLs {
		ep := fmt.Sprintf("%s/v10/finance/quoteSummary/%s?%s", strings.TrimRight(base, "/"), url.PathEscape(sym), params.Encode())
		req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
		if rerr != nil {
			lastErr = rerr
			continue
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "application/json")
		resp, derr := client.Do(req)
		if derr != nil {
			lastErr = derr
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("yahoo quoteSummary status %d", resp.StatusCode)
			continue
		}
		ratios, annual, quarterly, earnings, nextEarn, exDiv, err = ParseYahooQuoteSummary(body)
		if err == nil {
			return ratios, annual, quarterly, earnings, nextEarn, exDiv, nil
		}
		lastErr = err
	}
	return ratios, nil, nil, nil, nil, nil, lastErr
}

// ParseYahooQuoteSummary extracts valuation ratios, earnings history, and calendar dates from Yahoo v10 quoteSummary JSON.
func ParseYahooQuoteSummary(body []byte) (
	ratios FinancialRatios,
	annual, quarterly []FinancialPeriodRow,
	earnings []EarningsEvent,
	nextEarn, exDiv *int64,
	err error,
) {
	var env struct {
		QuoteSummary struct {
			Result []struct {
				SummaryDetail struct {
					MarketCap    rawVal `json:"marketCap"`
					TrailingPE   rawVal `json:"trailingPE"`
					ForwardPE    rawVal `json:"forwardPE"`
					PriceToSales rawVal `json:"priceToSalesTrailing12Months"`
					DividendRate rawVal `json:"dividendRate"`
					DividendYld  rawVal `json:"dividendYield"`
					ExDivDate    rawVal `json:"exDividendDate"`
					Beta         rawVal `json:"beta"`
				} `json:"summaryDetail"`
				DefaultKeyStats struct {
					EnterpriseValue    rawVal `json:"enterpriseValue"`
					ForwardPE          rawVal `json:"forwardPE"`
					PriceToBook        rawVal `json:"priceToBook"`
					EnterpriseToEbitda rawVal `json:"enterpriseToEbitda"`
					TrailingEps        rawVal `json:"trailingEps"`
					ProfitMargins      rawVal `json:"profitMargins"`
					Beta               rawVal `json:"beta"`
				} `json:"defaultKeyStatistics"`
				FinancialData struct {
					CurrentRatio     rawVal `json:"currentRatio"`
					QuickRatio       rawVal `json:"quickRatio"`
					DebtToEquity     rawVal `json:"debtToEquity"`
					ReturnOnAssets   rawVal `json:"returnOnAssets"`
					ReturnOnEquity   rawVal `json:"returnOnEquity"`
					GrossMargins     rawVal `json:"grossMargins"`
					OperatingMargins rawVal `json:"operatingMargins"`
					ProfitMargins    rawVal `json:"profitMargins"`
				} `json:"financialData"`
				CalendarEvents struct {
					ExDividendDate rawVal `json:"exDividendDate"`
					DividendDate   rawVal `json:"dividendDate"`
					Earnings       struct {
						EarningsDate    []rawVal `json:"earningsDate"`
						EarningsAverage rawVal   `json:"earningsAverage"`
					} `json:"earnings"`
				} `json:"calendarEvents"`
				EarningsHistory struct {
					History []struct {
						Quarter     rawVal `json:"quarter"`
						EpsActual   rawVal `json:"epsActual"`
						EpsEstimate rawVal `json:"epsEstimate"`
					} `json:"history"`
				} `json:"earningsHistory"`
			} `json:"result"`
		} `json:"quoteSummary"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return ratios, nil, nil, nil, nil, nil, err
	}
	if len(env.QuoteSummary.Result) == 0 {
		return ratios, nil, nil, nil, nil, nil, fmt.Errorf("empty quoteSummary result")
	}
	res := env.QuoteSummary.Result[0]
	sd := res.SummaryDetail
	ks := res.DefaultKeyStats
	fd := res.FinancialData

	ratios = FinancialRatios{
		MarketCap:          sd.MarketCap.ptr(),
		EnterpriseValue:    ks.EnterpriseValue.ptr(),
		TrailingPE:         sd.TrailingPE.ptr(),
		ForwardPE:          firstNonNil(sd.ForwardPE.ptr(), ks.ForwardPE.ptr()),
		PriceToBook:        ks.PriceToBook.ptr(),
		PriceToSales:       sd.PriceToSales.ptr(),
		EnterpriseToEbitda: ks.EnterpriseToEbitda.ptr(),
		TrailingEPS:        ks.TrailingEps.ptr(),
		DividendRate:       sd.DividendRate.ptr(),
		DividendYieldPct:   sd.DividendYld.pctPtr(),
		GrossMarginPct:     fd.GrossMargins.pctPtr(),
		OperatingMarginPct: fd.OperatingMargins.pctPtr(),
		ProfitMarginPct:    firstNonNil(fd.ProfitMargins.pctPtr(), ks.ProfitMargins.pctPtr()),
		ROEPct:             fd.ReturnOnEquity.pctPtr(),
		ROAPct:             fd.ReturnOnAssets.pctPtr(),
		DebtToEquity:       fd.DebtToEquity.ptr(),
		CurrentRatio:       fd.CurrentRatio.ptr(),
		QuickRatio:         fd.QuickRatio.ptr(),
		Beta:               firstNonNil(sd.Beta.ptr(), ks.Beta.ptr()),
	}

	exDiv = res.CalendarEvents.ExDividendDate.int64Ptr()
	if exDiv == nil {
		exDiv = sd.ExDivDate.int64Ptr()
	}

	seenEarn := map[int64]bool{}
	for _, h := range res.EarningsHistory.History {
		tsPtr := h.Quarter.int64Ptr()
		if tsPtr == nil || seenEarn[*tsPtr] {
			continue
		}
		seenEarn[*tsPtr] = true
		earnings = append(earnings, EarningsEvent{
			Time:     *tsPtr,
			Actual:   h.EpsActual.ptr(),
			Estimate: h.EpsEstimate.ptr(),
		})
	}
	if len(res.CalendarEvents.Earnings.EarningsDate) > 0 {
		if tsPtr := res.CalendarEvents.Earnings.EarningsDate[0].int64Ptr(); tsPtr != nil {
			nextEarn = tsPtr
			if !seenEarn[*tsPtr] {
				seenEarn[*tsPtr] = true
				earnings = append(earnings, EarningsEvent{
					Time:     *tsPtr,
					Estimate: res.CalendarEvents.Earnings.EarningsAverage.ptr(),
				})
			}
		}
	}
	sort.Slice(earnings, func(i, j int) bool { return earnings[i].Time < earnings[j].Time })
	return ratios, annual, quarterly, earnings, nextEarn, exDiv, nil
}

func firstNonNil(vals ...*float64) *float64 {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

// fetchIsYatirimStatements queries İş Yatırım's public MaliTablo endpoint for official KAP UFRS financial statements.
func (y *YahooProvider) fetchIsYatirimStatements(ctx context.Context, companyCode string) (annual, quarterly []FinancialPeriodRow, ok bool) {
	nowYear := time.Now().Year()
	annYears := [4][2]int{{nowYear - 1, 12}, {nowYear - 2, 12}, {nowYear - 3, 12}, {nowYear - 4, 12}}
	qtrPeriods := [4][2]int{{nowYear - 1, 12}, {nowYear - 1, 9}, {nowYear - 1, 6}, {nowYear - 1, 3}}

	for _, group := range []string{"XI_29", "UFRS_K"} {
		var aRows, qRows []FinancialPeriodRow
		var aErr error
		var wg sync.WaitGroup
		wg.Add(2)
		go func(g string) {
			defer wg.Done()
			aRows, aErr = y.queryIsYatirimTable(ctx, companyCode, g, annYears, false)
		}(group)
		go func(g string) {
			defer wg.Done()
			qRows, _ = y.queryIsYatirimTable(ctx, companyCode, g, qtrPeriods, true)
		}(group)
		wg.Wait()
		if aErr == nil && len(aRows) > 0 {
			return aRows, qRows, true
		}
	}
	return nil, nil, false
}

func (y *YahooProvider) queryIsYatirimTable(ctx context.Context, companyCode, finGroup string, periods [4][2]int, isQuarterly bool) ([]FinancialPeriodRow, error) {
	params := url.Values{}
	params.Set("companyCode", companyCode)
	params.Set("exchange", "TRY")
	params.Set("financialGroup", finGroup)
	for i, p := range periods {
		idx := strconv.Itoa(i + 1)
		params.Set("year"+idx, strconv.Itoa(p[0]))
		params.Set("period"+idx, strconv.Itoa(p[1]))
	}
	ep := fmt.Sprintf("%s/_layouts/15/IsYatirim.Website/Common/Data.aspx/MaliTablo?%s", strings.TrimRight(IsYatirimBaseURL, "/"), params.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ep, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")
	client := y.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("isyatirim status %d", resp.StatusCode)
	}
	return ParseIsYatirimMaliTablo(body, periods, isQuarterly)
}

// ParseIsYatirimMaliTablo parses İş Yatırım's KAP MaliTablo JSON response into up to 4 FinancialPeriodRow items.
func ParseIsYatirimMaliTablo(body []byte, periods [4][2]int, isQuarterly bool) ([]FinancialPeriodRow, error) {
	var env struct {
		Ok    bool `json:"ok"`
		Value []struct {
			ItemCode string `json:"itemCode"`
			Value1   string `json:"value1"`
			Value2   string `json:"value2"`
			Value3   string `json:"value3"`
			Value4   string `json:"value4"`
		} `json:"value"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	if !env.Ok || len(env.Value) == 0 {
		return nil, fmt.Errorf("empty isyatirim response")
	}

	rows := make([]FinancialPeriodRow, 4)
	for i, p := range periods {
		yr, mo := p[0], p[1]
		if isQuarterly {
			rows[i].Period = fmt.Sprintf("%d-Q%d", yr, mo/3)
		} else {
			rows[i].Period = strconv.Itoa(yr)
		}
		day := 31
		if mo == 6 || mo == 9 {
			day = 30
		}
		rows[i].Date = fmt.Sprintf("%04d-%02d-%02d", yr, mo, day)
	}

	var shortDebt, longDebt [4]*float64
	var amort [4]*float64

	parseCell := func(s string) *float64 {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return floatPtr(v)
	}

	for _, it := range env.Value {
		vals := [4]*float64{
			parseCell(it.Value1),
			parseCell(it.Value2),
			parseCell(it.Value3),
			parseCell(it.Value4),
		}
		for i := 0; i < 4; i++ {
			v := vals[i]
			if v == nil {
				continue
			}
			switch it.ItemCode {
			case "1A":
				rows[i].CurrentAssets = v
			case "1AA":
				rows[i].CashAndEquivalents = v
			case "1AK":
				rows[i].NonCurrentAssets = v
			case "1BL":
				rows[i].TotalAssets = v
			case "2A":
				rows[i].CurrentLiabilities = v
			case "2AA":
				shortDebt[i] = v
			case "2B":
				rows[i].NonCurrentLiabilities = v
			case "2BA":
				longDebt[i] = v
			case "2N":
				rows[i].StockholdersEquity = v
			case "2O":
				if rows[i].StockholdersEquity == nil {
					rows[i].StockholdersEquity = v
				}
			case "3C":
				rows[i].TotalRevenue = v
			case "3D":
				rows[i].GrossProfit = v
			case "3DF":
				rows[i].OperatingIncome = v
			case "3I":
				rows[i].PretaxIncome = v
			case "3Z":
				rows[i].NetIncome = v
			case "3L":
				if rows[i].NetIncome == nil {
					rows[i].NetIncome = v
				}
			case "4B":
				amort[i] = v
			case "4C":
				rows[i].OperatingCashFlow = v
			case "4CAI":
				rows[i].CapitalExpenditure = v
			case "4CB":
				rows[i].FreeCashFlow = v
			case "4CAK":
				rows[i].InvestingCashFlow = v
			case "4CBE":
				rows[i].FinancingCashFlow = v
			}
		}
	}

	out := make([]FinancialPeriodRow, 0, 4)
	for i := 0; i < 4; i++ {
		r := &rows[i]
		if r.CurrentLiabilities != nil && r.NonCurrentLiabilities != nil {
			r.TotalLiabilities = floatPtr(*r.CurrentLiabilities + *r.NonCurrentLiabilities)
		}
		if shortDebt[i] != nil || longDebt[i] != nil {
			sd, ld := 0.0, 0.0
			if shortDebt[i] != nil {
				sd = *shortDebt[i]
			}
			if longDebt[i] != nil {
				ld = *longDebt[i]
			}
			r.TotalDebt = floatPtr(sd + ld)
			if r.CashAndEquivalents != nil {
				r.NetDebt = floatPtr(sd + ld - *r.CashAndEquivalents)
			}
		}
		if r.OperatingIncome != nil && amort[i] != nil {
			r.EBITDA = floatPtr(*r.OperatingIncome + math.Abs(*amort[i]))
		}
		if r.TotalAssets != nil || r.TotalRevenue != nil || r.NetIncome != nil {
			out = append(out, *r)
		}
	}
	return out, nil
}

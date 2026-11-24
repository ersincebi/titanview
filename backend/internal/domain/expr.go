package domain

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// NormalizeAliasSymbol maps common shorthand FX/index tickers (e.g. USDTRY -> USDTRY=X)
// to their routable Yahoo/Binance canonical symbol.
func NormalizeAliasSymbol(raw string) string {
	sym := NormalizeSymbol(raw)
	switch sym {
	case "USDTRY", "USD/TRY":
		return "USDTRY=X"
	case "EURTRY", "EUR/TRY":
		return "EURTRY=X"
	case "EURUSD", "EUR/USD":
		return "EURUSD=X"
	case "GBPUSD", "GBP/USD":
		return "GBPUSD=X"
	case "GBPTRY", "GBP/TRY":
		return "GBPTRY=X"
	case "USDJPY", "USD/JPY":
		return "USDJPY=X"
	case "XAUUSD", "GOLD":
		return "GC=F"
	case "XAGUSD", "SILVER":
		return "SI=F"
	case "BRENT":
		return "BZ=F"
	case "DXY":
		return "DX-Y.NYB"
	case "BIST100", "XU100":
		return "XU100.IS"
	}
	return sym
}

// ExprNodeKind identifies an AST node in a symbol arithmetic expression.
type ExprNodeKind int

const (
	ExprNumber ExprNodeKind = iota
	ExprSymbol
	ExprUnary
	ExprBinary
)

// ExprNode is one node in a parsed symbol arithmetic expression AST.
type ExprNode struct {
	Kind   ExprNodeKind
	Op     byte // '+', '-', '*', '/'
	Number float64
	Symbol string
	Left   *ExprNode
	Right  *ExprNode
}

// SymbolExpr holds a parsed arithmetic expression over one or more market symbols.
type SymbolExpr struct {
	Raw       string
	Root      *ExprNode
	legs      []string
	IsComplex bool
}

// Symbols returns the ordered unique list of constituent symbols in the expression.
func (e *SymbolExpr) Symbols() []string {
	if e == nil {
		return nil
	}
	out := make([]string, len(e.legs))
	copy(out, e.legs)
	return out
}

// Eval evaluates the expression with the given symbol price map.
// Returns (value, true) if finite and valid; (0, false) on missing symbol, division by zero, or NaN/Inf.
func (e *SymbolExpr) Eval(vars map[string]float64) (float64, bool) {
	if e == nil || e.Root == nil {
		return 0, false
	}
	v, ok := evalNode(e.Root, vars)
	if !ok || math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false
	}
	return v, true
}

func evalNode(n *ExprNode, vars map[string]float64) (float64, bool) {
	switch n.Kind {
	case ExprNumber:
		return n.Number, true
	case ExprSymbol:
		v, ok := vars[n.Symbol]
		if !ok || math.IsNaN(v) || math.IsInf(v, 0) {
			return 0, false
		}
		return v, true
	case ExprUnary:
		v, ok := evalNode(n.Left, vars)
		if !ok {
			return 0, false
		}
		if n.Op == '-' {
			return -v, true
		}
		return v, true
	case ExprBinary:
		l, ok := evalNode(n.Left, vars)
		if !ok {
			return 0, false
		}
		r, ok := evalNode(n.Right, vars)
		if !ok {
			return 0, false
		}
		switch n.Op {
		case '+':
			return l + r, true
		case '-':
			return l - r, true
		case '*':
			return l * r, true
		case '/':
			if r == 0 {
				return 0, false
			}
			return l / r, true
		}
	}
	return 0, false
}

// IsSymbolExpression reports whether raw parses as a multi-symbol or arithmetic expression
// rather than a single plain ticker.
func IsSymbolExpression(raw string) bool {
	expr, err := ParseSymbolExpr(raw)
	return err == nil && expr != nil && expr.IsComplex
}

type exprTokKind int

const (
	tokEOF exprTokKind = iota
	tokNumber
	tokSymbol
	tokOp
	tokLParen
	tokRParen
)

type exprToken struct {
	kind exprTokKind
	text string
	num  float64
	op   byte
}

func isHyphenatedSingleSymbol(s string) bool {
	if s == "DX-Y.NYB" {
		return true
	}
	// Share class tickers like BRK-B, BRK-A, BF-B
	idx := strings.IndexByte(s, '-')
	if idx <= 0 || idx != strings.LastIndexByte(s, '-') {
		return false
	}
	left, right := s[:idx], s[idx+1:]
	if len(left) < 1 || len(left) > 5 {
		return false
	}
	for i := 0; i < len(left); i++ {
		if left[i] < 'A' || left[i] > 'Z' {
			return false
		}
	}
	if len(right) == 1 && right[0] >= 'A' && right[0] <= 'Z' {
		return true
	}
	if strings.HasSuffix(right, ".NYB") {
		return true
	}
	return false
}

func tokenizeExpr(raw string) ([]exprToken, error) {
	s := strings.TrimSpace(strings.ToUpper(raw))
	if s == "" {
		return nil, fmt.Errorf("empty symbol expression")
	}
	if isHyphenatedSingleSymbol(s) {
		norm := NormalizeAliasSymbol(s)
		return []exprToken{{kind: tokSymbol, text: norm}, {kind: tokEOF}}, nil
	}

	var toks []exprToken
	i := 0
	for i < len(s) {
		ch := s[i]
		if unicode.IsSpace(rune(ch)) {
			i++
			continue
		}
		if ch == '(' {
			toks = append(toks, exprToken{kind: tokLParen, text: "("})
			i++
			continue
		}
		if ch == ')' {
			toks = append(toks, exprToken{kind: tokRParen, text: ")"})
			i++
			continue
		}
		if ch == '+' || ch == '-' || ch == '*' || ch == '/' {
			toks = append(toks, exprToken{kind: tokOp, text: string(ch), op: ch})
			i++
			continue
		}
		// Match DX-Y.NYB inside compound expressions
		if strings.HasPrefix(s[i:], "DX-Y.NYB") {
			toks = append(toks, exprToken{kind: tokSymbol, text: "DX-Y.NYB"})
			i += len("DX-Y.NYB")
			continue
		}
		// Number or Symbol token
		start := i
		hasLetter := false
		for i < len(s) {
			c := s[i]
			if (c >= 'A' && c <= 'Z') || c == '_' || c == '=' {
				hasLetter = true
				i++
			} else if (c >= '0' && c <= '9') || c == '.' {
				i++
			} else {
				break
			}
		}
		if i == start {
			return nil, fmt.Errorf("invalid character %q in symbol expression", s[i])
		}
		part := s[start:i]
		if !hasLetter {
			val, err := strconv.ParseFloat(part, 64)
			if err != nil || math.IsNaN(val) || math.IsInf(val, 0) {
				return nil, fmt.Errorf("invalid number %q", part)
			}
			toks = append(toks, exprToken{kind: tokNumber, text: part, num: val})
		} else {
			norm := NormalizeAliasSymbol(part)
			toks = append(toks, exprToken{kind: tokSymbol, text: norm})
		}
	}
	toks = append(toks, exprToken{kind: tokEOF})
	return toks, nil
}

// ParseSymbolExpr parses a symbol or arithmetic symbol expression (e.g. "BTCUSDT/ETHUSDT",
// "THYAO.IS*USDTRY", "0.5*BTCUSDT+0.5*ETHUSDT", "(THYAO.IS+GARAN.IS)/2").
func ParseSymbolExpr(raw string) (*SymbolExpr, error) {
	toks, err := tokenizeExpr(raw)
	if err != nil {
		return nil, err
	}
	p := &exprParser{toks: toks}
	root, err := p.parseAddSub()
	if err != nil {
		return nil, err
	}
	if p.peek().kind != tokEOF {
		return nil, fmt.Errorf("unexpected token %q", p.peek().text)
	}
	var legs []string
	seen := map[string]bool{}
	var collect func(n *ExprNode)
	collect = func(n *ExprNode) {
		if n == nil {
			return
		}
		if n.Kind == ExprSymbol && !seen[n.Symbol] {
			seen[n.Symbol] = true
			legs = append(legs, n.Symbol)
		}
		collect(n.Left)
		collect(n.Right)
	}
	collect(root)
	if len(legs) == 0 {
		return nil, fmt.Errorf("expression must reference at least one symbol")
	}
	isComplex := root.Kind != ExprSymbol || len(legs) > 1
	return &SymbolExpr{
		Raw:       strings.TrimSpace(raw),
		Root:      root,
		legs:      legs,
		IsComplex: isComplex,
	}, nil
}

type exprParser struct {
	toks []exprToken
	pos  int
}

func (p *exprParser) peek() exprToken {
	if p.pos >= len(p.toks) {
		return exprToken{kind: tokEOF}
	}
	return p.toks[p.pos]
}

func (p *exprParser) next() exprToken {
	t := p.peek()
	if p.pos < len(p.toks) {
		p.pos++
	}
	return t
}

func (p *exprParser) parseAddSub() (*ExprNode, error) {
	left, err := p.parseMulDiv()
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		if t.kind == tokOp && (t.op == '+' || t.op == '-') {
			p.next()
			right, err := p.parseMulDiv()
			if err != nil {
				return nil, err
			}
			left = &ExprNode{Kind: ExprBinary, Op: t.op, Left: left, Right: right}
		} else {
			break
		}
	}
	return left, nil
}

func (p *exprParser) parseMulDiv() (*ExprNode, error) {
	left, err := p.parseUnary()
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		if t.kind == tokOp && (t.op == '*' || t.op == '/') {
			p.next()
			right, err := p.parseUnary()
			if err != nil {
				return nil, err
			}
			left = &ExprNode{Kind: ExprBinary, Op: t.op, Left: left, Right: right}
		} else {
			break
		}
	}
	return left, nil
}

func (p *exprParser) parseUnary() (*ExprNode, error) {
	t := p.peek()
	if t.kind == tokOp && (t.op == '+' || t.op == '-') {
		p.next()
		sub, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		if t.op == '+' {
			return sub, nil
		}
		return &ExprNode{Kind: ExprUnary, Op: '-', Left: sub}, nil
	}
	return p.parsePrimary()
}

func (p *exprParser) parsePrimary() (*ExprNode, error) {
	t := p.next()
	switch t.kind {
	case tokNumber:
		return &ExprNode{Kind: ExprNumber, Number: t.num}, nil
	case tokSymbol:
		return &ExprNode{Kind: ExprSymbol, Symbol: t.text}, nil
	case tokLParen:
		inner, err := p.parseAddSub()
		if err != nil {
			return nil, err
		}
		if p.peek().kind != tokRParen {
			return nil, fmt.Errorf("missing closing parenthesis ')'")
		}
		p.next()
		return inner, nil
	default:
		return nil, fmt.Errorf("unexpected token %q", t.text)
	}
}

// MergeExpressionCandles aligns constituent symbol candle series by timestamp (with carry-forward
// for secondary legs when combining different market calendars like BIST + 24h FX) and evaluates
// synthetic OHLC bars.
func MergeExpressionCandles(expr *SymbolExpr, series map[string][]Candle, timeframe string) []Candle {
	if expr == nil || len(expr.legs) == 0 {
		return nil
	}
	primarySym := expr.legs[0]
	primary := series[primarySym]
	if len(primary) == 0 {
		return nil
	}

	// Ensure all legs are sorted by timestamp ascending.
	sorted := make(map[string][]Candle, len(expr.legs))
	for _, sym := range expr.legs {
		leg := series[sym]
		if len(leg) == 0 {
			return nil
		}
		cp := make([]Candle, len(leg))
		copy(cp, leg)
		sort.Slice(cp, func(i, j int) bool { return cp[i].Timestamp < cp[j].Timestamp })
		sorted[sym] = cp
	}

	out := make([]Candle, 0, len(primary))
	openVars := make(map[string]float64, len(expr.legs))
	highVars := make(map[string]float64, len(expr.legs))
	lowVars := make(map[string]float64, len(expr.legs))
	closeVars := make(map[string]float64, len(expr.legs))
	// Track cursor per secondary leg for O(N) carry-forward lookup.
	cursors := make(map[string]int, len(expr.legs))

	for _, pBar := range primary {
		ts := pBar.Timestamp
		openVars[primarySym] = pBar.Open
		highVars[primarySym] = pBar.High
		lowVars[primarySym] = pBar.Low
		closeVars[primarySym] = pBar.Close

		allPresent := true
		for _, sym := range expr.legs[1:] {
			leg := sorted[sym]
			idx := cursors[sym]
			for idx+1 < len(leg) && leg[idx+1].Timestamp <= ts {
				idx++
			}
			cursors[sym] = idx
			if leg[idx].Timestamp > ts {
				// Secondary leg hasn't started yet at ts; allow same-UTC-day match for daily+ bars
				if leg[idx].Timestamp/86400 == ts/86400 {
					c := leg[idx]
					openVars[sym], highVars[sym], lowVars[sym], closeVars[sym] = c.Open, c.High, c.Low, c.Close
				} else {
					allPresent = false
					break
				}
			} else if leg[idx].Timestamp == ts || leg[idx].Timestamp/86400 == ts/86400 {
				c := leg[idx]
				openVars[sym], highVars[sym], lowVars[sym], closeVars[sym] = c.Open, c.High, c.Low, c.Close
			} else {
				// Carry-forward previous known close when market schedules differ (e.g. weekend crypto vs weekday FX)
				c := leg[idx]
				openVars[sym], highVars[sym], lowVars[sym], closeVars[sym] = c.Close, c.Close, c.Close, c.Close
			}
		}
		if !allPresent {
			continue
		}

		vOpen, okO := expr.Eval(openVars)
		vClose, okC := expr.Eval(closeVars)
		vHigh, okH := expr.Eval(highVars)
		vLow, okL := expr.Eval(lowVars)
		if !okO || !okC || !okH || !okL {
			continue
		}
		hi := math.Max(math.Max(vOpen, vClose), math.Max(vHigh, vLow))
		lo := math.Min(math.Min(vOpen, vClose), math.Min(vHigh, vLow))

		out = append(out, Candle{
			Symbol:    expr.Raw,
			Timeframe: timeframe,
			Timestamp: ts,
			Open:      vOpen,
			High:      hi,
			Low:       lo,
			Close:     vClose,
			Volume:    pBar.Volume,
		})
	}
	return out
}

// ResolveCurrencyConversion determines the Yahoo FX ticker and direction needed to convert
// fromCur to toCur. Treats USD and USDT as 1:1 equivalent for chart display conversion.
func ResolveCurrencyConversion(fromCur, toCur string) (fxSymbol string, invert bool, needed bool, ok bool) {
	f := strings.ToUpper(strings.TrimSpace(fromCur))
	t := strings.ToUpper(strings.TrimSpace(toCur))
	if f == "USDT" || f == "USDC" || f == "FDUSD" {
		f = "USD"
	}
	if t == "USDT" || t == "USDC" || t == "FDUSD" {
		t = "USD"
	}
	if f == "" || t == "" || t == "NATIVE" || t == "ORIGINAL" || f == t {
		return "", false, false, true
	}
	pair := f + "/" + t
	switch pair {
	case "TRY/USD":
		return "USDTRY=X", true, true, true
	case "USD/TRY":
		return "USDTRY=X", false, true, true
	case "TRY/EUR":
		return "EURTRY=X", true, true, true
	case "EUR/TRY":
		return "EURTRY=X", false, true, true
	case "EUR/USD":
		return "EURUSD=X", false, true, true
	case "USD/EUR":
		return "EURUSD=X", true, true, true
	default:
		return f + t + "=X", false, true, true
	}
}

// ConvertCandlesWithFx multiplies (invert=false) or divides (invert=true) each candle's OHLC
// by the timestamp-aligned FX rate series (with carry-forward/nearest fallback).
func ConvertCandlesWithFx(candles []Candle, fx []Candle, invert bool, targetCurrency string) []Candle {
	if len(candles) == 0 || len(fx) == 0 {
		return candles
	}
	sortedFx := make([]Candle, len(fx))
	copy(sortedFx, fx)
	sort.Slice(sortedFx, func(i, j int) bool { return sortedFx[i].Timestamp < sortedFx[j].Timestamp })

	out := make([]Candle, 0, len(candles))
	cursor := 0
	for _, c := range candles {
		for cursor+1 < len(sortedFx) && sortedFx[cursor+1].Timestamp <= c.Timestamp {
			cursor++
		}
		rateBar := sortedFx[cursor]
		if rateBar.Close <= 0 {
			continue
		}
		var o, h, l, cl float64
		if rateBar.Timestamp == c.Timestamp || rateBar.Timestamp/86400 == c.Timestamp/86400 {
			rO, rH, rL, rC := rateBar.Open, rateBar.High, rateBar.Low, rateBar.Close
			if rO <= 0 {
				rO = rC
			}
			if rH <= 0 {
				rH = rC
			}
			if rL <= 0 {
				rL = rC
			}
			if invert {
				o = c.Open / rO
				cl = c.Close / rC
				v1, v2 := c.High/rH, c.Low/rL
				h = math.Max(math.Max(o, cl), math.Max(v1, v2))
				l = math.Min(math.Min(o, cl), math.Min(v1, v2))
			} else {
				o = c.Open * rO
				cl = c.Close * rC
				v1, v2 := c.High*rH, c.Low*rL
				h = math.Max(math.Max(o, cl), math.Max(v1, v2))
				l = math.Min(math.Min(o, cl), math.Min(v1, v2))
			}
		} else {
			r := rateBar.Close
			if invert {
				o, h, l, cl = c.Open/r, c.High/r, c.Low/r, c.Close/r
			} else {
				o, h, l, cl = c.Open*r, c.High*r, c.Low*r, c.Close*r
			}
		}
		out = append(out, Candle{
			Symbol:    c.Symbol,
			Timeframe: c.Timeframe,
			Timestamp: c.Timestamp,
			Open:      o,
			High:      math.Max(h, math.Max(o, cl)),
			Low:       math.Min(l, math.Min(o, cl)),
			Close:     cl,
			Volume:    c.Volume,
		})
	}
	return out
}

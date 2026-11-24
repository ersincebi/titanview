// Package footprint builds per-bar order-flow footprints (taker buy / sell volume per price row)
// from the Binance public aggregated-trade tape. Closed bars are cached in SQLite; a forming bar is
// stored with the last aggregated-trade id and continued from there on the next request.
package footprint

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"sort"

	"github.com/ersincebi/titanview/backend/internal/provider"
)

// Schema creates the cache table. Safe to run repeatedly.
const Schema = `CREATE TABLE IF NOT EXISTS footprints (
	symbol    TEXT    NOT NULL,
	timeframe TEXT    NOT NULL,
	row_size  REAL    NOT NULL,
	bar_time  INTEGER NOT NULL,
	last_id   INTEGER NOT NULL,
	complete  INTEGER NOT NULL,
	data      TEXT    NOT NULL,
	PRIMARY KEY (symbol, timeframe, row_size, bar_time)
) WITHOUT ROWID;`

// Cell is the taker volume traded inside one price row.
type Cell struct{ B, S float64 }

// Bar accumulates one candle's footprint.
type Bar struct {
	Time     int64
	Rows     map[int64]*Cell
	LastID   int64
	Complete bool
	Trades   int
}

// NewBar returns an empty footprint for the candle opening at t (unix seconds).
func NewBar(t int64) *Bar { return &Bar{Time: t, Rows: map[int64]*Cell{}} }

// RowIndex maps a price to its row (row covers [idx*size, (idx+1)*size)).
func RowIndex(price, size float64) int64 { return int64(math.Floor(price/size + 1e-9)) }

// Add books one trade into its price row.
func (b *Bar) Add(t provider.AggTrade, size float64) {
	k := RowIndex(t.Price, size)
	c := b.Rows[k]
	if c == nil {
		c = &Cell{}
		b.Rows[k] = c
	}
	if t.Sell {
		c.S += t.Qty
	} else {
		c.B += t.Qty
	}
	b.Trades++
	if t.ID > b.LastID {
		b.LastID = t.ID
	}
}

// Out is the JSON shape sent to the browser. Rows are [rowLowPrice, buy, sell], ascending.
type Out struct {
	Time     int64        `json:"time"`
	Rows     [][3]float64 `json:"rows"`
	Delta    float64      `json:"delta"`
	Total    float64      `json:"total"`
	POC      float64      `json:"poc"`
	Trades   int          `json:"trades"`
	Complete bool         `json:"complete"`
}

// Summarise converts the accumulator to its output form.
func (b *Bar) Summarise(size float64) Out {
	keys := make([]int64, 0, len(b.Rows))
	for k := range b.Rows {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	o := Out{Time: b.Time, Rows: make([][3]float64, 0, len(keys)), Trades: b.Trades, Complete: b.Complete}
	best := -1.0
	for _, k := range keys {
		c := b.Rows[k]
		p := round(float64(k) * size)
		o.Rows = append(o.Rows, [3]float64{p, c.B, c.S})
		o.Delta += c.B - c.S
		o.Total += c.B + c.S
		if c.B+c.S > best {
			best = c.B + c.S
			o.POC = p
		}
	}
	return o
}

func round(v float64) float64 { return math.Round(v*1e8) / 1e8 }

type stored struct {
	R [][3]float64 `json:"r"` // [rowIndex, buy, sell]
	N int          `json:"n"`
}

// Store persists footprints.
type Store struct{ DB *sql.DB }

// Load returns the cached bar or nil.
func (s Store) Load(ctx context.Context, sym, tf string, size float64, t int64) (*Bar, error) {
	var lastID int64
	var complete int
	var data string
	err := s.DB.QueryRowContext(ctx, `SELECT last_id, complete, data FROM footprints WHERE symbol=? AND timeframe=? AND row_size=? AND bar_time=?`, sym, tf, size, t).Scan(&lastID, &complete, &data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var st stored
	if err := json.Unmarshal([]byte(data), &st); err != nil {
		return nil, nil // bozuk kayıt: baştan hesaplanır
	}
	b := NewBar(t)
	b.LastID, b.Complete, b.Trades = lastID, complete == 1, st.N
	for _, r := range st.R {
		b.Rows[int64(r[0])] = &Cell{B: r[1], S: r[2]}
	}
	return b, nil
}

// Save upserts the bar.
func (s Store) Save(ctx context.Context, sym, tf string, size float64, b *Bar) error {
	st := stored{N: b.Trades, R: make([][3]float64, 0, len(b.Rows))}
	for k, c := range b.Rows {
		st.R = append(st.R, [3]float64{float64(k), c.B, c.S})
	}
	raw, _ := json.Marshal(st)
	complete := 0
	if b.Complete {
		complete = 1
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO footprints (symbol,timeframe,row_size,bar_time,last_id,complete,data) VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(symbol,timeframe,row_size,bar_time) DO UPDATE SET last_id=excluded.last_id, complete=excluded.complete, data=excluded.data`,
		sym, tf, size, b.Time, b.LastID, complete, string(raw))
	return err
}

// Engine fills footprints within a per-request page budget (Binance weight protection).
type Engine struct {
	Fetch      provider.AggTradeFetcher
	Store      Store
	PageBudget int
}

// Result of one Compute call. Pending bars ran out of budget and should be asked for again.
type Result struct {
	Bars    []Out   `json:"bars"`
	Pending []int64 `json:"pending"`
}

const pageSize = 1000
const hourMs = 3600_000

// Compute returns footprints for the given bar open times (newest are filled first).
func (e *Engine) Compute(ctx context.Context, sym, tf string, stepSec int64, size float64, times []int64, nowMs int64) (Result, error) {
	res := Result{Bars: []Out{}, Pending: []int64{}}
	if size <= 0 || stepSec <= 0 {
		return res, errors.New("row size and interval must be positive")
	}
	ts := append([]int64(nil), times...)
	sort.Slice(ts, func(i, j int) bool { return ts[i] > ts[j] })
	budget := e.PageBudget
	if budget <= 0 {
		budget = 40
	}
	for _, t := range ts {
		b, err := e.Store.Load(ctx, sym, tf, size, t)
		if err != nil {
			return res, err
		}
		if b == nil {
			b = NewBar(t)
		}
		if !b.Complete && budget > 0 {
			used, caughtUp, ferr := e.fill(ctx, sym, b, stepSec, size, nowMs, budget)
			budget -= used
			if used > 0 {
				if err := e.Store.Save(ctx, sym, tf, size, b); err != nil {
					return res, err
				}
			}
			if ferr != nil && used == 0 {
				return res, ferr
			}
			if !b.Complete && !caughtUp {
				res.Pending = append(res.Pending, t)
			}
		} else if !b.Complete {
			res.Pending = append(res.Pending, t)
		}
		if b.Complete || b.Trades > 0 {
			res.Bars = append(res.Bars, b.Summarise(size))
		}
	}
	sort.Slice(res.Bars, func(i, j int) bool { return res.Bars[i].Time < res.Bars[j].Time })
	sort.Slice(res.Pending, func(i, j int) bool { return res.Pending[i] < res.Pending[j] })
	return res, nil
}

// fill pages trades into b. caughtUp=true when the tape has no newer trades yet (forming bar).
func (e *Engine) fill(ctx context.Context, sym string, b *Bar, stepSec int64, size float64, nowMs int64, budget int) (used int, caughtUp bool, err error) {
	start := b.Time * 1000
	end := (b.Time + stepSec) * 1000
	book := func(list []provider.AggTrade) (done bool) {
		for _, t := range list {
			if t.TimeMs >= end {
				b.Complete = true
				return true
			}
			if t.TimeMs >= start {
				b.Add(t, size)
			} else if t.ID > b.LastID {
				b.LastID = t.ID
			}
		}
		return false
	}
	if b.LastID == 0 {
		// ilk işlemi bul: 1 saatlik pencerelerle ilerle (Binance startTime/endTime sınırı)
		ws := start
		for ws < end {
			if used >= budget {
				return used, false, nil
			}
			we := ws + hourMs - 1
			if we > end-1 {
				we = end - 1
			}
			list, ferr := e.Fetch.FetchAggTrades(ctx, sym, 0, ws, we, pageSize)
			used++
			if ferr != nil {
				return used, false, ferr
			}
			if len(list) > 0 {
				if book(list) {
					return used, false, nil
				}
				break // kalan işlemler fromId ile taranır
			}
			ws = we + 1
		}
		if b.LastID == 0 {
			// barda hiç işlem yok
			if end <= nowMs {
				b.Complete = true
			}
			return used, end > nowMs, nil
		}
	}
	for used < budget {
		list, ferr := e.Fetch.FetchAggTrades(ctx, sym, b.LastID+1, 0, 0, pageSize)
		used++
		if ferr != nil {
			return used, false, ferr
		}
		if book(list) {
			return used, false, nil
		}
		if len(list) < pageSize {
			if end <= nowMs-2000 {
				b.Complete = true
				return used, false, nil
			}
			return used, true, nil
		}
	}
	return used, false, nil
}

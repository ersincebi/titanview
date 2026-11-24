package trading

import (
	"math"
	"strings"
	"testing"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

func place(t *testing.T, a *Account, r OrderRequest, last float64) Order {
	t.Helper()
	o, _, err := a.Place(r, last, 1)
	if err != nil {
		t.Fatalf("place %+v: %v", r, err)
	}
	return o
}

func TestMarketOrderOpensAndClosesWithPnl(t *testing.T) {
	a := NewAccount(10000, 0)
	o := place(t, &a, OrderRequest{Symbol: "btcusdt", Side: "buy", Type: "market", Qty: 0.1}, 50000)
	if o.Status != StatusFilled || !near(o.FillPrice, 50000) {
		t.Fatalf("market not filled: %+v", o)
	}
	p := a.Position("BTCUSDT")
	if p == nil || !near(p.Qty, 0.1) || !near(p.AvgPrice, 50000) {
		t.Fatalf("position: %+v", p)
	}
	a.OnPrice("BTCUSDT", 51000, 2)
	if !near(a.Summarize().Unrealized, 100) {
		t.Fatalf("unrealized = %v", a.Summarize().Unrealized)
	}
	if _, err := a.ClosePosition("BTCUSDT", 51000, 3); err != nil {
		t.Fatal(err)
	}
	if a.Position("BTCUSDT") != nil || !near(a.Balance, 10100) {
		t.Fatalf("after close balance=%v positions=%v", a.Balance, a.Positions)
	}
	if len(a.Fills) != 2 || !near(a.Fills[0].Realized, 100) {
		t.Fatalf("fills: %+v", a.Fills)
	}
}

func TestMarketNeedsPrice(t *testing.T) {
	a := NewAccount(0, 0)
	if _, _, err := a.Place(OrderRequest{Symbol: "X", Side: "buy", Type: "market", Qty: 1}, 0, 1); err != ErrNoPrice {
		t.Fatalf("err = %v", err)
	}
}

func TestLimitFillsOnlyWhenCrossed(t *testing.T) {
	a := NewAccount(100000, 0)
	o := place(t, &a, OrderRequest{Symbol: "ETH", Side: "buy", Type: "limit", Qty: 1, LimitPrice: 2000}, 2100)
	if o.Status != StatusWorking {
		t.Fatalf("limit filled too early: %+v", o)
	}
	a.OnPrice("ETH", 2050, 2)
	if len(a.Orders) != 1 {
		t.Fatal("filled above limit")
	}
	a.OnPrice("ETH", 1990, 3)
	if len(a.Orders) != 0 || !near(a.Position("ETH").AvgPrice, 1990) {
		t.Fatalf("limit buy should fill at min(price, limit): %+v", a.Positions)
	}
	// sell limit below market is marketable: fills at market (better) price
	o = place(t, &a, OrderRequest{Symbol: "ETH", Side: "sell", Type: "limit", Qty: 1, LimitPrice: 1900}, 1990)
	if o.Status != StatusFilled || !near(o.FillPrice, 1990) {
		t.Fatalf("marketable sell limit: %+v", o)
	}
}

func TestStopValidationAndTrigger(t *testing.T) {
	a := NewAccount(100000, 0)
	if _, _, err := a.Place(OrderRequest{Symbol: "S", Side: "buy", Type: "stop", Qty: 1, StopPrice: 90}, 100, 1); err == nil {
		t.Fatal("buy stop below market must be rejected")
	}
	if _, _, err := a.Place(OrderRequest{Symbol: "S", Side: "sell", Type: "stop", Qty: 1, StopPrice: 110}, 100, 1); err == nil {
		t.Fatal("sell stop above market must be rejected")
	}
	place(t, &a, OrderRequest{Symbol: "S", Side: "buy", Type: "stop", Qty: 1, StopPrice: 105}, 100)
	a.OnPrice("S", 104, 2)
	if len(a.Orders) != 1 {
		t.Fatal("stop fired early")
	}
	a.OnPrice("S", 106, 3)
	if a.Position("S") == nil || !near(a.Position("S").AvgPrice, 106) {
		t.Fatalf("stop should fill at market: %+v", a.Positions)
	}
}

func TestStopLimitTriggersThenWaitsForLimit(t *testing.T) {
	a := NewAccount(100000, 0)
	place(t, &a, OrderRequest{Symbol: "S", Side: "buy", Type: "stop_limit", Qty: 1, StopPrice: 105, LimitPrice: 104}, 100)
	a.OnPrice("S", 106, 2) // stop hit, but 106 > limit 104
	if len(a.Orders) != 1 || !a.Orders[0].Triggered {
		t.Fatalf("expected triggered working order: %+v", a.Orders)
	}
	a.OnPrice("S", 103.5, 3)
	if len(a.Orders) != 0 || !near(a.Position("S").AvgPrice, 103.5) {
		t.Fatalf("stop-limit fill: %+v %+v", a.Orders, a.Positions)
	}
	// modifying the stop after trigger is refused
	o := place(t, &a, OrderRequest{Symbol: "S", Side: "sell", Type: "stop_limit", Qty: 1, StopPrice: 100, LimitPrice: 99}, 103.5)
	a.OnPrice("S", 99.5, 4) // triggered, 99.5 >= 99 → fills
	if len(a.Orders) != 0 {
		t.Fatalf("sell stop-limit should fill: %+v", a.Orders)
	}
	_ = o
}

func TestBracketOCO(t *testing.T) {
	a := NewAccount(100000, 0)
	if _, _, err := a.Place(OrderRequest{Symbol: "B", Side: "buy", Type: "market", Qty: 2, TakeProfit: 90}, 100, 1); err == nil {
		t.Fatal("TP below entry on a buy must be rejected")
	}
	place(t, &a, OrderRequest{Symbol: "B", Side: "buy", Type: "market", Qty: 2, TakeProfit: 110, StopLoss: 95}, 100)
	if len(a.Orders) != 2 {
		t.Fatalf("expected TP+SL children, got %+v", a.Orders)
	}
	for _, o := range a.Orders {
		if !o.ReduceOnly || o.OcoGroup == "" || o.Side != SideSell || !near(o.Qty, 2) {
			t.Fatalf("bad child %+v", o)
		}
	}
	a.OnPrice("B", 111, 2)
	if a.Position("B") != nil {
		t.Fatal("TP should close the position")
	}
	if len(a.Orders) != 0 {
		t.Fatalf("SL must be cancelled by OCO: %+v", a.Orders)
	}
	if !near(a.Balance, 100000+2*11) {
		t.Fatalf("balance %v", a.Balance)
	}
}

func TestShortStopLossAndReverse(t *testing.T) {
	a := NewAccount(100000, 0)
	place(t, &a, OrderRequest{Symbol: "Z", Side: "sell", Type: "market", Qty: 10, StopLoss: 105}, 100)
	if a.Position("Z").Qty != -10 {
		t.Fatal("short not opened")
	}
	a.OnPrice("Z", 106, 2)
	if a.Position("Z") != nil || !near(a.Balance, 100000-60) {
		t.Fatalf("short SL: balance %v pos %+v", a.Balance, a.Positions)
	}
	place(t, &a, OrderRequest{Symbol: "Z", Side: "buy", Type: "market", Qty: 5}, 100)
	if _, err := a.ReversePosition("Z", 102, 3); err != nil {
		t.Fatal(err)
	}
	p := a.Position("Z")
	if p == nil || !near(p.Qty, -5) || !near(p.AvgPrice, 102) {
		t.Fatalf("reverse: %+v", p)
	}
}

func TestIncreaseAveragesPrice(t *testing.T) {
	a := NewAccount(100000, 0)
	place(t, &a, OrderRequest{Symbol: "A", Side: "buy", Type: "market", Qty: 1}, 100)
	place(t, &a, OrderRequest{Symbol: "A", Side: "buy", Type: "market", Qty: 3}, 120)
	if p := a.Position("A"); !near(p.AvgPrice, 115) || !near(p.Qty, 4) {
		t.Fatalf("avg %+v", p)
	}
	// partial reduce keeps the average and resizes reduce-only orders
	if _, err := a.SetBrackets("A", 150, 90, 2); err != nil {
		t.Fatal(err)
	}
	place(t, &a, OrderRequest{Symbol: "A", Side: "sell", Type: "market", Qty: 1}, 120)
	if p := a.Position("A"); !near(p.AvgPrice, 115) || !near(p.Qty, 3) {
		t.Fatalf("partial reduce %+v", p)
	}
	for _, o := range a.Orders {
		if !near(o.Qty, 3) {
			t.Fatalf("reduce-only not resized: %+v", o)
		}
	}
}

func TestBuyingPowerRejects(t *testing.T) {
	a := NewAccount(1000, 0)
	o := place(t, &a, OrderRequest{Symbol: "A", Side: "buy", Type: "market", Qty: 20}, 100)
	if o.Status != StatusRejected || !strings.Contains(o.Reason, "alım gücü") {
		t.Fatalf("expected rejection: %+v", o)
	}
	if len(a.Positions) != 0 {
		t.Fatal("rejected order must not open a position")
	}
}

func TestQuantityHasNoFloatNoise(t *testing.T) {
	a := NewAccount(100000, 0)
	place(t, &a, OrderRequest{Symbol: "Q", Side: "buy", Type: "market", Qty: 0.01}, 100)
	place(t, &a, OrderRequest{Symbol: "Q", Side: "sell", Type: "market", Qty: 0.001}, 100)
	if q := a.Position("Q").Qty; q != 0.009 {
		t.Fatalf("qty = %v", q)
	}
}

func TestCommission(t *testing.T) {
	a := NewAccount(10000, 0.1)
	place(t, &a, OrderRequest{Symbol: "C", Side: "buy", Type: "market", Qty: 10}, 100)
	if !near(a.Balance, 10000-1) {
		t.Fatalf("commission: %v", a.Balance)
	}
}

func TestSetBracketsMoveAndRemove(t *testing.T) {
	a := NewAccount(100000, 0)
	place(t, &a, OrderRequest{Symbol: "P", Side: "buy", Type: "market", Qty: 1}, 100)
	if _, err := a.SetBrackets("P", 99, 0, 2); err == nil {
		t.Fatal("TP below price on long must fail")
	}
	if _, err := a.SetBrackets("P", 120, 90, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SetBrackets("P", 125, 0, 3); err != nil {
		t.Fatal(err)
	}
	var tp, sl *Order
	for i := range a.Orders {
		switch a.Orders[i].Role {
		case RoleTP:
			tp = &a.Orders[i]
		case RoleSL:
			sl = &a.Orders[i]
		}
	}
	if tp == nil || sl == nil || !near(tp.LimitPrice, 125) || !near(sl.StopPrice, 90) || tp.OcoGroup != sl.OcoGroup {
		t.Fatalf("brackets: %+v", a.Orders)
	}
	if _, err := a.SetBrackets("P", -1, -1, 4); err != nil {
		t.Fatal(err)
	}
	if len(a.Orders) != 0 {
		t.Fatalf("remove: %+v", a.Orders)
	}
}

func TestModifyAndCancel(t *testing.T) {
	a := NewAccount(100000, 0)
	o := place(t, &a, OrderRequest{Symbol: "M", Side: "buy", Type: "limit", Qty: 1, LimitPrice: 90, TakeProfit: 105}, 100)
	if _, _, err := a.ModifyOrder(o.ID, OrderPatch{StopPrice: 95}, 100, 2); err == nil {
		t.Fatal("limit order has no stop")
	}
	if _, _, err := a.ModifyOrder(o.ID, OrderPatch{LimitPrice: 106}, 100, 2); err == nil {
		t.Fatal("moving entry above TP must fail bracket validation")
	}
	m, _, err := a.ModifyOrder(o.ID, OrderPatch{LimitPrice: 99.5}, 100, 2)
	if err != nil || m.Status != StatusWorking || !near(m.LimitPrice, 99.5) {
		t.Fatalf("modify: %+v %v", m, err)
	}
	// dragging the limit to the market fills it immediately
	m, _, err = a.ModifyOrder(o.ID, OrderPatch{LimitPrice: 100}, 100, 3)
	if err != nil || len(a.Orders) != 1 || a.Orders[0].Role != RoleTP {
		t.Fatalf("drag-to-market: %+v %v %+v", m, err, a.Orders)
	}
	if _, err := a.Cancel("nope", 4); err != ErrNotFound {
		t.Fatal("unknown id")
	}
	if _, err := a.Cancel(a.Orders[0].ID, 4); err != nil || len(a.Orders) != 0 {
		t.Fatal("cancel")
	}
	if a.Closed[0].Status != StatusCancelled {
		t.Fatalf("closed list: %+v", a.Closed[0])
	}
}

func TestReduceOnlyValidation(t *testing.T) {
	a := NewAccount(100000, 0)
	if _, _, err := a.Place(OrderRequest{Symbol: "R", Side: "sell", Type: "market", Qty: 1, ReduceOnly: true}, 100, 1); err == nil {
		t.Fatal("reduce-only without a position must fail")
	}
}

func TestInvalidRequests(t *testing.T) {
	a := NewAccount(100000, 0)
	bad := []OrderRequest{
		{Symbol: "", Side: "buy", Type: "market", Qty: 1},
		{Symbol: "X", Side: "hold", Type: "market", Qty: 1},
		{Symbol: "X", Side: "buy", Type: "iceberg", Qty: 1},
		{Symbol: "X", Side: "buy", Type: "market", Qty: 0},
		{Symbol: "X", Side: "buy", Type: "limit", Qty: 1},
		{Symbol: "X", Side: "buy", Type: "stop", Qty: 1},
		{Symbol: "X", Side: "buy", Type: "market", Qty: math.NaN()},
	}
	for _, r := range bad {
		if _, _, err := a.Place(r, 100, 1); err == nil {
			t.Errorf("expected error for %+v", r)
		}
	}
	if got := a.Symbols(); len(got) != 0 {
		t.Fatalf("symbols %v", got)
	}
}

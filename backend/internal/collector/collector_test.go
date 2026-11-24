package collector

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeSrc struct{ syms []string }

func (f fakeSrc) ListCollectSymbols(context.Context) ([]string, error) { return f.syms, nil }

type fakeFetcher struct {
	mu    sync.Mutex
	calls []string
	fail  map[string]bool
}

func (f *fakeFetcher) Collect(_ context.Context, s, tf string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, s+"|"+tf)
	if f.fail[s] {
		return 0, errors.New("upstream")
	}
	return 1, nil
}

func TestRunOnceCoversEverySymbolTimeframeAndSurvivesFailures(t *testing.T) {
	f := &fakeFetcher{fail: map[string]bool{"BAD": true}}
	ok, failed := RunOnce(context.Background(), fakeSrc{[]string{"THYAO.IS", "BAD", "BTCUSDT"}}, f)
	if ok != 4 || failed != 2 {
		t.Fatalf("ok=%d failed=%d", ok, failed)
	}
	if len(f.calls) != 6 || f.calls[0] != "THYAO.IS|15m" || f.calls[1] != "THYAO.IS|1h" || f.calls[5] != "BTCUSDT|1h" {
		t.Fatalf("calls: %v", f.calls)
	}
}

func TestRunStopsOnCancelAndTicks(t *testing.T) {
	f := &fakeFetcher{}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { Run(ctx, fakeSrc{[]string{"A"}}, f, 20*time.Millisecond); close(done) }()
	time.Sleep(110 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Run did not stop")
	}
	f.mu.Lock()
	n := len(f.calls)
	f.mu.Unlock()
	if n < 6 { // immediate run + several ticks, 2 timeframes each
		t.Errorf("expected repeated collection, got %d calls", n)
	}
	Run(context.Background(), fakeSrc{}, f, 0) // interval 0 = disabled, returns at once
}

func TestRunOnceCancelledMidway(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f := &fakeFetcher{}
	ok, failed := RunOnce(ctx, fakeSrc{[]string{"A", "B"}}, f)
	if ok+failed != 0 || len(f.calls) != 0 {
		t.Errorf("cancelled context must not fetch: %v", f.calls)
	}
}

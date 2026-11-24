package provider

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestParseYahooEvents(t *testing.T) {
	raw := []byte(`{
		"chart": {
			"result": [{
				"events": {
					"dividends": {
						"1700000000": {"amount": 0.25, "date": 1700000000},
						"1690000000": {"amount": 0.24, "date": 1690000000}
					},
					"splits": {
						"1598880000": {"date": 1598880000, "numerator": 4, "denominator": 1, "splitRatio": "4:1"}
					},
					"earnings": {
						"1705000000": {"raw": 1705000000, "epsActual": 2.18, "epsEstimate": 2.10},
						"1695000000": {"raw": 1695000000}
					}
				}
			}]
		}
	}`)
	ev, err := ParseYahooEvents("AAPL", raw)
	if err != nil {
		t.Fatalf("ParseYahooEvents failed: %v", err)
	}
	if !ev.Supported || ev.Symbol != "AAPL" {
		t.Fatalf("unexpected header: %+v", ev)
	}
	if len(ev.Dividends) != 2 || ev.Dividends[0].Time != 1690000000 || ev.Dividends[0].Amount != 0.24 || ev.Dividends[1].Amount != 0.25 {
		t.Fatalf("unexpected dividends: %+v", ev.Dividends)
	}
	if len(ev.Splits) != 1 || ev.Splits[0].Numerator != 4 || ev.Splits[0].Denominator != 1 || ev.Splits[0].Ratio != "4:1" {
		t.Fatalf("unexpected splits: %+v", ev.Splits)
	}
	if len(ev.Earnings) != 2 || ev.Earnings[0].Actual != nil || ev.Earnings[1].Actual == nil || *ev.Earnings[1].Actual != 2.18 {
		t.Fatalf("unexpected earnings: %+v", ev.Earnings)
	}
}

func TestYahooFetchCorporateEvents(t *testing.T) {
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.URL.Query().Get("events") != "div|split|earn" {
				t.Errorf("expected events=div|split|earn, got %q", r.URL.Query().Get("events"))
			}
			body := `{"chart":{"result":[{"events":{"dividends":{"1700000000":{"amount":1.5,"date":1700000000}}}}]}}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(body)),
			}, nil
		}),
	}
	yp := NewYahooProvider(client)
	yp.BaseURLs = []string{"https://yahoo.test"}

	ev, err := yp.FetchCorporateEvents(context.Background(), "THYAO.IS", 1600000000, 1750000000)
	if err != nil {
		t.Fatalf("FetchCorporateEvents error: %v", err)
	}
	if len(ev.Dividends) != 1 || ev.Dividends[0].Amount != 1.5 {
		t.Fatalf("unexpected dividends: %+v", ev.Dividends)
	}
}

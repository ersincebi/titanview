package alerts

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNtfyDelivery(t *testing.T) {
	var gotPath, gotTitle, gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotTitle, gotAuth = r.URL.Path, r.Header.Get("Title"), r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = io.WriteString(w, `{"id":"x"}`)
	}))
	defer srv.Close()
	st := testStore(t)
	n := NewNotifier(st)
	ctx := context.Background()
	if err := n.SetNtfy(ctx, NtfyConfig{Enabled: true, Server: srv.URL + "/", Topic: "titan-abc123", Token: " tk_1 "}); err != nil {
		t.Fatal(err)
	}
	// empty token keeps the stored one
	if err := n.SetNtfy(ctx, NtfyConfig{Enabled: true, Server: srv.URL, Topic: "titan-abc123"}); err != nil {
		t.Fatal(err)
	}
	ds := n.Deliver(ctx, LogEntry{Name: "RSI 70", Symbol: "BTCUSDT", Interval: "1h", Message: "RSI 71\nüst", Notify: Notify{Ntfy: true}})
	if len(ds) != 1 || !ds[0].OK || ds[0].Channel != "ntfy" {
		t.Fatalf("deliveries %+v", ds)
	}
	if gotPath != "/titan-abc123" || gotAuth != "Bearer tk_1" || gotBody != "RSI 71\nüst" || !strings.Contains(gotTitle, "BTCUSDT 1h") || strings.ContainsAny(gotTitle, "\r\n") {
		t.Fatalf("path=%q auth=%q body=%q title=%q", gotPath, gotAuth, gotBody, gotTitle)
	}
}

func TestNtfyValidation(t *testing.T) {
	n := NewNotifier(testStore(t))
	ctx := context.Background()
	for _, c := range []NtfyConfig{
		{Enabled: true, Topic: "abc"},
		{Enabled: true, Topic: "has space here"},
		{Enabled: true, Server: "ftp://x", Topic: "titan-abc123"},
	} {
		if err := n.SetNtfy(ctx, c); err == nil {
			t.Errorf("accepted %+v", c)
		}
	}
	if err := n.SetNtfy(ctx, NtfyConfig{Enabled: false, Topic: "x"}); err != nil {
		t.Fatal("disabled config should save:", err)
	}
	if d := n.Deliver(ctx, LogEntry{Notify: Notify{Ntfy: true}}); d[0].OK {
		t.Fatal("disabled ntfy delivered")
	}
}

package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

const sampleRSS = `<?xml version="1.0"?><rss><channel>
<item><title>BofA THYAO alımı - Paratic Haber</title><link>https://news.google.com/rss/articles/a</link><pubDate>Tue, 10 Nov 2026 20:03:49 GMT</pubDate><source url="https://p">Paratic Haber</source></item>
<item><title>No link item</title><link>javascript:x</link></item>
<item><title>Başlık - Tire - Kaynak</title><link>https://news.google.com/rss/articles/b</link><pubDate>garbage</pubDate></item>
<item><title></title><link>https://x</link></item>
</channel></rss>`

func TestParseGoogleNewsRSS(t *testing.T) {
	items, err := parseGoogleNewsRSS([]byte(sampleRSS), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("want 2 valid items (bad link/empty title dropped), got %+v", items)
	}
	if items[0].Title != "BofA THYAO alımı" || items[0].Publisher != "Paratic Haber" || items[0].Time != 1794341029 {
		t.Errorf("item0: %+v", items[0])
	}
	if items[1].Title != "Başlık - Tire" || items[1].Publisher != "Kaynak" || items[1].Time != 0 {
		t.Errorf("item1 (publisher from title suffix, bad date -> 0): %+v", items[1])
	}
	if one, _ := parseGoogleNewsRSS([]byte(sampleRSS), 1); len(one) != 1 {
		t.Errorf("limit ignored: %d", len(one))
	}
	if _, err := parseGoogleNewsRSS([]byte("<not xml"), 5); err == nil {
		t.Error("malformed xml must error")
	}
}

func TestGoogleNewsQuery(t *testing.T) {
	q, hl, gl, ceid := GoogleNewsQuery("thyao.is")
	if q != "THYAO hisse" || hl != "tr" || gl != "TR" || ceid != "TR:tr" {
		t.Errorf("bist: %q %q %q %q", q, hl, gl, ceid)
	}
	if q, _, gl, _ := GoogleNewsQuery("BTCUSDT"); q != "BTC crypto" || gl != "US" {
		t.Errorf("crypto: %q", q)
	}
	if q, _, _, _ := GoogleNewsQuery("AAPL"); q != "AAPL stock" {
		t.Errorf("us: %q", q)
	}
}

func TestGoogleNewsFetch(t *testing.T) {
	var gotQ, gotCeid string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rss/search" {
			http.NotFound(w, r)
			return
		}
		gotQ, gotCeid = r.URL.Query().Get("q"), r.URL.Query().Get("ceid")
		_, _ = w.Write([]byte(sampleRSS))
	}))
	defer srv.Close()
	g := NewGoogleNewsProvider(nil)
	g.BaseURL = srv.URL
	items, err := g.FetchNews(context.Background(), "THYAO.IS", 5)
	if err != nil || len(items) != 2 {
		t.Fatalf("items=%v err=%v", items, err)
	}
	if gotQ != "THYAO hisse" || gotCeid != "TR:tr" {
		t.Errorf("query sent: %q %q", gotQ, gotCeid)
	}
	if it, err := g.FetchNews(context.Background(), "  ", 5); it != nil || err != nil {
		t.Errorf("blank symbol: %v %v", it, err)
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer bad.Close()
	g.BaseURL = bad.URL
	if _, err := g.FetchNews(context.Background(), "AAPL", 5); err == nil {
		t.Error("non-200 must error")
	}
}

func TestParseYahooNewsAndQueries(t *testing.T) {
	items, err := parseYahooNews([]byte(`{"news":[{"title":"A","publisher":"P","link":"https://a","providerPublishTime":7},{"title":"","link":"https://b"},{"title":"C","link":"ftp://c"}]}`), 5)
	if err != nil || len(items) != 1 || items[0].Time != 7 {
		t.Fatalf("%v %v", items, err)
	}
	if qs := NewsQueries("THYAO.IS"); len(qs) != 2 || qs[0] != "THYAO.IS" || qs[1] != "THYAO" {
		t.Errorf("%v", qs)
	}
	if qs := NewsQueries("AAPL"); len(qs) != 1 {
		t.Errorf("%v", qs)
	}
}

package mobile

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestStartStop(t *testing.T) {
	if _, err := Start(" "); err == nil {
		t.Fatal("empty dir accepted")
	}
	dir := t.TempDir()
	raw, err := Start(dir)
	if err != nil {
		t.Fatal(err)
	}
	var c Config
	if err := json.Unmarshal([]byte(raw), &c); err != nil || c.Base == "" || len(c.Token) != 64 {
		t.Fatalf("config %s %v", raw, err)
	}
	if again, _ := Start(dir); again != raw || !Running() {
		t.Fatal("second Start changed config")
	}
	get := func(tok string) int {
		req, _ := http.NewRequest("GET", c.Base+"/api/alerts/config", nil)
		if tok != "" {
			req.Header.Set("X-Titan-Token", tok)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if get("") != 401 || get(c.Token) != 200 {
		t.Fatal("token not enforced")
	}
	Stop()
	Stop()
	if Running() {
		t.Fatal("still running")
	}
	raw2, err := Start(dir)
	if err != nil || raw2 == raw {
		t.Fatalf("restart: %v (same token %v)", err, raw2 == raw)
	}
	Stop()
}

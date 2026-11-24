// Package access verifies Cloudflare Access JWTs (defence in depth behind the tunnel).
//
// Cloudflare Access puts a signed JWT in the Cf-Access-Jwt-Assertion header (and the CF_Authorization
// cookie) of every request it lets through. When the server is configured with the team name and the
// application AUD tag it rejects anything without a valid token, so a request that reaches the origin
// some other way (misconfigured tunnel, LAN access) is still refused. Fail closed: no token, bad
// signature, wrong issuer/audience, expired, or an unreachable key set all mean 401.
package access

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// HeaderJWT is the header Cloudflare Access sets on authenticated requests.
	HeaderJWT = "Cf-Access-Jwt-Assertion"
	// CookieJWT is the cookie that carries the same token (browsers, WebSocket upgrades).
	CookieJWT = "CF_Authorization"

	keyTTL        = time.Hour
	minRefetch    = 30 * time.Second // unknown-kid refetches are rate limited
	clockLeeway   = 60 * time.Second
	maxTokenBytes = 16 << 10
)

// Config is the Access application this server belongs to.
type Config struct {
	Team   string   // team name: <team>.cloudflareaccess.com
	AUD    string   // application AUD tag (Zero Trust → Access → Applications → your app)
	Emails []string // optional extra allow-list (lower-case); empty = any identity the policy admits
	// CertsURL overrides the JWKS location (tests). Empty = https://<team>.cloudflareaccess.com/cdn-cgi/access/certs.
	CertsURL string
	Client   *http.Client
	Now      func() time.Time
}

// Enabled reports whether both team and AUD are set.
func (c Config) Enabled() bool { return c.Team != "" && c.AUD != "" }

// Validate rejects half-configured setups (one of the two set): silently running open would be a trap.
func (c Config) Validate() error {
	if (c.Team == "") != (c.AUD == "") {
		return errors.New("CF_ACCESS_TEAM and CF_ACCESS_AUD must be set together")
	}
	return nil
}

func (c Config) issuer() string { return "https://" + c.Team + ".cloudflareaccess.com" }

// Verifier checks tokens and caches the signing keys.
type Verifier struct {
	cfg Config

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

// New builds a Verifier. cfg must be Enabled.
func New(cfg Config) *Verifier {
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 8 * time.Second}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.CertsURL == "" {
		cfg.CertsURL = cfg.issuer() + "/cdn-cgi/access/certs"
	}
	return &Verifier{cfg: cfg}
}

// Claims are the verified identity claims.
type Claims struct {
	Email string
	Sub   string
	Exp   int64
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid"`
}

type audClaim []string

func (a *audClaim) UnmarshalJSON(b []byte) error {
	var one string
	if err := json.Unmarshal(b, &one); err == nil {
		*a = []string{one}
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return err
	}
	*a = many
	return nil
}

type jwtClaims struct {
	Iss   string   `json:"iss"`
	Aud   audClaim `json:"aud"`
	Exp   int64    `json:"exp"`
	Nbf   int64    `json:"nbf"`
	Email string   `json:"email"`
	Sub   string   `json:"sub"`
}

func decodeSegment(s string, v interface{}) error {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

// Verify checks signature, issuer, audience, expiry and the optional e-mail allow-list.
func (v *Verifier) Verify(token string) (*Claims, error) {
	if token == "" || len(token) > maxTokenBytes {
		return nil, errors.New("missing token")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("malformed token")
	}
	var h jwtHeader
	if err := decodeSegment(parts[0], &h); err != nil {
		return nil, errors.New("bad header")
	}
	if h.Alg != "RS256" { // refuse "none" and HMAC confusion outright
		return nil, fmt.Errorf("unsupported alg %q", h.Alg)
	}
	key, err := v.key(h.Kid)
	if err != nil {
		return nil, err
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, errors.New("bad signature encoding")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig); err != nil {
		return nil, errors.New("signature mismatch")
	}
	var c jwtClaims
	if err := decodeSegment(parts[1], &c); err != nil {
		return nil, errors.New("bad claims")
	}
	now := v.cfg.Now()
	if c.Iss != v.cfg.issuer() {
		return nil, errors.New("wrong issuer")
	}
	okAud := false
	for _, a := range c.Aud {
		if a == v.cfg.AUD {
			okAud = true
		}
	}
	if !okAud {
		return nil, errors.New("wrong audience")
	}
	if c.Exp == 0 || now.After(time.Unix(c.Exp, 0).Add(clockLeeway)) {
		return nil, errors.New("token expired")
	}
	if c.Nbf != 0 && now.Add(clockLeeway).Before(time.Unix(c.Nbf, 0)) {
		return nil, errors.New("token not yet valid")
	}
	if len(v.cfg.Emails) > 0 {
		allowed := false
		for _, e := range v.cfg.Emails {
			if strings.EqualFold(e, c.Email) {
				allowed = true
			}
		}
		if !allowed {
			return nil, errors.New("identity not allowed")
		}
	}
	return &Claims{Email: c.Email, Sub: c.Sub, Exp: c.Exp}, nil
}

func (v *Verifier) key(kid string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := v.cfg.Now()
	fresh := v.keys != nil && now.Sub(v.fetchedAt) < keyTTL
	if k, ok := v.keys[kid]; ok && fresh {
		return k, nil
	}
	// stale cache, or an unknown kid (key rotation): refetch, but not more often than minRefetch
	if v.keys != nil && now.Sub(v.fetchedAt) < minRefetch {
		return nil, errors.New("unknown signing key")
	}
	keys, err := v.fetchKeys()
	if err != nil {
		return nil, fmt.Errorf("fetch signing keys: %w", err)
	}
	v.keys, v.fetchedAt = keys, now
	k, ok := keys[kid]
	if !ok {
		return nil, errors.New("unknown signing key")
	}
	return k, nil
}

func (v *Verifier) fetchKeys() (map[string]*rsa.PublicKey, error) {
	resp, err := v.cfg.Client.Get(v.cfg.CertsURL)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("certs status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var set struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, err
	}
	out := map[string]*rsa.PublicKey{}
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		nb, err1 := base64.RawURLEncoding.DecodeString(k.N)
		eb, err2 := base64.RawURLEncoding.DecodeString(k.E)
		if err1 != nil || err2 != nil || len(nb) == 0 || len(eb) == 0 {
			continue
		}
		e := new(big.Int).SetBytes(eb)
		if !e.IsInt64() || e.Int64() < 3 {
			continue
		}
		out[k.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: int(e.Int64())}
	}
	if len(out) == 0 {
		return nil, errors.New("no usable keys")
	}
	return out, nil
}

// TokenFrom reads the Access token from the header, then the cookie.
func TokenFrom(r *http.Request) string {
	if t := r.Header.Get(HeaderJWT); t != "" {
		return t
	}
	if c, err := r.Cookie(CookieJWT); err == nil {
		return c.Value
	}
	return ""
}

// ExemptPaths answer without a token (liveness probes must work for the container healthcheck).
var ExemptPaths = map[string]bool{"/healthz": true}

// Middleware enforces a valid token on every request except ExemptPaths. With a nil Verifier it is a
// pass-through (local development).
func Middleware(v *Verifier, next http.Handler) http.Handler {
	if v == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ExemptPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}
		claims, err := v.Verify(TokenFrom(r))
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"unauthorized: valid Cloudflare Access token required"}`))
			return
		}
		r.Header.Set("X-Access-User", claims.Email)
		next.ServeHTTP(w, r)
	})
}

// ParseEmails splits a comma-separated allow-list.
func ParseEmails(s string) []string {
	var out []string
	for _, e := range strings.Split(s, ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			out = append(out, e)
		}
	}
	return out
}

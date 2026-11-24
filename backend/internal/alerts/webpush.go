package alerts

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"time"
)

// VAPID is the application server key pair (RFC 8292). The private scalar is stored base64url in alert_kv.
type VAPID struct {
	Key     *ecdsa.PrivateKey
	Subject string
}

var b64 = base64.RawURLEncoding

// decodeB64 accepts both padded/unpadded and std/url alphabets (browsers differ).
func decodeB64(s string) ([]byte, error) {
	for _, enc := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.StdEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			return b, nil
		}
	}
	return nil, errors.New("invalid base64")
}

// GenerateVAPID creates a new P-256 key pair.
func GenerateVAPID(subject string) (*VAPID, error) {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	return &VAPID{Key: k, Subject: subject}, nil
}

// PrivateB64 serialises the private scalar (32 bytes, base64url).
func (v *VAPID) PrivateB64() string {
	return b64.EncodeToString(v.Key.D.FillBytes(make([]byte, 32)))
}

// ParseVAPID restores a key pair from PrivateB64.
func ParseVAPID(priv, subject string) (*VAPID, error) {
	d, err := decodeB64(priv)
	if err != nil || len(d) != 32 {
		return nil, errors.New("invalid VAPID private key")
	}
	ek, err := ecdh.P256().NewPrivateKey(d)
	if err != nil {
		return nil, err
	}
	pub := ek.PublicKey().Bytes() // 0x04 || X || Y
	k := &ecdsa.PrivateKey{
		PublicKey: ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(pub[1:33]), Y: new(big.Int).SetBytes(pub[33:])},
		D:         new(big.Int).SetBytes(d),
	}
	return &VAPID{Key: k, Subject: subject}, nil
}

// PublicKey is the uncompressed point the browser passes as applicationServerKey.
func (v *VAPID) PublicKey() []byte {
	ek, err := v.Key.ECDH()
	if err != nil {
		return nil
	}
	return ek.PublicKey().Bytes()
}

// PublicB64 is PublicKey in base64url.
func (v *VAPID) PublicB64() string { return b64.EncodeToString(v.PublicKey()) }

// JWT signs the VAPID token for an endpoint origin (ES256, raw r||s signature).
func (v *VAPID) JWT(audience string, exp time.Time) (string, error) {
	h := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, _ := json.Marshal(map[string]any{"aud": audience, "exp": exp.Unix(), "sub": v.Subject})
	unsigned := h + "." + b64.EncodeToString(claims)
	sum := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, v.Key, sum[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return unsigned + "." + b64.EncodeToString(sig), nil
}

// EncryptPayload implements RFC 8291 (aes128gcm) for one record.
// uaPublic is the subscription p256dh (65 bytes), authSecret the 16-byte auth.
// salt and asKey are injectable for tests (nil = random).
func EncryptPayload(plaintext, uaPublic, authSecret, salt []byte, asKey *ecdh.PrivateKey) ([]byte, error) {
	curve := ecdh.P256()
	ua, err := curve.NewPublicKey(uaPublic)
	if err != nil {
		return nil, fmt.Errorf("p256dh: %w", err)
	}
	if len(authSecret) != 16 {
		return nil, errors.New("auth secret must be 16 bytes")
	}
	if asKey == nil {
		if asKey, err = curve.GenerateKey(rand.Reader); err != nil {
			return nil, err
		}
	}
	if salt == nil {
		salt = make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			return nil, err
		}
	}
	shared, err := asKey.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPublic := asKey.PublicKey().Bytes()
	keyInfo := append(append([]byte("WebPush: info\x00"), uaPublic...), asPublic...)
	prkKey, err := hkdf.Extract(sha256.New, shared, authSecret)
	if err != nil {
		return nil, err
	}
	ikm, err := hkdf.Expand(sha256.New, prkKey, string(keyInfo), 32)
	if err != nil {
		return nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	record := append(append([]byte{}, plaintext...), 0x02) // last-record delimiter, no padding
	const rs = 4096
	if len(record)+16 > rs {
		return nil, errors.New("push payload too large")
	}
	var hdr bytes.Buffer
	hdr.Write(salt)
	_ = binary.Write(&hdr, binary.BigEndian, uint32(rs))
	hdr.WriteByte(byte(len(asPublic)))
	hdr.Write(asPublic)
	return gcm.Seal(hdr.Bytes(), nonce, record, nil), nil
}

// ErrGone means the push service no longer knows the subscription (404/410): delete it.
var ErrGone = errors.New("push subscription gone")

// SendPush delivers one encrypted message to a subscription.
func SendPush(ctx context.Context, hc *http.Client, v *VAPID, sub PushSubscription, payload []byte) error {
	p256dh, err := decodeB64(sub.Keys.P256dh)
	if err != nil {
		return fmt.Errorf("p256dh: %w", err)
	}
	auth, err := decodeB64(sub.Keys.Auth)
	if err != nil {
		return fmt.Errorf("auth: %w", err)
	}
	body, err := EncryptPayload(payload, p256dh, auth, nil, nil)
	if err != nil {
		return err
	}
	u, err := url.Parse(sub.Endpoint)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return errors.New("invalid push endpoint")
	}
	jwt, err := v.JWT(u.Scheme+"://"+u.Host, time.Now().Add(12*time.Hour))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("TTL", "86400")
	req.Header.Set("Urgency", "high")
	req.Header.Set("Authorization", "vapid t="+jwt+", k="+v.PublicB64())
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrGone
	case resp.StatusCode >= 300:
		return fmt.Errorf("push service %d: %s", resp.StatusCode, bytes.TrimSpace(msg))
	}
	return nil
}

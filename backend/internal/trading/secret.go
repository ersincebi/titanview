package trading

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Sealer encrypts small secrets (broker API keys) with AES-256-GCM.
type Sealer struct {
	aead cipher.AEAD
}

// NewSealer derives the key from master (any string; SHA-256 stretched).
func NewSealer(master []byte) (*Sealer, error) {
	if len(master) < 16 {
		return nil, errors.New("ana anahtar en az 16 bayt olmalı")
	}
	k := sha256.Sum256(master)
	block, err := aes.NewCipher(k[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Sealer{aead: aead}, nil
}

// LoadOrCreateMaster returns $TITAN_SECRET_KEY, else the contents of dir/.titan_secret
// (created with 32 random bytes and mode 0600 on first use).
func LoadOrCreateMaster(dir string) ([]byte, error) {
	if v := strings.TrimSpace(os.Getenv("TITAN_SECRET_KEY")); v != "" {
		return []byte(v), nil
	}
	if dir == "" {
		dir = "."
	}
	path := filepath.Join(dir, ".titan_secret")
	if b, err := os.ReadFile(path); err == nil {
		raw, derr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b)))
		if derr != nil || len(raw) < 16 {
			return nil, fmt.Errorf("%s bozuk", path)
		}
		return raw, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) { // lost a race with another process: read theirs
			return LoadOrCreateMaster(dir)
		}
		return nil, err
	}
	defer f.Close()
	if _, err := f.WriteString(base64.StdEncoding.EncodeToString(raw) + "\n"); err != nil {
		return nil, err
	}
	return raw, nil
}

// Seal encrypts plain; the result is base64(nonce|ciphertext).
func (s *Sealer) Seal(plain []byte) (string, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := s.aead.Seal(nonce, nonce, plain, []byte("titanview-broker-v1"))
	return base64.StdEncoding.EncodeToString(out), nil
}

// Open decrypts a Seal result.
func (s *Sealer) Open(sealed string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return nil, err
	}
	n := s.aead.NonceSize()
	if len(raw) < n {
		return nil, errors.New("şifreli veri kısa")
	}
	return s.aead.Open(nil, raw[:n], raw[n:], []byte("titanview-broker-v1"))
}

// KeyHint shows only the first and last 4 characters.
func KeyHint(k string) string {
	if len(k) <= 8 {
		return strings.Repeat("•", len(k))
	}
	return k[:4] + "…" + k[len(k)-4:]
}

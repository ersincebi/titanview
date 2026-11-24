.PHONY: verify test-go test-fe cover fuzz smoke build start dev

verify: test-go test-fe build smoke

test-go:
	cd backend && go test -v -race ./...

test-fe:
	pnpm typecheck && pnpm test

# Kapsama: Go paket yüzdeleri + frontend eşikleri (vite.config.ts)
cover:
	cd backend && go test -cover ./...
	pnpm coverage

# Go fuzz (her hedef 15 sn)
fuzz:
	cd backend && go test ./internal/normalizer -run '^$$' -fuzz '^FuzzNormalizeBinanceKlines$$' -fuzztime 15s
	cd backend && go test ./internal/normalizer -run '^$$' -fuzz '^FuzzNormalizeYahooChart$$' -fuzztime 15s
	cd backend && go test ./internal/normalizer -run '^$$' -fuzz '^FuzzNormalizeBinanceWSKline$$' -fuzztime 15s
	cd backend && go test ./internal/normalizer -run '^$$' -fuzz '^FuzzResampleInvariants$$' -fuzztime 15s
	cd backend && go test ./internal/storage -run '^$$' -fuzz '^FuzzComputeMissingGaps$$' -fuzztime 15s
	cd backend && go test ./internal/domain -run '^$$' -fuzz '^FuzzValidateAndRepairCandle$$' -fuzztime 15s

smoke:
	scripts/smoke.sh

build:
	pnpm build
	cd backend && go build -o titanview-server ./cmd/server

start: build
	./backend/titanview-server --port 8080 --db data/titanview.db --static dist

dev: build
	./backend/titanview-server --port 8080 --db data/titanview.db --static dist

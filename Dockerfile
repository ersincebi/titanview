# syntax=docker/dockerfile:1
FROM node:22-slim AS web
RUN npm i -g pnpm@10.30.3
WORKDIR /src
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts index.html ./
COPY frontend ./frontend
COPY public ./public
RUN pnpm exec vite build

FROM golang:1.26-bookworm AS server
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=1 go build -o /out/titanview-server ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /out/titanview-server /app/titanview-server
COPY --from=web /src/dist /app/dist
EXPOSE 8080
CMD ["/app/titanview-server", "--port", "8080", "--db", "/app/data/titanview.db", "--static", "/app/dist"]

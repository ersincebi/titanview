# Contributing to TitanView

Thanks for helping! TitanView aims to be a complete, open, local-first charting and analysis platform,
and there is room for contributions of every size. [Türkçe özet aşağıda.](#türkçe)

## Ways to help

| You can… | Where to start |
|---|---|
| Report a bug | [New issue → Bug report](https://github.com/ersincebi/titanview/issues/new/choose) |
| Report a TitanScript compatibility bug | Bug report with a minimal `.titan` snippet, symbol, interval, expected output, and actual output. These become regression tests |
| Add an indicator | Write a clean-room `.titan` script under `frontend/src/script/builtins/` from a published formula, include `// SPDX-License-Identifier: AGPL-3.0-or-later`, and add a golden test |
| Add a drawing tool or chart type | `frontend/src/chart/drawing/` and `frontend/src/chart/customSeries.ts` |
| Add a data provider | `backend/internal/provider/`: implement the provider interface and add normalizer fuzz tests |
| Translate | UI strings live in `frontend/src/state/i18n.ts` and `frontend/src/state/i18n_en.ts` |
| Improve docs | README, this file, comments |

Issues labelled [`good first issue`](https://github.com/ersincebi/titanview/labels/good%20first%20issue) are a good start.
For larger changes, open an issue first so we can agree on the approach.

## Development setup

Requirements: Node.js 20+ with pnpm 10, Go 1.26+, Rust stable (WASM core and desktop shell).

```bash
git clone https://github.com/ersincebi/titanview.git && cd titanview
pnpm install
make build                                   # UI + Go server
./backend/titanview-server --port 8080 --db data/titanview.db --static dist
pnpm dev                                     # optional: Vite dev server with hot reload
```

## Before you open a pull request

```bash
make verify        # go test -race, typecheck, frontend tests, build, smoke test
pnpm coverage      # coverage thresholds must stay green
```

- Keep pull requests focused: one feature or fix per PR.
- Add or update tests. TitanScript features need golden-value tests; chart code has a Lightweight Charts mock (`frontend/src/chart/__tests__/lwcMock.ts`).
- **No fake data.** If a source is unavailable, show an explicit error; never fill gaps with synthetic values.
- **Clean-room rule — do not copy proprietary code, protected scripts, icons, or assets from third-party platforms.**
  Implement indicators strictly from published mathematical or financial literature (e.g., Wilder, Appel, Lane, Bollinger, Nison).
  Every file under `frontend/src/script/builtins/` must carry `// SPDX-License-Identifier: AGPL-3.0-or-later`; CI rejects third-party copyright notices.
  Only contribute code you have the right to license under AGPL-3.0-or-later.
- Commit messages: short imperative summary, e.g. `feat(chart): add Renko wick option`, `fix(script): ta.rsi warm-up`.
- Turkish or English are both fine in issues, PRs, and comments.

## Project layout

| Path | What lives there |
|---|---|
| `frontend/src/chart` | Chart controller, panes, custom series, drawing tools |
| `frontend/src/script` | TitanScript lexer, parser, type checker, VM, `ta.*`, broker, editor, built-in scripts (`builtins/*.titan`) |
| `frontend/src/state`, `frontend/src/ui` | Stores and SolidJS components |
| `backend/internal` | Go: `api`, `provider`, `storage`, `alerts`, `scriptjs`, `trading`, `footprint`, `analytics`, … |
| `wasm/titan-core` | Rust → WASM core |
| `src-tauri` | Desktop shell (Tauri v2) |

## License of contributions

TitanView is licensed under AGPL-3.0-or-later. By submitting a contribution you agree that it is licensed
under the same terms and you certify the [Developer Certificate of Origin](https://developercertificate.org/):
sign off your commits with `git commit -s`.

---

## Türkçe

Katkıya açığız: hata bildirimi, TitanScript uyumluluk testleri (regresyon testine dönüşür),
yeni gösterge (`frontend/src/script/builtins/` altında `.titan` ile), çizim aracı, veri sağlayıcısı, çeviri ve doküman.

1. Büyük değişiklik için önce issue aç.
2. Yukarıdaki kurulumla projeyi çalıştır.
3. PR öncesi `make verify` ve `pnpm coverage` yeşil olmalı; yeni işe test ekle.
4. Sahte veri yok; üçüncü taraf platformlardan kapalı kaynak kod, korumalı betik, simge veya görsel varlık kopyalanmaz. Göstergeler yalnızca yayımlanmış formüllerden sıfırdan yazılır ve `SPDX-License-Identifier: AGPL-3.0-or-later` başlığı taşır.
5. Commit'leri `git commit -s` ile imzala (DCO). Katkın AGPL-3.0-or-later altında lisanslanır.

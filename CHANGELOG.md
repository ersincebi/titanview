# Changelog

## 1.0.1 — 2026-11-24

### Fixed
- Symbols could not be added to favorites from symbol search: every search result now has a ☆ button, and the
  top bar has a ☆ next to the current symbol. The watchlist ☆ is no longer invisible until hover
  (always visible on touch screens).
- Release builds: desktop packages (dmg, exe, msi, AppImage, deb, rpm) are attached even when the updater
  signing key is not configured; `latest.json` is then skipped with a warning.
- Flaky CI performance test (warm-up and best of three runs).

### Changed
- Fonts (Inter, JetBrains Mono) ship with the app (SIL OFL 1.1); no request to Google Fonts at startup, and the
  app works offline.
- Own wording for several strategy tester and indicator dialog labels.
- Five built-in indicator files renamed to neutral names. Saved layouts that use the old ids keep working.

## 1.0.0 — 2026-11-24

First open-source release.

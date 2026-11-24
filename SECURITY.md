# Security Policy

TitanView runs locally and can hold sensitive data: exchange API keys (encrypted at rest), alert webhooks and Telegram tokens.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private
[security advisory form](https://github.com/ersincebi/titanview/security/advisories/new).
Include the version, platform and steps to reproduce. You will get a reply within 7 days.

## Scope

In scope: the Go server, the desktop shell, the update mechanism, key storage, the TitanScript runtime (sandbox escapes,
resource exhaustion) and anything that could let a remote page or script reach the local server.

## Supported versions

Only the latest release receives security fixes.

# Changelog

All notable changes to AAJ Contact Scan are recorded here.

## [1.0.0] - 2026-11-04

### Added

- Installable mobile-first PWA for event batches, camera/gallery intake, review, editing and approval.
- Adaptive Gemini model routing with Cloudflare Workers AI fallback.
- Privacy-safe shared AI usage and capacity reporting in Cloudflare D1.
- Text-only approved-contact backup with resilient client synchronization and administrator CSV recovery.
- Native CSV sharing with desktop download/email fallback.
- Separate team and administrator authentication with route-specific Cloudflare rate limiting.
- Public synthetic-card set, real-application workflow GIF and deployment/security/operations documentation.

### Security and privacy

- Card photos remain on the phone and are never stored in central backup D1.
- API keys and passcodes remain Cloudflare Worker secrets and are absent from Git.
- Public demo material contains synthetic data only.
- AAJ V1 uses a documented 180-day maximum routine retention target for approved backup text, enforced through monthly administrator review.

### Operational boundaries

- Provider quota indicators are estimates; provider dashboards remain authoritative.
- Cloudflare Worker rate-limit bindings are approximate and complement strong unique credentials.
- Backup retention deletion is a manual V1 administrator operation.


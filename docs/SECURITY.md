# Security Model

## Public source, private credentials

This repository is intentionally public. Production credentials are not encrypted inside Git; they are absent from Git and stored as Cloudflare Worker secrets. `.env`, `.dev.vars`, real evaluation cards and ground-truth files are git-ignored.

Cloudflare D1 database identifiers and Worker names are deployment coordinates, not credentials. Another account cannot use them without authorization, but forks must still create their own resources to avoid configuration mistakes.

## Authentication defenses

- Team and administrator credentials are separate.
- Comparisons hash both supplied and configured values before constant-length byte comparison.
- Invalid team and administrator attempts pass through distinct Cloudflare rate-limit bindings keyed by connecting IP.
- Administrator failures also receive bounded in-isolate delay as defense in depth.
- Rate limiting is approximate and per Cloudflare location; it complements rather than replaces strong unique passcodes.
- Secrets and contact values are excluded from API error messages.

## Data flow

| Data | Location | Lifetime |
|---|---|---|
| Card photos | Browser IndexedDB; temporary authorized AI request | Until phone batch is cleared; not backed up |
| Approved contact text | Browser + backup D1 | Until administrator deletion under the retention policy |
| Usage events | Usage D1 | Operational metadata only; no contact fields |
| Team/admin passcodes | Cloudflare secret store; transient request memory | Until rotation |
| Gemini key | Cloudflare secret store | Until rotation |

## Public demo boundary

Committed card images are synthetic. Public screenshots must not show real contacts, event names, database contents, credentials, account identifiers beyond non-secret deployment names, or developer tools containing secrets.

## Reporting a vulnerability

Do not open a public issue containing an exploit, credential or contact information. Contact the repository owner privately through [github.com/shashankshekharans](https://github.com/shashankshekharans). Include the affected route/version, reproduction conditions and impact without including real contact records.

## Supported release

Security fixes target the latest tagged release. Operators are responsible for applying new migrations, rotating exposed credentials and deploying updates to their own Cloudflare account.


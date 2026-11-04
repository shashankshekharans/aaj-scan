# Public Repository Model

Status: **single public repository approved for V1**
Updated: **2026-11-04**

AAJ Contact Scan uses one public repository for the real reference product and the reusable source. The live AAJ deployment demonstrates the use case; adopters create isolated infrastructure and replace the branding.

## What stays public

- Application, Worker and validation source code
- D1 schemas and deployment configuration structure
- Product screenshots that contain no credentials or real contacts
- Twelve synthetic demonstration cards
- Architecture, deployment, operations and security documentation
- Release notes and version tags

## What never enters Git

- API keys and passcodes
- `.env` and `.dev.vars`
- Real business-card photographs
- Ground truth derived from real contacts
- D1 contents and recovery CSVs
- Provider payloads containing card images or extracted personal data

## Isolation contract for forks

Every adopter creates its own Cloudflare Worker and URL, usage and backup D1 databases, Gemini API key, team/admin passcodes, branding and authorized public links. A fork must never call AAJ's production Worker or reuse AAJ credentials.

## Documentation assets

Only synthetic cards and privacy-safe app screens are used. The asset pipeline resizes images, converts them to WebP and strips metadata. `npm run demo:verify` enforces the public asset count, dimensions, format and maximum size.

## Release checklist

- [x] Real-device V1 workflow tested by the product owner.
- [x] Repository and Git history scanned for high-confidence credential patterns.
- [x] Synthetic demonstration set confirmed as non-real by the product owner.
- [x] Edge rate limiting added for invalid team and administrator authentication.
- [x] Deployment, operations and security boundaries documented.
- [x] Real production workflow GIF published in the README using synthetic data.
- [ ] Full test/typecheck/build/asset verification passes.
- [ ] Production Worker deployed and smoke-tested.
- [ ] `v1.0.0` tag and release notes published.

## Future generalization

The current repository is a working AAJ reference implementation, not a zero-input white-label generator. Future releases may centralize brand tokens and CRM mappings into a typed configuration layer. Those changes must not move secrets into browser-delivered configuration.

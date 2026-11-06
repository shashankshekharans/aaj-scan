# Using AAJ Contact Scan for Your Organisation

This repository is two things at once: the source of AAJ's live scanner and a reusable starting point for any team that collects business cards at events. You are welcome to fork it. This page explains what you get, what you must replace and the one rule that protects everyone's data.

## The isolation rule

**Every deployment runs on its own infrastructure.** A fork must never call AAJ's production Worker, reuse AAJ's database IDs or share AAJ's credentials. Create your own:

| Resource | Where it lives | Notes |
|---|---|---|
| Cloudflare Worker and URL | `wrangler.jsonc` → `name` | Gives you your own `*.workers.dev` address or custom domain |
| Usage database (D1) | `wrangler.jsonc` → `USAGE_DB` | Stores privacy-safe scan counts only |
| Backup database (D1) | `wrangler.jsonc` → `BACKUP_DB` | Stores approved contact text; never photos |
| Gemini API key | Worker secret `GEMINI_API_KEY` | Free tier works for typical event volumes |
| Team passcode | Worker secret `TEAM_PASSCODE` | Shared with the people who scan |
| Administrator passcode | Worker secret `BACKUP_ADMIN_PASSCODE` | Different from the team passcode; used for CSV recovery |

Step-by-step commands are in [Deployment](DEPLOYMENT.md).

## Make it yours

- **Branding:** replace the artwork in `brand/` and run `npm run brand:assets` to regenerate the header wordmark and app icons. Update colours in `src/styles.css` and the app name in `vite.config.ts` and `index.html`.
- **Social links:** edit `SocialFooter` in `src/App.tsx`.
- **CRM columns:** the CSV export in `src/csv.ts` targets HubSpot's contact import; adjust the headers for another CRM.
- **Brand assets you don't own:** the AAJ name and logo identify the reference deployment only. Use branding you are authorised to use.

## What is public and what never is

| Public in this repository | Never committed |
|---|---|
| Application, Worker and validation source code | API keys, passcodes, `.env`, `.dev.vars` |
| D1 schemas and deployment configuration structure | Real business-card photographs |
| Twelve synthetic demonstration cards in `demo/` | Ground truth derived from real contacts |
| Screenshots and demos recorded with synthetic data | D1 contents, recovery CSVs, provider payloads |

The demo asset pipeline (`npm run demo:assets`, `npm run demo:verify`) resizes images, converts them to WebP, strips metadata and enforces size limits, so public media stays small and clean.

## Staying up to date

Releases are tagged (`v1.0.0`, …) and described in the [changelog](../CHANGELOG.md). To pull improvements into a fork, merge the upstream tag, then run `npm install`, `npm test` and `npm run build` before deploying.

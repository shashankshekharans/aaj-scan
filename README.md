# AAJ Scan

Turns photos of business cards from events into a HubSpot-ready CSV — free to run, Android PWA, human review before export.

**Live app:** https://aaj-contact-scan.contact-scan.workers.dev

- **Requirements & decisions:** [docs/PRD.md](docs/PRD.md) (approved 2026-10-29)
- **Evaluation result:** [docs/EVALUATION_RESULTS.md](docs/EVALUATION_RESULTS.md) — Gemini primary, Cloudflare fallback, Groq manual-review only.

## Current status

Status as of 2026-10-31: the installable PWA and unified Cloudflare Worker are deployed. The app supports passcode access, camera/gallery intake, on-device image preparation, an offline queue, Gemini extraction with Workers AI fallback, review/edit/approval, and HubSpot-ready CSV export. The light-only interface follows AAJ's brand palette and uses Plus Jakarta Sans with Inter.

Gemini uses an automatic model pool. The evaluated `gemini-3.5-flash-lite` model is preferred; quota, rate-limit, capacity, timeout, or model-availability errors rotate to the next configured Gemini model before the app falls back to Cloudflare Workers AI. Configure the order with `GEMINI_MODELS`.

All 20 evaluation cards have verified ground truth. Combined full-frame and cropped OCR grounding plus review rules produced zero silent errors for Gemini and Cloudflare. Groq remains manual-review only; Mistral and NVIDIA remain excluded because free API access was unavailable.

## Next steps

1. Install the PWA on the marketing team's Android phones.
2. Pilot the complete workflow on a small event batch.
3. Review the exported CSV before the first HubSpot import.

Card photos, ground truth and `.env` are git-ignored (personal data / secrets): on another machine, copy them over manually.

## Layout

| Folder | What |
|---|---|
| `core/` | Provider-neutral extraction logic: prompt + schema, validation rules, OCR grounding, scoring. Reused later by the proxy Worker and the PWA. |
| `eval/` | Evaluation harness: provider adapters (Gemini, Groq, Cloudflare Workers AI, Mistral), OCR-only baseline, runner and reports. |
| `src/` | React/Vite PWA for capture, review, local storage and CSV export. |
| `worker/` | Cloudflare Worker API, authentication and AI-provider routing. |
| `docs/` | PRD and design documents. |

## Setup on a new machine

```bash
git clone https://github.com/shashankshekharans/aaj-scan.git
cd aaj-scan
npm install
npm test
```

Then copy `.env.example` to `.env` and add your free API keys. Card photos (`eval/cards/`), ground truth and results are **not** committed — they contain personal data and stay on your machine.

Requires Node.js 24+.

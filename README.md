# AAJ Scan

Turns photos of business cards from events into a HubSpot-ready CSV — free to run, Android PWA, human review before export.

- **Requirements & decisions:** [docs/PRD.md](docs/PRD.md) (approved 2026-10-29)
- **Current step:** extraction evaluation — measure free AI providers on real cards before building the app. See [eval/README.md](eval/README.md).

## Next steps (where to pick up)

Status as of 2026-10-29: PRD approved, evaluation harness built and tested (37 tests). Provider adapters not yet run against the live APIs.

1. **You:** create free accounts — Google AI Studio, Groq, Cloudflare, Mistral (links in [eval/README.md](eval/README.md)).
2. **You:** copy `.env.example` → `.env` and paste the keys (never into chat).
3. **You:** note each dashboard's free requests-per-day limit.
4. **You:** put 20–30 varied card photos in `eval/cards/` as `card-01.jpg`, `card-02.jpg`, … (keep the physical cards in order).
5. **Claude:** run `npm run eval -- --limit 3` smoke test, fix any adapter a provider rejects.
6. **Claude:** draft `eval/ground-truth.json` from the photos → **you** verify each entry against the physical cards.
7. **Claude:** full evaluation → pick provider priority order → then build the proxy Worker and the PWA.

To resume, open this folder in Claude Code and say: *"Keys and photos are ready — run the smoke test."*

## Layout

| Folder | What |
|---|---|
| `core/` | Provider-neutral extraction logic: prompt + schema, validation rules, OCR grounding, scoring. Reused later by the proxy Worker and the PWA. |
| `eval/` | Evaluation harness: provider adapters (Gemini, Groq, Cloudflare Workers AI, Mistral), OCR-only baseline, runner and reports. |
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

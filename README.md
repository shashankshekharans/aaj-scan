# AAJ Scan

Turns photos of business cards from events into a HubSpot-ready CSV — free to run, Android PWA, human review before export.

- **Requirements & decisions:** [docs/PRD.md](docs/PRD.md) (approved 2026-10-29)
- **Current step:** extraction evaluation — measure free AI providers on real cards before building the app. See [eval/README.md](eval/README.md).

## Next steps (where to pick up)

Status as of 2026-10-30: PRD approved; evaluation harness built and tested (39 tests). 20 real card photos added locally and ground truth drafted. OCR-only baseline measured: names ~6%, company 12%, email 88%, phone 76% → OCR alone is not enough; AI providers not yet run (no keys).

Done: ~~card photos~~ (in `eval/cards/`, local only) · ~~draft ground truth~~ (`eval/ground-truth.json`, local only).

1. **You:** verify `eval/ground-truth-review.md` against the physical cards (tick each row).
2. **You:** decide two rules — cards listing several people (recommended: first-listed person only) and company cards with no person's name (recommended: flag for review, export with blank name).
3. **You:** create free accounts — Google AI Studio, Groq, Cloudflare, Mistral (links in [eval/README.md](eval/README.md)); copy `.env.example` → `.env` and paste the keys (never into chat); note each dashboard's requests-per-day limit.
4. **Claude:** `npm run eval -- --limit 3` smoke test, fix any adapter a provider rejects.
5. **Claude:** full evaluation; test cropping the card before OCR (noisy OCR may over-flag); pick provider priority order.
6. **Claude:** build the proxy Worker and the PWA.

To resume, open this folder in Claude Code and say: *"Ground truth checked, keys are in .env — run the smoke test."*

Card photos, ground truth and `.env` are git-ignored (personal data / secrets): on another machine, copy them over manually.

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

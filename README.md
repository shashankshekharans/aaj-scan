# AAJ Scan

Turns photos of business cards from events into a HubSpot-ready CSV — free to run, Android PWA, human review before export.

- **Requirements & decisions:** [docs/PRD.md](docs/PRD.md) (approved 2026-10-29)
- **Current step:** extraction evaluation — measure free AI providers on real cards before building the app. See [eval/README.md](eval/README.md).

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

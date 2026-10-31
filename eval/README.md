# Extraction evaluation

Measures each extraction method on your real cards before we pick the provider order (PRD §5).

## What you need to do

1. **Create the free accounts** (no credit card, one account per provider):
   - Google AI Studio → https://aistudio.google.com/apikey → *Create API key*
   - Groq → https://console.groq.com/keys → *Create API Key*
   - Cloudflare → https://dash.cloudflare.com/sign-up → copy the **Account ID**, then *My Profile → API Tokens → Create Token →* "Workers AI" template
   - Mistral → https://console.mistral.ai → choose the free plan → *API Keys*
2. **Add the keys:** copy `.env.example` to `.env` in the project folder and paste each key after its `=`. Don't paste keys into chat. Missing keys are fine; that provider is skipped.
3. **Check the free limits** in each dashboard (AI Studio → *Rate limits*; Groq → *Settings → Limits*) and tell Claude the requests-per-day numbers. The providers don't publish them.
4. **Add 20–30 card photos** to `eval/cards/` (JPG/PNG). Name them `card-01.jpg`, `card-02.jpg`, …, keep the physical cards in the same order, and include the hard ones: dark backgrounds, vertical layouts, tiny fonts, two phone numbers, initials in names, one or two without email.

Claude then drafts `eval/ground-truth.json` from the photos, and **you check every entry against the physical card**.

## Running

```bash
npm run eval -- --limit 3          # cheap smoke test on 3 cards
npm run eval                       # all cards, all configured providers + OCR-only
npm run eval -- --methods gemini   # one provider
npm run eval -- --no-grounding     # turn off the OCR cross-check, to measure what it adds
npm run eval -- --crop-grounding   # crop the card region before local OCR
npm run eval -- --combined-grounding # combine full-frame and cropped OCR
```

Reports go to `eval/results/report-<time>.md`. Model answers are cached, so re-running costs no quota (`--fresh` forces new calls).

## Ground truth format

```json
[
  { "file": "card-01.jpg",
    "fields": { "firstName": "Priya", "lastName": "Nair", "company": "Acme Freight Pvt Ltd",
                "email": "priya.nair@acmefreight.in", "jobTitle": "Head of Logistics", "phone": "+91 98450 12345" } },
  { "file": "card-02.jpg", "skip": "no_email",
    "fields": { "firstName": "Rahul", "lastName": "Mehta", "company": "Mehta Traders",
                "email": null, "jobTitle": null, "phone": "+91 99000 54321" } }
]
```

Write values exactly as printed; use `null` for anything not on the card. `phone` is the mobile number if one is printed, otherwise the only/first number. `skip` is `no_email`, `non_english` or `not_a_card`.

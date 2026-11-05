# Extraction Evaluation

Before trusting any AI provider with real contacts, measure it on real cards. This harness runs each configured provider against a verified test set and reports the metric that matters most: **silent errors**, wrong values that were not flagged for review. The current provider order and its evidence are recorded in [Evaluation results](../docs/EVALUATION_RESULTS.md).

## Prepare a test set

1. **Collect 20–30 card photos** in `eval/cards/` as `card-01.jpg`, `card-02.jpg`, … Include the difficult ones: dark backgrounds, vertical layouts, tiny fonts, two phone numbers, initials in names, and one or two cards without an email.
2. **Write the ground truth** in `eval/ground-truth.json` (format below). One person transcribes; a second person checks every entry against the physical card.
3. **Add provider keys** by copying `.env.example` to `.env`. Providers without a key are skipped.

Card photos, ground truth and results are personal data. They are git-ignored and must never be committed.

## Run

```bash
npm run eval -- --limit 3              # smoke test on three cards
npm run eval                           # every card, every configured provider, plus OCR-only
npm run eval -- --methods gemini       # a single provider
npm run eval -- --no-grounding         # disable the OCR cross-check to measure its effect
npm run eval -- --crop-grounding       # crop the card region before local OCR
npm run eval -- --combined-grounding   # combine full-frame and cropped OCR (production setting)
```

Reports are written to `eval/results/report-<time>.md`. Provider answers are cached, so re-scoring costs no quota; `--fresh` forces new calls.

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

Write values exactly as printed and use `null` for anything not on the card. `phone` is the mobile number when one is printed, otherwise the first number. `skip` is `no_email`, `non_english` or `not_a_card`.

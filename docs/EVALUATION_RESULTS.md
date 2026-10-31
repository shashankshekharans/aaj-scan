# Extraction evaluation result

Decision recorded 2026-10-31 after evaluating 20 verified business-card images.

## Provider order

1. **Gemini (`gemini-3.5-flash-lite`) — primary.** Zero silent errors; 100% of cards marked “looks good” were fully correct.
2. **Cloudflare Workers AI (`@cf/google/gemma-4-26b-a4b-it`) — fallback.** Zero silent errors; 100% of cards marked “looks good” were fully correct. It was materially slower than Gemini in the fresh run.
3. **Groq (`qwen/qwen3.8-27b`) — manual-review only.** Seven silent field errors, five of them on cards marked “looks good”; it must not feed automatic approval.
4. **OCR-only — manual fallback only.** It is useful for grounding model output, not as the extractor.

Mistral was unavailable without a paid plan. NVIDIA API-key access was unavailable pending account verification.

## Final score

The final score uses combined full-frame and cropped local OCR grounding. Provider responses were already cached, so the final safety-rule rescore did not upload the images again.

| Method | Silent errors | Flag rate | “Looks good” fully correct | Required-field accuracy |
|---|---:|---:|---:|---:|
| Gemini | 0 | 50% | 100% | First 95%, last 95%, company 100%, email 100% |
| Cloudflare | 0 | 50% | 100% | First 100%, last 100%, company 100%, email 95% |
| Groq | 7 | 50% | 78% | First 89%, last 89%, company 89%, email 100% |
| OCR-only | 38 | 85% | 0% | First 6%, last 6%, company 12%, email 88% |

The safety target (at most one silent error) is met by Gemini and Cloudflare. The 50% review rate does not yet meet the PRD target of 30%; this is accepted for the first pilot because incorrect automatic approvals are more costly than extra review.

## Safeguards added from the evaluation

- Derive a missing company from a non-personal business-email domain, always with a review flag.
- Never infer a company from personal-email domains.
- Flag role labels when no person is named.
- Flag job titles that appear truncated before a printed suffix.
- Flag one-character differences between email and website domains as likely typos.
- Combine full-frame and cropped OCR for grounding; crop-only OCR increased false review flags.

The detailed local report is under `eval/results/`. Reports, provider responses, card images and ground truth stay git-ignored because they contain personal data.

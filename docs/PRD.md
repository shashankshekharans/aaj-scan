# Contact Scan — Discovery Output

Status: **Approved; MVP implemented** · Approved 2026-10-29 · Implementation updated 2026-10-31.

Facts marked *(verified 2026-10-29)* were checked against official docs. Anything marked *(unverified)* must be confirmed before or during the build. Accuracy figures are **targets to measure**, not results.

---

## 1. Product Requirements Document

### Problem
After each event, marketing types 50–300 business cards by hand into Excel (≈1.5–2 min per card), then imports the sheet into HubSpot. It is slow, repetitive and error-prone.

### Users
1–3 marketing team members, **Android phones only**, working **in the office on Wi-Fi** after the event. 1–2 events per month. Contacts must reach HubSpot within 2–3 days.

### Goal
Turn a stack of English business cards into a HubSpot-ready CSV with **under 20 seconds of human time per card** (including review) and **no silent errors** — every exported value is either correct or was visibly flagged to the reviewer.

### Core workflow
1. Open the app (installed PWA), enter the team passcode once.
2. Start a batch → enter **Event Name**.
3. Capture cards in either mode:
   - **One-by-one:** photograph → extraction result appears → review/fix → approve → next card.
   - **Batch:** photograph cards rapidly; each is queued and processed in the background while the phone sits aside (screen kept awake).
4. Without internet, photos are stored on the phone and processing resumes automatically when the connection returns.
5. Review table: thumbnail + fields + flags for every card. Cards with no flags are marked **"Looks good"** and can be **bulk-approved**; flagged cards must be opened individually (zoomable image beside editable fields).
6. Cards without an email, or non-English cards, are marked **Skipped** (with reason).
7. Export → downloads CSV of approved cards; the export screen lists skipped cards by name + company.
8. App asks **"File saved? Clear this batch"** → on confirmation, all images and records for the batch are deleted.
9. A team member uploads the CSV into HubSpot manually.

### Fields

| Field | Rule | CSV column |
|---|---|---|
| First name | **Required** | First Name |
| Last name | **Required** (single-name cards → flagged for user decision) | Last Name |
| Company | **Required** | Company Name |
| Work email | **Required** (missing → card Skipped) | Email |
| Job title | Optional, only if printed | Job Title |
| Phone | Optional; mobile preferred, office number dropped if both; exported as printed, no country code added | Phone Number |
| Event | Entered once per batch | Event Name |

**Never invented:** no guessed emails from website domains, no country code inferred from location, and no salutation/gender. One controlled fallback is allowed: when no company is printed and the card has a non-personal business email, derive the company from the email-domain label and flag it for human confirmation.

---

## 2. MVP scope

### In the MVP
- Installable PWA for Android Chrome; app shell works offline.
- Team passcode gate (via proxy).
- Batch creation with Event Name.
- Camera capture (one-by-one and rapid batch) and pick-from-gallery.
- Optional "add back side" photo for a card.
- Client-side image quality check (blur/darkness/too small) with immediate "retake?" prompt.
- Image resize + re-encode on device (also strips EXIF/GPS).
- Offline queue with automatic resume; screen wake lock during batch processing.
- AI field extraction through a **pool of free cloud vision providers** behind a proxy, with structured JSON output and **automatic failover** (quota exhausted / error → next provider in priority order).
- Settings screen: status per provider (active / quota exhausted / key missing — keys never shown) and a manual "prefer provider X" override.
- Review table shows which provider read each card.
- Validation + flagging layer (see §5).
- Review table with thumbnails, flags, inline edit, delete, bulk approve of "Looks good" cards.
- Card detail view: zoomable image beside editable fields, flags explained.
- Skipped status (no email / non-English / user skipped) with reason.
- CSV export (UTF-8 with BOM so Excel displays it correctly) with the 7 columns above.
- Skipped-cards list on the export screen.
- "File saved? Clear this batch" deletion step.
- Evaluation harness: scores extraction methods against the verified test set.

### Explicitly out of scope (MVP)
- Duplicate detection (HubSpot handles it on import).
- Direct HubSpot API sync; checking against existing HubSpot contacts.
- Excel (.xlsx) export.
- Multiple cards in one photo.
- Non-English cards (detected and skipped, not extracted).
- Handwritten notes / handwriting recognition.
- Per-card notes, lead status, owner assignment, other HubSpot properties.
- On-device AI extraction while offline (photos queue instead).
- iOS support, native Android app.
- Shared team backend, user accounts, merging batches across phones.
- Archiving card images anywhere after export.
- Website, address, LinkedIn, fax, office-phone columns.
- Paid AI providers (OpenAI, Anthropic, paid Gemini). Consumer subscriptions (ChatGPT Plus, Claude Pro, Google AI plans) do not include API access, so they cannot be used.
- In-app admin page for entering API keys (keys are set as Cloudflare Worker secrets instead).
- Multiple free accounts/keys for the same provider (quota-evasion risk).

### Later candidates (not committed)
Excel export · HubSpot API push with "create only" · multi-card photos · per-card notes · second phone column · additional languages · paid provider adapter (only if the team chooses to fund an API account).

---

## 3. Architecture comparison

| Criterion | **A. PWA + free proxy + free cloud vision model** (recommended) | B. PWA calling AI directly (key on each phone) | C. Native Android app (ML Kit OCR on device + cloud model) | D. Web app + local AI server on office PC |
|---|---|---|---|---|
| Cost | Free (free tiers) | Free | Free (Play Store not needed; sideload) | Free software; needs a capable PC always on |
| Extraction accuracy | High (cloud vision model) + OCR cross-check | Same as A | Same as A; ML Kit OCR is a strong on-device check | Low–medium on this hardware: the available laptop (i5-10210U, 8 GB RAM, no GPU) can run OCR but a local vision model would take ~30–90+ s/card and is likely weaker |
| Ease of use | Install from a link, works like an app | Same, but each phone must enter an API key | Best camera UX, needs APK install/updates | Phone must reach the PC on office network; PC must be running |
| Dev complexity | Low–medium (one web app + ~100-line Worker) | Lowest | Highest (Kotlin/Android toolchain, signing, updates) | Medium–high (server, model ops, networking) |
| Batch processing | Yes; foreground with wake lock | Yes | Yes; true background work possible | Yes; server-side queue |
| Offline | App opens offline; photos queue until online | Same | Could OCR offline; AI still needs internet | Works without internet on LAN only |
| Privacy | Images go to cloud provider (accepted); key never on phones | Key extractable from phones | Same as A | Best — data never leaves office |
| Maintainability | Provider/model switch in one place (proxy) | Key rotation on every phone | Two codebases worth of tooling | Model/server upkeep, single point of failure |

**Recommendation: A.** It is the simplest option that meets every requirement. Android-only removes the main PWA weakness (iOS limits). D is ruled out by hardware; C adds cost in complexity without a requirement that needs it.

---

## 4. Zero-cost technology stack

| Layer | Choice | Cost type |
|---|---|---|
| App | React + TypeScript + Vite, `vite-plugin-pwa` (service worker, installable) | Free & open source |
| Local storage | IndexedDB via Dexie (images + records, per batch) | Free & open source |
| Camera | `<input type="file" accept="image/*" capture="environment">` for one-by-one; `getUserMedia` for rapid batch capture | Browser built-in |
| Image prep | Canvas resize (~1600 px long edge, JPEG), blur/brightness check; optional edge detection/perspective correction with jscanify + OpenCV.js (MIT / Apache-2.0) if the test set shows it helps | Free & open source |
| Local OCR (cross-check + fallback) | Tesseract.js (Apache-2.0) in the browser; PaddleOCR.js (Apache-2.0) as alternative if Tesseract is too weak | Free & open source |
| Parsing/validation | Email regex + domain checks, `libphonenumber-js` (MIT) for phone validation | Free & open source |
| CSV | Papa Parse (MIT) `unparse` + UTF-8 BOM | Free & open source |
| Proxy | Cloudflare Worker: holds provider keys as encrypted secrets (set in the Cloudflare dashboard), checks team passcode, one provider-neutral interface with an adapter per provider, automatic failover in priority order, stores nothing | Free service with usage limits *(daily request limit to verify on Cloudflare's current free plan)* |
| Hosting | Cloudflare Pages (HTTPS required for camera) | Free service with usage limits |
| Provider pool — Gemini | Google Gemini API free tier, e.g. `gemini-3.5-flash-lite` (image input + structured JSON) *(verified 2026-10-29)*; no card needed | Free service with usage limits — **limits not published, unverified** |
| Provider pool — Groq | Groq free plan, `qwen/qwen3.8-27b` vision (JSON mode) *(model verified; free-plan limits unverified)* | Free service with usage limits |
| Provider pool — Cloudflare Workers AI | Vision model via the Worker's AI binding (no separate key), e.g. `llama-3.2-11b-vision`; 10,000 free Neurons/day *(verified)*; per-card Neuron cost unverified | Free service with usage limits |
| Provider pool — Mistral | Mistral free (Experiment) mode, vision-capable model; training opt-out available *(limits unverified)* — kept only if it passes evaluation | Free service with usage limits |
| Priority order | Set from evaluation results (most accurate first) | — |
| Fallback (no AI) | Tesseract.js + rule parser (every card flagged for review) | Free & open source |
| Tests | Vitest (parsers/validators), evaluation script (Node) against the labelled test set | Free & open source |

**Hardware:** the team's existing Android phones; any PC for development. No server hardware.
**Ongoing costs:** none expected. Combined free quota of 3–4 providers should cover ~300 cards/event (to confirm in evaluation). If all free tiers shrink, the OCR-only fallback keeps the app usable. Optional: a custom domain (not needed).
**Accounts the user must create (free, no card), one per provider:** Cloudflare (also covers Workers AI); Google AI Studio; Groq; Mistral.

---

## 5. OCR / AI accuracy strategy

### Pipeline
1. **Capture quality gate (on phone):** reject/prompt retake for blurry (Laplacian variance), too dark, or too small images — at capture time, while the card is in hand.
2. **Prepare:** resize, re-encode (strips EXIF), optional perspective correction (only if the evaluation shows a gain).
3. **Extract (cloud vision model):** strict JSON schema; each field returns the value **and the exact text as printed**, or `null`. Prompt forbids inference; model also reports `language` and lists *all* emails/phones seen.
4. **Ground (local OCR):** Tesseract.js reads the same image. Every extracted value must be found (fuzzy match) in the OCR text or the model's verbatim text; mismatch → flag. This is the main defence against invented values.
5. **Validate (rules):**
   - email syntax; email domain vs company name / website on card;
   - phone parses with `libphonenumber-js`; mobile vs landline classification where possible;
   - name split: initials, honorifics (Dr., Mr.), >3 tokens or single token → flag;
   - multiple candidates for email/phone → flag ("choose one");
   - non-English → Skipped; no email → Skipped.
6. **Flag, don't score:** "confidence" = the set of rule flags. Model self-reported confidence is not used (it is not reliable). A card is **"Looks good"** only when all required fields are present, validated and grounded.
7. **Human review:** bulk approve "Looks good"; open flagged cards individually.

### Evaluation (before choosing the provider)
- **Test set:** 20–30 deliberately varied card photos from the team (dark backgrounds, vertical layouts, tiny fonts, logo text, two phones, initials in names). Claude transcribes ground truth; **the user verifies it against the physical cards**.
- **Methods compared:** (A) Tesseract + rules only · (B) Gemini · (C) Groq · (D) Cloudflare Workers AI · (E) Mistral · each of B–E with OCR grounding. Results set the failover priority order; a provider that misses the targets is excluded from the pool.
- **Metrics:** per-field accuracy after normalisation; **silent error rate** (wrong value not flagged — the key metric); flag rate (share of cards needing individual review); quota used; time per card.
- **Targets (to validate):** silent errors ≤ 1 field in the whole test set; flag rate ≤ 30% of cards; required-field accuracy ≥ 95% on "Looks good" cards.

### Limitations (honest)
- 20–30 cards is a small sample; it catches big problems, not rare ones. Track corrections in real use to keep improving.
- Vision models can produce plausible text that is not on the card; grounding reduces this but stylised fonts that OCR misreads will cause **extra flags** (safe, but more review time).
- Free-tier limits and models change without notice; Gemini models are retired regularly — model name is a proxy setting.
- Very glossy, embossed, or low-contrast cards may fail all methods; they will be flagged, not silently wrong.

---

## 6. Privacy & data-handling plan

| Stage | Where data lives | Handling |
|---|---|---|
| Capture | Phone (IndexedDB, app's private storage) | Re-encoded image (no EXIF/GPS) |
| Processing | Cloudflare Worker → AI provider | Worker forwards only the image and prompt; logs no bodies; stores nothing |
| AI provider | Whichever pool provider handles the card (Google / Groq / Cloudflare / Mistral) | **Free tiers may use inputs for product improvement and allow human review** (Gemini terms advise against submitting personal info). The team accepted this because consent is collected when cards are handed over. *Owner of this decision: marketing team; record it.* |
| Review | Phone | Data never leaves the device except to the proxy |
| Export | Phone Downloads folder | User uploads CSV to HubSpot, then deletes the CSV |
| Clear | Phone | "File saved? Clear this batch" deletes all images + records for the batch |

Further measures: HTTPS only; API key stored only as a Worker secret; team passcode (rotate if a phone is lost or a member leaves); phones must have a screen lock; app shows a reminder for batches left uncleared for 14+ days.

---

## 7. Acceptance criteria

1. The app installs from a URL on Android Chrome and opens without internet (app shell).
2. Without the correct passcode, no extraction request succeeds.
3. A batch requires an Event Name; every exported row carries it.
4. One-by-one mode: capture → fields shown → approve → camera ready for next card, with no app restart.
5. Batch mode: 50 photos captured in a row are processed with the screen kept awake, with progress shown; interrupting (app closed, offline) resumes without losing photos.
6. Photos taken offline are processed automatically once the connection returns.
7. A blurry/dark photo triggers a retake prompt at capture time.
8. Every card in the review table shows thumbnail, fields and flags; flagged cards cannot be bulk-approved.
9. No exported field contains text absent from the card (verified on the test set).
10. Cards without an email or in a non-English language are Skipped and listed by name + company on the export screen.
11. The CSV has exactly the columns First Name, Last Name, Company Name, Email, Job Title, Phone Number, Event Name; opens correctly in Excel; imports into HubSpot (tested with a sample import).
12. Mobile number is chosen over office number when both are printed; phone exported as printed.
13. After "Clear this batch", no images or records for that batch remain on the device (verified in storage inspector).
14. On the verified test set: silent errors ≤ 1 field total, flag rate ≤ 30%, median human time ≤ 20 s per card in a timed trial.
15. Switching AI provider requires changing only the proxy configuration.
16. When the active provider returns a quota/rate-limit error or fails, the card is retried automatically on the next provider in priority order with no user action; if all providers are exhausted, cards stay queued and the app says so.
17. The settings screen shows each provider's status without revealing any key; the manual "prefer provider" override is respected.
18. Each card records which provider extracted it, visible in the review table.

---

## 8. Unresolved decisions & risks

| # | Item | Type | Mitigation / next step |
|---|---|---|---|
| 1 | Free-tier limits for Gemini, Groq and Mistral are **not published**; Workers AI cost per card unknown | Risk | User creates one free key per provider; check limits in each dashboard before build; evaluation measures real usage per card |
| 2 | Failover priority order and which providers stay in the pool | Decision | Decided by the evaluation on the test set |
| 3 | Gemini free terms advise against personal data | Risk (accepted) | Team decision recorded in §6 |
| 4 | Free tiers can change or disappear | Risk | Multi-provider pool with automatic failover; OCR-only fallback keeps the app usable |
| 4a | Fallback providers may be less accurate | Risk | Same grounding/validation applies to every provider (weaker output → more flags, not silent errors); provider shown per card |
| 4b | Detecting "quota exhausted" differs per provider (status codes, messages) | Risk | Adapter per provider maps errors to retry / failover / fatal; covered by tests with recorded error responses |
| 5 | Chrome may pause the page if the screen turns off or the app is switched | Risk | Wake lock, progress saved per card, auto-resume; tell users to keep the app open during batches; check Android battery-saver settings |
| 6 | Whether perspective correction / OpenCV.js (~several MB) is worth it | Decision | Include only if evaluation shows gains |
| 7 | Tesseract.js accuracy/speed on phones for the grounding step | Risk | Measure in evaluation; PaddleOCR.js as alternative |
| 8 | HubSpot property for "Event Name" | Decision (at import) | Map to an existing property or create a custom one on first import |
| 9 | Cloudflare free-plan request limits | To verify | Expected far above ~600 requests/month; confirm on current Cloudflare docs |
| 10 | Passcode sharing / lost phone | Risk | Rotate passcode in Worker settings; uncleared-batch reminder |
| 11 | Test set without existing Excel ground truth | Constraint | Claude drafts, user verifies against physical cards |
| 12 | Name splitting for Indian name formats | Risk | Flag initials/single names; user decides |

---

**Next step:** approve (or amend) this document. After approval, the first build step is the evaluation harness + test set, so the provider choice is based on measured results.

# AAJ Scan

Turns photos of business cards from events into a HubSpot-ready CSV — free to run, Android PWA, human review before export.

**Live app:** https://aaj.contact-scan.workers.dev

- **Requirements & decisions:** [docs/PRD.md](docs/PRD.md) (approved 2026-10-29)
- **Evaluation result:** [docs/EVALUATION_RESULTS.md](docs/EVALUATION_RESULTS.md) — Gemini primary, Cloudflare fallback, Groq manual-review only.
- **Public template roadmap:** [docs/PUBLIC_TEMPLATE_PLAN.md](docs/PUBLIC_TEMPLATE_PLAN.md) — checklist for finalizing AAJ Scan and publishing a reusable generic edition.

## Current status

Status as of 2026-11-02 (local implementation; backup rollout pending): the installable PWA and unified Cloudflare Worker are deployed. The app supports passcode access, camera/gallery intake, on-device image preparation, an offline queue, Gemini extraction with Workers AI fallback, privacy-safe AI capacity and token indicators, review/edit/approval, HubSpot-ready CSV download/native sharing, automatic text-only backup of newly approved contacts, and administrator event CSV recovery. The light-only interface follows AAJ's brand palette and uses Plus Jakarta Sans with Inter.

Gemini uses an automatic model pool. The evaluated `gemini-3.5-flash-lite` model is preferred; quota, rate-limit, capacity, timeout, or model-availability errors rotate to the next configured Gemini model before the app falls back to Cloudflare Workers AI. Configure the order with `GEMINI_MODELS`.

The AI Capacity panel reports exact completed scans, Gemini-reported tokens, model routing and fallback events stored in the separate, privacy-safe shared usage database, with an on-device fallback. Provider quota is shown as an estimate only when `VITE_GEMINI_DAILY_LIMIT` is configured from Google AI Studio; provider dashboards remain authoritative. No card or contact data is added to these counters.

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


## Approved-contact backups and privacy

Approving a contact saves it on the phone first, then queues the approved text for Cloudflare D1 backup. Upload failures never block approval. Pending or failed uploads retry after reconnection and on later app starts; re-uploading the same contact ID updates that record instead of duplicating it. Older cards with no backup state are not uploaded automatically. Keep the phone's batch until its contacts show **Backed up** or a CSV is saved; clearing a batch also removes any still-pending local uploads.

The dedicated `BACKUP_DB` stores approved first/last name, company, email, job title, phone, event name/date, source IDs, provider/model and timestamps. Photographs, raw OCR, extraction errors, passcodes and API keys are never backed up. Card photos remain in browser storage until the batch is cleared and are sent temporarily for authorized AI processing. The separate `USAGE_DB` contains usage metadata only. Confirm consent for marketing-contact use before collecting and approving cards.

Backups are retained indefinitely until a Cloudflare administrator deliberately deletes them. Clearing a phone batch does **not** delete its cloud backup. CSV exports contain contact information: store them securely and follow AAJ's contact handling policy. Cloudflare account administrators can administer D1 and its recovery facilities.

## Administrator recovery

1. Unlock the app with the team passcode, then open **Settings > Cloud backups** (Settings is also available before starting a batch).
2. Enter the separate administrator passcode. Team access can upload approved contacts but cannot list or download cloud backups.
3. Find the event by name and local event date; use **Load more events** for additional pages. Event summaries show contact count and latest backup time, without individual contact details.
4. Select **Download recovery CSV** for one consolidated HubSpot CSV across all phone batches with the same normalized event name and event date. Original contact IDs remain distinct; two separately created contacts are not deduplicated by email/name.
5. Select **Lock backups**, leave Settings, lock the app, or reload to end access. The administrator passcode stays only in React memory, never localStorage, IndexedDB or sessionStorage. Invalid/rotated credentials require another unlock. Local scanning remains available if recovery is temporarily unavailable.

**Share CSV** opens native file sharing where supported. The desktop fallback downloads the file and opens an email draft to `info@aajscm.com`; attach the CSV manually. Native sharing apps control recipient selection.

New batches capture their local calendar event date when created and reuse it for every approval, correction and retry. For older batches without a saved date, the first backup attempt derives it from the creation timestamp in that browser's local timezone and persists it once before upload. The original timezone cannot be recovered for these legacy batches; later timezone changes do not move their backups between events.

Contacts carry a persisted monotonic revision: explicit approval starts at one, corrections increment it transactionally, and retries keep it. The Worker only replaces a lower stored revision and returns the stored revision in its receipt. The client shows **Backed up** only for the revision acknowledged by that receipt. Migration `migrations/backup/0002_contact_revision.sql` upgrades existing D1 contacts to revision zero without rewriting the already-applied first migration. Apply this new migration before deploying the updated Worker. Old app versions that omit revisions must reload before backing up; local approval and CSV export remain available.

Cloud backup limits are 200 characters for the event and each name, 300 for company and job title, 320 for email, and 100 for phone. Extracted text over a limit stays intact for local approval and CSV export; open the contact and shorten the indicated field to enable cloud backup. Existing batches with oversized event names can still be exported locally.

## Cloudflare backup rollout

Run from the repository root. The existing `USAGE_DB`, `AI` and `ASSETS` bindings must remain. `wrangler.jsonc` now also binds `BACKUP_DB` to the already-created `aaj-contact-scan-backup` database and uses `migrations/backup`. A separate organization must create its own databases with `npx wrangler d1 create <name>` and replace both database IDs in its configuration.

The backup database exists, but the following production steps are still pending; only an authorized administrator should perform them:

```bash
# Interactive secret input; do not put the secret in a command, VITE_ variable or Git.
npx wrangler secret put BACKUP_ADMIN_PASSCODE
# Apply only the dedicated backup migrations, before deployment.
npx wrangler d1 migrations apply BACKUP_DB --remote
npm test
npm run build
npx wrangler deploy --dry-run
npx wrangler deploy
```

Use a strong administrator passcode distinct from `TEAM_PASSCODE`. For local Worker development, set `TEAM_PASSCODE`, `GEMINI_API_KEY` and `BACKUP_ADMIN_PASSCODE` in git-ignored `.dev.vars`; `.env` remains for the evaluation harness/public Vite settings. Never prefix a secret with `VITE_`.

After deployment, use only clearly labelled synthetic contacts to verify approval persistence, retry without duplication, correction updating the same ID, aggregation across two batch IDs, administrator-only event listing/CSV recovery, pagination and invalid credentials. Verify Android file sharing and desktop download/email attachment behavior on actual devices. Confirm no secret or real contact fixture is tracked before pushing. Until rollout completes, cloud recovery and uploads may report unavailable; local approvals and exports remain usable.

### Secret rotation

Rotate the administrator passcode with `npx wrangler secret put BACKUP_ADMIN_PASSCODE`, entering the replacement at the prompt, and distribute it privately to administrators. Existing in-memory recovery sessions are rejected on their next API request and must unlock again. Rotate `TEAM_PASSCODE` or `GEMINI_API_KEY` with the corresponding `wrangler secret put` command; the team must lock/unlock with the replacement team passcode. Keep secrets out of logs, screenshots, issues and source files.

### Cloudflare administrator deletion

There is no deletion UI in this version. To remove one event's cloud contact text:

1. In Cloudflare's D1 console, open **aaj-contact-scan-backup**. Confirm the database name; do not use the usage database.
2. Identify the exact event/date and its 64-character hexadecimal `event_key` using this metadata-only query:

```sql
SELECT event_key, MIN(event_name) AS event_name, MIN(event_date) AS event_date,
       COUNT(*) AS contact_count
FROM backup_contacts GROUP BY event_key ORDER BY event_date DESC;
```

3. Confirm the target, then substitute its verified hexadecimal key into the following query and execute deliberately:

```sql
DELETE FROM backup_contacts WHERE event_key = '<verified-64-character-event-key>';
```

4. Repeat the metadata query to confirm the event is gone. To remove one contact or phone batch instead, use the verified `contact_id` or `batch_id` in an equivalent scoped `DELETE`; avoid exposing contact fields in console output.
5. Remove matching approved contacts/pending uploads from participating phones so later retries or corrections cannot recreate the cloud record. Also handle downloaded CSV copies under AAJ's policy. SQL deletion removes live records; Cloudflare recovery/Time Travel retention is separate and must be checked in the account's D1 settings for any erasure request.

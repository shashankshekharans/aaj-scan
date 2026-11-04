# Operations Runbook

## Routine checks

- Confirm the live Worker responds and the app reports **Online**.
- Use synthetic cards for smoke tests.
- Review provider dashboards for real quota and billing information.
- Keep a CSV until every approved card shows **Backed Up**.
- Review D1 retention monthly.

## Credential rotation

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TEAM_PASSCODE
npx wrangler secret put BACKUP_ADMIN_PASSCODE
```

The commands prompt interactively. After rotating `TEAM_PASSCODE`, users lock and unlock with the replacement. After rotating `BACKUP_ADMIN_PASSCODE`, existing in-memory recovery sessions fail on their next request and must unlock again. API keys and passcodes must never be placed in committed files, `VITE_` variables, logs or screenshots.

## Gemini limits and automatic routing

The Worker tries `GEMINI_MODELS` from left to right. Quota, rate-limit, capacity, timeout and model-availability failures rotate to the next configured Gemini model. If the pool is unavailable, Cloudflare Workers AI is the fallback. Authentication and invalid-request failures do not rotate blindly.

`GEMINI_DAILY_LIMITS` powers an estimate only. Copy current values from the Gemini account dashboard and update them when the provider changes the plan. The provider dashboard is authoritative; the app cannot know every shared-project or rolling-window limit exactly.

## CSV recovery

1. Unlock the scanner and open **Settings → Cloud Backups**.
2. Enter the separate administrator passcode.
3. Locate the event name and local event date.
4. Download the consolidated recovery CSV.
5. Lock backups or leave Settings when finished.

The administrator passcode lives only in React memory. Event lists expose counts and timestamps, not individual fields. Team credentials can upload approved records but cannot list or download backups.

## Data retained

`USAGE_DB` contains provider/model/status/token metadata and scan identifiers, not contact fields. `BACKUP_DB` contains approved contact text, event metadata, source IDs and timestamps. It never receives card photographs, raw OCR, passcodes or API keys.

AAJ V1 operational policy: keep approved backup text only until its campaign hand-off has been verified, with a maximum routine retention target of **180 days**. An administrator reviews and deletes expired events monthly. This is a manual V1 control; each adopter must choose and document a retention period appropriate to its consent and business obligations.

## Delete a backed-up event

In Cloudflare's D1 console, open the backup database, not the usage database. First identify the exact event without selecting contact fields:

```sql
SELECT event_key, MIN(event_name) AS event_name, MIN(event_date) AS event_date,
       COUNT(*) AS contact_count
FROM backup_contacts
GROUP BY event_key
ORDER BY event_date DESC;
```

After verifying the 64-character hexadecimal key:

```sql
DELETE FROM backup_contacts
WHERE event_key = '<verified-64-character-event-key>';
```

Repeat the metadata query to confirm deletion. Remove matching local pending uploads so a later retry cannot recreate the record. Handle downloaded CSV copies separately. Cloudflare recovery/Time Travel retention is separate from live-row deletion and must be reviewed in the account settings.

## Credential exposure response

1. Rotate the affected secret immediately.
2. Check Cloudflare observability and provider usage for unexpected requests.
3. Invalidate or restrict the exposed provider key in its dashboard.
4. Search Git history, issues, build logs and screenshots for the value.
5. If committed, remove it from history only after rotation; history rewriting alone does not revoke a credential.
6. Notify the organization owner if contact data may have been accessed.


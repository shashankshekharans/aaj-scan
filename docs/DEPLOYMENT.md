# Deploy Your Own Contact Scan

This repository is the source for AAJ's reference deployment. A fork must create its own Cloudflare Worker, D1 databases, API key and passcodes. Never point a fork at AAJ's Worker or database IDs.

## Prerequisites

- Node.js 24+
- A Cloudflare account with Workers, Workers AI and D1 access
- A Google AI Studio Gemini API key
- Wrangler authenticated to the intended Cloudflare account

## 1. Install and verify

```bash
git clone https://github.com/<your-account>/<your-repository>.git
cd <your-repository>
npm install
npm test
npm run build
npx wrangler whoami
```

## 2. Create isolated D1 databases

```bash
npx wrangler d1 create contact-scan-usage
npx wrangler d1 create contact-scan-backup
```

Replace both `database_id` values and, if desired, the database names in `wrangler.jsonc` with the values returned for your account. Do not copy AAJ's IDs into another deployment.

Apply each migration directory only to its matching binding:

```bash
npx wrangler d1 migrations apply USAGE_DB --remote
npx wrangler d1 migrations apply BACKUP_DB --remote
```

## 3. Choose a unique Worker name

Change `name` in `wrangler.jsonc`. Cloudflare will publish it under your account's `workers.dev` subdomain. The two rate-limit namespace IDs only need to be unique within your Cloudflare account; change `1001` and `1002` if those values are already used by another Worker.

## 4. Create secrets interactively

Use long, unique values. These commands prompt securely; do not place secret values in the command, source code, screenshots or issues.

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TEAM_PASSCODE
npx wrangler secret put BACKUP_ADMIN_PASSCODE
```

The administrator passcode must be different from the team passcode. Never prefix a secret with `VITE_`; Vite-prefixed values are browser-visible.

For local Worker development, put the same names in git-ignored `.dev.vars`. `.env` is used by the optional evaluation harness and public, non-secret Vite configuration.

## 5. Configure model routing

Optional Worker variables:

- `GEMINI_MODELS`: comma-separated preferred order.
- `GEMINI_DAILY_LIMITS`: comma-separated `model:requests` values copied from the account's current provider dashboard.
- `CF_MODEL`: Workers AI fallback model.

Do not guess or copy another account's quotas. Provider dashboards remain authoritative.

## 6. Replace the branding

Replace the logo/icon assets in `public/`, update the title and public links in `index.html` and adjust the CSS tokens in `src/styles.css`. The AAJ name and logo identify the reference deployment and are not granted as reusable trademarks by the MIT code licence.

## 7. Deploy and verify

```bash
npm test
npm run build
npx wrangler deploy --dry-run
npx wrangler deploy
```

Verify on a real phone:

1. Invalid passcodes fail and repeated invalid attempts are throttled.
2. A valid team passcode unlocks scanning.
3. A synthetic card can be captured, reviewed, edited and approved.
4. CSV download/native share works.
5. Approved text reports **Backed Up**.
6. The separate administrator passcode can list an event and download its recovery CSV.
7. The usage and backup databases belong to your Cloudflare account.

## Updating a deployment

Pull changes, read the release notes, apply any new migrations to the correct database, run the full verification commands and deploy. Rotate secrets immediately if a key is ever committed, pasted into an issue or exposed in a screenshot.


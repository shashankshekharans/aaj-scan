# AAJ Contact Scan → Public Template Plan

Status: **Planned**  
Recorded: **2026-10-31**

This document preserves the agreed plan for finishing the private AAJ Contact Scan application and producing a separate, reusable public Contact Scan template. It is the project checklist and should be updated as work is completed.

## 1. Finalize AAJ Contact Scan

- [ ] Complete the premium light-mode interface.
- [ ] Review mobile layouts on the Android phones used by the marketing team.
- [ ] Confirm camera capture, gallery upload, review, correction and CSV export flows.
- [ ] Pilot the complete workflow with a small real event batch.
- [ ] Review the first exported CSV before importing it into HubSpot.
- [ ] Resolve issues discovered during the pilot.
- [ ] Tag the approved stable version as `v1.0.0`.
- [ ] Make the `aaj-scan` repository private.

Making the repository private will not disable the deployed Cloudflare Worker. If Cloudflare Git-based automatic deployment is enabled later, Cloudflare must be granted access to the private repository.

## 2. Prepare Safe Documentation Screenshots

AAJ application screenshots may be used to explain the public template's real-world use case, subject to these rules:

- [ ] Use only synthetic names, companies, emails and phone numbers.
- [ ] Create a dedicated batch clearly labelled **Demonstration data**.
- [ ] Do not show genuine business-card photographs.
- [ ] Do not show real event names, contacts, internal statistics or customer information.
- [ ] Do not show passcodes, API keys, Cloudflare account details or developer tools.
- [ ] Obtain AAJ approval for public use of the AAJ name, logo and interface screenshots.
- [ ] Crop screenshots deliberately and check every visible detail before publishing.
- [ ] Add descriptive alt text for accessibility.

## 3. Create the Generic Public Repository

- [ ] Create a new repository with a general product name such as `contact-scan`.
- [ ] Start it with a fresh Git history and a clean initial commit.
- [ ] Do **not** publish a fork, mirror or history-preserving duplicate of `aaj-scan`.
- [ ] Run a secret and personal-data review before the first public push.
- [ ] Make the repository public only after the sanitization review passes.
- [ ] Add an appropriate open-source licence.

A fresh history prevents deleted AAJ branding, internal decisions, evaluation files or accidentally committed information from remaining visible in older commits.

## 4. Make the Application Configurable

Move all organization-specific presentation into a documented configuration layer:

- [ ] Application name
- [ ] Company name
- [ ] Tagline
- [ ] Logo and PWA icon
- [ ] Primary, accent, background and text colors
- [ ] Typography
- [ ] CSV export format
- [ ] CRM field mapping
- [ ] Gemini model order
- [ ] Optional provider fallbacks

No secrets belong in this configuration. API keys and passcodes must remain Cloudflare Worker secrets.

Suggested public defaults:

```ts
{
  appName: "Contact Scan",
  companyName: "Your Company",
  tagline: "Business cards to CRM",
  logo: "/logo.svg",
  primaryColor: "#C22028",
  accentColor: "#CCA43B",
  csvFormat: "hubspot"
}
```

## 5. Public Deployment Experience

The intended user journey is:

1. Open the public GitHub repository.
2. Select **Deploy to Cloudflare**.
3. Connect a Cloudflare account.
4. Enter a personal Gemini API key and team passcode as secrets.
5. Let Cloudflare provision Workers AI and deploy the application.
6. Receive an independent `workers.dev` address.
7. Install the application as a PWA.

Each organization must deploy its own copy. Public users must never share AAJ's Worker, passcode, API quota or stored browser data.

## 6. Public Documentation Checklist

- [ ] Product overview and feature list
- [ ] Carefully sanitized AAJ screenshots
- [ ] Architecture diagram
- [ ] Setup and deployment flowchart
- [ ] Privacy and data-flow diagram
- [ ] Gemini API key instructions
- [ ] Cloudflare account and Worker setup instructions
- [ ] One-click **Deploy to Cloudflare** button
- [ ] Manual deployment instructions
- [ ] Branding and configuration guide
- [ ] API-key rotation guide
- [ ] Android PWA installation guide
- [ ] CSV and HubSpot import guide
- [ ] Synthetic demonstration card and example output
- [ ] Troubleshooting guide
- [ ] Security policy
- [ ] Privacy considerations
- [ ] Supported providers and automatic failover behavior
- [ ] API quota, free-tier and cost limitations
- [ ] Contribution instructions
- [ ] Open-source licence

## 7. Independent Release Validation

Before announcing the public template:

- [ ] Deploy it from a completely new Cloudflare account.
- [ ] Use newly created API credentials.
- [ ] Follow only the published instructions—do not rely on project knowledge.
- [ ] Confirm no AAJ-specific content appears in the generic deployment.
- [ ] Confirm secrets never enter GitHub or browser-delivered JavaScript.
- [ ] Confirm card images and contacts stay in the user's browser except during authorized AI processing.
- [ ] Test Android installation, capture, review, editing and CSV export.
- [ ] Test Gemini quota failover and Workers AI fallback.
- [ ] Confirm the public deployment can be updated from its own repository.

## 8. Long-Term Repository Model

```text
Public contact-scan repository
        │
        ├── reusable scanning, validation and deployment improvements
        │
        └── private aaj-scan repository
                └── AAJ branding and production configuration
```

- Treat the public generic repository as the reusable upstream product.
- Keep AAJ branding, deployment values and organization-specific changes private.
- Develop general bug fixes and features in the public repository first, then bring them into `aaj-scan`.
- Backport urgent AAJ fixes to the public repository only after removing organization-specific information.
- Record releases with version tags and release notes.
- Periodically test API model availability, quotas and deployment instructions.

## Definition of Done

The project is complete when:

1. AAJ Contact Scan is approved, piloted, tagged and private.
2. The public repository has a clean history and no AAJ-sensitive information.
3. A new user can deploy a private working copy using only the published instructions.
4. Every deployment uses the user's own secrets, Cloudflare account and AI quota.
5. The public template and private AAJ deployment can receive shared improvements without exposing AAJ-specific configuration.

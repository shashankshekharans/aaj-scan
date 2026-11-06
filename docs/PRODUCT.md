# Product Brief - AAJ Contact Scan

## Platform

web

## Users

The primary users are AAJ marketing team members collecting business cards at trade shows and events, often on Android phones under time pressure. Repository visitors are technical teams evaluating or deploying an isolated copy for their own organization.

## Product Purpose

AAJ Contact Scan converts event business-card photos into reviewed, HubSpot-ready contact records. Success means a team can capture quickly in the field, verify every extracted field, share a CSV and recover approved contact text if a phone export is missed.

## Positioning

The product combines adaptive AI extraction with mandatory human approval, offline-first batch handling and text-only centralized recovery. It makes uncertainty visible instead of silently treating model output as a trusted contact.

## Operating Context

Users work from mobile browsers or an installed PWA, create an event batch, capture one card per photo, review and correct fields, approve contacts and share a CSV. Cloudflare Workers provides authenticated routing, D1 usage metadata and approved-text backup. Gemini is primary; Workers AI is the configured fallback.

## Capabilities and Constraints

- Light-mode-only interface optimized for visibility at events.
- Camera and gallery intake with local IndexedDB persistence.
- Automatic Gemini model rotation and Cloudflare Workers AI fallback.
- Separate team scanning and administrator recovery credentials.
- Card photos are never centrally backed up; approved text may be retained in D1.
- Production remains at `https://aaj.contact-scan.workers.dev/`.
- The public repository must contain no credentials or real contact data.
- Forks must create isolated Cloudflare resources and secrets.

## Brand Commitments

The AAJ reference deployment uses the supplied AAJ logo, the red/ivory/charcoal brand palette, Plus Jakarta Sans for display text and Inter for interface/body text. The public product story should feel modern, premium, direct and trustworthy without becoming dark, flashy or visually distracting.

## Evidence on Hand

- Live production deployment, tested end to end on real Android devices.
- Twelve synthetic business cards, confirmed fictional, under `demo/synthetic-cards/`.
- README hero and two animated demos under `docs/assets/`, recorded from the real app with a synthetic card.
- Provider evaluation in `docs/EVALUATION_RESULTS.md`.
- No testimonials, adoption metrics, pricing claims or public customer logos beyond AAJ; future surfaces must not fabricate them.

## Product Principles

1. Human confirmation outranks model confidence.
2. Field capture must remain calm, legible and resilient.
3. Privacy boundaries are explained in plain language.
4. Operational recovery must not weaken team-access separation.
5. Public deployment guidance must create isolation by default.

## Accessibility & Inclusion

Keyboard access, visible focus, reduced-motion support, clear status text in addition to color, touch-friendly controls and responsive layouts are required.


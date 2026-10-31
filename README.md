# Aurevia CRM

Aurevia CRM is a clinic operations CRM built with Next.js 16, React 19,
TypeScript and Supabase. It supports lead management and imports, Meta lead
forms, daily agent work, appointments, attendance, analytics, follow-ups and
team activity. The interface and CRM help assistant use English throughout.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and fill in the values needed for the
   features you want to run.
3. Start the app with `npm run dev` and open <http://localhost:3000>.

Do not commit `.env.local`, access tokens, service-role keys or Meta app
secrets. Server-only secrets must never use a `NEXT_PUBLIC_` prefix.

## Database changes

Apply SQL files in `supabase/migrations/` to Supabase before deploying code
that depends on them. The October 12 workflow migrations are required for
appointments, calling, reporting and daily automation. The latest Meta and
function-hardening migration makes Meta delivery writes idempotent and removes
anonymous RPC access to trigger helpers. Review [CRM operations](docs/CRM-OPERATIONS.md)
for rollout order, backups, capacity and verification.

See the root [production guide](PRODUCTION.md) for role and workflow contracts,
feature-to-file ownership, release checks and the change log. Update that guide
in the same change whenever production behavior, permissions or data rules
change.

## Meta lead forms

The CRM receives Meta Lead Ads through `/api/meta-webhook`. Setup requires a
Meta developer app, a Page connected to the lead form, a Page access token with
lead retrieval access, the Meta app secret and a private verification token.
The webhook rejects deliveries unless the Meta app secret is configured, then
verifies `X-Hub-Signature-256` before fetching or saving patient details. See
[Meta lead setup](docs/META-LEADS.md) for the exact dashboard steps.

## Verification

Run `npm run lint`, `npm run build` and the relevant feature checks, including
`npm run verify:meta` and `npm run verify:crm-migrations`. The local migration
verification uses an isolated database and never connects to production.

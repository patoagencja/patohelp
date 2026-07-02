# Pato Client Dashboard — Engineering Guide

> Compact working reference. See `PROMPT.md` for the full roadmap and phases.

## 1. What we're building

Pato Client Dashboard — a multi-tenant SaaS for a marketing agency's clients.
A client logs in and sees their live Meta Ads, Google Ads and GA4 data in one
place, in good UX. Replaces logging into 5 separate panels.

First (and only MVP) client: **DRE** (Polish door manufacturer). Client type:
**engagement/traffic — NOT e-commerce**. Key metrics: CTR, CPC, sessions,
engagement, reach, frequency. **Do not show ROAS or conversion revenue** — DRE
does not sell online. UI language: **Polish**. Code, comments, commits:
**English**.

## 2. MVP goal

One screen for a DRE user:

1. Top: 4 KPI cards for the current month + delta vs previous (ad spend, ad
   clicks, GA4 sessions, avg CTR).
2. Main chart: 30-day trend — paid sessions vs spend (dual Y axis).
3. Active campaigns: combined Meta + Google table, sortable, statuses 🟢🟡🔴.
4. GA4 traffic sources: paid/organic/social/direct + devices + top 5 pages.
5. AI summary: 3–4 Polish sentences "what's happening this week", generated
   once a day.

One scroll, everything known. No 20-column tables. No 15 charts.

## 3. Stack (LOCKED — do not propose alternatives)

- Next.js 14 App Router + TypeScript
- Tailwind + shadcn/ui + Tremor (Tremor for charts + dashboard cards)
- Supabase — Postgres + Auth (magic link) + OAuth token storage
- Vercel — hosting + Vercel Cron for hourly data refresh
- Anthropic Claude API — daily AI summary
- pnpm — package manager. NOT npm, NOT yarn.

No Django, Redis, tRPC, Prisma, Drizzle, Zustand, Redux, React Query, SWR,
Vite, MongoDB, etc. The stack is closed.

## 4. Architecture

Data flow: Vercel Cron (hourly) → integrations pull from APIs → normalize →
write to Supabase → UI reads from Supabase (fast, cached). **Never hit
Meta/Google/GA4 APIs on page load. Always read from Supabase.**

Multi-tenant ready from day 1, single-tenant in production. Every table has
`client_id` from the start. RLS in Supabase checks `user.client_id ===
row.client_id`.

URL: `dashboard.patoagencja.com/<client_slug>` — DRE is `/dre`. Paths, not
subdomains.

Auth:

- Agency users (us): access to all clients. Roles: `admin`, `member`.
- Client users (DRE): only their own. Role: `client`.
- Login: Supabase magic link. No passwords.
- RLS on every table.

## 5. Database schema (initial)

Tables: `clients`, `users`, `integrations`, `ads_daily`, `ga4_daily`,
`ai_summaries`, `sync_runs`. See `supabase/migrations/0001_initial_schema.sql`.

- **Money**: all amounts in PLN, stored as `bigint` minor units (grosze).
  Divide by 100 in UI.
- **Timezone**: UTC in DB, format to `Europe/Warsaw` in UI only. Use
  `date-fns` + `date-fns-tz`.
- **RLS**: every table filtered by `client_id`. Client sees only their own.
  Admin/member see all. Helper: SQL function `is_agency_user()` used in all
  policies.

## 6. Data sources

- **Meta Marketing API**: reuse `META_APP_ID`/`META_APP_SECRET`. Per-client
  user access tokens stored encrypted in `integrations.credentials_encrypted`
  (via `lib/integrations/encryption.ts`, keyed by `ENCRYPTION_KEY`). Account
  IDs in `integrations.account_ids`. Metrics: campaign_id, campaign_name,
  date, spend, impressions, clicks, ctr, cpc, reach, frequency, conversions
  (tracked, not shown as ROAS).
- **Google Ads API**: DRE has 3 accounts (`dre`, `dre 2024`, `dre 2025`) —
  pull all three, combine in UI. Reuse `GOOGLE_ADS_*` env. Customer IDs in
  `integrations.account_ids`.
- **GA4 Data API**: server-side OAuth (`googleapis`). Property ID in
  `integrations.account_ids`. Reports: sessions by sourceMedium, by
  deviceCategory, top pages, new vs returning users, engagementRate.

## 7. Folder structure

See `PROMPT.md` section 7 for the full tree. Key roots: `app/` (routes,
grouped `(auth)`/`(dashboard)`), `components/ui` (shadcn) + `components/dashboard`,
`lib/supabase`, `lib/integrations`, `lib/ai`, `supabase/migrations`,
`middleware.ts`, `vercel.json`.

## 8. Code conventions

- Server Components by default. `"use client"` only when interaction is needed.
- Server Actions for mutations. Don't add `/api/*` routes when a Server Action
  works.
- Types everywhere. `zod` for input validation, generated Supabase types for DB.
- TypeScript only. No `.js` (config files aside).
- Group by feature, not by type.
- Tailwind + shadcn tokens. No inline hex colours. No CSS files besides
  `globals.css`.
- Comments explain WHY, not WHAT.
- Commit messages in English: `verb: what` (e.g. `add: meta oauth flow`).

## 9. Do's and Don'ts

Do: Tremor for charts/cards; shadcn/ui for form/button/dialog; `date-fns` +
`date-fns-tz`; server-side fetching in RSC; a "test connection" endpoint per
integration; UTC in DB → Europe/Warsaw in UI; money as `bigint` minor units.

Don't: OAuth tokens in `.env` (they belong per-client in Supabase, encrypted);
hitting external APIs on page load; `/api/hello`-style test routes in commits;
`getServerSideProps` (this is App Router); proposing stack changes; inventing
metrics for DRE (engagement client = engagement metrics only); showing prices,
agency fees or internal costs (client sees ONLY their own ad spend).

## 10. Env vars

See `.env.local.example`. `.env.local` is gitignored; `.env.local.example` is
committed. Secrets (ENCRYPTION_KEY, CRON_SECRET) generated with `openssl`.

## Roadmap

See `PROMPT.md` for the full roadmap (Phase 1 foundation, Phase 2 integrations,
Phase 3 UI + AI + polish).

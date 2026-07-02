# PROMPT — Pato Client Dashboard (full roadmap)

Pełna instrukcja projektu: kontekst, stack, plan na cały projekt. `CLAUDE.md`
zawiera skróconą wersję sekcji 1–10; ten plik trzyma pełny roadmap i 3 fazy.

## 1. Co budujemy

Pato Client Dashboard — multi-tenant SaaS dla klientów agencji marketingowej.
Klient loguje się i widzi w jednym miejscu live dane ze swoich Meta Ads,
Google Ads i GA4 w ładnym UX.

Pierwszy (i jedyny na MVP) klient: **DRE** (producent drzwi). Typ:
**engagement/traffic — NIE e-commerce**. Metryki: CTR, CPC, sesje, engagement,
reach, frequency. **Bez ROAS i conversion revenue.** UI po polsku, kod po
angielsku.

## 2. Cel MVP

Jeden ekran: 4 karty KPI (miesiąc + delta), wykres trendu 30 dni (sesje paid vs
wydatki, podwójna oś), tabela kampanii Meta+Google (sortowalna, statusy
🟢🟡🔴), źródła ruchu GA4 (paid/organic/social/direct + urządzenia + top 5
stron), AI summary (3–4 zdania PL, raz dziennie).

## 3. Stack (LOCKED)

Next.js 14 App Router + TypeScript · Tailwind + shadcn/ui + Tremor · Supabase
(Postgres + Auth magic link + storage tokenów) · Vercel + Vercel Cron ·
Anthropic Claude API · pnpm. Bez alternatyw.

## 4. Architektura

Vercel Cron (co godzinę) → integracje pullują dane → normalizacja → zapis do
Supabase → UI czyta z Supabase. Nigdy nie uderzaj w zewnętrzne API przy
załadowaniu strony. Multi-tenant od dnia 1: każda tabela ma `client_id`, RLS
sprawdza `user.client_id === row.client_id`. URL `/<client_slug>` (DRE = `/dre`).
Role: `admin`, `member` (agencja, wszyscy klienci), `client` (tylko swoi).
Login: magic link, bez haseł. RLS na każdej tabeli.

## 5. Schemat bazy

`clients`, `users`, `integrations`, `ads_daily`, `ga4_daily`, `ai_summaries`,
`sync_runs` — patrz `supabase/migrations/`. Pieniądze: `bigint` w groszach (÷100
w UI). Czas: UTC w DB, `Europe/Warsaw` w UI (`date-fns` + `date-fns-tz`). RLS:
helper `is_agency_user()`, filtr po `client_id` w każdej policy.

## 6. Źródła danych

- **Meta Marketing API** — `META_APP_ID`/`META_APP_SECRET`, per-klient token
  (encrypted) w `integrations`. Account IDs w `integrations.account_ids`.
- **Google Ads API** — DRE ma 3 konta (`dre`, `dre 2024`, `dre 2025`), łączymy
  w UI. `GOOGLE_ADS_*` z env, customer IDs w `account_ids`.
- **GA4 Data API** — OAuth server-side (`googleapis`), property ID w
  `account_ids`. Raporty: sourceMedium, deviceCategory, top pages, new vs
  returning, engagementRate.

## 7. Struktura folderów

```
app/
  (auth)/login/page.tsx
  (auth)/auth/callback/route.ts
  (dashboard)/layout.tsx
  (dashboard)/[clientSlug]/page.tsx
  (dashboard)/[clientSlug]/settings/page.tsx
  api/cron/{refresh-ads,refresh-ga4,generate-summary}/route.ts
  api/integrations/{meta,google-ads,ga4}/{connect,callback}/route.ts
  layout.tsx
  page.tsx
components/ui/            # shadcn primitives
components/dashboard/     # kpi-cards, trend-chart, campaigns-table,
                         # traffic-sources, ai-summary-card, empty-state
lib/supabase/{client,server,admin}.ts
lib/integrations/{meta-ads,google-ads,ga4,encryption}.ts
lib/ai/summary.ts
lib/utils.ts
lib/types.ts
types/database.ts        # generated from Supabase CLI
supabase/migrations/{0001_initial_schema,0002_rls_policies,0003_seed_dre}.sql
middleware.ts
vercel.json
```

## 8. Konwencje kodu

Server Components domyślnie; `"use client"` tylko przy interakcji. Server
Actions dla mutacji. Typy wszędzie (`zod` na input, generated types z Supabase).
Tylko TypeScript. Grupowanie po feature. Tailwind + shadcn tokens, bez inline
hex, bez CSS poza `globals.css`. Komentarze = WHY. Commity: `verb: what`.

## 9. Do's i Don'ts

**Rób:** Tremor (wykresy/karty), shadcn/ui (form/button/dialog), `date-fns(-tz)`,
fetch server-side w RSC, "test connection" endpoint per integracja, UTC→Warsaw,
pieniądze jako `bigint` grosze.

**Nie rób:** tokenów OAuth w `.env` (per-klient w Supabase, encrypted), uderzania
w API przy load strony, testowych route'ów w commicie, `getServerSideProps`,
zmian stacku, wymyślania metryk dla DRE, pokazywania cen/fee/kosztów agencji.

## 10. Env vars

Patrz `.env.local.example`. `.env.local` w `.gitignore`. Sekrety
(`ENCRYPTION_KEY`, `CRON_SECRET`) generowane przez `openssl`.

## 11. Pełny plan — 3 fazy

### FAZA 1 — Foundation (zrobione)

Bootstrap Next 14 + TS, Tremor/shadcn/Tailwind, deps, struktura folderów,
`CLAUDE.md`, env example + `.gitignore` + `vercel.json`, migracje SQL (schema +
RLS + seed DRE), Supabase client wrappery, encryption helper, `lib/utils.ts`
(cn + formatery), middleware auth, strony auth (magic link + callback), layout
dashboardu, placeholder strony klienta, landing z redirectem. `pnpm build` bez
błędów. Na końcu checklist manualnych kroków dla Daniela (Supabase, Meta app,
Google Cloud, sekrety, `.env.local`, test logowania).

### FAZA 2 — Integracje

Meta Ads OAuth + fetch → Google Ads OAuth + fetch → GA4 OAuth + fetch → cron
endpointy → `ads_daily` i `ga4_daily` faktycznie zapełnione. Dashboard nadal
pokazuje placeholdery, ale w tle są dane.

### FAZA 3 — UI + AI + polish

Wszystkie 5 komponentów dashboardu (KPI cards, trend chart, campaigns table,
traffic sources, AI summary). Design polish. Deploy na Vercel z custom domain.
Provision DRE usera. Pokaz klientowi.

## 12. Zasady współpracy

Działaj autonomicznie w ramach fazy. Commituj po każdym logicznym kawałku.
Pytaj tylko o: sekrety/klucze API, decyzje biznesowe, sprzeczności w dokumencie,
realne blockery. Komunikaty do Daniela po polsku; kod, komentarze, commity po
angielsku.

# Samaritan Industrial — Supabase + Vercel

**Samaritan Industrial** — multi-vendor retail management and a public marketplace, by
Samaritan Techs. It is the Apps Script *Business Operator* rebuilt on the same stack and
conventions as HOPE PMO, plus the phone-retail additions for multi-shop dealers (branches,
IMEI units, credit sales via financing partners, discounts, soft-cancel, stock movements,
yearly reports).

The product name lives in one place, `api/_lib/brand.js`, and can be overridden per deployment
with an `APP_NAME` environment variable. The folder, the package and the database stay named
`business-operator`: those are internal, and renaming them would break the deployment's Root
Directory setting for nothing.

- **The whole story:** [`docs/CLAUDE_CODE_HANDOFF.md`](docs/CLAUDE_CODE_HANDOFF.md) (what it is, every feature, the data dictionary).
- **What the code agrees on:** [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md).
- **Why things are the way they are:** [`DECISIONS.md`](DECISIONS.md).
- **Setup + migration + cut-over:** [`docs/SETUP.md`](docs/SETUP.md).
- **The legacy source of truth:** `legacy/Code.gs`, `legacy/App.html` (read-only reference).

## Layout (same as HOPE PMO)

```
public/index.html      the app: marketplace (public) -> login/register -> the workspace
public/bo/*.js         one file per tab (dashboard, sell, lendings, products, stock, users, cash, reports, manager, settings)
api/auth.js            /api/auth    login, register, reset, me
api/bo.js              /api/bo      every signed-in call: { token, fn, args }
api/market.js          /api/market  the public marketplace
api/report.js          /api/report  PDF / Excel downloads (signed ticket)
api/_lib/              auth, supabase (paging past the 1000-row cap), email (Resend), storage, pdf, xlsx
api/_lib/bo/*.js       the logic, one module per area; stock.js is the ONE door for stock changes
db/schema.sql          the complete database, idempotent
migrate/               CSV exports of the nine sheets -> Postgres, one file at a time
test/                  npm test is the gate (fake PostgREST, no network)
```

## Run it

```bash
cd business-operator
npm install
npm test                       # the gate
npm run dev                    # local: serves public/ + the API against an in-memory fake, seeded
```

Deploy: Vercel project with **Root Directory = `business-operator`**, env vars from `.env.example`.
Database: a **separate Supabase project** (`business-operator`, same org as hope-pmo / hoop-pmo,
eu-west-1) — run `db/schema.sql` in its SQL editor once.

## The standing rules (inherited from HOPE PMO)

- **`npm test` is the gate.** Not "it looked fine".
- **Server logic lives in `api/_lib/`**, so it runs without a browser.
- **Vendor scoping happens in the query**, never by fetching everything and filtering.
- **The Postgres budget:** every change says what it costs in round trips and rows (`test/speed.test.mjs`).
- **The hint table stays current:** a new screen or field ships with a bilingual tip.
- **Additive, whole files.** Never remove a working column or figure to make room.

# Setting up Samaritan Industrial

From an empty Supabase organisation to a working deployment, in the order the steps depend on
each other. Nothing here touches HOPE PMO or HOOP: this app has its **own database project**,
its **own Vercel project** and its **own environment variables**, and the only thing it shares
with them is the git repository it happens to live in.

Work through sections 1 to 5 in order; each one proves the one before it. Section 6 is an
appendix you can ignore — this system starts empty and fills up as you use it.

---

## 1. The database (Supabase)

Create a **new project** in the same organisation as `hope-pmo` and `hoop-pmo`:

- **Name:** `business-operator`
- **Region:** `eu-west-1` (the same as the others, so latency is the same)
- **Database password:** generate one and put it in the password manager. You will not need it
  day to day; the app authenticates with the service-role key, not this password.

> **Why a separate project and not another schema in HOPE's?** A shared project means one
> connection pool, one set of backups and one blast radius: a runaway query on the marketplace
> would slow the loan officers' dashboards, and a restore to recover one app would roll back
> the other. Separate projects cost nothing extra on the same organisation.

Then, in that project only, **SQL Editor → New query**, paste the whole of
[`db/schema.sql`](../db/schema.sql), and run it. It creates the tables, the enums, the
marketplace view, the storage buckets, the database-side aggregates and the default settings.

It is **idempotent** — every statement is `if not exists` / `or replace`, and columns added
after the first release come with their own `alter table ... add column if not exists` — so
running the whole file again after an update is safe, and is how a database made last month
gets this month's functions and columns.

Check it landed: **Table Editor** should list `vendors`, `profiles`, `products`, `sales`,
`product_units`, `stock_movements` and the rest; **Database → Functions** should list five
`bo_*` functions; **Storage** should list `product-images`, `logos`, `profile-photos`.

### The keys you need

**Project Settings → API**, and copy two values:

| Value | Goes into | Never |
|---|---|---|
| Project URL | `SUPABASE_URL` | — |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` | in a browser, in git, in a screenshot |

The **anon key is not used** by this app and you can ignore it. The API layer enforces every
role and vendor rule itself in `api/_lib/`, which is the same trust model HOPE PMO runs on:
the browser holds a session token, never a database key.

> Row Level Security is **not** what protects this data — the service-role key bypasses RLS by
> design. What protects it is that the key only ever exists on the server, and every request
> goes through `api/bo.js`, which resolves a session and then a role before it reads anything.

---

## 2. The setup key

A brand-new system has **nobody in it**, and the sign-up form on the marketplace only ever
creates a *business* and its admin. That is deliberate: a manager can activate and restrict
businesses, change system settings and send email, so it must never be self-service.

Instead the system offers a **one-time setup screen** the first time anybody opens it, and it
asks for a key that only you have. Decide that key now and keep it with the database password:

> A long random line. Anything you like, as long as it is not guessable, for example
> `sam-ind-2026-9f3b-quiet-river-4471`.

You will paste it into the deployment's settings in step 3 as **`BO_SETUP_KEY`**, and type it
once on the setup screen in step 4. After that it does nothing: the setup screen never appears
again, because the system now has a manager.

## 3. The deployment (Vercel)

New project from this repository, and the one setting that matters:

| Setting | Value |
|---|---|
| **Root Directory** | `business-operator` |
| Framework preset | Other |
| Build command | *(none)* |
| Output directory | *(none)* |
| Install command | `npm install` |

**Root Directory is the whole trick.** The repository root is HOPE PMO, with its own
`vercel.json` and its own `api/`. Pointing this project at the subfolder gives Business
Operator its own routes, its own functions and its own deployments, with no chance of one
app's API answering the other's request.

There is **no build step** by design: `public/` is served exactly as written, so what you read
in the repository is what runs in the browser.

### Environment variables

**Project Settings → Environment Variables**, set for **Production *and* Preview**, from
[`.env.example`](../.env.example):

| Variable | Required | What happens without it |
|---|---|---|
| `SUPABASE_URL` | **yes** | nothing works |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | nothing works |
| `BO_SETUP_KEY` | **yes, at first** | the setup screen refuses to create anything and says so |
| `BO_SECRET` | recommended | report-download tickets are signed with a secret derived from the service-role key instead; works, but rotating one then rotates both |
| `RESEND_API_KEY` | no | the app runs; every email action says plainly that email is not configured |
| `EMAIL_FROM` | with Resend | falls back to the built-in address |
| `APP_URL` | recommended | password-reset emails cannot build a working link |
| `WHATSAPP_NUMBER` | no | the feedback button falls back to the built-in number |
| `MANAGER_EMAIL` | no | the manager summary email goes to the built-in address |

Redeploy after changing any of them — Vercel does not apply new variables to an existing build.

---

## 4. Open it and make yourself the manager

In this order, because each step proves the one under it:

1. Open the deployment. Because the system is empty, it shows **Set up this system** instead of
   a sign-in box.
2. Enter the **setup key** from step 2, your name, the **User ID** you want to sign in with
   (short, no spaces — `markii`), your email and a password. Press **Create manager account**.
   - A wrong key is refused and says so. Nothing is created.
   - If it says the deployment has no setup key, `BO_SETUP_KEY` did not reach it: check step 3
     and redeploy.
3. You are signed straight in as the manager. Reload the page — the setup screen is gone for
   good, and you get the normal sign-in box.
4. Register a business from the marketplace's **Register New Business** link, then approve it
   from the **Manager** tab. Sign in as that admin.
5. Add a product, sell it, and check the sale appears on the **Dashboard** and the stock
   dropped by one. That path exercises the database, the session, the role check and the stock
   ledger in one go.
6. **Reports → Sales → PDF.** A signed download proves `BO_SECRET` and the PDF writer.

> Prefer a terminal? `node migrate/create-manager.js --email you@example.com --name "Your Name"
> --handle you --password -` does the same job. You do not need it.

## 5. Local development

```bash
cd business-operator
npm install
npm test          # the gate: 259 tests, no network, a fake PostgREST
npm run dev       # http://localhost:8787
```

`npm run dev` serves `public/` and the whole API against an **in-memory book** — no Supabase,
no credentials, nothing to set up. It is seeded with the test fixture, so you can sign in
immediately:

| User ID | Password | Who |
|---|---|---|
| `markii` | `pass1234` | system manager |
| `frank` | `pass1234` | admin, phone shop with two branches |
| `juma` | `pass1234` | seller |
| `mama` | `pass1234` | admin, grocery |

Nothing you do there touches any real database; restarting the server resets the book.

---

## 6. Appendix: importing an old spreadsheet

**You do not need this.** This system starts empty and fills up as you use it, which is the
plan. The importer is kept only in case a workbook ever has to be brought across later.

Export the nine tabs of the Apps Script workbook as CSV (**File → Download → CSV**, one per
tab) into a single folder:

```
Users.csv  ProductsDB.csv  Sales.csv  Lendings.csv  CashTracking.csv
Settings.csv  Hints.csv  ProductClicks.csv  Suggestions.csv
```

> **`Users.csv` contains every password in clear text.** Put the folder at
> `business-operator/legacy/data/`, which is git-ignored for exactly this reason, and delete it
> once the migration has been checked. The importer hashes those passwords on the way in, so
> nobody has to reset and no readable password is ever written to the database.

```bash
node migrate/run.js legacy/data --dry-run     # parses everything, writes nothing, prints counts
node migrate/run.js legacy/data               # for real
```

Run the dry run first and check its counts against the row counts in the sheets. The importer
goes in foreign-key order, keeps every old identifier in a `legacy_*` column, and is safe to
run twice — rows already present are matched on those identifiers and skipped. `--only=users,products`
limits it to named steps when you are re-running one part.

If you ever do run it, **skip step 2** on that database: the old manager account comes across
with everybody else.

---

## Troubleshooting

| What you see | What it is |
|---|---|
| Every screen fails, `supabaseUrl is required` | `SUPABASE_URL` is unset on that environment, or set on Production only and you opened a Preview |
| Sign-in says the account or password is wrong, and you are sure it is not | signing in with the email where the account has a different **User ID** — or the business is deactivated, which refuses its users by design |
| A screen loads but one table is empty and the others are fine | usually a column the database does not have. `npm test` fails on that before deploy (`test/schema.test.mjs`), so re-run it |
| Everything is slow and the manager screens are slowest | `db/schema.sql` has not been run since the aggregate functions were added. Re-run it; the code works without them and pays a lot for it (`test/speed.test.mjs` measures both worlds) |
| An email action says email is not configured | `RESEND_API_KEY` is unset. That is the honest message, not a failure |
| A download opens a blank tab | the ticket expired (they last five minutes). Ask for it again |

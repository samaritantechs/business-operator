# Setting up Business Operator

From an empty Supabase organisation to a working deployment, in the order the steps depend on
each other. Nothing here touches HOPE PMO or HOOP: this app has its **own database project**,
its **own Vercel project** and its **own environment variables**, and the only thing it shares
with them is the git repository it happens to live in.

Two paths through this file:

| You are | Read |
|---|---|
| Starting **clean** (no data to bring over) | 1 → 2 → 3 → 4 → 5 → 7 |
| Bringing the **old spreadsheet** over | all of it, in order |

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

It is **idempotent** — every statement is `if not exists` / `or replace` — so running it again
after an update is safe and is how you install new database functions later.

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

## 2. The first manager account

A fresh database has **no people in it**, and the sign-up form on the marketplace only ever
creates a *business* and its admin. That is deliberate: a manager can activate and restrict
businesses, change system settings and send email, so it must never be self-service.

Make the first one from a terminal, once:

```bash
cd business-operator
npm install

export SUPABASE_URL=https://xxxxxxxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...

# The password is read from stdin so it stays out of your shell history.
printf '%s' 'a-long-password' | node migrate/create-manager.js \
  --email you@example.com --name "Your Name" --handle you --password -
```

It refuses to run twice: once a manager exists it prints who, and points you at
**Users → Add User** inside the app for any further accounts. Sign in with the **User ID**
(`--handle`), not the email, then change the password from **My Account**.

---

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
| `BO_SECRET` | recommended | report-download tickets are signed with a secret derived from the service-role key instead; works, but rotating one then rotates both |
| `RESEND_API_KEY` | no | the app runs; every email action says plainly that email is not configured |
| `EMAIL_FROM` | with Resend | falls back to the built-in address |
| `APP_URL` | recommended | password-reset emails cannot build a working link |
| `WHATSAPP_NUMBER` | no | the feedback button falls back to the built-in number |
| `MANAGER_EMAIL` | no | the manager summary email goes to the built-in address |

Redeploy after changing any of them — Vercel does not apply new variables to an existing build.

---

## 4. Check it works

In this order, because each step proves the one under it:

1. Open the deployment. The **marketplace** loads. On an empty database it is an empty grid,
   not an error — that is the correct empty state.
2. **Sign in** as the manager from step 2.
3. **Manager** tab: it lists no businesses yet, and the Email Centre buttons are present.
4. Register a business from the marketplace's **Register New Business** link, then approve it
   from the Manager tab. Sign in as that admin.
5. Add a product, sell it, and check the sale appears on the **Dashboard** and the stock
   dropped by one. That path exercises the database, the session, the role check and the
   stock ledger in one go.
6. **Reports → Sales → PDF.** A signed download proves `BO_SECRET` and the PDF writer.

---

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

## 6. Bringing the old spreadsheet over *(skip if starting clean)*

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

If you migrated, **skip step 2**: the old manager account comes across with everybody else.

---

## 7. Keeping the printed QR codes working *(only if the old app was in the field)*

From §9 of the handoff. Street flyers and an installed Android APK point at the old Apps
Script `/exec` URL, and neither can be recalled.

**Day one — the bridge.** Replace the Apps Script `doGet` with a redirector to the new URL
(meta-refresh plus `location.replace`, preserving query parameters) and ship it with
**Manage deployments → Edit → New version**. Never "New deployment": the `/exec` URL must
survive, and a new deployment mints a different one.

**Then — the APK.** Rebuild as **v1.3** (versionCode 4) with `APP_URL` set to the new
production URL and the new domain added to the WebView allowlist. Sign it with the **same**
permanent keystore (`samaritan.keystore`, alias `businessoperator` — Markii holds the
password; it is never committed), and replace the file **in place** on Google Drive via
**Manage versions**, so the printed QR code keeps resolving. The build recipe is in Markii's
`APK_GENERATOR_HANDOFF.md`.

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

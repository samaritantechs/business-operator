# Business Operator v2 — API contract

Every screen in `public/index.html` (+ `public/bo/*.js`) talks to the server through four routes.
Every server function lives in one module under `api/_lib/bo/`. This file is the single agreement
between the two halves: names, arguments, return shapes, and who may call what. **If a name is not
here, the page must not call it and the server must not define it** — `test/navs.test.mjs` checks
both directions.

## 1. Transport

| Route | Method | Body / query | Purpose |
|---|---|---|---|
| `/api/auth` | POST | `{ fn, args }` | before a session: `login`, `register`, `requestReset`, `resetPassword`, `logout`, `me` |
| `/api/bo` | POST | `{ token, fn, args }` | everything signed-in. `token` = the session token from login |
| `/api/market` | GET | — | the public marketplace payload (ranked, cached ~60 s) |
| `/api/market` | POST | `{ fn: 'click' \| 'hints', args }` | log a product view; visitor tips |
| `/api/report` | GET | `?t=TICKET` | a report as a file (PDF / .xlsx). Ticket from `reportTicket` |

Answers are JSON `{ ok: true, ...result }` or `{ ok: false, error: "message", restricted?: true }` with
an HTTP status (400 bad input, 401 sign in again, 403 not allowed, 404, 500). Error messages are
short, human, and where natural bilingual (Swahili / English).

Handler signature in every module: `async (db, user, args, nowMs) => result`. `db` is the Supabase
client (or the test fake), `user` the resolved session (below), `nowMs` the clock (tests pin it).
Handlers throw `badRequest(msg)` / `forbidden(msg)` / `notFound(msg)` from `_shared.js`, never raw errors.

## 2. Shapes

**Names are `snake_case`, exactly as the database columns** — rows go to the page as they come from
Postgres. Instants are ISO strings (`2026-09-02T07:12:00.000Z`); date *keys* from pickers are
`yyyy-mm-dd`; money is a plain number. All "today / this week / this month" boundaries are on the
East Africa clock (`_shared.periodBounds`).

`user` (from `resolveSession`):
```
{ id, email, name, handle, role, vendor_id, branch_id, active, profile_photo_url,
  vendor: <vendor row> | null, is_admin, is_manager }
```
`vendor` row: `{ id, legacy_name, name, business_type, phone, address, currency, logo_url,
registered_on, active, restricted, permissions, created_at }`.

`product` row: `{ id, vendor_id, legacy_id, name, category, brand, model, price, stock, is_serialized,
supplier, reorder_point, active, image1_url, image2_url, listing_type, price_unit, location, created_at }`.

**bootPayload** (what `login`, `me` and `boot` return — everything the app needs in ONE trip):
```
{ user, vendor, token?,                      // token only from login
  perms: { canDownloadReport, showDashboard },
  hints: [{ en, sw }],                       // for this role (+ 'all'); defaults when the table is empty
  timings: { hintLifetime, hintInterval, autoSyncSeconds, sessionTimeoutMinutes, loadingTime },   // numbers
  restriction: { restricted, notice },       // notice = the payment message with placeholders filled
  branches: [branch row],                    // this vendor's active branches ([] for managers)
  partners: [financing_partner row],         // vendor's + global, active
  features: { has_branches, has_serialized },
  announcement: { enabled, title, text, audience, version },
  whatsapp: '255756749261' }
```

## 3. Roles and scope (enforced on the server, mirrored on the page)

| role | may |
|---|---|
| `seller` | Sell, Lendings (record + see own vendor's), own dashboard; Reports only if `perms.canDownloadReport` |
| `admin`, `assistant-admin` | everything for their vendor: Products, Stock (units/branches/transfers/movements), Users, Cash, Reports, business profile + logo |
| `manager`, `assistant-manager` | every vendor: Management, Manager Reports, Settings, Email Center, Hints, Users (all), Lendings (all). No Sell tab. |

A manager passes `vendor_id` (`'ALL'` or absent = every vendor) where a function is vendor-scoped;
everybody else is pinned to their own vendor whatever they send (`_shared.scopedVendor`). A
**restricted** vendor's users get 403 with `restricted: true` on every write except `suggestion`.
Every write goes through `audited()`; module `WRITES` arrays are the source of truth for "is a write".

## 4. Functions

### account — `api/_lib/bo/account.js` (route `/api/auth`, no token)
| fn | args | returns |
|---|---|---|
| `login` | `{ id, password }` — id = handle **or** email, case-insensitive | bootPayload + `token` (401 on bad credentials / inactive) |
| `register` | `{ business_name, business_type, phone, address, admin_email, admin_name, admin_handle, password }` | `{ message, active }` — vendor + admin profile; active iff setting `FreeRegistration === 'Yes'`; 400 if email/handle exists |
| `requestReset` | `{ email }` | `{ message }` — emails `APP_URL/?reset=TOKEN` (10-minute token) via `email.sendEmail`; message is the same whether or not the email exists |
| `resetPassword` | `{ token, password }` (min 4 chars) | `{ message }` |
| `logout` | `{ token }` | `{}` |
| `me` | `{ token }` | bootPayload (401 when expired) |

`account.js` also exports `accountApi(db, fn, args, nowMs, deps)`; `deps.userAgent`, `deps.fetch` (for email in tests).

### boot — `boot.js`
| fn | args | returns |
|---|---|---|
| `boot` | `{}` | bootPayload (via token) |
| `suggestion` | `{ category, message }` | `{ message }` — logs to `suggestions` (WRITE, allowed when restricted) |
Exports `buildBoot(db, user, nowMs)` used by account.login / me.

### dashboard — `dashboard.js`
| fn | args | returns |
|---|---|---|
| `dashboard` | `{ branch_id?, vendor_id? }` | `{ currency, today_total, week_total, month_total, year_total, low_count, stock_value, chart: [{ label, value }] (7 days, last = 'Today'), seller_rows: [{ seller_id, name, handle, cash_sales, lipa_sales, credit_sales, cash_received, lipa_received, cash_due, lipa_due }] (admin only, today, active sellers), self: { cash, lipa, credit, items } (seller only, today), products: [{ id, legacy_id, name, brand, model, stock, price, value, status: 'OK'\|'LOW'\|'OUT', is_serialized }], branch_rows: [{ branch_id, name, today, week, month, year, units }] (only when the vendor has branches) }`. Seller: totals over their own sales. Completed sales only. |
| `managerDashboard` | `{}` | `{ vendor_count, today, week, month, year, stock_value, rows: [{ vendor_id, name, admin_name, admin_handle, today, week, month, year, products, sellers, stock_value, currency }] }` — uses `bo_vendor_sales_summary` with a JS fallback |

### sales — `sales.js`
| fn | args | returns |
|---|---|---|
| `recordSale` | `{ items: [{ product_id, qty, price, discount?, unit_ids? }], payment_method: 'Cash'\|'Lipa Number'\|'Credit', financing_partner_id?, branch_id? }` | `{ message, group_id, grand_total, sale_ids }`. `price` is the LIST price; `discount` per unit (default 0); effective `price = list - discount`, `total = qty × price`. Serialized product ⇒ `unit_ids.length === qty`, each claimed via `stock.claimUnits`. Credit ⇒ `financing_partner_id` required. Stock through `stock.changeStock(type 'sold')`. Sellers, admins. `branch_id` defaults to the user's branch. |
| `cancelSale` | `{ sale_id, reason }` | `{ message }` — soft-cancel: status, cancelled_by/at/reason; stock/unit restored via `changeStock(type 'cancelled_restock')`; seller emailed if they have an email (best effort). Admin/manager. Already-cancelled ⇒ 400. |
| `markPartnerPaid` | `{ sale_id?, group_id?, paid }` | `{ message }` — Credit sales only. Admin/manager. |
| `recentSales` | `{ limit?, branch_id?, vendor_id?, include_cancelled? }` | `{ rows: [{ id, legacy_id, group_id, sold_at, seller_name, product_name, brand, model, imei, qty, list_price, discount, price, total, payment_method, partner_name, partner_paid, status, branch_name, cancelled_by_name, cancelled_at, cancel_reason }] }` newest first, default limit 30, max 200. Admin/manager. |
| `salesDetail` | `{ period: 'today'\|'week'\|'month'\|'year'\|'stock', vendor_id?, branch_id? }` | stock ⇒ `{ kind: 'stock', rows: [product summary as in dashboard.products] }`; else `{ kind: 'sales', currency, groups: [{ seller_name, total, rows: [{ sold_at, product_name, qty, price, discount, total, payment_method, partner_name, imei, branch_name }] }], grand_total }`. Seller sees only own. |

### products — `products.js`
| fn | args | returns |
|---|---|---|
| `products` | `{ include_inactive?, vendor_id? }` | `{ rows: [product + units_in_stock (serialized only)] }` |
| `productOptions` | `{ branch_id? }` | `{ products: [{ id, legacy_id, name, price, stock, is_serialized, brand, model, units: [{ id, imei, serial_no, branch_id }] (serialized, in stock, at branch if given) }], partners, branches }` — one trip for the Sell / Lend forms |
| `addProduct` | `{ name, category, price, stock, supplier?, reorder_point?, listing_type?, price_unit?, location?, brand?, model?, is_serialized?, branch_id? }` | `{ product }` — mints `legacy_id` P001… per vendor; opening `stock` > 0 writes a `received` movement (serialized products start at 0: units are added with `addUnits`) |
| `updateProduct` | `{ id, name, category, price, stock?, reorder_point, listing_type, price_unit, location, brand, model }` | `{ product }` — a changed `stock` on a non-serialized product writes an `adjustment` movement for the difference |
| `toggleProduct` | `{ id, active }` | `{ message }` |
| `addStock` | `{ product_id, qty, branch_id?, note? }` | `{ message, stock }` — `received` (non-serialized only) |
| `uploadProductImage` | `{ product_id, slot: 1\|2, data_url }` | `{ url }` |

### stockops — `stockops.js` (Frank Amos's phone-retail additions)
| fn | args | returns |
|---|---|---|
| `branches` | `{ vendor_id? }` | `{ rows }` (incl. inactive) |
| `saveBranch` | `{ id?, name, location?, active? }` | `{ branch }` |
| `partners` | `{}` | `{ rows }` vendor's + global |
| `savePartner` | `{ id?, name, contact?, active? }` | `{ partner }` (admin: vendor-scoped; manager without vendor: global) |
| `units` | `{ product_id?, status?, branch_id?, q? }` | `{ rows: [unit + product_name] }` (bounded: 500) |
| `addUnits` | `{ product_id, branch_id?, units: [{ imei?, serial_no? }] }` | `{ message, added, stock }` — one `received` movement per unit; duplicate IMEI ⇒ 400 naming it |
| `updateUnit` | `{ unit_id, imei?, serial_no?, branch_id?, status? ('in_stock'\|'lost'), note? }` | `{ unit }` — a status change writes an `adjustment` movement and recounts |
| `unitHistory` | `{ unit_id? , imei? }` | `{ unit, product, movements: [...], sale: recentSales row \| null }` |
| `transferStock` | `{ product_id, from_branch_id, to_branch_id, qty?, unit_ids?, note? }` | `{ message }` — non-serialized: qty from→to (`transfer_out` + `transfer_in`, needs `from` qty ≥ qty); serialized: each unit's branch moves |
| `adjustStock` | `{ product_id, branch_id?, delta, note }` | `{ message, stock }` — admin only, `adjustment` |
| `movements` | `{ start, end, product_id?, branch_id?, type?, vendor_id? }` | `{ rows: [movement + from_branch_name, to_branch_name] }` bounded by date, ≤ 2000 |
| `branchStock` | `{ branch_id? }` | `{ rows: [{ product_id, name, brand, model, is_serialized, total: stock, branches: [{ branch_id, name, qty }] }] }` — serialized: qty = units in stock per branch |

### lendings — `lendings.js`
| fn | args | returns |
|---|---|---|
| `lendings` | `{ status: 'Active'\|'Returned'\|'ALL', vendor_id? }` | `{ rows: [{ id, legacy_id, created_at, borrower_name, borrower_email, borrower_phone, recorded_by_name, vendor_id, vendor_name, status, return_date, items: [{ product_id, product_name, qty, price, total, imei }], grand_total }] }` newest first, ≤ 300 |
| `recordLending` | `{ items: [{ product_id, qty, price?, unit_ids? }], borrower_name, borrower_email?, borrower_phone?, branch_id? }` | `{ message, lending_id }` — stock via `changeStock('lent')`; insufficient stock ⇒ 400; confirmation email best-effort |
| `markLendingReturned` | `{ lending_id }` | `{ message }` — `returned` movements, units back to in_stock; email best-effort |
| `deleteLending` | `{ lending_id }` | `{ message }` — restores stock if still Active (admin/manager) |
| `sendLendingReminder` | `{ lending_id }` | `{ message }` — uses setting `lendingReminderText` (default template in module) |
| `sendLendingReminders` | `{ vendor_id? }` | `{ message: 'Sent N …' }` |

### cash — `cash.js`
| fn | args | returns |
|---|---|---|
| `recordCash` | `{ seller_id, cash_amount, lipa_amount, note? }` | `{ message }` (admin) |
| `cashReceipts` | `{ start?, end?, seller_id? }` | `{ rows: [receipt + seller_name] }` (today by default) |

### users — `users.js`
| fn | args | returns |
|---|---|---|
| `users` | `{ q?, vendor_id? }` | `{ rows: [profile (never hash/salt) + vendor_name, branch_name] }` — q matches name/role/handle/vendor (manager sees all) |
| `addUser` | `{ email, name, role, handle, password, branch_id? }` | `{ user }` — admin: roles seller/admin/assistant-admin in own vendor; manager may create manager roles |
| `updateUser` | `{ id, email, name, role, handle, password?, active, branch_id? }` | `{ user }` — password only if non-empty; manager only for password of others; reactivating the vendor's **admin** resets `vendors.registered_on` (the trial/billing anchor) |
| `toggleUser` | `{ id, active }` | `{ message }` (same anchor rule) |
| `deleteUser` | `{ id }` | `{ message }` (manager) |
| `uploadProfilePhoto` | `{ profile_id, data_url }` | `{ url }` |
| `changePassword` | `{ current, password }` | `{ message }` (own account) |
| `businessProfile` | `{}` | `{ vendor }` |
| `setBusinessProfile` | `{ business_type, phone, address, currency }` | `{ vendor }` (admin) |
| `uploadLogo` | `{ vendor_id?, data_url }` | `{ url }` (admin own; manager any) |

### vendors — `vendors.js` (manager unless noted)
| fn | args | returns |
|---|---|---|
| `managerSummary` | `{}` | `{ rows: [{ vendor..., admin_id, admin_name, admin_handle, admin_email, admin_role, admin_active, product_count, today_sales, stock_value, trial_days_left }] }` |
| `vendorList` | `{}` | `{ rows: [{ id, name, currency }] }` active vendors |
| `updateAdmin` | `{ profile_id, name?, role?, active? }` | `{ message }` |
| `setVendorActive` | `{ vendor_id, active }` | `{ message }` — reactivation resets `registered_on` |
| `setVendorRestricted` | `{ vendor_id, restricted }` | `{ message }` |
| `allVendorPermissions` | `{}` | `{ rows: [{ vendor_id, name, active, permissions }] }` |
| `setAllVendorPermissions` | `{ profile }` | `{ message }` |
| `analytics` | `{}` | `{ total_views, avg_views, top_viewed: [{ product_id, name, vendor_name, count, hot }], top_vendor_views: [{ vendor_name, count }], top_selling: [{ name, vendor_name, qty, revenue }] }` |
| `restrictionInfo` | `{}` | `{ restricted, notice }` — any vendor user (auto-sync polls this) |

### reports — `reports.js`
| fn | args | returns |
|---|---|---|
| `reportData` | `{ type, start?, end?, vendor_id?, branch_id?, status?, group?, partner_id? }` | `{ title, subtitle, meta: [string], columns: [{ key, label, align? }], rows, totals: [[label, value]], currency }` |
| `reportTicket` | same + `format: 'pdf'\|'xlsx'` | `{ url: '/api/report?t=…' }` |
Types: `sales`, `stock`, `cashdue`, `lending` (status Active/Returned/ALL), `commission` (manager), `brandmodel`,
`partner` (financed sales, by partner), `cancelled`, `employee`, `branch`, `payment` (by method),
`movements`, `units` (serialized stock list), `imei` (sales by IMEI). Sellers: only `sales` of their own
sales, and only with `perms.canDownloadReport`. Module also exports `reportFile(db, user, report)` →
`{ bytes, contentType, filename, inline }` used by `/api/report`.

### emails — `emails.js` (manager; `deps.fetch` injectable for tests)
`emailDaily`, `emailWeekly`, `emailMonthly` (per vendor permission flags, PDF attached), `emailCommission`
(non-trial vendors, billing cycle anchored on `registered_on`), `emailPaymentReminders` (restricted vendors),
`emailLendingReminders` (all vendors), `emailManagerSummary` → each `{ message }` counting what was sent.

### hints — `hints.js`
| fn | args | returns |
|---|---|---|
| `hints` | `{}` | `{ rows }` (manager: all rows; others: their role + 'all') |
| `addHints` | `{ rows: [{ role, en, sw? }] }` | `{ message }` |
| `updateHint` | `{ id, role, en, sw }` | `{ message }` |
| `deleteHint` | `{ id }` | `{ message }` |
Exports `hintsForRole(db, role)` → `[{ en, sw }]` with the legacy defaults when none exist.

### settings — `settings.js` (manager)
| fn | args | returns |
|---|---|---|
| `settingsGet` | `{}` | `{ settings: { FreeRegistration, commissionRate, trialDays, hintLifetime, hintInterval, loadingTime, autoSyncSeconds, sessionTimeoutMinutes, paymentReminderText, lendingReminderText, announcement_* } }` |
| `settingSet` | `{ key, value }` | `{ message }` — whitelisted keys only |
| `setAnnouncement` | `{ title, text, enabled, audience }` | `{ message }` |

### market — `market.js` (route `/api/market`, public)
| fn | args | returns |
|---|---|---|
| `market` | `{}` | `{ products: [{ id, name, cat, price, stock, vendor, vendor_id, image1, image2, currency, vendorPhone, vendorType, listingType, priceUnit, location, brand, model, clicks, hot }], vendors: [{ id, name, admin, logo, businessType, phone, address, currency }], avgClicks, totalClicks, hints: [{ en, sw }], timings: { hintLifetime, hintInterval } }` — ranked: in-stock tier → recency-weighted popularity (30-day clicks × 3 + older) → zero-click items randomised; cached 60 s in process |
| `click` | `{ product_id }` | `{}` |
| `hints` | `{}` | `{ hints, timings }` |

## 5. The page side

`public/index.html` owns: CSS, markup, state `S` (`token, user, vendor, perms, timings, branches,
partners, features, lang, theme, view, screen, tab`), `auth(fn,args)`, `srv(fn,args)` (POST /api/bo with the
token; on 401 → sign out; on `restricted` → lock UI), `esc`, `fmt`, `fmtFull`, `cur()`, `isAdmin()`,
`isManager()`, `showToast`, `openModal(id)`, `closeModal(id)`, `switchTab`, session persistence,
theme/lang/view toggles, hints rotation, auto-sync, idle logout, restriction UI, marketplace, login/
register/reset, feedback modal. Each tab lives in `public/bo/<tab>.js` and registers itself:
`BO.tabs.<name> = { load() {}, sync() {} }` — `load` builds the tab, `sync` is the silent refresh.
Shared modal markup for the tab lives in the tab file (injected once by `BO.ensureModal(id, html)`).

# account / boot / hints / settings — notes for the integrator

Modules: `api/_lib/bo/account.js`, `boot.js`, `hints.js`, `settings.js`.
Tests: `test/account.test.mjs`, `test/boot.test.mjs`, `test/hints-settings.test.mjs` (35 tests, green).

## Public names (exactly the contract)
- account `FN`: login, register, requestReset, resetPassword, logout, me — handlers are
  `(db, args, nowMs, deps)`; `accountApi(db, fn, args, nowMs, deps)`, `ACCOUNT_FUNCTIONS`.
- boot `FN`: boot, suggestion. `WRITES = ['suggestion']`. Exports `buildBoot(db, user, nowMs)`.
- hints `FN`: hints, addHints, updateHint, deleteHint. `WRITES = ['addHints','updateHint','deleteHint']`.
  Exports `hintsForRole(db, role)` (market.js wants it for `'marketplace'`), plus the data
  constants `DEFAULT_HINTS` and `HINT_ROLES`.
- settings `FN`: settingsGet, settingSet, setAnnouncement. `WRITES = ['settingSet','setAnnouncement']`.

## Shared files — nothing blocking, two small things worth knowing
1. `_shared.js` does not re-export `unauthorized`; account.js imports it from `../auth.js`
   directly (login answers 401 with the legacy sentence). Fine as is; re-export it if you want
   every module on one import line.
2. `restrictionInfo` fills `{admin}` from a name the caller passes. boot.js passes the caller's
   own name when they are the admin and otherwise looks the vendor's first active admin up
   (one extra read, only for a restricted vendor's non-admin users).

## Behaviour choices (all covered by tests)
- **login** id = handle or email, trimmed, case-insensitive. Two exact `.eq` reads first
  (citext makes them case-insensitive on Postgres), then an escaped `.ilike` on handle then
  email (`%`/`_` escaped, refuses a pattern that matches two rows). Wrong id, wrong password,
  inactive profile and inactive vendor all get the same 401 `Invalid credentials or inactive
  account.`; a manager is never blocked by a vendor. Blank credentials are a 400.
- **register** requires business_name, admin_email (valid, stored lowercase), admin_name,
  admin_handle (no spaces), password (≥ 4). business_type / phone / address optional (as legacy).
  Refuses an existing email or handle (any case) and an existing vendor name (400); vendor
  row then profile row; `bustSessions(db)` after. `active` = setting `FreeRegistration === 'Yes'`.
  If the profile insert fails after the vendor insert, the vendor row stays (no transaction
  on PostgREST) — the same "retry the form" recovery as before.
- **requestReset** always answers the same sentence; when the email exists it writes
  `password_resets {token, profile_id, expires_at: +10 min}` and mails `APP_URL/?reset=TOKEN`
  through `email.sendEmail` (`deps.fetch` injectable). A sendEmail failure (not configured,
  provider error) is a 400 carrying sendEmail's own message.
- **resetPassword** token must exist, be unused and unexpired; password ≥ 4; sets the new
  hash/salt, stamps `used_at`, **deletes every session of that profile** (a reset usually
  means the old password leaked) and busts the cache.
- **buildBoot** cost: 5 reads for a business user (settings, hints, branches, partners, a head
  `count` of serialized products), 3 for a manager, 6–7 for a restricted vendor (+ sales behind
  the notice, + admin name when the caller is not the admin). Sequential on purpose.
  `user` is the resolveSession object minus password fields (it keeps `user.vendor`; the
  payload's `vendor` is the same row). Timings are numbers: hint pair default 5 / 300, the rest
  0 (loadingTime defaults to 0 per DECISIONS #15, not the legacy 2).
- **hints** for non-managers = active rows for `role` + `'all'`; managers get every row ordered
  by role then sort. `addHints` sorts new rows after the existing ones (one `count`), skips blank
  `en`, refuses an unknown role or an empty batch (400). `updateHint` leaves `message_sw`
  untouched when `sw` is omitted (legacy behaviour). `manager` has no default hint list in
  legacy either and reads the seller's, as the old code did.
- **settingSet** rules: hintLifetime ≥ 1, hintInterval ≥ 10, autoSyncSeconds 0 or ≥ 5,
  sessionTimeoutMinutes ≥ 0, loadingTime 0–10, trialDays ≥ 0 (all whole numbers),
  commissionRate ≥ 0 (decimals allowed), FreeRegistration 'Yes'/'No', announcement_enabled
  normalised to 'Yes'/'No', text keys stored trimmed. Anything outside `SETTING_KEYS` is a 400.
- **setAnnouncement** writes the five announcement keys one upsert each (manager-only, rare)
  and `announcement_version = String(nowMs)`.

## For the page
- `login` returns `{ token, ...bootPayload }`; `me`/`boot` return bootPayload without `token`.
- `perms.showDashboard === false` for a seller means land on Sell (DECISIONS #7).
- `restriction.notice` is already filled in — show it verbatim in the banner.

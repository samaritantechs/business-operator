# Samaritan Techs — Reusable Feature & Pattern Library
### (sourced strictly from Business Operator)

**How to use this document:** paste this whole file into a new chat when starting
*any* new system — Google Apps Script or otherwise. Then just name the pattern:
*"give me the dark mode toggle like in my library,"* *"set up login like pattern
C1,"* *"I want the bilingual popup system,"* *"use my table pattern for this
list."* Each entry below is written generically — no Business Operator business
logic (vendors, products, sales) — so it transplants cleanly into a different
domain. Where a mechanism is GAS-specific, that's noted; most of the UI/UX
patterns apply to any web stack.

This is a **pattern library, not a feature list** — each entry describes the
*shape* of a solution and the *reasoning* behind its key decisions, so it can be
re-implemented from a one-line request instead of a full spec.

---

## A. Architecture & engineering conventions

**A1. Two-file GAS app, Sheets-as-DB, no build step**
Backend in one `Code.gs`, entire frontend (HTML+CSS+JS) in one `app.html` served
via `HtmlService.createTemplateFromFile`. Every "table" is a spreadsheet tab.
No framework, no npm, no bundler — just plain JS shipped directly to the
browser. Good for: solo-maintained tools, fast iteration, zero hosting cost,
non-technical stakeholders who can eyeball the "database" directly in Sheets.

**A2. ES5-flavoured JavaScript discipline**
`var`, `function(){}`, string concatenation only — no arrow functions,
`let`/`const`, template literals, destructuring, `async`/`await`. Applies even
though the runtime supports modern JS. Reasoning: uniform style across a
growing codebase edited over many sessions/months; avoids subtle GAS-runtime
edge cases. *Invoke with: "keep it ES5-style like my other GAS projects."*

**A3. Surgical anchored patching, whole-file delivery**
Never regenerate a whole file to make a small change and never hand back a
diff. Instead: find an exact, unique substring in the *current* file, replace
only that, verify (syntax check, balanced brackets, single closing tag), then
deliver the complete file. Reasoning: the person pastes whole files into an
editor — diffs are useless to them, and full regeneration risks silently
dropping unrelated code. *Invoke with: "patch this the way we always do —
anchored edit, then whole file back."*

**A4. Self-healing schema**
A small `ensureXColumns()`-style function that checks a sheet's header row and
appends any missing columns on demand, run lazily the first time a feature
touching that column executes. Lets the schema evolve over many sessions
without ever requiring manual spreadsheet surgery or a migration script.
*Invoke with: "make this column self-healing like the others."*

**A5. Generic key-value Settings store**
One sheet, two columns (Key, Value), with `getSetting(key)` /
`setSetting(key,value)` helpers. Every configurable knob (timing, toggles,
per-tenant flags via a `prefix_<tenantId>` key convention, JSON blobs for
structured settings) goes through this instead of being hardcoded or given its
own sheet. *Invoke with: "store that in the generic settings pattern."*

**A6. Deployment discipline (GAS-specific)**
Always redeploy via *Manage deployments → Edit → New version* — never *New
deployment*, which mints a new URL and breaks every bookmark, QR code, and
installed wrapper app pointing at the old one. Worth stating explicitly to any
assistant picking up a GAS project cold.

---

## B. Visual design system / branding

**B1. Samaritan Techs signature**
- Brand gradient: blue → violet (`#2563EB` → `#7C3AED`, deep navy `#1E3A8A`
  anchor), gold/amber accent (`#F5B301`/`#FCD34D`) used sparingly for
  highlights and CTAs.
- Logo mark: a simple rounded-square house silhouette with a small gold
  circle "roof accent" — abstract enough to read at favicon size.
- Typography: Plus Jakarta Sans (headings + UI), falls back to system
  sans-serif.
- Footer convention: `© [dynamic current year] Samaritan Techs · [Product
  Name] — [short functional tagline]`.
*Invoke with: "brand this with my Samaritan Techs signature."*

**B2. CSS-variable theming for instant dark/light mode**
All colors defined once as CSS custom properties (`--bg`, `--surface`,
`--text`, `--accent`, `--border`, `--shadow`, etc.) on `:root`, re-mapped
under a `[data-theme="dark"]` attribute selector. Every component references
the variables, never a literal color. This is what makes a full theme switch
a one-line `document.documentElement.setAttribute('data-theme', ...)` instead
of touching dozens of rules. *Invoke with: "set up theme variables like my
usual pattern."*

**B3. Card/badge/table visual language**
Consistent primitives reused everywhere: stat cards (icon + label + big value
+ colored accent bar along one edge), pill-shaped status badges
(color-coded: ok/green, low/amber, out/red, role-tinted variants), a
`.bo-table`-style zebra-free bordered table with sticky header and hover-row
highlight, and section cards (header strip + body) as the standard content
container. *Invoke with: "use my stat-card / badge / table components."*

---

## C. Auth & session patterns

**C1. Split-screen branded login**
Left panel: brand story (gradient background, tagline bullets, product
name/subtitle). Right panel: the actual form, with a language toggle
top-of-form, register-inline (a toggle link expands a registration form in
place rather than navigating away), and a "forgot password" link that emails a
time-limited reset token as a URL parameter the app checks for on load.
*Invoke with: "give me the split-screen login pattern."*

**C2. Lightweight client-side session persistence**
On successful login, store the minimal session (userId, name, role, tenant,
currency/locale — never the password) in `localStorage`. On boot, attempt a
silent "restore session" before falling back to the login/landing screen —
avoids forcing a fresh login every visit while keeping the server stateless
between requests (typical of GAS, which has no server-side session by
default). *Invoke with: "persist the session the way I usually do."*

**C3. Role-based UI gating, not route gating**
No client-side router. Instead: every nav item and content section carries a
CSS class (e.g. `roleAOnly`, `roleBOnly`) that a small helper toggles
`display:none` on after login, based on the logged-in role. Simple,
transparent, easy to extend with a new role later. *Invoke with: "gate this
section the way I gate admin-only stuff."*

---

## D. Navigation & layout patterns

**D1. Topbar + sidebar app shell, tab-switching (no router)**
Fixed top bar (brand mark, contextual badge, icon-button cluster
right-aligned: theme toggle, language toggle, refresh, logout), a left
sidebar of nav buttons grouped under small uppercase labels, and a main
content area where each "page" is a plain `<div id="tab-x">` shown/hidden by
a `switchTab()` function — no URL routing, no page reloads. *Invoke with:
"build the app shell with my sidebar+topbar pattern."*

**D2. Mobile hamburger sidebar with overlay**
Below a breakpoint, the sidebar becomes an off-canvas panel (`transform:
translateX(-100%)` → `0` when `.open`), triggered by a hamburger button that
only renders on mobile widths, with a semi-transparent overlay behind it that
closes the panel on tap. *Invoke with: "mobile sidebar like usual."*

**D3. Public landing distinct from the authenticated app**
Three top-level screens (`landing` / `login` / `app`), not nested inside one
authenticated shell. The public landing is a real, browsable, unauthenticated
page (not a login wall) — critical when the product has a public-facing
component (a catalog, directory, storefront, etc.) that should be indexable
and shareable without an account. *Invoke with: "give this a public landing
like Business Operator's marketplace, separate from the login wall."*

**D4. User-controlled display-density / viewport toggle**
A "Desktop / Mobile view" toggle (icon button, persisted like dark mode) lets
a user override the default responsive layout — e.g. force a wider,
denser desktop-style layout on a phone, or vice versa. Server-side (in GAS,
via a URL query param read in `doGet` that sets the viewport meta tag)
so it works identically inside a wrapped native-app shell too. Reconciles
on load without a redirect loop by checking the saved preference against
what was actually server-rendered before deciding whether to reload.
*Invoke with: "add a desktop/mobile view toggle like Business Operator has."*

---

## E. Data & UI display patterns

**E1. Dashboard stat cards + click-through detail**
A row of stat cards (today/week/month/count-style metrics), each clickable to
open a modal with the itemized detail behind that number. Optionally paired
with a themed bar/line chart (Chart.js) whose colors re-derive from the
current theme so it doesn't look broken in dark mode. *Invoke with: "give me
dashboard cards with drill-down like usual."*

**E2. Admin table with inline search + row actions**
A live-filtered table (search box wired to a function that re-queries/filters
and re-renders), rows carrying inline action buttons (Edit opens a modal
pre-filled via a JSON-serialized row object passed straight into the
`onclick`, small colored action buttons for state toggles like
activate/deactivate). *Invoke with: "standard searchable admin table."*

**E3. Popularity/relevance ranking with a cold-start fix**
When a public list should surface "what's popular" instead of raw
insertion order: log interaction events (e.g. clicks) with timestamps,
aggregate with **recency weighting** (recent activity counts more than old
activity) rather than raw all-time totals, apply **hard tiering** for
business-critical gates before the soft popularity score (e.g. "available"
items always outrank "unavailable" ones regardless of popularity), and give
**zero-signal items a randomized rotation slot** so brand-new entries aren't
invisible forever under a naive "sort by clicks" (the classic rich-get-richer
trap). Cache the aggregation (don't re-scan a growing interaction log on
every page load). *Invoke with: "rank this list the way we rank the
marketplace — recency-weighted, cold-start safe, cached."*

**E4. Paginated "Load more" instead of dumping a full list**
Render a manageable first slice (e.g. 48 items), track a "how many shown"
counter, and append more on demand rather than rendering hundreds of DOM
nodes up front or building full pagination UI. Resets to the first slice
whenever a filter/search changes. *Invoke with: "load-more pagination like
usual."*

**E5. Two-tier search: instant client-side vs. server round-trip**
Public/catalog-style search filters an already-fetched in-memory array
instantly on every keystroke (no server call). Admin/management search (over
data too large or sensitive to ship to the client wholesale) instead calls
the server per-query. Choose based on dataset size and sensitivity, not
uniformly. *Invoke with: "should this search be client-side or server
round-trip, like [the marketplace / the admin table]?"*

---

## F. Notification & communication patterns

**F1. Bilingual, role-targeted, rotating tips popup**
A small toast (bottom-right, auto-fades) that rotates a random tip from a
sheet-driven list every N seconds, filtered to the current user's role (plus
a shared "all" role and a special role for unauthenticated/public visitors).
Two-language support via a 3rd sheet column (e.g. `SW-MESSAGE`), with a
**user-facing language toggle** — placed and behaving exactly like a dark-mode
toggle (icon button, persisted per-device, instant effect) — that decides
which column's text shows. On toggle, show one tip immediately in the new
language as instant proof it worked, rather than making the user wait for the
next scheduled rotation. Same toast element is reused for one-off action
feedback (a `showToast(msg, icon)` helper), not just the rotating tips.
*Invoke with: "give me the bilingual tips popup system."*

**F2. Feedback-to-WhatsApp instead of an inbox**
An in-app feedback form (category dropdown + message box) that, on submit,
composes a formatted message and opens a `wa.me` deep link to the product
owner's WhatsApp — no support-ticket backend to build or monitor separately.
*Invoke with: "route feedback to WhatsApp like usual."*

**F3. Editable notification templates, not hardcoded strings**
Any recurring outbound message (reminder emails, lock-screen notices) is
stored as an editable template string in Settings with placeholder tokens
(e.g. `{name}`, `{amount}`), edited from an in-app textarea rather than
buried in code — so the product owner can adjust tone/wording without a
redeploy. *Invoke with: "make that message editable like my reminder
templates."*

---

## G. Multi-tenancy & access control patterns

**G1. Tenant-scoped everything, with a cross-tenant admin role**
Nearly every server function takes a tenant/owner identifier as a parameter
and filters by it; a small set of elevated roles pass a sentinel (e.g.
`'ALL'`) to see across every tenant. Keeps single-tenant and
multi-tenant-oversight code paths unified instead of forking the whole app.
*Invoke with: "scope this by tenant the way Business Operator scopes by
vendor."*

**G2. Trial + restriction access-gating**
Each tenant gets a trial anchored to a timestamp set at registration (and
reset when a deactivated tenant is later reactivated — a deliberate,
overridable choice, not automatic). A separate boolean per tenant
("restricted") is checked on login and on every background sync; when true,
the client renders a persistent, non-dismissible notice banner plus a
read-only visual overlay over the whole workspace (dimmed, `pointer-events:
none`) rather than blocking navigation entirely — the person can still reach
account-level actions like logout or support contact. Toggling
restriction/reactivation is a manual elevated-role action; automatic
expiry-triggered restriction is a known, explicitly-flagged extension, not
assumed. *Invoke with: "add trial + restriction gating like Business
Operator's."*

**G3. Public-facing content excludes restricted/inactive tenants**
Anything shown on a public, unauthenticated surface (a directory, catalog,
storefront) actively filters out tenants/items that are inactive or
access-restricted — so a non-paying or deactivated tenant doesn't keep
getting free public exposure. Applied at the data-fetch layer, not just
hidden with CSS. *Invoke with: "make sure restricted tenants don't leak into
the public view."*

---

## H. File/media handling patterns

**H1. Client-side base64 upload → server-stored → thumbnail URL**
Client reads a chosen file via `FileReader`, converts to base64, sends it to
the server function as a string. Server decodes it, writes it to a dedicated
folder (created on first use if missing), and returns a stable,
CDN-cacheable thumbnail URL (in GAS specifically: `drive.google.com/
thumbnail?id=X&sz=wN` — a different legacy Google image-hosting domain
pattern reliably 403s and should be avoided). Old-format URLs get a one-time
migration helper to rewrite them if the format ever changes. *Invoke with:
"wire up image upload the way I always do."*

**H2. Flexible item taxonomy (one entity, multiple transaction modes)**
A single record type (not two parallel tables) can carry a "mode" field
(e.g. Sale vs. Rent) plus mode-specific optional fields (e.g. a price-unit
and location that only matter in one mode) — letting the UI branch on
`(record.mode === X)` for labels/badges/pricing-display without duplicating
the whole CRUD surface. Reusable well beyond its original domain: any time a
product needs "the same kind of thing, offered two different ways."
*Invoke with: "give this entity a mode field like Sale/Rent, not two separate
tables."*

---

## I. GAS-in-the-browser / distribution patterns

**I1. WebView-shell native app that just loads the live URL**
Rather than building a real native app, wrap the live web URL in a minimal
signed WebView shell. Every future web update ships instantly to everyone
with zero app rebuild; the shell itself only needs touching for
shell-level concerns (icon, permissions, zoom behavior). Required WebView
checklist for this to actually work end-to-end: DOM storage enabled (session
persistence), third-party cookies allowed (needed when content is served via
a secondary asset domain), a file-chooser handler (so `<input type=file>`
uploads work), a `window.open` handler that captures the popup URL and hands
it to the system browser (needed for anything that opens a new tab, e.g. a
generated report/download), a download listener doing the same for direct
file links, domain-based routing (keep the app's own domain(s) inside the
WebView, send everything else — messaging app links, phone, email links — to
the OS), hardware back-button wired to in-app history, and pinch-zoom
explicitly enabled (off by default). Signed with one **permanent** keystore
per app — never regenerated, backed up in multiple places, every future
build reuses it. *Invoke with: "wrap this in a WebView shell app like
Business Operator's APK."*

**I2. Keep-the-link-alive distribution**
Distribute the installable file (e.g. an APK) via a cloud-storage share link
rather than a store listing when speed-to-market matters more than
polish. Update it by replacing the file *in place* (same file ID / same
share link) rather than uploading a new file each time — so any QR code or
link already printed/shared keeps working forever. *Invoke with: "distribute
this the way I distribute the APK — replace in place, don't re-share links."*

---

## J. Documentation patterns

**J1. Feature-completion handoff docs**
At the end of a significant feature push, produce a standalone Markdown
handoff summarizing what shipped, current data shape, and open/deferred
items — written so a *fresh* chat/assistant with zero prior context could
pick up the project correctly from it alone. *Invoke with: "give me a
handoff doc for what we just built."*

**J2. Reusable "paste this to build X" prompts**
For any generalizable subsystem (not just this one), produce a
self-contained prompt template — concept explanation, exact
code/markup/config needed, an integration checklist, and a fill-in-the-blanks
header — so it can be dropped into a brand-new, unrelated project and
implemented correctly with one message instead of redesigning it from
scratch. *This document is itself an example of J2, one level up.*

---

## Quick-reference index (jog your memory fast)

| Say this keyword… | …to get |
|---|---|
| dark mode / theme toggle | B2 |
| login screen | C1 |
| session persistence | C2 |
| admin-only sections | C3 |
| sidebar / topbar / app shell | D1 |
| mobile hamburger menu | D2 |
| public landing page | D3 |
| desktop/mobile view toggle | D4 |
| dashboard cards | E1 |
| searchable admin table | E2 |
| popularity ranking / trending | E3 |
| load more / pagination | E4 |
| bilingual popups / tips | F1 |
| feedback to WhatsApp | F2 |
| editable message templates | F3 |
| multi-tenant scoping | G1 |
| trial + restriction / paywall | G2 |
| hide restricted from public view | G3 |
| image upload | H1 |
| sale/rent-style dual-mode item | H2 |
| WebView wrapper app / APK | I1 |
| APK distribution via Drive | I2 |
| handoff doc | J1 |
| reusable build prompt | J2 |
| Samaritan Techs branding | B1 |
| ES5 style / anchored patching | A1–A3 |
| self-healing sheet columns | A4 |
| generic settings store | A5 |
| GAS deploy rule | A6 |

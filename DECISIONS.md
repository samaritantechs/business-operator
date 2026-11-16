# DECISIONS — Samaritan Industrial

Routine calls made while building, so nobody has to re-derive them. Newest at the bottom.

1. **Where it lives.** Its own repository, `samaritantechs/business-operator`, with the app at
   the root and Vercel's Root Directory left empty. It began as a `business-operator/` folder
   inside `hope-pmo-v2` because that is where the work started, and moved out once it was clear
   it shares no code, no database and no deployment with HOPE PMO -- keeping a second copy
   would have meant two places to fix every bug, one of them going quietly stale.


2. **Its own database.** A **third Supabase project, `business-operator`**, in the same org as
   `hope-pmo` and `hoop-pmo`, same region (eu-west-1), start on micro. Nothing here reads or writes
   the HOPE or HOOP databases; the only credentials it knows are its own `SUPABASE_URL` and
   service-role key, set on its own Vercel project.
3. **HOPE PMO's conventions win over the handoff's defaults** (the handoff says so): plain HTML +
   inline JS with no build step instead of Next.js; the service-role key on the server enforcing
   roles itself instead of Supabase Auth + RLS; Resend for email over plain `fetch`; `npm test` as
   the gate; the Postgres budget rule; the hints-table rule.
4. **Passwords and sessions.** Legacy plaintext passwords are hashed (scrypt) by the migration, so
   nobody resets. Login mints a session token (30 days) the browser keeps instead of the password.
   Reset links are `APP_URL/?reset=TOKEN`, 10 minutes, one use.
5. **Restriction is enforced at the server**, not only drawn: a restricted vendor's users get 403
   on every write (feedback excepted). The old app only dimmed the screen.
6. **`assistant-admin` = `admin`** everywhere. The old UI hid Products/Cash/Reports from assistant
   admins while its backend allowed them; the handoff describes the role as "same vendor scope as
   admin, delegated staff", so the UI now matches that.
7. **Seller permission flags are honoured.** `dashboardVisible=false` hides the seller's dashboard
   (they land on Sell); `sellerCanDownloadReport=true` gives sellers a Reports tab with their own
   sales report. The old code stored these flags and never read them.
8. **Deleting a sale is now cancelling it** (requirement #9): status `cancelled`, who/when/why,
   stock restored through a `cancelled_restock` movement, seller still notified by email.
9. **Every stock change writes a `stock_movements` row** through one function
   (`api/_lib/bo/stock.js: changeStock`). That table *is* requirement #10.
10. **Branches are optional; per-branch quantities live in `branch_stock`** for non-serialized
    products (serialized units carry their own `branch_id`). A vendor with no branches behaves
    exactly as before.
11. **Serialized products** (`is_serialized`) hold their stock as a maintained count of
    `product_units` in stock; checkout names the unit(s). Non-serialized products are untouched.
12. **Credit sales follow the hoop/hooploan model**: the sale is revenue; the financing partner
    owes the shop. `sales.partner_paid` lets the shop tick when the partner has settled, and the
    "sales by financing partner" report shows settled vs outstanding. Partners are a small
    admin-editable list (like HOPE Loan's `carriers`), vendor-scoped or global.
13. **Discounts** are per unit and never change `list_price`: `price = list_price − discount`,
    `total = qty × price`.
14. **Reports are real files** (PDF via pdf-lib, .xlsx via a 150-line dependency-free writer),
    served by a plain GET with a 5-minute signed ticket, so the phone's own download manager
    handles the file and no session token ever sits in a URL.
15. **Desktop/mobile toggle is pure CSS** (`html.bo-desktop`), no reload — the `?view=` iframe
    trick and the 2-second boot loader are gone (loading time defaults to 0 and stays editable).
16. **Time is East Africa Time** everywhere, via HOPE's `time.js`.
17. **Images**: new uploads go to Supabase Storage (`product-images`, `logos`, `profile-photos`,
    public). Old `drive.google.com/thumbnail` URLs are kept as they are.
18. **No Supabase Auth**: `profiles` is our own table, so the migration can keep every legacy
    handle/email pair and the `manager` accounts need no vendor.

19. **Three photos per product, shrunk on the phone.** `image3_url` joins `image1_url` and
    `image2_url` on `products` and on the marketplace view; the first is the one the grid
    shows, the rest appear in the detail view. The browser resizes to 1000px and re-encodes as
    JPEG (`BO.fileToDataUrl`) **before** upload, so a 6MB camera photo leaves the phone as
    roughly 150KB: the shop pays less data, storage stays small, and the picture is still sharp
    on a phone screen. There is no "delete photo" — a slot is replaced, not emptied — because a
    half-built delete that only clears the preview would look like it worked.

20. **The app survives its CDN.** Bootstrap is loaded from jsdelivr, so on a network that
    cannot reach it `bootstrap` is undefined. The modal helpers used to call it directly, which
    meant Edit Product, Sell, Add User and every confirmation threw and did **nothing**, with no
    message — indistinguishable from a frozen app. `openModal`/`closeModal` now check first and
    fall back to the app's own `.modal.bo-fb` styling, with the dismiss buttons, the backdrop
    and Escape wired by hand. `test/navs.test.mjs` fails if that guard is removed.

21. **A fresh open lands on the marketplace.** A saved session used to go straight to the
    dashboard. Now being signed in (`adoptSession_`) and standing in the workspace
    (`enterApp_`) are separate: a fresh open shows the shopfront with the person's name on its
    bar and loads no workspace data until they tap Business Manager. Only two things go back
    to the screen **and tab** they were on: a reload of the same browser tab
    (`sessionStorage.boWhere`), and the Android app being *restored* rather than started
    (`?resume=1`, which `MainActivity` adds only when Android hands it saved state — i.e. the
    app was never swiped off the recent-apps list). Typing a password always enters the
    workspace. `localStorage.boWhereLast` exists only for the `?resume=1` case and is never
    read on a fresh open. Idle sign-out now follows the person, not the screen.

22. **A phone number is stored whole.** `0712 345 678` is how a number is said; a WhatsApp link
    needs `+255712345678`, and a number saved the first way gave a dead button with nothing to
    say so. `api/_lib/bo/phone.js` completes it once, at the door (registration and the
    business profile), against the country of the shop's currency, refuses what is not a
    number, and the marketplace repairs old rows on the way out.

23. **The printable QR codes are drawn by the server, in this repository.** "Save this code as
    a picture" has to be an ordinary https file or the Android app cannot save it (a WebView's
    downloads go to the phone's download manager, which fetches addresses). `api/_lib/qr.js`
    is a small encoder — byte mode, versions 1–6 — written out rather than installed, and held
    to an independent encoder module for module in `test/qr.test.mjs`. The route serves exactly
    two pictures, both for the host the request arrived on: it never draws text it was sent,
    which would let anybody mint a code "from" this system that leads elsewhere.

24. **The app must fit the phone it is on.** A page wider than the screen is shrunk whole by
    the browser, so one bar that needed 510px drew every screen at three quarters of its size.
    On a phone the top bar keeps its buttons and drops its words, Log out is also the last row
    of the ☰ menu, and a sale line is a card (product; quantity and price; total) instead of
    six columns. `tools/smoke.mjs` measures it at 360 and 320px.

25. **Every way out of the page goes through one block, because the Android app can take only
    some.** A WebView opens a new window only while a tap is fresh (about five seconds), cannot
    show a PDF, saves nothing itself, and prints nothing. So a report asked for on a slow line
    did nothing at all, every report was built twice (the WebView asked, then the download
    manager asked again), and a refusal replaced the app with a line of text. Now nothing but
    `BO.openOutside` and `BO.fileDoor` (the shell) calls `window.open`; a file is fetched by
    the app itself where it has the door (`SamaritanApp.download`, one request, saved in the
    phone's Downloads under the name the ticket carries), through a hidden frame of its own
    where it has not, and in a browser a PDF gets a tab opened at the tap. Print goes to the
    phone's print screen (`SamaritanApp.print`). `test/screens.test.mjs` fails if a screen
    opens a window, saves an in-page file or prints on its own. The app's own update download
    is deliberately left exactly as it was.

26. **The marketplace search runs on the page, forgives a slip and reads both languages.** The
    list is already on the phone, so a search costs no request (`public/bo/find.js`). Every
    typed word must be found, in any order; a word also finds its translation from a short
    fixed list (`simu` → phones, `saa` → watches…), and only when nothing matches exactly are
    near spellings offered — one letter out for a short word, two for a long one, never for
    digits — with a line saying that these are the closest, not the thing asked for. The list
    of words is deliberately small and literal: a wrong "translation" hides products.

27. **The customer's first message says the price, in their language; and a shop can be reached
    without data.** The WhatsApp button used to send the product's name in English, so every
    conversation began with "which one?". It now carries the price the customer saw, in
    Kiswahili unless they pressed the language button (a shop that prices in another currency
    gets English). The same sentence goes in an SMS, and the same number can be called: a
    customer with airtime and no bundle cannot open WhatsApp at all. Four buttons do not fit
    one line of a phone as words side by side, a button that is only a picture leaves people
    guessing, and two lines covered the price — so each button is its picture above its word
    (`.pd-go`), measured at 320 and 360px.

28. **Every new photo is saved twice: the photograph, and a 400px copy for the grid.** The grid
    drew twenty stamps from twenty 1000px photographs. The phone that takes the picture also
    sends the small one; it sits beside the photograph as `…_t.jpg` and the address on the
    row ends `&t=1`, so no column was added and a photo saved before this is simply shown
    whole, as before, until it is saved again. Cards load their picture only when scrolled to
    (`loading="lazy"`), and a small copy that fails falls back to the photograph.

29. **Lipa Namba is a table of its own (`pay_numbers`), not three columns on `vendors`.** A
    table's optional columns are learnt absent together, so one more on `vendors` would have
    switched the shop's map pin off on every database that had not yet run the new file. The
    till shows the number, the network and the NAME the customer's phone will show, because
    checking that name before the PIN is the one habit that prevents a wrong payment — and a
    number may not be saved without it. A receipt of a sale paid that way prints the shop's
    numbers **as they stand now**: the sale never recorded which number was used. They are
    never sent to the public marketplace.

-- =====================================================================================
-- RUN-ME 006 -- the shop's pin on the map, sales per business, and the tips that go with them.
-- =====================================================================================
-- THREE PARTS, each instant. Paste the whole file, run it once. Safe to run twice.
--   Part 1 adds three empty columns to vendors (a few dozen rows; a moment's lock).
--   Part 2 creates one function. It reads nothing until the marketplace asks it to.
--   Part 3 adds the new tips to the hints list -- ONLY if that list is in use.
--
-- EVERYTHING WORKS WITHOUT IT. Until this is run:
--   * the marketplace has no Location button, because no business can save a pin yet. Saving a
--     business profile still saves the phone, address and the rest, and SAYS the pin was not kept;
--   * every card shows how long the business has been here, and nothing about its sales. The
--     count is never worked out row by row instead (api/_lib/bo/market.js says why);
--   * the new tips show wherever the built-in tips are in use, and are missing only from a
--     hints list somebody has already filled in under Settings.
-- Nothing fails, nobody sees an error, and the till and sign-in read none of this.
-- =====================================================================================

-- ---- PART 1: where the shop is -------------------------------------------------------
-- Coordinates when they could be read (typed, taken from the phone, or found inside a pasted
-- Google Maps link); otherwise the pasted share link itself. All three empty = no pin, and
-- that is what every existing business starts with. Checked again in api/_lib/bo/place.js.
alter table vendors add column if not exists latitude double precision check (latitude between -90 and 90);
alter table vendors add column if not exists longitude double precision check (longitude between -180 and 180);
alter table vendors add column if not exists map_url text;

-- ---- PART 2: sales per business, for the marketplace ----------------------------------
-- "3 months · 30 sales" under every shop name. A sale is ONE COMPLETED SALE RECORD -- what the
-- Sales report lists and numbers SALE-0001, SALE-0002 -- so a cancelled one does not count and
-- a basket of three things is three. One pass over the sales table, no DISTINCT: measured on
-- 2,000,000 sale lines across 60 businesses it answers in 0.15 seconds. The marketplace asks
-- at most once every fifteen minutes and never waits more than a second and a half for it.
create or replace function bo_vendor_sale_counts()
returns table (vendor_id uuid, sales bigint, first_sale timestamptz)
language sql stable as $$
  select vendor_id, count(*) as sales, min(sold_at) as first_sale
  from sales
  where status = 'completed'
  group by vendor_id
$$;

-- ---- PART 3: the tips, for a hints list that is already in use --------------------------
-- The app shows its built-in tips while the hints table is empty, and the table's own rows the
-- moment it has any. So a list somebody loaded or typed under Settings would never show the new
-- tips. This adds them to such a list -- and does NOTHING to an empty one, which is already
-- showing them. A tip is added once: a second run, or a list that already has it, adds nothing.
-- The last lines are two earlier tips (the eye on a password box, the app update) that went into
-- the app without SQL beside them. Every line here is word for word a built-in tip of
-- api/_lib/bo/hints.js; test/hints-settings.test.mjs fails if the two ever differ.
insert into hints (role, message_en, message_sw, active, sort)
select t.role, t.en, t.sw, true, (select coalesce(max(sort), 0) from hints) + t.n
from (values
  ('seller', '👆 A tip in your way? Swipe it off the screen in any direction.',
     '👆 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.', 1),
  ('admin', '📍 Users → Business Profile: set your shop location, and customers get a Location button to you on the marketplace.',
     '📍 Users → Business Profile: weka mahali pa duka lako, na wateja watapata kitufe cha Location sokoni.', 2),
  ('admin', '🏪 The marketplace shows how long your business has been here and how many sales you have recorded – every sale you record adds to it.',
     '🏪 Soko linaonyesha muda wa biashara yako na idadi ya mauzo uliyorekodi – kila mauzo unayorekodi yanaongeza.', 3),
  ('admin', '👆 A tip in your way? Swipe it off the screen in any direction.',
     '👆 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.', 4),
  ('assistant-admin', '📍 Users → Business Profile: set your shop location, and customers get a Location button to you on the marketplace.',
     '📍 Users → Business Profile: weka mahali pa duka lako, na wateja watapata kitufe cha Location sokoni.', 5),
  ('assistant-admin', '👆 A tip in your way? Swipe it off the screen in any direction.',
     '👆 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.', 6),
  ('manager', '👆 A tip in your way? Swipe it off the screen in any direction.',
     '👆 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.', 7),
  ('assistant-manager', '👆 A tip in your way? Swipe it off the screen in any direction.',
     '👆 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.', 8),
  ('marketplace', '🔖 Tap the bookmark on a product photo to save it. Your saved products wait under Favorites.',
     '🔖 Bonyeza alama ya kuhifadhi kwenye picha ya bidhaa. Ulizohifadhi zinakusubiri kwenye Favorites.', 9),
  ('marketplace', '🔎 Tap the lens on a product photo to see similar products from every shop.',
     '🔎 Bonyeza lenzi kwenye picha ya bidhaa kuona bidhaa zinazofanana kutoka maduka yote.', 10),
  ('marketplace', '📍 Open a product and tap Location to go to the shop with Google Maps.',
     '📍 Fungua bidhaa kisha bonyeza Location kwenda dukani kwa Google Maps.', 11),
  ('marketplace', '🏪 Under each shop name: how long the business has been here and how many sales it has made.',
     '🏪 Chini ya jina la duka: muda ambao biashara imekuwepo na idadi ya mauzo iliyofanya.', 12),
  ('marketplace', '👆 A tip in your way? Swipe it off the screen in any direction.',
     '👆 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.', 13),
  ('seller', '👁️ Typed your password wrong? Tap the eye on the password box to see what you typed.',
     '👁️ Umekosea neno la siri? Bonyeza jicho kwenye kisanduku cha neno la siri uone ulichoandika.', 14),
  ('seller', '📲 If the app asks you to update, tap Update now – it takes a moment and nothing you entered is lost.',
     '📲 Programu ikikuomba kusasisha, bonyeza Sasisha sasa – huchukua muda mfupi na hakuna ulichoandika kinachopotea.', 15),
  ('admin', '📲 If the app asks you to update, tap Update now – it takes a moment and nothing you entered is lost.',
     '📲 Programu ikikuomba kusasisha, bonyeza Sasisha sasa – huchukua muda mfupi na hakuna ulichoandika kinachopotea.', 16),
  ('marketplace', '👁️ Typed your password wrong? Tap the eye on the password box to see what you typed.',
     '👁️ Umekosea neno la siri? Bonyeza jicho kwenye kisanduku cha neno la siri uone ulichoandika.', 17)
) as t(role, en, sw, n)
where exists (select 1 from hints)
  and not exists (select 1 from hints h where h.role = t.role and h.message_en = t.en);

-- Tell the API layer the columns and the function are there, without waiting for it to notice.
notify pgrst, 'reload schema';

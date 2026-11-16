-- =====================================================================================
-- RUN-ME-007 -- the tips for the phone screens, the marketplace landing and the fixes of
--               16 November 2026. TIPS ONLY: no table, no column, no function is touched.
-- =====================================================================================
-- Run in the Supabase SQL editor. Safe to run twice: a tip is added once, and only to a hints
-- list that is already in use.
--
-- WHY THERE IS ANYTHING TO RUN. The app shows its built-in tips while the hints table is empty,
-- and the table's own rows the moment it has any. A list somebody loaded or typed under
-- Settings would therefore never show a tip that was added to the app later. This adds the new
-- ones to such a list, and does NOTHING to an empty one (which is already showing them).
--
-- WITHOUT IT nothing breaks: every screen works, and only these few tips are not shown on a
-- system whose hints list has been filled in.
--
-- Every line is word for word a built-in tip of api/_lib/bo/hints.js;
-- test/hints-settings.test.mjs fails if the two ever differ.
insert into hints (role, message_en, message_sw, active, sort)
select t.role, t.en, t.sw, true, (select coalesce(max(sort), 0) from hints) + t.n
from (values
  ('seller', '🛍️ The app opens on the marketplace – tap Business Manager at the top to come to your work.',
     '🛍️ Programu hufunguka sokoni – bonyeza Business Manager juu kuja kwenye kazi yako.', 1),
  ('seller', '⏻ Log out is also at the bottom of the ☰ menu.',
     '⏻ Kutoka (Log out) kupo pia chini ya menyu ya ☰.', 2),
  ('admin', '🛍️ The app opens on the marketplace – tap Business Manager at the top to come to your work.',
     '🛍️ Programu hufunguka sokoni – bonyeza Business Manager juu kuja kwenye kazi yako.', 3),
  ('admin', '⏻ Log out is also at the bottom of the ☰ menu.',
     '⏻ Kutoka (Log out) kupo pia chini ya menyu ya ☰.', 4),
  ('admin', '📞 Users → Business Profile: type your shop number the way you say it (0712 345 678) – it is kept as +255… so the WhatsApp button reaches you.',
     '📞 Users → Business Profile: andika namba ya duka kama unavyoitamka (0712 345 678) – huhifadhiwa kama +255… ili kitufe cha WhatsApp kikufikie.', 5),
  ('admin', '⚠️ The Low Stock tile on the Dashboard also counts products that have run out, and says how many are out.',
     '⚠️ Kigae cha Low Stock kwenye Dashboard huhesabu pia bidhaa zilizoisha kabisa, na huonyesha idadi yake.', 6),
  ('admin', '📄 A report leaves out the columns your shop never fills, so the PDF is easier to read.',
     '📄 Ripoti huacha safu ambazo duka lako halijazi, hivyo PDF ni rahisi kusoma.', 7),
  ('assistant-admin', '🛍️ The app opens on the marketplace – tap Business Manager at the top to come to your work.',
     '🛍️ Programu hufunguka sokoni – bonyeza Business Manager juu kuja kwenye kazi yako.', 8),
  ('assistant-admin', '⏻ Log out is also at the bottom of the ☰ menu.',
     '⏻ Kutoka (Log out) kupo pia chini ya menyu ya ☰.', 9),
  ('assistant-admin', '📞 Users → Business Profile: type your shop number the way you say it (0712 345 678) – it is kept as +255… so the WhatsApp button reaches you.',
     '📞 Users → Business Profile: andika namba ya duka kama unavyoitamka (0712 345 678) – huhifadhiwa kama +255… ili kitufe cha WhatsApp kikufikie.', 10),
  ('assistant-admin', '⚠️ The Low Stock tile on the Dashboard also counts products that have run out, and says how many are out.',
     '⚠️ Kigae cha Low Stock kwenye Dashboard huhesabu pia bidhaa zilizoisha kabisa, na huonyesha idadi yake.', 11),
  ('assistant-admin', '📄 A report leaves out the columns your shop never fills, so the PDF is easier to read.',
     '📄 Ripoti huacha safu ambazo duka lako halijazi, hivyo PDF ni rahisi kusoma.', 12),
  ('manager', '🛍️ The app opens on the marketplace – tap Business Manager at the top to come to your work.',
     '🛍️ Programu hufunguka sokoni – bonyeza Business Manager juu kuja kwenye kazi yako.', 13),
  ('manager', '⏻ Log out is also at the bottom of the ☰ menu.',
     '⏻ Kutoka (Log out) kupo pia chini ya menyu ya ☰.', 14),
  ('manager', '✅ Activate on a new business also lets its owner sign in – no second step under Users.',
     '✅ Activate kwenye biashara mpya humruhusu pia mmiliki wake kuingia – hakuna hatua ya pili kwenye Users.', 15),
  ('assistant-manager', '🛍️ The app opens on the marketplace – tap Business Manager at the top to come to your work.',
     '🛍️ Programu hufunguka sokoni – bonyeza Business Manager juu kuja kwenye kazi yako.', 16),
  ('assistant-manager', '⏻ Log out is also at the bottom of the ☰ menu.',
     '⏻ Kutoka (Log out) kupo pia chini ya menyu ya ☰.', 17),
  ('assistant-manager', '✅ Activate on a new business also lets its owner sign in – no second step under Users.',
     '✅ Activate kwenye biashara mpya humruhusu pia mmiliki wake kuingia – hakuna hatua ya pili kwenye Users.', 18),
  ('marketplace', '🏢 Have a shop here? Tap Business Manager at the top to open your workspace.',
     '🏢 Una duka hapa? Bonyeza Business Manager juu kufungua eneo lako la kazi.', 19),
  ('marketplace', '🖼️ Get the app → Save this code as a picture puts the QR code in your Downloads, ready to print for your counter.',
     '🖼️ Get the app → Save this code as a picture huweka QR code kwenye Downloads zako, tayari kuchapishwa kwa ajili ya kaunta yako.', 20)
) as t(role, en, sw, n)
where exists (select 1 from hints)
  and not exists (select 1 from hints h where h.role = t.role and h.message_en = t.en);

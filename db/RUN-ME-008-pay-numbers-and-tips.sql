-- =====================================================================================
-- RUN-ME-008 -- Lipa Namba (the numbers a shop is paid on), and the tips for the search,
--               the contact buttons and the small pictures of 16 November 2026.
-- =====================================================================================
-- Run in the Supabase SQL editor. Safe to run twice: the table and its index are created only
-- if they are missing, and a tip is added once.
--
-- WHAT IT ADDS
--   pay_numbers   up to three numbers per business -- network, number, and the NAME the
--                 customer's phone shows before they enter their PIN. Shown to the shop's own
--                 sellers at the till when "Lipa Number" is chosen, and on the receipt.
--                 Never read by the public marketplace. One line per place in a business's
--                 list (a unique index), so two saves at the same moment cannot both land.
--
-- WITHOUT IT nothing breaks: the till shows no number (as it always did), and Users ->
-- Business Profile says that this file has to be run before a number can be saved.
--
-- It is quick: one empty table and one small (unique) index. Nothing existing is rewritten.

create table if not exists pay_numbers (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  network text not null,                        -- 'M-Pesa', 'Airtel Money', 'Mixx by Yas', a bank...
  number text not null,                         -- digits only
  name text not null,                           -- what the customer's phone shows
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
-- UNIQUE, on purpose: a save is "delete the old list, insert the new one", and two of them at
-- the same moment (an admin who taps Save twice on a slow line, two admins, or the database
-- being asked to repeat an insert whose answer was lost) used to leave BOTH lists in the table,
-- the retired number beside the real one under the same name. With one line allowed per place
-- in the list, the second insert is refused whole and the till can only ever show one list.
-- It also serves the till's read: this business's lines, in order.
create unique index if not exists pay_numbers_vendor_sort_uq on pay_numbers (vendor_id, sort);

-- Tell the API layer the table is there, without waiting for it to notice.
notify pgrst, 'reload schema';

-- ---- the tips, for a hints list that is already in use ------------------------------------
-- The app shows its built-in tips while the hints table is empty, and the table's own rows the
-- moment it has any; this adds the new ones to such a list and does nothing to an empty one.
-- Every line is word for word a built-in tip of api/_lib/bo/hints.js;
-- test/hints-settings.test.mjs fails if the two ever differ.
insert into hints (role, message_en, message_sw, active, sort)
select t.role, t.en, t.sw, true, (select coalesce(max(sort), 0) from hints) + t.n
from (values
  ('seller', '📱 Customer paying by Lipa Number? Choose it at the till and read out the number shown – they must see the same name on their phone before the PIN.',
     '📱 Mteja analipa kwa Lipa Number? Ichague kwenye mauzo usome namba inayoonekana – aone jina hilohilo kwenye simu yake kabla ya PIN.', 1),
  ('admin', '📱 Users → Business Profile: save your Lipa Namba and the name customers see – your sellers get it at the till when they choose Lipa Number.',
     '📱 Users → Business Profile: hifadhi Lipa Namba yako na jina analoliona mteja – wauzaji wataiona wanapochagua Lipa Number.', 2),
  ('admin', '🖼️ Product photos now open faster on the marketplace – save an old photo again once to give it a small copy too.',
     '🖼️ Picha za bidhaa sasa hufunguka haraka sokoni – hifadhi tena picha ya zamani mara moja ipate nakala ndogo pia.', 3),
  ('assistant-admin', '📱 Users → Business Profile: save your Lipa Namba and the name customers see – your sellers get it at the till when they choose Lipa Number.',
     '📱 Users → Business Profile: hifadhi Lipa Namba yako na jina analoliona mteja – wauzaji wataiona wanapochagua Lipa Number.', 4),
  ('assistant-admin', '🖼️ Product photos now open faster on the marketplace – save an old photo again once to give it a small copy too.',
     '🖼️ Picha za bidhaa sasa hufunguka haraka sokoni – hifadhi tena picha ya zamani mara moja ipate nakala ndogo pia.', 5),
  ('marketplace', '🔎 Search in English or Kiswahili – simu finds phones, saa finds watches – and a small spelling slip still finds it.',
     '🔎 Tafuta kwa Kiswahili au Kiingereza – simu hupata phones, saa hupata watches – hata ukikosea herufi kidogo.', 6),
  ('marketplace', '📞 No data bundle? Open a product and tap Call to ring the shop, or SMS to send a message that is already written.',
     '📞 Huna bando? Fungua bidhaa kisha bonyeza Call kupiga simu dukani, au SMS kutuma ujumbe ulioandikwa tayari.', 7)
) as t(role, en, sw, n)
where exists (select 1 from hints)
  and not exists (select 1 from hints h where h.role = t.role and h.message_en = t.en);

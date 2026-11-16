import { rows, insertMany, update, remove, count, sel, columnAbsent, text, mustText, badRequest, notFound, permissionsOf } from './_shared.js';
import { requireManager } from '../auth.js';

/* =====================================================================================
   HINTS -- the bilingual rotating tips.
   =====================================================================================
   One table, six roles plus 'all' and 'marketplace'. Every screen asks for ITS role's rows
   (plus 'all') through hintsForRole(); when the table has nothing for a role the legacy
   built-in list answers instead, exactly as the Apps Script getHintSettingsForUser did, so a
   fresh database is never silent. The manager edits the table from the Settings tab. */

export const HINT_ROLES = ['seller', 'admin', 'assistant-admin', 'manager', 'assistant-manager', 'all', 'marketplace'];

/* Copied verbatim from legacy/Code.gs getHintSettingsForUser. `manager` had no list of its own
   there either -- an unknown role reads the seller's, which is what the old app showed. */
/* Every hint is a PAIR now. The tips were English-only and the Swahili side was the empty
   string, so the EN/SW toggle in the top bar changed the flag on the button and nothing else --
   in a country where Kiswahili is the working language of most shop counters. A hint a seller
   cannot read is not a hint.

   And six screens arrived without any: Holds, Purchase Orders, Credit & Voids, the receipt
   button, the Profit report and the cost price it needs. A feature nobody is told about is a
   feature nobody uses, which is the same as not having shipped it.

   A manager can still replace the whole list from Settings; these are what a database with no
   hints of its own shows. */
export const DEFAULT_HINTS = {
  seller: [
    ['\ud83d\udca1 Your User ID is your login \u2013 use it every time you sell.',
     '\ud83d\udca1 Namba yako ya mtumiaji ndiyo unayoingia nayo \u2013 itumie kila unapouza.'],
    ['\ud83d\uded2 Always select product and quantity before submitting.',
     '\ud83d\uded2 Chagua bidhaa na idadi kabla ya kutuma.'],
    ["\ud83d\udcb0 Cash='Cash', mobile='Lipa Number'.",
     "\ud83d\udcb0 Fedha taslimu='Cash', simu='Lipa Number'."],
    ['\ud83d\udce6 Check Stock for low products.',
     '\ud83d\udce6 Angalia Stoo kuona bidhaa zinazokaribia kuisha.'],
    ['\ud83d\udd12 Keep your password safe \u2013 never share it.',
     '\ud83d\udd12 Tunza neno lako la siri \u2013 usimpe mtu yeyote.'],
    ['\ud83d\udce5 Download your sales reports from the Reports tab.',
     '\ud83d\udce5 Pakua ripoti za mauzo yako kwenye kichupo cha Ripoti.'],
    ['\ud83d\udd04 Use Refresh to see the latest numbers.',
     '\ud83d\udd04 Bonyeza Onyesha upya kuona namba za sasa.'],
    ['\ud83d\udcb8 A Discount on a line lowers that line only \u2013 the receipt shows the list price crossed out.',
     '\ud83d\udcb8 Punguzo kwenye laini hupunguza laini hiyo tu \u2013 risiti inaonyesha bei ya kawaida imepigwa mstari.', 'phoneVending'],
    ['\ud83d\udc41\ufe0f Typed your password wrong? Tap the eye on the password box to see what you typed.',
     '\ud83d\udc41\ufe0f Umekosea neno la siri? Bonyeza jicho kwenye kisanduku cha neno la siri uone ulichoandika.'],
    ['\ud83d\udccb Use Lendings tab to record and track borrowed items.',
     '\ud83d\udccb Tumia kichupo cha Mikopo ya bidhaa kurekodi na kufuatilia vilivyoazimwa.'],
    ['\ud83e\uddfe After a sale, tap the receipt button to print it or send it on WhatsApp.',
     '\ud83e\uddfe Baada ya mauzo, bonyeza risiti kuichapisha au kuituma kwa WhatsApp.'],
    ['\ud83d\udd16 Customer coming back on Friday? Put it on Holds so nobody sells it.',
     '\ud83d\udd16 Mteja atarudi Ijumaa? Weka kwenye Zilizowekwa ili asiuziwe mtu mwingine.'],
    ['\ud83e\udd1d Goods leaving unsold? Choose Lending at the till instead of a sale.',
     '\ud83e\udd1d Bidhaa zinatoka bila kuuzwa? Chagua Mkopo wa bidhaa badala ya mauzo.'],
    ['\ud83d\udcf2 If the app asks you to update, tap Update now \u2013 it takes a moment and nothing you entered is lost.',
     '\ud83d\udcf2 Programu ikikuomba kusasisha, bonyeza Sasisha sasa \u2013 huchukua muda mfupi na hakuna ulichoandika kinachopotea.'],
    ['\ud83d\udc64 Add the customer\u2019s name and phone \u2013 it puts them on the receipt.',
     '\ud83d\udc64 Andika jina na simu ya mteja \u2013 huonekana kwenye risiti.'],
    ['\ud83d\udc46 A tip in your way? Swipe it off the screen in any direction.',
     '\ud83d\udc46 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.'],
    ['\ud83d\udecd\ufe0f The app opens on the marketplace \u2013 tap Business Manager at the top to come to your work.',
     '\ud83d\udecd\ufe0f Programu hufunguka sokoni \u2013 bonyeza Business Manager juu kuja kwenye kazi yako.'],
    ['\u23fb Log out is also at the bottom of the \u2630 menu.',
     '\u23fb Kutoka (Log out) kupo pia chini ya menyu ya \u2630.'],
    ['\ud83d\udda8\ufe0f Print on a receipt opens the print screen of the phone \u2013 choose a printer, or Save as PDF. Update the app if it says it cannot.',
     '\ud83d\udda8\ufe0f Print kwenye risiti hufungua skrini ya kuchapisha ya simu \u2013 chagua printa, au Save as PDF. Sasisha programu ikisema haiwezi.'],
    ['\ud83d\udcf1 Customer paying by Lipa Number? Choose it at the till and read out the number shown \u2013 they must see the same name on their phone before the PIN.',
     '\ud83d\udcf1 Mteja analipa kwa Lipa Number? Ichague kwenye mauzo usome namba inayoonekana \u2013 aone jina hilohilo kwenye simu yake kabla ya PIN.'],
  ],
  admin: [
    ['\ud83d\udcf2 If the app asks you to update, tap Update now \u2013 it takes a moment and nothing you entered is lost.',
     '\ud83d\udcf2 Programu ikikuomba kusasisha, bonyeza Sasisha sasa \u2013 huchukua muda mfupi na hakuna ulichoandika kinachopotea.'],
    ['\ud83d\udc65 Add or edit users in the Users tab.',
     '\ud83d\udc65 Ongeza au hariri watumiaji kwenye kichupo cha Watumiaji.'],
    ['\ud83d\udce6 Add products, photos or increase stock in the Products tab.',
     '\ud83d\udce6 Ongeza bidhaa, picha au stoo kwenye kichupo cha Bidhaa.'],
    ['\ud83d\udecd\ufe0f Add 1\u20132 photos per product so it shines in the marketplace.',
     '\ud83d\udecd\ufe0f Weka picha 1\u20132 kwa kila bidhaa ionekane vizuri sokoni.'],
    ['\ud83d\udcb0 Record cash payments from sellers in Cash tab.',
     '\ud83d\udcb0 Rekodi fedha unazopokea kwa wauzaji kwenye kichupo cha Fedha.'],
    ['\ud83d\udcca Seller balances show who owes what today.',
     '\ud83d\udcca Salio la muuzaji linaonyesha nani anadaiwa nini leo.'],
    ['\ud83c\udff7\ufe0f Cost Price is optional \u2013 but without it the Profit report is only a guess.',
     '\ud83c\udff7\ufe0f Bei ya kununulia si lazima \u2013 lakini bila hiyo ripoti ya Faida ni kubahatisha.'],
    ['\ud83d\udcc8 The Profit report shows what you EARNED, not just what you took.',
     '\ud83d\udcc8 Ripoti ya Faida inaonyesha ulichopata, si tu ulichokusanya.'],
    ['\ud83d\ude9a Order stock on Purchase Orders \u2013 receiving it updates the cost price for you.',
     '\ud83d\ude9a Agiza bidhaa kwenye Oda za manunuzi \u2013 zikipokelewa bei ya kununulia inajisasisha.'],
    ['\ud83d\udcb3 Credit & Voids shows what financing partners still owe you.',
     '\ud83d\udcb3 Mikopo na Zilizofutwa inaonyesha wanaokukopesha wanachokudai.'],
    ['\ud83d\uddd1\ufe0f Cancel a sale from the dashboard \u2013 the stock goes back on the shelf.',
     '\ud83d\uddd1\ufe0f Futa mauzo kwenye dashibodi \u2013 bidhaa zinarudi stoo.'],
    ['\ud83d\udccb Use Lendings to record and track borrowed items.',
     '\ud83d\udccb Tumia Mikopo ya bidhaa kurekodi na kufuatilia vilivyoazimwa.'],
    ['\ud83d\udce5 Download sales, stock, profit or cash due reports anytime.',
     '\ud83d\udce5 Pakua ripoti za mauzo, stoo, faida au madeni wakati wowote.'],
    ['\ud83d\udcf1 Selling phones? Register each handset by IMEI under Phone Vending, then sell that exact one.',
     '\ud83d\udcf1 Unauza simu? Sajili kila simu kwa IMEI kwenye Phone Vending, kisha uuze ile ile hasa.', 'phoneVending'],
    ['\ud83c\udfe6 Financing partners (MOGO, Watu) live under Phone Vending \u2013 pick one when you sell on credit.',
     '\ud83c\udfe6 Wafadhili wa mikopo (MOGO, Watu) wako kwenye Phone Vending \u2013 chagua mmoja unapouza kwa mkopo.', 'phoneVending'],
    ['\ud83d\udccd Users \u2192 Business Profile: set your shop location, and customers get a Location button to you on the marketplace.',
     '\ud83d\udccd Users \u2192 Business Profile: weka mahali pa duka lako, na wateja watapata kitufe cha Location sokoni.'],
    ['\ud83c\udfea The marketplace shows how long your business has been here and how many sales you have recorded \u2013 every sale you record adds to it.',
     '\ud83c\udfea Soko linaonyesha muda wa biashara yako na idadi ya mauzo uliyorekodi \u2013 kila mauzo unayorekodi yanaongeza.'],
    ['\ud83d\udc46 A tip in your way? Swipe it off the screen in any direction.',
     '\ud83d\udc46 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.'],
    ['\ud83d\udecd\ufe0f The app opens on the marketplace \u2013 tap Business Manager at the top to come to your work.',
     '\ud83d\udecd\ufe0f Programu hufunguka sokoni \u2013 bonyeza Business Manager juu kuja kwenye kazi yako.'],
    ['\u23fb Log out is also at the bottom of the \u2630 menu.',
     '\u23fb Kutoka (Log out) kupo pia chini ya menyu ya \u2630.'],
    ['\ud83d\udcde Users \u2192 Business Profile: type your shop number the way you say it (0712 345 678) \u2013 it is kept as +255\u2026 so the WhatsApp button reaches you.',
     '\ud83d\udcde Users \u2192 Business Profile: andika namba ya duka kama unavyoitamka (0712 345 678) \u2013 huhifadhiwa kama +255\u2026 ili kitufe cha WhatsApp kikufikie.'],
    ['\u26a0\ufe0f The Low Stock tile on the Dashboard also counts products that have run out, and says how many are out.',
     '\u26a0\ufe0f Kigae cha Low Stock kwenye Dashboard huhesabu pia bidhaa zilizoisha kabisa, na huonyesha idadi yake.'],
    ['\ud83d\udcc4 A report leaves out the columns your shop never fills, so the PDF is easier to read.',
     '\ud83d\udcc4 Ripoti huacha safu ambazo duka lako halijazi, hivyo PDF ni rahisi kusoma.'],
    ['\ud83d\udce5 In the app, a report you download is saved in the Downloads of the phone, under its own name.',
     '\ud83d\udce5 Kwenye programu, ripoti unayopakua huhifadhiwa kwenye Downloads za simu, kwa jina lake.'],
    ['\ud83d\udda8\ufe0f Print on a receipt opens the print screen of the phone \u2013 choose a printer, or Save as PDF. Update the app if it says it cannot.',
     '\ud83d\udda8\ufe0f Print kwenye risiti hufungua skrini ya kuchapisha ya simu \u2013 chagua printa, au Save as PDF. Sasisha programu ikisema haiwezi.'],
    ['\ud83d\udcf1 Users \u2192 Business Profile: save your Lipa Namba and the name customers see \u2013 your sellers get it at the till when they choose Lipa Number.',
     '\ud83d\udcf1 Users \u2192 Business Profile: hifadhi Lipa Namba yako na jina analoliona mteja \u2013 wauzaji wataiona wanapochagua Lipa Number.'],
    ['\ud83d\uddbc\ufe0f Product photos now open faster on the marketplace \u2013 save an old photo again once to give it a small copy too.',
     '\ud83d\uddbc\ufe0f Picha za bidhaa sasa hufunguka haraka sokoni \u2013 hifadhi tena picha ya zamani mara moja ipate nakala ndogo pia.'],
  ],
  'assistant-admin': [
    ['\ud83d\udc65 You can manage sellers under your admin.',
     '\ud83d\udc65 Unaweza kusimamia wauzaji walio chini ya msimamizi wako.'],
    ['\ud83d\udce6 Check stock levels regularly.',
     '\ud83d\udce6 Kagua kiwango cha stoo mara kwa mara.'],
    ['\ud83d\udcb0 Record cash from sellers in Cash tab.',
     '\ud83d\udcb0 Rekodi fedha kutoka kwa wauzaji kwenye kichupo cha Fedha.'],
    ['\ud83d\udcca Dashboard shows business overview.',
     '\ud83d\udcca Dashibodi inaonyesha muhtasari wa biashara.'],
    ['\ud83d\ude9a Receive a delivery on Purchase Orders \u2013 enter what actually arrived, not what was ordered.',
     '\ud83d\ude9a Pokea bidhaa kwenye Oda za manunuzi \u2013 andika zilizofika kweli, si zilizoagizwa.'],
    ['\ud83d\udd16 Holds keep stock off the shelf for a customer who is coming back.',
     '\ud83d\udd16 Zilizowekwa huhifadhi bidhaa kwa mteja atakayerudi.'],
    ['\ud83d\udcf1 Handsets tracked one by one live under Phone Vending, not Stock & Shops.',
     '\ud83d\udcf1 Simu zinazofuatiliwa moja moja ziko kwenye Phone Vending, si Stock & Shops.', 'phoneVending'],
    ['\ud83d\udccd Users \u2192 Business Profile: set your shop location, and customers get a Location button to you on the marketplace.',
     '\ud83d\udccd Users \u2192 Business Profile: weka mahali pa duka lako, na wateja watapata kitufe cha Location sokoni.'],
    ['\ud83d\udc46 A tip in your way? Swipe it off the screen in any direction.',
     '\ud83d\udc46 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.'],
    ['\ud83d\udecd\ufe0f The app opens on the marketplace \u2013 tap Business Manager at the top to come to your work.',
     '\ud83d\udecd\ufe0f Programu hufunguka sokoni \u2013 bonyeza Business Manager juu kuja kwenye kazi yako.'],
    ['\u23fb Log out is also at the bottom of the \u2630 menu.',
     '\u23fb Kutoka (Log out) kupo pia chini ya menyu ya \u2630.'],
    ['\ud83d\udcde Users \u2192 Business Profile: type your shop number the way you say it (0712 345 678) \u2013 it is kept as +255\u2026 so the WhatsApp button reaches you.',
     '\ud83d\udcde Users \u2192 Business Profile: andika namba ya duka kama unavyoitamka (0712 345 678) \u2013 huhifadhiwa kama +255\u2026 ili kitufe cha WhatsApp kikufikie.'],
    ['\u26a0\ufe0f The Low Stock tile on the Dashboard also counts products that have run out, and says how many are out.',
     '\u26a0\ufe0f Kigae cha Low Stock kwenye Dashboard huhesabu pia bidhaa zilizoisha kabisa, na huonyesha idadi yake.'],
    ['\ud83d\udcc4 A report leaves out the columns your shop never fills, so the PDF is easier to read.',
     '\ud83d\udcc4 Ripoti huacha safu ambazo duka lako halijazi, hivyo PDF ni rahisi kusoma.'],
    ['\ud83d\udce5 In the app, a report you download is saved in the Downloads of the phone, under its own name.',
     '\ud83d\udce5 Kwenye programu, ripoti unayopakua huhifadhiwa kwenye Downloads za simu, kwa jina lake.'],
    ['\ud83d\udda8\ufe0f Print on a receipt opens the print screen of the phone \u2013 choose a printer, or Save as PDF. Update the app if it says it cannot.',
     '\ud83d\udda8\ufe0f Print kwenye risiti hufungua skrini ya kuchapisha ya simu \u2013 chagua printa, au Save as PDF. Sasisha programu ikisema haiwezi.'],
    ['\ud83d\udcf1 Users \u2192 Business Profile: save your Lipa Namba and the name customers see \u2013 your sellers get it at the till when they choose Lipa Number.',
     '\ud83d\udcf1 Users \u2192 Business Profile: hifadhi Lipa Namba yako na jina analoliona mteja \u2013 wauzaji wataiona wanapochagua Lipa Number.'],
    ['\ud83d\uddbc\ufe0f Product photos now open faster on the marketplace \u2013 save an old photo again once to give it a small copy too.',
     '\ud83d\uddbc\ufe0f Picha za bidhaa sasa hufunguka haraka sokoni \u2013 hifadhi tena picha ya zamani mara moja ipate nakala ndogo pia.'],
  ],
  /* A MANAGER HAD NO LIST, so hintsForRole fell through to the seller's and the person who
     owns the platform was told "Your User ID is your login \u2013 use it every time you sell."
     These are the manager's own screens, including the two switches that decide what a
     business is charged and what its staff can see. */
  manager: [
    ['\ud83c\udfe2 Every business is a row in Management \u2013 activate, restrict or set its logo there.',
     '\ud83c\udfe2 Kila biashara ni safu kwenye Usimamizi \u2013 iwashe, izuie au weka nembo yake hapo.'],
    ['\ud83d\udcf1 Phone Vending is per business: switch it on in Management for a shop that sells handsets by IMEI.',
     '\ud83d\udcf1 Phone Vending ni kwa kila biashara: iwashe kwenye Usimamizi kwa duka linalouza simu kwa IMEI.'],
    ['\ud83d\udcbc Commission Rate is in Management, not Settings \u2013 type 0.6 for 0.6% of sales.',
     '\ud83d\udcbc Kiwango cha kamisheni kiko kwenye Usimamizi, si Mipangilio \u2013 andika 0.6 kwa 0.6% ya mauzo.'],
    ['\ud83e\uddfe Issue invoices, then read "Who would be blocked?" BEFORE you switch blocking on.',
     '\ud83e\uddfe Toa ankara, kisha soma "Nani angezuiwa?" KABLA hujawasha kuzuia.'],
    ['\ud83d\udcdd Manage Hints is in Settings \u2013 load the built-in tips once to see and edit what everybody reads.',
     '\ud83d\udcdd Simamia Vidokezo kwenye Mipangilio \u2013 pakia vidokezo vya msingi mara moja ili uone na uhariri vinavyosomwa na wote.'],
    ['\u2699\ufe0f Applying a permission profile in Settings changes EVERY business at once.',
     '\u2699\ufe0f Kuweka ruhusa kwenye Mipangilio kunabadilisha KILA biashara kwa mara moja.'],
    ['\ud83d\udc46 A tip in your way? Swipe it off the screen in any direction.',
     '\ud83d\udc46 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.'],
    ['\ud83d\udecd\ufe0f The app opens on the marketplace \u2013 tap Business Manager at the top to come to your work.',
     '\ud83d\udecd\ufe0f Programu hufunguka sokoni \u2013 bonyeza Business Manager juu kuja kwenye kazi yako.'],
    ['\u23fb Log out is also at the bottom of the \u2630 menu.',
     '\u23fb Kutoka (Log out) kupo pia chini ya menyu ya \u2630.'],
    ['\u2705 Activate on a new business also lets its owner sign in \u2013 no second step under Users.',
     '\u2705 Activate kwenye biashara mpya humruhusu pia mmiliki wake kuingia \u2013 hakuna hatua ya pili kwenye Users.'],
    ['\ud83d\udce5 In the app, a report you download is saved in the Downloads of the phone, under its own name.',
     '\ud83d\udce5 Kwenye programu, ripoti unayopakua huhifadhiwa kwenye Downloads za simu, kwa jina lake.'],
  ],
  'assistant-manager': [
    ['\ud83c\udfe2 View all vendor performance.',
     '\ud83c\udfe2 Angalia utendaji wa biashara zote.'],
    ['\ud83d\udcca Download comprehensive reports in the Reports tab.',
     '\ud83d\udcca Pakua ripoti kamili kwenye kichupo cha Ripoti.'],
    ['\ud83d\udcbc Set commission rates in Management tab.',
     '\ud83d\udcbc Weka viwango vya kamisheni kwenye kichupo cha Usimamizi.'],
    ['\ud83d\udc46 A tip in your way? Swipe it off the screen in any direction.',
     '\ud83d\udc46 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.'],
    ['\ud83d\udecd\ufe0f The app opens on the marketplace \u2013 tap Business Manager at the top to come to your work.',
     '\ud83d\udecd\ufe0f Programu hufunguka sokoni \u2013 bonyeza Business Manager juu kuja kwenye kazi yako.'],
    ['\u23fb Log out is also at the bottom of the \u2630 menu.',
     '\u23fb Kutoka (Log out) kupo pia chini ya menyu ya \u2630.'],
    ['\u2705 Activate on a new business also lets its owner sign in \u2013 no second step under Users.',
     '\u2705 Activate kwenye biashara mpya humruhusu pia mmiliki wake kuingia \u2013 hakuna hatua ya pili kwenye Users.'],
    ['\ud83d\udce5 In the app, a report you download is saved in the Downloads of the phone, under its own name.',
     '\ud83d\udce5 Kwenye programu, ripoti unayopakua huhifadhiwa kwenye Downloads za simu, kwa jina lake.'],
  ],
  marketplace: [
    ['\ud83d\udecd\ufe0f Tap any product to view details and contact the seller.',
     '\ud83d\udecd\ufe0f Bonyeza bidhaa yoyote kuona maelezo na kuwasiliana na muuzaji.'],
    ['\ud83d\udd0d Search by product name, category or business.',
     '\ud83d\udd0d Tafuta kwa jina la bidhaa, aina au biashara.'],
    ['\ud83d\udd25 A flame badge marks the most-viewed products.',
     '\ud83d\udd25 Alama ya moto inaonyesha bidhaa zinazotazamwa zaidi.'],
    ['\ud83d\udcf2 Contact a seller directly on WhatsApp.',
     '\ud83d\udcf2 Wasiliana na muuzaji moja kwa moja kwa WhatsApp.'],
    ['\ud83c\udd95 New businesses join the marketplace often \u2014 check back!',
     '\ud83c\udd95 Biashara mpya zinajiunga mara kwa mara \u2014 rudi tena!'],
    ['\ud83d\udc41\ufe0f Typed your password wrong? Tap the eye on the password box to see what you typed.',
     '\ud83d\udc41\ufe0f Umekosea neno la siri? Bonyeza jicho kwenye kisanduku cha neno la siri uone ulichoandika.'],
    ['\ud83d\udd16 Tap the bookmark on a product photo to save it. Your saved products wait under Favorites.',
     '\ud83d\udd16 Bonyeza alama ya kuhifadhi kwenye picha ya bidhaa. Ulizohifadhi zinakusubiri kwenye Favorites.'],
    ['\ud83d\udd0e Tap the lens on a product photo to see similar products from every shop.',
     '\ud83d\udd0e Bonyeza lenzi kwenye picha ya bidhaa kuona bidhaa zinazofanana kutoka maduka yote.'],
    ['\ud83d\udccd Open a product and tap Location to go to the shop with Google Maps.',
     '\ud83d\udccd Fungua bidhaa kisha bonyeza Location kwenda dukani kwa Google Maps.'],
    ['\ud83c\udfea Under each shop name: how long the business has been here and how many sales it has made.',
     '\ud83c\udfea Chini ya jina la duka: muda ambao biashara imekuwepo na idadi ya mauzo iliyofanya.'],
    ['\ud83d\udc46 A tip in your way? Swipe it off the screen in any direction.',
     '\ud83d\udc46 Kidokezo kinakuzuia? Kitelezeshe nje ya skrini upande wowote.'],
    ['\ud83c\udfe2 Have a shop here? Tap Business Manager at the top to open your workspace.',
     '\ud83c\udfe2 Una duka hapa? Bonyeza Business Manager juu kufungua eneo lako la kazi.'],
    ['\ud83d\uddbc\ufe0f Get the app \u2192 Save this code as a picture puts the QR code in your Downloads, ready to print for your counter.',
     '\ud83d\uddbc\ufe0f Get the app \u2192 Save this code as a picture huweka QR code kwenye Downloads zako, tayari kuchapishwa kwa ajili ya kaunta yako.'],
    ['\ud83d\udd0e Search in English or Kiswahili \u2013 simu finds phones, saa finds watches \u2013 and a small spelling slip still finds it.',
     '\ud83d\udd0e Tafuta kwa Kiswahili au Kiingereza \u2013 simu hupata phones, saa hupata watches \u2013 hata ukikosea herufi kidogo.'],
    ['\ud83d\udcde No data bundle? Open a product and tap Call to ring the shop, or SMS to send a message that is already written.',
     '\ud83d\udcde Huna bando? Fungua bidhaa kisha bonyeza Call kupiga simu dukani, au SMS kutuma ujumbe ulioandikwa tayari.'],
  ],
};

const HINT_COLS = 'id, role, message_en, message_sw, feature, active, sort, created_at';

/* WHICH BUSINESSES A TIP IS FOR. null / '' means everybody; 'phoneVending' means only a business
   the manager has switched Phone Vending on for. It is the SAME string as the permission flag on
   the vendor row on purpose -- one name for one idea, so a tip can never be shown to a business
   whose screens do not have the thing it talks about. Telling a grocer to "register each handset
   by IMEI under Phone Vending" is worse than telling them nothing: they go looking for a tab that
   is not there and conclude the app is broken.

   THE COLUMN MAY NOT BE THERE (db/RUN-ME-005). Absent, sel() drops it, every row comes back with
   feature undefined, and every tip is shown to everybody -- which is exactly what happened before
   any of this, so a database that has not run the migration is no worse off. */
export const HINT_FEATURES = ['phoneVending'];
const featureOk = (row, features) => {
  const f = String((row && row.feature) || '').trim();
  return !f || !!(features && features[f]);
};
function featureArg(v) {
  const f = text(v);
  if (!f) return null;
  if (!HINT_FEATURES.includes(f)) throw badRequest('Unknown hint audience: ' + f + '. Use one of ' + HINT_FEATURES.join(', ') + ', or leave it blank for everybody.');
  return f;
}
// A hint list is a few dozen rows at most; the bound is there so a runaway import cannot make
// every boot carry it.
const MAX_HINTS = 500;

/** [{ en, sw }] for a role (+ 'all'), with the legacy built-in defaults when the table has none.
    `features` is boot's own features object, so a tip for a feature this business does not have
    is dropped -- from the table's rows and from the built-ins alike, by the same test.

    STILL ONE READ. The filter runs on rows that were already coming back, and the WHERE stays
    exactly as it was: `feature` cannot go in the query because the column may not exist yet, and
    a query naming a column PostgREST does not know is refused WHOLE -- every screen's hints, and
    on this path boot itself. Cheap in the database, or nothing at all. */
export async function hintsForRole(db, role, features) {
  const r = text(role) || 'seller';
  const list = await rows(db, 'hints', q => q.select(sel('hints', 'message_en, message_sw, feature')).in('role', [r, 'all']).eq('active', true)
    .order('sort', { ascending: true }).order('id', { ascending: true }).limit(MAX_HINTS));
  if (list.length) {
    const keep = list.filter(h => featureOk(h, features));
    /* A ROLE WHOSE EVERY TIP WAS FOR A FEATURE THIS BUSINESS HAS NOT GOT would fall through to
       the built-ins below and show phone tips again -- the one case where filtering could put
       back what it was meant to take away. An empty list is the honest answer. */
    return keep.map(h => ({ en: String(h.message_en || '').trim(), sw: String(h.message_sw || '').trim() }));
  }
  return (DEFAULT_HINTS[r] || DEFAULT_HINTS.seller)
    .filter(m => featureOk({ feature: m[2] }, features))
    .map(m => ({ en: m[0], sw: m[1] || '' }));
}

function roleArg(v) {
  const r = text(v);
  if (!r || !HINT_ROLES.includes(r)) throw badRequest('Pick a hint role: ' + HINT_ROLES.join(', ') + '.');
  return r;
}

export const FN = {
  /** Manager: every row, grouped by role. Everybody else: the live rows their screen rotates. */
  async hints(db, user) {
    if (user.is_manager) {
      const list = await rows(db, 'hints', q => q.select(sel('hints', HINT_COLS)).order('role', { ascending: true }).order('sort', { ascending: true }).limit(MAX_HINTS));
      /* ASKED AFTER THE READ, WHICH IS THE ONLY MOMENT IT CAN BE ANSWERED. columnAbsent knows
         only what this process has already been refused, so on a cold instance it is false until
         something has tried -- and the read above is that something. Told here, the Manage Hints
         screen can say that "Shown to" will not do anything yet instead of quietly saving a
         value that is dropped on the way to the database. Silence reads as success. */
      return { rows: list, feature_column: !columnAbsent('hints', 'feature') };
    }
    /* The manager above sees EVERY row, because they are the person who edits them and a tip
       they cannot see is a tip they cannot fix. Everybody else sees the rows their own screens
       could act on -- the same feature test boot applies, in the same place, so the two can
       never come to different answers about one hint. */
    const features = { phoneVending: !!permissionsOf(user.vendor).phoneVending };
    const list = await rows(db, 'hints', q => q.select(sel('hints', HINT_COLS)).in('role', [user.role, 'all']).eq('active', true)
      .order('sort', { ascending: true }).limit(MAX_HINTS));
    return { rows: list.filter(h => featureOk(h, features)) };
  },

  /** Bulk add, as the Settings tab's textarea does: one row per line, blank lines skipped. */
  async addHints(db, user, args, nowMs) {
    requireManager(user);
    const list = Array.isArray(args.rows) ? args.rows : [];
    const made = [];
    for (const item of list) {
      const en = text(item && item.en);
      if (!en) continue;                                  // legacy skipped blank messages silently
      made.push({ role: roleArg(item.role), message_en: en, message_sw: text(item && item.sw) || '', feature: featureArg(item && item.feature), active: true });
    }
    if (!made.length) throw badRequest('No hints to add.');
    // New rows sort after everything already there, keeping the manager's order of entry.
    const base = await count(db, 'hints', q => q);
    made.forEach((r, i) => { r.sort = base + i; r.created_at = new Date(nowMs).toISOString(); });
    await insertMany(db, 'hints', made);
    return { message: made.length + ' hint(s) added.' };
  },

  /** {} -> { message }. Writes the built-in list into the table, once, so a manager can SEE the
      tips their staff are reading and edit or delete them one at a time.

      WHY THIS EXISTS. The defaults live in code, so Manage Hints showed an empty list while
      thirty-eight tips rotated on the screens -- which reads as "there are no hints". And
      hintsForRole returns the table's rows INSTEAD of the defaults the moment a role has one,
      so saving a single seller hint silently removed the other twelve. After this, a role's
      tips are all in one place and adding a thirteenth adds rather than erases.

      NOTHING CHANGES ON SCREEN when it runs: the rows written are the defaults themselves, so
      every role serves exactly what it served before. That is what makes it safe to press. */
  async loadDefaultHints(db, user, args, nowMs) {
    requireManager(user);
    /* ONE PRESS ONLY. A second would double every tip, and a manager who could not tell whether
       the first worked is exactly the person who presses again. Refusing on ANY existing row --
       not just a duplicate of one of these -- also means this can never overwrite or interleave
       with a list somebody has already curated. */
    const existing = await count(db, 'hints', q => q);
    if (existing) {
      throw badRequest('There are already ' + existing + ' hint(s) in the list, so the built-in tips '
        + 'have not been loaded again. Delete the list first if you want to start over.');
    }
    const made = [];
    for (const role of HINT_ROLES) {
      for (const [en, sw, feature] of (DEFAULT_HINTS[role] || [])) {
        made.push({
          role, message_en: en, message_sw: sw || '', feature: feature || null, active: true,
          sort: made.length, created_at: new Date(nowMs).toISOString(),
        });
      }
    }
    if (!made.length) throw badRequest('There are no built-in tips to load.');
    await insertMany(db, 'hints', made);
    return { message: made.length + ' built-in tips loaded. They are the same tips your staff were '
      + 'already seeing — you can now edit or delete them one by one.', count: made.length };
  },

  async updateHint(db, user, args) {
    requireManager(user);
    const id = mustText(args.id, 'Hint id');
    const patch = { role: roleArg(args.role), message_en: mustText(args.en, 'The English message') };
    if (args.sw !== undefined && args.sw !== null) patch.message_sw = text(args.sw) || '';
    if (args.feature !== undefined) patch.feature = featureArg(args.feature);
    const hit = await update(db, 'hints', patch, q => q.eq('id', id));
    if (!hit.length) throw notFound('Hint not found.');
    return { message: 'Updated.' };
  },

  async deleteHint(db, user, args) {
    requireManager(user);
    const id = mustText(args.id, 'Hint id');
    const gone = await remove(db, 'hints', q => q.eq('id', id));
    if (!gone.length) throw notFound('Hint not found.');
    return { message: 'Deleted.' };
  },
};

export const WRITES = ['addHints', 'loadDefaultHints', 'updateHint', 'deleteHint'];

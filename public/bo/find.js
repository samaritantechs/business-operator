/* =====================================================================================
   FIND -- what the marketplace's search box understands.
   =====================================================================================
   It used to look for the typed text, whole, inside a product's name, category, shop, place,
   brand or model. That is exact, and exact is wrong at a shop counter three ways:

     - "watch saa" found nothing unless those words stood together, in that order;
     - a customer who types "simu" does not find a shop that wrote "Phones", and a shop that
       wrote "Saa" is not found by "watch" -- the two languages of the same street;
     - one slip of a thumb ("samsng", "bangle") and the shelf is empty, which reads as "nobody
       sells it".

   So, in this order:

     1. EVERY typed word must be found, anywhere, in any order -- also when the product wrote
        it with a space the customer did not type ("128gb" finds "128 GB", "a05" finds "A 05",
        "spark10" finds "Spark 10") -- but only from the start of one of its words: "a20" is
        not the end of "Nokia" and a "20".
     2. A word is found when the product says it, OR says another word for the same thing
        (GROUPS below: English and Kiswahili side by side). The other word must be a WHOLE
        word of the product (or its plural): "pete" is a ring, and not the first letters of a
        shop called Peter.
     3. Only when NOTHING is found that way is a near miss let in -- one wrong letter in a
        short word, two in a long one -- and the screen says that is what it is showing.
        Never when something matched exactly: a near miss beside a real match is noise.
        Never for a number or a short word, typed or on the shelf: "A05" is not "A06", and
        "sasa" is not "saa". Nor in a short word the customer did not type: they typed "ring",
        not "pete".

   Text with no letter or digit of ours in it ("手机", an emoji) cannot be understood this way,
   and is not allowed to mean "everything": it is matched as plain text, as it always was.

   Nothing here talks to the server or to the page. It takes products and text and gives back
   a list, so test/find.test.mjs can hold it to every line above. ES5, like the rest. */
window.BOFind = (function () {
  /* The same thing, said two ways. One word may sit in more than one group. Kept to things a
     shop here actually sells; a word that means something else as well ("fedha" is silver and
     money) is left out rather than guessed at. */
  var GROUPS = [
    ['phone', 'phones', 'simu', 'smartphone', 'smartphones', 'handset', 'mobile'],
    ['watch', 'watches', 'saa'],
    ['bracelet', 'bracelets', 'bangili', 'bangle', 'bangles'],
    ['printer', 'printers', 'printa'],
    ['computer', 'computers', 'kompyuta', 'laptop', 'laptops'],
    ['tv', 'television', 'televisheni', 'runinga'],
    ['fridge', 'refrigerator', 'friji', 'jokofu'],
    ['charger', 'chargers', 'chaja'],
    ['cover', 'covers', 'kava', 'case', 'cases'],
    ['battery', 'batteries', 'betri'],
    ['speaker', 'speakers', 'spika'],
    ['radio', 'redio'],
    ['lamp', 'lamps', 'light', 'lights', 'taa'],
    ['solar', 'sola'],
    ['fan', 'fans', 'feni'],
    ['cooker', 'stove', 'jiko', 'majiko'],
    ['sugar', 'sukari'],
    ['rice', 'mchele'],
    ['flour', 'unga'],
    ['oil', 'mafuta'],
    ['soap', 'sabuni'],
    ['salt', 'chumvi'],
    ['tea', 'chai'],
    ['milk', 'maziwa'],
    ['bread', 'mkate', 'mikate'],
    ['egg', 'eggs', 'yai', 'mayai'],
    ['chicken', 'kuku'],
    ['fish', 'samaki'],
    ['meat', 'nyama'],
    ['beans', 'maharage'],
    ['maize', 'corn', 'mahindi'],
    ['water', 'maji'],
    ['food', 'chakula', 'vyakula'],
    ['drink', 'drinks', 'kinywaji', 'vinywaji'],
    ['clothes', 'clothing', 'nguo'],
    ['shoe', 'shoes', 'kiatu', 'viatu'],
    ['shirt', 'shirts', 'shati', 'mashati'],
    ['dress', 'dresses', 'gauni', 'magauni'],
    ['trousers', 'trouser', 'pants', 'suruali'],
    ['bag', 'bags', 'begi', 'mabegi', 'mkoba', 'mikoba'],
    ['wedding', 'bridal', 'harusi'],
    ['gold', 'dhahabu'],
    ['ring', 'rings', 'pete'],
    ['necklace', 'necklaces', 'mkufu', 'mikufu'],
    ['earring', 'earrings', 'hereni'],
    ['perfume', 'perfumes', 'manukato', 'marashi'],
    ['cosmetics', 'vipodozi'],
    ['hair', 'nywele'],
    ['bed', 'beds', 'kitanda', 'vitanda'],
    ['mattress', 'mattresses', 'godoro', 'magodoro'],
    ['blanket', 'blankets', 'blanketi'],
    ['chair', 'chairs', 'kiti', 'viti'],
    ['table', 'tables', 'meza'],
    ['car', 'cars', 'gari', 'magari'],
    ['motorcycle', 'motorbike', 'pikipiki', 'bodaboda'],
    ['bicycle', 'bike', 'baiskeli'],
    ['house', 'houses', 'nyumba'],
    ['room', 'rooms', 'chumba', 'vyumba'],
    ['shop', 'shops', 'duka', 'maduka'],
    ['book', 'books', 'kitabu', 'vitabu'],
    ['notebook', 'notebooks', 'daftari', 'madaftari'],
    ['pen', 'pens', 'kalamu'],
    ['medicine', 'medicines', 'dawa'],
    ['cement', 'saruji', 'simenti'],
    ['paint', 'rangi'],
    ['new', 'mpya'],
    ['secondhand', 'used', 'mtumba', 'mitumba'],
    ['rent', 'rental', 'kukodi', 'kupanga'],
    ['baby', 'babies', 'mtoto', 'watoto'],
    ['school', 'shule']
  ];
  var SAID = Object.create(null);            // not {}: a typed "constructor" must not find Object's own
  GROUPS.forEach(function (g, i) { g.forEach(function (w) { (SAID[w] = SAID[w] || []).push(i); }); });

  /** Lower case, accents folded, everything that is not a letter or a digit turned to a space. */
  function fold(s) {
    s = String(s == null ? '' : s).toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/[^a-z0-9]+/g, ' ').replace(/^ +| +$/g, '');
  }
  function wordsOf(s) { var f = fold(s); return f ? f.split(' ') : []; }

  /** Every way of saying one typed word: itself first, then the other words of its groups. */
  function sayings(w) {
    var out = [w], g = SAID[w];
    if (g) g.forEach(function (i) { GROUPS[i].forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); }); });
    return out;
  }

  /** How many single slips apart two words are -- a letter wrong, missing, extra, or two swapped
      -- stopping as soon as it is more than `max`. */
  function distance(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i];
      var best = cur[0];
      for (j = 1; j <= lb; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }
  /** How many slips a typed word is forgiven: none for a number or a short word. */
  function slack(w) { return (/\d/.test(w) || w.length < 4) ? 0 : (w.length < 7 ? 1 : 2); }

  /** What a product says about itself, folded once and kept on it: the text, its words, and the
      RUNS of up to three neighbouring words that meet at a letter and a digit, run together --
      "128" "gb" -> "128gb", "a" "05" -> "a05", "spark" "10" -> "spark10", "s" "23" "fe" ->
      "s23fe". A run, not the whole text with its spaces taken out: "Hot 12 8GB" has no "128gb"
      in it ("12" meets "8gb" at a digit and a digit), and "Nokia 20" no "a20" (a run starts
      where a word starts). */
  function hayOf(p) {
    if (p && p._hay) return p._hay;
    var t = fold([p.name, p.cat, p.vendor, p.location, p.brand, p.model].join(' ')), words = t ? t.split(' ') : [], runs = [], i, k, run, a, b;
    for (i = 0; i < words.length; i++) {
      run = words[i];
      for (k = i + 1; k < words.length && k <= i + 2; k++) {
        a = words[k - 1]; b = words[k];
        if (!((/[a-z]$/.test(a) && /^\d/.test(b)) || (/\d$/.test(a) && /^[a-z]/.test(b)))) break;
        run += b; runs.push(run);
      }
    }
    var h = { text: ' ' + t + ' ', pairs: runs.length ? ' ' + runs.join(' ') + ' ' : '', words: words, said: null };
    try { Object.defineProperty(p, '_hay', { value: h, enumerable: false }); } catch (e) {}
    return h;
  }
  /** The words a product SAYS: each of its words, with a number glued on its end taken off
      ("tv43" says "tv"), and the singular of each ("phones", "tvs", "dresses"). Built the first
      time a typed word has another way of being said -- most never do, and the first keystroke
      on a long shelf should not pay for it. */
  function saidBy(h) {
    if (h.said) return h.said;
    var said = {}, i, j, w, forms, f, bare;
    for (i = 0; i < h.words.length; i++) {
      w = h.words[i]; forms = [w];
      bare = w.replace(/\d+$/, '');
      if (bare && bare !== w) forms.push(bare);
      for (j = 0; j < forms.length; j++) {
        f = forms[j];
        said[f] = 1;
        if (f.length > 2 && f.charAt(f.length - 1) === 's') said[f.slice(0, -1)] = 1;     // phones -> phone, tvs -> tv
        if (f.length > 4 && f.slice(-2) === 'es') said[f.slice(0, -2)] = 1;               // dresses -> dress
      }
    }
    return (h.said = said);
  }
  /** A typed word that is a model or a size run together: "128gb", "a05", "s23fe". Letters AND a
      digit: a bare number is never made of two shorter ones ("12" and "8gb" are not "128gb"),
      and two words run together ("tshirt") are left to the near-miss pass, which says so. */
  function joinable(w) { return w.length >= 3 && /\d/.test(w) && /[a-z]/.test(w); }
  /* The typed word itself is found anywhere inside a word ("sung" finds Samsung), exactly as
     before. ANOTHER word for it must BE a word of the product, or its plural: "saa" for "watch"
     must not find "Masaa", nor "pete" for "ring" the shop "Peter". */
  function says(hay, ways) {
    var w = ways[0];
    if (hay.text.indexOf(w) !== -1) return true;
    if (joinable(w) && hay.pairs.indexOf(' ' + w) !== -1) return true;      // it starts where a word of the product starts
    if (ways.length > 1) {
      var said = saidBy(hay);
      for (var i = 1; i < ways.length; i++) if (Object.prototype.hasOwnProperty.call(said, ways[i])) return true;
    }
    return false;
  }
  function nearlySays(hay, ways) {
    for (var i = 0; i < ways.length; i++) {
      var w = ways[i], k = slack(w);
      /* A slip is forgiven in what was TYPED, and in a long word for it. Not in a short word the
         customer never typed: "pete" (a ring) is one letter from the shop "Peter", "maji" (water)
         from "Majid", and neither shop is the thing asked for. */
      if (!k || (i > 0 && w.length < 6)) continue;
      for (var j = 0; j < hay.words.length; j++) {
        var hw = hay.words[j];
        if (hw.length < 4) continue;               // a three-letter word one letter off is another word
        if (distance(hw, w, k) <= k) return true;
        // a slip inside the start of a longer word: "samsn" is nearly the start of "samsung"
        if (w.length >= 5 && hw.length > w.length && distance(hw.slice(0, w.length), w, k) <= k) return true;
      }
    }
    return false;
  }

  /* A letter of another script (Arabic, Chinese, Cyrillic...) or an emoji: not ASCII, and not in the
     blocks of punctuation, spaces, currency and symbols that a phone keyboard turns a typed quote,
     dash or "..." into. Those mean "nothing typed", like "!!" does. */
  var OTHER_SCRIPT = /[^\x00-\x7f\u00a0-\u00bf\u00d7\u00f7\u2000-\u2bff\u2e00-\u2e7f\u3000-\u303f\ufe00-\ufe0f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/;
  /** The six things a product says, searched as plain text: what the box did before it understood anything. */
  function plainHas(p, raw) {
    var f = [p.name, p.cat, p.vendor, p.location, p.brand, p.model];
    for (var i = 0; i < f.length; i++) if (String(f[i] == null ? '' : f[i]).toLowerCase().indexOf(raw) !== -1) return true;
    return false;
  }

  /** products, typed text -> { list, near, words }. `near` is true when nothing matched exactly
      and the list is the closest instead; the page must say so. The order of `products` is kept. */
  function search(products, typed) {
    var qs = wordsOf(typed), list = products || [];
    if (!qs.length) {
      /* Nothing, or punctuation ("!!", a smart quote, "…"): the whole shelf, as for an empty box. But
         a word in another script, or an emoji, is something typed that this folding cannot read --
         it is matched as the plain text it is, so Arabic finds Arabic and a stray "手机" finds
         nothing rather than everything. */
      var raw = String(typed == null ? '' : typed).replace(/^\s+|\s+$/g, '').toLowerCase();
      if (!OTHER_SCRIPT.test(raw)) return { list: list.slice(), near: false, words: [] };
      return { list: list.filter(function (p) { return plainHas(p, raw); }), near: false, words: [] };
    }
    var ways = qs.map(sayings), exact = [], i;
    for (i = 0; i < list.length; i++) {
      var hay = hayOf(list[i]), all = true;
      for (var q = 0; q < ways.length && all; q++) all = says(hay, ways[q]);
      if (all) exact.push(list[i]);
    }
    if (exact.length) return { list: exact, near: false, words: qs };
    var close = [];
    for (i = 0; i < list.length; i++) {
      var h2 = hayOf(list[i]), ok = true;
      for (var q2 = 0; q2 < ways.length && ok; q2++) ok = says(h2, ways[q2]) || nearlySays(h2, ways[q2]);
      if (ok) close.push(list[i]);
    }
    return { list: close, near: close.length > 0, words: qs };
  }

  return { search: search, fold: fold, sayings: sayings, distance: distance, slack: slack, GROUPS: GROUPS };
})();

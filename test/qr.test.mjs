/* =====================================================================================
   THE CODE A SHOP PRINTS -- api/_lib/qr.js and api/_lib/qrpic.js.
   =====================================================================================
   A QR code that is wrong does not look wrong. It looks like every other square of black and
   white, it is printed, it is stuck to a counter -- and a customer's phone says nothing at all.
   So this file does not check that a picture comes out; it checks that the picture can be READ:

     1. against another encoder. The two production addresses are pinned, module for module, to
        what an independent implementation draws for them (reportlab's, which was already on
        the machine this was written on; 1,144 codes across every version and mask this file
        can produce were compared with it once, and all 1,144 were identical);
     2. by reading it back. A small decoder below -- its own function map, the mask conditions
        as the standard writes them, Reed-Solomon checked by EVALUATING each block at the
        generator's roots rather than by the division the encoder uses -- takes the finished
        PNG and must return the text that went in, for every length the encoder accepts;
     3. by the standard's own published format-information strings.

   And that the route serves only this system's own two addresses, whatever it is asked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import './_book.mjs';

const { qrMatrix, qrPng, qrFit, QR_MAX_VERSION } = await import('../api/_lib/qr.js');
const { qrAddress, qrPicture, QR_PICTURES } = await import('../api/_lib/qrpic.js');

/* ---- reading a code back, written apart from the encoder ---------------------------- */
const BLOCKS = {            // [check codewords per block, blocks] by version, as the standard tabulates them
  M: [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4]],
  L: [null, [7, 1], [10, 1], [15, 1], [20, 1], [26, 1], [18, 2]],
};
const EXP = [], LOG = [];
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
const gmul = (a, b) => (a && b) ? EXP[(LOG[a] + LOG[b]) % 255] : 0;

/** rows of 0/1 -> { text, version, level, mask }. Throws, in words, on anything a scanner would choke on. */
function readCode(rows) {
  const n = rows.length, version = (n - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 6, 'not a version 1-6 square: ' + n);
  const at = (x, y) => rows[y][x];
  // the format information, first copy, most significant bit first
  const spots = [];
  for (let i = 0; i <= 5; i++) spots[i] = [8, i];
  spots[6] = [8, 7]; spots[7] = [8, 8]; spots[8] = [7, 8];
  for (let i = 9; i < 15; i++) spots[i] = [14 - i, 8];
  let fmt = 0; for (let i = 14; i >= 0; i--) fmt = (fmt << 1) | at(spots[i][0], spots[i][1]);
  // and the second copy must say the same thing
  let fmt2 = 0;
  const second = i => (i < 8 ? [n - 1 - i, 8] : [8, n - 15 + i]);
  for (let i = 14; i >= 0; i--) fmt2 = (fmt2 << 1) | at(second(i)[0], second(i)[1]);
  assert.equal(fmt2, fmt, 'the two copies of the format information disagree');
  assert.equal(at(8, n - 8), 1, 'the dark module is missing');
  const raw = fmt ^ 0x5412;
  let rem = raw; for (let i = 14; i >= 10; i--) if (rem & (1 << i)) rem ^= 0x537 << (i - 10);
  assert.equal(rem, 0, 'the format information fails its own check');
  const level = ['M', 'L'][(raw >> 13) & 3], mask = (raw >> 10) & 7;
  assert.ok(level, 'a level this file never writes');

  const isFn = (x, y) => (x <= 8 && y <= 8) || (x >= n - 8 && y <= 8) || (x <= 8 && y >= n - 8) || x === 6 || y === 6
    || (version >= 2 && Math.abs(x - (n - 7)) <= 2 && Math.abs(y - (n - 7)) <= 2);
  // the mask conditions exactly as the standard writes them: i is the row, j the column
  const masked = (i, j) => [
    (i + j) % 2 === 0, i % 2 === 0, j % 3 === 0, (i + j) % 3 === 0,
    (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, ((i * j) % 2) + ((i * j) % 3) === 0,
    (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (((i + j) % 2) + ((i * j) % 3)) % 2 === 0][mask];

  const bits = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;                                  // the vertical timing pattern is skipped whole
    for (let k = 0; k < n; k++) {
      const y = up ? n - 1 - k : k;
      for (const x of [col, col - 1]) if (!isFn(x, y)) bits.push(at(x, y) ^ (masked(y, x) ? 1 : 0));
    }
    up = !up;
  }
  const [ecLen, blocks] = BLOCKS[level][version];
  const total = Math.floor(bits.length / 8);
  assert.equal(bits.length - total * 8, version === 1 ? 0 : 7, 'the square does not hold a whole number of codewords plus the remainder the standard gives');
  const cw = []; for (let i = 0; i < total; i++) cw.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  const per = total / blocks - ecLen;
  assert.ok(Number.isInteger(per) && per > 0, 'the blocks do not divide the square evenly');
  const data = [];
  for (let b = 0; b < blocks; b++) {
    const block = [];
    for (let i = 0; i < per; i++) block.push(cw[i * blocks + b]);
    for (let i = 0; i < ecLen; i++) block.push(cw[per * blocks + i * blocks + b]);
    // a valid Reed-Solomon codeword is zero at every root of the generator: alpha^0 .. alpha^(ecLen-1)
    for (let k = 0; k < ecLen; k++) {
      let s = 0; for (const c of block) s = gmul(s, EXP[k]) ^ c;
      assert.equal(s, 0, 'block ' + b + ' fails its check at root ' + k);
    }
    data.push(...block.slice(0, per));
  }
  let p = 0; const take = k => { let v = 0; for (let i = 0; i < k; i++) v = (v << 1) | ((data[p >> 3] >> (7 - (p & 7))) & 1), p++; return v; };
  assert.equal(take(4), 4, 'not byte mode');
  const len = take(8), bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return { text: Buffer.from(bytes).toString('utf8'), version, level, mask };
}
const rowsOf = m => m.modules.map(r => Array.from(r));

/** The PNG, unpacked by hand: { side, px(x, y) -> grey 0..255 }. */
function readPng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'not a PNG');
  let o = 8, ihdr = null; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), body = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') ihdr = body; else if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  assert.ok(ihdr && idat.length, 'a PNG needs a header and data');
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  assert.deepEqual([ihdr[8], ihdr[9], ihdr[12]], [8, 0, 0], '8-bit greyscale, not interlaced');
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (w + 1) * h);
  for (let y = 0; y < h; y++) assert.equal(raw[y * (w + 1)], 0, 'every row is stored unfiltered');
  return { w, h, px: (x, y) => raw[y * (w + 1) + 1 + x] };
}
function codeInPng(buf, scale, margin) {
  const { w, h, px } = readPng(buf);
  assert.equal(w, h, 'the picture is square');
  const n = w / scale - margin * 2, rows = [];
  for (let y = 0; y < n; y++) { rows.push([]); for (let x = 0; x < n; x++) rows[y].push(px((x + margin) * scale + (scale >> 1), (y + margin) * scale + (scale >> 1)) < 128 ? 1 : 0); }
  // the quiet margin is white all the way round, or a camera cannot find the corners
  for (let i = 0; i < w; i++) for (const e of [0, margin * scale - 1, w - margin * scale, w - 1]) { assert.equal(px(i, e), 255); assert.equal(px(e, i), 255); }
  return rows;
}

const SITE = 'https://business-operator-ivory.vercel.app/';
const APK = 'https://business-operator-ivory.vercel.app/download';

test('how much each size holds is what the standard says, and too much is refused, not squeezed', () => {
  const at = n => { const f = qrFit(n); return f && (f.version + f.level); };
  assert.deepEqual([14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106].map(at), ['1M', '2M', '2M', '3M', '3M', '4M', '4M', '5M', '5M', '6M', '6M']);
  assert.equal(at(107), '6L', 'past level M the last size is tried at level L before giving up');
  assert.equal(at(134), '6L');
  assert.equal(qrFit(135), null, 'and past that there is no code -- never a wrong one');
  assert.equal(qrMatrix('x'.repeat(135)), null);
  assert.equal(qrPng('x'.repeat(135)), null);
  assert.equal(qrMatrix(''), null, 'nothing to say is not a code either');
  assert.equal(QR_MAX_VERSION, 6);
});

test('the format information is the standard\'s own published strings', () => {
  // ISO/IEC 18004, the format information table: level M mask 0, level M mask 5, level L mask 0, level L mask 7.
  const fmtOf = (text, mask) => {
    const m = qrMatrix(text, { mask }), r = rowsOf(m);
    let s = ''; for (let i = 14; i >= 0; i--) { const [x, y] = i <= 5 ? [8, i] : i === 6 ? [8, 7] : i === 7 ? [8, 8] : i === 8 ? [7, 8] : [14 - i, 8]; s += r[y][x]; }
    return m.level + ':' + s;
  };
  assert.equal(fmtOf('A', 0), 'M:101010000010010');
  assert.equal(fmtOf('A', 5), 'M:100000011001110');
  assert.equal(fmtOf('x'.repeat(120), 0), 'L:111011111000100');
  assert.equal(fmtOf('x'.repeat(120), 7), 'L:110100101110110');
});

/* What an independent encoder draws for the two addresses that are actually printed, each row
   of the square as a hexadecimal number. If either changes, a sticker on a counter has stopped
   matching what this code believes it printed. */
const GOLDEN = [
  { text: 'https://business-operator-ivory.vercel.app/', version: 4, level: 'M', mask: 4,
    rows: '1fd1b427f 1043d7141 174a4e95d 175118c5d 175c9245d 105e65741 1fd55557f 001a0f900 117728ff9 1bba38e8e 0c63f53ca 12be81641 1cf192759 082cc718c 04486d7f2 1e1c389c0 10f65bf5a 0c963468c 19d568f2a 10053c8a1 12f7e7158 1d809a726 015d1661e 01a90fa53 1b5ee89f2 001338b16 1fd5a5158 104c23512 1750b05fa 1743c7b76 1748618f4 104bf8900 1fd58ffc1' },
  { text: 'https://business-operator-ivory.vercel.app/download', version: 4, level: 'M', mask: 2,
    rows: '1fc85727f 104b34541 175652e5d 17510475d 175771e5d 105f86d41 1fd55557f 001113c00 17c0cb57c 0ebddbe6d 18c3e94d6 19199dd5d 0a63707ba 018b24a6f 19c8700ee 19afe5edc 1169787b9 03005766f 1959f4436 100e60bbd 0a69c45bb 10173bbc5 124e09102 138a10d4f 16f2c91f0 001a9b315 1fc439f54 1059bfb1e 175e925f9 175b27397 1753bdfe8 104e27e1c 1fdcae722' }
];
test('the two production codes are, module for module, what an independent encoder draws', () => {
  for (const g of GOLDEN) {
    const m = qrMatrix(g.text, { mask: g.mask });
    assert.equal(m.version, g.version); assert.equal(m.level, g.level);
    const mine = m.modules.map(r => BigInt('0b' + Array.from(r).join('')).toString(16).padStart(Math.ceil(m.size / 4), '0')).join(' ');
    assert.equal(mine, g.rows, 'the code for ' + g.text + ' is no longer the one another encoder draws');
    assert.equal(readCode(rowsOf(m)).text, g.text, 'and it reads back as that address');
  }
  assert.deepEqual(GOLDEN.map(g => g.text), [SITE, APK]);
});

test('every length reads back: all eight masks, every size, both levels, bytes that are not letters', () => {
  const seen = new Set();
  for (let n = 1; n <= 134; n++) {
    let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(33 + ((i * 7 + n * 13) % 90));
    const own = qrMatrix(s), got = readCode(rowsOf(own));
    assert.equal(got.text, s, 'a ' + n + '-byte text did not survive');
    assert.equal(got.mask, own.mask, 'the mask written into the code is the mask that was applied');
    seen.add(got.version + got.level);
    // any mask is a valid code; the one chosen is only the easiest to read
    const forced = qrMatrix(s, { mask: n % 8 });
    assert.equal(readCode(rowsOf(forced)).text, s, 'mask ' + (n % 8) + ' broke a ' + n + '-byte text');
  }
  assert.deepEqual([...seen].sort(), ['1M', '2M', '3M', '4M', '5M', '6L', '6M']);
  const sw = 'Karibu Samaritan Industrial — duka lako mtandaoni ✓';
  assert.equal(readCode(rowsOf(qrMatrix(sw))).text, sw, 'and text that is not plain ASCII goes in as UTF-8');
});

test('the mask is chosen, not defaulted: the same text gets different masks as it changes', () => {
  const masks = new Set();
  for (let n = 1; n <= 100; n++) masks.add(qrMatrix('https://example.tz/' + 'a'.repeat(n)).mask);
  assert.ok(masks.size >= 4, 'the penalty scoring is picking between masks (saw ' + [...masks].join(',') + ')');
});

test('the PICTURE reads back: a real PNG, black on white, with its quiet margin', () => {
  for (const text of [SITE, APK, 'http://localhost:8787/download']) {
    const png = qrPng(text, { scale: 16, margin: 4 });
    const m = qrMatrix(text);
    const { w } = readPng(png);
    assert.equal(w, (m.size + 8) * 16, 'four modules of margin on each side, sixteen pixels a module');
    const rows = codeInPng(png, 16, 4);
    assert.equal(readCode(rows).text, text, 'what a camera would see in the picture is the address');
  }
  assert.ok(qrPng(SITE).length < 6000, 'and it is a small file: a phone on a bad line still gets it');
});

test('the address in the picture is this deployment\'s own, as the browser reached it', () => {
  const h = host => ({ host });
  assert.equal(qrAddress('site', h('business-operator-ivory.vercel.app')), SITE);
  assert.equal(qrAddress('app', h('business-operator-ivory.vercel.app')), APK);
  assert.equal(qrAddress('site', { host: 'internal:3000', 'x-forwarded-host': 'shop.example.tz', 'x-forwarded-proto': 'https' }), 'https://shop.example.tz/',
    'behind the proxy, the name the visitor used');
  assert.equal(qrAddress('app', h('localhost:8787')), 'http://localhost:8787/download', 'a local copy says http, so its code works locally');
  assert.equal(qrAddress('site', { host: 'Shop.Example.TZ' }), 'https://shop.example.tz/');
  // Anything that is not a plain host name is refused, not tidied: it is about to be printed.
  for (const bad of ['', 'evil.example/path', 'a b.example', 'user@evil.example', 'evil.example#x', 'exämple.tz', '-bad.example', 'x'.repeat(120) + '.tz', 'evil.example:99999999'])
    assert.equal(qrAddress('site', h(bad)), null, 'accepted a host it should not: ' + JSON.stringify(bad));
  assert.equal(qrAddress('nope', h('a.tz')), null);
  for (const born of ['constructor', 'toString', '__proto__']) assert.equal(qrAddress(born, h('a.tz')), null, born + ' is not a picture');
  assert.equal(qrAddress(['site'], h('a.tz')), null, 'and neither is anything that is not a plain word');
  assert.deepEqual(Object.keys(QR_PICTURES), ['site', 'app'], 'exactly two pictures');
});

test('the route gives a file to save -- and never a code for an address somebody sent it', () => {
  const ok = qrPicture('site', { host: 'business-operator-ivory.vercel.app' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Content-Type'], 'image/png');
  assert.equal(ok.headers['Content-Disposition'], 'attachment; filename="samaritan-industrial-site-qr.png"',
    'an attachment with a name: that is what makes a phone save it instead of showing it');
  assert.match(ok.headers['Cache-Control'], /^private/, 'it depends on the host it was asked through, so no shared cache may keep it');
  assert.equal(ok.headers['Content-Length'], String(ok.body.length));
  assert.equal(readCode(codeInPng(ok.body, 16, 4)).text, SITE);
  assert.equal(readCode(codeInPng(qrPicture('app', { host: 'business-operator-ivory.vercel.app' }).body, 16, 4)).text, APK);

  /* The last five are names every object is born with. A plain lookup answered to them, and
     the route drew a third picture -- of "https://<host>undefined" -- found in review. */
  for (const sent of ['https://evil.example/', 'SITE', '', 'site/', '../site', 'app,site', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const r = qrPicture(sent, { host: 'business-operator-ivory.vercel.app' });
    assert.equal(r.status, 404, 'drew something for ' + JSON.stringify(sent));
    assert.match(r.headers['Content-Type'], /^text\/plain/);
  }
  assert.equal(qrPicture('site', { host: 'evil.example/x' }).status, 422, 'a host that cannot be printed is refused in words');
  assert.equal(qrPicture('app', { host: 'a'.repeat(100) + '.example.tz' }).status, 422, 'and so is an address too long for the largest code this draws');
});

test('GET /api/download?qr= answers before the database is touched; without it the download link is as it was', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../api/download.js', import.meta.url), 'utf8');
  const qr = src.indexOf('qrPicture(qr, req.headers)'), db = src.indexOf('currentRelease(supabase)');
  assert.ok(qr > 0 && db > qr, 'the picture is answered first, so it costs no read at all');
  const { default: handler } = await import('../api/download.js');
  const res = { status: 0, headers: null, body: null, writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { this.body = b; } };
  await handler({ method: 'GET', url: '/api/download?qr=app', headers: { host: 'business-operator-ivory.vercel.app' } }, res);
  assert.equal(res.status, 200);
  assert.equal(readCode(codeInPng(res.body, 16, 4)).text, APK);
  const res2 = { ...res, status: 0, body: null };
  await handler({ method: 'GET', url: '/api/download', query: { qr: 'nope' }, headers: { host: 'a.tz' } }, res2);
  assert.equal(res2.status, 404, 'Vercel hands the query already parsed; that is read too');
});

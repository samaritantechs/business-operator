import { deflateSync } from 'node:zlib';

/* =====================================================================================
   A QR CODE, DRAWN HERE -- for the picture a shop saves, prints and sticks on its counter.
   =====================================================================================
   The page draws the codes it SHOWS (a small library, on a canvas). What it cannot do is hand
   that canvas to a phone as a file from inside the Android app: a WebView has no "save" for a
   picture that exists only in the page, so "Save this code as a picture" did nothing there.
   The phone's own download manager can fetch any ordinary https address, though -- so the
   picture is made here and served as one (api/download.js), and the same link works in every
   browser and in every copy of the app already installed.

   It is written out rather than installed because it is small, it has no moving parts once it
   is right, and the address a printed sticker carries is not something to hand to a package
   that updates itself. It is NOT a general QR library and does not pretend to be:

     - byte mode only (an address is bytes);
     - versions 1 to 6 (21 to 41 modules a side), which hold 106 bytes at level M and 134 at
       level L. Above that a code needs version-information bits and more than one alignment
       pattern; nothing here is long enough to need them, and an address that is gets an
       honest refusal (null) instead of a code nobody has checked;
     - level M by choice (15% of the code can be dirt or a scratch), level L only when the
       text would not otherwise fit.

   The construction follows ISO/IEC 18004 step for step: data bits, Reed-Solomon over GF(256)
   with 0x11D, interleave, the function patterns, the zig-zag placement, eight masks scored by
   the four penalty rules, the format bits with their BCH(15,5) check. test/qr.test.mjs reads a
   code back out of the finished picture -- unmasking, de-interleaving and re-checking every
   Reed-Solomon block -- so a change that breaks it fails there and not on a shop counter. */

/* [error-correction codewords per block, number of blocks, data codewords per block],
   by version 1..6. Every block of a version is the same length up to version 6. */
const BLOCKS = {
  M: [null, [10, 1, 16], [16, 1, 28], [26, 1, 44], [18, 2, 32], [24, 2, 43], [16, 4, 27]],
  L: [null, [7, 1, 19], [10, 1, 34], [15, 1, 55], [20, 1, 80], [26, 1, 108], [18, 2, 68]],
};
const LEVEL_BITS = { L: 1, M: 0 };           // the two bits that name the level in the format information
export const QR_MAX_VERSION = 6;

/* ---- GF(256) arithmetic and Reed-Solomon ------------------------------------------- */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z & 0xFF;
}
/** The generator polynomial of the given degree, highest power first, leading 1 left out. */
function rsDivisor(degree) {
  const d = new Array(degree).fill(0); d[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { d[j] = gfMul(d[j], root); if (j + 1 < degree) d[j] ^= d[j + 1]; }
    root = gfMul(root, 2);
  }
  return d;
}
export function rsRemainder(data, degree) {
  const div = rsDivisor(degree), r = new Array(degree).fill(0);
  for (const b of data) {
    const f = b ^ r.shift(); r.push(0);
    for (let i = 0; i < degree; i++) r[i] ^= gfMul(div[i], f);
  }
  return r;
}

/* ---- the bits ------------------------------------------------------------------------ */
/** The smallest version (and the level) that holds `bytes`, or null when none up to 6 does. */
export function qrFit(byteLength) {
  for (const level of ['M', 'L']) {
    for (let v = 1; v <= QR_MAX_VERSION; v++) {
      const [, blocks, per] = BLOCKS[level][v];
      if (byteLength + 2 <= blocks * per) return { version: v, level };   // 4 bits of mode + 8 of count = 12, so 2 bytes
    }
  }
  return null;
}
function dataCodewords(bytes, version, level) {
  const [, blocks, per] = BLOCKS[level][version], capacity = blocks * per;
  const bits = [];
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(4, 4);                          // byte mode
  put(bytes.length, 8);               // the count is 8 bits wide up to version 9
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity * 8 - bits.length));           // the terminator, as much of it as fits
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xEC; out.length < capacity; pad ^= 0xEC ^ 0x11) out.push(pad);
  return out;
}
/** Data split into blocks, each given its check codewords, then dealt out column by column. */
function withErrorCorrection(data, version, level) {
  const [ecLen, blocks, per] = BLOCKS[level][version];
  const d = [], e = [];
  for (let b = 0; b < blocks; b++) { const part = data.slice(b * per, (b + 1) * per); d.push(part); e.push(rsRemainder(part, ecLen)); }
  const out = [];
  for (let i = 0; i < per; i++) for (let b = 0; b < blocks; b++) out.push(d[b][i]);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < blocks; b++) out.push(e[b][i]);
  return out;
}

/* ---- the square ---------------------------------------------------------------------- */
function blank(size) {
  const m = [], fn = [];
  for (let y = 0; y < size; y++) { m.push(new Uint8Array(size)); fn.push(new Uint8Array(size)); }
  return { size, m, fn };
}
function setFn(q, x, y, dark) { q.m[y][x] = dark ? 1 : 0; q.fn[y][x] = 1; }
function finder(q, cx, cy) {
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (x >= 0 && x < q.size && y >= 0 && y < q.size) setFn(q, x, y, dist !== 2 && dist !== 4);
  }
}
function formatBits(q, level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = i => ((bits >>> i) & 1) === 1;
  const n = q.size;
  for (let i = 0; i <= 5; i++) setFn(q, 8, i, bit(i));                 // beside the top-left finder
  setFn(q, 8, 7, bit(6)); setFn(q, 8, 8, bit(7)); setFn(q, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(q, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFn(q, n - 1 - i, 8, bit(i));          // and the second copy, split in two
  for (let i = 8; i < 15; i++) setFn(q, 8, n - 15 + i, bit(i));
  setFn(q, 8, n - 8, true);                                            // the one module that is always dark
}
function functionPatterns(q, version, level) {
  const n = q.size;
  for (let i = 0; i < n; i++) { setFn(q, 6, i, i % 2 === 0); setFn(q, i, 6, i % 2 === 0); }   // timing
  finder(q, 3, 3); finder(q, n - 4, 3); finder(q, 3, n - 4);
  if (version >= 2) {                                                  // one alignment pattern, up to version 6
    const c = n - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(q, c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  formatBits(q, level, 0);                                             // holds the place; the real mask is written last
}
/** Bottom-right upwards, two columns at a time, turning at each end, skipping the timing column. */
function placeCodewords(q, codewords) {
  const n = q.size, total = codewords.length * 8;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? n - 1 - vert : vert;
        if (q.fn[y][x]) continue;
        if (i < total) { q.m[y][x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1; i++; }
        // what is left over (7 modules from version 2 up) stays light, as the standard has it
      }
    }
  }
}
export function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
  }
}
function applyMask(q, mask) {
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (!q.fn[y][x] && maskBit(mask, x, y)) q.m[y][x] ^= 1;
}
/** The four penalty rules. A lower score is a code a camera finds easier to read. */
function penalty(q) {
  const n = q.size, m = q.m;
  let score = 0, dark = 0;
  const line = get => {
    let run = 1;
    for (let i = 1; i <= n; i++) {
      if (i < n && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) score += 3 + (run - 5);                            // rule 1: five or more alike in a row
      run = 1;
    }
    for (let i = 0; i + 10 < n; i++) {                                 // rule 3: something that looks like a finder
      const s = k => get(i + k);
      const core = j => s(j) && !s(j + 1) && s(j + 2) && s(j + 3) && s(j + 4) && !s(j + 5) && s(j + 6);
      if (core(0) && !s(7) && !s(8) && !s(9) && !s(10)) score += 40;
      if (!s(0) && !s(1) && !s(2) && !s(3) && core(4)) score += 40;
    }
  };
  for (let y = 0; y < n; y++) line(x => m[y][x] === 1);
  for (let x = 0; x < n; x++) line(y => m[y][x] === 1);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) dark++;
    if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;   // rule 2
  }
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;                                                         // rule 4
  return score;
}

/** text -> { size, version, level, mask, modules: Uint8Array[] (1 = dark) }, or null when the
    text is longer than a version-6 code holds. `opts.mask` (0-7) forces a mask instead of
    scoring all eight: every mask gives a valid code, and a test that compares this against
    another encoder has to be able to ask for the one the other chose. */
export function qrMatrix(text, opts = {}) {
  const bytes = Array.from(Buffer.from(String(text == null ? '' : text), 'utf8'));
  const fit = qrFit(bytes.length);
  if (!fit || !bytes.length) return null;
  const { version, level } = fit, size = 17 + 4 * version;
  const codewords = withErrorCorrection(dataCodewords(bytes, version, level), version, level);
  const q = blank(size);
  functionPatterns(q, version, level);
  placeCodewords(q, codewords);
  const forced = Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask < 8;
  let best = forced ? opts.mask : 0, bestScore = Infinity;
  for (let mask = 0; mask < 8 && !forced; mask++) {
    applyMask(q, mask); formatBits(q, level, mask);
    const s = penalty(q);
    if (s < bestScore) { bestScore = s; best = mask; }
    applyMask(q, mask);                                                // the same mask twice puts it back
  }
  applyMask(q, best); formatBits(q, level, best);
  return { size, version, level, mask: best, modules: q.m };
}

/* ---- the picture --------------------------------------------------------------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** A greyscale PNG of the code: black on white, with the four-module quiet margin a reader
    needs around it. `scale` is pixels per module. Null when the text does not fit. */
export function qrPng(text, opts = {}) {
  const q = qrMatrix(text);
  if (!q) return null;
  const scale = Math.max(1, Math.min(40, Math.floor(opts.scale || 16))), margin = opts.margin == null ? 4 : Math.max(0, Math.floor(opts.margin));
  const side = (q.size + margin * 2) * scale;
  const raw = Buffer.alloc((side + 1) * side, 0xFF);                   // one filter byte, then a row of white
  for (let py = 0; py < side; py++) {
    raw[py * (side + 1)] = 0;
    const my = Math.floor(py / scale) - margin;
    if (my < 0 || my >= q.size) continue;
    for (let px = 0; px < side; px++) {
      const mx = Math.floor(px / scale) - margin;
      if (mx >= 0 && mx < q.size && q.modules[my][mx]) raw[py * (side + 1) + 1 + px] = 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0); ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8 bits, greyscale, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

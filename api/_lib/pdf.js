import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { APP_NAME, COMPANY, APP_TAGLINE } from './brand.js';

/* =====================================================================================
   BRANDED PDF REPORTS -- pdf-lib, standard fonts, no file system, so it runs on Vercel as is.
   =====================================================================================
   One function draws every report: a navy title band, the vendor's name, the date range, a
   table whose header repeats on every page, a totals line, and the Samaritan Techs footer with
   page numbers. Column widths are measured from the content and scaled to the page; long cells
   wrap. Landscape when the table is wide. */

const NAVY = rgb(0x1E / 255, 0x3A / 255, 0x8A / 255);
const HEAD = rgb(0x1a / 255, 0x22 / 255, 0x36 / 255);
const ZEBRA = rgb(0.955, 0.965, 0.985);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.4, 0.45, 0.55);
const GOLD = rgb(0xF5 / 255, 0xB3 / 255, 0x01 / 255);

/** Standard fonts speak WinAnsi only. Anything else (emoji, arrows) would throw mid-report, so
    it is dropped here; the handful of typographic characters WinAnsi does have are kept. */
export function pdfSafe(s) {
  return String(s == null ? '' : s)
    .replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function wrap(text, font, size, width) {
  const words = pdfSafe(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= width) { line = t; continue; }
    if (line) { lines.push(line); line = ''; }
    // A single word wider than the cell: hard-break it.
    let chunk = '';
    for (const ch of w) {
      if (font.widthOfTextAtSize(chunk + ch, size) > width && chunk) { lines.push(chunk); chunk = ch; }
      else chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/* =====================================================================================
   HOW WIDE EACH COLUMN IS, AND HOW SMALL THE TYPE HAS TO BE.
   =====================================================================================
   The table used to measure what each column wanted and then scale EVERY column by the same
   factor until they fitted the page. A wide report therefore took width away from "Qty" and
   "Total" exactly as it did from "Product" -- and a column narrower than its own number has
   only one way left to print it: break it. "SALE-0001" came out as "SALE-000" over "1" and
   45,000 as "45,00" over "0", which in a sales report is not untidy, it is wrong.

   The rule now, in order:
     1. Every column gets at least the width of its widest UNBREAKABLE piece: a whole figure in
        a number column, the longest single word anywhere else (a heading may wrap between its
        words, so may a name). Nothing below this width is ever asked of a column.
     2. If those minimums do not fit, the type gets smaller -- a step at a time, down to a
        floor that can still be read on paper -- before anything is broken.
     3. Whatever width is left over goes to the columns that have long text, so names and
        products wrap as little as possible.
     4. Only if the smallest type still cannot fit does a column give way, and then it is the
        text columns: a figure keeps its width to the last.

   It is a pure function of the columns, the rows and a way to measure text, so it can be
   tested without building a PDF (test/reports.test.mjs). */
const TYPE_SIZES = [8.5, 8, 7.5, 7, 6.5, 6, 5.5];
const WORD_CAP = 200;                         // a single "word" longer than this (a link) may be broken
export function planLayout({ columns, rows, avail, widthOf, pad = 4, startSize = 8.5 }) {
  const sample = (rows || []).slice(0, 400);
  const texts = columns.map(c => sample.map(r => pdfSafe(fmtCell(r[c.key], c))).filter(Boolean));
  const measure = size => {
    const need = [], full = [];
    columns.forEach((c, i) => {
      const head = pdfSafe(c.label);
      let min = 0, wide = widthOf(head, size, true);
      for (const w of head.split(' ')) min = Math.max(min, widthOf(w, size, true));
      for (const t of texts[i]) {
        const tw = widthOf(t, size, false);
        wide = Math.max(wide, Math.min(tw, 240));
        if (c.align === 'right') min = Math.max(min, tw);                        // a figure is one piece
        else for (const w of t.split(' ')) min = Math.max(min, Math.min(widthOf(w, size, false), WORD_CAP));
      }
      // +0.5: a column exactly as wide as its figure must not lose the last digit to rounding.
      need.push(min + 2 * pad + 0.5); full.push(Math.max(wide, min) + 2 * pad + 0.5);
    });
    return { need, full, total: need.reduce((a, b) => a + b, 0) };
  };
  /** The widths at one type size: every column its minimum, the rest shared out to long text. */
  const layoutAt = size => {
    const m = measure(size);
    if (m.total <= avail) {
      const want = m.full.map((f, i) => f - m.need[i]);
      const wanted = want.reduce((a, b) => a + b, 0), spare = avail - m.total;
      let widths = m.need.map((n, i) => n + (wanted > 0 ? Math.min(want[i], spare * want[i] / wanted) : 0));
      // Still room once everybody has all they asked for: the table fills the page, in proportion.
      const used = widths.reduce((a, b) => a + b, 0);
      if (used < avail) widths = widths.map(w => w + (avail - used) * (w / used));
      return { size, widths, fits: true };
    }
    // Too many columns even at this size. Figures keep their width; text gives way.
    const fixed = columns.reduce((a, c, i) => a + (c.align === 'right' ? m.need[i] : 0), 0);
    const loose = m.total - fixed, room = Math.max(avail - fixed, 0);
    let widths = columns.map((c, i) => (c.align === 'right' ? m.need[i] : (loose > 0 ? m.need[i] * room / loose : 0)));
    const sum = widths.reduce((a, b) => a + b, 0) || 1;
    if (sum > avail || room === 0) widths = m.need.map(n => n * avail / m.total);  // nothing left to protect
    return { size, widths, fits: false };
  };
  /** How many lines of type the table takes at a layout: each row is as tall as its longest cell. */
  const linesOf = lay => {
    let lines = 0;
    for (let r = 0; r < sample.length; r++) {
      let most = 1;
      columns.forEach((c, i) => {
        const t = pdfSafe(fmtCell(sample[r][c.key], c));
        if (t) most = Math.max(most, Math.ceil(widthOf(t, lay.size, false) / Math.max(lay.widths[i] - 2 * pad, 1)));
      });
      lines += most;
    }
    return lines;
  };

  const sizes = TYPE_SIZES.filter(z => z <= startSize);
  let best = null;
  for (const z of sizes) { best = layoutAt(z); if (best.fits) break; }
  if (!best) best = layoutAt(startSize);
  if (!best.fits) return best;
  /* THE LARGEST TYPE THAT FITS IS NOT ALWAYS THE ONE TO USE. At the size where the minimums only
     just fit there is no width left over, so a product name wraps one word to a line and a row
     of figures is five lines tall. A step or two smaller can halve the paper. So the smaller
     sizes are tried too -- never below 6pt for this, that floor is for fitting, not for saving
     paper -- and one is taken only if it WRAPS a good deal less. It is lines that are counted,
     not height: smaller type is always shorter, and that alone is no reason to make a report
     harder to read. A table that does not wrap is never shrunk. */
  let bestLines = linesOf(best);
  for (const z of sizes) {
    if (bestLines <= sample.length) break;                             // nothing wraps: done
    if (z >= best.size || z < 6) continue;
    const lay = layoutAt(z);
    if (!lay.fits) continue;
    const n = linesOf(lay);
    if (n <= bestLines * 0.75) { best = lay; bestLines = n; }
  }
  return best;
}

export function fmtCell(v, col) {
  if (v == null) return '';
  if (typeof v === 'number') {
    if (col && col.int) return String(v);
    return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return String(v);
}

/** opts: { title, subtitle, meta: [string], columns: [{ key, label, align: 'left'|'right', width?, int? }],
            rows: [object], totals: [[label, value]], landscape?, footer?, generatedAt? }
    Returns a Uint8Array of the PDF. */
export async function buildPdf(opts) {
  const columns = opts.columns || [];
  const rows = opts.rows || [];
  const M = 36;
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(opts.title || 'Report'));
  doc.setAuthor(APP_NAME + ' - ' + COMPANY);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pad = 4;
  const widthOf = (t, size, isBold) => (isBold ? bold : font).widthOfTextAtSize(t, size);
  const startSize = columns.length > 8 ? 7.5 : 8.5;
  const SIZES = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] };
  const planFor = wide => planLayout({ columns, rows, avail: SIZES[wide ? 'landscape' : 'portrait'][0] - 2 * M, widthOf, pad, startSize });
  // More than six columns has always been a sideways page. A narrower report that still cannot
  // fit upright at full size is turned sideways too, before its type is made any smaller.
  let landscape = opts.landscape != null ? !!opts.landscape : columns.length > 6;
  let plan = planFor(landscape);
  if (!landscape && opts.landscape == null && (!plan.fits || plan.size < startSize)) { landscape = true; plan = planFor(true); }
  const [PW, PH] = SIZES[landscape ? 'landscape' : 'portrait'];
  const avail = PW - 2 * M;
  const fs = plan.size, widths = plan.widths;
  const lh = fs * 1.35;

  const pages = [];
  let page, y;
  // A heading wraps between its words like any other cell, so "Customer Phone" can sit on two
  // lines over a narrow column instead of running into the heading beside it.
  const heads = columns.map((c, i) => wrap(c.label, bold, fs, widths[i] - 2 * pad));
  const headLines = Math.max(1, ...heads.map(h => h.length));
  const drawHeader = () => {
    const h = headLines * lh + 2 * pad;
    page.drawRectangle({ x: M, y: y - h, width: avail, height: h, color: HEAD });
    let x = M;
    columns.forEach((c, i) => {
      heads[i].forEach((t, li) => {
        const tw = bold.widthOfTextAtSize(t, fs);
        const tx = c.align === 'right' ? x + widths[i] - pad - tw : x + pad;
        page.drawText(t, { x: tx, y: y - pad - fs - li * lh, size: fs, font: bold, color: rgb(1, 1, 1) });
      });
      x += widths[i];
    });
    y -= h;
  };
  const newPage = () => {
    page = doc.addPage([PW, PH]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: PH - 62, width: PW, height: 62, color: NAVY });
    page.drawRectangle({ x: 0, y: PH - 65, width: PW, height: 3, color: GOLD });
    page.drawText(pdfSafe(opts.title || 'Report'), { x: M, y: PH - 30, size: 15, font: bold, color: rgb(1, 1, 1) });
    if (opts.subtitle) page.drawText(pdfSafe(opts.subtitle), { x: M, y: PH - 48, size: 9.5, font, color: rgb(0.85, 0.9, 1) });
    const brand = APP_NAME + '  |  ' + COMPANY;
    page.drawText(brand, { x: PW - M - bold.widthOfTextAtSize(brand, 9), y: PH - 30, size: 9, font: bold, color: rgb(1, 1, 1) });
    y = PH - 80;
    if (pages.length === 1) {
      for (const line of (opts.meta || [])) {
        page.drawText(pdfSafe(line), { x: M, y, size: 8.5, font, color: MUTED });
        y -= 12;
      }
      y -= 4;
    }
    if (columns.length) drawHeader();
  };
  const footerAll = () => {
    const now = opts.generatedAt || new Date();
    const yr = now.getFullYear();
    pages.forEach((p, i) => {
      const left = '© ' + yr + ' ' + COMPANY + '  ·  ' + APP_NAME + ' — ' + APP_TAGLINE;
      p.drawText(pdfSafe(left), { x: M, y: 20, size: 7.5, font, color: MUTED });
      const right = 'Page ' + (i + 1) + ' of ' + pages.length + '   ·   ' + pdfSafe(opts.footer || ('Generated ' + now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'));
      p.drawText(right, { x: PW - M - font.widthOfTextAtSize(right, 7.5), y: 20, size: 7.5, font, color: MUTED });
    });
  };

  newPage();
  rows.forEach((r, ri) => {
    const cells = columns.map((c, i) => wrap(fmtCell(r[c.key], c), font, fs, widths[i] - 2 * pad));
    const lines = Math.max(...cells.map(c => c.length));
    const h = lines * lh + 2 * pad;
    if (y - h < 40) newPage();
    if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: avail, height: h, color: ZEBRA });
    let x = M;
    columns.forEach((c, i) => {
      cells[i].forEach((line, li) => {
        const tw = font.widthOfTextAtSize(line, fs);
        const tx = c.align === 'right' ? x + widths[i] - pad - tw : x + pad;
        page.drawText(line, { x: tx, y: y - pad - fs - li * lh, size: fs, font, color: INK });
      });
      x += widths[i];
    });
    y -= h;
    page.drawLine({ start: { x: M, y }, end: { x: M + avail, y }, thickness: 0.4, color: rgb(0.85, 0.87, 0.9) });
  });
  if (!rows.length) {
    page.drawText('No records for this selection.', { x: M + pad, y: y - pad - fs - 4, size: fs + 1, font, color: MUTED });
    y -= lh + 12;
  }
  for (const t of (opts.totals || [])) {
    if (y - lh - 10 < 40) newPage();
    y -= 8;
    const label = pdfSafe(t[0]), value = pdfSafe(t[1]);
    page.drawText(label, { x: M + avail - 260, y: y - fs, size: fs + 1, font: bold, color: INK });
    page.drawText(value, { x: M + avail - pad - bold.widthOfTextAtSize(value, fs + 1), y: y - fs, size: fs + 1, font: bold, color: INK });
    y -= lh + 2;
  }
  footerAll();
  return doc.save();
}

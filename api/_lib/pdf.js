import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
  const landscape = opts.landscape != null ? !!opts.landscape : columns.length > 6;
  const [PW, PH] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const M = 36;
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(opts.title || 'Report'));
  doc.setAuthor('Business Operator - Samaritan Techs');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fs = columns.length > 8 ? 7.5 : 8.5;
  const lh = fs * 1.35;
  const pad = 4;

  // Column widths: measured, clamped, scaled to the page.
  const avail = PW - 2 * M;
  const want = columns.map(c => {
    let w = bold.widthOfTextAtSize(pdfSafe(c.label), fs) + 2 * pad;
    for (const r of rows.slice(0, 400)) {
      const t = fmtCell(r[c.key], c);
      w = Math.max(w, Math.min(220, font.widthOfTextAtSize(pdfSafe(t), fs) + 2 * pad));
    }
    return Math.max(c.width || 0, Math.min(w, 240));
  });
  const sum = want.reduce((a, b) => a + b, 0) || 1;
  const widths = want.map(w => (w / sum) * avail);

  const pages = [];
  let page, y;
  const drawHeader = () => {
    const h = lh + 2 * pad;
    page.drawRectangle({ x: M, y: y - h, width: avail, height: h, color: HEAD });
    let x = M;
    columns.forEach((c, i) => {
      const t = pdfSafe(c.label);
      const tw = bold.widthOfTextAtSize(t, fs);
      const tx = c.align === 'right' ? x + widths[i] - pad - tw : x + pad;
      page.drawText(t, { x: tx, y: y - pad - fs, size: fs, font: bold, color: rgb(1, 1, 1) });
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
    const brand = 'Business Operator  |  Samaritan Techs';
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
      const left = '© ' + yr + ' Samaritan Techs  ·  Business Operator — Smart business management & marketplace';
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

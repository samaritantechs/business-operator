import { deflateRawSync } from 'node:zlib';

/* =====================================================================================
   A REAL .XLSX, WITH NO LIBRARY.
   =====================================================================================
   An .xlsx is a zip of a handful of XML files. Writing one needs a zip writer (~60 lines, below)
   and a worksheet serializer (~40 lines). That is less code than the smallest spreadsheet
   package on npm pulls in as dependencies, and it has no supply chain to worry about on a
   server that holds the service role key. Excel, Google Sheets and LibreOffice all open it.

   Cells: a number becomes a number cell with a thousands-separator format; anything else is an
   inline string (no shared-strings table to build). A cell may also be { v, b: true } for bold.
   Dates are passed as text, deliberately -- a date cell is where every "3/6 became March 6th"
   bug in the old sheets came from. */

/* ------------------------------------------------------------------ zip */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** entries: [{ name, data: Buffer|string }] -> a zip file as a Buffer (deflate, utf-8 names). */
export function zip(entries, nowMs = Date.now()) {
  const d = new Date(nowMs);
  const dosTime = ((d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()) & 0xFFFF;
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const comp = deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, eocd]);
}

/* ------------------------------------------------------------------ worksheet */
export function colLetter(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
/* XML 1.0 cannot carry most control characters at all, so they are dropped rather than
   escaped -- a stray one from a pasted product name would otherwise make the whole file
   "corrupt" in Excel's words. */
const xml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function cellXml(ref, cell) {
  const v = (cell && typeof cell === 'object' && 'v' in cell) ? cell.v : cell;
  const bold = !!(cell && typeof cell === 'object' && cell.b);
  if (typeof v === 'number' && Number.isFinite(v)) {
    return '<c r="' + ref + '" s="' + (bold ? 3 : 2) + '"><v>' + v + '</v></c>';
  }
  if (v == null || v === '') return bold ? '<c r="' + ref + '" s="1"/>' : '';
  return '<c r="' + ref + '" t="inlineStr" s="' + (bold ? 1 : 0) + '"><is><t xml:space="preserve">' + xml(v) + '</t></is></c>';
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if (sheet.widths && sheet.widths.length) {
    out += '<cols>' + sheet.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (Number(w) || 12) + '" customWidth="1"/>').join('') + '</cols>';
  }
  out += '<sheetData>';
  rows.forEach((r, ri) => {
    const cells = (r || []).map((c, ci) => cellXml(colLetter(ci) + (ri + 1), c)).join('');
    out += '<row r="' + (ri + 1) + '">' + cells + '</row>';
  });
  out += '</sheetData></worksheet>';
  return out;
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** sheets: [{ name, rows: [[cell,...],...], widths?: [n,...] }] -> Buffer of an .xlsx file. */
export function buildXlsx(sheets, nowMs = Date.now()) {
  const list = (sheets || []).length ? sheets : [{ name: 'Sheet1', rows: [] }];
  const safeName = (n, i) => (String(n || 'Sheet' + (i + 1)).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet' + (i + 1));
  const entries = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + list.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets>' + list.map((s, i) => '<sheet name="' + xml(safeName(s.name, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>'
      + '</workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + list.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
      + '<Relationship Id="rId' + (list.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>' },
    { name: 'xl/styles.xml', data: STYLES },
  ];
  list.forEach((s, i) => entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }));
  return zip(entries, nowMs);
}

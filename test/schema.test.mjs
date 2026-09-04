/* EVERY COLUMN THE CODE ASKS FOR MUST EXIST.
 *
 * PostgREST does not skip an unknown column and return the rest: it fails the WHOLE read. So a
 * select naming a column the table does not have is not a missing field on a screen -- it is a
 * screen that does not load, with an error that says nothing useful on a phone in a shop.
 *
 * The schema is in the repository and so is every query, so the two are compared here. The
 * server code reads through the _shared helpers -- rows / rowsAll / one / count / update /
 * remove / insertOne / insertMany (db, 'table', ...) -- and, in a few places, db.from('table')
 * directly; both shapes are scanned, the column lists behind the *_COLS constants are resolved
 * per file, and every select column, filter column, order column and written key is checked.
 *
 * IT ONLY CHECKS WHAT IT CAN SEE. A select built from anything it cannot resolve is skipped
 * and counted, and the count is asserted so the scan cannot quietly stop working. */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ the schema */
function schemaColumns() {
  const cols = {};
  const files = [fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8')];
  const migDir = path.join(ROOT, 'db/migrations');
  if (fs.existsSync(migDir)) for (const f of fs.readdirSync(migDir).sort()) if (f.endsWith('.sql')) files.push(fs.readFileSync(path.join(migDir, f), 'utf8'));
  const sql = files.join('\n');
  for (const m of sql.matchAll(/create table if not exists (?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const set = cols[m[1]] = cols[m[1]] || new Set();
    /* Several columns can share a line -- "brand text, model text," -- so each line is split on
       commas rather than read as one column; and a name may carry a digit (image1_url). */
    for (const line of m[2].split('\n')) {
      const bare = line.replace(/--.*$/, '').trim();
      if (!bare) continue;
      for (const part of bare.split(',')) {
        const c = part.trim().match(/^([a-z_][a-z0-9_]*)\s+([a-z_]+)/i);
        if (!c) continue;
        if (/^(primary|foreign|unique|check|constraint|exclude|like)$/i.test(c[1])) continue;
        set.add(c[1]);
      }
    }
  }
  for (const m of sql.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)\s+add column (?:if not exists )?(\w+)/gi)) {
    (cols[m[1]] = cols[m[1]] || new Set()).add(m[2]);
  }
  // A view: every output column is what comes after the last `as` or the last dot.
  for (const m of sql.matchAll(/create or replace view (\w+) as\s+select([\s\S]*?)\n\s+from /g)) {
    const set = cols[m[1]] = cols[m[1]] || new Set();
    for (const part of m[2].split(',')) {
      const p = part.trim().replace(/\s+/g, ' ');
      if (!p) continue;
      const alias = p.match(/ as (\w+)$/i);
      set.add(alias ? alias[1] : p.replace(/^\w+\./, ''));
    }
  }
  return cols;
}

/* ------------------------------------------------------------------ the queries */
function sourceFiles() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      if (fs.statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); }
      else if (e.endsWith('.js')) out.push(p);
    }
  })(path.join(ROOT, 'api'));
  return out;
}

/** The *_COLS constants, resolved per file: a string literal, or literals and other constants
    joined with `+`. Exported ones from auth.js / _shared.js are the fallback for importers. */
function constantsOf(src, shared) {
  const local = {};
  for (const m of src.matchAll(/(?:export )?const ([A-Z][A-Z0-9_]*) = ([^;]+);/g)) {
    const parts = m[2].split('+').map(s => s.trim());
    let val = '', ok = true;
    for (const p of parts) {
      const lit = p.match(/^'([^']*)'$/);
      if (lit) val += lit[1];
      else if (local[p] != null) val += local[p];
      else if (shared[p] != null) val += shared[p];
      else { ok = false; break; }
    }
    if (ok) local[m[1]] = val;
  }
  return local;
}

/** From `open` (index of the opening paren of a call) to its matching close, respecting
    strings, template literals and nesting. */
function callSpan(src, open) {
  let depth = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}
/** Top-level keys of the object literal starting at `open` ("{"): `key:`, shorthand `key`,
    never a spread or a computed key. */
function objectKeys(text, open) {
  const body = callSpan(text, open);
  const inner = body.slice(1, -1);
  const keys = [];
  let depth = 0, q = null, part = '';
  const flush = () => {
    const p = part.trim(); part = '';
    if (!p || p.startsWith('...') || p.startsWith('[')) return;
    const m = p.match(/^([A-Za-z_]\w*)\s*:/) || p.match(/^([A-Za-z_]\w*)$/);
    if (m) keys.push(m[1]);
  };
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (q) { part += ch; if (ch === '\\') { part += inner[++i]; } else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; part += ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { flush(); continue; }
    part += ch;
  }
  flush();
  return keys;
}

const FILTERS = /\.(eq|neq|gt|gte|lt|lte|in|ilike|like|is|not|order|contains)\(\s*'(\w+)'/g;
const HELPER = /\b(rows|rowsAll|one|count|update|remove|insertOne|insertMany)\(\s*db\s*,\s*'(\w+)'/g;
const DIRECT = /\bdb\.from\(\s*'(\w+)'\s*\)/g;

/** Every column reference the code makes: { file, table, col, how }, plus how many selects
    could not be resolved. */
function references() {
  const refs = [];
  let unresolved = 0;
  const shared = {};
  for (const f of sourceFiles()) Object.assign(shared, constantsOf(fs.readFileSync(f, 'utf8'), {}));
  for (const f of sourceFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const consts = constantsOf(src, shared);
    const file = path.relative(ROOT, f);
    const push = (table, col, how) => refs.push({ file, table, col, how });
    const scanChain = (table, chain) => {
      for (const m of chain.matchAll(/\.select\(\s*(?:'([^']*)'|([A-Z][A-Z0-9_]*)|\))/g)) {
        const list = m[1] != null ? m[1] : m[2] != null ? (consts[m[2]] != null ? consts[m[2]] : shared[m[2]]) : '';
        if (list == null) { unresolved++; continue; }
        if (list.trim() === '*' || list.includes('(')) { if (list.includes('(')) unresolved++; continue; }
        for (const c of list.split(',')) { const col = c.trim(); if (col) push(table, col, 'select'); }
      }
      for (const m of chain.matchAll(FILTERS)) push(table, m[2], m[1]);
      for (const m of chain.matchAll(/\.(insert|update|upsert)\(\s*\{/g)) {
        for (const k of objectKeys(chain, m.index + m[0].length - 1)) push(table, k, m[1]);
      }
    };
    for (const m of src.matchAll(HELPER)) {
      const call = callSpan(src, m.index + m[0].indexOf('('));
      scanChain(m[2], call);
      if (/^(update|insertOne|insertMany)$/.test(m[1])) {
        const at = call.indexOf(m[1] === 'insertMany' ? '[' : '{', m[0].length);
        if (at > 0 && (m[1] !== 'insertMany' || call[at] === '[')) {
          if (m[1] === 'insertMany') { const first = call.indexOf('{', at); if (first > 0) for (const k of objectKeys(call, first)) push(m[2], k, 'insert'); }
          else for (const k of objectKeys(call, at)) push(m[2], k, m[1]);
        }
      }
    }
    for (const m of src.matchAll(DIRECT)) {
      const rest = src.slice(m.index, src.indexOf('\n', src.indexOf(';', m.index)) + 1);
      scanChain(m[1], rest);
    }
  }
  return { refs, unresolved };
}

test('every column the server asks for, filters on, orders by or writes exists in the schema', () => {
  const cols = schemaColumns();
  const { refs, unresolved } = references();
  const missing = [], seen = new Set();
  let checked = 0, skippedTables = new Set();
  for (const r of refs) {
    if (!cols[r.table]) { skippedTables.add(r.table); continue; }
    checked++;
    if (!cols[r.table].has(r.col)) { const k = r.table + '.' + r.col + '  (' + r.how + ' in ' + r.file + ')'; if (!seen.has(k)) { seen.add(k); missing.push(k); } }
  }
  assert.ok(checked > 400, 'only ' + checked + ' column references found -- the scan is not working');
  assert.ok(unresolved < 10, unresolved + ' selects could not be resolved -- teach constantsOf() the new shape rather than losing them');
  assert.deepEqual([...skippedTables], [], 'tables the code reads that db/schema.sql does not create: ' + [...skippedTables].join(', '));
  assert.deepEqual(missing, [],
    'These columns are asked for but do not exist. PostgREST fails the WHOLE read when one\n' +
    'column is unknown, so each is a screen that does not load:\n  ' + missing.join('\n  '));
});

test('the schema scan actually found the tables the system is built on', () => {
  const cols = schemaColumns();
  for (const t of ['vendors', 'branches', 'profiles', 'sessions', 'password_resets', 'products', 'branch_stock', 'product_units',
    'financing_partners', 'sales', 'lendings', 'lending_items', 'cash_receipts', 'stock_movements', 'settings', 'hints',
    'product_clicks', 'suggestions', 'audit_log', 'marketplace_products']) {
    assert.ok(cols[t] && cols[t].size >= 2, t + ' was not read from the schema');
  }
  // The renames this port made on purpose, so a "helpful" revert cannot slip through.
  assert.ok(cols.profiles.has('handle'), 'the legacy userId is profiles.handle');
  assert.ok(cols.profiles.has('password_hash') && cols.profiles.has('password_salt'), 'passwords are hashed, never a plain column');
  assert.equal(cols.profiles.has('password'), false);
  assert.ok(cols.sales.has('status') && cols.sales.has('cancel_reason'), 'sales are soft-cancelled');
  assert.ok(cols.sales.has('list_price') && cols.sales.has('discount'), 'discounts live on the sale row');
  assert.ok(cols.product_units.has('imei'), 'phones are units with an IMEI');
  assert.ok(cols.stock_movements.has('reference_sale_id'), 'a movement points at the sale that caused it');
  assert.ok(cols.marketplace_products.has('vendor_phone') && cols.marketplace_products.has('currency'), 'the view carries the vendor columns the market page shows');
});

/* AND THE MIGRATION FILE MUST SAY THE SAME THING AS THE SCHEMA.
 *
 * db/schema.sql is what a FRESH database is built from; db/RUN-ME-*.sql is what an EXISTING one
 * is brought forward with. They describe the same tables, which makes them exactly the "two
 * implementations of one rule" CLAUDE.md warns about -- and a drift here is the worst kind,
 * because it shows up as a screen that works on a new deployment and fails on a live one.
 *
 * So: every table and column the migration creates must also be in schema.sql, and every column
 * the CODE needs on those tables must be in BOTH. */
test('the RUN-ME migration and schema.sql agree about the new tables', () => {
  const migFiles = fs.readdirSync(path.join(ROOT, 'db')).filter(f => /^RUN-ME-.*\.sql$/.test(f));
  assert.ok(migFiles.length, 'there should be a RUN-ME migration to check');
  const mig = migFiles.map(f => fs.readFileSync(path.join(ROOT, 'db', f), 'utf8')).join('\n');
  const schema = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');

  const tablesIn = sql => {
    const out = {};
    for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
      out[m[1]] = new Set([...m[2].matchAll(/^\s{2}(\w+)\s+/gm)].map(x => x[1]));
    }
    for (const m of sql.matchAll(/alter table if exists (\w+) add column if not exists (\w+)/g)) {
      (out[m[1]] = out[m[1]] || new Set()).add(m[2]);
    }
    return out;
  };
  const inMig = tablesIn(mig), inSchema = tablesIn(schema);
  assert.ok(Object.keys(inMig).length >= 4, 'the table scanner stopped seeing the migration');

  for (const [table, cols] of Object.entries(inMig)) {
    assert.ok(inSchema[table], 'db/schema.sql has no "' + table + '", but the migration creates it — a fresh database would not get it');
    for (const c of cols) {
      assert.ok(inSchema[table].has(c), table + '.' + c + ' is in the migration but not in db/schema.sql');
    }
  }

  /* And the enum values the code writes have to be added by the migration, not only declared in
     schema.sql -- an existing database gets its types ALTERed, never re-created. */
  for (const v of ['reserved', 'unreserved']) {
    assert.match(mig, new RegExp("alter type movement_type add value if not exists '" + v + "'"),
      "the migration must add the '" + v + "' movement type to a live database");
  }
  assert.match(mig, /alter type unit_status\s+add value if not exists 'reserved'/);
  for (const t of ['po_status', 'pending_status']) {
    assert.match(mig, new RegExp('create type ' + t + ' as enum'), t + ' must be created by the migration too');
  }

  /* Postgres refuses to USE an enum value in the transaction that adds it, and the Supabase SQL
     editor sends a whole paste as one transaction. If the parts were ever merged into one, the
     tables that reference po_status and pending_status would fail on every live database and
     succeed on every fresh one -- which is the drift this whole test exists to catch. */
  const parts = [...mig.matchAll(/^-- PART (\d) of 3/gm)].map(m => Number(m[1]));
  assert.deepEqual(parts, [1, 2, 3], 'the migration must stay split into three separately-run parts');
  assert.ok(mig.indexOf("add value if not exists 'reserved'") < mig.indexOf('-- PART 2 of 3'),
    'the enum changes must be in part 1, run and committed before anything uses them');
  assert.ok(mig.indexOf('create table if not exists pending_sales') > mig.indexOf('-- PART 3 of 3'),
    'a table using a new enum type belongs after that type is committed');
});

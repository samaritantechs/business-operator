/* THE PAGES MUST PARSE.
 *
 * The same guard HOPE PMO carries, for the same reason: there is no build step, public/ is
 * served exactly as written, and a page whose script will not parse is not a broken feature
 * but a dead app -- the sign-in box spins for ever and from outside it looks like the database
 * stopped answering. Every inline <script> in every page and every file under public/bo/ is
 * handed to the parser the browser uses; one that fails turns `npm test` red.
 *
 * It proves only that the page PARSES. Nothing here can tell you the screen is right. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'bo-pages-'));

/** Inline scripts only -- a <script src=...> is a file checked on its own below, and a JSON or
    template block is not JavaScript. */
function inlineScripts(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text\/javascript|application\/javascript|module)$/i.test(type)) continue;
    out.push({ code: m[2], module: /^module$/i.test(type || '') });
  }
  return out;
}
function check(file, label) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
  catch (e) {
    const why = String((e.stderr && e.stderr.toString()) || e.message).split('\n').slice(0, 6).join('\n');
    assert.fail(label + ' will not parse -- the whole page is dead in a browser, not just one feature:\n' + why);
  }
}

const pages = readdirSync(PUBLIC).filter(f => f.endsWith('.html')).sort();
assert.ok(pages.includes('index.html'), 'the app page is there');

for (const page of pages) {
  test(`public/${page}: every inline script parses`, () => {
    const html = readFileSync(join(PUBLIC, page), 'utf8');
    const blocks = inlineScripts(html);
    assert.ok(blocks.length, `${page} has at least one inline script`);
    blocks.forEach((b, i) => {
      const file = join(scratch, `${page}.${i}.${b.module ? 'mjs' : 'js'}`);
      writeFileSync(file, b.code);
      check(file, `public/${page} script #${i}`);
    });
  });
}

const scripts = readdirSync(join(PUBLIC, 'bo')).filter(f => f.endsWith('.js')).sort();
assert.ok(scripts.length >= 12, 'the shell and the eleven tab scripts are there');
for (const s of scripts) {
  test(`public/bo/${s} parses`, () => check(join(PUBLIC, 'bo', s), 'public/bo/' + s));
}

test('index.html loads every script under public/bo/, the shell first, and boots last', () => {
  const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
  const loaded = [...html.matchAll(/<script src="\/bo\/([a-z]+\.js)"><\/script>/g)].map(m => m[1]);
  assert.equal(loaded[0], 'shell.js', 'the shell defines BO and must load before any tab');
  const missing = scripts.filter(s => !loaded.includes(s));
  assert.deepEqual(missing, [], 'scripts under public/bo/ that index.html never loads: ' + missing.join(', '));
  const unknown = loaded.filter(s => !scripts.includes(s));
  assert.deepEqual(unknown, [], 'index.html loads scripts that do not exist: ' + unknown.join(', '));
  assert.ok(html.lastIndexOf('BO.boot()') > html.lastIndexOf('<script src="/bo/'), 'BO.boot() runs after every tab has registered');
});

test('vercel.json routes every page the app links to, and never caches the scripts', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const sources = (v.rewrites || []).map(r => r.source);
  for (const route of ['/', '/market', '/login', '/app']) assert.ok(sources.includes(route), route + ' is routed');
  const headers = JSON.stringify(v.headers || []);
  assert.ok(/\/bo\/.*\.js|\/bo\/\(\.\*\)|\/bo\//.test(headers), 'the tab scripts carry a no-cache header (a phone must never run last week\'s tab against this week\'s API)');
});

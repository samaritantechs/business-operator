/* THE APP HAS TO BE READABLE, IN BOTH THEMES, ON A CHEAP PHONE IN A SHOP WITH THE SUN ON IT.
 *
 * Colour is not decoration here. An IMEI, a shop name, a cancel reason and the word "Cancelled"
 * are all rendered in the secondary and muted tokens -- they are the content, not a flourish.
 * Before this file existed the muted token sat at 2.0-2.6:1 against every surface in BOTH
 * themes, and the accent ramp (blue, green, amber, rose, purple) was declared once, for white
 * paper, and then reused as text on near-black. WCAG AA asks 4.5:1 for ordinary text; a shop
 * counter in daylight asks for rather more than a standards body does.
 *
 * So the palette is measured, not eyeballed. If a token moves and stops reading, this fails and
 * names the pair. To change a colour: change it, run this, and it will tell you if you may.
 *
 * The one deliberate exception is the -solid tokens. Those are FILLS carrying #fff text, so they
 * must stay dark in both themes; they are declared only in :root and cascade into dark on
 * purpose. This file checks them the other way round -- white ON them. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url).pathname, 'utf8');

/** The custom properties declared by one selector's block, as a plain object. */
function tokensOf(selector) {
  const at = html.indexOf(selector + '{');
  assert.notEqual(at, -1, 'no CSS block for ' + selector);
  const body = html.slice(at + selector.length + 1, html.indexOf('}', at));
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+)/g)) out[m[1]] = m[2].trim();
  return out;
}

const relLum = hex => {
  const n = hex.replace('#', '');
  const parts = n.length === 3 ? n.split('').map(c => c + c) : n.match(/../g);
  const [r, g, b] = parts.map(x => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = relLum(a) > relLum(b) ? [relLum(a), relLum(b)] : [relLum(b), relLum(a)];
  return (hi + 0.05) / (lo + 0.05);
};

const AA = 4.5;                                    // WCAG 2.1 AA, ordinary body text
const SURFACES = ['bg', 'surface', 'surface2'];
const INK = ['text', 'text2', 'muted', 'accent', 'accent2', 'amber', 'rose', 'purple'];

const light = tokensOf(':root');
const dark = { ...light, ...tokensOf('[data-theme="dark"]') };   // dark overrides, rest cascades

for (const [name, palette] of [['light', light], ['dark', dark]]) {
  test('every text colour reads against every surface — ' + name, () => {
    for (const surface of SURFACES) {
      const bg = palette[surface];
      assert.match(bg, /^#[0-9A-Fa-f]{3,8}$/, name + ' --' + surface + ' must be a hex colour');
      for (const ink of INK) {
        const fg = palette[ink];
        assert.match(fg, /^#[0-9A-Fa-f]{3,8}$/, name + ' --' + ink + ' must be a hex colour');
        const ratio = contrast(fg, bg);
        assert.ok(ratio >= AA,
          name + ': --' + ink + ' (' + fg + ') on --' + surface + ' (' + bg + ') is only '
          + ratio.toFixed(2) + ':1, and AA asks ' + AA + ':1');
      }
    }
  });
}

test('the -solid fills stay dark in both themes, because #fff sits on them', () => {
  for (const name of ['accent', 'accent2', 'amber', 'rose', 'purple']) {
    const key = name + '-solid';
    assert.ok(light[key], '--' + key + ' must be declared in :root');
    assert.equal(tokensOf('[data-theme="dark"]')[key], undefined,
      '--' + key + ' must NOT be redeclared for dark: a fill carrying white text is dark in both themes');
    const ratio = contrast('#ffffff', light[key]);
    assert.ok(ratio >= AA, '#fff on --' + key + ' (' + light[key] + ') is only ' + ratio.toFixed(2) + ':1');
  }
});

test('no solid fill carrying white text is painted with a per-theme token', () => {
  /* --accent lightens in dark mode so it can be READ on near-black. Any rule that fills a
     button with it and writes #fff on top therefore turns unreadable the moment the theme
     flips -- which is exactly what happened to .btn-primary, .tab-chip.active and the update
     bar. Solid fills take the -solid tokens; this is the guard that keeps them there. */
  const offenders = [...html.matchAll(/background:var\(--(accent|accent2|amber|rose|purple)\);color:#fff/g)];
  assert.deepEqual(offenders.map(m => m[0]), [],
    'use var(--<name>-solid) for a fill that carries white text');
});

test('the first visit follows the device, and only a tap is remembered', () => {
  assert.match(html, /prefers-color-scheme: light/,
    'the pre-paint script must consult the device when nothing is stored');
  const shell = readFileSync(new URL('../public/bo/shell.js', import.meta.url).pathname, 'utf8');
  assert.match(shell, /S\.theme = document\.documentElement\.getAttribute\('data-theme'\)/,
    'shell.js must read back what the pre-paint script decided, not re-decide it');
  assert.match(shell, /function applyTheme\(t, remember\)[\s\S]{0,400}?if \(remember\) store\('boTheme', t\);/,
    'applyTheme must persist only when asked, so the device preference is not pinned on first load');
  assert.match(shell, /toggleTheme\(\) \{ applyTheme\([^)]*, true\)/,
    'the toggle is the one caller that remembers');
});

test('the status bar follows the theme', () => {
  assert.match(html, /<meta name="theme-color" id="themeColorMeta"/,
    'a phone paints its status bar from this, and the app fills the screen');
  const shell = readFileSync(new URL('../public/bo/shell.js', import.meta.url).pathname, 'utf8');
  assert.match(shell, /themeColorMeta[\s\S]{0,160}?setAttribute\('content'/,
    'applyTheme must move it, or a light app keeps a black bar all session');
});

test('a keyboard can see where it is', () => {
  assert.match(html, /:focus-visible\{outline:2px solid/, 'every focusable thing needs a visible ring');
  assert.match(html, /\.btn-primary:focus-visible[^}]*outline-color:var\(--text\)/,
    'an accent ring is invisible on an accent fill; the primary button needs its own');
});

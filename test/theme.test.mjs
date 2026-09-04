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

test('white-on-a-fill is a token, not a hardcoded colour', () => {
  /* A fill and the text on it are one decision. --accent-solid is navy on white paper and a
     light blue on a dark ground, so the text on it cannot be #fff in both -- it is --on-solid,
     which flips with the theme. Any surviving literal is a button that goes unreadable the
     moment somebody taps the toggle. */
  const offenders = [...html.matchAll(/background:var\(--[a-z0-9]+-solid\);color:#[0-9a-fA-F]{3,8}/g)];
  assert.deepEqual(offenders.map(m => m[0]), [], 'use color:var(--on-solid) on a -solid fill');
  const perTheme = [...html.matchAll(/background:var\(--(accent|accent2|amber|rose|purple)\);color:/g)];
  assert.deepEqual(perTheme.map(m => m[0]), [],
    'a fill takes the -solid token; the bare token is the READING colour and lightens for dark');
});

for (const [name, palette] of [['light', light], ['dark', dark]]) {
  test('a filled button can be found and read — ' + name, () => {
    const on = palette['on-solid'];
    assert.match(on, /^#[0-9A-Fa-f]{3,8}$/, name + ' must declare --on-solid');
    for (const key of ['accent', 'accent2', 'amber', 'rose', 'purple']) {
      const fill = palette[key + '-solid'];
      assert.match(fill, /^#[0-9A-Fa-f]{3,8}$/, name + ' --' + key + '-solid must be a hex colour');
      const read = contrast(on, fill);
      assert.ok(read >= AA, name + ': --on-solid on --' + key + '-solid (' + fill + ') is only '
        + read.toFixed(2) + ':1, and the label on a button is ordinary text');
      /* And the button has to be VISIBLE, not just legible once found. A navy fill on a
         near-black page is a button people hunt for. WCAG asks 3:1 of a UI component. */
      for (const surface of SURFACES) {
        const seen = contrast(fill, palette[surface]);
        assert.ok(seen >= 3, name + ': --' + key + '-solid (' + fill + ') on --' + surface + ' ('
          + palette[surface] + ') is only ' + seen.toFixed(2) + ':1 — the button disappears into the page');
      }
    }
  });
}

test('the brand is the Samaritan Techs mark, in one place', () => {
  /* Navy and amber were pasted as raw hex into logo tiles, gradients and glows. One token each
     means the next change to the mark is one line, not a hunt through 68KB of CSS. */
  assert.match(light['brand-navy'], /^#0B2A6B$/i);
  assert.match(light['brand-amber'], /^#F0A020$/i);
  assert.doesNotMatch(html, /#2563EB|#7C3AED/,
    'the old blue-and-violet palette must be gone; use the brand tokens');
});

test('light is the default, and a choice is what gets remembered', () => {
  assert.match(html, /localStorage\.getItem\('boTheme'\)==='dark'\?'dark':'light'/,
    'the pre-paint script opens light unless dark was chosen');
  assert.doesNotMatch(html, /prefers-color-scheme: light/,
    'following the device would let a phone in night mode override the default we were asked for');
  const shell = readFileSync(new URL('../public/bo/shell.js', import.meta.url).pathname, 'utf8');
  assert.match(shell, /S\.theme = document\.documentElement\.getAttribute\('data-theme'\)[^;]*\|\| 'light';/,
    'shell.js reads back what the pre-paint script decided and falls back to light, not dark');
  assert.match(shell, /function applyTheme\(t, remember\)[\s\S]{0,400}?if \(remember\) store\('boTheme', t\);/,
    'applyTheme persists only when asked, so booting does not turn the default into a decision');
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

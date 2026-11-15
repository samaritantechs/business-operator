/* place -- where a shop is: what the one box on the business profile will take, what it turns it
   into, and what it must never let onto a public page. See api/_lib/bo/place.js. */
import test from 'node:test';
import assert from 'node:assert/strict';
import './_book.mjs';   // first: it gives the server modules the environment they refuse to load without
import { parsePlace, mapLinkOf, placeText, safeMapUrl } from '../api/_lib/bo/place.js';

const refused = input => { try { parsePlace(input); return null; } catch (e) { return e; } };
const DIR = 'https://www.google.com/maps/dir/?api=1&destination=';

test('place: coordinates, however they were typed, are kept as numbers', () => {
  assert.deepEqual(parsePlace('-6.792354, 39.208328'), { latitude: -6.792354, longitude: 39.208328, map_url: null });
  assert.deepEqual(parsePlace('  -6.79 39.20  '), { latitude: -6.79, longitude: 39.2, map_url: null });
  assert.deepEqual(parsePlace('-6.79;39.2'), { latitude: -6.79, longitude: 39.2, map_url: null });
  // Six decimals is about ten centimetres; a phone's fifteen are noise, and noise is not stored.
  assert.deepEqual(parsePlace('-6.792354123456, 39.208328987654'), { latitude: -6.792354, longitude: 39.208329, map_url: null });
  assert.deepEqual(parsePlace('2, 33'), { latitude: 2, longitude: 33, map_url: null });
});

test('place: nothing in the box takes the pin away', () => {
  for (const blank of ['', '   ', null, undefined]) assert.deepEqual(parsePlace(blank), { latitude: null, longitude: null, map_url: null });
});

test('place: a Google Maps link gives up its coordinates, the most exact ones first', () => {
  // The place's own pin (!3d!4d) wins over where the map happened to be centred (@).
  assert.deepEqual(parsePlace('https://www.google.com/maps/place/Kariakoo/@-6.8179,39.2718,17z/data=!3m1!4b1!4m6!3m5!1s0x185c4b!8m2!3d-6.8188!4d39.2744!16s'),
    { latitude: -6.8188, longitude: 39.2744, map_url: null });
  // What WhatsApp sends when somebody shares a location.
  assert.deepEqual(parsePlace('https://maps.google.com/?q=-6.7924,39.2083'), { latitude: -6.7924, longitude: 39.2083, map_url: null });
  assert.deepEqual(parsePlace('https://www.google.com/maps/dir/?api=1&destination=-6.1,35.7'), { latitude: -6.1, longitude: 35.7, map_url: null });
  assert.deepEqual(parsePlace('https://www.google.com/maps/search/?api=1&query=-3.3869%2C36.6830'), { latitude: -3.3869, longitude: 36.683, map_url: null });
  assert.deepEqual(parsePlace('https://www.google.com/maps/@-6.8,39.28,15z'), { latitude: -6.8, longitude: 39.28, map_url: null });
  assert.deepEqual(parsePlace('https://www.google.co.tz/maps?ll=-6.8,39.28'), { latitude: -6.8, longitude: 39.28, map_url: null });
  // Typed without the https:// -- people copy what they see.
  assert.deepEqual(parsePlace('maps.google.com/?q=-6.7924,39.2083'), { latitude: -6.7924, longitude: 39.2083, map_url: null });
});

test('place: a share link with no coordinates in it is kept as the link, on https', () => {
  assert.deepEqual(parsePlace('https://maps.app.goo.gl/AbCdEf123'), { latitude: null, longitude: null, map_url: 'https://maps.app.goo.gl/AbCdEf123' });
  assert.deepEqual(parsePlace('maps.app.goo.gl/AbCdEf123'), { latitude: null, longitude: null, map_url: 'https://maps.app.goo.gl/AbCdEf123' });
  assert.deepEqual(parsePlace('http://goo.gl/maps/xYz12'), { latitude: null, longitude: null, map_url: 'https://goo.gl/maps/xYz12' });
  assert.equal(parsePlace('https://www.google.com/maps/place/Some+Shop+Name').map_url, 'https://www.google.com/maps/place/Some+Shop+Name');
});

test('place: anything that is not a place on Google Maps is refused, in words a shopkeeper can act on', () => {
  const notMaps = [
    'https://evil.example/maps?q=-6.7,39.2',            // a map-shaped address somewhere else
    'https://www.google.com.evil.example/maps',         // Google's name, somebody else's site
    'https://google.xyz/maps', 'https://maps.google.evil/x',   // a look-alike ending
    'https://www.google.com/search?q=shop',             // Google, but not Maps
    'https://www.google.com/url?q=https://evil.example', 'https://maps.google.com/url?q=https://evil.example',   // Google's own redirector
    'https://maps.google.com/anything', 'https://www.google.com/maps/../url?q=x',            // off the map, by any route
    'https://www.google.com\\@evil.example/maps',       // a backslash is a slash to a browser
    'https://goo.gl/abc',                               // a shortener, but not a Maps one
    'https://maps.app.goo.gl/',                         // nothing after the host
    'https://user:pw@www.google.com/maps',              // somebody else's name in front
    'https://www.google.com:8443/maps',                 // an odd port
    'javascript:alert(1)', 'data:text/html,<script>', 'ftp://maps.google.com/x',
    'Sinza Mori, near the bus stand', 'hello',
    'https://www.google.com/maps/' + 'a'.repeat(700),   // absurdly long
  ];
  for (const input of notMaps) {
    const e = refused(input);
    assert.ok(e, 'accepted: ' + input);
    assert.equal(e.status, 400, input);
    assert.match(e.message, /Google Maps/, input);
  }
  // Numbers that are not anywhere: out of the world, and 0,0 -- which is what a phone with no fix reports.
  for (const input of ['91, 10', '-91, 10', '10, 181', '0, 0', '0.000000, 0.000000']) {
    const e = refused(input);
    assert.ok(e && e.status === 400, 'accepted: ' + input);
    assert.match(e.message, /real place/, input);
  }
});

test('place: what the Location button opens -- directions to the pin, else the share link, else nothing', () => {
  assert.equal(mapLinkOf({ latitude: -6.7924, longitude: 39.2083, map_url: null }), DIR + '-6.7924,39.2083');
  // Postgres hands numerics back as strings through some drivers; a pin is still a pin.
  assert.equal(mapLinkOf({ latitude: '-6.5', longitude: '39.1' }), DIR + '-6.5,39.1');
  // Coordinates win over a link when both are somehow there.
  assert.equal(mapLinkOf({ latitude: -6.5, longitude: 39.1, map_url: 'https://maps.app.goo.gl/x1' }), DIR + '-6.5,39.1');
  assert.equal(mapLinkOf({ latitude: null, longitude: null, map_url: 'https://maps.app.goo.gl/x1' }), 'https://maps.app.goo.gl/x1');
  for (const none of [null, undefined, {}, { latitude: null, longitude: null, map_url: null }, { latitude: -6.5, longitude: null }]) assert.equal(mapLinkOf(none), '');
});

test('place: the way OUT is checked as well as the way in', () => {
  /* parsePlace guards the form. A row typed into the SQL editor never goes through the form, and
     whatever is in map_url becomes a link on a public page -- so mapLinkOf asks the same question
     again and answers with nothing rather than with somebody else's address. */
  for (const bad of ['https://evil.example/', 'javascript:alert(1)', 'https://www.google.com.evil.example/maps', 'not a link', 'https://www.google.com/accounts']) {
    assert.equal(mapLinkOf({ latitude: null, longitude: null, map_url: bad }), '', bad);
    assert.equal(placeText({ map_url: bad }), '', bad);
    assert.equal(safeMapUrl(bad), null, bad);
  }
  assert.equal(mapLinkOf({ latitude: 200, longitude: 39 }), '');
  assert.equal(mapLinkOf({ latitude: 0, longitude: 0 }), '');
});

test('place: the box shows back what was kept, in the form it was kept', () => {
  assert.equal(placeText({ latitude: -6.7924, longitude: 39.2083 }), '-6.7924, 39.2083');
  assert.equal(placeText({ map_url: 'https://maps.app.goo.gl/x1' }), 'https://maps.app.goo.gl/x1');
  assert.equal(placeText({}), ''); assert.equal(placeText(null), '');
  // And what it shows is something it would take back unchanged: a save with nothing edited is a no-op.
  for (const row of [{ latitude: -6.7924, longitude: 39.2083, map_url: null }, { latitude: null, longitude: null, map_url: 'https://maps.app.goo.gl/x1' }]) {
    assert.deepEqual(parsePlace(placeText(row)), row);
  }
});

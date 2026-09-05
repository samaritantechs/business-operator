import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, emptyBook, userOf, NOW, MANAGER, ADMIN1, SELLER1 } from './_book.mjs';
import * as hints from '../api/_lib/bo/hints.js';
import * as settings from '../api/_lib/bo/settings.js';
import { SETTING_KEYS } from '../api/_lib/bo/_shared.js';

const { hintsForRole, DEFAULT_HINTS } = hints;
const rejects = (p, status, re) => assert.rejects(p, e => { assert.equal(e.status, status, 'status of: ' + e.message); if (re) assert.match(e.message, re); return true; });
const setting = (db, key) => { const r = db._dump('settings').find(s => s.key === key); return r ? r.value : undefined; };

/* ---------------------------------------------------------------- hints */
test('module shapes', () => {
  assert.deepEqual(Object.keys(hints.FN).sort(), ['addHints', 'deleteHint', 'hints', 'loadDefaultHints', 'updateHint']);
  assert.deepEqual(hints.WRITES.slice().sort(), ['addHints', 'deleteHint', 'loadDefaultHints', 'updateHint']);
  assert.deepEqual(Object.keys(settings.FN).sort(), ['setAnnouncement', 'settingSet', 'settingsGet']);
  assert.deepEqual(settings.WRITES.slice().sort(), ['setAnnouncement', 'settingSet']);
});

test('hintsForRole: the table rows for the role plus "all", in sort order', async () => {
  const book = richBook();
  book.hints.push({ id: 'H0', role: 'seller', message_en: 'Late but first', message_sw: '', active: true, sort: -1 },
    { id: 'H4', role: 'seller', message_en: 'Switched off', message_sw: '', active: false, sort: 3 });
  const db = bookDb(book);
  assert.deepEqual(await hintsForRole(db, 'seller'), [
    { en: 'Late but first', sw: '' },
    { en: 'Your User ID is your login.', sw: 'Kitambulisho chako ndiyo login yako.' },
    { en: 'Use Refresh to see the latest numbers.', sw: 'Tumia Refresh kuona namba za sasa.' },
  ]);
  assert.deepEqual(await hintsForRole(db, 'admin'), [{ en: 'Use Refresh to see the latest numbers.', sw: 'Tumia Refresh kuona namba za sasa.' }]);
  assert.deepEqual(await hintsForRole(db, 'marketplace'), [
    { en: 'Use Refresh to see the latest numbers.', sw: 'Tumia Refresh kuona namba za sasa.' },
    { en: 'Tap any product to contact the seller.', sw: '' },
  ]);
});

test('hintsForRole: the legacy defaults when the table has nothing for the role', async () => {
  const db = bookDb(emptyBook());
  const seller = await hintsForRole(db, 'seller');
  assert.deepEqual(seller[0], { en: '💡 Your User ID is your login – use it every time you sell.',
    sw: '💡 Namba yako ya mtumiaji ndiyo unayoingia nayo – itumie kila unapouza.' });
  const market = await hintsForRole(db, 'marketplace');
  assert.equal(market[0].en, '🛍️ Tap any product to view details and contact the seller.');

  /* EVERY built-in tip carries BOTH languages. The Swahili side used to be the empty string for
     all of them, so the EN/SW toggle changed the flag on the button and nothing else -- in a
     country where Kiswahili is the working language of most shop counters. Counting the hints
     proves nothing; this is the property that matters. */
  for (const role of ['seller', 'admin', 'assistant-admin', 'assistant-manager', 'marketplace']) {
    const list = await hintsForRole(db, role);
    assert.ok(list.length >= 3, role + ' must have tips of its own');
    for (const h of list) {
      assert.ok(h.en && h.en.trim(), role + ': every tip needs English');
      assert.ok(h.sw && h.sw.trim(), role + ': "' + h.en + '" has no Swahili');
      assert.notEqual(h.sw, h.en, role + ': the Swahili must not just be the English again');
    }
  }

  /* And a screen nobody is told about is a screen nobody uses. Each of these arrived with the
     features and had no tip at all until they were written. */
  const sellerText = (await hintsForRole(db, 'seller')).map(h => h.en + ' ' + h.sw).join(' | ');
  const adminText = (await hintsForRole(db, 'admin')).map(h => h.en + ' ' + h.sw).join(' | ');
  for (const [who, text, must] of [
    ['seller', sellerText, [/receipt|risiti/i, /Holds|Zilizowekwa/i, /Lending at the till|Mkopo wa bidhaa/i, /customer|mteja/i]],
    ['admin', adminText, [/Cost Price|Bei ya kununulia/i, /Profit|Faida/i, /Purchase Orders|Oda za manunuzi/i, /Credit & Voids|Mikopo na/i]],
  ]) {
    for (const re of must) assert.match(text, re, who + ' has no tip mentioning ' + re);
  }
  assert.deepEqual(await hintsForRole(db, 'manager'), DEFAULT_HINTS.seller.map(([en, sw]) => ({ en, sw })), 'no list of its own in legacy either');
  assert.deepEqual(await hintsForRole(db, 'whatever'), DEFAULT_HINTS.seller.map(([en, sw]) => ({ en, sw })));
  assert.deepEqual(await hintsForRole(db, ''), DEFAULT_HINTS.seller.map(([en, sw]) => ({ en, sw })));
});

test('hints: the manager sees every row grouped by role; a seller only the live rows for their role', async () => {
  const book = richBook();
  book.hints.push({ id: 'H4', role: 'seller', message_en: 'Switched off', message_sw: '', active: false, sort: 3 });
  const db = bookDb(book);
  const all = await hints.FN.hints(db, userOf(book, MANAGER), {}, NOW);
  assert.deepEqual(all.rows.map(r => r.id), ['H2', 'H3', 'H1', 'H4']);
  assert.deepEqual(Object.keys(all.rows[0]).sort(), ['active', 'created_at', 'id', 'message_en', 'message_sw', 'role', 'sort']);
  const mine = await hints.FN.hints(db, userOf(book, SELLER1), {}, NOW);
  assert.deepEqual(mine.rows.map(r => r.id), ['H1', 'H2']);
  const adm = await hints.FN.hints(db, userOf(book, ADMIN1), {}, NOW);
  assert.deepEqual(adm.rows.map(r => r.id), ['H2']);
});

test('addHints: manager only, blank English skipped, roles validated, sorted after the existing rows', async () => {
  const book = richBook();
  const db = bookDb(book);
  const mgr = userOf(book, MANAGER);
  await rejects(hints.FN.addHints(db, userOf(book, ADMIN1), { rows: [{ role: 'admin', en: 'x' }] }, NOW), 403);
  const out = await hints.FN.addHints(db, mgr, { rows: [
    { role: 'admin', en: ' Tip A ', sw: ' Kidokezo A ' }, { role: 'admin', en: '   ' }, { role: 'all', en: 'Tip B' },
  ] }, NOW);
  assert.equal(out.message, '2 hint(s) added.');
  const added = db._dump('hints').slice(3);
  assert.deepEqual(added.map(r => [r.role, r.message_en, r.message_sw, r.active, r.sort]),
    [['admin', 'Tip A', 'Kidokezo A', true, 3], ['all', 'Tip B', '', true, 4]]);
  assert.equal(added[0].created_at, new Date(NOW).toISOString());
  await rejects(hints.FN.addHints(db, mgr, { rows: [{ role: 'boss', en: 'x' }] }, NOW), 400, /hint role/);
  await rejects(hints.FN.addHints(db, mgr, { rows: [{ role: 'admin', en: '' }] }, NOW), 400, /No hints/);
  await rejects(hints.FN.addHints(db, mgr, {}, NOW), 400, /No hints/);
  assert.equal(db._dump('hints').length, 5, 'a refused batch writes nothing');
  // What was added now rotates for admins, ahead of the defaults.
  assert.deepEqual((await hintsForRole(db, 'admin')).map(h => h.en), ['Use Refresh to see the latest numbers.', 'Tip A', 'Tip B']);
});

test('loadDefaultHints: puts the built-ins in the table so they can be seen and edited', async () => {
  /* The built-in tips live in code, so the Manage Hints list was empty and read as "there are
     no hints" -- while thirty-eight of them were rotating on the screens all along. Worse, the
     first custom hint saved for a role REPLACES that role's built-ins, so adding one seller tip
     silently took twelve away. Loading them into the table fixes both: they become visible,
     editable and deletable one at a time, and adding a thirteenth now adds rather than erases. */
  const db = bookDb(emptyBook());
  const before = {};
  for (const r of hints.HINT_ROLES) before[r] = await hintsForRole(db, r);

  const r = await hints.FN.loadDefaultHints(db, userOf(richBook(), MANAGER), {}, NOW);
  const written = db._dump('hints');
  assert.equal(written.length, Object.values(DEFAULT_HINTS).reduce((a, b) => a + b.length, 0));
  assert.match(r.message, new RegExp(String(written.length)));

  /* THE POINT OF THIS IS THAT NOTHING CHANGES ON SCREEN. The rows written ARE the built-ins, so
     every role must serve exactly what it served a moment ago -- otherwise this "make them
     visible" button would quietly be a "change everyone's tips" button. */
  for (const role of hints.HINT_ROLES) {
    assert.deepEqual(await hintsForRole(db, role), before[role], role + ' sees exactly what it saw before');
  }

  assert.ok(written.every(h => h.active === true), 'all switched on');
  assert.ok(written.every(h => typeof h.message_sw === 'string' && h.message_sw.length), 'Kiswahili on every one');
  assert.ok(written.every(h => hints.HINT_ROLES.includes(h.role)), 'no row lands under a role nothing reads');
});

test('loadDefaultHints: refuses to run twice, so a second press cannot double every tip', async () => {
  const db = bookDb(emptyBook());
  const mgr = () => userOf(richBook(), MANAGER);
  await hints.FN.loadDefaultHints(db, mgr(), {}, NOW);
  const after = db._dump('hints').length;
  await rejects(hints.FN.loadDefaultHints(db, mgr(), {}, NOW), 400, /already/i);
  assert.equal(db._dump('hints').length, after, 'and nothing was written by the refused call');
});

test('loadDefaultHints: manager only', async () => {
  await rejects(hints.FN.loadDefaultHints(bookDb(emptyBook()), userOf(richBook(), ADMIN1), {}, NOW), 403);
  await rejects(hints.FN.loadDefaultHints(bookDb(emptyBook()), userOf(richBook(), SELLER1), {}, NOW), 403);
});

test('updateHint and deleteHint: manager only, by id, 404 when gone', async () => {
  const book = richBook();
  const db = bookDb(book);
  const mgr = userOf(book, MANAGER);
  await rejects(hints.FN.updateHint(db, userOf(book, SELLER1), { id: 'H1', role: 'seller', en: 'x', sw: '' }, NOW), 403);
  assert.deepEqual(await hints.FN.updateHint(db, mgr, { id: 'H1', role: 'all', en: ' New text ', sw: 'Maandishi mapya' }, NOW), { message: 'Updated.' });
  let h1 = db._dump('hints').find(r => r.id === 'H1');
  assert.deepEqual([h1.role, h1.message_en, h1.message_sw], ['all', 'New text', 'Maandishi mapya']);
  await hints.FN.updateHint(db, mgr, { id: 'H1', role: 'seller', en: 'Again' }, NOW);
  h1 = db._dump('hints').find(r => r.id === 'H1');
  assert.equal(h1.message_sw, 'Maandishi mapya', 'sw left out = untouched, as the legacy updateHint did');
  await rejects(hints.FN.updateHint(db, mgr, { id: 'H1', role: 'nope', en: 'x' }, NOW), 400);
  await rejects(hints.FN.updateHint(db, mgr, { id: 'H1', role: 'seller', en: ' ' }, NOW), 400, /English message/);
  await rejects(hints.FN.updateHint(db, mgr, { id: 'H99', role: 'seller', en: 'x' }, NOW), 404);
  await rejects(hints.FN.deleteHint(db, userOf(book, ADMIN1), { id: 'H1' }, NOW), 403);
  assert.deepEqual(await hints.FN.deleteHint(db, mgr, { id: 'H1' }, NOW), { message: 'Deleted.' });
  assert.equal(db._dump('hints').some(r => r.id === 'H1'), false);
  await rejects(hints.FN.deleteHint(db, mgr, { id: 'H1' }, NOW), 404);
  await rejects(hints.FN.deleteHint(db, mgr, {}, NOW), 400);
});

/* ---------------------------------------------------------------- settings */
test('settingsGet: every whitelisted key with its default, manager only', async () => {
  const book = richBook();
  const db = bookDb(book);
  await rejects(settings.FN.settingsGet(db, userOf(book, ADMIN1), {}, NOW), 403);
  await rejects(settings.FN.settingsGet(db, userOf(book, SELLER1), {}, NOW), 403);
  const { settings: s } = await settings.FN.settingsGet(db, userOf(book, MANAGER), {}, NOW);
  assert.deepEqual(Object.keys(s).sort(), SETTING_KEYS.slice().sort());
  assert.equal(s.FreeRegistration, 'Yes');
  assert.equal(s.commissionRate, '2');
  assert.equal(s.paymentReminderText, '');
  assert.equal(s.announcement_title, "What's New");
  assert.equal(s.announcement_enabled, 'No');
});

test('settingSet: the whitelist and the rule for each key', async () => {
  const book = richBook();
  const db = bookDb(book);
  const mgr = userOf(book, MANAGER);
  await rejects(settings.FN.settingSet(db, userOf(book, ADMIN1), { key: 'hintLifetime', value: 7 }, NOW), 403);
  assert.deepEqual(await settings.FN.settingSet(db, mgr, { key: 'hintLifetime', value: 7 }, NOW), { message: 'Setting saved.' });
  assert.equal(setting(db, 'hintLifetime'), '7');
  await settings.FN.settingSet(db, mgr, { key: 'hintInterval', value: '45' }, NOW);
  assert.equal(setting(db, 'hintInterval'), '45');
  for (const [key, value] of [['hintLifetime', 0], ['hintInterval', 9], ['autoSyncSeconds', 3], ['autoSyncSeconds', -1],
    ['sessionTimeoutMinutes', -1], ['loadingTime', 11], ['loadingTime', -1], ['trialDays', -5], ['commissionRate', -1],
    ['commissionRate', 'abc'], ['hintLifetime', 'abc'], ['hintLifetime', ''], ['hintLifetime', 2.5], ['FreeRegistration', 'Maybe']]) {
    await rejects(settings.FN.settingSet(db, mgr, { key, value }, NOW), 400);
  }
  for (const [key, value, stored] of [['autoSyncSeconds', 0, '0'], ['autoSyncSeconds', '5', '5'], ['sessionTimeoutMinutes', 0, '0'],
    ['sessionTimeoutMinutes', 30, '30'], ['loadingTime', 10, '10'], ['loadingTime', 0, '0'], ['trialDays', 0, '0'], ['trialDays', '90', '90'],
    ['commissionRate', '2.5', '2.5'], ['commissionRate', 0, '0'], ['FreeRegistration', 'No', 'No'], ['FreeRegistration', ' Yes ', 'Yes'],
    ['paymentReminderText', ' Pay {amount} {currency} ', 'Pay {amount} {currency}'], ['lendingReminderText', '', ''],
    ['announcement_enabled', true, 'Yes'], ['announcement_enabled', 'no', 'No']]) {
    await settings.FN.settingSet(db, mgr, { key, value }, NOW);
    assert.equal(setting(db, key), stored, key + ' = ' + JSON.stringify(value));
  }
  await rejects(settings.FN.settingSet(db, mgr, { key: 'permissions_V1', value: '{}' }, NOW), 400, /Unknown setting/);
  await rejects(settings.FN.settingSet(db, mgr, { key: '', value: 'x' }, NOW), 400);
  await rejects(settings.FN.settingSet(db, mgr, { value: 'x' }, NOW), 400);
});

test('setAnnouncement writes the five keys and stamps the version with the clock', async () => {
  const book = richBook();
  const db = bookDb(book);
  await rejects(settings.FN.setAnnouncement(db, userOf(book, SELLER1), { title: 'x' }, NOW), 403);
  const out = await settings.FN.setAnnouncement(db, userOf(book, MANAGER), { title: ' Hello ', text: 'New reports are here.', enabled: true, audience: 'app' }, NOW);
  assert.equal(out.message, 'Announcement saved.');
  assert.equal(setting(db, 'announcement_title'), 'Hello');
  assert.equal(setting(db, 'announcement_text'), 'New reports are here.');
  assert.equal(setting(db, 'announcement_enabled'), 'Yes');
  assert.equal(setting(db, 'announcement_audience'), 'app');
  assert.equal(setting(db, 'announcement_version'), String(NOW));
  await settings.FN.setAnnouncement(db, userOf(book, MANAGER), { enabled: false }, NOW + 1000);
  assert.equal(setting(db, 'announcement_title'), "What's New");
  assert.equal(setting(db, 'announcement_text'), '');
  assert.equal(setting(db, 'announcement_enabled'), 'No');
  assert.equal(setting(db, 'announcement_audience'), 'both');
  assert.equal(setting(db, 'announcement_version'), String(NOW + 1000));
  const { settings: s } = await settings.FN.settingsGet(db, userOf(book, MANAGER), {}, NOW);
  assert.equal(s.announcement_version, String(NOW + 1000));
});

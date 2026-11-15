/* phone -- the one rule that turns the number a shopkeeper types into one a customer can reach.
   See api/_lib/bo/phone.js. It is used when a number is SAVED and when the marketplace is BUILT,
   so every case here is both "what is stored" and "what an old stored number becomes". */
import test from 'node:test';
import assert from 'node:assert/strict';
import './_book.mjs';   // first: it gives the server modules the environment they refuse to load without
import { intlDigits, phoneArg, dialCodeOf } from '../api/_lib/bo/phone.js';

test('phone: every way a Tanzanian number gets typed comes out as the one WhatsApp can use', () => {
  for (const typed of ['0712 345 678', '0712345678', '+255 712 345 678', '+255712345678', '255712345678', '255 712 345 678',
    '712345678', '00255712345678', '(0712) 345-678', ' 0712.345.678 ']) {
    assert.equal(intlDigits(typed, 'TZS'), '255712345678', typed);
    assert.equal(phoneArg(typed, 'TZS'), '+255712345678', typed);
  }
});

test('phone: the country is the shop\'s currency; a currency nobody knows is taken to be at home', () => {
  assert.equal(intlDigits('0712345678', 'KES'), '254712345678');
  assert.equal(intlDigits('0772345678', 'UGX'), '256772345678');
  assert.equal(intlDigits('0788123456', 'RWF'), '250788123456');
  assert.equal(intlDigits('079123456', 'BIF'), '25779123456', 'Burundi\'s numbers are a digit shorter');
  assert.equal(intlDigits('0712345678', 'USD'), '255712345678', 'a shop that prices in dollars is still here');
  assert.equal(intlDigits('0712345678', ''), '255712345678');
  assert.equal(dialCodeOf('kes'), '254'); assert.equal(dialCodeOf(null), '255');
});

test('phone: a number that says its own country is left alone, whatever the shop\'s currency', () => {
  assert.equal(intlDigits('+254712345678', 'TZS'), '254712345678');
  assert.equal(intlDigits('254712345678', 'TZS'), '254712345678', 'already whole, just without the plus');
  assert.equal(intlDigits('+1 415 555 2671', 'TZS'), '14155552671');
  assert.equal(intlDigits('+44 20 7946 0958', 'TZS'), '442079460958');
});

test('phone: one digit short or long is not a number, and is said so in words', () => {
  // The commonest typing mistake there is. It used to be saved, and the WhatsApp button died quietly.
  for (const typed of ['0712 345 67', '07123456789', '+255 712 345 67', '2557123456789', '12345', '0', 'hello', '+', '++255']) {
    assert.equal(intlDigits(typed, 'TZS'), '', typed);
    assert.throws(() => phoneArg(typed, 'TZS'), e => e.status === 400 && /country code/.test(e.message) && /namba ya nchi/.test(e.message), typed);
  }
  // Nothing typed is nothing stored: the number stays optional.
  for (const none of ['', '   ', null, undefined]) { assert.equal(intlDigits(none, 'TZS'), ''); assert.equal(phoneArg(none, 'TZS'), ''); }
});

test('phone: what is stored is something the rule takes back unchanged', () => {
  for (const typed of ['0712 345 678', '+254712345678', '+1 415 555 2671']) {
    const stored = phoneArg(typed, 'TZS');
    assert.equal(phoneArg(stored, 'TZS'), stored);
    assert.equal(phoneArg(stored, 'KES'), stored, 'a stored number does not move when the currency does');
  }
});

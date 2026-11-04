// Air Register 1.2.0: customer display data (GET /api/customer-state) and the "Customer display" setting. Offline.
// Run: node tests/customer-display.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Customer } = require('../app/lib/customer');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = (name, fn) => { n++; try { fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } };
const view = st => { const o = Object.create(Customer); o.state = () => st; o.completed = st.completed || null; return o; };
const base = { loggedIn: true, user: { shop: 'Shop' }, currency: '$', mode: 'sale', cart: [], totals: {}, order: {}, pay: null, completed: null };

t('logged out: Welcome only, nothing about the last sale', () => {
  const c = view({ ...base, loggedIn: false, cart: [{ name: 'X', quantity: 1, price: 1, total: 1 }] }).customerState();
  assert.strictEqual(c.view, 'idle'); assert.deepStrictEqual(c.lines, []); assert.strictEqual(c.totals, null);
});
t('sale with discount and Tax Off', () => {
  const c = view({ ...base, cart: [{ name: 'Toy', quantity: 2, price: 5, discountAmount: 1, total: 9, number: '1234567890123' }], totals: { itemAmount: 10, discountAmount: 1, pointDiscount: 0, tax: 0, due: 9 }, order: { taxExempt: true } }).customerState();
  assert.strictEqual(c.view, 'sale'); assert.deepStrictEqual(c.lines, [{ name: 'Toy', quantity: 2, price: 5, discount: 1, total: 9 }]);
  assert.deepStrictEqual(c.totals, { subtotal: 10, discount: 1, tax: 0, taxOff: true, total: 9 });
});
t('payment: paid, amount due and change; no card details passed on', () => {
  const st = { ...base, cart: [{ name: 'Toy', quantity: 1, price: 10, total: 10 }], totals: { itemAmount: 10, tax: 0.8, due: 10.8 },
    pay: { paid: 20, remaining: 0, tenders: [{ status: 'done', type: 20, giveAmount: 0, cardNumber: '4111111111111111', authCode: 'A1' }, { status: 'done', type: 10, giveAmount: 9.2 }] } };
  const c = view(st).customerState();
  assert.strictEqual(c.view, 'pay'); assert.deepStrictEqual(c.pay, { paid: 20, due: 0, change: 9.2 });
  assert.ok(!/4111|A1/.test(JSON.stringify(c)), 'card number / auth code must not appear');
});
t('mixed sale + return lines show Returned and net', () => {
  const c = view({ ...base, cart: [{ name: 'New', quantity: 1, price: 10, total: 10 }], totals: { itemAmount: 10, tax: 0, due: 10 }, mix: { lines: [{ name: 'Old', quantity: 1, price: 15, total: -15 }], totals: { refund: 15 }, net: -5 } }).customerState();
  assert.strictEqual(c.lines.length, 2); assert.strictEqual(c.lines[1].ret, true); assert.strictEqual(c.totals.returned, 15); assert.strictEqual(c.totals.net, -5);
});
t('return mode: items going back and the refund', () => {
  const c = view({ ...base, mode: 'return', ret: { subs: [{ name: 'Ball', quantity: 2, price: 4 }], totals: { tax: 0.64, refund: 8.64 } } }).customerState();
  assert.strictEqual(c.view, 'return'); assert.deepStrictEqual(c.lines, [{ name: 'Ball', quantity: 2, price: 4, total: -8, ret: true }]); assert.deepStrictEqual(c.totals, { tax: 0.64, refund: 8.64 });
});
t('finished sale: Thank you with change, then back to Welcome after 2 minutes', () => {
  const o = view({ ...base, completed: { due: 12.3, tendered: 15, change: 2.7 } });
  let c = o.customerState(); assert.strictEqual(c.view, 'done'); assert.deepStrictEqual(c.pay, { total: 12.3, paid: 15, change: 2.7 });
  o._custDoneAt -= 121000; c = o.customerState(); assert.strictEqual(c.view, 'idle');
});
t('"Customer display" setting: unset by default (= on), saved off/on in this PC\'s settings.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-cd-'));
  const r = new Register({ log: () => {}, dataDir: dir });
  assert.notStrictEqual(r.settings.customerDisplay, false);
  assert.ok(r.saveSettings({ customerDisplay: false }).ok);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).customerDisplay, false);
  assert.strictEqual(new Register({ log: () => {}, dataDir: dir }).settings.customerDisplay, false, 'remembered after restart');
  r.saveSettings({ customerDisplay: 'yes' }); assert.strictEqual(r.settings.customerDisplay, false, 'non-boolean ignored');
  r.saveSettings({ customerDisplay: true }); assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).customerDisplay, true);
});
console.log(`\n${n - bad}/${n} passed`);
fs.writeFileSync(path.join(__dirname, 'customer-display-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: n - bad, total: n, out }, null, 1));
process.exit(bad ? 1 : 0);

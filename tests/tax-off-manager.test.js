// Air Register 1.2.0: F5 Tax Off needs an AIR POS manager (RetailManager / super admin). A cashier needs a manager's
// login (same check as Restart PC). Tax math unchanged. Offline (fake AIR POS calls, temp data folder; no account).
// Run: node tests/tax-off-manager.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };

async function reg({ manager }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-taxoff-'));
  const r = new Register({ log: () => {}, dataDir: dir });
  r.settingsPath = null;
  r.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: false };
  r.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: manager ? ['RetailManager'] : [] };
  r.mode = 'sale';
  const a = r.api; a.verifyCalls = [];
  a.scan = async code => ({ success: true, value: { id: 'sub-' + code, itemId: 'i' + code, productId: 'p' + code, number: code, name: 'Item ' + code, quantity: 1, rate: 1, price: 10, taxRate: 8, discount: 0, discountAmount: 0 } });
  a.promotionGet = async s => { let tot = 0, tax = 0; for (const x of s.subs || []) { const v = x.price * x.quantity; tot += v; tax += v * (x.taxRate || 0) / 100; } return { success: true, value: { subs: [], totalAmount: tot, totalTax: Math.round(tax * 100) / 100, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot } }; };
  a.verify = async (u, p) => { a.verifyCalls.push(u); return u === 'boss' && p === 'boss-pw' ? { success: true, value: 'mgr-1' } : { success: false, message: 'Wrong user name or password' }; };
  assert.ok((await r.scan('1001')).ok);
  return r;
}

(async () => {
  await t('manager: F5 Tax Off works without any login, tax 0', async () => {
    const r = await reg({ manager: true });
    assert.strictEqual(r.totals.tax, 0.8);
    const x = await r.setTaxExempt(null, {}); assert.ok(x.ok, x.message); assert.strictEqual(r.order.taxExempt, true);
    assert.strictEqual(r.totals.tax, 0); assert.strictEqual(r.totals.due, 10); assert.strictEqual(r.api.verifyCalls.length, 0);
  });
  await t('cashier: F5 Tax Off is refused and asks for a manager (tax stays on)', async () => {
    const r = await reg({ manager: false });
    const x = await r.setTaxExempt(null, {}); assert.strictEqual(x.ok, false); assert.strictEqual(x.needManager, true);
    assert.ok(!r.order.taxExempt); assert.strictEqual(r.totals.tax, 0.8); assert.strictEqual(r.api.verifyCalls.length, 0);
  });
  await t('cashier: wrong manager login is refused (tax stays on)', async () => {
    const r = await reg({ manager: false });
    const x = await r.setTaxExempt(true, { user: 'boss', password: 'wrong-pw' }); assert.strictEqual(x.ok, false); assert.strictEqual(x.needManager, true);
    assert.match(x.message, /Wrong/); assert.ok(!r.order.taxExempt); assert.strictEqual(r.totals.tax, 0.8);
  });
  await t('cashier: the exit PIN does not approve Tax Off', async () => {
    const r = await reg({ manager: false }); r.settings.exitPinEnabled = true; r.settings.exitPinHash = 'aa:bb';
    const x = await r.setTaxExempt(true, { pin: '1234' }); assert.strictEqual(x.ok, false); assert.ok(!r.order.taxExempt);
  });
  await t('cashier: a manager login approves Tax Off; same tax math as a manager (tax 0, due = pre-tax)', async () => {
    const r = await reg({ manager: false });
    const x = await r.setTaxExempt(true, { user: 'boss', password: 'boss-pw' }); assert.ok(x.ok, x.message);
    assert.strictEqual(r.order.taxExempt, true); assert.strictEqual(r.totals.tax, 0); assert.strictEqual(r.totals.due, 10); assert.deepStrictEqual(r.api.verifyCalls, ['boss']);
    assert.ok((await r.scan('1003')).ok); assert.strictEqual(r.totals.tax, 0, 'items added after Tax Off are tax-free too');
  });
  await t('cashier: turning tax back ON needs no manager', async () => {
    const r = await reg({ manager: false });
    await r.setTaxExempt(true, { user: 'boss', password: 'boss-pw' });
    const x = await r.setTaxExempt(null, {}); assert.ok(x.ok, x.message); assert.ok(!r.order.taxExempt); assert.strictEqual(r.totals.tax, 0.8);
  });
  await t('return mode: still refused with the old message (no login asked)', async () => {
    const r = await reg({ manager: false }); r.mode = 'return';
    const x = await r.setTaxExempt(true, {}); assert.strictEqual(x.ok, false); assert.ok(!x.needManager); assert.match(x.message, /for sales/);
  });
  console.log(`\n${n - bad}/${n} passed`);
  fs.writeFileSync(path.join(__dirname, 'tax-off-manager-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: n - bad, total: n, out }, null, 1));
  process.exit(bad ? 1 : 0);
})();

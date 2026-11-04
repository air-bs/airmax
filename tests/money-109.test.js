// AirMax 1.0.9 Team Kit money fixes (Ari OK 2:07 AM ET Oct 30). Offline: in-process Register + fake AIR POS pricing, no account.
// (a) an AMOUNT order discount kept the % worked out when it was set, so after items changed the tax was cut by that old %
//     ($10 off a $100 sale, then $200 of items: tax 15.98 instead of 16.86, $0.88 under-collected at 8.875%; Team Kit saw $0.89).
// (b) Clock In / Clock Out read "1,250.00" or "$100" as $0 (Number() gives NaN, then "|| 0").
// Run: node tests/money-109.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + e.message); } };
const r2 = x => Math.round(x * 100) / 100;
const TAX = 0.08875;
function make() {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-money109-')) });
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  const tot = subs => (subs || []).reduce((x, y) => x + y.price * y.quantity, 0);
  reg.api.promotionGet = async s => { const am = tot(s.subs); return { success: true, value: { subs: [], totalAmount: am, totalTax: r2(am * TAX), totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: am } }; };
  reg.api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  return reg;
}
const item = (id, price) => ({ id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity: 1, rate: 1, price, taxRate: 8.875, discount: 0, discountAmount: 0, type: 0, timestamp: 1 });
// what the customer owes when $off comes off a sale of `items` dollars (tax on what is left)
const expectDue = (items, off) => r2(r2(items - off) + r2(r2(items * TAX) * (1 - off / items)));

(async () => {
  // ---------- (a) totals ----------
  await t('(a) Team Kit case: $10 off a $100 sale, then items go to $200 -> tax 16.86, due 206.86 (before the fix: tax 15.98, due 205.98, $0.88 short)', async () => {
    const reg = make(); reg.subs = [item('A', 100)]; await reg.recalc();
    assert.ok((await reg.setOrderDiscount('amount', 10)).ok);
    assert.strictEqual(r2(reg.totals.tax), 7.99); assert.strictEqual(reg.totals.due, 97.99);
    reg.subs.push(item('B', 100)); await reg.recalc();
    assert.strictEqual(r2(reg.totals.tax), 16.86, 'tax ' + reg.totals.tax);
    assert.strictEqual(reg.totals.due, 206.86); assert.strictEqual(reg.totals.due, expectDue(200, 10));
    assert.strictEqual(r2(reg.totals.orderAmount), 190);
    assert.ok(Math.abs(reg.order.orderDiscount - 5) < 1e-9, 'order % now 5 (10 of 200), sent to AIR POS with the order: ' + reg.order.orderDiscount);
  });
  await t('(a) items go DOWN after an amount discount ($10 off $200, then $100 left) -> tax 7.99 not over-cut, due 97.99', async () => {
    const reg = make(); reg.subs = [item('A', 100), item('B', 100)]; await reg.recalc();
    await reg.setOrderDiscount('amount', 10); reg.subs.pop(); await reg.recalc();
    assert.strictEqual(reg.totals.due, expectDue(100, 10)); assert.strictEqual(reg.totals.due, 97.99);
  });
  await t('(a) quantity change after an amount discount uses the new item total', async () => {
    const reg = make(); reg.subs = [item('A', 40)]; await reg.recalc(); await reg.setOrderDiscount('amount', 4);
    reg.subs[0].quantity = 3; await reg.recalc(); assert.strictEqual(reg.totals.due, expectDue(120, 4));
  });
  await t('(a) unchanged: amount discount with no item change gives the same total as before the fix', async () => {
    const reg = make(); reg.subs = [item('A', 200)]; await reg.recalc(); await reg.setOrderDiscount('amount', 25); await reg.recalc();
    assert.strictEqual(reg.totals.due, expectDue(200, 25)); assert.ok(Math.abs(reg.order.orderDiscount - 12.5) < 1e-9);
  });
  await t('(a) unchanged: PERCENT discount still follows the items (10% of $100 then of $200)', async () => {
    const reg = make(); reg.subs = [item('A', 100)]; await reg.recalc(); await reg.setOrderDiscount('percent', 10);
    assert.strictEqual(reg.totals.due, expectDue(100, 10)); reg.subs.push(item('B', 100)); await reg.recalc();
    assert.strictEqual(reg.totals.due, expectDue(200, 20)); assert.strictEqual(reg.order.orderDiscount, 10);
  });
  await t('(a) unchanged: no discount and cleared discount give full tax', async () => {
    const reg = make(); reg.subs = [item('A', 200)]; await reg.recalc(); assert.strictEqual(reg.totals.due, 217.75);
    await reg.setOrderDiscount('amount', 10); await reg.setOrderDiscount('clear'); reg.subs.push(item('B', 1)); await reg.recalc();
    assert.strictEqual(reg.totals.due, r2(201 + r2(201 * TAX))); assert.strictEqual(reg.order.orderDiscount, 0);
  });
  await t('(a) empty cart after an amount discount: everything 0, no divide by zero', async () => {
    const reg = make(); reg.subs = [item('A', 50)]; await reg.recalc(); await reg.setOrderDiscount('amount', 5);
    reg.subs = []; await reg.recalc(); assert.strictEqual(reg.totals.due, 0); assert.strictEqual(reg.order.orderDiscount, 0);
  });
  await t('(a) the fix is ONE added line in register.js recalc (tagged // mon109+)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'lib', 'register.js'), 'utf8').split('\n').filter(l => /mon109/.test(l));
    assert.strictEqual(src.length, 1); assert.ok(/^\s+if \(o\.orderDiscountMethod === DiscountMethod\.Amount\) o\.orderDiscount = /.test(src[0]));
  });

  // ---------- (b) clock in / out amount ----------
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
  const m = app.match(/^function cashNum\(v\) \{[\s\S]*?\n\}\n/m); assert.ok(m, 'cashNum in app.js');
  const cashNum = vm.runInNewContext('(' + m[0] + ')');
  const good = { '1,250.00': 1250, '$100': 100, '$1,250.00': 1250, ' $ 1,250.5 ': 1250.5, '100': 100, '0': 0, '0.00': 0, '12.3': 12.3, '.75': 0.75, '100.': 100, '12,345,678.90': 12345678.9, '$0': 0 };
  for (const [s, v] of Object.entries(good)) await t(`(b) cash "${s}" -> ${v}`, async () => assert.strictEqual(cashNum(s), v));
  for (const s of ['', '  ', '$', 'abc', '1.250,00', '12,50', '1,25,0', '-5', '$-5', '12.345', '1e3', '1 250', '100$', '.', ',100', '0x10'])
    await t(`(b) cash "${s}" refused (not sent as $0)`, async () => assert.ok(Number.isNaN(cashNum(s)), String(cashNum(s))));
  await t('(b) Clock In and Clock Out both use cashNum and stop on a bad amount (no "Number(...) || 0" left)', async () => {
    assert.ok(/\$\('ciOk'\)\.onclick = async \(\) => \{ const a = cashNum\(\$\('ciAmt'\)\.value\); if \(isNaN\(a\)\) return toast\(CASH_BAD, false\); const r = await act\('clock-in', \{ amount: a \}\)/.test(app));
    assert.ok(/\$\('coOk'\)\.onclick = async \(\) => \{ const a = cashNum\(\$\('coAmt'\)\.value\); if \(isNaN\(a\)\) return toast\(CASH_BAD, false\); const r = await act\('clock-out', \{ amount: a \}\)/.test(app));
    assert.ok(!/Number\(\$\('(ciAmt|coAmt)'\)\.value\)/.test(app));
  });
  await t('(b) the register still sends a parsed number to AIR POS unchanged (1250 -> initialAmount 1250)', async () => {
    const reg = make(); let sent; reg.mode = 'clockin'; reg.api.clockIn = async a => { sent = a; return { success: false, message: 'stop' }; };
    await reg.clockIn(cashNum('1,250.00')); assert.strictEqual(sent, 1250);
  });
  fs.writeFileSync(path.join(__dirname, 'money-109-results.json'), JSON.stringify({ when: new Date().toISOString(), passed: n - bad, total: n, results: out }, null, 1));
  console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

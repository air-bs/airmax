// 1.0.11-local.8 (Ari OK 6:26 PM ET Nov 1): Temporary Item "Taxable" switch, on by default. A taxable temp line gets the
// store's sales tax rate from the AIR POS tax list (Commons/RetailTaxKindSelect), never a typed-in rate; off = no tax;
// F5 Tax Off still wins. Offline: fake AIR POS calls (tax worked out per line, rounded to the cent, like TestShop's
// RetailOrderPromotionGet did in the 6:29 PM ET probe), temp data folder, no account. Run: node tests/taxtemp-1011.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log('ok   ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const ONE = [{ id: 'k-sales', name: 'Sales Tax', rate: 8.875, taxFree: false }, { id: 'k-free', name: 'Tax free', rate: 0, taxFree: true }];
const MANY = [...ONE, { id: 'k-hi', name: 'Alcohol Tax', rate: 25, taxFree: false }];
const PROD = { '1001': { price: 10, taxRate: 8.875 }, '2002': { price: 4, taxRate: 0 } };

async function reg({ kinds = ONE, manager = true, kindsFail = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-tt-'));
  const r = new Register({ log: () => {}, dataDir: dir });
  r.settingsPath = null;
  r.identity = { userName: 'u', corpName: 'fake corp', shopName: 'Fake', currency: 2, superAdmin: false };
  r.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: manager ? ['RetailManager'] : [] };
  r.mode = 'sale';
  const a = r.api; a.kindCalls = 0; a.saved = null;
  const retail0 = a.retail.bind(a);
  a.retail = async (p, prm, o) => { if (p === '/Commons/RetailTaxKindSelect') { a.kindCalls++; return kindsFail ? { success: false, message: 'Network error: ETIMEDOUT', unreachable: true } : JSON.parse(JSON.stringify(kinds)); } return retail0(p, prm, o); };
  a.scan = async code => PROD[code] ? { success: true, value: { id: 'sub-' + code, itemId: 'i' + code, productId: 'p' + code, number: code, name: 'Item ' + code, quantity: 1, rate: 1, price: PROD[code].price, taxRate: PROD[code].taxRate, taxNotSet: false, discount: 0, discountAmount: 0 } } : { success: false, message: 'Product not found' };
  a.promotionGet = async s => { let tot = 0, tax = 0; for (const x of s.subs || []) { const v = x.price * x.quantity - (x.discountAmount || 0); tot += v; tax += r2(v * (x.taxRate || 0) / 100); } return { success: true, value: { subs: [], totalAmount: r2(tot), totalTax: r2(tax), totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: r2(tot) } }; };
  a.verify = async () => ({ success: false, message: 'no' });
  return r;
}
const temp = r => r.subs.filter(s => s.type === 10);

(async () => {
  await t('switch defaults to on: a temp item with no taxable flag gets the AIR POS sales tax (8.875%)', async () => {
    const r = await reg(); const x = await r.addSpecial('temp', { price: 5, name: 'Misc' }); assert.ok(x.ok, x.message);
    const l = temp(r)[0]; assert.strictEqual(l.taxRate, 8.875); assert.strictEqual(l.taxFree, false); assert.strictEqual(l.taxNotSet, true);
    assert.strictEqual(r.totals.tax, 0.44); assert.strictEqual(r.totals.due, 5.44); // 5 x 8.875% = 0.44375 -> 0.44
  });
  await t('taxable total = price + tax rounded like a regular taxed item (same price, same tax)', async () => {
    const a = await reg(); await a.scan('1001'); const b = await reg(); await b.addSpecial('temp', { price: 10, taxable: true });
    assert.strictEqual(a.totals.tax, b.totals.tax); assert.strictEqual(a.totals.due, b.totals.due); assert.strictEqual(b.totals.due, 10.89);
  });
  await t('Taxable off: no tax', async () => {
    const r = await reg(); assert.ok((await r.addSpecial('temp', { price: 5, taxable: false })).ok);
    assert.strictEqual(temp(r)[0].taxRate, 0); assert.strictEqual(r.totals.tax, 0); assert.strictEqual(r.totals.due, 5);
    assert.strictEqual(r.api.kindCalls, 0, 'no AIR POS tax read when Taxable is off');
  });
  await t('F5 Tax Off on first: taxable temp item added with no tax; F5 again puts its tax back', async () => {
    const r = await reg(); await r.setTaxExempt(true); assert.ok((await r.addSpecial('temp', { price: 5 })).ok);
    assert.strictEqual(r.totals.tax, 0); assert.strictEqual(r.totals.due, 5);
    await r.setTaxExempt(false); assert.strictEqual(temp(r)[0].taxRate, 8.875); assert.strictEqual(r.totals.due, 5.44);
  });
  await t('F5 Tax Off after adding: tax cleared, back on restores it', async () => {
    const r = await reg(); await r.addSpecial('temp', { price: 5 }); await r.setTaxExempt(true); assert.strictEqual(r.totals.tax, 0);
    await r.setTaxExempt(false); assert.strictEqual(r.totals.tax, 0.44);
  });
  await t('F5 Tax Off + Taxable off temp item: stays tax-free after F5 is turned off', async () => {
    const r = await reg(); await r.setTaxExempt(true); await r.addSpecial('temp', { price: 5, taxable: false }); await r.setTaxExempt(false);
    assert.strictEqual(r.totals.tax, 0);
  });
  await t('mixed: taxed product + tax-free product + taxable temp + non-taxable temp', async () => {
    const r = await reg(); await r.scan('1001'); await r.scan('2002'); await r.addSpecial('temp', { price: 3.33 }); await r.addSpecial('temp', { price: 1.11, taxable: false });
    // 10 x 8.875% = 0.8875 -> 0.89; 3.33 x 8.875% = 0.2955 -> 0.30; others 0
    assert.strictEqual(r.totals.tax, 1.19); assert.strictEqual(r.totals.due, r2(10 + 4 + 3.33 + 1.11 + 1.19));
  });
  await t('quantity change on a taxed temp item: tax follows the quantity', async () => {
    const r = await reg(); await r.addSpecial('temp', { price: 3.33 }); const x = await r.setQty(0, 3); assert.ok(x.ok, x.message);
    assert.strictEqual(r.totals.tax, 0.89); assert.strictEqual(r.totals.due, 10.88); // 9.99 x 8.875% = 0.8866 -> 0.89
  });
  await t('line discount (F4) 10% on a taxed temp item: tax is on the discounted price', async () => {
    const r = await reg(); await r.addSpecial('temp', { price: 10 }); const x = await r.lineDiscount(0, 'percent', 10); assert.ok(x.ok, x.message);
    assert.strictEqual(r.totals.tax, 0.8); assert.strictEqual(r.totals.due, 9.8); // 9 x 8.875% = 0.79875 -> 0.80
  });
  await t('saved sale sends the temp line with taxRate 8.875 (taxNotSet true, taxFree false), like AIR POS Edit Tax', async () => {
    const r = await reg(); await r.addSpecial('temp', { price: 5 }); const s = r.saveSubmit(false); const l = s.subs.find(x => x.type === 10);
    assert.strictEqual(l.taxRate, 8.875); assert.strictEqual(l.taxNotSet, true); assert.strictEqual(l.taxFree, false); assert.ok(!('taxName' in l));
  });
  await t('several AIR POS sales taxes and none picked: refused with a clear message, nothing added', async () => {
    const r = await reg({ kinds: MANY }); const x = await r.addSpecial('temp', { price: 5 }); assert.strictEqual(x.ok, false);
    assert.match(x.message, /2 sales taxes/); assert.strictEqual(r.subs.length, 0);
    assert.ok((await r.addSpecial('temp', { price: 5, taxable: false })).ok, 'Taxable off still works');
  });
  await t('manager picks the tax in Settings: used for the temp item; cashier cannot change it', async () => {
    const r = await reg({ kinds: MANY }); assert.ok((await r.setTempTax('k-hi')).ok); assert.ok((await r.addSpecial('temp', { price: 2 })).ok);
    assert.strictEqual(temp(r)[0].taxRate, 25); assert.strictEqual(r.totals.due, 2.5);
    const c = await reg({ kinds: MANY, manager: false }); const y = await c.setTempTax('k-hi'); assert.strictEqual(y.ok, false); assert.match(y.message, /manager/);
    const z = await r.setTempTax('k-free'); assert.strictEqual(z.ok, false, 'a tax-free kind cannot be picked');
  });
  await t('picked tax belongs to its company: another company on this PC ignores it', async () => {
    const r = await reg({ kinds: MANY }); await r.setTempTax('k-hi'); r.identity.corpName = 'other corp';
    assert.strictEqual((await r.addSpecial('temp', { price: 2 })).ok, false);
  });
  await t('rate is read from AIR POS on every add (a changed AIR POS rate is used, nothing cached)', async () => {
    const kinds = JSON.parse(JSON.stringify(ONE)); const r = await reg({ kinds }); await r.addSpecial('temp', { price: 10 });
    kinds[0].rate = 7; await r.addSpecial('temp', { price: 10 }); assert.deepStrictEqual(temp(r).map(s => s.taxRate).sort(), [7, 8.875]);
  });
  await t('AIR POS tax list not reachable: refused (never added untaxed by surprise)', async () => {
    const r = await reg({ kindsFail: true }); const x = await r.addSpecial('temp', { price: 5 }); assert.strictEqual(x.ok, false);
    assert.match(x.message, /Could not read the taxes/); assert.strictEqual(r.subs.length, 0);
  });
  await t('no sales tax in AIR POS: refused with a clear message', async () => {
    const r = await reg({ kinds: [ONE[1]] }); const x = await r.addSpecial('temp', { price: 5 }); assert.strictEqual(x.ok, false); assert.match(x.message, /no sales tax/);
  });
  await t('extra charges are unchanged (no tax)', async () => {
    const r = await reg(); r.home.retailConfig.extraChargeSetting = [{ id: 'ec1', name: 'Bag', defaultAmount: 0.1 }];
    assert.ok((await r.addSpecial('extra', { chargeItemId: 'ec1', price: 1 })).ok); assert.strictEqual(r.totals.tax, 0); assert.strictEqual(r.api.kindCalls, 0);
  });
  await t('receipt return of a taxed temp item refunds its tax', async () => {
    const r = await reg(); r.mode = 'return';
    r.ret = { kind: 'receipt', subs: [], order: { id: 'o1', orderDiscount: 0, amount: 5, tax: 0.44, subs: [{ id: 's1', itemId: '00000000-0000-0000-0000-000000000000', productId: '00000000-0000-0000-0000-000000000000', number: 'TEMP', name: 'Item', type: 10, rate: 1, quantityTotal: 1, quantityReturn: 0, price: 5, taxRate: 8.875, taxFree: false, discountTaxFree: false, discount: 0, isRetailRefund: true }] }, payments: [] };
    r.allocateRefund = total => [{ paymentType: 10, amount: total }];
    const x = await r.returnScan('TEMP'); assert.ok(x.ok, x.message); const tt = r.returnTotals();
    assert.strictEqual(tt.tax, 0.44); assert.strictEqual(tt.refund, 5.44);
  });
  await t('temp-tax info for the window: names the tax, says when Tax Off is on', async () => {
    const r = await reg(); let i = await r.tempTaxInfo(); assert.strictEqual(i.kind.name, 'Sales Tax'); assert.strictEqual(i.taxOff, false);
    await r.setTaxExempt(true); i = await r.tempTaxInfo(); assert.strictEqual(i.taxOff, true);
    const m = await reg({ kinds: MANY }); i = await m.tempTaxInfo(); assert.strictEqual(i.kind, null); assert.match(i.error, /Settings/); assert.strictEqual(i.list.length, 2);
  });
  console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

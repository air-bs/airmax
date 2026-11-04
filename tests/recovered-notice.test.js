// Air Register 1.2.0: the "Recovered the unfinished sale" notice shows only while that recovered sale is the
// current sale. Offline (fake AIR POS calls, temp data folder; no account). Run: node tests/recovered-notice.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };

// a logged-in Register with a fake AIR POS; the journal holds an unfinished, unpaid 1-line sale (or `journal`)
async function recovered({ serverStatus = null, journal } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-notice-'));
  const reg = new Register({ log: () => {}, dataDir: dir });
  reg.settingsPath = null; reg.settings.hardware = 'airpos'; reg.settings.drawerOnlyForCash = true;
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  const a = reg.api, saved = {};
  a.promotionGet = async s => { const tot = (s.subs || []).reduce((x, y) => x + y.price * y.quantity, 0); return { success: true, value: { subs: [], totalAmount: tot, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot } }; };
  a.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  a.orderSave = async s => { saved[s.id] = 1; return { success: true }; };
  a.receiveBegin = async () => ({ success: true, value: { isCompleted: true } });
  a.complete = async () => ({ success: true });
  a.openCashbox = async () => ({ success: true }); a.printBill = async () => ({ success: true });
  a.orderGet = async id => (serverStatus && id === 'rec-order' ? { success: true, value: { id, number: 'T1', status: serverStatus, amount: 10, tax: 0 } } : saved[id] ? { success: true, value: { id, status: 1 } } : { success: true, value: null });
  a.pendingSave = async () => ({ success: true });
  const order = { id: 'rec-order', discountConfigSubId: null, orderDiscountMethod: 0, orderDiscount: 0, orderDiscountAmount: 0, discount: 0, discountName: '', discountRemark: '', receiveAmount: 0, giveAmount: 0, discountTaxFree: false, discountCustomerType: 0, paymentType: 10, currency: 2, retailMemberId: null, promotionalCode: null, resuming: false };
  reg.journal.write(journal || { kind: 'sale', stage: 'cart', company: 'fake shop', shop: 'Fake', user: 'u', order, subs: [{ id: 'sub1', itemId: 'i1', productId: 'p1', number: '1001', name: 'Candy', quantity: 1, rate: 1, price: 10, taxRate: 0, discount: 0, discountAmount: 0, timestamp: 1 }], memberNumber: null, usingPoints: 0, pay: null });
  reg.recoveryPending = true;
  const r = await reg.recover();
  return { reg, r, dir };
}
const notice = reg => reg.state().notice;

(async () => {
  await t('Recovered sale: the notice shows while the recovered sale is still on screen', async () => {
    const { reg } = await recovered();
    assert.strictEqual(reg.order.id, 'rec-order'); assert.strictEqual(reg.subs.length, 1);
    assert.ok(notice(reg) && /Recovered the unfinished sale/.test(notice(reg).message), JSON.stringify(notice(reg)));
    reg.state(); assert.ok(notice(reg), 'still shown on the next screen refresh');
  });
  await t('New sale after a recovered sale: the notice is gone', async () => {
    const { reg } = await recovered(); assert.ok(notice(reg));
    const x = await reg.newSale(); assert.ok(x.ok, x.message);
    assert.strictEqual(notice(reg), null, 'notice still on screen: ' + JSON.stringify(notice(reg)));
  });
  await t('Recovered sale paid in cash and completed: the notice is gone', async () => {
    const { reg } = await recovered(); assert.ok(notice(reg));
    const p = await reg.startPay(); assert.ok(p.ok !== false, p.message);
    const x = await reg.tender({ type: 10, tendered: 10 }); assert.ok(x.ok && x.completed, x.message);
    assert.strictEqual(notice(reg), null, 'notice still on screen: ' + JSON.stringify(notice(reg)));
  });
  await t('Recovered sale put aside (cleared from the screen): the notice is gone', async () => {
    const { reg } = await recovered(); assert.ok(notice(reg));
    const x = reg.putAside(); assert.ok(x.ok, x.message);
    assert.strictEqual(notice(reg), null, 'notice still on screen: ' + JSON.stringify(notice(reg)));
  });
  await t('Recovered sale emptied line by line, then New sale: the notice is gone', async () => {
    const { reg } = await recovered(); const row = reg.state().cart[0];
    if (reg.remove) await reg.remove(0); await reg.newSale();
    assert.strictEqual(notice(reg), null, 'notice still on screen: ' + JSON.stringify(notice(reg)) + ' row ' + (row && row.number));
  });
  await t('Notice not tied to a restored cart ("already completed") still stays until OK, unchanged', async () => {
    const { reg } = await recovered({ serverStatus: 20 });
    assert.strictEqual(reg.subs.length, 0); assert.ok(notice(reg) && /already completed/.test(notice(reg).message), JSON.stringify(notice(reg)));
    await reg.newSale(); assert.ok(notice(reg) && /already completed/.test(notice(reg).message), 'should stay until OK');
  });
  await t('Recovery data untouched: journal still written for the restored cart and cleared after completion', async () => {
    const { reg } = await recovered(); const j = reg.journal.read();
    assert.ok(j && j.order && j.order.id === 'rec-order' && j.subs.length === 1, 'journal for the recovered cart');
    await reg.startPay(); const x = await reg.tender({ type: 10, tendered: 10 }); assert.ok(x.ok && x.completed, x.message);
    assert.strictEqual(reg.journal.read(), null, 'journal cleared after the sale completed');
  });
  console.log(`\n${n - bad}/${n} passed`);
  fs.writeFileSync(path.join(__dirname, 'recovered-notice-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: n - bad, total: n, out }, null, 1));
  process.exit(bad ? 1 : 0);
})();

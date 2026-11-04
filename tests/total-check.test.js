// Air Register 1.2.3 total check (Register 2, 10/29: "received amount is less than the amount due" after "Fully paid").
// Offline: fake AIR POS calls in-process, temp data folder, no account. Run: node tests/total-check.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const STALE = "Couldn't check the total with AIR POS. Nothing was charged. Check the connection, then press Payment again.";
const r2 = x => Math.round(x * 100) / 100;

// a logged-in Register + an AIR POS-like fake: prices from the saved order, strict Complete, one cash receive per order
function make(dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-totalcheck-'));
  const reg = new Register({ log: () => {}, dataDir: dir });
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  const srv = { promoFail: 0, extra: 0, orders: {}, rcv: {}, calls: { promo: 0, begin: 0, complete: 0 }, done: {} };
  const tot = subs => (subs || []).reduce((x, y) => x + y.price * y.quantity, 0);
  const due = subs => r2(tot(subs) * 1.08875 + srv.extra);
  const a = reg.api;
  a.promotionGet = async s => { srv.calls.promo++; if (srv.promoFail > 0) { srv.promoFail--; return { success: false, message: 'Network error: ETIMEDOUT', unreachable: true }; }
    const am = tot(s.subs) + srv.extra; return { success: true, value: { subs: [], totalAmount: am, totalTax: r2(tot(s.subs) * 0.08875), totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: am } }; };
  a.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  a.productPaged = async () => ({ rows: [] });
  a.orderSave = async s => { srv.orders[s.id] = s; return { success: true }; };
  a.receiveBegin = async s => { srv.calls.begin++; const l = srv.rcv[s.retailOrderId] = (srv.rcv[s.retailOrderId] || []).filter(r => !(s.paymentType === 10 && r.paymentType === 10) && r.id !== s.id);
    l.push({ id: s.id, paymentType: s.paymentType, amount: s.amount, receiveAmount: s.receiveAmount, giveAmount: s.giveAmount, status: 20 }); return { success: true, value: { isCompleted: true } }; };
  a.complete = async c => { srv.calls.complete++; const o = srv.orders[c.id]; const got = r2((srv.rcv[c.id] || []).reduce((x, r) => x + r.amount, 0));
    if (got + 0.004 < due(o.subs)) return { success: false, message: 'The received amount is less than the amount due, the order cannot be completed.' }; srv.done[c.id] = 1; return { success: true }; };
  a.orderGet = async id => srv.orders[id] ? { success: true, value: { id, number: 'T1', status: srv.done[id] ? 20 : 15, amount: 1, tax: 0, receives: srv.rcv[id] || [] } } : { success: true, value: null };
  a.openCashbox = async () => ({ success: true }); a.printBill = async () => ({ success: true }); a.printBillContent = async () => ({ success: true });
  return { reg, srv, dir };
}
const item = (id, price) => ({ id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity: 1, rate: 1, price, taxRate: 8.875, discount: 0, discountAmount: 0, type: 0, timestamp: 1 });
const receives = (srv, reg) => (srv.rcv[reg.order.id] || []).length;

(async () => {
  await t('Normal sale: one recalc per step, cash pays the full total, completes first time', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 100)]; assert.strictEqual(await reg.recalc(), true);
    const r = await reg.tender({ type: 10, tendered: reg.totals.due });
    assert.ok(r.ok && r.completed, JSON.stringify(r)); assert.strictEqual(srv.calls.complete, 1);
  });
  await t('Register 2 case: total check fails after adding an item -> payment refused, nothing sent to AIR POS', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 100)]; await reg.recalc(); const before = reg.totals.due;
    srv.promoFail = 5; reg.subs.push(item('B', 10)); assert.strictEqual(await reg.recalc(), false);
    assert.strictEqual(reg.totals.stale, true); assert.strictEqual(reg.totals.due, before, 'old total still on screen but marked stale');
    const r = await reg.tender({ type: 10, tendered: before });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.message, STALE); assert.ok(r.retryable && r.stale);
    assert.strictEqual(srv.calls.begin, 0, 'no receive sent'); assert.strictEqual(reg.paidTotal(), 0);
  });
  await t('Retry after the connection is back: correct (higher) total, pays and completes', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 100)]; await reg.recalc(); srv.promoFail = 1; reg.subs.push(item('B', 10)); await reg.recalc();
    const r = await reg.tender({ type: 10, tendered: 200 });
    assert.ok(r.ok && r.completed, JSON.stringify(r)); assert.strictEqual(reg.lastOrderId && srv.done[reg.lastOrderId], 1);
    assert.strictEqual(r.due, r2(110 * 1.08875)); assert.strictEqual(r.change, r2(200 - r2(110 * 1.08875)));
  });
  await t('Payment screen already open: total check fails before the next payment -> refused, nothing sent', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 100)]; const s = await reg.startPay(); assert.ok(s.ok);
    srv.promoFail = 1; const r = await reg.tender({ type: 10, amount: 20, tendered: 20 });
    assert.strictEqual(r.message, STALE); assert.strictEqual(srv.calls.begin, 0);
  });
  await t('AIR POS refuses Complete (received < due): reopens payment for what is still owed, paid line kept, not re-sent', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 100)]; await reg.recalc();
    const due0 = reg.totals.due; const orig = reg.api.complete;
    reg.api.complete = async c => { srv.extra = 10; reg.api.complete = orig; return orig(c); }; // the server's total went up after we priced it
    const r = await reg.tender({ type: 10, tendered: due0 });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.owed, 10); assert.ok(/AIR POS says \$10\.00 is still owed/.test(r.message) && /Your payments are safe/.test(r.message) && /press Esc/.test(r.message) && /\$10\.00/.test(r.message), r.message);
    assert.strictEqual(reg.paidTotal(), due0); assert.strictEqual(reg.remaining(), 10); assert.ok(!reg.pay.lastError, 'no "fix it" error left on the Fully paid screen');
    assert.strictEqual(srv.calls.begin, 1); assert.strictEqual(receives(srv, reg), 1);
    // 1.0.9-local.2 (a): real AIR POS keeps only the first cash receive (TestShop C33): a second cash is refused, nothing sent
    const c2 = await reg.tender({ type: 10, tendered: 10 }); assert.ok(!c2.ok && c2.sameType && /already taken on this sale/.test(c2.message), JSON.stringify(c2)); assert.strictEqual(srv.calls.begin, 1);
    const f2 = await reg.tender({ type: 20, amount: 10 }); // cashier takes the $10 by card
    assert.ok(f2.ok && f2.completed, JSON.stringify(f2));
    const rcv = srv.rcv[f2.orderId]; assert.strictEqual(rcv.length, 2); assert.strictEqual(rcv[0].amount, due0, 'the first cash receive kept as is'); assert.strictEqual(rcv[1].amount, 10);
  });
  await t('Pressing Finish sale again after a refusal never posts a payment again', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 100)]; await reg.recalc(); const due0 = reg.totals.due;
    const orig = reg.api.complete; reg.api.complete = async c => { srv.extra = 5; reg.api.complete = orig; return orig(c); };
    await reg.tender({ type: 10, tendered: due0 }); const b0 = srv.calls.begin;
    const f = await reg.finishSale(); const f3 = await reg.finishSale();
    assert.strictEqual(srv.calls.begin, b0); assert.strictEqual(f.ok, false); assert.strictEqual(f3.ok, false); assert.strictEqual(f.owed, 5);
  });
  await t('Refusal while the total still cannot be checked: says so, keeps the paid line, does not claim nothing is owed', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 100)]; await reg.recalc(); const due0 = reg.totals.due;
    const orig = reg.api.complete; reg.api.complete = async c => { srv.extra = 5; srv.promoFail = 9; reg.api.complete = orig; return orig(c); };
    const r = await reg.tender({ type: 10, tendered: due0 });
    assert.strictEqual(r.ok, false); assert.ok(r.stale && /could not be checked/.test(r.message), r.message); assert.strictEqual(reg.paidTotal(), due0);
    srv.promoFail = 0; const f = await reg.finishSale(); assert.strictEqual(f.owed, 5, JSON.stringify(f)); assert.strictEqual(srv.calls.begin, 1);
  });
  await t('Recovery after a forced close: paid cash line comes back from AIR POS, owed amount shown, nothing re-sent', async () => {
    const { reg, srv, dir } = make(); reg.subs = [item('A', 100)]; await reg.recalc(); const due0 = reg.totals.due;
    const orig = reg.api.complete; reg.api.complete = async c => { srv.extra = 7; reg.api.complete = orig; return orig(c); };
    await reg.tender({ type: 10, tendered: due0 }); reg.journalSnap('route');
    const { reg: reg2 } = make(dir); reg2.api = reg.api; reg2.recoveryPending = true;
    const begins = srv.calls.begin, completes = srv.calls.complete; const rr = await reg2.recover();
    assert.ok(rr && /already paid/.test(rr.notice) && /\$7\.00 left/.test(rr.notice), JSON.stringify(rr));
    assert.strictEqual(reg2.paidTotal(), due0); assert.strictEqual(srv.calls.begin, begins); assert.strictEqual(srv.calls.complete, completes);
  });
  await t('Recovery when the total cannot be checked: does NOT auto-finish; Finish sale later shows what is owed', async () => {
    const { reg, srv, dir } = make(); reg.subs = [item('A', 100)]; await reg.recalc(); const due0 = reg.totals.due;
    const orig = reg.api.complete; reg.api.complete = async c => { srv.extra = 7; reg.api.complete = orig; return orig(c); };
    await reg.tender({ type: 10, tendered: due0 }); reg.journalSnap('route');
    const { reg: reg2 } = make(dir); reg2.api = reg.api; reg2.recoveryPending = true;
    srv.promoFail = 1; const completes = srv.calls.complete; const rr = await reg2.recover();
    assert.strictEqual(srv.calls.complete, completes, 'no Complete sent on a stale total'); assert.ok(rr && rr.ok === false && /could not check the total/.test(rr.notice), JSON.stringify(rr));
    assert.strictEqual(reg2.paidTotal(), due0); assert.strictEqual(reg2.totals.stale, true);
    const f = await reg2.finishSale(); assert.strictEqual(f.owed, 7, JSON.stringify(f)); assert.strictEqual(srv.calls.complete, completes, 'owed found by the total check before sending Complete');
    const p = await reg2.tender({ type: 20, amount: 7 }); assert.ok(p.ok && p.completed, JSON.stringify(p)); // (a): the rest by card, cash already taken
  });
  await t('Recovery of a fully paid sale with a good connection still finishes it (old behaviour kept)', async () => {
    const { reg, srv, dir } = make(); reg.subs = [item('A', 100)]; await reg.recalc(); const due0 = reg.totals.due;
    const orig = reg.api.complete; reg.api.complete = async () => ({ success: false, unreachable: true, message: 'Network error' }); reg.api.orderGet0 = reg.api.orderGet;
    const r = await reg.tender({ type: 10, tendered: due0 }); assert.strictEqual(r.ok, false); reg.journalSnap('route'); reg.api.complete = orig;
    const { reg: reg2 } = make(dir); reg2.api = reg.api; reg2.recoveryPending = true; const rr = await reg2.recover();
    assert.ok(rr && rr.ok && /finished it now/.test(rr.notice), JSON.stringify(rr)); assert.strictEqual(srv.calls.begin, 1);
  });
  console.log(`${n - bad}/${n} passed`);
  fs.writeFileSync(path.join(__dirname, 'total-check-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: n - bad, total: n, out }, null, 1));
  process.exit(bad ? 1 : 0);
})();

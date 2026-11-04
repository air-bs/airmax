// Recovery verify (Gordon OK 6:41 PM ET Nov 3 2026, branch fix/recovery-receive-verify): after a crash, when recovery's order read (RetailOrderGet)
// lists NO receive for the payment the journal says was being sent, recovery asks AIR POS about that one payment with RetailOrderReceiveCheck
// (read-only) before it says "nothing was paid yet". Done = adopted (never re-sent); pending card = existing wait; no clear answer = sale stays
// blocked (recoveryPending) with a "not known whether it was paid" notice. Recovery never sends a ReceiveBegin. Offline AIR POS-like fake, in-process.
// Run: node tests/recovery-verify-1011.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log('PASS ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const r2 = x => Math.round(x * 100) / 100;
const CRASH = new Error('simulated crash: the app died right after AIR POS handled ReceiveBegin');

// one AIR POS (srv) shared by the "before the crash" and "after the restart" Register on the same data folder.
// srv.hide: the order read hides receives of a Pending order (the fake-server.js line 226 behaviour / a read one behind)
// srv.check: null = answer truthfully | 'error' (HTTP 500) | 'unreachable' (timeout) | 'pending' (isCompleted false) | 'absent' (1001)
function make(dir, srv) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-rv11-'));
  const logs = [];
  const reg = new Register({ log: m => logs.push(String(m)), dataDir: dir });
  reg.settingsPath = null; reg.settings.hardware = 'airpos'; reg.pollCard = () => {}; reg.keptRetryMs = 0;
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  srv = srv || { orders: {}, rcv: {}, begins: [], completes: 0, done: {}, checks: [], hide: true, check: null, crashAfterBegin: false, status: 20 };
  const due = subs => r2((subs || []).reduce((x, y) => x + y.price * y.quantity, 0));
  const a = reg.api;
  a.promotionGet = async s => { const am = due(s.subs); return { success: true, value: { subs: [], totalAmount: am, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: am } }; };
  a.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  a.productPaged = async () => ({ rows: [] });
  a.orderSave = async s => { srv.orders[s.id] = s; return { success: true }; };
  a.receiveBegin = async s => {
    srv.begins.push(JSON.parse(JSON.stringify(s)));
    const l = srv.rcv[s.retailOrderId] = srv.rcv[s.retailOrderId] || [];
    if (!l.some(r => r.id === s.id)) l.push({ id: s.id, paymentType: s.paymentType, amount: s.amount, receiveAmount: s.receiveAmount, giveAmount: s.giveAmount, status: srv.status });
    if (srv.crashAfterBegin) throw CRASH;
    return { success: true, value: { isCompleted: srv.status === 20 } };
  };
  a.receiveCheck = async s => {
    srv.checks.push(s.id);
    if (srv.check === 'error') return { success: false, errorCode: 500, message: 'HTTP 500 Internal Server Error' };
    if (srv.check === 'unreachable') return { success: false, unreachable: true, message: 'Network error: timeout' };
    if (srv.check === 'absent') return { success: false, errorCode: 1001, message: 'Combined payment infomation not found' };
    const r = (srv.rcv[s.retailOrderId] || []).find(x => x.id === s.id);
    if (srv.check === 'pending') return r ? { success: true, value: { isCompleted: false } } : { success: false, errorCode: 1001, message: 'Combined payment infomation not found' };
    return r ? { success: true, value: { isCompleted: r.status === 20 } } : { success: false, errorCode: 1001, message: 'Combined payment infomation not found' };
  };
  a.complete = async c => { srv.completes++; const o = srv.orders[c.id]; const l = srv.rcv[c.id] || []; const got = r2(l.reduce((x, r) => x + r.amount, 0));
    if (got + 0.004 < due(o.subs)) return { success: false, message: 'The received amount is less than the amount due, the order cannot be completed.' };
    srv.done[c.id] = 1; return { success: true }; };
  a.orderGet = async id => srv.orders[id] ? { success: true, value: { id, number: 'T1', status: srv.done[id] ? 20 : 15, amount: due(srv.orders[id].subs), tax: 0, receives: srv.done[id] || !srv.hide ? (srv.rcv[id] || []) : [] } } : { success: true, value: null };
  a.openCashbox = async () => ({ success: true }); a.printBill = async () => ({ success: true }); a.printBillContent = async () => ({ success: true });
  return { reg, srv, dir, logs };
}
const item = (id, price) => ({ id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity: 1, rate: 1, price, taxRate: 0, taxFree: true, discount: 0, discountAmount: 0, type: 0, timestamp: 1 });

// first session: ring a $10 sale, send one payment, and "die" right after AIR POS handled ReceiveBegin (journal keeps pendingSubmit)
async function crashAfterPayment({ type = 20, tendered, status = 20, srv } = {}) {
  const a = make(null, srv); a.srv.status = status; a.srv.crashAfterBegin = true;
  a.reg.subs = [item('A', 10)]; await a.reg.recalc(); await a.reg.startPay();
  let died = false; try { await a.reg.tender(type === 10 ? { type: 10, tendered: tendered || 10 } : { type, amount: tendered }); } catch (e) { died = e === CRASH; }
  assert.ok(died, 'the first session should die inside ReceiveBegin');
  const j = a.reg.journal.read(); assert.ok(j && j.pay && j.pay.pendingSubmit && j.pay.pendingSubmit.submit.id, 'journal holds the pending payment id');
  a.srv.crashAfterBegin = false; a.srv.begins.length = 0; a.srv.checks.length = 0; // count only what the restarted app does
  return { ...a, jid: j.pay.pendingSubmit.submit.id };
}
// restarted app (new Register on the same folder + same AIR POS) logs in and runs its recovery check
async function restart(c) { const b = make(c.dir, c.srv); b.reg.recoveryPending = true; const r = await b.reg.recover(); return { ...b, r }; }
const noBegin = c => assert.strictEqual(c.srv.begins.length, 0, 'recovery must never send a ReceiveBegin');

(async () => {
  await t('Read empty + journal id + ReceiveCheck done (card, full amount): adopted, sale finished, no new ReceiveBegin', async () => {
    const c = await crashAfterPayment({ type: 20 }); const b = await restart(c);
    assert.ok(b.r && b.r.ok, JSON.stringify(b.r)); assert.ok(/fully paid/.test(b.r.notice) && !/nothing was paid/i.test(b.r.notice), b.r.notice);
    noBegin(b); assert.strictEqual(c.srv.completes, 1); assert.strictEqual(c.srv.rcv[b.reg.lastOrderId || Object.keys(c.srv.orders)[0]].length, 1, 'only ONE receive on AIR POS');
    assert.ok(c.srv.checks.includes(c.jid), 'ReceiveCheck was asked about the journaled id');
    assert.ok(b.logs.some(l => /reply was lost; server shows receive done .*adopted, not sent again/.test(l)), 'logs the adopted payment');
    assert.strictEqual(b.reg.recoveryPending, false);
  });
  await t('Same with cash: adopted and finished, no new ReceiveBegin', async () => {
    const c = await crashAfterPayment({ type: 10, tendered: 10 }); const b = await restart(c);
    assert.ok(b.r && b.r.ok && /fully paid/.test(b.r.notice), JSON.stringify(b.r)); noBegin(b); assert.strictEqual(c.srv.completes, 1);
  });
  await t('Part paid ($4 of $10 cash): adopted as paid, $6 left, nothing re-sent, cart restored', async () => {
    const c = await crashAfterPayment({ type: 10, tendered: 4 }); const b = await restart(c);
    assert.ok(b.r && b.r.ok, JSON.stringify(b.r)); assert.ok(/\$4\.00 already paid, \$6\.00 left/.test(b.r.notice), b.r.notice);
    noBegin(b); assert.strictEqual(b.reg.paidTotal(), 4); assert.strictEqual(b.reg.subs.length, 1); assert.strictEqual(c.srv.completes, 0);
    assert.ok(!/nothing was paid/i.test(b.r.notice));
  });
  await t('ReceiveCheck PENDING on a card (still open on AIR POS): existing wait behaviour, card kept waiting, never re-sent, never cancelled as paid', async () => {
    const c = await crashAfterPayment({ type: 20, status: 10 }); c.srv.check = 'pending'; const b = await restart(c);
    assert.ok(b.r && b.r.ok && /still open on the terminal/.test(b.r.notice), JSON.stringify(b.r)); assert.ok(!/nothing was paid/i.test(b.r.notice));
    noBegin(b); assert.ok(b.reg.pay && b.reg.pay.card && b.reg.pay.card.status === 'waiting', 'card is waiting'); assert.strictEqual(b.reg.pay.card.submit.id, c.jid); assert.strictEqual(c.srv.completes, 0);
  });
  await t('ReceiveCheck PENDING on cash (AIR POS has it, not confirmed): sale stays blocked, flagged, not "nothing paid"', async () => {
    const c = await crashAfterPayment({ type: 10, tendered: 10, status: 10 }); c.srv.check = 'pending'; const b = await restart(c);
    assert.ok(b.r && b.r.ok === false && !/nothing was paid/i.test(b.r.notice) && /not confirmed/.test(b.r.notice), JSON.stringify(b.r));
    assert.strictEqual(b.reg.recoveryPending, true); assert.strictEqual(b.reg.subs.length, 0, 'cart not restored'); noBegin(b);
  });
  for (const mode of ['error', 'unreachable']) {
    await t(`ReceiveCheck ${mode.toUpperCase()}: not "nothing was paid", sale stays blocked + flagged, nothing re-sent; clears when AIR POS answers`, async () => {
      const c = await crashAfterPayment({ type: 20 }); c.srv.check = mode; const b = await restart(c);
      assert.ok(b.r && b.r.ok === false, JSON.stringify(b.r)); assert.ok(!/nothing was paid/i.test(b.r.notice), b.r.notice); assert.ok(/NOT known whether it was paid/.test(b.r.notice) && /AIR POS back office/.test(b.r.notice), b.r.notice);
      assert.strictEqual(b.reg.recoveryPending, true, 'blocked from new payments (server.js refuses pay/scan while recoveryPending)'); assert.strictEqual(b.reg.state().recoveryPending, true);
      assert.strictEqual(b.reg.subs.length, 0); noBegin(b); assert.strictEqual(c.srv.completes, 0);
      assert.ok(!b.logs.some(l => /nothing was paid/.test(l)));
      c.srv.check = null; const r2_ = await b.reg.recover(); /* what retryRecovery() / the 15 s timer runs while recoveryPending */ assert.ok(r2_.ok && /fully paid/.test(r2_.notice), JSON.stringify(r2_)); noBegin(b); assert.strictEqual(c.srv.completes, 1); assert.strictEqual(b.reg.recoveryPending, false);
    });
  }
  await t('ReceiveCheck ABSENT (1001: AIR POS never recorded it): existing "nothing was paid yet" is correct, cart restored, nothing re-sent', async () => {
    const c = await crashAfterPayment({ type: 20 }); c.srv.check = 'absent'; const b = await restart(c);
    assert.ok(b.r && b.r.ok && /nothing was paid yet/i.test(b.r.notice), JSON.stringify(b.r)); noBegin(b); assert.strictEqual(b.reg.subs.length, 1); assert.strictEqual(b.reg.recoveryPending, false);
  });
  await t('No journaled payment id (closed before any payment was sent): unchanged "nothing was paid yet", ReceiveCheck never called', async () => {
    const a = make(); a.reg.subs = [item('A', 10)]; await a.reg.recalc(); await a.reg.startPay(); a.reg.journalSnap('pay'); // journal has the cart + pay screen, no pendingSubmit
    const j = a.reg.journal.read(); assert.ok(j && !(j.pay && j.pay.pendingSubmit), 'no pendingSubmit in the journal');
    const b = make(a.dir, a.srv); b.reg.recoveryPending = true; const r = await b.reg.recover();
    assert.ok(r && r.ok && /nothing was paid yet/i.test(r.notice), JSON.stringify(r)); assert.strictEqual(a.srv.checks.length, 0); assert.strictEqual(a.srv.begins.length, 0);
  });
  await t('Order read DOES list the payment (normal case): the existing path is used, no extra ReceiveCheck for it', async () => {
    const c = await crashAfterPayment({ type: 10, tendered: 4 }); c.srv.hide = false; const b = await restart(c);
    assert.ok(b.r && b.r.ok && /\$4\.00 already paid/.test(b.r.notice), JSON.stringify(b.r)); assert.strictEqual(c.srv.checks.length, 0); noBegin(b); assert.strictEqual(b.reg.paidTotal(), 4);
  });
  await t('Never leaks card data: logs and notice carry ids / type names only', async () => {
    const c = await crashAfterPayment({ type: 20 }); c.srv.check = 'error'; const b = await restart(c);
    const all = b.logs.join('\n') + '\n' + JSON.stringify(b.r); assert.ok(!/cardNo|cvv|expiration|\b\d{13,19}\b/.test(all), 'no card data in logs');
    assert.ok(b.logs.some(l => l.includes(c.jid) && /ReceiveCheck says unknown/.test(l)), 'id and result are logged');
  });
  console.log(`recovery-verify-1011: ${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

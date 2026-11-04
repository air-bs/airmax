// M1 fix (approved Nov 3 10:38 AM ET, branch fix/m1-payment-keep): a cash/check/gift/store credit payment that AIR POS reported COMPLETE is never
// dropped because ONE order read does not list it yet. The order is read up to 5 times (0.8 s apart); only if every read still lacks it, it is KEPT
// as paid and flagged (never dropped). Offline AIR POS-like fake in-process (same as multigift-1011). Run: node tests/m1-keep-1011.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log('PASS ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const r2 = x => Math.round(x * 100) / 100;

function make(dir, srvIn) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-mg7-'));
  const logs = [];
  const reg = new Register({ log: m => logs.push(String(m)), dataDir: dir });
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  const srv = srvIn || { orders: {}, rcv: {}, begins: [], completes: 0, done: {}, cards: {}, keepLess: null, drop: 0, lose: 0, getMode: null, members: {} };
  const due = subs => r2((subs || []).reduce((x, y) => x + y.price * y.quantity, 0)); // no tax: amounts stay exact
  const a = reg.api;
  a.promotionGet = async s => { const am = due(s.subs); return { success: true, value: { subs: [], totalAmount: am, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: am } }; };
  a.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  a.productPaged = async () => ({ rows: [] });
  a.orderSave = async s => { srv.orders[s.id] = s; return { success: true }; };
  a.receiveBegin = async s => {
    srv.begins.push(JSON.parse(JSON.stringify(s)));
    const l = srv.rcv[s.retailOrderId] = srv.rcv[s.retailOrderId] || [];
    let store = !l.some(r => r.paymentType === s.paymentType && r.id !== s.id) && !l.some(r => r.id === s.id); // real AIR POS: first receive of a type only
    if (srv.drop > 0) { srv.drop--; store = false; }
    if (s.paymentType === 40) { const bal = r2((s.retailGiftCards || []).reduce((x, id) => x + (srv.cards[id] || 0), 0)); if (bal + 0.004 < s.amount) return { success: false, message: 'Insufficient gift card balance' }; }
    if (store) l.push({ id: s.id, paymentType: s.paymentType, amount: srv.keepLess != null ? srv.keepLess : s.amount, receiveAmount: s.receiveAmount, giveAmount: s.giveAmount, status: 20, giftIds: s.retailGiftCards || [] });
    if (srv.lose > 0) { srv.lose--; return { success: false, message: 'Network error: socket hang up', unreachable: true }; }
    return { success: true, value: { isCompleted: true } };
  };
  a.receiveCheck = async s => { const r = (srv.rcv[s.retailOrderId] || []).find(x => x.id === s.id); return r ? { success: true, value: { isCompleted: r.status === 20 } } : { success: false, errorCode: 1001, message: 'Combined payment infomation not found' }; };
  a.complete = async c => { srv.completes++; const o = srv.orders[c.id]; const l = srv.rcv[c.id] || []; const got = r2(l.reduce((x, r) => x + r.amount, 0));
    if (got + 0.004 < due(o.subs)) return { success: false, message: 'The received amount is less than the amount due, the order cannot be completed.' };
    for (const r of l) if (r.paymentType === 40) { let left = r.amount; for (const id of r.giftIds) { const take = Math.min(left, srv.cards[id] || 0); srv.cards[id] = r2(srv.cards[id] - take); left = r2(left - take); } }
    srv.done[c.id] = 1; return { success: true }; };
  a.orderGet = async id => {
    if (srv.getMode === 'unreachable') return { success: false, message: 'Network error', unreachable: true };
    if (srv.getMode === 'refused') return { success: false, errorCode: 1000, message: 'Object reference not set to an instance of an object.' };
    return srv.orders[id] ? { success: true, value: { id, number: 'T1', status: srv.done[id] ? 20 : 15, amount: due(srv.orders[id].subs), tax: 0, receives: (srv.rcv[id] || []).map(({ giftIds, ...r }) => r) } } : { success: true, value: null };
  };
  a.openCashbox = async () => ({ success: true }); a.printBill = async () => ({ success: true }); a.printBillContent = async () => ({ success: true });
  a.giftCardGet = async number => ({ success: true, value: { number, balance: 0 } });
  return { reg, srv, dir, logs };
}
const item = (id, price) => ({ id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity: 1, rate: 1, price, taxRate: 0, taxFree: true, discount: 0, discountAmount: 0, type: 0, timestamp: 1 });
const cards = (srv, list) => list.map((b, i) => { const id = 'gc' + i; srv.cards[id] = b; return { id, number: 'ZZTGC1030' + String(i + 1).padStart(2, '0'), balance: b }; });
// AIR POS one read behind: the first `lag` order reads do not list receives that were just saved
function lagReads(reg, srv, lag) { const og = reg.api.orderGet; let left = lag, reads = 0; reg.api.orderGet = async id => { if (srv.begins.length) reads++; const g = await og(id); if (srv.begins.length && left > 0 && g.value && Array.isArray(g.value.receives)) { /* only reads AFTER the payment was sent */ left--; return { ...g, value: { ...g.value, receives: [] } }; } return g; }; return () => reads; }

(async () => {
  await t('M1 repro: AIR POS lags ONE read behind a cash payment it reported complete: the payment is counted, sale goes on, nothing re-sent', async () => {
    const { reg, srv } = make(); reg.keptRetryMs = 5; reg.subs = [item('A', 5)]; await reg.recalc(); const reads = lagReads(reg, srv, 1);
    const r = await reg.tender({ type: 10, tendered: 2 });
    assert.ok(r.ok && !r.notKept, JSON.stringify(r)); assert.strictEqual(reg.paidTotal(), 2); assert.strictEqual(srv.begins.length, 1); assert.ok(reads() >= 2, 'read again');
    assert.ok(!reg.pay.tenders[0].unconfirmed);
  });
  await t('Full payment with a lagging read completes the sale (the real M1 symptom: it came back as unpaid)', async () => {
    const { reg, srv } = make(); reg.keptRetryMs = 5; reg.subs = [item('A', 5)]; await reg.recalc(); lagReads(reg, srv, 1);
    const r = await reg.tender({ type: 10, tendered: 5 }); assert.ok(r.ok && r.completed, JSON.stringify(r)); assert.strictEqual(srv.completes, 1);
  });
  await t('Lag of 3 reads (a slow AIR POS): still counted after the retries', async () => {
    const { reg, srv } = make(); reg.keptRetryMs = 5; reg.subs = [item('A', 5)]; await reg.recalc(); lagReads(reg, srv, 3);
    const r = await reg.tender({ type: 10, tendered: 2 }); assert.ok(r.ok && !r.notKept, JSON.stringify(r)); assert.strictEqual(reg.paidTotal(), 2); assert.ok(!reg.pay.tenders[0].unconfirmed);
  });
  await t('Check payment and store credit with a lagging read: counted too', async () => {
    const { reg, srv } = make(); reg.keptRetryMs = 5; reg.subs = [item('A', 5)]; await reg.recalc(); reg.member = { id: 'm1', number: '555', availableBalance: 10, creditAmount: 0 }; lagReads(reg, srv, 1);
    const r = await reg.tender({ type: 11, amount: 3 }); assert.ok(r.ok && !r.notKept, JSON.stringify(r)); assert.strictEqual(reg.paidTotal(), 3); assert.strictEqual(reg.member.availableBalance, 7, 'balance shown stays reduced by the $3 (not put back)');
  });
  await t('Never listed in 5 reads: KEPT and flagged (unconfirmed, log, journal), never dropped, nothing re-sent', async () => {
    const { reg, srv, logs } = make(); reg.keptRetryMs = 0; reg.subs = [item('A', 5)]; await reg.recalc(); const reads = lagReads(reg, srv, 99);
    const r = await reg.tender({ type: 10, tendered: 2 }); assert.ok(r.ok && !r.notKept, JSON.stringify(r)); assert.strictEqual(reg.paidTotal(), 2); assert.strictEqual(srv.begins.length, 1);
    assert.strictEqual(reads(), 5, 'exactly 5 order reads'); assert.ok(reg.pay.tenders[0].unconfirmed); assert.ok(logs.some(l => /PAYMENT NOT CONFIRMED/.test(l)));
  });
  await t('A partial keep is still shown as what AIR POS kept (asked $4, kept $1), nothing re-sent', async () => {
    const { reg, srv } = make(); reg.keptRetryMs = 0; reg.subs = [item('A', 5)]; await reg.recalc(); srv.keepLess = 1;
    const r = await reg.tender({ type: 10, tendered: 4 }); assert.strictEqual(r.ok, false); assert.ok(r.notKept); assert.strictEqual(r.kept, 1); assert.strictEqual(reg.paidTotal(), 1); assert.strictEqual(srv.begins.length, 1);
  });
  await t('A clear first read (normal case) does not wait or read again', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); const og = reg.api.orderGet; let c = 0; reg.api.orderGet = async id => { if (srv.begins.length) c++; return og(id); };
    const t0 = Date.now(); const r = await reg.tender({ type: 10, tendered: 2 }); assert.ok(r.ok); assert.strictEqual(c, 1); assert.ok(Date.now() - t0 < 700);
  });
  console.log(`m1-keep-1011: ${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

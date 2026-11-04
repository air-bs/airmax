// 1.0.11-local.7 (mgc1011, Ari OK 6:07 PM ET Nov 1): several gift cards = ONE gift card payment (like AIR POS GiftCardConfirmer.vue),
// a 2nd gift card payment is refused before anything is sent, and after a cash / check / gift / store credit payment only what
// AIR POS really kept is counted. Offline: an AIR POS-like fake in-process (keeps only the FIRST receive of each payment type,
// answers success for the dropped one, like TestShop RO11052; gift balances are taken at Complete). Run: node tests/multigift-1011.test.js
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
const gBegins = srv => srv.begins.filter(b => b.paymentType === 40);

(async () => {
  await t('1 card: one gift payment, one ReceiveBegin with the card id only (no per-card amounts), sale completes, balance taken once', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 3)]; await reg.recalc();
    const r = await reg.tender({ type: 40, amount: 3, giftCards: cards(srv, [5]) });
    assert.ok(r.ok && r.completed, JSON.stringify(r)); assert.strictEqual(gBegins(srv).length, 1);
    assert.deepStrictEqual(gBegins(srv)[0].retailGiftCards, ['gc0']); assert.strictEqual(gBegins(srv)[0].amount, 3); assert.strictEqual(srv.cards.gc0, 2);
  });
  await t('2 cards ($2 + $3) for $4: ONE gift payment with both ids, completes, AIR POS splits it (2 -> 0, 3 -> 1)', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 4)]; await reg.recalc();
    const r = await reg.tender({ type: 40, amount: 4, giftCards: cards(srv, [2, 3]) });
    assert.ok(r.ok && r.completed, JSON.stringify(r)); assert.strictEqual(gBegins(srv).length, 1);
    assert.deepStrictEqual(gBegins(srv)[0].retailGiftCards, ['gc0', 'gc1']); assert.strictEqual(srv.cards.gc0, 0); assert.strictEqual(srv.cards.gc1, 1);
    assert.strictEqual(reg.pay ? reg.pay.tenders.length : 1, 1);
  });
  await t('7 cards ($1 each) for $6.50: ONE gift payment with 7 ids, completes, 6 cards emptied and 0.50 left on the 7th', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 6.5)]; await reg.recalc();
    const r = await reg.tender({ type: 40, amount: 6.5, giftCards: cards(srv, [1, 1, 1, 1, 1, 1, 1]) });
    assert.ok(r.ok && r.completed, JSON.stringify(r)); assert.strictEqual(gBegins(srv).length, 1); assert.strictEqual(gBegins(srv)[0].retailGiftCards.length, 7);
    assert.strictEqual(Object.values(srv.cards).filter(b => b === 0).length, 6); assert.strictEqual(srv.cards.gc6, 0.5);
  });
  await t('Not enough balance (cards $2 total, $3 asked): refused, nothing sent, nothing paid', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 3)]; await reg.recalc();
    const r = await reg.tender({ type: 40, amount: 3, giftCards: cards(srv, [1.5, 0.5]) });
    assert.strictEqual(r.ok, false); assert.match(r.message, /balance \$2\.00 is less than \$3\.00/); assert.strictEqual(srv.begins.length, 0); assert.strictEqual(reg.paidTotal(), 0);
  });
  await t('Second gift card payment on the same sale (the two-gift-card bug): refused BEFORE anything is sent, first gift kept', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); const cs = cards(srv, [2, 3]);
    const r1 = await reg.tender({ type: 40, amount: 2, giftCards: [cs[0]] }); assert.ok(r1.ok && !r1.completed, JSON.stringify(r1));
    const r2b = await reg.tender({ type: 40, amount: 3, giftCards: [cs[1]] });
    assert.strictEqual(r2b.ok, false); assert.ok(r2b.sameType); assert.match(r2b.message, /only one gift card payment per sale.*Nothing was taken/);
    assert.strictEqual(gBegins(srv).length, 1, 'no 2nd gift receive sent'); assert.strictEqual(reg.paidTotal(), 2); assert.strictEqual(reg.remaining(), 3);
    const r3 = await reg.tender({ type: 10, tendered: 3 }); assert.ok(r3.ok && r3.completed, JSON.stringify(r3));
  });
  await t('AIR POS keeps less than asked (asked $4, kept $1): screen shows the server $1 paid and $3 left, not re-sent', async () => {
    const { reg, srv, logs } = make(); reg.subs = [item('A', 4)]; await reg.recalc(); srv.keepLess = 1;
    const r = await reg.tender({ type: 40, amount: 4, giftCards: cards(srv, [2, 3]) });
    assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.ok(r.notKept); assert.strictEqual(r.kept, 1); assert.strictEqual(r.remaining, 3);
    assert.match(r.message, /did not keep this gift card payment of \$4\.00 \(it kept only \$1\.00\).*Paid so far: \$1\.00\. \$3\.00 is left/);
    assert.strictEqual(reg.paidTotal(), 1); assert.strictEqual(reg.pay.tenders.length, 1); assert.strictEqual(reg.pay.tenders[0].amount, 1);
    assert.strictEqual(srv.begins.length, 1); assert.strictEqual(srv.completes, 0, 'never tried to finish on a payment AIR POS did not keep');
    assert.ok(logs.some(l => /PAYMENT NOT KEPT/.test(l)));
  });
  // M1 (approved Nov 3): a payment AIR POS reported complete is NEVER dropped. After 5 order reads that still do not list it, it is kept as paid,
  // flagged (t.unconfirmed + log + journal), nothing is re-sent; Complete's own total check is the guard. (Partial keeps, below, still show the server amount.)
  await t('AIR POS answers OK but the order never lists the payment (cash): KEPT as paid and flagged, not dropped, nothing re-sent', async () => {
    const { reg, srv, logs } = make(); reg.keptRetryMs = 0; reg.subs = [item('A', 5)]; await reg.recalc(); srv.drop = 1;
    const r = await reg.tender({ type: 10, tendered: 2 });
    assert.ok(r.ok && !r.notKept, JSON.stringify(r)); assert.strictEqual(reg.paidTotal(), 2); assert.strictEqual(reg.remaining(), 3); assert.strictEqual(srv.begins.length, 1);
    assert.ok(reg.pay.tenders[0].unconfirmed); assert.ok(logs.some(l => /PAYMENT NOT CONFIRMED/.test(l)));
  });
  await t('Store credit never listed by the order: kept and flagged, the customer balance shown stays reduced', async () => {
    const { reg, srv } = make(); reg.keptRetryMs = 0; reg.subs = [item('A', 5)]; await reg.recalc(); reg.member = { id: 'm1', number: '555', availableBalance: 10, creditAmount: 0 }; srv.drop = 1;
    const r = await reg.tender({ type: 11, amount: 3 }); assert.ok(r.ok && !r.notKept, JSON.stringify(r)); assert.strictEqual(reg.paidTotal(), 3); assert.ok(reg.pay.tenders[0].unconfirmed);
  });
  await t('Lost reply on the gift payment, then Retry: AIR POS is asked first, the payment is adopted, never sent twice', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 4)]; await reg.recalc(); const cs = cards(srv, [2, 3]); srv.lose = 1; srv.getMode = 'unreachable';
    const r1 = await reg.tender({ type: 40, amount: 4, giftCards: cs }); assert.strictEqual(r1.ok, false); assert.ok(r1.retryable, JSON.stringify(r1));
    srv.getMode = null; const r2b = await reg.tender({ type: 40, amount: 4, giftCards: cs });
    assert.ok(r2b.ok && r2b.completed, JSON.stringify(r2b)); assert.strictEqual(gBegins(srv).length, 1, 'one gift receive only'); assert.strictEqual(srv.cards.gc0, 0); assert.strictEqual(srv.cards.gc1, 1);
  });
  await t('Restart after a gift payment (sale not finished): recovery shows only what AIR POS kept, and a 2nd gift payment is still refused', async () => {
    const A = make(); A.reg.subs = [item('A', 5)]; await A.reg.recalc(); const cs = cards(A.srv, [2, 3]);
    const r1 = await A.reg.tender({ type: 40, amount: 2, giftCards: [cs[0]] }); assert.ok(r1.ok);
    // old 1.0.10 journal shape: two gift tenders (the 2nd one AIR POS dropped)
    A.reg.pay.tenders.push({ id: 'ghost', type: 40, name: 'Gift card', amount: 3, status: 'done' }); A.reg.journalSnap('tendered');
    const B = make(A.dir, A.srv); B.reg.recoveryPending = true; await B.reg.recover();
    assert.ok(B.reg.pay, 'sale back on screen'); assert.strictEqual(B.reg.paidTotal(), 2, JSON.stringify(B.reg.pay.tenders)); assert.strictEqual(B.reg.remaining(), 3);
    const before = A.srv.begins.length; const r3 = await B.reg.tender({ type: 40, amount: 3, giftCards: [cs[1]] });
    assert.strictEqual(r3.ok, false); assert.ok(r3.sameType); assert.strictEqual(A.srv.begins.length, before);
    const r4 = await B.reg.tender({ type: 20, amount: 3 }); assert.ok(r4.ok && r4.completed, JSON.stringify(r4));
  });
  await t('Mixed: gift $2 (2 cards) + cash $3 -> completes; gift + card; gift + check; gift + store credit', async () => {
    { const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); const r = await reg.tender({ type: 40, amount: 2, giftCards: cards(srv, [1, 1]) }); assert.ok(r.ok && !r.completed);
      const c = await reg.tender({ type: 10, tendered: 10 }); assert.ok(c.ok && c.completed, JSON.stringify(c)); assert.strictEqual(c.change, 7); }
    { const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); await reg.tender({ type: 40, amount: 1, giftCards: cards(srv, [1]) });
      const c = await reg.tender({ type: 20, amount: 4 }); assert.ok(c.ok && c.completed, JSON.stringify(c)); }
    { const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); reg.member = { id: 'm1', number: '555', availableBalance: 10, creditAmount: 0 }; await reg.tender({ type: 40, amount: 1, giftCards: cards(srv, [1]) });
      const c = await reg.tender({ type: 50, amount: 4, checkNumber: '101' }); assert.ok(c.ok && c.completed, JSON.stringify(c)); }
    { const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); reg.member = { id: 'm1', number: '555', availableBalance: 10, creditAmount: 0 }; await reg.tender({ type: 40, amount: 1, giftCards: cards(srv, [1]) });
      const c = await reg.tender({ type: 11, amount: 4 }); assert.ok(c.ok && c.completed, JSON.stringify(c)); assert.strictEqual(reg.member ? reg.member.availableBalance : 6, 6); }
  });
  await t('Read-back unclear (no connection) after a kept payment: counted as AIR POS answered, sale goes on (no false "not kept")', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); srv.getMode = 'unreachable';
    const r = await reg.tender({ type: 40, amount: 2, giftCards: cards(srv, [2]) }); assert.ok(r.ok && !r.notKept, JSON.stringify(r)); assert.strictEqual(reg.paidTotal(), 2);
  });
  await t('Read-back refused (AIR POS HTTP 500 for a pending order with payments): asks ReceiveCheck for that payment instead', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 5)]; await reg.recalc(); srv.getMode = 'refused';
    const ok = await reg.tender({ type: 10, tendered: 2 }); assert.ok(ok.ok && !ok.notKept, JSON.stringify(ok));
    const { reg: rb, srv: sb } = make(); rb.keptRetryMs = 0; rb.subs = [item('A', 5)]; await rb.recalc(); sb.getMode = 'refused'; sb.drop = 1;
    const no = await rb.tender({ type: 10, tendered: 2 }); assert.ok(no.ok && !no.notKept, JSON.stringify(no)); assert.strictEqual(rb.paidTotal(), 2); assert.ok(rb.pay.tenders[0].unconfirmed); // M1: never dropped
  });
  console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

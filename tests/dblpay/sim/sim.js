// DEEP fake AIR POS: one shared HTTP service for all test registers (offline, 127.0.0.1 only).
// Built on a module copy of the app's own tests/fake-server.js (base-handlers.js, see gen-base.js), plus:
//  - real HTTP between app and fake (the app's own AirPos.call / fetch / timeouts run unchanged; app-run.js points HOSTS here)
//  - per-register fault injection: slow, hang (past the app's 30 s timeout), lost (handled then the socket is cut, reply never
//    arrives), down (cut before handling), http500, http502, done502 (handled, then a 502 page), garbage (non-JSON), fail (success:false), expire (errorCode 1003)
//  - strict Complete WITH order discounts and points (due recomputed from the saved order), only Completed receives count
//  - card terminal polling (approve after N checks / decline / never), keyed Stripe payment intents, card-on-file declines
//  - member balance / points / stock bookkeeping, sessions + drawer balance per register, X / Z reports, return receipts
//  - a money ledger of every order save / receive / cancel / complete / return, with which register sent it
'use strict';
process.env.FAKE_HELD = '1'; delete process.env.FAKE_STRICT_COMPLETE;
const http = require('http'), fs = require('fs');
const B = require('./base-handlers.js');
const { handlers: H0, fake, PRODUCTS, J, ok } = B;
const PORT = Number(process.env.SIM_PORT || 5186); if (!((PORT >= 5180 && PORT <= 5186) || (PORT >= 5280 && PORT <= 5286))) throw new Error('port');
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const S = global.__sim = { seq: 0, ledger: [], faults: [], regs: {}, rcv: {}, orders: fake.orders, returns: {}, z: [], members: {}, stock: {}, numbers: 0, reqs: 0, strictOD: true, stats: {}, cofDedupe: 'none', setiN: 0 };
// deep run: extra test products (edge prices + many distinct lines)
[['2000','Free sample',0,8],['2001','Penny candy',0.01,8],['2002','Penny no tax',0.01,0],['2003','Big TV',999999.99,8],['2004','Third',0.3333,8],['2005','Odd tax',1.15,7.375],['2006','High tax',19.99,25]].forEach(([n,name,price,taxRate]) => PRODUCTS.push({ number: n, upc: '', name, price, taxRate, stock: 1000000 }));
for (let i = 0; i < 150; i++) PRODUCTS.push({ number: String(3000 + i), upc: '', name: 'Line item ' + i, price: Math.round((0.37 + i * 1.13) * 100) / 100, taxRate: i % 3 ? 8 : 0, stock: 1000 });
PRODUCTS.forEach(p => { S.stock[p.number] = p.stock; });
const reg = r => (S.regs[r] = S.regs[r] || { session: 10, token: null, expired: false, drawer: 0, term: { mode: 'instant', polls: 2, outcome: 'approve' }, keyed: { pi: false, airposNever: false }, cof: 'ok', lastZ: 0, clockOuts: 0, clockIns: 0, cashTx: [] });
// member money (made-up test customers): m-sample balance 42.5 credit 100 points 120 rate 1
const MEM = { 'm-sample': { balance: 42.5, credit: 100, points: 120, rate: 1, allowCredit: true }, 'm-acct': { balance: 0, credit: 50, points: 0, rate: 1, allowCredit: true }, 'm-zero': { balance: 0, credit: 0, points: 0, rate: 1, allowCredit: false }, 'm-test': { balance: 0, credit: 0, points: 0, rate: 1, allowCredit: false } };
const memOf = id => MEM[id] || null;
const L = (r, path, x) => { const e = { seq: ++S.seq, t: Date.now(), reg: r, path, ...x }; S.ledger.push(e); if (S.ledger.length > 200000) S.ledger.splice(0, 50000); return e; };
const H = Object.assign({}, H0);
const prodOf = sub => PRODUCTS.find(q => 'p' + q.number === sub.productId) || null;
// strict server total (AIR POS-like, documented): items - order discount + tax x (1 - order discount %) - points
function dueOf(o) {
  let item = 0, tax = 0;
  for (const x of o.subs || []) { const a = x.price * x.quantity * (x.rate || 1) - (x.discountAmount || 0); item += a; tax += a * (x.taxRate || 0) / 100; }
  let od = 0, odPct = 0;
  if (S.strictOD) {
    if (o.orderDiscountMethod === 20) { od = Math.min(Number(o.orderDiscountAmount) || 0, item); odPct = item > 0 ? od / item * 100 : 0; }
    else { odPct = Number(o.orderDiscount) || 0; od = odPct / 100 * item; }
  }
  const m = o.retailMemberId && memOf(o.retailMemberId); const pts = m && o.points > 0 ? r2(o.points * m.rate / 100) : 0;
  return { item: r2(item), od: r2(od), tax: r2(r2(tax) * (1 - odPct / 100)), pts, due: r2(r2(item - od) + r2(r2(tax) * (1 - odPct / 100)) - pts) };
}
const subsSum = s => (s || []).map(x => ({ p: x.productId, n: (prodOf(x) || {}).number || x.number || null, type: x.type || 0, q: x.quantity, price: x.price, d: x.discountAmount || 0, tr: x.taxRate }));
H['/Identities/Login'] = (p, r) => { const x = H0['/Identities/Login'](p); if (x.success) { const g = reg(r); g.token = 'tok-' + r + '-' + (++S.seq); g.expired = false; x.value.ide = g.token; x.value.stationId = 'st-' + r; x.value.stationName = 'Register ' + r; } return x; };
H['/RetailSessions/SessionCheck'] = (p, r) => ({ type: reg(r).session });
H['/RetailSessions/ClockIn'] = (p, r) => { const g = reg(r), s = J(p, 'submit'); if (g.session === 10) return { success: false, message: 'You are already clocked in' }; g.session = 10; g.clockIns++; g.drawer = r2(Number(s.initialAmount) || 0); L(r, 'ClockIn', { success: true, amount: s.initialAmount }); return ok({}); };
H['/RetailSessions/ClockOut'] = (p, r) => { const g = reg(r), s = J(p, 'submit'); if (g.session !== 10) return { success: false, message: 'You are not clocked in' }; g.session = 0; g.clockOuts++; L(r, 'ClockOut', { success: true, amount: s.finalAmount, expected: g.drawer }); return { success: true, message: 'Clocked out', value: {} }; };
H['/RetailCashTransactions/LastestBalanceGet'] = (p, r) => ok(r2(reg(r).drawer));
H['/RetailCashTransactions/RetailCashTransactionGet'] = (p, r) => { const id = p.get ? p.get('id') : p.id; return reg(r).cashTx.includes(id) ? { id, type: 20 } : null; }; // real AIR POS: the record, or raw null
H['/RetailCashTransactions/RetailCashTransactionAccess'] = (p, r) => { const g = reg(r), s = J(p, 'submit'); if (g.cashTx.includes(s.id)) return { success: false, message: 'Duplicate cash transaction' }; g.cashTx.push(s.id); g.drawer = r2(g.drawer + (s.type === 30 ? -1 : 1) * s.amount); L(r, 'CashTx', { success: true, type: s.type, amount: s.amount, id: s.id }); return ok({}); };
H['/Orders/RetailOrderSave'] = (p, r) => { const s = J(p, 'submit'); const old = fake.orders[s.id];
  if (old && old.done) { L(r, 'OrderSave', { orderId: s.id, success: false, why: 'completed' }); return { success: false, message: 'The order has been completed and cannot be saved.' }; }
  if (old && old.reg && old.reg !== r && old.isPending && !old.resumed) { /* another register saving a held order */ }
  s.number = old && old.number ? old.number : 'T' + (5000 + (++S.numbers)); s.reg = old && old.reg ? old.reg : r; s.lastReg = r; s.savedAt = Date.now(); if (old) { s.resumed = old.resumed; s.resumedBy = old.resumedBy; }
  fake.orders[s.id] = s;
  L(r, 'OrderSave', { orderId: s.id, success: true, isPending: s.isPending, subs: subsSum(s.subs), od: { m: s.orderDiscountMethod, pct: s.orderDiscount, amt: s.orderDiscountAmount }, points: s.points, member: s.retailMemberId, srv: dueOf(s) });
  return ok({}); };
const rcvList = id => (S.rcv[id] = S.rcv[id] || []);
H['/Orders/RetailOrderReceiveBegin'] = (p, r) => { const x = J(p, 'submit'), g = reg(r); const o = fake.orders[x.retailOrderId];
  const base = { orderId: x.retailOrderId, rid: x.id, type: x.paymentType, amount: x.amount, receiveAmount: x.receiveAmount, giveAmount: x.giveAmount, savedCard: x.retailMemberCardId || null, giftCards: (x.retailGiftCards || []).length };
  if (!o) { L(r, 'ReceiveBegin', { ...base, success: false, why: 'no order' }); return { success: false, message: 'Order not found' }; }
  if (o.done) { L(r, 'ReceiveBegin', { ...base, success: false, why: 'order completed' }); return { success: false, message: 'The order has been completed.' }; }
  const list = rcvList(x.retailOrderId);
  const same = list.find(q => q.id === x.id && q.status !== -10);
  if (same) { L(r, 'ReceiveBegin', { ...base, success: true, dupId: true }); return ok(same.status === 20 ? { isCompleted: true } : { isCompleted: false }); } // same receive id again: no second charge (idempotent)
  if (!(x.amount >= 0)) { L(r, 'ReceiveBegin', { ...base, success: false, why: 'negative' }); return { success: false, message: 'Amount must not be negative' }; }
  if (x.paymentType === 11) { const m = memOf(x.retailMemberId); if (m) { const max = r2(m.balance + (m.allowCredit ? m.credit : 0)); if (x.amount > max + 0.004) { L(r, 'ReceiveBegin', { ...base, success: false, why: 'over balance' }); return { success: false, message: 'Insufficient balance' }; } m.balance = r2(m.balance - x.amount); } }
  if (x.paymentType === 40) { for (const id of x.retailGiftCards || []) { const c = Object.values(fake.cards).find(k => k.id === id); if (c && c.balance + 0.004 < x.amount / (x.retailGiftCards.length || 1)) { L(r, 'ReceiveBegin', { ...base, success: false, why: 'gift balance' }); return { success: false, message: 'Gift card balance is not enough' }; } } }
  let status = 20, value = { isCompleted: true };
  if (x.paymentType === 30) {
    if (x.retailMemberCardId) { const out = g.cof; const msg = { decline: 'Your card was declined.', insufficient: 'Your card has insufficient funds.', expired: 'Your card has expired.', network: 'Stripe: An error occurred with our connection to Stripe.' }[out];
      if (msg) { L(r, 'ReceiveBegin', { ...base, success: false, why: 'cof ' + out }); return { success: false, message: msg }; }
      if (out === '3ds') { status = 10; value = { isCompleted: false, paymentIntent: { id: 'pi_sim_' + x.id.slice(0, 8), status: 'requires_action', client_secret: 'pi_sim_' + x.id.slice(0, 8) + '_secret_TESTONLY' } }; } }
    else if (g.keyed.pi) { status = 10; value = { isCompleted: false, paymentIntent: { id: 'pi_sim_' + x.id.slice(0, 8), status: 'requires_payment_method', client_secret: 'pi_sim_' + x.id.slice(0, 8) + '_secret_TESTONLY' } }; }
  }
  if (x.paymentType === 20 && g.term.mode !== 'instant') { status = 10; value = { isCompleted: false }; }
  if (x.paymentType === 10) list.forEach(q => { if (q.paymentType === 10 && q.status === 20) { q.status = -10; q.replacedBy = x.id; } }); // AIR POS keeps ONE cash receive per order
  const rc = { id: x.id, paymentType: x.paymentType, amount: x.amount, receiveAmount: x.receiveAmount, giveAmount: x.giveAmount, status, checks: 0, reg: r, retailGiftCards: x.retailGiftCards || [] };
  list.push(rc);
  if (x.paymentType === 40) H0['/Orders/RetailOrderReceiveBegin'](p); // base: gift card balance goes down (+ base bookkeeping)
  L(r, 'ReceiveBegin', { ...base, success: true, status });
  return ok(value); };
H['/Orders/RetailOrderReceiveCheck'] = (p, r) => { const x = J(p, 'submit'), g = reg(r); const rc = rcvList(x.retailOrderId).find(q => q.id === x.id);
  if (!rc) return { success: false, message: 'Combined payment infomation not found', action: 2000, errorCode: 1001 }; // the real AIR POS reply (TestShop probe Oct 31 2026)
  rc.checks++;
  if (rc.status === 20) return ok({ isCompleted: true });
  if (rc.status === -10) return ok({ isCompleted: false, shouldReissue: true, message: 'Payment was cancelled' });
  if (rc.paymentType === 30) { if (g.keyed.airposNever) return ok({ isCompleted: false, message: 'Waiting for the payment' }); rc.status = 20; L(r, 'ReceiveDone', { orderId: x.retailOrderId, rid: x.id, type: 30, amount: rc.amount }); return ok({ isCompleted: true }); }
  const t = g.term; if (rc.checks < t.polls) return ok({ isCompleted: false, message: 'Waiting for the customer…', subMessage: 'Tap, insert or swipe' });
  if (t.outcome === 'approve') { rc.status = 20; L(r, 'ReceiveDone', { orderId: x.retailOrderId, rid: x.id, type: rc.paymentType, amount: rc.amount }); return ok({ isCompleted: true }); }
  if (t.outcome === 'decline') { rc.status = -10; rc.declined = true; L(r, 'ReceiveDeclined', { orderId: x.retailOrderId, rid: x.id, amount: rc.amount }); return ok({ isCompleted: false, shouldReissue: true, message: 'Card declined', subMessage: 'Insufficient funds' }); }
  return ok({ isCompleted: false, message: 'Waiting for the customer…' }); };
H['/Orders/RetailOrderReceiveCancel'] = (p, r) => { const x = J(p, 'submit'); const rc = rcvList(x.retailOrderId).find(q => q.id === x.id);
  if (!rc) { L(r, 'ReceiveCancel', { orderId: x.retailOrderId, rid: x.id, success: true, none: true }); return ok({}); }
  if (rc.status === 20 && rc.paymentType !== 30) { L(r, 'ReceiveCancel', { orderId: x.retailOrderId, rid: x.id, success: false, why: 'completed' }); return { success: false, message: 'The payment is completed and cannot be cancelled' }; }
  rc.status = -10; L(r, 'ReceiveCancel', { orderId: x.retailOrderId, rid: x.id, success: true, amount: rc.amount }); return ok({}); };
H['/Orders/RetailOrderComplete'] = (p, r) => { const c = J(p, 'command'); const o = fake.orders[c.id];
  if (!o) { L(r, 'OrderComplete', { orderId: c.id, success: false, why: 'no order' }); return { success: false, message: 'Order not found' }; }
  if (o.done) { L(r, 'OrderComplete', { orderId: c.id, success: false, why: 'already completed' }); return { success: false, message: 'The order has been completed.' }; }
  if (S.refuseN > 0) { S.refuseN--; L(r, 'OrderComplete', { orderId: c.id, success: false, why: 'refused (hook)' }); return { success: false, message: 'The order cannot be completed.' }; }
  const d = dueOf(o), got = r2(rcvList(c.id).filter(q => q.status === 20).reduce((a, q) => a + q.amount, 0)), open = rcvList(c.id).filter(q => q.status === 10).length;
  if (got + 0.004 < d.due) { L(r, 'OrderComplete', { orderId: c.id, success: false, why: 'short', due: d.due, got }); return { success: false, message: 'The received amount is less than the amount due, the order cannot be completed.' }; }
  if (!(o.subs || []).length) { /* AIR POS behaviour for an empty order is unknown: accepted, flagged by the oracle */ }
  for (const x of o.subs || []) { const pr = prodOf(x); if (pr) S.stock[pr.number] = r2((S.stock[pr.number] || 0) - x.quantity * (x.rate || 1)); }
  const m = o.retailMemberId && memOf(o.retailMemberId); if (m && c.points > 0) m.points = r2(m.points - c.points);
  const cash = rcvList(c.id).filter(q => q.status === 20 && q.paymentType === 10).reduce((a, q) => a + q.amount, 0); reg(r).drawer = r2(reg(r).drawer + cash);
  H0['/Orders/RetailOrderComplete'](p); o.done = true; o.doneAt = Date.now(); o.doneReg = r; o.srv = d; o.got = got;
  L(r, 'OrderComplete', { orderId: c.id, success: true, due: d.due, got, open, subs: subsSum(o.subs), number: o.number, points: c.points, member: o.retailMemberId });
  return ok({}); };
H['/Orders/RetailOrderGet'] = (p, r) => { if (B.RET_ORDERS[p.orderId]) return H0['/Orders/RetailOrderGet'](p); const o = fake.orders[p.orderId]; if (!o) return ok(null);
  // 1.0.9-local.7: real AIR POS (TestShop, Oct 31 2026) answers RetailOrderGet for a Pending order that already has payments with HTTP 500
  // {success:false, errorCode:1000, "Object reference not set..."}. /pending-get?reg=R&mode=nullref makes this register's sim do the same.
  if (reg(r).pendingGet === 'nullref' && !o.done && rcvList(p.orderId).length) return { __http: 500, success: false, message: 'Object reference not set to an instance of an object.', action: 2000, errorCode: 1000 };
  if (o.isPending && !o.done && !o.resumed) { const x = H0['/Orders/RetailOrderGet'](p); o.resumedBy = r; if (x && x.value) x.value.receives = rcvList(p.orderId).map(q => ({ ...q })); return x; }
  return ok({ id: o.id, number: o.number, status: o.done ? 20 : 15, amount: o.srv ? o.srv.item : 0, receives: rcvList(p.orderId).map(q => ({ id: q.id, paymentType: q.paymentType, amount: q.amount, status: q.status })) }); };
// 1.0.9-local.2 (e): /shop?on=1 makes the shop keep points per shop (pointSetting.pointByShop, as Business Test does):
// members then carry shop* figures that differ from balance/point (made-up numbers; MemberInfoGet unchanged)
const SHOPM = { shopBalance: 2, shopPoint: 9, shopAllowCreditPayment: true, shopCreditAmount: 25, balance: 0, point: 5, allowCreditPayment: false, creditAmount: 0 };
const shopCfg = x => (S.shop ? { ...x, pointSetting: { pointExpiredDays: 0, pointByShop: true } } : x);
const shopMem = m => (S.shop && m && m.id === 'm-edit1' ? Object.assign(m, SHOPM) : m);
{ const home = H['/Home/Index'], cfg = H['/Commons/RetailConfigGet'], get = H['/RetailMembers/RetailMemberGet'], paged = H['/RetailMembers/RetailMemberPaged'], num = H['/RetailMembers/RetailMemberGetByNumber'];
  H['/Home/Index'] = (p, r) => { const x = home(p, r); return x && x.retailConfig ? { ...x, retailConfig: shopCfg(x.retailConfig) } : x; };
  H['/Commons/RetailConfigGet'] = (p, r) => { const x = cfg(p, r); return x && x.value ? { ...x, value: shopCfg(x.value) } : x; };
  H['/RetailMembers/RetailMemberGet'] = (p, r) => { const x = get(p, r); if (x && x.value) shopMem(x.value); return x; };
  H['/RetailMembers/RetailMemberGetByNumber'] = (p, r) => { const x = num(p, r); if (x && x.value) shopMem(x.value); return x; };
  H['/RetailMembers/RetailMemberPaged'] = (p, r) => { const x = paged(p, r); (x.rows || []).forEach(shopMem); return x; }; }
H['/RetailMembers/MemberInfoGet'] = (p, r) => { const x = H0['/RetailMembers/MemberInfoGet'](p); const v = x && x.value; if (v && v.member && MEM[v.member.id]) { const m = MEM[v.member.id]; v.points = m.points; v.availableBalance = m.balance; v.creditAmount = m.credit; v.allowCreditPayment = !!m.allowCredit; } return x; };
// returns: stored per id (duplicates refused), cash refunds leave the drawer
const retCreate = kind => (p, r) => { const s = J(p, 'submit'); if (S.returns[s.id]) { L(r, 'ReturnCreate', { retId: s.id, success: false, why: 'duplicate id' }); return { success: false, message: 'The return order already exists.' }; }
  S.returns[s.id] = { kind, ...s, reg: r, at: Date.now() }; const cash = (s.payments || []).filter(q => q.paymentType === 10).reduce((a, q) => a + q.amount, 0); reg(r).drawer = r2(reg(r).drawer - cash);
  (fake.returns = fake.returns || []).push({ kind, ...s });
  L(r, 'ReturnCreate', { retId: s.id, kind, success: true, orderId: s.retailOrderId || null, pays: (s.payments || []).map(q => ({ t: q.paymentType, a: q.amount })), subs: (s.subs || []).map(q => ({ p: q.productId, q: q.quantity, price: q.price })) }); return ok({}); };
// 1.0.9-local.7 save card (copied from the Stress Tester's simx.js): each AddBegin gives a new SetupIntent (seti_simN); AddComplete
// stores the card (Visa 4242 12/30). /cof-mode?dedupe=none|card|seti decides whether AIR POS refuses a second copy (real behaviour unknown).
H['/RetailMembers/RetailMemberCardAddBegin'] = (p, r) => { const x = H0['/RetailMembers/RetailMemberCardAddBegin'](p); if (x && x.value && x.value.setupIntent) { const id = 'seti_sim' + (++S.setiN); x.value.setupIntent = { id, client_secret: id + '_secret_TESTONLY' }; } return x; };
H['/RetailMembers/RetailMmeberCardAddComplete'] = (p, r) => { const x = J(p, 'submit'); if (!/^seti_[A-Za-z0-9_]+$/.test(String(x.setupIntentId || ''))) return { success: false, message: 'bad setup (sim)' };
  if (x.cardNo || x.expiration || x.cvv) return { success: false, message: 'card fields must be blank (sim)' };
  const l = fake.cof.cards[x.retailMemberId] = fake.cof.cards[x.retailMemberId] || [];
  if (S.cofDedupe === 'card' && l.some(c => c.fp === 'fp4242')) { L(r, 'CardSave', { member: x.retailMemberId, success: true, dedupe: true }); return ok({}); }
  if (S.cofDedupe === 'seti' && l.some(c => c.seti === x.setupIntentId)) { L(r, 'CardSave', { member: x.retailMemberId, success: true, dedupe: 'seti' }); return ok({}); }
  l.push({ id: 'mc-sim' + (++fake.cof.seq), cardType: 'Visa', lastFourDigits: '4242', validityPeriod: '12/30', usableForCurrentChannel: true, fp: 'fp4242', seti: x.setupIntentId });
  L(r, 'CardSave', { member: x.retailMemberId, success: true, n: l.length }); return ok({}); };
H['/ReturnOrders/RetailReturnOrderGet'] = p => { const x = S.returns[p.id]; return x ? { id: x.id, retailOrderId: x.retailOrderId || null, status: 10 } : null; }; // dblpay: like real AIR POS (TestShop read-only probe Oct 30): the object, or plain null
H['/ReturnOrders/RetailReturnOrderCreate'] = retCreate('receipt'); H['/ReturnOrders/NonOrderReturnOrderCreate'] = retCreate('nonorder');
// reports
const sinceZ = r => Object.values(fake.orders).filter(o => o.done && o.doneReg === r && o.doneAt > reg(r).lastZ);
H['/RetailReports/xReadReportGet'] = (p, r) => { const os = sinceZ(r); return ok({ orderCount: os.length, grossAmount: r2(os.reduce((a, o) => a + (o.got || 0), 0)), cashBalance: reg(r).drawer, reportTime: new Date().toISOString() }); };
H['/RetailReports/XReadPrintRecordPaged'] = () => ({ success: true, rows: [], total: 0 });
H['/RetailReports/GenerateStationZRead'] = (p, r) => { const os = sinceZ(r); const z = { id: 'z-' + r + '-' + (S.z.length + 1), number: 'Z' + (100 + S.z.length + 1), reg: r, orderCount: os.length, grossAmount: r2(os.reduce((a, o) => a + (o.got || 0), 0)), reportDate: new Date().toISOString(), reportTime: new Date().toISOString() };
  S.z.push(z); reg(r).lastZ = Date.now(); L(r, 'ZGenerate', { success: true, z: z.number, orders: z.orderCount, gross: z.grossAmount }); return { success: true, message: 'Z report generated', value: {} }; };
H['/RetailReports/StationZReadReportPaged'] = (p, r) => { const rows = S.z.filter(z => z.reg === r).slice().reverse(); return { success: true, rows, total: rows.length }; };
const PDF = Buffer.from('%PDF-1.4\n% sim report\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const GETS = { '/RetailReports/XReadReportExport': () => PDF, '/RetailReports/StationZReadReportExport': () => PDF, '/ReturnOrders/RetailReturnOrderBillGet': q => (S.returns[q.get('returnOrderId')] ? PDF : null), '/Orders/RetailOrderBillGet': () => PDF };
// order list for History (with real numbers / amounts)
H['/Orders/RetailOrderPaged'] = (p, r) => { const f = J(p, 'filter'); if (f.status === 15) return H0['/Orders/RetailOrderPaged'](p); const pi = J(p, 'pageInfo');
  const all = Object.values(fake.orders).filter(o => o.done).sort((a, b) => b.doneAt - a.doneAt).map(o => ({ id: o.id, number: o.number, status: 20, statusName: 'Completed', paymentTypeName: 'Cash', quantity: (o.subs || []).length, amount: o.srv ? o.srv.item : 0, tax: o.srv ? o.srv.tax : 0, createTime: new Date(o.doneAt).toISOString() }));
  const sz = pi.pageSize || 20, pg = pi.page || 1; return { success: true, rows: all.slice((pg - 1) * sz, pg * sz), total: all.length }; };
// ---------------- HTTP ----------------
const parseBody = async (q, buf) => { const ct = q.headers['content-type'] || ''; if (!buf.length) return {};
  if (/multipart\/form-data/.test(ct)) { const fd = await new Request('http://x/', { method: 'POST', headers: { 'content-type': ct }, body: buf }).formData(); const o = {}; for (const [k, v] of fd.entries()) o[k] = typeof v === 'string' ? v : ''; return o; }
  try { return JSON.parse(buf.toString()); } catch { return {}; } };
const NOAUTH = new Set(['/Identities/Login', '/Hardwares/GetDeviceInfo', '/Hardwares/GetPrinters', '/Hardwares/OpenCashbox', '/Hardwares/PrintBillContent']);
async function api(q, s, r, host, path) {
  const buf = await new Promise(res => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => res(Buffer.concat(c))); q.on('error', () => res(Buffer.alloc(0))); });
  const g = reg(r); S.reqs++; const st = S.stats[path] = S.stats[path] || { n: 0, faults: 0 }; st.n++;
  const f = S.faults.find(x => (x.reg === '*' || x.reg === r) && x.n > 0 && path.includes(x.path) && (!x.after || (x.seen = (x.seen || 0) + 1) > x.after)); if (f) { f.n--; f.used = (f.used || 0) + 1; st.faults++; }
  if (f && f.mode === 'down') return s.socket.destroy();
  if (f && f.mode === 'hang') { await sleep(f.ms || 35000); return s.socket.destroy(); }
  if (f && f.mode === 'slow') await sleep(f.ms || 3000);
  if (f && f.mode === 'http500') { s.writeHead(500, { 'content-type': 'text/html' }); return s.end('<html>500 Internal Server Error</html>'); }
  if (f && f.mode === 'http502') { s.writeHead(502, { 'content-type': 'text/html' }); return s.end('<html>502 Bad Gateway</html>'); }
  if (f && f.mode === 'garbage') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end('<html>gateway</html>'); }
  if (f && f.mode === 'fail') return send(s, { success: false, message: 'Server is busy, please try again (sim)' });
  if (f && f.mode === 'expire') g.expired = true;
  if (host === 'retail' && !NOAUTH.has(path) && (g.expired || (g.token && q.headers.ide !== g.token))) return send(s, { success: false, errorCode: 1003, message: 'Login has expired, please log in again' });
  if (q.method === 'GET') { const u = new URL(q.url, 'http://x'); const gfn = GETS[path]; const out = gfn ? gfn(u.searchParams) : null; if (out) { s.writeHead(200, { 'content-type': 'application/pdf' }); return s.end(out); } return send(s, { success: false, message: 'Not found' }); }
  const params = await parseBody(q, buf);
  if (/^\/RetailSessions\/Clock(In|Out)$/.test(path)) (fake.clock = fake.clock || []).push({ path, submit: J(params || {}, 'submit') });
  const h = H[path]; let out;
  try { out = h ? await h(params, r) : { success: true, value: null, rows: [], total: 0 }; } catch (e) { out = { success: false, message: 'sim error ' + e.message }; L(r, 'SIM_ERROR', { path, err: String(e.stack).slice(0, 300) }); }
  if (f && f.mode === 'lost') { L(r, 'LOST_REPLY', { path }); return s.socket.destroy(); }
  if (f && f.mode === 'done500') { L(r, 'LOST_REPLY', { path, as: 500 }); s.writeHead(500, { 'content-type': 'text/html' }); return s.end('<html>502 Bad Gateway</html>'); }
  if (f && f.mode === 'done502') { L(r, 'LOST_REPLY', { path, as: 502 }); s.writeHead(502, { 'content-type': 'text/html' }); return s.end('<html>502 Bad Gateway</html>'); }
  if (f && f.mode === 'donegarbage') { L(r, 'LOST_REPLY', { path, as: 'garbage' }); s.writeHead(200, { 'content-type': 'text/html' }); return s.end('<html>proxy</html>'); }
  if (f && f.mode === 'lost-slow') { await sleep(f.ms || 35000); L(r, 'LOST_REPLY', { path }); return s.socket.destroy(); }
  return send(s, out);
}
const send = (s, o) => { const st = o && o.__http ? o.__http : 200; if (o && o.__http) { o = { ...o }; delete o.__http; } s.writeHead(st, { 'content-type': 'application/json' }); s.end(JSON.stringify(o === undefined ? null : o)); };
const hooks = {
  '/fault': u => { const x = { reg: u.get('reg') || '*', path: u.get('path') || '', mode: u.get('mode') || 'down', n: Number(u.get('n') || 1), ms: Number(u.get('ms') || 0), after: Number(u.get('after') || 0) }; S.faults.push(x); return x; },
  '/faults-clear': u => { const r = u.get('reg'); S.faults = r ? S.faults.filter(f => f.reg !== r) : []; return { ok: true }; },
  '/faults': () => S.faults,
  '/pending-get': u => { const g = reg(u.get('reg')); g.pendingGet = u.get('mode') || 'ok'; return { pendingGet: g.pendingGet }; },
  '/term': u => { const g = reg(u.get('reg')); g.term = { mode: u.get('mode') || 'instant', polls: Number(u.get('polls') || 2), outcome: u.get('outcome') || 'approve' }; return g.term; },
  '/keyed': u => { const g = reg(u.get('reg')); fake.keyed = u.get('mode') || 'stripe'; g.keyed = { pi: u.get('pi') === '1', airposNever: u.get('never') === '1' }; return g.keyed; },
  '/cof': u => { const n = Number(u.get('n') || 0); fake.cof.cards = { 'm-sample': B.COF_CARDS.slice(0, n).map(c => ({ ...c })) }; reg(u.get('reg')).cof = u.get('out') || 'ok'; return { ok: true }; },
  '/session': u => { const g = reg(u.get('reg')); if (u.get('type') != null) g.session = Number(u.get('type')); if (u.get('expire') === '1') g.expired = true; return g; },
  '/ledger': u => { const since = Number(u.get('since') || 0), r = u.get('reg'); const oid = u.get('orderId'); return S.ledger.filter(e => e.seq > since && (!r || e.reg === r) && (!oid || e.orderId === oid)); },
  '/seq': () => ({ seq: S.seq }),
  '/order': u => { const o = fake.orders[u.get('id')]; return o ? { ...o, rcv: rcvList(o.id), srvDue: dueOf(o) } : null; },
  '/orders-summary': () => { const os = Object.values(fake.orders); return { total: os.length, done: os.filter(o => o.done).length, pending: os.filter(o => !o.done).length }; },
  '/members': () => MEM, '/member-set': u => { const m = MEM[u.get('id')] = MEM[u.get('id')] || { balance: 0, credit: 0, points: 0, rate: 1, allowCredit: false }; if (m) { for (const k of ['balance', 'credit', 'points']) if (u.get(k) != null) m[k] = Number(u.get(k)); } return m; },
  '/cof-mode': u => { S.cofDedupe = u.get('dedupe') || 'none'; return { cofDedupe: S.cofDedupe }; },
  '/cof-cards': u => (fake.cof.cards[u.get('member') || 'm-sample'] || []).map(c => ({ id: c.id, last4: c.lastFourDigits, seti: c.seti || null })),
  '/cof-reset': u => { fake.cof.cards[u.get('member') || 'm-sample'] = []; return { ok: true }; },
  '/shop': u => { S.shop = u.get('on') === '1'; return { shop: S.shop }; },
  '/stock': () => S.stock, '/z': () => S.z, '/regs': () => S.regs, '/returns': () => Object.values(S.returns).map(x => ({ id: x.id, kind: x.kind, reg: x.reg, pays: x.payments })),
  '/refuse': u => { S.refuseN = Number(u.get('n') || 1); return { ok: true }; },
  '/strict-od': u => { S.strictOD = u.get('on') !== '0'; return { strictOD: S.strictOD }; },
  '/gift-set': u => { const no = u.get('no'); const c = fake.cards[no] = fake.cards[no] || { id: no === '7000000000008888' ? 'gc-pay8' : 'gc-' + no, cardNo: no, isSold: true, balance: 0 }; if (c) c.balance = Number(u.get('balance')); return c || null; },
  '/gift': u => { const c = fake.cards[u.get('no')]; return c || null; },
  '/stats': () => ({ reqs: S.reqs, ledger: S.ledger.length, orders: Object.keys(fake.orders).length, rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed, paths: S.stats }),
  '/health': () => ({ ok: true }),
};
http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x'); const m = u.pathname.match(/^\/(R\d+)\/(retail|base|local)(\/.*)$/);
  if (m) return api(q, s, m[1], m[2], m[3]).catch(e => { try { send(s, { success: false, message: 'sim ' + e.message }); } catch {} });
  const hk = hooks[u.pathname.replace(/^\/__/, '')]; if (hk && u.pathname.startsWith('/__/')) return send(s, hk(u.searchParams));
  s.writeHead(404); s.end('no');
}).listen(PORT, '127.0.0.1', () => console.log('SIM on ' + PORT));
process.on('uncaughtException', e => console.log('SIM UNCAUGHT ' + e.stack));

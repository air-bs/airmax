// Fake AIR POS gift cards for Batch 8 tests (made-up cards only). It behaves like TestShop did on 2026-11-03:
//  - Complete is NOT idempotent (a second Complete adds the money again), and it does not check that money was taken for cash
//  - ReceiveCheck says completed for a cash order that never began a receive
//  - Cancel answers HTTP 404; Delete works but Get still shows the order, the list does not
//  - Update zeroes the face value (updateBug, on by default)
//  - Save needs amount >= 1; the same order id saved twice is one order; an unknown card id is accepted
// State: fake.gc (counters, cards, orders, xread). Hooks (hook port): /gc-state /gc-reset /gc-conf?k=v /gc-approve?id=  (faults: the existing /fault?path=...&mode=lost|down|http500|http500-done&n=)
// Test seams (fake only): fake.gc.afterComplete / beforeComplete let a test act at the moment of the call.
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  if (!process.env.B8_FAKE) return; // Batch 8 fakes replace base fake handlers (gift cards, members, sessions, Z-reads): only on the servers that ask for them (B8_FAKE=1), so no other test changes
  const path = require('path');
  const { AirPos } = require(path.join(__dirname, '..', '..', 'app', 'lib', 'airpos.js'));
  if (!AirPos.prototype.__qfix) { AirPos.prototype.__qfix = true; const orig = AirPos.prototype.call; // real AIR POS takes ?id= in the address; the fake keys handlers by the plain path
    AirPos.prototype.call = function (host, p, params, o) { const i = String(p).indexOf('?'); if (i < 0) return orig.call(this, host, p, params, o); const q = {}; new URLSearchParams(p.slice(i + 1)).forEach((v, k) => { q[k] = v; }); return orig.call(this, host, p.slice(0, i), { ...(params || {}), ...q }, o); }; }
  if (!handlers['/Identities/verify']) handlers['/Identities/verify'] = p => { const s = J(p, 'submit'); return s.userName === 'boss' && s.password === 'boss-pw' ? ok('mgr-1') : { success: false, message: 'Wrong user name or password' }; }; // manager approval for the browser test (same as FAKE_CASHIER mode)
  const R = '/RetailGiftCardRechargeOrders/RetailGiftCardRechargeOrder', C = '/RetailGiftCards/RetailGiftCard';
  const r2 = x => Math.round(x * 100) / 100;
  const seed = () => {
    const mk = (n, cardNo, o) => ({ id: 'gcard-' + n, corpId: 'c', cardNo, password: 'SECRET-PW-' + n, faceValue: 20, consumedAmount: 0, balance: 20, issueDate: '2026-01-01T00:00:00.000+08:00', expireDate: null, expired: false, retailMemberId: null, retailMemberNumber: '', retailMemberPhone: '', retailMemberName: '', isSold: true, retailOrderId: 'o', retailOrderNumber: 'RO1', ...o });
    const cards = [mk(1, 'FAKEGC-0001', {}), mk(2, 'FAKEGC-0002', { expired: true, expireDate: '2025-01-01T00:00:00.000+08:00', balance: 5, faceValue: 5 }), mk(3, 'FAKEGC-0003', { isSold: false, faceValue: 10, balance: 10 }), mk(4, 'FAKEGC-0004', { balance: 5, faceValue: 5, retailMemberName: 'Made Up' }), mk(5, 'FAKEGC-0005', {}), mk(6, 'FAKEGC-0006', {})];
    return { cards: Object.fromEntries(cards.map(c => [c.id, c])), orders: {}, seq: 0, counters: { save: 0, begin: 0, check: 0, complete: 0, cancelPay: 0, cancel: 0, del: 0, update: 0, cardGet: 0 }, completeCalls: {}, approved: {}, begun: {}, xread: { giftTopUps: 0, cashInDrawer: 0 }, tx: [], conf: { updateBug: true, autoPay: false } };
  };
  fake.gc = seed();
  const G = () => fake.gc;
  const cp = o => (o == null ? o : JSON.parse(JSON.stringify(o))); // the app runs in this same process: hand out copies, like a real network reply
  const byNo = no => Object.values(G().cards).find(c => c.cardNo === no) || null;
  const ordRow = o => { const { _pay, _deleted, ...r } = o; return r; };

  handlers[C + 'Paged'] = p => { const f = J(p, 'filter'), pg = J(p, 'pageInfo'); const rows = Object.values(G().cards).filter(c => !f.cardNo || c.cardNo.includes(f.cardNo)); const size = pg.pageSize || 20, page = pg.page || 1; return cp({ rows: rows.slice((page - 1) * size, page * size), total: rows.length }); };
  handlers[C + 'GetById'] = p => { G().counters.cardGet++; return cp(G().cards[p.id] || null); };
  handlers[C + 'Get'] = p => { G().counters.cardGet++; return cp(byNo(p.number)); };
  handlers[C + 'Update'] = p => { const s = J(p, 'submit'), c = G().cards[s.id]; G().counters.update++; if (!c) return { success: false, message: 'not exist' }; if (G().conf.updateBug) { c.faceValue = 0; c.balance = r2(0 - c.consumedAmount); } else if (s.expireDate !== undefined) c.expireDate = s.expireDate; return { value: { ...c, isSold: false }, success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 }; };
  handlers[R + 'Save'] = p => {
    const s = J(p, 'submit'), g = G(); g.counters.save++;
    if (!(Number(s.amount) >= 1)) return { success: false, message: 'Recharge amount must be greater than or equal to 1', action: 2000, errorCode: 1001 };
    if (!g.orders[s.id]) { const c = g.cards[s.retailGiftCardId]; g.orders[s.id] = { id: s.id, corpId: 'c', retailShopId: 's', retailShopName: 'Fake', retailGiftCardId: s.retailGiftCardId, cardNo: c ? c.cardNo : '', operatorId: s.operatorId, number: 'GRE' + (10001 + g.seq++), currency: s.currency, currencyCode: s.currencyCode, paymentType: s.paymentType, paymentTypeName: s.paymentType === 20 ? 'Credit Card' : 'Cash', status: 10, statusName: 'New', amount: s.amount, receiveDetailsJson: '{}', createTime: new Date().toISOString(), completedTime: null, _pay: Number(s.paymentAmount) }; }
    return ok({ id: s.id, number: '', amount: 0 });
  };
  handlers[R + 'Get'] = p => { const o = G().orders[p.id]; return o ? cp(ordRow(o)) : null; }; // a deleted order still shows here (as on TestShop)
  handlers[R + 'Paged'] = p => { const f = J(p, 'filter'); const rows = Object.values(G().orders).filter(o => !o._deleted && (!f.cardNo || o.cardNo.includes(f.cardNo))).map(ordRow); return cp({ rows, total: rows.length }); };
  handlers[R + 'ReceiveBegin'] = p => { const s = J(p, 'submit'), g = G(); g.counters.begin++; const o = g.orders[s.id]; if (!o) return { success: false, message: 'not exist' }; g.begun[s.id] = (g.begun[s.id] || 0) + 1; return ok({ receiveChannelOrderId: '', isCompleted: o.paymentType !== 20 || g.conf.autoPay, isUncertain: false, shouldReissue: false, status: '', message: '' }); };
  handlers[R + 'ReceiveCheck'] = p => { const g = G(); g.counters.check++; const o = g.orders[p.id]; if (!o) return { success: false, message: 'not exist' }; const done = o.paymentType !== 20 || !!g.approved[p.id] || (g.conf.autoPay && !!g.begun[p.id]); return ok({ receiveChannelOrderId: '', isCompleted: done, isUncertain: false, shouldReissue: false, status: '', message: done ? '' : 'Waiting for the customer' }); };
  handlers[R + 'ReceiveCancel'] = p => { G().counters.cancelPay++; return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 }; };
  handlers[R + 'Cancel'] = () => { G().counters.cancel++; return { success: false, message: 'Non-JSON reply (HTTP 404)', uncertain: true }; };
  handlers[R + 'Delete'] = p => { const c = J(p, 'command'), g = G(), o = g.orders[c.id]; g.counters.del++; if (!o || o._deleted) return { success: false, message: 'the RetailGiftCardRechargeOrderDO of grain state not exist.', action: 0, errorCode: 0 }; o._deleted = true; return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 }; };
  handlers[R + 'Complete'] = p => {
    const g = G(), o = g.orders[p.id]; g.counters.complete++; g.completeCalls[p.id] = (g.completeCalls[p.id] || 0) + 1;
    if (!o || o._deleted) return { success: false, message: 'the RetailGiftCardRechargeOrderDO of grain state not exist.', action: 0, errorCode: 0 };
    if (o.paymentType === 20 && !g.approved[p.id] && !(g.conf.autoPay && g.begun[p.id])) return { success: false, message: 'Payment not received', action: 0, errorCode: 0 };
    const c = g.cards[o.retailGiftCardId]; if (c) { c.balance = r2(c.balance + o.amount); c.faceValue = r2(c.faceValue + o.amount); }  // NOT idempotent, like TestShop
    o.status = 20; o.statusName = 'Completed'; o.completedTime = new Date().toISOString();
    g.xread.giftTopUps = r2(g.xread.giftTopUps + o._pay); g.xread.cashInDrawer = r2(g.xread.cashInDrawer + (o.paymentType === 10 ? o._pay : 0));
    return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 };
  };

  const q = (u, k) => u.searchParams.get(k), send = (res, v) => res.end(JSON.stringify(v));
  hooks['/gc-state'] = (u, res) => { const g = G(); send(res, { counters: g.counters, completeCalls: g.completeCalls, xread: g.xread, conf: g.conf, begun: g.begun, cards: Object.values(g.cards).map(c => ({ id: c.id, cardNo: c.cardNo, balance: c.balance, faceValue: c.faceValue })), orders: Object.values(g.orders).map(o => ({ id: o.id, number: o.number, status: o.status, amount: o.amount, pay: o._pay, deleted: !!o._deleted, paymentType: o.paymentType, retailGiftCardId: o.retailGiftCardId })) }); };
  hooks['/gc-reset'] = (u, res) => { fake.gc = seed(); send(res, { ok: true }); };
  hooks['/gc-conf'] = (u, res) => { const c = G().conf; for (const [k, v] of u.searchParams) c[k] = v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : v; send(res, c); };
  hooks['/gc-approve'] = (u, res) => { G().approved[q(u, 'id')] = true; send(res, { ok: true }); };
  hooks['/gc-card'] = (u, res) => { const c = G().cards[q(u, 'id')]; if (c) for (const k of ['balance', 'faceValue', 'expired', 'expireDate']) if (q(u, k) !== null) c[k] = k === 'expired' ? q(u, k) === '1' : k === 'expireDate' ? (q(u, k) || null) : Number(q(u, k)); send(res, { ok: !!c }); };
};

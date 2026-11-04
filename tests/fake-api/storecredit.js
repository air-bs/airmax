// Fake AIR POS store credit (customer account recharge) for Batch 8 tests. Made-up customers sc-m1 (balance 0) and sc-m2 (balance 12.5).
// Behaves like the gift-card top-up on TestShop: Complete is NOT idempotent, Complete does not check that cash was taken, ReceiveCheck is true for an unbegun cash order.
// State: fake.sc. Hooks (hook port): /sc-state /sc-reset /sc-approve?id=   Faults: the existing /fault?path=...&mode=lost|down|http500|http500-done
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  if (!process.env.B8_FAKE) return; // Batch 8 fakes replace base fake handlers (gift cards, members, sessions, Z-reads): only on the servers that ask for them (B8_FAKE=1), so no other test changes
  // Batch 2 / 5 fakes (loaded later, alphabetical) define some of the same AIR POS paths; on a B8_FAKE server Batch 8's answers win (applied once loading ends)
  { const real = handlers; handlers = {}; const mine = handlers; setImmediate(() => Object.assign(real, mine)); }
  const path = require('path');
  const { AirPos } = require(path.join(__dirname, '..', '..', 'app', 'lib', 'airpos.js'));
  if (!AirPos.prototype.__qfix) { AirPos.prototype.__qfix = true; const orig = AirPos.prototype.call; // real AIR POS takes ?id= in the address; the fake keys handlers by the plain path
    AirPos.prototype.call = function (host, p, params, o) { const i = String(p).indexOf('?'); if (i < 0) return orig.call(this, host, p, params, o); const q = {}; new URLSearchParams(p.slice(i + 1)).forEach((v, k) => { q[k] = v; }); return orig.call(this, host, p.slice(0, i), { ...(params || {}), ...q }, o); }; }
  const R = '/RetailRechargeOrders/RetailRechargeOrder';
  const r2 = x => Math.round(x * 100) / 100;
  const seed = () => ({ members: { 'sc-m1': { id: 'sc-m1', number: '5559001', name: 'Made Up One', balance: 0, shopBalance: 0, point: 0, status: 10 }, 'sc-m2': { id: 'sc-m2', number: '5559002', name: 'Made Up Two', balance: 12.5, shopBalance: 0, point: 0, status: 10 } },
    orders: {}, seq: 0, counters: { save: 0, begin: 0, check: 0, complete: 0, del: 0 }, completeCalls: {}, approved: {}, begun: {}, xread: { rechargeCash: 0 } });
  fake.sc = seed();
  const S = () => fake.sc, cp = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const prevGet = handlers['/RetailMembers/RetailMemberGet']; // keep every other test's customers; add ours
  handlers['/RetailMembers/RetailMemberGet'] = p => (S().members[p.id] ? cp(S().members[p.id]) : prevGet ? prevGet(p) : { success: false, message: 'Member not found' });
  const row = o => { const { _deleted, ...r } = o; return r; };
  handlers[R + 'Save'] = p => {
    const s = J(p, 'submit'), g = S(); g.counters.save++;
    if (!(Number(s.amount) >= 1)) return { success: false, message: 'Recharge amount must be greater than or equal to 1', action: 2000, errorCode: 1001 };
    if (!g.members[s.retailMemberId]) return { success: false, message: 'Member not found', action: 0, errorCode: 0 };
    if (!g.orders[s.id]) g.orders[s.id] = { id: s.id, number: 'RE' + (20001 + g.seq++), retailMemberId: s.retailMemberId, retailMemberNumber: g.members[s.retailMemberId].number, amount: Number(s.amount), paymentAmount: Number(s.amount), paymentType: s.paymentType, paymentTypeName: s.paymentType === 20 ? 'Credit Card' : 'Cash', status: 10, statusName: 'New', createTime: new Date().toISOString(), operatorId: s.operatorId };
    return ok({ id: s.id });
  };
  handlers[R + 'Get'] = p => { const o = S().orders[p.id]; return o ? cp(row(o)) : null; };
  handlers[R + 'Paged'] = p => { const f = J(p, 'filter'); const rows = Object.values(S().orders).filter(o => !o._deleted && (!f.retailMemberId || o.retailMemberId === f.retailMemberId)).map(row); return cp({ rows, total: rows.length }); };
  handlers[R + 'ReceiveBegin'] = p => { const s = J(p, 'submit'), g = S(); g.counters.begin++; const o = g.orders[s.id]; if (!o) return { success: false, message: 'not exist' }; g.begun[s.id] = (g.begun[s.id] || 0) + 1; return ok({ isCompleted: o.paymentType !== 20, isUncertain: false, message: '' }); };
  handlers[R + 'ReceiveCheck'] = p => { const g = S(); g.counters.check++; const o = g.orders[p.id]; if (!o) return { success: false, message: 'not exist' }; return ok({ isCompleted: o.paymentType !== 20 || !!g.approved[p.id], isUncertain: false, message: '' }); };
  handlers[R + 'Delete'] = p => { const c = J(p, 'command'), g = S(), o = g.orders[c.id]; g.counters.del++; if (!o || o._deleted) return { success: false, message: 'not exist', action: 0, errorCode: 0 }; o._deleted = true; return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 }; };
  handlers[R + 'Complete'] = p => {
    const g = S(), o = g.orders[p.id]; g.counters.complete++; g.completeCalls[p.id] = (g.completeCalls[p.id] || 0) + 1;
    if (!o || o._deleted) return { success: false, message: 'not exist', action: 0, errorCode: 0 };
    if (o.paymentType === 20 && !g.approved[p.id]) return { success: false, message: 'Payment not received', action: 0, errorCode: 0 };
    const m = g.members[o.retailMemberId]; if (m) m.balance = r2(m.balance + o.amount); // NOT idempotent, like the gift-card Complete on TestShop
    o.status = 20; o.statusName = 'Completed'; o.completedTime = new Date().toISOString(); g.xread.rechargeCash = r2(g.xread.rechargeCash + (o.paymentType === 10 ? o.amount : 0));
    return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 };
  };
  const q = (u, k) => u.searchParams.get(k), send = (res, v) => res.end(JSON.stringify(v));
  hooks['/sc-state'] = (u, res) => { const g = S(); send(res, { counters: g.counters, completeCalls: g.completeCalls, xread: g.xread, begun: g.begun, members: Object.values(g.members).map(m => ({ id: m.id, balance: m.balance })), orders: Object.values(g.orders).map(o => ({ id: o.id, status: o.status, amount: o.amount, deleted: !!o._deleted, paymentType: o.paymentType })) }); };
  // test only: an unfinished cash credit order made on another register (not in this register's pending file)
  hooks['/sc-seed'] = (u, res) => { const g = S(), id = String((u && u.searchParams && u.searchParams.get('id')) || 'other-' + g.seq), m = (u && u.searchParams && u.searchParams.get('member')) || Object.keys(g.members)[0]; g.orders[id] = { id, number: 'RE' + (20001 + g.seq++), retailMemberId: m, retailMemberNumber: g.members[m].number, amount: 4, paymentAmount: 4, paymentType: 10, paymentTypeName: 'Cash', status: 10, statusName: 'New', createTime: new Date().toISOString(), operatorId: 'other' }; send(res, { ok: true, id }); };
  hooks['/sc-reset'] = (u, res) => { fake.sc = seed(); send(res, { ok: true }); };
  hooks['/sc-approve'] = (u, res) => { S().approved[q(u, 'id')] = true; send(res, { ok: true }); };
};

// AirMax API Batch 8 - Store credit (a customer's account balance): reads 88 93 94, writes 86 87 89 92. (90 and 91 are NOT built.)
// Same money rules as the gift-card top-up (see giftcards.js): Complete (89) is sent at most once, an unclear reply is read back and never resent,
// every write starts from a fresh read, ids and amounts typed on the screen are re-checked here, and a pending file survives a restart.
// Order flow, as AIR POS does it:  Save (86) -> Pay: ReceiveBegin (87) -> [card: wait, check (88)] -> Complete (89).   Unpaid order: Delete (92).
// Who may: adding paid credit is normal cashier work (like AIR POS' cash-change-to-account). Looking at the recharge-order list/one order, and deleting an order, are manager only.
'use strict';
const path = require('path');
const giftcards = require('./giftcards.js');
const makeLib = giftcards.makeLib;

const RO = '/RetailRechargeOrders/RetailRechargeOrder';

const plugin = ctx => {
  const L = makeLib(ctx, 'credit'), { api, reg } = L;
  const fail = (message, extra) => ({ ok: false, message, ...(extra || {}) });
  const unwrap = r => (r && r.value && typeof r.value === 'object' && r.value.id ? r.value : r);
  const order = o => o && { id: o.id, number: o.number, memberId: o.retailMemberId, memberNumber: o.retailMemberNumber, memberName: o.retailMemberName, amount: o.amount, paymentAmount: o.paymentAmount, status: o.status, statusName: o.statusName, paymentType: o.paymentType, paymentTypeName: o.paymentTypeName, createTime: o.createTime, completedTime: o.completedTime, operatorName: o.operatorName };
  const sum = p => p && { id: p.id, step: p.step, amount: p.amount, method: p.method, number: p.number || '', at: p.at, memberId: p.memberId };

  const readMember = async id => {
    const r = unwrap(await api.memberGet(id)), k = L.klass(r);
    if (k === 'none') return { state: 'none' };
    if (k === 'ok' && r.id) return { state: 'ok', m: r };
    if (k === 'refused' && /not.?found|not exist/i.test(String(r.message))) return { state: 'none' };
    return { state: 'unclear', message: L.msg(r) || 'AIR POS did not answer' };
  };
  const bal = m => ({ balance: L.r2(m.balance), shopBalance: L.r2(m.shopBalance) });
  const readOrder = async id => {
    const r = await api.retail(RO + 'Get', { id }), k = L.klass(r);
    if (k === 'none') return { state: 'none' };
    if (k === 'ok' && r.id) return { state: 'ok', order: r };
    return { state: L.unclear(k) ? 'unclear' : 'refused', message: L.msg(r) || 'AIR POS did not answer' };
  };
  // did the customer's balance rise by the amount? (either account figure may be the one AIR POS raises)
  const rose = (before, after, amount) => ['balance', 'shopBalance'].some(f => L.r2(after[f] - before[f]) === L.r2(amount));
  const unchanged = (before, after) => L.r2(after.balance) === L.r2(before.balance) && L.r2(after.shopBalance) === L.r2(before.shopBalance);

  const settle = async p => {
    const o = await readOrder(p.id), mm = await readMember(p.memberId);
    if (o.state !== 'ok' || mm.state !== 'ok') { L.pend.set(p.id, { step: 'unknown-completing' }); return fail('Could not read the result back. Press "Check what happened".', { unknown: true, id: p.id }); }
    if (o.order.status === 20) {
      const after = bal(mm.m), good = rose(p.before, after, p.amount);
      L.pend.set(p.id, { step: 'done', after });
      L.audit('credit-log.jsonl', { kind: 'store-credit', orderId: p.id, number: o.order.number, memberId: p.memberId, amount: p.amount, method: p.method, before: p.before, after, by: p.by, matches: good });
      return { ok: true, done: true, number: o.order.number, amount: p.amount, before: p.before, after, balanceMatches: good, message: good ? undefined : 'Finished, but the account balance did not rise by $' + p.amount.toFixed(2) + '. Ask a manager to check.' };
    }
    return { ok: false, notFinished: true, id: p.id, status: o.order.status, message: 'AIR POS shows this credit as not finished.' };
  };
  const doComplete = async p => {
    if (p.completeSent) return fail('Finish was already sent for this credit. Use "Check what happened" first.', { id: p.id });
    L.pend.set(p.id, { step: 'completing', completeSent: true }); // saved BEFORE the call
    const r = await api.retail(RO + 'Complete?id=' + encodeURIComponent(p.id), {}), k = L.klass(r);
    if (k === 'refused' || k === 'loggedOut') { L.pend.set(p.id, { step: 'paid', completeSent: false }); return fail(L.msg(r) || 'AIR POS refused to finish', k === 'loggedOut' ? { loggedOut: true } : {}); }
    if (k !== 'ok') { L.pend.set(p.id, { step: 'unknown-completing' }); return fail('AIR POS did not answer clearly. The credit may or may not be on the account. Press "Check what happened". Do not take payment again.', { unknown: true, id: p.id }); }
    return settle(L.pend.get(p.id));
  };

  const routes = {
    // ----- reads: 94 and 93 are manager only; 88 only for a payment this register began -----
    'sc-orders': async b => { // 94
      const g = await L.needMgr(b, 'The store-credit order list'); if (!g.ok) return g;
      const page = Math.max(1, Math.min(500, parseInt(b.page, 10) || 1)), f = {};
      if (b.memberId) f.retailMemberId = String(b.memberId).slice(0, 64);
      const r = await api.retail(RO + 'Paged', { filter: JSON.stringify(f), pageInfo: JSON.stringify({ page, pageSize: 20, amount: 0 }) });
      const k = L.klass(r); if (k !== 'ok' || !Array.isArray(r.rows)) return fail(L.msg(r) || 'Could not read the store-credit orders', { k });
      const rows = b.memberId ? r.rows.filter(o => !o.retailMemberId || o.retailMemberId === String(b.memberId)) : r.rows; // belt and braces if AIR POS ignores the filter
      return { ok: true, rows: rows.map(order), total: r.total || 0, page };
    },
    'sc-order': async b => { // 93
      const g = await L.needMgr(b, 'A store-credit order'); if (!g.ok) return g;
      const o = await readOrder(String(b.id || '')); if (o.state === 'none') return fail('No such order'); if (o.state !== 'ok') return fail(o.message);
      return { ok: true, order: order(o.order) };
    },
    'sc-pay-check': async b => { // 88
      const p = L.pend.get(String(b.id || '')); if (!p || !p.receiveBegun) return fail('No card payment is open for that credit');
      const r = await api.retail(RO + 'ReceiveCheck?id=' + encodeURIComponent(p.id), {}), k = L.klass(r);
      if (k !== 'ok') return fail(L.msg(r) || 'Could not check the payment', { k });
      const v = r.value || {};
      if (v.isCompleted && !v.isUncertain && p.step === 'receiving') L.pend.set(p.id, { step: 'paid' });
      return { ok: true, paid: !!(v.isCompleted && !v.isUncertain), waiting: !v.isCompleted, uncertain: !!v.isUncertain, message: String(v.message || '').slice(0, 200) };
    },
    'sc-open': async () => ({ ok: true, open: L.pend.open().map(sum) }),

    // ----- Start (86) -----
    'sc-start': async b => L.exclusive(async () => {
      L.pend.prune();
      const am = L.parseAmount(b.amount, 1, 1000); if (!am.ok) return fail(am.message);
      const method = b.method === 'card' ? 'card' : 'cash';
      const open = L.pend.open(); if (open.length) return fail('A store credit is already open on this register. Finish or cancel it first.', { open: open.map(sum) });
      const mid = String(b.memberId || '').slice(0, 64); if (!mid) return fail('Pick a customer first');
      const mm = await readMember(mid); if (mm.state === 'none') return fail('No such customer'); if (mm.state !== 'ok') return fail(mm.message);
      const p = L.pend.add({ id: L.newId(), kind: 'credit', step: 'saving', amount: am.n, method, memberId: mid, before: bal(mm.m), at: new Date().toISOString(), by: String((reg.identity && reg.identity.userName) || '').slice(0, 40) });
      const r = await api.submit(RO + 'Save', { id: p.id, retailMemberId: mid, amount: am.n, paymentType: method === 'card' ? 20 : 10, retailGiftCardId: null, currencyCode: reg.identity.currencyCode, currency: reg.identity.currency, operatorId: reg.identity.userId }), k = L.klass(r);
      if (k === 'loggedOut') { L.pend.drop(p.id); return fail('Logged out. Log in again.', { loggedOut: true }); }
      if (k === 'refused') { L.pend.drop(p.id); return fail(L.msg(r) || 'AIR POS refused the credit'); }
      const o = await readOrder(p.id);
      if (L.unclear(k) || k === 'none') {
        if (o.state === 'none') { L.pend.drop(p.id); return fail('The credit was not started (no answer from AIR POS). Nothing was added. Try again.'); }
        if (o.state !== 'ok') { L.pend.set(p.id, { step: 'unknown-saving' }); return fail('Not sure the credit was started. Check the recharge orders before trying again.', { unknown: true, id: p.id }); }
      }
      L.pend.set(p.id, { step: 'saved', number: o.state === 'ok' ? o.order.number : '' });
      return { ok: true, id: p.id, step: 'saved', amount: p.amount, method, number: o.state === 'ok' ? o.order.number : '' };
    }),
    // ----- Pay (87) -----
    'sc-pay': async b => L.exclusive(async () => {
      const p = L.pend.get(String(b.id || '')); if (!p) return fail('That credit is not open on this register');
      if (p.step === 'paid') return { ok: true, id: p.id, step: 'paid', paid: true };
      if (p.step !== 'saved') return fail('This credit cannot take payment now (' + p.step + ').');
      const o = await readOrder(p.id); if (o.state !== 'ok' || o.order.status !== 10) return fail('AIR POS does not show this credit as waiting for payment.');
      L.pend.set(p.id, { receiveBegun: true });
      const r = await api.submit(RO + 'ReceiveBegin', { id: p.id, creditCard: p.method === 'card' ? { cardNo: '', expiration: '', cvv: '' } : null }), k = L.klass(r);
      if (k === 'refused' || k === 'loggedOut') { L.pend.set(p.id, { receiveBegun: false }); return fail(L.msg(r) || 'AIR POS would not start the payment', k === 'loggedOut' ? { loggedOut: true } : {}); }
      if (k !== 'ok') {
        if (p.method === 'cash') { L.pend.set(p.id, { receiveBegun: false }); return fail('No clear answer from AIR POS. Press Cash received again.'); }
        L.pend.set(p.id, { step: 'receiving', unknownBegin: true });
        return fail('No clear answer from AIR POS. A card payment may be open on the terminal. Check it; do not charge again.', { unknown: true, id: p.id });
      }
      const v = (r && r.value) || {};
      if (p.method === 'cash') { L.pend.set(p.id, { step: 'paid' }); return { ok: true, id: p.id, step: 'paid', paid: true }; }
      L.pend.set(p.id, { step: v.isCompleted && !v.isUncertain ? 'paid' : 'receiving' });
      return { ok: true, id: p.id, step: L.pend.get(p.id).step, paid: !!(v.isCompleted && !v.isUncertain), waiting: !v.isCompleted };
    }),
    // ----- Finish (89) -----
    'sc-finish': async b => L.exclusive(async () => {
      const p = L.pend.get(String(b.id || '')); if (!p) return fail('That credit is not open on this register');
      if (p.step === 'done') return fail('This credit is already finished.', { done: true });
      if (p.step !== 'paid') return fail('Take the payment first.');
      if (p.method === 'card') {
        const r = await api.retail(RO + 'ReceiveCheck?id=' + encodeURIComponent(p.id), {}), v = (r && r.value) || {};
        if (L.klass(r) !== 'ok' || !v.isCompleted || v.isUncertain) return fail('AIR POS does not show the card payment as complete.');
      }
      const o = await readOrder(p.id); if (o.state !== 'ok' || o.order.status !== 10) return fail('AIR POS does not show this credit as waiting to finish.');
      const mm = await readMember(p.memberId); if (mm.state !== 'ok') return fail('Could not read the customer. Try again.');
      L.pend.set(p.id, { before: bal(mm.m) });
      return doComplete(L.pend.get(p.id));
    }),
    'sc-resolve': async b => L.exclusive(async () => { // "Check what happened": read, never resend
      const p = L.pend.get(String(b.id || '')); if (!p) return fail('That credit is not open on this register');
      const o = await readOrder(p.id);
      if (o.state === 'none') { if (!p.completeSent) { L.pend.drop(p.id); return { ok: true, cleared: true, message: 'AIR POS has no such order. Nothing was added.' }; } return fail('AIR POS cannot find this order, but Finish was sent. Check the customer balance.'); }
      if (o.state !== 'ok') return fail(o.message);
      if (o.order.status === 20) { if (p.step === 'done') return { ok: true, done: true, message: 'Already finished.' }; return settle(p); }
      if (p.step === 'unknown-saving') { L.pend.set(p.id, { step: 'saved' }); return { ok: true, step: 'saved', message: 'The credit was started. Continue.' }; }
      if (p.step === 'unknown-completing' || p.step === 'completing') {
        const mm = await readMember(p.memberId); if (mm.state !== 'ok') return fail('Could not read the customer.');
        if (!unchanged(p.before, bal(mm.m))) return fail('The customer balance changed but AIR POS shows the credit as not finished. Ask a manager. Do not press Finish.', { id: p.id, hold: true });
        L.pend.set(p.id, { step: 'paid', completeSent: false });
        return { ok: true, step: 'paid', message: 'AIR POS did not finish it and nothing was added. You can press Finish again.' };
      }
      return { ok: true, step: p.step, message: 'Nothing to fix.' };
    }),
    // ----- Delete (92): our own unpaid order needs no manager; any other order does -----
    'sc-delete': async b => L.exclusive(async () => {
      const id = String(b.id || ''), p = L.pend.get(id), mine = !!p && p.step === 'saved' && !p.receiveBegun && !p.completeSent;
      let by = String((reg.identity && reg.identity.userName) || '').slice(0, 40);
      if (!mine) { const g = await L.needMgr(b, 'Deleting a store-credit order'); if (!g.ok) return g; by = g.by; }
      const o = await readOrder(id); if (o.state !== 'ok') return fail(o.state === 'none' ? 'No such order' : o.message);
      if (o.order.status !== 10) return fail('Only an unfinished order can be deleted.');
      if (p && (p.completeSent || p.receiveBegun || p.step === 'receiving' || p.step === 'paid')) return fail('A payment may be involved. Use Check what happened first.');
      if (o.order.paymentType !== 10) { const r = await api.retail(RO + 'ReceiveCheck?id=' + encodeURIComponent(id), {}), v = (r && r.value) || {}; if (L.klass(r) !== 'ok' || v.isCompleted || v.isUncertain) return fail('A payment may exist on this order. It was not deleted.'); }
      const r = await api.retail(RO + 'Delete', { command: JSON.stringify({ id }) }), k = L.klass(r);
      if (k !== 'ok') return fail(L.msg(r) || 'AIR POS did not delete it', { unknown: L.unclear(k) });
      if (p) L.pend.set(id, { step: 'cancelled' });
      L.audit('credit-log.jsonl', { kind: 'delete', orderId: id, by });
      return { ok: true, message: 'Credit order deleted.' };
    }),
  };
  return { routes, unlocked: ['sc-orders', 'sc-order', 'sc-pay-check', 'sc-open'], once: ['sc-start', 'sc-pay', 'sc-finish', 'sc-resolve', 'sc-delete'], noSnap: Object.keys(routes) };
};
module.exports = plugin;

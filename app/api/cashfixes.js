// AirMax API Batch 8 - Cash fixes (manager only): 106 mark a shift's cash short/over as handled, 111 mark one cash transaction's short/over as handled, 117 cancel a Z-read.
// What TestShop shows (read only, 2026-11-03): the shift list/Get carry NO hasDiff/diffHandled fields; the short/over lives on the cash transactions
// (hasDiff, diffAmount, diffHandled, diffHandledRemark). So 106 is only sent when this shift has at least one unhandled short/over transaction.
// TestShop answers HTTP 404 to 106 (RetailSessionDiffHandle), so on that server the shift-level fix is reported as not available; 111 (one record at a time) works.
// A Z-read can only be cancelled while nothing was sold after it (hasNewOrder false) - AIR POS shows the button only then, and so do we.
// Every write: manager (or a manager's typed password), a reason of 3-200 letters, a fresh read first, one send, then a read back. An unclear reply is never resent blind.
'use strict';
const giftcards = require('./giftcards.js');
const plugin = ctx => {
  const L = giftcards.makeLib(ctx, 'cashfix'), { api } = L;
  const fail = (message, extra) => ({ ok: false, message, ...(extra || {}) });
  const PG = (page, n) => JSON.stringify({ page, pageSize: n, amount: 0 });
  const TX = '/RetailCashTransactions/RetailCashTransaction', SS = '/RetailSessions/RetailSession', ZR = '/RetailReports/';
  const tx = t => t && { id: t.id, type: t.type, typeName: t.typeName, amount: t.amount, balance: t.balance, hasDiff: !!t.hasDiff, diffAmount: t.diffAmount, diffHandled: !!t.diffHandled, diffHandledRemark: t.diffHandledRemark, diffHandledOperatorName: t.diffHandledOperatorName, diffHandledTime: t.diffHandledTime, sessionId: t.retailSessionId, sessionNumber: t.retailSessionNumber, operatorName: t.operatorName || t.retailOperatorName, createTime: t.createTime };
  const zr = z => z && { id: z.id, number: z.number, reportDate: z.reportDate, status: z.status, stationNumber: z.saleStationNumber, orderCount: z.orderCount, netAmount: z.netAmount, cashInDrawer: z.cashInDrawer, reportTime: z.reportTime, hasNewOrder: !!z.hasNewOrder, canCancel: !z.hasNewOrder };
  const reason = v => { const s = String(v == null ? '' : v).trim(); return s.length >= 3 && s.length <= 200 ? { ok: true, s } : { ok: false, message: 'Write a reason (3 to 200 letters)' }; };
  const readTx = async id => { const r = await api.retail(TX + 'Get', { id }), k = L.klass(r); if (k === 'none') return { state: 'none' }; if (k === 'ok' && r.id) return { state: 'ok', t: r }; return { state: 'unclear', message: L.msg(r) || 'AIR POS did not answer' }; };
  const sessionTxs = async sid => { // all short/over transactions of one shift (up to 5 pages of 50)
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await api.retail(TX + 'Paged', { filter: JSON.stringify({ retailSessionId: sid, hasDiff: true }), pageInfo: PG(page, 50) });
      if (L.klass(r) !== 'ok' || !Array.isArray(r.rows)) return { ok: false, message: L.msg(r) || 'Could not read the cash records' };
      out.push(...r.rows.filter(t => t.hasDiff && (!t.retailSessionId || t.retailSessionId === sid)));
      if (r.rows.length < 50) break;
    }
    return { ok: true, rows: out };
  };
  const readZ = async id => { // the Z-read row, newest 5 pages of 20
    for (let page = 1; page <= 5; page++) {
      const r = await api.zReadPaged({}, page, 20), k = L.klass(r);
      if (k !== 'ok' || !Array.isArray(r.rows)) return { state: 'unclear', message: L.msg(r) || 'Could not read the Z-reads' };
      const z = r.rows.find(x => x.id === id); if (z) return { state: 'ok', z };
      if (r.rows.length < 20) break;
    }
    return { state: 'none' };
  };
  const done = (kind, g, extra) => L.audit('cashfix-log.jsonl', { kind, by: g.by, approvedWithPassword: !!g.typed, ...extra });

  const routes = {
    // ----- reads (manager only: money records) -----
    'cf-diffs': async b => { // the list of cash short/over records (Reports > Cash fixes)
      const g = await L.needMgr(b, 'The cash differences list'); if (!g.ok) return g;
      const page = Math.max(1, Math.min(200, parseInt(b.page, 10) || 1)), f = { hasDiff: true };
      if (b.sessionId) f.retailSessionId = String(b.sessionId).slice(0, 64);
      const r = await api.retail(TX + 'Paged', { filter: JSON.stringify(f), pageInfo: PG(page, 20) });
      const k = L.klass(r); if (k !== 'ok' || !Array.isArray(r.rows)) return fail(L.msg(r) || 'Could not read the cash records', { k });
      const rows = r.rows.filter(t => t.hasDiff);
      return { ok: true, rows: rows.map(tx), total: r.total || 0, page, unhandled: rows.filter(t => !t.diffHandled).length };
    },
    'cf-session-diffs': async b => { // what a shift fix would cover
      const g = await L.needMgr(b, 'A shift cash difference'); if (!g.ok) return g;
      const sid = String(b.sessionId || ''); if (!sid) return fail('Pick a shift first');
      const s = await sessionTxs(sid); if (!s.ok) return s;
      return { ok: true, sessionId: sid, rows: s.rows.map(tx), unhandled: s.rows.filter(t => !t.diffHandled).length };
    },
    'cf-zreads': async b => {
      const g = await L.needMgr(b, 'The Z-read list'); if (!g.ok) return g;
      const page = Math.max(1, Math.min(200, parseInt(b.page, 10) || 1)), r = await api.zReadPaged({}, page, 10), k = L.klass(r);
      if (k !== 'ok' || !Array.isArray(r.rows)) return fail(L.msg(r) || 'Could not read the Z-reads', { k });
      return { ok: true, rows: r.rows.map(zr), total: r.total || 0, page };
    },

    // ----- 111: one cash transaction's short/over -----
    'cf-tx-handle': async b => L.exclusive(async () => {
      const g = await L.needMgr(b, 'Marking a cash difference as handled'); if (!g.ok) return g;
      const why = reason(b.reason); if (!why.ok) return fail(why.message);
      const id = String(b.id || ''); if (!id) return fail('Pick a cash record first');
      const t = await readTx(id); if (t.state === 'none') return fail('No such cash record'); if (t.state !== 'ok') return fail(t.message);
      if (!t.t.hasDiff) return fail('This cash record has no short/over to handle.');
      if (t.t.diffHandled) return fail('This short/over is already marked handled.', { already: true });
      L.audit('cashfix-log.jsonl', { kind: 'tx-handle', step: 'intent', txId: id, diffAmount: t.t.diffAmount, by: g.by, reason: why.s });
      const r = await api.submit(TX + 'DiffHandled', { retailCashTransactionId: id, diffHandledRemark: why.s }), k = L.klass(r);
      if (k === 'loggedOut') return fail('Logged out. Log in again.', { loggedOut: true });
      if (k === 'refused') { done('tx-handle', g, { step: 'refused', txId: id }); return fail(L.msg(r) || 'AIR POS refused'); }
      const after = await readTx(id);
      if (after.state === 'ok' && after.t.diffHandled) { done('tx-handle', g, { step: 'done', txId: id, diffAmount: t.t.diffAmount, reason: why.s }); return { ok: true, done: true, tx: tx(after.t), message: 'Marked as handled.' }; }
      if (k === 'ok') return fail('AIR POS said done, but the record still shows unhandled. Check it.', { unknown: true });
      done('tx-handle', g, { step: 'unknown', txId: id });
      return fail(after.state === 'ok' ? 'AIR POS did not confirm it. The record still shows unhandled. You can try again.' : 'Not sure it went through, and could not read it back. Look at the record before trying again.', { unknown: after.state !== 'ok' });
    }),
    // ----- 106: a shift's short/over -----
    'cf-session-handle': async b => L.exclusive(async () => {
      const g = await L.needMgr(b, 'Marking a shift cash difference as handled'); if (!g.ok) return g;
      const why = reason(b.reason); if (!why.ok) return fail(why.message);
      const sid = String(b.sessionId || ''); if (!sid) return fail('Pick a shift first');
      const sg = await api.retail(SS + 'Get', { id: sid }); if (L.klass(sg) === 'none') return fail('No such shift'); if (L.klass(sg) !== 'ok') return fail(L.msg(sg) || 'Could not read the shift');
      const before = await sessionTxs(sid); if (!before.ok) return before;
      const open = before.rows.filter(t => !t.diffHandled);
      if (!before.rows.length) return fail('This shift has no cash short/over.');
      if (!open.length) return fail('This shift\'s short/over is already marked handled.', { already: true });
      L.audit('cashfix-log.jsonl', { kind: 'session-handle', step: 'intent', sessionId: sid, unhandled: open.length, by: g.by, reason: why.s });
      const r = await api.submit(SS + 'DiffHandle', { retailSessionId: sid, diffHandledRemark: why.s }), k = L.klass(r);
      if (k === 'loggedOut') return fail('Logged out. Log in again.', { loggedOut: true });
      if (/HTTP 404/.test(String((r && r.message) || ''))) { done('session-handle', g, { step: 'not-available', sessionId: sid }); return fail('This AIR POS server has no shift short/over handling (it answers "not found"). Mark the short/over records one by one instead.', { notAvailable: true }); }
      if (k === 'refused') { done('session-handle', g, { step: 'refused', sessionId: sid }); return fail(L.msg(r) || 'AIR POS refused'); }
      const after = await sessionTxs(sid), left = after.ok ? after.rows.filter(t => !t.diffHandled).length : -1;
      if (after.ok && left === 0) { done('session-handle', g, { step: 'done', sessionId: sid, count: open.length, reason: why.s }); return { ok: true, done: true, handled: open.length, message: 'Marked as handled.' }; }
      if (k === 'ok') { done('session-handle', g, { step: 'sent-not-confirmed', sessionId: sid, left }); return { ok: true, done: false, left, message: 'AIR POS accepted it' + (left > 0 ? ', but ' + left + ' short/over record(s) still show unhandled. Check them.' : ', but the records could not be read back.') }; }
      done('session-handle', g, { step: 'unknown', sessionId: sid });
      return fail(after.ok ? 'AIR POS did not confirm it. The short/over still shows unhandled. You can try again.' : 'Not sure it went through, and could not read it back. Look at the shift before trying again.', { unknown: !after.ok });
    }),
    // ----- 117: cancel a Z-read -----
    'cf-zread-cancel': async b => L.exclusive(async () => {
      const g = await L.needMgr(b, 'Cancelling a Z-read'); if (!g.ok) return g;
      const why = reason(b.reason); if (!why.ok) return fail(why.message);
      const id = String(b.id || ''); if (!id) return fail('Pick a Z-read first');
      const z = await readZ(id); if (z.state === 'none') return fail('No such Z-read (it may already be cancelled).'); if (z.state !== 'ok') return fail(z.message);
      if (z.z.hasNewOrder) return fail('This Z-read cannot be cancelled: a sale was made after it.');
      if (String(b.zNumber || '').trim().toUpperCase() !== String(z.z.number || '').trim().toUpperCase()) return fail('Type the Z-read number (' + z.z.number + ') to confirm.');
      L.audit('cashfix-log.jsonl', { kind: 'zread-cancel', step: 'intent', zreadId: id, number: z.z.number, by: g.by, reason: why.s });
      const r = await api.retail(ZR + 'CancelZRead?id=' + encodeURIComponent(id), {}), k = L.klass(r);
      if (k === 'loggedOut') return fail('Logged out. Log in again.', { loggedOut: true });
      if (k === 'refused') { done('zread-cancel', g, { step: 'refused', zreadId: id }); return fail(L.msg(r) || 'AIR POS refused'); }
      const after = await readZ(id), gone = after.state === 'none' || (after.state === 'ok' && after.z.status !== z.z.status);
      if (gone) { done('zread-cancel', g, { step: 'done', zreadId: id, number: z.z.number, reason: why.s }); return { ok: true, done: true, message: 'Z-read cancelled.' }; }
      if (k === 'ok') { done('zread-cancel', g, { step: 'sent-not-confirmed', zreadId: id }); return fail('AIR POS said done, but the Z-read still shows as before. Check the list.', { unknown: true }); }
      done('zread-cancel', g, { step: 'unknown', zreadId: id });
      return fail(after.state === 'ok' ? 'AIR POS did not confirm it. The Z-read is still there. You can try again.' : 'Not sure it went through, and could not read it back. Check the Z-read list before trying again.', { unknown: after.state !== 'ok' });
    }),
  };
  return { routes, unlocked: ['cf-diffs', 'cf-session-diffs', 'cf-zreads'], once: ['cf-tx-handle', 'cf-session-handle', 'cf-zread-cancel'], noSnap: Object.keys(routes) };
};
module.exports = plugin;

// Fake AIR POS cash records, shifts and Z-reads for Batch 8 cash-fix tests (made-up data).
// Shape copied from what TestShop returned (read only): shift rows have NO hasDiff/diffHandled; cash records do (hasDiff, diffAmount, diffHandled, diffHandledRemark...).
// Shifts: ses-1 has two short/over cash records (tx-1 -129.39, tx-2 +5), ses-2 has none, ses-3 has one already handled (tx-3).
// Z-reads: zr-new (nothing sold after: can be cancelled), zr-old (a sale came after: cannot).
// Hooks (hook port): /cf-state /cf-reset /cf-conf?noSession=1 (shift fix answers HTTP 404 like TestShop).  Faults: the existing /fault?path=...&mode=lost|down|http500|http500-done
// ASSUMPTION (not yet seen on TestShop, which has no cancellable Z-read): a cancelled Z-read leaves the list.
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  if (!process.env.B8_FAKE) return; // Batch 8 fakes replace base fake handlers (gift cards, members, sessions, Z-reads): only on the servers that ask for them (B8_FAKE=1), so no other test changes
  // Batch 2 / 5 fakes (loaded later, alphabetical) define some of the same AIR POS paths; on a B8_FAKE server Batch 8's answers win (applied once loading ends)
  { const real = handlers; handlers = {}; const mine = handlers; setImmediate(() => Object.assign(real, mine)); }
  const path = require('path');
  const { AirPos } = require(path.join(__dirname, '..', '..', 'app', 'lib', 'airpos.js'));
  if (!AirPos.prototype.__qfix) { AirPos.prototype.__qfix = true; const orig = AirPos.prototype.call;
    AirPos.prototype.call = function (host, p, params, o) { const i = String(p).indexOf('?'); if (i < 0) return orig.call(this, host, p, params, o); const q = {}; new URLSearchParams(p.slice(i + 1)).forEach((v, k) => { q[k] = v; }); return orig.call(this, host, p.slice(0, i), { ...(params || {}), ...q }, o); }; }
  const cp = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const seed = () => {
    const t = (id, ses, diff, handled) => ({ id, type: 10, typeName: 'Count at Clock Out', retailSaleStationId: 'st', retailSessionId: ses, retailSessionNumber: 'RSS-' + ses, amount: 0, balance: 0, hasDiff: diff !== 0, diffAmount: diff, diffHandled: !!handled, diffHandledRemark: handled ? 'old' : '', createTime: '2026-11-03T10:00:00.000+08:00' });
    const z = (id, n, has) => ({ id, number: n, reportDate: '2026-11-03T00:00:00.000+08:00', status: 10, saleStationNumber: 'POS9', orderCount: 3, netAmount: 30, cashInDrawer: 30, hasNewOrder: has, reportTime: '2026-11-03T20:00:00.000+08:00' });
    return { sessions: { 'ses-1': { id: 'ses-1', number: 'RSS-ses-1', status: 10 }, 'ses-2': { id: 'ses-2', number: 'RSS-ses-2', status: 10 }, 'ses-3': { id: 'ses-3', number: 'RSS-ses-3', status: 10 } },
      txs: [t('tx-1', 'ses-1', -129.39), t('tx-2', 'ses-1', 5), t('tx-3', 'ses-3', -2, true), t('tx-4', 'ses-2', 0)], zreads: [z('zr-new', 'ZR-NEW', false), z('zr-old', 'ZR-OLD', true)],
      counters: { txHandle: 0, sesHandle: 0, zCancel: 0 }, remarks: [], conf: { noSession: false } };
  };
  fake.cf = seed();
  const S = () => fake.cf, hist = [];
  const TXR = '/RetailCashTransactions/RetailCashTransaction', SS = '/RetailSessions/RetailSession';
  handlers[SS + 'Get'] = p => cp(S().sessions[p.id] || null);
  handlers[TXR + 'Get'] = p => cp(S().txs.find(t => t.id === p.id) || null);
  handlers[TXR + 'Paged'] = p => { const f = J(p, 'filter'), pg = J(p, 'pageInfo'); const rows = S().txs.filter(t => (!f.hasDiff || t.hasDiff) && (!f.retailSessionId || t.retailSessionId === f.retailSessionId)); const size = pg.pageSize || 20, page = pg.page || 1; return cp({ rows: rows.slice((page - 1) * size, page * size), total: rows.length }); };
  handlers[TXR + 'DiffHandled'] = p => { const s = J(p, 'submit'), t = S().txs.find(x => x.id === s.retailCashTransactionId); S().counters.txHandle++; if (!t) return { success: false, message: 'not exist', action: 0, errorCode: 0 }; t.diffHandled = true; t.diffHandledRemark = s.diffHandledRemark; t.diffHandledTime = new Date().toISOString(); S().remarks.push(String(s.diffHandledRemark)); return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 }; };
  handlers[SS + 'DiffHandle'] = p => { const s = J(p, 'submit'); S().counters.sesHandle++; if (S().conf.noSession) return { success: false, message: 'Non-JSON reply (HTTP 404)', uncertain: true }; if (!S().sessions[s.retailSessionId]) return { success: false, message: 'not exist', action: 0, errorCode: 0 }; S().txs.filter(t => t.retailSessionId === s.retailSessionId && t.hasDiff).forEach(t => { t.diffHandled = true; t.diffHandledRemark = s.diffHandledRemark; }); S().remarks.push(String(s.diffHandledRemark)); return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 }; };
  handlers['/RetailReports/StationZReadReportPaged'] = p => { const pg = J(p, 'pageInfo'), size = pg.pageSize || 10, page = pg.page || 1; const rows = S().zreads; return cp({ rows: rows.slice((page - 1) * size, page * size), total: rows.length }); };
  handlers['/RetailReports/CancelZRead'] = p => { const z = S().zreads.find(x => x.id === p.id); S().counters.zCancel++; if (!z) return { success: false, message: 'Z-read not found', action: 0, errorCode: 0 }; if (z.hasNewOrder) return { success: false, message: 'A sale was made after this Z-read', action: 0, errorCode: 0 }; S().zreads = S().zreads.filter(x => x.id !== p.id); return { success: true, message: 'Operation completed successfully', action: 0, errorCode: 0 }; };
  const send = (res, v) => res.end(JSON.stringify(v));
  hooks['/cf-state'] = (u, res) => { const g = S(); send(res, { counters: g.counters, remarks: g.remarks, txs: g.txs.map(t => ({ id: t.id, hasDiff: t.hasDiff, diffHandled: t.diffHandled })), zreads: g.zreads.map(z => z.id) }); };
  hooks['/cf-conf'] = (u, res) => { for (const [k, v] of u.searchParams) S().conf[k] = v === '1' || v === 'true'; send(res, S().conf); };
  hooks['/cf-reset'] = (u, res) => { fake.cf = seed(); send(res, { ok: true }); };
};

// AirMax API Batch 2: Reports tab (shifts, cash in/out, Z-reads, sales report, E-sales by product, E-journal, Discount types).
// Calls: 104 RetailSessionGet, 105 RetailSessionPaged, 110 RetailCashTransactionPaged, 118 StationZReadReportPaged (reused: reg.api.zReadPaged),
//   119 StationZReadReportRecordPaged, 121 SalesReportModelGet, 122 SalesReportPaged, 130 ESalesReportPaged, 133 ESalesProductReportExport (PDF),
//   135 EJournalReportPaged, 136 EJournalReportExport (PDF), 138 DiscountTypeReportPaged, 139 DiscountTypeReportExport (PDF),
//   writes 134 GenerateEJournalReport and 137 GenerateDiscountTypeReport.
// Only talks to AIR POS through ctx.reg.api.retail() / .submit() / .fetchPdf(); prints through ctx.reg.printPdfBase64() (the same path X / Z reports use).
// Nothing is logged here except a route name and its outcome (no URLs, no tokens, no customer data).
// Request filters and row fields come from the AIR POS 1.9.11 client source and read-only TestShop captures (Nov 3, 2026). Marked [UNVERIFIED] = not seen on TestShop (e.g. both writes).
'use strict';
module.exports = ctx => {
  const reg = ctx.reg, api = () => reg.api;
  const P = '/RetailReports/';
  const A = { // AIR POS paths (catalog numbers in the comment)
    sessionGet: '/RetailSessions/RetailSessionGet',                       // 104
    sessionPaged: '/RetailSessions/RetailSessionPaged',                   // 105
    cashPaged: '/RetailCashTransactions/RetailCashTransactionPaged',      // 110
    zRecords: P + 'StationZReadReportRecordPaged',                        // 119
    salesModel: P + 'SalesReportModelGet',                                // 121
    salesPaged: P + 'SalesReportPaged',                                   // 122
    esalesPaged: P + 'ESalesReportPaged',                                 // 130
    esalesExport: P + 'ESalesProductReportExport',                        // 133
    ejGenerate: P + 'GenerateEJournalReport',                             // 134 (write)
    ejPaged: P + 'EJournalReportPaged',                                   // 135
    ejExport: P + 'EJournalReportExport',                                 // 136
    dtGenerate: P + 'GenerateDiscountTypeReport',                         // 137 (write)
    dtPaged: P + 'DiscountTypeReportPaged',                               // 138
    dtExport: P + 'DiscountTypeReportExport',                             // 139
  };
  const fail = (message, extra) => ({ ok: false, message, ...(extra || {}) });
  const msgOf = r => (r && (r.message || r.msg)) || '';
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const str = (v, max) => (v == null ? '' : String(v).slice(0, max || 200));
  const pageOf = b => Math.max(1, num(b && b.page, 1) | 0);
  const sizeOf = b => Math.min(50, Math.max(1, num(b && b.pageSize, 10) | 0));
  const pageInfo = (b, extra) => JSON.stringify({ page: pageOf(b), pageSize: sizeOf(b), amount: 0, ...(extra || {}) }); // same pageInfo AIR POS lists use (see reg.api.zReadPaged)
  const isoDay = s => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);
  // AIR POS list filters take plain 'YYYY-MM-DD' for a day and include both ends (TestShop: begin = end = one day returns that day). Names differ per list:
  const days = b => ({ from: isoDay(b && b.from), to: isoDay(b && b.to) });
  const rangeFilter = b => { const d = days(b); return { reportNumber: str(b && b.number, 40), startDate: d.from, endDate: d.to }; };   // 118, 119, 130, 135, 138
  const down = r => !r ? 'No answer from AIR POS' : r.unreachable ? 'Could not reach AIR POS' : msgOf(r) || 'AIR POS refused this';
  const good = r => !!(r && r.success !== false && !r.unreachable && !r.uncertain && !r.loggedOut);
  const pageReply = (r, map, b) => (r && r.loggedOut) ? fail('Signed out of AIR POS', { loggedOut: true }) : !good(r) ? fail(down(r)) : (() => {
    const v = Array.isArray(r.rows) ? r : (r.value && Array.isArray(r.value.rows) ? r.value : { rows: Array.isArray(r.value) ? r.value : [], total: 0 });
    const rows = v.rows.map(map); return { ok: true, rows, total: num(v.total, rows.length), page: pageOf(b), pageSize: sizeOf(b) };
  })();
  const val = r => (r && r.value !== undefined ? r.value : r);

  // ----- manager gate. The Reports tab is shown to managers only; the routes check it again (a cashier's request is refused). -----
  // A cashier logged in may still use a route that needs a manager if a manager signs in on the pop-up (b.user + b.password), same rule as Price Change.
  async function needManager(b, what) {
    if (ctx.isManager()) return { ok: true };
    if (!b || (!b.user && !b.password)) return fail(what + ' needs a manager. A manager logs in to approve it.', { needManager: true });
    const m = await reg.managerCheck({ user: b.user, password: b.password });
    if (!m || !m.ok) return fail((m && m.message) || 'Manager login refused', { needManager: true });
    return { ok: true };
  }
  const gate = (what, fn) => async b => { const g = await needManager(b, what); return g.ok ? fn(b) : g; };

  // ----- row shapes the screen reads. One place that knows the AIR POS field names (seen on TestShop). -----
  const shiftRow = s => { s = s || {}; const done = !!s.clockOutTime;
    return { id: str(s.id), number: str(s.number), operator: str(s.clockInOperatorName || s.clockInRetailOperatorName), operatorOut: str(s.clockOutOperatorName || s.clockOutRetailOperatorName),
      clockIn: s.clockInTime || null, clockOut: s.clockOutTime || null, opening: num(s.initialAmount, 0), counted: done ? num(s.finalAmount, 0) : null,
      status: str(s.statusName), statusCode: s.status, station: str(s.stationNumber || s.deviceName) }; };
  const cashRow = c => { c = c || {}; return { id: str(c.id), number: str(c.targetNumber), type: str(c.typeName), typeCode: c.type, hasDiff: !!c.hasDiff, difference: c.hasDiff ? num(c.diffAmount, 0) : 0, handled: c.hasDiff ? !!c.diffHandled : null,
    amount: num(c.amount, 0), balance: c.balance == null ? null : num(c.balance, 0), note: str(c.remark, 300), time: c.createTime || null, operator: str(c.retailOperatorName || c.operatorName), shiftNumber: str(c.retailSessionNumber) }; };
  const zRow = z => ({ id: str(z.id), number: str(z.number), date: z.reportDate || null, from: z.bootTime || null, to: z.shutdownTime || null, time: z.reportTime || null, operator: str(z.operatorName), station: str(z.saleStationNumber || z.deviceName),
    orders: num(z.orderCount, 0), gross: num(z.grossAmount, 0), net: num(z.netAmount, 0), tax: num(z.tax, 0), discount: num(z.discountAmount, 0), returns: num(z.returnAmount, 0), cashInDrawer: z.cashInDrawer == null ? null : num(z.cashInDrawer, 0),
    reset: num(z.resetCounter, 0), status: z.status });
  const listRow = z => { z = z || {}; return { id: str(z.id), number: str(z.number), date: z.reportDate || null, from: z.startDate || null, to: z.endDate || null, created: z.reportTime || null,
    orders: z.orderCount == null ? null : num(z.orderCount, 0), products: z.soldProductCount == null ? null : num(z.soldProductCount, 0), total: z.totalAmount == null ? null : num(z.totalAmount, 0),
    taxable: z.taxableSalesAmount == null ? null : num(z.taxableSalesAmount, 0), nonTaxable: z.nonTaxableSalesAmount == null ? null : num(z.nonTaxableSalesAmount, 0), tax: z.taxAmount == null ? null : num(z.taxAmount, 0) }; }; // E-sales (130), E-journal (135), Discount types (138)
  const TABS = ['Shift', 'Vendor', 'Product', 'ProductCategory'];
  const salesRow = (z, tab) => { z = z || {}; const label = tab === 'Shift' ? (str(z.sessionNumber) || '—') : tab === 'Vendor' ? str(z.vendorName || z.name) : tab === 'Product' ? str(z.number) : str(z.categoryName || z.name);
    return { label, label2: tab === 'Product' ? str(z.name) : tab === 'Shift' ? str(z.clockInTime || '') : '', orders: num(z.orderCount, 0), quantity: num(z.quantity, 0), gross: num(z.amount, 0), discount: num(z.discountAmount, 0), returns: num(z.returnAmount, 0), net: num(z.netAmount, 0) }; };

  // ----- reads (unlocked: they never wait for a sale) -----
  const routes = {
    'reports-shifts': async b => { // 105: filter keys as the AIR POS shift screen sends them (no status filter exists there)
      const d = days(b); const f = { number: str(b.number, 40), clockInRetailOperatorName: str(b.operator, 60), clockInDateBegin: d.from, clockInDateEnd: d.to };
      return pageReply(await api().retail(A.sessionPaged, { filter: JSON.stringify(f), pageInfo: pageInfo(b) }), shiftRow, b); },
    'reports-shift': async b => { // 104: one shift (bare session), then its cash records (110 filtered by shift number)
      const id = str(b.id, 80); if (!id) return fail('Choose a shift');
      const r = await api().retail(A.sessionGet, { id });
      if (r && r.loggedOut) return fail('Signed out of AIR POS', { loggedOut: true }); if (!good(r)) return fail(down(r));
      const shift = shiftRow(val(r) || {}); let cash = [];
      if (shift.number) { const c = await api().retail(A.cashPaged, { filter: JSON.stringify({ retailSessionNumber: shift.number }), pageInfo: pageInfo({ page: 1, pageSize: 50 }) }); cash = good(c) && Array.isArray(c.rows) ? c.rows : []; }
      const rows = cash.map(cashRow); const diff = rows.reduce((t, x) => t + x.difference, 0);
      return { ok: true, shift, difference: Math.round(diff * 100) / 100, cash: rows }; },
    'reports-cash': async b => { // 110
      const d = days(b); const f = { createDateBegin: d.from, createDateEnd: d.to, type: b.type === undefined || b.type === '' || b.type === null ? null : num(b.type, 0), hasDiff: b.hasDiff ? true : null, retailOperatorName: str(b.operator, 60) || null, retailSessionNumber: str(b.number, 40) || null };
      return pageReply(await api().retail(A.cashPaged, { filter: JSON.stringify(f), pageInfo: pageInfo(b) }), cashRow, b); },
    'reports-zreads': async b => { // 118 (already used by AirMax: reg.api.zReadPaged)
      const f = { ...rangeFilter(b), posNumber: str(b.pos, 40) };
      return pageReply(await api().zReadPaged(f, pageOf(b), sizeOf(b)), zRow, b); },
    'reports-zrecords': async b => { // 119: the saved records of one Z-read (found by its report number)
      const number = str(b.number, 40); if (!number) return fail('Choose a Z-read');
      return pageReply(await api().retail(A.zRecords, { filter: JSON.stringify({ reportNumber: number, startDate: null, endDate: null, posNumber: '' }), pageInfo: pageInfo(b) }), zRow, b); },
    'reports-sales-model': async () => { // 121: the lists the filters offer (vendors, vendor categories, product categories)
      const r = await api().retail(A.salesModel, {}); if (r && r.loggedOut) return fail('Signed out of AIR POS', { loggedOut: true }); if (!good(r)) return fail(down(r));
      const v = val(r) || {}; const pick = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
      return { ok: true, vendors: pick(v.vendors, 300).map(x => ({ id: str(x.key), name: str(x.name, 80) })), vendorCategories: pick(v.vendorCategories, 100).map(x => ({ id: str(x.key), name: str(x.name, 80) })), categories: pick(v.productCategories, 100).length }; },
    'reports-sales': async b => { // 122: one of four views (Shift / Vendor / Product / ProductCategory)
      const tab = TABS.includes(b.tab) ? b.tab : 'Shift', d = days(b);
      const f = { activeTab: tab, productNumber: str(b.product, 40), productCategoryCode: '', vendorId: str(b.vendorId, 60), vendorCategoryId: '', retailOrderDateBegin: d.from, retailOrderDateEnd: d.to, excludeNoTransactions: true };
      return pageReply(await api().retail(A.salesPaged, { filter: JSON.stringify(f), pageInfo: pageInfo(b) }), z => salesRow(z, tab), b); },
    'reports-esales': async b => pageReply(await api().retail(A.esalesPaged, { filter: JSON.stringify(rangeFilter(b)), pageInfo: pageInfo(b) }), listRow, b), // 130
    'reports-ejournal': async b => pageReply(await api().retail(A.ejPaged, { filter: JSON.stringify(rangeFilter(b)), pageInfo: pageInfo(b) }), listRow, b), // 135
    'reports-discount': async b => pageReply(await api().retail(A.dtPaged, { filter: JSON.stringify(rangeFilter(b)), pageInfo: pageInfo(b) }), listRow, b), // 138
  };

  // ----- PDFs (133, 136, 139): fetched and sent to the printer exactly as the X / Z reports are. isPrint 'false': AIR POS is not asked to record a print. -----
  let printing = false; // one report printing at a time (a second press is refused, not queued)
  const DISCOUNT_TYPES = { 10: 'SC', 20: 'PWD', 30: 'SP', 50: 'NAAC' }; // RetailDiscountCustomerType in AIR POS: Senior citizen, Person with disability, Solo parent, National athlete and coach
  async function printPdf(kind, b) {
    const id = str(b.id, 80); if (!id) return fail('Choose a report');
    const base = { stationId: api().stationId, operator: api().operator, isPrint: 'false' };
    let path, params, label;
    if (kind === 'esales') { path = A.esalesExport; params = { id, ...base }; label = 'E-sales by product'; }              // AIR POS: { id, isPrint, stationId, operator }
    else if (kind === 'ejournal') { path = A.ejExport; params = { id, ...base }; label = 'E-journal'; }
    else { const t = num(b.discountType, 0); if (!DISCOUNT_TYPES[t]) return fail('Choose a discount type'); path = A.dtExport; params = { id, discountType: t, ...base }; label = DISCOUNT_TYPES[t] + ' discount report'; } // AIR POS: { id, discountType, isPrint, stationId, operator }
    if (printing) return fail('Still printing a report…', { busy: true });
    printing = true;
    try {
      const pdf = await api().fetchPdf(path, params, label);
      if (!pdf || !pdf.success) return fail('Could not get the ' + label + ' report: ' + (pdf && pdf.message || 'no answer'), pdf && pdf.unreachable ? { retryable: true } : {});
      return await reg.printPdfBase64(pdf.value.toString('base64'), label + ' report sent to printer');
    } finally { printing = false; }
  }
  routes['reports-print-esales'] = b => printPdf('esales', b || {});
  routes['reports-print-ejournal'] = b => printPdf('ejournal', b || {});
  routes['reports-print-discount'] = b => printPdf('discount', b || {});

  // ----- writes (134, 137): each makes ONE new report record on AIR POS. Never retried by AirMax. Before and after, the list is read so a lost reply is not guessed at. -----
  async function ids(listPath) { const r = await api().retail(listPath, { filter: JSON.stringify({}), pageInfo: pageInfo({ page: 1, pageSize: 50 }) }); return good(r) && Array.isArray(r.rows) ? r.rows.map(x => String(x.id)) : null; }
  async function generate(genPath, listPath, what, params, opt) {
    const seen = await ids(listPath);
    if (!seen) return fail('Could not read the ' + what + ' list from AIR POS first, so nothing was generated. Try again.', { retryable: true });
    const r = await api().retail(genPath, params || {}, opt); // [UNVERIFIED on TestShop: writes are not run there] AIR POS: 134 sends form field filter={startDate,endDate}; 137 sends nothing
    if (r && r.loggedOut) return fail('Signed out of AIR POS', { loggedOut: true });
    // A CLEAR refusal = AIR POS itself answered with a failed status / an error message it wrote (not a timeout, a network error or an unreadable reply).
    const inner = val(r), failedInside = !!(inner && typeof inner === 'object' && !Array.isArray(inner) && inner.success === false);
    if (good(r) && !failedInside) return { ok: true, message: msgOf(r) || what + ' generated', record: val(r) && typeof val(r) === 'object' ? { id: str(val(r).id), number: str(val(r).number) } : null };
    const why = (r && r.success === false ? msgOf(r) : '') || (failedInside ? msgOf(inner) : '');
    const weak = /^HTTP \d|^Non-JSON reply|^Network error|^No answer|time[sd]? ?out|timed out|ETIMEDOUT|ECONN|ENET|abort|fetch failed/i;
    const clearNo = !!r && !r.unreachable && !r.loggedOut && (r.success === false || failedInside) && !!String(why).trim() && !weak.test(String(why));
    const now = await ids(listPath); // the list is read again either way: it shows what AIR POS really has
    const grew = !!(now && now.some(id => !seen.includes(id)));
    if (clearNo && !grew) return fail('Not created: ' + str(why, 300).trim(), { refused: true }); // AIR POS said no: nothing was made, nothing is retried
    if (grew && !clearNo) return { ok: true, message: what + ' generated (AIR POS recorded it; the reply was lost).' };
    return fail('No clear answer from AIR POS about the ' + what + ' (' + down(r) + '). It may have been made. Check the list before trying again; AirMax did not retry.', { unknown: true });
  }
  routes['reports-ejournal-generate'] = gate('Generate E-journal', b => { const d = days(b); // 134 needs a start and an end date (AIR POS asks for both)
    if (!d.from || !d.to) return fail('Pick a start date and an end date for the E-journal.'); if (d.from > d.to) return fail('The start date is after the end date.');
    return generate(A.ejGenerate, A.ejPaged, 'E-journal', { filter: JSON.stringify({ startDate: d.from, endDate: d.to }) }); });
  routes['reports-discount-generate'] = gate('Generate discount-type report', () => generate(A.dtGenerate, A.dtPaged, 'Discount-type report', {}, { form: false })); // 137

  const reads = ['reports-shifts', 'reports-shift', 'reports-cash', 'reports-zreads', 'reports-zrecords', 'reports-sales-model', 'reports-sales', 'reports-esales', 'reports-ejournal', 'reports-discount'];
  // the reads need a manager too (the tab is manager-only; a direct request from a cashier is refused the same way)
  for (const n of reads) { const fn = routes[n]; routes[n] = gate('Reports', fn); }
  for (const n of ['reports-print-esales', 'reports-print-ejournal', 'reports-print-discount']) { const fn = routes[n]; routes[n] = gate('Printing a report', fn); }
  return {
    routes,
    unlocked: reads,
    once: ['reports-ejournal-generate', 'reports-discount-generate', 'reports-print-esales', 'reports-print-ejournal', 'reports-print-discount'],
    noSnap: [...reads, 'reports-ejournal-generate', 'reports-discount-generate', 'reports-print-esales', 'reports-print-ejournal', 'reports-print-discount'],
  };
};

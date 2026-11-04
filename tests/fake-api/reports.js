// AirMax API Batch 2 (Reports, shifts, cash records): fake AIR POS answers. OFFLINE, ALL DATA MADE UP (no real store, customer or operator).
// Calls: 104 RetailSessionGet, 105 RetailSessionPaged, 110 RetailCashTransactionPaged, 118 StationZReadReportPaged (reused for the Z-read list),
//   119 StationZReadReportRecordPaged, 121 SalesReportModelGet, 122 SalesReportPaged, 130 ESalesReportPaged, 133 ESalesProductReportExport (PDF),
//   135 EJournalReportPaged, 136 EJournalReportExport (PDF), 138 DiscountTypeReportPaged, 139 DiscountTypeReportExport (PDF),
//   writes 134 GenerateEJournalReport and 137 GenerateDiscountTypeReport (each only adds one record to the fake list).
// SHAPES: [SEEN] = field names, filter keys and reply shape seen on a read-only TestShop capture (Nov 3, 2026) or in the AIR POS client source; values are made up.
//         [UNVERIFIED] = the list row shapes for E-sales (130), E-journal (135), Discount types (138) (their TestShop lists are empty, so the row fields come from the
//                    client source only) and both writes (134 / 137), which are never run on TestShop. The PDF exports (133 / 136 / 139) also stay unverified live.
// The three PDF exports (133, 136, 139) are not handled here: the fake server already answers every reg.api.fetchPdf() with '%PDF-1.4 fake <path>'
//   and lists the paths on the hook /pdfs (fake-server.js). A test can read them there.
// Own state: fake.reports = { ejournal: [], discount: [], writes: [], fail: null }. Hooks (hook port = FAKE_PORT+1): /reports-state, /reports-reset, /reports-delay?ms=N, /reports-fail?mode=error|refuse|inner|refuse500|lost|silent|http500|unreadable|network|off
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  const S = () => (fake.reports = fake.reports || fresh());
  const fresh = () => ({ esales: seedES(), ejournal: seedEJ(), discount: seedDT(), writes: [], fail: null, delay: 0 });
  // ---- made-up seed data. Dates are plain ISO strings with the +08:00 style offset real AIR POS replies use. ----
  const ST = 'ffffffff-0000-4000-8000-0000000000';        // fake id prefix; ids are ST + 2 digits
  const id = n => ST + String(n).padStart(2, '0');
  // day d (1..7) = (7 - d) days before today, so the made-up rows sit inside the screen's default "last 7 days" window
  const DAY = d => { const t = new Date(Date.now() - (7 - d) * 864e5); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
  const iso = (d, h = 9, m = 0) => `${DAY(d)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000+08:00`;
  const OPS = ['Test Cashier One', 'Test Cashier Two', 'Test Manager'];
  const day = t => String(t || '').slice(0, 10);
  const SESSIONS = [1, 2, 3, 4, 5, 6, 7].map(n => ({   // [SEEN] 105 rows and 104 reply (a bare session: no cash records, no expected amount, no difference)
    id: id(n), number: 'RSS9' + String(n).padStart(5, '0'), retailSaleStationId: id(90), stationNumber: '', deviceName: '',
    initialAmount: 100, finalAmount: n === 7 ? 0 : 100 + n * 25, clockInTime: iso(n), clockOutTime: n === 7 ? null : iso(n, 17),
    clockInRetailOperatorId: id(50), clockInRetailOperatorName: OPS[n % 3], clockInOperatorId: id(51), clockInOperatorName: OPS[n % 3],
    clockOutRetailOperatorId: n === 7 ? null : id(50), clockOutRetailOperatorName: n === 7 ? '' : OPS[n % 3], clockOutOperatorId: n === 7 ? null : id(51), clockOutOperatorName: n === 7 ? '' : OPS[n % 3],
    status: n === 7 ? 0 : n === 5 ? 20 : 10, statusName: n === 7 ? 'At Work' : n === 5 ? 'Forced Over Work' : 'Over Work' }));
  const CT = { 0: 'Count at Clock In', 10: 'Count at Clock Out', 11: 'Collection', 12: 'Refund' };
  const CASH = []; { let k = 0; const add = (sn, type, amount, balance, o) => CASH.push({ id: id(100 + k), type, typeName: CT[type], retailSaleStationId: id(90), retailSessionId: null, retailSessionNumber: 'RSS9' + String(sn).padStart(5, '0'), targetNumber: 'RCT9' + String(++k).padStart(5, '0'), // [SEEN] 110 row shape (note: retailSessionId is null in real rows; the number is the link)
      amount, balance, hasDiff: false, diffAmount: 0, diffHandled: false, diffHandledRemark: '', diffHandledOperatorId: null, diffHandledOperatorName: '', diffHandledTime: null, retailOperatorId: id(50), retailOperatorName: OPS[sn % 3], operatorId: id(51), operatorName: '', createTime: iso(sn, type === 10 ? 17 : type === 0 ? 8 : 12, k), remark: '', ...(o || {}) });
    for (let n = 1; n <= 7; n++) { add(n, 0, 100, 100); if (n <= 6) { add(n, 11, 20 * n, 100 + 20 * n); add(n, 10, 100 + n * 25, 100 + n * 25, n === 3 ? { hasDiff: true, diffAmount: -5, diffHandled: false, remark: 'made-up note 3' } : {}); } } }
  const ZREADS = [1, 2, 3, 4].map(n => ({               // [SEEN] 118 / 119 row (trimmed); values made up
    id: id(30 + n), shopName: 'Fake shop', saleStationNumber: 'FAKE-POS1', deviceName: 'FAKE-REG', operatorName: OPS[n % 3],
    number: 'ZR-FAKE-2026100' + n, reportDate: iso(n, 0), status: 10, bootTime: n === 4 ? null : iso(n, 8), shutdownTime: iso(n, 21),
    startOrderNumber: 'T' + (1000 + n * 10), endOrderNumber: 'T' + (1009 + n * 10), orderCount: 10, soldProductCount: 25 + n, cancelledOrderCount: 0, cancelledAmount: 0,
    pendingOrderCount: 0, pendingAmount: 0, grossAmount: 500 + n, amount: 480 + n, returnAmount: 20, discountAmount: 12.5, netAmount: 450 + n, tax: 36, returnTax: 0,
    paymentIncome: [{ paymentType: 10, paymentTypeName: 'Cash', income: 300, returnAmount: 0 }, { paymentType: 20, paymentTypeName: 'Card', income: 150 + n, returnAmount: 0 }],
    initialFund: 100, depositAmount: 0, pullOutsAmount: 0, cashInDrawer: 400, reportTime: iso(n, 21), resetCounter: 0, serialNumber: n }));
  const ZRECORDS = ZREADS.concat([{ ...ZREADS[0], id: id(39), resetCounter: 1, reportTime: iso(1, 22) }]); // [SEEN] 119 = the same row shape as 118 (one record per print/reset of a Z-read); ZR-FAKE-20261001 has two
  const SALES = { // [SEEN] 122 rows per activeTab
    Shift: SESSIONS.slice(0, 3).map((x, i) => ({ shopName: 'Fake shop', sessionNumber: x.number, clockInTime: x.clockInTime, clockOutTime: x.clockOutTime, number: '', name: '', categoryName: '', orderCount: 10 + i, quantity: 25 + i, amount: 500 + i, discountAmount: 12.5, returnAmount: 20, netAmount: 467.5 + i })),
    Vendor: [{ vendorId: id(95), vendorName: 'Fake Vendor Co', number: '', name: '', categoryName: '', orderCount: 30, quantity: 80, amount: 1200, discountAmount: 30, returnAmount: 10, netAmount: 1160 }],
    Product: [{ productId: id(96), vendorId: id(95), number: '9001', name: 'Fake candy (lb)', categoryName: 'Fake sweets', orderCount: 20, quantity: 40, amount: 160, discountAmount: 0, returnAmount: 0, netAmount: 160 }, { productId: id(97), vendorId: id(94), number: '9002', name: 'Fake toy car', categoryName: 'Fake toys', orderCount: 5, quantity: 7, amount: 69.93, discountAmount: 0, returnAmount: 0, netAmount: 69.93 }],
    ProductCategory: [{ number: 'C01', name: 'Fake sweets', categoryName: 'Fake sweets', orderCount: 20, quantity: 40, amount: 160, discountAmount: 0, returnAmount: 0, netAmount: 160 }] };
  const row = (n, o) => ({ id: id(n), number: '', reportDate: iso(1, 0), reportTime: iso(1, 22), ...o });
  const seedES = () => [1, 2].map(n => row(80 + n, { number: 'ES-FAKE-' + n, reportDate: iso(n, 0), orderCount: 10 * n, soldProductCount: 25 * n, totalAmount: 480 * n })); // [UNVERIFIED] row fields from the client source
  function seedEJ() { return [1, 2, 3].map(n => row(60 + n, { number: 'EJ-FAKE-' + n, reportDate: iso(n, 0), reportTime: iso(n, 22), startDate: iso(n, 0), endDate: iso(n, 0), totalAmount: 480 * n, taxableSalesAmount: 430 * n, nonTaxableSalesAmount: 50 * n, taxAmount: 36 * n })); } // [UNVERIFIED]
  function seedDT() { return [1, 2].map(n => row(70 + n, { number: 'DT-FAKE-' + n, reportDate: iso(n, 0), reportTime: iso(n, 22) })); } // [UNVERIFIED]
  const page = (all, p) => { const pi = J(p, 'pageInfo'), sz = pi.pageSize || 10, pg = pi.page || 1; return { success: true, rows: all.slice((pg - 1) * sz, pg * sz), total: all.length }; }; // [SEEN] { rows, total }
  const filt = p => J(p, 'filter');
  // AIR POS ignores filter keys it does not know; plain 'YYYY-MM-DD' dates include both ends [SEEN]. The helpers below do the same.
  const inDays = (t, a, b) => (!a || day(t) >= a) && (!b || day(t) <= b);
  const has = (v, w) => !w || String(v || '').toLowerCase().includes(String(w).toLowerCase());
  const byRange = (rows, f, key = 'reportDate') => rows.filter(x => (!f.reportNumber || x.number === f.reportNumber) && inDays(x[key], f.startDate, f.endDate));

  // ---- reads ----
  handlers['/RetailSessions/RetailSessionPaged'] = p => { const f = filt(p); // [SEEN] keys: number, clockInRetailOperatorName, clockInDateBegin, clockInDateEnd (no status filter exists)
    return page(SESSIONS.slice().reverse().filter(x => (!f.number || x.number === f.number) && has(x.clockInRetailOperatorName, f.clockInRetailOperatorName) && inDays(x.clockInTime, f.clockInDateBegin, f.clockInDateEnd)), p); };
  handlers['/RetailSessions/RetailSessionGet'] = p => { const s = SESSIONS.find(x => x.id === (p.id || J(p, 'submit').id)); // [SEEN] form field `id`; reply = the bare session
    return s ? ok(s) : { success: false, message: 'Shift not found (fake)' }; };
  handlers['/RetailCashTransactions/RetailCashTransactionPaged'] = p => { const f = filt(p); // [SEEN] keys: createDateBegin, createDateEnd, type, hasDiff, retailOperatorName, retailSessionNumber
    return page(CASH.slice().reverse().filter(x => (f.type == null || f.type === '' || x.type === Number(f.type)) && (!f.hasDiff || x.hasDiff) && has(x.retailOperatorName, f.retailOperatorName) && (!f.retailSessionNumber || x.retailSessionNumber === f.retailSessionNumber) && inDays(x.createTime, f.createDateBegin, f.createDateEnd)), p); };
  handlers['/RetailReports/StationZReadReportPaged'] = p => { const f = filt(p); return page(byRange(ZREADS.slice().reverse(), f).filter(x => has(x.saleStationNumber, f.posNumber)), p); }; // 118 (already used by AirMax: reg.api.zReadPaged)
  handlers['/RetailReports/StationZReadReportRecordPaged'] = p => { const f = filt(p); return page(byRange(ZRECORDS.slice().reverse(), f).filter(x => has(x.saleStationNumber, f.posNumber)), p); }; // 119
  handlers['/RetailReports/SalesReportModelGet'] = () => ok({ productCategories: [{ id: id(98), parentId: null, value: 'C01', label: 'Fake sweets', disable: false, childs: [] }], // [SEEN] 121 = filter options
    vendors: [{ key: id(95), name: 'Fake Vendor Co', code: '' }, { key: id(94), name: 'Other Fake Vendor', code: '' }], vendorCategories: [{ key: id(93), name: 'Fake type', code: '' }] });
  handlers['/RetailReports/SalesReportPaged'] = p => { const f = filt(p); let rows = (SALES[f.activeTab] || SALES.Shift).slice(); // [SEEN] keys: activeTab, productNumber, vendorId, retailOrderDateBegin / End ...
    if (f.productNumber) rows = rows.filter(x => x.number === f.productNumber); if (f.vendorId) rows = rows.filter(x => x.vendorId === f.vendorId);
    if (f.activeTab === 'Shift' || !f.activeTab) rows = rows.filter(x => inDays(x.clockInTime, f.retailOrderDateBegin, f.retailOrderDateEnd)); return page(rows, p); };
  handlers['/RetailReports/ESalesReportPaged'] = p => page(byRange(S().esales.slice().reverse(), filt(p)), p);
  handlers['/RetailReports/EJournalReportPaged'] = p => page(byRange(S().ejournal.slice().reverse(), filt(p)), p);
  handlers['/RetailReports/DiscountTypeReportPaged'] = p => page(byRange(S().discount.slice().reverse(), filt(p)), p);

  // ---- writes: one new record each, nothing else. [UNVERIFIED] reply = the new record. 134 needs filter={startDate,endDate} (as AIR POS sends it); 137 sends nothing ----
  const gen = (key, prefix, extra) => p => { const s = S(), body = J(p, 'filter');
    const run = () => {
      s.writes.push({ path: key, body });
      if (key === 'ejournal' && (!body.startDate || !body.endDate)) return { success: false, message: 'The start date and the end date are required (fake)' };
      if (s.fail === 'error') return { success: false, message: 'Could not generate the report (fake error)' };
      if (s.fail === 'refuse') return { success: false, errorCode: 4001, message: 'Product 00001 is missing the share configuration (fake refusal)' };   // AIR POS says no, in its own words
      if (s.fail === 'inner') return { success: true, value: { success: false, message: 'The report could not be created (fake failed status)' } }; // a failed status inside the reply
      if (s.fail === 'refuse500') return { success: false, uncertain: true, message: 'Report service error: no sales in range (fake HTTP 500 with a message)' }; // 5xx that carries AIR POS's own message
      if (s.fail === 'http500') return { success: false, uncertain: true, message: 'HTTP 500' };                    // server error with no message: real uncertainty
      if (s.fail === 'unreadable') return { success: false, uncertain: true, message: 'Non-JSON reply (HTTP 200)' }; // reply cannot be read: real uncertainty
      if (s.fail === 'network') return { success: false, unreachable: true, message: 'Network error: ECONNRESET (fake)' };
      if (s.fail === 'silent') return { success: false, uncertain: true, message: 'timed out waiting for AIR POS (fake)' };   // no record made, reply lost
      const list = s[key], n = list.length + 1, rec = { id: id(60 + (key === 'ejournal' ? 30 : 40) + n), number: prefix + n, reportDate: iso(4, 0), reportTime: iso(4, 22), ...(key === 'ejournal' ? { startDate: body.startDate, endDate: body.endDate } : {}), ...extra };
      list.push(rec); return s.fail === 'lost' ? { success: false, uncertain: true, message: 'timed out waiting for AIR POS (fake)' } : ok(rec); }; // 'lost': the record IS made, the reply is lost
    return s.delay ? new Promise(r => setTimeout(() => r(run()), s.delay)) : run(); }; // hook /reports-delay?ms=: a slow AIR POS (to press twice while it runs)
  handlers['/RetailReports/GenerateEJournalReport'] = gen('ejournal', 'EJ-FAKE-', { totalAmount: 480, taxableSalesAmount: 430, nonTaxableSalesAmount: 50, taxAmount: 36 });
  handlers['/RetailReports/GenerateDiscountTypeReport'] = gen('discount', 'DT-FAKE-', {});

  // ---- hooks (hook port) ----
  hooks['/reports-state'] = (u, res, f) => res.end(JSON.stringify(S()));
  hooks['/reports-reset'] = (u, res, f) => { f.reports = fresh(); res.end('ok'); };
  hooks['/reports-delay'] = (u, res, f) => { S().delay = Math.min(5000, Math.max(0, Number(u.searchParams.get('ms')) || 0)); res.end('ok'); };
  hooks['/reports-fail'] = (u, res, f) => { { const m = u.searchParams.get('mode'); S().fail = ['error', 'refuse', 'inner', 'refuse500', 'lost', 'silent', 'http500', 'unreadable', 'network'].includes(m) ? m : null; } res.end('ok'); };
};

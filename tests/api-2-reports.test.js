// AirMax API Batch 2 (Reports, shifts, cash records). Part 1: the fake AIR POS answers (tests/fake-api/reports.js). Part 2: the fake server boots with them.
// Part 3: every route of app/api/reports.js over HTTP against the fake server (manager), then a cashier fake (FAKE_CASHIER=1): refused, manager pop-up approves.
// The screen itself is in tests/e2e-api-2-reports.js. Offline, made-up data only; never a real AIR POS.
//   node tests/api-2-reports.test.js     (own ports: API2_PORT default 5228 / hook 5229; cashier fake API2_CASHIER_PORT default 5224 / hook 5225)
'use strict';
const path = require('path'), cp = require('child_process'), fs = require('fs'), os = require('os');
const PORT = Number(process.env.API2_PORT || 5228), HOOK = PORT + 1;
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = value => ({ success: true, value }), J = (p, k) => { try { return JSON.parse(p[k]); } catch { return {}; } };
const mk = () => { const handlers = {}, hooks = {}, fake = {}; require(path.join(__dirname, 'fake-api', 'reports.js'))({ handlers, hooks, fake, ok, J, PRODUCTS: [] }); return { handlers, hooks, fake }; };
const pi = (page, pageSize) => JSON.stringify({ page, pageSize, amount: 0 });
const D = d => { const x = new Date(Date.now() - (7 - d) * 864e5); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }; // same day numbering as tests/fake-api/reports.js
const R = '/RetailReports/', SECRET = 'pw-api2-not-a-real-secret';
(async () => {
  // ---- part 1: the handlers, called directly (no server) ----
  const { handlers: H, hooks, fake } = mk();
  const ALL = ['/RetailSessions/RetailSessionGet', '/RetailSessions/RetailSessionPaged', '/RetailCashTransactions/RetailCashTransactionPaged', R + 'StationZReadReportPaged', R + 'StationZReadReportRecordPaged',
    R + 'SalesReportModelGet', R + 'SalesReportPaged', R + 'ESalesReportPaged', R + 'EJournalReportPaged', R + 'DiscountTypeReportPaged', R + 'GenerateEJournalReport', R + 'GenerateDiscountTypeReport'];
  rec('1 a fake answer exists for every call of the batch (PDF exports 133/136/139 are answered by the fake server\'s fetchPdf)', ALL.every(k => typeof H[k] === 'function'), ALL.filter(k => !H[k]).join(','));
  const sp = H['/RetailSessions/RetailSessionPaged']({ filter: '{}', pageInfo: pi(1, 3) });
  rec('2 105 shift list pages: 3 rows of 7, newest first, total 7', sp.success && sp.rows.length === 3 && sp.total === 7 && sp.rows[0].number > sp.rows[1].number, JSON.stringify({ n: sp.rows.length, t: sp.total }));
  const sp3 = H['/RetailSessions/RetailSessionPaged']({ filter: '{}', pageInfo: pi(3, 3) });
  rec('3 105 last page has the rest (1 row)', sp3.rows.length === 1, String(sp3.rows.length));
  const byNo = H['/RetailSessions/RetailSessionPaged']({ filter: JSON.stringify({ number: sp.rows[0].number }), pageInfo: pi(1, 10) }), byOp = H['/RetailSessions/RetailSessionPaged']({ filter: JSON.stringify({ clockInRetailOperatorName: 'manager' }), pageInfo: pi(1, 10) }), byDay = H['/RetailSessions/RetailSessionPaged']({ filter: JSON.stringify({ clockInDateBegin: D(2), clockInDateEnd: D(3) }), pageInfo: pi(1, 10) });
  rec('4 105 filters as AIR POS has them: number, operator (part of a name), plain dates both ends included; a status key is ignored (no status filter exists)', byNo.rows.length === 1 && byOp.rows.length > 0 && byOp.rows.every(r => /manager/i.test(r.clockInRetailOperatorName)) && byDay.rows.length === 2 && H['/RetailSessions/RetailSessionPaged']({ filter: JSON.stringify({ status: 0 }), pageInfo: pi(1, 10) }).total === 7, '');
  const one = H['/RetailSessions/RetailSessionGet']({ id: sp.rows[0].id });
  rec('5 104 one shift = a bare session (no cash records, no expected amount, no difference), like the real reply', one.success && one.value.id === sp.rows[0].id && !('cashTransactions' in one.value) && !('expectedAmount' in one.value) && 'initialAmount' in one.value, '');
  rec('6 104 unknown id: a clear error, not a throw', H['/RetailSessions/RetailSessionGet']({ id: 'nope' }).success === false, '');
  const ct = H['/RetailCashTransactions/RetailCashTransactionPaged']({ filter: '{}', pageInfo: pi(1, 20) });
  rec('7 110 cash list rows have the real fields: targetNumber, typeName, hasDiff, diffAmount, diffHandled, remark, retailOperatorName, retailSessionNumber', ct.rows.length >= 3 && ct.rows.every(r => ['targetNumber', 'typeName', 'hasDiff', 'diffAmount', 'diffHandled', 'amount', 'balance', 'remark', 'createTime', 'retailOperatorName', 'retailSessionNumber'].every(k => k in r)), '');
  const sn = ct.rows[0].retailSessionNumber; rec('8 110 filter retailSessionNumber returns only that shift; hasDiff filter returns only the short count', H['/RetailCashTransactions/RetailCashTransactionPaged']({ filter: JSON.stringify({ retailSessionNumber: sn }), pageInfo: pi(1, 20) }).rows.every(r => r.retailSessionNumber === sn) && H['/RetailCashTransactions/RetailCashTransactionPaged']({ filter: JSON.stringify({ hasDiff: true }), pageInfo: pi(1, 20) }).rows.length === 1, '');
  const z = H[R + 'StationZReadReportPaged']({ filter: '{}', pageInfo: pi(1, 10) });
  rec('9 118 Z-read list has the saved-sample fields (number, reportDate, netAmount, paymentIncome[])', z.rows.length === 4 && z.rows.every(r => r.number && r.reportDate && 'netAmount' in r && Array.isArray(r.paymentIncome)), '');
  const zr = H[R + 'StationZReadReportRecordPaged']({ filter: JSON.stringify({ reportNumber: z.rows[3].number }), pageInfo: pi(1, 10) });
  rec('10 119 has the same row shape as 118; filtered by reportNumber it gives that Z-read\'s saved copies (two for the first, one for the others)', zr.rows.length === 2 && zr.rows[0].number === z.rows[3].number && H[R + 'StationZReadReportRecordPaged']({ filter: JSON.stringify({ reportNumber: z.rows[0].number }), pageInfo: pi(1, 10) }).rows.length === 1 && H[R + 'StationZReadReportPaged']({ filter: JSON.stringify({ startDate: D(2), endDate: D(3) }), pageInfo: pi(1, 10) }).rows.length === 2, String(zr.rows.length));
  const sl = H[R + 'SalesReportPaged']({ filter: JSON.stringify({ activeTab: 'Product' }), pageInfo: pi(1, 10) }); rec('11 121 gives vendors; 122 gives rows per activeTab (Shift / Vendor / Product / ProductCategory) and obeys productNumber', H[R + 'SalesReportModelGet']({}).value.vendors.length === 2 && sl.rows.length === 2 && H[R + 'SalesReportPaged']({ filter: JSON.stringify({ activeTab: 'Product', productNumber: '9001' }), pageInfo: pi(1, 10) }).rows.length === 1 && H[R + 'SalesReportPaged']({ filter: JSON.stringify({ activeTab: 'Vendor' }), pageInfo: pi(1, 10) }).rows[0].vendorName && H[R + 'SalesReportPaged']({ filter: '{}', pageInfo: pi(1, 10) }).rows[0].sessionNumber, '');
  rec('12 130 / 135 / 138 lists start with 2, 3 and 2 records', H[R + 'ESalesReportPaged']({ pageInfo: pi(1, 10) }).total === 2 && H[R + 'EJournalReportPaged']({ pageInfo: pi(1, 10) }).total === 3 && H[R + 'DiscountTypeReportPaged']({ pageInfo: pi(1, 10) }).total === 2 && H[R + 'EJournalReportPaged']({ filter: JSON.stringify({ reportNumber: 'EJ-FAKE-2' }), pageInfo: pi(1, 10) }).total === 1, '');
  const g1 = H[R + 'GenerateEJournalReport']({ filter: JSON.stringify({ startDate: D(1), endDate: D(3) }) }), g2 = H[R + 'GenerateDiscountTypeReport']({}), g0 = H[R + 'GenerateEJournalReport']({});
  const el = H[R + 'EJournalReportPaged']({ pageInfo: pi(1, 10) }), dl = H[R + 'DiscountTypeReportPaged']({ pageInfo: pi(1, 10) });
  rec('13 134 needs both dates (refuses without); 134 / 137 each add exactly one record to their own list, newest first', !g0.success && g1.success && g2.success && el.total === 4 && dl.total === 3 && el.rows[0].id === g1.value.id && el.rows[0].startDate && dl.rows[0].id === g2.value.id && fake.reports.writes.length === 3, '');
  rec('14 new record ids are unique', new Set([...el.rows, ...dl.rows].map(r => r.id)).size === el.rows.length + dl.rows.length, '');
  hooks['/reports-fail']({ searchParams: new URLSearchParams('mode=error') }, { end() {} }, fake);
  const bad = H[R + 'GenerateEJournalReport']({ filter: JSON.stringify({ startDate: D(1), endDate: D(3) }) });
  rec('15 hook /reports-fail?mode=error: the write answers an error and adds no record', bad.success === false && H[R + 'EJournalReportPaged']({ pageInfo: pi(1, 10) }).total === 4 && fake.reports.writes.length === 4, '');
  let body = ''; hooks['/reports-reset']({ searchParams: new URLSearchParams('') }, { end(x) { body = x; } }, fake);
  rec('16 hook /reports-reset puts the seed data back', body === 'ok' && H[R + 'EJournalReportPaged']({ pageInfo: pi(1, 10) }).total === 3 && fake.reports.writes.length === 0, '');
  const txt = fs.readFileSync(path.join(__dirname, 'fake-api', 'reports.js'), 'utf8');
  rec('17 no URL, token or e-mail address in the fake file (made-up data only)', !/https?:\/\//.test(txt) && !/@[a-z0-9-]+\.[a-z]{2,}/i.test(txt), '');

  // ---- part 1b: what the plugin sends to AIR POS (stub api: records the calls, answers like the real server) ----
  {
    const calls = []; const api = { stationId: 'st-1', operator: 'op-1', async retail(pth, params, opt) { calls.push({ pth, params, opt }); if (/RetailSessionGet/.test(pth)) return { id: 'abc', number: 'RSS7', initialAmount: 1 }; return { success: true, rows: [], total: 0 }; }, async fetchPdf(pth, params, label) { calls.push({ pth, params, pdf: true }); return { success: true, value: Buffer.from('%PDF-1.4 x') }; }, async zReadPaged(f, pg, sz) { calls.push({ pth: 'zread', f, pg, sz }); return { success: true, rows: [], total: 0 }; } };
    const printed = []; const reg = { api, printPdfBase64: async (b, m) => { printed.push(m); return { ok: true, message: m }; } };
    const pl = require(path.join(__dirname, '..', 'app', 'api', 'reports.js'))({ reg, log() {}, needLogin: f => f, isManager: () => true, perms: async () => ({}), hasMenu: () => true, dataDir: os.tmpdir() });
    const last = () => calls[calls.length - 1], F = c => JSON.parse(c.params.filter);
    await pl.routes['reports-shifts']({ number: ' RSS1 ', operator: 'bo', from: '2026-10-02', to: '2026-10-03', status: 0 });
    rec('46 105 request: filter has only the keys AIR POS reads (number, clockInRetailOperatorName, clockInDateBegin, clockInDateEnd), plain dates, a status is not sent', JSON.stringify(Object.keys(F(last())).sort()) === JSON.stringify(['clockInDateBegin', 'clockInDateEnd', 'clockInRetailOperatorName', 'number']) && F(last()).clockInDateBegin === '2026-10-02' && F(last()).number === ' RSS1 '.slice(0, 40), JSON.stringify(F(last())));
    await pl.routes['reports-shift']({ id: 'abc' });
    rec('47 104 then 110 with retailSessionNumber from the session reply', calls.slice(-2)[0].pth === '/RetailSessions/RetailSessionGet' && calls.slice(-2)[0].params.id === 'abc' && F(last()).retailSessionNumber === 'RSS7' && last().pth.endsWith('RetailCashTransactionPaged'), JSON.stringify(calls.slice(-2).map(c => c.pth)));
    await pl.routes['reports-cash']({ number: 'RSS1', hasDiff: true, from: '2026-10-02' });
    rec('48 110 request keys: createDateBegin, createDateEnd, type, hasDiff, retailOperatorName, retailSessionNumber', JSON.stringify(Object.keys(F(last())).sort()) === JSON.stringify(['createDateBegin', 'createDateEnd', 'hasDiff', 'retailOperatorName', 'retailSessionNumber', 'type']) && F(last()).retailSessionNumber === 'RSS1' && F(last()).hasDiff === true, JSON.stringify(F(last())));
    await pl.routes['reports-zreads']({ number: 'ZR1' }); const zc = last();
    await pl.routes['reports-zrecords']({ number: 'ZR1' });
    rec('49 118 (through zReadPaged) and 119 send reportNumber / startDate / endDate (+ posNumber)', zc.f.reportNumber === 'ZR1' && 'startDate' in zc.f && 'endDate' in zc.f && F(last()).reportNumber === 'ZR1' && last().pth.endsWith('StationZReadReportRecordPaged'), JSON.stringify(F(last())));
    await pl.routes['reports-sales']({ tab: 'Vendor', vendorId: 'v1', from: '2026-10-01', to: '2026-10-07' }); const sf = F(last());
    await pl.routes['reports-sales']({ tab: 'nonsense' });
    rec('50 122 request: activeTab is one of Shift / Vendor / Product / ProductCategory (anything else becomes Shift), dates as retailOrderDateBegin / End, excludeNoTransactions', sf.activeTab === 'Vendor' && sf.vendorId === 'v1' && sf.retailOrderDateBegin === '2026-10-01' && sf.excludeNoTransactions === true && F(last()).activeTab === 'Shift', JSON.stringify(sf));
    await pl.routes['reports-esales']({ number: 'E1', from: '2026-10-01' }); const ef = F(last());
    rec('51 130 / 135 / 138 filter: reportNumber, startDate, endDate', JSON.stringify(Object.keys(ef).sort()) === JSON.stringify(['endDate', 'reportNumber', 'startDate']) && ef.reportNumber === 'E1' && ef.endDate === null, JSON.stringify(ef));
    calls.length = 0;
    await pl.routes['reports-print-esales']({ id: 'e1' }); const c133 = calls.find(c => c.pdf);
    await pl.routes['reports-print-ejournal']({ id: 'j1' }); const c136 = calls.filter(c => c.pdf)[1];
    await pl.routes['reports-print-discount']({ id: 'd1', discountType: 30 }); const c139 = calls.filter(c => c.pdf)[2];
    rec('52 PDF requests: 133 {id, isPrint:false, stationId, operator}, 136 the same, 139 adds discountType; all three printed', c133.pth.endsWith('ESalesProductReportExport') && c133.params.id === 'e1' && c133.params.isPrint === 'false' && c133.params.stationId === 'st-1' && c133.params.operator === 'op-1' && c136.pth.endsWith('EJournalReportExport') && c136.params.id === 'j1' && c139.pth.endsWith('DiscountTypeReportExport') && c139.params.id === 'd1' && c139.params.discountType === 30 && printed.length === 3, JSON.stringify([c133.params, c139.params]));
    calls.length = 0;
    await pl.routes['reports-ejournal-generate']({ from: '2026-10-01', to: '2026-10-03' }); const gw = calls.find(c => /GenerateEJournalReport/.test(c.pth));
    await pl.routes['reports-discount-generate']({}); const gd = calls.find(c => /GenerateDiscountTypeReport/.test(c.pth));
    rec('53 134 sends form field filter={startDate,endDate}; 137 sends nothing; each write is called once', JSON.parse(gw.params.filter).startDate === '2026-10-01' && JSON.parse(gw.params.filter).endDate === '2026-10-03' && Object.keys(gd.params || {}).length === 0 && calls.filter(c => /Generate/.test(c.pth)).length === 2, JSON.stringify(gw.params));
  }

  // ---- part 2: the real fake server still boots with this file in tests/fake-api (own port, hook on) ----
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'api2-')), 'srv.log');
  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: String(HOOK), AIRMAX_TEST_PW: SECRET }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });

  // ---- part 3 ----
  async function part3() {
    const B = 'http://127.0.0.1:' + PORT, HK = 'http://127.0.0.1:' + HOOK;
    const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
    const st = () => fetch(HK + '/reports-state').then(r => r.json());
    const setFail = m => fetch(HK + '/reports-fail?mode=' + m).then(r => r.text());
    await post('logout');
    rec('21 a route answers only when logged in (needLogin)', (await fetch(B + '/api/reports-shifts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json())).ok === false, '');
    await post('login', { company: 'fake shop', user: 'tester', password: SECRET }); await fetch(HK + '/reports-reset');
    const sh = await post('reports-shifts', { page: 1, pageSize: 3 });
    rec('22 reports-shifts (105): ok, 3 of 7 rows, normalized fields only (no raw AIR POS names)', sh.ok && sh.rows.length === 3 && sh.total === 7 && ['id', 'number', 'operator', 'clockIn', 'opening', 'status'].every(k => k in sh.rows[0]) && !('clockInOperatorName' in sh.rows[0]), JSON.stringify(sh).slice(0, 120));
    const one = await post('reports-shift', { id: sh.rows[2].id });
    rec('23 reports-shift (104 + 110 by shift number): the shift and its cash records (opening count, collection, closing count)', one.ok && one.shift.id === sh.rows[2].id && Array.isArray(one.cash) && one.cash.length === 3 && one.cash.every(c => c.shiftNumber === one.shift.number), JSON.stringify(one).slice(0, 100));
    const three = (await post('reports-shifts', { page: 1, pageSize: 10 })).rows.find(r => /900003$/.test(r.number));
    const d3 = await post('reports-shift', { id: three.id });
    rec('24 the shift with a short count shows difference -5 (from its cash record)', d3.ok && d3.difference === -5 && d3.cash.some(c => c.hasDiff && c.difference === -5 && c.handled === false), JSON.stringify(d3.difference));
    rec('25 reports-shift without an id / with an unknown id: a clear message, ok false', (await post('reports-shift', {})).ok === false && (await post('reports-shift', { id: 'nope' })).ok === false, '');
    const op = await post('reports-shifts', { number: three.number }), op2 = await post('reports-shifts', { operator: 'manager', from: D(1), to: D(7) }), op3 = await post('reports-shifts', { from: D(2), to: D(3) });
    rec('26 shift no., operator and date filters are passed through (1 row, some rows, 2 rows); a bad date is ignored, not sent', op.ok && op.rows.length === 1 && op2.ok && op2.rows.length > 0 && op3.rows.length === 2 && (await post('reports-shifts', { from: 'x; drop', to: '2026-13' })).total === 7, '');
    const cash = await post('reports-cash', { page: 1, pageSize: 50 }), cs = await post('reports-cash', { number: three.number }), cd = await post('reports-cash', { hasDiff: true });
    rec('27 reports-cash (110): rows with type, amount, balance, time, operator; filters by shift no. and by differences', cash.ok && cash.total === 19 && cash.rows.every(r => r.type && 'amount' in r && 'time' in r && 'operator' in r) && cs.rows.length === 3 && cd.rows.length === 1 && cd.rows[0].difference === -5, JSON.stringify([cash.total, cs.rows && cs.rows.length, cd.rows && cd.rows.length]));
    const zs = await post('reports-zreads', {});
    rec('28 reports-zreads (118, through the existing zReadPaged): 4 rows with number, date, net', zs.ok && zs.rows.length === 4 && zs.rows.every(r => r.number && r.date && typeof r.net === 'number'), '');
    const zr = await post('reports-zrecords', { number: zs.rows[3].number }), zf = await post('reports-zreads', { number: zs.rows[0].number });
    rec('29 reports-zrecords (119): the 2 saved copies of the first Z-read, 1 of another, a Z-read number is needed; reports-zreads filters by number', zr.ok && zr.rows.length === 2 && (await post('reports-zrecords', { number: zs.rows[0].number })).rows.length === 1 && (await post('reports-zrecords', {})).ok === false && zf.rows.length === 1, '');
    const sm = await post('reports-sales-model', {}), sa = await post('reports-sales', { tab: 'Product' }), sv = await post('reports-sales', { tab: 'Vendor' }), sp1 = await post('reports-sales', { tab: 'Product', vendorId: sm.vendors && sm.vendors[0] && sm.vendors[0].id }), es = await post('reports-esales', {});
    rec('30 reports-sales-model (121): vendors; reports-sales (122) per tab, labelled by number+name / vendor; reports-esales (130)', sm.ok && sm.vendors.length === 2 && sa.ok && sa.rows.length === 2 && sa.rows[0].label === '9001' && sa.rows[0].label2 && sv.rows[0].label === 'Fake Vendor Co' && sp1.rows.length === 1 && es.ok && es.rows.length === 2 && es.rows[0].number && es.rows[0].total > 0, JSON.stringify([sm.ok, sa.rows && sa.rows.length, sp1.rows && sp1.rows.length]));
    const ej = await post('reports-ejournal', {}), dt = await post('reports-discount', {});
    rec('31 reports-ejournal (135) 3 rows, reports-discount (138) 2 rows', ej.ok && ej.rows.length === 3 && dt.ok && dt.rows.length === 2, '');
    const pdfs0 = (await fetch(HK + '/pdfs').then(r => r.json())).length;
    const p1 = await post('reports-print-ejournal', { id: ej.rows[0].id }), p2 = await post('reports-print-discount', { id: dt.rows[0].id, discountType: 20 }), p3 = await post('reports-print-esales', { id: es.rows[0].id });
    const pdfs = await fetch(HK + '/pdfs').then(r => r.json());
    rec('32 the three PDF routes (136, 139, 133) each fetch their PDF exactly once and hand it to the printer path', pdfs.length === pdfs0 + 3 && /EJournalReportExport/.test(pdfs[pdfs0].path) && /DiscountTypeReportExport/.test(pdfs[pdfs0 + 1].path) && /ESalesProductReportExport/.test(pdfs[pdfs0 + 2].path) && [p1, p2, p3].every(x => typeof x.ok === 'boolean'), JSON.stringify([p1.message, p2.message, p3.message]));
    rec('33 a PDF route without an id (136), a discount PDF without a valid type (139) or with a made-up type: refused before anything is fetched', (await post('reports-print-ejournal', {})).ok === false && (await post('reports-print-discount', { id: dt.rows[0].id })).ok === false && (await post('reports-print-discount', { id: dt.rows[0].id, discountType: 99 })).ok === false && (await fetch(HK + '/pdfs').then(r => r.json())).length === pdfs0 + 3, '');
    // writes
    const GD = { from: D(1), to: D(3) }; const w0 = await post('reports-ejournal-generate', {}), w0b = await post('reports-ejournal-generate', { from: D(5), to: D(1) }), s0 = await st(); const w1 = await post('reports-ejournal-generate', GD), s1 = await st();
    rec('34 134 generate: needs both dates and from <= to (refused, nothing sent); with dates ok, ONE write carrying startDate/endDate, list now 4, no other list changed', !w0.ok && !w0b.ok && s0.writes.length === 0 && w1.ok && s1.writes.length === 1 && s1.writes[0].body.startDate === D(1) && s1.writes[0].body.endDate === D(3) && s1.ejournal.length === 4 && s1.discount.length === 2, JSON.stringify(w1).slice(0, 100));
    const w2 = await post('reports-discount-generate', {}), s2 = await st();
    rec('35 137 generate: ok, ONE more write, discount list now 3', w2.ok && s2.writes.length === 2 && s2.discount.length === 3 && s2.ejournal.length === 4, '');
    await setFail('error'); const w3 = await post('reports-ejournal-generate', GD), s3 = await st();
    rec('36 AIR POS refuses (clear error): ok false, "Not created: <AIR POS message>", not the cautious text, one attempt only (never retried), list unchanged', !w3.ok && !w3.unknown && w3.refused === true && w3.message === 'Not created: Could not generate the report (fake error)' && !/No clear answer|Check the list/.test(w3.message) && s3.writes.length === 3 && s3.ejournal.length === 4, JSON.stringify(w3).slice(0, 140));
    await setFail('lost'); const w4 = await post('reports-ejournal-generate', GD), s4 = await st();
    rec('37 reply lost but the record was made: the list is re-read and it counts as done, still ONE attempt', w4.ok && /reply was lost/.test(w4.message) && s4.writes.length === 4 && s4.ejournal.length === 5, JSON.stringify(w4).slice(0, 140));
    await setFail('silent'); const w5 = await post('reports-discount-generate', {}), s5 = await st();
    rec('38 reply lost and nothing new in the list: "unknown" (check the list), never a retry, never a guess', !w5.ok && w5.unknown === true && /did not retry/.test(w5.message) && s5.writes.length === 5 && s5.discount.length === 3, JSON.stringify(w5).slice(0, 140));
    await setFail('off');
    await fetch(HK + '/reports-delay?ms=500');
    const [a, b2, c] = await Promise.all([post('reports-ejournal-generate', GD), post('reports-ejournal-generate', GD), post('reports-ejournal-generate', GD)]), s6 = await st(); await fetch(HK + '/reports-delay?ms=0');
    rec('39 three presses at once make ONE record (the others are refused as busy)', s6.writes.length === 6 && s6.ejournal.length === 6 && [a, b2, c].filter(x => x.ok).length === 1 && [a, b2, c].filter(x => x.busy).length === 2, JSON.stringify([a.ok, b2.ok, c.ok]) + ' ' + [a, b2, c].map(x => x.busy || '').join());
    // ---- refusal vs real uncertainty (fresh state: ejournal 3, discount 2) ----
    // clear refusals in other shapes (137 too), each ONE attempt, list re-read, nothing created
    await fetch(HK + '/reports-reset'); await setFail('off'); let nw = 0; const refusals = [];
    for (const [mode, route, body, want] of [['refuse', 'reports-discount-generate', {}, 'Not created: Product 00001 is missing the share configuration (fake refusal)'], ['inner', 'reports-ejournal-generate', GD, 'Not created: The report could not be created (fake failed status)'], ['refuse500', 'reports-discount-generate', {}, 'Not created: Report service error: no sales in range (fake HTTP 500 with a message)']]) {
      await setFail(mode); const x = await post(route, body), sx = await st(); nw++;
      refusals.push([mode, !x.ok && x.refused === true && !x.unknown && x.message === want && !/No clear answer/.test(x.message) && sx.writes.length === nw && sx.ejournal.length === 3 && sx.discount.length === 2]);
    }
    rec('36b clear refusals (AIR POS error message with a failed status, a failed status inside the reply, a server error that carries a message) all say "Not created: <message>", on 134 and 137, one attempt each, nothing made', refusals.every(x => x[1]), JSON.stringify(refusals));
    // real uncertainty keeps the cautious text, never "Not created"
    const unsure = [];
    for (const mode of ['http500', 'unreadable', 'network', 'silent']) {
      await setFail(mode); const x = await post('reports-discount-generate', {}), sx = await st(); nw++;
      unsure.push([mode, !x.ok && x.unknown === true && !x.refused && /^No clear answer from AIR POS/.test(x.message) && /It may have been made\. Check the list before trying again/.test(x.message) && !/Not created/.test(x.message) && sx.writes.length === nw && sx.discount.length === 2]);
    }
    rec('36c real uncertainty (HTTP 500 with no message, unreadable reply, network error, timeout) keeps the cautious "No clear answer... Check the list before trying again" text, one attempt each, never "Not created"', unsure.every(x => x[1]), JSON.stringify(unsure));
    await setFail('off'); await fetch(HK + '/reports-reset');
    { const sec = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'sections', 'reports.js'), 'utf8');
      rec('36d the Reports screen shows generate / print results in its own visible notice (the app toast is on Checkout), and never retries by itself', /id="rpNotice"/.test(sec) && /function notice\(/.test(sec) && !/ctx\.toast\((?!m,)/.test(sec) && (sec.match(/api\(gen\.route/g) || []).length === 1, ''); }
    rec('40 the plugin lists its routes as unlocked reads / once writes / no snapshot (BATCH-INTERFACE)', (() => { const pl = require(path.join(__dirname, '..', 'app', 'api', 'reports.js'))({ reg: { api: {} }, log() {}, needLogin: f => f, isManager: () => true, perms: async () => ({}), hasMenu: () => true, dataDir: os.tmpdir() }); return pl.unlocked.length === 10 && pl.once.includes('reports-ejournal-generate') && pl.once.includes('reports-discount-generate') && !pl.unlocked.some(n => /generate|print/.test(n)) && Object.keys(pl.routes).length === 15 && pl.noSnap.length === 15; })(), '');
    // cashier fake
    const CP = Number(process.env.API2_CASHIER_PORT || 5224), CH = CP + 1, CB = 'http://127.0.0.1:' + CP;
    const csrv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(CP), FAKE_HOOK_PORT: String(CH), FAKE_CASHIER: '1', AIRMAX_TEST_PW: SECRET }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
    try {
      let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(CB + '/api/shortcuts'); up = true; } catch { await sleep(250); } }
      const cpost = (r, x) => fetch(CB + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
      await cpost('login', { company: 'fake shop', user: 'tester', password: SECRET });
      const perms = await fetch(CB + '/api/state').then(r => r.json());
      const r1 = await cpost('reports-shifts', {}), r2 = await cpost('reports-ejournal-generate', GD);
      rec('41 a cashier (not a manager) is refused every route with needManager, nothing written', r1.ok === false && r1.needManager === true && r2.ok === false && r2.needManager === true && (await fetch('http://127.0.0.1:' + CH + '/reports-state').then(r => r.json())).writes.length === 0, JSON.stringify([r1.needManager, r2.needManager]));
      const r3 = await cpost('reports-ejournal-generate', { ...GD, user: 'boss', password: 'wrong-pw' });
      rec('42 a wrong manager password is refused, nothing written', r3.ok === false && r3.needManager === true && (await fetch('http://127.0.0.1:' + CH + '/reports-state').then(r => r.json())).writes.length === 0, JSON.stringify(r3).slice(0, 100));
      const r4 = await cpost('reports-ejournal-generate', { ...GD, user: 'boss', password: 'boss-pw' });
      rec('43 the manager\'s user + password on the pop-up approves ONE generate for the cashier', r4.ok === true && (await fetch('http://127.0.0.1:' + CH + '/reports-state').then(r => r.json())).writes.length === 1, JSON.stringify(r4).slice(0, 100));
      const r5 = await cpost('reports-shifts', {});
      rec('44 that approval is not kept: the next request from the cashier is refused again', r5.ok === false && r5.needManager === true, '');
    } finally { csrv.kill(); }
    await sleep(300);
    const logTxt = fs.readFileSync(log, 'utf8');
    rec('45 the server log never holds the passwords (login, manager pop-up) or any operator name', !logTxt.includes(SECRET) && !logTxt.includes('boss-pw') && !logTxt.includes('wrong-pw') && !/Test Cashier|Test Manager/.test(logTxt), 'log lines: ' + logTxt.split('\n').length);
  }
  try {
    let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch('http://127.0.0.1:' + PORT + '/api/shortcuts'); up = true; } catch { await sleep(250); } }
    rec('18 the fake server starts with tests/fake-api/reports.js loaded', up, '');
    const st = await fetch('http://127.0.0.1:' + HOOK + '/reports-state').then(r => r.json()).catch(e => ({ err: String(e) }));
    rec('19 hook /reports-state answers with the seed lists', Array.isArray(st.ejournal) && st.ejournal.length === 3 && Array.isArray(st.discount) && st.discount.length === 2, JSON.stringify(st).slice(0, 80));
    await fetch('http://127.0.0.1:' + PORT + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: 'fake shop', user: 'tester', password: SECRET }) }).catch(() => {});
    const zl = await fetch('http://127.0.0.1:' + PORT + '/api/state').then(r => r.json()).catch(() => ({}));
    rec('20 the built-in register still answers state after login (loader did not break the fake)', zl && zl.loggedIn === true, '');
    await part3();
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 300)); }
  finally { srv.kill(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

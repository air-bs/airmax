// 1.0.11 instant scan, store size (owner: about 38,000 items). OFFLINE fake AIR POS with FAKE_PRODUCTS=38000 (made-up products) and
// a simulated AIR POS round trip (FAKE_LATENCY_MS). Measures: startup download (paged, in the background), pages, size on disk,
// server memory, scan time (instant vs the old AIR POS lookup), search time; and checks scans go the old way until the list is complete.
//   AIRREG_DEV_PROBE=1 FAKE_PRODUCTS=38000 FAKE_LATENCY_MS=150 FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/instant-38k.js
'use strict';
const fs = require('fs');
const FP = Number(process.env.FAKE_PORT || 5180), B = 'http://127.0.0.1:' + FP, H = 'http://127.0.0.1:' + (Number(process.env.FAKE_HOOK_PORT) || FP + 1);
const N = Number(process.env.EXPECT_PRODUCTS || 38000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(B + '/api/state').then(r => r.json());
const timed = async f => { const t = Date.now(); const r = await f(); return [Date.now() - t, r]; };
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
(async () => {
  const R = {};
  try {
    await post('login', { company: 'fake shop', user: 'tester', password: 'test-pw' }); await post('instant-scan', { on: false }); await post('new-sale');
    const mem0 = await post('dev-fault', {});
    // the old way (setting off): 10 scans of list items, each one AIR POS lookup + total
    const old = []; for (let i = 0; i < 10; i++) old.push((await timed(() => post('scan', { code: String(300000 + i * 3001) })))[0]);
    const [oldSearch] = await timed(() => post('search', { keyword: 'product 3700' })); await post('new-sale');
    // switch on: the list downloads in pages in the background
    const t0 = Date.now(); const on = await post('instant-scan', { on: true });
    const [busyScanMs, busyScan] = await timed(() => post('scan', { code: '300005' })); // during the download: the old way, no waiting on the list
    const st1 = await state();
    rec('While the list is loading, a scan goes the old way at once (AIR POS lookup) and the register keeps answering', on.ok && busyScan.ok && !busyScan.instant && !st1.instant.ready && busyScanMs < 5000, `scan ${busyScanMs} ms, loading ${JSON.stringify(st1.instant.loading)}`);
    let s; for (;;) { s = (await state()).instant; if (s.ready || Date.now() - t0 > 600000) break; await sleep(250); }
    const loadMs = Date.now() - t0, st = s.stats || {};
    R.download = { ms: st.ms, wallMs: loadMs, pages: st.pages, products: st.count, diskKB: Math.round((st.bytes || 0) / 1024) };
    rec(`Startup download of ${N} products: complete, paged (500 per call), in the background`, s.ready && s.count >= N && s.count <= N + 10 && st.pages === Math.ceil(s.count / 500), JSON.stringify(R.download));
    const paged = await fetch(H + '/paged').then(r => r.json()); const pg = paged.filter(x => x.k === '');
    rec('Only ProductPaged pages were read for the list (keyword "", page 1..n, 500 each); no giant single call', pg.length === st.pages && pg.every((x, i) => x.sz === 500 && x.pg === i + 1), pg.length + ' pages');
    const mem1 = await post('dev-fault', {});
    R.memoryMB = { rssBefore: +(mem0.rss / 1048576).toFixed(1), rssAfter: +(mem1.rss / 1048576).toFixed(1), heapBefore: +(mem0.heap / 1048576).toFixed(1), heapAfter: +(mem1.heap / 1048576).toFixed(1) };
    await post('new-sale');
    // instant: 20 scans spread over the list (codes and UPCs)
    const fast = []; for (let i = 0; i < 20; i++) { const c = i % 2 ? String(2000000000000 + i * 1871) : String(300000 + i * 1871); const [ms, r] = await timed(() => post('scan', { code: c })); if (r.instant) fast.push(ms); }
    for (let k = 0; k < 400 && (await state()).instant.pending; k++) await sleep(50);
    const s2 = await state();
    R.scanMs = { oldMedian: med(old), oldMax: Math.max(...old), instantMedian: med(fast), instantMax: Math.max(...fast), instantCount: fast.length };
    rec('Scan from the list: every scan instant, median well under the old AIR POS lookup; all lines then confirmed by AIR POS', fast.length === 20 && med(fast) < med(old) && s2.cart.length === 20 && !s2.instant.pending, JSON.stringify(R.scanMs));
    const srch = []; for (const k of ['product 3700', 'blue', 'zz-nothing', '2000000001871', '317000']) srch.push((await timed(() => post('search', { keyword: k })))[0]);
    const sr = await post('search', { keyword: 'product 3700' });
    R.searchMs = { oldOne: oldSearch, instantMedian: med(srch), instantMax: Math.max(...srch), results: sr.total };
    rec('Search from the list: results with prices at once', sr.instant && sr.rows.length > 0 && sr.rows.every(x => x.price > 0) && Math.max(...srch) < 1000, JSON.stringify(R.searchMs));
    console.log('RESULTS ' + JSON.stringify(R));
    if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(R, null, 1));
    await post('new-sale'); await post('instant-scan', { on: false });
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

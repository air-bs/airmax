// 1.0.11-speed.1 timing: the real app server + offline fake AIR POS with the latencies measured on TestShop (Nov 1 ~5:05 PM ET):
// item look-up 270 ms, total check 180 ms, in-stock search 280 ms. Acts like the register page: each add, then the in-stock note
// fired without waiting (stockPeek), then the next add. Usage: node add-speed-1011-bench.js <appRoot> <port> <label>
'use strict';
const { spawn } = require('child_process'), path = require('path');
const PAR = process.argv[5] === 'parallel', ROOT = process.argv[2], PORT = Number(process.argv[3] || 5193), LABEL = process.argv[4] || 'run', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const st = () => fetch(BASE + '/api/state').then(r => r.json());
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const srv = spawn(process.execPath, [path.join(ROOT, 'tests', 'look-fake.js')], { cwd: ROOT, env: { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: 'off', FAKE_SCAN_DELAY: '270', FAKE_PROMO_DELAY: '180', FAKE_STOCK_DELAY: '280' }, stdio: 'ignore' });
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p90 = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
async function totalReady() { for (;;) { const s = await st(); if (!(s.totals && (s.totals.updating))) return s; await sleep(10); } }
(async () => {
  for (let i = 0; i < 60; i++) { try { await st(); break; } catch { await sleep(200); } }
  await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
  const codes = ['1001', '1003', '1004', '1001', '1003'];
  // A) one add at a time on an idle register (cashier pauses between items): 15 adds
  const A = { lineShown: [], totalReady: [], stockNote: [], allDone: [] };
  for (let i = 0; i < 15; i++) {
    await post('new-sale').catch(() => {}); if (i % 5 !== 0) { /* keep a few lines in the sale */ }
    const t0 = now(); let tNote = null, pn = null; const note = () => post('stock-note', { code: codes[i % 5] }).then(() => { tNote = now() - t0; });
    if (PAR) pn = note(); // 1.0.11-speed.1 page: in-stock look-up starts with the add
    const r = await post('scan', { code: codes[i % 5] }); await st(); const tLine = now() - t0; // act(): scan + refresh
    if (!PAR) pn = note(); // 1.0.10 page: after the add answered
    const s = await totalReady(); const tTot = now() - t0; await pn;
    if (!r.ok) throw new Error('scan failed ' + JSON.stringify(r));
    A.lineShown.push(tLine); A.totalReady.push(tTot); A.stockNote.push(tNote); A.allDone.push(Math.max(tTot, tNote));
    await sleep(300);
  }
  // B) 10 fast scans in a row (scanner queue): next scan goes as soon as the last one answered, stock note fired each time
  const B = [];
  for (let k = 0; k < 3; k++) {
    await post('new-sale'); const t0 = now(); const notes = [];
    for (let i = 0; i < 10; i++) { if (PAR) notes.push(post('stock-note', { code: codes[i % 5] })); const r = await post('scan', { code: codes[i % 5] }); await st(); if (!r.ok) throw new Error('burst scan failed'); if (!PAR) notes.push(post('stock-note', { code: codes[i % 5] })); }
    const tLines = now() - t0; const s = await totalReady(); const tTot = now() - t0; await Promise.all(notes); const tAll = now() - t0;
    B.push({ allLinesShown: Math.round(tLines), finalTotal: Math.round(tTot), allNotes: Math.round(tAll), due: s.totals.due, rows: s.cart.length });
    await sleep(500);
  }
  await post('new-sale');
  const sum = a => ({ median: Math.round(med(a)), p90: Math.round(p90(a)) });
  const res = { label: LABEL, stockNoteStarts: PAR ? 'with the add' : 'after the add', latencies: 'lookup 270 / total check 180 / stock search 280 ms', single: { lineShown: sum(A.lineShown), totalReady: sum(A.totalReady), stockNote: sum(A.stockNote), everythingDone: sum(A.allDone) }, burst10: B };
  console.log(JSON.stringify(res, null, 1)); srv.kill(); process.exit(0);
})().catch(e => { console.error('crash', e); srv.kill(); process.exit(1); });

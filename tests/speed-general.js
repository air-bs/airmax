// General speed measurements (claude/speed-general). Offline only: the fake AIR POS with an added answer time (FAKE_LATENCY_MS,
// default here 150 ms per AIR POS call, like a real store), never a live store, no card. Measures, does not change anything:
// app start, page load, typing lag (scan box), quick search, Product search (Ctrl+F), adding items, opening History / Customer /
// Settings, and the customer lookup. Prints a table and writes tests/speed-general-results.json (median of RUNS).
// Run: FAKE_PORT=5190 CHROME_URL=http://127.0.0.1:9440 node tests/speed-general.js   (starts its own fake on FAKE_PORT)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const FP = Number(process.env.FAKE_PORT || 5190), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const LAT = Number(process.env.SPEED_LATENCY_MS || 150), RUNS = Number(process.env.SPEED_RUNS || 5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.json());
const calls = () => fetch(HOOK + '/all-calls').then(r => r.json()).then(l => l.length);
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const M = {}; const put = (k, v, extra) => { (M[k] = M[k] || { ms: [], ...(extra || {}) }).ms.push(Math.round(v)); if (extra) Object.assign(M[k], extra); };

(async () => {
  let fake; const startFake = async () => {
    const t0 = Date.now();
    fake = spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(FP), FAKE_LATENCY_MS: String(LAT) }, stdio: 'ignore' });
    for (;;) { try { await fetch(BASE + '/api/state'); break; } catch { await sleep(10); } }
    return Date.now() - t0;
  };
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9440', defaultViewport: { width: 1366, height: 768 } });
  try {
    for (let run = 0; run < RUNS; run++) {
      put('server start (spawn -> first answer)', await startFake());
      const c0 = await calls(), tl = Date.now(); await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' });
      put('login (API)', Date.now() - tl, { airposCalls: (await calls()) - c0 });
      const p = await b.newPage();
      let apiN = 0; p.on('request', q => { if (/\/api\//.test(q.url())) apiN++; });
      const tp = Date.now(); await p.goto(BASE + '/');
      await p.waitForFunction(() => typeof S !== 'undefined' && S.loggedIn && document.activeElement && document.activeElement.id === 'scanInput' && document.querySelector('#actions [data-a]'), { timeout: 30000, polling: 10 });
      put('page load -> sale screen ready (scan box focused)', Date.now() - tp, { apiCalls: apiN });
      await sleep(1500); // let the start-up reads settle

      // typing lag: 13 characters into the scan box, time spent in the page's key handlers per key
      const lag = await p.evaluate(async () => {
        const i = document.getElementById('scanInput'); i.focus(); i.value = ''; const out = [];
        for (const ch of '0123456789012') { const t = performance.now(); i.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); i.value += ch; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); await new Promise(r => requestAnimationFrame(() => r())); out.push(performance.now() - t); }
        i.value = ''; return out;
      });
      put('typing lag: key -> next frame, scan box (median of 13 keys)', med(lag));

      // quick search (right panel): type "toy" at 60 ms per key, time from the last key to the results, AIR POS calls used
      let c1 = await calls(); await p.click('#qsIn', { clickCount: 3 }); await p.keyboard.press('Backspace'); await sleep(400); c1 = await calls();
      let t = Date.now(); for (const ch of 'toy') { await p.keyboard.type(ch); await sleep(60); }
      const tk = Date.now(); await p.waitForFunction(() => /Toy car/.test(document.getElementById('qsRes').innerText), { timeout: 20000, polling: 5 });
      put('quick search: last key -> results', Date.now() - tk, { airposCalls: (await calls()) - c1 });
      await p.keyboard.press('Escape'); await sleep(300);

      // Product search window (Ctrl+F): open, type "rope", results
      await p.focus('#scanInput'); t = Date.now(); await p.keyboard.down('Control'); await p.keyboard.press('KeyF'); await p.keyboard.up('Control');
      await p.waitForFunction(() => document.getElementById('sIn') && document.activeElement && document.activeElement.id === 'sIn', { timeout: 20000, polling: 5 });
      put('open Product search (Ctrl+F)', Date.now() - t);
      c1 = await calls(); for (const ch of 'rope') { await p.keyboard.type(ch); await sleep(60); } const ts = Date.now();
      await p.waitForFunction(() => { const r = [...document.querySelectorAll('#sRes tr.row')]; return r.length === 1 && /Rope/.test(r[0].innerText); }, { timeout: 20000, polling: 5 }); // the window lists every item first
      put('Product search: last key -> results', Date.now() - ts, { airposCalls: (await calls()) - c1 });
      await p.keyboard.press('Escape'); await sleep(400);

      // adding items: scan -> the line is on screen (3 scans)
      for (const code of ['1001', '1003', '1004']) {
        await p.focus('#scanInput'); const n0 = await p.$$eval('#cart tr.row', x => x.length); c1 = await calls();
        t = Date.now(); await p.keyboard.type(code); await p.keyboard.press('Enter');
        await p.waitForFunction(n => document.querySelectorAll('#cart tr.row').length > n, { timeout: 20000, polling: 5 }, n0);
        put('add item: Enter -> line on screen', Date.now() - t, { airposCalls: (await calls()) - c1 });
        await sleep(600);
      }
      // scanner speed: 3 barcodes back to back (no pause) -> all 3 lines on screen
      await post('new-sale'); await p.evaluate(() => refresh()); await sleep(500); await p.focus('#scanInput'); c1 = await calls(); t = Date.now();
      for (const code of ['1001', '1003', '1004']) { await p.keyboard.type(code); await p.keyboard.press('Enter'); }
      await p.waitForFunction(() => document.querySelectorAll('#cart tr.row').length === 3, { timeout: 30000, polling: 5 });
      put('3 fast scans (scanner, back to back) -> 3 lines on screen', Date.now() - t, { airposCalls: (await calls()) - c1 });
      await sleep(800);
      // a long sale: 60 lines, then the 15 s background refresh and typing while it runs (browser work, layout included)
      await post('new-sale'); for (let i = 0; i < 60; i++) await post('temp-item', { price: 1 + i / 100, name: 'Line ' + i });
      await p.evaluate(() => refresh()); await sleep(800);
      const long = await p.evaluate(async () => { const a = [], k = [];
        for (let i = 0; i < 9; i++) { const s = performance.now(); await refresh(); document.body.getBoundingClientRect(); a.push(performance.now() - s); }
        const inp = document.getElementById('scanInput'); inp.focus();
        for (let i = 0; i < 9; i++) { const r = refresh(); const s = performance.now(); inp.value += '1'; inp.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(z => requestAnimationFrame(() => setTimeout(z, 0))); k.push(performance.now() - s); await r; }
        inp.value = ''; a.sort((x, y) => x - y); k.sort((x, y) => x - y); return { refresh: a[4], key: k[4] }; });
      put('60-line sale: background refresh (unchanged sale), layout included', long.refresh);
      put('60-line sale: a key typed during a refresh -> on screen', long.key);
      await post('new-sale'); await p.evaluate(() => refresh()); await sleep(500);
      // History (Ctrl+L), Customer (F3), Settings (Ctrl+,): key -> window shown with its content
      const openTime = async (label, keys, ready) => {
        await p.focus('#scanInput'); const c = await calls(); const t0 = Date.now();
        for (const k of keys.slice(0, -1)) await p.keyboard.down(k); await p.keyboard.press(keys[keys.length - 1]); for (const k of keys.slice(0, -1).reverse()) await p.keyboard.up(k);
        await p.waitForFunction(ready, { timeout: 30000, polling: 5 });
        put(label, Date.now() - t0, { airposCalls: (await calls()) - c });
        await p.keyboard.press('Escape'); await sleep(500);
      };
      await openTime('open History (Ctrl+L) -> list shown', ['Control', 'KeyL'], () => /Order History/.test((document.getElementById('modalRoot') || {}).innerText || '') && document.querySelector('#modalRoot table tbody'));
      await openTime('open Customer (F3) -> search box', ['F3'], () => !!document.getElementById('mQ'));
      await openTime('open Settings (Ctrl+,) -> page shown', ['Control', 'Comma'], () => !!document.getElementById('stTabs'));
      // customer lookup: F3, type a name, Enter -> results (two made-up customers match "sample" / "a")
      await p.focus('#scanInput'); await p.keyboard.press('F3'); await p.waitForFunction(() => !!document.getElementById('mQ'), { polling: 5 });
      await p.keyboard.type('Sample'); c1 = await calls(); t = Date.now(); await p.keyboard.press('Enter');
      await p.waitForFunction(() => { const m = document.getElementById('mMsg'); return (m && /found/.test(m.innerText)) || !document.getElementById('mQ'); }, { timeout: 30000, polling: 5 });
      put('customer lookup: Enter -> result', Date.now() - t, { airposCalls: (await calls()) - c1 });
      await p.keyboard.press('Escape'); await sleep(300);
      await post('new-sale'); await post('member-detach').catch(() => {});
      await p.close(); fake.kill(); await sleep(800);
    }
  } catch (e) { console.log('ERROR ' + e.message); process.exitCode = 1; }
  finally { try { fake && fake.kill(); } catch {} b.disconnect(); }
  const rows = Object.entries(M).map(([k, v]) => ({ k, median: med(v.ms), ms: v.ms, airposCalls: v.airposCalls, apiCalls: v.apiCalls }));
  console.log(`latency per AIR POS call: ${LAT} ms; runs: ${RUNS}`);
  for (const r of rows) console.log(`${String(r.median).padStart(6)} ms  ${r.k}${r.airposCalls != null ? `  [AIR POS calls ${r.airposCalls}]` : ''}${r.apiCalls != null ? `  [page /api calls ${r.apiCalls}]` : ''}   (${r.ms.join(', ')})`);
  fs.writeFileSync(path.join(__dirname, process.env.SPEED_OUT || 'speed-general-results.json'), JSON.stringify({ at: new Date().toISOString(), latencyMs: LAT, runs: RUNS, rows }, null, 1));
})();

// 1.0.11 startup and search speed, OFFLINE fake AIR POS with a random 50-150 ms per AIR POS call (fixed seed, FAKE_LATENCY_RANGE).
// Startup, by stage, from "app open" (the server process starts) to "ready to scan" (logged in, sale screen drawn, scan box shown and usable):
//   server start -> login screen shown -> login (AIR POS calls, listed by the fake's timeline) -> sale screen ready.
// Search: product search and customer search, on the server (API) and on the screen (typed -> results drawn).
// Also checks the answers are the same as the plain AIR POS ones (correct results, newest typing wins).
//   CHROME_URL=http://127.0.0.1:9433 STARTUP_PORT=5190 node tests/e2e-startup-search-speed.js      (starts its own fake servers)
'use strict';
const puppeteer = require('puppeteer-core'), { spawn } = require('child_process'), path = require('path'), fs = require('fs');
const INSTANT = process.env.INSTANT === '1', os = require('os');
const PORT = Number(process.env.STARTUP_PORT || 5190), B = 'http://127.0.0.1:' + PORT, H = 'http://127.0.0.1:' + (PORT + 1), RUNS = Number(process.env.SS_RUNS || 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = q => fetch(H + q).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const med = a => { const s = a.filter(x => x != null && !isNaN(x)).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const short = p => p.replace(/^.*\//, '');
async function startServer() {
  let extra = {}; if (INSTANT) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-instant-')); fs.writeFileSync(path.join(d, 'instant-scan.json'), JSON.stringify({ on: true })); extra = { FAKE_DATA_DIR: d }; } // INSTANT=1: the Instant scan setting is already on when the app opens (needs a build that has it)
  const t0 = Date.now(), env = { ...process.env, ...extra, FAKE_PORT: String(PORT), FAKE_LATENCY_RANGE: '50-150' };
  const ch = spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env, stdio: 'ignore' });
  for (let i = 0; i < 400; i++) { try { const r = await fetch(B + '/api/state'); if (r.ok) return { ch, ms: Date.now() - t0 }; } catch { /* not up yet */ } await sleep(10); }
  throw new Error('server did not start');
}
async function startup(b) {
  const s = await startServer(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const api = []; p.on('request', q => { if (q.url().includes('/api/')) api.push(q.url().replace(/^.*\/api\//, '')); });
  try {
    let t = Date.now(); await p.goto(B + '/'); await p.waitForFunction(() => { const f = document.getElementById('loginForm'); return f && f.offsetParent !== null && document.getElementById('lgCompany'); }, { timeout: 20000 }); const uiMs = Date.now() - t;
    await p.$eval('#lgCompany', e => { e.value = 'fake shop'; }); await p.$eval('#lgUser', e => { e.value = 'tester'; }); await p.type('#lgPw', 'test-pw');
    await hook('/timeline?reset=1'); const before = api.length;
    t = Date.now(); await p.click('#lgBtn');
    await p.waitForFunction(() => { const i = document.getElementById('scanInput'); return i && i.offsetParent !== null && !i.disabled && document.getElementById('login').offsetParent === null && typeof S !== 'undefined' && S.loggedIn && S.mode === 'sale'; }, { timeout: 30000 });
    const loginMs = Date.now() - t; let listMs = null; if (INSTANT) { for (let i = 0; i < 400; i++) { const st = await fetch(B + '/api/state').then(r => r.json()); if (st.instant && st.instant.ready) { listMs = Date.now() - t; break; } if (!st.instant) break; await sleep(25); } }
    const tl = await hook('/timeline'), t0 = tl.length ? Math.min(...tl.map(x => x.t0)) : 0;
    const calls = tl.filter(x => x.host !== 'local' && !/ProductPaged/.test(x.p)).map(x => ({ call: short(x.p), from: x.t0 - t0, to: x.t1 - t0 }));
    return { serverMs: s.ms, loginScreenMs: uiMs, loginToReadyMs: loginMs, instantListReadyAfterLoginMs: listMs, readyToScanMs: s.ms + uiMs + loginMs, airposCalls: calls, airposSpanMs: calls.length ? Math.max(...calls.map(c => c.to)) : 0, screenApiCalls: api.slice(before), errors: errs, page: p, ch: s.ch };
  } catch (e) { s.ch.kill(); throw e; }
}
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9433', defaultViewport: { width: 1366, height: 768 } });
  const R = { startup: [], search: {} }; let last = null;
  try {
    for (let i = 0; i < RUNS; i++) { const r = await startup(b); const { page, ch, ...keep } = r; R.startup.push(keep); if (i < RUNS - 1) { await page.close(); ch.kill(); await sleep(500); } else last = r; }
    const S0 = R.startup;
    R.startupMedian = { serverMs: med(S0.map(x => x.serverMs)), loginScreenMs: med(S0.map(x => x.loginScreenMs)), loginToReadyMs: med(S0.map(x => x.loginToReadyMs)), readyToScanMs: med(S0.map(x => x.readyToScanMs)), airposSpanMs: med(S0.map(x => x.airposSpanMs)), ...(INSTANT ? { instantListReadyAfterLoginMs: med(S0.map(x => x.instantListReadyAfterLoginMs)) } : {}) };
    rec(`Startup to ready to scan (median of ${RUNS}, 50-150 ms per AIR POS call)`, R.startupMedian.readyToScanMs > 0 && S0.every(x => !x.errors.length), JSON.stringify(R.startupMedian));
    console.log('LOGIN CALLS ' + JSON.stringify(S0[S0.length - 1].airposCalls) + ' | screen api ' + JSON.stringify(S0[S0.length - 1].screenApiCalls));
    // ---- search, server side (API), 5 rounds each
    const p = last.page, tm = async f => { const t = Date.now(); const r = await f(); return [Date.now() - t, r]; };
    const prod = [], cust = { name: [], phone: [], email: [], empty: [] };
    for (let i = 0; i < 5; i++) {
      prod.push((await tm(() => post('search', { keyword: 'candy' })))[0]);
      cust.name.push((await tm(() => post('member-find', { keyword: 'Mike' })))[0]); cust.phone.push((await tm(() => post('member-find', { keyword: '555123' })))[0]);
      cust.email.push((await tm(() => post('member-find', { keyword: 'dana@example.com' })))[0]); cust.empty.push((await tm(() => post('member-find', { keyword: '' })))[0]);
    }
    const pr = await post('search', { keyword: 'candy' }), cn = await post('member-find', { keyword: 'Mike' }), ce = await post('member-find', { keyword: 'dana@example.com' });
    R.search.api = { product: med(prod), customerName: med(cust.name), customerPhone: med(cust.phone), customerEmail: med(cust.email), customerList: med(cust.empty) };
    rec('Search results are correct (product "candy" = Bulk candy $10.00; customer "Mike" = Mike Fake; e-mail = Dana Sample)', pr.rows.length === 1 && pr.rows[0].name === 'Bulk candy (lb)' && pr.rows[0].price === 10 && cn.rows.some(m => /Mike/.test(m.name)) && ce.rows.length === 1 && /Dana/.test(ce.rows[0].name), JSON.stringify(R.search.api));
    // ---- search on the screen: Product Search box (right panel) and the Customer window
    const ui = [];
    for (let i = 0; i < 3; i++) {
      await p.$eval('#qsIn', e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await sleep(400);
      const t = Date.now(); await p.type('#qsIn', ['candy', 'rope', 'toy'][i]);
      await p.waitForFunction(w => [...document.querySelectorAll('#qsRes .rbtn, #qsRes tr, #qsRes button, #qsRes div')].some(x => x.textContent.toLowerCase().includes(w)), { timeout: 10000 }, ['candy', 'rope', 'toy car'][i]); ui.push(Date.now() - t);
    }
    // newest typing wins: type "rope", then quickly change to "candy"; the shown results must be for "candy"
    await p.$eval('#qsIn', e => { e.value = ''; e.dispatchEvent(new Event('input')); }); await sleep(400); await p.type('#qsIn', 'rope'); await sleep(260); await p.$eval('#qsIn', e => { e.value = 'candy'; e.dispatchEvent(new Event('input')); }); await sleep(1500);
    const shown = await p.$eval('#qsRes', e => e.textContent.toLowerCase());
    const cu = [];
    for (let i = 0; i < 3; i++) {
      await p.evaluate(() => run('customer')); await p.waitForSelector('#mQ', { timeout: 5000 });
      const t = Date.now(); await p.type('#mQ', 'Dana'); await p.keyboard.press('Enter');
      await p.waitForFunction(() => !document.getElementById('mQ') ? !!(S.member && /Dana/.test(S.member.name)) : /Dana/.test((document.getElementById('mRes') || {}).textContent || ''), { timeout: 10000 }); cu.push(Date.now() - t); // one match: attached and the window closes (as designed)
      await p.evaluate(() => closeModal()); await post('new-sale'); await p.evaluate(() => refresh()); await sleep(300);
    }
    R.search.screen = { productTypedToShownMs: med(ui), customerTypedToShownMs: med(cu) };
    rec('On screen: typed -> results shown, for product search and customer search; the newest typing wins', shown.includes('candy') && !shown.includes('rope'), JSON.stringify(R.search.screen));
    console.log('RESULTS ' + JSON.stringify({ startupMedian: R.startupMedian, search: R.search }));
    if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(R, null, 1));
  } catch (e) { rec('run', false, e.stack); }
  finally { if (last) { await last.page.close().catch(() => {}); last.ch.kill(); } b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

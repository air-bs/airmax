// 1.2.3 (owner 4:27 / 4:29 PM): tap / click the version number -> check for updates; newer version -> download -> "Update now"
// (launcher closes, installs silently, restarts); never during an open sale or payment. Store Air Register UI, OFFLINE fake
// AIR POS. The feed answers are simulated (the real updater + feed parsing is checked offline in update-tap.test.js).
// Run: AIRREG_DEV_PROBE=1 FAKE_PORT=5098 node tests/fake-server.js &   FAKE_PORT=5098 node tests/e2e-update-tap.js   (Chrome :9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os');
const FP = Number(process.env.FAKE_PORT || 5098), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  const dir = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('airreg-fake-')).map(d => path.join(os.tmpdir(), d)).sort((a, c) => fs.statSync(c).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const ctl = path.join(dir, 'control.json'); try { fs.unlinkSync(ctl); } catch {}
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    let scen = null, stateCalls = 0;
    await p.setRequestInterception(true);
    p.on('request', async q => {
      const u = q.url();
      if (scen && /\/api\/update-check/.test(u)) return q.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, update: scen.first }) });
      if (scen && scen.later && /\/api\/state$/.test(u)) { stateCalls++; const j = await (await fetch(u)).json(); j.update = stateCalls > 2 ? scen.later : scen.first; return q.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); }
      q.continue();
    });
    await p.goto(BASE + '/'); await sleep(1500);
    const panel = () => p.$eval('#updText', e => e.textContent).catch(() => '');
    const tap = async (sel, s, wait) => { scen = s; stateCalls = 0; await p.click(sel); await sleep(wait || 800); return panel(); };
    const U = v => ({ current: '1.2.3', ...v });
    rec('Version number (status bar + top pill) is a button: "Check for updates now"', /Check for updates now/.test(await p.$eval('#stVer', e => e.title)) && /Check for updates now/.test(await p.$eval('#buildPill', e => e.title)), '');
    let t = await tap('#stVer', { first: U({ state: 'current', message: 'Up to date (1.2.3)' }) });
    rec('Up to date: "You\'re up to date (1.2.3)", no Update now button', t === "You're up to date (1.2.3)" && !(await p.$('#updNow')), t);
    await p.screenshot({ path: SCR + 'update-check-up-to-date.png' });
    t = await tap('#stVer', { first: U({ state: 'error', message: 'Update check failed: getaddrinfo ENOTFOUND' }) });
    rec('No internet: "Couldn\'t check, no internet"', /^Couldn't check, no internet/.test(t) && !(await p.$('#updNow')), t);
    await p.screenshot({ path: SCR + 'update-check-no-internet.png' });
    t = await tap('#buildPill', { first: U({ state: 'downloading', available: '1.2.4' }), later: U({ state: 'ready', available: '1.2.4' }) }, 900);
    rec('Newer version: "Update 1.2.4 found, downloading…" while it downloads', /^Update 1\.2\.4 found, downloading/.test(t), t);
    await sleep(3500); t = await panel();
    rec('Download done: "Update 1.2.4 is ready." with an "Update now" button', /^Update 1\.2\.4 is ready/.test(t) && !!(await p.$('#updNow')), t);
    await p.screenshot({ path: SCR + 'update-now-button.png' });
    // real server route from here: the fake updater is told a verified 1.2.4 download is ready (dev-only hook)
    scen = null; await post('dev-fault', { update: { state: 'ready', available: '1.2.4', message: 'Update 1.2.4 is ready. It installs when you close Air Register.' } });
    await post('scan', { code: '1002' }); await sleep(600);
    await p.click('#updNow'); await sleep(1200); t = await panel();
    rec('Open sale: "Update now" refuses with "Finish or hold the current sale first." and nothing is started', t === 'Finish or hold the current sale first.' && !fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('airreg-fake-')).some(d => { const f = path.join(os.tmpdir(), d, 'control.json'); return fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 10000; }) && (await state()).lines !== 0, t);
    await p.screenshot({ path: SCR + 'update-now-open-sale.png' });
    await post('hold'); await sleep(600); await post('new-sale'); await p.reload(); await sleep(1500);
    t = await tap('#buildPill', null, 900);
    rec('After holding the sale, tapping the version again shows the ready update (no new download)', /^Update 1\.2\.4 is ready/.test(t) && !!(await p.$('#updNow')), t);
    await p.click('#updNow'); await sleep(1200); t = await panel();
    // which fake data folder is ours is not knowable by mtime when several suites ran: find the control.json written just now
    const fresh = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('airreg-fake-')).map(d => path.join(os.tmpdir(), d, 'control.json')).filter(f => fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 10000);
    const c = fresh.length ? JSON.parse(fs.readFileSync(fresh[0], 'utf8')) : null;
    rec('No sale open: "Update now" asks the launcher to close, install and restart (control.json action "update")', /^Installing update 1\.2\.4/.test(t) && c && c.action === 'update', t + ' | ' + JSON.stringify(c));
    await p.screenshot({ path: SCR + 'update-now-installing.png' });
    const held = await post('held').catch(() => ({})); const h = (held.held || held.orders || []);
    if (Array.isArray(h) && h[0] && h[0].id) await post('void-held', { id: h[0].id }).catch(() => {});
    try { fs.unlinkSync(ctl); } catch {}
    await p.setRequestInterception(false);
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-update-tap-results.json'), JSON.stringify(out, null, 1));
  console.log(`e2e-update-tap: ${out.filter(x => x.pass).length}/${out.length} passed`); process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

// AirMax 1.0.4: this PC's RustDesk remote help ID in the bottom status bar (right side, next to the version and clock) and on the
// "Reconnecting to Air Register…" screen (shown while Air Register is stuck / not answering). ID ONLY: the password is never read,
// asked for or shown. RustDesk itself cannot run on this Linux box, so the RustDesk status is faked (tests/rdid-fake.js).
// Checks: ID present -> "Remote ID 123 456 789 · v… · clock"; absent -> nothing shown; server stopped after load -> ID still in the
// status bar and big on the Reconnecting screen; nothing cut off at 1024x768 / 1280x720 / 1366x768; no reply carries anything from
// remote-access.txt; the word "password" is never next to the ID; lib/remote.js on (faked) Windows never reads remote-access.txt;
// no install/reset RustDesk button added; every button + shortcut label unchanged.
// Runs its own fake servers (node tests/rdid-fake.js) on FAKE_PORT. Run: FAKE_PORT=5180 node tests/e2e-rdid-104.js  (Chrome 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const SENT = 'PW-SENTINEL-never-shown-7Qx', ID = '123456789', PRETTY = '123 456 789';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.text());
let srv = null;
const startSrv = async rdid => { await stopSrv(); srv = spawn(process.execPath, [path.join(__dirname, 'rdid-fake.js')], { env: { ...process.env, FAKE_PORT: String(FP), FAKE_RDID: rdid, RDID_SENTINEL: SENT }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { await sleep(250); try { await fetch(BASE + '/api/state'); return; } catch {} } throw new Error('fake server did not start'); };
const stopSrv = async () => { if (srv) { srv.kill('SIGKILL'); srv = null; await sleep(800); } };
const BUTTONS_103 = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e-stripes-103.js'), 'utf8').match(/const BUTTONS_102 = (\[.*?\]);/)[1].replace(/\/\*.*?\*\//g, '').replace(/'/g, '"')); // combine: e2e-stripes-103's list now has a /* Temporary Item */ comment
(async () => {
  // ---- 1. lib/remote.js itself, on faked Windows: reads the ID file, never the password file ----
  { const pf = fs.mkdtempSync(path.join(os.tmpdir(), 'rdid-pf-')), pd = fs.mkdtempSync(path.join(os.tmpdir(), 'rdid-pd-')), rd = path.join(pd, 'AirRegister', 'remote');
    fs.mkdirSync(path.join(pf, 'RustDesk'), { recursive: true }); fs.mkdirSync(rd, { recursive: true });
    const exe = path.join(pf, 'RustDesk', 'rustdesk.exe'); fs.writeFileSync(exe, '#!/bin/sh\necho "$RDID_OUT"\n'); fs.chmodSync(exe, 0o755);
    fs.writeFileSync(path.join(rd, 'remote-id.txt'), '987654321'); fs.writeFileSync(path.join(rd, 'remote-access.txt'), 'Password: ' + SENT);
    process.env.ProgramW6432 = pf; process.env.ProgramData = pd;
    const realPlat = process.platform; Object.defineProperty(process, 'platform', { value: 'win32' });
    const origRead = fs.readFileSync, reads = []; fs.readFileSync = function (f, ...a) { reads.push(String(f)); return origRead.call(fs, f, ...a); };
    const { RemoteHelp } = require('../app/lib/remote'); const rh = new RemoteHelp({});
    process.env.RDID_OUT = '555666777'; const a = await rh.status(); process.env.RDID_OUT = ''; const c = await rh.status();
    fs.readFileSync = origRead; Object.defineProperty(process, 'platform', { value: realPlat });
    const keys = r => Object.keys(r).sort().join(',');
    rec('lib/remote.js: ID from "rustdesk.exe --get-id", grouped 555 666 777', a.id === '555666777' && a.idPretty === '555 666 777', JSON.stringify(a));
    rec('lib/remote.js: falls back to the ID-only file remote-id.txt', c.id === '987654321' && c.idPretty === '987 654 321', JSON.stringify(c));
    rec('lib/remote.js: never opens remote-access.txt (the password file); reply has only ok/installed/id/idPretty/serviceRunning', !reads.some(f => /remote-access/i.test(f)) && !JSON.stringify([a, c]).includes(SENT) && keys(a) === 'id,idPretty,installed,ok,serviceRunning', JSON.stringify(reads)); }
  // ---- 2. no app file mentions the password file ----
  { const hits = []; const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|html|json)$/.test(f) && /remote-access/i.test(fs.readFileSync(p, 'utf8'))) hits.push(p); } };
    walk(path.join(__dirname, '..', 'app')); rec('no app file reads or names remote-access.txt', !hits.length, JSON.stringify(hits)); }
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433') });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
  const bodies = []; p.on('response', async r => { if (r.url().startsWith(BASE)) { try { bodies.push(r.url() + ' ' + await r.text()); } catch {} } });
  const login = () => post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
  const load = async () => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(2500); };
  const bar = () => p.evaluate(() => { const g = id => document.getElementById(id), st = document.querySelector('.status'), sr = st.getBoundingClientRect();
    const vis = e => e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
    const fit = e => { const r = e.getBoundingClientRect(); return r.left >= sr.left - .5 && r.right <= sr.right + .5 && e.scrollWidth <= e.clientWidth + 1; };
    const ids = ['stRdid', 'stVer', 'stTime'].filter(i => vis(g(i)));
    return { rdid: vis(g('stRdid')) ? g('stRdid').textContent : '', text: ids.map(i => getComputedStyle(g(i), '::before').content.replace(/^"|"$/g, '').replace('none', '') + g(i).textContent).join(' '),
      fit: ids.every(i => fit(g(i))), order: ids.join('>'), right: Math.round(sr.right - g('stTime').getBoundingClientRect().right), barText: st.textContent }; });
  try {
    // ---- 3. ID present ----
    await startSrv(ID); await login();
    for (const [w, h] of [[1366, 768], [1280, 720], [1024, 768]]) {
      await p.setViewport({ width: w, height: h }); await p.bringToFront(); await load();
      const s = await bar();
      rec(`${w}x${h} status bar right side: "Remote ID ${PRETTY} · v… · clock", all fully visible`, s.rdid === 'Remote ID ' + PRETTY && /^Remote ID 123 456 789 · v\d+\.\d+\.\d+ · \d+\/\d+\/\d{4}, /.test(s.text) && s.fit && s.order === 'stRdid>stVer>stTime' && s.right <= 14, JSON.stringify(s));
      if (w === 1366) {
        await p.screenshot({ path: path.join(__dirname, '..', 'screens', 'v104-sale-rdid-1366.png') });
        const btns = await p.evaluate(() => [...document.querySelectorAll('.abtn, .tiles .tile, .rbtn')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.a || '').filter(a => a !== 'price-change' && a !== 'quote' /* store requests #23/#26 */));
        rec('every 1.0.3 button still there, same order; no RustDesk install/reset button on the main screen', JSON.stringify(btns) === JSON.stringify(BUTTONS_103) && !(await p.evaluate(() => /turn on remote|new password|install rustdesk|reset/i.test(document.body.innerText))), btns.length + ' buttons');
      }
      if (w === 1280) await p.screenshot({ path: path.join(__dirname, '..', 'screens', 'v104-sale-rdid-1280.png') });
    }
    // scan + pay still work with the ID showing
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(1000);
    rec('scanning still works with the ID showing', (await p.$$eval('#cart tr.row', x => x.length)) === 1, 'ok');
    // ---- 4. server stops after load: the ID stays (status bar + big on the Reconnecting screen) ----
    await p.setViewport({ width: 1366, height: 768 }); await stopSrv(); await p.evaluate(() => refresh()); await sleep(3500);
    const d = await p.evaluate(() => { const o = document.getElementById('reconn'), i = document.getElementById('reconnId'); return { shown: !!o && getComputedStyle(o).display !== 'none', big: i ? i.textContent : '', fs: i ? parseFloat(getComputedStyle(i).fontSize) : 0, text: o ? o.innerText : '', bar: document.getElementById('stRdid').textContent }; });
    rec('server stopped: "Reconnecting…" screen shows "Remote help ID: 123 456 789" in big type', d.shown && d.big === 'Remote help ID: ' + PRETTY && d.fs >= 24, JSON.stringify(d));
    rec('server stopped: status bar still shows the ID', d.bar === 'Remote ID ' + PRETTY, d.bar);
    rec('the word "password" is never next to the ID (status bar, Reconnecting screen)', !/password/i.test(d.text) && !/password/i.test((await bar()).barText), d.text.replace(/\n/g, ' | '));
    await p.screenshot({ path: path.join(__dirname, '..', 'screens', 'v104-stuck-rdid-1366.png') });
    await p.setViewport({ width: 1024, height: 768 }); await sleep(500);
    const d2 = await p.evaluate(() => { const r = document.getElementById('reconnId').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    rec('1024x768 Reconnecting screen: ID fully on screen', d2, String(d2)); await p.screenshot({ path: path.join(__dirname, '..', 'screens', 'v104-stuck-rdid-1024.png') });
    // ---- 5. RustDesk not installed: nothing shown ----
    await startSrv('absent'); await login(); await p.setViewport({ width: 1366, height: 768 }); await load();
    const s2 = await bar(); const r2 = await p.evaluate(() => { reconnecting(true); const t = document.getElementById('reconn').innerText; reconnecting(false); return t; });
    rec('RustDesk not set up: nothing shown in the status bar (version + clock as before)', s2.rdid === '' && /^v\d+\.\d+\.\d+ · \d+\//.test(s2.text) && s2.fit && !/remote/i.test(s2.barText), JSON.stringify(s2));
    rec('RustDesk not set up: Reconnecting screen has no ID line', !/remote/i.test(r2), r2.replace(/\n/g, ' | '));
    // ---- 6. no reply carries the password file ----
    await startSrv(ID); await login(); await load();
    for (const r of ['remote-status', 'remote-setup', 'state']) bodies.push(r + ' ' + await post(r, { mode: 'install', user: 'm', password: 'x' }));
    bodies.push('log ' + await fetch(BASE + '/export/log').then(r => r.text()));
    rec(`no reply (${bodies.length} checked: page + remote-status + remote-setup + state + log) contains anything from remote-access.txt`, !bodies.some(x => x.includes(SENT)), bodies.length + ' replies');
    rec('remote-status reply is ID only (no password field)', (() => { const j = JSON.parse(bodies.find(x => x.startsWith('remote-status ')).slice(14)); return !Object.keys(j).some(k => /pass|pw|secret|key/i.test(k)) && j.id === ID; })(), 'ok');
    rec('no page errors', !errs.length, JSON.stringify(errs));
  } catch (e) { rec('test ran', false, e.stack); }
  finally { await p.close().catch(() => {}); b.disconnect(); await stopSrv(); }
  const passed = out.filter(x => x.pass).length; console.log(`${passed}/${out.length} passed` + (passed === out.length ? '' : ' — ' + (out.length - passed) + ' failed'));
  fs.writeFileSync(path.join(__dirname, 'e2e-rdid-104-results.json'), JSON.stringify(out, null, 1)); process.exit(passed === out.length ? 0 : 1);
})();

// 1.0.11 instant scan, the screen (OFFLINE fake AIR POS, Chrome on CHROME_URL): Settings shows the "Instant scan" switch (off) under
// "Warn before selling below zero stock"; switching it on works from there; a scanned line shows grey until AIR POS confirms it, then normal.
//   FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-instant-ui.js
'use strict';
const puppeteer = require('puppeteer-core'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (Number(process.env.FAKE_HOOK_PORT) || FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9433', defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'test-pw' });
    await post('instant-scan', { on: false }); await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/'); await sleep(1500);
    await p.evaluate(() => run('settings')); await sleep(1200);
    const sw = await p.evaluate(() => { const c = document.getElementById('seIS'), w = document.getElementById('seSWnote'); return c ? { checked: c.checked, label: c.parentElement.textContent.trim(), afterWarn: !!(w && w.nextElementSibling && w.nextElementSibling.contains(c)), note: document.getElementById('seISnote').textContent } : null; });
    rec('U1 Settings shows "Instant scan", OFF, right under the stock warning option', sw && !sw.checked && sw.label === 'Instant scan' && sw.afterWarn && /^Off \(default\)/.test(sw.note), JSON.stringify(sw));
    await p.click('#seIS'); await sleep(600); const s1 = await state();
    rec('U2 ticking it switches instant scan on (saved on this PC) and starts the list', s1.instant.on === true, (await p.$eval('#seISnote', e => e.textContent)).slice(0, 90));
    await p.screenshot({ path: SCR + 'instant-scan-setting.png' });
    await p.keyboard.press('Escape'); await sleep(300); await p.evaluate(() => closeModal()); for (let i = 0; i < 100 && !(await state()).instant.ready; i++) await sleep(50);
    await fetch(HOOK + '/latency?ms=1200');
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(350);
    const grey = await p.$$eval('#cart tr.row', t => t.map(r => r.classList.contains('pend')));
    await p.screenshot({ path: SCR + 'instant-scan-checking.png' });
    for (let i = 0; i < 100 && (await state()).instant.pending; i++) await sleep(50); await sleep(600);
    const after = await p.$$eval('#cart tr.row', t => t.map(r => r.classList.contains('pend')));
    rec('U3 a scanned line shows at once in grey (not yet confirmed), then normal once AIR POS has checked it', grey.length === 1 && grey[0] === true && after.length === 1 && after[0] === false, `while checking ${JSON.stringify(grey)}, after ${JSON.stringify(after)}`);
    rec('U4 no page errors', !errs.length, errs.join(' | ') || 'none');
    await fetch(HOOK + '/latency?ms=0'); await post('new-sale'); await post('instant-scan', { on: false });
  } catch (e) { rec('run', false, e.stack); }
  finally { if (p) await p.close().catch(() => {}); b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

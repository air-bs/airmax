// AirMax 1.0.9 Team Kit money fix (b), UI e2e against the OFFLINE fake AIR POS (no account, no store):
// Clock In / Clock Out with "1,250.00", "$100", "$1,250.00" reach AIR POS as 1250 / 100 / 1250 (they went as $0), and a
// bad amount is refused on screen with nothing sent.
// Run: FAKE_PORT=5094 node tests/fake-server.js &   FAKE_PORT=5094 CHROME_URL=http://127.0.0.1:9433 node tests/e2e-clock-amount-109.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5094), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const clocks = async () => JSON.parse(await (await fetch(HOOK + '/clock-state')).text());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const toastTxt = () => p.$eval('#toast', e => e.textContent).catch(() => '');
    const modalUp = () => p.$('#ciAmt').then(Boolean);
    const BAD = 'Enter the cash amount as a number, like 1250.00 or $100.';
    const clockIn = async v => {
      if (!(await modalUp())) { await p.evaluate(() => clockInDialog()); await sleep(500); }
      await p.$eval('#ciAmt', e => { e.value = ''; }); await p.type('#ciAmt', v); await p.keyboard.press('Enter'); await sleep(1500);
    };
    // bad amount: refused, nothing sent, dialog stays
    let n0 = (await clocks()).length;
    await clockIn('1.250,00');
    rec('Clock In "1.250,00": refused on screen, nothing sent to AIR POS, dialog stays open', (await toastTxt()) === BAD && (await clocks()).length === n0 && await modalUp(), `toast "${await toastTxt()}", sent ${(await clocks()).length - n0}`);
    await p.screenshot({ path: SCR + 'v109-clockin-bad-1366.png' });
    for (const [v, want] of [['$100', 100], ['1,250.00', 1250]]) {
      n0 = (await clocks()).length; await clockIn(v); const c = await clocks(); const last = c[c.length - 1];
      rec(`Clock In "${v}" -> AIR POS ClockIn initialAmount ${want} (was 0)`, c.length === n0 + 1 && last.path === '/RetailSessions/ClockIn' && last.submit.initialAmount === want && !(await modalUp()), JSON.stringify(last && last.submit));
    }
    // clock out
    const coOpen = async () => { await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('X'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); await sleep(1500); };
    await p.focus('#scanInput').catch(() => {}); await coOpen();
    const coUp = await p.$('#coAmt').then(Boolean); rec('Clock Out dialog opens (Ctrl+Shift+X) with the expected amount filled in', coUp, coUp ? await p.$eval('#coAmt', e => e.value) : 'no dialog');
    n0 = (await clocks()).length;
    await p.$eval('#coAmt', e => { e.value = ''; }); await p.type('#coAmt', 'abc'); await p.keyboard.press('Enter'); await sleep(1500);
    const st1 = await state();
    rec('Clock Out "abc": refused on screen, nothing sent, still logged in', (await toastTxt()) === BAD && (await clocks()).length === n0 && st1.loggedIn && await p.$('#coAmt').then(Boolean), `toast "${await toastTxt()}", loggedIn ${st1.loggedIn}`);
    await p.$eval('#coAmt', e => { e.value = ''; }); await p.type('#coAmt', '$1,250.00');
    await p.screenshot({ path: SCR + 'v109-clockout-amount-1366.png' });
    await p.keyboard.press('Enter'); await sleep(2500);
    const c = await clocks(), last = c[c.length - 1], st2 = await state();
    rec('Clock Out "$1,250.00" -> AIR POS ClockOut finalAmount 1250 (was 0), then logged out', c.length === n0 + 1 && last.path === '/RetailSessions/ClockOut' && last.submit.finalAmount === 1250 && !st2.loggedIn, JSON.stringify(last && last.submit) + ' loggedIn ' + st2.loggedIn);
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await p.close();
  } catch (e) { rec('e2e run', false, e.stack || e.message); }
  const pass = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-clock-amount-109-results.json'), JSON.stringify({ when: new Date().toISOString(), passed: pass, total: out.length, results: out }, null, 1));
  console.log(`${pass}/${out.length} passed`); b.disconnect(); process.exit(pass === out.length ? 0 : 1);
})();

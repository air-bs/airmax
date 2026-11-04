// AirMax 1.0.9-local.10 (Stress Tester local.9 report, LOW "L6", 4/4, seeds 9706000-9706003; Ari 12:18 AM ET Nov 1 "fix stress
// bugs right away"): after one cash payment on a split sale, typing cash AGAIN showed Balance $0.00, change and the green
// "Pay — finish sale" button, then AIR POS's one-cash-per-sale rule refused it. The rule is unchanged; the Payment window now
// does not count a 2nd cash amount (no "finish sale", Balance stays what is left, Change $0.00) and says why, before Pay.
// e2e against the OFFLINE fake AIR POS (tests/look-fake.js); nothing real is paid or sent.
// Run: FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 CHROME_URL=http://127.0.0.1:9433 node tests/e2e-stress9-cash2-110.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    if ((await state()).mode === 'clockin') await post('clock-in', { amount: 100 });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.bringToFront(); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1800);
    const scanUi = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    await scanUi('1001'); await scanUi('1002');
    for (let i = 0; i < 6 && (await state()).totals.due < 8; i++) await scanUi('1001');
    const total = (await state()).totals.due;
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1400);
    const typeCash = async v => { await p.evaluate(() => { const c = $('cashIn'); c.value = ''; c.focus(); }); await p.keyboard.type(v); await sleep(500); };
    await typeCash('5'); await p.click('#payOk'); await sleep(1800);
    const st1 = await state(), left = Math.round((total - 5) * 100) / 100;
    rec('first cash $5.00 taken on a ' + total.toFixed(2) + ' sale, Payment window still open with the rest due', st1.pay && st1.pay.tenders.filter(t => t.type === 10 && t.status === 'done').length === 1 && !!(await p.$('#cashIn')), JSON.stringify(st1.pay && st1.pay.tenders.map(t => [t.type, t.amount, t.status])));
    await typeCash('20');
    const ui = await p.evaluate(() => ({ ok: ($('payOk') || {}).textContent || '', bal: ($('payDue') || {}).textContent || '', chg: ($('chg') || {}).textContent || '', msg: ($('payMsg') || {}).textContent || '' }));
    rec('2nd cash typed: NOT offered as "Pay — finish sale"', !/finish sale/i.test(ui.ok), JSON.stringify(ui));
    rec('2nd cash typed: Balance stays ' + left.toFixed(2) + ', Change $0.00', ui.bal === '$' + left.toFixed(2) && ui.chg === '$0.00', JSON.stringify(ui));
    rec('2nd cash typed: says before Pay that only one cash payment is kept, take the rest another way', /one cash payment per sale/.test(ui.msg) && /another way/.test(ui.msg), ui.msg);
    await p.click('#payOk'); await sleep(1500);
    const st2 = await state(), msg2 = await p.evaluate(() => ($('payMsg') || {}).textContent || '');
    rec('Pay anyway: AIR POS rule unchanged (refused, nothing taken), the plain reason shown', st2.pay && st2.pay.tenders.filter(t => t.type === 10 && t.status === 'done').length === 1 && /only one cash payment/.test(msg2), msg2);
    await p.evaluate(() => { const c = $('cashIn'); c.value = ''; c.dispatchEvent(new Event('input')); }); await sleep(300);

    const ui2 = await p.evaluate(() => ({ ok: ($('payOk') || {}).textContent || '', msg: ($('payMsg') || {}).textContent || '' }));
    rec('cash box cleared: the warning goes away', !/one cash payment per sale, so this amount/.test(ui2.msg), JSON.stringify(ui2));
    rec('no page errors', !errs.length, JSON.stringify(errs));
    await post('pay-close'); await post('new-sale'); await p.close();
  } catch (e) { rec('run', false, e.stack || e.message); }
  b.disconnect();
  const pass = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-stress9-cash2-110-results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

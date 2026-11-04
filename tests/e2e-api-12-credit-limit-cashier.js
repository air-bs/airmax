// AirMax Extra 12, cashier variant: the whole fake AIR POS runs with FAKE_CASHIER=1 (the logged-in user is a cashier, not an AIR POS manager). A cashier gets NO Discount strip and NO route.
// run-env: FAKE_CASHIER=1
//   FAKE_CASHIER=1 FAKE_PORT=5324 CHROME_URL=http://127.0.0.1:9462 node tests/e2e-api-12-credit-limit-cashier.js   (start the fake with FAKE_CASHIER=1 too)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5324), BASE = 'http://127.0.0.1:' + FP, HB = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = p => fetch(HB + p).then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9462', defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    await hook('/disc-reset');
    if (!(await fetch(BASE + '/api/state').then(r => r.json())).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await hook('/disc-seed?id=m-edit2&discount=10');
    const perm = await post('perms');
    rec('C1 the fake is running as a cashier (not a manager)', perm.manager === false || perm.isManager === false || !perm.manager, JSON.stringify(perm).slice(0, 160));
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    const tab = await p.evaluate(() => { const t = document.querySelector('#tabbar .tab[data-tab="customers"]'); if (t && t.offsetWidth > 0) { t.click(); return true; } return false; });
    let ui = { tab, credit: 0, disc: false };
    if (tab) { await sleep(1200); await p.click('#cuGo'); await sleep(800); await p.evaluate(() => { const r = [...document.querySelectorAll('#cuList .cu-row')].find(r => /Dana/.test(r.textContent)); if (r) r.click(); }); await sleep(1300);
      ui = await p.evaluate(() => ({ tab: true, credit: !!document.getElementById('cuCredit') && document.getElementById('cuCredit').children.length, disc: !!document.getElementById('cuDisc') || !!document.querySelector('.cu-strip') || /Discount/.test(document.getElementById('cuWrap') ? document.getElementById('cuWrap').textContent : '') })); }
    rec('C2 a cashier: no Credit box and no Discount strip anywhere on the Customers tab (or no tab at all)', ui.credit === 0 && ui.disc === false, JSON.stringify(ui));
    const rr = await Promise.all([post('cust-discount-get', { retailMemberId: 'm-edit2' }), post('cust-discount-save', { retailMemberId: 'm-edit2', discount: 50, confirmed: true }), post('cust-discount-save', { retailMemberId: 'm-edit2', discount: 50, confirmed: true, user: 'boss', password: 'boss-pw' })]), s = await hook('/disc-state?id=m-edit2');
    rec('C3 a cashier: get and save (even with a manager name + password sent) answer "forbidden"; AIR POS is never asked; the discount stays 10', rr.every(x => x.ok === false && x.forbidden === true) && s.saves === 0 && s.rec.discount === 10, JSON.stringify(rr).slice(0, 200));
    rec('C4 no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 400)); }
  finally { try { if (p) await p.close(); } catch (e) {} b.disconnect(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

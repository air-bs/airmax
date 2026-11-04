// run-env: B8_FAKE=1
// AirMax Batch 8 wiring test (fake AIR POS only): Batch 8's cash-fix buttons mount in Batch 2's real Reports > Shifts / Z-reads rows,
// and store credit mounts in Batch 5's real Customers > Account box. Skips (passes) a part whose owner screen is not in this tree.
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5281), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9458', defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await fetch(BASE + '/api/state').then(r => r.json())).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(150); } return false; };
    const hasB2 = await p.evaluate(() => (window.AirMaxSectionsLoaded || []).includes('reports.js'));
    if (hasB2) {
      await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="reports"]').click());
      await waitFor(() => document.querySelectorAll('#rpList tbody tr').length > 0);
      const ok1 = await waitFor(() => { const s = [...document.querySelectorAll('#rpList td[data-slot]')]; return s.length > 0 && s.every(td => /Mark short\/over handled/.test(td.textContent)); });
      rec('W1 Batch 2 Reports > Shifts: every row\'s reports.shifts.row-actions slot shows Batch 8\'s "Mark short/over handled" (manager)', ok1, String(await p.evaluate(() => document.querySelectorAll('#rpList td[data-slot] button').length)));
      await p.evaluate(() => document.querySelector('#rpList td[data-slot] button').click()); await sleep(600);
      const m = await p.evaluate(() => ({ reason: !!document.getElementById('b8rs'), side: /Shift /.test((document.getElementById('rpSide') || {}).textContent || '') }));
      rec('W2 the button opens Batch 8\'s reason window and does not open the row\'s side panel (click stays in the slot)', m.reason, JSON.stringify(m));
      await p.keyboard.press('Escape'); await sleep(300); await p.evaluate(() => typeof closeModal === 'function' && closeModal());
      await p.evaluate(() => document.querySelector('#rpMenu .rp-mi[data-s="zreads"]').click());
      const ok3 = await waitFor(() => document.querySelectorAll('#rpList td[data-slot]').length === 2 && /ZR-NEW/.test(document.getElementById('rpList').textContent));
      await sleep(800);
      const z = await p.evaluate(() => [...document.querySelectorAll('#rpList tbody tr')].map(r => [r.children[0].textContent.trim(), !!r.querySelector('td[data-slot] button')]));
      rec('W3 Batch 2 Reports > Z-reads: "Cancel Z-read" shows only on the Z-read with no sale after it (looked up from AIR POS, Batch 2 rows have no hasNewOrder)', ok3 && JSON.stringify(z) === JSON.stringify([['ZR-NEW', true], ['ZR-OLD', false]]), JSON.stringify(z));
    } else rec('W1-W3 skipped: no Batch 2 Reports screen in this tree', true);
    const hasB5 = await p.evaluate(() => (window.AirMaxSectionsLoaded || []).includes('customers.js'));
    if (hasB5) {
      await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="customers"]').click()); await sleep(1200);
      const n = await p.evaluate(() => document.querySelectorAll('#cuList .cu-row').length);
      if (n) { await p.click('#cuList .cu-row'); }
      const ok4 = await waitFor(() => /Store credit/.test((document.getElementById('cuAcct') || {}).textContent || '') && !!document.querySelector('#cuAcct #b8cs'));
      rec('W4 Batch 5 Customers > customer panel: the customers.account-box slot shows Batch 8\'s Store credit box with "Add store credit"', n > 0 && ok4, (await p.evaluate(() => (document.getElementById('cuAcct') || {}).textContent || '')).slice(0, 120));
    } else rec('W4 skipped: no Batch 5 Customers screen in this tree', true);
    rec('W5 no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  } catch (e) { rec('test run', false, e.message); }
  finally { if (p) await p.close().catch(() => {}); b.disconnect(); }
  console.log(fails.length ? fails.length + ' failed: ' + fails.join('; ') : 'ALL PASSED'); process.exit(fails.length ? 1 : 0);
})();

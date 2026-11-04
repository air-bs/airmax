// run-env: FAKE_CASHIER=1
// AirMax API batch 1, cashier side: a login that is NOT a manager (no super admin, no RetailManager) is shown one plain line instead of the
// Terminal settings / Lists panels, and the register makes no terminal-settings call for it. OFFLINE fake AIR POS only.   FAKE_PORT=5180 node tests/e2e-api-1-lookups-cashier.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1), SHOTS = process.env.SHOTS_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    await post('login', { company: 'fake shop', user: 'cashier', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss().catch(() => {})); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    for (const [name, id] of [['settings.store.terminal', 'cT'], ['settings.store.lists', 'cL']]) {
      await p.evaluate((name, id) => { const d = document.createElement('div'); d.id = id; d.style.cssText = 'position:fixed;left:200px;top:70px;width:760px;background:#f4f7f9;padding:16px;border:1px solid #d5dde5;z-index:50'; document.body.appendChild(d); AirMaxMounts.fill(d, name, {}); }, name, id); await sleep(900);
      const t = await p.evaluate(id => ({ txt: document.getElementById(id).innerText.replace(/\s+/g, ' ').trim(), rows: document.querySelectorAll('#' + id + ' .lkrow, #' + id + ' details').length }), id);
      rec('C ' + name + ': a cashier sees one plain line and no panel', /manager login/.test(t.txt) && t.rows === 0, t.txt.slice(0, 90));
      if (SHOTS && id === 'cT') await p.screenshot({ path: path.join(SHOTS, 'batch1-cashier-no-access.png') });
      await p.evaluate(id => document.getElementById(id).remove(), id);
    }
    const st = await fetch(HOOK + '/lookups-state').then(r => r.json());
    rec('C3 for a cashier the register never asked AIR POS for the terminal settings or the lists', !st.calls['/Commons/RetailTerminalConfigGet'] && !st.calls['/Categories/CategorySelectAsTreeNode'] && !st.calls['/Commons/ProductOriginSelect'], JSON.stringify(st.calls));
    rec('C4 no page error', errs.length === 0, errs.join(' | ').slice(0, 200));
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 500)); }
  finally { try { if (p && !p.isClosed()) await p.close(); } catch (e) {} b.disconnect(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

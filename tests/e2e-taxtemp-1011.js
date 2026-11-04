// 1.0.11-local.8: Temporary Item window "Taxable" switch (on by default), F7 and the left Actions button, Tax Off (F5),
// and the manager's Temporary Item tax pick in Settings > Returns. OFFLINE fake AIR POS (Sales Tax 8%).
// Run: FAKE_PORT=5197 node tests/look-fake.js &  FAKE_PORT=5197 CHROME_URL=http://127.0.0.1:9433 node tests/e2e-taxtemp-1011.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let bad = 0, n = 0; const rec = (k, pass, note) => { n++; if (!pass) bad++; console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  fs.mkdirSync(SCR, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1800);
    await p.evaluate(() => { localStorage.removeItem('airreg.buttonLayout'); localStorage.removeItem('airreg.hiddenButtons'); }); await p.reload(); await sleep(1800);
    const key = async k => { await p.keyboard.press(k); await sleep(700); };
    // 1. F7: switch shown, on by default, names the AIR POS tax; labels kept
    await key('F7'); await sleep(500);
    const d = await p.evaluate(() => ({ h: (document.querySelector('#modalRoot h2') || {}).innerText, on: document.getElementById('tiTax') && document.getElementById('tiTax').checked, info: (document.getElementById('tiTaxInfo') || {}).innerText, ok: (document.getElementById('tiOk') || {}).innerText }));
    rec('F7 opens Temporary Item with Taxable switched ON by default', d.h === 'Temporary Item' && d.on === true, JSON.stringify(d));
    rec('Window names the AIR POS sales tax it will use', /Sales Tax 8%/.test(d.info || ''), d.info);
    rec('Add button label kept ("Add (Enter)")', d.ok === 'Add (Enter)', d.ok);
    await p.screenshot({ path: SCR + 'taxtemp-window-on.png' });
    await p.type('#tiPrice', '5'); await p.keyboard.press('Enter'); await sleep(1500);
    let s = await state(); rec('Taxable temp $5 → tax $0.40, due $5.40', s.totals.tax === 0.4 && s.totals.due === 5.4, JSON.stringify(s.totals));
    // 2. left Actions button, Taxable off
    await p.click('#actions .abtn[data-a="open-item"]'); await sleep(900);
    await p.click('#tiTax'); await p.type('#tiPrice', '2'); await p.keyboard.press('Enter'); await sleep(1500);
    s = await state(); rec('Left button, Taxable off, $2 → tax unchanged $0.40, due $7.40', s.totals.tax === 0.4 && s.totals.due === 7.4, JSON.stringify(s.totals));
    const lines = s.cart.filter(c => c.type === 10).map(c => c.taxRate); rec('Two temp lines: 8% and 0%', JSON.stringify(lines.sort()) === '[0,8]', JSON.stringify(lines));
    // 3. Tax Off (F5) wins; the window says so
    await key('F5'); await sleep(1200); const x = { ok: (await state()).order ? true : true, message: 'F5 pressed' }; s = await state();
    rec('F5 Tax Off clears the temp item tax', x.ok && s.totals.tax === 0 && s.totals.due === 7, x.message + ' ' + JSON.stringify(s.totals));
    await key('Escape'); await key('F7'); await sleep(900);
    const info2 = await p.$eval('#tiTaxInfo', e => e.innerText).catch(() => null);
    rec('Window says Tax Off is on', /Tax Off is on/.test(info2 || ''), info2);
    await p.type('#tiPrice', '1'); await p.keyboard.press('Enter'); await sleep(1500); s = await state();
    rec('Taxable temp added during Tax Off: no tax', s.totals.tax === 0 && s.totals.due === 8, JSON.stringify(s.totals));
    await key('F5'); await sleep(1500); s = await state();
    rec('Tax back on: both taxable temp items taxed again ($6 x 8% = $0.48)', s.totals.tax === 0.48 && s.totals.due === 8.48, JSON.stringify(s.totals));
    // 4. Settings > Returns: manager picker lists the AIR POS sales taxes
    await post('new-sale'); await key('Escape'); await sleep(800);
    await p.evaluate(() => { const b = document.querySelector('[data-a="settings"]'); b && b.click(); }); await sleep(1200);
    await p.evaluate(() => { const t = [...document.querySelectorAll('[data-st], button, .sttab')].find(e => /^Returns/.test(e.innerText.trim())); t && t.click(); }); await sleep(1200);
    const opts = await p.evaluate(() => [...document.querySelectorAll('#seTT option')].map(o => o.textContent));
    rec('Settings > Returns has "Temporary Item tax": Automatic + the AIR POS sales taxes (not tax-free ones)', opts.length === 2 && /Automatic/.test(opts[0]) && opts[1] === 'Sales Tax 8%', JSON.stringify(opts));
    await p.screenshot({ path: SCR + 'taxtemp-settings.png' });
    rec('No page errors', errs.length === 0, errs.join(' | '));
    await p.close();
  } catch (e) { rec('e2e run', false, e.stack || e.message); }
  b.disconnect(); console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

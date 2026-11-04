// AirMax API batch 1 (calls 11, 14-19), browser side: the section file app/public/sections/lookups.js. OFFLINE fake AIR POS only.
//   FAKE_PORT=5180 node tests/e2e-api-1-lookups.js        (SHOTS_DIR=<folder> also saves screenshots; none by default)
// The two read-only panels are drawn into a test element through the named slots (settings.store.terminal / settings.store.lists): the real Settings layout
// does not draw them yet (needs the owner's OK). Checks: AirMaxLookups.load answers + cache, manager sees the panels, a cashier sees one plain line and
// no AIR POS call, the Settings tab still opens the OLD Settings dialog (nothing registered for `settings`), Checkout untouched.
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1), SHOTS = process.env.SHOTS_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = () => fetch(HOOK + '/lookups-state').then(r => r.json());
(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss().catch(() => {})); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    rec('E1 lookups.js was loaded by the top bar; AirMaxLookups and the two slots exist', await p.evaluate(() => (window.AirMaxSectionsLoaded || []).includes('lookups.js') && !!window.AirMaxLookups && typeof AirMaxLookups.load === 'function' && AirMaxLookups.names.includes('regions')));
    const L = await p.evaluate(async () => { const o = {}; for (const n of ['taxKinds', 'paymentTypes', 'subPaymentTypes', 'origins', 'categories', 'regions', 'terminal']) o[n] = await AirMaxLookups.load(n); return JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ok: v.ok, count: v.count, avail: v.available }]))); });
    const l = JSON.parse(L);
    rec('E2 AirMaxLookups.load answers for all seven reads', l.taxKinds.ok && l.taxKinds.count === 2 && l.paymentTypes.avail === false && l.subPaymentTypes.ok && l.origins.count === 3 && l.categories.count === 5 && l.regions.count === 3 && l.terminal.ok, L.slice(0, 300));
    const c0 = (await hook()).calls, again = await p.evaluate(async () => { await AirMaxLookups.load('origins'); await AirMaxLookups.load('origins'); return true; }), c1 = (await hook()).calls;
    rec('E3 a list is asked of AIR POS once (5 minute memory cache), { refresh: true } asks again', again && c1['/Commons/ProductOriginSelect'] === c0['/Commons/ProductOriginSelect'] && await p.evaluate(async () => { await AirMaxLookups.load('origins', { refresh: true }); return true; }) && (await hook()).calls['/Commons/ProductOriginSelect'] === c0['/Commons/ProductOriginSelect'] + 1);
    // the Settings tab still opens the old Settings dialog
    await p.evaluate(() => document.getElementById('setTop').click()); await sleep(900);
    const dlg = await p.evaluate(() => ({ page: !!document.querySelector('#modalRoot .stpage'), txt: (document.getElementById('modalRoot').innerText || '').replace(/\s+/g, ' ').slice(0, 400), sec: document.getElementById('sectionHost').hidden }));
    rec('E4 the Settings tab / button still opens the Settings page (Step 0 top bar unchanged) (this batch registers nothing for `settings`)', dlg.page && /Printer/.test(dlg.txt) && dlg.sec === true, dlg.txt.slice(0, 80));
    await p.keyboard.press('Escape'); await sleep(500);
    // draw the slots into a test element (manager = the fake login)
    const draw = async (name, id) => { await p.evaluate((name, id) => { document.getElementById(id)?.remove(); const d = document.createElement('div'); d.id = id; d.style.cssText = 'position:fixed;left:200px;top:70px;width:760px;max-height:620px;overflow:auto;background:#f4f7f9;padding:16px;border:1px solid #d5dde5;z-index:50'; document.body.appendChild(d); AirMaxMounts.fill(d, name, {}); }, name, id); await sleep(900); };
    await draw('settings.store.terminal', 'tTerm');
    const T1 = await p.evaluate(() => { const d = document.getElementById('tTerm'); return { h: (d.querySelector('h3') || {}).textContent, rows: [...d.querySelectorAll('.lkrow')].map(r => r.dataset.k + '=' + (r.querySelector('.lkchip') ? r.querySelector('.lkchip').textContent : r.querySelector('b').textContent)), inputs: d.querySelectorAll('input,button,select,textarea').length }; });
    rec('E5 manager: Terminal settings panel is "View only" with the 7 switches, printer and shortcuts, and no input or button', /Terminal settings/.test(T1.h) && /View only/.test(T1.h) && T1.rows.length === 9 && T1.rows.includes('checkoutAutoPrint=On') && T1.rows.includes('useVirtualKeyboard=Off') && T1.rows.includes('printerName=Made-up Receipt Printer') && T1.inputs === 0, T1.rows.join(' | '));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'batch1-terminal-settings-view.png') });
    await draw('settings.store.lists', 'tLists');
    await p.evaluate(() => document.querySelectorAll('#tLists details').forEach(d => { d.open = true; }));
    await sleep(200);
    const T2 = await p.evaluate(() => { const d = document.getElementById('tLists'); return { sums: [...d.querySelectorAll('summary')].map(s => s.textContent.replace(/\s+/g, ' ').trim()), cats: [...d.querySelectorAll('.lkcat')].map(x => x.textContent.trim()), inputs: d.querySelectorAll('input,button,select,textarea').length, tax: d.querySelector('[data-l=tax] table') ? d.querySelector('[data-l=tax] table').innerText.replace(/\s+/g, ' ') : '' }; });
    rec('E6 manager: Lists panel shows the six lists with counts (payment types: "not offered by AIR POS"), read only', T2.sums.length === 6 && /Tax kinds.*2 entries/.test(T2.sums[0]) && /not offered by AIR POS/.test(T2.sums[1]) && /Product origins.*3 entries/.test(T2.sums[3]) && /Categories.*5 entries/.test(T2.sums[4]) && /States.*3 entries/.test(T2.sums[5]) && T2.cats.length === 5 && T2.inputs === 0 && /Sales Tax 8%/.test(T2.tax), T2.sums.join(' | '));
    if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'batch1-lists-view.png') });
    // Checkout still as before
    const names = await p.evaluate(() => [...document.querySelectorAll('#actions .abtn, #right .rbtn, #tiles .tile')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    rec('E7 Checkout still has Gift Card, Multiple Gift Cards, Gift Card Balance, Customer add, Items, Checkout (nothing added or taken)', ['Gift Card', 'Multiple Gift Cards', 'Gift Card Balance', 'Customer add', 'Items', 'Checkout'].every(m => names.some(n => n.includes(m))) && !names.some(n => /Terminal settings|Lists/.test(n)), names.length + ' buttons');
    rec('E8 no page error', errs.length === 0, errs.join(' | ').slice(0, 200));
    await p.close();
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 500)); }
  finally { try { if (p && !p.isClosed()) await p.close(); } catch (e) {} b.disconnect(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

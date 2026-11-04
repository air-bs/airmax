// AirMax Batch 5 (Customers tab: files, history, manager credit). Browser test on the fake AIR POS (made-up customers, made-up files): search, pick, list, upload, size refusal,
// Remove asks first (Keep / Remove), the Batch 8 slot is drawn, Transaction / Account Balance / Point records (paging, filters), the manager-only Credit box (and that a cashier / a login without Member Management does not get it or the tab), Esc goes back to Checkout. Screenshots when B5_SHOTS=<folder>.
//   FAKE_PORT=5250 CHROME_URL=http://127.0.0.1:9455 node tests/e2e-api-5-customers.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5250), BASE = 'http://127.0.0.1:' + FP, HB = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = p => fetch(HB + p).then(r => r.json());
const SHOTS = process.env.B5_SHOTS || '';
(async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e5-'));
  const small = path.join(T, 'made-up-note.txt'); fs.writeFileSync(small, 'made-up file for the test');
  const huge = path.join(T, 'huge.bin'); fs.writeFileSync(huge, Buffer.alloc(700 * 1024, 7));
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9455', defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    await hook('/cust-reset'); await hook('/cust-credit-seed?id=m-edit2&allow=0&amount=0');
    if (!(await fetch(BASE + '/api/state').then(r => r.json())).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="customers"]').click()); await sleep(1200);
    const e1 = await p.evaluate(() => ({ rows: [...document.querySelectorAll('#cuList .cu-row')].map(r => r.querySelector('b').textContent), q: !!document.getElementById('cuQ'), empty: document.querySelector('#cuRight .cu-empty') && document.querySelector('#cuRight .cu-empty').textContent }));
    rec('E1 Customers tab: search box + customer list (made-up customers) + "Pick a customer" hint', e1.q && e1.rows.length >= 2 && e1.rows.includes('Dana Sample') && /Pick a customer/.test(e1.empty || ''), JSON.stringify(e1));
    await p.type('#cuQ', 'Dana'); await p.keyboard.press('Enter'); await sleep(900);
    const e2 = await p.evaluate(() => [...document.querySelectorAll('#cuList .cu-row')].map(r => r.querySelector('b').textContent));
    rec('E2 Search + Enter narrows the list through the register\'s own customer search', e2.length >= 1 && e2.includes('Dana Sample'), JSON.stringify(e2));
    await p.click('#cuList .cu-row'); await sleep(1000);
    const e3 = await p.evaluate(() => ({ head: document.querySelector('.cu-head h2').textContent, files: [...document.querySelectorAll('#cuFilesBody tbody tr')].map(r => r.children[0].textContent + '|' + r.children[1].textContent), up: (document.getElementById('cuUp') || {}).textContent, slot: !!document.querySelector('#cuAcct[data-mount="customers.account-box"], #cuAcct .mount-empty, #cuAcct [data-mount]') || !!document.getElementById('cuAcct') }));
    rec('E3 Picking a customer shows the name and their 2 files (name + type) and an Upload File button', e3.head === 'Dana Sample' && e3.files.join() === 'sample-photo.png|PNG,agreement.pdf|PDF' && e3.up === 'Upload File', JSON.stringify(e3));
    rec('E4 the Batch 8 slot customers.account-box exists inside the customer panel and is usable (may be filled by batch 8)', await p.evaluate(() => { const a = document.getElementById('cuAcct'); return !!a && !!a.closest('.cu-body') && a.isConnected; }), '');
    await shot('customers-files');
    // upload
    const inp = await p.$('#cuPick'); await inp.uploadFile(small); await sleep(1500);
    const e5 = await p.evaluate(() => [...document.querySelectorAll('#cuFilesBody tbody tr')].map(r => r.children[0].textContent));
    const s5 = await hook('/cust-state');
    rec('E5 Upload File: the picked file is uploaded (31) and attached (84); the list reloads with 3 files', e5.length === 3 && e5[2] === 'made-up-note.txt' && s5.uploads === 1 && s5.adds === 1 && s5.bad.length === 0, JSON.stringify({ e5, up: s5.uploads, adds: s5.adds }));
    await inp.uploadFile(huge); await sleep(800);
    const s6 = await hook('/cust-state'), t6 = await p.evaluate(() => document.getElementById('toast').textContent);
    rec('E6 a file over 650 KB is refused on the screen with a message and is never sent', /too big/.test(t6) && s6.uploads === 1, t6);
    // remove asks first
    await p.evaluate(() => document.querySelector('#cuFilesBody [data-rm]').click()); await sleep(300);
    const e7 = await p.evaluate(() => { const t = document.querySelector('#cuFilesBody tr.cu-ask'); return t ? t.textContent.replace(/\s+/g, ' ').trim() : null; });
    rec('E7 Remove asks "Remove “sample-photo.png” from this customer?" with Remove / Keep, nothing deleted yet', /^Remove “sample-photo\.png” from this customer\?/.test(e7 || '') && (await hook('/cust-state')).deletes === 0, e7);
    await shot('customers-remove-confirm');
    await p.evaluate(() => document.querySelector('#cuFilesBody [data-no]').click()); await sleep(800);
    rec('E8 Keep: the list comes back with 3 files, nothing deleted', (await p.evaluate(() => document.querySelectorAll('#cuFilesBody tbody tr').length)) === 3 && (await hook('/cust-state')).deletes === 0, '');
    await p.evaluate(() => document.querySelector('#cuFilesBody [data-rm]').click()); await sleep(300);
    await p.evaluate(() => document.querySelector('#cuFilesBody [data-yes]').click()); await sleep(1500);
    const e9 = await p.evaluate(() => [...document.querySelectorAll('#cuFilesBody tbody tr')].map(r => r.children[0].textContent)), s9 = await hook('/cust-state');
    rec('E9 Remove (confirmed): exactly that file is deleted (85) and the list reloads with 2 files', e9.join() === 'agreement.pdf,made-up-note.txt' && s9.deletes === 1 && s9.bad.length === 0, JSON.stringify(e9));
    // a customer with no files
    await p.evaluate(() => { document.getElementById('cuQ').value = ''; document.getElementById('cuGo').click(); }); await sleep(900);
    await p.evaluate(() => [...document.querySelectorAll('#cuList .cu-row')].find(r => /Mike/.test(r.textContent)).click()); await sleep(900);
    rec('E10 a customer without files shows "No files for this customer."', await p.evaluate(() => /No files for this customer/.test(document.getElementById('cuFilesBody').textContent)), '');
    // ---- history tabs (80 / 81 / 82)
    const dana = async () => { await p.evaluate(() => [...document.querySelectorAll('#cuList .cu-row')].find(r => /Dana/.test(r.textContent)).click()); await sleep(900); };
    const rows = () => p.evaluate(() => document.querySelectorAll('#cuHistBody tbody tr').length);
    const txt = sel => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
    await dana();
    await p.evaluate(() => document.querySelector('#cuTabs [data-t="tx"]').click()); await sleep(1200);
    const h1 = await p.evaluate(() => ({ head: [...document.querySelectorAll('#cuHistBody th')].map(x => x.textContent), only: document.getElementById('hfOnly').checked, files: document.getElementById('cuFiles').classList.contains('cu-hide') }));
    rec('E11 Transaction Records tab: AIR POS columns, Only Balance Affected ticked, 20 rows, "34 records · page 1 of 2"; the Files box is hidden', h1.head.join('|') === 'Transaction NO.|Type|Transaction Time|Payments|Transaction Amount|Balance Affected|Balance' && h1.only && h1.files && (await rows()) === 20 && /34 records · page 1 of 2/.test(await txt('.cu-pager')), JSON.stringify(h1));
    await shot('customers-transactions');
    await p.click('#hNext'); await sleep(800);
    rec('E12 Next shows page 2 (14 rows), Previous goes back', (await rows()) === 14 && /page 2 of 2/.test(await txt('.cu-pager')) && await p.evaluate(() => document.getElementById('hNext').disabled), '');
    await p.click('#hPrev'); await sleep(800);
    await p.evaluate(() => { const c = document.getElementById('hfOnly'); c.checked = false; c.dispatchEvent(new Event('change')); }); await sleep(1000);
    const l1 = await hook('/cust-hist');
    rec('E13 Untick Only Balance Affected: 45 records, back on page 1, AIR POS was asked with onlyBalanceAffected false', /45 records · page 1 of 3/.test(await txt('.cu-pager')) && l1.last.tx.filter.onlyBalanceAffected === false, await txt('.cu-pager'));
    await p.select('#hfType', '20'); await sleep(1000);
    rec('E14 Type filter Recharge: only Recharge rows (15 records)', /15 records/.test(await txt('.cu-pager')) && await p.evaluate(() => [...document.querySelectorAll('#cuHistBody tbody tr')].every(r => r.children[1].textContent === 'Recharge')), await txt('.cu-pager'));
    await p.evaluate(() => document.querySelector('#cuTabs [data-t="bal"]').click()); await sleep(1000);
    const bh = await p.evaluate(() => [...document.querySelectorAll('#cuHistBody th')].map(x => x.textContent).join('|'));
    rec('E15 Account Balance tab: Order NO. | Type | Amount | Create Time, 6 records', bh === 'Order NO.|Type|Amount|Create Time' && (await rows()) === 6, bh);
    await p.type('#hfNum', '100299'); await p.keyboard.press('Enter'); await sleep(900);
    rec('E16 Search by Order NO. + Enter narrows it to 1 record', (await rows()) === 1, '');
    await p.evaluate(() => document.querySelector('#cuTabs [data-t="pts"]').click()); await sleep(1000);
    const ph = await p.evaluate(() => [...document.querySelectorAll('#cuHistBody th')].map(x => x.textContent).join('|'));
    rec('E17 Point Records tab: Order NO. | Type | Status | Points | Used Points | Create Time | Expired Time, 5 records', ph === 'Order NO.|Type|Status|Points|Used Points|Create Time|Expired Time' && (await rows()) === 5, ph);
    await shot('customers-points');
    await p.select('#hfStatus', '3'); await sleep(900);
    rec('E18 Status filter Used narrows the point records', (await rows()) === 2, 'rows ' + (await rows()) + ' ' + JSON.stringify((await hook('/cust-hist')).last.pts));
    await p.evaluate(() => document.querySelector('#cuTabs [data-t="files"]').click()); await sleep(300);
    rec('E19 Files tab brings the Files box back (the uploaded file is still listed)', await p.evaluate(() => !document.getElementById('cuFiles').classList.contains('cu-hide') && document.getElementById('cuHist').classList.contains('cu-hide') && document.querySelectorAll('#cuFilesBody tbody tr').length === 2), '');
    // ---- manager Credit box
    const cr = await p.evaluate(() => { const b = document.querySelector('#cuCredit .cu-credit'); return b ? { tag: b.querySelector('.cu-tag').textContent, allow: document.getElementById('cuAllow').checked, amt: document.getElementById('cuAmt').value, save: document.getElementById('cuCrSave').disabled, note: document.getElementById('cuCrNote').textContent } : null; });
    rec('E20 manager: the Credit box shows Allow Credit Payment (off), Credit Amount 0.00, the store credit balance, and Save credit is greyed until something changes', cr && cr.tag === 'MANAGER' && cr.allow === false && cr.amt === '0.00' && cr.save === true && /Store credit balance: \$12\.50/.test(cr.note), JSON.stringify(cr));
    await p.click('#cuAllow'); await p.evaluate(() => { const a = document.getElementById('cuAmt'); a.value = '250.00'; a.dispatchEvent(new Event('input')); }); await sleep(200);
    await p.click('#cuCrSave'); await sleep(300);
    const cn = await txt('#cuCrNote'); const hs0 = await hook('/cust-hist');
    rec('E21 Save credit asks first: "Set Credit Amount to $250.00 and Allow Credit Payment to On for Dana Sample?" (Save / Cancel), nothing sent yet', /^Set Credit Amount to \$250\.00 and Allow Credit Payment to On for Dana Sample\?/.test(cn) && hs0.creditSaves === 0, cn);
    await shot('customers-credit-confirm');
    await p.click('#cuCrNote [data-no]'); await sleep(900);
    rec('E22 Cancel puts back the saved values (Allow off, 0.00), nothing sent', await p.evaluate(() => !document.getElementById('cuAllow').checked && document.getElementById('cuAmt').value === '0.00') && (await hook('/cust-hist')).creditSaves === 0, '');
    await p.click('#cuAllow'); await p.evaluate(() => { const a = document.getElementById('cuAmt'); a.value = '250.00'; a.dispatchEvent(new Event('input')); }); await p.click('#cuCrSave'); await sleep(200); await p.click('#cuCrNote [data-yes]'); await sleep(600);
    await sleep(900);
    // Gordon (Nov 3): a logged-in manager is never asked for the manager password again; the confirm above is enough
    rec('E22b a logged-in manager: Save after the confirm goes straight through, no manager password window', await p.evaluate(() => !document.getElementById('mlU') && !document.getElementById('mlP')), '');
    const hs1 = await hook('/cust-hist');
    rec('E23 Save (confirmed, logged-in manager, no password): AIR POS got the whole record with Allow on + 250; the box reloads showing them; no malformed call', hs1.creditSaves === 1 && hs1.lastCredit.allow === true && hs1.lastCredit.amount === 250 && hs1.lastCredit.keys === 19 && hs1.bad.length === 0 && await p.evaluate(() => document.getElementById('cuAllow').checked && document.getElementById('cuAmt').value === '250.00'), JSON.stringify(hs1.lastCredit));
    await shot('customers-credit-saved');
    await p.evaluate(() => { const a = document.getElementById('cuAmt'); a.value = '12.345'; a.dispatchEvent(new Event('input')); }); await p.click('#cuCrSave'); await sleep(300);
    rec('E24 a bad Credit Amount (3 decimals) is refused on the screen and nothing is sent', /Credit Amount must be a number/.test(await p.evaluate(() => document.getElementById('toast').textContent)) && (await hook('/cust-hist')).creditSaves === 1, '');
    // ---- who sees it: a cashier (tab yes, no Credit box), a manager without Member Management (no tab)
    const relog = async mode => { await hook('/cust-role?mode=' + mode); await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' }); await p.goto(BASE + '/'); await sleep(2000); };
    await relog('cashier');
    await p.evaluate(() => { const t = document.querySelector('#tabbar .tab[data-tab="customers"]'); if (t) t.click(); }); await sleep(1200);
    await p.click('#cuGo'); await sleep(800); await dana();
    const ck = await p.evaluate(() => ({ tab: !!document.querySelector('#cuWrap'), credit: !!document.getElementById('cuCredit') && document.getElementById('cuCredit').children.length, tabs: document.querySelectorAll('#cuTabs .cu-tab').length }));
    rec('E25 a cashier (menu present, not a manager): the Customers tab works, the Credit box is not drawn at all (nothing greyed)', ck.tab && ck.credit === 0 && ck.tabs === 4, JSON.stringify(ck));
    await shot('customers-cashier-view');
    await relog('nomenu');
    const nm = await p.evaluate(() => ({ tab: !!(t => t && t.offsetWidth > 0)(document.querySelector('#tabbar .tab[data-tab="customers"]')), checkout: !!(t => t && t.offsetWidth > 0)(document.querySelector('#tabbar .tab[data-tab="checkout"]')) }));
    rec('E26 a login without Member Management in AIR POS: the Customers tab is not shown; Checkout still is', nm.tab === false && nm.checkout === true, JSON.stringify(nm));
    await hook('/cust-reset'); await relog('super');
    // Esc back to Checkout, nothing changed there
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="customers"]').click()); await sleep(900);
    await p.keyboard.press('Escape'); await sleep(700);
    rec('E27 Esc leaves the Customers tab back to Checkout (Customer add F3 button still there)', await p.evaluate(() => !!document.querySelector('[data-a="customer"], #tabbar .tab[data-tab="checkout"].on, #tabbar .tab[data-tab="checkout"].active, #tabbar .tab[data-tab="checkout"][aria-selected="true"]') && !document.getElementById('cuWrap')), '');
    await shot('checkout-intact'); // Checkout after visiting the Customers tab: nothing moved
    rec('E28 no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 400)); }
  finally { try { if (p) await p.close(); } catch (e) {} b.disconnect(); fs.rmSync(T, { recursive: true, force: true }); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

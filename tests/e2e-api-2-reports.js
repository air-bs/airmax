// AirMax API Batch 2: the Reports tab in a real (headless) browser against the FAKE AIR POS only (made-up data; never TestShop, never a store).
// Run by tests/run-all-look.sh (glob e2e-api-*.js).   FAKE_PORT=5221 CHROME_URL=http://127.0.0.1:9452 node tests/e2e-api-2-reports.js
// Optional: SHOTS_DIR=/some/folder saves 3 screenshots of the screen.
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5221), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = (p) => fetch(HOOK + p).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const SH = process.env.SHOTS_DIR;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9452'), defaultViewport: { width: 1280, height: 720 } });
  let p;
  try {
    if (!(await fetch(BASE + '/api/state').then(r => r.json())).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await hook('/reports-reset');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    await p.goto(BASE + '/'); await sleep(2000);
    const text = sel => p.evaluate(s => [...document.querySelectorAll(s)].map(e => e.textContent.trim().replace(/\s+/g, ' ')), sel);
    const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn).catch(() => false)) return true; await sleep(100); } return false; };
    const menu = id => p.evaluate(i => document.querySelector('#rpMenu .rp-mi[data-s="' + i + '"]').click(), id);
    const tab = await p.evaluate(() => { const t = document.querySelector('#tabbar .tab[data-tab="reports"]'); return { shown: !!t && !t.hidden, label: t && t.textContent.trim(), all: [...document.querySelectorAll('#tabbar .tab, #setTop')].map(x => x.textContent.trim()) }; });
    rec('R1 the Reports tab is shown to a manager, label "Reports" unchanged, 9 tabs as before', tab.shown && /Reports/i.test(tab.label) && tab.all.length === 9, JSON.stringify(tab));
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="reports"]').click());
    rec('R2 the Reports screen opens on Shifts and lists the 7 made-up shifts', await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 7));
    const items = await text('#rpMenu .rp-mi b');
    rec('R3 left menu: Sales report, E-sales by product, E-journal, Discount types, Shifts, Cash in / out, Z-reads (no Live tiles)', items.join('|') === 'Sales report|E-sales by product|E-journal|Discount types|Shifts|Cash in / out|Z-reads', items.join('|'));
    if (SH) await p.screenshot({ path: path.join(SH, 'reports-shifts-list.png') });
    const first = await text('#rpList tbody tr:first-child td');
    rec('R4 a shift row shows number, operator, clock in/out, opening, counted, status (no difference column: AIR POS gives it only through the cash records)', first.length >= 7 && /^RSS9/.test(first[0]) && /\$/.test(first[4]), first.join(' | '));
    await p.evaluate(() => [...document.querySelectorAll('#rpList tbody tr')].find(r => /RSS900003/.test(r.textContent)).click());
    rec('R5 clicking a row opens that shift in the side panel (104) with its cash records (110)', await waitFor(() => /Shift RSS900003/.test((document.getElementById('rpSide') || {}).textContent || '') && document.querySelectorAll('#rpSide tbody tr').length >= 1), (await text('#rpSide'))[0].slice(0, 160));
    const diff = (await text('#rpSide .kv')).find(x => /^Difference/.test(x));
    rec('R6 the panel shows the shift\'s difference at the count (-$5.00 short, from its cash record)', /-\$5\.00/.test(diff || '') , diff);
    if (SH) await p.screenshot({ path: path.join(SH, 'reports-shift-panel.png') });
    rec('R7 the shift row has an empty reports.shifts.row-actions slot (nothing drawn until batch 8) and the reports.fixes slot exists', await p.evaluate(() => document.querySelectorAll('#rpList td[data-slot]').length === 7 && !!document.getElementById('rpFix')), '');
    await menu('cash');
    rec('R8 Cash in / out lists the cash records (110): first page of 10 of 19, with the real type names', await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 10 && /Count at Clock|Collection/.test(document.getElementById('rpList').textContent) && /of 19/.test(document.getElementById('rpList').textContent)));
    await menu('zreads');
    rec('R9 Z-reads lists the Z-reads (118)', await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 4));
    await p.evaluate(() => [...document.querySelectorAll('#rpList tbody tr')].find(r => /ZR-FAKE-20261004/.test(r.textContent)).click());
    rec('R10 clicking a Z-read shows its totals and its one saved copy (119)', await waitFor(() => /Z-read ZR-FAKE-20261004/.test(document.getElementById('rpSide').textContent) && /Net sales/.test(document.getElementById('rpSide').textContent) && document.querySelectorAll('#rpSide tbody tr').length === 1));
    await p.evaluate(() => [...document.querySelectorAll('#rpList tbody tr')].find(r => /ZR-FAKE-20261001/.test(r.textContent)).click());
    rec('R10b a Z-read with a reset shows two saved copies (119)', await waitFor(() => /Z-read ZR-FAKE-20261001/.test(document.getElementById('rpSide').textContent) && document.querySelectorAll('#rpSide tbody tr').length === 2));
    await menu('sales');
    rec('R11 Sales report lists rows by shift (122), the vendor list comes from 121, the Product view lists 2 products and the vendor filter narrows it', await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 3) && (await p.evaluate(() => document.getElementById('rpSide').hidden)) && await (async () => { await p.select('#rpTab', 'Product'); await p.click('#rpGo'); const a = await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 2 && /Fake candy/.test(document.getElementById('rpList').textContent)); const o = await p.evaluate(() => document.querySelectorAll('#rpVen option').length); await p.select('#rpVen', 'ffffffff-0000-4000-8000-000000000095'); await p.click('#rpGo'); const b2 = await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 1); return a && o === 3 && b2; })());
    await menu('esales');
    rec('R12 E-sales by product lists the 2 reports (130), each with its own PDF button', await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 2 && /ES-FAKE-1/.test(document.getElementById('rpList').textContent) && document.querySelectorAll('#rpList [data-pdf]').length === 2));
    await hook('/pdfs-reset').catch(() => {});
    const pdf0 = (await fetch(HOOK + '/pdfs').then(r => r.json())).length;
    await p.click('#rpList [data-pdf]'); await sleep(900);
    const pdfs = await fetch(HOOK + '/pdfs').then(r => r.json());
    rec('R13 an E-sales row\'s PDF button fetches that report\'s PDF (133) and sends it to the printer path', pdfs.length === pdf0 + 1 && /ESalesProductReportExport/.test(pdfs[pdfs.length - 1].path), JSON.stringify(pdfs.slice(-1)));
    await menu('ejournal');
    rec('R14 E-journal lists 3 reports (135) with a PDF button each and a Generate E-journal button (E-sales has none: 129 is not built)', await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 3) && await p.evaluate(() => document.querySelectorAll('#rpList [data-pdf]').length === 3 && /Generate E-journal/.test(document.getElementById('rpGen').textContent)));
    await p.click('#rpList [data-pdf]'); await sleep(900);
    const pdfs2 = await fetch(HOOK + '/pdfs').then(r => r.json());
    rec('R15 a row\'s PDF button fetches that report\'s PDF (136)', /EJournalReportExport/.test(pdfs2[pdfs2.length - 1].path), pdfs2[pdfs2.length - 1].path);
    // Generate: confirm box
    await p.click('#rpGen'); await sleep(300);
    rec('R15b the Generate E-journal box asks for a From and a To date (AIR POS needs both)', await p.evaluate(() => !!document.querySelector('.rp-ov #rpGf') && !!document.querySelector('.rp-ov #rpGt') && document.querySelector('#rpGf').value.length === 10));
    const box = await p.evaluate(() => { const o = document.querySelector('.rp-ov'); return o ? { t: o.querySelector('h3').textContent, p: o.textContent, yes: o.querySelector('#rpYes').textContent } : null; });
    rec('R16 Generate E-journal opens a confirm box that says it creates a record and changes no sale, payment or cash', !!box && box.t === 'Generate E-journal?' && /create a new E-journal record/.test(box.p) && /does not change any sale, payment or cash amount/.test(box.p), box && box.t);
    if (SH) await p.screenshot({ path: path.join(SH, 'reports-generate-confirm.png') });
    rec('R17 nothing is written while the box is only open', (await hook('/reports-state')).writes.length === 0, '');
    await p.keyboard.press('Escape'); await sleep(300);
    rec('R18 Esc closes the box only (it is a window inside the app modal holder) (still on the Reports tab, nothing written)', await p.evaluate(() => !document.querySelector('.rp-ov') && !!document.getElementById('rp')) && (await hook('/reports-state')).writes.length === 0, '');
    await p.click('#rpGen'); await sleep(200); await p.click('.rp-ov #rpNo'); await sleep(200);
    rec('R19 Cancel writes nothing', (await hook('/reports-state')).writes.length === 0 && !(await p.$('.rp-ov')), '');
    await p.click('#rpGen'); await sleep(200);
    await p.evaluate(() => { const y = document.querySelector('.rp-ov #rpYes'); y.click(); y.click(); y.click(); }); // three presses at once
    rec('R20 pressing Generate several times makes ONE record (button locks while it runs); list re-read shows 4', await waitFor(() => !document.querySelector('.rp-ov') && document.querySelectorAll('#rpList tbody tr').length === 4) && (await hook('/reports-state')).writes.length === 1 && (await hook('/reports-state')).ejournal.length === 4, JSON.stringify((await hook('/reports-state')).writes.length));
    await hook('/reports-fail?mode=error'); await p.click('#rpGen'); await sleep(200); await p.click('.rp-ov #rpYes');
    rec('R21 a refused generate (AIR POS error) adds nothing, closes the box, the list still shows 4', await waitFor(() => !document.querySelector('.rp-ov')) && (await hook('/reports-state')).ejournal.length === 4 && await p.evaluate(() => document.querySelectorAll('#rpList tbody tr').length === 4), '');
    await hook('/reports-fail?mode=off');
    await menu('discount');
    rec('R22 Discount types lists 2 reports (138) and a Generate report button', await waitFor(() => document.querySelectorAll('#rpList tbody tr').length === 2) && await p.evaluate(() => /Generate report/.test(document.getElementById('rpGen').textContent)));
    await p.click('#rpList [data-dt="20"]'); await sleep(900);
    const pdfs3 = await fetch(HOOK + '/pdfs').then(r => r.json());
    rec('R23 a discount row has SC / PWD / SP / NAAC buttons; PWD fetches that report\'s PDF (139)', await p.evaluate(() => [...document.querySelectorAll('#rpList tbody tr:first-child [data-dt]')].map(b => b.textContent).join() === 'SC,PWD,SP,NAAC') && /DiscountTypeReportExport/.test(pdfs3[pdfs3.length - 1].path), pdfs3[pdfs3.length - 1].path);
    await p.click('#rpGen'); await sleep(200); await p.click('.rp-ov #rpYes');
    rec('R24 Generate report (137) adds one discount record and the list shows 3', await waitFor(() => !document.querySelector('.rp-ov') && document.querySelectorAll('#rpList tbody tr').length === 3) && (await hook('/reports-state')).discount.length === 3 && (await hook('/reports-state')).writes.filter(w => /discount/.test(w.path)).length === 1, '');
    if (SH) await p.screenshot({ path: path.join(SH, 'reports-discount-types.png') });
    // leaving
    await p.keyboard.press('Escape'); await sleep(500);
    rec('R25 Esc leaves Reports back to Checkout; Checkout is the register again', await p.evaluate(() => document.getElementById('sectionHost').hidden === true), '');
    const sc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'shortcuts.json'), 'utf8')), master = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-0', 'shortcuts-master.json'), 'utf8'));
    rec('R26 no shortcut added or changed (shortcuts.json equals master)', JSON.stringify(sc) === JSON.stringify(master), '');
    rec('R27 no page errors', !errs.length, errs.join(' | ').slice(0, 200) || 'none');
  } catch (e) { rec('R0 run finished', false, String(e && e.stack || e).slice(0, 400)); }
  finally { if (p) await p.close().catch(() => {}); await b.disconnect(); }
  console.log(`${fails.length ? 'FAILED' : 'ALL PASSED'}: ${fails.length} failed${fails.length ? ': ' + fails.join('; ') : ''}`); process.exit(fails.length ? 1 : 0);
})();

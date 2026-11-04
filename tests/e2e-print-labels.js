// Air Max 1.0.11-local.9 (test build): Print Labels screen (Ctrl+Shift+P, fix/ctrl-shift-p-labels; Ctrl+Alt+L removed) against the OFFLINE fake AIR POS + dev label sink.
// Run: FAKE_SALE=1 AIRREG_DEV_PROBE=1 AIRMAX_LABEL_SINK=/tmp/look-labels2 FAKE_PORT=5180 node tests/look-fake.js &
//      LABEL_SINK=/tmp/look-labels2 FAKE_PORT=5180 node tests/e2e-print-labels.js   (Chrome --remote-debugging-port=9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SINK = process.env.LABEL_SINK || '/tmp/look-labels2', SCR = path.join(__dirname, '..', 'screens') + '/', PREV = process.env.LABELS_PREVIEW_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.json()).catch(() => ({ calls: [] }));
async function combo(p, key, mods) { for (const m of mods) await p.keyboard.down(m); await p.keyboard.press(key); for (const m of mods.slice().reverse()) await p.keyboard.up(m); }
const sinkFiles = ext => { try { return fs.readdirSync(SINK).filter(f => f.endsWith(ext)).sort(); } catch { return []; } };
(async () => {
  fs.rmSync(SINK, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('label-settings-save', { settings: {} });
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1800);
    await p.evaluate(() => { window.__pls = []; window.__plsDialog = pages => { window.__pls.push(pages.map(x => ({ w: x.w, h: x.h, svg: x.svg }))); }; window.__pdf = []; window.__plsPdf = x => window.__pdf.push(x); });
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900);
    const st0 = await state(), cart0 = st0.cart.length, tot0 = JSON.stringify(st0.totals);
    await p.focus('#scanInput'); await combo(p, 'KeyL', ['Control', 'Alt']); await sleep(900);
    rec('Ctrl+Alt+L no longer opens anything (shortcut removed)', await p.evaluate(() => !document.querySelector('.plsmode') && !document.querySelector('.plmode')), 'nothing opened');
    await p.focus('#scanInput'); await combo(p, 'KeyP', ['Control', 'Shift']); await sleep(1200);
    rec('Ctrl+Shift+P opens Print Labels (several items) with the cursor in Lookup', await p.evaluate(() => !!document.querySelector('.plsmode') && document.activeElement && document.activeElement.id === 'plsIn'), 'open');
    const heads = await p.$$eval('.plstab th', l => l.map(e => e.textContent.trim()).filter(Boolean));
    rec('Grid like First Choice: Site, Item name, Lookup code, Cost, Price, Discount, Price rule, Label price, Layout, Copies', heads.join('|') === 'Site|Item name|Lookup code|Cost|Price|Discount|Price rule|Label price|Layout|Copies', heads.join('|'));
    rec('Auto Print, Layout for new items, Printer, Reset, Preview PDF, Print are there', await p.evaluate(() => ['plsAuto', 'plsNewLay', 'plsPr', 'plsReset', 'plsPdf', 'plsPrint', 'plsCopies'].every(i => document.getElementById(i))), 'ok');
    const scan = async code => { await p.focus('#plsIn'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    await scan('1002'); await scan('1001');
    let s = await p.evaluate(() => window.__plsState());
    rec('Two scans = two rows, built-in layout wPrice, AIR POS sale price', s.rows.length === 2 && s.rows.every(r => r.layout === 'wprice') && s.rows[0].price === 3.99, JSON.stringify(s.rows));
    const r1 = await p.$eval('#plsRows tr[data-i="0"]', e => e.innerText.replace(/\s+/g, ' '));
    rec('Row shows price, discount $1.01 and the price rule (sale, regular $5)', /\$3\.99/.test(r1) && /\$1\.01/.test(r1) && /Sale \(Reg\. \$5\.00\)/.test(r1), r1);
    rec('Preview of wPrice shows its 2 stickers', (await p.$$eval('#plsPrev .lblbox', l => l.length)) === 2, 'ok');
    // layout per row
    await p.select('#plsRows select[data-lay="1"]', 'shelf15x3'); await sleep(300);
    s = await p.evaluate(() => window.__plsState());
    const pv = await p.$eval('#plsPrev', e => e.innerText);
    rec('Layout picked on a row; preview follows (Shelf 1.5 x 3, marked "to be matched")', s.rows[1].layout === 'shelf15x3' && s.sel === 1 && /Shelf Label 1\.5 x 3/.test(pv) && /to be matched/i.test(pv), pv.replace(/\s+/g, ' ').slice(0, 120));
    // label price typed by hand
    await p.click('#plsRows input[data-lp="0"]'); await p.keyboard.type('2.50', { delay: 90 }); await p.keyboard.press('Enter'); await sleep(400);
    s = await p.evaluate(() => window.__plsState()); const pv0 = await p.$eval('#plsPrev', e => e.innerHTML), msg = await p.$eval('#plsStatus', e => e.innerText);
    rec('Label price 2.50 typed: preview shows $2.50, message says AIR POS is not changed', s.rows[0].lpRaw === '2.50' && s.rows[0].lpOk && /\$2\.50/.test(pv0) && /AIR POS is not changed/.test(msg), msg);
    // a scanner burst into the price box -> Lookup
    await p.click('#plsRows input[data-lp="1"]'); await p.keyboard.type('012345678912', { delay: 0 }); await p.keyboard.press('Enter'); await sleep(1200);
    s = await p.evaluate(() => window.__plsState()); const m2 = await p.$eval('#plsStatus', e => e.innerText);
    rec('Barcode scanned into the Label price box: NOT a price, it went to Lookup (new row for Toy car)', s.rows.length === 3 && s.rows[1].lpRaw === '' && s.rows[2].number === '1002', JSON.stringify(s.rows.map(r => [r.number, r.lpRaw])) + ' / ' + m2);
    // typed slowly but 6+ digits: also refused as a price
    await p.click('#plsRows input[data-lp="1"]'); await p.keyboard.type('123456', { delay: 90 }); await p.keyboard.press('Enter'); await sleep(1200);
    s = await p.evaluate(() => window.__plsState());
    rec('6+ digits typed slowly: still never a price', s.rows[1].lpRaw === '' , JSON.stringify(s.rows.map(r => r.lpRaw)));
    // a bad price blocks printing
    await p.click('#plsRows input[data-lp="2"]'); await p.keyboard.type('1,99', { delay: 60 }); await p.keyboard.press('Tab'); await sleep(300);
    const badCls = await p.$eval('#plsRows input[data-lp="2"]', e => e.classList.contains('bad'));
    await p.click('#plsPrint'); await sleep(600);
    const m3 = await p.$eval('#plsStatus', e => e.innerText), n3 = await p.evaluate(() => window.__pls.length);
    rec('"1,99" is marked wrong and Print refuses (nothing printed)', badCls && /no commas/.test(m3) && n3 === 0 && sinkFiles('.json').length === 0, m3);
    await p.click('#plsRows input[data-lp="2"]', { clickCount: 3 }); await p.keyboard.press('Backspace'); await p.keyboard.press('Tab'); await sleep(300);
    await p.click('#plsRows input[data-cp="2"]', { clickCount: 3 }); await p.keyboard.type('3'); await p.keyboard.press('Tab'); await sleep(300);
    // print window path (no printer chosen)
    await p.select('#plsPr', ''); await sleep(500);
    await p.click('#plsPrint'); await sleep(1200);
    const why = await p.$eval('#plsStatus', e => e.innerText);
    await p.click('#plsPw'); await sleep(600);
    const pages = await p.evaluate(() => window.__pls[0] || []);
    // rows: 0 Toy car wPrice x1 (2 stickers, $2.50); 1 candy shelf15x3 x1; 2 Toy car wPrice x3 (6 stickers)
    rec('No printer: reason shown, print window gets 9 pages at their sizes, label price on row 1 only', /no label printer picked/i.test(why) && pages.length === 9 && pages.slice(0, 2).every(x => x.w === 2.25 && x.h === 1.25 && /\$2\.50/.test(x.svg)) && pages[2].w === 3 && pages[2].h === 1.5 && pages.slice(3).every(x => /\$3\.99/.test(x.svg)), `${pages.length} pages ${JSON.stringify(pages.map(x => x.w + 'x' + x.h))}`);
    // preview PDF
    await p.click('#plsPdf'); await sleep(1200);
    const pdf = await p.evaluate(() => window.__pdf[0] || null);
    rec('Preview PDF made (9 labels), nothing printed', pdf && pdf.total === 9 && pdf.bytes > 1000 && sinkFiles('.json').length === 0, JSON.stringify(pdf && { total: pdf.total, bytes: pdf.bytes }));
    // a chosen label printer (Zebra = ZPL) through the printer helper (dev sink stands in)
    await p.evaluate(() => { const s = document.getElementById('plsPr'); const o = document.createElement('option'); o.value = 'Zebra ZD220'; o.textContent = 'Zebra ZD220'; s.appendChild(o); s.value = 'Zebra ZD220'; s.dispatchEvent(new Event('change')); }); await sleep(600);
    await p.click('#plsPrint'); await sleep(1500);
    const zf = sinkFiles('.zpl'), meta = zf.length ? JSON.parse(fs.readFileSync(path.join(SINK, zf[0].replace(/\.zpl$/, '.json')), 'utf8')) : {}, zpl = zf.length ? fs.readFileSync(path.join(SINK, zf[0]), 'utf8') : '';
    rec('Zebra chosen: one ZPL job, 9 labels, label price 2.50 only on row 1, AIR POS price 3.99 on the rest', zf.length === 1 && meta.printer === 'Zebra ZD220' && meta.total === 9 && meta.rows[0].labelPrice === 2.5 && meta.rows[2].labelPrice == null && /\$2\.50/.test(zpl) && /\$3\.99/.test(zpl), JSON.stringify(meta.rows));
    rec('Printer saved for Print Labels on this PC (not the receipt printer setting)', (await post('labels-layouts')).printer === 'Zebra ZD220', 'ok');
    // default layout for this item, then a fresh scan uses it
    await p.click('#plsRows tr[data-i="1"] td'); await sleep(300);
    await p.click('#plsDefItem'); await sleep(600);
    const dm = await p.$eval('#plsDefMsg', e => e.innerText);
    await p.click('#plsReset'); await sleep(300); await scan('1001');
    s = await p.evaluate(() => window.__plsState()); const from = await p.$eval('#plsRows tr[data-i="0"] .plsfrom', e => e.innerText);
    rec('Default for item 1001 saved; next scan of 1001 comes in with Shelf 1.5 x 3 (item default)', /Default layout for item 1001/.test(dm) && s.rows.length === 1 && s.rows[0].layout === 'shelf15x3' && from === 'item default', dm + ' / ' + from);
    await p.select('#plsNewLay', 'bc12'); await scan('1001');
    s = await p.evaluate(() => window.__plsState());
    rec('"Layout for new items" overrides the default before printing', s.rows[1].layout === 'bc12', s.rows[1].layout);
    await p.select('#plsNewLay', ''); await p.click('#plsRows tr[data-i="0"] td'); await sleep(200); await p.click('#plsDefClr'); await sleep(500);
    rec('Remove this item\'s default', !(await post('labels-layouts')).defaults.items['1001'], 'ok');
    // Auto Print
    await p.click('#plsAuto'); const z0 = sinkFiles('.zpl').length; await scan('1003'); await sleep(600);
    rec('Auto Print: a scan prints that item right away', sinkFiles('.zpl').length === z0 + 1, `${z0} -> ${sinkFiles('.zpl').length}`);
    await p.click('#plsAuto');
    await p.screenshot({ path: SCR + 'print-labels.png' }); if (PREV) await p.screenshot({ path: path.join(PREV, 'ui-print-labels-1366.png') });
    const fitAt = () => p.evaluate(() => { const m = document.querySelector('.plsmode').getBoundingClientRect(), b = document.getElementById('plsPrint').getBoundingClientRect(), mm = document.querySelector('.plsmode');
      return { b: Math.round(b.bottom), r: Math.round(b.right), mb: Math.round(m.bottom), mr: Math.round(m.right), hx: mm.scrollWidth - mm.clientWidth }; });
    let fit = await fitAt();
    rec('Fits 1366 x 768: Print button inside the window without scrolling, no sideways scroll', fit.b <= fit.mb && fit.r <= fit.mr && fit.mb <= 768 && fit.hx <= 0, JSON.stringify(fit));
    await p.setViewport({ width: 1024, height: 768 }); await sleep(500);
    fit = await fitAt();
    rec('Fits 1024 x 768: Print button inside the window without scrolling, no sideways scroll', fit.b <= fit.mb && fit.r <= fit.mr && fit.mb <= 768 && fit.hx <= 0, JSON.stringify(fit));
    if (PREV) await p.screenshot({ path: path.join(PREV, 'ui-print-labels-1024.png') });
    await p.setViewport({ width: 1366, height: 768 });
    await p.keyboard.press('Escape'); await sleep(600);
    rec('Esc closes Print Labels', await p.evaluate(() => !document.querySelector('.plsmode')), 'closed');
    // the left Print Label button goes to the same screen as Ctrl+Shift+P
    await p.click('#actions [data-a="print-label"]'); await sleep(1200);
    rec('The left Print Label button opens the same several-items Print Labels screen', await p.evaluate(() => !!document.querySelector('.plsmode') && !document.querySelector('.plmode') && document.activeElement && document.activeElement.id === 'plsIn'), 'open');
    await p.click('#plsDone'); await sleep(500);
    // the one-item screen (no key / button of its own now) still works and its "Print Labels (layouts)" button (no Ctrl+Alt+L hint) goes to the several-items screen
    await p.evaluate(() => A['print-label-single']()); await sleep(900);
    const btn = await p.$eval('#plLayouts', e => e.innerText.replace(/\s+/g, ' '));
    await p.click('#plLayouts'); await sleep(1200);
    rec('One-item Print Label screen still opens; its "Print Labels (layouts)" button (no Ctrl+Alt+L hint) opens the several-items screen', /Print Labels \(layouts\)/.test(btn) && !/Ctrl\+Alt\+L/.test(btn) && await p.evaluate(() => !!document.querySelector('.plsmode') && !document.querySelector('.plmode')), btn);
    await p.click('#plsDone'); await sleep(500);
    // read only
    const st1 = await state(), calls = (await hook('/x')).calls || [];
    const writes = calls.filter(c => /Complete|Save|Update|Create|Delete|Receive|Return|Refund|Pay|Stock|Inventory|Bill|Price/i.test(c) && !/Get$|Get\b|GetByScan|Paged|List$/.test(c));
    rec('Sale untouched, no AIR POS writes (fake AIR POS call log)', st1.cart.length === cart0 && JSON.stringify(st1.totals) === tot0 && writes.length === 0, `cart ${cart0}->${st1.cart.length}, calls ${[...new Set(calls)].join(',').slice(0, 200)}`);
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } catch (e) { rec('ran to the end', false, e.stack || e.message); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} print labels e2e tests passed`);
  fs.writeFileSync(path.join(__dirname, 'e2e-print-labels-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  b.disconnect(); process.exit(pass === out.length ? 0 : 1);
})();

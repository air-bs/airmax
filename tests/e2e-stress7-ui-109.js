// AirMax 1.0.9-local.9 (Ari OK 9:24 PM ET Oct 31 "Fix everything"): Stress Tester local.7 UI findings, e2e against the OFFLINE fake AIR POS.
//  p) Payment window when the payment is no longer open on the server (chaos seed 110161): was an empty window Esc could not close
//  l) Print Label with no label printer (Windows print window): focus went to the hidden print iframe, the next scan / Esc were lost
//  t) Customer tile: no red "ACCOUNT $0.00" for a $0 customer (the chip and the F3 Customer box already hid it)
//  m) "Candy is already on this sale" message under the scan box stayed on the next, empty sale
// Run: FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 CHROME_URL=http://127.0.0.1:9433 node tests/e2e-stress7-ui-109.js
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
    const modalOpen = () => p.evaluate(() => !!$('modalRoot').firstChild);
    const toastTxt = () => p.$eval('#toast', e => e.textContent).catch(() => '');
    const scanUi = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };

    // p) payment closed on the server while the Payment window is open
    await scanUi('1001'); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1400);
    const open = await p.evaluate(() => !!$('payBody') && !!$('payBack'));
    await post('pay-close'); await p.evaluate(() => refresh()); await sleep(300);
    await p.keyboard.press('ArrowDown'); await sleep(900); // any redraw of the window (here: next tender)
    const body = await p.evaluate(() => ($('payBody') || {}).innerText || '');
    const backBtn = await p.evaluate(() => !!$('payBack'));
    rec('p) Payment window with no payment open: says so and has Back (Esc) (not empty)', open && /no payment open/i.test(body) && backBtn, JSON.stringify({ open, body: body.slice(0, 120), backBtn }));
    await p.keyboard.press('Escape'); await sleep(900);
    rec('p) Esc closes it; the sale is still there', !(await modalOpen()) && (await state()).cart.length === 1, `modal ${await modalOpen()}, cart ${(await state()).cart.length}`);
    await post('new-sale'); await p.evaluate(() => refresh()); await sleep(500);

    // l) Print Label, no label printer: the print window path (real iframe, no test hook)
    await post('label-settings-save', { settings: {} });
    await p.focus('#scanInput'); await p.evaluate(() => A['print-label-single']()); await sleep(900); // 1.0.11: Ctrl+Shift+P now opens the several-items screen; this checks the one-item screen, opened through A['print-label-single'] (same code, same screen) like e2e-print-label
    const plOpen = await p.evaluate(() => !!document.querySelector('.plmode'));
    await p.focus('#plIn'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(1200); await p.keyboard.press('Enter'); await sleep(2200); // 1.0.10-local.2: Enter on the empty box opens the print window
    const act1 = await p.evaluate(() => { const a = document.activeElement; return a ? a.tagName + '#' + a.id : ''; });
    await p.keyboard.type('1003'); await p.keyboard.press('Enter'); await sleep(2200); // typed without clicking the box
    const rows = await p.$$eval('#plRows tr:not(.plnone)', t => t.length).catch(() => 0);
    rec('l) after the print window: focus back in the Print Label scan box; the next scan (typed blind) is taken', plOpen && act1 === 'INPUT#plIn' && rows === 2, JSON.stringify({ plOpen, act1, rows }));
    await p.keyboard.press('Escape'); await sleep(900);
    rec('l) Esc still closes Print Label', !(await p.evaluate(() => !!document.querySelector('.plmode'))), 'closed');

    // t) $0 customer on the tile
    await post('member-attach', { number: '5550101' }); await p.evaluate(() => refresh()); await sleep(700);
    const tile = await p.evaluate(() => { const c = document.querySelector('#info-customer .custc'); return c ? { text: c.innerText.replace(/\s+/g, ' '), bal: !!c.querySelector('b.bal') } : null; });
    rec('t) $0 customer: Customer tile shows name / phone / points, no red ACCOUNT $0.00', tile && !tile.bal && !/Account/i.test(tile.text) && /Zero Balance/.test(tile.text), JSON.stringify(tile));
    await post('member-attach', { number: '5550100' }); await p.evaluate(() => refresh()); await sleep(700);
    const tile2 = await p.evaluate(() => { const b = document.querySelector('#info-customer .custc b.bal'); return b ? b.textContent : null; });
    rec('t) a customer with a balance still shows it ($42.50)', tile2 === '$42.50', String(tile2));
    await post('member-detach'); await p.evaluate(() => refresh()); await sleep(500);

    // m) duplicate ask-price bulk message, then the sale is paid: the next empty sale has no old message
    await post('settings', { bulkItems: [{ label: 'Candy', code: '1001', name: 'Bulk candy', askPrice: true }], bulkFolders: [], bulkOrder: [] });
    await p.evaluate(() => refresh()); await sleep(600);
    await p.click('#bulkBtns [data-bulk="0"]'); await sleep(900); await p.type('#bpIn', '10'); await p.keyboard.press('Enter'); await sleep(1200);
    await p.click('#bulkBtns [data-bulk="0"]'); await sleep(900);
    const t1 = await toastTxt();
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1400);
    const due = (await state()).totals.due;
    const x = await p.evaluate(async d => { const r = await api('pay-cash', { tendered: d }); await refresh(); if (r.completed) doneDialog(r); return r; }, due); await sleep(900);
    const doneUp = await p.evaluate(() => /Sale complete/.test(($('modalRoot') || {}).innerText || ''));
    await post('dismiss'); await p.evaluate(() => { closeModal(); return refresh(); }); await sleep(700);
    const t2 = await toastTxt(), st = await state();
    rec('m) "already on this sale" shown, then after the sale is paid the next empty sale has no old message', /already on this sale/.test(t1) && x.ok && doneUp && st.cart.length === 0 && !/already on this sale/.test(t2), JSON.stringify({ t1: t1.slice(0, 40), paid: x.ok, doneUp, cart: st.cart.length, t2 }));
    await post('settings', { bulkItems: [], bulkFolders: [], bulkOrder: [] });

    rec('no page errors in the whole run', !errs.length, JSON.stringify(errs));
    await p.close();
  } catch (e) { rec('run', false, e.stack || e.message); }
  b.disconnect();
  const pass = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-stress7-ui-109-results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

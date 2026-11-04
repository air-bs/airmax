// Air Register 1.2.0 UI e2e against the OFFLINE fake AIR POS (tests/fake-server.js on :5058; no real account).
// Needs Chrome with --remote-debugging-port=9333. Run: node tests/fake-server.js & node tests/e2e-120.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const FP = Number(process.env.FAKE_PORT || 5058); // worker 2: FAKE_PORT lets two test runs use separate fake servers
const BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = '/workspace/air-register-1.2.0-work/screens/';
const hang = ms => fetch(HOOK + '/hang?ms=' + ms).then(r => r.text());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
(async () => {
  const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 800 } });
  const page = await b.newPage(); let dialogs = 0; page.on('dialog', d => { dialogs++; d.accept(); });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/'); await sleep(800);
  const st = () => page.evaluate(() => fetch('/api/state').then(r => r.json()));
  const apiP = (r, x) => page.evaluate((r, x) => fetch('/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), r, x);
  const shot = n => page.screenshot({ path: SCR + n + '.png' });
  const modalH = () => page.$eval('#modalRoot h2', e => e.textContent).catch(() => '');
  const active = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const typeScan = async (c, enter = true) => { await page.focus('#scanInput'); await page.keyboard.type(c, { delay: 5 }); if (enter) await page.keyboard.press('Enter'); await sleep(900); };
  const cashPath = async () => { await page.keyboard.press('Enter'); await sleep(250); await page.keyboard.press('+'); await sleep(150); await page.keyboard.press('Enter'); }; // Cash: Enter, +, Enter
  const esc = async () => { await page.keyboard.press('Escape'); await sleep(400); };
  // login (fake shop; any password works on the fake server)
  const fill = async (sel, v) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, v); };
  if (!(await st()).loggedIn) { await fill('#lgCompany', 'fake shop'); await fill('#lgUser', 'tester'); await fill('#lgPw', 'fake'); await page.click('#lgBtn'); await sleep(2500); }
  await apiP('pay-close'); await apiP('new-sale'); await page.goto(BASE + '/'); await sleep(1200);
  let s = await st(); rec('login to fake AIR POS', s.loggedIn, s.user && s.user.name || JSON.stringify(s.user || {}));
  await apiP('settings', { bulkItems: [] }); await page.evaluate(() => refresh()); await sleep(500);
  await page.evaluate(() => { window.__marker = 'no-reload'; });

  // item 2: scanner Enter adds, then empty Enter opens payment
  await typeScan('1001'); s = await st();
  rec('Scanner code + Enter adds the item (no payment window)', s.cart.length === 1 && !(await modalH()), `cart ${s.cart.length}, modal "${await modalH()}"`);
  await page.focus('#scanInput'); await page.keyboard.type('1004', { delay: 5 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await sleep(900); const quick = await modalH();
  rec('Enter right after a scan (scanner CR+LF) does not open payment', !quick, `modal "${quick}"`);
  await sleep(500); await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900);
  const h1 = await modalH(); await shot('120-enter-payment');
  rec('Enter on the empty scan box with items = Payment', h1 === 'Payment', `modal "${h1}"`);
  await page.click('#payBack'); await sleep(700);
  await apiP('new-sale'); await page.evaluate(() => refresh()); await sleep(400);
  await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(700);
  rec('Enter on an empty sale does nothing', !(await modalH()), `modal "${await modalH()}"`);

  // item 7: wrong barcode
  const beeps0 = await page.evaluate(() => (window.__beeps || 0) + ((window.__scanSounds || {}).bad || 0)); // request H: the error tone is now our own WAV (falls back to the beep)
  await typeScan('99999999'); await sleep(300);
  const bad = await page.evaluate(() => ({ msg: document.getElementById('scanMsg').textContent, vis: getComputedStyle(document.getElementById('scanMsg')).display !== 'none', cls: document.getElementById('scanInput').className, beeps: (window.__beeps || 0) + ((window.__scanSounds || {}).bad || 0) }));
  await shot('120-wrong-barcode');
  rec('Wrong barcode: inline message, beep, red scan box, no popup, focus stays in scan box', bad.vis && /Not found: 99999999/.test(bad.msg) && /bad/.test(bad.cls) && bad.beeps > beeps0 && !(await modalH()) && (await active()) === 'scanInput', `${bad.msg} | beeps ${beeps0}->${bad.beeps} | focus ${await active()}`);
  await typeScan('1003'); const cleared = await page.evaluate(() => getComputedStyle(document.getElementById('scanMsg')).display === 'none' && !/bad/.test(document.getElementById('scanInput').className));
  rec('Next good scan clears the not-found message', cleared, 'cleared ' + cleared);

  // item 3: F5 Tax Off, F6 Discount, tiles
  await typeScan('1001'); s = await st(); const tax0 = s.totals.tax;
  await page.keyboard.press('F5'); await sleep(1200); s = await st();
  const ui5 = await page.evaluate(() => ({ marker: window.__marker, tile: !!document.querySelector('[data-a="tax-off"].on'), chip: document.getElementById('gridInfo').textContent, totals: document.getElementById('totals').innerText }));
  await shot('120-tax-off');
  rec('F5 = Tax Off: tax 0 on the whole sale, Tax Off button lit, TAX OFF shown, page not reloaded', s.order.taxExempt && s.totals.tax === 0 && tax0 > 0 && ui5.tile && /TAX OFF/i.test(ui5.chip) && ui5.marker === 'no-reload', `tax ${tax0} -> ${s.totals.tax}; chip "${ui5.chip}"; totals "${ui5.totals.replace(/\n/g, ' ')}"`);
  await page.keyboard.press('F5'); await sleep(1200); s = await st();
  rec('F5 again puts tax back', !s.order.taxExempt && s.totals.tax === tax0, `tax ${s.totals.tax}`);
  const tiles = await page.$$eval('#tiles button, #tiles .tile', x => x.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  const acts = await page.$$eval('#actions button, .actions button', x => x.map(e => e.innerText.replace(/\s+/g, ' ').trim())).catch(() => []);
  const rpan = await page.$$eval('#right .rbtn, .abtn', x => x.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  rec('AIR POS look footer tiles ONLY Customer add (customers; was Member Scan before 1.0.7), Items, Checkout (payment); Discount (F6), Tax Off (F5) and History are in the side panels', tiles.length === 3 && /Customer add/i.test(tiles[0]) && /Items/i.test(tiles[1]) && /Checkout/i.test(tiles[2]) && rpan.some(t => /Sale Discount/.test(t) && /F6/.test(t)) && rpan.some(t => /Tax Off/.test(t) && /F5/.test(t)) && rpan.some(t => /History/.test(t)), tiles.join(' | ') + ' || side: ' + rpan.filter(t => /Discount|Tax Off|History/.test(t)).join(' | '));
  await page.keyboard.press('F6'); await sleep(700); const h6 = await modalH();
  rec('F6 opens Discount', /discount/i.test(h6), `modal "${h6}"`);
  // owner: a click / tap outside a window closes it (same as Esc)
  await page.mouse.move(12, 420); await page.mouse.down(); await page.mouse.up(); await sleep(400); // (not the top-left exit corner)
  rec('Click outside a window closes it (same as Esc)', !(await modalH()), `modal after click "${await modalH()}"`);
  if (await modalH()) await esc();
  // item 6: totals
  const tot = await page.evaluate(() => { const t = document.getElementById('totals'), tt = t.querySelector('.total'); return { txt: t.innerText, fs: parseFloat(getComputedStyle(t).fontSize), tfs: tt ? parseFloat(getComputedStyle(tt.querySelector('span:last-child') || tt).fontSize) : 0, h: t.getBoundingClientRect().height, pre: !!t.querySelector('.pretax') }; });
  await shot('120-totals');
  // 1.0.3 (stripes look approved by Ari 8:15 PM Oct 29): Total is now the big blue number in the dark bar (34px); strip height and small labels unchanged
  rec('Totals (AIR POS look, 1.0.3 stripes): small text, Before tax subtotal, Total value bigger (≤ 36px) in a strip ≤ 60px', tot.fs <= 14 && tot.tfs >= 15 && tot.tfs <= 36 && tot.h <= 60 && tot.pre && /Before tax/.test(tot.txt), `font ${tot.fs}px, total ${tot.tfs}px, height ${tot.h}px; "${tot.txt.replace(/\n/g, ' ')}"`);

  // item 5: persistent quick search
  const n0 = (await st()).cart.length;
  await page.click('#qsIn'); await page.keyboard.type('toy'); await sleep(900);
  const rows = await page.$$eval('#qsRes [data-i]', x => x.length);
  await page.keyboard.press('Enter'); await sleep(1200); s = await st();
  const qsKept = await page.$eval('#qsIn', e => e.value);
  await shot('120-quick-search');
  rec('Quick search panel: results while typing, Enter adds, panel stays with results, focus back to scan box', rows >= 1 && s.cart.length === n0 + 1 && qsKept === 'toy' && (await active()) === 'scanInput', `${rows} rows, cart ${n0}->${s.cart.length}, box "${qsKept}", focus ${await active()}`);

  // item 4: bulk items (empty slots ship -> set up in Settings -> buttons)
  const empty = await page.$eval('#bulkBtns', e => e.innerText);
  rec('Bulk panel ships empty with a set-up button', /No bulk items yet/.test(empty), empty.replace(/\n/g, ' '));
  await page.click('#bulkSetup'); await sleep(600);
  await page.type('#blQ', '1003'); await page.keyboard.press('Enter'); await sleep(900);
  await page.type('#blQ', 'candy'); await page.keyboard.press('Enter'); await sleep(900); await page.click('#blRes [data-i="0"]'); await sleep(300);
  await page.click('#blRows [data-a="1"]'); const lab = await page.$('#blRows [data-l="0"]'); await lab.click({ clickCount: 3 }); await page.keyboard.type('Rope');
  await shot('120-bulk-settings');
  await page.click('#blOk'); await sleep(900); const bmsg = await page.$eval('#blMsg', e => e.textContent); await esc(); await sleep(400);
  s = await st(); const btns = await page.$$eval('#bulkBtns [data-bulk]', x => x.map(e => e.innerText.replace(/\s+/g, ' ')));
  rec('Bulk items set up in Settings (search + scan, label, Ask price) show as side buttons', s.settings.bulkItems.length === 2 && btns.length === 2 && /Rope/.test(btns[0]) && /price/.test(btns[1]), `${bmsg}; buttons ${btns.join(' | ')}`);
  await apiP('new-sale'); await page.evaluate(() => refresh()); await sleep(500);
  await page.click('#bulkBtns [data-bulk="0"]'); await sleep(1000); s = await st();
  rec('Bulk button adds the product', s.cart.length === 1 && /Rope/.test(s.cart[0].name), `cart ${s.cart.map(l => l.name + ' x' + l.quantity).join(', ')}`);
  await page.click('#bulkBtns [data-bulk="1"]'); await sleep(600); const hp = await modalH();
  await page.type('#bpIn', '7.50'); await page.keyboard.press('Enter'); await sleep(1200); s = await st();
  const candy = s.cart.filter(l => /candy/i.test(l.name)).pop();
  await shot('120-bulk-price');
  rec('Bulk button with price prompt: asks, adds at the typed price (line discount)', /candy/i.test(hp) && !(await modalH()) && candy && candy.discountAmount === 2.5 && candy.quantity === 1, `prompt "${hp}"; line ${JSON.stringify(candy).slice(0, 200)}`);
  // 1.0.9.1: the second tap is now refused before the price box opens (toast); the server refusal in #bpMsg stays as the fallback
  await page.click('#bulkBtns [data-bulk="1"]'); await sleep(600);
  if (await page.$('#bpIn')) { await page.type('#bpIn', '6'); await page.keyboard.press('Enter'); await sleep(1200); }
  s = await st();
  const twice = { modal: await modalH(), msg: (await page.$eval('#bpMsg', e => e.textContent).catch(() => '')) || (await page.$eval('#toast', e => e.textContent).catch(() => '')), qty: s.cart.filter(l => /candy/i.test(l.name)).map(l => l.quantity) };
  rec('Same price-prompt item twice: refused with a clear message, first line unchanged', /already on this sale/.test(twice.msg) && JSON.stringify(twice.qty) === '[1]', JSON.stringify(twice));
  await esc();

  // item 11: settings wait + advanced pulse
  await page.keyboard.down('Control'); await page.keyboard.press(','); await page.keyboard.up('Control'); await sleep(1200);
  const se = await page.evaluate(() => ({ dw: $('seDW') && $('seDW').value, pl: $('sePL') && $('sePL').value, adv: $('seAdv') && !$('seAdv').open, auto: $('seC') && $('seC').value, bulk: !!document.querySelector('#stTabs [data-tab="bulk"]') }));
  rec('Settings: drawer wait 5 s, pulse Standard under Advanced (closed), auto-open on cash, Bulk items tab', se.dw === '5' && se.pl === '50' && se.adv && se.auto === 'cash' && se.bulk, JSON.stringify(se));
  await page.$eval('#seDW', e => { e.value = '2'; }); await page.click('#seOk'); await sleep(900); await esc(); s = await st();
  rec('Drawer wait saved from Settings', s.settings.drawerWaitSec === 2, 'drawerWaitSec ' + s.settings.drawerWaitSec);

  // item 10: drawer timeout, short non-blocking message, sale continues
  await hang(60000);
  let t0 = Date.now(); await page.click('.abtn[data-a="drawer"]');
  await page.waitForFunction(() => /no answer/i.test(document.body.innerText), { timeout: 15000 }).catch(() => {}); let ms = Date.now() - t0;
  const dm = await page.evaluate(() => (document.getElementById('toast').textContent || '') + ' ' + (document.getElementById('flash') ? document.getElementById('flash').textContent : ''));
  await shot('120-drawer-timeout');
  rec('Open Drawer with no answer: gives up after the wait (2 s here), short message, no popup', ms < 4500 && /no answer/i.test(dm) && !(await modalH()), `${ms} ms: ${dm.trim().slice(0, 200)}`);
  const c1 = (await st()).cart.length; await typeScan('1004'); s = await st();
  rec('Sale continues right after a drawer timeout', s.cart.length === c1 + 1 && (await active()) === 'scanInput', `cart ${c1}->${s.cart.length}`);
  // cash sale with dead drawer: done screen within wait + margin
  await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900);
  t0 = Date.now(); await cashPath();
  await page.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 20000 }).catch(() => {}); ms = Date.now() - t0;
  const done = await page.$eval('#modalRoot', e => e.innerText).catch(() => '');
  // request L: the drawer runs in the background after the sale; a failure is a small fading note, not text in the done box
  const dNote = await page.waitForFunction(() => [...document.querySelectorAll('#softNotes .softnote')].some(e => /drawer didn't open/i.test(e.innerText)), { timeout: 8000, polling: 200 }).then(() => true).catch(() => false);
  const nt = await page.$$eval('#softNotes .softnote', x => x.map(e => e.innerText).join(' | ')).catch(() => '');
  await shot('120-done-drawer-timeout');
  rec('Cash sale with a dead drawer: Sale complete right away, then a short fading drawer note', /Sale complete/.test(done) && ms < 6000 && dNote, `${ms} ms; note "${nt}"; ${done.replace(/\n/g, ' ').slice(0, 160)}`);
  // item 8: print -> back to the sale screen
  await hang(0);
  await page.click('#dPrint'); await sleep(1800); s = await st();
  const after = { modal: await modalH(), focus: await active(), toast: await page.$eval('#toast', e => e.textContent) };
  await shot('120-after-print');
  rec('Print Receipt: window closes, back on an empty sale screen, focus in scan box', !after.modal && after.focus === 'scanInput' && s.cart.length === 0 && s.mode === 'sale', JSON.stringify(after));
  // done-screen drawer button (fast drawer)
  await typeScan('1003'); await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900); await cashPath();
  await page.waitForSelector('#dDrawer', { visible: true, timeout: 20000 }).catch(() => {}); // Step 0 test update: wait for the done screen (M1 keptCheck can add ~3.2 s to a cash sale) instead of a fixed 2.5 s
  await page.click('#dDrawer'); await sleep(1500); const dd = await page.$eval('#doneMsg', e => e.textContent).catch(() => '');
  rec('Done screen Open Drawer works', /Drawer opened/i.test(dd), dd);
  await page.click('#dNew'); await sleep(600);
  // quick cash buttons under the Cash line: $20 fills Cash, Exact = amount due, next-bill suggestions shown
  await typeScan('1003'); await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900);
  await page.keyboard.press('ArrowDown'); await page.evaluate(() => [...document.querySelectorAll('.pline')].find(r => r.querySelector('.plbl').textContent === 'Cash').click()); await sleep(400);
  const qc = await page.evaluate(() => ({ btns: [...document.querySelectorAll('.quick button')].map(b => [...b.childNodes].filter(n => !(n.classList && n.classList.contains('dk'))).map(n => n.textContent).join('')), nb: document.querySelectorAll('#nextBills .nb').length }));
  await page.click('.quick button[data-l="20"]'); await sleep(200); const qv20 = await page.$eval('#cashIn', e => e.value);
  await page.click('.quick button[data-l="Exact"]:not(.nb)'); await sleep(200); const qvEx = await page.$eval('#cashIn', e => e.value);
  const dueQ = (await st()).pay; await shot('120-quick-cash');
  rec('Quick cash buttons under Cash: $20 fills 20.00, Exact fills the amount due, next-bill suggestions', qv20 === '20' && Number(qvEx) > 0 && qc.btns.includes('Exact') && qc.btns.includes('$100') && qc.nb >= 1, `buttons ${qc.btns.join(' ')}; $20->${qv20}; Exact->${qvEx}; due ${dueQ && dueQ.remaining}`);
  await page.keyboard.press('Enter'); await page.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 15000 }).catch(() => {});
  rec('Exact + Enter completes the sale', /Sale complete/.test(await page.$eval('#modalRoot', e => e.innerText).catch(() => '')), 'done');
  await page.click('#dNew').catch(() => {}); await sleep(600);
  // F5 never reloads even on an empty sale
  await page.keyboard.press('F5'); await sleep(800); rec('F5 never reloads the page', (await page.evaluate(() => window.__marker)) === 'no-reload', 'marker kept');
  if ((await st()).order.taxExempt) await page.keyboard.press('F5');

  // ===== approved key map / layout / item 12 / item 13 =====
  await apiP('new-sale'); await page.evaluate(() => refresh()); await sleep(500);
  const tiles2 = await page.$$eval('#tiles .tile', x => x.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  rec('Footer tiles: exactly Customer add (1.0.7, was Member Scan), Items, Checkout (AIR POS look)', tiles2.length === 3 && /Customer add/i.test(tiles2[0]) && /Items/i.test(tiles2[1]) && /Checkout/i.test(tiles2[2]), tiles2.join(' | '));
  const rb = await page.$$eval('#right .rbtn', x => x.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  const gi = rb.findIndex(t => /^Gift Card\b/.test(t) && !/Balance/.test(t));
  rec('Right panel: "Gift Card" then "Multiple Gift Cards" right below it', gi >= 0 && /^Multiple Gift Cards/.test(rb[gi + 1]), rb.slice(Math.max(0, gi - 1), gi + 3).join(' | '));
  // *N quantity
  await typeScan('1003'); await typeScan('*5'); s = await st();
  rec('*5 + Enter sets the quantity of the last line to 5 (no window)', s.cart.length === 1 && s.cart[0].quantity === 5 && !(await modalH()) && (await page.$eval('#scanInput', e => e.value)) === '', `qty ${s.cart[0] && s.cart[0].quantity}`);
  // F2 quick search
  await page.keyboard.press('F2'); await sleep(300); const qa = await active(); await page.keyboard.type('gift bag'); await sleep(900); await page.keyboard.press('Enter'); await sleep(1200); s = await st();
  rec('F2 = quick search: type, Enter adds', qa === 'qsIn' && s.cart.some(l => /Gift bag/.test(l.name)), `focus ${qa}; cart ${s.cart.map(l => l.name).join(', ')}`);
  // Delete removes the selected line with no confirm
  const d0 = dialogs, c0 = s.cart.length; await page.focus('#scanInput'); await page.keyboard.press('Delete'); await sleep(1000); s = await st();
  rec('Delete removes the selected line with no confirm popup', s.cart.length === c0 - 1 && dialogs === d0 && !(await modalH()), `cart ${c0}->${s.cart.length}, popups ${dialogs - d0}`);
  // New sale (Ctrl+Shift+N) with no confirm
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyN'); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(900); s = await st();
  rec('Ctrl+Shift+N = new sale, no "clear the sale?" popup', s.cart.length === 0 && dialogs === d0, `cart ${s.cart.length}, popups ${dialogs - d0}`);
  // item 13: payment tender list
  await typeScan('1001'); await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900);
  const pl = await page.$$eval('.pline', x => x.map(e => e.querySelector('.plbl').textContent));
  // 1.0.8 (Ari OK 12:50 AM Oct 30): the payment is a centred pop-up over the dimmed sale (was a full-height left side panel)
  const full = await page.$eval('#modalRoot .modal', e => { const r = e.getBoundingClientRect(); return Math.abs(r.x + r.width / 2 - innerWidth / 2) <= 2 && r.width <= 900 && r.width >= Math.min(900, innerWidth - 48) - 2 && r.top >= 0 && r.bottom <= innerHeight; });
  const big = await page.$eval('#payDue', e => parseFloat(getComputedStyle(e).fontSize));
  await shot('120-pay-list');
  rec('Payment: centred pop-up (was left panel), vertical list Credit Card, Cash, then others; big amount due', pl[0] === 'Credit Card' && pl[1] === 'Cash' && pl.length >= 3 && full && big >= 40, `${pl.join(', ')}; full ${full}; due ${big}px`);
  const hiAt = () => page.$eval('.pline.on .plbl', e => e.textContent);
  const h0 = await hiAt(); await page.keyboard.press('Enter'); await sleep(300); const h1b = await hiAt(); await page.keyboard.press('Enter'); await sleep(300); const h2 = await hiAt();
  rec('Enter moves the highlight down one line', h0 === 'Credit Card' && h1b === 'Cash' && h2 === 'Gift Card', [h0, h1b, h2].join(' -> '));
  await page.keyboard.press('Escape'); await sleep(400);
  rec('Esc goes back one step (payment closes, sale kept)', !(await modalH()) && (await st()).cart.length === 1, `modal "${await modalH()}"`);
  await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900); await page.keyboard.press('Enter'); await sleep(250);
  await page.keyboard.press('NumpadAdd'); await sleep(200); const filled = await page.$eval('#cashIn', e => e.value); const dueNow = await page.$eval('#payDue', e => e.textContent);
  rec('Numpad + fills the whole amount due on the highlighted line', filled === '10.80' && dueNow === '$0.00', `cash "${filled}", due ${dueNow}`);
  const nums = await page.$$eval('.paynums .pn span', x => x.map(e => e.textContent)); const zero = await page.$eval('#payDue', e => e.parentElement.classList.contains('zero'));
  rec('Payment shows Due / Paid / Balance (+ Change) big; Balance turns green at $0.00', nums.join(',') === 'Due,Paid,Balance,Change' && zero, `${nums.join(', ')}; zero ${zero}`);
  await page.keyboard.press('Enter'); await page.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 8000 }).catch(() => {});
  rec('Cash path Enter, +, Enter = sale done', /Sale complete/.test(await page.$eval('#modalRoot', e => e.innerText).catch(() => '')), (await modalH()));
  await page.keyboard.type('1003', { delay: 5 }); await page.keyboard.press('Enter'); await sleep(1200); s = await st(); // worker 2: scan straight from the done screen
  rec('Done screen: scanning the next item closes it and starts the next sale (no extra key)', !(await modalH()) && s.cart.length === 1 && !s.completed && (await active()) === 'scanInput', `modal "${await modalH()}", cart ${s.cart.map(l => l.code || l.name).join(',')}`);
  await apiP('new-sale'); await page.evaluate(() => refresh()); await sleep(500);
  // split tender: type 5 on cash, + on Check fills the rest (work copy: Check needs a customer on the sale, so the made-up test customer is attached)
  await typeScan('1001'); await apiP('member-attach', { number: '5550001' }); await page.evaluate(() => refresh()); await sleep(300); await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900); await page.keyboard.press('Enter'); await sleep(250);
  await page.keyboard.type('5'); await sleep(150); await page.keyboard.press('Enter'); await sleep(300); const atGift = await hiAt(); await page.keyboard.press('Enter'); await sleep(300);
  await page.keyboard.press('+'); await sleep(150); const chk = await page.$eval('#pa-50', e => e.value); const due2 = await page.$eval('#payDue', e => e.textContent);
  await shot('120-pay-split');
  rec('Split tender: digits = custom amount, Enter moves on while money is still due, + fills only the rest', atGift === 'Gift Card' && chk === '5.80' && due2 === '$0.00', `after 5 cash -> ${atGift}; check "${chk}"; due ${due2}`);
  await page.keyboard.press('Enter'); await sleep(500); const askNo = { msg: await page.$eval('#payMsg', e => e.textContent).catch(() => ''), focus: await active() };
  await page.keyboard.type('1234'); await page.keyboard.press('Enter'); await page.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 8000 }).catch(() => {});
  rec('Check line with no check number: asks for it in place (focus on the number), Enter then finishes', /check number/i.test(askNo.msg) && askNo.focus === 'chkNo', JSON.stringify(askNo));
  const calls = JSON.parse(await (await fetch(HOOK + '/')).text()).calls;
  rec('Split tender finishes in one go (check, then cash)', /Sale complete/.test(await page.$eval('#modalRoot', e => e.innerText).catch(() => '')), calls.filter(c => /Receive|Complete/.test(c)).slice(-4).join(', '));
  await page.click('#dNew'); await sleep(600);
  // item 12: multiple gift cards
  await page.click('#right .rbtn[data-a="gift-multi"]'); await sleep(500);
  await page.type('#gmAmt', '25'); await page.keyboard.press('Enter'); await sleep(150);
  const gmFocus = await active();
  let dupMsg = ''; for (const n of ['6000123400000001', '6000123400000002', '6000123400000001', '7000000000009999']) { await page.keyboard.type(n, { delay: 2 }); await page.keyboard.press('Enter'); await sleep(900); if (!dupMsg) dupMsg = await page.$eval('#gmMsg', e => e.innerText).catch(() => ''); }
  const gm = await page.evaluate(() => ({ title: document.querySelector('#modalRoot h2').innerText, list: $('gmList').innerText, count: $('gmCount').innerText, msg: $('gmMsg').innerText, notes: document.querySelectorAll('#modalRoot .note, #modalRoot p').length, labels: [...document.querySelectorAll('#modalRoot label')].map(l => l.innerText) }));
  rec('Multiple Gift Cards window is minimal: title, Amount, Scan card, list, count + total; no helper text', gm.title === 'Multiple Gift Cards' && gm.notes === 0 && gm.labels.join('|') === 'Amount|Scan card' && /3 cards/.test(gm.count) && /\$75\.00/.test(gm.count), JSON.stringify({ title: gm.title, notes: gm.notes, labels: gm.labels, count: gm.count }));
  await shot('120-gift-multi');
  rec('Multiple gift cards: amount once, each scan adds at once, duplicate refused', gmFocus === 'gmNo' && /\*\*\*\* 0001/.test(gm.list) && /\*\*\*\* 9999/.test(gm.list) && /already on this sale/.test(dupMsg) && !/6000123400000001/.test(gm.list), JSON.stringify(gm).replace(/\\n/g, ' ').slice(0, 300));
  await page.keyboard.press('Enter'); await sleep(900); s = await st();
  const gl = s.cart.filter(l => l.type === 30 || l.type === 40);
  const gmBack = await modalH(), names = gl.map(l => l.name); await shot('120-gift-multi-cart');
  await page.keyboard.press('Enter'); await sleep(900); const gmPay = await modalH(); await shot('120-gift-multi-pay'); await page.keyboard.press('Escape'); await sleep(500); // round 3: Done -> the sale (lines visible), Enter -> Payment
  rec('Multiple gift cards: Done = back to the sale with lines "Gift Card **** 1234"; Enter = Payment; Esc back', !gmBack && names.every(n => /^Gift Card \*\*\*\* \d{4}$/.test(n)) && gmPay === 'Payment' && !(await modalH()), `after Done "${gmBack}" lines ${names.join(', ')}; after Enter "${gmPay}"`);
  rec('Enter on the empty scan field finishes; 3 card lines (2 new, 1 reload) at $25 each', gl.length === 3 && gl.every(l => l.price === 25) && gl.filter(l => l.type === 40).length === 1 && dialogs === d0, gl.map(l => l.type + ':' + l.price).join(', '));
  await page.click('#right .rbtn[data-a="gift-multi"]'); await sleep(500); const again = await page.$eval('#gmAmt', e => e.value); await page.keyboard.press('Escape'); await sleep(400);
  rec('Multiple gift cards: the last amount is offered again (type over it)', again === '25' && !(await modalH()), `amount "${again}"`);
  // single Gift Card button
  await page.click('#right .rbtn[data-a="gift-card"]'); await sleep(500); const gh = await modalH();
  await page.type('#gmAmt', '10'); await page.keyboard.press('Enter'); await page.keyboard.type('6000123400000003'); await page.keyboard.press('Enter'); await sleep(1200); s = await st();
  rec('Gift Card button: amount, scan, done (closes by itself)', /^Gift Card$/.test(gh) && !(await modalH()) && s.cart.filter(l => l.type === 30 || l.type === 40).length === 4, `title "${gh}", modal "${await modalH()}"`);
  await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(900); await cashPath();
  await page.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 8000 }).catch(() => {});
  const gdone = await page.$eval('#doneGifts', e => e.innerText).catch(() => '');
  await shot('120-gift-done');
  rec('One checkout for all cards; done screen lists each card masked with its amount', /Gift cards activated \(4\)/.test(gdone) && /\*\*\*\* 0003 \$10\.00/.test(gdone) && !/600012340000/.test(gdone), gdone);
  await page.click('#dNew'); await sleep(600);
  // History presets + CSV
  await page.keyboard.down('Control'); await page.keyboard.press('KeyL'); await page.keyboard.up('Control'); await sleep(1200);
  await page.select('#hP', 'today'); await sleep(1500);
  const hs = await page.evaluate(() => ({ sum: $('hSum') && $('hSum').innerText, rows: document.querySelectorAll('#modalRoot tbody tr').length, opts: [...$('hP').options].map(o => o.text).length, csv: !!$('hCsv') }));
  await shot('120-history');
  rec('History: date presets (Today, Yesterday, weeks, months, 30/90 days, quarter, year, one date), totals line, CSV export', hs.opts >= 12 && /completed/.test(hs.sum) && hs.rows >= 3 && hs.csv, JSON.stringify(hs));
  await esc();
  // Settings: Save diagnostics
  await page.keyboard.down('Control'); await page.keyboard.press(','); await page.keyboard.up('Control'); await sleep(1200);
  const hasDiag = !!(await page.$('#seDiag')); if (hasDiag) { await page.click('#seDiag'); await sleep(2500); }
  const dmsg = await page.evaluate(() => document.getElementById('modalRoot').innerText + ' ' + document.getElementById('toast').textContent);
  rec('Settings: Save diagnostics writes the printer report file', hasDiag && /AirRegister-printer-diagnostics\.txt/.test(dmsg), (dmsg.match(/Diagnostics[^\n]*/) || [''])[0].slice(0, 200));
  await esc();
  rec('No browser script errors', !errs.length, errs.slice(0, 3).join(' | ') || 'none');
  fs.writeFileSync(process.env.E2E_RESULTS || (__dirname + '/e2e-120-results.json'), JSON.stringify(out, null, 2));
  await page.close(); b.disconnect();
  console.log(`\n${out.filter(x => x.pass).length}/${out.length} UI e2e (1.2.0) passed`); process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });

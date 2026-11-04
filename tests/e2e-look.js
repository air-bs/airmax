// Air Register (AIR POS look): screenshots + look checks of the restyled sale screen, against the OFFLINE fake AIR POS.
// Run via tests/run-all-look.sh (fake 5180, Chrome 9433). Writes screens/look-*.png.
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens') + '/'; fs.mkdirSync(SCR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));   // leave-page prompt when reloading for the refund screenshot
    await p.goto(BASE + '/'); await sleep(1200); await p.screenshot({ path: SCR + 'look-login.png' });
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    await p.goto(BASE + '/'); await sleep(1500);
    await p.screenshot({ path: SCR + 'look-empty.png' });
    const css = (sel, prop) => p.$eval(sel, (e, pr) => getComputedStyle(e)[pr], prop).catch(() => null);
    rec('Top bar is white with the AIR POS-style logo and the app name "Air Max" (Oct 30 rename; no old name)', await css('.top', 'backgroundColor') === 'rgb(255, 255, 255)' && /Air Max/.test(await p.$eval('.top', e => e.innerText)) && !/Air Register|AIR POS look/i.test(await p.$eval('.top', e => e.innerText)), await css('.top', 'backgroundColor'));
    rec('ORDER CHECKOUT title and SCANNING INPUT box above the table', await p.evaluate(() => { const t = document.querySelector('.cotitle'), s = document.getElementById('scanInput'), g = document.querySelector('.gridbox'); return /ORDER CHECKOUT/.test(t.innerText) && s.getBoundingClientRect().bottom <= g.getBoundingClientRect().top + 1; }), '');
    rec('Scan box has focus on the sale screen', await p.evaluate(() => document.activeElement && document.activeElement.id) === 'scanInput', '');
    await p.focus('#scanInput');
    for (const c of ['1001', '1003', '1004']) { await p.keyboard.type(c); await p.keyboard.press('Enter'); await sleep(700); }
    await p.keyboard.type('*3'); await p.keyboard.press('Enter'); await sleep(700);
    const s = await state();
    rec('Three items scanned, *3 sets the quantity (same keys as the store app)', s.cart.length === 3 && (s.cart.find(l => l.number === '1004') || {}).quantity === 3, s.cart.map(l => l.number + 'x' + l.quantity).join(', '));
    const heads = await p.$$eval('#cartHead th', x => x.map(e => e.innerText.trim()));
    rec('Table headers use the store wording (Ari 4:40 PM): # | Lookup Code | Name | Qty | Price | Discount | Total', heads.map(h => h.toUpperCase()).join('|') === '#|LOOKUP CODE|NAME|QTY|PRICE|DISCOUNT|TOTAL', heads.join(' | '));
    rec('Totals strip says "Quantity" (store wording), not "Total Quantity"', /Quantity/i.test(await p.$eval('#totals', e => e.innerText)) && !/Total Quantity/i.test(await p.$eval('#totals', e => e.innerText)), '');
    const tot = await p.$eval('#totals', e => e.innerText.replace(/\s+/g, ' '));
    const big = await p.$$eval('#totals span', x => Math.max(...x.map(e => parseFloat(getComputedStyle(e).fontSize))));
    const th = await p.$eval('#totals', e => e.getBoundingClientRect().height);
    // 1.0.3 stripes look (Ari approved 8:15 PM Oct 29): the Total is the big blue number (34px) in the dark bar; strip height unchanged
    rec('Totals line: one strip (≤ 80px), Total ≤ 36px (1.0.3 stripes), and it shows the same Total as the server', big <= 36 && th <= 80 && tot.includes('$' + s.totals.due.toFixed(2)), `max font ${big}px, height ${Math.round(th)}px, "${tot}"`);
    const foot = await p.$$eval('.apfoot [data-a], .apfoot [data-fa]', x => x.filter(e => e.getClientRects().length).sort((a, b) => { const r = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return Math.abs(r.y - q.y) > 8 ? r.y - q.y : r.x - q.x; }).map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    rec('Footer buttons: only Customer add (1.0.7, was Member Scan), Items, Checkout (extra Hold Order / Open Drawer removed, Ari 4:40 PM)', foot.length === 3 && /CUSTOMER ADD/i.test(foot[0]) && /ITEMS/i.test(foot[1]) && /CHECKOUT/i.test(foot[2]) && !(await p.$('.apf, [data-fa]')), foot.join(' | '));
    // 1.0.3 stripes look: Checkout is a white tile with the green sale stripe (was solid green)
    rec('Checkout has the green sale stripe (1.0.3 stripes look)', /rgb\(24, 160, 88\)/.test(await css('#tiles [data-a="checkout"]', 'boxShadow')), await css('#tiles [data-a="checkout"]', 'boxShadow'));
    rec('Left-side Hold and Drawer buttons are still there and visible', await p.$$eval('#actions .abtn[data-a="hold"], #actions .abtn[data-a="drawer"]', x => x.filter(e => e.getClientRects().length).length) === 2, '');
    rec('look.js is gone (not loaded by the page)', (await p.$$eval('script', x => x.map(e => e.src))).every(u => !/look\.js/.test(u)), '');
    // 1.0.3 stripes look: left buttons are white with dark text and a coloured stripe on the left (was blue text)
    rec('Left buttons are white with a coloured stripe (1.0.3 stripes look)', /8px 0px 0px 0px inset/.test(await css('#actions .abtn[data-a="history"]', 'boxShadow')) && await css('#actions .abtn[data-a="history"]', 'backgroundColor') === 'rgb(255, 255, 255)', await css('#actions .abtn[data-a="history"]', 'boxShadow'));
    rec('Right panel headers PRODUCT SEARCH / QUICK ADD', /PRODUCT SEARCH/.test(await p.$eval('#qsPanel h3', e => e.innerText)) && /QUICK ADD/.test(await p.$eval('#bulkPanel h3', e => e.innerText)), '');
    await p.screenshot({ path: SCR + 'look-sale.png' });
    await p.setViewport({ width: 1024, height: 640 }); await sleep(500); await p.screenshot({ path: SCR + 'look-sale-1024.png' });
    await p.setViewport({ width: 1920, height: 1080 }); await sleep(500); await p.screenshot({ path: SCR + 'look-sale-1920.png' }); await p.setViewport({ width: 1280, height: 800 }); await sleep(400);
    await p.evaluate(() => { window.__runs = []; const o = window.run; window.run = a => { window.__runs.push(a); return o(a); }; });
    await p.click('#actions .abtn[data-a="hold"]'); await sleep(900); await p.click('#actions .abtn[data-a="drawer"]'); await sleep(1200); await p.keyboard.press('Escape'); await sleep(400);
    const runs = await p.evaluate(() => window.__runs);
    rec('Left Hold / Drawer buttons still run hold and drawer, no page errors', runs.slice(0, 2).join() === 'hold,drawer' && errs.length === 0, runs.join(', ') + (errs.length ? ' errors: ' + errs.join('; ') : ''));
    await post('new-sale'); await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(700);
    await p.click('#tiles [data-a="checkout"]'); await sleep(1200);
    // 1.0.8 (Ari OK 12:50 AM Oct 30): centred pop-up over the dimmed sale (was: left side panel, sale visible on the right)
    rec('Footer Checkout opens the store 1.2.3 payment (sidepay) as a centred pop-up, sale still drawn behind', !!(await p.$('#payBody')) && await p.$eval('#modalRoot .modal', e => { const r = e.getBoundingClientRect(); return /\bsidepay\b/.test(e.className) && Math.abs(r.x + r.width / 2 - innerWidth / 2) <= 2; }) && await p.$eval('#cart', e => e.getBoundingClientRect().width > 200), '');
    const pc = sel => p.$eval(sel, e => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.borderRadius, c.boxShadow].join(' / '); }).catch(() => 'missing');
    rec('Payment panel in the AIR POS look: white header with a blue title and blue underline, dark Balance strip with the amount in light blue (1.0.3), small corners', await css('.payhead', 'backgroundColor') === 'rgb(255, 255, 255)' && await css('.payhead h2', 'color') === 'rgb(20, 108, 255)' && /rgb\(20, 108, 255\)/.test(await css('.payhead', 'boxShadow')) && await css('.paynums .pn.left', 'backgroundColor') === 'rgb(13, 23, 38)' && await css('.paynums .pn.left b', 'color') === 'rgb(72, 138, 253)' && await css('.pline', 'borderRadius') === '2px', [await pc('.payhead'), await pc('.paynums .pn.left'), await pc('.pline')].join(' | '));
    rec('Payment panel keeps the store lines (Credit Card, Cash, Gift Card, Check, Manual Credit, Account)', (await p.$$eval('.pline .plbl', x => x.map(e => e.textContent.trim()))).length === 6, (await p.$$eval('.pline .plbl', x => x.map(e => e.textContent.trim()))).join(', '));
    await p.screenshot({ path: SCR + 'look-payment.png' });
    await p.keyboard.press('Escape'); await sleep(600); await post('pay-close'); await post('new-sale');
    // refund panel (store 1.2.3: same left panel, labelled Refund) on a made-up fake receipt T9001
    const rs = await post('return-start', { kind: 'receipt', orderId: 'o-ret-acct' });
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(1000); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1300);
    rec('Refund panel: same left panel, AIR POS red header line, dark Refund strip with the amount in red (1.0.3)', rs.ok && !!(await p.$('#refBody')) && await css('.payhead h2', 'color') === 'rgb(255, 8, 73)' && await css('.paynums .pn.left', 'backgroundColor') === 'rgb(13, 23, 38)' && await css('.paynums .pn.left b', 'color') === 'rgb(255, 122, 138)', (rs.ok ? '' : rs.message + ' ') + [await pc('.payhead h2'), await pc('.paynums .pn.left')].join(' | '));
    await p.screenshot({ path: SCR + 'look-refund.png' });
    await p.keyboard.press('Escape'); await sleep(500); await post('pay-close'); await post('return-cancel'); await post('return-toggle', { on: false }); await post('new-sale');
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.close();
  } catch (e) { rec('look run', false, e.message); }
  finally { b.disconnect(); }
  console.log(`${out.filter(o => o.pass).length}/${out.length} passed`); process.exit(out.every(o => o.pass) ? 0 : 1);
})();

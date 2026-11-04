// AirMax 1.0.7 wide Customer add | Items | Checkout boxes (Ari OK 12:30 AM ET Oct 30, option A = boxes across the sale area).
// Offline fake AIR POS only (made-up customers 5550100 "Sample Customer" $42.50 and 5550101 "Zero Balance" $0.00, no account).
// Checks at 1024, 1280 and 1366: the 3 buttons + keys are there and nothing is cut off, boxes >= 82px tall across the sale area,
// customer card (name, Account green / red at <= $0, Phone, Points), small customer chip kept and clickable, payment panel width
// 1.0.8: centred pop-up, boxes behind not squeezed; no MOCK-UP tag. Screenshots with the fake customer at 1366 and 1024.
// Run: FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-wide-customer-107.js  (Chrome on 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens') + '/'; fs.mkdirSync(SCR, { recursive: true });
const POP_W = w => Math.min(900, w - 48); // 1.0.8 payment pop-up width (Ari OK 12:50 AM Oct 30; 1.0.6/1.0.7 side panel was 601 / 563 / 451px)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const p = await b.newPage(); const errs = [];
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const clean = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach'); };
    await clean();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {})); await p.bringToFront();
    await p.setViewport({ width: 1366, height: 768 }); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const refresh = async () => { await p.evaluate(() => refresh()); await sleep(600); };
    await scan('1001'); await scan('1003'); await scan('1004');
    // what the three boxes look like at a width (paying = payment panel open)
    const boxes = () => p.evaluate(() => {
      const vis = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const gb = document.querySelector('.gridbox').getBoundingClientRect();
      return [...document.querySelectorAll('#tiles .tile')].map(t => { const r = t.getBoundingClientRect(), k = t.querySelector('.k');
        const cut = [t, ...t.querySelectorAll('*')].filter(vis).filter(e => { const q = e.getBoundingClientRect(); return e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis' || q.right > r.right + 1 || q.bottom > r.bottom + 1 || q.left < r.left - 1; }).map(e => e.className || e.tagName);
        return { a: t.dataset.a, label: [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(), key: k && vis(k) ? k.textContent.trim() : '', h: Math.round(r.height), l: Math.round(r.left - gb.left), r: Math.round(gb.right - r.right), w: Math.round(r.width),
          onScreen: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, cut }; }); });
    const rowOk = (bx, wide) => bx.length === 3 && /^Customer add/i.test(bx[0].label) && bx[0].key === 'F3' && /^Items/i.test(bx[1].label) && bx[1].key === 'Esc' && /^Checkout/i.test(bx[2].label) && bx[2].key === 'F12'
      && bx.every(x => x.h >= 82 && x.onScreen && !x.cut.length) && (!wide || (bx[0].l <= 30 && bx[2].r <= 30));
    const card = () => p.evaluate(() => { const c = document.querySelector('#info-customer .custc'); if (!c) return { hint: document.getElementById('info-customer').innerText };
      const bal = c.querySelector('b.bal'); return { text: c.innerText.replace(/\s+/g, ' '), bal: bal ? bal.textContent : null, color: bal ? getComputedStyle(bal).color : null, neg: bal ? bal.classList.contains('neg') : false, nmCut: (n => n.scrollWidth > n.clientWidth + 1)(c.querySelector('.nm')) }; });
    for (const w of [1366, 1280, 1024]) {
      await p.setViewport({ width: w, height: 768 }); await post('member-detach'); await refresh();
      let bx = await boxes(); const c0 = await card();
      rec(`${w}: no customer: Customer add (F3) / Items (Esc) / Checkout (F12) across the sale area, >= 82px, nothing cut off`, rowOk(bx, true), JSON.stringify(bx));
      rec(`${w}: no customer: hint "Scan card, phone or tap to add"`, c0.hint === 'Scan card, phone or tap to add', JSON.stringify(c0));
      await post('member-attach', { number: '5550100' }); await refresh();
      bx = await boxes(); const c1 = await card();
      rec(`${w}: Sample Customer: card shows name, Account $42.50 (green), Phone 555-0100, Points 120`, /Sample Customer/.test(c1.text) && c1.bal === '$42.50' && c1.color === 'rgb(24, 160, 88)' && !c1.neg && /555-0100/.test(c1.text) && /120/.test(c1.text) && !c1.nmCut, JSON.stringify(c1));
      rec(`${w}: with customer: buttons, keys, sizes still fit`, rowOk(bx, true), JSON.stringify(bx));
      if (w !== 1280) await p.screenshot({ path: `${SCR}v107-sale-customer-${w}.png` });
      await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1400);
      const pm = await p.evaluate(() => { const m = document.querySelector('.modal.fullpay'); if (!m) return { w: 0 }; const r = m.getBoundingClientRect(); return { w: Math.round(r.width), mid: Math.round(r.x + r.width / 2), top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
      const bx0 = bx; bx = await boxes();
      const same = bx.length === 3 && bx.every((x, i) => Math.abs(x.w - bx0[i].w) <= 1 && Math.abs(x.h - bx0[i].h) <= 1);
      rec(`${w}: payment open: centred pop-up ${POP_W(w)}px over the sale; the boxes behind keep their size (no squeeze)`, Math.abs(pm.w - POP_W(w)) <= 1 && Math.abs(pm.mid - w / 2) <= 2 && pm.top >= 0 && pm.bottom <= 768 && same && rowOk(bx, true), `pop-up ${JSON.stringify(pm)}; ${JSON.stringify(bx)}`);
      if (w !== 1280) await p.screenshot({ path: `${SCR}v108-payment-customer-${w}.png` });
      await p.keyboard.press('Escape'); await sleep(600);
    }
    await p.setViewport({ width: 1366, height: 768 });
    await post('member-attach', { number: '5550101' }); await refresh();
    const cz = await card();
    // 1.0.9-local.9 (Stress Tester local.7, Ari OK 9:24 PM ET Oct 31): $0.00 is hidden on the tile, as on the chip and the F3 Customer box (was: shown red)
    rec('Account $0.00 not shown on the Customer tile (no red ACCOUNT $0.00); name, phone, points still shown', cz.bal === null && !/Account/i.test(cz.text) && /Zero Balance/.test(cz.text), JSON.stringify(cz));
    const chip = await p.$eval('#memChip', e => e.offsetParent ? e.innerText : '').catch(() => '');
    await p.click('#memChip').catch(() => {}); await sleep(800);
    const dlg1 = await p.evaluate(() => /Customer/i.test((document.querySelector('#modalRoot .modal h2, #modalRoot .modal h3') || {}).textContent || ''));
    rec('Small customer chip above the cart kept and clickable (opens Customer)', /Zero Balance/.test(chip) && dlg1, `chip "${chip}", dialog ${dlg1}`);
    await p.keyboard.press('Escape'); await sleep(500);
    await p.click('#tiles .tile[data-a="customer"]'); await sleep(800);
    const dlg2 = await p.evaluate(() => /Customer/i.test((document.querySelector('#modalRoot .modal h2, #modalRoot .modal h3') || {}).textContent || ''));
    await p.keyboard.press('Escape'); await sleep(500); await p.focus('#scanInput'); await p.keyboard.press('F3'); await sleep(800);
    const dlg3 = await p.evaluate(() => /Customer/i.test((document.querySelector('#modalRoot .modal h2, #modalRoot .modal h3') || {}).textContent || ''));
    await p.keyboard.press('Escape'); await sleep(500);
    rec('Customer add box and F3 both open Customer (same action as before)', dlg2 && dlg3, `click ${dlg2}, F3 ${dlg3}`);
    const html = await p.content();
    rec('No MOCK-UP tag on screen', !/MOCK-UP/i.test(await p.evaluate(() => document.body.innerText)) && !/mockex/.test(html), '');
    await clean(); await refresh();
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
  } catch (e) { rec('ran without crashing', false, e.stack); }
  fs.writeFileSync(path.join(__dirname, 'e2e-wide-customer-107-results.json'), JSON.stringify(out, null, 2));
  await p.close().catch(() => {}); b.disconnect();
  const n = out.filter(x => x.pass).length; console.log(`\n${n}/${out.length} wide customer box checks passed (AirMax 1.0.7)`); process.exit(n === out.length ? 0 : 1);
})();

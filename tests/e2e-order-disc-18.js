// Store request #18 (Nov 2): with an order discount (F6) on, EVERY item line shows it in green with the % (screen only), and the
// totals are exactly what AIR POS (the fake) gave, to the cent. Run against the OFFLINE fake AIR POS (see run-all-look.sh).
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const tags = () => p.$$eval('#cart tr.row', t => t.map(r => { const d = r.querySelector('.odisc'); return d ? { text: d.innerText.trim(), color: getComputedStyle(d).color } : null; }));
    for (const c of ['1001', '1003', '1004']) await post('scan', { code: c });
    await post('scan', { code: '1001' }); // 1001 qty 2
    await p.evaluate(() => refresh()); await sleep(500);
    let t0 = await tags(), s0 = await state();
    rec('A1 no order discount: no per-line tag on any line', t0.length >= 3 && t0.every(x => x === null), JSON.stringify(t0));
    const before = JSON.stringify(s0.totals);
    // percent order discount
    let r = await post('discount', { kind: 'percent', value: 10 }); await p.evaluate(() => refresh()); await sleep(600);
    let s1 = await state(), t1 = await tags();
    rec('A2 10% order discount: every item line shows "−10% order" in green', r.ok && t1.length === s1.cart.length && t1.every(x => x && /^−10% order$/.test(x.text) && x.color === 'rgb(30, 123, 52)'), JSON.stringify(t1));
    const sumLine = s1.cart.reduce((a, l) => a + l.total, 0);
    rec('A3 totals come from the server, not from the tags: Subtotal unchanged, discount = 10% of items', JSON.stringify(s1.totals) !== before && Math.abs(s1.totals.discountAmount - sumLine * 0.10) < 0.011 && Math.abs(s1.totals.itemAmount - sumLine) < 0.011, `items ${sumLine.toFixed(2)} discount ${s1.totals.discountAmount}`);
    const hdr = await p.$eval('#cartHead', e => e.innerText.replace(/\s+/g, ' ').trim());
    rec('A4 column headers unchanged', /#\s*Lookup Code\s*Name\s*Qty\s*Price\s*Discount\s*Total/i.test(hdr), hdr);
    // a dollar order discount = its effective percent on every line
    r = await post('discount', { kind: 'amount', value: 3 }); await p.evaluate(() => refresh()); await sleep(600);
    let s2 = await state(), t2 = await tags(); const eff = Math.round(3 / s2.totals.itemAmount * 10000) / 100;
    rec('A5 $3.00 order discount: every line shows its effective % (' + eff + '%)', r.ok && t2.every(x => x && x.text === `−${eff}% order`), JSON.stringify(t2.map(x => x && x.text)));
    // a line discount of its own still shows as before, the order tag is added under it
    await post('discount', { kind: 'percent', value: 10 }); await post('line-discount', { row: 0, kind: 'percent', value: 20 }); await p.evaluate(() => refresh()); await sleep(600);
    // Step 0: the cart is drawn newest-at-bottom, so DOM order is reversed from register order; line-discount row 0 is the register's row 0 = data-row="0"
    const cell = await p.$eval('#cart tr.row[data-row="0"] td:nth-child(6)', e => e.innerText.replace(/\s+/g, ' ').trim());
    rec('A6 a line with its own 20% discount keeps "−$x.xx (20%)" and also shows "−10% order"', /−\$[\d.]+ \(20%\)/.test(cell) && /−10% order/.test(cell), cell);
    // clearing removes every tag
    await post('line-discount', { row: 0, kind: 'clear' }); await post('discount', { kind: 'clear' }); await p.evaluate(() => refresh()); await sleep(600);
    const t3 = await tags(), s3 = await state();
    rec('A7 order discount cleared: no tags, totals back to the first value', t3.every(x => x === null) && JSON.stringify(s3.totals) === before, JSON.stringify(t3));
    // removing a line keeps the tag on the lines that are left
    await post('discount', { kind: 'percent', value: 25 }); await post('remove', { row: 0 }); await p.evaluate(() => refresh()); await sleep(600);
    const t4 = await tags(), s4 = await state();
    rec('A8 item removed: the remaining lines all show −25% order', t4.length === s4.cart.length && t4.length >= 1 && t4.every(x => x && x.text === '−25% order'), JSON.stringify(t4.map(x => x && x.text)));
    await p.screenshot({ path: '/tmp/order-disc-18.png' });
    rec('A9 no page errors', errs.length === 0, errs.join('; ') || 'none');
    await post('discount', { kind: 'clear' }); await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

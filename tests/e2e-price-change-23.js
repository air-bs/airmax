// Store request #23 / #6 (Nov 2): a "Price Change" button in the LEFT column opens the Item discount window on "New price" for the selected
// line. It is the same F4 New price path: this sale only, can only LOWER the price, the item price in AIR POS is never saved.
// Totals must be right to the cent. OFFLINE fake AIR POS only (see run-all-look.sh).
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = () => fetch(HOOK + '/x').then(r => r.json()).catch(() => ({ calls: [] }));
const c2 = x => Math.round(x * 100) / 100;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const modalText = () => p.evaluate(() => { const m = document.querySelector('#modalRoot .modal'); return m ? m.innerText : null; });
    const leftLabels = () => p.$$eval('#actions button', bs => bs.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    const L = await leftLabels();
    rec('P1 left column has a "Price Change" button; the other left buttons keep their names', L.some(x => /^\S*\s*Price Change/.test(x)) && ['New', 'History', 'Hold', 'Load Hold', 'Open Drawer', 'Return', 'Print Label', 'Add Gift Receipt', 'Temporary Item', 'Customer', 'End of Day', 'Clock Out', 'Log Out'].every(n => L.some(x => x.includes(n))), JSON.stringify(L));
    await p.click('#actions button[data-a="price-change"]'); await sleep(400);
    rec('P2 nothing on the sale: the button says to select a line, no window', !(await modalText()), await p.$eval('#toast', e => e.textContent));
    await post('scan', { code: '1001' }); await post('scan', { code: '1001' }); await p.evaluate(() => refresh()); await sleep(500);
    let s0 = await state(); const l0 = s0.cart[0], orig = l0.price, qty = l0.quantity, tot0 = JSON.stringify(s0.totals);
    await p.click('#cart tr.row'); await sleep(200);
    await p.click('#actions button[data-a="price-change"]'); await sleep(500);
    const mt = await modalText();
    const tab = await p.$eval('#modalRoot .tab.on', e => e.dataset.k).catch(() => null);
    rec('P3 Price Change opens the item window with the "New price" tab selected and the item named', /Item discount/.test(mt || '') && tab === 'price' && (mt || '').includes(l0.name), `tab=${tab}`);
    const hint = await p.$eval('#ldHint', e => e.textContent);
    rec('P4 the window says the item price in AIR POS is not changed', /not changed/.test(hint), hint);
    const target = c2(orig - 0.40);
    await p.type('#ldVal', String(target)); await p.keyboard.press('Enter'); await sleep(900);
    let s1 = await state(); const l1 = s1.cart[0];
    const discExpected = c2((orig - target) * qty);
    rec('P5 new price applied for this sale: line total = new price x qty, discount = difference, to the cent', Math.abs(l1.total - c2(target * qty)) < 0.005 && Math.abs(l1.discountAmount - discExpected) < 0.005, `orig ${orig} new ${target} qty ${qty}: total ${l1.total} (want ${c2(target * qty)}), discount ${l1.discountAmount} (want ${discExpected})`);
    const sumLines = c2(s1.cart.reduce((a, l) => a + l.total, 0));
    const rate = l1.taxRate != null ? l1.taxRate : 8;
    rec('P6 sale totals follow to the cent: items = sum of the lines, tax = rate x items, due = items + tax; totals differ from before', Math.abs(s1.totals.itemAmount - sumLines) < 0.005 && Math.abs(s1.totals.tax - c2(sumLines * rate / 100)) < 0.0105 && Math.abs(s1.totals.due - c2(s1.totals.itemAmount + s1.totals.tax)) < 0.0105 && JSON.stringify(s1.totals) !== tot0, `${JSON.stringify(s1.totals)} rate ${rate}`);
    // a higher price is refused, nothing changes
    await p.click('#actions button[data-a="price-change"]'); await sleep(500);
    await p.$eval('#ldVal', e => { e.value = ''; }); await p.type('#ldVal', String(c2(orig + 1))); await p.keyboard.press('Enter'); await sleep(700);
    const msg = await p.$eval('#ldMsg', e => e.textContent).catch(() => '');
    const s2 = await state();
    rec('P7 a HIGHER price is refused ("can only lower"), the line is unchanged', /can only lower/i.test(msg) && s2.cart[0].total === l1.total, msg);
    await p.keyboard.press('Escape'); await sleep(300);
    // F4 still opens on the % tab (unchanged)
    await p.keyboard.press('F4'); await sleep(500);
    const tab2 = await p.$eval('#modalRoot .tab.on', e => e.dataset.k).catch(() => null);
    rec('P8 F4 / Item Discount still opens on the usual tab (not New price) for a line with a price change on it', !!tab2 && tab2 !== 'price' || tab2 === 'amount', `tab=${tab2}`);
    await p.keyboard.press('Escape'); await sleep(300);
    // remove the discount: back to the original
    await post('line-discount', { row: 0, kind: 'clear' }); await p.evaluate(() => refresh()); await sleep(500);
    const s3 = await state();
    rec('P9 removing the item discount returns the original totals exactly', JSON.stringify(s3.totals) === tot0 && s3.cart[0].total === l0.total, JSON.stringify(s3.totals));
    // return mode: not available
    const calls = ((await hook()).calls || []);
    const writes = calls.filter(c => /Price|Product.*(Save|Update)|Item.*(Save|Update)/i.test(c) && !/Get|List|Paged/.test(c));
    rec('P10 no AIR POS item-price write in the fake call log (saved prices untouched)', writes.length === 0, `${calls.length} calls, writes: ${writes.join(',') || 'none'}`);
    rec('P11 no page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.screenshot({ path: '/tmp/price-change-23.png' });
    await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

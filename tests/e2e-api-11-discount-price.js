// run-env: DP_CUST=1
// AirMax Step 0b (Batch 11) C1 + C2 on the real screen against the OFFLINE fake AIR POS (made-up data, tests/fake-api/discount-price.js; nothing paid, nothing real).
//  C1: the Discount cell shows what each line got (F4 %, F4 $, New price, customer type, Sale / Multi-buy / promo code in green, an order discount on top);
//      a click on it selects THAT line and opens the item discount (same window as F4). C2: a click on the Price cell opens Price Change for THAT line
//      (manager only: a cashier gets the manager login first; this sale only; lower only; not in return mode).
//  Nothing else on the line table changes: other cells only select; return mode has no clickable cells; the two cells look the same as before.
//   FAKE_PORT=5311 node tests/e2e-api-11-discount-price.js   (Chrome on CHROME_URL; the fake runs with DP_CUST=1; a cashier fake is started on CASHIER_PORT, default FAKE_PORT+2)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HB = 'http://127.0.0.1:' + (FP + 1), CP = Number(process.env.CASHIER_PORT || FP + 2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; let n = 0; const rec = (k, pass, note) => { n++; if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const mk = base => ({ B: base, post: (r, x) => fetch(base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), state: () => fetch(base + '/api/state').then(r => r.json()) });
const M = mk(BASE), c2 = x => Math.round(x * 100) / 100, hook = q => fetch(HB + q).then(r => r.json());
const CANDY = 'Bulk candy (lb)', ROPE = 'Rope (ft)', GIFT = 'Gift bag';
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p, cashier;
  try {
    if (!(await M.state()).loggedIn) await M.post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    const fresh = async (codes, promo = '/dp-promo?off=1') => { await M.post('pay-close'); await M.post('new-sale'); await M.post('dismiss'); await hook(promo); for (const c of codes) await M.post('scan', { code: c }); await p.goto(BASE + '/'); await sleep(1500); };
    const cell = async (place, col) => p.$eval(`#cart tr.row:nth-child(${place}) td:nth-child(${col})`, e => { const c = e.cloneNode(true); c.querySelectorAll('.dsz').forEach(x => x.remove()); return c.innerText.replace(/\s+/g, ' ').trim(); });
    const names = () => p.$$eval('#cart tr.row td:nth-child(3)', t => t.map(x => { const c = x.cloneNode(true); c.querySelectorAll('.discline').forEach(d => d.remove()); return c.innerText.trim(); }));
    const modal = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const modalLine = async () => ((await modal()).match(/Item discount\s+([^\n·]+?)\s*·/) || [])[1] || '';
    const esc = async () => { await p.keyboard.press('Escape'); await sleep(300); };
    const discCells = () => p.$$eval('#cart tr.row td:nth-child(6)', t => t.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    const dispOf = async name => (await names()).indexOf(name) + 1; // place on screen (1 = top)

    // ---- C1 display
    await fresh(['1001', '1003', '1004']); let s = await M.state();
    rec('E1 no discount: the Discount cell stays empty on every line (as today)', (await discCells()).every(t => t === ''), JSON.stringify(await discCells()));
    const sty = sel => p.$eval(sel, e => { const c = getComputedStyle(e); return [c.cursor, c.color, c.backgroundColor, c.textDecorationLine, c.borderTopWidth, c.borderBottomColor, c.fontWeight, c.padding].join('|'); });
    const sClick = await sty('#cart tr.row:nth-child(1) td[data-c="disc"]'), sPlain = await sty('#cart tr.row:nth-child(1) td:nth-child(7)'), sPrice = await sty('#cart tr.row:nth-child(1) td[data-c="price"]'), sQty = await sty('#cart tr.row:nth-child(1) td:nth-child(4)');
    rec('E2 the two clickable cells look the same as any other number cell: same pointer, colour, background, underline, border, weight, padding', sClick === sPlain && sPrice === sQty, `${sClick} / ${sPrice}`);

    await M.post('line-discount', { row: s.cart.findIndex(l => l.name === CANDY), kind: 'percent', value: 10 }); await M.post('line-discount', { row: s.cart.findIndex(l => l.name === ROPE), kind: 'amount', value: 0.5 }); await M.post('line-discount', { row: s.cart.findIndex(l => l.name === GIFT), kind: 'price', value: '1.2' });
    await p.goto(BASE + '/'); await sleep(1500);
    const dc = Object.fromEntries((await names()).map((nm, i) => [nm, i + 1]));
    rec('E3 F4 percent shows "−$1.00 (10%)" (as today)', (await cell(dc[CANDY], 6)) === '−$1.00 (10%)', await cell(dc[CANDY], 6));
    rec('E4 F4 $ off shows "−$0.50 (25%)" (as today)', (await cell(dc[ROPE], 6)) === '−$0.50 (25%)', await cell(dc[ROPE], 6));
    rec('E5 F4 New price ($1.20 for $1.50) shows "−$0.30 (20%)" (as today)', (await cell(dc[GIFT], 6)) === '−$0.30 (20%)', await cell(dc[GIFT], 6));

    await fresh(['1003', '1004']); await M.post('predefined-discount', { id: 'dp-senior' }); await p.goto(BASE + '/'); await sleep(1500); const d2 = Object.fromEntries((await names()).map((nm, i) => [nm, i + 1]));
    rec('E6 customer-type discount: name, amount and percent ("Senior −$0.20 (10%)")', (await cell(d2[ROPE], 6)) === 'Senior −$0.20 (10%)' && (await cell(d2[GIFT], 6)) === 'Senior −$0.15 (10%)', `${await cell(d2[ROPE], 6)} | ${await cell(d2[GIFT], 6)}`);
    await M.post('predefined-discount', { id: '' });

    // Sale, Multi-buy, promo code (green)
    const green = sel => p.$eval(sel, e => getComputedStyle(e).color);
    await fresh(['1001', '1004', '1003'], '/dp-promo?sale=1'); await M.post('qty', { row: (await M.state()).cart.findIndex(l => l.name === CANDY), qty: 2 }); await p.goto(BASE + '/'); await sleep(1500);
    let d = Object.fromEntries((await names()).map((nm, i) => [nm, i + 1]));
    rec('E7 Sale: "Sale −$4.00" in the same green as the line under a name, on the promoted line only', (await cell(d[CANDY], 6)) === 'Sale −$4.00' && (await green(`#cart tr.row:nth-child(${d[CANDY]}) td:nth-child(6) .promo`)) === 'rgb(30, 123, 52)' && (await cell(d[ROPE], 6)) === '' && (await cell(d[GIFT], 6)) === '', `${await cell(d[CANDY], 6)} | ${await green(`#cart tr.row:nth-child(${d[CANDY]}) td:nth-child(6) .promo`)}`);
    await hook('/dp-promo?multi=1'); await M.post('qty', { row: (await M.state()).cart.findIndex(l => l.name === GIFT), qty: 2 }); await p.goto(BASE + '/'); await sleep(1500); d = Object.fromEntries((await names()).map((nm, i) => [nm, i + 1]));
    rec('E8 Multi-buy: "Multi-buy 2 for $2 −$1.00" in green', (await cell(d[GIFT], 6)) === 'Multi-buy 2 for $2 −$1.00' && (await green(`#cart tr.row:nth-child(${d[GIFT]}) td:nth-child(6) .promo`)) === 'rgb(30, 123, 52)', await cell(d[GIFT], 6));
    await fresh(['1001', '1003'], '/dp-promo?code=SAVE10'); await M.post('promo-code', { code: 'SAVE10' }); await p.goto(BASE + '/'); await sleep(1500); d = Object.fromEntries((await names()).map((nm, i) => [nm, i + 1]));
    rec('E9 promo code: "Promo code SAVE10 −$1.00" and "… −$0.20" in green', (await cell(d[CANDY], 6)) === 'Promo code SAVE10 −$1.00' && (await cell(d[ROPE], 6)) === 'Promo code SAVE10 −$0.20', `${await cell(d[CANDY], 6)} | ${await cell(d[ROPE], 6)}`);
    await M.post('discount', { kind: 'percent', value: 10 }); await p.goto(BASE + '/'); await sleep(1500);
    rec('E10 an order discount (F6) on top: the "−10% order" tag is still there under the line\'s own text', /Promo code SAVE10 −\$1\.00\s*−10% order/.test((await cell(d[CANDY], 6)).replace(/\s+/g, ' ')) || /Promo code SAVE10 −\$1\.00 −10% order/.test(await cell(d[CANDY], 6)), await cell(d[CANDY], 6));
    await M.post('discount', { kind: 'percent', value: 0 });
    // total / tax unchanged by the display: the screen's Total = the server's due
    s = await M.state(); await p.goto(BASE + '/'); await sleep(1200); const totTxt = await p.$eval('#totals', e => e.innerText.replace(/\s+/g, ' '));
    rec('E11 totals on the screen are the server\'s own numbers (display change only)', totTxt.includes('$' + s.totals.due.toFixed(2)) && totTxt.includes('$' + s.totals.tax.toFixed(2)), totTxt.slice(0, 120));

    await fresh(['1001', '1003', '1004'], '/dp-promo?sale=1&multi=1&code=SAVE10'); await M.post('qty', { row: (await M.state()).cart.findIndex(l => l.name === GIFT), qty: 2 }); await M.post('promo-code', { code: 'SAVE10' }); await p.goto(BASE + '/'); await sleep(1500); d = Object.fromEntries((await names()).map((nm, i) => [nm, i + 1]));
    rec('E12 a mix of different promotions: each line shows its name in green AND its provisional dollars (3.20 split 10 : 3 : 2 = 2.13 + 0.64 + 0.43)', (await cell(d[CANDY], 6)) === 'Sale −$2.13' && (await cell(d[GIFT], 6)) === 'Multi-buy 2 for $2 −$0.64' && (await cell(d[ROPE], 6)) === 'Promo code SAVE10 −$0.43', `${await cell(d[CANDY], 6)} | ${await cell(d[GIFT], 6)} | ${await cell(d[ROPE], 6)}`);
    { const hdr = () => p.$$eval('#cartHead th', t => t.map(x => Math.round(x.getBoundingClientRect().left * 10) / 10)), dtl = () => p.$eval('#cart tr.row:nth-child(1) td:nth-child(6) .dc', e => [e.scrollWidth > e.clientWidth, e.title]).catch(() => null);
      const withPromo = await hdr(), tip = await dtl();
      await fresh(['1001', '1003', '1004']); await M.post('qty', { row: (await M.state()).cart.findIndex(l => l.name === GIFT), qty: 2 }); await p.goto(BASE + '/'); await sleep(1500); const plain = await hdr();
      rec('E12b column header positions with Sale / Multi-buy / code text in the Discount cells are EXACTLY those of the same sale without any promotion (the text never widens the column)', JSON.stringify(withPromo) === JSON.stringify(plain) && withPromo.length === 7, JSON.stringify([withPromo, plain]));
      rec('E12c the full promotion text is the cell tooltip', !!tip && /Sale/.test(tip[1]), JSON.stringify(tip));
      await fresh(['1001', '1003', '1004'], '/dp-promo?sale=1&multi=1&code=SAVE10'); await M.post('qty', { row: (await M.state()).cart.findIndex(l => l.name === GIFT), qty: 2 }); await M.post('promo-code', { code: 'SAVE10' }); await p.goto(BASE + '/'); await sleep(1500);
      const cut = await p.$$eval('#cart tr.row .dc', t => t.map(e => { const a = e.querySelector('.pa'), n = e.querySelector('.pn'); return { amountCut: !!a && a.scrollWidth > a.clientWidth, nameCut: !!n && n.scrollWidth > n.clientWidth, w: e.getBoundingClientRect().width }; }));
      rec('E12d too little room (long promo name in the narrow column): the NAME gets the "…", the dollar amount is never cut, the cell stays inside the column', cut.length === 3 && cut.every(x => !x.amountCut) && cut.some(x => x.nameCut) && (await p.$$eval('#cart tr.row td:nth-child(6)', t => t.every(x => x.scrollWidth <= x.clientWidth + 1))), JSON.stringify(cut)); }

    // ---- clicks (manager fake). Three lines: Bulk candy (oldest, top), Rope, Gift bag (newest, bottom)
    await fresh(['1001', '1003', '1004']); const top = 1, mid = 2, bot = 3, order = await names();
    const base = JSON.stringify((await M.state()).totals);
    for (const [label, place] of [['first', top], ['a middle', mid], ['the newest', bot]]) {
      await p.click(`#cart tr.row:nth-child(${place}) td[data-c="disc"]`); await sleep(700);
      const mt = await modal(), sel = await p.$eval('#cart tr.row.sel td:nth-child(3)', e => e.innerText.split('\n')[0].trim());
      rec(`E13 click Discount on ${label} line: it is selected and the item discount opens for that line`, /Item discount/.test(mt) && (await modalLine()) === order[place - 1] && sel === order[place - 1], `${order[place - 1]} -> "${await modalLine()}" sel=${sel}`);
      await esc();
    }
    rec('E14 closing the window changes nothing (totals the same)', JSON.stringify((await M.state()).totals) === base && !(await modal()).trim(), '');
    // ---- Batch 11 (the owner): Qty and Price are edited right in the cell
    const ced = () => p.$eval('#cart input.ced', e => ({ v: e.value, sel: e.selectionStart === 0 && e.selectionEnd === e.value.length, focus: document.activeElement === e, row: +e.closest('tr').dataset.row, col: e.closest('td').dataset.c })).catch(() => null);
    const typeIn = async v => { await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control'); for (const ch of v) { await p.keyboard.type(ch); await sleep(60); } };
    for (const [label, place] of [['first', top], ['a middle', mid], ['the newest', bot]]) {
      await p.click(`#cart tr.row:nth-child(${place}) td[data-c="price"]`); await sleep(900); const e1 = await ced(), sel = await p.$eval('#cart tr.row.sel td:nth-child(3)', e => e.innerText.split('\n')[0].trim());
      rec(`E15 click Price on ${label} line (manager): that line is selected and its Price cell becomes a number box with the price selected; no window, no manager login asked`, !!e1 && e1.col === 'price' && e1.sel && e1.focus && sel === order[place - 1] && !(await modal()).trim() && /^\d+\.\d\d$/.test(e1.v), JSON.stringify(e1) + ' sel=' + sel);
      await p.keyboard.press('Escape'); await sleep(400);
    }
    rec('E15b Esc puts the cell back as it was (no box, same text), nothing changed', !(await ced()) && JSON.stringify((await M.state()).totals) === base, '');
    const ropeRow = (await M.state()).cart.findIndex(l => l.name === ROPE), giftRow = (await M.state()).cart.findIndex(l => l.name === GIFT);
    await p.click(`#cart tr.row:nth-child(${mid}) td[data-c="price"]`); await sleep(900); await typeIn('2.5'); await p.keyboard.press('Enter'); await sleep(1200);
    const toastTxt = async () => p.$$eval('.toast, #toast, .toasts div', t => t.map(x => x.innerText).join(' | ')).catch(() => '');
    let tt = await toastTxt();
    rec('E16 a HIGHER price typed in the cell is refused with the window\'s own message; line unchanged, cell back to normal', /can only lower|higher/i.test(tt) && (await M.state()).cart[ropeRow].discountAmount === 0 && !(await ced()), tt.slice(0, 160));
    await p.click(`#cart tr.row:nth-child(${mid}) td[data-c="price"]`); await sleep(900); await typeIn('1.5'); await p.keyboard.press('Enter'); await sleep(1200); s = await M.state();
    rec('E17 price edit + Enter: a lower price changes THAT line only, through Price Change (Rope $2 -> $1.50 = $0.50 off); the other lines untouched', s.cart[ropeRow].discountAmount === 0.5 && s.cart.every((l, i) => i === ropeRow || l.discountAmount === 0) && !(await ced()), JSON.stringify(s.cart.map(l => [l.name, l.discountAmount])));
    await p.click(`#cart tr.row:nth-child(${bot}) td[data-c="qty"]`); await sleep(700); const q1 = await ced();
    rec('E17b click Qty: the Qty cell becomes a number box with the quantity selected', !!q1 && q1.col === 'qty' && q1.v === '1' && q1.sel && q1.focus, JSON.stringify(q1));
    await typeIn('3'); await p.keyboard.press('Enter'); await sleep(1200); s = await M.state();
    rec('E17c qty edit + Enter: the quantity changes on that line only (Gift bag 1 -> 3), cell back to normal', s.cart[giftRow].quantity === 3 && s.cart.filter((l, i) => i !== giftRow).every(l => l.quantity === 1) && !(await ced()), JSON.stringify(s.cart.map(l => [l.name, l.quantity])));
    const candyRow = (await M.state()).cart.findIndex(l => l.name === CANDY), cPlace = order.indexOf(CANDY) + 1;
    await p.click(`#cart tr.row:nth-child(${cPlace}) td[data-c="qty"]`); await sleep(700); await typeIn('1.25'); await p.keyboard.press('Enter'); await sleep(1200); s = await M.state();
    const viaWin = await (async () => { const r = await M.post('qty', { row: candyRow, qty: 1.25 }); return (await M.state()).cart[candyRow]; })();
    rec('E17c2 a weighted line (Bulk candy lb) takes a decimal qty 1.25 in the cell, same result as the Quantity window', s.cart[candyRow].quantity === 1.25 && viaWin.quantity === 1.25 && viaWin.total === s.cart[candyRow].total && !(await ced()), JSON.stringify([s.cart[candyRow].quantity, s.cart[candyRow].total, viaWin.total]));
    await M.post('qty', { row: candyRow, qty: 1 }); await p.goto(BASE + '/'); await sleep(1500);
    const t3 = JSON.stringify((await M.state()).totals);
    await p.click(`#cart tr.row:nth-child(${bot}) td[data-c="qty"]`); await sleep(700); await typeIn('abc'); await p.keyboard.press('Enter'); await sleep(900);
    const q2 = await p.$eval(`#cart tr.row:nth-child(${bot}) td[data-c="qty"]`, e => e.innerText.trim());
    rec('E17d invalid input (letters) reverts: the old quantity is back, nothing sent', q2 === '3' && JSON.stringify((await M.state()).totals) === t3 && !(await ced()), q2);
    await p.click(`#cart tr.row:nth-child(${bot}) td[data-c="qty"]`); await sleep(700); await typeIn('0'); await p.keyboard.press('Enter'); await sleep(900);
    rec('E17e quantity 0 is not a quantity: reverts, nothing sent', JSON.stringify((await M.state()).totals) === t3 && !(await ced()), '');
    await p.click(`#cart tr.row:nth-child(${bot}) td[data-c="qty"]`); await sleep(700); await typeIn('7'); await p.keyboard.press('Escape'); await sleep(500);
    rec('E17f Esc after typing cancels: quantity still 3', (await M.state()).cart[giftRow].quantity === 3 && !(await ced()), '');
    await p.click(`#cart tr.row:nth-child(${bot}) td[data-c="qty"]`); await sleep(700); await typeIn('9'); await p.click(`#cart tr.row:nth-child(${top}) td:nth-child(3)`); await sleep(700);
    rec('E17g clicking away cancels: quantity still 3, no box left', (await M.state()).cart[giftRow].quantity === 3 && !(await ced()), '');
    await p.click(`#cart tr.row:nth-child(${bot}) td[data-c="qty"]`); await sleep(700); await p.keyboard.type('1003', { delay: 5 }); await p.keyboard.press('Enter'); await sleep(1500); s = await M.state();
    rec('E17h a scanner typing into an open box is not taken as a quantity: the code is scanned as usual (Rope +1), Gift bag still 3', s.cart.find(l => l.name === GIFT).quantity === 3 && s.cart.find(l => l.name === ROPE).quantity === 2 && !(await ced()), JSON.stringify(s.cart.map(l => [l.name, l.quantity])));
    await fresh(['1001', '1003', '1004']); await p.goto(BASE + '/'); await sleep(1500);
    // clicking another cell only selects
    for (const col of [1, 2, 3, 7]) { await p.click(`#cart tr.row:nth-child(${top}) td:nth-child(${col})`); await sleep(250); }
    await p.click(`#cart tr.row:nth-child(${bot}) td:nth-child(3)`); await sleep(500);
    rec('E18 a click on any other cell (#, code, name, total) only selects the line: no window, no box', !(await modal()).trim() && !(await ced()) && (await p.$eval('#cart tr.row.sel td:nth-child(3)', e => e.innerText.split('\n')[0].trim())) === order[bot - 1], 'sel=' + await p.$eval('#cart tr.row.sel td:nth-child(3)', e => e.innerText.split('\n')[0].trim()));
    // F4 key and the left-column Price Change button still work
    await p.click(`#cart tr.row:nth-child(${mid}) td:nth-child(3)`); await sleep(300); await p.keyboard.press('F4'); await sleep(600);
    rec('E19 F4 still opens the item discount for the selected line', /Item discount/.test(await modal()) && (await modalLine()) === order[mid - 1], await modalLine()); await esc();
    await p.click('#actions button[data-a="price-change"]'); await sleep(900);
    rec('E20 the left-column Price Change button still opens on New price', /Item discount/.test(await modal()) && (await p.$eval('#modalRoot .tab.on', e => e.dataset.k).catch(() => null)) === 'price', ''); await esc();
    // touch tap
    await p.touchscreen.tap(...(await p.$eval(`#cart tr.row:nth-child(${bot}) td[data-c="disc"]`, e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }))); await sleep(900);
    rec('E21 a touch tap on the Discount cell works like a click', /Item discount/.test(await modal()) && (await modalLine()) === order[bot - 1], await modalLine()); await esc();
    // the scan box keeps working after a click-and-cancel
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(1000);
    rec('E22 after a click and Esc the scan box still takes a scan', (await M.state()).cart.filter(l => l.name === CANDY)[0].quantity === 2, '');

    // ---- return mode: Max column, nothing clickable
    await M.post('pay-close'); await M.post('new-sale'); await M.post('dismiss'); await M.post('return-start', { kind: 'receipt', orderId: 'o-ret-cash' }); await p.goto(BASE + '/'); await sleep(1500);
    const hdr = await p.$eval('#cartHead', e => e.innerText.replace(/\s+/g, ' ')), cl = await p.$$eval('#cart td[data-c]', t => t.length);
    await p.click('#cart tr.row td:nth-child(6)').catch(() => {}); await sleep(500);
    const mtR = await modal(); rec('E23 return mode: the column is still "Max", no clickable cells, a click opens nothing', /max/i.test(hdr) && !/discount/i.test(hdr) && cl === 0 && !/Item discount/.test(mtR), `${hdr} cells=${cl} modal=${mtR.replace(/\s+/g, ' ').slice(0, 80)}`);
    await M.post('return-cancel'); await M.post('new-sale'); await M.post('dismiss');

    // ---- cashier: Price click asks for the manager first
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dp11e-'));
    cashier = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(CP), FAKE_HOOK_PORT: 'off', FAKE_CASHIER: '1' }, stdio: ['ignore', fs.openSync(path.join(T, 'c.log'), 'a'), fs.openSync(path.join(T, 'c.log'), 'a')] });
    const K = mk('http://127.0.0.1:' + CP); for (let i = 0; i < 60; i++) { try { await fetch(K.B + '/api/shortcuts'); break; } catch (e) { await sleep(250); } }
    await K.post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' }); await K.post('pay-close'); await K.post('new-sale'); await K.post('dismiss'); for (const c of ['1001', '1003', '1004']) await K.post('scan', { code: c });
    await p.goto(K.B + '/'); await sleep(1500); const ks = await K.state(), ktot = JSON.stringify(ks.totals), korder = await names();
    rec('E24 the second fake is a cashier (not a manager)', ks.user && !ks.user.manager, 'manager=' + (ks.user && ks.user.manager));
    await p.click(`#cart tr.row:nth-child(${mid}) td[data-c="price"]`); await sleep(900); let mt = await modal();
    rec('E25 cashier clicks Price: the manager login appears first (no box yet); sale unchanged', /Price Change/.test(mt) && /Manager user name/.test(mt) && !(await ced()) && JSON.stringify((await K.state()).totals) === ktot, mt.replace(/\s+/g, ' ').slice(0, 90));
    await p.type('#mlU', 'boss'); await p.type('#mlP', 'wrong-pw'); await p.keyboard.press('Enter'); await sleep(900); mt = await modal();
    rec('E26 wrong manager login: refused, no box, nothing changed', /Manager user name/.test(mt) && !(await ced()) && JSON.stringify((await K.state()).totals) === ktot, '');
    await p.$eval('#mlU', e => { e.value = ''; }); await p.$eval('#mlP', e => { e.value = ''; }); await p.type('#mlU', 'boss'); await p.type('#mlP', 'boss-pw'); await p.keyboard.press('Enter'); await sleep(1000); const kc = await ced();
    rec('E27 right manager login: the window closes and the clicked (middle) line\'s Price cell is the number box', !(await modal()).trim() && !!kc && kc.col === 'price' && kc.focus, JSON.stringify(kc));
    const kRope = (await K.state()).cart.findIndex(l => l.name === korder[mid - 1]); await typeIn('1.5'); await p.keyboard.press('Enter'); await sleep(1200);
    rec('E27b the cashier\'s price (approved by that manager login) is applied to that line ($0.50 off)', (await K.state()).cart[kRope].discountAmount === 0.5, JSON.stringify((await K.state()).cart.map(l => [l.name, l.discountAmount])));
    await p.click(`#cart tr.row:nth-child(${top}) td[data-c="qty"]`); await sleep(700); const kq = await ced();
    rec('E27c cashier clicks Qty: the box opens at once (quantity needs no manager)', !!kq && kq.col === 'qty' && !(await modal()).trim(), JSON.stringify(kq)); await p.keyboard.press('Escape'); await sleep(300);
    await p.click(`#cart tr.row:nth-child(${bot}) td[data-c="disc"]`); await sleep(800);
    rec('E28 cashier clicks Discount: the item discount opens at once (F4 needs no manager), for that line', /Item discount/.test(await modal()) && (await modalLine()) === korder[bot - 1], await modalLine()); await esc();

    // ---- payment in progress: no editing
    await p.goto(BASE + '/'); await fresh(['1001', '1003']); const pq = JSON.stringify((await M.state()).cart.map(l => l.quantity)); await M.post('pay-start', {});
    await p.$eval('#cart tr.row:nth-child(1) td[data-c="qty"]', e => e.click()).catch(() => {}); await sleep(900);
    await p.$eval('#cart tr.row:nth-child(1) td[data-c="price"]', e => e.click()).catch(() => {}); await sleep(900);
    rec('E28b payment in progress: a click on Qty or Price opens no box and changes nothing', !(await ced()) && JSON.stringify((await M.state()).cart.map(l => l.quantity)) === pq && (await M.state()).cart.every(l => !l.discountAmount), pq);
    await M.post('pay-close'); await M.post('new-sale'); await M.post('dismiss');
    rec('E29 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    const g = cp.spawnSync('git', ['diff', '--quiet', '--', 'app/lib', 'app/shortcuts.json'], { cwd: path.join(__dirname, '..') });
    rec('E30 app/lib and app/shortcuts.json are untouched (no label, shortcut or backend change)', g.status === 0, 'git diff exit ' + g.status);
    await M.post('pay-close'); await M.post('new-sale'); await hook('/dp-promo?off=1');
  } catch (e) { rec('run', false, e.stack); }
  finally { if (p) await p.close().catch(() => {}); if (cashier) cashier.kill(); b.disconnect(); }
  console.log(`${n - fails.length}/${n} passed`); process.exit(fails.length ? 1 : 0);
})();

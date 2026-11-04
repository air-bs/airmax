// Gift card sales, returns and Tax Off (manager: no approval; cashier: manager login, owner decision Nov 3) on the OFFLINE fake AIR POS (made-up cards / orders, no store, no card charged).
// Fake started with FAKE_PRINT_LOG=1 (what AirMax prints is kept, hook /printlog). Cashier fake (FAKE_CASHIER=1) on CASHIER_PORT.
// Gift cards: on master the receipt itself is AIR POS's; AirMax prints the GIFT CARDS list right after it, with each card's last 4
// digits and its balance read from AIR POS after the sale. Run (runner): FENV=FAKE_PRINT_LOG=1 start $FP $CP; FAKE_PORT=$FP CASHIER_PORT=$CP node tests/e2e-gift-returns-taxoff.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5190), CP = Number(process.env.CASHIER_PORT || 5192);
const B = 'http://127.0.0.1:' + FP, H = 'http://127.0.0.1:' + (FP + 1), CB = 'http://127.0.0.1:' + CP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [], notes = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const note = t => { notes.push(t); console.log('NOTE ' + t); };
const mkApi = base => ({ post: (r, x) => fetch(base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), state: () => fetch(base + '/api/state').then(r => r.json()) });
const A = mkApi(B), C = mkApi(CB), hook = q => fetch(H + q).then(r => r.json());
const LOGIN = { company: 'fake shop', user: 'tester', password: 'fake-pw' }; // made up: the fake accepts any non-empty password
const printed = async () => (await hook('/printlog?reset=1')).map(x => x.text);
const slipOf = list => list.filter(t => /^GIFT CARDS/.test(t)).join('\n');
async function sellCash(api, tendered) { await api.post('pay-start'); const r = await api.post('pay-cash', { tendered }); await sleep(2500); return r; }

(async () => {
  let b;
  try {
    if (!(await A.state()).loggedIn) await A.post('login', LOGIN);
    await A.post('pay-close'); await A.post('new-sale'); await A.post('dismiss'); await printed();
    if ((await fetch(H + '/printlog')).status !== 200) throw new Error('start the fake with FAKE_PRINT_LOG=1');

    // ---------------- gift cards: last 4 digits and the balance together on the printout after the receipt
    let r = await A.post('gift-line', { number: '7000000000001234', amount: 25 });
    rec('G1 a new gift card is shown with its last 4 digits only ("**** 1234") on the screen line', r.ok && r.gift.masked === '**** 1234', r.message);
    let s = await sellCash(A, 25), pr = await printed(), slip = slipOf(pr);
    rec('G2 sale complete: the receipt prints, then the GIFT CARDS list', s.completed && pr.length === 2 && /fake receipt/.test(pr[0]) && /^GIFT CARDS \(1\)/.test(pr[1]), pr.map(t => t.split('\n')[0]).join(' | '));
    rec('G3 the list has the card as "**** 1234 new $25.00" and its balance from AIR POS after the sale, "Balance now $25.00", on the same printout', /\*\*\*\* 1234 new\s+\$25\.00\nBalance now\s+\$25\.00/.test(slip), JSON.stringify(slip));
    rec('G4 the full card number is on no printout', !pr.some(t => t.includes('7000000000001234') || t.includes('000000001234')), '');
    await A.post('dismiss');
    r = await A.post('gift-line', { number: '7000000000009999', amount: 10 }); s = await sellCash(A, 10); slip = slipOf(await printed());
    rec('G5 reload $10 onto a sold card that had $3: "**** 9999 reload $10.00", "Balance now $13.00"', r.ok && r.gift.kind === 'reload' && /\*\*\*\* 9999 reload\s+\$10\.00\nBalance now\s+\$13\.00/.test(slip), JSON.stringify(slip));
    await A.post('dismiss');
    await A.post('scan', { code: '1002' }); await A.post('pay-start');
    const v = await A.post('gift-verify', { number: '7000000000008888', secret: '' }), due = (await A.state()).totals.due;
    s = await A.post('pay-tender', { type: 40, amount: due, giftCards: [v.card] }); await sleep(2500); pr = await printed(); slip = slipOf(pr);
    rec('G6 paying $5.40 with a gift card that had $8: "GIFT CARDS USED", "**** 8888 paid $5.40", "Balance left $2.60"', s.completed && /GIFT CARDS USED \(1\)\n\*\*\*\* 8888 paid\s+\$5\.40\nBalance left\s+\$2\.60/.test(slip) && !pr.some(t => t.includes('7000000000008888')), JSON.stringify(slip));
    await A.post('dismiss');
    await A.post('gift-line', { number: '7000000000005678', amount: 20 }); await A.post('pay-start');
    const v2 = await A.post('gift-verify', { number: '7000000000008888', secret: '' }); await A.post('pay-tender', { type: 40, amount: 2.6, giftCards: [v2.card] });
    s = await A.post('pay-cash', { tendered: 17.4 }); await sleep(2500); pr = await printed(); slip = slipOf(pr);
    rec('G7 one sale selling a card AND paying with another: one list, both parts, each with its last 4 and balance', s.completed && /GIFT CARDS \(1\)\n\*\*\*\* 5678 new\s+\$20\.00\nBalance now\s+\$20\.00/.test(slip) && /GIFT CARDS USED \(1\)\n\*\*\*\* 8888 paid\s+\$2\.60\nBalance left\s+\$0\.00/.test(slip), JSON.stringify(slip));
    await A.post('dismiss');
    const pr2 = (await A.post('print', {})); await sleep(1500); pr = await printed();
    rec('G8 Reprint of that sale prints the receipt and the same list again (balances as read after the sale)', pr2.ok !== false && /\*\*\*\* 5678 new/.test(slipOf(pr)) && /\*\*\*\* 8888 paid/.test(slipOf(pr)), (pr2.message || '') + ' | ' + pr.map(t => t.split('\n')[0]).join(' | '));
    await A.post('scan', { code: '1003' }); s = await sellCash(A, 5); pr = await printed();
    rec('G9 a sale with no gift card prints only the receipt (no list)', s.completed && pr.length === 1 && !slipOf(pr), pr.map(t => t.split('\n')[0]).join(' | '));
    await A.post('dismiss');
    const g10 = await A.post('gift-line', { number: '7000000000004321', amount: 15 }); await hook('/fault?path=RetailGiftCardGet&mode=down&n=5'); // card on the sale first, then AIR POS stops answering the balance look-up
    s = await sellCash(A, 15); slip = slipOf(await printed()); await hook('/fault-clear');
    rec('G10 AIR POS cannot be asked for the balance: the list says "check at counter", never a guessed amount', g10.ok && s.completed && /\*\*\*\* 4321 new\s+\$15\.00\nBalance now\s+check at counter/.test(slip), JSON.stringify(slip));
    await A.post('dismiss');

    // ---------------- returns (cash-paid made-up orders T9005 / T9006)
    await hook('/receives-reset'); const pdf0 = (await hook('/pdfs')).length;
    r = await A.post('return-start', { kind: 'receipt', orderId: 'o-ret-cash' }); await A.post('scan', { code: '1001' }); await A.post('scan', { code: '1001' });
    let t = (await A.state()).ret.totals; let c = await A.post('return-confirm'); await sleep(2000); let ret = (await hook('/')).returns.slice(-1)[0];
    rec('R1 full return (2 of 2 at $10 + 8% tax, paid cash): refund $21.60 cash; AIR POS gets 2 items and one cash refund', r.ok && t.refund === 21.6 && c.ok && ret && ret.kind === 'receipt' && ret.retailOrderId === 'o-ret-cash' && ret.subs[0].quantity === 2 && ret.payments.length === 1 && ret.payments[0].paymentType === 10 && ret.payments[0].amount === 21.6, `${c.message}`);
    const pdfs = (await hook('/pdfs')).slice(pdf0);
    rec('R2 the return receipt prints (AIR POS return receipt for that return)', pdfs.some(x => /RetailReturnOrderBillGet/.test(x.path) && x.returnOrderId === c.returnId), pdfs.map(x => x.path.split('/').pop()).join(', '));
    await A.post('dismiss');
    await A.post('return-start', { kind: 'receipt', orderId: 'o-ret-cash' }); await A.post('scan', { code: '1001' });
    t = (await A.state()).ret.totals; c = await A.post('return-confirm'); await sleep(1500); ret = (await hook('/')).returns.slice(-1)[0];
    rec('R3 partial return (1 of 2): refund $10.80 cash ($10 + $0.80 tax), AIR POS gets 1 item', t.refund === 10.8 && t.tax === 0.8 && c.ok && ret.subs[0].quantity === 1 && ret.payments[0].amount === 10.8, `refund ${t.refund}, tax ${t.tax}`);
    await A.post('dismiss');
    await A.post('return-start', { kind: 'receipt', orderId: 'o-ret-f4' }); await A.post('scan', { code: '1001' });
    t = (await A.state()).ret.totals;
    rec('R4 return 1 item of a sale that had an F4 typed price ($10 item sold at $8): refund $8.64 = $8 + 8% tax (what was paid for it)', t.refund === 8.64 && t.amount === 8 && t.tax === 0.64, JSON.stringify({ amount: t.amount, tax: t.tax, refund: t.refund }));
    await A.post('scan', { code: '1001' }); await A.post('scan', { code: '1001' }); t = (await A.state()).ret.totals; const more = await A.post('scan', { code: '1001' });
    rec('R5 all 3 items of that sale: refund $25.92 = exactly what the customer paid; a 4th item is refused', t.refund === 25.92 && !more.ok && /Nothing left to return/.test(more.message), `${t.refund} | ${more.message}`);
    c = await A.post('return-confirm'); await sleep(1500); ret = (await hook('/')).returns.slice(-1)[0];
    rec('R6 ...sent to AIR POS with the sale\'s 20% line discount (not the full $10 price): refund $25.92 cash', c.ok && ret.retailOrderId === 'o-ret-f4' && ret.subs[0].quantity === 3 && ret.subs[0].discount === 20 && ret.payments[0].amount === 25.92, JSON.stringify(ret.subs[0]));
    await A.post('dismiss');

    // ---------------- Tax Off
    b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9440', defaultViewport: { width: 1366, height: 768 } });
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
    await A.post('new-sale'); await p.goto(B + '/'); await sleep(1500);
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900);
    const t0 = (await A.state()).totals;
    await p.keyboard.press('F5'); await sleep(1000);
    const ui = await p.evaluate(() => ({ modal: !!document.getElementById('modalRoot').firstChild, totals: document.getElementById('totals').innerText.replace(/\s+/g, ' ') }));
    const t1 = (await A.state()).totals;
    rec('T1 manager (the fake login): F5 Tax Off works straight away, no approval window', !ui.modal && (await A.state()).order.taxExempt === true, ui.totals);
    rec('T2 totals: tax $0.80 -> $0.00, total $10.80 -> $10.00 (= before tax); the screen shows "Tax (OFF) $0.00"', t0.tax === 0.8 && t0.due === 10.8 && t1.tax === 0 && t1.due === 10 && /Tax \(OFF\) \$0\.00/.test(ui.totals) && /Total \$10\.00/.test(ui.totals), `${t0.tax}/${t0.due} -> ${t1.tax}/${t1.due}`);
    await p.screenshot({ path: SCR + 'taxoff-sale-1366.png' });
    await p.keyboard.type('1003'); await p.keyboard.press('Enter'); await sleep(900); const t2 = (await A.state()).totals;
    rec('T3 an item scanned after Tax Off is tax free too ($12.00, tax $0.00)', t2.tax === 0 && t2.due === 12, `${t2.tax}/${t2.due}`);
    await printed(); const bills0 = (await hook('/')).bills.length; s = await sellCash(A, 20);
    const saved = await hook('/order?id=' + s.orderId), rcv = (await hook('/')).receives.slice(-1)[0], bills = (await hook('/')).bills.slice(bills0);
    rec('T4 paid: $12.00 taken (change $8.00), the receive is $12.00 with no tax', s.completed && s.due === 12 && s.change === 8 && rcv.amount === 12, s.message);
    rec('T5 the receipt AIR POS prints is for an order with no tax: every saved line has tax rate 0, and the receipt asked for is that order', saved && saved.subs.length === 2 && saved.subs.every(x => x.taxRate === 0) && bills.some(x => { try { return JSON.parse(x.submit).id === s.orderId; } catch { return false; } }), JSON.stringify(saved && saved.subs.map(x => x.taxRate)));
    await A.post('dismiss'); await A.post('new-sale'); await p.reload(); await sleep(1500);
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900); await p.keyboard.press('F5'); await sleep(700); await p.keyboard.press('F5'); await sleep(900);
    const t6 = (await A.state()).totals;
    rec('T6 F5 again: tax back on ($0.80, total $10.80)', t6.tax === 0.8 && t6.due === 10.8 && !(await A.state()).order.taxExempt, `${t6.tax}/${t6.due}`);
    await A.post('new-sale');
    // cashier (not an AIR POS manager): owner decision Nov 3, keep the manager login (tests/tax-off-manager.test.js covers the approval itself)
    if (!(await C.state()).loggedIn) await C.post('login', { company: 'fake shop', user: 'cashier', password: 'fake-pw' });
    await C.post('new-sale'); await C.post('scan', { code: '1001' }); const cx = await C.post('tax-exempt', {}); const cs = await C.state();
    rec('T7 owner decision (1.0.11, keep): a cashier (not an AIR POS manager) is asked for a manager login for Tax Off; tax stays on ($0.80)',
      !cx.ok && cx.needManager === true && /Tax Off needs a manager/.test(cx.message) && !cs.order.taxExempt && cs.totals.tax === 0.8, cx.message);
    await C.post('new-sale');
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { try { await A.post('pay-close'); await A.post('new-sale'); await hook('/fault-clear'); } catch {} if (b) b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-gift-returns-taxoff-results.json'), JSON.stringify({ out, notes }, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

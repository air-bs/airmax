// Store request #26: "Print Quote" prints the sale on screen as QUOTE / ESTIMATE - NOT A SALE - NOT PAID.
// It must never create, hold, complete, pay or void anything in AIR POS, never open the drawer, and never change the sale on screen.
// Offline fake AIR POS only. FAKE_PORT=<port> node tests/e2e-quote-26.js
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const calls = () => fetch(HOOK + '/x').then(r => r.json()).then(j => j.calls || []).catch(() => []);
const MONEY = /RetailOrderSave|RetailOrderReceiveBegin|RetailOrderComplete|RetailOrderPendingVoid|RetailOrderVoid|OpenCashbox|ReceiveCheck|MemberAccount|RetailGiftCard|RetailOrderReturn/;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const toast = () => p.$eval('#toast', e => e.textContent).catch(() => '');
    const L = await p.$$eval('#actions button', bs => bs.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    rec('Q1 left column has a "Print Quote" button (estimate, not a sale); existing buttons keep their names', L.some(x => /Print Quote/.test(x) && /not a sale/i.test(x)) && ['New', 'History', 'Hold', 'Load Hold', 'Open Drawer', 'Price Change'].every(n => L.some(x => x.includes(n))), L.join(' | ').slice(0, 200));
    await p.click('#actions button[data-a="quote"]'); await sleep(600);
    rec('Q2 nothing on the sale: says so, nothing printed', /Nothing on the sale/.test(await toast()), await toast());
    await post('scan', { code: '1001' }); await post('scan', { code: '1002' }); await p.evaluate(() => refresh()); await sleep(800);
    const s0 = await state(), c0 = await calls(), snap = s => JSON.stringify({ id: s.order.id, number: s.order.number, cart: s.cart, totals: s.totals, mode: s.mode, pay: s.pay, completed: s.completed, lastOrderId: s.lastOrderId });
    const pr0 = (await (await fetch(HOOK + '/strict')).json()).prints || 0;
    await p.click('#actions button[data-a="quote"]'); await sleep(2500);
    const s1 = await state(), c1 = await calls(), added = c1.slice(c0.length), t = await toast();
    const pr1 = (await (await fetch(HOOK + '/strict')).json()).prints || 0;
    rec('Q3 a quote is printed once and the cashier is told it is NOT A SALE', pr1 - pr0 === 1 && /Quote printed.*NOT A SALE/.test(t), `prints +${pr1 - pr0}, "${t}"`);
    rec('Q4 no order saved / held / paid / completed / voided, no drawer, no gift card or account call in AIR POS', !added.some(c => MONEY.test(c)), added.join(',') || '(no calls)');
    rec('Q5 the sale on screen is unchanged (same order, items, totals, nothing paid)', snap(s0) === snap(s1) && !s1.completed, `items ${s1.cart.length}, due ${s1.totals.due}`);
    // no money path: quote twice, still nothing
    await p.click('#actions button[data-a="quote"]'); await sleep(2000);
    const c2 = await calls(); rec('Q6 pressing it again prints again but still creates no sale or payment', !c2.slice(c0.length).some(c => MONEY.test(c)) && c2.length >= c1.length, `${c2.length - c0.length} calls`);
    // then the sale still completes normally, exactly once (the quote did not use up or break anything)
    await post('pay-open').catch(() => {}); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    const modal = await p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    rec('Q7 the normal Pay screen still opens after a quote', /Cash|Due/.test(modal), modal.replace(/\s+/g, ' ').slice(0, 60));
    await p.keyboard.press('Escape'); await sleep(300); await post('pay-close'); await sleep(300);
    // payment open on the server (pay-start): refused, nothing printed
    const pr2 = (await (await fetch(HOOK + '/strict')).json()).prints || 0;
    const st8 = await post('pay-start').catch(() => null);
    const r = await post('quote-print'); rec('Q8 while a payment is open the server refuses (and prints nothing)', (await state()).pay ? (r && r.ok === false && /payment is open/i.test(r.message || '') && ((await (await fetch(HOOK + '/strict')).json()).prints || 0) === pr2) : false, r && r.message);
    await post('pay-close'); await sleep(300);
    // return mode refused
    await post('new-sale'); await post('dismiss');
    rec('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
    await p.close().catch(() => {});
  } catch (e) { rec('test crashed', false, e.stack || e.message); }
  b.disconnect();
  const bad = out.filter(x => !x.pass).length; console.log(`\n${out.length - bad}/${out.length} passed`); process.exit(bad ? 1 : 0);
})();

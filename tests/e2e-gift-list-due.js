// 1.0.11-local.4g on the real screen against the OFFLINE fake AIR POS (made-up card numbers only):
//  G: Ctrl+Shift+B Gift card balance keeps a list — every Check adds the card + balance, the box clears and keeps focus,
//     a combined total shows under the list, a card already on the list is not added twice. Read only: only RetailGiftCardGet is called.
//  T: display only — while a sale is part-paid the Checkout tile says "Due $left (of $total)" and on F12 the first big number is
//     shows what is still owed, labelled "Due (of $total)" (same as Balance). Totals and what is sent are unchanged.
//   FAKE_PORT=5180 node tests/e2e-gift-list-due.js   (Chrome on CHROME_URL, default 9433; fake hook on FAKE_PORT+1)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text()).catch(() => '');
const C4 = '7100000000000004', C1 = '7100000000000001', C2 = '7100000000000002', C3 = '7100000000000003', C9 = '7100000000000099';
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await hook(`/gift-add?no=${C1}&bal=20`); await hook(`/gift-add?no=${C2}&bal=5.5`); await hook(`/gift-add?no=${C3}&bal=9&expired=1`);
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    await p.goto(BASE + '/'); await sleep(1500);
    const modal = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const rows = () => p.$$eval('#gTbl tr', t => t.map(r => r.innerText.replace(/\s+/g, ' ').trim())).catch(() => []);
    const total = () => p.$eval('#gTotal', e => e.textContent).catch(() => null);
    const box = () => p.evaluate(() => ({ v: document.getElementById('gNo') && document.getElementById('gNo').value, f: document.activeElement && document.activeElement.id }));
    const scan = async (no, btn) => { await p.type('#gNo', no); if (btn) await p.click('#gChk'); else await p.keyboard.press('Enter'); await sleep(900); };
    const calls0 = JSON.parse(await hook('/gift-calls') || '[]').length, all0 = JSON.parse(await hook('/all-calls') || '[]').length;
    await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('KeyB'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); await sleep(700);
    let m = await modal();
    rec('G1 Ctrl+Shift+B opens Gift card; labels kept: Check balance, Multiple Gift Cards…, Close (Esc); no list yet', /Gift card number/.test(m) && /Check balance/.test(m) && /Multiple Gift Cards/.test(m) && /Close \(Esc\)/.test(m) && !(await rows()).length, m.replace(/\s+/g, ' ').slice(0, 160));
    await scan(C1); let bx = await box();
    rec('G2 Enter on card 1: listed with $20.00, total $20.00, box cleared and focused', (await rows()).length === 1 && /0001.*\$20\.00/.test((await rows())[0]) && (await total()) === '$20.00' && bx.v === '' && bx.f === 'gNo', JSON.stringify([await rows(), await total(), bx]));
    await scan(C2, true); bx = await box();
    rec('G3 Check balance button on card 2: 2 rows, combined total $25.50, box cleared and focused', (await rows()).length === 2 && (await total()) === '$25.50' && bx.v === '' && bx.f === 'gNo', JSON.stringify([await rows(), await total(), bx]));
    await scan(C1); m = await modal();
    rec('G4 card 1 again: not added twice, says so, total still $25.50', (await rows()).length === 2 && (await total()) === '$25.50' && /already on the list/.test(m), JSON.stringify([await rows(), await total()]));
    await scan(C3); m = await modal();
    rec('G5 expired card: listed as EXPIRED, not counted (total $25.50, "Total of 2 cards")', (await rows()).length === 3 && /EXPIRED/.test((await rows())[2]) && (await total()) === '$25.50' && /Total of 2 cards/.test(m) && /not counted/.test(m), JSON.stringify([await rows(), await total()]));
    await scan(C9); m = await modal();
    rec('G6 unknown card: not listed, the usual "No gift card … yet" message', (await rows()).length === 3 && /No gift card 7100000000000099 yet/.test(m), m.replace(/\s+/g, ' ').slice(0, 200));
    await p.click('#gTbl tr:nth-child(2) .gRm'); await sleep(400); bx = await box();
    rec('G8 remove (✕) card 2: 2 rows left (card 1 + expired), total back to $20.00, box focused', (await rows()).length === 2 && !(await rows()).some(r => /0002/.test(r)) && (await total()) === '$20.00' && bx.f === 'gNo', JSON.stringify([await rows(), await total(), bx]));
    await scan(C2); rec('G9 card 2 can be added again after removing: total $25.50', (await rows()).length === 3 && (await total()) === '$25.50', JSON.stringify([await rows(), await total()]));
    await hook(`/gift-add?no=${C4}&bal=0&face=25&sold=0`); await scan(C4); m = await modal(); bx = await box();
    rec('G10 not-active card: listed "not active", not counted (total $25.50); sell box still focuses the amount as before', /not active/.test((await rows()).join('|')) && (await total()) === '$25.50' && bx.f === 'gPay', JSON.stringify([await rows(), await total(), bx]));
    for (let i = 0; i < 4; i++) { if (!(await p.$('#gTbl .gRm'))) break; await p.click('#gTbl .gRm'); await sleep(250); }
    rec('G11 remove every card: list and total gone', !(await rows()).length && (await total()) === null, JSON.stringify([await rows(), await total()]));
    const calls = JSON.parse(await hook('/gift-calls') || '[]').slice(calls0), allC = JSON.parse(await hook('/all-calls') || '[]').slice(all0);
    rec('G12 no write calls: every AIR POS call made while the list was open is RetailGiftCardGet (' + allC.length + ' calls)', allC.length === 7 && allC.every(c => /RetailGiftCardGet$/.test(c)), JSON.stringify([...new Set(allC)]));
    const l1 = await post('gift-lookup', { number: C1 }), l2 = await post('gift-lookup', { number: C2 });
    rec('G7 read only: only RetailGiftCardGet was called (' + calls.length + ' calls), balances unchanged, sale untouched', calls.length === 7 && calls.every(c => /RetailGiftCardGet$/.test(c)) && l1.card.balance === 20 && l2.card.balance === 5.5 && !(await state()).cart.length, JSON.stringify([...new Set(calls)]));
    await p.keyboard.press('Escape'); await sleep(400);
    // ---- T: part-paid display ----
    await post('scan', { code: '1001' }); await post('qty', { row: 0, qty: 2 }); await sleep(300);
    await p.goto('about:blank'); await p.goto(BASE + '/'); await sleep(1500);
    const tile = () => p.$eval('#info-payment', e => e.textContent).catch(() => null);
    let s = await state(); const full = s.totals.due;
    rec('T1 not paid yet: tile unchanged "Due $21.60"', full === 21.6 && (await tile()) === 'Due $21.60', `${await tile()} due ${full}`);
    await p.keyboard.press('F12'); await sleep(1200);
    let lab = await p.$eval('#payTotal', e => e.previousElementSibling.textContent).catch(() => null);
    rec('T2 F12 with no payment yet: big number still labelled "Due" $21.60', lab === 'Due' && (await p.$eval('#payTotal', e => e.textContent)) === '$21.60', String(lab));
    const t = await post('pay-tender', { type: 10, amount: 5, tendered: 5 }); s = await state();
    await p.goto('about:blank'); await p.goto(BASE + '/'); await sleep(1500);
    rec('T4 part-paid Checkout tile: "Due $16.60 (of $21.60)" = S.pay.remaining', (await tile()) === 'Due $16.60 (of $21.60)' && (await state()).pay.remaining === 16.6, String(await tile()));
    if (!(await p.$('#payTotal'))) { await p.keyboard.press('F12'); await sleep(1200); }
    lab = await p.$eval('#payTotal', e => e.previousElementSibling.textContent).catch(() => null);
    const pt = await p.$eval('#payTotal', e => e.textContent).catch(() => null), pd = await p.$eval('#payDue', e => e.textContent).catch(() => null), pdl = await p.$eval('#payDue', e => e.previousElementSibling.textContent).catch(() => null);
    rec('T3 $5 cash paid: F12 big Due shows what is still owed $16.60 ("Due (of $21.60)"), equals Balance $16.60 (labels Paid/Balance kept)', t.ok && !t.completed && s.pay && s.pay.paid === 5 && lab === 'Due (of $21.60)' && pt === '$16.60' && pt === pd && pt === '$' + s.pay.remaining.toFixed(2) && pd === '$16.60' && pdl === 'Balance' && /Paid/.test(await modal()), JSON.stringify({ ok: t.ok, msg: t.message, lab, pt, pd, pdl }));
    rec('T5 display only: totals.due still $21.60, remaining $16.60 from the server', s.totals.due === full && s.pay.remaining === 16.6, `due ${s.totals.due} rem ${s.pay.remaining}`);
    const f = await post('pay-tender', { type: 20, amount: 16.6, stockOk: true }); let fin = f; if (f.ok && !f.completed) fin = await post('finish-sale'); await sleep(1500);
    rec('T6 the rest paid: sale completes normally', fin.ok && (fin.completed || (fin.result && fin.result.completed) || !(await state()).cart.length), JSON.stringify({ ok: fin.ok, msg: fin.message }).slice(0, 200));
    await post('dismiss'); await p.goto('about:blank'); await p.goto(BASE + '/'); await sleep(1200);
    rec('T7 after the sale: tile empty again', !(await tile()), JSON.stringify(await tile()));
    rec('T8 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    await post('new-sale');
  } catch (e) { rec('run', false, e.stack); }
  finally { if (p) await p.close().catch(() => {}); b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

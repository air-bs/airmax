// local.8 (Ari OK 8:29 PM Oct 31): payment pop-up, Gift Card line. Amount typed + Enter with no card checked -> cursor goes to
// the gift card box (#gcNo), nothing is paid. Enter in #gcNo = Check. After the card is checked the old flow is unchanged
// (focus back to the amount, capped at the card balance, Enter moves on / completes). Offline fake AIR POS, made-up $8 card.
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const resetRx = () => fetch(HOOK + '/receives-reset').then(r => r.text());
const receives = async () => (await (await fetch(HOOK + '/')).json()).receives;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach'); await resetRx();
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {})); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(1000); };
    const openPay = async () => { await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); };
    const line = async t => { const i = await p.$$eval('.pline', (x, t) => x.findIndex(e => e.querySelector('.plbl') && e.querySelector('.plbl').textContent === t), t); await p.click(`.pline[data-i="${i}"] .plbl`); await sleep(400); return i; };
    const msg = () => p.$eval('#payMsg', e => e.innerText).catch(() => '');
    const act = () => p.evaluate(() => document.activeElement && document.activeElement.id);
    const onLbl = () => p.$eval('.pline.on .plbl', e => e.textContent).catch(() => '');
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const done = async () => { await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 12000 }).catch(() => {}); await sleep(600); return /Sale complete/.test(await modalTxt()); };
    // 1) item 1001 = $10.80 owed; Gift Card line, type the whole $10.80 (more than the $8 card has), Enter, no card yet
    await scan('1001'); await openPay(); await line('Gift Card');
    await p.click('#pa-40', { clickCount: 3 }); await p.keyboard.type('10.80'); await p.keyboard.press('Enter'); await sleep(900);
    const f1 = await act(), m1 = await msg(), a1 = await p.$eval('#pa-40', e => e.value), r1 = await receives(), s1 = await state();
    rec('Enter on Gift Card amount with no card: cursor goes to the gift card box, amount kept, hint shown', f1 === 'gcNo' && Number(a1) === 10.8 && /Scan the gift card, then Enter/.test(m1), `focus ${f1}, amount ${a1}, "${m1}"`);
    rec('... and nothing is paid (no AIR POS payment, still on Payment)', r1.length === 0 && s1.pay && s1.pay.tenders.length === 0 && !/Sale complete/.test(await modalTxt()), `payments sent ${r1.length}`);
    await p.screenshot({ path: SCR + 'gc-enter-1-scan-box.png' });
    // 2) Enter again on the amount box (still no card) -> stays safe, back to the card box
    await p.focus('#pa-40'); await p.keyboard.press('Enter'); await sleep(700);
    rec('Enter again with still no card: back to the gift card box, still nothing paid', (await act()) === 'gcNo' && (await receives()).length === 0, `focus ${await act()}`);
    // 3) scan the card + Enter in the card box = Check; old flow: focus to amount, capped at $8
    await p.keyboard.type('7000000000008888'); await p.keyboard.press('Enter'); await sleep(1500);
    const f3 = await act(), a3 = await p.$eval('#pa-40', e => e.value), m3 = await msg(), r3 = await receives();
    rec('Scan + Enter in the card box checks the card; cursor back on the amount, capped at the $8 balance', f3 === 'pa-40' && Number(a3) === 8 && /up to \$8\.00/.test(m3) && r3.length === 0, `focus ${f3}, amount ${a3}, "${m3}", sent ${r3.length}`);
    await p.screenshot({ path: SCR + 'gc-enter-2-checked.png' });
    // 4) Enter after the card: existing rule (not covered -> next line), no payment yet
    await p.keyboard.press('Enter'); await sleep(900);
    const l4 = await onLbl(), r4 = await receives();
    rec('After the card is checked, Enter works as before: $2.80 still owed -> moves to the next line, nothing sent yet', l4 === 'Check' && r4.length === 0, `line now "${l4}", sent ${r4.length}`);
    // 5) rest in cash, finish: gift card took exactly $8 (cap), cash $2.80
    await line('Cash'); await p.keyboard.press('+'); await sleep(300); await p.click('#payOk');
    const ok5 = await done(), r5 = await receives();
    rec('Sale finishes: gift card pays the capped $8.00, cash $2.80', ok5 && r5.length === 2 && r5[0].paymentType === 40 && r5[0].amount === 8 && r5[1].paymentType === 10 && Math.abs(r5[1].amount - 2.8) < 0.005, JSON.stringify(r5));
    await resetRx(); await post('pay-close'); await post('new-sale'); await post('dismiss'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    // 6) arriving on Gift Card from another line with Enter (empty amount) is unchanged; Credit Card Enter unchanged
    await scan('1001'); await openPay(); await line('Cash'); await p.click('#cashIn', { clickCount: 3 }); await p.keyboard.press('Enter'); await sleep(700);
    const l6 = await onLbl(), f6 = await act();
    rec('Empty Cash + Enter still just moves to Gift Card (amount box), card box not forced', l6 === 'Gift Card' && f6 === 'pa-40' && (await receives()).length === 0, `line "${l6}", focus ${f6}`);
    await p.keyboard.press('Enter'); await sleep(700);
    rec('Empty Gift Card amount + Enter moves on as before (no card box jump)', (await onLbl()) === 'Check' && (await receives()).length === 0, `line "${await onLbl()}"`);
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} gift card Enter e2e passed`);
  fs.writeFileSync(path.join(__dirname, 'e2e-gc-enter-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  b.disconnect(); process.exit(pass === out.length ? 0 : 1);
})();

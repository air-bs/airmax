// 1.0.10-local.2 split card (Ari OK 2:03 PM ET Nov 1, local only): Card $5 + Cash typed on the payment screen. When the fake terminal
// approves the card part, the card box must close (card shown paid) and the cash part goes on by itself, finishing the sale.
// OFFLINE fake AIR POS only:  FAKE_PORT=5180 node tests/e2e-split-card.js   (Chrome on CHROME_URL, default 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text()).catch(() => '');
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    await hook('/card-approve?on=0'); await hook('/card-wait?on=1');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {})); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await sleep(150); } await sleep(250); };
    const r0 = JSON.parse(await hook('/')).receives.length;
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900); await p.keyboard.press('Enter'); await sleep(900);
    await p.focus('#pa-20'); await p.keyboard.type('5'); await sleep(150); await key('ArrowDown'); await key('+');
    const vals = await p.$$eval('.pline .pamt', x => x.map(e => e.value));
    rec('S1 Card 5 + Cash (rest 5.80) typed', vals[0] === '5' && vals[1] === '5.80', vals.join(' | '));
    await key('Enter'); await sleep(1500);
    let st = (await state()).pay, txt = await modalTxt();
    rec('S2 card $5 waiting on the terminal, card box shown, cash not taken yet', st && st.card && st.card.status === 'waiting' && st.tenders.length === 1 && /Cancel card/.test(txt), JSON.stringify({ card: st && st.card && st.card.status, n: st && st.tenders.length }));
    await p.screenshot({ path: SCR + 'split-card-1-waiting.png' });
    await hook('/card-approve?on=1');
    await p.waitForFunction(() => /Sale complete|Transaction completed/i.test(document.getElementById('modalRoot').innerText), { timeout: 15000 }).catch(() => {});
    txt = await modalTxt();
    rec('S3 card approved: the card box closes and the typed cash goes on by itself; the sale finishes', /Sale complete|Transaction completed/i.test(txt), txt.replace(/\s+/g, ' ').slice(0, 140));
    await p.screenshot({ path: SCR + 'split-card-2-done.png' });
    const rcv = JSON.parse(await hook('/')).receives.slice(r0);
    const cards = rcv.filter(x => x.paymentType === 20), cash = rcv.filter(x => x.paymentType === 10);
    rec('S4 the card was sent once ($5) and cash once ($5.80); amounts unchanged', cards.length === 1 && cards[0].amount === 5 && cash.length === 1 && Math.abs(cash[0].amount - 5.8) < 0.001, JSON.stringify(rcv.map(x => [x.paymentType, x.amount])));
    rec('S5 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.click('#dNew').catch(() => {}); await sleep(800);
    // ---- sale 2: short-stock item, "Take payment anyway", then card part + cash rest (app.js kept only the card before) ----
    await hook('/card-approve?on=0'); await post('settings', { stockWarn: true });
    const r1 = JSON.parse(await hook('/')).receives.length;
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await p.goto('about:blank'); await p.goto(BASE + '/'); await sleep(1500);
    await p.focus('#scanInput'); await p.keyboard.type('1002'); await p.keyboard.press('Enter'); await sleep(1200); await p.keyboard.press('Enter');
    await p.waitForSelector('#pa-20', { timeout: 8000 }).catch(() => {}); await sleep(600);
    const due2 = (await state()).pay.remaining, part = Math.round(due2 * 50) / 100;
    await p.focus('#pa-20'); await p.keyboard.type(String(part)); await sleep(150); await key('ArrowDown'); await key('+');
    await key('Enter'); await sleep(1500);
    const warn = await p.$('#payStockOk');
    rec('S6 short stock: "Take payment anyway" shown before the card is sent (nothing sent yet)', !!warn && JSON.parse(await hook('/')).receives.length === r1, 'warn ' + !!warn);
    if (warn) await p.click('#payStockOk'); await sleep(1500);
    st = (await state()).pay;
    rec('S7 after "Take payment anyway" the card part goes to the terminal', st && st.card && st.card.status === 'waiting' && Math.abs(st.card.amount - part) < 0.005, JSON.stringify(st && st.card));
    await hook('/card-approve?on=1');
    await p.waitForFunction(() => /Sale complete|Transaction completed/i.test(document.getElementById('modalRoot').innerText), { timeout: 15000 }).catch(() => {});
    txt = await modalTxt();
    rec('S8 card approved: the cash queued behind the card is still taken (not dropped by "Take payment anyway"); the sale finishes', /Sale complete|Transaction completed/i.test(txt), txt.replace(/\s+/g, ' ').slice(0, 140));
    const rcv2 = JSON.parse(await hook('/')).receives.slice(r1);
    const c2 = rcv2.filter(x => x.paymentType === 20), k2 = rcv2.filter(x => x.paymentType === 10);
    rec('S9 sale 2: card sent once, cash once, amounts as typed', c2.length === 1 && Math.abs(c2[0].amount - part) < 0.005 && k2.length === 1 && Math.abs(k2[0].amount - Math.round((due2 - part) * 100) / 100) < 0.005, JSON.stringify(rcv2.map(x => [x.paymentType, x.amount])) + ' due ' + due2);
    await p.screenshot({ path: SCR + 'split-card-3-stock-done.png' });
    rec('S10 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.click('#dNew').catch(() => {}); await sleep(500);
  } catch (e) { rec('test run crashed', false, String(e && e.stack || e)); }
  finally { await post('settings', { stockWarn: false }).catch(() => {}); await hook('/card-approve?on=0'); await hook('/card-wait?on=0'); if (p) await p.close().catch(() => {}); b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`e2e-split-card: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

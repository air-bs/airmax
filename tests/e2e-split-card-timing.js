// 1.0.11-local.1 hotfix (Stress Tester l1010, split card + cash): when the terminal approves the card part before the payment
// queue has finished its own step (first poll, ~0.35-0.5 s), the cash queued behind the card was never sent (48/49 at POLLS=1).
// This drives the real payment screen against the OFFLINE fake: the card is approved at the 1st / 4th / 12th Receive Check
// (POLLS=1/4/12), plain sale and short-stock sale ("Take payment anyway"). For POLLS=1 the browser's /api/state answers are
// held back 1.2 s so the approval surely lands while the queue step is still running (the race the stress run hit).
// Checks: the sale finishes, cash sent exactly once, never before the card is approved, card once, amounts as typed.
// OFFLINE fake AIR POS only:  FAKE_PORT=5180 node tests/e2e-split-card-timing.js   (Chrome on CHROME_URL, default 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text()).catch(() => '');
const CASES = [
  { id: 'T1', item: '1001', polls: 1, slow: true }, { id: 'T2', item: '1001', polls: 4 }, { id: 'T3', item: '1001', polls: 12 },
];
// short-stock sales: only the FIRST one on a fresh fake asks "Take payment anyway" (once an oversold sale completes, the store is
// learned as "allows below zero" and is not asked again, as in 1.0.10). TAKE_POLLS picks which timing gets the question (default 1).
const TAKE = Number(process.env.TAKE_POLLS || 1);
CASES.push(...[1, 4, 12].sort((x, y) => (y === TAKE) - (x === TAKE)).map((n, i) => ({ id: 'T' + (4 + i), item: '1002', polls: n, slow: n === 1, stock: true, ask: i === 0 })));
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {})); await p.bringToFront();
    let slow = false; await p.setRequestInterception(true);
    p.on('request', q => { if (slow && q.method() === 'GET' && /\/api\/state/.test(q.url())) setTimeout(() => q.continue().catch(() => {}), 1200); else q.continue().catch(() => {}); });
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await sleep(150); } await sleep(250); };
    for (const c of CASES) {
      const tag = `${c.id} POLLS=${c.polls}${c.stock ? (c.ask ? ' short stock + Take payment anyway' : ' short stock') : ''}`;
      slow = false; await post('settings', { stockWarn: !!c.stock }); await post('pay-close'); await post('new-sale'); await post('dismiss');
      await hook('/card-approve?on=0'); await hook('/card-wait?on=1'); await hook('/cash-log?reset=1');
      const r0 = JSON.parse(await hook('/')).receives.length;
      await p.goto('about:blank'); await p.goto(BASE + '/'); await sleep(1500);
      await p.focus('#scanInput'); await p.keyboard.type(c.item); await p.keyboard.press('Enter'); await sleep(1100); await p.keyboard.press('Enter');
      await p.waitForSelector('#pa-20', { timeout: 8000 }).catch(() => {}); await sleep(600);
      const due = (await state()).pay.remaining, part = Math.round(due * 50) / 100, rest = Math.round((due - part) * 100) / 100;
      await p.focus('#pa-20'); await p.keyboard.type(String(part)); await sleep(150); await key('ArrowDown'); await key('+');
      const vals = await p.$$eval('.pline .pamt', x => x.map(e => e.value));
      // the terminal will approve at the Nth check; armed before the card is even sent (POLLS=1 = approved at the very first poll)
      await hook('/card-approve?on=1&after=' + c.polls); slow = !!c.slow;
      await key('Enter');
      let warned = null;
      if (c.stock) { await p.waitForSelector('#payStockOk', { timeout: c.ask ? 6000 : 1500 }).catch(() => {}); const w = await p.$('#payStockOk'); warned = !!w && JSON.parse(await hook('/')).receives.length === r0; if (w) await p.click('#payStockOk'); }
      await p.waitForFunction(() => /Sale complete|Transaction completed/i.test(document.getElementById('modalRoot').innerText), { timeout: 12000 + c.polls * 1200 }).catch(() => {});
      slow = false; await sleep(1500); // let any late duplicate show up
      const txt = await modalTxt();
      const rcv = JSON.parse(await hook('/')).receives.slice(r0), cash = JSON.parse(await hook('/cash-log'));
      const cards = rcv.filter(x => x.paymentType === 20), cashR = rcv.filter(x => x.paymentType === 10);
      rec(`${tag}: card ${part} + cash ${rest} typed`, vals[0] === String(part) && Number(vals[1]) === rest, vals.join(' | '));
      if (c.stock && c.ask) rec(`${tag}: "Take payment anyway" asked before anything was sent, then pressed`, warned === true, 'warn ' + warned);
      if (c.stock && !c.ask) rec(`${tag}: not asked again (store already learned it allows below zero, as in 1.0.10)`, warned === false, 'warn ' + warned);
      rec(`${tag}: the sale finishes by itself after the card is approved`, /Sale complete|Transaction completed/i.test(txt), txt.replace(/\s+/g, ' ').slice(0, 120));
      rec(`${tag}: card sent once, cash sent exactly once, amounts as typed`, cards.length === 1 && Math.abs(cards[0].amount - part) < 0.005 && cashR.length === 1 && Math.abs(cashR[0].amount - rest) < 0.005, JSON.stringify(rcv.map(x => [x.paymentType, x.amount])));
      rec(`${tag}: cash was sent only AFTER the terminal approved the card`, cash.length === 1 && cash[0].cardApproved === true && cash[0].cardChecks >= c.polls, JSON.stringify(cash));
      await p.click('#dNew').catch(() => {}); await sleep(500);
    }
    // a card that is NOT approved (declined) must never let the queued cash go
    slow = false; await post('settings', { stockWarn: false }); await post('pay-close'); await post('new-sale'); await post('dismiss');
    await hook('/card-approve?on=0'); await hook('/card-wait?on=1'); await hook('/cash-log?reset=1');
    const r9 = JSON.parse(await hook('/')).receives.length;
    await p.goto('about:blank'); await p.goto(BASE + '/'); await sleep(1500);
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(1100); await p.keyboard.press('Enter');
    await p.waitForSelector('#pa-20', { timeout: 8000 }).catch(() => {}); await sleep(600);
    await p.focus('#pa-20'); await p.keyboard.type('5'); await sleep(150); await key('ArrowDown'); await key('+'); await key('Enter'); await sleep(2500);
    const cancel = await p.$('#cardCancel'); if (cancel) await p.click(cancel).catch(() => {}); else await post('card-cancel').catch(() => {}); await sleep(3000);
    const rcv9 = JSON.parse(await hook('/')).receives.slice(r9), st9 = (await state()).pay;
    rec('T7 card still waiting, cashier presses Cancel card: the queued cash is NOT sent', rcv9.filter(x => x.paymentType === 10).length === 0 && JSON.parse(await hook('/cash-log')).length === 0, JSON.stringify({ rcv: rcv9.map(x => [x.paymentType, x.amount]), card: st9 && st9.card && st9.card.status, paid: st9 && st9.paid }));
    rec('T8 no page errors', errs.length === 0, errs.join(' | ') || 'none');
  } catch (e) { rec('test run crashed', false, String(e && e.stack || e)); }
  finally { await post('settings', { stockWarn: false }).catch(() => {}); await post('pay-close').catch(() => {}); await hook('/card-approve?on=0'); await hook('/card-wait?on=0'); if (p) await p.close().catch(() => {}); b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`e2e-split-card-timing: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

// AirMax 1.0.6 = Coach's 1.2.3.1 hotfix (Ari OK 10:48 PM ET Oct 29): way out of "Payment taken, but AIR POS did not finish the sale".
// Port of the hotfix tests/e2e-stuck.js to the AirMax look (same checks) + screenshots of the new buttons / red bar at 1366 and 1024.
// Offline strict fake AIR POS only (made-up data, no account).
// Run: FAKE_STRICT_COMPLETE=1 FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-stuck-106.js  (Chrome on 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/'; fs.mkdirSync(SCR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = async p => JSON.parse(await (await fetch(HOOK + p)).text());
const strict = () => hook('/strict');
const rcvOf = (s, id) => (s.rcv[id] || []).length;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if ((await strict()).promoFail === undefined) throw new Error('fake server is not in FAKE_STRICT_COMPLETE=1 mode');
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); await p.setViewport({ width: 1366, height: 768 }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {})); await p.bringToFront();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const payTxt = () => p.$eval('#payBody', e => e.innerText).catch(() => '');
    const bar = () => p.$eval('#payStuck', e => e.offsetParent ? e.innerText : '').catch(() => '');
    // both AirMax widths; every button and key label must be on screen (not cut off) at each
    const shot2 = async n => { for (const w of [1366, 1024]) { await p.setViewport({ width: w, height: 768 }); await sleep(500); await p.screenshot({ path: SCR + n + '-' + w + '.png' });
      const fit = await p.evaluate(() => [...document.querySelectorAll('#payKeepBack,#payRecheck,#payFinish,#psBack,#psCheck,#payStuck span')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || 'text', ok: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && e.scrollWidth <= e.clientWidth + 1, t: e.innerText }; }));
      rec(`${n} at ${w}: buttons / text fully on screen`, fit.length > 0 && fit.every(f => f.ok), fit.map(f => f.id + (f.ok ? '' : ' CUT')).join(', ')); }
      await p.setViewport({ width: 1366, height: 768 }); await sleep(400); };
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    // ---- 1: the store case: fully paid, AIR POS refuses Complete, totals look equal ----
    await scan('1001'); await hook('/complete-refuse?n=2');
    let st = await state(); const due = st.totals.due;
    const r1 = await post('pay-cash', { tendered: due }); await sleep(300); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    st = await state(); const oid = st.order.id; const n0 = rcvOf(await strict(), oid);
    let t = await payTxt();
    rec('Refused Complete: clear message, payments safe, Esc way out shown', !r1.ok && /Your payments are safe/.test(r1.message) && /Back to sale \(payments kept\)/.test(t) && /Check AIR POS again/.test(t), `${r1.message} | ${t.replace(/\s+/g, ' ').slice(0, 200)}`);
    await shot2('v106-paid-keepback');
    await p.keyboard.press('Escape'); await sleep(900); st = await state(); let bt = await bar();
    rec('Esc closes the payment screen; the sale and its payment stay (nothing cancelled)', !(await p.$('#payBody')) && st.pay && st.pay.paid === due && st.cart.length === 1, `pay open ${!!st.pay}, paid ${st.pay && st.pay.paid}, cart ${st.cart.length}`);
    rec('Sale screen shows the red bar: Paid $X, sale not finished, Back to payment (F12), Check AIR POS again', /Paid \$[\d.]+: sale not finished/.test(bt) && /Back to payment \(F12\)/.test(bt) && /Check AIR POS again/.test(bt), bt.replace(/\s+/g, ' '));
    await shot2('v106-stuck-bar');
    await p.keyboard.press('Escape'); await sleep(600); st = await state();
    rec('Esc again on the sale screen changes nothing', st.pay && st.pay.paid === due && st.cart.length === 1 && /sale not finished/.test(await bar()), `paid ${st.pay && st.pay.paid}`);
    const sNo = await strict(); rec('No payment re-posted by Esc', rcvOf(sNo, oid) === n0, `receives ${n0} -> ${rcvOf(sNo, oid)}`);
    // Check AIR POS again from the bar: order still not completed -> message, no payment
    await p.click('#psCheck'); await sleep(1200); const toastT = await p.$eval('#toast', e => e.innerText).catch(() => '');
    rec('Check AIR POS again: reads only, says what AIR POS shows, no payment sent', rcvOf(await strict(), oid) === n0 && /AIR POS/.test(toastT), toastT);
    // F12 back to the payment, Finish (AIR POS refuses once more), then Finish again completes
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); t = await payTxt();
    rec('F12 reopens the same payment (Fully paid, Finish sale)', /Fully paid/.test(t) && /Finish sale/.test(t), t.replace(/\s+/g, ' ').slice(0, 120));
    await p.keyboard.press('Enter'); await sleep(1200); t = await payTxt();
    rec('Finish refused again: still the way out, still no new payment', /Back to sale \(payments kept\)/.test(t) && rcvOf(await strict(), oid) === n0, t.replace(/\s+/g, ' ').slice(0, 200));
    await p.keyboard.press('Enter'); await sleep(1500); const body = await p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const s1 = await strict(); const c1 = s1.completes.filter(c => c.id === oid);
    rec('Finish when AIR POS accepts: Sale complete, exactly the one original payment', /Sale complete/.test(body) && rcvOf(s1, oid) === n0 && c1.some(c => c.got === c.due), `${body.replace(/\s+/g, ' ').slice(0, 80)}; receives ${rcvOf(s1, oid)}`);
    await post('dismiss'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    // ---- 2: AIR POS total went up: owed; Esc; F12; take the rest = exactly one extra payment ----
    await scan('1001'); await hook('/strict-bump?amt=5'); st = await state(); const due2 = st.totals.due;
    const r2 = await post('pay-cash', { tendered: due2 }); st = await state(); const oid2 = st.order.id; const m0 = rcvOf(await strict(), oid2);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    rec('Short: "AIR POS says $5.00 is still owed ... Take $5.00 more, or press Esc"', !r2.ok && /AIR POS says \$5\.00 is still owed/.test(r2.message) && /press Esc/.test(r2.message), r2.message);
    await p.keyboard.press('Escape'); await sleep(900); st = await state(); bt = await bar();
    rec('Esc with money owed: back to the sale, payment kept, bar shows $5.00 still owed', !(await p.$('#payBody')) && st.pay && st.pay.paid === due2 && /\$5\.00 still owed/.test(bt), bt.replace(/\s+/g, ' '));
    await shot2('v106-owed-bar');
    rec('No payment re-posted by Esc (owed case)', rcvOf(await strict(), oid2) === m0, `receives ${m0} -> ${rcvOf(await strict(), oid2)}`);
    await p.click('#psBack'); await sleep(1200);
    // 1.0.9-local.2 (a): real AIR POS keeps only the first cash receive of a sale (TestShop C33), so a second cash is refused
    // with nothing sent, and the rest is taken by card (the fake's terminal approves at once)
    const r3c = await post('pay-cash', { tendered: 5 }); const m1 = rcvOf(await strict(), oid2);
    rec('Second cash refused: "Cash $X is already taken on this sale ... Take the $5.00 left another way", nothing sent', !r3c.ok && /already taken on this sale/.test(r3c.message) && /\$5\.00 left another way/.test(r3c.message) && m1 === m0, `${r3c.message}; receives ${m0} -> ${m1}`);
    const r3 = await post('pay-tender', { type: 20, amount: 5, stockOk: true }); const s3 = await strict();
    const c3 = s3.completes.filter(c => c.id === oid2 && !c.refused).pop();
    rec('Take the rest by card: only the $5.00 more is taken, AIR POS gets exactly the total, sale completes', r3.ok && r3.completed && c3 && c3.got === c3.due && Math.abs(c3.due - (due2 + 5)) < 0.001, `${r3.message}; complete ${JSON.stringify(c3)}`);
    await post('dismiss');
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } catch (e) { rec('run', false, e.stack); }
  finally {
    fs.writeFileSync(path.join(__dirname, 'e2e-stuck-106-results.json'), JSON.stringify(out, null, 1));
    const n = out.filter(x => x.pass).length; console.log(`\n${n}/${out.length} way-out e2e checks passed (AirMax 1.0.6)`); process.exit(n === out.length ? 0 : 1);
  }
})();

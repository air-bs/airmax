// fix/account-sale-one-enter (handoff #3): a sale put on a customer's account takes ONE Enter and never posts twice.
// Fake AIR POS only (made-up customers). Counts what AIR POS received: Receive Begin (the payment) and Complete (the sale).
// FAKE_PORT=<port> node tests/e2e-account-one-enter.js   (Chrome CHROME_URL, default :9433)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5090), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = p => fetch(HOOK + p).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const receives = async () => (await hook('/')).receives || [];
const calls = async n => (await hook('/all-calls')).filter(c => c.includes(n)).length;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const msg = () => p.$eval('#payMsg', e => e.innerText).catch(() => '');
    const completeDialogs = async () => (await modalTxt()).match(/Sale complete/g) ? 1 : 0;
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const fresh = async (member, codes) => { await hook('/fault-clear'); await hook('/receives-reset'); await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach');
      if (member) await post('member-attach', { number: member }); await p.goto('about:blank'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
      for (const c of codes || ['1001']) await scan(c); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); };
    const line = async t => { const i = await p.$$eval('.pline', (x, t) => x.findIndex(e => e.querySelector('.plbl') && e.querySelector('.plbl').textContent === t), t); await p.click(`.pline[data-i="${i}"] .plbl`); await sleep(400); return i; };
    const done = async () => { await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 12000 }).catch(() => {}); await sleep(600); return /Sale complete/.test(await modalTxt()); };
    const acct = r => r.filter(x => x.paymentType === 11);

    // 1. ONE Enter (nothing typed) puts the whole sale on the account: one payment, one Complete, sale done
    await fresh('5550002'); let c0 = await calls('RetailOrderComplete'); await line('Put on Account'); await p.keyboard.press('Enter');
    let ok = await done(), r = await receives();
    rec('1: customer with a house account, Put on Account line empty, ONE Enter: the sale completes', ok, `receives ${r.length}, "${(await modalTxt()).replace(/\s+/g, ' ').slice(0, 60)}"`);
    rec('1: exactly one AIR POS payment (MemberAccount 11, $10.80, that customer) and one Complete', r.length === 1 && acct(r).length === 1 && r[0].amount === 10.8 && r[0].retailMemberId === 'm-acct' && (await calls('RetailOrderComplete')) - c0 === 1, JSON.stringify(r.map(x => [x.paymentType, x.amount])));

    // 2. Enter hammered 10 times with no pause: still ONE payment and ONE Complete
    await fresh('5550002'); c0 = await calls('RetailOrderComplete'); await line('Put on Account');
    for (let i = 0; i < 10; i++) await p.keyboard.press('Enter');
    ok = await done(); await sleep(1200); r = await receives();
    rec('2: Enter pressed 10 times in a row: still exactly one payment and one Complete', ok && r.length === 1 && (await calls('RetailOrderComplete')) - c0 === 1, `receives ${r.length}, completes ${(await calls('RetailOrderComplete')) - c0}`);

    // 3. Held-down Enter (key repeat)
    await fresh('5550002'); c0 = await calls('RetailOrderComplete'); await line('Put on Account');
    for (let i = 0; i < 12; i++) await p.keyboard.down('Enter'); await p.keyboard.up('Enter');
    ok = await done(); await sleep(1200); r = await receives();
    rec('3: Enter held down (key repeat): exactly one payment and one Complete', ok && r.length === 1 && (await calls('RetailOrderComplete')) - c0 === 1, `receives ${r.length}`);

    // 4. AIR POS did the payment but the reply was lost: more Enters never make a second payment
    await fresh('5550002'); c0 = await calls('RetailOrderComplete'); await hook('/fault?path=RetailOrderReceiveBegin&mode=lost&n=1'); await line('Put on Account');
    for (let i = 0; i < 5; i++) { await p.keyboard.press('Enter'); await sleep(700); }
    ok = await done(); await sleep(1200); r = await receives(); const s4 = await state();
    rec('4: payment reply lost, Enter pressed 5 more times: AIR POS holds ONE payment, one Complete (never charged twice)', r.length === 1 && acct(r).length === 1 && (await calls('RetailOrderComplete')) - c0 === 1, `receives ${r.length}, completes ${(await calls('RetailOrderComplete')) - c0}, sale still open ${!!(s4.pay)}`);

    // 5. No balance: the Enter on an empty line takes nothing (old behaviour: it just moves on)
    await fresh('5550001'); const lbl = await p.$$eval('.pline .plbl', x => x.map(e => e.textContent)); await line(lbl[lbl.length - 1]); await p.keyboard.press('Enter'); await sleep(900); r = await receives();
    rec('5: customer with no account or credit: Enter takes nothing (0 payments), still on Payment', r.length === 0 && !(await done().catch(() => false)), `receives ${r.length}`);

    // 6. No customer on the sale: Enter on the empty Put on Account line takes nothing
    await fresh(null); await line('Put on Account'); await p.keyboard.press('Enter'); await sleep(900); r = await receives();
    rec('6: no customer: Enter takes nothing (0 payments)', r.length === 0 && !/Sale complete/.test(await modalTxt()), `receives ${r.length}`);

    // 8. Old way still works: + then Enter = one payment
    await fresh('5550002'); await line('Put on Account'); await p.keyboard.press('+'); await sleep(300); await p.keyboard.press('Enter'); ok = await done(); r = await receives();
    rec('8: "+" then Enter still takes the whole amount once', ok && r.length === 1 && r[0].paymentType === 11, `receives ${r.length}`);

    // 9. Cash line: Enter on an empty Cash line does not pay (behaviour unchanged)
    await fresh('5550002'); await line('Cash'); await p.keyboard.press('Enter'); await sleep(900); r = await receives();
    rec('9: Enter on an empty Cash line still takes nothing (only the Put on Account line got the one-Enter)', r.length === 0, `receives ${r.length}`);
    // 7 (last: leaves a part-paid sale open). House account limit $50 smaller than the sale ($54): Enter only fills $50.00 and says so; nothing is sent until Pay
    await fresh('5550002', ['1001', '1001', '1001', '1001', '1001']); const due = await p.$eval('#payDue', e => e.textContent).catch(() => ''); await line('Put on Account'); await p.keyboard.press('Enter'); await sleep(900);
    const v7 = await p.$eval('#pa-11', e => e.value).catch(() => ''); r = await receives(); const m7 = await msg();
    rec('7: customer can cover only $50.00 of a $54.00 sale: Enter fills $50.00 + explains, sends nothing', v7 === '50.00' && r.length === 0 && /Press Pay/.test(m7), `due ${due}, box ${v7}, receives ${r.length}, "${m7.slice(0, 90)}"`);
    await p.click('#payOk'); await sleep(1500); r = await receives();
    rec('7: Pay then takes exactly one $50.00 payment; sale stays open for the rest', r.length === 1 && r[0].amount === 50 && !/Sale complete/.test(await modalTxt()), JSON.stringify(r.map(x => [x.paymentType, x.amount])));

    rec('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
  } catch (e) { rec('test crashed', false, e.stack || e.message); }
  await p.close().catch(() => {}); b.disconnect();
  const bad = out.filter(x => !x.pass).length; console.log(`\n${out.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})();

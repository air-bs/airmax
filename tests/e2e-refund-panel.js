// Work copy (NOT released): owner request J — the refund screen is the SAME left side-panel payment screen (same lines, same
// layout), labelled Refund, with "Return to Account" (AIR POS Member Account refund). OFFLINE fake AIR POS, made-up data only.
// Run: FAKE_PORT=5074 node tests/fake-server.js &   FAKE_PORT=5074 node tests/e2e-refund-panel.js   (Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5074), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = async () => (await fetch(HOOK + '/')).json();
const reset = () => fetch(HOOK + '/receives-reset').then(r => r.text());
const EXPECT = ['Credit Card', 'Cash', 'Gift Card', 'Check', 'Manual Credit', 'Account'];
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const clean = async () => { await post('pay-close'); await post('return-cancel'); await post('return-toggle', { on: false }); await post('new-sale'); await post('dismiss'); await post('member-detach'); await reset(); };
    await clean();
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {})); await p.setViewport({ width: 1280, height: 800 }); await p.bringToFront();
    const load = async () => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(1000); };
    const labels = () => p.$$eval('.pline .plbl', x => x.map(e => e.textContent.trim()));
    const rect = () => p.$eval('#modalRoot .modal', e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), cls: e.className }; }).catch(() => null);
    const clickLine = async t => { await p.click(`.pline[data-t="${t}"] .plbl`); await sleep(900); };
    const amt = t => p.$eval(`.pline[data-t="${t}"] .pamt`, e => e.value).catch(() => '');
    const msg = () => p.$eval('#refMsg', e => e.innerText).catch(() => '');
    const txt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');

    // 0. the sale's payment screen, for comparison
    await load(); await scan('1001'); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    const saleLbl = await labels(), saleRect = await rect();
    await post('pay-close'); await clean();

    // 1. receipt return, sale had the made-up house-account customer
    let r = await post('return-start', { kind: 'receipt', orderId: 'o-ret-acct' }); await load(); await scan('1001');
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    const lbl = await labels(), rr = await rect(), head = await p.$eval('.payhead h2', e => e.textContent).catch(() => '');
    const appShift = await p.$eval('#app', e => parseInt(getComputedStyle(e).marginLeft)), cartVis = await p.$eval('#cart', e => e.getBoundingClientRect().width > 200).catch(() => false);
    rec('return start (receipt T9001, made-up customer)', r.ok, r.message);
    // 1.0.8 (Ari OK 12:50 AM Oct 30): refund uses the same centred pop-up as Payment over the dimmed sale (was: left side panel, app shifted right)
    rec('refund opens in the same centred pop-up as Payment (same width/place, sale screen still drawn behind, not shifted)', rr && saleRect && /sidepay/.test(rr.cls) && rr.x === saleRect.x && rr.w === saleRect.w && appShift === 0 && cartVis, JSON.stringify({ rr, saleRect, appShift, cartVis }));
    rec('labelled "Refund"', head === 'Refund', head);
    rec('same lines in the same order as the sale (Credit Card, Cash, Gift Card, Check, Manual Credit, Account)', lbl.length === 6 && lbl.every((l, i) => l.startsWith(EXPECT[i])) && saleLbl.length === 6 && saleLbl.slice(0, 5).join() === lbl.slice(0, 5).join(), 'refund ' + JSON.stringify(lbl) + ' sale ' + JSON.stringify(saleLbl));
    let s = await state(); const def = s.ret.totals.payments.map(x => x.paymentType + ':' + x.amount).join(',');
    rec('default = back the way they paid (unchanged math): Cash $10.80 shown on the Cash line', def === '10:10.8' && (await amt(10)) === '$10.80' && !s.ret.toAccount, def + ' cash=' + (await amt(10)));
    rec('Account line available (Return to Account ON by default, sale had a customer)', s.ret.account.allowed && s.settings.returnToAccount !== false, JSON.stringify(s.ret.account));
    await p.screenshot({ path: SCR + 'refund-side-panel.png' });
    await clickLine(11); s = await state();
    rec('tap Account: refund goes to the customer account — same $10.80, AIR POS type 11, sale\'s customer', s.ret.toAccount && s.ret.totals.refund === 10.8 && s.ret.totals.payments.every(x => x.paymentType === 11 && x.retailMemberId === 'm-acct') && (await amt(11)) === '$10.80' && !(await amt(10)), JSON.stringify(s.ret.totals.payments));
    await p.screenshot({ path: SCR + 'return-to-account.png' });
    await clickLine(30); const mcMsg = await msg(); s = await state();
    rec('a line not used by this sale explains the rule and changes nothing', /way the customer paid/.test(mcMsg) && s.ret.toAccount, mcMsg);
    await p.click('#rOk'); await sleep(1800);
    let h = await hook(); const ro = (h.returns || []).slice(-1)[0] || {};
    rec('Refund sends AIR POS RetailReturnOrderCreate with type-11 lines and the sale\'s customer (total $10.80)', ro.kind === 'receipt' && ro.retailMemberId === 'm-acct' && ro.payments.every(x => x.paymentType === 11 && x.retailMemberId === 'm-acct') && Math.abs(ro.payments.reduce((a, x) => a + x.amount, 0) - 10.8) < 0.001, JSON.stringify(ro.payments));
    rec('done screen: Return complete, Customer account $10.80', /Return complete/.test(await txt()) && /Customer account/.test(await txt()), (await txt()).replace(/\s+/g, ' ').slice(0, 160));
    await p.keyboard.press('Enter'); await sleep(400); await clean();

    // 2. receipt return of a walk-in sale: Account refused
    await post('return-start', { kind: 'receipt', orderId: 'o-ret-walkin' }); await load(); await scan('1001'); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    await clickLine(11); s = await state(); const m2 = await msg();
    rec('walk-in sale: Account says "This sale had no customer…" and the refund stays the way they paid', /had no customer/.test(m2) && !s.ret.toAccount && s.ret.totals.payments.every(x => x.paymentType !== 11), m2);
    await p.keyboard.press('Escape'); await sleep(400); rec('Esc closes the refund panel, nothing sent', !(await p.$('#refBody')) && !((await hook()).returns || []).length, ''); await clean();

    // 3. no-receipt return: customer required, then refunded to the customer account
    await post('return-start', { kind: 'nonorder' }); await load(); await scan('1001'); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    await clickLine(11); const m3 = await msg(); s = await state();
    rec('no receipt, no customer: Account says "Add a customer to refund to their account"', /Add a customer to refund to their account/.test(m3) && !s.ret.toAccount, m3);
    await p.keyboard.press('Escape'); await sleep(300);
    r = await post('member-attach', { number: '5550002' }); await load(); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    await clickLine(11); s = await state(); const ref3 = s.ret.totals.refund;
    rec('with the made-up customer attached: Account picked, refund amount unchanged', r.ok && s.ret.toAccount && s.ret.totals.payments.length === 1 && s.ret.totals.payments[0].paymentType === 11 && ref3 === 10.8, JSON.stringify(s.ret.totals.payments));
    await p.click('#rOk'); await sleep(1800); h = await hook(); const no = (h.returns || []).slice(-1)[0] || {};
    rec('NonOrderReturnOrderCreate: retailMemberId = customer, one type-11 payment of $10.80', no.kind === 'nonorder' && no.retailMemberId === 'm-acct' && no.payments.length === 1 && no.payments[0].paymentType === 11 && no.payments[0].amount === 10.8, JSON.stringify({ m: no.retailMemberId, p: no.payments }));
    await p.keyboard.press('Enter'); await sleep(400); await clean();

    // 4. quick return inside a sale (red line): same panel; Account with the customer
    await post('member-attach', { number: '5550002' }); await load(); await post('return-toggle', { on: true }); await load(); await scan('1003');
    await p.focus('#scanInput'); await p.keyboard.press('Enter'); await sleep(1200);
    const ql = await labels(), qr = await rect();
    rec('quick return: same side panel and same lines', qr && qr.x === saleRect.x && qr.w === saleRect.w && ql.every((l, i) => l.startsWith(EXPECT[i])), JSON.stringify(ql));
    rec('quick return default = Cash with the full refund', (await amt(10)) === '$2.16', await amt(10));
    await clickLine(11); rec('Account picked: amount moves to Account', (await amt(11)) === '$2.16' && !(await amt(10)), await amt(11));
    await p.screenshot({ path: SCR + 'quick-return-to-account.png' });
    await p.keyboard.press('Enter'); await sleep(1800); h = await hook(); const q = (h.returns || []).slice(-1)[0] || {};
    rec('quick return to account: NonOrderReturnOrderCreate with the customer, type 11 $2.16', q.kind === 'nonorder' && q.retailMemberId === 'm-acct' && q.payments.some(x => x.paymentType === 11 && x.amount === 2.16), JSON.stringify({ m: q.retailMemberId, p: q.payments }));
    rec('done screen says it went to the customer\'s account', /account in AIR POS/.test(await txt()), (await txt()).replace(/\s+/g, ' ').slice(0, 140));
    await p.keyboard.press('Enter'); await sleep(400); await clean();

    rec('no page errors', !errs.length, errs.join(' | '));
    await p.close();
  } catch (e) { rec('test run crashed', false, e.stack); }
  finally { b.disconnect(); }
  const passed = out.filter(x => x.pass).length;
  console.log(`${passed}/${out.length} refund-panel e2e passed`);
  fs.writeFileSync(path.join(__dirname, 'e2e-refund-panel-results.json'), JSON.stringify({ when: new Date().toISOString(), passed, total: out.length, results: out }, null, 2));
  process.exit(passed === out.length ? 0 : 1);
})();

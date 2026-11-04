// Air Register 1.2.3 total check, UI e2e against the OFFLINE strict fake AIR POS (no account, no store).
// Run: FAKE_PORT=5094 FAKE_STRICT_COMPLETE=1 node tests/fake-server.js &   FAKE_PORT=5094 CDP=9533 node tests/e2e-total-check.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5094), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = async (p) => JSON.parse(await (await fetch(HOOK + p)).text());
const strict = () => hook('/strict');
const rcvCount = s => Object.values(s.rcv).reduce((a, l) => a + l.length, 0);
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if ((await strict()).promoFail === undefined) throw new Error('fake server is not in FAKE_STRICT_COMPLETE=1 mode');
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); const dialogs = []; p.on('dialog', d => { dialogs.push(d.type() + ': ' + d.message()); d.accept().catch(() => {}); }); await p.bringToFront();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const payTxt = () => p.$eval('#payBody', e => e.innerText).catch(() => '');
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    // ---- 1: the Register 2 case. Item added while AIR POS cannot price it -> payment refused, nothing charged ----
    const base0 = rcvCount(await strict());
    await scan('1001'); await hook('/promo-fail?n=2'); await scan('1003');
    await p.keyboard.press('Enter'); await sleep(1200); // open payment: the total check fails again
    let s0 = await strict(); let st = await state(); const t1 = (await payTxt()) + ' ' + (await p.$eval('body', e => e.innerText).catch(() => ''));
    rec('Stale total: payment refused with the retry message, nothing sent to AIR POS', /Couldn't check the total with AIR POS\. Nothing was charged\. Check the connection, then press Payment again\./.test(t1) && rcvCount(s0) === base0 && !(st.pay && st.pay.paid > 0), `new receives ${rcvCount(s0) - base0}; pay ${JSON.stringify(st.pay && { paid: st.pay.paid, remaining: st.pay.remaining })}`);
    await p.screenshot({ path: SCR + 'tc-1-stale-refused.png' });
    // retry: connection back -> correct total 10.80 + 2.16 = 12.96
    await post('pay-close'); await sleep(300); await p.keyboard.press('Escape'); await sleep(300);
    const sp = await post('pay-start'); st = await state();
    rec('Retry: correct total from AIR POS (both items)', sp.ok && Math.abs(st.totals.due - 12.96) < 0.001 && !st.totals.stale, `due ${st.totals.due} stale ${st.totals.stale}`);
    const r1 = await post('pay-tender', { type: 10, tendered: 20 }); s0 = await strict(); const c1 = s0.completes[s0.completes.length - 1];
    rec('Retry: cash pays the full total and AIR POS completes it (strict check)', r1.ok && r1.completed && c1 && c1.got === c1.due && c1.due === 12.96, `${JSON.stringify(r1.message)}; complete ${JSON.stringify(c1)}`);
    await post('dismiss'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    // ---- 2: AIR POS refuses Complete (its total went up after we priced it) -> payment reopens for what is owed ----
    await hook('/strict-bump?amt=5');
    await scan('1001'); await p.keyboard.press('Enter'); await sleep(1200);
    const cash = await p.$('#cashIn'); if (cash) { await p.click('#cashIn', { clickCount: 3 }).catch(() => {}); }
    const r2 = await post('pay-tender', { type: 10, tendered: 10.8 }); await sleep(1500);
    st = await state(); s0 = await strict(); const ordRcv = Object.values(s0.rcv).pop() || [];
    rec('Refused Complete: "still owed $5.00" with the paid $10.80 kept (one receive, not re-sent)', r2.ok === false && r2.owed === 5 && /\$5\.00 is still owed/.test(r2.message) && st.pay && st.pay.paid === 10.8 && st.pay.remaining === 5 && ordRcv.length === 1, `${r2.message} | paid ${st.pay && st.pay.paid} left ${st.pay && st.pay.remaining} receives ${ordRcv.length}`);
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); await p.keyboard.press('Enter').catch(() => {}); await sleep(1000);
    const t2 = await payTxt();
    rec('Payment screen shows payment lines again, not "Fully paid"', !!t2 && !/Fully paid/.test(t2), t2.replace(/\s+/g, ' ').slice(0, 160));
    await p.screenshot({ path: SCR + 'tc-2-owed.png' });
    const f0 = (await strict()).completes.length; const fin = await post('finish-sale'); const s1 = await strict();
    rec('Pressing Finish sale again: no payment re-sent, still asks for what is owed', fin.ok === false && fin.owed === 5 && rcvCount(s1) === rcvCount(s0), `${fin.message} | completes ${f0}->${s1.completes.length} receives ${rcvCount(s0)}->${rcvCount(s1)}`);
    // mny109a: one cash payment per sale, so the $5.00 owed goes on a card (the fake terminal approves at once)
    const r3 = await post('pay-tender', { type: 20, amount: 5, stockOk: true }); const s2 = await strict(); const c3 = s2.completes[s2.completes.length - 1]; const last = Object.values(s2.rcv).pop();
    rec('Taking the $5.00 owed by card finishes the sale (AIR POS gets $15.80, the cash $10.80 is not re-sent)', r3.ok && r3.completed && c3.got === 15.8 && c3.due === 15.8 && last.filter(x => x.amount === 10.8).length === 1 && !last.some(x => x.amount === 15.8), `${r3.message} | ${JSON.stringify(c3)} rcv ${JSON.stringify(last)}`);
    await hook('/strict-bump?amt=0'); await post('dismiss');
    rec('No page errors', errs.length === 0, (errs.join(' | ') || 'none') + (dialogs.length ? ' | dialogs: ' + dialogs.join(' | ') : ''));
    await p.close();
  } catch (e) { rec('run', false, e.stack); }
  finally { b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'e2e-total-check-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})();

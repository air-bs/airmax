// Store request #3 (handoff problem 3): "Put on Account": ONE Enter must post the sale to the customer's account; extra Enters must never post it twice;
// a real failure must say so (no freeze). OFFLINE fake AIR POS only (fake customer 5550100: store credit + house account). No real money.
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text());
// Step 0 test update: /all-calls (the whole call list) instead of the hook '/' (only the last 30 calls), and the STRICT fake (FAKE_STRICT_COMPLETE=1),
// which records every payment and every Complete the way AIR POS does, so the order read-back (M1 keptCheck) finds the payment and adds no delay.
const calls = async () => JSON.parse(await hook('/all-calls'));
const count = async re => (await calls()).filter(c => re.test(typeof c === 'string' ? c : JSON.stringify(c))).length;
const strict = async () => JSON.parse(await hook('/strict'));
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if ((await strict()).promoFail === undefined) throw new Error('fake server is not in FAKE_STRICT_COMPLETE=1 mode (run: FAKE_STRICT_COMPLETE=1 FAKE_PORT=<port> node tests/look-fake.js)');
    const st0 = await strict(); // what the strict fake already holds, so only this run's orders are judged below
    // M1 (keptCheck) can add up to ~3.2 s to a payment when AIR POS does not list it yet; every wait below allows for that
    const waitDone = (ms = 15000) => p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: ms }).catch(() => {});
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const done = async () => /Sale complete/.test(await modalTxt());
    async function openAccountScreen() {
      if (await done()) { await p.click('#dNew').catch(() => {}); await sleep(700); }
      await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach').catch(() => {});
      await p.evaluate(() => refresh()); await sleep(500);
      await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900);
      await post('member-attach', { number: '5550100' }); await p.evaluate(() => refresh()); await sleep(1500);
      if (await p.$('#modalRoot .modal')) { await p.keyboard.press('Enter'); await sleep(300); }
      await p.focus('#scanInput'); await p.keyboard.press('Enter'); await sleep(1200);
      const idx = await p.$$eval('.pline .plbl', ls => ls.findIndex(e => /Account|Store credit/.test(e.textContent)));
      if (idx < 0) throw new Error('no account line on the payment screen');
      await p.click(`.pline[data-i="${idx}"] .plbl`); await sleep(300); await p.keyboard.press('+'); await sleep(300);
    }
    async function enters(n, gap) { for (let i = 0; i < n; i++) { await p.keyboard.press('Enter'); await sleep(gap); } }
    // S1: one Enter, normal
    await openAccountScreen();
    const r0 = await count(/ReceiveBegin/), c0 = await count(/RetailOrderComplete/);
    await p.keyboard.press('Enter'); await waitDone();
    rec('S1 one Enter posts the sale to the account and finishes it (1 payment, 1 completion)', await done() && (await count(/ReceiveBegin/)) === r0 + 1 && (await count(/RetailOrderComplete/)) === c0 + 1, `receives +${(await count(/ReceiveBegin/)) - r0}, completes +${(await count(/RetailOrderComplete/)) - c0}`);
    // S2: AIR POS is slow (stops answering for 3.5 s, then gives up): a burst of Enters must not send a 2nd payment while the 1st is still running
    await openAccountScreen(); await hook('/fault?path=ReceiveBegin&mode=hang&ms=3500&n=1');
    const r1 = await count(/ReceiveBegin/), c1 = await count(/RetailOrderComplete/);
    await enters(6, 250); const rc = (await count(/ReceiveBegin/)) - r1; // checked while the first call is still hanging
    rec('S2 six quick Enters while AIR POS is slow: only ONE payment request is sent (the rest are ignored)', rc === 1, `receive calls +${rc} while waiting`);
    await p.waitForFunction(() => /Press Retry|Can't reach|no record|failed|dropped/i.test(document.getElementById('modalRoot').innerText), { timeout: 20000 }).catch(() => {});
    const t2 = (await modalTxt()).replace(/\s+/g, ' '), mid = await state();
    rec('S2b when AIR POS gives up the screen says so plainly and nothing was recorded as paid', !(await done()) && /connection|Press Retry|no record/i.test(t2) && mid.pay && mid.pay.paid === 0, t2.slice(t2.indexOf('Put on Account') > 0 ? t2.indexOf('Use points') : 0, 400).slice(0, 220));
    await p.keyboard.press('Enter'); await waitDone();
    rec('S2c ONE more Enter after the failure puts the sale on the account: 1 completion, 2 payment requests in total (1 lost + 1 real)', (await done()) && (await count(/RetailOrderComplete/)) - c1 === 1 && (await count(/ReceiveBegin/)) - r1 === 2, `completes +${(await count(/RetailOrderComplete/)) - c1}, receive calls +${(await count(/ReceiveBegin/)) - r1}`);
    // S3: reply to the payment is LOST (AIR POS took it): Enter must not post a second time
    await openAccountScreen(); await hook('/fault?path=ReceiveBegin&mode=lost&n=1');
    const r2 = await count(/ReceiveBegin/), c2 = await count(/RetailOrderComplete/);
    await p.keyboard.press('Enter');
    // wait for the screen to settle (sale complete, or the "press Retry" message) instead of a fixed 3 s, so the M1 delay can not make us press Enter early
    await p.waitForFunction(() => /Sale complete|Press Retry|Can't reach|no record|failed|dropped/i.test(document.getElementById('modalRoot').innerText), { timeout: 12000 }).catch(() => {});
    const m3 = (await modalTxt()).replace(/\s+/g, ' ');
    let presses = 1; for (; presses < 5 && !(await done()); presses++) { await p.keyboard.press('Enter'); await waitDone(8000); }
    const rr = await state();
    rec('S3 payment reply lost: the sale ends up on the account ONCE (paid once, completed once)', (await done()) && (await count(/RetailOrderComplete/)) - c2 === 1, `Enters used ${presses}; completes +${(await count(/RetailOrderComplete/)) - c2}; receive calls +${(await count(/ReceiveBegin/)) - r2}; first message: ${m3.slice(0, 200)}`);
    rec('S3b it took one Enter (the first reply may be "press Retry", but never more than 2 presses)', presses <= 2, `Enters used ${presses}`);
    // money check on the strict fake (what AIR POS really recorded): every sale this run made has exactly ONE account payment and exactly ONE Complete
    const st1 = await strict(), seen = new Set((st0.completes || []).map(c => c.id));
    const mine = (st1.completes || []).filter(c => !seen.has(c.id)), ids = [...new Set(mine.map(c => c.id))];
    const oneEach = ids.every(id => mine.filter(c => c.id === id).length === 1 && (st1.rcv[id] || []).filter(r => r.paymentType === 11 && r.status === 20).length === 1 && (st1.rcv[id] || []).length === 1);
    rec('S3c strict fake: S1, S2 and S3 each recorded exactly ONE payment (Put on Account) and exactly ONE Complete', mine.length === 3 && ids.length === 3 && oneEach, `completes ${mine.length} for ${ids.length} orders; payments per order ${ids.map(id => (st1.rcv[id] || []).length).join('/')}; got vs due ${mine.map(c => c.got + '/' + c.due).join(', ')}`);
    rec('S4 no page errors', errs.length === 0, errs.join('; ') || 'none');
    await hook('/fault-clear'); await post('pay-close'); await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

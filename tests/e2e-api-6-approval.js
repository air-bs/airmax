// run-env: FAKE_CASHIER=1 AIRMAX_FP_HW_PORT=5268
// AirMax Batch 6, manager approval by fingerprint in the real manager pop-up (OFFLINE: fake AIR POS as a CASHIER + FAKE reader service on 5268, made-up managers).
// The pop-up keeps its title, text, user name, password, Cancel (Esc) and OK exactly; the fingerprint block is added under them through the slot checkout.manager-approval.
// FAKE_PORT = the cashier fake (manager login "boss" / "boss-pw"). Set SHOT_DIR to also save PNG screenshots.
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), HW = Number(process.env.AIRMAX_FP_HW_PORT || 5268), SHOT = process.env.SHOT_DIR || '';
const B = 'http://127.0.0.1:' + FP, sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), state = () => fetch(B + '/api/state').then(r => r.json());
const taxOffNow = async () => { const x = await state(); return !!(x.order && x.order.taxExempt); };
const hw = p => fetch('http://127.0.0.1:' + HW + '/__fp/' + p).then(r => r.json());
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note || '').slice(0, 150)); };
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    await hw('reset');
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('scan', { code: '1001' });
    const s0 = await state();
    rec('0 setup: a cashier (not an AIR POS manager) with one item', s0.user && !s0.user.manager && s0.cart.length === 1, '');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(B + '/'); await sleep(1500);
    const shot = async n => { if (SHOT) await p.screenshot({ path: SHOT + '/' + n + '.png' }); };
    const mtext = () => p.evaluate(() => { const m = document.querySelector('#modalRoot .modal'); return m ? m.innerText.replace(/\s+/g, ' ') : null; });
    // A: pop-up while nobody touches the reader (reader holds)
    await hw('mode?m=hold');
    await p.click('#actions button[data-a="tax-off"]').catch(async () => { await p.keyboard.press('F5'); }); await sleep(1500);
    let mt = await mtext();
    rec('1 the Tax Off pop-up is as before (title, text, user name, password, Cancel (Esc), OK) and now has the fingerprint block', /Tax Off/.test(mt || '') && /A manager must approve Tax Off for this sale\./.test(mt || '') && /Manager user name/.test(mt || '') && /Password/.test(mt || '') && /Cancel \(Esc\)/.test(mt || '') && /OK/.test(mt || '') && /Manager: place your finger on the reader/.test(mt || '') && /Waiting for finger/.test(mt || ''), (mt || '').slice(0, 200));
    await shot('real-manager-popup-fingerprint');
    await p.keyboard.press('Escape'); await sleep(1300);
    rec('2 closing the pop-up stops the reader (162) and nothing is approved', (await hw('state')).calls.some(c => c.name === 'FingerPrintRegistStop') && !(await taxOffNow()) && !(await post('fp-mgr-status')).tokens, '');
    // B: password typed while the reader waits: unchanged
    await hw('reset'); await hw('mode?m=hold');
    await p.keyboard.press('F5'); await sleep(1500);
    await p.type('#mlU', 'boss'); await p.type('#mlP', 'boss-pw'); await p.keyboard.press('Enter'); await sleep(1500);
    const mclosed3 = (await p.$('#modalRoot .modal')) === null;
    rec('3 a manager password typed while the reader waits still approves (Tax Off is on, pop-up closed), and the reader is stopped', mclosed3 && await taxOffNow() && (await hw('state')).calls.some(c => c.name === 'FingerPrintRegistStop'), 'closed=' + mclosed3);
    const taxOn = async () => { const r = await post('tax-exempt', { on: false }); return r; };
    await taxOn();
    // C: fingerprint approves Tax Off with no typing
    await hw('reset');   // reader ok (250 ms)
    await p.keyboard.press('F5'); await sleep(2500);
    const closed = (await p.$('#modalRoot .modal')) === null;
    rec('4 touching the reader approves Tax Off by itself: the pop-up closes and Tax Off is on, no password typed', closed && await taxOffNow(), 'popup closed=' + closed);
    await taxOn();
    // D: wrong finger, then Scan again
    await hw('reset'); await hw('mode?m=nomatch');
    await p.keyboard.press('F5'); await sleep(2000);
    mt = await mtext();
    rec('5 a finger that matches no manager: the pop-up stays open, says so, offers "Scan again"; nothing approved', /does not match any manager/.test(mt || '') && /Scan again/.test(mt || ''), (mt || '').slice(-140));
    await shot('real-manager-popup-fingerprint-nomatch');
    await hw('mode?m=ok'); await p.click('#fp6Again'); await sleep(2500);
    rec('6 Scan again with the right finger approves and closes the pop-up (Tax Off is on)', (await p.$('#modalRoot .modal')) === null && await taxOffNow(), '');
    await taxOn();
    // E: Price Change by fingerprint (the item window opens with the same approval used twice)
    await hw('reset'); await post('new-sale'); await post('dismiss'); await post('scan', { code: '1001' }); await p.evaluate(() => refresh()); await sleep(800);
    const s1 = await state(), orig = s1.cart[0].price, target = Math.round((orig - 0.4) * 100) / 100;
    await p.click('#cart tr.row'); await sleep(200); await p.click('#actions button[data-a="price-change"]'); await sleep(3000);
    mt = await mtext();
    rec('7 Price Change by fingerprint: the item window opens on "New price" with no password typed', /Item discount/.test(mt || '') && !/Manager user name/.test(mt || ''), (mt || '').slice(0, 100));
    await p.type('#ldVal', String(target)); await p.keyboard.press('Enter'); await sleep(1500);
    const s2 = await state(), l = s2.cart[0];
    rec('8 the lower price is applied (the second approval, same fingerprint approval, is accepted)', Math.abs(l.total - target * l.quantity) < 0.005, `orig ${orig} new ${target} line total ${l.total}`);
    const html8 = await p.evaluate(() => document.documentElement.innerHTML);
    rec('8b no token (48 hex) is left anywhere in the page, and none was put on the screen', !/[0-9a-f]{48}/.test(html8), '');
    // the owner's rule: no fingerprint block on the Exit to Windows manager pop-up (it shares the pop-up code and slot)
    await hw('reset'); await p.keyboard.press('Escape'); await sleep(300);
    for (const [ttl, open] of [['Exit to Windows', () => managerLogin('Exit to Windows', 'A manager logs in to close Air Max and go back to Windows.', async () => null)]]) {
      await p.evaluate(open); await sleep(1500);
      const t = await mtext(), box = await p.$('#modalRoot .fp6-box'), calls = (await hw('state')).calls.filter(c => /FingerPrint|ManagerAuth/.test(c.name)).length;
      rec('9a the "' + ttl + '" pop-up has NO fingerprint block and never starts the reader (password + OK only)', new RegExp(ttl, 'i').test(t || '') && /Manager user name/.test(t || '') && !/finger/i.test(t || '') && !box && calls === 0, (t || '').slice(0, 80) + ' calls=' + calls);
      await p.keyboard.press('Escape'); await sleep(400);
    }
    // F: labels and errors
    const lab = await p.$$eval('[data-a="price-change"], [data-a="tax-off"]', bs => bs.map(x => x.innerText.replace(/\s+/g, ' ').trim()).join('|'));
    rec('9 the button labels are unchanged (Price Change, Tax Off)', /^Price Change/.test(lab) && /Tax Off/.test(lab), lab);
    rec('10 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } catch (e) { rec('test ran', false, e.stack || e.message); }
  const n = out.filter(x => x.pass).length; console.log(`${n}/${out.length} passed`); b.disconnect(); process.exit(n === out.length ? 0 : 1);
})();

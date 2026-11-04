// Work copy (NOT released): payment side panel + Left/Right qty + Manual Credit, against the OFFLINE fake AIR POS.
// Run: FAKE_PORT=5074 node tests/fake-server.js &   FAKE_PORT=5074 node tests/e2e-side-panel.js   (Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5074), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const begins = async () => JSON.parse(await (await fetch(HOOK + '/')).text()).calls.filter(c => /ReceiveBegin/.test(typeof c === 'string' ? c : JSON.stringify(c))).length;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await sleep(200); } await sleep(400); };
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const qtys = async () => (await state()).cart.map(l => l.quantity);
    const rect = sel => p.$eval(sel, e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), vis: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 }; }).catch(() => null);
    // ---------- Part C (1): Left / Right quantity ----------
    await scan('1001'); await scan('1002');
    const q0 = await qtys(); await key('ArrowRight'); const q1 = await qtys(); await key('ArrowRight'); const q2 = await qtys();
    await p.screenshot({ path: SCR + 'qty-arrows-right-x2.png' }); rec('Right raises the highlighted (top) line by 1 each press', q0[0] === 1 && q1[0] === 2 && q2[0] === 3 && q2[1] === 1, `${q0} -> ${q1} -> ${q2}`);
    await key('ArrowLeft', 5); const q3 = await qtys();
    rec('Left lowers by 1 and never below 1 (pressed 5 times from 3)', q3[0] === 1 && q3.length === 2, String(q3));
    await key('ArrowUp'); await key('ArrowRight'); const q4 = await qtys();
    rec('After Up selects the other line (Step 0: newest is the bottom line, so the next line is above it), Right raises line 2 only', q4[0] === 1 && q4[1] === 2, String(q4));
    await p.focus('#scanInput'); await p.keyboard.type('10'); await key('ArrowLeft'); await key('ArrowRight'); const q5 = await qtys();
    const sv = await p.$eval('#scanInput', e => e.value); await p.$eval('#scanInput', e => { e.value = ''; });
    rec('Text in the scan box: Left/Right move the cursor only, quantities unchanged', String(q5) === String(q4) && sv === '10', `${q5}, box "${sv}"`);
    await p.keyboard.down('Shift'); await p.keyboard.press('ArrowRight'); await p.keyboard.up('Shift'); await sleep(500); const q6 = await qtys();
    rec('Shift+Right does nothing to quantity (plain arrows only)', String(q6) === String(q4), String(q6));
    await key('ArrowLeft'); // back to 1,1
    await post('new-sale'); await sleep(800);
    // ---------- Part B: side panel ----------
    await scan('1001'); await key('Enter'); await sleep(600); // $10.80
    const pr = await rect('.modal.sidepay'), cart = await rect('#cart'), tot = await rect('.totals, #totals, .bottom');
    const vw = await p.evaluate(() => innerWidth);
    // 1.0.8 (Ari OK 12:50 AM Oct 30): payment is a centred pop-up over the dimmed sale (was: left side panel, sale tappable)
    const dim = await p.evaluate(() => { const o = document.getElementById('ov'), c = document.getElementById('cart').getBoundingClientRect(), hit = document.elementFromPoint(c.x + c.width / 2, c.y + 10);
      return { bg: getComputedStyle(o).backgroundColor, pe: getComputedStyle(o).pointerEvents, cartCovered: !!hit && o.contains(hit) && !document.getElementById('app').contains(hit) }; });
    rec('Payment opens as a centred pop-up (1.0.8; was a left side panel)', pr && pr.vis && Math.abs(pr.x + pr.w / 2 - vw / 2) <= 2 && pr.w <= 900, JSON.stringify(pr));
    rec('The sale (cart + totals) is still drawn behind, dimmed and blocked by the dim layer', cart && cart.vis && tot && tot.vis && dim.pe === 'auto' && dim.cartCovered && !/rgba\(0, 0, 0, 0\)|transparent/.test(dim.bg), `cart ${JSON.stringify(cart)} totals ${JSON.stringify(tot)} dim ${JSON.stringify(dim)}`);
    const pl = await p.$$eval('.pline .plbl', x => x.map(e => e.textContent));
    rec('Tenders: Credit Card, Cash … and "Manual Credit" always listed; no "Keyed card"', pl[0] === 'Credit Card' && pl[1] === 'Cash' && pl.includes('Manual Credit') && !pl.includes('Keyed card'), pl.join(', '));
    await p.screenshot({ path: SCR + 'side-panel-1-open.png' });
    // Manual Credit not set up (fake shop has no keyed card)
    const mcI = pl.indexOf('Manual Credit'); const b0 = await begins();
    await p.click(`.pline[data-i="${mcI}"] .plbl`); await sleep(500); const mm1 = await p.$eval('#payMsg', e => e.textContent).catch(() => '');
    await p.click(`.pline[data-i="${mcI}"] .pamt`); await p.keyboard.type('5'); await sleep(200); await p.click('#payOk'); await sleep(900);
    const mm2 = await p.$eval('#payMsg', e => e.textContent).catch(() => ''), s0 = (await state()).pay;
    rec('Manual Credit tapped when not set up: "Manual Credit not set up", nothing charged', /Manual Credit not set up/.test(mm1) && /Manual Credit not set up/.test(mm2) && s0.tenders.length === 0 && (await begins()) === b0, `"${mm1}" / "${mm2}", tenders ${s0.tenders.length}, begins ${b0}->${await begins()}`);
    await p.screenshot({ path: SCR + 'manual-credit-not-set-up.png' });
    // card $5 (fake terminal approves at once)
    await p.click('.pline[data-i="0"] .plbl'); await sleep(300); await p.click('#pa-20'); await p.keyboard.type('5'); await sleep(200); await p.click('#payOk'); await sleep(1500);
    let s1 = (await state()).pay;
    rec('Card $5.00 taken, balance $5.80', s1 && s1.paid === 5 && s1.remaining === 5.8 && s1.tenders.some(t => t.type === 20 && t.status === 'done'), JSON.stringify(s1 && { paid: s1.paid, remaining: s1.remaining }));
    // 1.0.8: tapping the dimmed sale does nothing; Back (Esc) = "Back to sale (payments kept)" -> back to items
    await p.mouse.click(cart.x + cart.w / 2, (cart.y || 300) + 10); await sleep(900);
    const open0 = !!(await p.$('#payBody')), s0b = (await state()).pay;
    rec('Tap the dimmed sale: nothing happens (pop-up stays, card $5.00 still there)', open0 && s0b && s0b.paid === 5, `pop-up ${open0}, paid ${s0b && s0b.paid}`);
    await key('Escape'); await sleep(900);
    const open1 = !!(await p.$('#payBody')); s1 = (await state()).pay; const toastT = await p.evaluate(() => document.body.innerText);
    rec('Back (Esc): back to the items, pop-up closed, card payment still kept on the sale', !open1 && s1 && s1.paid === 5 && /\$5\.00 paid is kept/.test(toastT), `panel ${open1}, paid ${s1 && s1.paid}`);
    await sleep(1500); rec('Panel does not pop back by itself', !(await p.$('#payBody')), 'stays closed');
    // add an item
    await scan('1002'); const s2 = await state();
    rec('Scan another item: added to the sale ($5.40), card $5 kept, remaining $11.20', s2.cart.length === 2 && s2.pay && s2.pay.paid === 5 && s2.pay.remaining === 11.2, `lines ${s2.cart.length}, due ${s2.totals.due}, paid ${s2.pay && s2.pay.paid}, remaining ${s2.pay && s2.pay.remaining}`);
    await key('ArrowRight'); const s3 = await state();
    rec('Right (qty +1) also allowed after the payment: remaining $16.60', s3.pay.remaining === 16.6 && s3.cart[0].quantity === 2, `qty ${s3.cart[0].quantity}, remaining ${s3.pay.remaining}`);
    await key('ArrowLeft'); const s4 = await state(); const err4 = await p.evaluate(() => document.body.innerText);
    rec('Left (lower) refused after a payment: never below what is paid', s4.cart[0].quantity === 2 && /already paid/.test(err4), `qty ${s4.cart[0].quantity}`);
    const rm = await post('remove', { row: 0 });
    rec('Remove a line refused after a payment', !rm.ok && (await state()).cart.length === 2, rm.message);
    // back to payment
    await key('F12'); await sleep(900); if (!(await p.$('#payBody'))) { await p.focus('#scanInput'); await key('Enter'); await sleep(900); }
    const due = await p.$eval('#payDue', e => e.textContent).catch(() => null), tend = await p.$eval('#payTend', e => e.textContent).catch(() => null), mt = await modalTxt();
    rec('Payment again: shows the kept card $5.00 and only the remaining $16.60', due === '$16.60' && tend === '$5.00' && /Credit Card|Card/.test(mt), `balance ${due}, paid ${tend}`);
    await p.screenshot({ path: SCR + 'side-panel-2-mid-payment-added-item.png' });
    await p.click('.pline[data-i="1"] .plbl'); await sleep(300); await key('+'); await sleep(200); await p.click('#payOk');
    await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 10000 }).catch(() => {});
    const done = await modalTxt();
    rec('Cash pays the remaining $16.60 and the sale completes', /Sale complete/.test(done), done.replace(/\s+/g, ' ').slice(0, 140));
    await p.screenshot({ path: SCR + 'side-panel-3-done.png' });
    await p.click('#dNew').catch(() => {}); await sleep(700);
    // nothing paid: tapping the dim does nothing, Back (Esc) closes the payment (as before)
    await scan('1001'); await key('Enter'); await sleep(600);
    { const c = await rect('#cart'); await p.mouse.click(c.x + c.w / 2, 300); await sleep(700); }
    rec('Nothing paid yet: tap the dimmed sale does nothing (pop-up stays, note says press Back)', !!(await p.$('#payBody')) && /Press Back \(Esc\) to add items/.test(await modalTxt()), (await modalTxt()).replace(/\s+/g, ' ').slice(0, 80));
    await key('Escape'); await sleep(900);
    rec('Nothing paid yet: Back (Esc) closes the payment, cart unchanged', !(await p.$('#payBody')) && !(await state()).pay && (await state()).cart.length === 1, `pay ${!!(await state()).pay}`);
    await post('pay-close'); await post('new-sale');
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-side-panel-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

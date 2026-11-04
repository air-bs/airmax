// Store request #17 (Nov 2): after Reprint Receipt (Ctrl+P) the last receipt stays on screen and does not close by itself; the cashier can print
// more copies and a gift receipt for picked items from it. OFFLINE fake AIR POS (see run-all-look.sh). The fake counts every receipt it is asked for.
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.json());
async function payCash(p) {
  await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
  await p.click('.pline[data-i="1"] .plbl'); await sleep(300); await p.keyboard.press('+'); await sleep(300); await p.click('#payOk');
  await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 15000 }).catch(() => {});
  await sleep(800);
}
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    await hook('/templates?names=Standard,Gift%20Receipt');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const ctrlP = async () => { await p.keyboard.down('Control'); await p.keyboard.press('KeyP'); await p.keyboard.up('Control'); };
    const panel = () => p.evaluate(() => { const m = document.querySelector('#modalRoot .modal'); return m ? { text: m.innerText, rp: !!m.querySelector('#rpCopy') } : null; });
    await scan('1001'); await scan('1002'); await scan('1003');
    await payCash(p); await p.keyboard.press('Enter'); await sleep(800); // close "Sale complete"
    const n0 = (await hook('/')).bills.length;
    await p.focus('#scanInput'); await ctrlP(); await sleep(2500);
    const a = await panel(), n1 = (await hook('/')).bills.length;
    rec('R1 Ctrl+P prints the last receipt once AND opens the "Last receipt" screen', n1 === n0 + 1 && a && a.rp && /Last receipt/.test(a.text), `prints ${n0}->${n1}`);
    rec('R2 the screen lists the items of that sale and shows no money', a && /Bulk candy|×/.test(a.text) && !/\$\d/.test(a.text), (a && a.text.replace(/\s+/g, ' ').slice(0, 200)) || '');
    await sleep(9000);
    rec('R3 it does NOT close by itself (still open after 9 s)', !!(await panel()), '');
    await p.keyboard.press('Enter'); await sleep(2500);
    const n2 = (await hook('/')).bills.length, a2 = await panel();
    rec('R4 Enter prints ONE more copy and the screen stays open', n2 === n1 + 1 && a2 && a2.rp && /copy/.test(a2.text), `prints ${n1}->${n2}`);
    await p.click('#rpCopy'); await sleep(2500); await p.click('#rpCopy'); await sleep(2500);
    const n3 = (await hook('/')).bills.length;
    rec('R5 two more presses = exactly two more copies (one press, one print)', n3 === n2 + 2 && !!(await panel()), `prints ${n2}->${n3}`);
    await p.click('#rpGift'); await sleep(1500);
    const pk = await p.evaluate(() => { const r = document.getElementById('modalRoot'); const cb = [...r.querySelectorAll('.gp-cb')]; return { n: cb.length, names: cb.map(c => c.closest('label').innerText.trim()) }; });
    rec('R6 "Gift receipt…" opens the pick screen with all 3 items ticked', pk.n === 3, pk.names.join(', '));
    await p.click('.gp-row:nth-child(2) .gp-cb'); await p.click('#gpOk'); await sleep(2500);
    const a3 = await panel();
    rec('R7 after the gift receipt (2 items picked) the Last receipt screen is back and says so', !!(a3 && a3.rp && /2 items, no prices/.test(a3.text)), (a3 && a3.text.replace(/\s+/g, ' ').slice(-120)) || 'no screen');
    await p.keyboard.press('Escape'); await sleep(500);
    rec('R8 Esc closes the screen', !(await panel()), '');
    // a sale in progress is not touched
    const s = await state();
    rec('R9 the register is ready for the next sale (empty cart, nothing paid)', s.cart.length === 0, `cart ${s.cart.length}`);
    // one-item sale: Gift receipt prints straight away, no pick screen
    await scan('1001'); await payCash(p); await p.keyboard.press('Enter'); await sleep(800);
    await p.focus('#scanInput'); await ctrlP(); await sleep(2500);
    const ng0 = (await hook('/')).bills.length; await p.click('#rpGift'); await sleep(2500);
    const pk1 = await p.evaluate(() => document.querySelectorAll('.gp-cb').length), ng1 = (await hook('/')).bills.length;
    rec('R10 one-item sale: Gift receipt prints at once, no questions (#16)', pk1 === 0 && ng1 === ng0 + 1, `prints ${ng0}->${ng1}`);
    await p.keyboard.press('Escape'); await sleep(400);
    rec('R11 no page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.screenshot({ path: '/tmp/receipt-panel-17.png' });
    await hook('/templates?names='); await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

// Work copy (NOT released): "Add Gift Receipt" (right panel button + F10) against the OFFLINE fake AIR POS.
// Run: FAKE_PORT=5074 node tests/fake-server.js &   FAKE_PORT=5074 node tests/e2e-gift-receipt.js   (Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5074), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.json());
// pay the whole sale with Cash through the real payment panel (exact amount), wait for the done screen, return its text
async function payCash(p) {
  await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
  await p.click('.pline[data-i="1"] .plbl'); await sleep(300); await p.keyboard.press('+'); await sleep(300); await p.click('#payOk');
  await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 15000 }).catch(() => {});
  await sleep(800); return p.$eval('#modalRoot', e => e.innerText).catch(() => '');
}
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    await hook('/templates?names=Standard,Gift%20Receipt');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const btn = () => p.$eval('[data-a="gift-receipt"]', e => ({ txt: e.innerText.replace(/\s+/g, ' '), on: e.classList.contains('gifton'), right: e.getBoundingClientRect().x > innerWidth / 2, vis: e.offsetParent !== null })).catch(() => null);
    const line = () => p.$eval('#giftLine', e => e.offsetParent !== null ? e.innerText : '').catch(() => '');
    await scan('1001');
    const b0 = await btn();
    rec('Left column shows "Add Gift Receipt" with its key F10 (moved from the right panel, Print Label build)', b0 && b0.vis && !b0.right && /Add Gift Receipt/.test(b0.txt) && /F10/.test(b0.txt), JSON.stringify(b0));
    await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(900);
    const s1 = await state(), b1 = await btn(), l1 = await line();
    rec('F10 marks the sale: state on, button highlighted, green line shown', s1.giftReceipt === true && b1.on && /Gift receipt will print/.test(l1), `state ${s1.giftReceipt}, on ${b1.on}, line "${l1}"`);
    await p.screenshot({ path: SCR + 'gift-receipt-button.png' });
    await p.keyboard.press('F10'); await sleep(900);
    const s2 = await state(), l2 = await line();
    rec('F10 again removes it', s2.giftReceipt === false && !l2, `state ${s2.giftReceipt}, line "${l2}"`);
    await p.click('[data-a="gift-receipt"]'); await sleep(900);
    const s3 = await state();
    rec('Tapping the button marks it again', s3.giftReceipt === true, 'state ' + s3.giftReceipt);
    const tot = s3.totals.due;
    const dm = await payCash(p); const c1 = (await state()).completed || {};
    const bills = JSON.stringify((await hook('/')).bills);
    rec('Sale completes; the store\'s "Gift Receipt" template (tpl-1) printed after the normal flow', /Sale complete/.test(dm) && /tpl-1/.test(bills), `bills ${bills}`);
    rec('Total unchanged by the gift receipt; exact cash, no change', c1.due === tot && c1.change === 0, `due ${c1.due} (before ${tot}) change ${c1.change}`);
    rec('Done screen says the gift receipt prints right after the receipt (request L: printing is in the background)', /Gift receipt: prints right after the receipt/.test(dm), dm.replace(/\s+/g, ' ').slice(0, 160));
    await p.screenshot({ path: SCR + 'gift-receipt-done.png' });
    await p.keyboard.press('Enter'); await sleep(900);
    rec('Next sale is not marked', (await state()).giftReceipt === false, 'state ' + (await state()).giftReceipt);
    // store WITHOUT a gift template: nothing extra prints, the cashier is told why
    await hook('/templates?names=Standard');
    await scan('1002'); await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(900);
    const dm2 = await payCash(p); const bills2 = (await hook('/')).bills;
    rec('No gift template in AIR POS: sale completes, no gift print', /Sale complete/.test(dm2) && !JSON.stringify(bills2).includes('templateId'), 'bills (normal receipt only, no gift template used) ' + bills2.length + ' ' + JSON.stringify(bills2).slice(0, 300));
    const why2 = await p.waitForFunction(() => /no gift receipt template/i.test(document.body.innerText), { timeout: 40000, polling: 200 }).then(() => 'note shown').catch(() => 'no note');
    rec('The cashier is told why (small note: AIR POS has no gift receipt template)', why2 === 'note shown', why2 + ' | ' + dm2.replace(/\s+/g, ' ').slice(0, 160));
    await p.screenshot({ path: SCR + 'gift-receipt-no-template.png' });
    await p.keyboard.press('Enter'); await sleep(600);
    await hook('/templates?names='); await post('pay-close'); await post('new-sale');
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-gift-receipt-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

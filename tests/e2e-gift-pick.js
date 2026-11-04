// 1.0.11-local.6g (Ari OK 6:06 PM ET Nov 1, test build): F10 pick-items gift receipt on the real screen against the OFFLINE fake AIR POS.
// Run (runner): FAKE_PORT=$FP node tests/e2e-gift-pick.js   (Chrome at CHROME_URL)
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
const tplOf = x => { try { return JSON.parse(x.submit).templateId; } catch { return x.templateId; } };
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
    const picker = () => p.evaluate(() => { const r = document.getElementById('modalRoot'); const cb = [...r.querySelectorAll('.gp-cb')]; return { open: !!cb.length, n: cb.length, ticked: cb.filter(c => c.checked).length, names: [...r.querySelectorAll('.gp-row span:first-of-type')].map(s => s.textContent), btns: [...r.querySelectorAll('button')].map(x => x.textContent.trim()), text: r.innerText }; });
    // one line: F10 as before (no screen)
    await scan('1001'); await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(900);
    const one = await picker(), s1 = await state();
    rec('One item: F10 marks the sale straight away, no pick screen (as before)', !one.open && s1.giftReceipt === true, `picker ${one.open}, state ${s1.giftReceipt}`);
    await p.keyboard.press('F10'); await sleep(700);
    // three lines: the pick screen, all ticked
    await scan('1002'); await scan('1003');
    const before = await state(); const tot = before.totals.due;
    await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(1000);
    const pk = await picker();
    rec('3 items: F10 opens the pick screen with all 3 items ticked', pk.open && pk.n === 3 && pk.ticked === 3, `${pk.ticked}/${pk.n} ticked: ${pk.names.join(', ')}`);
    rec('Screen buttons: Print (Enter) and Cancel (Esc); no prices on the screen', pk.btns.some(t => /^Print \(Enter\)/.test(t)) && pk.btns.some(t => /^Cancel \(Esc\)/.test(t)) && !/\$\d/.test(pk.text), pk.btns.join(' | '));
    await p.screenshot({ path: SCR + 'gift-pick-screen.png' });
    await p.keyboard.press('Escape'); await sleep(700);
    const sc = await state(), pc = await picker();
    rec('Cancel (Esc): screen closes, sale NOT marked, nothing printed', !pc.open && sc.giftReceipt === false && !(await hook('/')).bills.length, `state ${sc.giftReceipt}`);
    // untick the 2nd line, Enter
    await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(1000);
    const nm = (await picker()).names; await p.click('.gp-row:nth-child(2) .gp-cb'); await sleep(200); await p.focus('#gpFirst'); await p.keyboard.press('Enter'); await sleep(1000);
    const sm = await state(), pm = await picker(), toastTxt = await p.evaluate(() => document.body.innerText);
    rec('Untick 1, Enter: screen closes, sale marked, cashier told "2 of 3 items, no prices"', !pm.open && sm.giftReceipt === true && /2 of 3 items, no prices/.test(toastTxt), `state ${sm.giftReceipt}; left off: ${nm[1]}`);
    rec('Total unchanged by the pick screen', sm.totals.due === tot, `due ${sm.totals.due} (before ${tot})`);
    const dm = await payCash(p); const c1 = (await state()).completed || {}; await sleep(2500);
    const h1 = await hook('/'); const giftTpl = h1.bills.filter(x => tplOf(x) === 'tpl-1');
    rec('Sale completes; the store gift template is NOT used (slip of the ticked items instead)', /Sale complete/.test(dm) && !giftTpl.length && c1.due === tot, `templates asked: ${h1.bills.map(tplOf).join() || 'none'} (tpl-0 = normal receipt, tpl-1 = Gift Receipt)`);
    await p.keyboard.press('Enter'); await sleep(800);
    rec('Next sale is not marked', (await state()).giftReceipt === false, 'state ' + (await state()).giftReceipt);
    // all ticked: the old path
    await hook('/templates?names=Standard,Gift%20Receipt');
    await scan('1001'); await scan('1003'); await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(1000);
    const pa = await picker(); await p.keyboard.press('Enter'); await sleep(900);
    const sa = await state(); const dm2 = await payCash(p); await sleep(2500); const h2 = await hook('/');
    rec('All ticked + Enter: after the sale the store\'s "Gift Receipt" template prints exactly as before', pa.n === 2 && pa.ticked === 2 && sa.giftReceipt === true && /Sale complete/.test(dm2) && h2.bills.some(x => tplOf(x) === 'tpl-1'), `templates asked: ${h2.bills.map(tplOf).join()}`);
    await p.keyboard.press('Enter'); await sleep(600);
    // no payment / order / return call from the screen itself
    const calls0 = (await hook('/')).calls.length; await scan('1001'); await scan('1002');
    const callsA = (await hook('/')).calls.slice(); await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(900); await p.keyboard.press('Escape'); await sleep(500);
    await p.keyboard.press('F10'); await sleep(900); await p.click('.gp-row:nth-child(1) .gp-cb'); await p.click('#gpOk'); await sleep(900);
    const callsB = (await hook('/')).calls.slice(); const added = callsB.slice(callsB.length - Math.max(0, callsB.length - callsA.length));
    rec('Opening / cancelling / confirming the screen sends no AIR POS call at all', JSON.stringify(callsA.slice(-5)) === JSON.stringify(callsB.slice(-5)), 'calls added: ' + (added.join(' ') || 'none') + ' (start ' + calls0 + ')');
    await post('gift-receipt', { on: false }); await post('pay-close'); await post('new-sale'); await hook('/templates?names=');
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-gift-pick-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

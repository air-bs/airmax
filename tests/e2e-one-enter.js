// 1.0.10-local.2 (Ari 12:17 PM Nov 1): ONE Enter from the "Sale complete" screen to the next empty sale, for a cash sale and a
// card sale, also when the cashier tapped Open Drawer / Print Receipt first or focus left the window, and when the receipt
// printer fails (the failure is a small fading note on the next sale, never a popup that needs its own Enter).
// Ari 12:22 PM: "Warn before selling below zero stock" OFF (default) = straight to payment; ON = Check first + Take payment anyway (Alt+T).
// Fake AIR POS only, made-up data. FAKE_PORT=<port> node tests/e2e-one-enter.js (Chrome CHROME_URL, default :9433)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5090), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = p => fetch(HOOK + p).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const ONLY_COUNT = process.env.ONE_ENTER_COUNT_ONLY === '1';
// ONE_ENTER_STOCK=on: only the "warning ON" part, on a fresh fake (a finished oversold sale teaches "this store allows", which skips the check)
const STOCK_ON = process.env.ONE_ENTER_STOCK === 'on'; // measure only (used for the "before" count on the old code)
(async () => {
  await hook('/print-fail?mode=off'); await hook('/stock-refuse?on=0');
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const p = await b.newPage(); const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { if (d.type() !== 'beforeunload') dialogs.push(d.type() + ': ' + d.message()); d.accept().catch(() => {}); });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const set0 = (await state()).settings || {};
    const fresh = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const mtxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const focusId = () => p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    const waitDone = () => p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 15000, polling: 100 }).then(() => true).catch(() => false);
    const toLine = async id => { for (let k = 0; k < 7 && (await focusId()) !== id; k++) { await p.keyboard.press('ArrowUp'); await sleep(250); } return (await focusId()) === id; };
    // pay by keyboard: F12, pick the line, type the amount, Enter
    const pay = async (kind, code = '1001') => {
      await fresh(); await scan(code); await p.keyboard.press('F12'); await sleep(1500);
      if (kind === 'cash') { await toLine('pa-20'); await p.keyboard.press('ArrowDown'); await sleep(300); await p.keyboard.type('20'); }
      else { await toLine('pa-20'); await p.keyboard.type((await state()).totals.due.toFixed(2)); }
      await sleep(200); await p.keyboard.press('Enter');
      return waitDone();
    };
    const atNewSale = async () => { const s = await state(); return !(await mtxt()).trim() && !s.cart.length && !s.pay && !s.completed && (await focusId()) === 'scanInput'; };
    // count Enter presses from the done screen to the next empty sale ready to scan (max 8)
    const enters = async () => { for (let n = 1; n <= 8; n++) { await p.keyboard.press('Enter'); await sleep(900); if (await atNewSale()) return n; } return 99; };
    const counts = {};
    if (!STOCK_ON) {
    const run = async (name, kind, before) => {
      const done = await pay(kind); if (!done) { rec(name + ': sale completed', false, (await mtxt()).slice(0, 160)); return; }
      const info = before ? await before() : '';
      const n = await enters(); counts[name] = n;
      rec(`${name}: ONE Enter from "Sale complete" to the next empty sale (took ${n})`, n === 1, `${info} drawer/prints ${JSON.stringify(((await hook('/strict')) || {}).prints)}`);
    };
    await run('Cash sale', 'cash');
    await run('Card sale', 'card');
    await run('Cash sale, Open Drawer tapped first', 'cash', async () => { await p.click('#dDrawer'); await sleep(900); return 'focus ' + (await focusId()); });
    await run('Card sale, focus left the window', 'card', async () => { await p.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(200); return 'focus ' + (await focusId()); });
    await hook('/print-fail?mode=offline');
    await run('Cash sale, printer offline, Print Receipt (P) pressed', 'cash', async () => { await p.keyboard.press('p'); await sleep(2500); return 'msg "' + (await p.$eval('#doneMsg', e => e.innerText).catch(() => '')) + '" focus ' + (await focusId()); });
    await hook('/print-fail?mode=off');
    if (ONLY_COUNT) { console.log('COUNTS ' + JSON.stringify(counts)); return; }
    // the automatic receipt fails: the done screen still needs one Enter; the reason shows as a soft note on the next sale
    await post('settings', { receiptAutoPrint: 'always' }); await hook('/print-fail?mode=offline');
    let done = await pay('card'); const n = await enters(); await sleep(3500);
    const notes = await p.$eval('#softNotes', e => e.innerText).catch(() => '');
    rec('Receipt printer offline (auto print): still ONE Enter; the reason is a small note on the next sale (no popup)', done && n === 1 && /Receipt didn't print/.test(notes) && !(await mtxt()).trim() && (await focusId()) === 'scanInput', `enters ${n}, notes "${notes.replace(/\s+/g, ' ')}"`);
    await hook('/print-fail?mode=off');
    // the done screen keeps every button and label
    done = await pay('cash'); const labels = await p.$$eval('#modalRoot button', x => x.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    rec('Done screen keeps Open Drawer (Alt+O), Print Receipt (P), New Sale (Enter) and the Enter / P note', done && labels.some(t => /^Open Drawer/.test(t)) && labels.some(t => /^Print Receipt \(P\)/.test(t)) && labels.some(t => /^New Sale \(Enter\)/.test(t)) && /Enter = next sale/.test(await mtxt()), labels.join(' | '));
    await p.keyboard.press('Enter'); await sleep(900);
    // money step kept: a part payment never leaves the payment window on Enter
    await fresh(); await scan('1001'); await p.keyboard.press('F12'); await sleep(1500); await toLine('pa-20'); await p.keyboard.press('ArrowDown'); await sleep(300); await p.keyboard.type('5'); await p.keyboard.press('Enter'); await sleep(900);
    for (let k = 0; k < 3; k++) { await p.keyboard.press('Enter'); await sleep(500); }
    let s = await state();
    rec('Money step kept: an unpaid balance keeps the payment window open (Enter never finishes or skips it)', !!s.pay && s.cart.length > 0 && !!(await p.$('#payBody')) && !/Sale complete/.test(await mtxt()), `pay ${!!s.pay} paid ${s.pay && s.pay.paid} remaining ${s.pay && s.pay.remaining}`);
    if (s.pay && s.pay.remaining > 0) await post('pay-tender', { type: 20, amount: s.pay.remaining }); await sleep(500); await post('dismiss');
    // ---- Ari 12:22: "Warn before selling below zero stock" ----
    await post('settings', { stockWarn: false });
    const r0 = ((await hook('/')).receives || []).length;
    done = await pay('card', '1002');
    const r1 = ((await hook('/')).receives || []).length;
    rec('Stock warning OFF (default): Toy car (0 in stock) goes straight to payment, no "Check first", card taken once', done && r1 === r0 + 1 && !dialogs.length, `done ${done} receives +${r1 - r0} dialogs ${dialogs.length} screen "${(await mtxt()).slice(0, 160).replace(/\s+/g, ' ')}"`);
    await p.keyboard.press('Enter'); await sleep(900);
    } else {
    const r1 = ((await hook('/')).receives || []).length;
    await post('settings', { stockWarn: true });
    await fresh(); await scan('1002'); await p.keyboard.press('F12'); await sleep(1500);
    const pw = await p.$eval('#payStock', e => e.innerText).catch(() => '');
    await toLine('pa-20'); await p.keyboard.type((await state()).totals.due.toFixed(2)); await p.keyboard.press('Enter'); await sleep(1800);
    const btn = await p.$eval('#payStockOk', e => e.innerText.replace(/\s+/g, ' ')).catch(() => ''), msg = await p.$eval('#payMsg', e => e.innerText).catch(() => '');
    const r2 = ((await hook('/')).receives || []).length;
    rec('Stock warning ON: same as before (notice, "Check first ... (0 in stock, selling 1)", nothing charged, Take payment anyway (Alt+T))', /Toy car \(0 in stock, selling 1\)/.test(pw) && /Check first: Toy car \(0 in stock, selling 1\)/.test(msg) && /Take payment anyway/.test(btn) && /Alt\+T/.test(btn) && r2 === r1, `notice "${pw}" button "${btn}" receives +${r2 - r1}`);
    await p.keyboard.down('Alt'); await p.keyboard.press('t'); await p.keyboard.up('Alt');
    const done = await waitDone(); const r3 = ((await hook('/')).receives || []).length;
    rec('Stock warning ON: Alt+T = Take payment anyway -> charged once, sale complete', done && r3 === r2 + 1, `receives +${r3 - r2}`);
    await p.keyboard.press('Enter'); await sleep(900);
    }
    rec('No page errors, no browser pop-ups', !errs.length && !dialogs.length, JSON.stringify(errs.concat(dialogs)).slice(0, 300));
    await post('settings', { stockWarn: set0.stockWarn === true, receiptAutoPrint: set0.receiptAutoPrint || 'always' });
  } catch (e) { rec('test ran to the end', false, String(e && e.stack || e).slice(0, 400)); } finally {
    await hook('/print-fail?mode=off').catch(() => {}); await post('pay-close').catch(() => {}); await post('new-sale').catch(() => {}); await post('dismiss').catch(() => {});
    await p.close().catch(() => {}); b.disconnect();
    const pass = out.filter(x => x.pass).length; console.log(`e2e-one-enter: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
  }
})().catch(e => { console.error(e); process.exit(1); });

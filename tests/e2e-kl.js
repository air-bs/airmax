// Work copy (NOT released): owner requests K (out-of-stock items still added, small fading note) and
// L (printer / drawer failures never block a sale) against the OFFLINE fake AIR POS. Made-up test data only.
// Run: FAKE_PORT=5080 FAKE_AUTOPRINT=1 node tests/fake-server.js &   then   FAKE_PORT=5080 node tests/e2e-kl.js
//      (Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5080), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const printMode = m => fetch(HOOK + '/print-fail?mode=' + m).then(r => r.text());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await printMode('off'); await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach');
    const p = await b.newPage(); const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); }); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const openPay = async () => { await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); };
    const line = async t => { const i = await p.$$eval('.pline', (x, t) => x.findIndex(e => e.querySelector('.plbl') && e.querySelector('.plbl').textContent === t), t); await p.click(`.pline[data-i="${i}"] .plbl`); await sleep(400); return i; };
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const notes = () => p.$$eval('#softNotes .softnote', x => x.map(e => ({ t: e.innerText, fade: e.classList.contains('fade') }))).catch(() => []);
    const waitNote = (re, ms) => p.waitForFunction(src => [...document.querySelectorAll('#softNotes .softnote')].some(e => new RegExp(src).test(e.innerText)), { timeout: ms, polling: 200 }, re.source).then(() => true).catch(() => false);
    const fresh = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const payCash = async () => { await openPay(); await line('Cash'); await p.keyboard.press('+'); await sleep(300); const t0 = Date.now(); await p.click('#payOk');
      const ok = await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 15000, polling: 50 }).then(() => true).catch(() => false); return { ok, ms: Date.now() - t0 }; };

    // ================= K: out-of-stock item still goes in the sale =================
    await scan('1002');
    const s1 = await state(), inCart = s1.cart.some(l => l.number === '1002' && l.quantity === 1);
    const kNote = await waitNote(/Toy car: Out of stock \(qty 0\)/, 4000);
    const kModal = (await modalTxt()).trim(), kFocus = await p.evaluate(() => document.activeElement && document.activeElement.id);
    rec('K: scanning the 0-stock "Toy car" adds it to the sale (qty 1)', inCart, JSON.stringify(s1.cart));
    rec('K: a small "Out of stock (qty 0)" note shows', kNote, JSON.stringify(await notes()));
    rec('K: no popup / modal and no browser dialog; the scan box keeps focus', kModal === '' && dialogs.length === 0 && kFocus === 'scanInput', `modal "${kModal.slice(0, 60)}", dialogs ${dialogs.length}, focus ${kFocus}`);
    const box = await p.$eval('#softNotes', e => { const r = e.getBoundingClientRect(); return { pe: getComputedStyle(e).pointerEvents, w: r.width, role: e.getAttribute('role') }; });
    rec('K: the note does not block taps (pointer-events none) and is small', box.pe === 'none' && box.w < 700 && box.role === 'status', JSON.stringify(box));
    await p.screenshot({ path: SCR + 'out-of-stock-note.png' });
    await scan('1001'); await sleep(1200);
    const nn = (await notes()).filter(n => /Bulk candy/.test(n.t)).length;
    rec('K: an in-stock item (Bulk candy, 50 in stock) shows no note', nn === 0, JSON.stringify(await notes()));
    await sleep(6000);
    const gone = (await notes()).filter(n => /Out of stock/.test(n.t)).length;
    rec('K: the note disappears by itself (about 6 s)', gone === 0, JSON.stringify(await notes()));
    const s2 = await state();
    rec('K: both items are still in the sale afterwards', s2.cart.length === 2, s2.cart.map(l => l.name).join(', '));

    // ================= L1: printer offline mid-sale =================
    await fresh(); await printMode('offline');
    await scan('1001'); const r1 = await payCash();
    rec('L: printer OFFLINE — the sale completes right away (under 3 s)', r1.ok && r1.ms < 3000, `${r1.ms} ms`);
    const lNote = await waitNote(/Receipt didn't print: press Reprint Receipt \(Ctrl\+P\)/, 6000);
    rec('L: a small note "Receipt didn\'t print, reprint later" appears', lNote, JSON.stringify(await notes()));
    const doneTxt = await modalTxt();
    rec('L: the done screen shows no blocking printer error', /Sale complete/.test(doneTxt) && !/failed|offline/i.test(doneTxt), doneTxt.replace(/\s+/g, ' ').slice(0, 160));
    await p.screenshot({ path: SCR + 'receipt-didnt-print.png' });
    // reprint keeps working once the printer is back
    await printMode('off'); const pr0 = (await (await fetch(HOOK + '/strict')).json()).prints;
    await p.keyboard.press('p'); await sleep(2500);
    const pr1 = (await (await fetch(HOOK + '/strict')).json()).prints; const after = await state(), mClosed = (await modalTxt()).trim() === '';
    rec('L: printer back on, P (Print Receipt) reprints and goes to the next sale', pr1 === pr0 + 1 && mClosed && after.cart.length === 0 && !after.completed, `printer jobs ${pr0}->${pr1}, modal closed ${mClosed}, cart ${after.cart.length}, completed ${!!after.completed}`);
    await sleep(6000);
    rec('L: the printer note fades away by itself', (await notes()).filter(n => /Receipt didn't print/.test(n.t)).length === 0, JSON.stringify(await notes()));

    // ================= L2: printer hangs (times out) mid-sale =================
    await fresh(); await printMode('hang');
    await scan('1001'); const r2 = await payCash();
    rec('L: printer HANGS — the sale still completes right away (under 3 s)', r2.ok && r2.ms < 3000, `${r2.ms} ms`);
    await p.keyboard.press('Enter'); await sleep(800); await scan('1003');
    const s3 = await state();
    rec('L: the next sale starts and takes a scan while the printer is still stuck', s3.cart.length === 1 && s3.cart[0].number === '1003' && (await modalTxt()).trim() === '', s3.cart.map(l => l.name).join(', '));
    const tNote = await waitNote(/Receipt didn't print: press Reprint Receipt \(Ctrl\+P\)/, 40000);
    rec('L: when the stuck print times out (30 s), only the small note shows; the new sale is untouched', tNote && (await state()).cart.length === 1 && (await modalTxt()).trim() === '', JSON.stringify(await notes()));
    await printMode('off');
    await post('new-sale'); await post('dismiss');
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } catch (e) { rec('run', false, e.stack); }
  await printMode('off').catch(() => {});
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} K/L e2e passed`);
  fs.writeFileSync(path.join(__dirname, 'e2e-kl-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  b.disconnect(); process.exit(pass === out.length ? 0 : 1);
})();

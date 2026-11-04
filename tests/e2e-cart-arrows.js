// Air Register 1.2.1: Up / Down move the selected sale line, against the OFFLINE fake AIR POS.
// Run: FAKE_PORT=5072 node tests/fake-server.js &   FAKE_PORT=5072 node tests/e2e-cart-arrows.js   (Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    // AirMax Step 0: lines are drawn oldest first (line 1 on top, newest at the bottom), so sel() = the highlighted line's PLACE on screen (0 = top)
    const sel = () => p.$$eval('#cart tr.row', t => t.map((r, i) => r.classList.contains('sel') ? i : -1).filter(i => i >= 0));
    const names = () => p.$$eval('#cart tr.row td:nth-child(3)', t => t.map(x => x.innerText.trim()));
    const focus = () => p.evaluate(() => document.activeElement && document.activeElement.id);
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await sleep(120); } await sleep(300); };
    await p.focus('#scanInput');
    for (const c of ['1001', '1003', '1004']) { await p.keyboard.type(c); await p.keyboard.press('Enter'); await sleep(700); }
    const nm = await names();
    rec('Three items scanned through the scan box', nm.length === 3, nm.join(' | '));
    const s0 = (await sel())[0];
    await key('ArrowUp', 5); const top = await sel();
    rec('Up moves the highlight up and stops at the top line', top.join() === '0' && await focus() === 'scanInput', `start line ${s0 + 1}, now line ${top[0] + 1}, focus ${await focus()}`);
    await key('ArrowDown'); const one = await sel();
    rec('Down moves one line down (exactly one line highlighted)', one.join() === '1', `line ${one[0] + 1}`);
    await key('ArrowDown', 5); const bot = await sel();
    rec('Down stops at the bottom line', bot.join() === '2', `line ${bot[0] + 1}`);
    rec('Scan box keeps focus while moving', await focus() === 'scanInput', String(await focus()));
    await p.screenshot({ path: SCR + 'cart-arrows-1-moved.png' });
    // + / - / Delete act on the line picked with the arrows
    await key('ArrowUp'); const picked = (await sel())[0], pickedName = (await names())[picked];
    const q0 = (await state()).cart.map(l => l.quantity).reverse(); // register order is newest first; reversed = screen order
    await key('+'); const q1 = (await state()).cart.map(l => l.quantity).reverse();
    rec('+ adds 1 to the line picked with the arrows, other lines unchanged', q1[picked] === q0[picked] + 1 && q1.every((q, i) => i === picked || q === q0[i]), `line ${picked + 1} (${pickedName}): ${q0} -> ${q1}`);
    await key('-'); const q2 = (await state()).cart.map(l => l.quantity).reverse();
    rec('- takes 1 off that same line', q2.join() === q0.join(), `${q1} -> ${q2}`);
    rec('Highlight stays on the same line after + / - (screen refreshed)', (await sel()).join() === String(picked), `line ${(await sel())[0] + 1}`);
    await key('ArrowDown'); await key('ArrowUp', 2); const t = (await sel())[0], tName = (await names())[t];
    await key('Delete'); const left = (await state()).cart.map(l => l.name);
    rec('Delete removes the line picked with the arrows', left.length === 2 && !left.includes(tName), `removed "${tName}", left: ${left.join(' | ')}`);
    // scanning still works after arrows, and a new scan still selects the newest line as before
    await key('ArrowDown'); await p.keyboard.type('1003'); await p.keyboard.press('Enter'); await sleep(900);
    const after = await state();
    rec('Scanning still works after using the arrows', after.cart.some(l => /Rope/.test(l.name) && l.quantity === 2) && after.cart.length === 2, `${after.cart.map(l => l.name + ' x' + l.quantity).join(' | ')}`);
    rec('New scan selects the newest line (the bottom one) (Step 0 line order)', (await sel()).join() === String((await names()).length - 1), `line ${(await sel())[0] + 1} of ${(await names()).length}`);
    // a window is open: arrows do not move the sale line
    await key('ArrowDown'); const before = (await sel()).join();
    await p.keyboard.down('Control'); await p.keyboard.press('f'); await p.keyboard.up('Control'); await sleep(800);
    const mo = await p.evaluate(() => !!document.getElementById('modalRoot').firstChild);
    await key('ArrowUp'); await key('ArrowDown', 2); const inModal = (await sel()).join();
    rec('Search window open (Ctrl+F): arrows do not move the sale line', mo && inModal === before, `window open ${mo}, line before ${before}, after ${inModal}`);
    await key('Escape'); await sleep(400);
    // quick search side panel has focus: its own arrows, not the sale's
    await p.click('#qsIn'); await p.keyboard.type('o'); await sleep(900);
    await key('ArrowUp'); await key('ArrowDown'); const qs = (await sel()).join();
    rec('Quick search box focused: arrows stay in quick search, sale line unchanged', qs === before && await focus() === 'qsIn', `line ${qs}, focus ${await focus()}`);
    await p.evaluate(() => { document.getElementById('qsIn').value = ''; }); await p.focus('#scanInput'); await sleep(200);
    // payment screen open: arrows do nothing to the sale line
    await key('F12'); await sleep(800);
    const pay = await p.evaluate(() => !!document.getElementById('payBody'));
    const sBefore = JSON.stringify((await state()).cart);
    await key('ArrowUp'); await key('ArrowDown', 2);
    rec('Payment screen open: arrows do not move the sale line or change the sale', pay && JSON.stringify((await state()).cart) === sBefore && (await p.evaluate(() => document.querySelectorAll('#cart tr.row.sel').length ? [...document.querySelectorAll('#cart tr.row')].findIndex(r => r.classList.contains('sel')) : -1)) === +before, `payment open ${pay}`);
    await key('Escape'); await sleep(600); await post('pay-close'); await sleep(300);
    // modifiers are not taken
    await p.focus('#scanInput'); const m0 = (await sel()).join();
    await p.keyboard.down('Shift'); await p.keyboard.press('ArrowUp'); await p.keyboard.up('Shift'); await sleep(300);
    rec('Shift+Up is not taken (only plain Up/Down)', (await sel()).join() === m0, `line ${m0} -> ${(await sel()).join()}`);
    // long sale: the highlighted line scrolls into view
    await post('new-sale'); await sleep(300);
    for (const c of ['1001', '1003', '1004']) await post('scan', { code: c });
    await p.evaluate(() => { document.querySelector('.gridbox, #gridbox').style.maxHeight = '95px'; return refresh(); }); /* sale list sized to show about 2 lines, like a long sale on a small screen */ await sleep(800); await p.focus('#scanInput'); await key('ArrowUp', 5);
    const n = (await names()).length; await key('ArrowDown', n + 2);
    const vis = await p.evaluate(() => { const r = document.querySelector('#cart tr.row.sel'); if (!r) return null; let el = r.parentElement; while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement; const a = (el || document.documentElement).getBoundingClientRect(), b = r.getBoundingClientRect(); return { row: +r.dataset.row, inside: b.top >= a.top - 1 && b.bottom <= a.bottom + 1, scroller: el ? (el.id || el.className) : 'page', scrolled: el ? el.scrollTop : window.scrollY }; });
    rec('Long sale: Down to the last line scrolls it into view', vis && vis.row === 0 /* register row 0 = newest = bottom line */ && vis.inside && vis.scrolled > 0, JSON.stringify(vis) + `, ${n} lines`);
    await p.screenshot({ path: SCR + 'cart-arrows-2-scrolled.png' });
    await p.evaluate(() => { document.querySelector('.gridbox, #gridbox').style.maxHeight = ''; });
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-cart-arrows-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

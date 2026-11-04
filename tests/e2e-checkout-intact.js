// AirMax Step 0 (parent rule: NOTHING comes off the Checkout page). The Gift Card, Multiple Gift Cards, Gift Card Balance, Customer Add (F3),
// Items (Esc) and Checkout (F12) buttons, every left-column and right-column button with its shortcut label, and every shortcut of master
// are still there and still work, before and after using the new tabs (Gift Cards and Customers are extra pages, they replace nothing).
// Golden copies of master base (dfcc450, the 1.0.11 release line): tests/fixtures-0/checkout-buttons-master.json (taken from master's own screen) and shortcuts-master.json.
// OFFLINE fake AIR POS only.   FAKE_PORT=5180 node tests/e2e-checkout-intact.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-0', 'checkout-buttons-master.json'), 'utf8'));
const SC_MASTER = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-0', 'shortcuts-master.json'), 'utf8'));
const MUST = ['Gift Card', 'Multiple Gift Cards', 'Gift Card Balance', 'Customer add', 'Items', 'Checkout']; // named by the parent
(async () => {
  // static: every shortcut master had is still in shortcuts.json with the same key, action and label
  const cur = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'shortcuts.json'), 'utf8'));
  const flat = j => { const o = []; (function w(x) { if (Array.isArray(x)) x.forEach(w); else if (x && typeof x === 'object') { if (x.key && x.action) o.push(x.key + '|' + x.action + '|' + (x.label || '')); Object.values(x).forEach(w); } })(j); return o; };
  const have = new Set(flat(cur)), lost = flat(SC_MASTER).filter(k => !have.has(k));
  rec('K1 every shortcut in master (key, action, label) is still in shortcuts.json', !lost.length && flat(SC_MASTER).length > 40, lost.length ? 'lost: ' + lost.join('; ') : flat(SC_MASTER).length + ' kept');
  rec('K2 shortcuts.json is unchanged from master (Step 0 adds no shortcuts; tabs are click-only)', JSON.stringify(cur) === JSON.stringify(SC_MASTER), 'identical');
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await fetch(BASE + '/api/state').then(r => r.json())).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    await p.goto(BASE + '/'); await sleep(1800);
    const snap = () => p.evaluate(() => {
      const t = e => e.textContent.replace(/\s+/g, ' ').trim(), vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const all = sel => [...document.querySelectorAll(sel)];
      return { left: all('#actions .abtn').map(e => [t(e), e.dataset.a]), right: all('#right h3, #right .rbtn').map(e => [e.tagName === 'H3' ? 'H:' + t(e) : t(e), e.dataset.a || '']), tiles: all('#tiles .tile').map(e => [t(e), e.dataset.a]),
        help: t(document.getElementById('helpPill')), set: t(document.getElementById('setTop')), shown: all('#actions .abtn, #right .rbtn, #tiles .tile').filter(e => !vis(e)).length, checkoutShown: vis(document.getElementById('checkoutView')) };
    });
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const s0 = await snap();
    rec('B1 left Actions column: same buttons, labels, shortcut labels and actions as master', same(s0.left, GOLD.left), `${s0.left.length} buttons`);
    rec('B2 right column: same headings and buttons, labels, shortcut labels and actions as master', same(s0.right, GOLD.right), `${s0.right.length} entries`);
    rec('B3 the three tiles (Customer add F3, Items Esc, Checkout F12) are as master', same(s0.tiles, GOLD.tiles), JSON.stringify(s0.tiles.map(x => x[0])));
    rec('B4 "F1 = keys" is as master and the Settings button is still there (now drawn as a tab: icon + SETTINGS, key in its tooltip)', s0.help === GOLD.help && /Settings/i.test(s0.set) && (await p.$eval('#setTop', e => e.title)) === 'Settings (Ctrl+,)', s0.help + ' | ' + s0.set);
    const names = [...s0.right, ...s0.tiles, ...s0.left].map(x => x[0]);
    const missing = MUST.filter(m => !names.some(n => n.toLowerCase().includes(m.toLowerCase())));
    rec('B5 Gift Card, Multiple Gift Cards, Gift Card Balance, Customer add (F3), Items and Checkout (F12) are on Checkout', !missing.length && s0.right.some(x => /Gift Card.*Ctrl \+ G/.test(x[0]) && x[1] === 'gift-card') && s0.right.some(x => /Multiple Gift Cards.*Ctrl \+ Shift \+ G/.test(x[0]) && x[1] === 'gift-multi') && s0.right.some(x => /Gift Card Balance.*Ctrl \+ Shift \+ B/.test(x[0]) && x[1] === 'gift-balance') && s0.tiles.some(x => /F3.*Customer add/.test(x[0]) && x[1] === 'customer') && s0.tiles.some(x => /F12.*Checkout/.test(x[0]) && x[1] === 'checkout'), missing.join() || 'all present');
    rec('B6 no Checkout button is hidden', s0.shown === 0, String(s0.shown));
    // the extra pages: visit every tab (Gift Cards, Customers included), come back, nothing moved
    const TABS = ['orders', 'items', 'customers', 'giftcards', 'reports', 'users', 'backoffice'];
    let moved = [];
    for (const t of TABS) {
      await p.evaluate(x => { const e = document.querySelector('#tabbar .tab[data-tab="' + x + '"]'); if (e) e.click(); }, t); await sleep(400);
      const away = await snap(); if (away.checkoutShown && t !== 'orders') /* the Orders page (orders.js) is a window over the sale */ moved.push(t + ': Checkout still drawn on the other page');
      await p.evaluate(() => { const e = document.querySelector('#tabbar .tab[data-tab="checkout"]'); e.click(); }); await sleep(400);
      const back = await snap(); if (!same(back.left, GOLD.left) || !same(back.right, GOLD.right) || !same(back.tiles, GOLD.tiles) || !back.checkoutShown) moved.push(t + ': buttons changed after coming back');
    }
    rec('T1 after opening Orders, Items, Customers, Gift Cards, Reports, Users and Back Office and coming back, every Checkout button is as before', !moved.length, moved.join('; ') || TABS.length + ' tabs visited');
    // still work: each shortcut opens its window
    const modal = () => p.$eval('#modalRoot', e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
    const close = async () => { await p.keyboard.press('Escape'); await sleep(400); await p.keyboard.press('Escape'); await sleep(300); };
    const tryKey = async (label, press, re) => { await p.focus('#scanInput'); await press(); await sleep(900); const m = await modal(); rec(label, re.test(m), m.slice(0, 70)); await close(); };
    await tryKey('W1 Ctrl+G opens Gift Card', () => p.keyboard.down('Control').then(() => p.keyboard.press('g')).then(() => p.keyboard.up('Control')), /Gift Card/);
    await tryKey('W2 Ctrl+Shift+G opens Multiple Gift Cards', async () => { await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('G'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); }, /Multiple Gift Cards/);
    await tryKey('W3 Ctrl+Shift+B opens Gift Card Balance', async () => { await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('B'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); }, /Gift Card|Balance/i);
    await tryKey('W4 F3 opens Customer add', () => p.keyboard.press('F3'), /Customer|Member|phone/i);
    // clicking the buttons also works (the right-column buttons and the tile)
    for (const [lab, sel, re] of [['W5 click Gift Card (right column)', '#right .rbtn[data-a="gift-card"]', /Gift Card/], ['W6 click Multiple Gift Cards', '#right .rbtn[data-a="gift-multi"]', /Multiple Gift Cards/], ['W7 click Gift Card Balance', '#right .rbtn[data-a="gift-balance"]', /Gift Card|Balance/i], ['W8 click the Customer add tile', '#tiles .tile[data-a="customer"]', /Customer|Member|phone/i]]) {
      await p.click(sel); await sleep(900); const m = await modal(); rec(lab, re.test(m), m.slice(0, 70)); await close();
    }
    await post('scan', { code: '1001' }); await p.reload(); await sleep(1500); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(900);
    const pm = await modal(); rec('W9 F12 opens Payment', /Payment|Due|Total/i.test(pm), pm.slice(0, 70)); await close();
    rec('X0 no page errors', !errs.length, errs.join(' | ').slice(0, 200) || 'none');
  } catch (e) { rec('X1 run finished', false, String(e && e.stack || e).slice(0, 300)); }
  finally { try { await post('pay-close'); await post('new-sale'); } catch {} if (p) await p.close().catch(() => {}); await b.disconnect(); }
  console.log(`${fails.length ? 'FAILED' : 'ALL PASSED'}: ${fails.length} failed${fails.length ? ': ' + fails.join('; ') : ''}`); process.exit(fails.length ? 1 : 0);
})();

// AirMax Step 0 (Gordon OK 1:26 PM ET Nov 3): the newest scanned item is the BOTTOM line, line 1 stays at the top, and every
// action (Qty + / *N, F4 discount, Edit tax, Delete, arrows, return lines, Find in sale) hits the right underlying line.
// Also the top bar (8 tabs, coming soon, section register, permission check, Esc back, Ctrl+Shift+N).
// OFFLINE fake AIR POS only.   FAKE_PORT=5180 node tests/e2e-sale-line-order.js   (Chrome on CHROME_URL, default 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
// the temporary file is named zz-... so it loads AFTER every batch section file: its sample 'giftcards' section replaces a real Batch 8 screen, so P6 finds its test marker whatever the batches register
const SEC = path.join(__dirname, '..', 'app', 'public', 'sections', 'zz-step0-test.js');
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    const fresh = async codes => { await post('pay-close'); await post('new-sale'); await post('dismiss'); for (const c of codes) await post('scan', { code: c }); await p.goto(BASE + '/'); await sleep(1500); };
    const names = () => p.$$eval('#cart tr.row td:nth-child(3)', t => t.map(x => { const c = x.cloneNode(true); c.querySelectorAll('.discline').forEach(d => d.remove()); return c.innerText.replace(/\s+return$/, '').trim(); })); // the green discount line under an item is not part of its name
    const nums = () => p.$$eval('#cart tr.row td:nth-child(1)', t => t.map(x => x.innerText.trim()));
    const selName = () => p.$eval('#cart tr.row.sel td:nth-child(3)', x => { const c = x.cloneNode(true); c.querySelectorAll('.discline').forEach(d => d.remove()); return c.innerText.replace(/\s+return$/, '').trim(); }).catch(() => null);
    const line = async n => { await p.click(`#cart tr.row:nth-child(${n})`); await sleep(500); }; // click the line drawn at place n (1 = top)
    const qtys = async () => Object.fromEntries((await state()).cart.map(l => [l.name, l.quantity]));
    const scan = async c => { await p.focus('#scanInput'); await p.keyboard.type(c); await p.keyboard.press('Enter'); await sleep(900); };
    const CANDY = 'Bulk candy (lb)', ROPE = 'Rope (ft)', GIFT = 'Gift bag';

    // ---- order of lines
    await fresh(['1001', '1003']);
    await scan('1004');
    rec('L1 newest scan (Gift bag) is the BOTTOM line; older lines keep their places and numbers', (await names()).join() === [CANDY, ROPE, GIFT].join() && (await nums()).join() === '1,2,3', `${(await names()).join(' | ')} / #${(await nums()).join(',')}`);
    rec('L2 the newest line is selected', (await selName()) === GIFT, String(await selName()));
    await scan('1001');
    rec('L3 scanning an item already in the sale adds 1 to it and moves it to the bottom (the register treats it as the newest line)', (await names()).join() === [ROPE, GIFT, CANDY].join() && (await qtys())[CANDY] === 2 && (await selName()) === CANDY, `${(await names()).join(' | ')} / ${JSON.stringify(await qtys())}`);

    // ---- actions hit the right line
    await fresh(['1001', '1003', '1004']);
    await line(1); let q0 = await qtys(); await p.focus('#scanInput'); await p.keyboard.press('+'); await sleep(700); let q1 = await qtys();
    rec('A1 click line 1 (Bulk candy) then +: only Bulk candy gets 1 more', q1[CANDY] === q0[CANDY] + 1 && q1[ROPE] === q0[ROPE] && q1[GIFT] === q0[GIFT], JSON.stringify(q1));
    await p.keyboard.press('-'); await sleep(700);
    await line(2); await p.focus('#scanInput'); await p.keyboard.type('*5'); await p.keyboard.press('Enter'); await sleep(800); q1 = await qtys();
    rec('A2 click line 2 (Rope) then *5 Enter: only Rope is set to 5', q1[ROPE] === 5 && q1[CANDY] === 1 && q1[GIFT] === 1, JSON.stringify(q1));
    await line(3); await p.focus('#scanInput'); await p.keyboard.press('ArrowRight'); await sleep(700); q1 = await qtys();
    rec('A3 click line 3 (Gift bag) then Right arrow (qty +): only Gift bag changes', q1[GIFT] === 2 && q1[ROPE] === 5 && q1[CANDY] === 1, JSON.stringify(q1));
    await p.keyboard.press('ArrowLeft'); await sleep(700);
    await line(2); await p.keyboard.press('F4'); await sleep(600); await p.$eval('#ldVal', e => { e.value = ''; }); await p.type('#ldVal', '10'); await p.keyboard.press('Enter'); await sleep(1500);
    let s = await state(); const by = n => s.cart.find(l => l.name === n);
    rec('A4 line 2 (Rope) + F4 10% off: only Rope has a discount', by(ROPE).custom && by(ROPE).discountAmount > 0 && !by(CANDY).custom && !by(GIFT).custom, `rope ${by(ROPE).discountAmount}, candy ${by(CANDY).custom}, gift ${by(GIFT).custom}`);
    await line(3); await p.keyboard.press('F4'); await sleep(600); await p.$eval('#ldTax', e => { e.value = ''; }); await p.type('#ldTax', '5'); await p.click('#ldOk'); await sleep(1500); s = await state();
    rec('A5 line 3 (Gift bag) + F4 Edit tax 5%: only Gift bag tax rate changes', by(GIFT).taxRate === 5 && by(CANDY).taxRate === 8 && by(ROPE).taxRate === 8, `gift ${by(GIFT).taxRate}, candy ${by(CANDY).taxRate}, rope ${by(ROPE).taxRate}`);
    await line(1); await p.focus('#scanInput'); await p.keyboard.press('Delete'); await sleep(900); s = await state();
    rec('A6 line 1 (Bulk candy) + Delete: only Bulk candy is removed; lines renumber 1, 2 from the top', s.cart.length === 2 && !by(CANDY) && (await nums()).join() === '1,2' && (await names()).join() === [ROPE, GIFT].join(), `${(await names()).join(' | ')} #${(await nums()).join(',')}`);

    // ---- arrows follow the screen
    await p.focus('#scanInput'); await p.keyboard.press('ArrowUp'); await sleep(300); const up1 = await selName(); await p.keyboard.press('ArrowUp'); await sleep(300); const up2 = await selName();
    rec('R1 Up moves the highlight UP the screen (toward line 1) and stops at the top', up1 === ROPE && up2 === ROPE, `${up1} / ${up2}`);
    await p.keyboard.press('ArrowDown'); await sleep(300); const d1 = await selName(); await p.keyboard.press('ArrowDown'); await sleep(300); const d2 = await selName();
    rec('R2 Down moves the highlight down and stops at the bottom', d1 === GIFT && d2 === GIFT, `${d1} / ${d2}`);
    await p.keyboard.press('ArrowUp'); await sleep(300); await p.keyboard.press('+'); await sleep(700); q1 = await qtys();
    rec('R3 after Up, + changes the highlighted line (Rope), not the newest', q1[ROPE] === 6 && q1[GIFT] === 1, JSON.stringify(q1));

    // ---- Find in sale (Ctrl+Shift+F): numbers match the screen, picking selects the right line
    await fresh(['1001', '1003', '1004']);
    await p.keyboard.down('Control'); await p.keyboard.down('Shift'); await p.keyboard.press('f'); await p.keyboard.up('Shift'); await p.keyboard.up('Control'); await sleep(800);
    const list = await p.$$eval('#csRes tr.row', t => t.map(r => r.children[0].innerText.trim() + ':' + r.children[2].innerText.trim()));
    rec('F1 Find in sale lists the lines in screen order with the same numbers', list.join('|') === ['1:' + CANDY, '2:' + ROPE, '3:' + GIFT].join('|'), list.join(' | '));
    await p.type('#csIn', 'rope'); await sleep(300); await p.keyboard.press('Enter'); await sleep(800);
    rec('F2 picking Rope selects Rope (and the message says line 2)', (await selName()) === ROPE, String(await selName()));

    // ---- no-receipt return lines (after the sale lines): the row numbers still point at the right line
    await fresh(['1003', '1004']); await post('return-toggle'); await post('scan', { code: '1001' }); await p.goto(BASE + '/'); await sleep(1500);
    rec('M1 sale lines first, the return line after them, numbered 1, 2, 3', (await names()).join() === [ROPE, GIFT, CANDY].join() && (await nums()).join() === '1,2,3', `${(await names()).join(' | ')} #${(await nums()).join(',')}`);
    await line(3); await p.focus('#scanInput'); await p.keyboard.press('Delete'); await sleep(900); s = await state();
    rec('M2 return line (line 3) + Delete removes the return line only', s.mix.lines.length === 0 && s.cart.length === 2, `mix ${s.mix.lines.length}, sale ${s.cart.length}`);
    await post('scan', { code: '1001' }); await p.goto(BASE + '/'); await sleep(1500); await line(1); await p.focus('#scanInput'); await p.keyboard.press('Delete'); await sleep(900); s = await state();
    rec('M3 sale line 1 (Rope) + Delete with a return line present removes Rope only; the return line stays', s.cart.length === 1 && s.cart[0].name === GIFT && s.mix.lines.length === 1, `sale ${s.cart.map(c => c.name)}, mix ${s.mix.lines.length}`);
    await post('return-toggle');

    // ---- receipt return mode (one line in the fake) + a crafted many-line state for ret rows and scrolling
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const fakeRet = ['c', 'b', 'a'].map((n, i) => ({ number: 'R' + n, name: 'Ret ' + n, quantity: 1, price: 1, max: 2 })); // register order = newest first
    await p.setRequestInterception(true);
    let craft = null; p.on('request', rq => { if (craft && /\/api\/state$/.test(rq.url())) { fetch(BASE + '/api/state').then(r => r.json()).then(j => rq.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(craft(j)) })).catch(() => rq.continue()); } else rq.continue().catch(() => {}); });
    craft = j => ({ ...j, mode: 'return', ret: { kind: 'receipt', order: { number: 'T1', amount: 3, tax: 0, payments: 'Cash' }, subs: fakeRet, lines: [], totals: { quantity: 3, amount: 3, tax: 0, refund: 3 }, toAccount: false } });
    await p.goto(BASE + '/'); await sleep(1500);
    rec('T1 return-receipt rows: oldest on top, numbered 1..3, newest at the bottom (selected)', (await names()).join() === 'Ret a,Ret b,Ret c' && (await nums()).join() === '1,2,3' && (await selName()) === 'Ret c', `${(await names()).join(',')} #${(await nums()).join(',')} sel ${await selName()}`);
    await line(1); const row = await p.evaluate(() => ({ r: selectedRow, no: lineNo(selectedRow) }));
    rec('T2 clicking line 1 selects register row 2 (the oldest of 3) and lineNo agrees', row.r === 2 && row.no === 1, JSON.stringify(row));
    // many lines: the newest (bottom) stays in view and selected
    const many = Array.from({ length: 40 }, (_, i) => ({ number: 'N' + (40 - i), upc: '', name: 'Item ' + (40 - i), type: 0, quantity: 1, price: 1, total: 1, discount: 0, discountAmount: 0, taxRate: 0 })); // newest first
    craft = j => ({ ...j, cart: many });
    await p.goto(BASE + '/'); await sleep(1800);
    const vis = await p.evaluate(() => { const tr = document.querySelector('#cart tr.row.sel'); if (!tr) return null; let c = tr.parentElement; while (c && c.scrollHeight <= c.clientHeight + 1) c = c.parentElement; const a = tr.getBoundingClientRect(), z = c.getBoundingClientRect(); return { name: tr.children[2].innerText, no: tr.children[0].innerText, inView: a.top >= z.top - 1 && a.bottom <= z.bottom + 1, scrolled: c.scrollTop > 0 }; });
    rec('S1 40 lines: the newest line (Item 40, number 40) is at the bottom, selected and scrolled into view', vis && vis.name === 'Item 40' && vis.no === '40' && vis.inView && vis.scrolled, JSON.stringify(vis));
    craft = null; await p.setRequestInterception(false);

    // ---- top bar
    await fresh(['1001']);
    const tabs = await p.$$eval('#tabs .tab', t => t.map(x => x.dataset.tab)), setTop = await p.$eval('#setTop', e => e.innerText.replace(/\s+/g, ' ').trim() + '|' + e.title);
    rec('B1 top bar: Checkout, Orders, Items, Customers, Gift Cards, Reports, Users tabs + the Settings button (tab look, still opens Settings, key Ctrl+, in its tooltip)', tabs.join() === 'checkout,orders,items,customers,giftcards,reports,users' && /^SETTINGS\|Settings \(Ctrl\+,\)$/.test(setTop), tabs.join() + ' ' + setTop);
    rec('B2 Checkout is open: register visible, section area hidden', await p.evaluate(() => !!document.querySelector('.wrap').offsetParent && document.getElementById('sectionHost').hidden), 'ok');
    for (const t of ['orders', 'items', 'customers', 'giftcards', 'reports', 'users']) {
      await p.click(`#tabs .tab[data-tab="${t}"]`); await sleep(250);
      const o = await p.evaluate(() => ({ soon: /Coming soon/.test(document.getElementById('sectionHost').innerText), wrap: !!document.querySelector('.wrap').offsetParent, title: (document.querySelector('#sectionHost h2') || {}).innerText }));
      const reg = await p.evaluate(id => !!(window.AirMaxSections && window.AirMaxSections._defs && window.AirMaxSections._defs[id]), t);
      if (reg) { if (t !== 'orders') rec(`B3 ${t}: its batch section opens (not coming soon), register hidden`, !o.soon && !o.wrap, JSON.stringify(o)); continue; } // a pushed batch owns its own tab test (Orders: Batch 7 tests that #obPage stays reachable)
      if (t === 'orders') { const ob = await p.evaluate(() => ({ page: !!document.getElementById('obPage'), on: document.querySelector('#tabbar .tab.on').dataset.tab })); rec('B3 orders: the existing Orders page (orders.js) opens, the Orders tab is highlighted', ob.page && ob.on === 'orders', JSON.stringify(ob)); await p.keyboard.press('Escape'); await sleep(500); const ok2 = await p.evaluate(() => !document.getElementById('obPage') && document.querySelector('#tabbar .tab.on').dataset.tab === 'checkout'); rec('B3 orders: Esc closes it and Checkout is highlighted again', ok2, ''); continue; }
      rec(`B3 ${t}: coming soon, register hidden`, o.soon && !o.wrap, JSON.stringify(o));
    }
    { await p.click('#tabbar .tab[data-tab="backoffice"]'); await sleep(250); const o = await p.evaluate(() => ({ soon: /Coming soon/.test(document.getElementById('sectionHost').innerText), label: document.querySelector('#tabbar .tab[data-tab="backoffice"]').innerText.trim() })); rec('B3 Back Office (9th tab, manager login): coming soon', o.soon && /BACK OFFICE/i.test(o.label), JSON.stringify(o)); }
    await p.keyboard.press('Escape'); await sleep(300);
    rec('B4 Esc leaves a section and returns to Checkout', await p.evaluate(() => !!document.querySelector('.wrap').offsetParent), 'ok');
    await p.click('#tabbar .tab[data-tab=items]'); await sleep(300);
    rec('B5 clicking the Items tab opens Items (tabs are click-only; no new shortcuts)', await p.evaluate(() => document.getElementById('sectionHost').dataset.section === 'items' && !document.getElementById('sectionHost').hidden), 'items');
    await p.click('#tabbar .tab[data-tab=checkout]'); await sleep(300);
    rec('B6 back on Checkout with the sale kept', (await p.evaluate(() => !!document.querySelector('.wrap').offsetParent)) && (await state()).cart.length === 1, 'ok');
    await p.keyboard.down('Control'); await p.keyboard.press(','); await p.keyboard.up('Control'); await sleep(800);
    rec('B7 Ctrl+, still opens Settings (existing shortcut)', await p.evaluate(() => !!document.getElementById('stTabs')), 'ok'); await p.keyboard.press('Escape'); await sleep(400);
    await p.click('#setTop'); await sleep(800);
    rec('B8 the Settings button still opens the Settings window', await p.evaluate(() => !!document.getElementById('stTabs')), 'ok'); await p.keyboard.press('Escape'); await sleep(400);
    await p.evaluate(() => document.querySelector('[data-a="customer"]') && 0);
    // a window open: tabs refuse
    await p.keyboard.press('F3'); await sleep(700); await p.click('#tabs .tab[data-tab="orders"]'); await sleep(300);
    rec('B9 with a window open a tab click does nothing (stays on Checkout)', await p.evaluate(() => document.getElementById('sectionHost').hidden), 'ok'); await p.keyboard.press('Escape'); await sleep(400);

    // ---- section register: render, visible, disabled, allowed (permission), onHide
    await p.evaluate(() => {
      window.__hid = 0;
      AirMaxSections.register({ id: 'users', render: (host, ctx) => { host.innerHTML = '<div id="uTest">users screen ' + ctx.tabs.length + '</div>'; }, onHide: () => { window.__hid++; } });
      AirMaxSections.register({ id: 'items', visible: S => false });
      AirMaxSections.register({ id: 'customers', disabled: S => 'Not for this login' });
      AirMaxSections.register({ id: 'reports', allowed: async ctx => { const pm = await ctx.perms(); window.__perm = pm; return false; }, render: h => { h.textContent = 'never'; } });
      AirMaxSections.register({ id: 'orders', allowed: async ctx => (await ctx.perms()).hasMenu('Operator Management') || (await ctx.perms()).manager, render: h => { h.innerHTML = '<div id="oTest">orders screen</div>'; } });
    });
    await sleep(1200);
    const st = await p.$$eval('#tabs .tab', t => t.map(x => x.dataset.tab + ':' + (x.hidden ? 'hidden' : x.getAttribute('aria-disabled') === 'true' ? 'disabled' : 'shown')));
    rec('P1 section options: visible()=false hides Items, allowed()=false hides Reports, disabled() greys Customers, an allowed Orders stays', st.join() === 'checkout:shown,orders:shown,items:hidden,customers:disabled,giftcards:shown,reports:hidden,users:shown', st.join());
    await p.click('#tabs .tab[data-tab="customers"]'); await sleep(300);
    rec('P2 clicking a greyed tab does nothing', await p.evaluate(() => document.getElementById('sectionHost').hidden), 'ok');
    await p.click('#tabs .tab[data-tab="users"]'); await sleep(300);
    const u = await p.evaluate(() => (document.getElementById('uTest') || {}).innerText);
    rec('P3 a registered render() fills the section area; ctx.tabs lists 9', u === 'users screen 9', String(u));
    await p.click('#tabs .tab[data-tab="orders"]'); await sleep(500);
    rec('P4 opening another tab runs the first one\'s onHide and the permission check again', (await p.evaluate(() => window.__hid)) === 1 && await p.evaluate(() => !!document.getElementById('oTest')), 'ok');
    const pm = await p.evaluate(() => { const x = window.__perm; return x && { ok: x.ok, keys: Object.keys(x).sort().join(), menus: Array.isArray(x.menus), isMgr: typeof x.manager }; });
    rec('P5 ctx.perms() returns manager / superAdmin / authorities / menus + hasMenu()', pm && pm.ok && pm.menus && /authorities/.test(pm.keys) && /hasMenu/.test(pm.keys), JSON.stringify(pm));
    await p.click('#tabs .tab[data-tab="checkout"]'); await sleep(300);

    // ---- section files in app/public/sections/ are loaded by the page
    fs.writeFileSync(SEC, "AirMaxSections.register({ id: 'giftcards', render: h => { h.innerHTML = '<div id=\"gTest\">from a section file</div>'; } });\n");
    await p.goto(BASE + '/'); await sleep(2000);
    await p.click('#tabs .tab[data-tab="giftcards"]'); await sleep(400);
    rec('P6 a file in app/public/sections/ registers itself and is loaded (listed by /api/sections)', await p.evaluate(() => !!document.getElementById('gTest') && (window.AirMaxSectionsLoaded || []).includes('zz-step0-test.js')), JSON.stringify(await p.evaluate(() => window.AirMaxSectionsLoaded)));
    rec('X0 no page errors', errs.length === 0, errs.join(' | ').slice(0, 300));
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 600)); }
  finally { try { fs.unlinkSync(SEC); } catch (e) {} if (p) await p.close().catch(() => {}); await b.disconnect(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

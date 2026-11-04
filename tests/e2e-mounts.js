// AirMax Step 0: named mount slots (app/public/mounts.js), the Back Office tab, the store name at the top left, the section permission check
// reading AIR POS menus and the manager flag. A temporary section file fills every slot; it is deleted at the end.
// The temporary file is named zz-... so it loads AFTER every batch's section file and its test sections replace a real batch's section for the same tab
// (a real Reports/Customers/Users/Items screen would otherwise win and draw its own rows); the checks below do not depend on the test sections' text.
// OFFLINE fake AIR POS only.   FAKE_PORT=5180 node tests/e2e-mounts.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const SEC = path.join(__dirname, '..', 'app', 'public', 'sections', 'zz-step0-mounts-test.js');
fs.writeFileSync(SEC, `(function () {
  const M = window.AirMaxMounts; window.__m = { calls: [], cleaned: [] };
  M.add('checkout.login', { id: 't-login', render(h, c) { h.innerHTML = '<span id="tLogin">login-slot</span>'; window.__m.calls.push(['login', c.where, typeof c.perms, typeof c.api]); return () => window.__m.cleaned.push('login'); } });
  M.add('checkout.lock', { id: 't-lock', render(h) { h.innerHTML = '<span id="tLock">lock-slot</span>'; } });
  M.add('checkout.manager-approval', { id: 't-mgr', render(h, c) { h.innerHTML = '<button id="tMgrBtn">approve-slot</button>'; h.querySelector('button').onclick = () => c.submit({ user: 'slot-user', password: 'x' }); window.__m.calls.push(['mgr', c.title, typeof c.submit, typeof c.close]); } });
  M.add('checkout.tx-actions', { id: 't-tx', label: 'Slot Action', key: 'Ctrl+9', action: 'step0-slot', style: 'red' });
  M.add('checkout.tx-actions', { id: 't-tx-hidden', label: 'Hidden Slot Action', action: 'step0-slot', visible: S => false });
  M.add('reports.shifts.row-actions', { id: 't-sh', render(h, c) { h.innerHTML = '<i class="tSh">fix</i>'; } });
  M.add('customers.account-box', { id: 't-acct', render(h, c) { h.innerHTML = '<i id="tAcct">recharge ' + (c.customer || '') + '</i>'; } });
  A['step0-slot'] = () => { window.__m.slot = (window.__m.slot || 0) + 1; };
  AirMaxSections.register({ id: 'reports', render(h, c) { h.innerHTML = '<div id="tRep">reports <div id="tShifts"></div><div id="tAcctHost"></div></div>'; ['A', 'B'].forEach(r => { const d = document.createElement('div'); h.querySelector('#tShifts').appendChild(d); c.mount('reports.shifts.row-actions', d, { row: r }); }); const a = h.querySelector('#tAcctHost'); c.mount('customers.account-box', a, { customer: 'C1' }); } });
  AirMaxSections.register({ id: 'backoffice', render(h) { h.innerHTML = '<div id="tBO">back office</div>'; } });
  AirMaxSections.register({ id: 'users', allowed: async c => { const p = await c.perms(); window.__m.perm = { manager: p.manager, hasMenu: typeof p.hasMenu, menus: Array.isArray(p.menus) }; return p.manager && p.hasMenu('Operator Management'); }, render(h) { h.innerHTML = '<div id="tUsers">users</div>'; } });
  AirMaxSections.register({ id: 'items', allowed: async c => (await c.perms()).menus.some(m => m.name === 'No Such Menu Entry Zz'), render(h) { h.innerHTML = 'items'; } });
})();`);
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.setCacheEnabled(false);
    // logged out: the sign-in slot
    await post('logout'); await p.goto(BASE + '/'); await sleep(1800);
    const lg = await p.evaluate(() => ({ txt: (document.getElementById('tLogin') || {}).textContent, host: !!document.querySelector('#mountLogin[data-mount="checkout.login"]'), shown: getComputedStyle(document.getElementById('login')).display, calls: window.__m && window.__m.calls }));
    rec('M1 sign-in screen: the checkout.login slot is drawn and filled (where = login, ctx has perms and api)', lg.txt === 'login-slot' && lg.host && lg.shown !== 'none' && JSON.stringify(lg.calls[0]) === '["login","checkout.login","function","function"]', JSON.stringify(lg));
    await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    await p.goto(BASE + '/'); await sleep(2000);
    // top left
    const br = await p.evaluate(() => ({ name: document.getElementById('brandName').textContent, small: document.querySelector('#brand small').textContent.replace(/\s+/g, ' ').trim(), logoBox: !!document.getElementById('brandLogo'), apname: document.querySelector('.apname').textContent, h: document.querySelector('.top').getBoundingClientRect().height }));
    rec('S1 top left: the logged-in company, its shop and "Air Max" (no "AIR pos" mark); the bar is 56px', br.name === 'fake shop' && /^Fake shop · Air Max$/.test(br.small) && br.apname === 'Air Max' && br.logoBox && Math.round(br.h) === 56, JSON.stringify(br));
    // tx actions
    const tx = await p.evaluate(() => ({ btns: [...document.querySelectorAll('#mountTx .rbtn')].map(e => e.textContent), cls: (document.querySelector('#mountTx .rbtn') || {}).className, next: document.getElementById('mountTx').previousElementSibling.querySelector('.rbtn').textContent }));
    rec('X1 checkout.tx-actions: one extra button under Transaction Actions (the hidden one is not drawn), same button style', tx.btns.length === 1 && /^Slot ActionCtrl\+9$/.test(tx.btns[0]) && /rbtn red/.test(tx.cls), JSON.stringify(tx));
    await p.click('#mountTx .rbtn'); await sleep(300);
    rec('X2 clicking the extra button runs the register action A["step0-slot"]', (await p.evaluate(() => window.__m.slot)) === 1, '');
    const gold = await p.evaluate(() => [...document.querySelectorAll('#right .rgrid')][0].querySelectorAll('.rbtn').length);
    rec('X3 the built-in Transaction Actions buttons are untouched (11)', gold === 11, String(gold));
    // lock slot (clock-in)
    await p.evaluate(() => { document.getElementById('modalRoot'); clockInDialog(); }); await sleep(500);
    rec('M2 clock-in / lock screen: the checkout.lock slot is filled', await p.evaluate(() => !!document.querySelector('#modalRoot #mountLock #tLock')), '');
    await p.keyboard.press('Escape'); await sleep(300); await p.evaluate(() => { if (typeof closeModal === 'function') closeModal(); });
    // manager approval pop-up
    await p.evaluate(() => { window.__approved = null; managerLogin('Test approval', 'Slot test', async b => { window.__approved = b.user; return { ok: true, message: 'done' }; }); }); await sleep(500);
    const mg = await p.evaluate(() => ({ btn: !!document.querySelector('#modalRoot #mlMount #tMgrBtn'), call: window.__m.calls.find(c => c[0] === 'mgr') }));
    rec('M3 manager approval pop-up: the slot is inside it with title, submit() and close()', mg.btn && JSON.stringify(mg.call) === '["mgr","Test approval","function","function"]', JSON.stringify(mg));
    await p.click('#tMgrBtn'); await sleep(500);
    rec('M4 ctx.submit(body) runs the pop-up\'s own approval callback and shows its message', (await p.evaluate(() => window.__approved)) === 'slot-user' && /done/.test(await p.$eval('#mlMsg', e => e.textContent)), '');
    await p.evaluate(() => closeModal()); await sleep(300);
    // tabs: reports with row slots + customers account slot + auto reports.fixes
    await p.evaluate(() => document.querySelector('#tabs .tab[data-tab="reports"]').click()); await sleep(700);
    const rp = await p.evaluate(() => { const hosts = [...document.querySelectorAll('[data-mount="reports.shifts.row-actions"]')], acct = [...document.querySelectorAll('[data-mount="customers.account-box"]')];
      return { rowHosts: hosts.length, rowFills: hosts.map(h => h.querySelectorAll('.tSh').length), allRowFills: document.querySelectorAll('.tSh').length, acctHosts: acct.length, acctFills: acct.map(h => h.querySelectorAll('#tAcct').length), auto: !!document.querySelector('#sectionHost [data-mount="reports.fixes"]') }; });
    rec('M5 a section fills slots it draws itself: Reports > Shifts row actions (every row slot filled exactly once) and Customers account box via ctx.mount', rp.rowHosts >= 2 && rp.rowFills.every(n => n === 1) && rp.allRowFills === rp.rowHosts && rp.acctHosts === 1 && rp.acctFills.join() === '1', JSON.stringify(rp));
    rec('M6 the Reports screen gets an empty reports.fixes slot at the end when it did not draw one', rp.auto, '');
    await p.evaluate(() => AirMaxMounts.add('reports.fixes', { id: 't-fix', render(h) { h.innerHTML = '<b id="tFix">fix-buttons</b>'; } })); await sleep(300);
    rec('M7 a slot added later is drawn into a screen that is already open', !!(await p.$('#tFix')), '');
    rec('M8 bad names / a second slot with the same id are refused', await p.evaluate(() => !AirMaxMounts.add('Bad Name', { render() {} }) && !AirMaxMounts.add('reports.fixes', { id: 't-fix', render() {} })), '');
    // Back office tab, permission check
    const bo = await p.evaluate(() => { const t = document.querySelector('#tabbar .tab[data-tab="backoffice"]'); return { shown: !!t && !t.hidden, txt: t && t.textContent.trim() }; });
    rec('B1 Back Office is a 9th tab, drawn once a section registers it', bo.shown && /Back Office/.test(bo.txt), JSON.stringify(bo));
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="backoffice"]').click()); await sleep(500);
    rec('B2 the Back Office tab opens its section', !!(await p.$('#tBO')), '');
    const perm = await p.evaluate(() => ({ perm: window.__m.perm, users: (document.querySelector('#tabbar .tab[data-tab="users"]') || {}).hidden, items: (document.querySelector('#tabbar .tab[data-tab="items"]') || {}).hidden }));
    rec('P1 allowed(ctx) sees the manager flag and menus (ctx.perms(): manager, menus[], hasMenu())', perm.perm && perm.perm.manager === true && perm.perm.hasMenu === 'function' && perm.perm.menus === true, JSON.stringify(perm.perm));
    rec('P2 a section whose check fails (menu entry not there) is removed from the bar, not greyed', perm.items === true, JSON.stringify(perm));
    rec('P3 the manager + super admin fake login passes a manager/menu check (Users stays)', perm.users === false, JSON.stringify(perm));
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="checkout"]').click()); await sleep(400);
    await p.evaluate(() => { const e = document.querySelector('.top'); return e; });
    // leaving the screen runs cleanup
    await post('logout'); await p.reload(); await sleep(1500);
    rec('X0 no page errors', !errs.length, errs.join(' | ').slice(0, 200) || 'none');
  } catch (e) { rec('X1 run finished', false, String(e && e.stack || e).slice(0, 300)); }
  finally { try { fs.unlinkSync(SEC); } catch {} try { await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' }); await post('new-sale'); } catch {} if (p) await p.close().catch(() => {}); await b.disconnect(); }
  console.log(`${fails.length ? 'FAILED' : 'ALL PASSED'}: ${fails.length} failed${fails.length ? ': ' + fails.join('; ') : ''}`); process.exit(fails.length ? 1 : 0);
})();

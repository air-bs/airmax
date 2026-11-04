// Orders tab phase 1 (PLAN-orders-tab.md): the ORDERS tab and page on the real screen against the OFFLINE fake AIR POS started with
// FAKE_ORDERS=1 (130 made-up orders, fake names / 555 numbers). VIEW AND SEARCH ONLY: checks every filter sent to AIR POS, what the
// page shows for it, the "AIR POS did not apply a filter" warning, errors, that the sale is untouched, that only RetailOrderPaged is
// ever called, that no existing button / label / key changed, and the layout at 1024x768, 1280x800 and 1366x768.
// Run (runner): FENV=FAKE_ORDERS=1 start $FP; FAKE_PORT=$FP node tests/e2e-orders-tab.js   (Chrome at CHROME_URL)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5190), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.json());
const pad = n => String(n).padStart(2, '0'), ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOff = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const BLUE = 'rgb(20, 108, 255)';
// Step 0 top bar: 9 real tabs in #tabbar (Checkout, Orders, Items, Customers, Gift Cards, Reports, Users, Settings, Back Office). The old RETAIL SALES (.apnav) /
// ORDERS (#obTab) pair still exists in the page but is hidden (#legacyNav / .obtab), so the tests drive and measure the Checkout and Orders tabs of the new bar.
const TAB_O = '#tabbar .tab[data-tab="orders"]', TAB_C = '#tabbar .tab[data-tab="checkout"]';
const LOGIN = { company: 'fake shop', user: 'tester', password: 'fake-pw' }; // the fake accepts any non-empty password (made up)

(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    const seed = await hook('/orders-seed').catch(() => []);
    if (!Array.isArray(seed) || seed.length !== 130) { rec('Fake AIR POS runs with FAKE_ORDERS=1 (130 made-up orders)', false, 'seed ' + (seed && seed.length)); throw new Error('start the fake with FAKE_ORDERS=1'); }
    if (!(await state()).loggedIn) await post('login', LOGIN);
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await hook('/orders-ignore?keys='); await hook('/orders-filters?reset=1');
    const today = dayOff(0), yesterday = dayOff(-1);

    // ---- 0. the tab only ADDS: same buttons, labels and keys with and without orders.js
    const labels = pg => pg.evaluate(() => ({
      top: [...document.querySelector('.top').children].filter(e => e.id !== 'obTab').map(e => { const c = e.cloneNode(true); c.querySelectorAll('#obTab').forEach(x => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); }), // the legacy ORDERS button (hidden now) is what orders.js adds; the tab bar itself must be the same with and without it
      buttons: [...document.querySelectorAll('#actions [data-a], #right [data-a], #tiles [data-a]')].map(e => e.dataset.a + '=' + e.textContent.replace(/\s+/g, ' ').trim()),
      keys: (typeof keys !== 'undefined' ? keys : []).map(k => k.key + '=' + k.action + '=' + k.label) }));
    const p0 = await b.newPage(); await p0.setRequestInterception(true);
    p0.on('request', r => (r.url().endsWith('/orders.js') ? r.abort() : r.continue()));
    await p0.goto(BASE + '/'); await sleep(1500);
    const without = await labels(p0), noTab = await p0.$('#obTab'); await p0.close();
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
    await p.bringToFront(); await p.goto(BASE + '/'); await sleep(1500);
    const withTab = await labels(p);
    rec('Without orders.js there is no ORDERS tab (the tab is all phase 1 adds to the screen)', !noTab, '');
    rec('Every existing top-bar item, button label and key is identical with the Orders tab loaded', JSON.stringify(without) === JSON.stringify(withTab) && without.buttons.length > 30 && without.keys.length > 60,
      `${without.top.length} top-bar items, ${without.buttons.length} buttons, ${without.keys.length} keys; top: ${withTab.top.join(' | ')}`);

    // ---- 1. top bar: Checkout (was RETAIL SALES) unchanged, Orders right after it
    const tabs = () => p.evaluate(() => { const s = document.querySelector('#tabbar .tab[data-tab="checkout"]'), t = document.querySelector('#tabbar .tab[data-tab="orders"]'), cs = e => getComputedStyle(e);
      return { sales: s.querySelector('.tl').textContent, next: s.nextElementSibling && s.nextElementSibling.dataset.tab, tab: t && t.querySelector('.tl').textContent, salesLine: cs(s).borderBottomColor, salesW: cs(s).borderBottomWidth, tabLine: cs(t).borderBottomColor,
        salesOn: s.classList.contains('on') && s.getAttribute('aria-current') === 'page', tabOn: t.classList.contains('on') && t.getAttribute('aria-current') === 'page',
        on: document.body.classList.contains('ob-on'), open: !!document.getElementById('obPage') }; });
    let tb = await tabs();
    rec('Top bar: "Checkout" (the old RETAIL SALES tab) first, "Orders" right next to it', tb.sales === 'Checkout' && tb.next === 'orders' && tb.tab === 'Orders', JSON.stringify(tb));
    rec('On the sale screen Checkout is the underlined (active) tab', tb.salesLine === BLUE && tb.salesOn && tb.tabLine !== BLUE && !tb.tabOn && !tb.on, `sales ${tb.salesLine}, orders ${tb.tabLine}`);

    // a sale in progress (kept the whole time; checked at the end)
    const scan = async c => { await p.focus('#scanInput'); await p.keyboard.type(c); await p.keyboard.press('Enter'); await sleep(800); };
    await scan('1001'); await scan('1003');
    const sale0 = await state(), cart0 = JSON.stringify(sale0.cart.map(l => [l.number, l.quantity, l.price])), calls0 = (await hook('/all-calls')).length;

    // ---- 2. open the page
    const view = () => p.evaluate(() => {
      const pg = document.getElementById('obPage'); if (!pg) return { open: false };
      const g = id => document.getElementById(id), rows = [...pg.querySelectorAll('#obRows tr[data-id]')].map(tr => [...tr.children].map(td => td.innerText.trim()));
      return { open: true, count: g('obCount').innerText, pg: g('obPg').innerText, rows, numbers: rows.map(r => r[0]), msg: g('obMsg').innerText, warn: g('obWarn').hidden ? '' : g('obWarn').innerText,
        prev: g('obPrev').disabled, next: g('obNext').disabled, from: g('obFrom').value, to: g('obTo').value, empty: (pg.querySelector('#obRows td.empty') || {}).innerText || '', focus: document.activeElement && document.activeElement.id };
    });
    // settled = the page is there and its search is done (count or message shown); open:false = settled when the page is gone
    const settle = (open = true) => p.waitForFunction(o => { const c = document.getElementById('obCount'), m = document.getElementById('obMsg'); if (!c) return !o; return !/^Searching/.test(c.innerText) && !!(c.innerText || (m && m.innerText)); }, { timeout: 12000 }, open).catch(() => {});
    const go = async (fn, open = true) => { const n0 = (await hook('/orders-filters')).length; await fn(); await sleep(60); await settle(open); await sleep(120); const l = await hook('/orders-filters');
      return { sent: l.length > n0 ? l[l.length - 1] : null, n: l.length - n0, v: await view(), last: await hook('/orders-last') }; };
    const same = (v, last) => !!last && JSON.stringify(v.numbers) === JSON.stringify(last.numbers);
    const setVal = (sel, v) => p.$eval(sel, (e, x) => { e.value = x; }, v);
    const tick = async (cls, code) => { await p.click(`#obPage input.${cls}[value="${code}"]`); await sleep(50); };
    const search = () => go(() => p.click('#obGo'));

    // a double tap on the first open: the 2nd tap lands while the 1st is still loading the options (two clicks in the same moment)
    let r = await go(() => p.evaluate(sel => { const t = document.querySelector(sel); t.click(); t.click(); }, TAB_O));
    await sleep(400); const n2 = (await hook('/orders-filters')).length;
    rec('A double tap on ORDERS opens one page and asks AIR POS once', r.n === 1 && n2 === 1 && await p.evaluate(() => document.querySelectorAll('#obPage').length === 1 && document.getElementById('modalRoot').children.length === 1), `${n2} search(es)`);
    tb = await tabs();
    const geo = await p.evaluate(() => { const o = document.getElementById('ov').getBoundingClientRect(), t = document.querySelector('.top').getBoundingClientRect(), s = document.querySelector('.status').getBoundingClientRect(), c = document.querySelector('#tabbar .tab[data-tab="checkout"]'), a = c.getBoundingClientRect();
      const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2); return { top: Math.round(o.top), topBar: Math.round(t.bottom), bottom: Math.round(o.bottom), status: Math.round(s.top), salesHit: !!hit && (hit === c || c.contains(hit)) }; });
    rec('Orders opens a full page under the top bar; the top bar (Checkout tab tappable) and the status bar stay visible', r.v.open && Math.abs(geo.top - geo.topBar) <= 1 && Math.abs(geo.bottom - geo.status) <= 1 && geo.salesHit, JSON.stringify(geo));
    rec('Orders is now the underlined tab; Checkout is not', tb.on && tb.tabOn && tb.tabLine === BLUE && tb.salesLine !== BLUE && !tb.salesOn, `orders ${tb.tabLine}, sales ${tb.salesLine}`);
    rec('Opens on today (From = To = today), Order # box has the focus', r.v.from === today && r.v.to === today && r.v.focus === 'obNum', `${r.v.from} – ${r.v.to}, focus ${r.v.focus}`);
    rec('Today: 55 orders, page 1 of 2 with 50 rows, exactly the orders AIR POS sent (newest first)', /^55 orders · showing 1–50$/.test(r.v.count) && r.v.pg === 'Page 1 of 2' && r.v.rows.length === 50 && same(r.v, r.last) && r.v.prev && !r.v.next && !r.v.warn,
      `${r.v.count} | ${r.v.pg} | first ${r.v.numbers[0]}`);
    const F0 = { number: '', productNumber: '', memberNumber: '', status: null, operatorName: null, paymentType: null, beginDate: today + 'T00:00:00', endDate: today + 'T23:59:59' };
    rec('Filter sent to AIR POS = the known store shape (same keys, same order) + today\'s dates; 50 per page', r.n === 1 && JSON.stringify(r.sent.filter) === JSON.stringify(F0) && JSON.stringify(r.sent.pageInfo) === '{"page":1,"pageSize":50,"amount":0}', JSON.stringify(r.sent));
    const row0 = seed.find(o => o.number === r.v.numbers[0]) || {};
    rec('A row shows number, time, status, paid by, customer (+ #), operator, items, total (amount + tax) and remark', r.v.rows[0][0] === row0.number && r.v.rows[0][2] === row0.statusName && r.v.rows[0][3] === row0.paymentTypeName
      && r.v.rows[0][4].includes(row0.retailMemberName || '') && r.v.rows[0][5] === row0.operatorName && r.v.rows[0][7] === '$' + (row0.amount + row0.tax).toFixed(2), r.v.rows[0].join(' | '));
    await sleep(300);
    const keysShown = await p.evaluate(() => [...document.querySelectorAll('#obPage button')].filter(x => x.getClientRects().length).map(x => [x.textContent.replace(/\s+/g, ' ').trim(), !!x.querySelector('kbd')]));
    rec('Every button on the page shows its key (Esc, Enter, PgUp / PgDn, Alt+letter)', keysShown.length >= 10 && keysShown.every(k => k[1]), keysShown.map(k => k[0]).join(' | '));
    await p.screenshot({ path: SCR + 'orders-today-1366.png' });

    // ---- 3. paging
    r = await go(() => p.keyboard.press('PageDown'));
    rec('PgDn = next page: page 2 of 2, the last 5 orders, same filter with page 2', r.v.pg === 'Page 2 of 2' && r.v.rows.length === 5 && /showing 51–55/.test(r.v.count) && !r.v.prev && r.v.next && same(r.v, r.last)
      && JSON.stringify(r.sent.filter) === JSON.stringify(F0) && r.sent.pageInfo.page === 2, `${r.v.pg} | ${r.v.count}`);
    r = await go(() => p.click('#obPrev'));
    rec('Previous = back to page 1', r.v.pg === 'Page 1 of 2' && r.v.rows.length === 50 && r.sent.pageInfo.page === 1, r.v.pg);

    // ---- 4. each filter
    r = await go(async () => { await p.click('#obNum', { clickCount: 3 }); await p.keyboard.type('RO2012'); await p.keyboard.press('Enter'); });
    rec('Order #: Enter searches; only matching orders', r.sent.filter.number === 'RO2012' && r.v.rows.length === 10 && r.v.numbers.every(n => n.includes('RO2012')) && same(r.v, r.last), `${r.v.count}: ${r.v.numbers.join(' ')}`);
    await setVal('#obNum', '');
    r = await go(() => p.click('#obPage .obq[data-q="any"]'));
    rec('"Any date": no dates sent, all 130 orders in 3 pages', r.v.from === '' && r.v.to === '' && r.sent.filter.beginDate === null && r.sent.filter.endDate === null && /^130 orders/.test(r.v.count) && r.v.pg === 'Page 1 of 3', `${r.v.count} | ${r.v.pg}`);
    await tick('obst', -5); await tick('obst', -10); r = await search();
    rec('Status Void + Canceled: sent as the list statuses [-5, -10] (status null); only those rows', r.sent.filter.status === null && JSON.stringify(r.sent.filter.statuses) === '[-5,-10]' && r.v.rows.length > 0 && r.v.rows.every(x => x[2] === 'Void' || x[2] === 'Canceled') && same(r.v, r.last) && !r.v.warn,
      `${r.v.count}; statuses shown: ${[...new Set(r.v.rows.map(x => x[2]))].join(', ')}`);
    await tick('obst', -10); r = await search();
    rec('One status (Void): sent as status -5 and statuses [-5]', r.sent.filter.status === -5 && JSON.stringify(r.sent.filter.statuses) === '[-5]' && r.v.rows.every(x => x[2] === 'Void') && same(r.v, r.last), r.v.count);
    await tick('obst', -5);
    await tick('obpt', 10); r = await search();
    rec('Paid by Cash: sent as paymentType 10 and paymentTypes [10]; only cash orders', r.sent.filter.paymentType === 10 && JSON.stringify(r.sent.filter.paymentTypes) === '[10]' && r.v.rows.length > 0 && r.v.rows.every(x => x[3] === 'Cash') && same(r.v, r.last), r.v.count);
    await tick('obpt', 10);
    r = await go(async () => { await p.click('#obCust'); await p.keyboard.type('(555) 987-6543'); await p.keyboard.press('Enter'); });
    rec('Customer typed as a phone "(555) 987-6543" is sent as customer # 5559876543 (memberNumber); only that customer', r.sent.filter.memberNumber === '5559876543' && r.v.rows.length > 0 && r.v.rows.every(x => /Dana Sample/.test(x[4]) && /5559876543/.test(x[4])) && same(r.v, r.last), r.v.count);
    await setVal('#obCust', '');
    r = await go(async () => { await p.click('#obOp'); await p.keyboard.type('dana'); await p.keyboard.press('Enter'); });
    rec('Operator: sent as operatorName; only that operator\'s orders', r.sent.filter.operatorName === 'dana' && r.v.rows.length > 0 && r.v.rows.every(x => x[5] === 'Dana Ops') && same(r.v, r.last), r.v.count);
    await setVal('#obOp', '');
    r = await go(async () => { await p.click('#obProd'); await p.keyboard.type('1004'); await p.keyboard.press('Enter'); });
    const with1004 = seed.filter(o => o.products.includes('1004')).length;
    rec('Product #: sent as productNumber; AIR POS\'s answer shown (orders with item 1004)', r.sent.filter.productNumber === '1004' && new RegExp('^' + with1004 + ' orders').test(r.v.count) && same(r.v, r.last), `${r.v.count} (fake has ${with1004})`);
    await setVal('#obProd', '');
    r = await go(async () => { await p.click('#obRem'); await p.keyboard.type('gift'); await p.keyboard.press('Enter'); });
    rec('Remark: sent as remark only when typed; matching orders shown', r.sent.filter.bak === 'gift' && r.v.rows.length > 0 && r.v.rows.every(x => /gift/i.test(x[8])) && same(r.v, r.last), r.v.count);
    await setVal('#obRem', '');
    r = await search();
    rec('Unused list / remark filters are not sent at all', !('statuses' in r.sent.filter) && !('paymentTypes' in r.sent.filter) && !('bak' in r.sent.filter), Object.keys(r.sent.filter).join(','));
    r = await go(() => p.click('#obPage .obq[data-q="yesterday"]'));
    rec('"Yesterday": From = To = yesterday; only yesterday\'s 20 orders', r.v.from === yesterday && r.v.to === yesterday && r.sent.filter.beginDate === yesterday + 'T00:00:00' && r.sent.filter.endDate === yesterday + 'T23:59:59' && /^20 orders/.test(r.v.count), r.v.count);
    r = await go(() => p.click('#obPage .obq[data-q="d30"]'));
    rec('"Past 30 days": the 120 orders of the last 30 days (not the 40-day-old ones)', r.v.from === dayOff(-29) && r.v.to === today && /^120 orders/.test(r.v.count), `${r.v.from} – ${r.v.to}: ${r.v.count}`);
    await tick('obst', 20); await tick('obpt', 10); r = await search();
    rec('Filters combine: Completed + Cash + past 30 days', r.sent.filter.status === 20 && r.sent.filter.paymentType === 10 && r.sent.filter.beginDate === dayOff(-29) + 'T00:00:00' && r.v.rows.length > 0 && r.v.rows.every(x => x[2] === 'Completed' && x[3] === 'Cash') && same(r.v, r.last), r.v.count);
    await p.screenshot({ path: SCR + 'orders-filtered-1366.png' });
    await tick('obst', 20); await tick('obpt', 10);

    // ---- 5. refusals, warnings, errors
    await setVal('#obFrom', today); await setVal('#obTo', yesterday); r = await search();
    rec('From after To: clear message, AIR POS is not asked', r.n === 0 && /From date is after the To date/.test(r.v.msg) && r.v.empty === 'Not loaded', r.v.msg);
    await hook('/orders-ignore?keys=statuses');
    await setVal('#obFrom', ''); await setVal('#obTo', ''); await tick('obst', -5); await tick('obst', -10); r = await search();
    rec('AIR POS ignoring the status list: the page says the list is NOT filtered by Status', /do not match: Status/.test(r.v.warn) && /NOT filtered/.test(r.v.warn) && /^130 orders/.test(r.v.count), r.v.warn);
    await p.screenshot({ path: SCR + 'orders-warning-1366.png' });
    await tick('obst', -10); r = await search();
    rec('...one status still works there (sent as status too): no warning', !r.v.warn && r.v.rows.every(x => x[2] === 'Void'), r.v.count);
    await tick('obst', -5);
    await hook('/orders-ignore?keys=beginDate,endDate'); r = await go(() => p.click('#obPage .obq[data-q="yesterday"]'));
    rec('AIR POS ignoring the dates: the page says so (Dates)', /do not match: Dates/.test(r.v.warn), r.v.warn);
    await hook('/orders-ignore?keys=');
    await hook('/orders-fail?n=1&mode=down'); r = await search();
    rec('AIR POS not answering: clear message, nothing shown as if loaded, page stays open', r.v.open && /AIR POS did not send the orders \((Network error: ECONNREFUSED|Can't reach AIR POS \(ECONNREFUSED\))\)/.test(r.v.msg) && r.v.empty === 'Not loaded' && r.v.pg === '', r.v.msg);
    r = await search();
    rec('Search again works after the error', !r.v.msg && /^20 orders/.test(r.v.count), r.v.count);

    // ---- 6. the sale keys wait while the page is open; Esc goes back; the sale is untouched
    await p.focus('#obNum'); await p.keyboard.press('F12'); await sleep(700); const s12 = await state();
    await p.keyboard.down('Control'); await p.keyboard.press('KeyL'); await p.keyboard.up('Control'); await sleep(700);
    await p.keyboard.press('F3'); await sleep(500);
    const still = await view(), modalKids = await p.evaluate(() => document.getElementById('modalRoot').children.length);
    rec('While the page is open F12 (payment), Ctrl+L (History) and F3 (Customer) do nothing, like in any window', still.open && !s12.pay && modalKids === 1, `open ${still.open}, pay ${!!s12.pay}`);
    const callsAll = await hook('/all-calls'), added = callsAll.slice(calls0);
    rec('Read-only: the only AIR POS call the Orders tab made is RetailOrderPaged', added.length > 20 && added.every(c => c === '/Orders/RetailOrderPaged'), `${added.length} calls: ${[...new Set(added)].join(', ')}`);
    await p.keyboard.press('Escape'); await sleep(600); tb = await tabs();
    const sale1 = await state(), cart1 = JSON.stringify(sale1.cart.map(l => [l.number, l.quantity, l.price]));
    rec('Esc = back to the sale: page closed, Checkout underlined again, scan box has the focus', !tb.open && !tb.on && tb.salesLine === BLUE && tb.salesOn && await p.evaluate(() => document.activeElement && document.activeElement.id) === 'scanInput', JSON.stringify(tb));
    rec('The sale is exactly as it was (same lines, same total), no payment started', cart1 === cart0 && sale1.totals.due === sale0.totals.due && !sale1.pay && sale1.cart.length === 2, `${cart1} due ${sale1.totals.due}`);
    r = await go(() => p.click(TAB_O));
    rec('Opening again keeps the last search (Yesterday) and reloads it', r.v.from === yesterday && /^20 orders/.test(r.v.count), `${r.v.from}: ${r.v.count}`);
    await p.click(TAB_C); await sleep(500); tb = await tabs();
    rec('Tapping Checkout goes back to the sale too', !tb.open && !tb.on && tb.salesOn, '');

    // ---- 7. a started payment stays on screen
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    const covered = await p.evaluate(sel => { const o = document.querySelector(sel), t = o.getBoundingClientRect(), h = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2); return !!document.getElementById('payBody') && !(h && (h === o || o.contains(h))); }, TAB_O);
    rec('During a payment the Orders tab is covered (cannot be tapped)', covered, '');
    await p.keyboard.press('Escape'); await sleep(900);
    const guard = await p.evaluate(sel => { const keep = S; S = { ...S, pay: { paid: 1, remaining: 1 } }; document.querySelector(sel).click(); const msg = document.getElementById('toast').innerText, opened = !!document.getElementById('obPage'); S = keep; return { msg, opened }; }, TAB_O);
    rec('A paid-but-not-finished sale (payment kept): Orders refuses with "Finish the payment first"', !guard.opened && /Finish the payment first/.test(guard.msg), guard.msg);

    // ---- 8. layout (typical bar, and the widest one: long shop name, clocked in, update ready; the shop name may get "…")
    const bar = (worst) => p.evaluate(worst => {
      if (worst) { document.getElementById('subtitle').textContent = 'Business Test Company · Main Street Store'; document.getElementById('sessPill').textContent = 'Clocked in RSS001488'; document.getElementById('buildPill').textContent = 'v1.0.11 · update 1.0.12 ready'; window.dispatchEvent(new Event('resize')); }
      const items = [...document.querySelector('.top').children].filter(e => e.getClientRects().length), r = e => e.getBoundingClientRect();
      return { off: items.filter(e => r(e).left < -0.5 || r(e).right > innerWidth + 0.5).map(e => e.id || e.className), // Step 0 bar: the status pills shrink with "…" so all 9 tabs fit (CSS .top > .pill), and the shop name may get "…"; the 9 tab labels may never be cut or pushed off the screen
        clip: items.filter(e => e.scrollWidth > e.clientWidth + 1 && e.id !== 'subtitle' && !e.classList.contains('pill')).map(e => e.id || e.className)
          .concat([...document.querySelectorAll('#tabbar .tab:not([hidden]), #setTop')].filter(t => { const q = r(t), l = t.querySelector('.tl'); return q.left < -0.5 || q.right > innerWidth + 0.5 || (l && l.scrollWidth > l.clientWidth + 1); }).map(t => 'tab:' + (t.dataset.tab || t.id))),
        set: r(document.getElementById('setTop')).right <= innerWidth + 0.5, retail: !!document.querySelector('#tabbar .tab[data-tab="checkout"]').getClientRects().length, orders: !!document.querySelector('#tabbar .tab[data-tab="orders"]').getClientRects().length };
    }, worst);
    const fits = x => !x.off.length && !x.clip.length && x.set && x.orders;
    const txt = x => `off ${x.off.join() || '-'}, clipped ${x.clip.join() || '-'}, Settings in view ${x.set}, Checkout ${x.retail ? 'shown' : 'hidden'}`;
    for (const [w, h] of [[1024, 768], [1280, 800], [1366, 768]]) {
      await p.setViewport({ width: w, height: h }); await sleep(500);
      const sale = await bar(false);
      await p.screenshot({ path: SCR + `orders-topbar-${w}.png`, clip: { x: 0, y: 0, width: w, height: 60 } });
      const saleW = await bar(true); await p.evaluate(() => refresh()); await sleep(300);
      rec(`${w}x${h} sale screen: the top bar fits with the Orders tab, also at its widest (Settings in view, no tab cut off; status pills may show "…")`, fits(sale) && fits(saleW) && sale.retail, `typical: ${txt(sale)} | widest: ${txt(saleW)}`);
      await go(() => p.click(TAB_O));
      const ord = await bar(false);
      const L = await p.evaluate(() => { const r = e => e.getBoundingClientRect(), pg = document.getElementById('obPage'), pr = r(pg), tbl = r(pg.querySelector('.obtable')), frm = document.getElementById('obForm');
        const btns = [...pg.querySelectorAll('button, input')].filter(e => e.getClientRects().length).filter(e => { const q = r(e); return q.left < pr.left - 0.5 || q.right > pr.right + 0.5 || q.bottom > pr.bottom + 0.5; }).map(e => e.id || e.className || e.value);
        return { inView: pr.left >= 0 && pr.right <= innerWidth + 0.5 && pr.bottom <= innerHeight + 0.5, hscroll: pg.scrollWidth > pg.clientWidth + 1 || frm.scrollWidth > frm.clientWidth + 1, tableH: Math.round(tbl.height), outside: btns }; });
      await p.screenshot({ path: SCR + `orders-page-${w}.png` });
      const ordW = await bar(true);
      rec(`${w}x${h} Orders page: Checkout + Orders tabs in the bar (all tabs shown at every width), Settings in view; the page fits with room for the list`,
        fits(ord) && ord.retail && fits(ordW) && L.inView && !L.hscroll && !L.outside.length && L.tableH >= 150,
        `typical: ${txt(ord)} | widest: ${txt(ordW)} | page in view ${L.inView}, h-scroll ${L.hscroll}, list ${L.tableH}px, outside ${L.outside.join() || '-'}`);
      await p.keyboard.press('Escape'); await sleep(300); await p.evaluate(() => refresh()); await sleep(300);
    }

    // ---- 9. logout closes the page; another user starts from the defaults
    await go(() => p.click(TAB_O)); await p.click('#obNum', { clickCount: 3 }); await p.keyboard.type('RO2012'); await p.keyboard.press('Enter'); await settle();
    await post('logout'); r = await go(() => p.click('#obGo'), false);
    const lg = await p.evaluate(() => ({ login: getComputedStyle(document.getElementById('login')).display !== 'none', open: !!document.getElementById('obPage'), on: document.body.classList.contains('ob-on') }));
    rec('Logged out (e.g. session ended): the next search shows the login screen and closes the Orders page', lg.login && !lg.open && !lg.on, JSON.stringify(lg));
    await p.$eval('#lgCompany', e => { e.value = 'fake shop'; }); await p.$eval('#lgUser', e => { e.value = 'cashier2'; }); await p.$eval('#lgPw', e => { e.value = 'fake-pw'; });
    await p.click('#lgBtn'); await sleep(1800);
    r = await go(() => p.click(TAB_O));
    rec('Another user logs in: the Orders tab starts again from today with empty filters', r.v.open && r.v.from === today && (await p.$eval('#obNum', e => e.value)) === '' && /^55 orders/.test(r.v.count), `${r.v.from} ${r.v.count}`);
    await p.keyboard.press('Escape'); await sleep(300);
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
  } catch (e) { rec('test run', false, e.message); }
  finally {
    try { await post('logout'); await post('login', LOGIN); await post('pay-close'); await post('new-sale'); await hook('/orders-ignore?keys='); } catch {}
    if (p) await p.close().catch(() => {});
    b.disconnect();
  }
  fs.writeFileSync(path.join(__dirname, 'e2e-orders-tab-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

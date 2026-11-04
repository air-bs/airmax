// Air Register 1.2.0: full-screen tabbed Settings page + Buttons tab (show / hide on-screen buttons), OFFLINE fake AIR POS.
// Needs Chrome with --remote-debugging-port=9333 and two fresh fake servers:
//   FAKE_PORT=5068 node tests/fake-server.js &   FAKE_PORT=5070 FAKE_CASHIER=1 node tests/fake-server.js &
//   FAKE_PORT=5068 CASHIER_PORT=5070 node tests/e2e-settings.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5068), CP = Number(process.env.CASHIER_PORT || 5070);
const BASE = 'http://127.0.0.1:' + FP, CBASE = 'http://127.0.0.1:' + CP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (base, r, x) => fetch(base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = base => fetch(base + '/api/state').then(r => r.json());
async function login(base, user) { const s = await state(base); if (!s.loggedIn) await post(base, 'login', { company: 'fake shop', user, password: '<redacted>' }); await post(base, 'pay-close'); await post(base, 'new-sale'); await post(base, 'dismiss'); }
const combo = async (pg, k, mods = []) => { for (const m of mods) await pg.keyboard.down(m); await pg.keyboard.press(k); for (const m of mods.slice().reverse()) await pg.keyboard.up(m); };
// what the page shows right now
const view = pg => pg.evaluate(() => {
  const vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const md = document.querySelector('#modalRoot .modal');
  return { open: !!md, page: !!(md && md.classList.contains('stpage')), title: (document.querySelector('.sthead h1') || {}).textContent || '',
    tabs: [...document.querySelectorAll('#stTabs [data-tab]')].map(b => ({ k: b.dataset.tab, t: b.childNodes[0].textContent.trim(), key: (b.querySelector('kbd') || {}).textContent || '', on: b.classList.contains('on') })),
    ids: ['seDW', 'seOk', 'seTP', 'seTD', 'seDiag', 'seRT', 'rtOk', 'tkK', 'tkCD', 'tkF', 'tkR', 'tkOk', 'seSides', 'stPanels', 'stZv', 'blQ', 'blOk', 'btAll', 'rhBtns', 'seLog'].filter(id => vis(document.getElementById(id))),
    notes: [...document.querySelectorAll('#modalRoot p.note')].filter(vis).map(n => n.textContent.trim()).filter(t => t && !/No printers found|No bulk items yet|RustDesk/.test(t)),
    okMsgs: [...document.querySelectorAll('#modalRoot .msg.ok')].filter(vis).map(n => n.textContent), flash: (document.getElementById('stFlash') || {}).textContent || '' };
});
(async () => {
  const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 800 } });
  let failure = null; // an exception thrown mid-run must fail the run (process.exit in finally used to swallow it and exit 0 on a truncated run)
  try {
    await login(BASE, 'tester');
    const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(BASE + '/'); await sleep(1500);
    await pg.evaluate(() => { localStorage.removeItem('airreg.hiddenButtons'); localStorage.removeItem('airreg.buttonLayout'); }); await pg.reload(); await sleep(1500);
    // ---- the page ----
    await combo(pg, ',', ['Control']); await sleep(1500);
    let v = await view(pg);
    const keys = v.tabs.map(t => t.key);
    rec('Ctrl+, opens ONE full-screen page titled "Settings" with tabs across the top', v.page && v.title === 'Settings' && v.tabs.length === 9 /* + Labels (Print Label build) + Cards (1.0.9 Sola card on file switch, off by default) */, `page ${v.page}, title "${v.title}", tabs ${v.tabs.map(t => t.t).join(' | ')}`);
    rec('Tabs: Printer & Drawer, Returns, Screen, Touch, Bulk items, Buttons, Remote help, Labels, Cards (the Sola card-on-file switch, local.10 combine)', JSON.stringify(v.tabs.map(t => t.k)) === '["printer","returns","screen","touch","bulk","buttons","remote","labels","cards"]', v.tabs.map(t => t.k).join(','));
    rec('Each tab shows its own shortcut (Ctrl+1..Ctrl+9), all different', keys.join() === 'Ctrl+1,Ctrl+2,Ctrl+3,Ctrl+4,Ctrl+5,Ctrl+6,Ctrl+7,Ctrl+8,Ctrl+9' && new Set(keys).size === 9, keys.join(' '));
    rec('Printer & Drawer tab: printer settings + Save / Print test / Test drawer / Save diagnostics; refund tax not here', v.tabs[0].on && ['seDW', 'seOk', 'seTP', 'seTD', 'seDiag'].every(i => v.ids.includes(i)) && !v.ids.includes('seRT') && !v.ids.includes('tkCD'), v.ids.join(','));
    rec('No helper / explanation notes on the Printer tab', v.notes.length === 0, JSON.stringify(v.notes).slice(0, 200));
    await pg.screenshot({ path: SCR + 'settings-e2e-printer.png' });
    // Save still works (same key), success only flashes in the header
    await pg.$eval('#seDW', e => { e.value = '7'; }); await pg.click('#seOk'); await sleep(900);
    v = await view(pg); let s = await state(BASE);
    rec('Save on the Printer tab saves the same setting (drawerWaitSec)', s.settings.drawerWaitSec === 7, 'drawerWaitSec ' + s.settings.drawerWaitSec);
    rec('Success shows only as a short header flash (no green note left in the form)', v.okMsgs.length === 0 && /saved/i.test(v.flash), `flash "${v.flash}", inline ok ${v.okMsgs.length}`);
    await pg.$eval('#seDW', e => { e.value = '5'; }); await pg.click('#seOk'); await sleep(700);
    await pg.click('#seTD'); await sleep(1500); v = await view(pg);
    rec('Test drawer still runs from the page', /drawer|pin/i.test(v.flash + JSON.stringify(await pg.$eval('#seMsg', e => e.textContent))), `flash "${v.flash}"`);
    await pg.click('#seTP'); await sleep(1500); v = await view(pg);
    const tpMsg = await pg.$eval('#seMsg', e => e.textContent);
    rec('Print test still runs from the page', !!(v.flash || tpMsg), `flash "${v.flash}" msg "${tpMsg}"`);
    // ---- tabs: shortcut keys and clicks show only that tab ----
    const only = { returns: ['seRT', 'rtOk'], screen: ['seSides', 'stPanels', 'stZv', 'tkCD', 'tkF', 'tkR', 'tkOk'], touch: ['tkK', 'tkOk'], bulk: ['blQ', 'blOk'], buttons: ['btAll'], remote: ['rhBtns', 'seLog'] };
    const other = { returns: ['seDW', 'tkCD', 'btAll'], screen: ['tkK', 'seDW', 'seRT'], touch: ['tkCD', 'tkF', 'tkR', 'seSides', 'seDW'], bulk: ['seDW', 'tkCD'], buttons: ['seDW', 'tkCD'], remote: ['seDW', 'btAll'] };
    let keyOk = true, clickOk = true, notes = [], detail = [];
    for (const [i, k] of ['returns', 'screen', 'touch', 'bulk', 'buttons', 'remote'].entries()) {
      await combo(pg, String(i + 2), ['Control']); await sleep(k === 'remote' ? 1600 : 900); v = await view(pg);
      const on = (v.tabs.find(t => t.on) || {}).k, good = on === k && only[k].every(id => v.ids.includes(id)) && !other[k].some(id => v.ids.includes(id));
      if (!good) { keyOk = false; detail.push(`${k}: on=${on} ids=${v.ids.join('/')}`); }
      notes.push(...v.notes);
    }
    rec('Ctrl+2..Ctrl+7 switch tabs while the page is open; each tab shows only its own settings', keyOk, detail.join('; ') || 'all 6 tabs');
    rec('No helper / explanation notes on any tab', notes.length === 0, JSON.stringify(notes).slice(0, 200));
    for (const k of ['screen', 'printer', 'returns']) { await pg.click(`#stTabs [data-tab="${k}"]`); await sleep(1300); v = await view(pg); if ((v.tabs.find(t => t.on) || {}).k !== k) clickOk = false; }
    rec('Clicking a tab switches to it', clickOk && v.ids.includes('seRT') && !v.ids.includes('seDW'), v.ids.join(','));
    // Returns tab: same key, manager can change it
    await pg.click('#seRT'); await pg.click('#rtOk'); await sleep(800); s = await state(BASE); const off = s.settings.refundTaxNoReceipt;
    await pg.click('#seRT'); await pg.click('#rtOk'); await sleep(800); s = await state(BASE);
    rec('Returns tab (manager): "Refund tax on no-receipt returns" saves the same setting', off === false && s.settings.refundTaxNoReceipt === true, `off ${off}, back on ${s.settings.refundTaxNoReceipt}`);
    // Screen tab: hide sidebars is live; reset sidebar sizes
    await pg.click('#stTabs [data-tab="screen"]'); await sleep(900);
    await pg.evaluate(() => setPanelWidths(300, 400)); await pg.click('#stPanels'); await sleep(300);
    const pw = await pg.evaluate(() => ({ ls: localStorage.getItem('airreg.panels'), lw: document.querySelector('.wrap').style.getPropertyValue('--lw') }));
    rec('Screen tab: Reset sidebar sizes puts both panels back to default', pw.ls === '{}' && pw.lw === '172px', JSON.stringify(pw));
    await pg.click('#seSides'); await sleep(200); const hid = await pg.evaluate(() => document.body.classList.contains('nosides'));
    await pg.click('#seSides'); await sleep(200); const back = await pg.evaluate(() => !document.body.classList.contains('nosides'));
    rec('Screen tab: Hide sidebars works (same Ctrl+B setting)', hid && back, `hidden ${hid}, back ${back}`);
    await pg.click('#stZi'); await sleep(200); const z = await pg.evaluate(() => [localStorage.getItem('airreg.zoom'), $('stZv').textContent]); await pg.click('#stZr'); await sleep(200);
    rec('Screen tab: zoom buttons use the same zoom setting', z[0] === '1.1' && z[1] === '110%', JSON.stringify(z));
    await pg.screenshot({ path: SCR + 'settings-e2e-screen.png' });
    // Escape closes back to the sale
    await pg.keyboard.press('Escape'); await sleep(500); v = await view(pg);
    rec('Escape closes the Settings page back to the sale', !v.open && await pg.evaluate(() => document.activeElement && document.activeElement.id === 'scanInput'), `open ${v.open}`);
    // ---- always-visible Settings button in the top bar ----
    const topBtn = () => pg.evaluate(() => { const e = document.getElementById('setTop'); if (!e) return null; const r = e.getBoundingClientRect(), top = document.querySelector('.top').getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { text: e.textContent.replace(/\s+/g, ' ').trim(), key: (e.querySelector('kbd') || {}).textContent || '', inView: r.width > 0 && r.y >= 0 && r.bottom <= innerHeight && r.right <= innerWidth, inTop: r.y >= top.y && r.bottom <= top.bottom, onTop: !!hit && (hit === e || e.contains(hit)),
        right: !!document.querySelector('#right [data-a="settings"]') }; });
    let tb = await topBtn();
    rec('Top bar shows an always-visible Settings button (icon + "Settings") with its key Ctrl+, (right-panel Settings kept)', tb && /Settings/i.test(tb.text) && tb.key === 'Ctrl+,' && tb.inView && tb.inTop && tb.onTop && tb.right, JSON.stringify(tb));
    await pg.screenshot({ path: SCR + 'settings-topbar-button.png' });
    await pg.click('#setTop'); await sleep(1300); v = await view(pg);
    rec('Clicking the top-bar Settings button opens the full-screen tabbed Settings page', v.page && v.tabs.length >= 7 && v.title === 'Settings', `page ${v.page} tabs ${v.tabs.length} title ${v.title}`);
    await pg.keyboard.press('Escape'); await sleep(500);
    await pg.evaluate(() => setSides(true)); await sleep(300); tb = await topBtn();
    const sidesHid = await pg.evaluate(() => document.body.classList.contains('nosides') && !document.querySelector('#right [data-a="settings"]').getClientRects().length);
    await pg.screenshot({ path: SCR + 'settings-topbar-button-nosides.png' });
    await pg.click('#setTop'); await sleep(1300); v = await view(pg);
    rec('With sidebars hidden (Ctrl+B) the top-bar Settings button is still visible and opens Settings', sidesHid && tb && tb.inView && tb.onTop && v.page && v.tabs.length >= 7, JSON.stringify({ sidesHid, tb, page: v.page }));
    await pg.keyboard.press('Escape'); await sleep(500); await pg.evaluate(() => setSides(false)); await sleep(300); v = await view(pg);
    await combo(pg, '6', ['Control']); await sleep(900); v = await view(pg);
    rec('A tab key from the sale screen opens Settings on that tab (Ctrl+6 = Buttons)', v.page && (v.tabs.find(t => t.on) || {}).k === 'buttons', JSON.stringify(v.tabs.find(t => t.on)));
    // ---- Buttons tab ----
    const bt = () => pg.evaluate(() => [...document.querySelectorAll('[data-bt]')].map(c => ({ id: c.dataset.bt, on: c.checked, dis: c.disabled, lock: !!c.closest('.btrow').querySelector('.btlock'), key: (c.closest('.btrow').querySelector('.btkey') || {}).textContent || '' })));
    let rows = await bt();
    const ids = rows.map(r => r.id), locked = rows.filter(r => r.lock).map(r => r.id).sort();
    const need = ['L:new-sale', 'L:history', 'L:hold', 'L:logout', 'R:tax-off', 'R:gift-card', 'R:price-check', 'R:remove', 'R:settings', 'T:checkout', 'T:customer', 'T:close', 'P:bulk'];
    rec('Buttons tab lists every on-screen button (tiles, left side, right sections, Bulk items) with its key', need.every(i => ids.includes(i)) && rows.filter(r => r.id !== 'P:bulk').every(r => r.key), `${rows.length} buttons; missing ${need.filter(i => !ids.includes(i)).join(',') || 'none'}`);
    rec('Locked buttons: shown checked + disabled with a lock icon', JSON.stringify(locked) === JSON.stringify(['L:logout', 'L:new-sale', 'R:settings', 'T:checkout', 'T:close', 'T:customer']) && rows.filter(r => r.lock).every(r => r.on && r.dis) && rows.filter(r => !r.lock).every(r => !r.dis), locked.join(', '));
    const visA = sel => pg.$eval(sel, e => e.getClientRects().length > 0).catch(() => false);
    // reflow reference: where "Return" sits before hiding "Open Item" (right panel, first grid)
    const rect = sel => pg.$eval(sel, e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; });
    await pg.keyboard.press('Escape'); await sleep(300);
    const r0 = await rect('#right .rbtn[data-a="open-item"]');
    await combo(pg, '6', ['Control']); await sleep(900);
    for (const id of ['L:history', 'R:open-item', 'L:hold']) await pg.click(`[data-bt="${id}"]`);
    await sleep(300);
    const lsHidden = await pg.evaluate(() => JSON.parse(localStorage.getItem('airreg.hiddenButtons') || '[]'));
    rec('Unticking hides only that button, saved on this PC right away', JSON.stringify(lsHidden.sort()) === JSON.stringify(['L:history', 'L:hold', 'R:open-item']) && !(await visA('#actions [data-a="history"]')) && !(await visA('#right [data-a="open-item"]')) && await visA('#right [data-a="history"]') && await visA('#actions [data-a="return"]'), JSON.stringify(lsHidden));
    await pg.screenshot({ path: SCR + 'settings-buttons-tab.png' });
    await pg.keyboard.press('Escape'); await sleep(300);
    const r1 = await rect('#right .rbtn[data-a="return"]');
    const hg = await pg.evaluate(() => [...document.querySelectorAll('#actions .hgrp [data-a]')].filter(e => e.getClientRects().length).map(e => e.dataset.a + ':' + (e.style.gridColumn || '-')));
    rec('No gaps: the next button moves into the hidden one\'s place; the Hold group closes up (Load Hold takes the whole row)', JSON.stringify(r0) === JSON.stringify(r1) && hg.length === 1 && /^load-hold:1 \/ -1$/.test(hg[0]) /* 1.2.3: Put Aside / Load Aside left the group (owner 3:46 PM), so with Hold hidden Load Hold spans the whole row */, `Return at ${r1} (Open Item was ${r0}); group ${hg.join(' ')}`);
    await pg.screenshot({ path: SCR + 'settings-buttons-hidden-sale.png' });
    // persists across a reload
    await pg.reload(); await sleep(1800);
    const afterReload = { hist: await visA('#actions [data-a="history"]'), oi: await visA('#right [data-a="open-item"]'), ret: await visA('#right [data-a="return"]') };
    await combo(pg, '6', ['Control']); await sleep(900); rows = await bt();
    rec('Hidden buttons stay hidden after a reload (and stay unticked in the tab)', !afterReload.hist && !afterReload.oi && afterReload.ret && rows.find(r => r.id === 'L:history').on === false, JSON.stringify(afterReload));
    await pg.keyboard.press('Escape'); await sleep(300);
    // a hidden button's key still works
    await combo(pg, 'L', ['Control']); await sleep(1200);
    const histOpen = await pg.evaluate(() => /history/i.test(document.getElementById('modalRoot').innerText));
    rec('A hidden button\'s shortcut still works (History hidden, Ctrl+L opens History)', histOpen, 'modal ' + histOpen);
    await pg.keyboard.press('Escape'); await sleep(400);
    // core buttons can't be hidden, even if forced
    await pg.evaluate(() => localStorage.setItem('airreg.hiddenButtons', JSON.stringify(['T:checkout', 'L:logout', 'L:new-sale', 'R:settings', 'T:customer', 'T:close', 'L:history']))); await pg.reload(); await sleep(1800);
    const core = await Promise.all(['#tiles [data-a="checkout"]', '#tiles [data-a="customer"]', '#tiles [data-a="close"]', '#actions [data-a="new-sale"]', '#actions [data-a="logout"]', '#right [data-a="settings"]'].map(visA));
    await combo(pg, '6', ['Control']); await sleep(900);
    await pg.$eval('[data-bt="T:checkout"]', c => c.click()); await sleep(200); rows = await bt();
    rec('Core (locked) buttons can\'t be hidden: forced hidden list ignored, tick box can\'t change', core.every(Boolean) && rows.find(r => r.id === 'T:checkout').on && rows.find(r => r.id === 'T:checkout').dis, JSON.stringify(core));
    // whole section hidden -> its title goes too; Bulk items panel; Show all buttons
    for (const id of ['R:gift-card', 'R:gift-multi', 'R:gift-balance', 'P:bulk'] /* Add Gift Receipt moved to the left column */) await pg.click(`[data-bt="${id}"]`);
    await sleep(300);
    const sec = await pg.evaluate(() => { const h = [...document.querySelectorAll('#right h3')].find(x => /gift/i.test(x.textContent)); return { h3: !!h && h.getClientRects().length > 0, bulk: $('bulkPanel').getClientRects().length > 0 }; });
    rec('Hiding every button of a section hides its title (no empty block); Bulk items panel can be hidden', !sec.h3 && !sec.bulk, JSON.stringify(sec));
    await pg.click('#btAll'); await sleep(300); rows = await bt();
    const all = { ls: await pg.evaluate(() => localStorage.getItem('airreg.hiddenButtons')), ticks: rows.every(r => r.on), shown: await pg.evaluate(() => ![...document.querySelectorAll('#tiles [data-a], #actions [data-a], #right [data-a], #right h3, #bulkPanel')].some(e => e.classList.contains('uhid'))) };
    rec('"Show all buttons" brings every button back', all.ls === '[]' && all.ticks && all.shown, JSON.stringify(all));
    // ---- move buttons: each slot's dropdown picks which button sits there (swap, no duplicates) ----
    const order = (p, g) => p.evaluate(sel => [...document.querySelectorAll(sel + ' [data-a]')].map(e => e.dataset.a), g === 'L' ? '#actions' : '#right');
    const defL = await order(pg, 'L'), defR = await order(pg, 'R');
    const sels = await pg.evaluate(() => ({ slots: [...document.querySelectorAll('.btsel')].map(b => b.dataset.slot), lockedRows: [...document.querySelectorAll('.btrow.lk')].map(r => r.dataset.row) }));
    rec('Every movable slot has a dropdown; locked slots have none (lock icon instead)', sels.slots.length > 30 && !sels.slots.some(s => ['L:new-sale', 'L:logout', 'R:settings', 'T:checkout', 'T:customer', 'T:close'].includes(s)) && sels.lockedRows.length === 6, `${sels.slots.length} dropdowns; locked rows ${sels.lockedRows.join(',')}`);
    await pg.click('.btsel[data-slot="R:open-item"]'); await sleep(400);
    const dd = await pg.evaluate(() => { const d = document.querySelector('.btdrop'); if (!d) return null; const p = [...d.querySelectorAll('[data-pick]')].map(x => x.dataset.pick); return { n: p.length, scroll: getComputedStyle(d).overflowY, tall: d.scrollHeight > d.clientHeight, locked: p.some(x => x === 'R:settings'), cur: (d.querySelector('.cur') || {}).dataset?.pick, focus: document.activeElement.dataset.pick }; });
    rec('Dropdown is a scrolling list of that panel\'s movable buttons (no locked ones), current one marked', dd && dd.scroll === 'auto' && dd.tall && !dd.locked && dd.cur === 'R:open-item' && dd.n === defR.length - 1, JSON.stringify(dd));
    await pg.screenshot({ path: SCR + 'settings-buttons-dropdown.png' });
    await pg.keyboard.press('Escape'); await sleep(300);
    const escd = await pg.evaluate(() => ({ drop: !!document.querySelector('.btdrop'), page: !!document.getElementById('stTabs') }));
    rec('Esc closes only the dropdown, Settings stays open', !escd.drop && escd.page, JSON.stringify(escd));
    // swap inside the right panel (Price Check into the first slot) and on the left (Clock Out <-> History)
    await pg.click('.btsel[data-slot="R:open-item"]'); await sleep(300); await pg.click('.btdrop [data-pick="R:price-check"]'); await sleep(400);
    await pg.click('.btsel[data-slot="L:history"]'); await sleep(300); await pg.click('.btdrop [data-pick="L:clock-out"]'); await sleep(400);
    let L1 = await order(pg, 'L'), R1 = await order(pg, 'R');
    const lay = await pg.evaluate(() => JSON.parse(localStorage.getItem('airreg.buttonLayout') || '{}'));
    const uniq = a => new Set(a).size === a.length;
    rec('Picking a button that is already in another slot swaps the two (no duplicates, nothing lost)', R1[0] === 'price-check' && R1[defR.indexOf('price-check')] === 'open-item' && L1[1] === 'clock-out' && L1[defL.indexOf('clock-out')] === 'history' && uniq(L1) && uniq(R1) && L1.length === defL.length && R1.length === defR.length && JSON.stringify(lay) === JSON.stringify({ 'R:open-item': 'R:price-check', 'R:price-check': 'R:open-item', 'L:history': 'L:clock-out', 'L:clock-out': 'L:history' }), `L ${L1.slice(0, 3)}…; R ${R1.slice(0, 2)}…; saved ${JSON.stringify(lay)}`);
    const rowShow = await pg.evaluate(() => ({ name: document.querySelector('.btrow[data-row="L:history"] .btname').textContent, key: document.querySelector('.btrow[data-row="L:history"] .btkey').textContent }));
    rec('The slot row shows the button now in it, with that button\'s own key', rowShow.name === 'Clock Out' && /Shift/.test(rowShow.key) && /X/.test(rowShow.key), JSON.stringify(rowShow));
    await pg.keyboard.press('Escape'); await sleep(300);
    await pg.screenshot({ path: SCR + 'settings-buttons-rearranged-sale.png' });
    // locked can't move: no API path, and a forced saved layout that touches a locked slot is ignored
    const lk = await pg.evaluate(() => ({ a: laySet('L:new-sale', 'L:history'), b: laySet('L:history', 'L:logout'), c: laySet('R:open-item', 'R:settings') }));
    // persists across a reload; keys and clicks stay with the function
    await pg.reload(); await sleep(1800);
    L1 = await order(pg, 'L'); R1 = await order(pg, 'R');
    rec('Rearranged layout stays after a reload (saved on this PC)', L1[1] === 'clock-out' && R1[0] === 'price-check', `L ${L1.slice(0, 3)} R ${R1.slice(0, 2)}`);
    await combo(pg, 'L', ['Control']); await sleep(1200);
    const k1 = await pg.evaluate(() => /history/i.test($('modalRoot').innerText)); await pg.keyboard.press('Escape'); await sleep(400);
    await pg.click('#actions .abtn[data-a="history"]'); await sleep(1200);
    const k2 = await pg.evaluate(() => /history/i.test($('modalRoot').innerText)); await pg.keyboard.press('Escape'); await sleep(400);
    await combo(pg, 'I', ['Control']); await sleep(1000);
    const k3 = await pg.evaluate(() => /price/i.test($('modalRoot').innerText)); await pg.keyboard.press('Escape'); await sleep(400);
    rec('Keys stay tied to the function after moving (Ctrl+L = History, Ctrl+I = Price Check; the moved History button still opens History)', k1 && k2 && k3, JSON.stringify({ ctrlL: k1, click: k2, ctrlI: k3 }));
    const pos = () => pg.evaluate(() => ['#actions [data-a="new-sale"]', '#actions [data-a="logout"]', '#right [data-a="settings"]'].map(s => { const e = document.querySelector(s); const all = [...e.parentNode.parentNode.querySelectorAll('[data-a]')]; return all.indexOf(e) + '/' + all.length; }));
    const p0 = await pos();
    await pg.evaluate(() => localStorage.setItem('airreg.buttonLayout', JSON.stringify({ 'L:new-sale': 'L:history', 'L:history': 'L:new-sale' }))); await pg.reload(); await sleep(1800);
    const forced = await order(pg, 'L');
    rec('Locked buttons can\'t be moved or replaced (no dropdown, swap refused, a forced saved layout is ignored)', !lk.a && !lk.b && !lk.c && forced[0] === 'new-sale' && forced[forced.length - 1] === 'logout' && JSON.stringify(forced) === JSON.stringify(defL), `laySet ${JSON.stringify(lk)}; forced -> ${forced.slice(0, 2)}; locked at ${p0}`);
    // reset to default layout
    await pg.evaluate(() => localStorage.setItem('airreg.buttonLayout', JSON.stringify({ 'L:history': 'L:clock-out', 'L:clock-out': 'L:history' }))); await pg.reload(); await sleep(1800);
    await combo(pg, '6', ['Control']); await sleep(900);
    await pg.click('#btLay'); await sleep(400);
    const rs = { ls: await pg.evaluate(() => localStorage.getItem('airreg.buttonLayout')), L: JSON.stringify(await order(pg, 'L')) === JSON.stringify(defL), R: JSON.stringify(await order(pg, 'R')) === JSON.stringify(defR) };
    rec('"Reset to default layout" puts every button back', rs.ls === null && rs.L && rs.R, JSON.stringify(rs));
    await pg.keyboard.press('Escape'); await sleep(300);
    rec('No page errors (manager page)', errs.length === 0, errs.join(' | ').slice(0, 200) || 'none');
    await pg.close();

    // ---- a cashier (no manager rights) ----
    await login(CBASE, 'cashier');
    const cp = await b.newPage(); const cerrs = []; cp.on('pageerror', e => cerrs.push(e.message));
    await cp.goto(CBASE + '/'); await sleep(1500); await cp.evaluate(() => { localStorage.removeItem('airreg.hiddenButtons'); localStorage.removeItem('airreg.buttonLayout'); }); await cp.reload(); await sleep(1500);
    await combo(cp, '2', ['Control']); await sleep(900);
    const rt = await cp.evaluate(() => ({ dis: $('seRT') && $('seRT').disabled, save: !!$('rtOk') }));
    rec('Returns tab stays manager-only for a cashier (box locked, no Save)', rt.dis === true && !rt.save, JSON.stringify(rt));
    await cp.click('#stTabs [data-tab="buttons"]'); await sleep(900);
    await cp.click('[data-bt="R:promo"]'); await sleep(300);
    const cash = { ls: await cp.evaluate(() => localStorage.getItem('airreg.hiddenButtons')), vis: await cp.$eval('#right [data-a="promo"]', e => e.getClientRects().length > 0) };
    rec('Any cashier can change the Buttons tab (no manager login asked)', cash.ls === '["R:promo"]' && !cash.vis && !(await cp.evaluate(() => /manager/i.test(document.getElementById('modalRoot').innerText.split('\n')[0]))), JSON.stringify(cash));
    await cp.click('.btsel[data-slot="L:history"]'); await sleep(300); await cp.click('.btdrop [data-pick="L:drawer"]'); await sleep(400);
    const cmv = await cp.evaluate(() => ({ ls: localStorage.getItem('airreg.buttonLayout'), second: [...document.querySelectorAll('#actions [data-a]')][1].dataset.a }));
    rec('Any cashier can move buttons too (Open Drawer into the History slot, swapped)', cmv.second === 'drawer' && cmv.ls === JSON.stringify({ 'L:history': 'L:drawer', 'L:drawer': 'L:history' }), JSON.stringify(cmv));
    await cp.click('#btLay'); await sleep(200);
    await cp.click('#btAll'); await sleep(200); await cp.keyboard.press('Escape'); await sleep(300);
    rec('No page errors (cashier page)', cerrs.length === 0, cerrs.join(' | ').slice(0, 200) || 'none');
    await cp.close();
  } catch (e) {
    failure = e;
    console.error('FAIL exception thrown mid-run (the run stopped early) — ' + (e && e.stack || e));
    out.push({ k: 'Test run finished without an exception', pass: false, note: String(e && e.message || e).slice(0, 300) });
  } finally {
    b.disconnect();
    const passed = out.filter(x => x.pass).length;
    console.log(`\n${passed}/${out.length} passed`);
    fs.writeFileSync(path.join(__dirname, 'e2e-settings-results.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: out.length, out }, null, 1));
    process.exit(!failure && passed === out.length && out.length ? 0 : 1);
  }
})().catch(e => { console.error(e); process.exit(1); });

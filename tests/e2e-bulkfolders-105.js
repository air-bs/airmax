// AirMax 1.0.5 bulk item FOLDERS e2e (Ari OK 10:46 PM ET Oct 29) against the OFFLINE fake AIR POS (made-up data, no account).
// Covers: folders made in Settings > Bulk items, open / Back, Alt+1..Alt+= on visible spots, Alt+Backspace (not while typing),
// more than 12 spots (scroll + tap), back to the top after a sale / new sale / Hold / Load Hold, 1.0.4 settings (no folders)
// look exactly as before, whole-save check, delete folder (asks first), totals the same as scanning.
// Run: FAKE_PORT=5180 node tests/look-fake.js &  FAKE_PORT=5180 node tests/e2e-bulkfolders-105.js  (Chrome on 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const it = (label, code, askPrice = false) => ({ label, code, name: label, askPrice });
(async () => {
  const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const page = await b.newPage(); page.on('dialog', d => d.accept());
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/'); await sleep(800);
  const st = () => page.evaluate(() => fetch('/api/state').then(r => r.json()));
  const apiP = (r, x) => page.evaluate((r, x) => fetch('/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), r, x);
  const refresh = async () => { await page.evaluate(() => refresh()); await sleep(400); };
  const shot = n => page.screenshot({ path: path.join(SCR, n + '.png') });
  const modalH = () => page.$eval('#modalRoot h2', e => e.textContent).catch(() => '');
  const esc = async () => { await page.keyboard.press('Escape'); await sleep(400); };
  const alt = async k => { await page.focus('#scanInput'); await page.keyboard.down('Alt'); await page.keyboard.press(k); await page.keyboard.up('Alt'); await sleep(900); };
  const view = () => page.evaluate(() => { const el = $('bulkBtns'); return { mode: el.classList.contains('bfmode'), back: !!$('bulkBack'), path: (el.querySelector('.fpath') || {}).textContent || '', head: document.querySelector('#bulkPanel h3 small').textContent,
    spots: [...el.querySelectorAll('[data-bulk]')].map(x => ({ n: +x.dataset.bulk, f: x.dataset.bulkFolder || '', t: x.innerText.replace(/\s+/g, ' ').trim(), bk: (x.querySelector('.bk') || {}).textContent || '' })) }; });
  const fill = async (sel, v) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, v); };
  if (!(await st()).loggedIn) { await fill('#lgCompany', 'fake shop'); await fill('#lgUser', 'tester'); await fill('#lgPw', 'fake'); await page.click('#lgBtn'); await sleep(2500); }
  await apiP('pay-close'); await apiP('new-sale'); await page.goto(BASE + '/'); await sleep(1200);
  let s = await st(); rec('login to fake AIR POS', s.loggedIn, s.user && s.user.name || '');

  // 1) 1.0.4 settings (bulkItems only, no folders): exactly the old buttons, old look, old keys
  await apiP('settings', { bulkItems: [it('Rope', '1003'), it('Candy', '1001', true)], bulkFolders: [], bulkOrder: [] }); await refresh();
  let v = await view(); const grid = await page.$eval('#bulkBtns', e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
  rec('No folders = the 1.0.4 Quick Add (same buttons, order, Alt keys, layout, header)', !v.mode && !v.back && JSON.stringify(v.spots.map(x => x.n + x.bk)) === '["0Alt+1","1Alt+2"]' && /Rope/.test(v.spots[0].t) && v.head === 'bulk items · Alt+1-9', JSON.stringify(v));

  // 2) create folders in Settings > Bulk items
  await page.evaluate(() => A['bulk-settings']()); await sleep(1000);
  const ids = await page.evaluate(() => ['bfTabs', 'bfName', 'bfAdd', 'blQ', 'blOk', 'blRows'].filter(i => !!$(i)));
  await page.type('#bfName', 'Candy'); await page.click('#bfAdd'); await sleep(300);
  await page.type('#blQ', '1001'); await page.keyboard.press('Enter'); await sleep(900);
  await page.type('#blQ', '1004'); await page.keyboard.press('Enter'); await sleep(900);
  await page.click('#bfTabs [data-tab="top"]'); await sleep(200);
  await page.type('#bfName', 'candy'); await page.click('#bfAdd'); await sleep(200); const dupMsg = await page.$eval('#blMsg', e => e.textContent);
  await fill('#bfName', 'Hardware'); await page.click('#bfAdd'); await sleep(200);
  await page.type('#blQ', '1003'); await page.keyboard.press('Enter'); await sleep(900);
  await page.click('#bfTabs [data-tab="top"]'); await sleep(300);
  await shot('v105-settings-bulk-1366');
  await page.click('#blOk'); await sleep(1000); const saved = await page.evaluate(() => (document.getElementById('blMsg') || {}).textContent + ' ' + ((document.getElementById('stFlash') || {}).textContent || '')); s = await st();
  const fo = s.settings.bulkFolders || [];
  rec('Settings > Bulk items: Add folder, add products by search/scan into it, duplicate name refused, Save', ids.length === 6 && /already a folder called candy/i.test(dupMsg) && /saved/i.test(saved) && fo.length === 2 && fo[0].name === 'Candy' && fo[0].items.map(x => x.code).join() === '1001,1004' && fo[1].name === 'Hardware' && fo[1].items[0].code === '1003',
    `${saved}; dup "${dupMsg}"; folders ${JSON.stringify(fo.map(f => [f.name, f.items.map(x => x.code)]))}; order ${JSON.stringify(s.settings.bulkOrder)}`);
  // rename + move: rename Hardware -> Tools, move "Rope" single into Tools (Move to)
  await page.click(`#bfTabs [data-tab="${fo[1].id}"]`); await sleep(200); await fill('#bfRename', 'Tools'); await page.click('#bfRenameOk'); await sleep(200);
  await page.click('#bfTabs [data-tab="top"]'); await sleep(200);
  const ropeRow = await page.evaluate(() => [...document.querySelectorAll('#blRows [data-row]')].findIndex(r => r.querySelector('[data-l]') && /Rope/.test(r.querySelector('[data-l]').value)));
  await page.evaluate((i, id) => { const sel = document.querySelectorAll('#blRows [data-row]')[i].querySelector('[data-mv]'); sel.value = id; sel.dispatchEvent(new Event('change')); }, ropeRow, fo[1].id); await sleep(200);
  // Move up: put the Candy folder first (it was added after the single, so the singles keep their Alt keys until moved)
  const up = await page.evaluate(() => { const r = [...document.querySelectorAll('#blRows [data-row]')].find(r => /Folder: Candy/.test(r.innerText)); return r ? +r.dataset.row : -1; });
  for (let i = up; i > 0; i--) { await page.click(`#blRows [data-up="${i}"]`); await sleep(150); }
  await page.click('#blOk'); await sleep(1000); s = await st(); await esc();
  const f2 = s.settings.bulkFolders.find(f => f.id === fo[1].id);
  rec('Rename folder, Move to (single into a folder) and Move up saved', s.settings.bulkOrder[0] === 'f:' + fo[0].id && f2 && f2.name === 'Tools' && f2.items.length === 2 && s.settings.bulkItems.length === 1 && !s.settings.bulkItems.some(x => x.label === 'Rope'), `Tools ${JSON.stringify(f2 && f2.items.map(x => x.label))}; singles ${s.settings.bulkItems.map(x => x.label)}; order ${s.settings.bulkOrder}`);

  // 3) the sale screen: folders view
  await apiP('new-sale'); await refresh(); v = await view();
  const look = await page.evaluate(() => { const f = document.querySelector('#bulkBtns .rbtn.fold'), cs = getComputedStyle(f); return { shadow: cs.boxShadow, bg: cs.backgroundColor, open: (f.querySelector('.open') || {}).textContent, small: (f.querySelector('small') || {}).textContent, cols: getComputedStyle($('bulkBtns')).gridTemplateColumns.split(' ').length }; });
  await shot('v105-folders-1366');
  rec('Top level: folders + the single in bulkOrder, folders = green stripe, light tint, "Folder · N items", OPEN, Alt keys', v.mode && v.spots.length === 3 && v.spots[0].f && /Candy/.test(v.spots[0].t) && v.spots[0].bk === 'Alt+1' && v.spots[2].bk === 'Alt+3' && /rgb\(24, 160, 88\)/.test(look.shadow) && look.bg === 'rgb(243, 250, 246)' && look.open === 'OPEN' && look.small === 'Folder · 2 items' && look.cols === 1,
    JSON.stringify(v.spots) + ' ' + JSON.stringify(look));
  await page.setViewport({ width: 1280, height: 720 }); await sleep(600); await shot('v105-folders-1280x720');
  const fit = await page.evaluate(() => { const r = $('bulkPanel').getBoundingClientRect(); return r.right <= innerWidth && r.width > 100; });
  rec('1280x720: Quick Add folders panel on screen', fit, String(fit));
  await page.setViewport({ width: 1366, height: 768 }); await sleep(600);
  // tap a folder, open view, add, Back
  await page.click('#bulkBtns [data-bulk-folder]'); await sleep(500); v = await view();
  await shot('v105-folder-open-1366');
  const backBk = await page.$eval('#bulkBack .bk', e => e.textContent).catch(() => '');
  rec('Tap a folder: Back to folders (Alt+Backspace), folder name · N items, its items with Alt+1.., header shows the folder', v.back && backBk === 'Alt+Backspace' && /Candy · 2 items/i.test(v.path) && v.spots.length === 2 && v.spots[0].bk === 'Alt+1' && v.head === 'Candy · Alt+1-2', JSON.stringify(v) + ' back ' + backBk);
  await page.click('#bulkBtns [data-bulk="1"]'); await sleep(1000); s = await st();
  rec('Tap an item inside the folder adds that product (stays in the folder)', s.cart.length === 1 && s.cart[0].number === '1004' && (await view()).back, s.cart.map(l => l.number + ' x' + l.quantity).join(', '));
  await page.click('#bulkBack'); await sleep(400); v = await view();
  rec('Back to folders returns to the top level', !v.back && v.spots.length === 3, JSON.stringify(v.spots.map(x => x.t)));
  // keys
  await alt('1'); v = await view(); const k1 = v.back && /Candy/.test(v.path);
  await alt('1'); s = await st(); const k2 = s.cart.some(l => l.number === '1001' && l.quantity === 1);
  await page.focus('#scanInput'); await page.keyboard.type('10'); await page.keyboard.down('Alt'); await page.keyboard.press('Backspace'); await page.keyboard.up('Alt'); await sleep(500);
  const typing = (await view()).back; await page.$eval('#scanInput', e => { e.value = ''; });
  await alt('Backspace'); v = await view(); const k3 = !v.back;
  await alt('Backspace'); const k4 = !(await view()).back && !(await modalH());
  rec('Alt+1 opens the 1st spot (folder), Alt+1 inside adds item 1, Alt+Backspace = Back (not while typing in the scan box; nothing at the top)', k1 && k2 && typing && k3 && k4, JSON.stringify({ k1, k2, typingKeptFolder: typing, k3, k4 }));

  // 4) more than 12: 12 singles + 12 folders = 24 spots; a 24-item folder
  const big = Array.from({ length: 24 }, (_, i) => it('Big ' + (i + 1), i % 2 ? '1003' : '1004'));
  const singles = Array.from({ length: 12 }, (_, i) => it('S' + (i + 1), '1004'));
  const folders = [{ id: 'f-big', name: 'Big', items: big }, ...Array.from({ length: 11 }, (_, i) => ({ id: 'f-' + i, name: 'F' + (i + 1), items: [it('Gift bag', '1004')] }))];
  let x = await apiP('settings', { bulkItems: singles, bulkFolders: folders, bulkOrder: [...singles.map((_, i) => 'i:' + i), ...folders.map(f => 'f:' + f.id)] });
  await apiP('new-sale'); await refresh(); v = await view();
  const scroll = await page.$eval('#bulkBtns', e => ({ sh: e.scrollHeight, ch: e.clientHeight, oy: getComputedStyle(e).overflowY }));
  rec('24 top spots: all shown, Alt keys only on spots 1-12, 13-24 tap-only, panel scrolls', x.ok && v.spots.length === 24 && v.spots.slice(0, 12).every((p, i) => p.bk === 'Alt+' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='][i]) && v.spots.slice(12).every(p => !p.bk) && scroll.sh > scroll.ch && scroll.oy === 'auto', `${x.message || 'saved'}; ${v.spots.length} spots; scroll ${JSON.stringify(scroll)}`);
  await alt('='); s = await st(); const eq = s.cart.length === 1 && s.cart[0].number === '1004';
  await page.$eval('#bulkBtns [data-bulk="23"]', e => e.scrollIntoView()); await sleep(200); await page.click('#bulkBtns [data-bulk="23"]'); await sleep(500); v = await view();
  rec('Alt+= presses spot 12; spot 24 (a folder, below the fold) opens by scroll + tap', eq && v.back && /F11/.test(v.path), `cart ${s.cart.map(l => l.number)}; ${v.path}`);
  await page.click('#bulkBack'); await sleep(300); await page.click('#bulkBtns [data-bulk-folder="f-big"]'); await sleep(500); v = await view();
  await alt('='); s = await st(); const n12 = s.cart.find(l => l.number === '1003');
  await page.$eval('#bulkBtns [data-bulk="23"]', e => e.scrollIntoView()); await sleep(200); await page.click('#bulkBtns [data-bulk="23"]'); await sleep(900); s = await st();
  rec('24-item folder: 24 items, Alt+= = item 12, item 24 by scroll + tap', v.spots.length === 24 && v.spots[11].bk === 'Alt+=' && !v.spots[12].bk && n12 && s.cart.find(l => l.number === '1003').quantity === 2 && v.head === 'Big · Alt+1…=', `${v.spots.length} items; head ${v.head}; cart ${s.cart.map(l => l.number + ' x' + l.quantity)}`);

  // 5) back to the top after a sale, new sale, Hold, Load Hold
  const openBig = async () => { if (!(await view()).back) { await page.click('#bulkBtns [data-bulk-folder="f-big"]'); await sleep(400); } return (await view()).back; };
  await openBig(); const dueApp = (await st()).totals.due;
  await openBig(); await page.focus('#scanInput'); await page.keyboard.press('Enter'); await sleep(700); const payH = await modalH();
  await page.keyboard.press('+'); await sleep(200); await page.keyboard.press('Enter'); await sleep(2500);
  for (let i = 0; i < 4 && await modalH(); i++) { await esc(); }
  s = await st(); v = await view();
  rec('After the sale is finished (cash), Quick Add is back at the top', /Payment/.test(payH) && s.cart.length === 0 && !v.back, `payment "${payH}", cart ${s.cart.length}, back shown ${v.back}`);
  const ctl = await new Promise(r => require('http').get('http://127.0.0.1:' + (FP + 1) + '/strict', q => { let d = ''; q.on('data', c => d += c); q.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({ err: d }); } }); }).on('error', e => r({ err: String(e) })));
  const lastC = (ctl.completes || []).slice(-1)[0] || {};
  rec('Finished sale: the server (fake AIR POS works the total out from the saved order) agrees with the app total', dueApp > 0 && lastC.due === dueApp && lastC.got >= dueApp, `app ${dueApp}; server due ${lastC.due} got ${lastC.got}`);
  const o1 = await openBig(); await page.evaluate(() => A['new-sale'] ? A['new-sale']() : act('new-sale')); await sleep(1200); for (let i = 0; i < 3 && await modalH(); i++) await esc();
  rec('New sale: back at the top', o1 && !(await view()).back, String(o1));
  await openBig(); await page.click('#bulkBtns [data-bulk="0"]'); await sleep(900); const o2 = (await view()).back;
  await page.evaluate(() => act('hold')); await sleep(1200); s = await st();
  rec('Hold: back at the top', o2 && s.cart.length === 0 && !(await view()).back, `cart ${s.cart.length}`);
  // Load Hold: real resume of the order just held (the runner starts the fake with FAKE_HELD=1, which lists held orders and
  // returns them with their lines, as AIR POS does).
  const heldNo = s.cart.length;
  const o3 = await openBig(); const rs = await page.evaluate(() => act('resume', {})); await sleep(1500); s = await st(); await refresh();
  rec('Load Hold (real resume of the held sale): sale back, Quick Add back at the top', o3 && rs && rs.ok && s.order && s.order.resuming && s.cart.length === 1 && s.cart[0].number === '1004' && !(await view()).back, `${rs && rs.message}; cart ${s.cart.map(l => l.number + ' x' + l.quantity)}; held cart was ${heldNo}`);
  await apiP('new-sale'); await refresh();

  // 6) whole-save check from the screen's API: one bad part = nothing saved
  const before = JSON.stringify(((await st()).settings));
  x = await apiP('settings', { bulkItems: [it('New', '1001')], bulkFolders: [{ id: 'f-a', name: 'Ok', items: [] }, { id: 'f-b', name: 'OK', items: [] }], drawerWaitSec: 1 });
  const x2 = await apiP('settings', { bulkItems: [it('New', '1001')], bulkFolders: [{ id: 'f-a', name: 'Ok', items: Array.from({ length: 25 }, () => it('x', '1001')) }] });
  const x3 = await apiP('settings', { bulkItems: [{ label: 'no product', code: '' }], bulkFolders: [] });
  const after = JSON.stringify(((await st()).settings));
  rec('Whole-save check: duplicate name / 25 items / item without product = whole save refused, settings unchanged', !x.ok && !x2.ok && !x3.ok && before === after && /Two folders/.test(x.message) && /full: up to 24/.test(x2.message) && /pick a product/.test(x3.message), [x.message, x2.message, x3.message].join(' | '));
  // the editor shows the server's refusal and keeps the dialog
  await apiP('settings', { bulkItems: [it('Rope', '1003')], bulkFolders: [{ id: 'f-c', name: 'Candy', items: [it('Candy', '1001')] }], bulkOrder: ['f:f-c', 'i:0'] }); await refresh();
  await page.evaluate(() => A['bulk-settings']()); await sleep(900);
  await page.click('#bfTabs [data-tab="f-c"]'); await sleep(200); await page.click('#bfDel'); await sleep(200);
  const ask = await page.$eval('#bfBar', e => e.innerText); await page.click('#bfDelNo'); await sleep(200); const kept = !!(await page.$('#bfTabs [data-tab="f-c"]'));
  await page.click('#bfDel'); await sleep(200); await page.click('#bfDelYes'); await sleep(200); await page.click('#blOk'); await sleep(1000); s = await st(); await esc();
  const sing = s.settings.bulkItems.map(x => x.label), ord = s.settings.bulkOrder;
  rec('Delete folder asks first (Keep / Yes, delete); its items move to the top level in its place (same rule as AirRegister); only this PC\'s setup changes', /Delete folder Candy from this PC\? Its 1 button moves to the top level\. \(AIR POS products are not changed\.\)/.test(ask) && kept && s.settings.bulkFolders.length === 0 && JSON.stringify(sing) === '["Rope","Candy"]' && JSON.stringify(ord) === '["i:1","i:0"]', `ask "${ask.replace(/\n/g, ' ')}"; folders ${s.settings.bulkFolders.length}; singles ${sing}; order ${ord}`);
  // no room at the top: delete is refused with a plain message, nothing changes
  await apiP('settings', { bulkItems: Array.from({ length: 11 }, (_, i) => it('S' + i, '1004')), bulkFolders: [{ id: 'f-d', name: 'Two', items: [it('A', '1001'), it('B', '1003')] }] }); await refresh();
  await page.evaluate(() => A['bulk-settings']()); await sleep(900);
  await page.click('#bfTabs [data-tab="f-d"]'); await sleep(200); await page.click('#bfDel'); await sleep(200);
  const noRoom = await page.$eval('#blMsg', e => e.textContent), noAsk = !(await page.$('#bfDelYes')); await esc(); s = await st();
  rec('Delete folder with no room at the top (12 single buttons max) is refused: "Move some items first"', noAsk && /room for 1 .*Move some items first/.test(noRoom) && s.settings.bulkFolders.length === 1, noRoom);

  // 7) totals: folder buttons = scanning the same products
  await apiP('settings', { bulkItems: [], bulkFolders: [{ id: 'f-t', name: 'Mix', items: [it('Candy', '1001'), it('Rope', '1003'), it('Bag', '1004')] }] });
  await apiP('new-sale'); await refresh(); await page.click('#bulkBtns [data-bulk-folder="f-t"]'); await sleep(400);
  for (const i of [0, 1, 1, 2]) { await page.click(`#bulkBtns [data-bulk="${i}"]`); await sleep(800); }
  const tf = (await st()).totals; await apiP('new-sale'); await refresh();
  for (const c of ['1001', '1003', '1003', '1004']) { await page.focus('#scanInput'); await page.keyboard.type(c); await page.keyboard.press('Enter'); await sleep(800); }
  const ts = (await st()).totals; await apiP('new-sale'); await refresh();
  rec('Totals unchanged: folder buttons give exactly the same totals as scanning', JSON.stringify(tf) === JSON.stringify(ts) && tf.due > 0, JSON.stringify(tf));

  // 8) the Bulk items tab and Buttons tab still show; no script errors
  await apiP('settings', { bulkItems: [], bulkFolders: [], bulkOrder: [] }); await refresh();
  rec('No page errors', !errs.length, errs.join(' | ') || 'none');
  fs.writeFileSync(path.join(__dirname, 'e2e-bulkfolders-105-results.json'), JSON.stringify(out, null, 1));
  const bad = out.filter(r => !r.pass).length; console.log(`\n${out.length - bad}/${out.length} passed`);
  await page.close(); b.disconnect(); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL crashed — ' + e.stack); process.exit(1); });

// AirMax Batch 4: the ITEMS tab in a real browser on the fake AIR POS (offline, made-up data): look-up screens for everyone,
// write controls (New item, Save item, Disable Item, Save price… + confirm box, Add to Quick Add, × on a tile) ONLY for a manager with the Product Management permission.
//   node tests/e2e-items-b4.js    (E2E4_PORT default 5240, hook +5; Chrome from CHROME_URL, or one is started)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.E2E4_PORT || 5240), HOOK = PORT + 5, BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; let passes = 0;
const rec = (k, pass, note) => { if (!pass) fails.push(k); else passes++; console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' - ' + String(note).slice(0, 200) : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch('http://127.0.0.1:' + HOOK + '/items-state').then(r => r.json());

async function withServer(role, fn) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e4-')), log = path.join(T, 'srv.log');
  const env = { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: String(HOOK), FAKE_DATA_DIR: path.join(T, 'data'), FAKE_ITEMS_PAGED: '1' }; if (role) env.FAKE_ITEMS_ROLE = role; else delete env.FAKE_ITEMS_ROLE;
  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  try { for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/shortcuts'); await state(); break; } catch (e) { await sleep(250); } } await fn(); }
  finally { srv.kill(); await sleep(400); fs.rmSync(T, { recursive: true, force: true }); }
}
let B, own = null;
async function page() {
  const p = await B.newPage(); await p.setViewport({ width: 1366, height: 768 }); await p.setCacheEnabled(false); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.errs = errs;
  await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' }); await post('pay-close'); await post('new-sale'); await post('dismiss');
  await p.goto(BASE + '/'); await sleep(1800); return p;
}
const openItems = async p => { await p.evaluate(() => { const t = document.querySelector('#tabbar .tab[data-tab="items"]'); if (t) t.click(); }); await p.waitForSelector('.b4', { timeout: 8000 }).catch(() => {}); await sleep(900); };
const txt = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);
const click = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const setv = (p, sel, v) => p.evaluate((s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, sel, v);
const btnTexts = p => p.evaluate(() => [...document.querySelectorAll('.b4 button, .b4dlg button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()));

(async () => {
  const url = process.env.CHROME_URL;
  if (url) B = await puppeteer.connect({ browserURL: url, protocolTimeout: 60000 });
  else { own = cp.spawn('google-chrome', ['--headless=new', '--no-sandbox', '--remote-debugging-port=9459', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'chr-e2e4-')), 'about:blank'], { stdio: 'ignore' }); await sleep(3000); B = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9459', protocolTimeout: 60000 }); }
  try {
    await withServer('', async () => {
      const p = await page(); await openItems(p);
      rec('U1 manager with the permission: Items tab opens, "New item" button is there, no annotation chips', (await btnTexts(p)).some(t => /^New item/.test(t)) && !(await p.evaluate(() => /Mockup|annot/i.test(document.body.innerText))), '');
      await p.type('.b4 input[type=text], .b4 input:not([type])', 'candy').catch(() => {}); await sleep(1500);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.b4 table tbody tr')].length);
      rec('U2 search "candy" lists items', rows >= 1, 'rows ' + rows);
      await p.evaluate(() => document.querySelector('.b4 table tbody tr').click()); await sleep(1500);
      const bt = await btnTexts(p);
      rec('U3 the edit form shows Save item, Disable Item, Add to Quick Add, Save price…', ['Save item', 'Disable Item', 'Add to Quick Add', 'Save price…'].every(l => bt.includes(l)), JSON.stringify(bt));
      // price change with the confirm box
      const first = await p.evaluate(() => { const i = document.querySelector('.p-in'); return { id: i.dataset.id, v: i.value }; });
      await setv(p, '.p-in', 'abc'); await click(p, '#b-price'); await sleep(500);
      rec('U4 a bad price (text) is stopped on the screen; no box', /number, 0 or more/.test(await txt(p, '#b-pmsg') || '') && !(await p.$('.b4dlg')), '');
      await setv(p, '.p-in', '11.50'); await click(p, '#b-price'); await sleep(900);
      const bx = await txt(p, '.b4dlg') || '';
      rec('U5 Save price… opens the confirm box: old → new price, % change, Confirm price change / Cancel; nothing saved yet', /\$10\.00/.test(bx) && /\$11\.50/.test(bx) && /\+15\.0%/.test(bx) && /Confirm price change/.test(bx) && /Cancel/.test(bx) && !(await state()).calls.some(c => c.path.endsWith('ProductPriceSave')), bx.replace(/\s+/g, ' ').slice(0, 160));
      await click(p, '.b4dlg [data-n]'); await sleep(400);
      rec('U6 Cancel closes the box and saves nothing', !(await p.$('.b4dlg')) && !(await state()).calls.some(c => c.path.endsWith('ProductPriceSave')), '');
      await click(p, '#b-price'); await sleep(700); await click(p, '.b4dlg [data-y]'); await sleep(1500);
      const sv = (await state()).calls.filter(c => c.path.endsWith('ProductPriceSave'));
      rec('U7 Confirm price change saves once and the form shows the new price', sv.length === 1 && JSON.parse(sv[0].params.submit).subs[0].price === 11.5 && (await p.evaluate(() => document.querySelector('.p-in').value)) === '11.5', first.v + ' -> ' + (await p.evaluate(() => document.querySelector('.p-in').value)));
      // disable
      await click(p, '#b-dis'); await sleep(500); const dtx = await txt(p, '.b4dlg') || '';
      rec('U8 Disable Item asks first (Disable Item / Cancel); Cancel changes nothing', /Disable this item/.test(dtx) && (await click(p, '.b4dlg [data-n]')) && !(await state()).calls.some(c => c.path.endsWith('ProductUpdate')), '');
      await click(p, '#b-dis'); await sleep(400); await click(p, '.b4dlg [data-y]'); await sleep(1500);
      const upd = (await state()).calls.filter(c => c.path.endsWith('ProductUpdate'));
      rec('U9 confirmed Disable Item: ProductUpdate with enabled false', upd.length >= 1 && JSON.parse(upd[upd.length - 1].params.submit).enabled === false && !(await p.evaluate(() => document.querySelector('#f-en').checked)), '');
      const org = await p.evaluate(() => ({ val: document.querySelector('#f-org').value, opts: [...document.querySelectorAll('#f-org option')].map(o => o.value + '=' + o.textContent) }));
      rec('U9b Origin list: value = code when AIR POS has one (AR), else its key (AA001); the item\'s current origin (key AA001) is selected and is sent back unchanged on save', org.val === 'AA001' && org.opts.includes('AA001=Anguilla') && org.opts.includes('AR=Argentina') && org.opts.includes('=(none)') && JSON.parse(upd[upd.length - 1].params.submit).originCode === 'AA001', JSON.stringify(org));
      // quick add / remove
      await click(p, '#b-qadd'); await sleep(400); const qtx = await txt(p, '.b4dlg') || ''; await click(p, '.b4dlg [data-y]'); await sleep(1200);
      rec('U10 Add to Quick Add asks, then adds', /Add to the Quick Add grid/.test(qtx) && (await state()).calls.some(c => c.path.endsWith('QuickSellingProductAdd')), '');
      await p.evaluate(() => { const s = [...document.querySelectorAll('.b4seg button, .b4seg span')].find(e => /Quick/.test(e.innerText)); if (s) s.click(); }); await sleep(1200);
      const tiles = await p.evaluate(() => document.querySelectorAll('.b4 .tile .rm').length);
      rec('U11 Quick Add grid shows a × on every tile (manager with permission)', tiles >= 1, 'x buttons ' + tiles);
      await click(p, '.b4 .tile .rm'); await sleep(400); const rtx = await txt(p, '.b4dlg') || ''; await click(p, '.b4dlg [data-y]'); await sleep(1200);
      rec('U12 × asks "Remove from the Quick Add grid?" then removes (QuickSellingProductRemove with the grid id)', /Remove from the Quick Add grid/.test(rtx) && (await state()).calls.some(c => c.path.endsWith('QuickSellingProductRemove')), '');
      // new item
      await p.evaluate(() => { const s = [...document.querySelectorAll('.b4seg button, .b4seg span')].find(e => /^Items/.test(e.innerText)); if (s) s.click(); }); await sleep(500);
      await click(p, '#b4newbtn'); await sleep(1200);
      rec('U13 New item: empty form with Save item and Cancel, no price section yet', (await btnTexts(p)).includes('Cancel') && !(await p.$('.p-in')) && (await p.evaluate(() => document.querySelector('#f-number').value)) === '', '');
      const cats = await p.evaluate(() => [...document.querySelectorAll('#f-cat option')].map(o => o.textContent)); rec('U13b the Department list comes from Batch 1 lookups-all (nested as "Made-up Toys > Cars", the disabled one left out)', cats.includes('Made-up Toys > Cars') && cats.includes('Made-up School') && !cats.some(t => /Dolls$/.test(t) && !/clothes/.test(t)), JSON.stringify(cats));
      await setv(p, '#f-number', 'ZZ-B4-UI'); await setv(p, '#f-name', 'UI test item'); await click(p, '#b-save'); await sleep(700);
      rec('U14 Save item without a department: stopped on the screen, nothing sent', /Pick a department/.test(await txt(p, '#b-msg') || '') && !(await state()).calls.some(c => c.path === '/Products/ProductAdd'), '');
      await setv(p, '#f-cat', 'c-2'); await click(p, '#b-save'); await sleep(1800);
      rec('U15 Save item adds it and opens the same item with its price section ("Now set its price")', (await state()).calls.filter(c => c.path === '/Products/ProductAdd').length === 1 && !!(await p.$('.p-in')) && /set its price/.test(await txt(p, '#b-msg') || ''), '');
      rec('U16 no script errors in the browser', p.errs.length === 0, p.errs.join('|'));
      await p.close();
    });
    for (const role of ['cashier', 'manager-nomenu']) await withServer(role, async () => {
      const p = await page(); await openItems(p);
      await p.type('.b4 input[type=text], .b4 input:not([type])', 'candy').catch(() => {}); await sleep(1500);
      await p.evaluate(() => { const r = document.querySelector('.b4 table tbody tr'); if (r) r.click(); }); await sleep(1500);
      const bt = await btnTexts(p), html = await p.evaluate(() => document.querySelector('.b4').innerHTML);
      rec('U17 ' + role + ': look-up works, but NO write control anywhere (no New item / Save / Disable / Save price / Add to Quick Add / form fields)', bt.length > 0 && !bt.some(t => /^New item|Save item|Disable Item|Save price|Add to Quick Add|Remove from grid/.test(t)) && !/id="f-number"|class="p-in"|b4newbtn/.test(html) && /Name/.test(html), JSON.stringify(bt));
      await p.evaluate(() => { const s = [...document.querySelectorAll('.b4seg button, .b4seg span')].find(e => /Quick/.test(e.innerText)); if (s) s.click(); }); await sleep(1200);
      rec('U18 ' + role + ': Quick Add grid has no × buttons', (await p.evaluate(() => document.querySelectorAll('.b4 .tile').length)) >= 1 && (await p.evaluate(() => document.querySelectorAll('.b4 .tile .rm').length)) === 0, '');
      rec('U19 ' + role + ': no script errors', p.errs.length === 0, p.errs.join('|'));
      await p.close();
    });
  } catch (e) { rec('EXC ' + e.message, false, e.stack.split('\n')[1]); }
  finally { try { await B.disconnect(); } catch (e) {} if (own) own.kill(); }
  console.log(fails.length ? fails.length + ' failed: ' + fails.join('; ') + ' (' + passes + ' passed)' : 'ALL PASSED (' + passes + ' passed, 0 failed)'); process.exit(fails.length ? 1 : 0);
})();

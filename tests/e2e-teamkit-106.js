// AirMax 1.0.6 Team Kit fix (Ari "On the whole thing", 10/30): Order History "Resume" now asks first when the current sale
// has items, the same as Held Orders > Resume already did. Before, it cleared the current sale without asking.
// Also: Alt+letter key labels on blue/green/red window buttons were grey on blue (unreadable); now they use the button's text colour.
// OFFLINE fake AIR POS (made-up data, no account). Run: FAKE_HELD=1 FAKE_PORT=5180 node tests/look-fake.js &  FAKE_PORT=5180 node tests/e2e-teamkit-106.js
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
(async () => {
  const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const page = await b.newPage();
  let answer = true, asked = [];
  page.on('dialog', d => { asked.push(d.message()); answer ? d.accept() : d.dismiss(); });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/'); await sleep(800);
  const st = () => page.evaluate(() => fetch('/api/state').then(r => r.json()));
  const apiP = (r, x) => page.evaluate((r, x) => fetch('/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), r, x);
  const fill = async (sel, v) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, v); };
  const scan = async c => { await page.focus('#scanInput'); await page.type('#scanInput', c); await page.keyboard.press('Enter'); await sleep(900); };
  const cart = () => page.evaluate(() => S.cart.map(x => x.number || x.name).join(','));
  if (!(await st()).loggedIn) { await fill('#lgCompany', 'fake shop'); await fill('#lgUser', 'tester'); await fill('#lgPw', 'fake'); await page.click('#lgBtn'); await sleep(2500); }
  await apiP('pay-close'); await apiP('new-sale'); await page.goto(BASE + '/'); await sleep(1200);
  rec('login to fake AIR POS', (await st()).loggedIn, '');

  // a held order (1001), then a new sale with 1002 on it
  await scan('1001'); await page.evaluate(() => act('hold')); await sleep(1200);
  const held = await apiP('held'); const hid = (held.rows || [])[0] && held.rows[0].id;
  rec('a held order exists', !!hid, (held.rows || []).length + ' held');
  await scan('1002'); const before = await cart();
  // Order History lists the held order (the fake's history has no held rows, so the list shows the real held id with status 15)
  await page.setRequestInterception(true);
  const onReq = q => { if (q.url().endsWith('/api/orders')) return q.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rows: [{ id: hid, number: 'H100', status: 15, statusName: 'Pending', quantity: 1, amount: 10, tax: 0 }] }) }); q.continue(); }; page.on('request', onReq);
  const openHist = async () => { await page.evaluate(() => A.history()); await sleep(900); return page.$('#modalRoot [data-res]'); };

  // 1) No on the question: nothing changes, the current sale stays, History stays open
  answer = false; asked = []; let btn = await openHist(); await btn.click(); await sleep(1200);
  const afterNo = await cart(), stillOpen = await page.$eval('#modalRoot h2', e => e.textContent).catch(() => '');
  rec('History Resume with items on the sale asks first', asked.length === 1 && /current sale will be cleared/.test(asked[0]), JSON.stringify(asked));
  rec('Answering No keeps the current sale and History open', afterNo === before && /Order History/.test(stillOpen), `before ${before} after ${afterNo} modal "${stillOpen}"`);
  // 2) Yes: the held order is loaded (as before the fix)
  answer = true; asked = []; await page.evaluate(() => closeModal()); btn = await openHist(); await btn.click(); await sleep(1800);
  const afterYes = await cart(); const s = await st();
  rec('Answering Yes resumes the held order (same as before)', asked.length === 1 && afterYes !== before && s.order && s.order.resuming, `cart ${afterYes}`);
  // 3) empty sale: no question (same as Held Orders)
  page.off('request', onReq); await page.setRequestInterception(false); await apiP('new-sale'); await page.goto(BASE + '/'); await sleep(1000);
  asked = []; await page.evaluate(() => { S.cart = []; }); await page.evaluate(() => historyDialog()); await sleep(800);
  rec('Empty sale: no extra question (History opens normally)', asked.length === 0, '');
  // 4) Alt+letter key labels readable on coloured buttons (Customer window: Find = blue, New customer = green). Before 1.0.6 the
  //    label was grey text on blue/green (contrast about 1.5:1). Needs at least 3:1 against the button colour (opacity counted).
  const contrast = () => page.evaluate(() => {
    const rgb = c => (c.match(/[\d.]+/g) || []).map(Number), lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    return [...document.querySelectorAll('#modalRoot button.pbtn kbd.dk')].filter(k => k.getClientRects().length).map(k => {
      const b = k.closest('button'), bg = rgb(getComputedStyle(b).backgroundColor), fg = rgb(getComputedStyle(k).color), op = Number(getComputedStyle(k).opacity);
      const mix = fg.slice(0, 3).map((v, i) => v * op + bg[i] * (1 - op)); const L1 = lum(mix), L2 = lum(bg.slice(0, 3));
      return { t: b.innerText.replace(/\s+/g, ' ').trim(), r: Math.round((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) * 10) / 10 }; }); });
  await page.evaluate(() => A.customer()); await sleep(900);
  const cs = await contrast();
  rec('Customer window: every Alt+letter label readable on its button (>= 3:1)', cs.length >= 2 && cs.every(x => x.r >= 3), JSON.stringify(cs));
  await page.evaluate(() => closeModal()); await page.evaluate(() => historyDialog()); await sleep(900);
  const hs = await contrast(); await page.evaluate(() => closeModal());
  rec('History window: every Alt+letter label readable on its button (>= 3:1)', hs.every(x => x.r >= 3), JSON.stringify(hs));
  rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
  await apiP('new-sale'); await page.close(); b.disconnect();
  const bad = out.filter(x => !x.pass).length; console.log(`${out.length - bad}/${out.length} Team Kit checks passed (AirMax 1.0.6)`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

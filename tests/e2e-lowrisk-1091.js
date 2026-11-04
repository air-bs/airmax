// AirMax local 1.0.9.1 low-risk UI fixes (Stress Tester findings), UI e2e against the OFFLINE fake AIR POS (no account, no store):
//  a) Product Search: a late search reply after Esc closed the box no longer throws PAGE_ERROR (null innerHTML)
//  d) ask-price bulk button for an item already on the sale: refused BEFORE the price box opens; the next tap works
//  (e, the exchange done screen, was reverted: it needs a change in the frozen money files register.js / quickreturn.js)
// Run: FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 CHROME_URL=http://127.0.0.1:9433 node tests/e2e-lowrisk-1091.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    let slowSearch = 0; await p.setRequestInterception(true);
    p.on('request', q => { if (slowSearch && q.url().endsWith('/api/search')) setTimeout(() => q.continue().catch(() => {}), slowSearch); else q.continue().catch(() => {}); });
    await p.bringToFront(); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const toastTxt = () => p.$eval('#toast', e => e.textContent).catch(() => '');
    const modalOpen = () => p.evaluate(() => !!$('modalRoot').firstChild);
    const cart = async () => (await state()).cart || [];

    // a) Product Search: type, Esc before the (slow) reply comes back
    slowSearch = 1500;
    await p.evaluate(() => searchDialog()); await sleep(200); await p.type('#sIn', 'rope'); await sleep(450); // debounce fired, reply still out
    await p.keyboard.press('Escape'); await sleep(2600);
    const aErr = errs.filter(e => /innerHTML/.test(e));
    rec('a) Product Search closed with Esc while a search is out: no PAGE_ERROR (null innerHTML)', !aErr.length && !(await modalOpen()), `page errors ${JSON.stringify(aErr)}, box open ${await modalOpen()}`);
    await p.evaluate(() => searchDialog()); await sleep(2200); // initial empty search, slow
    const rows = await p.$$eval('#sRes tr', t => t.length).catch(() => 0);
    rec('a) Product Search still lists products when left open (slow reply)', rows > 0, `${rows} rows`);
    await p.keyboard.press('Escape'); await sleep(400); slowSearch = 0;

    // d) ask-price bulk button, second press for the same item
    await post('settings', { bulkItems: [{ label: 'Candy', code: '1001', name: 'Bulk candy', askPrice: true }, { label: 'Rope', code: '1003', name: 'Rope', askPrice: false }], bulkFolders: [], bulkOrder: [] });
    await p.evaluate(() => refresh()); await sleep(600);
    const tap = async n => { await p.click(`#bulkBtns [data-bulk="${n}"]`); await sleep(900); };
    await tap(0); const priceBox = await p.$('#bpIn').then(Boolean);
    if (priceBox) { await p.type('#bpIn', '10'); await p.keyboard.press('Enter'); await sleep(1200); }
    let c = await cart();
    rec('d) first Candy tap: price box, then added at the typed price', priceBox && c.length === 1 && c[0].number === '1001' && c[0].quantity === 1 && !(await modalOpen()), JSON.stringify(c.map(l => [l.number, l.quantity, l.total])));
    await tap(0); const t2 = await toastTxt(), box2 = await modalOpen();
    c = await cart();
    rec('d) second Candy tap: refused right away (no price box), sale unchanged', !box2 && /already on this sale/.test(t2) && c.length === 1 && c[0].quantity === 1, `box ${box2}, toast "${t2}", cart ${JSON.stringify(c.map(l => [l.number, l.quantity]))}`);
    await p.screenshot({ path: SCR + 'v1091-bulk-refused-1366.png' });
    await tap(1); c = await cart();
    rec('d) the next tap (Rope) is not swallowed: Rope added', c.some(l => l.number === '1003' && l.quantity === 1) && c.length === 2, JSON.stringify(c.map(l => [l.number, l.quantity])));
    const srv = await post('bulk-add', { index: 0, price: 10 }); c = await cart();
    rec('d) server check unchanged (direct bulk-add still refused, +1 undone)', !srv.ok && /already on this sale/.test(srv.message) && c.find(l => l.number === '1001').quantity === 1, srv.message);
    await post('new-sale'); await post('settings', { bulkItems: [], bulkFolders: [], bulkOrder: [] });

    rec('no page errors in the whole run', !errs.length, JSON.stringify(errs));
    await p.close();
  } catch (e) { rec('run', false, e.stack || e.message); }
  b.disconnect();
  const pass = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-lowrisk-1091-results.json'), JSON.stringify({ pass, total: out.length, out }, null, 1));
  console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

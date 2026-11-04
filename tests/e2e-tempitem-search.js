// Temporary Item (was "Open Item") in the left Actions column + product search prices (Ari 11:05 PM ET Oct 31, local only),
// against the OFFLINE fake AIR POS (ProductPaged in the real shape: retailPrice 0, price in shopPrices / standardPrices).
// Run: FAKE_SEARCH_EXTRA=1 FAKE_PORT=5190 node tests/look-fake.js &
//      FAKE_PORT=5190 CHROME_URL=http://127.0.0.1:9440 node tests/e2e-tempitem-search.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const WANT = { '1001': '$10.00', '1002': '$5.00', '1003': '$2.00', '1004': '$1.50', '1005': '—', '1006': '$6.00' };
(async () => {
  fs.mkdirSync(SCR, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.evaluate(() => { try { localStorage.removeItem('airreg.buttonLayout'); localStorage.removeItem('airreg.hiddenButtons'); } catch {} }).catch(() => {});
    await p.goto(BASE + '/'); await sleep(1800);
    await p.evaluate(() => { localStorage.removeItem('airreg.buttonLayout'); localStorage.removeItem('airreg.hiddenButtons'); }); await p.reload(); await sleep(1800);
    const txt = sel => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => null);
    // 1. buttons
    const col = await p.evaluate(() => [...document.querySelectorAll('#actions [data-a]')].filter(e => e.offsetParent).map(e => ({ a: e.dataset.a, t: e.innerText.replace(/\s+/g, ' ').trim(), bottom: Math.round(e.getBoundingClientRect().bottom) })));
    const ids = col.map(x => x.a), iG = ids.indexOf('gift-receipt'), iT = ids.indexOf('open-item');
    rec('Left column has a "Temporary Item F7" button right after Add Gift Receipt', iT >= 0 && iT === iG + 1 && /^(\S+ )?Temporary Item F7$/.test(col[iT].t), ids.join(',') + ' | ' + (iT >= 0 ? col[iT].t : ''));
    rec('Left column still fits 1366 x 768 (no scrolling)', Math.max(...col.map(x => x.bottom)) <= 768 - 20, 'last bottom ' + Math.max(...col.map(x => x.bottom)));
    const rt = await txt('#right .rbtn[data-a="open-item"]');
    rec('Right-side button is renamed "Temporary Item" and keeps F7', /^Temporary Item F7$/.test(rt || ''), rt);
    const stripe = await p.$eval('#actions .abtn[data-a="open-item"]', e => getComputedStyle(e).boxShadow);
    const stripeR = await p.$eval('#right .rbtn[data-a="open-item"]', e => getComputedStyle(e).boxShadow);
    rec('Left Temporary Item has the green stripe like the right one', /inset/.test(stripe) && /rgb\(/.test(stripe) && stripe.match(/rgb\([^)]*\)/)[0] === (stripeR.match(/rgb\([^)]*\)/) || [])[0], stripe + ' | ' + stripeR);
    const body = await p.evaluate(() => document.body.innerText);
    rec('No "Open Item" text left on the register screen', !/Open Item/i.test(body), '');
    await p.screenshot({ path: SCR + 'tempitem-left-column.png', clip: { x: 0, y: 0, width: 420, height: 768 } });
    await p.screenshot({ path: SCR + 'tempitem-register.png' });
    // 2. left button opens the Temporary Item window and adds the line (same action as F7)
    const n0 = (await state()).cart.length;
    await p.click('#actions .abtn[data-a="open-item"]'); await sleep(700);
    const h = await txt('#modal h2, .modal h2, dialog h2');
    rec('Left button opens the "Temporary Item" window', h === 'Temporary Item', h);
    await p.screenshot({ path: SCR + 'tempitem-dialog.png' });
    await p.type('#tiName', 'Temp test'); await p.type('#tiPrice', '2.25'); await p.keyboard.press('Enter'); await sleep(1800);
    let s = await state(); const tl = s.cart.find(c => c.type === 10 && /Temp test/.test(c.name));
    rec('Temporary Item from the left button adds a temporary line (type 10) at the typed price', !!tl && s.cart.length === n0 + 1 && Math.abs(Number(tl.price) - 2.25) < 0.001, tl ? `${tl.name} ${tl.price}` : 'none');
    await p.focus('#scanInput'); await p.keyboard.press('F7'); await sleep(700);
    const h7 = await txt('#modal h2, .modal h2, dialog h2');
    rec('F7 opens the same "Temporary Item" window', h7 === 'Temporary Item', h7);
    await p.keyboard.press('Escape'); await sleep(400);
    await p.click('#right .rbtn[data-a="open-item"]'); await sleep(700);
    const hr = await txt('#modal h2, .modal h2, dialog h2');
    rec('Right button opens the same window', hr === 'Temporary Item', hr); await p.keyboard.press('Escape'); await sleep(400);
    // 3. keys overlay (F1)
    await p.focus('#scanInput'); await p.keyboard.press('F1'); await sleep(700);
    const ov = await p.evaluate(() => document.body.innerText);
    rec('Keys overlay (F1) says "Temporary Item", not "Open Item"', /Temporary Item/.test(ov) && !/Open Item/i.test(ov), '');
    await p.keyboard.press('Escape'); await sleep(400);
    // 4. search prices: API
    const api = await post('search', { keyword: '' });
    const got = Object.fromEntries((api.rows || []).map(r => [r.number, r.price]));
    rec('Search API: prices come from shopPrices / standardPrices (retailPrice is 0)', got['1001'] === 10 && got['1002'] === 5 && got['1003'] === 2 && got['1004'] === 1.5, JSON.stringify(got));
    rec('Search API: an item with no price gives null (not 0)', got['1005'] === null, String(got['1005']));
    rec('Search API: shop price $6 vs standard $4 -> the scan price ($6) is shown', got['1006'] === 6, String(got['1006']));
    // 5. search dialog (Ctrl+F)
    await post('new-sale'); await sleep(500); await p.focus('#scanInput');
    await p.keyboard.down('Control'); await p.keyboard.press('f'); await p.keyboard.up('Control'); await sleep(1500);
    const tbl = await p.$$eval('#sRes tr.row', l => l.map(tr => [...tr.children].map(td => td.innerText.trim())));
    const shown = Object.fromEntries(tbl.map(r => [r[0], r[3]]));
    rec('Product Search window shows each price ("—" when AIR POS has none)', Object.keys(WANT).every(k => shown[k] === WANT[k]), JSON.stringify(shown));
    await p.screenshot({ path: SCR + 'tempitem-search-prices.png' });
    await p.type('#sIn', 'yo-yo'); await sleep(1500);
    await p.keyboard.press('Enter'); await sleep(1500);
    s = await state(); const yo = s.cart.find(c => c.number === '1006');
    rec('Adding from search still uses the scan price ($6)', !!yo && Number(yo.price) === 6 && s.cart.length === 1, yo ? `${yo.name} ${yo.price}` : JSON.stringify(s.cart.map(c => c.name)));
    await p.focus('#scanInput'); await p.keyboard.down('Control'); await p.keyboard.press('f'); await p.keyboard.up('Control'); await sleep(900);
    await p.type('#sIn', 'widget'); await sleep(1500); await p.keyboard.press('Enter'); await sleep(1500);
    s = await state();
    rec('Unpriced item from search is refused by AIR POS (sale unchanged)', s.cart.length === 1 && !s.cart.some(c => c.number === '1005'), JSON.stringify(s.cart.map(c => c.name)));
    await post('dismiss'); await p.keyboard.press('Escape'); await sleep(500);
    // 6. side panel quick search
    await p.click('#qsIn', { clickCount: 3 }); await p.keyboard.type('o'); await sleep(1500);
    const qs = await p.$$eval('#qsRes [data-i]', l => l.map(d => ({ n: d.querySelector('small').innerText.split(' ')[0], b: d.querySelector('b').innerText.trim() })));
    const qm = Object.fromEntries(qs.map(x => [x.n, x.b]));
    rec('Side panel quick search shows prices too ("—" for none)', qs.length > 0 && qs.every(x => !WANT[x.n] || x.b === WANT[x.n]) && qm['1002'] === '$5.00', JSON.stringify(qm));
    await p.screenshot({ path: SCR + 'tempitem-side-search.png' });
    rec('No page errors', !errs.length, errs.join(' | '));
    await post('new-sale'); await p.close();
  } catch (e) { rec('test ran', false, e.stack || e.message); }
  finally { b.disconnect(); }
  const pass = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-tempitem-search-results.json'), JSON.stringify(out, null, 1));
  console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

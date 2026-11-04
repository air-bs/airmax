// Store request #14 (Nov 2): when AIR POS stops answering, Air Max never looks frozen: after 3 s a "Still working… waiting for AIR POS" banner shows,
// the sale stays on screen unchanged, the message says "Can't reach AIR POS" in plain words, and the next try works. OFFLINE fake AIR POS;
// the fake is told to hang for 5 s on the next scan and then report "ETIMEDOUT" (/fault?mode=hang). No money is involved.
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const banner = () => p.evaluate(() => { const o = document.getElementById('awaitpos'); return o && o.style.display !== 'none' ? o.innerText.replace(/\s+/g, ' ') : null; });
    const rows = () => p.$$eval('#cart tr.row', t => t.length);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); };
    await scan('1001'); await sleep(1500);
    const s0 = await state(); const tot0 = JSON.stringify(s0.totals);
    rec('L1 normal scan: line added, no banner', s0.cart.length === 1 && !(await banner()), `lines ${s0.cart.length}`);
    await hook('/fault?path=/Orders/RetailOrderSubGetByScan&mode=hang&ms=6000&n=1');
    const t0 = Date.now(); await scan('1002'); await sleep(1200);
    rec('L2 at 1 s of waiting: no banner yet (a normal short wait stays quiet)', !(await banner()), '');
    await sleep(3000);
    const bn = await banner();
    rec('L3 after ~4 s: the "Still working… waiting for AIR POS" banner is on screen', !!bn && /waiting for AIR POS/.test(bn), String(bn));
    const alive = await p.evaluate(() => 1 + 1), rowsNow = await rows();
    rec('L4 the page is not frozen and the sale is still on screen (1 line, same totals) while waiting', alive === 2 && rowsNow === 1 && JSON.stringify((await state()).totals) === tot0, `rows ${rowsNow}`);
    await p.screenshot({ path: '/tmp/lost-conn-14-wait.png' });
    await p.waitForFunction(() => { const o = document.getElementById('awaitpos'); return !o || o.style.display === 'none'; }, { timeout: 15000 }).catch(() => {});
    const dt = Date.now() - t0, msg = await p.$eval('#toast', e => e.textContent).catch(() => '');
    rec('L5 when AIR POS gives up the banner goes away by itself and the message is in plain words', !(await banner()) && /Can't reach AIR POS/.test(msg) && !/ETIMEDOUT.*ETIMEDOUT/.test(msg), `${dt} ms: ${msg}`);
    const s1 = await state();
    rec('L6 the sale is unchanged after the failure: still 1 line, same totals, nothing added', s1.cart.length === 1 && JSON.stringify(s1.totals) === tot0, `lines ${s1.cart.length}`);
    await scan('1002'); await sleep(2000);
    const s2 = await state();
    rec('L7 trying again works: 2 lines, totals = sum of the lines', s2.cart.length === 2 && Math.abs(s2.totals.itemAmount - s2.cart.reduce((a, l) => a + l.total, 0)) < 0.005, `lines ${s2.cart.length}, itemAmount ${s2.totals.itemAmount}`);
    rec('L8 no banner left over', !(await banner()), '');
    rec('L9 no page errors', errs.length === 0, errs.join('; ') || 'none');
    await hook('/fault-clear'); await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

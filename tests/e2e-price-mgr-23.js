// Store request #23/#6 (Gordon, Nov 3 2026): the left-column "Price Change" button is MANAGER-ONLY. A cashier who presses it gets the manager login
// (same dialog as Tax Off); the sale is unchanged until a manager approves; wrong login is refused; a manager's login lets the cashier change THIS line's
// price (lower only); the server refuses without approval even when the screen is skipped. A logged-in manager goes straight through. OFFLINE fake AIR POS only:
// FAKE_PORT = manager fake, CASHIER_PORT = FAKE_CASHIER=1 fake (manager login "boss" / "boss-pw"). Run via tests/run-all-look.sh.
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), CP = Number(process.env.CASHIER_PORT || 5070);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const mk = port => { const B = 'http://127.0.0.1:' + port; return { B, post: (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), state: () => fetch(B + '/api/state').then(r => r.json()) }; };
const c2 = x => Math.round(x * 100) / 100;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    const K = mk(CP), M = mk(FP);
    for (const X of [K, M]) { if (!(await X.state()).loggedIn) await X.post('login', { company: 'fake shop', user: 'tester', password: 'x' }); await X.post('pay-close'); await X.post('new-sale'); await X.post('dismiss'); await X.post('scan', { code: '1001' }); }
    const sk = await K.state(), sm = await M.state();
    rec('0 the two fakes: one cashier, one manager', sk.user && !sk.user.manager && sm.user && sm.user.manager, `cashier.manager=${sk.user && sk.user.manager} manager.manager=${sm.user && sm.user.manager}`);
    const orig = sk.cart[0].price, tot0 = JSON.stringify(sk.totals);
    // server side, screen skipped
    const a0 = await K.post('price-change', { row: 0, value: String(c2(orig - 0.4)) }); let s = await K.state();
    rec('1 server: cashier without approval is refused (needManager), price unchanged', !a0.ok && a0.needManager && JSON.stringify(s.totals) === tot0, a0.message);
    const a1 = await K.post('price-change', { row: 0, value: String(c2(orig - 0.4)), user: 'boss', password: 'wrong' }); s = await K.state();
    rec('2 server: cashier with a WRONG manager login is refused, price unchanged', !a1.ok && JSON.stringify(s.totals) === tot0, a1.message);
    const a2 = await K.post('price-approve', {});
    rec('3 server: price-approve without a login says needManager', !a2.ok && a2.needManager, a2.message);
    // screen: cashier
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(K.B + '/'); await sleep(1500);
    const modalText = () => p.evaluate(() => { const m = document.querySelector('#modalRoot .modal'); return m ? m.innerText : null; });
    await p.click('#cart tr.row'); await sleep(200);
    await p.click('#actions button[data-a="price-change"]'); await sleep(600);
    let mt = await modalText();
    rec('4 cashier presses Price Change: the manager login appears, NOT the item window; sale unchanged', /Price Change/.test(mt || '') && /Manager user name/.test(mt || '') && !/Item discount/.test(mt || '') && JSON.stringify((await K.state()).totals) === tot0, (mt || '').replace(/\s+/g, ' ').slice(0, 90));
    await p.type('#mlU', 'boss'); await p.type('#mlP', 'wrong-pw'); await p.keyboard.press('Enter'); await sleep(900); mt = await modalText();
    rec('5 wrong manager login: refused, still no item window, sale unchanged', /Manager user name/.test(mt || '') && !/Item discount/.test(mt || '') && JSON.stringify((await K.state()).totals) === tot0, ((await p.$eval('#mlMsg', e => e.textContent).catch(() => '')) || '').slice(0, 80));
    await p.$eval('#mlP', e => { e.value = ''; }); await p.$eval('#mlU', e => { e.value = ''; }); await p.type('#mlU', 'boss'); await p.type('#mlP', 'boss-pw'); await p.keyboard.press('Enter'); await sleep(900); mt = await modalText();
    const tab = await p.$eval('#modalRoot .tab.on', e => e.dataset.k).catch(() => null);
    rec('6 manager login accepted: the item window opens on "New price"', /Item discount/.test(mt || '') && tab === 'price', `tab=${tab}`);
    const hi = c2(orig + 1); await p.type('#ldVal', String(hi)); await p.keyboard.press('Enter'); await sleep(800);
    rec('7 a HIGHER price is still refused, line unchanged', /can only lower/i.test(await p.$eval('#ldMsg', e => e.textContent).catch(() => '')) && JSON.stringify((await K.state()).totals) === tot0, 'refused');
    const target = c2(orig - 0.4); await p.$eval('#ldVal', e => { e.value = ''; }); await p.type('#ldVal', String(target)); await p.keyboard.press('Enter'); await sleep(900);
    s = await K.state(); const l = s.cart[0];
    rec('8 approved: new price applied to THIS sale only, to the cent', Math.abs(l.total - c2(target * l.quantity)) < 0.005 && Math.abs(l.discountAmount - c2((orig - target) * l.quantity)) < 0.005, `orig ${orig} new ${target}: total ${l.total} discount ${l.discountAmount}`);
    // a second press asks again (approval is not kept)
    await p.click('#cart tr.row'); await sleep(200); await p.click('#actions button[data-a="price-change"]'); await sleep(600); mt = await modalText();
    rec('9 the next press by the cashier asks for a manager again (no standing approval)', /Manager user name/.test(mt || ''), (mt || '').replace(/\s+/g, ' ').slice(0, 60));
    await p.keyboard.press('Escape'); await sleep(300);
    // manager: straight through
    const pm = await b.newPage(); await pm.bringToFront(); await pm.goto(M.B + '/'); await sleep(1500);
    await pm.click('#cart tr.row'); await sleep(200); await pm.click('#actions button[data-a="price-change"]'); await sleep(600);
    const mm = await pm.evaluate(() => { const m = document.querySelector('#modalRoot .modal'); return m ? m.innerText : null; });
    rec('10 a logged-in AIR POS manager goes straight to the item window (no prompt)', /Item discount/.test(mm || '') && !/Manager user name/.test(mm || ''), (mm || '').replace(/\s+/g, ' ').slice(0, 60));
    await pm.keyboard.press('Escape');
    // label unchanged
    const lab = await p.$$eval('#actions button[data-a="price-change"]', bs => bs.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    rec('11 the button label is unchanged ("Price Change")', lab.length === 1 && /Price Change/.test(lab[0]), lab.join('|'));
    rec('12 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close(); await pm.close();
  } catch (e) { rec('test ran', false, e.stack || e.message); }
  const n = out.filter(x => x.pass).length; console.log(`${n}/${out.length} passed`); b.disconnect(); process.exit(n === out.length ? 0 : 1);
})();

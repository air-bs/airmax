// 1.0.11-local.3: the F4 Item discount dialog on the real screen against the OFFLINE fake AIR POS: tabs % off / $ off / New price,
// a line with its own discount opens prefilled (to change or remove it), New price above the original refused, equal = no discount,
// totals = the fake AIR POS answer. Labels kept: "% off", "$ off", "Remove item discount", "Apply (Enter)", "Cancel".
//   FAKE_PORT=5180 node tests/e2e-f4-price.js   (Chrome on CHROME_URL, default 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('scan', { code: '1001' }); await post('qty', { row: 0, qty: 2 });
    await p.goto(BASE + '/'); await sleep(1500);
    const modal = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const val = () => p.$eval('#ldVal', e => e.value).catch(() => null);
    const tabOn = () => p.$eval('#modalRoot .tab.on', e => e.dataset.k).catch(() => null);
    const f4 = async () => { await p.click('#cart tr.row'); await sleep(200); await p.keyboard.press('F4'); await sleep(500); };
    const typeEnter = async v => { await p.$eval('#ldVal', e => { e.value = ''; }); await p.type('#ldVal', v); await p.keyboard.press('Enter'); await sleep(1500); };
    const s0 = await state(); const full = s0.totals.due;
    await f4(); let m = await modal();
    rec('D1 F4 shows % off / $ off / New price; Cancel and Apply (Enter) labels kept; no Remove button without a discount', /% off/.test(m) && /\$ off/.test(m) && /New price/.test(m) && /Cancel/.test(m) && /Apply \(Enter\)/.test(m) && !/Remove item discount/.test(m) && (await tabOn()) === 'percent' && (await val()) === '', m.replace(/\s+/g, ' ').slice(0, 160));
    await p.click('#modalRoot .tab[data-k="price"]'); await sleep(200); m = await modal();
    rec('D2 New price tab names the original price ($10.00 each)', /Original price \$10\.00 each/.test(m), m.replace(/\s+/g, ' ').slice(0, 200));
    await typeEnter('10.50'); m = await modal(); let s = await state();
    rec('D3 New price $10.50 above the original: refused in the dialog, nothing applied (Ari 4:34 PM)', /higher than the original \$10\.00/.test(m) && s.totals.due === full && !s.cart[0].custom, m.replace(/\s+/g, ' ').slice(0, 200));
    await typeEnter('10'); s = await state();
    rec('D4 New price equal to the original: no discount, dialog closes, total unchanged', !(await modal()).trim() && s.totals.due === full && !s.cart[0].custom, `due ${s.totals.due}`);
    await f4(); await p.click('#modalRoot .tab[data-k="price"]'); await sleep(200); await typeEnter('7.49'); s = await state();
    const exp = Math.round(7.49 * 2 * 1.08 * 100) / 100;
    rec('D5 New price $7.49 x 2: line $5.02 off, total = fake AIR POS answer $' + exp, s.cart[0].custom && s.cart[0].dm === 20 && s.cart[0].discountAmount === 5.02 && Math.abs(s.totals.due - exp) < 0.005 && s.cart[0].price === 10, `disc ${s.cart[0].discountAmount} due ${s.totals.due} price ${s.cart[0].price}`);
    await f4(); m = await modal();
    rec('D6 F4 again opens prefilled on "$ off 5.02" with "Remove item discount"', (await tabOn()) === 'amount' && (await val()) === '5.02' && /Remove item discount/.test(m), `${await tabOn()} ${await val()}`);
    await typeEnter('3'); s = await state();
    rec('D7 change the prefilled discount to $3 off', s.cart[0].discountAmount === 3 && Math.abs(s.totals.due - Math.round(17 * 1.08 * 100) / 100) < 0.005, `due ${s.totals.due}`);
    await post('line-discount', { row: 0, kind: 'percent', value: 15 }); await p.goto('about:blank'); await p.goto(BASE + '/'); await sleep(1500); await f4();
    rec('D8 a % discount opens prefilled on "% off 15"', (await tabOn()) === 'percent' && (await val()) === '15', `${await tabOn()} ${await val()}`);
    await p.click('#ldClr'); await sleep(1500); s = await state();
    rec('D9 Remove item discount restores the full total', !s.cart[0].custom && s.totals.due === full, `due ${s.totals.due}`);
    rec('D10 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    await post('new-sale');
  } catch (e) { rec('run', false, e.stack); }
  finally { if (p) await p.close().catch(() => {}); b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

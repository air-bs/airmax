// AirMax Extra 12 (customer Discount, top strip of the Customers > Credit box). Browser test on the fake AIR POS (made-up customers). Screenshots when B12_SHOTS=<folder>.
//   FAKE_PORT=5320 CHROME_URL=http://127.0.0.1:9462 node tests/e2e-api-12-credit-limit.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5320), BASE = 'http://127.0.0.1:' + FP, HB = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = p => fetch(HB + p).then(r => r.json());
const SHOTS = process.env.B12_SHOTS || '';
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9462', defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    const login = () => post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await hook('/cust-reset'); await hook('/disc-reset');
    if (!(await fetch(BASE + '/api/state').then(r => r.json())).loggedIn) await login();
    await hook('/disc-seed?id=m-edit2&discount=10'); await hook('/cust-credit-seed?id=m-edit2&allow=0&amount=0');
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    const shot = async (n, sel) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const f = path.join(SHOTS, n + '.png'); await p.screenshot({ path: f }); };
    const txt = sel => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
    const openDana = async () => { await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="customers"]').click()); await sleep(1200); await p.click('#cuGo'); await sleep(800);
      await p.evaluate(() => [...document.querySelectorAll('#cuList .cu-row')].find(r => /Dana/.test(r.textContent)).click()); await sleep(1300); };
    const setVal = async v => { await p.evaluate(x => { const a = document.getElementById('cuDisc'); a.value = x; a.dispatchEvent(new Event('input')); }, v); await sleep(150); };
    const st = () => hook('/disc-state?id=m-edit2');
    await openDana();
    const d1 = await p.evaluate(() => { const box = document.querySelector('#cuCredit .cu-credit'), s = box && box.querySelector('.cu-strip'), row = box && box.querySelector('.row'), i = document.getElementById('cuDisc');
      return s ? { inBox: true, above: s.getBoundingClientRect().bottom <= row.getBoundingClientRect().top + 1, first: box.children[1] === document.getElementById('cuDisc') || box.children[1].contains(s), text: s.textContent.replace(/\s+/g, ' ').trim(), val: i.value, dis: document.getElementById('cuDiscSave').disabled, inputOn: !i.disabled } : { inBox: false }; });
    rec('D1 manager: the top strip of the Credit box (above the Allow / Credit Amount row) reads "Store credit now $12.50 | Discount [10] % (customer record)"; Save discount is greyed until it changes', d1.inBox && d1.above && d1.first && /^Store credit now \$12\.50\s*\|\s*Discount\s*%\s*\(customer record\)/.test(d1.text) && d1.val === '10' && d1.dis === true && d1.inputOn, JSON.stringify(d1));
    await shot('discount-1-manager-view');
    await setVal('15');
    rec('D2 typing a different number turns Save discount on', (await p.evaluate(() => document.getElementById('cuDiscSave').disabled)) === false, '');
    await p.click('#cuDiscSave'); await sleep(300);
    const cn = (await txt('#cuDiscNote')).replace(/\s+/g, ' ').trim();
    rec('D3 Save asks first with old and new: "Change Discount from 10% to 15% for Dana Sample?" (Save / Cancel); nothing sent yet', /^Change Discount from 10% to 15% for Dana Sample\?/.test(cn) && (await st()).saves === 0, cn);
    await shot('discount-2-confirm-10-to-15');
    await p.click('#cuDiscNote [data-no]'); await sleep(300);
    rec('D4 Cancel puts the saved 10 back; nothing sent', (await p.evaluate(() => document.getElementById('cuDisc').value === '10' && document.getElementById('cuDiscSave').disabled)) && (await st()).saves === 0, '');
    const badOnes = ['', '   ', '-5', '101', '100.5', 'abc', '1.234', '1e1', '10%', '.5'], toasts = [];
    for (const v of badOnes) { await setVal(v); await p.evaluate(() => { const s = document.getElementById('cuDiscSave'); s.disabled = false; }); await p.click('#cuDiscSave'); await sleep(250); toasts.push([await txt('#toast'), await txt('#cuDiscNote')]); }
    rec('D5 blank, spaces, negative, over 100, text, 3 decimals, exponent, "%", ".5" are refused ON THE SCREEN (message, no confirm card); AIR POS is not called', toasts.every(t => /Discount must be a number from 0 to 100/.test(t[0]) && t[1] === '') && (await st()).saves === 0, JSON.stringify(toasts.map(t => t[0].slice(0, 30))));
    await setVal('15'); await p.click('#cuDiscSave'); await sleep(250); await p.click('#cuDiscNote [data-yes]'); await sleep(1000);
    const h1 = await st();
    rec('D6 Save (confirmed, logged-in manager): no manager password window; AIR POS got ONE update with the whole record (19 fields), discount 15', !(await p.evaluate(() => !!document.getElementById('mlU') || !!document.getElementById('mlP'))) && h1.saves === 1 && h1.last.discount === 15 && Object.keys(h1.last).length === 19 && h1.bad.length === 0, JSON.stringify({ saves: h1.saves, d: h1.last && h1.last.discount, keys: h1.last && Object.keys(h1.last).length }));
    const keep = ['number', 'mobile', 'phone', 'firstName', 'middleName', 'lastName', 'company', 'email', 'receiveAutoEmail', 'province', 'city', 'address', 'zipCode', 'remark', 'status'].filter(k => JSON.stringify(h1.last[k]) !== JSON.stringify(h1.before[k]));
    rec('D7 every other field in that update equals the customer as AIR POS had it a moment before', keep.length === 0 && h1.last.creditAmount === 0 && h1.last.allowCreditPayment === false, JSON.stringify(keep));
    const d8 = await p.evaluate(() => ({ v: document.getElementById('cuDisc').value, dis: document.getElementById('cuDiscSave').disabled, toast: document.getElementById('toast').textContent, allow: document.getElementById('cuAllow').checked, amt: document.getElementById('cuAmt').value, note: document.getElementById('cuDiscNote').textContent }));
    rec('D8 saved: the strip shows 15, Save is greyed again, the toast says "Saved: Discount 15%", the credit row beside it is untouched (Allow off, 0.00)', d8.v === '15' && d8.dis === true && /Discount 15%/.test(d8.toast) && d8.allow === false && d8.amt === '0.00' && d8.note === '', JSON.stringify(d8));
    await shot('discount-3-saved');
    // a fresh read when the customer is opened again
    await p.keyboard.press('Escape'); await sleep(500); await openDana();
    rec('D9 opening the customer again reads 15 from AIR POS', (await p.evaluate(() => document.getElementById('cuDisc').value)) === '15', '');
    // AIR POS refuses: the screen says so and goes back to the saved value
    await hook('/disc-fail?mode=error&n=1'); await setVal('20'); await p.click('#cuDiscSave'); await sleep(250); await p.click('#cuDiscNote [data-yes]'); await sleep(900);
    const d10 = { toast: await txt('#toast'), v: await p.evaluate(() => document.getElementById('cuDisc').value), on: await p.evaluate(() => !document.getElementById('cuDiscSave').disabled), note: await txt('#cuDiscNote'), stored: (await hook('/disc-state?id=m-edit2')).rec.discount };
    rec('D10 AIR POS refuses the save: the toast says so, the typed 20 stays so it can be tried again (Save still on, no confirm card left), and AIR POS still has 15', /could not be saved/i.test(d10.toast) && d10.v === '20' && d10.on && d10.note === '' && d10.stored === 15, JSON.stringify(d10));
    // credit editor beside it still works (Batch 5), and does not touch the discount
    await p.click('#cuAllow'); await p.evaluate(() => { const a = document.getElementById('cuAmt'); a.value = '40.00'; a.dispatchEvent(new Event('input')); }); await p.click('#cuCrSave'); await sleep(250); await p.click('#cuCrNote [data-yes]'); await sleep(1500);
    const dd = await st();
    rec('D11 the Save credit button beside it still saves credit (Allow on, 40.00) and the discount stays 15 (the credit save carries it unchanged)', await p.evaluate(() => document.getElementById('cuAllow').checked && document.getElementById('cuAmt').value === '40.00' && document.getElementById('cuDisc').value === '15') && dd.last.discount === 15 && dd.last.creditAmount === 40, JSON.stringify({ d: dd.last.discount, c: dd.last.creditAmount }));
    // ---- cashier / no menu
    const relog = async mode => { await hook('/cust-role?mode=' + mode); await post('logout'); await login(); await p.goto(BASE + '/'); await sleep(2000); };
    await relog('cashier');
    await p.evaluate(() => { const t = document.querySelector('#tabbar .tab[data-tab="customers"]'); if (t) t.click(); }); await sleep(1200);
    await p.click('#cuGo'); await sleep(800); await p.evaluate(() => [...document.querySelectorAll('#cuList .cu-row')].find(r => /Dana/.test(r.textContent)).click()); await sleep(1200);
    const ck = await p.evaluate(() => ({ tab: !!document.querySelector('#cuWrap'), credit: !!document.getElementById('cuCredit') && document.getElementById('cuCredit').children.length, disc: !!document.getElementById('cuDisc') || !!document.querySelector('.cu-strip') || /Discount/.test((document.getElementById('cuCredit') || {}).textContent || '') }));
    const sv0 = (await st()).saves, rr = await Promise.all([post('cust-discount-get', { retailMemberId: 'm-edit2' }), post('cust-discount-save', { retailMemberId: 'm-edit2', discount: 50, confirmed: true })]);
    rec('D12 a cashier: the Customers tab works, but there is no Credit box and no Discount strip at all (nothing greyed), and both routes answer "forbidden" (nothing saved)', ck.tab && ck.credit === 0 && ck.disc === false && rr.every(x => x.ok === false && x.forbidden === true) && (await st()).saves === sv0, JSON.stringify({ ck, rr }).slice(0, 260));
    await shot('discount-4-cashier-view');
    await relog('nomenu');
    rec('D13 a login without Member Management: no Customers tab; the discount routes answer "forbidden"', (await p.evaluate(() => !(t => t && t.offsetWidth > 0)(document.querySelector('#tabbar .tab[data-tab="customers"]')))) && (await post('cust-discount-get', { retailMemberId: 'm-edit2' })).forbidden === true, '');
    await hook('/cust-reset'); await relog('super');
    rec('D14 no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 400)); }
  finally { try { if (p) await p.close(); } catch (e) {} b.disconnect(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

// airmax-fix-stock (live-store stuck paid sale, Nov 2 2026): ANY failure of Finish sale (stock refusal, server error, timeout, connection drop)
// keeps the real reason, logs it, shows it after "Check AIR POS again", and Finish sale retries SAFELY (a card is never charged twice;
// hold / resume / put aside are refused on a paid sale). Offline strict fake AIR POS only (made-up data).
// Run: FAKE_STRICT_COMPLETE=1 FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-stuck-stock-1011.js  (Chrome on 9433 for the screen part)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note || '').slice(0, 300)); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hookTxt = p => fetch(HOOK + p).then(r => r.text());
const strict = async () => JSON.parse(await hookTxt('/strict'));
const logText = () => fetch(BASE + '/export/log').then(r => r.text());
const rcvOf = (s, id) => (s.rcv[id] || []).length;
const completesOf = (s, id) => s.completes.filter(c => c.id === id).length;
async function newSale(code) {
  await post('pay-close'); await post('new-sale'); await post('dismiss'); await hookTxt('/fault-clear'); await hookTxt('/stock-refuse?on=0'); await hookTxt('/complete-refuse?n=0');
  const r = await post('scan', { code }); if (!r.ok) throw new Error('scan failed ' + r.message);
  const st = await state(); await post('pay-start'); return { id: st.order.id, due: (await state()).totals.due };
}
(async () => {
  if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
  if ((await strict()).promoFail === undefined) throw new Error('fake server is not in FAKE_STRICT_COMPLETE=1 mode');
  let s, st, r, lg;
  // ===== A: card-paid sale refused for stock (item 1002 has 0 in stock) =====
  let sale = await newSale('1002'); await hookTxt('/stock-refuse?on=1');
  r = await post('pay-tender', { type: 20, amount: sale.due }); s = await strict(); st = await state();
  rec('A1 card sale refused for stock: not completed, says why (AIR POS wording) and that payments are safe', !r.ok && !r.completed && r.completeFailed && /Insufficient inventory/.test(r.message) && /payments are safe/i.test(r.message), r.message);
  rec('A2 one card payment on AIR POS, the card is on the sale as paid', rcvOf(s, sale.id) === 1 && st.pay && st.pay.paid === sale.due, `receives ${rcvOf(s, sale.id)}, paid ${st.pay && st.pay.paid}`);
  rec('A3 the reason is kept on the sale (pay.lastError)', st.pay && /Insufficient inventory/.test(st.pay.lastError || ''), st.pay && st.pay.lastError);
  lg = await logText();
  rec('A4 log: one clear line with the reason AND the short item name', /FINISH SALE NOT DONE \[refused\][^\n]*Insufficient inventory[^\n]*short: Toy car \(0 in stock, selling 1\)/.test(lg), (lg.match(/FINISH SALE NOT DONE[^\n]*/) || ['no line'])[0]);
  r = await post('pay-recheck'); st = await state(); lg = await logText();
  rec('A5 Check AIR POS again: the reason is STILL shown (first), not replaced by the generic text', !r.ok && /^AIR POS refused to finish the sale: [^|]*Insufficient inventory/.test(r.message) && /Toy car \(0 in stock/.test(r.message) && /has not finished this sale yet/.test(r.message), r.message);
  rec('A6 ...and it stays on the sale for the red box after the recheck', st.pay && /Insufficient inventory/.test(st.pay.lastError || ''), st.pay && st.pay.lastError);
  rec('A7 log: every recheck writes a line with the last reason and the short items', /CHECK AGAIN pressed[^\n]*\[refused\][^\n]*Insufficient inventory[^\n]*short: Toy car/.test(lg), (lg.match(/CHECK AGAIN pressed[^\n]*/) || ['no line'])[0]);
  r = await post('pay-recheck'); rec('A8 a second recheck still shows the reason (nothing was overwritten)', /Insufficient inventory/.test(r.message), r.message);
  const f1 = await post('finish-sale'); s = await strict();
  rec('A9 Finish sale retried while AIR POS still refuses: same reason, still ONE card payment', !f1.ok && /Insufficient inventory/.test(f1.message) && rcvOf(s, sale.id) === 1, `${f1.message} | receives ${rcvOf(s, sale.id)}`);
  // never hold / resume / put aside / new sale on a paid sale
  const h = await post('hold'), rs = await post('resume', { orderId: sale.id }), pa = await post('aside-put'), ns = await post('new-sale'), cp = await post('pay-tender', { type: 20, amount: sale.due }); s = await strict(); st = await state();
  rec('A10 hold, resume, put aside and new sale are refused on the paid sale; a second card is refused', !h.ok && !rs.ok && !pa.ok && !ns.ok && !cp.ok && st.pay && st.pay.paid === sale.due && rcvOf(s, sale.id) === 1, JSON.stringify([h.message, rs.message, pa.message, ns.message, cp.message]).slice(0, 250));
  await hookTxt('/stock-refuse?on=0'); const f2 = await post('finish-sale'); s = await strict();
  rec('A11 stock fixed -> Finish sale completes with the SAME card payment (no second charge)', f2.ok && f2.completed && rcvOf(s, sale.id) === 1, `${f2.message || ''} receives ${rcvOf(s, sale.id)}, Complete calls ${completesOf(s, sale.id)}`);
  rec('A12 after it completes the failure note is gone', !(await state()).pay, 'pay cleared');
  await post('dismiss');
  // ===== B: stock check OFF at AIR POS (below-zero sales allowed): item with 0 stock completes =====
  sale = await newSale('1002'); r = await post('pay-tender', { type: 20, amount: sale.due }); s = await strict();
  rec('B1 below-zero sale by card completes at once, one card payment, nothing blocked before the card', r.ok && r.completed && rcvOf(s, sale.id) === 1 && !r.needStockOk && !r.stockBlocked, `${r.message || ''} receives ${rcvOf(s, sale.id)}`);
  await post('dismiss');
  // ===== C: Complete times out (server never saw it) =====
  sale = await newSale('1001'); await hookTxt('/fault?path=RetailOrderComplete&mode=timeout&n=2');
  r = await post('pay-tender', { type: 20, amount: sale.due }); s = await strict(); st = await state(); lg = await logText();
  rec('C1 Complete timed out: clear message with the reason, payments safe, retry offered', !r.ok && r.completeFailed && r.retryable && /TimeoutError/.test(r.message) && /Nothing is lost/.test(r.message) && /Finish sale/.test(r.message), r.message);
  rec('C2 the timeout reason is kept on the sale and logged', st.pay && /TimeoutError/.test(st.pay.lastError || '') && /FINISH SALE NOT DONE \[no reply\][^\n]*TimeoutError/.test(lg), (st.pay && st.pay.lastError || '').slice(0, 160));
  r = await post('pay-recheck'); rec('C3 Check AIR POS again keeps the timeout reason', /did not answer[^|]*TimeoutError/.test(r.message), r.message);
  r = await post('finish-sale'); rec('C4 Finish sale while it still times out: same way forward, still one card payment', !r.ok && r.retryable && /TimeoutError/.test(r.message) && rcvOf(await strict(), sale.id) === 1, r.message);
  r = await post('finish-sale'); s = await strict(); rec('C5 next Finish sale completes; ONE card payment in total', r.ok && r.completed && rcvOf(s, sale.id) === 1, `${r.message || ''} receives ${rcvOf(s, sale.id)}`);
  await post('dismiss');
  // ===== D: connection drop during Complete: (1) reply lost but AIR POS finished it, (2) call never arrived =====
  sale = await newSale('1001'); await hookTxt('/fault?path=RetailOrderComplete&mode=lost&n=1');
  r = await post('pay-tender', { type: 20, amount: sale.due }); s = await strict();
  rec('D1 reply lost but AIR POS DID finish: the register finds it completed, no second Complete needed, one card payment', r.ok && r.completed && rcvOf(s, sale.id) === 1, `${r.message || ''} receives ${rcvOf(s, sale.id)}, Complete calls ${completesOf(s, sale.id)}`);
  await post('dismiss');
  sale = await newSale('1001'); await hookTxt('/fault?path=RetailOrderComplete&mode=down&n=1');
  r = await post('pay-tender', { type: 20, amount: sale.due }); st = await state(); lg = await logText();
  rec('D2 connection down before Complete arrived: payment kept, reason ECONNREFUSED shown and logged', !r.ok && r.completeFailed && /ECONNREFUSED/.test(r.message) && /ECONNREFUSED/.test(st.pay.lastError || '') && /FINISH SALE NOT DONE \[no reply\][^\n]*ECONNREFUSED/.test(lg), r.message);
  r = await post('finish-sale'); s = await strict(); rec('D3 connection back: Finish sale completes, still one card payment', r.ok && r.completed && rcvOf(s, sale.id) === 1, `${r.message || ''} receives ${rcvOf(s, sale.id)}`);
  await post('dismiss');
  // ===== E: server error (HTTP 500) during Complete =====
  sale = await newSale('1001'); await hookTxt('/fault?path=RetailOrderComplete&mode=http500&n=1');
  r = await post('pay-tender', { type: 20, amount: sale.due }); st = await state(); lg = await logText();
  rec('E1 HTTP 500 from Complete: reason shown, payment kept, logged as server error', !r.ok && r.completeFailed && /HTTP 500/.test(r.message) && /Your payments are safe/.test(r.message) && /FINISH SALE NOT DONE \[server error\][^\n]*HTTP 500/.test(lg), r.message);
  r = await post('pay-recheck'); rec('E2 Check AIR POS again keeps the server error reason', /error finishing the sale: HTTP 500/.test(r.message), r.message);
  r = await post('finish-sale'); s = await strict(); rec('E3 retry completes; one card payment', r.ok && r.completed && rcvOf(s, sale.id) === 1, `${r.message || ''} receives ${rcvOf(s, sale.id)}`);
  await post('dismiss');
  sale = await newSale('1001'); await hookTxt('/fault?path=RetailOrderComplete&mode=http500-done&n=1');
  r = await post('pay-tender', { type: 20, amount: sale.due }); s = await strict();
  rec('E4 HTTP 500 although AIR POS finished the sale: the register sees it completed, no second Complete, one card payment', r.ok && r.completed && rcvOf(s, sale.id) === 1 && completesOf(s, sale.id) === 1, `${r.message || ''} Complete calls ${completesOf(s, sale.id)}`);
  await post('dismiss');
  // ===== F: refusal of any other kind (generic "cannot be completed") =====
  sale = await newSale('1001'); await hookTxt('/complete-refuse?n=1');
  r = await post('pay-tender', { type: 20, amount: sale.due }); lg = await logText(); r = await post('pay-recheck');
  rec('F1 other refusal text is kept too and shown after the recheck', /cannot be completed/.test(r.message) && /FINISH SALE NOT DONE \[refused\][^\n]*cannot be completed/.test(lg), r.message);
  r = await post('finish-sale'); s = await strict(); rec('F2 retry completes; one card payment', r.ok && r.completed && rcvOf(s, sale.id) === 1, `${r.message || ''}`);
  await post('dismiss');
  // ===== G: the screen (Chrome) =====
  let b = null; try { b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } }); } catch (e) { console.log('NOTE no Chrome: screen part skipped (' + e.message + ')'); }
  if (b) try {
    sale = await newSale('1002'); await hookTxt('/stock-refuse?on=1'); await post('pay-tender', { type: 20, amount: sale.due });
    const p = await b.newPage(); await p.setViewport({ width: 1366, height: 768 }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {})); await p.bringToFront();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1800);
    const payTxt = () => p.$eval('#payBody', e => e.innerText).catch(() => ''); const msg = () => p.$eval('#payMsg', e => e.innerText).catch(() => '');
    let t = await payTxt(), m = await msg();
    rec('G1 payment screen after a refusal: Fully paid, red box has the reason, Finish sale / Back to sale / Check AIR POS again all there', /Fully paid/.test(t) && /Insufficient inventory/.test(m) && /Finish sale/.test(t) && /Back to sale \(payments kept\)/.test(t) && /Check AIR POS again/.test(t), m.replace(/\s+/g, ' '));
    await p.click('#payRecheck'); await sleep(1500); m = await msg();
    rec('G2 after Check AIR POS again the red box STILL names the reason and the item', /Insufficient inventory/.test(m) && /Toy car/.test(m) && /has not finished this sale yet/.test(m), m.replace(/\s+/g, ' '));
    await p.keyboard.press('Escape'); await sleep(900); const bar = await p.$eval('#payStuck', e => e.offsetParent ? e.innerText : '').catch(() => '');
    rec('G3 red bar on the sale screen keeps the reason, labels unchanged', /Paid \$[\d.]+: sale not finished/.test(bar) && /Insufficient inventory/.test(bar) && /Back to payment \(F12\)/.test(bar) && /Check AIR POS again/.test(bar), bar.replace(/\s+/g, ' '));
    for (const w of [1366, 1024]) { await p.setViewport({ width: w, height: 768 }); await sleep(400); const fit = await p.evaluate(() => [...document.querySelectorAll('#psBack,#psCheck,#payStuck span')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })); rec(`G4 red bar fits at ${w}`, fit.length > 0 && fit.every(Boolean), JSON.stringify(fit)); }
    await hookTxt('/stock-refuse?on=0'); await p.setViewport({ width: 1366, height: 768 }); await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); await p.keyboard.press('Enter'); await sleep(1800);
    const body = await p.$eval('#modalRoot', e => e.innerText).catch(() => ''); s = await strict();
    rec('G5 stock fixed: Finish sale from the screen completes, one card payment', /Sale complete/.test(body) && rcvOf(s, sale.id) === 1, body.replace(/\s+/g, ' ').slice(0, 80));
    rec('G6 no script errors on the page', errs.length === 0, errs.join(' | '));
    await post('dismiss'); await p.close(); b.disconnect();
  } catch (e) { rec('G screen part ran', false, e.stack || e.message); }
  const pass = out.filter(x => x.pass).length; console.log(`stuck-stock-1011: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

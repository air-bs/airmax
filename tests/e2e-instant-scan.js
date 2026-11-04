// 1.0.11 instant scan (approved for 1.0.11) against the OFFLINE fake AIR POS (made-up products, cash only, no card ever charged):
//  A. setting OFF (default): no list downloaded or saved, and a whole sale makes exactly the AIR POS calls master makes
//  B. setting ON: list loads in pages when switched on; scans go the old way until it is complete
//  C. scan speed before (off) / after (on) with a 150 ms AIR POS round trip
//  D. stale price / name / tax corrected from AIR POS; E. invalid item taken off with a message
//  F. Pay waits until every line is confirmed and charges AIR POS's total; G. AIR POS unreachable during the check
//  H. multi-buy; I. F4 New price on a just-scanned line uses AIR POS's price; J. returns stay the old way; K. search from the list
// Fresh fake needed (scenario A counts every call from the login on):
//   FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-instant-scan.js     (no browser needed)
'use strict';
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), B = 'http://127.0.0.1:' + FP, H = 'http://127.0.0.1:' + (Number(process.env.FAKE_HOOK_PORT) || FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(B + '/api/state').then(r => r.json());
const hook = q => fetch(H + q).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const calls = () => hook('/all-calls');
const timed = async f => { const t = Date.now(); const r = await f(); return [Date.now() - t, r]; };
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const settle = async () => { for (let i = 0; i < 300; i++) { const s = await state(); if (!s.instant.pending) return s; await sleep(25); } return state(); };
const fresh = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); };
(async () => {
  try {
    // ---------- A. OFF (the default): same AIR POS calls as master, nothing saved
    await post('login', { company: 'fake shop', user: 'tester', password: 'test-pw' }); await sleep(1500);
    await post('new-sale'); await post('scan', { code: '1001' }); await post('scan', { code: '1001' }); await post('scan', { code: '1003' });
    await post('search', { keyword: 'candy' }); await post('qty', { row: 0, qty: 3 }); await post('line-discount', { row: 1, kind: 'percent', value: 10 });
    await post('pay-cash', { tendered: 100 }); await sleep(1500); await post('dismiss');
    // receipt prefetch (release branch): the template list is asked at the same moment as Complete, so those two calls may arrive in either order
    const norm = a => { const x = a.slice(); for (let i = 0; i + 1 < x.length; i++) if (x[i] === '/Orders/RetailOrderComplete' && x[i + 1] === '/Commons/RetailBillTemplateConfigGet') { x[i] = '/Commons/RetailBillTemplateConfigGet'; x[i + 1] = '/Orders/RetailOrderComplete'; } return x; };
    const master = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-instant', 'master-calls.json'), 'utf8')).calls, offCalls = await calls(), s0 = await state();
    rec('A1 Instant scan is OFF by default', s0.instant && s0.instant.on === false && !s0.instant.ready, JSON.stringify({ on: s0.instant.on }));
    rec('A2 OFF: login + a whole sale make exactly the AIR POS calls master makes (zero extra calls)', JSON.stringify(norm(offCalls)) === JSON.stringify(norm(master)), `${offCalls.length} calls (master ${master.length})`);
    rec('A3 OFF: no product list downloaded (no ProductPaged list pages)', !(await hook('/paged')).some(x => x.k === ''), 'none');
    // timing, before: the old way (off), 150 ms per AIR POS call
    await hook('/latency?ms=150'); await fresh();
    const before = []; for (const c of ['1001', '1003', '1004', '1001', '1003']) before.push((await timed(() => post('scan', { code: c })))[0]);
    // ---------- B. ON: the list loads in the background; until it is complete, scans go the old way
    await fresh(); const on = await post('instant-scan', { on: true });
    const [ms0, r0] = await timed(() => post('scan', { code: '1001' }));
    rec('B1 switched on: the list loads in the background; a scan before it is complete goes the old way (no wait on the list)', on.ok && on.on && !r0.instant && r0.ok, `${on.message} | first scan ${ms0} ms, instant=${!!r0.instant}`);
    let st; for (let i = 0; i < 200; i++) { st = await state(); if (st.instant.ready) break; await sleep(50); }
    rec('B2 list complete: products saved on this PC (code, name, price, tax only)', st.instant.ready && st.instant.count === 4 && st.instant.from === 'downloaded', JSON.stringify(st.instant.stats));
    // ---------- C. speed after
    await fresh(); const after = []; for (const c of ['1001', '1003', '1004', '1001', '1003']) { const [ms, r] = await timed(() => post('scan', { code: c })); if (r.instant) after.push(ms); }
    const sC = await settle();
    rec('C1 scan speed with a 150 ms AIR POS round trip: before (off) vs after (on); lines then confirmed by AIR POS with the same totals', after.length === 5 && med(after) * 5 < med(before) && sC.cart.length === 3 && !sC.instant.pending && sC.totals.due === Math.round((20 + 4 + 1.5) * 100 + 20 * 8 + 4 * 8) / 100,
      `before median ${med(before)} ms (max ${Math.max(...before)}), after median ${med(after)} ms (max ${Math.max(...after)}); due ${sC.totals.due}`);
    if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify({ beforeMs: before, afterMs: after }));
    // ---------- D. stale price (and name, tax) in the saved list: AIR POS's values win
    await fresh(); await hook('/price?n=1001&p=12&name=' + encodeURIComponent('Bulk candy (lb) new') + '&tax=0');
    const rD = await post('scan', { code: '1001' }); const sD0 = await state();
    const sD = await settle(); const l = sD.cart[0];
    rec('D1 stale list: the line shows at once from the list ($10.00, marked unconfirmed) ...', rD.instant && sD0.cart[0].price === 10 && sD0.instant.pendingRows.includes(0), `${sD0.cart[0].price} pending ${JSON.stringify(sD0.instant.pendingRows)}`);
    rec('D2 ... then AIR POS\'s price, name and tax replace it, the total is AIR POS\'s answer, and the cashier gets a note', l.price === 12 && l.name === 'Bulk candy (lb) new' && l.taxRate === 0 && sD.totals.due === 12 && sD.instant.notes.some(n => /price \$10\.00 -> \$12\.00/.test(n.message) && /tax 8% -> 0%/.test(n.message)), `${l.name} $${l.price} tax ${l.taxRate}% due ${sD.totals.due} | ${(sD.instant.notes.slice(-1)[0] || {}).message}`);
    await hook('/price?n=1001&p=10&name=' + encodeURIComponent('Bulk candy (lb)') + '&tax=8');
    // ---------- E. invalid item
    await fresh(); await hook('/product-gone?n=1004&on=1'); const rE = await post('scan', { code: '1004' }); const sE = await settle();
    rec('E1 AIR POS says the item is not valid: the line is taken off with a clear message', rE.instant && sE.cart.length === 0 && sE.instant.notes.some(n => n.kind === 'err' && /Gift bag was taken off the sale: AIR POS says Product not found/.test(n.message)), (sE.instant.notes.slice(-1)[0] || {}).message);
    await hook('/product-gone?n=1004&on=0');
    // ---------- F. Pay waits for the check; AIR POS's total is charged
    await fresh(); await hook('/price?n=1001&p=12'); await hook('/latency?ms=400'); await hook('/receives-reset');
    const c0 = (await calls()).length; await post('scan', { code: '1001' });
    const [payMs, pay] = await timed(() => post('pay-cash', { tendered: 50 })); const cF = (await calls()).slice(c0), rcv = (await hook('/')).receives;
    rec('F1 Pay pressed right after the scan waits until AIR POS has checked the line, then charges AIR POS\'s total ($12.96, not the list\'s $10.80)', pay.ok && pay.completed && rcv.length === 1 && rcv[0].amount === 12.96 && payMs >= 700, `pay after ${payMs} ms, received ${JSON.stringify(rcv.map(x => x.amount))}`);
    rec('F2 order of AIR POS calls: the check (SubGetByScan) and the total (PromotionGet) come before Save / payment / Complete', cF.indexOf('/Orders/RetailOrderSubGetByScan') >= 0 && cF.indexOf('/Orders/RetailOrderSubGetByScan') < cF.indexOf('/Orders/RetailOrderSave') && cF.lastIndexOf('/Orders/RetailOrderPromotionGet', cF.indexOf('/Orders/RetailOrderSave')) > cF.indexOf('/Orders/RetailOrderSubGetByScan'), cF.slice(0, 8).join(' '));
    await hook('/price?n=1001&p=10'); await hook('/latency?ms=0'); await sleep(1000); await post('dismiss');
    // ---------- G. AIR POS unreachable during the check
    await fresh(); await hook('/fault?path=RetailOrderSubGetByScan&mode=down&n=2'); const rG = await post('scan', { code: '1003' }); const sG = await settle(); const rG2 = await post('scan', { code: '1003' }); await settle();
    rec('G1 no connection for the check: the line is taken off with a message (never paid unchecked), and the next scans go the old way for a minute', rG.instant && sG.cart.length === 0 && sG.instant.notes.some(n => /could not be checked with AIR POS \(no connection\)/.test(n.message)) && rG2.ok && !rG2.instant, `${(sG.instant.notes.slice(-1)[0] || {}).message} | next scan instant=${!!rG2.instant}`);
    // instant again only after the minute: restart the instant state by switching off and on (list reloads)
    await post('instant-scan', { on: false });
    await post('instant-scan', { on: true }); for (let i = 0; i < 200 && !(await state()).instant.ready; i++) await sleep(50);
    // ---------- H. multi-buy (AIR POS promotion 3 for $5 on Rope)
    await fresh(); await hook('/multibuy?on=1'); for (let i = 0; i < 3; i++) await post('scan', { code: '1003' }); const sH = await settle();
    rec('H1 multi-buy: three quick scans make one line of 3; AIR POS\'s promotion ($1 off) is in the total ((6 - 1) + 8% = $5.40)', sH.cart.length === 1 && sH.cart[0].quantity === 3 && sH.totals.promotionDiscount === 1 && sH.totals.due === 5.4, `qty ${sH.cart[0] && sH.cart[0].quantity}, promo ${sH.totals.promotionDiscount}, due ${sH.totals.due}`);
    await hook('/multibuy?on=0');
    // ---------- I. F4 New price right after the scan of a stale item
    await fresh(); await hook('/price?n=1001&p=12'); await hook('/latency?ms=300'); await post('scan', { code: '1001' });
    const f4 = await post('line-discount', { row: 0, kind: 'price', value: 9 }); const sI = await settle(); const li = sI.cart[0];
    rec('I1 F4 New price $9.00 pressed before the check finished: it waits, then works from AIR POS\'s $12.00 ($3.00 off, line $9.00)', f4.ok && li.price === 12 && li.discountAmount === 3 && li.total === 9, `${f4.message} | price ${li.price} off ${li.discountAmount} total ${li.total}`);
    await hook('/price?n=1001&p=10'); await hook('/latency?ms=0');
    // ---------- J. returns: the old way
    await fresh(); await post('return-toggle'); const rJ = await post('scan', { code: '1001' }); const sJ = await state();
    rec('J1 return lines inside a sale (Ctrl+R) are scanned the old way, never from the list', rJ.ok && !rJ.instant && sJ.mix && sJ.mix.lines.length === 1, `instant=${!!rJ.instant}, return lines ${sJ.mix && sJ.mix.lines.length}`);
    await post('return-toggle'); await fresh();
    const rs = await post('return-start', { kind: 'nonorder' }); const rJ2 = rs.ok ? await post('scan', { code: '1003' }) : rs; await post('return-cancel');
    rec('J2 return mode (no receipt) is scanned the old way', rJ2.ok && !rJ2.instant, `instant=${!!rJ2.instant} ${rJ2.message || ''}`);
    // ---------- K. search from the list
    await fresh(); const k = await post('search', { keyword: 'candy' });
    rec('K1 product search answers from the saved list at once, with prices', k.ok && k.instant && k.rows.length === 1 && k.rows[0].price === 10, JSON.stringify(k.rows));
    await post('instant-scan', { on: false }); const k2 = await post('search', { keyword: 'candy' }); const sOff = await state();
    rec('K2 switched off again: search and scan are the old way, the saved list is deleted', k2.ok && !k2.instant && !sOff.instant.on && !sOff.instant.ready && (await post('scan', { code: '1001' })).instant === undefined, `instant=${!!k2.instant}`);
    await fresh();
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

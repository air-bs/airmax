// AirMax Step 0b (Batch 11) C1 / C2, server side: app/linedisc.js (what discount each sale line got) and the lineDisc[] that /api/state sends next to lineIds[].
// Starts its OWN offline fake AIR POS (made-up data, tests/fake-api/discount-price.js in the real promotionSubs shape: one row per line, NO per-row amount).
// No real AIR POS, no browser, nothing paid.   node tests/api-11-discount-price.test.js   (ports DP_PORT default 5313, hook 5314)
// The per-line promotion amount is PROVISIONAL (a split of the sale-level promotion total, see app/linedisc.js): these tests pin that rule so a change shows up here.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const LD = require('../app/linedisc');
const PORT = Number(process.env.DP_PORT || 5313), HOOK = PORT + 1, BASE = 'http://127.0.0.1:' + PORT, HB = 'http://127.0.0.1:' + HOOK;
const fails = []; let n = 0; const rec = (k, pass, note) => { n++; if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms)), c2 = x => Math.round(x * 100) / 100;
const ZERO = '00000000-0000-0000-0000-000000000000';

// ---------- A. the pure function
{
  const sub = (id, o = {}) => ({ id, discountAmount: 0, isCustomDiscount: false, discountName: '', ...o });
  const row = (id, o = {}) => ({ retailOrderSubId: id, promotionId: ZERO, promotionType: 0, promotionTypeName: 'Others', discountName: '', price: 10, quantity: 1, rate: 1, ...o });
  let r = LD.forSale([sub('a'), sub('b')], [row('a'), row('b')], 0);
  rec('A1 no promotion (type 0 "Others" rows, one per line): every entry empty, same length and order as the lines', r.length === 2 && r.every(x => !x.name && !x.promoName && x.promoAmount === 0 && x.promoType === 0), JSON.stringify(r));
  r = LD.forSale([sub('a'), sub('b')], [row('a', { promotionType: 1, promotionTypeName: 'Discount', discountName: 'Sale', promotionId: 'p1' }), row('b')], 2);
  rec('A2 one promoted line gets the whole sale-level total, name from discountName', r[0].promoName === 'Sale' && r[0].promoAmount === 2 && r[1].promoName === '' && r[1].promoAmount === 0 && r[0].promoType === 1, JSON.stringify(r));
  r = LD.forSale([sub('a')], [row('a', { promotionType: 2, promotionTypeName: 'DiscountMulti' })], 1);
  rec('A3 no discountName: the promotionTypeName is the name', r[0].promoName === 'DiscountMulti', r[0].promoName);
  r = LD.forSale([sub('a'), sub('b'), sub('c')], [row('a', { promotionType: 1, price: 10, quantity: 1 }), row('b', { promotionType: 1, price: 10, quantity: 2 }), row('c', { promotionType: 1, price: 10, quantity: 1 })], 1);
  rec('A4 several promoted lines: split in proportion to the line amount, cents add up to the total exactly', c2(r.reduce((a, x) => a + x.promoAmount, 0)) === 1 && r[1].promoAmount === 0.5 && r.every(x => Math.round(x.promoAmount * 100) === x.promoAmount * 100 || Math.abs(x.promoAmount * 100 - Math.round(x.promoAmount * 100)) < 1e-9), JSON.stringify(r.map(x => x.promoAmount)));
  r = LD.forSale([sub('a'), sub('b'), sub('c')], [row('a', { promotionType: 1 }), row('b', { promotionType: 1 }), row('c', { promotionType: 1 })], 0.1);
  rec('A5 odd cents (10 cents over 3 equal lines): 0.04 + 0.03 + 0.03, sum 0.10', c2(r.reduce((a, x) => a + x.promoAmount, 0)) === 0.1 && r.every(x => x.promoAmount >= 0.03 && x.promoAmount <= 0.04), JSON.stringify(r.map(x => x.promoAmount)));
  r = LD.forSale([sub('a')], [row('a', { promotionType: 1 }), row('gone', { promotionType: 1 })], 5);
  rec('A6 an answer that names a promoted line no longer on the sale is out of date: no amounts', r[0].promoAmount === 0 && r.length === 1, JSON.stringify(r));
  r = LD.forSale([sub('a'), sub('b')], [row('a', { promotionType: 1, promotionId: 'p1', discountName: 'Sale' }), row('b', { promotionType: 2, promotionId: 'p2', discountName: 'Multi-buy' })], 3);
  rec('A6b two DIFFERENT promotions on one sale (Gordon Nov 3): each line shows its name AND its dollars, split by line amount (1.50 + 1.50 of 3)', r[0].promoName === 'Sale' && r[1].promoName === 'Multi-buy' && r[0].promoAmount === 1.5 && r[1].promoAmount === 1.5, JSON.stringify(r));
  r = LD.forSale([sub('a'), sub('b')], [row('a', { promotionType: 1, promotionId: 'p1', price: 10 }), row('b', { promotionType: 1, promotionId: 'p1', price: 30 })], 2);
  rec('A6c the same promotion on two lines: split by line amount (0.50 + 1.50)', r[0].promoAmount === 0.5 && r[1].promoAmount === 1.5, JSON.stringify(r.map(x => x.promoAmount)));
  r = LD.forSale([sub('a'), sub('b')], [row('a', { promotionType: 1 })], 3);
  rec('A7 a line the answer has no row for (just scanned, total check on its way) shows nothing', r[1].promoName === '' && r[1].promoAmount === 0, JSON.stringify(r[1]));
  // --- Gordon Nov 3: mixed promotions, every promoted line gets dollars. PROVISIONAL rule: per-line signal (originalPrice/retailPrice over price) else proportional split, largest-remainder cents
  const P = (id, o = {}) => row(id, { promotionType: 1, promotionId: 'p-' + id, discountName: 'N' + id, ...o }), amts = x => x.map(y => y.promoAmount), sum2 = x => c2(x.reduce((a, y) => a + y, 0));
  r = LD.forSale([sub('a'), sub('b'), sub('c')], [P('a', { price: 10 }), P('b', { price: 2 }), P('c', { price: 4.5 })], 3.2);
  rec('A8 mixed promotions, rounding remainder: 3.20 over 10 : 2 : 4.5 gives 1.94 + 0.39 + 0.87 (floors 193/38/87, the 2 spare cents go to the biggest fractions .94 and .79)', JSON.stringify(amts(r)) === '[1.94,0.39,0.87]' && sum2(amts(r)) === 3.2, JSON.stringify(amts(r)));
  r = LD.forSale([sub('a'), sub('b'), sub('c')], [P('a'), P('b'), P('c')], 1);
  rec('A9 mixed promotions, 3 equal lines and $1.00: the spare cent goes to the FIRST line (0.34 + 0.33 + 0.33), never negative, exact sum', JSON.stringify(amts(r)) === '[0.34,0.33,0.33]', JSON.stringify(amts(r)));
  r = LD.forSale([sub('a'), sub('b')], [P('a', { price: 10, originalPrice: 12 }), P('b', { price: 5 })], 3);
  rec('A10 per-line signal: line a was marked down 12 -> 10 (= 2.00); the rest of the total (1.00) goes to the line without a signal', JSON.stringify(amts(r)) === '[2,1]', JSON.stringify(amts(r)));
  r = LD.forSale([sub('a')], [P('a', { price: 10, quantity: 3, retailPrice: 11, originalPrice: 10 })], 3);
  rec('A11 signal from retailPrice x quantity (11 -> 10, 3 pieces = 3.00) and it matches the total', JSON.stringify(amts(r)) === '[3]', JSON.stringify(amts(r)));
  r = LD.forSale([sub('a'), sub('b')], [P('a', { price: 10, originalPrice: 20 }), P('b', { price: 30 })], 4);
  rec('A12 a signal bigger than the whole total (10.00 > 4.00) is not trusted: split by line amount instead (1.00 + 3.00)', JSON.stringify(amts(r)) === '[1,3]', JSON.stringify(amts(r)));
  r = LD.forSale([sub('a'), sub('b')], [P('a', { price: 10, originalPrice: 11 }), P('b', { price: 10, originalPrice: 12 })], 4);
  rec('A13 every line has a signal (1.00, 2.00) but they do not add up to the total 4.00: the total is shared in proportion to the signals (1.33 + 2.67)', JSON.stringify(amts(r)) === '[1.33,2.67]', JSON.stringify(amts(r)));
  r = LD.forSale([sub('a'), sub('b')], [P('a', { price: 10, originalPrice: 11 }), P('b', { price: 10, originalPrice: 12 })], 3);
  rec('A14 every line has a signal and they add up to the total: used as they are (1.00 + 2.00)', JSON.stringify(amts(r)) === '[1,2]', JSON.stringify(amts(r)));
  { let bad = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 400; k++) { const m = 1 + Math.floor(rnd() * 5), tot = Math.round(rnd() * 5000) / 100, subs = [], rows2 = [];
      for (let i = 0; i < m; i++) { subs.push(sub('l' + i)); const pr = Math.round(rnd() * 3000) / 100, op = rnd() < 0.3 ? pr + Math.round(rnd() * 500) / 100 : pr; rows2.push(P('l' + i, { price: pr, originalPrice: op, quantity: 1 + Math.floor(rnd() * 4) })); }
      const a = amts(LD.forSale(subs, rows2, tot)); if (tot > 0 && (sum2(a) !== tot || a.some(x => x < 0))) bad++; }
    rec('A15 400 random mixed sales (1-5 promoted lines, with and without signals): the line amounts always add up to the total to the cent, none negative', bad === 0, bad + ' bad'); }
  r = LD.forSale([sub('a', { discountAmount: 1, discountName: 'Senior' }), sub('b', { discountAmount: 1, discountName: 'F4', isCustomDiscount: true }), sub('c', { discountName: 'Senior' })], [], 0);
  rec('A8 customer-type name shows only on a line that got an amount and is not an F4 line', r[0].name === 'Senior' && r[1].name === '' && r[2].name === '', JSON.stringify(r.map(x => x.name)));
  rec('A9 bad input never throws', LD.forSale(null, null, null).length === 0 && LD.forSale([null], undefined, NaN).length === 1 && LD.forSale([sub('a')], [null, {}], 'x').length === 1, '');
  rec('A10 promotion rows with promotionId set but type 0 still count as promoted; all-zero id does not', LD.isPromoRow({ promotionType: 0, promotionId: 'x1' }) && !LD.isPromoRow({ promotionType: 0, promotionId: ZERO }) && !LD.isPromoRow(null), '');
}

// ---------- B. through the real server and the fake AIR POS
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'dp11-')), log = path.join(T, 'srv.log');
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = (q) => fetch(HB + q).then(r => r.json());
const state = async () => { for (let i = 0; i < 40; i++) { const s = await fetch(BASE + '/api/state').then(r => r.json()); if (!(s.totals && s.totals.updating)) return s; await sleep(100); } return fetch(BASE + '/api/state').then(r => r.json()); };
(async () => {
  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: String(HOOK), DP_CUST: '1' }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/shortcuts'); break; } catch (e) { await sleep(250); } }
    await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    const fresh = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await hook('/dp-promo?off=1'); };
    const idx = (s, name) => s.cart.findIndex(l => l.name === name), sum = a => c2(a.reduce((x, y) => x + (y.promoAmount || 0), 0));
    const CANDY = 'Bulk candy (lb)', ROPE = 'Rope (ft)', GIFT = 'Gift bag';

    await fresh(); await post('scan', { code: '1001' }); await post('scan', { code: '1003' }); await post('scan', { code: '1004' }); let s = await state();
    const keys = Object.keys(s.cart[0]).sort().join();
    rec('B1 cart[] rows keep exactly today\'s fields (nothing added to a row)', Object.keys(s.cart[0]).every(k => 'number,upc,name,type,quantity,unitName,price,discount,discountAmount,custom,dm,taxRate,total'.split(',').includes(k)), keys);
    rec('B2 /api/state has lineDisc[] next to lineIds[]: same length and order as cart[], empty entries with no promotion', Array.isArray(s.lineDisc) && s.lineDisc.length === s.cart.length && s.lineIds.length === s.cart.length && s.lineDisc.every(d => !d.name && !d.promoName && d.promoAmount === 0), JSON.stringify(s.lineDisc));

    await hook('/dp-promo?sale=1'); await post('qty', { row: idx(s, CANDY), qty: 2 }); s = await state(); let ci = idx(s, CANDY);
    rec('B3 Sale on Bulk candy x2 ($20, 20% off): the line shows name "Sale" and $4.00; the other lines nothing', s.lineDisc[ci].promoName === 'Sale' && s.lineDisc[ci].promoAmount === 4 && s.lineDisc.filter((d, i) => i !== ci).every(d => !d.promoName && !d.promoAmount), JSON.stringify(s.lineDisc[ci]));
    rec('B4 the promotion amounts add up to the sale\'s promotion total, and the total is the fake AIR POS answer (nothing recalculated here)', sum(s.lineDisc) === s.totals.promotionDiscount && s.totals.promotionDiscount === 4 && c2(s.totals.itemAmount) === c2(20 + 2 + 1.5 - 4), `promo ${s.totals.promotionDiscount} itemAmount ${s.totals.itemAmount}`);
    rec('B5 the cart row itself is untouched by the promotion (discountAmount 0, total = price x qty), as today', s.cart[ci].discountAmount === 0 && s.cart[ci].total === 20, `disc ${s.cart[ci].discountAmount} total ${s.cart[ci].total}`);
    rec('B6 lineIds[i] is the id of the promoted row for cart[i] (the link is retailOrderSubId)', (await hook('/dp-state')).amounts[s.lineIds[ci]] === 4, '');

    await hook('/dp-promo?multi=1'); await post('qty', { row: idx(s, GIFT), qty: 2 }); s = await state(); let gi = idx(s, GIFT);
    rec('B7 Multi-buy on Gift bag x2 (2 for $2): name "Multi-buy 2 for $2", $1.00; the amount sums to the total', s.lineDisc[gi].promoName === 'Multi-buy 2 for $2' && s.lineDisc[gi].promoAmount === 1 && s.lineDisc[gi].promoType === 2 && sum(s.lineDisc) === s.totals.promotionDiscount, JSON.stringify(s.lineDisc[gi]));

    await fresh(); await post('scan', { code: '1001' }); await post('scan', { code: '1003' }); await hook('/dp-promo?code=SAVE10'); await post('promo-code', { code: 'SAVE10' }); s = await state();
    rec('B8 promo code SAVE10 (10% off every line): both lines show "Promo code SAVE10", $1.00 and $0.20, sum = total', s.lineDisc.every(d => d.promoName === 'Promo code SAVE10') && s.lineDisc[idx(s, CANDY)].promoAmount === 1 && s.lineDisc[idx(s, ROPE)].promoAmount === 0.2 && sum(s.lineDisc) === s.totals.promotionDiscount, JSON.stringify(s.lineDisc));
    rec('B9 the code reaches AIR POS as promotionalCode and is shown in the totals as today', s.order.promotionalCode === 'SAVE10', s.order.promotionalCode);

    await fresh(); for (const c of ['1001', '1003', '1004']) await post('scan', { code: c }); s = await state();
    await post('qty', { row: idx(s, GIFT), qty: 3 }); await hook('/dp-promo?sale=1&multi=1&code=SAVE10'); await post('promo-code', { code: 'SAVE10' }); s = await state();
    const L = Object.fromEntries(s.cart.map((l, i) => [l.name, s.lineDisc[i]]));
    rec('B10 a mix of DIFFERENT promotions on one sale (Sale on candy, Multi-buy on 3 bags, the code on the rope): each line shows its name and a provisional amount (the AIR POS total 3.2 split by line amount 10 : 4.5 : 2 = 1.94 + 0.87 + 0.39, cents add up exactly)', L[CANDY].promoName === 'Sale' && L[GIFT].promoType === 2 && L[ROPE].promoName === 'Promo code SAVE10' && L[CANDY].promoAmount === 1.94 && L[GIFT].promoAmount === 0.87 && L[ROPE].promoAmount === 0.39 && c2(L[CANDY].promoAmount + L[GIFT].promoAmount + L[ROPE].promoAmount) === s.totals.promotionDiscount && s.totals.promotionDiscount === 3.2, JSON.stringify(Object.entries(L).map(([k, v]) => k + ':' + v.promoName + ':' + v.promoAmount)));

    // F4 on a promoted line, then the order discount (F6) on top
    await fresh(); await post('scan', { code: '1001' }); await hook('/dp-promo?sale=1'); await post('line-discount', { row: 0, kind: 'percent', value: 10 }); s = await state(); ci = idx(s, CANDY);
    rec('B11 F4 10% on a Sale line: the line keeps its own discount in cart[] AND the Sale part in lineDisc[] (20% of the rest = $1.80); an F4 line has no customer-type name', s.cart[ci].custom && s.cart[ci].discountAmount === 1 && s.lineDisc[ci].promoName === 'Sale' && s.lineDisc[ci].name === '' && s.lineDisc[ci].promoAmount === 1.8, JSON.stringify([s.cart[ci].discountAmount, s.lineDisc[ci]]));
    const before = JSON.stringify(s.lineDisc); await post('discount', { kind: 'percent', value: 10 }); s = await state();
    rec('B12 an order discount (F6) on top changes no line entry (it keeps its own green tag)', JSON.stringify(s.lineDisc) === before && s.order.orderDiscount === 10, `orderDiscount ${s.order.orderDiscount}`);
    await post('discount', { kind: 'percent', value: 0 });

    await fresh(); await post('scan', { code: '1003' }); await post('scan', { code: '1004' }); await post('predefined-discount', { id: 'dp-senior' }); s = await state();
    rec('B13 customer-type discount "Senior" 10%: both lines carry the name, and the cart row has the percent and amount', s.lineDisc.every(d => d.name === 'Senior') && s.cart.every(l => l.discount === 10 && l.discountAmount > 0 && !l.custom), JSON.stringify([s.lineDisc.map(d => d.name), s.cart.map(l => [l.discount, l.discountAmount])]));
    await post('predefined-discount', { id: '' });

    // sale with nothing promoted but a promotion on: names appear only where promoted; remove a line: arrays shrink together
    await fresh(); await post('scan', { code: '1001' }); await post('scan', { code: '1003' }); await hook('/dp-promo?sale=1'); await post('qty', { row: 0, qty: 1 }); s = await state();
    await post('remove', { row: idx(s, ROPE) }); s = await state();
    rec('B14 remove a line: lineDisc[], lineIds[] and cart[] shrink together and stay aligned', s.cart.length === 1 && s.lineDisc.length === 1 && s.lineIds.length === 1 && s.lineDisc[0].promoName === 'Sale' && s.lineDisc[0].promoAmount === 2, JSON.stringify(s.lineDisc));

    // return mode: lineDisc is empty, like lineIds
    await post('return-start', { kind: 'receipt', orderId: 'o-ret-cash' }); await post('scan', { code: '1001' }); s = await state();
    rec('B15 return mode: lineDisc[] is empty (the Discount column is "Max" there)', s.mode === 'return' && Array.isArray(s.lineDisc) && s.lineDisc.length === 0, `mode ${s.mode}`);
    await post('return-cancel'); await fresh();
    s = await state(); rec('B16 empty sale: lineDisc[] empty, totals zero', s.lineDisc.length === 0 && s.totals.due === 0, '');
  } catch (e) { rec('run', false, e.stack); }
  finally { srv.kill(); }
  console.log(`${n - fails.length}/${n} passed`); process.exit(fails.length ? 1 : 0);
})();

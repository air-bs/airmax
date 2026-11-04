// 1.0.11-local.3 (Ari 4:32 / 4:34 PM ET Nov 1): F4 single-item discount with % off / $ off / New price. New price is sent as the
// EXISTING $-off line discount (discount = original - new); a new price above the original is refused, equal = no discount; the
// item price itself is never changed. Totals come from the mocked AIR POS (same formula as tests/fake-server.js). Offline, made-up data.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const r2 = x => Math.round(x * 100) / 100;
function mk(lines) {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4-')) }); reg.settingsPath = null;
  const api = reg.api, sent = [], calls = [];
  api.ide = 'x'; api.shop = 'MadeUpShopA'; reg.identity = { userName: 'u', corpName: 'MadeUpCo', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  // AIR POS stand-in: line = price x qty x rate - discountAmount, tax per line rate, rounded to cents (as tests/fake-server.js)
  api.promotionGet = async s => { sent.push(JSON.parse(JSON.stringify(s.subs))); let tot = 0, tax = 0; for (const x of s.subs) { const a = x.price * x.quantity * (x.rate || 1) - (x.discountAmount || 0); tot += a; tax += a * (x.taxRate || 0) / 100; } tax = r2(tax); return { success: true, value: { subs: [], totalAmount: r2(tot), totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: r2(tot) } }; };
  for (const k of Object.keys(api)) if (typeof api[k] === 'function' && !['promotionGet'].includes(k) && /Save|Update|Edit|Product|Price/i.test(k)) { const f = api[k]; api[k] = async (...a) => { calls.push(k); return f.apply(api, a); }; }
  reg.mode = 'sale';
  reg.subs = lines.map((l, i) => ({ id: 's' + i, itemId: 'i' + i, productId: 'p' + i, number: '000' + i, name: 'Made-up item ' + i, quantity: l.q || 1, rate: 1, price: l.p, originalPrice: l.p, taxRate: l.t || 0, discount: 0, discountAmount: 0, discountMethod: 10, isCustomDiscount: false, timestamp: 10 - i }));
  return { reg, sent, calls };
}
const due = t => t.reg.totals.due, tax = t => t.reg.totals.tax;
const strip = subs => subs.map(({ id, itemId, productId, timestamp, ...x }) => ({ ...x, discount: r2(x.discount) }));
(async () => {
  // P1 tax/total match AIR POS: New price 7.49 on a $10 8% item = same subs sent and same totals as $2.51 off
  let a = mk([{ p: 10, t: 8 }]), b = mk([{ p: 10, t: 8 }]); await a.reg.recalc(); await b.reg.recalc();
  let ra = await a.reg.lineDiscount(0, 'price', '7.49'), rb = await b.reg.lineDiscount(0, 'amount', 2.51);
  rec('P1 New price $7.49 (8% tax) = the existing $2.51-off line discount: identical line sent to AIR POS, same tax and total', ra.ok && rb.ok && JSON.stringify(strip(a.sent.at(-1))) === JSON.stringify(strip(b.sent.at(-1))) && due(a) === due(b) && Math.abs(due(a) - 8.09) < 0.005 && tax(a) === 0.6, `due ${due(a)} tax ${tax(a)} vs ${due(b)} / ${ra.message}`);
  rec('P2 the item price itself is never changed (price/originalPrice stay $10, no product or price call to AIR POS)', a.reg.subs[0].price === 10 && a.reg.subs[0].originalPrice === 10 && a.reg.subs[0].discountMethod === 20 && a.calls.length === 0, JSON.stringify({ price: a.reg.subs[0].price, calls: a.calls }));
  // P3 cents rounding + qty > 1
  let t = mk([{ p: 3.33, q: 3, t: 8 }]); await t.reg.recalc(); let r = await t.reg.lineDiscount(0, 'price', '2.99');
  rec('P3 qty 3 x $3.33 -> new price $2.99 each: discount $1.02, line $8.97, tax $0.72, due $9.69 (cents rounding)', r.ok && t.reg.subs[0].discountAmount === 1.02 && due(t) === 9.69 && tax(t) === 0.72, `disc ${t.reg.subs[0].discountAmount} due ${due(t)} tax ${tax(t)}`);
  t = mk([{ p: 0.99, q: 7, t: 6.25 }]); await t.reg.recalc(); r = await t.reg.lineDiscount(0, 'price', '0.333');
  rec('P4 new price typed with 3 decimals is taken to the cent ($0.33): 7 x $0.99 -> discount $4.62, line $2.31', r.ok && t.reg.subs[0].discountAmount === 4.62 && r2(t.reg.totals.itemAmount) === 2.31, `disc ${t.reg.subs[0].discountAmount} items ${t.reg.totals.itemAmount} due ${due(t)}`);
  // P5 qty changed after a new price: the per-item new price is kept (custom % recomputed by the existing code)
  t = mk([{ p: 10, q: 2 }]); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); const d2 = due(t); await t.reg.setQty(0, 5);
  rec('P5 new price $8 x 2 = $16, then qty 5 = $40 (new price per item kept)', d2 === 16 && due(t) === 40, `${d2} -> ${due(t)}`);
  // P6 refusals: higher, negative, empty / not a number; nothing changes
  t = mk([{ p: 10, t: 8 }]); await t.reg.recalc(); const d0 = due(t), n0 = t.sent.length;
  const hi = await t.reg.lineDiscount(0, 'price', '10.01'), neg = await t.reg.lineDiscount(0, 'price', '-1'), emp = await t.reg.lineDiscount(0, 'price', ''), nan = await t.reg.lineDiscount(0, 'price', 'abc');
  rec('P6 new price above the original ($10.01 > $10.00) is refused with a clear message, nothing sent (Ari 4:34 PM)', !hi.ok && /higher than the original \$10\.00/.test(hi.message), hi.message);
  rec('P7 negative / empty / not-a-number new price refused; total unchanged, nothing sent to AIR POS', !neg.ok && /below \$0\.00/.test(neg.message) && !emp.ok && !nan.ok && due(t) === d0 && t.sent.length === n0 && !t.reg.subs[0].isCustomDiscount, `${neg.message} | ${emp.message} | ${nan.message}`);
  const eq = await t.reg.lineDiscount(0, 'price', '10');
  rec('P8 new price equal to the original = no discount (line unchanged, total unchanged)', eq.ok && /no discount/.test(eq.message) && !t.reg.subs[0].isCustomDiscount && t.reg.subs[0].discountAmount === 0 && due(t) === d0, `${eq.message} due ${due(t)}`);
  await t.reg.lineDiscount(0, 'percent', 20); const d20 = due(t); const eq2 = await t.reg.lineDiscount(0, 'price', '10.00');
  rec('P9 a line with 20% off, then New price = original: the discount is removed and the total is back to the full price', d20 < d0 && eq2.ok && !t.reg.subs[0].isCustomDiscount && due(t) === d0, `${d20} -> ${due(t)}`);
  // P10 $ off above the price and % above 100 still refused (existing rules kept); new price $0 allowed = 100% off, never below 0
  const big = await t.reg.lineDiscount(0, 'amount', 10.5), pc = await t.reg.lineDiscount(0, 'percent', 101), z = await t.reg.lineDiscount(0, 'price', '0');
  rec('P10 discount above the price refused ($10.50 off a $10 line, 101%); new price $0.00 = $10.00 off, total $0 (never negative)', !big.ok && !pc.ok && z.ok && t.reg.subs[0].discountAmount === 10 && due(t) === 0, `${big.message} | ${pc.message} | due ${due(t)}`);
  // P11 removing the discount restores the total
  const cl = await t.reg.lineDiscount(0, 'clear');
  rec('P11 Remove item discount restores the full total', cl.ok && due(t) === d0 && t.reg.subs[0].discountAmount === 0, `due ${due(t)}`);
  // P12 lines without a discount are untouched
  t = mk([{ p: 10, t: 8 }, { p: 4.5, q: 2, t: 8 }]); await t.reg.recalc(); const other0 = JSON.stringify(t.reg.subs[1]); await t.reg.lineDiscount(0, 'price', '6');
  rec('P12 the other line (no discount) is sent exactly as before; only the chosen line changes', JSON.stringify(t.reg.subs[1]) === other0 && t.reg.subs[0].discountAmount === 4 && due(t) === r2((6 + 9) * 1.08), `due ${due(t)}`);
  // P13 cart state reports the discount kind so F4 opens prefilled
  const st = t.reg.state ? t.reg.state() : null, line = st && st.cart.find(x => x.number === '0000');
  rec('P13 cart line reports custom + discount type ($ off = 20) + amount, so F4 opens on "$ off $4.00"', line && line.custom && line.dm === 20 && line.discountAmount === 4, JSON.stringify(line && { custom: line.custom, dm: line.dm, discountAmount: line.discountAmount }));
  // P14 return of a discounted line refunds the discounted price (AIR POS order line carries the % AirMax sent)
  t = mk([{ p: 10, q: 3, t: 8 }]); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '7.49'); const s = t.reg.subs[0];
  const order = { id: 'o1', number: 'RO-MADEUP', status: 20, orderDiscount: 0, amount: 22.47, tax: 1.8, subs: [{ id: 'os1', productId: s.productId, itemId: s.itemId, number: s.number, upc: '', name: s.name, rate: 1, quantityTotal: 3, quantityReturn: 0, price: 10, taxRate: 8, discount: r2(s.discount * 1e4) / 1e4, isRetailRefund: true, promotionType: 0 }], receives: [{ paymentType: 10, amount: 24.27 }] };
  t.reg.api.orderGet = async () => ({ success: true, value: order }); t.reg.subs = []; await t.reg.recalc();
  const sr = await t.reg.startReturn('receipt', 'o1'); await t.reg.returnScan(s.number); const one = t.reg.returnTotals(); await t.reg.returnScan(s.number); await t.reg.returnScan(s.number); const all = t.reg.returnTotals();
  rec('P14 return of a line sold at new price $7.49: 1 returned refunds $7.49 + tax ($8.09), all 3 refund $24.27 (what was paid)', sr.ok && one.amount === 7.49 && one.refund === 8.09 && all.amount === 22.47 && all.refund === 24.27, `one ${one.amount}/${one.refund} all ${all.amount}/${all.refund}`);
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

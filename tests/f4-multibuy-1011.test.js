// F4 New price on multi-buy and weighed items (approved Nov 3, branch claude/f4-multibuy). The typed new price per item is now kept
// when the quantity changes, also when it crosses a multi-buy price point (was: kept as a % of the line, so $8 at qty 1 became $7.20
// each at the 3-for-$27 price, line $21.60 instead of $24), and the target is worked out in whole cents (1.5 lb at $3.99 = $5.99, was
// $5.98). Still sent as the existing $-off line discount; the item price is never changed; nothing new is sent to AIR POS.
// Offline: Register with a mocked AIR POS (tests/f4-price.test.js formula, plus the multi-buy unit price the way AirMax's saveSubmit
// sends it; real AIR POS's own multi-buy total is not confirmed here), made-up data.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const r2 = x => Math.round(x * 100) / 100;
function mk(l) {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4m-')) }); reg.settingsPath = null;
  const api = reg.api, sent = []; api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { sent.push(JSON.parse(JSON.stringify(s.subs))); let tot = 0, tax = 0; for (const x of s.subs) { const q = x.quantity * (x.rate || 1), up = x.bulkPriceQuantity > 0 && x.bulkPrice > 0 && q >= x.bulkPriceQuantity ? x.bulkPrice : x.price, a = up * q - (x.discountAmount || 0); /* multi-buy unit price, as saveSubmit sends it */ tot += a; tax += a * (x.taxRate || 0) / 100; } tax = r2(tax); return { success: true, value: { subs: [], totalAmount: r2(tot), totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: r2(tot) } }; };
  reg.mode = 'sale';
  reg.subs = [{ id: 's0', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: l.q, rate: l.rate || 1, price: l.p, originalPrice: l.p, bulkPriceQuantity: l.bq || 0, bulkPrice: l.bp || 0, taxRate: l.t || 0, discount: 0, discountAmount: 0, discountMethod: 10, isCustomDiscount: false, timestamp: 1 }];
  return { reg, sent };
}
const net = reg => r2(reg.lineAmount(reg.subs[0]) - reg.subs[0].discountAmount);
(async () => {
  // M1-M4 multi-buy: $10 each, 3 or more = $9 each (3 for $27)
  let { reg } = mk({ p: 10, q: 1, bq: 3, bp: 9 }); await reg.recalc(); await reg.lineDiscount(0, 'price', '8'); const a1 = net(reg); await reg.setQty(0, 3);
  rec('M1 new price $8 at qty 1, then qty 3 (multi-buy $9 each): line $24 = 3 x $8 (was $21.60)', a1 === 8 && net(reg) === 24 && reg.totals.due === 24, `${a1} -> ${net(reg)}, due ${reg.totals.due}`);
  await reg.setQty(0, 2);
  rec('M2 ...then back to qty 2 (no multi-buy, $10 each): line $16 = 2 x $8 (was $17.78)', net(reg) === 16, `${net(reg)}`);
  ({ reg } = mk({ p: 10, q: 1, bq: 3, bp: 9 })); await reg.recalc(); await reg.lineDiscount(0, 'price', '9.50'); await reg.setQty(0, 3);
  rec('M3 new price $9.50, then qty 3: the multi-buy $9 is lower, so the line is $27 with no discount (never more than the store price)', net(reg) === 27 && reg.subs[0].discountAmount === 0, `line ${net(reg)}, discount ${reg.subs[0].discountAmount}`);
  await reg.setQty(0, 1);
  rec('M4 ...back to qty 1: $9.50 again', net(reg) === 9.5, `${net(reg)}`);
  // W weighed items: whole-cent target
  ({ reg } = mk({ p: 4.99, q: 1, rate: 1.5 })); await reg.recalc(); await reg.lineDiscount(0, 'price', '3.99');
  rec('W1 1.5 lb at $4.99/lb, new price $3.99/lb: line $5.99 (598.5 c rounds up; was $5.98)', net(reg) === 5.99, `${net(reg)}`);
  ({ reg } = mk({ p: 2.49, q: 1, rate: 0.75 })); await reg.recalc(); await reg.lineDiscount(0, 'price', '1.99');
  rec('W2 0.75 lb at $2.49/lb, new price $1.99/lb: line $1.49 (149.25 c)', net(reg) === 1.49, `${net(reg)}`);
  // C clearing / switching
  ({ reg } = mk({ p: 10, q: 1, bq: 3, bp: 9 })); await reg.recalc(); await reg.lineDiscount(0, 'price', '8'); await reg.lineDiscount(0, 'percent', 10); await reg.setQty(0, 3);
  rec('C1 New price, then F4 10% off: the new price is forgotten, 10% off the line as before ($24.30 at qty 3)', net(reg) === 24.3, `${net(reg)}`);
  ({ reg } = mk({ p: 10, q: 1 })); await reg.recalc(); await reg.lineDiscount(0, 'price', '8'); await reg.lineDiscount(0, 'clear'); await reg.setQty(0, 2);
  rec('C2 New price, then Remove item discount: full price again ($20 at qty 2)', net(reg) === 20 && !reg.subs[0].isCustomDiscount, `${net(reg)}`);
  ({ reg } = mk({ p: 10, q: 1 })); await reg.recalc(); await reg.lineDiscount(0, 'price', '8'); const bad = await reg.lineDiscount(0, 'price', '11'); await reg.setQty(0, 2);
  rec('C3 a refused new price (higher than the original) keeps the earlier one ($16 at qty 2)', !bad.ok && net(reg) === 16, `${bad.message} | ${net(reg)}`);
  // S nothing new reaches AIR POS or the journal
  let A = mk({ p: 10, q: 2, t: 8 }), B = mk({ p: 10, q: 2, t: 8 }); await A.reg.recalc(); await B.reg.recalc(); await A.reg.lineDiscount(0, 'price', '7.49'); await B.reg.lineDiscount(0, 'amount', 5.02);
  const strip = l => l.map(({ id, itemId, productId, timestamp, discount, ...x }) => ({ ...x, discount: r2(discount) }));
  rec('S1 the line AIR POS gets = the same $-off line discount as before (no extra field)', JSON.stringify(strip(A.sent.at(-1))) === JSON.stringify(strip(B.sent.at(-1))) && !JSON.stringify(A.sent.at(-1)).includes('f4'), JSON.stringify(strip(A.sent.at(-1))[0]).slice(0, 160));
  rec('S2 the remembered new price is memory only (not in the saved sale / journal JSON)', !JSON.stringify(A.reg.subs).includes('f4') && A.reg.subs[0].f4NewPrice === 7.49, `f4NewPrice ${A.reg.subs[0].f4NewPrice}`);
  rec('S3 the item price itself is never changed', A.reg.subs[0].price === 10 && A.reg.subs[0].originalPrice === 10, `${A.reg.subs[0].price}`);
  // X the 2,640-combination sweep (plain items): line = new price x qty after any qty change, to the cent
  let n = 0, off = [];
  for (const p of [0.99, 1.49, 2.5, 3.33, 4.99, 7.77, 9.99, 10, 12.34, 19.95, 24.99, 99.99]) for (const f of [0.1, 0.33, 0.5, 0.67, 0.9]) { const np = r2(p * f); if (np >= p) continue;
    for (const q1 of [1, 2, 3, 7]) for (const q2 of [1, 2, 3, 4, 5, 6, 7, 9, 11, 12, 25]) { n++;
      const t = mk({ p, q: q1 }); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', String(np)); const x1 = net(t.reg); await t.reg.setQty(0, q2);
      if (Math.abs(x1 - r2(np * q1)) > 0.004 || Math.abs(net(t.reg) - r2(np * q2)) > 0.004) off.push({ p, np, q1, q2, got: net(t.reg) }); } }
  rec(`X1 sweep: ${n} price / new price / qty combinations, line = new price x qty to the cent`, n === 2640 && off.length === 0, `${off.length} off ${JSON.stringify(off.slice(0, 3))}`);
  const pass = out.filter(x => x.pass).length; console.log(`f4-multibuy-1011: ${pass}/${out.length} passed`);
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

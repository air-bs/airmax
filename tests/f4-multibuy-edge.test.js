// Independent review of the F4 multi-buy fix (commit 4a529b6, tag f4m1011): edge cases. Offline: Register with the same mocked
// AIR POS as tests/f4-multibuy-1011.test.js (multi-buy unit price the way saveSubmit sends it), made-up data, no card, no store.
// "KNOWN BUG" lines are real problems found in the review (the typed price is memory only, so it is lost when the sale's lines
// are rebuilt: Load Aside, crash recovery, Load Hold). They are printed but not counted, so the suite stays green; each turns
// into "FIXED" by itself once the fix lands. Every other check must pass.
// Run: node tests/f4-multibuy-edge.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = [], known = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const bug = (k, fixed, note) => { known.push({ k, fixed: !!fixed, note }); console.log((fixed ? 'FIXED ' : 'KNOWN BUG ') + k + ' — ' + note); };
const r2 = x => Math.round(x * 100) / 100;
const MB = { p: 10, q: 1, bq: 3, bp: 9 }; // $10 each, 3 or more $9 each (made up)
function mk(l) {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4e-')) }); reg.settingsPath = null;
  const api = reg.api, sent = []; api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true, corpName: 'Made-up corp', shopName: 'Made-up shop' };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { sent.push(JSON.parse(JSON.stringify(s.subs))); let tot = 0, tax = 0;
    for (const x of s.subs) { const q = x.quantity * (x.rate || 1), up = x.bulkPriceQuantity > 0 && x.bulkPrice > 0 && q >= x.bulkPriceQuantity ? x.bulkPrice : x.price, a = up * q - (x.discountAmount || 0); tot += a; tax += a * (x.taxRate || 0) / 100; }
    return { success: true, value: { subs: [], totalAmount: r2(tot), totalTax: r2(tax), totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: r2(tot) } }; };
  api.scan = async () => ({ success: true, value: { id: 'sub-' + Math.random().toString(36).slice(2), itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: l.rate || 1, price: l.p, originalPrice: l.p, bulkPriceQuantity: l.bq || 0, bulkPrice: l.bp || 0, taxRate: 0, discount: 0, discountAmount: 0 } });
  reg.mode = 'sale';
  reg.subs = [{ id: 's0', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: l.q, rate: l.rate || 1, price: l.p, originalPrice: l.p, bulkPriceQuantity: l.bq || 0, bulkPrice: l.bp || 0, taxRate: l.t || 0, discount: 0, discountAmount: 0, discountMethod: 10, isCustomDiscount: false, timestamp: 1 }];
  return { reg, sent };
}
const hasF4Key = txt => /"f4[A-Za-z]*"\s*:/i.test(txt); // a JSON KEY named f4…; random GUIDs can contain the letters f4, so plain text search would be a false alarm
const net = reg => r2(reg.lineAmount(reg.subs[0]) - reg.subs[0].discountAmount);
const start = async (l, np) => { const t = mk(l); await t.reg.recalc(); if (np != null) await t.reg.lineDiscount(0, 'price', String(np)); return t; };

(async () => {
  // ---- quantity changes by every route
  let { reg } = await start(MB, 8); await reg.addQty(0, 1); await reg.addQty(0, 1);
  rec('E1 + key twice from qty 1 (into the multi-buy): $24 = 3 x $8', net(reg) === 24, `${net(reg)}`);
  await reg.addQty(0, -1); rec('E2 then - key (qty 2, out of the multi-buy): $16', net(reg) === 16, `${net(reg)}`);
  ({ reg } = await start(MB, 8)); await reg.scan('0001'); await reg.scan('0001');
  rec('E3 scanning the same item twice more joins the line (qty 3): $24', reg.subs.length === 1 && reg.subs[0].quantity === 3 && net(reg) === 24, `${reg.subs.length} line(s), ${net(reg)}`);
  ({ reg } = await start(MB)); await reg.setQty(0, 3); await reg.lineDiscount(0, 'price', '8.50'); const at3 = net(reg); await reg.setQty(0, 1);
  rec('E4 new price typed at qty 3 (multi-buy $9 each): $25.50, back to qty 1: $8.50', at3 === 25.5 && net(reg) === 8.5, `${at3} -> ${net(reg)}`);
  ({ reg } = await start(MB, 8)); await reg.setQty(0, 12); rec('E5 large quantity (12): $96, never more than the store price', net(reg) === 96 && net(reg) <= reg.lineAmount(reg.subs[0]), `${net(reg)} of ${reg.lineAmount(reg.subs[0])}`);
  // ---- amounts at the edges
  ({ reg } = await start(MB, 0)); await reg.setQty(0, 4); rec('E6 new price $0 (free) stays free at qty 4 (line $0, discount = whole line)', net(reg) === 0 && reg.subs[0].discountAmount === 36, `${net(reg)}, off ${reg.subs[0].discountAmount}`);
  ({ reg } = await start({ p: 1, q: 1 }, 0.01)); await reg.setQty(0, 3); rec('E7 $0.01 each x 3 = $0.03', net(reg) === 0.03, `${net(reg)}`);
  ({ reg } = await start({ p: 4.99, q: 1 }, 3.99)); await reg.setQty(0, 2.5); rec('E8 fractional qty 2.5 x $3.99 = $9.98 (997.5 c rounds up)', net(reg) === 9.98, `${net(reg)}`);
  ({ reg } = await start({ p: 4, q: 1, bq: 2, bp: 3, rate: 0.75 }, 3.5)); const w1 = net(reg); await reg.setQty(0, 3);
  rec('E9 weighed 0.75 lb, $3.50/lb; qty 3 = 2.25 lb crosses the $3/lb multi-buy: the lower $6.75 wins, no discount', w1 === 2.63 && net(reg) === 6.75 && reg.subs[0].discountAmount === 0, `${w1} -> ${net(reg)}`);
  ({ reg } = await start(MB, 9.5)); await reg.setQty(0, 3); const mb = net(reg); await reg.setQty(0, 1);
  rec('E10 $9.50 beaten by the multi-buy at qty 3 ($27, $0 off), back to qty 1: $9.50 again', mb === 27 && net(reg) === 9.5, `${mb} -> ${net(reg)}`);
  // ---- other discounts and settings around it
  ({ reg } = await start(MB, 8)); await reg.setOrderDiscount('percent', 10); await reg.setQty(0, 3);
  rec('E11 an order discount added later does not change the line ($24); it is applied on the order', net(reg) === 24, `${net(reg)}, due ${reg.totals.due}`);
  ({ reg } = await start(MB, 8)); await reg.setTaxExempt(true, {}); await reg.setQty(0, 3); rec('E12 Tax Off, then qty 3: $24', net(reg) === 24, `${net(reg)}`);
  ({ reg } = await start(MB, 8)); const big = await reg.lineDiscount(0, 'amount', 999); await reg.setQty(0, 3);
  rec('E13 a refused $ off (more than the line) keeps the new price: $24 at qty 3', !big.ok && net(reg) === 24, `${big.message} | ${net(reg)}`);
  ({ reg } = await start(MB, 8)); const bad = await reg.lineDiscount(0, 'percent', 120); await reg.setQty(0, 3);
  rec('E14 a refused % off (over 100) keeps the new price: $24 at qty 3', !bad.ok && net(reg) === 24, `${bad.message} | ${net(reg)}`);
  ({ reg } = await start(MB, 8)); const blank = await reg.lineDiscount(0, 'price', ''); await reg.setQty(0, 3);
  rec('E15 a blank new price is refused ("Type the new price") and keeps the earlier one', !blank.ok && /Type the new price/.test(blank.message) && net(reg) === 24, `${blank.message} | ${net(reg)}`);
  ({ reg } = await start(MB, 8)); await reg.lineDiscount(0, 'price', '10'); await reg.setQty(0, 3);
  rec('E16 new price back to the original $10 = no discount; qty 3 is the plain multi-buy $27', net(reg) === 27 && !reg.subs[0].isCustomDiscount, `${net(reg)}`);
  ({ reg } = await start(MB, 8)); await reg.lineDiscount(0, 'amount', 1); await reg.setQty(0, 3);
  rec('E17 New price then $1 off: the new price is forgotten, $1 off works as before (old rule, kept as a %)', net(reg) === r2(27 - r2(27 * 10 / 100)), `${net(reg)}`);
  // ---- two lines: one with a new price, one without
  ({ reg } = await start(MB, 8)); reg.subs.push({ id: 's1', itemId: 'i1', productId: 'p1', number: '0002', name: 'Second made-up item', quantity: 1, rate: 1, price: 5, originalPrice: 5, bulkPriceQuantity: 0, bulkPrice: 0, taxRate: 0, discount: 0, discountAmount: 0, discountMethod: 10, isCustomDiscount: false, timestamp: 0 });
  await reg.recalc(); await reg.setQty(1, 3); await reg.setQty(0, 3);
  rec('E18 another line is not touched by the first line\'s new price ($24 + $15 = $39)', net(reg) === 24 && r2(reg.lineAmount(reg.subs[1]) - reg.subs[1].discountAmount) === 15 && reg.totals.due === 39, `due ${reg.totals.due}`);
  // ---- saved data: nothing new on disk or to AIR POS; restoring never changes a price by itself
  let t = await start(MB, 8); await t.reg.setQty(0, 2); const before = net(t.reg), due0 = t.reg.totals.due; t.reg.putAside();
  const asideTxt = fs.readFileSync(t.reg.dataFile('aside.json'), 'utf8'); await t.reg.loadAside(t.reg.asideAll()[0].id);
  rec('E19 Put Aside saves no new field (aside.json has no f4 key); Load Aside brings the line back unchanged ($16)', !hasF4Key(asideTxt) && net(t.reg) === before && t.reg.totals.due === due0, `${before} -> ${net(t.reg)}`);
  t = await start(MB, 8); await t.reg.setQty(0, 3); const sub = t.reg.saveSubmit(false).subs[0];
  rec('E20 what is saved to AIR POS is the plain $-off line (no f4 field, price unchanged)', !Object.keys(sub).some(k => /f4/i.test(k)) && sub.price === 9 && r2(sub.discountAmount) === 3, JSON.stringify({ price: sub.price, discountAmount: sub.discountAmount, discountMethod: sub.discountMethod }));

  // ---- Gordon OK Nov 3: the typed price survives the sale being rebuilt (was lost: the next qty change went back to the % rule)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-'));
  const at = (l, d) => { const t = mk(l); if (d) { t.reg.dataDir = d; t.reg.journal.dir = d; } return t; };
  const restart = (d, l) => { const t = mk(l); t.reg.dataDir = d; t.reg.subs = []; return t.reg; }; // a new Air Max process on the same PC (same data folder), empty sale
  t = at(MB, dir); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); t.reg.putAside(); await t.reg.loadAside(t.reg.asideAll()[0].id); await t.reg.setQty(0, 3);
  rec('K1 Put Aside -> Load Aside, then qty 3 (multi-buy): $24 = 3 x $8 (was $21.60)', net(t.reg) === 24, `${net(t.reg)}`);
  t = at(MB, fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-'))); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '9.50'); await t.reg.setQty(0, 3); t.reg.putAside();
  let r2g = restart(t.reg.dataDir, MB); await r2g.loadAside(r2g.asideAll()[0].id); const mb2 = net(r2g); await r2g.setQty(0, 1);
  rec('K2 $9.50 beaten by the multi-buy ($27, $0 off), Put Aside, RESTART, Load Aside, qty 1: $9.50 (was the full $10)', mb2 === 27 && net(r2g) === 9.5, `${mb2} -> ${net(r2g)}`);
  t = at(MB, fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-'))); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); await t.reg.setQty(0, 2);
  const jsubs = JSON.parse(JSON.stringify(t.reg.subs)); r2g = restart(t.reg.dataDir, MB); r2g.subs = jsubs; await r2g.recalc(); const j1 = net(r2g); await r2g.setQty(0, 3); // what crash recovery restores (recovery.js: this.subs = j.subs)
  rec('K3 crash recovery (lines from the journal, NEW process): $16 as before, then qty 3: $24 (was $21.60)', j1 === 16 && net(r2g) === 24, `${j1} -> ${net(r2g)}`);
  t = at(MB, fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-'))); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); await t.reg.setQty(0, 2);
  let saved = null; t.reg.api.orderSave = async s => { saved = JSON.parse(JSON.stringify(s)); return { success: true }; };
  const h = await t.reg.hold(); r2g = restart(t.reg.dataDir, MB);
  r2g.api.receiveAllCancel = async () => ({ success: true }); r2g.api.orderGet = async () => ({ success: true, value: { ...saved, number: 'H100', status: 15, receives: [], subs: saved.subs.map(x => ({ ...x, number: '0001', name: 'Made-up item', price: 10, bulkPriceQuantity: 3, bulkPrice: 9 })) } }); // as Load Hold gets it back from AIR POS
  const rs = await r2g.resume(saved.id); const h1 = net(r2g); await r2g.setQty(0, 3);
  rec('K4 Hold, RESTART, Load Hold (lines from AIR POS, same ids): $16, then qty 3: $24 (was $21.60)', h.ok && rs.ok && h1 === 16 && net(r2g) === 24, `${h.message} / ${rs.message}: ${h1} -> ${net(r2g)}`);
  t = at({ p: 4.99, q: 1, rate: 1.5 }, fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-'))); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '3.99'); t.reg.putAside();
  r2g = restart(t.reg.dataDir, { p: 4.99, q: 1, rate: 1.5 }); await r2g.loadAside(r2g.asideAll()[0].id); const w0 = net(r2g); await r2g.setQty(0, 2);
  rec('K5 weighed 1.5 lb at $3.99/lb kept over Put Aside / restart: $5.99, then qty 2 (3 lb): $11.97, whole cents', w0 === 5.99 && net(r2g) === 11.97, `${w0} -> ${net(r2g)}`);
  const WB = { p: 4, q: 1, bq: 2, bp: 3, rate: 0.75 }; t = at(WB, fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-'))); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '2.50'); t.reg.putAside();
  r2g = restart(t.reg.dataDir, WB); await r2g.loadAside(r2g.asideAll()[0].id); const wb0 = net(r2g); await r2g.setQty(0, 3);
  rec('K5b weighed 0.75 lb with a $3/lb multi-buy from 2 lb, new price $2.50/lb, Put Aside / restart, qty 3 (2.25 lb): $5.63 (old % rule: $4.23)', wb0 === 1.88 && net(r2g) === 5.63, `${wb0} -> ${net(r2g)}`);
  t = at(MB, fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-'))); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); t.reg.putAside();
  r2g = restart(t.reg.dataDir, MB); await r2g.loadAside(r2g.asideAll()[0].id); await r2g.lineDiscount(0, 'percent', 10); const kept = fs.readFileSync(path.join(t.reg.dataDir, 'f4-prices.json'), 'utf8'); await r2g.setQty(0, 3);
  rec('K6 after a restore, F4 10% off forgets the typed price (also on this PC): 10% off at qty 3 = $24.30', net(r2g) === 24.3 && kept === '{}', `${net(r2g)}, f4-prices.json ${kept}`);
  // ---- what is kept, and where
  const d7 = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-')); t = at(MB, d7); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); t.reg.journalSnap('route');
  const f4f = JSON.parse(fs.readFileSync(path.join(d7, 'f4-prices.json'), 'utf8')), ent = f4f.s0 || {};
  const jtxt = fs.existsSync(t.reg.journal.file || '') ? fs.readFileSync(t.reg.journal.file, 'utf8') : JSON.stringify(t.reg.journal.read() || {});
  rec('K7 f4-prices.json keeps only line id -> price and time (no name, customer or card data); the journal does not carry it', JSON.stringify(Object.keys(f4f)) === '["s0"]' && JSON.stringify(Object.keys(ent).sort()) === '["at","price"]' && ent.price === 8 && !hasF4Key(jtxt), JSON.stringify(f4f));
  t.reg.putAside(); r2g = restart(d7, MB); await r2g.loadAside(r2g.asideAll()[0].id); const n0 = t.sent.length; await r2g.setQty(0, 3);
  rec('K8 after a restore nothing new goes to AIR POS (the line it gets has no f4 field)', !hasF4Key(JSON.stringify(r2g.subs)) && !hasF4Key(JSON.stringify(r2g.saveSubmit(false))), '');
  const d9 = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-')); fs.writeFileSync(path.join(d9, 'f4-prices.json'), JSON.stringify({ old: { price: 1, at: Date.now() - 50 * 86400000 }, keep: { price: 2, at: Date.now() } }));
  t = at(MB, d9); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); const f9 = JSON.parse(fs.readFileSync(path.join(d9, 'f4-prices.json'), 'utf8'));
  rec('K9 entries older than 45 days are dropped when the file is next written', !('old' in f9) && 'keep' in f9 && 's0' in f9, Object.keys(f9).join(','));
  const d10 = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-')); fs.writeFileSync(path.join(d10, 'f4-prices.json'), '{not json');
  t = at(MB, d10); await t.reg.recalc(); const ok10 = await t.reg.lineDiscount(0, 'price', '8'); await t.reg.setQty(0, 3);
  rec('K10 a damaged f4-prices.json is ignored (no crash) and written fresh', ok10.ok && net(t.reg) === 24 && JSON.parse(fs.readFileSync(path.join(d10, 'f4-prices.json'), 'utf8')).s0.price === 8, '');
  const d11 = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-')); t = at(MB, d11); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8');
  r2g = restart(d11, MB); r2g.subs = [{ ...t.reg.subs[0] }]; r2g.subs[0].id = 'another-line'; r2g.subs[0].isCustomDiscount = true; r2g.subs[0].discountMethod = 20; r2g.subs[0].discount = 20; await r2g.setQty(0, 3);
  rec('K11 another line (other id) never picks up a kept price: its own $-off rule as before', net(r2g) === r2(27 - 27 * 0.2), `${net(r2g)}`);
  // ---- returns and reprint of a sale that had a typed price
  const d12 = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4k-')); t = at(MB, d12); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); await t.reg.setQty(0, 3);
  const sold = t.reg.saveSubmit(false); r2g = restart(d12, MB); const before12 = fs.readFileSync(path.join(d12, 'f4-prices.json'), 'utf8');
  r2g.api.orderGet = async () => ({ success: true, value: { id: sold.id, number: 'RO1', status: 20, amount: 24, tax: 0, retailMemberId: null, returnPayments: [], promotionSubs: [], receives: [{ id: 'rc1', paymentType: 10, amount: 24 }],
    subs: sold.subs.map(x => ({ ...x, number: '0001', upc: '', name: 'Made-up item', quantityTotal: 3, quantityReturn: 0, isRetailRefund: true, promotionType: 0 })) } }); // the completed sale as AIR POS keeps it
  const st = await r2g.startReturn('receipt', sold.id); const sc = await r2g.returnScan('0001'); const rt = r2g.returnTotals();
  rec('K12 return with receipt of 1 item from that sale: refund $8.00 (what was paid per item), from the sale on AIR POS', st.ok && sc.ok && rt.refund === 8, `${st.message} | refund ${rt.refund}`);
  rec('K13 the return line is a new line (new id, no kept price) and the kept prices on this PC are not changed', r2g.ret.subs.every(x => x.id !== 's0' && x.f4NewPrice == null) && fs.readFileSync(path.join(d12, 'f4-prices.json'), 'utf8') === before12, '');
  await r2g.cancelReturn();
  const bills = []; r2g.api.billTemplateConfigGet = async () => ({ success: true, value: { templates: [{ id: 't1', name: 'Standard', fields: [] }], defaultTemplateId: 't1', orderPrintId: 'op', orderSubs: [] } });
  r2g.api.billContentGet = async (id, extra) => { bills.push({ id, extra }); return { success: true, value: { billBase64: Buffer.from('%PDF-1.4 fake').toString('base64') } }; };
  r2g.printPdfBase64 = async () => ({ ok: true, message: 'printed' }); r2g.hw = { present: false };
  const rp = await r2g.printOrder(sold.id); const after12 = fs.readFileSync(path.join(d12, 'f4-prices.json'), 'utf8');
  rec('K14 reprint of that sale asks AIR POS for its receipt only (no f4 field sent) and changes nothing kept', rp && rp.ok !== false && bills.length >= 1 && !hasF4Key(JSON.stringify(bills)) && after12 === before12, `${(rp && rp.message) || ''} | ${bills.length} bill request(s)`);
  // ---- owner decision (Nov 3): a multi-buy price typed as the new price REPLACES the earlier typed price (current behaviour, pinned)
  const dD = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-f4d-')); t = at(MB, dD); await t.reg.recalc(); await t.reg.lineDiscount(0, 'price', '8'); await t.reg.setQty(0, 3);
  const was = net(t.reg), mbx = await t.reg.lineDiscount(0, 'price', '9'); const atMb = net(t.reg), fileD = fs.readFileSync(path.join(dD, 'f4-prices.json'), 'utf8');
  rec('D1 owner decision: $8 typed, qty 3, then the multi-buy price $9 typed: "same as the original price", plain multi-buy $27, no discount', was === 24 && mbx.ok && /same as the original price \$9\.00, no discount/.test(mbx.message) && atMb === 27 && !t.reg.subs[0].isCustomDiscount && t.reg.subs[0].discountAmount === 0, `${was} -> ${atMb} | ${mbx.message}`);
  rec('D2 ...the earlier $8 is forgotten, in memory and on this PC (f4-prices.json has no entry)', t.reg.subs[0].f4NewPrice == null && fileD === '{}', `f4-prices.json ${fileD}`);
  await t.reg.setQty(0, 1); const q1 = net(t.reg); await t.reg.setQty(0, 3); const q3 = net(t.reg);
  rec('D3 ...so later quantity changes use the store prices: qty 1 = $10 (full price), qty 3 = $27 (multi-buy)', q1 === 10 && q3 === 27, `qty 1 ${q1}, qty 3 ${q3}`);
  t.reg.putAside(); r2g = restart(dD, MB); await r2g.loadAside(r2g.asideAll()[0].id); await r2g.setQty(0, 1);
  rec('D4 ...and the $8 does not come back after Put Aside, a restart and Load Aside (qty 1 = $10)', net(r2g) === 10 && r2g.subs[0].f4NewPrice == null, `${net(r2g)}`);

  const pass = out.filter(x => x.pass).length; console.log(`f4-multibuy-edge: ${pass}/${out.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'f4-multibuy-edge-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

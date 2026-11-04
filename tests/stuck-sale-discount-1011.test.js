// airmax-fix-stock (Nov 2 2026, a live-store sale): AIR POS due vs the card charge when an ORDER % discount is on the sale and items
// are added / removed / changed afterwards. Offline: mocked AIR POS that works out the due the way AIR POS did on that sale
// (net = lines - the order discount AMOUNT it was sent; tax = line tax x (1 - order discount %); Complete refuses received < due).
// Made-up items and prices. Run: node tests/stuck-sale-discount-1011.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note || '').slice(0, 300)); };
const r2 = x => Math.round(x * 100) / 100;
const CAT = { A: ['Boat toy', 29.99], B: ['Tower kit one', 2.99], C: ['Tower kit two', 2.99], D: ['Tower kit three', 2.99], E: ['Puzzle', 12.5] };
function mk(opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-sd-')), logs = [];
  const reg = new Register({ log: m => logs.push(m), dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  const api = reg.api, srv = { saved: null, begins: [], completes: [], gets: 0, skew: 0, skewSaves: 0, hideAmounts: !!opt.hideAmounts, refuseShortOnce: false };
  api.ide = 'x'; reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  const lines = s => s.subs.reduce((a, x) => a + x.price * x.quantity, 0);
  // AIR POS-like numbers from the SAVED order (what that sale showed)
  const server = () => { const o = srv.saved; if (!o) return null; const gross = lines(o), net = gross - (o.orderDiscountAmount || 0); const tax = o.subs.reduce((a, x) => a + x.price * x.quantity * (x.taxRate || 0) / 100, 0) * (1 - (o.orderDiscount || 0) / 100); return { net, tax, due: r2(net) + r2(tax) + srv.skew }; };
  srv.server = server;
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0), tax = s.subs.reduce((a, x) => a + x.quantity * x.price * (x.taxRate || 0) / 100, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async s => { srv.saved = JSON.parse(JSON.stringify(s)); if (srv.skewSaves > 0 && --srv.skewSaves === 0) srv.skew = 0; return { success: true }; };
  api.receiveBegin = async s => { srv.begins.push({ type: s.paymentType, amount: s.amount, id: s.id }); return { success: true, value: { isCompleted: true } }; };
  api.complete = async () => { const sv = server(), got = r2(srv.begins.reduce((a, b) => a + b.amount, 0)); srv.completes.push({ due: sv && sv.due, got });
    if (sv && got + 0.05 < sv.due) return { success: false, message: 'The received amount is less than the amount due, the order cannot be completed.' }; srv.done = true; return { success: true }; };
  api.orderGet = async () => { srv.gets++; const sv = server(), o = srv.saved; const base = { id: reg.order.id, number: 'RO1', status: srv.done ? 20 : 15, receives: srv.begins.map(b => ({ id: b.id, status: 20, paymentType: b.type, amount: b.amount })) };
    return { success: true, value: sv && !srv.hideAmounts ? { ...base, subs: o.subs, orderDiscountAmount: o.orderDiscountAmount, amount: sv.net + srv.skew, tax: sv.tax } : base }; };
  api.scan = async code => { const c = CAT[code]; if (!c) return { success: false, message: 'Item not found' };
    return { success: true, value: { id: 'sub-' + code + '-' + Math.random(), itemId: 'i' + code, productId: 'p' + code, number: code, name: c[0], quantity: 1, rate: 1, price: c[1], originalPrice: c[1], taxRate: 8, discount: 0, discountAmount: 0, type: 0, timestamp: 0 } }; };
  api.productPaged = async () => ({ success: true, rows: [] });
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' }); reg.mode = 'sale';
  return { reg, srv, logs };
}
const dueNow = t => t.srv.server().due;
// ring items, apply the discount (when asked), then run `after`, then pay by card and complete; compare AIR POS's due with the card charge
async function scenario(name, first, disc, after, opt = {}) {
  const t = mk(opt); for (const c of first) await t.reg.scan(c);
  if (disc) await t.reg.setOrderDiscount(disc[0], disc[1]);
  if (after) await after(t.reg);
  const shown = t.reg.totals.due; let sv = await t.reg.startPay(); const r = await t.reg.tender({ type: 20 });
  const due = t.srv.server() && t.srv.server().due, charge = t.srv.begins.reduce((a, b) => a + b.amount, 0);
  rec(`${name}: AIR POS due = card charge = total shown, and the sale completes`, r.ok && r.completed && !t.srv.completes.some(c => c.got + 0.004 < c.due) && Math.abs(due - charge) < 0.005 && Math.abs(shown - charge) < 0.005 && t.srv.done,
    JSON.stringify({ shown, charge, airposDue: due, ok: r.ok, completed: r.completed, msg: (r.message || '').slice(0, 120), sentDiscAmt: t.srv.saved && t.srv.saved.orderDiscountAmount, sentDiscPct: t.srv.saved && t.srv.saved.orderDiscount }));
  return t;
}
(async () => {
  // the reported-sale shape: 33% off, then 3 more items
  await scenario('V1 33% order discount, THEN 3 more items (the reported sale)', ['A'], ['percent', 33], async g => { await g.scan('B'); await g.scan('C'); await g.scan('D'); });
  await scenario('V2 33% order discount on 4 items, THEN 2 removed', ['A', 'B', 'C', 'D'], ['percent', 33], async g => { await g.remove(0); await g.remove(0); });
  await scenario('V3 33% order discount, THEN quantity raised 1 -> 4', ['A', 'B'], ['percent', 33], async g => { await g.setQty('last', 4); });
  await scenario('V4 33% order discount, THEN quantity lowered 5 -> 2', ['A', 'B'], ['percent', 33], async g => { await g.setQty('last', 5); await g.setQty('last', 2); });
  await scenario('V5 10% discount, add, remove, change quantity, add again', ['A'], ['percent', 10], async g => { await g.scan('E'); await g.remove('last'); await g.setQty(0, 3); await g.scan('B'); });
  await scenario('V6 $5 order discount (amount), THEN more items', ['A'], ['amount', 5], async g => { await g.scan('B'); await g.scan('E'); });
  await scenario('V7 discount set, cleared, items added', ['A'], ['percent', 33], async g => { await g.setOrderDiscount('clear', 0); await g.scan('B'); });
  await scenario('V8 no order discount (control)', ['A', 'B'], null, async g => { await g.scan('C'); });
  await scenario('V9 discount set while the cart is a single line, 33% again after more items (re-applied)', ['A'], ['percent', 33], async g => { await g.scan('B'); await g.setOrderDiscount('percent', 33); await g.scan('E'); });
  // what was SENT to AIR POS on every Save/Complete: the amount is 33% of ALL current lines
  let t = mk(); await t.reg.scan('A'); await t.reg.setOrderDiscount('percent', 33); await t.reg.scan('B'); await t.reg.scan('C'); await t.reg.scan('D'); await t.reg.startPay(); await t.reg.tender({ type: 20, amount: 5 });
  const want = r2(0.33 * (29.99 + 3 * 2.99)); const sent = t.srv.saved.orderDiscountAmount;
  rec('V10 the Save sent to AIR POS carries 33% of ALL four lines, not of the first line', Math.abs(sent - want) < 0.005, `sent ${sent}, want ${want}`);
  // hold after changes sends the right amount too
  t = mk(); await t.reg.scan('A'); await t.reg.setOrderDiscount('percent', 33); await t.reg.scan('B'); await t.reg.hold();
  rec('V11 Hold sends the right discount amount', Math.abs(t.srv.saved.orderDiscountAmount - r2(0.33 * (29.99 + 2.99))) < 0.005, String(t.srv.saved && t.srv.saved.orderDiscountAmount));
  // ---- before any card is charged AirMax compares its total with AIR POS's due ----
  t = mk(); await t.reg.scan('A'); await t.reg.scan('B'); t.srv.skew = 2.97; await t.reg.startPay(); let r = await t.reg.tender({ type: 20 });
  rec('D1 AIR POS due differs from the total: NOTHING charged, clear message with both totals', !r.ok && r.dueMismatch && t.srv.begins.length === 0 && /AIR POS/.test(r.message) && /\$3[0-9]\.\d\d/.test(r.message) && /Nothing was charged/.test(r.message), r.message);
  rec('D2 ...and the log says so (both totals)', t.logs.some(l => /TOTAL MISMATCH/.test(l) && /AIR POS/.test(l)), t.logs.filter(l => /MISMATCH/.test(l)).join(' // '));
  rec('D3 ...the sale is still open and editable (nothing paid, not locked)', !t.reg.locked() && t.reg.subs.length === 2, String(t.reg.locked()));
  t.srv.skew = 0; r = await t.reg.tender({ type: 20 });
  rec('D4 once the two totals agree again the same sale is charged once and completes', r.ok && r.completed && t.srv.begins.length === 1, JSON.stringify({ ok: r.ok, begins: t.srv.begins.length }));
  t = mk(); await t.reg.scan('A'); t.srv.skew = 0.02; await t.reg.startPay(); r = await t.reg.tender({ type: 20 });
  rec('D5 a rounding difference of 2 cents is NOT blocked', r.ok && t.srv.begins.length === 1, r.message);
  t = mk({ hideAmounts: true }); await t.reg.scan('A'); await t.reg.startPay(); r = await t.reg.tender({ type: 20 });
  rec('D6 AIR POS does not show its amounts: no check possible, sale goes on as before', r.ok && r.completed, r.message);
  t = mk(); await t.reg.scan('A'); t.srv.skew = 1; t.reg.api.orderGet = async () => ({ success: false, unreachable: true, message: 'Network error' }); await t.reg.startPay(); r = await t.reg.tender({ type: 20 });
  rec('D7 the look-up of AIR POS\'s total fails: not blocked (as before), the Complete step still protects', t.srv.begins.length === 1, JSON.stringify({ ok: r.ok, begins: t.srv.begins.length }));
  // ---- a refusal for "received less than due" after payment: re-send and finish once more ----
  t = mk({ hideAmounts: true }); await t.reg.scan('A'); await t.reg.scan('B'); t.srv.skew = 2.97; t.srv.skewSaves = 2; await t.reg.startPay();
  // the stale amount sits on AIR POS; the 2nd Save (the re-send) puts it right
  r = await t.reg.tender({ type: 20 });
  rec('R1 AIR POS refused "received less than due" at Complete: Air Max re-sent the order and finished it (one card payment)', r.ok && r.completed && t.srv.begins.length === 1 && t.srv.completes.length === 2, JSON.stringify({ ok: r.ok, c: r.completed, begins: t.srv.begins.length, completes: t.srv.completes.length, msg: (r.message || '').slice(0, 100) }));
  t = mk({ hideAmounts: true }); await t.reg.scan('A'); t.srv.skew = 2.97; await t.reg.startPay(); r = await t.reg.tender({ type: 20 });
  rec('R2 a refusal that a re-send cannot cure: sale kept paid, reason shown, only ONE re-send per Finish, nothing charged again', !r.ok && r.completeFailed && t.srv.begins.length === 1 && t.srv.completes.length === 2 && /less than/i.test(t.reg.pay.lastError + r.message), JSON.stringify({ ok: r.ok, begins: t.srv.begins.length, completes: t.srv.completes.length }));
  const p2 = await t.reg.finishSale();
  rec('R3 pressing Finish sale again re-sends once more and still never charges again', t.srv.begins.length === 1 && !p2.ok, JSON.stringify({ begins: t.srv.begins.length, completes: t.srv.completes.length }));
  const pass = out.filter(x => x.pass).length; console.log(`stuck-sale-discount-1011: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

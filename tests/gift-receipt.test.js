// Add Gift Receipt (work copy, not released). AIR POS 1.9.11 has no gift-receipt option: Air Register only marks the
// sale and, when it completes, prints the store's own AIR POS bill template whose name contains "gift".
// Offline: the Register class with a mocked AIR POS api (no network, no printer). Money calls must be identical with/without.
'use strict';
const fs = require('fs'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
function mk(templates) {
  const reg = new Register({ log: () => {} }); const api = reg.api, calls = [], bills = [], printed = [];
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2 }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} } };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async s => { calls.push('save:' + s.paymentType + ':' + s.subs.length); return { success: true }; };
  api.receiveBegin = async s => { calls.push('begin:' + s.paymentType + ':' + s.amount); return { success: true, value: { isCompleted: true } }; };
  api.complete = async () => { calls.push('complete'); return { success: true }; };
  api.billTemplateConfigGet = async () => ({ success: true, value: { templates, defaultTemplateId: templates[0] && templates[0].id, orderPrintId: 'op', orderSubs: [] } });
  api.billContentGet = async (id, extra) => { bills.push(extra ? extra.templateId : 'default'); return { success: true, value: { billBase64: 'eA==' } }; };
  reg.printPdfBase64 = async (b, msg) => { printed.push(msg); return { ok: true, message: msg }; };
  reg.drawer = async () => ({ ok: true, message: 'drawer' }); reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', name: 'Item 0', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, calls, bills, printed, extra: () => bills.filter(b => /gift/i.test(b)) }; // 1.0.10-local.2: auto print defaults to Always, so the normal receipt (t-std or default) prints too; these checks are about the gift receipt only
}
async function sell(t, gift) {
  await t.reg.recalc(); if (gift) t.reg.setGiftReceipt(true);
  await t.reg.startPay(); const r = await t.reg.tender({ type: 10, tendered: 20 });
  if (r && r.hwJob) for (const [k, v] of await r.hwJob) if (k === 'gift') r.giftReceipt = v; // request L: printing now runs after the sale, in the background
  return r;
}
(async () => {
  const TPL = [{ id: 't-std', name: 'Standard', fields: [] }, { id: 't-gift', name: 'Gift Receipt', fields: [] }];
  let t = mk(TPL);
  const on = t.reg.setGiftReceipt(true), s1 = t.reg.state().giftReceipt, off = t.reg.setGiftReceipt(false), s2 = t.reg.state().giftReceipt;
  rec('Toggle: on marks this sale, off clears it', on.ok && s1 === true && off.ok && s2 === false, `${on.message} / ${off.message}`);
  t = mk(TPL); const r = await sell(t, true);
  rec('Marked sale + store has a "Gift Receipt" template: that template prints after the sale', r.ok && r.giftReceipt && r.giftReceipt.ok && t.extra().join() === 't-gift', `${r.giftReceipt && r.giftReceipt.message}; bill templates asked: ${t.bills.join()}`);
  rec('Flag cleared for the next sale', t.reg.state().giftReceipt === false, 'state.giftReceipt=' + t.reg.state().giftReceipt);
  const u = mk(TPL); const r0 = await sell(u, false);
  rec('Unmarked sale: no gift receipt printed', r0.ok && !r0.giftReceipt && u.extra().length === 0, 'gift bills ' + u.extra().length + ' (all bills: ' + u.bills.join() + ')');
  rec('Money calls identical with and without the gift receipt', t.calls.join() === u.calls.join() && r.due === r0.due && r.change === r0.change, t.calls.join(' '));
  const n = mk([{ id: 't-std', name: 'Standard', fields: [] }]); const rn = await sell(n, true);
  rec('No gift template in AIR POS: sale still completes, nothing extra prints, cashier told why', rn.ok && rn.completed && rn.giftReceipt && !rn.giftReceipt.ok && rn.giftReceipt.noTemplate && n.extra().length === 0, rn.giftReceipt && rn.giftReceipt.message);
  const m = mk(TPL); m.reg.setGiftReceipt(true); const oldId = m.reg.order.id; m.reg.resetOrder();
  rec('New sale (e.g. Esc/void) is never marked by the old sale', m.reg.state().giftReceipt === false && m.reg.giftReceiptFor === oldId, 'state.giftReceipt=' + m.reg.state().giftReceipt);
  const rt = mk(TPL); rt.reg.mode = 'return'; const rr = rt.reg.setGiftReceipt(true);
  rec('Return mode: refused', !rr.ok, rr.message);
  const sc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'shortcuts.json'), 'utf8')).keys.filter(k => k.key === 'F10');
  rec('F10 = gift-receipt only', sc.length === 1 && sc[0].action === 'gift-receipt', JSON.stringify(sc.map(k => k.action)));
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} gift receipt tests passed`);
  fs.writeFileSync(path.join(__dirname, 'gift-receipt-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

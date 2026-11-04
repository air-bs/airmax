// Payment side panel (work copy, not released): once part of a sale is paid, ONLY "add more" is allowed
// (scan an item, raise a quantity). Removing / lowering / discounts stay blocked so the sale never drops below what is paid.
// Offline: the Register class with a mocked AIR POS api (no network, no card).
'use strict';
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
function mk(cardCompletes = true) {
  const reg = new Register({ log: () => {} }); const api = reg.api, calls = [];
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2 }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} } };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async s => { calls.push('save:' + s.paymentType + ':' + s.subs.length + 'lines'); return { success: true }; };
  api.receiveBegin = async s => { calls.push('begin:' + s.paymentType + ':' + s.amount); return { success: true, value: { isCompleted: cardCompletes || s.paymentType !== 20 } }; };
  api.receiveCheck = async () => ({ success: true, value: { isCompleted: false } });
  api.receiveCancel = async () => ({ success: true });
  api.complete = async () => { calls.push('complete'); return { success: true }; };
  api.scan = async code => ({ success: true, value: { id: 's' + code, itemId: 'i' + code, productId: 'p' + code, name: 'Item ' + code, quantity: 1, rate: 1, price: 5, discount: 0, discountAmount: 0 } });
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', name: 'Item 0', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, calls };
}
(async () => {
  let t = mk(); await t.reg.recalc(); await t.reg.startPay();
  const due0 = t.reg.state().pay.remaining;
  await t.reg.tender({ type: 20, amount: 4 }); // card $4 taken (fake terminal approves)
  const paid = t.reg.paidTotal(), rem1 = t.reg.state().pay.remaining;
  rec('Card $4 of $10 taken: paid 4, remaining 6', due0 === 10 && paid === 4 && rem1 === 6, `due ${due0} paid ${paid} remaining ${rem1}`);
  const s = await t.reg.scan('77'); const rem2 = t.reg.state().pay && t.reg.state().pay.remaining;
  rec('Scan a new $5 item after the card payment: allowed, card payment kept, remaining 11', s.ok && t.reg.paidTotal() === 4 && rem2 === 11 && t.reg.pay.tenders.length === 1, `${s.message || 'ok'}; paid ${t.reg.paidTotal()} remaining ${rem2}`);
  const row = t.reg.subs.findIndex(x => x.itemId === 'i77');
  const up = await t.reg.addQty(row, 1);
  rec('Raise quantity (+1) after a payment: allowed, remaining 16', up.ok && t.reg.state().pay.remaining === 16, `${up.message || 'ok'}; remaining ${t.reg.state().pay.remaining}`);
  const dn = await t.reg.addQty(row, -1), rm = await t.reg.remove(row), sq = await t.reg.setQty(row, 1);
  rec('Lower quantity / set lower / remove after a payment: refused, nothing changed', !dn.ok && !rm.ok && !sq.ok && t.reg.subs[row].quantity === 2 && t.reg.subs.length === 2, [dn.message, rm.message].join(' / '));
  const disc = await (t.reg.lineDiscount ? t.reg.lineDiscount(row, 50) : Promise.resolve({ ok: false, message: 'n/a' }));
  rec('Line discount after a payment: still refused', !disc.ok, disc.message);
  const cl = await t.reg.closePay();
  rec('Cannot cancel the payment while money is taken (as before)', !cl.ok && t.reg.pay, cl.message);
  const fin = await t.reg.tender({ type: 10, tendered: 20 });
  rec('Cash pays only the remaining $16; the next save sends all 2 lines; sale completes', fin.ok && t.reg.completed && t.calls.includes('begin:10:16') && t.calls.some(c => c === 'save:99:2lines') && t.calls.includes('complete'), t.calls.join(' '));
  // card waiting: nothing may be added
  t = mk(false); await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 20, amount: 4 });
  const w1 = await t.reg.scan('77'), w2 = await t.reg.addQty(0, 1);
  rec('Card still waiting on the terminal: scan and qty + refused', !w1.ok && !w2.ok && t.reg.subs.length === 1 && t.reg.subs[0].quantity === 1, [w1.message, w2.message].join(' / '));
  await t.reg.cardCancel();
  // no payment yet: everything as before
  t = mk(); await t.reg.recalc();
  const n1 = await t.reg.scan('77'), n2 = await t.reg.addQty(0, -0), n3 = await t.reg.remove(0);
  rec('No payment started: scan / remove work as before', n1.ok && n3.ok && t.reg.subs.length === 1, [n1.message, n3.message].join(' / ') || 'ok');
  require('fs').writeFileSync(__dirname + '/side-panel-results.json', JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})().catch(e => { console.log('FAIL run — ' + e.stack); process.exit(1); });

// Offline Air Register server for UI e2e tests: the real app/server.js with a FAKE AIR POS behind it
// (no network, no real account, no live store). Port 5058. Env: FAKE_DRAWER_HANG=ms the drawer never answers.
// Run: node tests/fake-server.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');





const PRODUCTS = [
  { number: '1001', upc: '012345678905', name: 'Bulk candy (lb)', price: 10, taxRate: 8, stock: 50 },
  { number: '1002', upc: '012345678912', name: 'Toy car', price: 5, taxRate: 8, stock: 0 },
  { number: '1003', upc: '', name: 'Rope (ft)', price: 2, taxRate: 8, stock: 500 },
  { number: '1004', upc: '', name: 'Gift bag', price: 1.5, taxRate: 0, stock: 20 },
];
const FM = () => (fake.members = fake.members || { 'm-edit1': { id: 'm-edit1', number: '5551234567', mobile: '555-123-4567', phone: '', firstName: 'Mike', lastName: 'Fake', email: 'mike@example.com', address: '', zipCode: '', remark: '', status: 10, statusName: 'Active', point: 5, balance: 0, discount: 0 }, 'm-edit2': { id: 'm-edit2', number: '5559876543', mobile: '555-987-6543', phone: '', firstName: 'Dana', lastName: 'Sample', email: 'dana@example.com', address: '', zipCode: '', remark: '', status: 10, statusName: 'Active', point: 0, balance: 0, discount: 0 } });
const fake = global.__fake = { calls: [], drawerHang: Number(process.env.FAKE_DRAWER_HANG || 0), orders: {}, cards: { '7000000000009999': { id: 'gc-sold', cardNo: '7000000000009999', isSold: true, balance: 3 } } };
const ok = value => ({ success: true, value });
// 1.0.7 card test customers (made up), so the Customer window opens for them; kept out of FM() so other tests' member lists do not change
const FM107 = { 'm-sample': { id: 'm-sample', number: '5550100', mobile: '555-0100', phone: '', firstName: 'Sample', lastName: 'Customer', email: 'sample@example.com', address: '100 Example St', zipCode: '00000', remark: '', status: 10, statusName: 'Active', point: 120, balance: 42.5 },
  'm-zero': { id: 'm-zero', number: '5550101', mobile: '555-0101', phone: '', firstName: 'Zero', lastName: 'Balance', email: '', address: '', zipCode: '', remark: '', status: 10, statusName: 'Active', point: 0, balance: 0 } };
// two made-up completed sales for receipt-return tests (no real data): one with the made-up house-account customer, one walk-in
const retOrder = (id, number, memberId) => ({ id, number, status: 20, amount: 20, tax: 1.6, retailMemberId: memberId, returnPayments: [],
  subs: [{ id: id + '-s1', productId: 'p1001', itemId: 'i1001', number: '1001', upc: '', name: 'Bulk candy (lb)', rate: 1, quantityTotal: 2, quantityReturn: 0, price: 10, taxRate: 8, discount: 0, isRetailRefund: true, promotionType: 0 }],
  receives: [{ id: id + '-rc-card', paymentType: 20, amount: 10 }, { id: id + '-rc-cash', paymentType: 10, amount: 11.6 }] });
const RET_ORDERS = { 'o-ret-acct': retOrder('o-ret-acct', 'T9001', 'm-acct'), 'o-ret-walkin': retOrder('o-ret-walkin', 'T9002', null) };
const J = (p, k) => { try { return JSON.parse(p[k]); } catch { return {}; } };
let sid = 0;
const handlers = {
  '/Identities/Login': p => { const s = J(p, 'submit'); return s.password ? ok({ ide: 'fake-token', corpName: s.corpName, shopName: 'Fake shop', userName: s.userName, superAdmin: true, shopId: 'shop', operatorId: 'op', stationId: 'st', currency: 2 }) : { success: false, message: 'Wrong password' }; },
  '/Home/Index': () => ({ terminalConfig: { autoOpenCashDrawer: false, ...(process.env.FAKE_AUTOPRINT ? { checkoutAutoPrint: true, returnAutoPrint: true } : {}) }, retailConfig: { basicSetting: {}, extraChargeSetting: [] }, authorities: ['RetailManager'] }),
  '/Commons/RetailDiscountConfigGet': () => ok({ subs: [] }),
  '/Commons/RetailConfigGet': () => ok({ basicSetting: {}, extraChargeSetting: [] }),
  '/RetailSessions/SessionCheck': () => ({ type: 10 }),
  '/Commons/RetailReceiveChannelGet': () => ok(fake.keyed === 'sola' ? { channelType: 20, secretKey: '' } : fake.keyed === 'stripe' ? { channelType: 10, secretKey: 'pk_test_madeup' } : {}), // hook /keyed?mode=sola|stripe (stripe: made-up test key, 1.0.9)
  '/Orders/RetailOrderSubGetByScan': p => { const x = PRODUCTS.find(q => q.number === p.number || (q.upc && q.upc === p.number)); return x ? ok({ id: 'sub' + (++sid), itemId: 'i' + x.number, productId: 'p' + x.number, number: x.number, name: x.name, quantity: 1, rate: 1, price: x.price, taxRate: x.taxRate, discount: 0, discountAmount: 0 }) : { success: false, message: 'Product not found' }; },
  '/Products/ProductPaged': p => { const f = J(p, 'filter'); const k = String(f.keyword ?? p.keyword ?? '').toLowerCase(); const rows = PRODUCTS.filter(x => !k || x.name.toLowerCase().includes(k) || x.number === k || x.upc === k).map(x => ({ id: 'i' + x.number, number: x.number, upc: x.upc, name: x.name, retailPrice: x.price, quantityStock: x.stock })); return { success: true, rows, total: rows.length }; },
  '/Orders/RetailOrderPromotionGet': p => { const s = J(p, 'submit'); let tot = 0, tax = 0; for (const x of s.subs || []) { const a = x.price * x.quantity - (x.discountAmount || 0); tot += a; tax += a * (x.taxRate || 0) / 100; } tax = Math.round(tax * 100) / 100; return ok({ subs: [], totalAmount: tot, totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot }); },
  '/Orders/RetailOrderAuthorizationCheck': () => ok({ needAuthorization: false }),
  '/Orders/RetailOrderSave': p => { const s = J(p, 'submit'); fake.orders[s.id] = s; return ok({}); },
  '/Orders/RetailOrderReceiveBegin': p => { const x = J(p, 'submit');
    if (x.paymentType === 40) { (x.retailGiftCards || []).forEach(id => { const c = Object.values(fake.cards).find(k => k.id === id); if (c) c.balance = Math.round((c.balance - x.amount / (x.retailGiftCards.length || 1)) * 100) / 100; }); } /* request O: redeeming lowers the balance */ (fake.receives = fake.receives || []).push({ paymentType: x.paymentType, amount: x.amount, retailMemberId: x.retailMemberId || null, gift: (x.retailGiftCards || []).length, keyedLast4: x.creditCard && x.creditCard.cardNo ? String(x.creditCard.cardNo).slice(-4) : null, keyedExp: !!(x.creditCard && x.creditCard.expiration), keyedCvv: !!(x.creditCard && x.creditCard.cvv) }); return ok({ isCompleted: true }); },
  '/Orders/RetailOrderComplete': p => { const c = J(p, 'command'); const o = fake.orders[c.id]; (fake.completeCalls = fake.completeCalls || []).push(c.id);
    if (fake.stockRefuse && o && /"(?:number|productNumber)":"1002"/.test(JSON.stringify(o))) return { success: false, message: 'Insufficient inventory, inventory write-down failed' }; // AR-16 hook /stock-refuse?on=1 (store that does not oversell)
    if (o) { o.done = true; (o.subs || []).forEach(x => { const c = fake.cards[String(x.number)]; if (c && x.price > 0) { c.balance = Math.round((c.balance + x.price * (x.quantity || 1)) * 100) / 100; c.isSold = true; } }); } return ok({}); }, // request O: a sold / reloaded card holds its value after Complete
  '/Orders/RetailOrderGet': p => RET_ORDERS[p.orderId] ? ok(RET_ORDERS[p.orderId]) : ok({ id: p.orderId, status: fake.orders[p.orderId] && fake.orders[p.orderId].done ? 20 : 15 }),
  // returns: record what Air Register sends (test-only), so Return to Account can be checked
  '/ReturnOrders/RetailReturnOrderCreate': p => { (fake.returns = fake.returns || []).push({ kind: 'receipt', ...J(p, 'submit') }); return ok({}); },
  '/ReturnOrders/NonOrderReturnOrderCreate': p => { (fake.returns = fake.returns || []).push({ kind: 'nonorder', ...J(p, 'submit') }); return ok({}); },
  '/Commons/RetailBillTemplateConfigGet': () => ok({ templates: fake.templates || [], defaultTemplateId: fake.templates && fake.templates[0] ? fake.templates[0].id : null, orderPrintId: 'op-1', orderSubs: [] }),
  '/Orders/RetailOrderBillContentGet': p => { (fake.bills = fake.bills || []).push(p); return ok({ billBase64: Buffer.from('%PDF-1.4 fake receipt').toString('base64') }); },
  // FAKE_AUTOPRINT=1 turns on auto print (request L e2e); hook /print-fail?mode=hang|offline|off
  '/Hardwares/PrintBillContent': async () => { fake.prints = (fake.prints || 0) + 1; if (fake.printFail === 'hang') await new Promise(r => setTimeout(r, 120000)); if (fake.printFail === 'offline') return { success: false, message: 'Printer offline (fake)' }; return ok({}); },
  '/Hardwares/GetPrinters': () => ok([]),
  '/Hardwares/OpenCashbox': async () => { if (fake.drawerHang) await new Promise(r => setTimeout(r, fake.drawerHang)); return ok({}); },
  '/Hardwares/GetDeviceInfo': () => ok({}),
  // one made-up gift card for paying (balance $8; fake number, no real data); any other number = not valid, as before
  '/RetailGiftCards/RetailGiftCardVerify': p => { if (String(p.number) !== '7000000000008888') return ok(null); const c = fake.cards['7000000000008888'] = fake.cards['7000000000008888'] || { id: 'gc-pay8', cardNo: '7000000000008888', isSold: true, balance: 8 }; return ok({ id: c.id, number: c.cardNo, balance: c.balance }); },
  // one made-up test customer (no real data) so Check payments (customer required) can be tested
  // request M: a small made-up customer list for find / Edit Customer / phone change / duplicate phone (fake names, 555 numbers)
  // AIR POS rule (MemberSaveDrawer): number = phone without punctuation and must be unique (MemberNumberValidate)
  '/RetailMembers/RetailMemberPaged': p => { const f = J(p, 'filter'); const rows = Object.values(FM()).filter(m => (!f.name || (m.firstName + ' ' + m.lastName).toLowerCase().includes(String(f.name).toLowerCase())) && (!f.mobile || m.number.includes(f.mobile))).map(m => ({ ...m })); return { success: true, rows, total: rows.length }; },
  '/RetailMembers/RetailMemberGetByNumber': p => { const m = Object.values(FM()).find(x => x.number === String(p.number)); return m ? ok({ ...m }) : { success: false, message: 'Member not found' }; },
  '/RetailMembers/RetailMemberGet': p => FM()[p.id] ? ok({ ...FM()[p.id] }) : FM107[p.id] ? ok({ ...FM107[p.id] }) : { success: false, message: 'Member not found' },
  '/RetailMembers/MemberNumberValidate': p => { (fake.validates = fake.validates || []).push({ number: p.number, id: p.id || null }); return Object.values(FM()).some(m => m.number === String(p.number) && m.id !== p.id) ? { success: false, message: 'The member number already exists' } : ok(true); },
  '/RetailMembers/RetailMemberAdd': p => { const x = J(p, 'submit'); if (Object.values(FM()).some(m => m.number === x.number)) return { success: false, message: 'The member number already exists' }; FM()[x.id] = { ...x, point: 0, balance: 0, status: 10, statusName: 'Active' }; return ok({}); },
  '/RetailMembers/RetailMemberUpdate': p => { const x = J(p, 'submit'); (fake.memberUpdates = fake.memberUpdates || []).push(x); const want = String(x.mobile || '').replace(/[^\w]/g, ''); if (x.number !== want) return { success: false, message: `(fake rule) number ${x.number} must equal phone digits ${want}` }; if (Object.values(FM()).some(m => m.number === x.number && m.id !== x.id)) return { success: false, message: 'The member number already exists' }; if (!FM()[x.id]) return { success: false, message: 'Member not found' }; Object.assign(FM()[x.id], x); return ok({}); },
  '/RetailMembers/MemberInfoGet': p => String(p.number) === '5550100' ? ok({ member: { id: 'm-sample', number: '5550100', firstName: 'Sample', lastName: 'Customer', mobile: '555-0100', email: 'sample@example.com' }, points: 120, availableBalance: 42.5, pointExchangeRate: 1, allowCreditPayment: true, creditAmount: 100 }) // 1.0.7 card test (made up)
    : String(p.number) === '5550101' ? ok({ member: { id: 'm-zero', number: '5550101', firstName: 'Zero', lastName: 'Balance', mobile: '555-0101' }, points: 0, availableBalance: 0 }) // 1.0.7 card test: red $0.00
    : String(p.number) === '5550001' ? ok({ member: { id: 'm-test', number: '5550001', firstName: 'Test', lastName: 'Customer' }, points: 0, availableBalance: 0 })
    : String(p.number) === '5550002' ? ok({ member: { id: 'm-acct', number: '5550002', firstName: 'House', lastName: 'Account' }, points: 0, availableBalance: 0, allowCreditPayment: true, creditAmount: 50 }) : (m => m ? ok({ member: { ...m }, points: m.point || 0, availableBalance: 0 }) : ok(null))(Object.values(FM()).find(x => x.number === String(p.number))),
  // gift cards (fake numbers only) + history
  '/RetailGiftCards/RetailGiftCardGet': p => { const c = fake.cards[String(p.number)]; return c ? ok(c) : { success: false, message: 'Gift card not found' }; },
  '/RetailGiftCards/RetailGiftCardAdd': p => { const s = J(p, 'submit'); fake.cards[s.cardNo] = { id: s.id, cardNo: s.cardNo, faceValue: s.faceValue, isSold: false, balance: 0 }; return ok({}); },
  '/Orders/RetailOrderPaged': p => { const pi = J(p, 'pageInfo'); const all = Object.values(fake.orders).filter(o => o.done).reverse().map((o, i) => ({ id: o.id, number: 'T' + (1000 + i), status: 20, statusName: 'Completed', paymentTypeName: 'Cash', quantity: (o.subs || []).length, amount: 1, tax: 0, createTime: new Date(Date.now() - i * 60000).toISOString() }));
    const sz = pi.pageSize || 20, pg = pi.page || 1; return { success: true, rows: all.slice((pg - 1) * sz, pg * sz), total: all.length }; },
};
// FAKE_CASHIER=1: the logged-in user is a cashier (not an AIR POS manager); manager login "boss" / "boss-pw" passes /Identities/verify
if (process.env.FAKE_CASHIER === '1') {
  const login = handlers['/Identities/Login'], home = handlers['/Home/Index'];
  handlers['/Identities/Login'] = p => { const r = login(p); if (r.value) r.value.superAdmin = false; return r; };
  handlers['/Home/Index'] = () => ({ ...home(), authorities: [] });
  handlers['/Identities/verify'] = p => { const s = J(p, 'submit'); return s.userName === 'boss' && s.password === 'boss-pw' ? ok('mgr-1') : { success: false, message: 'Wrong user name or password' }; };
}
// 1.0.9 card on file (made-up cards: Stripe test numbers' last 4 only, no real data). Hook /cof?n=0|1|2 sets m-sample's cards
// (n=2: a Visa usable here + a Mastercard saved under another payment channel); /cof-state returns what Air Register sent.
fake.cof = { cards: {}, log: [], pays: [], seq: 0 };
const COF_CARDS = [{ id: 'mc-visa', cardType: 'Visa', lastFourDigits: '4242', validityPeriod: '12/28', usableForCurrentChannel: true }, { id: 'mc-other', cardType: 'Mastercard', lastFourDigits: '4444', validityPeriod: '03/27', usableForCurrentChannel: false }];
Object.assign(handlers, {
  '/RetailMembers/RetailMemberCardSelect': p => { fake.cof.log.push({ op: 'select', p: { ...p } }); return ok((fake.cof.cards[p.retailMemberId] || []).map(c => ({ ...c }))); },
  '/RetailMembers/RetailMemberCardAddBegin': p => { fake.cof.log.push({ op: 'begin', p: { ...p } }); if (!FM107[p.retailMemberId] && !FM()[p.retailMemberId]) return { success: false, message: 'Member not found' };
    return ok({ success: true, setupIntent: { id: 'seti_fake109', client_secret: 'seti_fake109_secret_DONOTLOG' } }); },
  '/RetailMembers/RetailMmeberCardAddComplete': p => { const x = J(p, 'submit'); fake.cof.log.push({ op: 'complete', p: x });
    if (x.cardNo || x.expiration || x.cvv) return { success: false, message: 'card fields must be blank (fake check)' };
    if (x.setupIntentId !== 'seti_fake109' || !x.holderName || !x.billAddress || !x.zipCode) return { success: false, message: 'bad setup (fake check)' };
    const l = fake.cof.cards[x.retailMemberId] = fake.cof.cards[x.retailMemberId] || []; l.push({ id: 'mc-new' + (++fake.cof.seq), cardType: 'Visa', lastFourDigits: '4242', validityPeriod: '12/30', usableForCurrentChannel: true }); return ok({}); },
  '/RetailMembers/RetailMemberCardDelete': p => { fake.cof.log.push({ op: 'delete', p: { ...p } }); const l = fake.cof.cards[p.retailMemberId] || []; if (p.cardId == null || p.cardId === '') return ok({}); /* like real AIR POS (TestShop Oct 30): no cardId = 'success' but nothing removed */ const i = l.findIndex(c => c.id === p.cardId); if (i < 0) return { success: false, message: 'Card not found' }; l.splice(i, 1); return ok({}); },
});
{ const b0 = handlers['/Orders/RetailOrderReceiveBegin']; handlers['/Orders/RetailOrderReceiveBegin'] = p => { const x = J(p, 'submit'); if (x.paymentType === 30) fake.cof.pays.push({ amount: x.amount, retailMemberId: x.retailMemberId, retailMemberCardId: x.retailMemberCardId === undefined ? 'missing' : x.retailMemberCardId, recordCreditCard: x.recordCreditCard, creditCard: x.creditCard }); return b0(p); }; }
// FAKE_STRICT_COMPLETE=1 (1.2.3 total check): AIR POS-like Complete. Works out the order total from the SAVED order and refuses
// "The received amount is less than the amount due, the order cannot be completed." when the receives fall short.
// Hook /strict-bump?amt=X: at the next Complete the server total is X higher (refusal test). Hook /promo-fail?n=N makes the next N RetailOrderPromotionGet calls fail (network blip). Off by default: other tests unchanged.
if (process.env.FAKE_STRICT_COMPLETE === '1') {
  fake.promoFail = 0; fake.rcv = {};
  const promo = handlers['/Orders/RetailOrderPromotionGet'], get = handlers['/Orders/RetailOrderGet'], begin = handlers['/Orders/RetailOrderReceiveBegin'], done = handlers['/Orders/RetailOrderComplete'];
  const r2 = n => Math.round(n * 100) / 100;
  const dueOf = o => { let tot = 0, tax = 0; for (const x of o.subs || []) { const a = x.price * x.quantity - (x.discountAmount || 0); tot += a; tax += a * (x.taxRate || 0) / 100; } return r2(r2(tot) + r2(tax) + (fake.extra || 0)); };
  handlers['/Orders/RetailOrderPromotionGet'] = p => { if (fake.promoFail > 0) { fake.promoFail--; return { success: false, message: 'Network error: ETIMEDOUT', unreachable: true }; } const r = promo(p); if (fake.extra && r.value) { r.value.totalAmount += fake.extra; r.value.originalTotalAmount += fake.extra; } return r; };
  handlers['/Orders/RetailOrderReceiveBegin'] = p => { const x = J(p, 'submit'); const l = fake.rcv[x.retailOrderId] = (fake.rcv[x.retailOrderId] || []).filter(r => !(x.paymentType === 10 && r.paymentType === 10) && r.id !== x.id);
    l.push({ id: x.id, paymentType: x.paymentType, amount: x.amount, receiveAmount: x.receiveAmount, giveAmount: x.giveAmount, status: 20 }); return begin(p); };
  handlers['/Orders/RetailOrderComplete'] = p => { const c = J(p, 'command'); const o = fake.orders[c.id]; if (!o) return { success: false, message: 'Order not found' };
    if (fake.bump) { fake.extra = (fake.extra || 0) + fake.bump; fake.bump = 0; } // the server total goes up after we priced it
    if (fake.refuseN > 0) { fake.refuseN--; (fake.completes = fake.completes || []).push({ id: c.id, refused: true }); return { success: false, message: 'The order cannot be completed.' }; } // hook /complete-refuse?n=N (1.2.3.1 way-out test)
    const due = dueOf(o), got = r2((fake.rcv[c.id] || []).reduce((a, r) => a + r.amount, 0)); (fake.completes = fake.completes || []).push({ id: c.id, due, got });
    return got + 0.004 < due ? { success: false, message: 'The received amount is less than the amount due, the order cannot be completed.' } : done(p); };
  handlers['/Orders/RetailOrderGet'] = p => { const r = get(p); if (r && r.value && fake.orders[p.orderId]) r.value = { ...r.value, receives: fake.rcv[p.orderId] || [] }; return r; };
}
// FAKE_HELD=1 (1.0.5 bulk folders e2e): real Hold / Load Hold. RetailOrderPaged with status Pending lists the held (saved
// isPending, not completed) orders; RetailOrderGet returns the held order with its lines (number/name filled from PRODUCTS, as
// AIR POS returns them). Off by default: other tests unchanged.
if (process.env.FAKE_HELD === '1') {
  const paged = handlers['/Orders/RetailOrderPaged'], get = handlers['/Orders/RetailOrderGet'];
  const held = () => Object.values(fake.orders).filter(o => o.isPending && !o.done && !o.resumed);
  handlers['/Orders/RetailOrderPaged'] = p => { const f = J(p, 'filter'); if (f.status !== 15) return paged(p);
    const rows = held().reverse().map((o, i) => ({ id: o.id, number: 'H' + (100 + i), status: 15, statusName: 'Pending', quantity: (o.subs || []).length, amount: 1, tax: 0, createTime: new Date().toISOString() }));
    return { success: true, rows, total: rows.length }; };
  handlers['/Orders/RetailOrderGet'] = p => { const o = fake.orders[p.orderId]; if (!o || o.done || !o.isPending) return get(p);
    o.resumed = true; const subs = (o.subs || []).map(x => { const pr = PRODUCTS.find(q => 'p' + q.number === x.productId) || {}; return { ...x, number: pr.number, upc: pr.upc, name: pr.name, oriPrice: pr.price }; });
    return ok({ ...o, number: 'H' + o.id.slice(0, 4), status: 15, subs, receives: [] }); };
}

module.exports = { handlers, fake, PRODUCTS, FM, FM107, RET_ORDERS, COF_CARDS, J, ok };

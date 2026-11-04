// Offline Air Register server for UI e2e tests: the real app/server.js with a FAKE AIR POS behind it
// (no network, no real account, no live store). Port 5058. Env: FAKE_DRAWER_HANG=ms the drawer never answers.
// Run: node tests/fake-server.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const APPDIR = process.env.FAKE_APP_DIR || path.join(__dirname, '..', 'app'); // FAKE_APP_DIR: run the STAGED installer copy of the app (tests/build-stage-complete.test.js)
const { AirPos } = require(path.join(APPDIR, 'lib/airpos'));
const dir = process.env.FAKE_DATA_DIR ? (fs.mkdirSync(process.env.FAKE_DATA_DIR, { recursive: true }), process.env.FAKE_DATA_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-fake-')); // FAKE_DATA_DIR (startup speed test): a fixed app data folder, so a setting saved there is in place when the app starts
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: Number(process.env.FAKE_PORT || 5058), build: 'customer', blockedCompanies: [], updateFeedUrl: 'http://updates-off-in-tests' }));
process.env.AIRREG_CONFIG = path.join(dir, 'config.json'); process.env.AIRREG_DATA = dir;

const PRODUCTS = [
  { number: '1001', upc: '012345678905', name: 'Bulk candy (lb)', price: 10, taxRate: 8, stock: 50 },
  { number: '1002', upc: '012345678912', name: 'Toy car', price: 5, taxRate: 8, stock: 0 },
  { number: '1003', upc: '', name: 'Rope (ft)', price: 2, taxRate: 8, stock: 500 },
  { number: '1004', upc: '', name: 'Gift bag', price: 1.5, taxRate: 0, stock: 20 },
];
// Temporary Item / search prices (Oct 31): FAKE_SEARCH_EXTRA=1 adds an item with no price (scan refuses, like real AIR POS)
// and one with both a corp standard price ($4) and a different shop price ($6; the scan charges $6).
if (process.env.FAKE_SEARCH_EXTRA === '1') PRODUCTS.push(
  { number: '1005', upc: '', name: 'Unpriced widget', price: 0, noPrice: true, taxRate: 8, stock: 3 },
  { number: '1006', upc: '', name: 'Two price yo-yo', price: 6, stdPrice: 4, taxRate: 8, stock: 9 });
// 1.0.11 instant scan load test: FAKE_PRODUCTS=N adds N made-up products (codes 300000+, 13-digit UPCs, prices $0.50-$99.99, tax 8 / 0)
for (let i = 0, n = Number(process.env.FAKE_PRODUCTS || 0); i < n; i++) PRODUCTS.push({ number: String(300000 + i), upc: String(2000000000000 + i), name: 'Test product ' + i + ' ' + ['red', 'blue', 'green', 'large', 'small', 'pack'][i % 6], price: Math.round((0.5 + (i * 7919 % 9950) / 100) * 100) / 100, taxRate: i % 3 ? 8 : 0, stock: i % 50 });
// ProductPaged row in the real AIR POS shape (TestShop Oct 31): retailPrice is always 0; the price sits in standardPrices (corp)
// or shopPrices (this shop, shopId 'shop' = the fake login's shop) on the base unit (rate 1). 1001/1003 standard, 1002/1004 shop.
const ZERO_SHOP = '00000000-0000-0000-0000-000000000000';
const pagedPrices = x => {
  const lv = (shopId, price) => [{ shopId, unitId: 'u' + x.number, unitName: 'Each', rate: 1, price }];
  if (x.noPrice) return { standardPrices: [], shopPrices: [] };
  if (x.stdPrice != null) return { standardPrices: lv(ZERO_SHOP, x.stdPrice), shopPrices: lv('shop', x.price) };
  return ['1002', '1004'].includes(x.number) ? { standardPrices: [], shopPrices: lv('shop', x.price) } : { standardPrices: lv(ZERO_SHOP, x.price), shopPrices: [] };
};
const FM = () => (fake.members = fake.members || { 'm-edit1': { id: 'm-edit1', number: '5551234567', mobile: '555-123-4567', phone: '', firstName: 'Mike', lastName: 'Fake', email: 'mike@example.com', address: '', zipCode: '', remark: '', status: 10, statusName: 'Active', point: 5, balance: 0, discount: 0 }, 'm-edit2': { id: 'm-edit2', number: '5559876543', mobile: '555-987-6543', phone: '', firstName: 'Dana', lastName: 'Sample', email: 'dana@example.com', address: '', zipCode: '', remark: '', status: 10, statusName: 'Active', point: 0, balance: 0, discount: 0 } });
const fake = global.__fake = { calls: [], drawerHang: Number(process.env.FAKE_DRAWER_HANG || 0), orders: {}, cards: { '7000000000009999': { id: 'gc-sold', cardNo: '7000000000009999', isSold: true, balance: 3 } } };
const ok = value => ({ success: true, value });
// 1.0.7 card test customers (made up), so the Customer window opens for them; kept out of FM() so other tests' member lists do not change
const FM107 = { 'm-sample': { id: 'm-sample', number: '5550100', mobile: '555-0100', phone: '', firstName: 'Sample', lastName: 'Customer', email: 'sample@example.com', address: '100 Example St', zipCode: '00000', remark: (process.env.FAKE_MEMBER_NOTE === '1' ? 'Account locked - needs approval from the owner <b>before</b> any sale' : '') /* store request #21 test only */, status: 10, statusName: 'Active', point: 120, balance: 42.5 },
  'm-zero': { id: 'm-zero', number: '5550101', mobile: '555-0101', phone: '', firstName: 'Zero', lastName: 'Balance', email: '', address: '', zipCode: '', remark: '', status: 10, statusName: 'Active', point: 0, balance: 0 } };
// two made-up completed sales for receipt-return tests (no real data): one with the made-up house-account customer, one walk-in
const retOrder = (id, number, memberId) => ({ id, number, status: 20, amount: 20, tax: 1.6, retailMemberId: memberId, returnPayments: [],
  subs: [{ id: id + '-s1', productId: 'p1001', itemId: 'i1001', number: '1001', upc: '', name: 'Bulk candy (lb)', rate: 1, quantityTotal: 2, quantityReturn: 0, price: 10, taxRate: 8, discount: 0, isRetailRefund: true, promotionType: 0 }],
  receives: [{ id: id + '-rc-card', paymentType: 20, amount: 10 }, { id: id + '-rc-cash', paymentType: 10, amount: 11.6 }] });
const RET_ORDERS = { 'o-ret-acct': retOrder('o-ret-acct', 'T9001', 'm-acct'), 'o-ret-walkin': retOrder('o-ret-walkin', 'T9002', null) };
// drawer-rules-1011 test: a sale paid only by card and one paid only by cash (made-up, walk-in), to return
RET_ORDERS['o-ret-cardonly'] = { ...retOrder('o-ret-cardonly', 'T9003', null), receives: [{ id: 'o-ret-cardonly-rc', paymentType: 20, amount: 21.6 }] };
RET_ORDERS['o-ret-cashonly'] = { ...retOrder('o-ret-cashonly', 'T9004', null), receives: [{ id: 'o-ret-cashonly-rc', paymentType: 10, amount: 21.6 }] };
let byCodeMap = null; const byCode = () => { if (!byCodeMap || byCodeMap.size < PRODUCTS.length) { byCodeMap = new Map(); for (const q of PRODUCTS) { byCodeMap.set(q.number, q); if (q.upc) byCodeMap.set(q.upc, q); } } return byCodeMap; };
// returns tests (made up): T9005 = 2 x Bulk candy $10, tax 8%, paid all cash $21.60; T9006 = 3 x Bulk candy, F4 New price $8 each
// (saved as AirMax saves it: $6.00 off the $30 line = 20%, custom $-off discount), tax 8% on $24, paid all cash $25.92
RET_ORDERS['o-ret-cash'] = { ...retOrder('o-ret-cash', 'T9005', null), receives: [{ id: 'o-ret-cash-rc', paymentType: 10, amount: 21.6 }] };
RET_ORDERS['o-ret-f4'] = { ...retOrder('o-ret-f4', 'T9006', null), amount: 24, tax: 1.92, receives: [{ id: 'o-ret-f4-rc', paymentType: 10, amount: 25.92 }],
  subs: [{ ...retOrder('o-ret-f4', 'T9006', null).subs[0], quantityTotal: 3, discount: 20, discountAmount: 6, discountMethod: 20, isCustomDiscount: true }] };
const J = (p, k) => { try { return JSON.parse(p[k]); } catch { return {}; } };
let sid = 0;
// AirMax #18 (test only): with FAKE_REAL_RECEIPT=1 (or hook /real-receipt?on=1) the receipt is a real PDF in the AIR POS TestShop
// layout, made from the SAVED order (names / numbers from PRODUCTS, amount = price x qty - line discount), so the e2e can check
// where Air Max puts the "33% off -$9.90" line. Off by default: every other test keeps the old tiny fake receipt.
const { receiptPdf } = require('./fake-receipt-pdf');
// #18 "printed once" (Nov 3): FAKE_RECEIPT_DISC / hook /receipt-disc?mode= says what the STORE TEMPLATE itself prints under an item:
// none (default) | line ("Discount -$9.90") | saved ("You saved $9.90") | pct ("-33% -$9.90"). Multi-buy promotions (hook /multibuy?on=1)
// print "3 for $5 -$1.00" under the item in every mode but none; a whole-sale discount is a "Discount" total line.
const r2f = n => Math.round(n * 100) / 100, money2 = n => '$' + r2f(n).toFixed(2), pctT = p => String(r2f(p)).replace(/\.0+$/, '');
function tplDisc(d, pct) { const m = fake.receiptDisc || 'none'; if (!(d >= 0.01) || m === 'none') return [];
  return m === 'line' ? ['Discount -' + money2(d)] : m === 'saved' ? ['You saved ' + money2(d)] : ['-' + pctT(pct) + '% -' + money2(d)]; }
function rcptLines(subs, promos, sign) {
  return (subs || []).map(x => { const pr = PRODUCTS.find(q => 'p' + q.number === x.productId) || {}, q = x.quantity, d = r2f(x.discountAmount != null ? x.discountAmount : x.price * q * (x.discount || 0) / 100);
    const pm = (promos || []).find(p => p.retailOrderSubId === x.id), pd = (fake.promoAmt || {})[x.id] || 0; // amount is server-side knowledge (fake.promoAmt), never read from a promotionSubs row
    const disc = tplDisc(d, x.discount); if (pd && (fake.receiptDisc || 'none') !== 'none') disc.push((pm.discountName || pm.promotionTypeName) + ' -' + money2(pd));
    return { name: pr.name || x.name || 'Temporary item', number: pr.number || '', quantity: sign * q, price: x.price, amount: r2f(sign * (x.price * q - d - pd)), taxRate: x.taxRate ?? pr.taxRate ?? 0, disc }; });
}
function realReceipt(id) {
  const o = (fake.orders || {})[id] || { subs: [] }, lines = rcptLines(o.subs, o.promotionSubs, 1);
  const items = r2f(lines.reduce((a, l) => a + l.amount, 0)), od = r2f(o.orderDiscountMethod === 20 ? (o.orderDiscountAmount || 0) : (o.orderDiscount || 0) / 100 * items);
  const tax = r2f(lines.reduce((a, l) => a + l.amount * l.taxRate / 100, 0) * (items > 0 ? (items - od) / items : 1));
  return receiptPdf({ shop: 'Fake shop', lines, subtotal: items, extra: od >= 0.01 ? [['Discount', '-' + money2(od)]] : [], tax, total: r2f(items - od + tax), change: 0 }, { style: process.env.FAKE_RECEIPT_STYLE || 'flip' }).toString('base64');
}
function realReturnReceipt(retId) {
  const rt = (fake.returns || []).find(x => x.id === retId) || (fake.returns || [])[(fake.returns || []).length - 1] || { subs: [] };
  const src = Object.values(fake.orders).find(o => o.id === rt.retailOrderId) || {};
  const subs = (rt.subs || []).map(x => { const os = (src.subs || []).find(y => y.id === x.id || y.itemId === x.itemId) || {}; return { ...os, ...x, price: os.price ?? x.price, quantity: x.quantity, discount: x.discount ?? os.discount, discountAmount: os.discountAmount != null && os.quantity ? r2f(os.discountAmount * x.quantity / os.quantity) : undefined }; });
  const lines = rcptLines(subs, [], -1), items = r2f(lines.reduce((a, l) => a + l.amount, 0)), tax = r2f(lines.reduce((a, l) => a + l.amount * l.taxRate / 100, 0));
  return receiptPdf({ title: 'RETURN RECEIPT', shop: 'Fake shop', lines, subtotal: items, tax, total: r2f(items + tax), change: 0 }, { style: process.env.FAKE_RECEIPT_STYLE || 'flip' });
}
fake.receiptDisc = process.env.FAKE_RECEIPT_DISC || 'none';
fake.realReceipt = process.env.FAKE_REAL_RECEIPT === '1';
const handlers = {
  '/Identities/Login': p => { const s = J(p, 'submit'); return s.password ? ok({ ide: 'fake-token', corpName: s.corpName, shopName: 'Fake shop', userName: s.userName, superAdmin: true, shopId: 'shop', operatorId: 'op', stationId: 'st', currency: 2 }) : { success: false, message: 'Wrong password' }; },
  '/Home/Index': () => ({ terminalConfig: { autoOpenCashDrawer: false, ...(process.env.FAKE_AUTOPRINT ? { checkoutAutoPrint: true, returnAutoPrint: true } : {}) }, retailConfig: { basicSetting: {}, extraChargeSetting: [] }, authorities: ['RetailManager'] }),
  '/Commons/RetailDiscountConfigGet': () => ok({ subs: [] }),
  '/Commons/RetailTaxKindSelect': () => (process.env.FAKE_TAXKINDS === 'many' ? [{ id: 'tk-8', name: 'Sales Tax', rate: 8, taxFree: false, sort: 1 }, { id: 'tk-0', name: 'Tax free', rate: 0, taxFree: true, sort: 2 }, { id: 'tk-25', name: 'Alcohol Tax', rate: 25, taxFree: false, sort: 3 }] : [{ id: 'tk-8', name: 'Sales Tax', rate: 8, taxFree: false, sort: 1 }, { id: 'tk-0', name: 'Tax free', rate: 0, taxFree: true, sort: 2 }]), // 1.0.11-local.8: bare array like TestShop; FAKE_TAXKINDS=many = 2 sales taxes
  '/Commons/RetailConfigGet': () => ok({ basicSetting: {}, extraChargeSetting: [] }),
  '/RetailSessions/SessionCheck': () => ({ type: 10 }),
  '/Commons/RetailReceiveChannelGet': () => ok(fake.keyed === 'sola' ? { channelType: 20, secretKey: '' } : fake.keyed === 'stripe' ? { channelType: 10, secretKey: 'pk_test_madeup' } : {}), // hook /keyed?mode=sola|stripe (stripe: made-up test key, 1.0.9)
  '/Orders/RetailOrderSubGetByScan': p => { const x0 = byCode().get(String(p.number)), x = x0 && !x0.gone ? x0 : null; if (x && x.noPrice) return { success: false, message: 'The price of the product is not set' }; const sale = process.env.FAKE_SALE === '1' && x && x.number === '1002' ? { price: 3.99, oriPrice: 5 } : null; /* FAKE_SALE=1 (print-label e2e only): Toy car on sale $3.99, regular $5 */ return x ? ok({ id: 'sub' + (++sid), itemId: 'i' + x.number, productId: 'p' + x.number, number: x.number, ...(process.env.FAKE_SALE === '1' ? { upc: x.upc } : {}), name: x.name, quantity: 1, rate: 1, price: x.price, taxRate: x.taxRate, discount: 0, discountAmount: 0, ...(sale || {}) }) : { success: false, message: 'Product not found' }; },
  '/Products/ProductPaged': p => { const f = J(p, 'filter'); const k = String(f.keyword ?? p.keyword ?? '').toLowerCase(); const all = PRODUCTS.filter(x => !x.gone && (!k || x.name.toLowerCase().includes(k) || x.number === k || x.upc === k)), pi = J(p, 'pageInfo'), sz = Number(pi.pageSize) || all.length || 1, pg = Number(pi.page) || 1; (fake.paged = fake.paged || []).push({ k, pg, sz }); const rows = all.slice((pg - 1) * sz, pg * sz).map(x => ({ id: 'i' + x.number, number: x.number, upc: x.upc, name: x.name, retailPrice: 0, ...pagedPrices(x), taxRate: x.taxRate, quantityStock: x.stock })); return { success: true, rows, total: all.length }; }, // 1.0.11: paged like the real call
  '/Orders/RetailOrderPromotionGet': p => { const s = J(p, 'submit'); let tot = 0, tax = 0; for (const x of s.subs || []) { const a = x.price * x.quantity - (x.discountAmount || 0); tot += a; tax += a * (x.taxRate || 0) / 100; } tax = Math.round(tax * 100) / 100; return ok({ subs: [], totalAmount: tot, totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot }); },
  '/Orders/RetailOrderAuthorizationCheck': () => ok({ needAuthorization: false }),
  '/Orders/RetailOrderSave': p => { const s = J(p, 'submit'); fake.orders[s.id] = s; return ok({}); },
  '/Orders/RetailOrderReceiveBegin': p => { const x = J(p, 'submit');
    if (x.paymentType === 40) { (x.retailGiftCards || []).forEach(id => { const c = Object.values(fake.cards).find(k => k.id === id); if (c) c.balance = Math.round((c.balance - x.amount / (x.retailGiftCards.length || 1)) * 100) / 100; }); } /* request O: redeeming lowers the balance */ (fake.receives = fake.receives || []).push({ paymentType: x.paymentType, amount: x.amount, retailMemberId: x.retailMemberId || null, gift: (x.retailGiftCards || []).length, keyedLast4: x.creditCard && x.creditCard.cardNo ? String(x.creditCard.cardNo).slice(-4) : null, keyedExp: !!(x.creditCard && x.creditCard.expiration), keyedCvv: !!(x.creditCard && x.creditCard.cvv) }); return ok({ isCompleted: true }); },
  '/Orders/RetailOrderComplete': p => { const c = J(p, 'command'); const o = fake.orders[c.id]; (fake.completeCalls = fake.completeCalls || []).push(c.id);
    if (fake.stockRefuse && o && /"(?:number|productNumber)":"1002"|"productId":"p1002"/.test(JSON.stringify(o))) return { success: false, message: 'Insufficient inventory, inventory write-down failed' }; // AR-16 hook /stock-refuse?on=1 (store that does not oversell)
    if (o) { o.done = true; (o.subs || []).forEach(x => { const c = fake.cards[String(x.number)] || ((x.type === 30 || x.type === 40) ? Object.values(fake.cards).find(k => k.id === x.itemId) : null); /* AirMax saves gift lines by card id (itemId), not number */ if (c && x.price > 0) { c.balance = Math.round((c.balance + x.price * (x.quantity || 1)) * 100) / 100; c.isSold = true; } }); } return ok({}); }, // request O: a sold / reloaded card holds its value after Complete
  '/Orders/RetailOrderGet': p => RET_ORDERS[p.orderId] ? ok(RET_ORDERS[p.orderId]) : ok({ id: p.orderId, status: fake.orders[p.orderId] && fake.orders[p.orderId].done ? 20 : 15 }),
  // returns: record what Air Register sends (test-only), so Return to Account can be checked
  '/ReturnOrders/RetailReturnOrderCreate': p => { (fake.returns = fake.returns || []).push({ kind: 'receipt', ...J(p, 'submit') }); return ok({}); },
  '/ReturnOrders/NonOrderReturnOrderCreate': p => { (fake.returns = fake.returns || []).push({ kind: 'nonorder', ...J(p, 'submit') }); return ok({}); },
  '/Commons/RetailBillTemplateConfigGet': () => ok({ templates: fake.templates || [], defaultTemplateId: fake.templates && fake.templates[0] ? fake.templates[0].id : null, orderPrintId: 'op-1', orderSubs: [] }),
  '/Orders/RetailOrderBillContentGet': p => { (fake.bills = fake.bills || []).push(p); return ok({ billBase64: fake.realReceipt ? realReceipt(J(p, 'submit').id) : Buffer.from('%PDF-1.4 fake receipt').toString('base64') }); }, // #18: FAKE_REAL_RECEIPT=1 / hook /real-receipt?on=1 = a receipt PDF in the AIR POS TestShop layout
  // FAKE_AUTOPRINT=1 turns on auto print (request L e2e); hook /print-fail?mode=hang|offline|off
  '/Hardwares/PrintBillContent': async p => { fake.prints = (fake.prints || 0) + 1; { const b = J(p || {}, 'submit').billBase64; if (b) { (fake.printed = fake.printed || []).push(b); if (fake.printed.length > 12) fake.printed.shift(); } } /* #18: the PDFs as printed (hook /printed) */ if (process.env.FAKE_PRINT_LOG === '1') { const s = J(p, 'submit'); const t = Buffer.from(String(s.billBase64 || ''), 'base64').toString('latin1'); (fake.printLog = fake.printLog || []).push({ at: Date.now(), text: [...t.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\(.)/g, '$1')).join('\n') || t.slice(0, 200) }); } /* FAKE_PRINT_LOG=1: what was printed (text lines of AirMax's own slips; AIR POS receipts are the fake PDF), hook /printlog */ if (fake.printFail === 'hang') await new Promise(r => setTimeout(r, 120000)); if (fake.printFail === 'offline') return { success: false, message: 'Printer offline (fake)' }; return ok({}); },
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
// sola109 (Sola card on file, made-up cards only: public test numbers, only the last 4 are ever kept or shown). With /keyed?mode=sola:
// AddBegin answers plain success (no Stripe SetupIntent); AddComplete needs the typed card (number / MM/YY / CVV) and saves only brand,
// last 4 and expiry. The fake keeps a masked copy of what was sent, never the number or CVV. Hooks: /sola-wait?on=1 a Sola Online
// payment stays open (ReceiveCheck says not done) until /sola-done?ok=1|0 (approved / declined); /fault?path=X&mode=lost|down&n=N:
// "lost" = AIR POS DID the call but the reply was lost, "down" = it never arrived; /sola-state shows calls, faults and receives.
fake.sola = { wait: false, done: null, faults: [], checks: 0, cancels: [] };
const maskCard = c => c ? { cardNo: /^\d{12,19}$/.test(String(c.cardNo || '')) ? 'FULL-NUMBER-ending-' + String(c.cardNo).slice(-4) : c.cardNo, expiration: c.expiration ? (String(c.cvv || '') === '***' ? c.expiration : 'set') : '', cvv: c.cvv ? (c.cvv === '***' ? '***' : 'set') : '' } : c;
{ const ab = handlers['/RetailMembers/RetailMemberCardAddBegin'], ac = handlers['/RetailMembers/RetailMmeberCardAddComplete'];
  handlers['/RetailMembers/RetailMemberCardAddBegin'] = p => { if (fake.keyed !== 'sola') return ab(p); fake.cof.log.push({ op: 'begin', p: { ...p } }); if (!FM107[p.retailMemberId] && !FM()[p.retailMemberId]) return { success: false, message: 'Member not found' }; return ok({ success: true }); };
  handlers['/RetailMembers/RetailMmeberCardAddComplete'] = p => { if (fake.keyed !== 'sola') return ac(p); const x = J(p, 'submit'); const no = String(x.cardNo || '');
    fake.cof.log.push({ op: 'complete', p: { ...x, ...maskCard(x), last4: no.slice(-4) } });
    if (!/^\d{13,19}$/.test(no) || !/^\d{2}\/\d{2}$/.test(String(x.expiration || '')) || !/^\d{3,4}$/.test(String(x.cvv || ''))) return { success: false, message: 'card number, expiration (MM/YY) and cvv are needed (fake Sola check)' };
    if (x.setupIntentId || !x.holderName || !x.billAddress || !x.zipCode) return { success: false, message: 'bad Sola add (fake check)' };
    if (fake.sola.decline) return { success: false, message: 'Card declined by Sola (fake)' };
    const l = fake.cof.cards[x.retailMemberId] = fake.cof.cards[x.retailMemberId] || []; l.push({ id: 'mc-sola' + (++fake.cof.seq), cardType: no[0] === '5' ? 'Mastercard' : no[0] === '3' ? 'Amex' : 'Visa', lastFourDigits: no.slice(-4), validityPeriod: x.expiration, usableForCurrentChannel: true }); return ok({}); };
  const rb = handlers['/Orders/RetailOrderReceiveBegin']; handlers['/Orders/RetailOrderReceiveBegin'] = p => { const x = J(p, 'submit'); const r = rb(p); const pr = fake.cof.pays[fake.cof.pays.length - 1]; if (pr && x.paymentType === 30) pr.creditCard = maskCard(pr.creditCard);
    if (fake.keyed === 'sola' && x.paymentType === 30) { (fake.sola.begins = fake.sola.begins || []).push({ id: x.id, amount: x.amount, retailMemberCardId: x.retailMemberCardId == null ? null : x.retailMemberCardId, creditCard: maskCard(x.creditCard) });
      if (fake.sola.wait && r && r.value) { fake.sola.open = x.id; return { ...r, value: { ...r.value, isCompleted: false } }; } }
    return r; };
  const rk = handlers['/Orders/RetailOrderReceiveCheck'], rc = handlers['/Orders/RetailOrderReceiveCancel'];
  handlers['/Orders/RetailOrderReceiveCheck'] = p => { const x = J(p, 'submit'); if (fake.keyed === 'sola' && x.paymentType === 30) { fake.sola.checks++; const known = (fake.sola.begins || []).some(b => b.id === x.id);
      if (!known) return ok(null); if (fake.sola.open === x.id) { if (fake.sola.done === true) return ok({ isCompleted: true }); if (fake.sola.done === false) return ok({ isCompleted: false, shouldReissue: true, message: 'Card declined by Sola (fake)' }); return ok({ isCompleted: false }); } return ok({ isCompleted: true }); }
    return rk ? rk(p) : { success: true, value: null }; };
  handlers['/Orders/RetailOrderReceiveCancel'] = p => { const x = J(p, 'submit'); if (fake.keyed === 'sola' && x.paymentType === 30) fake.sola.cancels.push(x.id); return rc ? rc(p) : ok({}); };
}
function solaHook(u, s) {
  const q = k => u.searchParams.get(k);
  if (u.pathname === '/sola-wait') { fake.sola.wait = q('on') === '1'; fake.sola.done = null; fake.sola.open = null; }
  else if (u.pathname === '/sola-done') { fake.sola.done = q('ok') === '1'; Object.values(fake.rcv || {}).forEach(l => l.forEach(r => { if (r.id === fake.sola.open) r.status = fake.sola.done ? 20 : -10; })); }
  else if (u.pathname === '/sola-decline') fake.sola.decline = q('on') === '1';
  else if (u.pathname === '/fault') fake.sola.faults.push({ path: q('path') || '', mode: q('mode') || 'lost', n: Number(q('n') || 1), skip: Number(q('skip') || 0), ms: Number(q('ms') || 0) }); // &skip=K: let the first K matching calls through
  else if (u.pathname === '/fault-clear') fake.sola.faults = [];
  else if (u.pathname === '/sola-reset') { fake.sola = { wait: false, done: null, faults: [], checks: 0, cancels: [], begins: [] }; }
  else if (u.pathname !== '/sola-state') return false;
  s.end(JSON.stringify({ ...fake.sola, calls: fake.calls.slice(-80) })); return true;
}
// FAKE_STRICT_COMPLETE=1 (1.2.3 total check): AIR POS-like Complete. Works out the order total from the SAVED order and refuses
// "The received amount is less than the amount due, the order cannot be completed." when the receives fall short.
// Hook /strict-bump?amt=X: at the next Complete the server total is X higher (refusal test). Hook /promo-fail?n=N makes the next N RetailOrderPromotionGet calls fail (network blip). Off by default: other tests unchanged.
if (process.env.FAKE_STRICT_COMPLETE === '1') {
  fake.promoFail = 0; fake.rcv = {};
  const promo = handlers['/Orders/RetailOrderPromotionGet'], get = handlers['/Orders/RetailOrderGet'], begin = handlers['/Orders/RetailOrderReceiveBegin'], done = handlers['/Orders/RetailOrderComplete'];
  const r2 = n => Math.round(n * 100) / 100;
  const partsOf = o => { let tot = 0, tax = 0; for (const x of o.subs || []) { const a = x.price * x.quantity - (x.discountAmount || 0); tot += a; tax += a * (x.taxRate || 0) / 100; } // airmax-fix-stock: AIR POS like (the reported sale): net = lines - the order discount AMOUNT it was sent; tax = tax x (1 - order discount %)
    return { net: tot - (o.orderDiscountAmount || 0) + (fake.extra || 0), tax: tax * (1 - (o.orderDiscount || 0) / 100) }; };
  const dueOf = o => { const q = partsOf(o); return r2(r2(q.net) + r2(q.tax)); };
  handlers['/Orders/RetailOrderPromotionGet'] = p => { if (fake.promoFail > 0) { fake.promoFail--; return { success: false, message: 'Network error: ETIMEDOUT', unreachable: true }; } const r = promo(p); if (fake.extra && r.value) { r.value.totalAmount += fake.extra; r.value.originalTotalAmount += fake.extra; } return r; };
  handlers['/Orders/RetailOrderReceiveBegin'] = p => { const x = J(p, 'submit'); const l = fake.rcv[x.retailOrderId] = (fake.rcv[x.retailOrderId] || []).filter(r => !(x.paymentType === 10 && r.paymentType === 10) && r.id !== x.id);
    l.push({ id: x.id, paymentType: x.paymentType, amount: x.amount, receiveAmount: x.receiveAmount, giveAmount: x.giveAmount, status: fake.keyed === 'sola' && fake.sola.wait && x.paymentType === 30 ? 10 : 20 }); return begin(p); }; // sola109: an open Sola payment is 10 (begun) until /sola-done
  handlers['/Orders/RetailOrderComplete'] = p => { const c = J(p, 'command'); const o = fake.orders[c.id]; if (!o) return { success: false, message: 'Order not found' };
    if (fake.bump) { fake.extra = (fake.extra || 0) + fake.bump; fake.bump = 0; } // the server total goes up after we priced it
    if (fake.refuseN > 0) { fake.refuseN--; (fake.completes = fake.completes || []).push({ id: c.id, refused: true }); return { success: false, message: 'The order cannot be completed.' }; } // hook /complete-refuse?n=N (1.2.3.1 way-out test)
    const due = dueOf(o), got = r2((fake.rcv[c.id] || []).reduce((a, r) => a + r.amount, 0)); (fake.completes = fake.completes || []).push({ id: c.id, due, got });
    return got + 0.004 < due ? { success: false, message: 'The received amount is less than the amount due, the order cannot be completed.' } : done(p); };
  handlers['/Orders/RetailOrderGet'] = p => { const r = get(p); if (r && r.value && fake.orders[p.orderId]) { const q = partsOf(fake.orders[p.orderId]); r.value = { ...r.value, receives: fake.rcv[p.orderId] || [], subs: fake.orders[p.orderId].subs || [], orderDiscountAmount: fake.orders[p.orderId].orderDiscountAmount || 0, amount: q.net + (fake.dueSkew || 0), tax: q.tax }; /* airmax-fix-stock: AIR POS shows its own net + tax of the saved order; /due-skew makes it differ */ } return r; };
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
    return ok({ ...o, number: 'H' + o.id.slice(0, 4), status: 15, subs, receives: (fake.rcv && fake.rcv[p.orderId]) || [] }); /*HARNESS-PATCH: held-order Get hid the order receives*/ };
}
// store request #17 test only (FAKE_ORDER_SUBS=1): a saved sale answers RetailOrderGet with its item lines + order number, like AIR POS (the Last receipt screen reads them)
if (process.env.FAKE_ORDER_SUBS === '1') {
  const g = handlers['/Orders/RetailOrderGet'];
  handlers['/Orders/RetailOrderGet'] = p => { const r = g(p); const o = fake.orders[p.orderId]; if (r && r.value && o && Array.isArray(o.subs) && o.subs.length && !(r.value.subs && r.value.subs.length)) r.value = { ...r.value, number: r.value.number || 'RO' + String(p.orderId).slice(0, 5), subs: o.subs.map(l => ({ id: l.id, name: l.name || 'Item ' + String(l.productId || l.id).slice(0, 4), quantity: l.quantity })) }; return r; };
}
// Orders tab phase 1 (PLAN-orders-tab.md): FAKE_ORDERS=1 seeds 130 made-up orders (fake names, 555 numbers; no real data) and lets
// RetailOrderPaged apply the Orders tab filters the way the plan's filter table assumes AIR POS does. Hooks (ordersHook below):
// /orders-filters (every filter + pageInfo received; ?reset=1 clears), /orders-last (total + order numbers of the last answer),
// /orders-seed (all made-up orders), /orders-ignore?keys=a,b (act like an AIR POS that does not know those filter keys),
// /orders-fail?n=N&mode=error|down (the next N calls fail). Off by default: other tests unchanged.
fake.ord = { filters: [], last: null, ignore: new Set(), fail: 0, failMode: 'error', seed: [] };
if (process.env.FAKE_ORDERS === '1') {
  const pad = n => String(n).padStart(2, '0'), iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const CUST = [['5550100', 'Sample Customer'], ['5559876543', 'Dana Sample'], ['5551234567', 'Mike Fake'], ['', '']];
  const OPS = ['tester', 'Dana Ops', 'Sam Night'], REM = ['', '', 'gift wrap please', '', 'call when ready', 'Gift for Mom'];
  const ST = { 20: 'Completed', 15: 'Pending', 17: 'Paid', 10: 'New', [-5]: 'Void', [-10]: 'Canceled' };
  const PT = [[10, 'Cash'], [20, 'Credit Card'], [40, 'Gift Card'], [50, 'Check'], [11, 'Member Account'], [30, 'Online'], [99, 'Combination']];
  const LINES = [['1001'], ['1001', '1003'], ['1002'], ['1003', '1004']];
  const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAYS = [[40, 10], [25, 20], [6, 15], [3, 10], [1, 20], [0, 55]]; // [days ago, orders], oldest first: 130 orders, 55 today (2 pages of 50)
  let i = 0;
  for (const [ago, n] of DAYS) for (let k = 0; k < n; k++, i++) {
    const t = ago === 0 ? new Date(d0.getTime() + Math.floor((now - d0) * (k + 1) / (n + 1))) : new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - ago, 8 + (k % 12), (k * 7) % 60, 0);
    const st = i % 8 === 5 ? 15 : i % 8 === 6 ? -5 : i % 8 === 7 ? -10 : i % 31 === 1 ? 17 : i % 37 === 2 ? 10 : 20;
    const [pt, ptName] = PT[i % 7], [mn, mName] = CUST[i % 4], amount = 5 + (i % 9) * 2.5;
    fake.ord.seed.push({ id: 'o-tab-' + i, number: 'RO' + (20000 + i), status: st, statusName: ST[st], paymentType: pt, paymentTypeName: ptName, products: LINES[i % 4],
      quantity: LINES[i % 4].length + (i % 3), quantityReturn: i % 11 === 0 ? 1 : 0, amount, tax: Math.round(amount * 8) / 100, amountReturn: 0, createTime: iso(t),
      retailMemberNumber: mn, retailMemberName: mName, operatorName: OPS[i % 3], bak: REM[i % 6] });
  }
  const lc = v => String(v ?? '').toLowerCase(), on = k => !fake.ord.ignore.has(k);
  const T = s => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/.exec(String(s)); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN; };
  handlers['/Orders/RetailOrderPaged'] = p => {
    const f = J(p, 'filter'), pi = J(p, 'pageInfo'); fake.ord.filters.push({ filter: f, pageInfo: pi });
    if (fake.ord.fail > 0) { fake.ord.fail--; return fake.ord.failMode === 'down' ? { success: false, message: 'Network error: ECONNREFUSED', unreachable: true } : { success: false, message: 'The filter is not valid (fake AIR POS)' }; }
    for (const k of ['beginDate', 'endDate']) if (on(k) && f[k] != null && isNaN(T(f[k]))) return { success: false, message: `${k} is not a date (fake AIR POS)` };
    const sts = on('statuses') && Array.isArray(f.statuses) && f.statuses.length ? f.statuses : on('status') && f.status != null ? [f.status] : null;
    const pts = on('paymentTypes') && Array.isArray(f.paymentTypes) && f.paymentTypes.length ? f.paymentTypes : on('paymentType') && f.paymentType != null ? [f.paymentType] : null;
    const rows = fake.ord.seed.filter(o => (!on('number') || !f.number || lc(o.number).includes(lc(f.number)))
      && (!on('productNumber') || !f.productNumber || o.products.includes(String(f.productNumber)))
      && (!on('memberNumber') || !f.memberNumber || o.retailMemberNumber === String(f.memberNumber))
      && (!on('operatorName') || !f.operatorName || lc(o.operatorName).includes(lc(f.operatorName)))
      && (!sts || sts.includes(o.status)) && (!pts || pts.includes(o.paymentType))
      && (!on('beginDate') || f.beginDate == null || Date.parse(o.createTime) >= T(f.beginDate))
      && (!on('endDate') || f.endDate == null || Date.parse(o.createTime) <= T(f.endDate))
      && (!on('bak') || !f.bak || lc(o.bak).includes(lc(f.bak))))
      .sort((a, b) => Date.parse(b.createTime) - Date.parse(a.createTime)); // newest first, like AIR POS
    const sz = pi.pageSize || 20, pg = pi.page || 1, rowsOut = rows.slice((pg - 1) * sz, pg * sz).map(({ products, ...o }) => ({ ...o })); // AIR POS rows carry no lines
    fake.ord.last = { total: rows.length, page: pg, numbers: rowsOut.map(o => o.number) };
    return { success: true, rows: rowsOut, total: rows.length };
  };
}
function ordersHook(u, s) {
  const q = k => u.searchParams.get(k), o = fake.ord;
  if (u.pathname === '/orders-filters') { const l = o.filters.slice(); if (q('reset') === '1') o.filters = []; s.end(JSON.stringify(l)); return true; }
  if (u.pathname === '/orders-last') { s.end(JSON.stringify(o.last)); return true; }
  if (u.pathname === '/orders-seed') { s.end(JSON.stringify(o.seed)); return true; }
  if (u.pathname === '/orders-ignore') o.ignore = new Set((q('keys') || '').split(',').filter(Boolean));
  else if (u.pathname === '/orders-fail') { o.fail = Number(q('n') || 1); o.failMode = q('mode') === 'down' ? 'down' : 'error'; }
  else return false;
  s.end(JSON.stringify({ ignore: [...o.ignore], fail: o.fail, failMode: o.failMode })); return true;
}
// speed tests: FAKE_LATENCY_MS=N makes every fake AIR POS / hardware-service answer take N ms (real AIR POS: about 100-500 ms).
// Off by default (0): other tests unchanged. Hook /latency?ms=N changes it while running.
fake.latency = Number(process.env.FAKE_LATENCY_MS || 0);
AirPos.prototype.call = async function (host, p, params = {}) {
  fake.calls.push(p);
  if (host !== 'local' && (fake.latency || Number(process.env.FAKE_LATENCY_MS || 0))) await new Promise(r => setTimeout(r, fake.latency || Number(process.env.FAKE_LATENCY_MS))); // 1.0.11 timing tests: AIR POS round trip
  const fl = (fake.sola.faults || []).find(f => f.n > 0 && p.includes(f.path) && !(f.skip > 0 && f.skip-- > 0)); // sola109 hook /fault
  if (fl) { fl.n--; if (fl.mode === 'timeout') return { success: false, message: 'Network error: TimeoutError', unreachable: true, code: 'TimeoutError' }; /* airmax-fix-stock: timed out, server never saw it */ if (fl.mode === 'http500') return { success: false, message: 'HTTP 500', uncertain: true }; /* server error, nothing done */ if (fl.mode === 'http500-done') { const h1 = handlers[p]; if (h1) h1(params || {}); return { success: false, message: 'HTTP 500', uncertain: true }; } /* server did it, then answered 500 */ if (fl.mode === 'hang') { await new Promise(ok => setTimeout(ok, fl.ms || 5000)); return { success: false, message: 'Network error: ETIMEDOUT', unreachable: true }; } /* store request #14 test: AIR POS stops answering for ms, then gives up */ if (fl.mode === 'down') return { success: false, message: 'Network error: ECONNREFUSED', unreachable: true }; const h0 = handlers[p]; if (h0) h0(params || {}); return { success: false, message: 'Network error: ECONNRESET', unreachable: true }; }
  if (/^\/RetailSessions\/Clock(In|Out)$/.test(p)) (fake.clock = fake.clock || []).push({ path: p, submit: J(params || {}, 'submit') }); // 1.0.9 money fix: /clock-state shows what was sent
  const h = handlers[p]; if (!h) return { success: true, value: null, rows: [], total: 0 };
  return h(params || {});
};
// 1.0.10-local.2: server PDFs (return receipt RetailReturnOrderBillGet, X/Z report exports) are answered by the fake too. Before,
// fetchPdf went out to the real AIR POS host with the fake ide, which answered "not logged in" (1003) and logged the register out.
// Returns now print by default (auto print Always), so every e2e return hit it. Offline only: nothing leaves the box.
AirPos.prototype.fetchPdf = async function (p, params) { fake.calls.push(p); (fake.pdfs = fake.pdfs || []).push({ path: p, returnOrderId: params && params.returnOrderId }); return { success: true, value: Buffer.from('%PDF-1.4 fake ' + p) }; };
// 1.0.10 hook /card-wait?on=1: a Card (terminal) payment stays "waiting" (Receive Check answers not done) so the customer screen message can be seen
{ const b0 = handlers['/Orders/RetailOrderReceiveBegin']; handlers['/Orders/RetailOrderReceiveBegin'] = p => { const r = b0(p); const x = J(p, 'submit'); if (x.paymentType === 10) (fake.cashLog = fake.cashLog || []).push({ amount: x.amount, cardChecks: fake.cardChecks || 0, cardApproved: !!fake.cardApprove && (fake.cardChecks || 0) >= (fake.cardAfter || 1) }); /* 1.0.11-local.1 */ if (fake.cardWait && x.paymentType === 20 && r && r.value) return { ...r, value: { ...r.value, isCompleted: false } }; return r; }; }
// 1.0.10-local.2 hook /card-approve?on=1: the waiting Card (terminal) payment is approved at the next Receive Check (split card e2e)
{ const k0 = handlers['/Orders/RetailOrderReceiveCheck']; handlers['/Orders/RetailOrderReceiveCheck'] = p => { const x = J(p, 'submit'); if (fake.cardApprove && x.paymentType === 20) { fake.cardChecks = (fake.cardChecks || 0) + 1; if (fake.cardChecks >= (fake.cardAfter || 1)) return ok({ isCompleted: true }); return ok({ isCompleted: false }); } return k0 ? k0(p) : { success: true, value: null }; }; }
// #18 test hooks (opt-in): multi-buy "3 for $5" on Rope (1003); with real receipts, a completed sale reads back with its lines
// (reprint after a restart, receipt returns) and the return receipt is a real PDF too
// Batch 11 (Step 0b) real-shape fix: the REAL RetailOrderPromotionGet answers ONE promotionSubs row per cart line (promotionType 0 "Others" when nothing applies),
// linked by retailOrderSubId = the line's own id, with NO per-row amount (checked on TestShop Nov 3 2026: no promotionDiscountAmount / promotionName / discountAmount
// on rows; only the sale-level totalPromotionDiscountAmount). With the multibuy hook on this fake does the same. ASSUMPTIONS until a real promotion reply is seen:
// a "3 for $5" set is promotionType 6 (bundle, "Bundle") and its name is in discountName. The per-line amount the fake's own receipt needs lives OUTSIDE the rows,
// in fake.promoAmt[retailOrderSubId] (what AIR POS's server-side receipt would know), never in a row.
fake.promoAmt = fake.promoAmt || {};
{ const pg = handlers['/Orders/RetailOrderPromotionGet']; handlers['/Orders/RetailOrderPromotionGet'] = p => { const r = pg(p); if (!fake.multibuy || !r || !r.value) return r; const s = J(p, 'submit'); let promo = 0; const subs = [];
    const ZERO = '00000000-0000-0000-0000-000000000000', PROMO_ID = 'a0000000-0000-4000-8000-000000000003';
    for (const x of s.subs || []) { const hit = x.productId === 'p1003' && x.quantity >= 3, d = hit ? Math.floor(x.quantity / 3) * 1 : 0; if (hit) { promo += d; fake.promoAmt[x.id] = d; } else delete fake.promoAmt[x.id];
      subs.push({ id: crypto.randomUUID(), retailOrderId: ZERO, retailOrderSubId: x.id, promotionId: hit ? PROMO_ID : ZERO, productId: x.productId, itemId: x.itemId, type: x.type || 0,
        promotionType: hit ? 6 : 0, promotionTypeName: hit ? 'Bundle' : 'Others', promotionDiscountType: 0, number: x.number, upc: x.upc || '', name: x.name, categoryName: '', imagePath: '', productType: 0, description: '',
        quantity: x.quantity, quantityTotal: x.quantityTotal != null ? x.quantityTotal : x.quantity * (x.rate || 1), quantityReturn: 0, originalPrice: x.originalPrice != null ? x.originalPrice : x.price, price: x.price, retailPrice: x.price, bulkPrice: 0, bulkPriceQuantity: 10,
        tax: 0, taxRate: x.taxRate || 0, taxFree: !!x.taxFree, discountTaxFree: false, costPrice: 0, unit: 1, unitName: x.unitName || 'PCS', rate: x.rate || 1, isGroupTitle: false, isBonus: false, ignoreOrderDiscount: !!x.ignoreOrderDiscount,
        discount: x.discount || 0, discountMethod: x.discountMethod || 0, discountName: hit ? '3 for $5' : (x.discountName || ''), originalDiscount: x.discount || 0, isCustomDiscount: !!x.isCustomDiscount, isRetailRefund: true, sort: 0 }); }
    if (!promo) return ok({ ...r.value, subs }); const v = r.value, rate = v.totalAmount > 0 ? (v.totalAmount - promo) / v.totalAmount : 1;
    return ok({ ...v, subs, totalAmount: r2f(v.totalAmount - promo), totalTax: r2f(v.totalTax * rate), totalDiscountAmount: promo, totalPromotionDiscountAmount: promo }); }; }
{ const og = handlers['/Orders/RetailOrderGet']; handlers['/Orders/RetailOrderGet'] = p => { const o = fake.orders[p.orderId]; if (!fake.realReceipt || !o || !o.done) return og(p);
    const subs = (o.subs || []).map(x => { const pr = PRODUCTS.find(q => 'p' + q.number === x.productId) || {}; return { ...x, number: pr.number, upc: pr.upc, name: pr.name, quantityTotal: x.quantity * (x.rate || 1), quantityReturn: 0, isRetailRefund: true, promotionType: 0 }; });
    const amount = r2f(subs.reduce((a, x) => a + x.price * x.quantity - (x.discountAmount || 0), 0)), tax = r2f(subs.reduce((a, x) => a + (x.price * x.quantity - (x.discountAmount || 0)) * (x.taxRate || 0) / 100, 0));
    return ok({ ...o, number: 'T' + o.id.slice(0, 4), status: 20, amount, tax, retailMemberId: null, returnPayments: [], subs, receives: [{ id: o.id + '-rc', paymentType: 10, amount: r2f(amount + tax) }] }); }; }
{ const fp = AirPos.prototype.fetchPdf; AirPos.prototype.fetchPdf = async function (p, params) { if (fake.realReceipt && /RetailReturnOrderBillGet/.test(p)) { fake.calls.push(p); (fake.pdfs = fake.pdfs || []).push({ path: p, returnOrderId: params && params.returnOrderId }); return { success: true, value: realReturnReceipt(params && params.returnOrderId) }; } return fp.call(this, p, params); }; }
// startup / search speed (1.0.11): FAKE_LATENCY_RANGE=50-150 (or hook /latency-range?min=&max=) delays every AIR POS (not local hardware) call by a random 50..150 ms from a fixed seed; the timeline records start and answer
{ const c0 = AirPos.prototype.call; let seed = 20261103; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const rg = String(process.env.FAKE_LATENCY_RANGE || '').split('-').map(Number); fake.lrange = rg.length === 2 && rg[1] >= rg[0] ? rg : null;
  AirPos.prototype.call = async function (host, p, params) { const t0 = Date.now(); if (host !== 'local' && fake.lrange) await new Promise(r => setTimeout(r, Math.round(fake.lrange[0] + rnd() * (fake.lrange[1] - fake.lrange[0])))); const r = await c0.call(this, host, p, params); (fake.timeline = fake.timeline || []).push({ p, host, t0, t1: Date.now(), done: !!(r && r.value && r.value.isCompleted) }); if (fake.timeline.length > 2000) fake.timeline.shift(); return r; }; } // receipt-prefetch timing: when each AIR POS call started and answered (hook /timeline)
// receipt-variety test: FAKE_RECEIPT_TEXT=1 (off by default). Receipts become small text PDFs drawn from what the fake AIR POS RECORDED:
// the saved order (items, tax unless Tax Off / tax-free lines, total) and its payments; a return receipt shows the recorded refund and its
// payments. Every document sent to the AIR POS print service is kept in order (hook /receipts, ?reset=1 clears). Test only, made-up data.
if (process.env.FAKE_RECEIPT_TEXT === '1') {
  const { testPagePdf } = require(path.join(APPDIR, 'lib/hardware'));
  const r2 = n => Math.round(n * 100) / 100, m2 = n => '$' + r2(n).toFixed(2), PN = { 10: 'Cash', 11: 'Account', 20: 'Card', 30: 'Keyed card', 40: 'Gift card', 50: 'Check' };
  fake.rx = { printed: [], rcv: {} };
  const b0 = handlers['/Orders/RetailOrderReceiveBegin']; handlers['/Orders/RetailOrderReceiveBegin'] = p => { const x = J(p, 'submit'); const l = fake.rx.rcv[x.retailOrderId] = (fake.rx.rcv[x.retailOrderId] || []).filter(r => r.id !== x.id && !(x.paymentType === 10 && r.paymentType === 10)); l.push({ id: x.id, type: x.paymentType, amount: x.amount, give: x.giveAmount || 0 }); return b0(p); };
  const c0 = handlers['/Orders/RetailOrderBillContentGet']; handlers['/Orders/RetailOrderBillContentGet'] = p => { c0(p); const id = p.orderId || J(p, 'submit').id || p.id; const o = fake.orders[id]; if (!o) return { success: false, message: 'Order not found' };
    let tot = 0, tax = 0; const L = ['SALE RECEIPT', 'Order ' + String(id).slice(-8)];
    for (const x of o.subs || []) { const a = r2(x.price * x.quantity * (x.rate || 1) - (x.discountAmount || 0)); tot += a; if (!o.taxExempt && !x.taxFree) tax += a * (x.taxRate || 0) / 100; L.push(`${x.quantity} x ${x.name || x.number || 'Item'} ${m2(a)}`); }
    const rc = fake.rx.rcv[id] || []; L.push('Tax ' + m2(tax), 'Total ' + m2(r2(tot) + r2(tax)));
    for (const r of rc) L.push(`Paid ${PN[r.type] || r.type} ${m2(r.amount)}`); const give = rc.reduce((a, r) => a + (r.give || 0), 0); if (give > 0) L.push('Change ' + m2(give));
    return ok({ billBase64: testPagePdf(L) }); };
  const pr0 = handlers['/Hardwares/PrintBillContent']; handlers['/Hardwares/PrintBillContent'] = async p => { fake.rx.printed.push(String(J(p, 'submit').billBase64 || '')); return pr0(p); };
  const f0 = AirPos.prototype.fetchPdf; AirPos.prototype.fetchPdf = async function (pth, params) { const r = await f0.call(this, pth, params); if (!/ReturnOrderBillGet/.test(pth)) return r;
    const id = params && params.returnOrderId, rt = (fake.returns || []).find(x => x.id === id); if (!rt) return { success: false, message: 'Return not found' };
    const pays = (rt.payments || []).filter(x => Number(x.amount) > 0), L = ['RETURN RECEIPT', 'Return ' + String(id).slice(-8)];
    for (const x of rt.subs || rt.retailReturnOrderSubs || []) L.push(`${x.quantity || x.quantityReturn || 1} x ${x.name || x.number || 'Item'}`);
    L.push('Refund ' + m2(pays.reduce((a, x) => a + Number(x.amount), 0))); for (const x of pays) L.push(`Refunded ${PN[x.paymentType] || x.paymentType} ${m2(x.amount)}`);
    return { success: true, value: Buffer.from(Buffer.from(testPagePdf(L), 'base64')) }; };
}
// AirMax API batches (Step 0): every tests/fake-api/*.js adds its own fake AIR POS answers; a batch only ADDS a file here, never edits this one.
// A file is `module.exports = ({ handlers, hooks, fake, ok, J, PRODUCTS }) => { ... }`:
//   handlers['/Some/AirPosPath'] = p => ({ success: true, value: ... })   the fake answer to that AIR POS call (p = the call's params)
//   hooks['/my-hook'] = (url, res, fake) => res.end(JSON.stringify(...))   a test hook on the hook port (FAKE_PORT+1), for setting / reading fake state
// Use made-up data only. Files load in name order, after every built-in handler above (so a file may wrap an existing handler).
fake.hooks = {};
{ const dir = process.env.AIRMAX_FAKE_API_DIR || path.join(__dirname, 'fake-api'); let fl = []; try { fl = fs.readdirSync(dir).filter(f => /^[\w.-]+\.js$/.test(f)).sort(); } catch (e) { /* no folder yet */ }
  for (const f of fl) require(path.join(dir, f))({ handlers, hooks: fake.hooks, fake, ok, J, PRODUCTS }); }
require(path.join(APPDIR, 'server.js'));
// test hooks (fake server only)
const http = require('http');
// 1.0.11-speed.1 timing tests: FAKE_PROMO_DELAY=ms / FAKE_STOCK_DELAY=ms make the total check / the product search answer late
// (the answer is worked out when asked, then held back, like a slow network). Off by default: other tests unchanged.
// FAKE_SCAN_DELAY=ms: the item look-up by code answers late too (timing runs with the TestShop-measured 270/180/280 ms)
for (const [env, route] of [['FAKE_PROMO_DELAY', '/Orders/RetailOrderPromotionGet'], ['FAKE_STOCK_DELAY', '/Products/ProductPaged'], ['FAKE_SCAN_DELAY', '/Orders/RetailOrderSubGetByScan']]) {
  const ms = Number(process.env[env] || 0), h = handlers[route]; if (!(ms > 0)) continue;
  handlers[route] = async p => { const r = await h(p); (fake.slow = fake.slow || []).push({ route, at: Date.now() }); await new Promise(ok => setTimeout(ok, ms)); (fake.slow = fake.slow || []).push({ route, done: Date.now() }); return r; };
}
const hookSrv = http.createServer((q, s) => { const u = new URL(q.url, 'http://x'); if (solaHook(u, s) || ordersHook(u, s)) return; { const fh = fake.hooks && fake.hooks[u.pathname]; if (fh) return fh(u, s, fake); } if (u.pathname === '/receipts' && fake.rx) { if (u.searchParams.get('reset') === '1') fake.rx.printed = []; return s.end(JSON.stringify({ printed: fake.rx.printed })); } /* receipt-variety test */ if (u.pathname === '/latency-range') { const a = Number(u.searchParams.get('min') || 0), b = Number(u.searchParams.get('max') || 0); fake.lrange = b > 0 ? [a, b] : null; return s.end('ok'); } /* startup/search speed hooks */ if (u.pathname === '/timeline') { const l = fake.timeline || []; if (u.searchParams.get('reset') === '1') fake.timeline = []; return s.end(JSON.stringify(l)); } if (u.pathname === '/price') { const x = byCode().get(u.searchParams.get('n')); if (x) { if (u.searchParams.get('p')) x.price = Number(u.searchParams.get('p')); if (u.searchParams.get('name')) x.name = u.searchParams.get('name'); if (u.searchParams.get('tax')) x.taxRate = Number(u.searchParams.get('tax')); } return s.end(JSON.stringify(x || null)); } if (u.pathname === '/product-gone') { const x = byCode().get(u.searchParams.get('n')); if (x) x.gone = u.searchParams.get('on') !== '0'; return s.end('ok'); } if (u.pathname === '/calls-reset') { fake.calls.length = 0; fake.paged = []; return s.end('ok'); } if (u.pathname === '/paged') return s.end(JSON.stringify(fake.paged || [])); if (u.pathname === '/latency') { fake.latency = Number(u.searchParams.get('ms') || 0); return s.end(JSON.stringify({ latency: fake.latency })); } if (u.pathname === '/receipt-disc') { fake.receiptDisc = u.searchParams.get('mode') || 'none'; return s.end('ok'); } if (u.pathname === '/multibuy') { fake.multibuy = u.searchParams.get('on') === '1'; return s.end('ok'); } if (u.pathname === '/real-receipt') { fake.realReceipt = u.searchParams.get('on') === '1'; return s.end('ok'); } if (u.pathname === '/pdfs') return s.end(JSON.stringify(fake.pdfs || [])); if (u.pathname === '/order') return s.end(JSON.stringify(fake.orders[u.searchParams.get('id')] || null)); if (u.pathname === '/printlog') { const l = fake.printLog || []; if (u.searchParams.get('reset') === '1') fake.printLog = []; return s.end(JSON.stringify(l)); } if (u.pathname === '/printed') { const l = fake.printed || []; if (u.searchParams.get('reset') === '1') fake.printed = []; return s.end(JSON.stringify({ printed: l })); } /* #18 + #12 test hook: the PDFs as printed, base64 */ if (u.pathname === '/card-wait') fake.cardWait = u.searchParams.get('on') === '1'; if (u.pathname === '/card-approve') { fake.cardApprove = u.searchParams.get('on') === '1'; fake.cardAfter = Number(u.searchParams.get('after') || 1); fake.cardChecks = 0; } /* 1.0.11-local.1: after=N approves at the Nth check (stress POLLS) */ if (u.pathname === '/keyed') fake.keyed = u.searchParams.get('mode') || ''; if (u.pathname === '/cof') { const n = Number(u.searchParams.get('n') || 0); fake.cof.cards = { 'm-sample': COF_CARDS.slice(0, n).map(c => ({ ...c })) }; fake.cof.log = []; fake.cof.pays = []; } if (u.pathname === '/gift-add') { /* 1.0.11-local.4g test hook: a made-up gift card for the balance list */ const no = u.searchParams.get('no'); fake.cards[no] = { id: 'gc-' + no, cardNo: no, isSold: u.searchParams.get('sold') !== '0', balance: Number(u.searchParams.get('bal') || 0), faceValue: Number(u.searchParams.get('face') || 0), expired: u.searchParams.get('expired') === '1' }; return s.end('ok'); } if (u.pathname === '/all-calls') { return s.end(JSON.stringify(fake.calls.map(c => c.path || c.url || c))); } if (u.pathname === '/gift-calls') { return s.end(JSON.stringify(fake.calls.filter(c => /GiftCard/.test(c.path || c.url || c)).map(c => c.path || c.url || c))); } if (u.pathname === '/cash-log') { const l = fake.cashLog || []; if (u.searchParams.get('reset') === '1') fake.cashLog = []; return s.end(JSON.stringify(l)); } if (u.pathname === '/cof-state') return s.end(JSON.stringify(fake.cof)); if (u.pathname === '/clock-state') return s.end(JSON.stringify(fake.clock || [])); if (u.pathname === '/due-skew') fake.dueSkew = Number(u.searchParams.get('amt') || 0); if (u.pathname === '/strict-bump') { fake.bump = Number(u.searchParams.get('amt') || 0); fake.extra = 0; } if (u.pathname === '/complete-refuse') fake.refuseN = Number(u.searchParams.get('n') || 1); if (u.pathname === '/promo-fail') fake.promoFail = Number(u.searchParams.get('n') || 1); if (u.pathname === '/strict') return s.end(JSON.stringify({ prints: fake.prints || 0, promoFail: fake.promoFail, rcv: fake.rcv || {}, completes: fake.completes || [], orders: Object.keys(fake.orders).length })); if (u.pathname === '/receives-reset') { fake.receives = []; fake.returns = []; } if (u.pathname === '/stock-refuse') fake.stockRefuse = u.searchParams.get('on') === '1'; if (u.pathname === '/members-reset') { fake.members = null; fake.validates = []; fake.memberUpdates = []; } if (u.pathname === '/members') return s.end(JSON.stringify({ members: FM(), validates: fake.validates || [], updates: fake.memberUpdates || [] })); if (u.pathname === '/print-fail') fake.printFail = u.searchParams.get('mode') || 'off'; if (u.pathname === '/hang') fake.drawerHang = Number(u.searchParams.get('ms') || 0); if (u.pathname === '/templates') { fake.templates = (u.searchParams.get('names') || '').split(',').filter(Boolean).map((n, i) => ({ id: 'tpl-' + i, name: n, fields: [] })); fake.bills = []; } s.end(JSON.stringify({ receives: fake.receives || [], returns: fake.returns || [], drawerHang: fake.drawerHang, calls: fake.calls.slice(-30), templates: fake.templates || [], bills: fake.bills || [] })); }); if (process.env.FAKE_HOOK_PORT !== 'off') hookSrv.listen(process.env.FAKE_HOOK_PORT !== undefined ? Number(process.env.FAKE_HOOK_PORT) : Number(process.env.FAKE_PORT || 5058) + 1, '127.0.0.1'); // FAKE_HOOK_PORT=off: no hook server (1.0.10 runner keeps to ports 5187-5189)

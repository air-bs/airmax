// 1.0.11 candidate: totals, tax and change due must come out EXACTLY as in the 1.0.11 base (7298f17) on a set of sample sales
// (line + order discounts, tax-off, gift card + cash change, card-free). Offline, made-up items, fake AIR POS. Never touches a real store.
// tests/sales-equiv-1011-golden.json was written by running this same file on the BASE tree (7298f17) with --write-golden.
// Candidate runs every sale twice (fastScan off and on, like the server) and compares to that file. Run: node tests/sales-equiv-1011.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const GOLD = path.join(__dirname, 'sales-equiv-1011-golden.json');
const WRITE = process.argv.includes('--write-golden');
const r2 = x => Math.round(x * 100) / 100;
const ITEMS = { A: { price: 10, tax: 8 }, B: { price: 2.5, tax: 8 }, C: { price: 1.25, tax: 0 }, D: { price: 7.99, tax: 8.875 }, E: { price: 24.99, tax: 6.5 } };
function mk(fast) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-eq1011-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  Object.assign(reg.settings, { receiptAutoPrint: 'never', drawerAutoOpen: 'never' }); reg.fastScan = fast;
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: ['RetailManager'] };
  const srv = { orders: {}, rcv: {}, begins: [], completes: 0, cards: {}, saved: [] }; let sid = 0;
  const a = reg.api;
  a.scan = async code => { const x = ITEMS[code]; if (!x) return { success: false, message: 'Item not found' };
    return { success: true, value: { id: 's' + (++sid), itemId: 'i' + code, productId: 'p' + code, number: code, name: 'Made-up ' + code, quantity: 1, rate: 1, price: x.price, taxRate: x.tax, discount: 0, discountAmount: 0 } }; };
  a.promotionGet = async s => { let orig = 0, tot = 0, tax = 0, disc = 0; const subs = [];
    for (const x of s.subs) { const g = x.quantity * x.price; orig += g; const net = g - (x.discountAmount || 0); disc += x.discountAmount || 0; tot += net; const tx = r2(net * (x.taxRate || 0) / 100); tax += tx; subs.push({ id: x.id, discountAmount: x.discountAmount || 0, promotionDiscountAmount: 0, taxAmount: tx }); }
    return { success: true, value: { subs, totalAmount: r2(tot), totalTax: r2(tax), totalDiscountAmount: r2(disc), totalPromotionDiscountAmount: 0, originalTotalAmount: r2(orig) } }; };
  a.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  a.productPaged = async () => ({ success: true, rows: [], total: 0 });
  a.orderSave = async s => { srv.orders[s.id] = JSON.parse(JSON.stringify(s)); srv.saved.push({ amount: s.amount, due: s.dueAmount, tax: s.tax }); return { success: true }; };
  a.receiveBegin = async s => { srv.begins.push({ t: s.paymentType, amount: s.amount, receive: s.receiveAmount, give: s.giveAmount });
    (srv.rcv[s.retailOrderId] = srv.rcv[s.retailOrderId] || []).push({ id: s.id, paymentType: s.paymentType, amount: s.amount, receiveAmount: s.receiveAmount, giveAmount: s.giveAmount, status: 20, giftIds: s.retailGiftCards || [] });
    return { success: true, value: { isCompleted: true } }; };
  a.receiveCheck = async s => ({ success: true, value: { isCompleted: !!(srv.rcv[s.retailOrderId] || []).find(r => r.id === s.id) } });
  a.complete = async c => { srv.completes++; for (const r of srv.rcv[c.id] || []) if (r.paymentType === 40) { let left = r.amount; for (const id of r.giftIds) { const take = Math.min(left, srv.cards[id] || 0); srv.cards[id] = r2(srv.cards[id] - take); left = r2(left - take); } } return { success: true }; };
  a.orderGet = async id => srv.orders[id] ? { success: true, value: { id, number: 'T1', status: 15, receives: (srv.rcv[id] || []).map(({ giftIds, ...r }) => r) } } : { success: true, value: null };
  a.openCashbox = async () => ({ success: true }); a.printBill = async () => ({ success: true }); a.printBillContent = async () => ({ success: true });
  reg.mode = 'sale';
  return { reg, srv };
}
const snap = reg => { const t = reg.totals; return { due: t.due, tax: t.tax, itemAmount: t.itemAmount, discount: t.discount, total: t.total, lines: reg.subs.map(s => [s.itemId, s.quantity, s.discountAmount, s.taxRate]).sort() }; };
const SALES = [
  { name: 'S1 plain taxed items, cash with change', steps: [['scan', 'A'], ['scan', 'A'], ['scan', 'B']], pay: [{ type: 10, tendered: 50 }] },
  { name: 'S2 mixed tax rates (0, 8, 8.875, 6.5), exact cash', steps: [['scan', 'C'], ['scan', 'D'], ['scan', 'E'], ['scan', 'B']], pay: [{ type: 10, tendered: 'due' }] },
  { name: 'S3 line discount percent + amount', steps: [['scan', 'A'], ['scan', 'E'], ['line', 0, 'percent', 15], ['line', 1, 'amount', 2]], pay: [{ type: 10, tendered: 100 }] },
  { name: 'S4 order discount percent 10', steps: [['scan', 'A'], ['scan', 'D'], ['scan', 'D'], ['order', 'percent', 10]], pay: [{ type: 10, tendered: 60 }] },
  { name: 'S5 order discount amount 5 + line discount', steps: [['scan', 'E'], ['scan', 'E'], ['scan', 'B'], ['line', 0, 'percent', 10], ['order', 'amount', 5]], pay: [{ type: 10, tendered: 80 }] },
  { name: 'S6 Tax Off (manager): tax 0, change due', steps: [['scan', 'A'], ['scan', 'D'], ['taxoff']], pay: [{ type: 10, tendered: 20 }] },
  { name: 'S7 Tax Off then back on', steps: [['scan', 'E'], ['taxoff'], ['taxoff']], pay: [{ type: 10, tendered: 'due' }] },
  { name: 'S8 Tax Off + order discount', steps: [['scan', 'A'], ['scan', 'E'], ['taxoff'], ['order', 'percent', 20]], pay: [{ type: 10, tendered: 40 }] },
  { name: 'S9 gift card pays part, cash the rest', steps: [['scan', 'E'], ['scan', 'D'], ['scan', 'A']], gift: [20], pay: [{ type: 40, amount: 20, gift: true }, { type: 10, tendered: 30 }] },
  { name: 'S10 gift card pays the whole sale (2 cards, one payment), balances left', steps: [['scan', 'A'], ['scan', 'B']], gift: [8, 9], pay: [{ type: 40, amount: 'due', gift: true }] },
  { name: 'S11 gift card + discounts + tax off, cash change', steps: [['scan', 'E'], ['scan', 'D'], ['line', 0, 'percent', 10], ['taxoff'], ['order', 'amount', 3]], gift: [15], pay: [{ type: 40, amount: 15, gift: true }, { type: 10, tendered: 20 }] },
  { name: 'S12 quantity changes then discount', steps: [['scan', 'B'], ['qty', 0, 6], ['scan', 'C'], ['line', 0, 'percent', 5]], pay: [{ type: 10, tendered: 25 }] },
];
async function run(fast, S) {
  const { reg, srv } = mk(fast), res = { steps: [] };
  const settle = async () => { if (typeof reg.settle === 'function') await reg.settle(); };
  for (const st of S.steps) {
    let r;
    if (st[0] === 'scan') r = await reg.scan(st[1]); else if (st[0] === 'line') { await settle(); r = await reg.lineDiscount(st[1], st[2], st[3]); }
    else if (st[0] === 'order') { await settle(); r = await reg.setOrderDiscount(st[1], st[2]); } else if (st[0] === 'taxoff') { await settle(); r = await reg.setTaxExempt(null, {}); }
    else if (st[0] === 'qty') { await settle(); r = await reg.setQty(st[1], st[2]); }
    await settle(); res.steps.push({ ok: !!(r && r.ok), snap: snap(reg) });
  }
  await settle(); const sp = await reg.startPay(); res.start = { ok: !!(sp && sp.ok) }; res.beforePay = snap(reg); res.pay = [];
  const cards = (S.gift || []).map((b, i) => { const id = 'gc' + i; srv.cards[id] = b; return { id, number: 'ZZTGC' + i, balance: b }; });
  for (const p of S.pay) {
    const b = { type: p.type }; if (p.tendered != null) b.tendered = p.tendered === 'due' ? reg.totals.due : p.tendered;
    if (p.amount != null) b.amount = p.amount === 'due' ? reg.totals.due : p.amount; if (p.gift) b.giftCards = cards;
    const r = await reg.tender(b) || {};
    res.pay.push({ ok: !!r.ok, completed: !!r.completed, due: r.due, change: r.change, remaining: r.remaining, paid: r.paid });
  }
  res.server = { begins: srv.begins, completes: srv.completes, cards: srv.cards, savedAmounts: srv.saved.map(x => [x.amount, x.due, x.tax]).slice(-1) };
  return res;
}
(async () => {
  const got = {}; for (const S of SALES) got[S.name] = await run(false, S);
  if (WRITE) { fs.writeFileSync(GOLD, JSON.stringify(got, null, 1)); console.log('golden written: ' + SALES.length + ' sales'); return; }
  const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8')); let pass = 0, bad = 0;
  const rec = (k, ok, note) => { ok ? pass++ : bad++; console.log((ok ? 'PASS ' : 'FAIL ') + k + (ok ? '' : ' — ' + note)); };
  for (const S of SALES) {
    const g = JSON.stringify(gold[S.name]);
    for (const fast of [false, true]) {
      const x = JSON.stringify(await run(fast, S));
      rec(`${S.name} [${fast ? 'fast scan' : 'normal'}]: totals, tax, discounts, due, change, AIR POS calls and gift balances identical to base`, x === g, 'cand ' + x.slice(0, 600) + ' | base ' + g.slice(0, 600));
    }
  }
  // sanity: the golden sales really exercise money (not all empty / failed)
  rec('golden sanity: every sale completed and at least one has change, tax off, and a gift card payment', SALES.every(S => gold[S.name].pay.some(p => p.completed)) && SALES.some(S => gold[S.name].pay.some(p => p.change > 0)) && gold['S6 Tax Off (manager): tax 0, change due'].beforePay.tax === 0 && gold['S9 gift card pays part, cash the rest'].server.begins.some(b => b.t === 40), 'golden check');
  console.log(`${pass}/${pass + bad} sales-equiv-1011 passed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.log('FAIL crash ' + (e.stack || e.message)); process.exit(1); });

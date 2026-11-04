// Work copy (NOT released). Owner requests K + L, offline (mocked AIR POS, no network, no printer, made-up data only).
// L: printer / drawer failures never hold a sale: once AIR POS completes it, the sale ends at once; printing runs in the
//    background and a failure leaves only a small note ("Receipt didn't print, reprint later"). Reprint keeps working.
// K: an out-of-stock item is still added; a read-only look-up gives "Out of stock (qty N)".
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mk(printer, drawer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-hwbg-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  const api = reg.api, calls = [], printed = [];
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true }; reg.home = { terminalConfig: { checkoutAutoPrint: true, returnAutoPrint: true, autoOpenCashDrawer: true }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async s => { calls.push('save:' + s.paymentType + ':' + s.subs.length); return { success: true }; };
  const rcv = []; // mgc1011: 1.0.11-local.7 reads the order back after a cash payment; answer like AIR POS (kept receives, status 20) so no network is tried
  api.receiveBegin = async s => { calls.push('begin:' + s.paymentType + ':' + s.amount); rcv.push({ id: s.id, paymentType: s.paymentType, amount: s.amount, status: 20 }); return { success: true, value: { isCompleted: true } }; };
  api.orderGet = async id => ({ success: true, value: { id, status: 15, receives: rcv } });
  api.complete = async () => { calls.push('complete'); return { success: true }; };
  api.returnCreate = async () => ({ success: true, value: {} }); api.nonOrderReturnCreate = async () => { calls.push('nonOrderReturn'); return { success: true }; };
  api.returnGet = async id => ({ id, status: 10, payments: [] });
  reg.printOrder = async id => { printed.push(id); return printer(id); }; reg.printReturn = async id => { printed.push('ret:' + id); return printer(id); };
  reg.drawer = async () => drawer();
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, calls, printed };
}
async function sell(t) { await t.reg.recalc(); await t.reg.startPay(); const t0 = Date.now(); const r = await t.reg.tender({ type: 10, tendered: 20 }); return { r, ms: Date.now() - t0 }; }
const OK = async () => ({ ok: true, message: 'Receipt sent' }), DOK = async () => ({ ok: true, message: 'Drawer opened' });
const HANG = () => new Promise(() => {});
(async () => {
  // 1. printer hangs (never answers) mid-sale
  let t = mk(HANG, DOK); t.reg.hwPrintMs = 400;
  let { r, ms } = await sell(t);
  rec('Printer hangs: the sale finishes at once (no printer wait)', r.ok && r.completed && ms < 300, `${ms} ms, completed ${r.completed}`);
  rec('Next sale is ready right away (cart cleared, payment closed)', t.reg.subs.length === 0 && !t.reg.pay && t.reg.order.id !== r.orderId, `subs ${t.reg.subs.length}`);
  rec('Result says printing runs in the background; no printer message holds the done screen', JSON.stringify(r.hwPending) === '["drawer","receipt"]' && !r.print && !r.drawer && JSON.parse(JSON.stringify(r)).hwJob === undefined, JSON.stringify(r.hwPending));
  rec('While still printing: no note yet', t.reg.hwNotesRecent().length === 0, JSON.stringify(t.reg.hwNotesRecent()));
  await r.hwJob; let n = t.reg.hwNotesRecent();
  rec('Printer timed out: small note "Receipt didn\'t print, reprint later"', n.length === 1 && n[0].kind === 'receipt' && /Receipt didn't print: press Reprint Receipt \(Ctrl\+P\)/.test(n[0].message), JSON.stringify(n));
  // 2. printer offline (answers with an error)
  t = mk(async () => ({ ok: false, message: 'Printer offline', hw: 'error' }), DOK); ({ r, ms } = await sell(t)); await r.hwJob; n = t.reg.hwNotesRecent();
  rec('Printer offline: sale finishes fast, note shown, reason kept for the log', r.ok && ms < 300 && n.length === 1 && /Reprint Receipt \(Ctrl\+P\)/.test(n[0].message) && /offline/.test(n[0].why), `${ms} ms ${JSON.stringify(n)}`);
  // 3. out of paper (throws)
  t = mk(async () => { throw new Error('Out of paper'); }, DOK); ({ r, ms } = await sell(t)); await r.hwJob; n = t.reg.hwNotesRecent();
  rec('Out of paper (printer throws): sale finishes, note shown, nothing crashes', r.ok && ms < 300 && n.length === 1 && /Out of paper/.test(n[0].why), `${ms} ms ${JSON.stringify(n)}`);
  // 4. reprint still works once the printer is back
  let up = false; t = mk(async () => (up ? { ok: true, message: 'Receipt sent' } : { ok: false, message: 'Printer offline' }), DOK); ({ r } = await sell(t)); await r.hwJob;
  up = true; const rp = await t.reg.printOrder(r.orderId);
  rec('Reprint works afterwards for the same sale', rp.ok && t.printed.filter(x => x === r.orderId).length === 2, JSON.stringify(t.printed));
  // 5. drawer fails
  t = mk(OK, async () => ({ ok: false, message: 'Drawer not connected' })); ({ r, ms } = await sell(t)); await r.hwJob; n = t.reg.hwNotesRecent();
  rec('Cash drawer fails: sale finishes, only a small drawer note (receipt still prints)', r.ok && ms < 300 && n.length === 1 && n[0].kind === 'drawer' && /Cash drawer didn't open/.test(n[0].message) && t.printed.includes(r.orderId), JSON.stringify(n));
  // 6. drawer hangs then printer still gets its turn
  t = mk(OK, HANG); t.reg.drawerWaitMs = () => 0; ({ r, ms } = await sell(t)); const job = await r.hwJob; n = t.reg.hwNotesRecent();
  rec('Drawer hangs: sale finishes at once; receipt still prints after the drawer cap', r.ok && ms < 300 && n.length === 1 && n[0].kind === 'drawer' && job.find(j => j[0] === 'receipt')[1].ok, `${ms} ms ${JSON.stringify(n)}`);
  // 7. money calls identical with a broken and a working printer
  const a = mk(OK, DOK), b = mk(HANG, HANG); b.reg.hwPrintMs = 100; b.reg.drawerWaitMs = () => 0;
  const ra = (await sell(a)).r, rb = (await sell(b)).r; await ra.hwJob; await rb.hwJob;
  rec('Sale logic unchanged: same AIR POS calls, total and change with a working or a broken printer', a.calls.join() === b.calls.join() && ra.due === rb.due && ra.change === rb.change, a.calls.join(' '));
  rec('Working printer: no note at all', a.reg.hwNotesRecent().length === 0, JSON.stringify(a.reg.hwNotesRecent()));
  // 8. returns: same rule
  t = mk(HANG, DOK); t.reg.hwPrintMs = 200; t.reg.mode = 'return'; t.reg.ret = { id: 'ret-9', kind: 'nonorder', order: null, subs: [{ id: 's1', productId: 'p1', itemId: 'i1', quantity: 1, rate: 1, discount: 0, price: 5, taxRate: 0 }] };
  let t0 = Date.now(); const rr = await t.reg.confirmReturn(); ms = Date.now() - t0; await rr.hwJob; n = t.reg.hwNotesRecent();
  rec('Return with a hung printer: return finishes at once, note "Return receipt didn\'t print"', rr.ok && ms < 300 && n.length === 1 && /Return receipt didn't print/.test(n[0].message), `${ms} ms ${rr.message} ${JSON.stringify(n)}`);
  // 9. notes fade from the list after a minute
  t.reg.hwNotes[0].at -= 61000; rec('Old notes drop off by themselves (60 s)', t.reg.hwNotesRecent().length === 0, 'ok');
  // K: out of stock
  const k = mk(OK, DOK); const stock = { '1002': 0, '1005': -3, '1001': 50 };
  k.reg.api.scan = async code => (stock[code] !== undefined || code === '7777' ? { success: true, value: { id: 'sub' + code, itemId: 'i' + code, productId: 'p' + code, number: code, name: 'Made-up ' + code, quantity: 1, rate: 1, price: 5, taxRate: 0, discount: 0, discountAmount: 0 } } : { success: false, message: 'Product not found' });
  let paged = 0; k.reg.api.productPaged = async code => { paged++; return { success: true, rows: stock[code] === undefined ? [] : [{ id: 'p' + code, number: code, name: 'Made-up ' + code, quantityStock: stock[code] }] }; };
  k.reg.subs = []; const s0 = await k.reg.scan('1002');
  rec('K: scanning a 0-stock item still adds it to the sale (no stock call inside the scan)', s0.ok && k.reg.subs.length === 1 && k.reg.subs[0].number === '1002' && paged === 0, `${s0.message}; lookups during scan ${paged}`);
  const z = await k.reg.stockNote('1002'), neg = await k.reg.stockNote('1005'), pos = await k.reg.stockNote('1001'), unk = await k.reg.stockNote('7777');
  rec('K: zero stock → "Out of stock (qty 0)"', z.ok && z.out && z.message === 'Out of stock (qty 0)', JSON.stringify(z));
  rec('K: negative stock → "Out of stock (qty -3)"', neg.out && neg.message === 'Out of stock (qty -3)', JSON.stringify(neg));
  rec('K: in stock / unknown → no note', !pos.out && pos.known && unk.ok && !unk.known && !unk.out, JSON.stringify([pos, unk]));
  rec('K: the look-up changes nothing in the sale', k.reg.subs.length === 1 && k.reg.subs[0].quantity === 1, 'subs ' + k.reg.subs.length);
  const srv = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');
  rec('Routes hw-notes and stock-note exist (login needed), not in the single-flight money set', /'hw-notes': needLogin/.test(srv) && /'stock-note': needLogin/.test(srv) && !/const ONCE = new Set\(\[[^\]]*'(hw-notes|stock-note)'/.test(srv), 'ok');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} printer-background / out-of-stock tests passed`);
  fs.writeFileSync(path.join(__dirname, 'printer-background-results.json'), JSON.stringify(out, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

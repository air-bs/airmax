// airmax-fix-stock (Nov 2 2026): offline checks (mocked AIR POS, temp data folder, made-up data) for
//  - AIR POS's own setting retailConfig.inventorySetting.retailOrderStockCheck: false = never block before payment (even if this PC learned "refuses" earlier);
//    true / missing = exactly as before
//  - the reason a failed Finish sale gave survives a restart (journal) and is shown again after recovery
// Run: node tests/stuck-stock-1011.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note || '').slice(0, 260)); };
function mk(opt = {}) {
  const dir = opt.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-ss-'));
  const logs = []; const reg = new Register({ log: m => logs.push(m), dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  const api = reg.api, begins = [], completes = [], looks = [];
  api.ide = 'x'; reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {}, ...(opt.inv === undefined ? {} : { inventorySetting: { retailOrderStockCheck: opt.inv } }) }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async s => { begins.push({ type: s.paymentType, amount: s.amount, id: s.id }); return { success: true, value: { isCompleted: true } }; };
  let refuse = opt.refuse || 0;
  api.complete = async () => { completes.push(1); if (refuse > 0) { refuse--; return { success: false, message: 'Insufficient inventory, inventory write-down failed' }; } return { success: true }; };
  api.orderGet = async () => ({ success: true, value: { id: reg.order.id, number: 'RO1', status: 15, receives: begins.map(b => ({ id: b.id, status: 20, paymentType: b.type, amount: b.amount })) } });
  api.productPaged = async q => { looks.push(q); const rows = [{ id: 'p0', number: '0001', name: 'Made-up item', quantityStock: 0 }].filter(x => x.number === q); return { success: true, rows, total: rows.length }; };
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' });
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, begins, completes, looks, dir, logs };
}
const learned = (t, rule) => { t.reg._stockRule = { rule }; };
(async () => {
  // ---- AIR POS stock-check setting ----
  let t = mk({ inv: false }); learned(t, 'refuses'); await t.reg.recalc(); let s = await t.reg.startPay(); let r = await t.reg.tender({ type: 20, amount: 10 });
  rec('U1 setting false + this PC learned "refuses" earlier: no stock look-up, card taken, sale completes (never blocked)', t.reg.stockRule() === 'allows' && t.looks.length === 0 && s.ok && r.ok && r.completed && t.begins.length === 1, JSON.stringify({ rule: t.reg.stockRule(), looks: t.looks.length, ok: r.ok, c: r.completed, begins: t.begins.length }));
  t = mk({ inv: false, refuse: 1 }); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 20, amount: 10 });
  rec('U2 setting false but AIR POS refuses anyway: card kept, reason shown, rule stays "allows" (the next sale is not blocked), Finish retry completes with ONE card payment', !r.ok && r.completeFailed && /Insufficient inventory/.test(r.message) && t.reg.stockRule() === 'allows' && (await t.reg.finishSale()).completed && t.begins.length === 1, r.message);
  t = mk({ inv: true }); learned(t, 'refuses'); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 20, amount: 10 });
  rec('U3 setting true + learned "refuses": unchanged, stopped BEFORE the card is charged', !r.ok && r.stockBlocked && t.begins.length === 0, r.message);
  t = mk(); learned(t, 'refuses'); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 20, amount: 10 });
  rec('U4 setting missing + learned "refuses": unchanged (still stopped before the card)', !r.ok && r.stockBlocked && t.begins.length === 0 && t.reg.stockRule() === 'refuses', r.message);
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 20, amount: 10 });
  rec('U5 setting missing, nothing learned, warning off: unchanged (card taken)', r.ok && r.completed && t.begins.length === 1, r.message);
  // ---- reason kept in its own field, journalled, restored ----
  t = mk({ refuse: 3 }); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 20, amount: 10 }); t.reg.journalSnap('route');
  const rf = t.reg.pay.refusal, j = t.reg.journal.read();
  rec('U6 refusal kept in pay.refusal (kind, text, short items) and in the sale journal', rf && rf.kind === 'refused' && /Insufficient inventory/.test(rf.text) && rf.items.length === 1 && /Made-up item \(0 in stock/.test(rf.items[0]) && j && j.pay && j.pay.refusal && j.pay.refusal.text === rf.text, JSON.stringify(rf));
  const rc = await t.reg.payRecheck(); const rc2 = await t.reg.payRecheck();
  rec('U7 Check AIR POS again twice: pay.refusal untouched, message leads with it', t.reg.pay.refusal === rf && /^AIR POS refused to finish the sale: Insufficient inventory/.test(rc.message) && /^AIR POS refused to finish the sale: Insufficient inventory/.test(rc2.message), rc2.message.slice(0, 160));
  rec('U8 log has the refusal line (reason + short item) and a recheck line each time', t.logs.some(l => /FINISH SALE NOT DONE \[refused\].*Insufficient inventory.*short: Made-up item/.test(l)) && t.logs.filter(l => /^CHECK AGAIN pressed/.test(l) && /Insufficient inventory/.test(l)).length === 2, t.logs.filter(l => /NOT DONE|CHECK AGAIN pressed/.test(l)).join(' // ').slice(0, 300));
  // restart: a new Register on the same data folder recovers the paid sale and still knows the reason
  const t2 = mk({ dir: t.dir, refuse: 1 }); t2.reg.mode = 'sale'; t2.reg.subs = []; t2.reg.recoveryPending = true;
  t2.reg.api.orderGet = async id => ({ success: true, value: { id, number: 'RO1', status: 15, receives: [{ id: j.pay.tenders[0].id, status: 20, paymentType: 20, amount: 10 }], subs: j.subs } });
  const rr = await t2.reg.recover(); const st2 = t2.reg.state();
  rec('U9 after a restart the recovered paid sale shows the reason AIR POS gave before (red box), payment kept', t2.reg.pay && t2.reg.paidTotal() === 10 && t2.reg.pay.refusal && /Insufficient inventory/.test(st2.pay.lastError || '') && /Press Finish sale to try again/.test(st2.pay.lastError || ''), JSON.stringify({ r: rr && rr.notice && rr.notice.slice(0, 80), le: st2.pay && st2.pay.lastError }).slice(0, 300));
  const f = await t2.reg.finishSale();
  rec('U10 ...and Finish sale after the restart completes with no new card payment', f.ok && f.completed && t2.begins.length === 0, JSON.stringify({ ok: f.ok, c: f.completed, begins: t2.begins.length, msg: f.message }));
  rec('U11 a completed sale clears the note', !t2.reg.pay || !t2.reg.pay.refusal, 'cleared');
  const pass = out.filter(x => x.pass).length; console.log(`stuck-stock-1011 unit: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

// 1.0.10-local.2 (Ari OK via parent 2:32 PM ET Nov 1): (1) Log out while payments are taken on an unfinished sale needs a second
// press (the payments are kept and come back after login); (2) the "AIR POS refuses below zero stock" rule is learned per store,
// so a store known to refuse is stopped BEFORE any card is charged even with the stock warning OFF; (3) the refused-Finish
// message names the item and says the payments are kept. No payment or void code changed. Offline, mocked AIR POS, made-up data.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
function mk(opt = {}) {
  const dir = opt.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-ls-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  Object.assign(reg.settings, { receiptAutoPrint: 'never', drawerAutoOpen: 'never' });
  const api = reg.api, begins = [], completes = [];
  api.ide = 'x'; api.shop = opt.shop || 'MadeUpShopA'; reg.identity = { userName: 'u', corpName: 'MadeUpCo', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async s => { begins.push({ type: s.paymentType, amount: s.amount }); return { success: true, value: { isCompleted: true } }; };
  let refuse = opt.refuse || 0;
  api.complete = async () => { completes.push(1); if (refuse > 0) { refuse--; return { success: false, message: 'Insufficient inventory, inventory write-down failed' }; } return { success: true }; };
  api.orderGet = async () => ({ success: true, value: { status: 1, receives: [] } });
  api.productPaged = async q => { const rows = [{ id: 'p0', number: '0001', name: 'Made-up toy', quantityStock: 0 }].filter(x => x.number === q); return { success: true, rows, total: rows.length }; };
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' });
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up toy', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, begins, completes, dir };
}
(async () => {
  // ---- logout ----
  let t = mk(); await t.reg.recalc(); await t.reg.startPay(); let r = await t.reg.tender({ type: 10, amount: 4 });
  const paid = t.reg.paidTotal(); let lo = t.reg.logout();
  rec('L1 log out with $4 taken on an unfinished sale: refused with a clear message (payments kept, press again)', !lo.ok && lo.paidOpen && /\$4\.00/.test(lo.message) && /Finish sale/.test(lo.message) && /payments are kept/.test(lo.message) && t.reg.identity && t.reg.pay && t.reg.paidTotal() === paid, lo.message);
  lo = t.reg.logout();
  rec('L2 second press within 30 s logs out (recovery after login brings the sale back)', lo.ok && !t.reg.identity, lo.message);
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); t.reg.pay.tenders.push({ id: 'x', type: 20, amount: 4, status: 'done' }); t.reg.pay.card = { kind: 'terminal', status: 'approved', tenderId: 'x' };
  lo = t.reg.logout(); rec('L3 approved card part (card box still up): first press refused too', !lo.ok && lo.paidOpen, lo.message);
  t.reg._logoutOk = { ...t.reg._logoutOk, at: Date.now() - 31000 }; lo = t.reg.logout(); rec('L4 a press after 30 s asks again', !lo.ok && lo.paidOpen, lo.message);
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); t.reg.pay.card = { kind: 'terminal', status: 'waiting' };
  lo = t.reg.logout(); const lo2 = t.reg.logout(); rec('L5 card still waiting: always refused (as before), even on a second press', !lo.ok && !lo2.ok && /Cancel it first/.test(lo2.message), lo2.message);
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); lo = t.reg.logout(); rec('L6 payment window open, nothing paid: logs out at once (as before)', lo.ok, lo.message);
  t = mk(); lo = t.reg.logout(); rec('L7 no sale: logs out at once', lo.ok, lo.message);
  // ---- 1.0.11-local.1 hotfix (Stress Tester l1010 lw-*): a refused press on sale A must not let ONE press log out on sale B ----
  for (const [k1, k2] of [['cash', 'cash'], ['card', 'cash'], ['cash', 'card']]) {
    const tw = mk(); await tw.reg.recalc(); await tw.reg.startPay(); await tw.reg.tender({ type: k1 === 'card' ? 20 : 10, amount: 3 });
    const a1 = tw.reg.logout(); const fin = await tw.reg.tender({ type: k1 === 'cash' ? 20 : 10, amount: 7 }); /* AIR POS keeps one cash payment per sale */ const oidA = tw.reg.lastOrderId || 'A';
    const ns = await tw.reg.newSale(); tw.reg.subs = [{ ...mk().reg.subs[0], id: 'b' }]; await tw.reg.recalc(); await tw.reg.startPay(); await tw.reg.tender({ type: k2 === 'card' ? 20 : 10, amount: 4 });
    const b1 = tw.reg.logout();
    rec(`W lw-${k1}-${k2}: refused press on sale A, A finished, sale B with $4 taken: the FIRST press on B is refused (no carry-over)`, !a1.ok && a1.paidOpen && fin.ok && fin.completed && ns.ok && tw.reg.paidTotal() === 4 && !b1.ok && b1.paidOpen && !!tw.reg.identity, JSON.stringify({ a1: a1.ok, fin: fin.ok && fin.completed, newSale: ns.ok, b1: b1.ok, paidB: tw.reg.paidTotal(), oidA: !!oidA }));
    const b2 = tw.reg.logout();
    rec(`W lw-${k1}-${k2}: second press on sale B within 30 s still logs out (payments kept)`, b2.ok && !tw.reg.identity, b2.message);
  }
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 10, amount: 3 }); lo = t.reg.logout();
  const okAfterPress = !!t.reg._logoutOk; t.reg.resetOrder();
  rec('W hold / new sale / finish / void all reset the sale: the logout OK is cleared with it', okAfterPress && !t.reg._logoutOk, JSON.stringify(t.reg._logoutOk));
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 10, amount: 3 }); lo = t.reg.logout();
  t.reg.pay = { ...t.reg.pay }; lo = t.reg.logout();
  rec('W same sale but its payment was reopened (e.g. recovered after login): asks again', !lo.ok && lo.paidOpen, lo.message);
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 10, amount: 3 }); lo = t.reg.logout();
  t.reg._logoutOk = { ...t.reg._logoutOk, id: 'some-other-sale' }; lo = t.reg.logout();
  rec('W an OK given on another sale id never counts', !lo.ok && lo.paidOpen, lo.message);
  // ---- refused Finish after a split card + cash, warning OFF (default) ----
  t = mk({ refuse: 1 }); await t.reg.recalc(); await t.reg.startPay();
  rec('M0 default OFF, store rule unknown: no stock check before payment', t.reg.stockWarnOn() === false && t.reg.stockRule() === 'unknown', t.reg.stockRule());
  await t.reg.tender({ type: 20, amount: 6 }); r = await t.reg.tender({ type: 10, amount: 4 });
  rec('M1 refused Finish: names the item, payments kept, add stock in AIR POS back office, press Finish sale', !r.ok && r.completeFailed && /Made-up toy/.test(r.message) && /Payments are kept/.test(r.message) && /back office/.test(r.message) && /Finish sale/.test(r.message), r.message);
  rec('M2 nothing charged again or refunded: card once, cash once, $10 paid', t.begins.length === 2 && t.reg.paidTotal() === 10 && t.reg.remaining() === 0, JSON.stringify(t.begins));
  rec('M3 the payment window keeps the same advice on screen', /Made-up toy/.test(t.reg.state().pay.lastError || ''), t.reg.state().pay.lastError);
  rec('M4 refusal learned for THIS store', t.reg.stockRule() === 'refuses', t.reg.stockRule());
  const f = await t.reg.finishSale();
  rec('M5 stock added -> Finish sale completes with the same payments (no new charge)', f.ok && f.completed && t.begins.length === 2, JSON.stringify({ ok: f.ok, m: f.message }));
  // ---- per store ----
  let t2 = mk({ dir: t.dir }); await t2.reg.recalc(); await t2.reg.startPay();
  rec('P1 same store, next short sale with warning OFF: notice in the payment window', /refuses sales below zero/.test(t2.reg.state().pay.stockWarning), t2.reg.state().pay.stockWarning);
  r = await t2.reg.tender({ type: 20, amount: 10 });
  rec('P2 same store: card stopped BEFORE it is charged (nothing sent)', !r.ok && r.stockBlocked && t2.begins.length === 0, r.message);
  t2 = mk({ dir: t.dir }); await t2.reg.recalc(); await t2.reg.startPay(); r = await t2.reg.tender({ type: 40, amount: 10, giftCards: [{ id: 'g', number: '7000000000002222', balance: 50 }] });
  rec('P3 same store: gift card stopped before it is charged too', !r.ok && r.stockBlocked && t2.begins.length === 0, r.message);
  let t3 = mk({ dir: t.dir, shop: 'MadeUpShopB' }); await t3.reg.recalc(); await t3.reg.startPay(); r = await t3.reg.tender({ type: 20, amount: 10 });
  rec('P4 another store on the same PC (rule unknown there): default OFF applies, card taken', t3.reg.stockRule() === 'unknown' && r.ok && r.completed && t3.begins.length === 1, t3.reg.stockRule());
  rec('P5 store B sale done with the warning OFF (no stock look-up, so nothing learned for B); store A still "refuses"', t3.reg.stockRule() === 'unknown' && mk({ dir: t.dir }).reg.stockRule() === 'refuses', JSON.parse(fs.readFileSync(path.join(t.dir, 'stock-rule.json'), 'utf8')).shops ? 'per-store file' : 'no shops');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-ls-')); fs.writeFileSync(path.join(d, 'stock-rule.json'), JSON.stringify({ rule: 'refuses', why: 'old file' }));
  let t4 = mk({ dir: d, shop: 'Other' }); await t4.reg.recalc(); await t4.reg.startPay(); r = await t4.reg.tender({ type: 20, amount: 10 });
  rec('P6 older PC-wide "refuses" file (1.0.9): still stops the card before charging, for any store', !r.ok && r.stockBlocked && t4.begins.length === 0, t4.reg.stockRule());
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-ls-')); fs.writeFileSync(path.join(d2, 'stock-rule.json'), JSON.stringify({ rule: 'allows', why: 'old file' }));
  rec('P7 older PC-wide "allows" file: not trusted for a named store (unknown -> the store\'s own answer decides)', mk({ dir: d2 }).reg.stockRule() === 'unknown', mk({ dir: d2 }).reg.stockRule());
  const pass = out.filter(x => x.pass).length; console.log(`logout-stock: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

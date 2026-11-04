// 1.0.10-local.2 (Ari OK 12:22 PM Nov 1): Settings > Printer & Drawer "Warn before selling below zero stock", per PC, default OFF.
// Off: payment opens straight away (no stock look-up, no "Check first"). On: exactly as before (Check first + Take payment anyway).
// Money: when AIR POS refuses to finish a below-zero sale AFTER the card was charged, Air Max stops with a clear message, keeps the
// charge recorded (Finish sale retries the Complete only) and never charges again. Offline, mocked AIR POS, made-up data only.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
function mk(opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-sw-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  if (opt.stockWarn !== undefined) reg.settings.stockWarn = opt.stockWarn;
  const api = reg.api, begins = [], completes = [], looks = [];
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async s => { begins.push({ type: s.paymentType, amount: s.amount }); return { success: true, value: { isCompleted: true } }; };
  let refuse = opt.refuse || 0;
  api.complete = async () => { completes.push(1); if (refuse > 0) { refuse--; return { success: false, message: 'Insufficient inventory, inventory write-down failed' }; } return { success: true }; };
  api.orderGet = async () => ({ success: true, value: { status: 1, receives: [] } });
  api.productPaged = async q => { looks.push(q); const rows = [{ id: 'p0', number: '0001', name: 'Made-up item', quantityStock: 0 }].filter(x => x.number === q); return { success: true, rows, total: rows.length }; };
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' });
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, begins, completes, looks, dir, setRefuse: n => { refuse = n; } };
}
const GC = [{ id: 'g', number: '7000000000002222', balance: 50 }];
(async () => {
  // ---- default OFF (new installs and upgrades: the key is unset) ----
  let t = mk(); await t.reg.recalc(); let s = await t.reg.startPay();
  rec('S1 default: warning OFF (unset key), payment opens, no stock look-up, no notice', t.reg.stockWarnOn() === false && s.ok && t.looks.length === 0 && !t.reg.state().pay.stockWarning, JSON.stringify({ on: t.reg.stockWarnOn(), looks: t.looks.length, w: t.reg.state().pay.stockWarning }));
  let r = await t.reg.tender({ type: 20, amount: 10 });
  rec('S2 OFF: card on a 0-in-stock sale is taken straight away (no "Check first") and the sale completes', r.ok && !r.needStockOk && r.completed && t.begins.length === 1 && t.begins[0].type === 20, JSON.stringify({ ok: r.ok, c: r.completed, m: r.message, begins: t.begins }));
  t = mk({ stockWarn: false }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 40, amount: 10, giftCards: GC });
  rec('S3 OFF: gift card too, straight to payment', r.ok && !r.needStockOk && t.begins.length === 1, JSON.stringify({ ok: r.ok, m: r.message }));
  // ---- ON: same as today ----
  t = mk({ stockWarn: true }); await t.reg.recalc(); s = await t.reg.startPay();
  rec('S4 ON: payment window shows the low-stock notice (as before)', /Made-up item \(0 in stock, selling 1\)/.test(t.reg.state().pay.stockWarning), t.reg.state().pay.stockWarning);
  r = await t.reg.tender({ type: 20, amount: 10 });
  rec('S5 ON: card -> "Check first: ... (0 in stock, selling 1)", nothing charged', !r.ok && r.needStockOk && /^Check first: Made-up item \(0 in stock, selling 1\)/.test(r.message) && /Take payment anyway/.test(r.message) && t.begins.length === 0, r.message);
  r = await t.reg.tender({ type: 20, amount: 10, stockOk: true });
  rec('S6 ON: "Take payment anyway" -> charged once, sale completes', r.ok && r.completed && t.begins.length === 1, JSON.stringify({ ok: r.ok, c: r.completed }));
  t = mk({ stockWarn: true }); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 10, tendered: 20 });
  rec('S7 ON: cash is not gated (as before)', r.ok && r.completed && t.begins.length === 1, JSON.stringify({ ok: r.ok, m: r.message }));
  // ---- money: AIR POS refuses to finish after the card was charged (warning OFF) ----
  t = mk({ refuse: 2 }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 20, amount: 10 });
  const st = t.reg.state();
  rec('S8 refusal after the charge: stops with a clear message (payment taken, not enough stock, Finish sale), not completed', !r.ok && !r.completed && r.completeFailed && /Payment taken/.test(r.message) && /stock/i.test(r.message) && /Finish sale/.test(r.message) && /payments are safe|payment is kept/i.test(r.message), r.message);
  rec('S9 the card charge stays recorded on the sale (paid $10.00, nothing owed, sale not cleared)', t.reg.pay && t.reg.paidTotal() === 10 && t.reg.remaining() === 0 && t.reg.subs.length === 1 && st.pay && st.pay.paid === 10, JSON.stringify({ paid: t.reg.paidTotal(), left: t.reg.remaining(), subs: t.reg.subs.length }));
  const jr = t.reg.journal && t.reg.journal.read && t.reg.journal.read();
  rec('S10 the charge is in the crash-safe sale journal too (refund or retry after a restart)', !!jr && JSON.stringify(jr).includes('"amount":10'), jr ? Object.keys(jr).join(',') : 'none');
  const again = await t.reg.tender({ type: 20, amount: 10 });
  rec('S11 a second card tender on the fully paid sale is refused: no second charge', !again.ok && t.begins.length === 1, again.message);
  const f1 = await t.reg.finishSale();
  rec('S12 Finish sale while AIR POS still refuses: same clear message, still ONE charge', !f1.ok && /stock/i.test(f1.message) && t.begins.length === 1 && t.reg.paidTotal() === 10, f1.message);
  rec('S14 the refusal is learned: this store refuses below zero stock', t.reg.stockRule() === 'refuses', t.reg.stockRule());
  // after that, a short sale is stopped BEFORE any money is taken even with the warning off (hard stop, not the warning)
  const t2 = mk(); t2.reg.dataDir = t.dir; t2.reg._stockRule = null; await t2.reg.recalc(); await t2.reg.startPay();
  r = await t2.reg.tender({ type: 20, amount: 10 });
  rec('S15 store known to refuse: next short sale is stopped before the card is charged (warning OFF too), nothing charged', !r.ok && r.stockBlocked && t2.begins.length === 0, r.message);
  const f2 = await t.reg.finishSale();
  rec('S13 stock fixed -> Finish sale completes with the SAME charge (one ReceiveBegin, Complete retried only)', f2.ok && f2.completed && t.begins.length === 1 && t.completes.length === 3, JSON.stringify({ ok: f2.ok, begins: t.begins.length, completes: t.completes.length }));
  // ---- the setting ----
  t = mk(); t.reg.savePrinterSettings({ stockWarn: true }); const on = t.reg.stockWarnOn();
  t.reg.savePrinterSettings({ stockWarn: 'yes' }); const junk = t.reg.stockWarnOn(); t.reg.savePrinterSettings({ stockWarn: false });
  rec('S16 saved per PC through Settings (true / false only; junk ignored)', on === true && junk === true && t.reg.stockWarnOn() === false && t.reg.settings.stockWarn === false, JSON.stringify({ on, junk, now: t.reg.settings.stockWarn }));
  t = mk(); const sv = t.reg.saveSettings({ stockWarn: true });
  rec('S17 the Settings save passes it through and the screen state shows it', sv.ok && t.reg.state().settings.stockWarn === true, JSON.stringify({ ok: sv.ok, v: t.reg.state().settings.stockWarn }));
  const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
  rec('S18 Settings > Printer & Drawer: "Warn before selling below zero stock" checkbox, unchecked unless saved ON, sent on Save', /id="seSW"[^>]*\$\{st\.stockWarn === true \? 'checked' : ''\}> Warn before selling below zero stock/.test(app) && /stockWarn: \$\('seSW'\)\.checked/.test(app), '');
  rec('S19 "Take payment anyway" button (Alt+T) code unchanged', /btn\.id = 'payStockOk'/.test(app) && /btn\.textContent = 'Take payment anyway'/.test(app), '');
  const pass = out.filter(x => x.pass).length; console.log(`stockwarn: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

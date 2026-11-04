// 1.0.10-local.2 (Ari 12:16 PM Nov 1): Settings > Printer & Drawer "Print receipt after every sale" / "...after every return":
// Always (default) / Follow AIR POS / Never. Print only (no money, no stored records). Never prints twice. Mocked AIR POS, made-up data.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mk(set = {}, term = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-ap-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos'; Object.assign(reg.settings, set);
  const api = reg.api, prints = [], pre = [];
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: Object.assign({ checkoutAutoPrint: false, returnAutoPrint: false, autoOpenCashDrawer: false }, term), retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } });
  api.complete = async () => ({ success: true });
  api.orderGet = async () => ({ success: true, value: { status: 1, receives: [] } });
  api.productPaged = async () => ({ success: true, rows: [], total: 0 });
  reg.printOrder = async id => { prints.push(id); return { ok: true, message: 'Receipt sent' }; };
  reg.prefetchReceipt = id => { pre.push(id); };
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, prints, pre };
}
async function sale(set, term) { const t = mk(set, term); await t.reg.recalc(); await t.reg.startPay(); const r = await t.reg.tender({ type: 10, amount: 10 }); await sleep(400); return Object.assign(t, { r }); }
(async () => {
  let t = await sale({}, { checkoutAutoPrint: false });
  rec('A1 default (key unset) = Always: one receipt even though AIR POS "auto print" is OFF', t.r.completed && t.prints.length === 1 && t.pre.length === 1 && t.reg.autoPrintMode('sale') === 'always', JSON.stringify({ c: t.r.completed, prints: t.prints.length, pre: t.pre.length }));
  t = await sale({ receiptAutoPrint: 'always' }, { checkoutAutoPrint: false });
  rec('A2 Always + AIR POS OFF: exactly one receipt (one print, one prefetch)', t.r.completed && t.prints.length === 1 && t.pre.length === 1, JSON.stringify({ prints: t.prints.length, pre: t.pre.length }));
  t = await sale({ receiptAutoPrint: 'always' }, { checkoutAutoPrint: true });
  rec('A3 Always + AIR POS ON: still exactly one receipt (never twice)', t.r.completed && t.prints.length === 1 && t.pre.length === 1, JSON.stringify({ prints: t.prints.length, pre: t.pre.length }));
  t = await sale({ receiptAutoPrint: 'never' }, { checkoutAutoPrint: true });
  rec('A4 Never: no receipt, even with AIR POS auto print ON; the sale still completes', t.r.completed && t.prints.length === 0 && t.pre.length === 0, JSON.stringify({ c: t.r.completed, prints: t.prints.length }));
  t = await sale({ receiptAutoPrint: 'airpos' }, { checkoutAutoPrint: true });
  const a5 = t.prints.length; t = await sale({ receiptAutoPrint: 'airpos' }, { checkoutAutoPrint: false });
  rec('A5 Follow AIR POS: prints once when AIR POS auto print is ON, none when OFF', a5 === 1 && t.prints.length === 0, JSON.stringify({ on: a5, off: t.prints.length }));
  t = await sale({ receiptAutoPrint: 'bogus' }, {});
  rec('A6 an unknown saved value falls back to Always', t.reg.autoPrintMode('sale') === 'always' && t.prints.length === 1, t.reg.autoPrintMode('sale'));
  // returns (the return job is built only when autoPrintOn('return'))
  const R = (set, term) => mk(set, term).reg.autoPrintOn('return');
  rec('A7 returns: default Always prints with AIR POS return auto print OFF; Never never; Follow AIR POS follows returnAutoPrint',
    R({}, { returnAutoPrint: false }) === true && R({ returnReceiptAutoPrint: 'never' }, { returnAutoPrint: true }) === false && R({ returnReceiptAutoPrint: 'airpos' }, { returnAutoPrint: true }) === true && R({ returnReceiptAutoPrint: 'airpos' }, { returnAutoPrint: false }) === false && R({ returnReceiptAutoPrint: 'always' }, { checkoutAutoPrint: false }) === true, '');
  rec('A8 sale and return settings are separate', mk({ receiptAutoPrint: 'never', returnReceiptAutoPrint: 'always' }).reg.autoPrintOn('sale') === false && mk({ receiptAutoPrint: 'never', returnReceiptAutoPrint: 'always' }).reg.autoPrintOn('return') === true, '');
  const src = fs.readFileSync(path.join(__dirname, '../app/lib/register.js'), 'utf8');
  { const pre = src.split('\n').filter(l => / \/\/ rp1011\+$/.test(l)); rec('A9b 1.0.11 receipt prefetch line (template list asked for during Complete) only reads, never prints', pre.length === 1 && !/printOrder|printPdf|printBillContent|printSlip|jobs\.push|billContentGet/.test(pre[0].replace(/\/\/.*$/, '')), pre.length + ' line'); }
  rec('A9 register.js: the sale receipt job / prefetch and the return job each depend on autoPrintOn (one place each, no second print path)', (src.split('\n').filter(l => !/ \/\/ rp1011\+$/.test(l)).join('\n').match(/autoPrintOn\('sale'\)/g) || []).length === 2 && (src.match(/autoPrintOn\('return'\)/g) || []).length === 1 && !/checkoutAutoPrint\)\s*jobs\.push/.test(src) && !/returnAutoPrint\)\s*jobs\.push/.test(src), '');
  // saving (whitelist: only the three values)
  t = mk(); const sv = x => { try { t.reg.savePrinterSettings(x); } catch {} };
  sv({ receiptAutoPrint: 'never', returnReceiptAutoPrint: 'airpos' }); const s1 = [t.reg.settings.receiptAutoPrint, t.reg.settings.returnReceiptAutoPrint];
  sv({ receiptAutoPrint: 'junk', returnReceiptAutoPrint: 7 }); const s2 = [t.reg.settings.receiptAutoPrint, t.reg.settings.returnReceiptAutoPrint];
  rec('A10 saved per PC; only Always / Follow AIR POS / Never are kept', s1.join() === 'never,airpos' && s2.join() === 'never,airpos', JSON.stringify({ s1, s2 }));
  const app = fs.readFileSync(path.join(__dirname, '../app/public/app.js'), 'utf8');
  rec('A11 Settings > Printer & Drawer: both choices with Always / Follow AIR POS / Never; the after-sale note says Always by default',
    /Print receipt after every sale/.test(app) && /Print receipt after every return/.test(app) && /Follow AIR POS/.test(app) && /Always by default/.test(app), '');
  const pass = out.filter(x => x.pass).length; console.log(`autoprint: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

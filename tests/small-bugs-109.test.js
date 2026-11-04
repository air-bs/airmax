// 1.0.9-local.2 smaller bugs (Ari OK 12:32 PM ET Oct 30, local only; PLAN-double-charge-refund.md part 3).
// Offline fault injection: fake AIR POS calls in-process, temp data folder, no account. Run: node tests/small-bugs-109.test.js
// APP=<folder> runs the same checks against another copy of app/ (used for the before-fix baseline).
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const APP = process.env.APP || path.join(__dirname, '..', 'app');
const { Register } = require(path.join(APP, 'lib', 'register'));
let n = 0, bad = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log('ok   ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + (e.message || e)); } };
const LOST = { success: false, message: 'Network error: ETIMEDOUT', unreachable: true };

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-small109-'));
  const reg = new Register({ log: () => {}, dataDir: dir });
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  const srv = { orders: {}, saves: 0, completes: 0, session: 10, clockIns: 0, clockOuts: 0, xRecs: [], xExports: [], printed: 0, cards: {}, adds: 0, f: {} };
  const once = k => { if (srv.f[k] > 0) { srv.f[k]--; return true; } return false; };
  const a = reg.api;
  a.promotionGet = async s => { const am = (s.subs || []).reduce((x, y) => x + y.price * y.quantity * (1 - (y.discount || 0) / 100), 0); return { success: true, value: { subs: [], totalAmount: am, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: am } }; };
  a.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  a.productPaged = async () => ({ rows: [] });
  a.orderSave = async s => { srv.saves++; srv.orders[s.id] = { ...s, status: s.isPending === false ? 20 : 15 }; if (once('saveLost')) return LOST; if (once('saveRefuse')) { delete srv.orders[s.id]; return { success: false, message: 'Refused' }; } return { success: true }; };
  a.orderGet = async id => once('getLost') ? LOST : srv.orders[id] ? { success: true, value: { id, number: 'T1', status: srv.orders[id].status, receives: [] } } : { success: false, message: 'Not found' };
  a.complete = async c => { srv.completes++; if (srv.orders[c.id]) srv.orders[c.id].status = 20; return { success: true }; };
  a.sessionCheck = async () => once('sessLost') ? LOST : { type: srv.session, expectedAmount: 0 };
  a.clockIn = async () => { srv.clockIns++; if (srv.session === 10) return { success: false, message: 'Already clocked in' }; srv.session = 10; return once('ciLost') ? LOST : { success: true }; };
  a.clockOut = async () => { srv.clockOuts++; if (srv.session !== 10) return { success: false, message: 'Not clocked in' }; srv.session = 0; return once('coLost') ? LOST : { success: true }; };
  a.xReadPrintRecordPaged = async () => ({ rows: srv.xRecs.map((x, i) => ({ id: 'x' + i, printTime: x })) });
  a.fetchPdf = async (p, params) => { if (/XReadReportExport/.test(p)) { srv.xExports.push(params.isPrint); if (params.isPrint === 'true') srv.xRecs.push(Date.now()); } if (once('pdfLost')) return LOST; return { success: true, value: Buffer.from('%PDF-1.4 x') }; };
  reg.printPdfBase64 = async (b64, label) => { srv.printed++; if (once('printFail')) return { ok: false, message: 'Printer offline' }; return { ok: true, message: label }; };
  a.giftCardGet = async no => { if (once('gcGetLost')) return LOST; const c = srv.cards[no]; return c ? { success: true, value: c } : { success: false, message: 'Gift card not found' }; };
  a.giftCardAdd = async s => { srv.adds++; if (srv.cards[s.cardNo]) return { success: false, message: 'Gift card number already exists' }; srv.cards[s.cardNo] = { id: s.id, cardNo: s.cardNo, faceValue: s.faceValue, isSold: false }; return once('gcAddLost') ? LOST : { success: true }; };
  a.openCashbox = async () => ({ success: true }); a.printBill = async () => ({ success: true }); a.printBillContent = async () => ({ success: true });
  return { reg, srv };
}
const item = (id, price, discount = 0) => ({ id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity: 1, rate: 1, price, taxRate: 0, discount, discountAmount: 0, type: 0, timestamp: 1 });
const held = srv => Object.values(srv.orders).filter(o => o.status === 15).length;

(async () => {
  // (f) empty $0 order
  await t('(f) Finish on an empty register: refused, nothing sent to AIR POS', async () => {
    const { reg, srv } = make(); const r = await reg.finishSale();
    assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.strictEqual(srv.completes + srv.saves, 0, 'calls ' + (srv.completes + srv.saves));
  });
  await t('(f) Finish pressed after a background card approval already finished the sale: no empty $0 order', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 1)]; await reg.recalc(); await reg.startPay();
    reg.resetOrder(); reg.pay = null; // what the card poll does when AIR POS finished the sale in the background
    const r = await reg.finishSale(); assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.strictEqual(srv.completes + srv.saves, 0);
  });
  // (g) $0 sale with items
  await t('(g) $0.00 sale (100% discount) with items: Finish completes it with no payment', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 5, 100)]; await reg.recalc(); const s = await reg.startPay(); assert.ok(s.ok, JSON.stringify(s));
    const r = await reg.finishSale(); assert.ok(r.ok && r.completed, JSON.stringify(r)); assert.strictEqual(srv.completes, 1);
  });
  await t('(g) payment screen shows Finish sale for a $0.00 sale that has items (no tender needed)', async () => {
    const js = fs.readFileSync(path.join(APP, 'public', 'app.js'), 'utf8');
    assert.ok(/left <= 0\.004 && \(p\.tenders\.length \|\| \(S\.cart\.length && S\.totals && S\.totals\.due <= 0\.004\)\)/.test(js), 'Finish needs a tender');
  });
  // (h) hold
  await t('(h) Hold with a lost reply that AIR POS saved: held once, sale cleared', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 2)]; srv.f.saveLost = 1;
    const r = await reg.hold(); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(held(srv), 1); assert.strictEqual(reg.subs.length, 0);
  });
  await t('(h) Hold, lost reply and the check fails too: re-press does not make a second held order', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 2)]; srv.f.saveLost = 1; srv.f.getLost = 1;
    const r1 = await reg.hold(); assert.strictEqual(r1.ok, false); const r2 = await reg.hold();
    assert.ok(r2.ok, JSON.stringify(r2)); assert.strictEqual(held(srv), 1, 'held orders ' + held(srv));
  });
  await t('(h) Hold refused by AIR POS: nothing held, re-press holds once', async () => {
    const { reg, srv } = make(); reg.subs = [item('A', 2)]; srv.f.saveRefuse = 1;
    const r1 = await reg.hold(); assert.strictEqual(r1.ok, false); const r2 = await reg.hold(); assert.ok(r2.ok); assert.strictEqual(held(srv), 1);
  });
  // (i) clock in / out
  await t('(i) Clock in, lost reply that AIR POS recorded: in sale mode, not stuck on "already clocked in"', async () => {
    const { reg, srv } = make(); reg.mode = 'clockin'; srv.session = 0; srv.f.ciLost = 1;
    const r1 = await reg.clockIn(0); const r2 = r1.ok ? r1 : await reg.clockIn(0);
    assert.ok(r2.ok, JSON.stringify(r2)); assert.strictEqual(reg.mode, 'sale'); assert.strictEqual(srv.clockIns <= 2, true);
  });
  await t('(i) Clock in when AIR POS says "already clocked in": goes to sale mode', async () => {
    const { reg, srv } = make(); reg.mode = 'clockin'; srv.session = 10; const r = await reg.clockIn(0); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(reg.mode, 'sale');
  });
  await t('(i) Clock in fails and AIR POS cannot be reached: stays on clock-in', async () => {
    const { reg, srv } = make(); reg.mode = 'clockin'; srv.session = 0; srv.f.ciLost = 1; srv.f.sessLost = 9;
    const a = reg.api; a.clockIn = async () => LOST; const r = await reg.clockIn(0); assert.strictEqual(r.ok, false); assert.strictEqual(reg.mode, 'clockin');
  });
  await t('(i) Clock out, lost reply that AIR POS recorded: logged out, no "not clocked in" error on re-press', async () => {
    const { reg, srv } = make(); srv.f.coLost = 1; const r = await reg.clockOut(0); assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(srv.clockOuts, 1);
  });
  await t('(i) Clock out, lost reply, not recorded: says try again and stays logged in', async () => {
    const { reg, srv } = make(); reg.api.clockOut = async () => { srv.clockOuts++; return LOST; };
    const r = await reg.clockOut(0); assert.strictEqual(r.ok, false); assert.ok(r.retryable, JSON.stringify(r)); assert.ok(reg.identity, 'still logged in');
  });
  // (j) X report print
  await t('(j) X report print, printer fails, re-press: only one X print recorded on AIR POS', async () => {
    const { reg, srv } = make(); srv.f.printFail = 1; await reg.printReport('x'); const r = await reg.printReport('x');
    assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(srv.xRecs.length, 1, 'X print records ' + srv.xRecs.length); assert.strictEqual(srv.printed, 2);
  });
  await t('(j) X report print, lost reply that AIR POS recorded, re-press: printed once more without a second record', async () => {
    const { reg, srv } = make(); srv.f.pdfLost = 1; const r1 = await reg.printReport('x'); assert.strictEqual(r1.ok, false); const r2 = await reg.printReport('x');
    assert.ok(r2.ok, JSON.stringify(r2)); assert.strictEqual(srv.xRecs.length, 1, 'X print records ' + srv.xRecs.length);
  });
  await t('(j) X report print double press at the same time: one X print', async () => {
    const { reg, srv } = make(); await Promise.all([reg.printReport('x'), reg.printReport('x')]); assert.strictEqual(srv.xRecs.length, 1, 'X print records ' + srv.xRecs.length);
  });
  // (k) gift card
  await t('(k) Gift card top-up when the card check gets no reply: nothing added, no "already exists"', async () => {
    const { reg, srv } = make(); srv.cards['GC1'] = { id: 'g1', cardNo: 'GC1', isSold: true, balance: 10, faceValue: 10 }; srv.f.gcGetLost = 1;
    const r = await reg.addGiftLine({ number: 'GC1', amount: 5 }); assert.strictEqual(srv.adds, 0, 'RetailGiftCardAdd called'); assert.strictEqual(r.ok, false); assert.ok(!/already exists/i.test(r.message), r.message);
    const r2 = await reg.addGiftLine({ number: 'GC1', amount: 5 }); assert.ok(r2.ok && r2.gift.kind === 'reload', JSON.stringify(r2));
  });
  await t('(k) New gift card, lost reply on create: card line added once, no "already exists"', async () => {
    const { reg, srv } = make(); srv.f.gcAddLost = 1; const r = await reg.addGiftLine({ number: 'GC2', amount: 20 });
    assert.ok(r.ok && r.gift.kind === 'sale', JSON.stringify(r)); assert.strictEqual(reg.giftLines().length, 1); assert.strictEqual(srv.adds, 1);
  });
  await t('(k) Card made in AIR POS meanwhile (create says "already exists" and it is sold): becomes a reload', async () => {
    const { reg, srv } = make(); let first = true; const g = reg.api.giftCardGet;
    reg.api.giftCardGet = async no => { if (first) { first = false; srv.cards[no] = { id: 'g3', cardNo: no, isSold: true, balance: 3, faceValue: 3 }; return { success: false, message: 'Gift card not found' }; } return g(no); };
    const r = await reg.addGiftLine({ number: 'GC3', amount: 5 }); assert.ok(r.ok && r.gift.kind === 'reload', JSON.stringify(r));
  });
  console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

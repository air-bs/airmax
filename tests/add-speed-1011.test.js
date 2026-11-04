// 1.0.11-speed.1 (Ari OK via parent 5:26 PM ET Nov 1 2026, local test build only): adding an item shows the line at once and the
// total is checked in the background (latest answer wins); every other step waits for that total first, and a stale total is never
// paid on. Offline: mocked AIR POS, made-up items and amounts, no network.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
const ITEMS = { '0001': { price: 10, tax: 8 }, '0002': { price: 2.5, tax: 8 }, '0003': { price: 1.25, tax: 0 } };
function mk(opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-add1011-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  Object.assign(reg.settings, { receiptAutoPrint: 'never', drawerAutoOpen: 'never' });
  reg.fastScan = opt.fast !== false;
  const api = reg.api, f = { calls: 0, done: 0, delay: opt.delay || 40, delays: null, fail: 0, saves: [], begins: [] };
  api.ide = 'x'; api.shop = 'MadeUpShopA'; reg.identity = { userName: 'u', corpName: 'MadeUpCo', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.scan = async code => { const x = ITEMS[code]; if (!x) return { success: false, message: 'Item not found' }; await sleep(2); return { success: true, value: { id: 's' + Math.random(), itemId: 'i' + code, productId: 'p' + code, number: code, name: 'Made-up ' + code, quantity: 1, rate: 1, price: x.price, taxRate: x.tax, discount: 0, discountAmount: 0 } }; };
  // the reply is worked out from the items AS SENT (like AIR POS), then held back
  api.promotionGet = async s => {
    const n = ++f.calls, snap = s.subs.map(x => ({ id: x.id, q: x.quantity, p: x.price, t: x.taxRate || 0 }));
    const fail = f.fail > 0 ? (f.fail--, true) : false;
    await sleep(f.delays ? f.delays(n) : f.delay); f.done++;
    if (fail) return { success: false, message: 'Network error: ETIMEDOUT', unreachable: true };
    let tot = 0, tax = 0; for (const x of snap) { tot += x.q * x.p; tax += x.q * x.p * x.t / 100; } tax = r2(tax);
    return { success: true, value: { subs: snap.map(x => ({ id: x.id, discountAmount: 0, promotionDiscountAmount: 0, taxAmount: r2(x.q * x.p * x.t / 100) })), totalAmount: r2(tot), totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: r2(tot), n } };
  };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async x => { f.saves.push({ promoDone: f.done, calls: f.calls, subs: (x.subs || []).map(s => s.quantity + 'x' + String(s.productId).slice(1)), orderDiscount: x.orderDiscount, x }); return { success: true }; };
  api.receiveBegin = async s => { f.begins.push({ type: s.paymentType, amount: s.amount }); return { success: true, value: { isCompleted: true } }; };
  api.complete = async () => ({ success: true });
  api.orderGet = async () => ({ success: true, value: { status: 1, receives: [] } });
  api.productPaged = async () => ({ success: true, rows: [], total: 0 });
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' });
  reg.mode = 'sale';
  return { reg, f };
}
const want = codes => { let tot = 0, tax = 0; for (const c of codes) { tot += ITEMS[c].price; tax += ITEMS[c].price * ITEMS[c].tax / 100; } return { due: r2(r2(tax) + tot), tax: r2(tax) }; };
(async () => {
  // ---- burst of 10 adds ----
  let t = mk(); const codes = ['0001', '0002', '0003', '0001', '0002', '0002', '0003', '0001', '0002', '0001'];
  const ret = []; for (const c of codes) { const r = await t.reg.scan(c); ret.push({ ok: r.ok, done: t.f.done, calls: t.f.calls, up: t.reg.totals.updating, stale: t.reg.totals.stale }); }
  rec('B1 each of 10 adds returns with its line in the cart before its total answer is back (updating + stale)', ret.every((x, i) => x.ok && x.calls === i + 1 && x.done < x.calls && x.up && x.stale) && t.reg.subs.length === 3, JSON.stringify(ret.slice(0, 3)) + ' …');
  let ok = await t.reg.settle(); let w = want(codes);
  rec('B2 after the burst: final total and tax are the ones for all 10 items (latest answer kept)', ok && t.reg.totals.due === w.due && t.reg.totals.tax === w.tax && !t.reg.totals.stale && !t.reg.totals.updating, `due ${t.reg.totals.due} (want ${w.due}), tax ${t.reg.totals.tax} (want ${w.tax})`);
  rec('B3 the 10 lines are 3 rows with the right quantities', t.reg.subs.map(s => s.number + 'x' + s.quantity).sort().join(',') === '0001x4,0002x4,0003x2', t.reg.subs.map(s => s.number + 'x' + s.quantity).join(','));
  // ---- out-of-order replies ----
  t = mk(); t.f.delays = n => n === 1 ? 160 : n === 2 ? 90 : 10; // first asked answers LAST
  await t.reg.scan('0001'); await t.reg.scan('0002'); await t.reg.scan('0001');
  await sleep(60); const mid = { due: t.reg.totals.due, done: t.f.done, up: t.reg.totals.updating };
  await sleep(200); w = want(['0001', '0002', '0001']);
  rec('O1 newest answer (asked 3rd, back 1st) is applied; the 2 older answers that come back later are ignored', mid.done === 1 && mid.due === w.due && !mid.up && t.f.done === 3 && t.reg.totals.due === w.due && t.reg.lastPromoReply.value.n === 3, `after newest: ${JSON.stringify(mid)}; at end due ${t.reg.totals.due} (want ${w.due}), reply kept #${t.reg.lastPromoReply.value.n}`);
  // ---- pay mid-recalc ----
  t = mk({ delay: 120 }); await t.reg.scan('0001'); await t.reg.scan('0002'); await t.reg.scan('0002');
  const t0 = Date.now(); let r = await t.reg.startPay(); w = want(['0001', '0002', '0002']);
  rec('P1 Payment pressed while the total is still being checked: waits, then opens on the FINAL total', r.ok && t.reg.pay && t.reg.totals.due === w.due && !t.reg.totals.stale && t.reg.pay.dueSeen === w.due, `due ${t.reg.totals.due} (want ${w.due}), waited ${Date.now() - t0} ms`);
  r = await t.reg.tender({ type: 10, amount: w.due });
  rec('P2 cash for the final total finishes the sale; saved with all 3 items, one cash payment of the final total', r.ok && r.completed && t.f.begins.length === 1 && t.f.begins[0].amount === w.due && t.f.saves.length >= 1 && t.f.saves[0].subs.sort().join(',') === '1x0001,2x0002', JSON.stringify({ begins: t.f.begins, subs: t.f.saves[0] && t.f.saves[0].subs }));
  // tender straight away (payment window already open, then an add on the side panel waits as before)
  t = mk({ delay: 80 }); await t.reg.scan('0001'); await t.reg.startPay(); r = await t.reg.scan('0002');
  rec('P3 an add with the payment window open still waits for its total (as before: no background check while paying)', r.ok && !t.reg.totals.stale && !t.reg.totals.updating && t.reg.totals.due === want(['0001', '0002']).due, `due ${t.reg.totals.due}`);
  // ---- failure ----
  t = mk({ delay: 30 }); await t.reg.scan('0001'); await t.reg.settle(); t.f.fail = 1; await t.reg.scan('0002'); ok = await t.reg.settle();
  rec('F1 background total check fails: total stays marked stale (not updating), cart keeps the line', ok === false && t.reg.totals.stale === true && !t.reg.totals.updating && t.reg.subs.length === 2, JSON.stringify({ stale: t.reg.totals.stale, up: t.reg.totals.updating, due: t.reg.totals.due }));
  t.f.fail = 5; r = await t.reg.startPay();
  rec('F2 Payment while AIR POS still cannot check the total: refused with the existing stale-total message, nothing charged', !r.ok && /total/i.test(r.message) && !t.reg.pay && t.f.begins.length === 0, r.message);
  r = await t.reg.tender({ type: 10, amount: 100 });
  rec('F3 a tender without a payment window is refused too (never paid on an old total)', !r.ok && t.f.begins.length === 0, r.message);
  t.f.fail = 0; r = await t.reg.startPay(); w = want(['0001', '0002']);
  rec('F4 once AIR POS answers again, Payment opens on the right total', r.ok && t.reg.totals.due === w.due && !t.reg.totals.stale, `due ${t.reg.totals.due} (want ${w.due})`);
  // failure on the 1st of 2 overlapping checks, success on the 2nd: the newer answer wins
  t = mk(); t.f.fail = 1; t.f.delays = n => n === 1 ? 100 : 20; await t.reg.scan('0001'); await t.reg.scan('0002'); ok = await t.reg.settle(); await sleep(120);
  rec('F5 an OLDER failed check coming back late does not mark the newer good total stale', ok && !t.reg.totals.stale && t.reg.totals.due === want(['0001', '0002']).due, JSON.stringify({ stale: t.reg.totals.stale, due: t.reg.totals.due }));
  // ---- hold / discount / promo / points mid-recalc ----
  t = mk({ delay: 100 }); await t.reg.scan('0001'); await t.reg.scan('0002'); r = await t.reg.hold();
  rec('H1 Hold pressed mid-check: waits for the total, then saves the held sale with both items', r.ok && t.f.saves.length === 1 && t.f.saves[0].promoDone === t.f.calls && t.f.saves[0].subs.sort().join(',') === '1x0001,1x0002' && t.reg.subs.length === 0, JSON.stringify(t.f.saves.map(s => ({ promoDone: s.promoDone, calls: s.calls, subs: s.subs }))));
  t = mk({ delay: 100 }); await t.reg.scan('0001'); await t.reg.scan('0001'); r = await t.reg.setOrderDiscount('amount', 15);
  rec('D1 a $15 order discount typed mid-check is checked against the full $20 (the $10 before the 2nd add would refuse it)', r.ok && t.reg.order.orderDiscountAmount === 15 && t.reg.totals.itemAmount === 20 && !t.reg.totals.stale, JSON.stringify({ r: r.message, orderDiscountAmount: t.reg.order.orderDiscountAmount, item: t.reg.totals.itemAmount, orderDiscount: t.reg.order.orderDiscount, due: t.reg.totals.due }));
  t = mk({ delay: 100 }); await t.reg.scan('0001'); const qp = await t.reg.addQty ? await t.reg.addQty(0, 1) : await t.reg.setQty(0, 2);
  rec('Q1 quantity change right after an add: ends on the right total (2 x $10 + tax)', !t.reg.totals.stale && t.reg.totals.due === want(['0001', '0001']).due && t.reg.subs[0].quantity === 2, JSON.stringify({ q: qp && qp.message, due: t.reg.totals.due, qty: t.reg.subs[0].quantity }));
  // ---- sale reset with an answer still out ----
  t = mk({ delay: 80 }); await t.reg.scan('0001'); t.reg.resetOrder(); await sleep(120);
  rec('R1 sale reset (new sale / void) while a total check is out: its late answer never lands on the new empty sale', t.reg.subs.length === 0 && t.reg.totals.due === 0 && !(t.reg.promotionSubs || []).length && !t.reg.totals.stale, JSON.stringify({ due: t.reg.totals.due, ps: (t.reg.promotionSubs || []).length }));
  // ---- off by default ----
  t = mk({ fast: false, delay: 30 }); r = await t.reg.scan('0001');
  rec('X1 without fastScan (direct Register use, older tests) a scan still waits for its total, as before', r.ok && t.f.done === 1 && !t.reg.totals.updating && t.reg.totals.due === want(['0001']).due, JSON.stringify({ done: t.f.done, due: t.reg.totals.due }));
  // ---- timing ----
  t = mk({ delay: 300 }); let a = Date.now(); await t.reg.scan('0001'); const addMs = Date.now() - a; await t.reg.settle(); const totMs = Date.now() - a;
  rec('T1 with a 300 ms total check, the add itself returns before the total (line first, total after)', addMs < 100 && totMs >= 290, `add ${addMs} ms, total in after ${totMs} ms`);
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error('FAIL crash', e); process.exit(1); });

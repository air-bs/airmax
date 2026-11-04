// AirMax 1.0.9-local.10 (Stress Tester local.9 report, LOW "Hold", 8/8, seeds 25091006/013/020/027, 25092006/013/020/027;
// Ari 12:18 AM ET Nov 1 "fix stress bugs right away"): Air Max closed (crash / power) while Hold was being saved, AFTER
// AIR POS saved it. Before: at the next start the sale came back on screen as "nothing was paid yet", nothing said it was
// already held, and holding it again (or ringing it again and holding) left TWO parked orders on AIR POS.
// Now (ls10h, same pattern as the pay-in / pay-out redo check ls9d): the notice says it WAS held (Load Hold), the cart is not
// put back, and the first redo of the SAME items is reported done once (not sent); a second press holds a genuinely new sale.
// Offline: in-process Register + an in-memory fake AIR POS, temp data folder, no account, nothing sent anywhere.
// Run: node tests/stress9-hold-110.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log('ok   ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const item = (id, price, quantity = 1) => ({ id: 's' + id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity, rate: 1, price, taxRate: 0, discount: 0, discountAmount: 0, type: 0, timestamp: 1 });
// one shared fake AIR POS (survives the "crash"); each Register is one app start on the same data folder
function airpos() { return { orders: {}, saves: 0, crashNext: false, lostBeforeSave: false }; }
function start(srv, dir) {
  const reg = new Register({ log: () => {}, dataDir: dir });
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  const a = reg.api;
  a.promotionGet = async s => { const tot = (s.subs || []).reduce((x, y) => x + y.price * y.quantity, 0); return { success: true, value: { subs: [], totalAmount: tot, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot } }; };
  a.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  a.orderSave = async s => {
    if (srv.lostBeforeSave) { srv.lostBeforeSave = false; return new Promise(() => {}); } // closed before AIR POS got it
    srv.saves++; srv.orders[s.id] = { id: s.id, number: 'H' + Object.keys(srv.orders).length, status: s.isPending ? 15 : 10, subs: JSON.parse(JSON.stringify(s.subs)), receives: [] };
    if (srv.crashNext) { srv.crashNext = false; return new Promise(() => {}); } // AIR POS saved it; Air Max closed before the reply
    return { success: true };
  };
  a.orderGet = async id => ({ success: true, value: srv.orders[id] ? JSON.parse(JSON.stringify(srv.orders[id])) : null });
  a.orderPaged = async () => ({ rows: Object.values(srv.orders).filter(o => o.status === 15) });
  reg.stockShort = async () => null;
  return reg;
}
const held = srv => Object.values(srv.orders).filter(o => o.status === 15).length;
async function crashDuringHold(srv, { lost = false, items = [item('1001', 3), item('1002', 2.5)] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airmax-hold110-'));
  const r1 = start(srv, dir); r1.subs = items.map(x => ({ ...x })); await r1.recalc(); r1.journalSnap('cart');
  if (lost) srv.lostBeforeSave = true; else srv.crashNext = true;
  r1.hold(); await new Promise(r => setTimeout(r, 50)); // Air Max is killed here (the hold never returns)
  const r2 = start(srv, dir); r2.recoveryPending = true; await r2.recover();
  return { r2, dir, notice: (r2.state().notice || {}).message || '' };
}
const ring = async (reg, items) => { reg.subs = items.map(x => ({ ...x })); await reg.recalc(); reg.journalSnap('cart'); };

(async () => {
  await t('crash after AIR POS saved the Hold: notice says it WAS held (Load Hold), cart not put back', async () => {
    const srv = airpos(); const { r2, notice } = await crashDuringHold(srv);
    assert.strictEqual(held(srv), 1);
    assert.match(notice, /already held/i, notice); assert.match(notice, /Load Hold/, notice);
    assert.strictEqual(r2.subs.length, 0, 'the held sale must not be put back on screen (it is in Load Hold)');
  });
  await t('crash after the Hold was saved, cashier presses Hold again on the sale on screen: still ONE parked order', async () => {
    const srv = airpos(); const { r2 } = await crashDuringHold(srv);
    if (!r2.subs.length) await ring(r2, [item('1001', 3), item('1002', 2.5)]); // nothing on screen: the cashier rings the same items again
    const x = await r2.hold(); assert.ok(x.ok, JSON.stringify(x));
    assert.strictEqual(held(srv), 1, 'AIR POS has ' + held(srv) + ' parked orders: ' + JSON.stringify(x));
  });
  await t('Stress Tester redo (seed 25091006): New sale, ring the same 2 items, Hold -> reported done once, ONE parked order', async () => {
    const srv = airpos(); const { r2 } = await crashDuringHold(srv);
    await r2.newSale(); await ring(r2, [item('1001', 3), item('1002', 2.5)]);
    const saves = srv.saves; const x = await r2.hold();
    assert.ok(x.ok && x.already, JSON.stringify(x)); assert.match(x.message, /already held/i); assert.match(x.message, /not held again/i);
    assert.strictEqual(srv.saves, saves, 'nothing sent'); assert.strictEqual(held(srv), 1);
    assert.strictEqual(r2.subs.length, 2, 'the cart stays (nothing lost) so the cashier can choose');
  });
  await t('...and pressing Hold again (a genuinely NEW identical sale) holds it: 2 parked orders', async () => {
    const srv = airpos(); const { r2 } = await crashDuringHold(srv);
    await r2.newSale(); await ring(r2, [item('1001', 3), item('1002', 2.5)]);
    await r2.hold(); const y = await r2.hold(); assert.ok(y.ok && !y.already, JSON.stringify(y)); assert.strictEqual(held(srv), 2);
  });
  await t('a DIFFERENT sale held after the recovery is held normally (no false "already held")', async () => {
    const srv = airpos(); const { r2 } = await crashDuringHold(srv);
    await r2.newSale(); await ring(r2, [item('1003', 9)]); const x = await r2.hold(); assert.ok(x.ok && !x.already, JSON.stringify(x)); assert.strictEqual(held(srv), 2);
  });
  await t('crash BEFORE AIR POS got the Hold: the sale comes back (as before), one Hold = one parked order', async () => {
    const srv = airpos(); const { r2, notice } = await crashDuringHold(srv, { lost: true });
    assert.strictEqual(held(srv), 0); assert.strictEqual(r2.subs.length, 2, notice); assert.match(notice, /Recovered the unfinished sale/);
    const x = await r2.hold(); assert.ok(x.ok && !x.already, JSON.stringify(x)); assert.strictEqual(held(srv), 1);
  });
  await t('AIR POS has the order Pending but with DIFFERENT items than the journal: not called held, cart put back (same id, a re-hold updates it)', async () => {
    const srv = airpos(); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airmax-hold110-'));
    const r1 = start(srv, dir); await ring(r1, [item('1001', 3)]); srv.crashNext = true; r1.hold(); await new Promise(r => setTimeout(r, 50));
    const id = Object.keys(srv.orders)[0]; srv.orders[id].subs[0].quantity = 5; // AIR POS's copy differs
    const r2 = start(srv, dir); r2.recoveryPending = true; await r2.recover();
    assert.strictEqual(r2.subs.length, 1); assert.strictEqual(r2.order.id, id);
    const x = await r2.hold(); assert.ok(x.ok, JSON.stringify(x)); assert.strictEqual(held(srv), 1, 'same order id updated, not a second one');
  });
  await t('a normal Hold (no crash) is unchanged: one save, cart cleared', async () => {
    const srv = airpos(); const reg = start(srv, fs.mkdtempSync(path.join(os.tmpdir(), 'airmax-hold110-')));
    await ring(reg, [item('1001', 3)]); const x = await reg.hold(); assert.ok(x.ok && !x.already); assert.strictEqual(srv.saves, 1); assert.strictEqual(reg.subs.length, 0);
  });
  console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

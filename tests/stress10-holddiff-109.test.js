// AirMax 1.0.9 (Stress Tester local.10 report, real fail #1 "Hold after a crash when AIR POS's copy differs", replay 8/8,
// suite seeds 50803007/015/023/031/039/047/055/063/071; Ari Nov 1 "if any problems, you fix it right away"):
// Air Max is killed while Hold is being saved, AFTER AIR POS saved it; AIR POS's copy is then edited (qty 3 on line 1).
// Before (ls10h matched only identical copies): restart said "Recovered the unfinished sale (2 lines); nothing was paid yet",
// the cashier pressed New sale, rang the 2 items again and held -> TWO held orders on AIR POS.
// Now (ls10d): the notice says it WAS held on AIR POS (copy differs), the cart is back unchanged (no lines lost), Hold on it
// updates the SAME order, and ringing the same items again after New sale is reported done once (not held twice).
// Offline: in-process Register + in-memory fake AIR POS (same as stress9-hold-110), temp data folder, nothing sent anywhere.
// Run: node tests/stress10-holddiff-109.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log('ok   ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const item = (id, price, quantity = 1) => ({ id: 's' + id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity, rate: 1, price, taxRate: 0, discount: 0, discountAmount: 0, type: 0, timestamp: 1 });
function airpos() { return { orders: {}, saves: [], crashNext: false }; }
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
    srv.saves.push({ id: s.id, isPending: !!s.isPending });
    const old = srv.orders[s.id]; srv.orders[s.id] = { id: s.id, number: old ? old.number : 'H' + (Object.keys(srv.orders).length + 1), status: s.isPending ? 15 : 10, subs: JSON.parse(JSON.stringify(s.subs)), receives: [] };
    if (srv.crashNext) { srv.crashNext = false; return new Promise(() => {}); } // AIR POS saved it; Air Max killed before the reply
    return { success: true };
  };
  a.orderGet = async id => ({ success: true, value: srv.orders[id] ? JSON.parse(JSON.stringify(srv.orders[id])) : null });
  a.orderPaged = async () => ({ rows: Object.values(srv.orders).filter(o => o.status === 15) });
  reg.stockShort = async () => null;
  return reg;
}
// the Stress Tester's oracle: distinct order ids saved as held
const heldIds = srv => new Set(srv.saves.filter(s => s.isPending).map(s => s.id)).size;
const ITEMS = () => [item('1001', 3), item('1002', 2.5)];
const ring = async (reg, items) => { reg.subs = items.map(x => ({ ...x })); await reg.recalc(); reg.journalSnap('cart'); };
async function crashHoldDiffer(srv, qty = 3) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airmax-holddiff-'));
  const r1 = start(srv, dir); await ring(r1, ITEMS());
  srv.crashNext = true; r1.hold(); await new Promise(r => setTimeout(r, 50)); // killed here
  const id = Object.keys(srv.orders)[0]; srv.orders[id].subs[0].quantity = qty; // AIR POS copy edited before the restart
  const r2 = start(srv, dir); r2.recoveryPending = true; await r2.recover();
  return { r2, id, notice: (r2.state().notice || {}).message || '' };
}
const SAID_DONE = /\b(WAS|was) (already )?(recorded|held|generated|saved)\b|already (been )?(recorded|held|generated|saved) on AIR POS/;

(async () => {
  for (const seed of [50803007, 50803015, 50803023, 50803031, 50803039, 50803047, 50803055, 50803063, 50803071]) {
    await t(`Stress Tester flow seed ${seed}: restart, New sale, redo only if not told it was done -> ONE held order`, async () => {
      const srv = airpos(); const { r2, notice } = await crashHoldDiffer(srv);
      await r2.newSale();
      if (!SAID_DONE.test(notice)) { await ring(r2, ITEMS()); await r2.hold(); }
      assert.strictEqual(heldIds(srv), 1, 'AIR POS has ' + heldIds(srv) + ' held orders; notice: ' + notice);
    });
  }
  await t('notice says it WAS held on AIR POS, copy differs, Load Hold / Hold updates; nothing paid', async () => {
    const srv = airpos(); const { notice } = await crashHoldDiffer(srv);
    assert.match(notice, SAID_DONE, notice); assert.match(notice, /different/i, notice); assert.match(notice, /Load Hold/, notice); assert.match(notice, /Nothing was paid/, notice);
  });
  await t('cart comes back exactly as Air Max had it (2 lines, qty 1 + 1, same order id, total unchanged)', async () => {
    const srv = airpos(); const { r2, id } = await crashHoldDiffer(srv);
    assert.strictEqual(r2.subs.length, 2); assert.deepStrictEqual(r2.subs.map(x => x.quantity), [1, 1]); assert.strictEqual(r2.order.id, id);
    assert.strictEqual(Math.round(r2.totals.due * 100), 550);
    assert.ok(!r2.pay, 'no payment invented');
  });
  await t('Hold on the recovered sale updates the SAME held order (one held order, sent once)', async () => {
    const srv = airpos(); const { r2, id } = await crashHoldDiffer(srv);
    const before = srv.saves.length; const x = await r2.hold(); assert.ok(x.ok && !x.already, JSON.stringify(x));
    assert.strictEqual(srv.saves.length, before + 1); assert.strictEqual(heldIds(srv), 1); assert.deepStrictEqual(srv.orders[id].subs.map(s => s.quantity), [1, 1]);
  });
  await t('New sale + ring the same items + Hold (a real cashier ignoring the notice): reported done once, nothing sent, cart kept', async () => {
    const srv = airpos(); const { r2 } = await crashHoldDiffer(srv);
    await r2.newSale(); await ring(r2, ITEMS()); const before = srv.saves.length; const x = await r2.hold();
    assert.ok(x.ok && x.already, JSON.stringify(x)); assert.strictEqual(srv.saves.length, before); assert.strictEqual(heldIds(srv), 1); assert.strictEqual(r2.subs.length, 2);
    const y = await r2.hold(); assert.ok(y.ok && !y.already, 'a second press holds a genuinely new sale'); assert.strictEqual(heldIds(srv), 2);
  });
  await t('a DIFFERENT sale after the recovery is held normally', async () => {
    const srv = airpos(); const { r2 } = await crashHoldDiffer(srv);
    await r2.newSale(); await ring(r2, [item('1003', 9)]); const x = await r2.hold(); assert.ok(x.ok && !x.already, JSON.stringify(x)); assert.strictEqual(heldIds(srv), 2);
  });
  await t('copy NOT changed (ls10h path) is unchanged: WAS held, cart not put back', async () => {
    const srv = airpos(); const { r2, notice } = await crashHoldDiffer(srv, 1);
    assert.match(notice, /WAS already held on AIR POS\. Open it with Load Hold/, notice); assert.strictEqual(r2.subs.length, 0);
  });
  console.log(`${n - bad}/${n} passed`); process.exit(bad ? 1 : 0);
})();

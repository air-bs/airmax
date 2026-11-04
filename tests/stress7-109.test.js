// AirMax 1.0.9-local.9 (Ari OK 9:24 PM ET Oct 31 "Fix everything, money ones too"): Stress Tester local.7 money / total fixes.
// Offline: in-process Register + fake AIR POS pricing, no account, nothing sent anywhere.
// (a) coupon / promo code AIR POS stops accepting after the cashier saw the total (seeds 10001011/090/115, 10001018):
//     the total goes up; the next payment must charge NOTHING and show the new total (before: the old amount was charged,
//     then "$5.40 left", forcing a second card / a refused second cash payment).
// (b) promo code AIR POS refuses (unknown code error) or cannot check: before, "applied — no change in price" / "applied"
//     and the sale got stuck with a stale total; now an honest message: refused -> code taken back off; not reachable ->
//     "could not check it yet", code kept and the total checked again before any payment.
// (c) $5 amount order discount, then an item removed / quantity lowered (seeds 4401025/026): total went below $0 and the
//     sale was stuck; now the discount is lowered to the items, total $0.00 at least.
// (d) Air Max closed while a pay-out was being recorded (seed 15001002): no word after restart, and a pay-in first cleared
//     the check, so the redo pay-out was recorded twice. Now: notice at login + the redo is reported done once (not sent).
// Run: node tests/stress7-109.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + e.message); } };
const r2 = x => Math.round(x * 100) / 100;
const TAX = 0.08;
function make(opts = {}) {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-stress7-')) });
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  const P = { promos: { SAVE5: 5 }, unknown: 'ignore', down: false };
  const calls = [];
  const real = reg.api;
  const tot = subs => (subs || []).reduce((x, y) => x + y.price * y.quantity, 0);
  const promotionGet = async s => {
    calls.push('promotionGet');
    if (P.down) return { success: false, message: 'Network error: ECONNREFUSED', unreachable: true };
    const code = s.promotionalCode; if (code && !(code in P.promos) && P.unknown === 'error') return { success: false, message: 'Invalid promotional code' };
    const am = tot(s.subs), off = code && P.promos[code] ? Math.min(P.promos[code], am) : 0, net = am - off;
    return { success: true, value: { subs: [], totalAmount: net, totalTax: r2(net * TAX), totalDiscountAmount: off, totalPromotionDiscountAmount: off, originalTotalAmount: am } };
  };
  // every other AIR POS call is recorded and refused: a test fails if anything is sent when it must not be
  reg.api = new Proxy(real, { get(o, k) {
    if (k === 'promotionGet') return promotionGet;
    if (k === 'authorizationCheck') return async () => ({ success: true, value: { needAuthorization: false } });
    const v = o[k]; if (typeof v !== 'function') return v;
    return async () => { calls.push(String(k)); return { success: false, message: 'offline test: not sent' }; };
  } });
  reg.stockShort = async () => null;
  return { reg, P, calls };
}
const item = (id, price, quantity = 1) => ({ id, itemId: 'i' + id, productId: 'p' + id, number: id, name: 'Toy ' + id, quantity, rate: 1, price, taxRate: 8, discount: 0, discountAmount: 0, type: 0, timestamp: 1 });
const sent = calls => calls.filter(c => c !== 'promotionGet');

(async () => {
  // ---------- (a) ----------
  for (const [label, tender] of [['cash, full amount', { type: 10, tendered: 20 }], ['card for the rest', { type: 20, amount: 5.4 }]]) {
    await t(`(a) coupon no longer accepted after Payment opened, ${label}: nothing charged, new total shown`, async () => {
      const { reg, P, calls } = make(); reg.subs = [item('A', 10)];
      assert.ok((await reg.setPromoCode('SAVE5')).ok); assert.strictEqual(reg.totals.due, 5.4);
      assert.ok((await reg.startPay()).ok); assert.strictEqual(reg.remaining(), 5.4);
      delete P.promos.SAVE5; calls.length = 0; // used up on another register
      const r = await reg.tender(tender);
      assert.strictEqual(r.ok, false, 'payment must be stopped: ' + JSON.stringify(r));
      assert.ok(r.totalChanged, 'flag totalChanged: ' + JSON.stringify(r));
      assert.deepStrictEqual(sent(calls), [], 'nothing sent to AIR POS / the card: ' + sent(calls).join(','));
      assert.strictEqual(reg.pay.tenders.length, 0, 'no payment taken');
      assert.match(r.message, /went up from \$5\.40 to \$10\.80/); assert.match(r.message, /SAVE5/); assert.match(r.message, /Nothing was charged/);
      assert.strictEqual(r.remaining, 10.8);
      // the cashier tells the customer and presses again: now it goes ahead (sent to AIR POS)
      calls.length = 0; const r2_ = await reg.tender(tender);
      assert.ok(!r2_.totalChanged, 'second press is not stopped again'); assert.ok(sent(calls).length > 0, 'second press goes ahead');
    });
  }
  await t('(a) total unchanged: payment goes ahead as before (no extra stop)', async () => {
    const { reg, calls } = make(); reg.subs = [item('A', 10)]; await reg.setPromoCode('SAVE5'); await reg.startPay(); calls.length = 0;
    const r = await reg.tender({ type: 10, tendered: 20 }); assert.ok(!r.totalChanged); assert.ok(sent(calls).length > 0);
  });
  await t('(a) total went DOWN: no stop', async () => {
    const { reg, P, calls } = make(); reg.subs = [item('A', 10)]; await reg.startPay(); P.promos.AUTO = 0; calls.length = 0;
    reg.order.promotionalCode = 'SAVE5'; const r = await reg.tender({ type: 10, tendered: 20 }); assert.ok(!r.totalChanged); assert.ok(sent(calls).length > 0);
  });
  // ---------- (b) ----------
  await t('(b) unknown code, AIR POS answers an error: "not applied", code taken off, total still good (before: "applied", stuck)', async () => {
    const { reg, P } = make(); reg.subs = [item('A', 10)]; await reg.recalc(); P.unknown = 'error';
    const r = await reg.setPromoCode('NOPE1');
    assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.match(r.message, /NOPE1 was not applied/); assert.match(r.message, /Invalid promotional code/);
    assert.strictEqual(reg.order.promotionalCode, null); assert.strictEqual(reg.totals.stale, false); assert.strictEqual(reg.totals.due, 10.8);
  });
  await t('(b) code applied while AIR POS cannot be reached: honest "could not check it yet", never "applied — no change in price"; checked at Payment', async () => {
    const { reg, P } = make(); reg.subs = [item('A', 10)]; await reg.recalc(); P.down = true;
    const r = await reg.setPromoCode('SAVE5');
    assert.strictEqual(r.ok, false, JSON.stringify(r)); assert.ok(r.promoUnchecked); assert.match(r.message, /could not check it yet/); assert.doesNotMatch(r.message, /applied|no change in price/);
    assert.strictEqual(reg.order.promotionalCode, 'SAVE5'); assert.strictEqual(reg.totals.stale, true);
    P.down = false; const st = await reg.startPay(); assert.ok(st.ok); assert.strictEqual(reg.totals.due, 5.4, 'checked when Payment opens');
  });
  await t('(b) code AIR POS ignores (no discount): says so plainly, not "applied"', async () => {
    const { reg } = make(); reg.subs = [item('A', 10)]; await reg.recalc();
    const r = await reg.setPromoCode('WHAT'); assert.ok(r.ok); assert.doesNotMatch(r.message, /applied/); assert.match(r.message, /gave no discount/);
  });
  await t('(b) good code still "applied ($5.40 off)"', async () => {
    const { reg } = make(); reg.subs = [item('A', 10)]; await reg.recalc();
    const r = await reg.setPromoCode('SAVE5'); assert.ok(r.ok); assert.match(r.message, /SAVE5 applied \(\$5\.40 off\)/);
  });
  await t('(b) code removed while AIR POS cannot be reached: removed, total marked to recheck', async () => {
    const { reg, P } = make(); reg.subs = [item('A', 10)]; await reg.setPromoCode('SAVE5'); P.down = true;
    const r = await reg.setPromoCode(''); assert.ok(r.ok); assert.strictEqual(reg.order.promotionalCode, null); assert.strictEqual(reg.totals.stale, true); assert.match(r.message, /checked again before any payment/);
  });
  // ---------- (c) ----------
  for (const [label, change] of [['remove an item', reg => reg.subs.splice(0, 1)], ['lower the quantity', reg => { reg.subs[0].quantity = 1; }]]) {
    await t(`(c) $5 order discount then ${label}: total not below $0, payment can start`, async () => {
      const { reg } = make(); reg.subs = label === 'remove an item' ? [item('A', 10), item('B', 1.5)] : [item('B', 1.5, 4)]; await reg.recalc();
      assert.ok((await reg.setOrderDiscount('amount', 5)).ok);
      change(reg); await reg.recalc();
      assert.ok(reg.totals.due >= 0, 'due ' + reg.totals.due); assert.strictEqual(reg.totals.due, 0);
      assert.strictEqual(reg.order.orderDiscountAmount, 1.5, 'discount lowered to the items, also what AIR POS is sent');
      const st = await reg.startPay(); assert.ok(st.ok, JSON.stringify(st));
    });
  }
  await t('(c) $5 order discount on $11.50 of items: unchanged ($6.50 + tax)', async () => {
    const { reg } = make(); reg.subs = [item('A', 10), item('B', 1.5)]; await reg.recalc(); await reg.setOrderDiscount('amount', 5);
    assert.strictEqual(reg.order.orderDiscountAmount, 5); assert.strictEqual(reg.totals.due, r2(6.5 + r2(r2(11.5 * TAX) * (6.5 / 11.5))));
  });
  // ---------- (c2) local.10 (Stress Tester S1, seeds 4493000-003 / 4494000-003): the ls9c cap must not lower the cashier's discount for good ----------
  for (const [label, down, up, subs] of [
    ['item removed then added back', reg => reg.subs.splice(0, 1), reg => reg.subs.unshift(item('A', 10)), () => [item('A', 10), item('B', 1.5)]],
    ['quantity 4 -> 1 -> 4', reg => { reg.subs[0].quantity = 1; }, reg => { reg.subs[0].quantity = 4; }, () => [item('B', 1.5, 4)]]]) {
    await t(`(c2) $5 order discount, ${label}: back to $5 off (not the lowered amount)`, async () => {
      const { reg } = make(); reg.subs = subs(); await reg.recalc(); assert.ok((await reg.setOrderDiscount('amount', 5)).ok);
      const before = reg.totals.due;
      down(reg); await reg.recalc(); assert.strictEqual(reg.totals.due, 0); assert.strictEqual(reg.order.orderDiscountAmount, 1.5, 'still lowered while the items are less than $5');
      up(reg); await reg.recalc();
      assert.strictEqual(reg.order.orderDiscountAmount, 5, 'the $5 the cashier entered is back (also what AIR POS is sent)');
      assert.strictEqual(reg.totals.due, before, 'due back to ' + before + ', got ' + reg.totals.due);
    });
  }
  await t('(c2) cart emptied: the order discount is cleared like before (not brought back on the next item)', async () => {
    const { reg } = make(); reg.subs = [item('A', 10)]; await reg.recalc(); await reg.setOrderDiscount('amount', 5);
    reg.subs = []; await reg.recalc(); reg.subs = [item('A', 10)]; await reg.recalc();
    assert.strictEqual(reg.order.orderDiscountAmount, 0); assert.strictEqual(reg.totals.due, r2(10 + r2(10 * TAX)));
  });
  // ---------- (d) ----------
  const cashReg = () => {
    const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-stress7d-')) });
    reg.settingsPath = null; reg.settings.hardware = 'airpos'; reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: true };
    reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] }; reg.mode = 'sale';
    const A = { tx: [], drawer: 150, getDown: false };
    reg.api = new Proxy(reg.api, { get(o, k) {
      if (k === 'retail') return async (p, b) => { if (/RetailCashTransactionGet$/.test(p)) { if (A.getDown) return { success: false, message: 'Network error', unreachable: true }; return A.tx.some(x => x.id === b.id) ? { id: b.id, type: 20 } : null; } return { success: false, message: 'offline' }; };
      if (k === 'latestBalanceGet') return async () => ({ success: true, value: A.drawer });
      if (k === 'cashTransactionAccess') return async x => { A.tx.push(x); A.drawer += x.type === 30 ? -x.amount : x.amount; return { success: true, value: {} }; };
      const v = o[k]; return typeof v === 'function' ? async () => ({ success: false, message: 'offline' }) : v;
    } });
    reg.openDrawerRaw = async () => ({ ok: true });
    return { reg, A };
  };
  await t('(d) Air Max closed while a $10 pay-out was recorded: next login says it WAS recorded; a pay-in first, then the redo pay-out is not recorded twice', async () => {
    const { reg, A } = cashReg();
    A.tx.push({ id: 'tx-crash', type: 30, amount: 10 }); reg.pendingWrite('cash', { id: 'tx-crash', kind: 'out', amount: 10, at: Date.now() }); // AIR POS had it, the app died before the reply
    await reg.recover();
    const nt = reg.currentNotice(); assert.ok(nt && /pay-out of \$10\.00 .*WAS recorded on AIR POS/.test(nt.message), 'notice after restart: ' + JSON.stringify(nt));
    const a = await reg.cashMove('in', 50, 'float'); assert.ok(a.ok, 'a different cash move still works: ' + JSON.stringify(a));
    const b = await reg.cashMove('out', 10, 'redo'); assert.strictEqual(b.ok, true, 'redo reported done, not sent: ' + JSON.stringify(b)); assert.ok(b.already && /not recorded again/.test(b.message));
    assert.strictEqual(A.tx.filter(x => x.type === 30).length, 1, 'one pay-out on AIR POS');
    const c = await reg.cashMove('out', 10, 'really new'); assert.ok(c.ok, 'pressed again = a new pay-out: ' + JSON.stringify(c));
    assert.strictEqual(A.tx.filter(x => x.type === 30).length, 2);
  });
  await t('(d) interrupted pay-out AIR POS never got: told nothing was recorded, redo records it once', async () => {
    const { reg, A } = cashReg(); reg.pendingWrite('cash', { id: 'tx-lost', kind: 'out', amount: 10, at: Date.now() });
    await reg.recover(); assert.match(reg.currentNotice().message, /no record of it: nothing was recorded/);
    assert.ok((await reg.cashMove('out', 10)).ok); assert.strictEqual(A.tx.length, 1);
  });
  await t('(d) interrupted pay-out, AIR POS cannot be reached at login: told not to redo yet, check kept', async () => {
    const { reg, A } = cashReg(); A.getDown = true; reg.pendingWrite('cash', { id: 'tx-x', kind: 'out', amount: 10, at: Date.now() });
    await reg.recover(); assert.match(reg.currentNotice().message, /cannot be reached to check it/); assert.ok(reg.pendingRead('cash'), 'check kept for later');
  });
  // (r) seed 18901000: refund reply was HTTP 500 and AIR POS has no record -> it said "The connection dropped"; now says AIR POS answered with an error.
  const retReg = (reply, st) => { const { reg } = make(); reg.ret = { id: 'ret-1', kind: 'nonorder', subs: [{ id: 's1', productId: 'p1', itemId: 'i1', quantity: 1, rate: 1, price: 10, taxRate: 0 }], payments: [{ paymentType: 10, amount: 10 }] };
    const base = reg.api; reg.api = new Proxy({}, { get: (o, k) => k === 'nonOrderReturnCreate' ? async () => reply : base[k] }); reg.returnRecorded = async () => st; return reg; };
  await t('(r) refund HTTP 500, not recorded: worded as an AIR POS error, not a dropped connection; still nothing refunded', async () => {
    const r = await retReg({ success: false, message: 'HTTP 500', uncertain: true }, 'no').confirmReturn();
    assert.strictEqual(r.ok, false); assert.doesNotMatch(r.message, /connection dropped/i); assert.match(r.message, /AIR POS answered with an error \(HTTP 500\) and AIR POS has no record of this refund, so nothing was refunded/);
  });
  await t('(r) refund reply lost (network): still says the connection dropped', async () => {
    const r = await retReg({ success: false, message: 'ECONNRESET', unreachable: true }, 'unknown').confirmReturn();
    assert.match(r.message, /^The connection dropped while the refund was being sent\. Do not hand out money yet/);
  });
  // (n) app name: user-facing messages in app/lib + server.js say "Air Max" (the store app stays "regular/store Air Register").
  await t('(n) no user-facing "Air Register" text left in messages (comments, store-app mentions and print-queue job names excluded)', async () => {
    const left = [];
    for (const f of [...fs.readdirSync(path.join(__dirname, '../app/lib')).filter(f => f.endsWith('.js') && f !== 'updater.js').map(f => 'lib/' + f), 'server.js'])
      fs.readFileSync(path.join(__dirname, '../app', f), 'utf8').split('\n').forEach((l, i) => { if (/^\s*\/\//.test(l)) return; const code = l.replace(/\/\/ [^'"`]*$/, '');
        if (/(?<!(store|regular) )Air Register(?! drawer'|'\))/.test(code) && !/doc \|\| 'Air Register'/.test(code)) left.push(f + ':' + (i + 1)); });
    assert.deepStrictEqual(left, []);
  });
  console.log(`${n - bad}/${n} passed`);
  fs.writeFileSync(path.join(__dirname, 'stress7-109-results.json'), JSON.stringify({ when: new Date().toISOString(), total: n, failed: bad, results: out }, null, 1));
  process.exit(bad ? 1 : 0);
})();

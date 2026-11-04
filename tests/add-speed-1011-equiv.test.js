// 1.0.11-speed.1 (Ari OK via parent 5:26 PM ET Nov 1 2026, local test build only): totals must come out EXACTLY as before.
// The same random cashier sessions (fast repeated scans, quantity changes, line/order discounts, promo code, removes, unknown codes,
// a look-up that cannot reach AIR POS) run twice: once the old way (every add waits for its total) and once the new way (the line
// shows at once, the total is checked in the background, every other step waits for it first, as server.js locked() does).
// The fake AIR POS answers each total check from the items AS SENT, with promotions, after a random delay (so answers come back
// out of order). Final totals, lines, discounts and every step's answer must be identical. Offline, made-up items, no network.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round(n * 100) / 100;
const ITEMS = { '0001': { price: 10, tax: 8 }, '0002': { price: 2.5, tax: 8 }, '0003': { price: 1.25, tax: 0 }, '0004': { price: 7.99, tax: 8.875 } };
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function mk(fast, seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-add1011eq-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  Object.assign(reg.settings, { receiptAutoPrint: 'never', drawerAutoOpen: 'never' }); reg.fastScan = fast;
  const api = reg.api, R = rng(seed * 7919 + 13), f = { calls: 0, scanOut: null };
  api.ide = 'x'; api.shop = 'MadeUpShopA'; reg.identity = { userName: 'u', corpName: 'MadeUpCo', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  let sid = 0;
  api.scan = async code => {
    await sleep(1 + Math.floor(R() * 4));
    if (code === 'NET') return { success: false, message: 'Network error: ECONNRESET', unreachable: true };
    const x = ITEMS[code]; if (!x) return { success: false, message: 'Item not found' };
    return { success: true, value: { id: 's' + (++sid), itemId: 'i' + code, productId: 'p' + code, number: code, name: 'Made-up ' + code, quantity: 1, rate: 1, price: x.price, taxRate: x.tax, discount: 0, discountAmount: 0 } };
  };
  // promotions: 3+ of 0002 -> 10% off those lines; code SAVE5 -> $5 off (only if items >= $5); line discounts sent by the register count
  api.promotionGet = async s => {
    const n = ++f.calls; const snap = s.subs.map(x => ({ id: x.id, num: x.number, q: x.quantity, p: x.price, t: x.taxRate || 0, d: x.discountAmount || 0 })); const code = s.promotionalCode;
    await sleep(Math.floor(R() * 40)); f.order = (f.order || []); f.order.push(n); // random: answers come back out of order in the new mode
    if (code && code !== 'SAVE5') return { success: false, message: 'Promotion code is not valid' };
    const q2 = snap.filter(x => x.num === '0002').reduce((a, x) => a + x.q, 0);
    let orig = 0, tot = 0, tax = 0, disc = 0, promo = 0; const subs = [];
    for (const x of snap) {
      const g = x.q * x.p; orig += g; const pd = (x.num === '0002' && q2 >= 3) ? r2(g * 0.1) : 0; const net = g - x.d - pd;
      promo += pd; disc += x.d + pd; tot += net; const tx = r2(net * x.t / 100); tax += tx;
      subs.push({ id: x.id, discountAmount: x.d, promotionDiscountAmount: pd, taxAmount: tx });
    }
    let codeOff = 0; if (code === 'SAVE5' && tot >= 5) { codeOff = 5; tot -= 5; disc += 5; promo += 5; }
    return { success: true, value: { subs, totalAmount: r2(tot), totalTax: r2(tax), totalDiscountAmount: r2(disc), totalPromotionDiscountAmount: r2(promo), originalTotalAmount: r2(orig), n } };
  };
  api.productPaged = async () => ({ success: true, rows: [], total: 0 });
  reg.mode = 'sale';
  return { reg, f };
}
function plan(seed, len) {
  const R = rng(seed), ops = [];
  for (let i = 0; i < len; i++) {
    const x = R();
    if (x < 0.55) ops.push(['scan', ['0001', '0002', '0002', '0003', '0004'][Math.floor(R() * 5)]]);
    else if (x < 0.60) ops.push(['scan', R() < 0.5 ? 'BAD9' : 'NET']);
    else if (x < 0.68) ops.push(['setQty', Math.floor(R() * 3), 1 + Math.floor(R() * 4)]);
    else if (x < 0.73) ops.push(['addQty', Math.floor(R() * 3), 1]);
    else if (x < 0.78) ops.push(['lineDiscount', Math.floor(R() * 3), R() < 0.5 ? 'percent' : 'amount', R() < 0.5 ? 10 : 1]);
    else if (x < 0.84) ops.push(['setOrderDiscount', ['percent', 'amount', 'clear'][Math.floor(R() * 3)], R() < 0.5 ? 5 : 3]);
    else if (x < 0.90) ops.push(['setPromoCode', ['SAVE5', '', 'NOPE'][Math.floor(R() * 3)]]);
    else if (x < 0.95) ops.push(['remove', Math.floor(R() * 3)]);
    else ops.push(['burst', Math.floor(R() * 4) + 2]);
  }
  return ops;
}
async function run(fast, seed, ops) {
  const { reg, f } = mk(fast, seed), log = [];
  const step = async (name, ...a) => { if (fast && name !== 'scan') await reg.settle(); /* server.js locked(): every route but scan waits for the total */ const r = await reg[name](...a); log.push(name + ':' + (r && r.ok) + ':' + ((r && r.message) || '')); };
  for (const [op, ...a] of ops) {
    if (op === 'burst') { for (let i = 0; i < a[0]; i++) await step('scan', '0002'); }
    else await step(op, ...a);
  }
  await reg.settle(); await sleep(60); // any late answer has come back (and must have been ignored)
  const t = reg.totals, o = reg.order;
  return { log, f, snap: JSON.stringify({
    totals: ['itemAmount', 'orderAmount', 'tax', 'discountAmount', 'discountRate', 'promotionDiscount', 'pointDiscount', 'due', 'quantity', 'stale'].map(k => [k, t[k]]),
    updating: !!t.updating,
    order: ['orderDiscountMethod', 'orderDiscount', 'orderDiscountAmount', 'orderDiscountEntered', 'promotionalCode'].map(k => [k, o[k]]),
    subs: reg.subs.map(s => [s.number, s.quantity, s.discount, s.discountAmount, s.discountMethod, !!s.isCustomDiscount]),
    promotionSubs: reg.promotionSubs }) };
}
(async () => {
  const N = Number(process.env.EQ_SESSIONS || 100); let same = 0, steps = 0, scans = 0, late = 0; const bad = [];
  for (let seed = 1; seed <= N; seed++) {
    const ops = plan(seed, 8 + (seed % 25));
    const a = await run(false, seed, ops), b = await run(true, seed, ops);
    steps += a.log.length; late += (b.f.order || []).filter((n, i, A) => A.slice(i + 1).some(m => m < n)).length; scans += a.log.filter(x => x.startsWith('scan:')).length;
    const okSnap = a.snap === b.snap, okLog = a.log.join('\n') === b.log.join('\n');
    if (okSnap && okLog) same++; else if (bad.length < 3) bad.push({ seed, ops, old: a.snap, new: b.snap, logDiff: a.log.map((x, i) => x === b.log[i] ? null : [i, x, b.log[i]]).filter(Boolean).slice(0, 3) });
  }
  rec(`E1 ${N} random sessions (${steps} steps, ${scans} scans incl. fast repeats, qty changes, line/order discounts, promo codes, removes, unknown and unreachable codes): final totals, lines, discounts identical old vs new`, same === N, `${same}/${N} identical; new way had ${late} total-check answers come back out of order (ignored as older)` + (bad.length ? ' first mismatch: ' + JSON.stringify(bad[0]).slice(0, 1500) : ''));
  // ---- look-up fails ----
  let { reg, f } = mk(true, 999); await reg.scan('0001'); await reg.settle(); const before = JSON.stringify(reg.totals);
  let r = await reg.scan('NET');
  rec('L1 item look-up cannot reach AIR POS: refused as "try again", no line added, no total check started, total unchanged and not stale', !r.ok && r.retryable === true && reg.subs.length === 1 && f.calls === 1 && JSON.stringify(reg.totals) === before && !reg.totals.stale && !reg.totals.updating, JSON.stringify({ msg: r.message, retry: r.retryable, rows: reg.subs.length, calls: f.calls }));
  r = await reg.scan('BAD9');
  rec('L2 unknown code: "Item not found", nothing changes', !r.ok && /not found/i.test(r.message) && reg.subs.length === 1 && JSON.stringify(reg.totals) === before, r.message);
  ({ reg, f } = mk(true, 998)); await reg.scan('0001'); const up1 = !!reg.totals.updating; r = await reg.scan('NET'); await reg.settle();
  rec('L3 look-up fails while the previous total is still out: that total still lands, correct and final (10 + 8% = 10.80)', up1 && !r.ok && reg.totals.due === 10.8 && !reg.totals.stale && !reg.totals.updating, JSON.stringify({ up1, due: reg.totals.due, stale: reg.totals.stale }));
  // ---- promotion check fails then works (old vs new end the same) ----
  for (const fast of [false, true]) {
    ({ reg, f } = mk(fast, 997)); const real = reg.api.promotionGet; let failN = 2; /* the add's check and Payment's own re-check both fail */ reg.api.promotionGet = async s => failN-- > 0 ? (await sleep(20), { success: false, message: 'Network error: ETIMEDOUT', unreachable: true }) : real(s);
    await reg.scan('0001'); await reg.settle(); const st1 = reg.totals.stale; const p1 = await reg.startPay();
    await reg.scan('0002'); await reg.settle();
    rec(`M${fast ? 2 : 1} ${fast ? 'new' : 'old'} way: total check fails -> marked stale, Payment re-checks, still failing -> refused, nothing charged; the next add's check works -> not stale, right total`, st1 === true && p1 && !p1.ok && !reg.pay && !reg.totals.stale && reg.totals.due === 13.5, JSON.stringify({ st1, pay: p1 && p1.message, due: reg.totals.due }));
  }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error('FAIL crash', e); process.exit(1); });

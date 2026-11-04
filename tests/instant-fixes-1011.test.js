// 1.0.11 fixes for the instant scan / receipt prefetch review (docs/REVIEW-instant-scan-prefetch.md; approved Nov 3 2026 8:58 AM ET).
// The repros of tests/review-instant-prefetch.test.js, run against THIS tree: every check must PASS.
//   F5  an error answer to the early receipt-template request: the receipt is still asked for WITH the store template
//   F1  a queued qty / Delete / F4 acts on the line the cashier chose (line id), not on whatever sits in that row later
//   F2  a restored "not confirmed" line is checked with AIR POS by itself after a restart: Pay and Hold work
//   F3  an instant line is in the crash journal as soon as it is added
// Offline: mocked AIR POS or the fake server, made-up data, no card, no store.   Run: node tests/instant-fixes-1011.test.js  (INSTANT_FIX_PORT, default 5263)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const rec = (k, ok, note) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const { Register } = require(ROOT + '/app/lib/register');
function mkReg(dir, more = {}) {
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; const api = reg.api; api.ide = 'x'; api.shop = 'shop';
  reg.identity = { userName: 'u', currency: 2, superAdmin: true, corpName: 'Made-up corp', shopName: 'Made-up shop' };
  reg.home = { terminalConfig: { checkoutAutoPrint: true, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => ({ success: true, value: { subs: [], totalAmount: s.subs.reduce((a, x) => a + x.price * x.quantity, 0), totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: 0 } });
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } }); api.orderSave = async () => ({ success: true });
  api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } }); api.orderGet = async () => ({ success: true, value: { status: 20, receives: [] } });
  reg.printPdfBase64 = async () => ({ ok: true }); reg.drawer = async () => ({ ok: true }); reg.mode = 'sale';
  Object.assign(api, more); return reg;
}
(async () => {
  // ================= F5: receipt prefetch, error answer before Complete
  const sale = async (early) => {
    let completed = false; const bills = [];
    const reg = mkReg(tmp('fx-rp-'), {
      complete: async () => { await sleep(150); completed = true; return { success: true }; },
      billTemplateConfigGet: async () => completed || !early ? { success: true, value: { templates: [{ id: 't1', name: 'Store receipt', fields: [{ name: 'Footer', content: 'Thank you' }] }], defaultTemplateId: 't1', orderPrintId: 'op1', orderSubs: [] } } : early(),
      billContentGet: async (id, extra) => { bills.push(extra ? extra.templateId : 'NO TEMPLATE'); return { success: true, value: { billBase64: 'JVBERi0x' } }; } });
    Object.assign(reg.settings, { receiptAutoPrint: 'always' });
    reg.subs = [{ id: 'a', itemId: 'i', productId: 'p', number: '1', name: 'Made-up', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
    await reg.recalc(); await reg.startPay(); const r = await reg.tender({ type: 10, amount: 10, tendered: 10 }); if (r && r.hwJob) await r.hwJob; await sleep(300);
    return { r, bills };
  };
  let x = await sale(null);
  rec('F5 baseline: a good early answer is used, one receipt with the store template', x.r.completed && x.bills.join() === 't1', x.bills.join());
  x = await sale(async () => ({ success: false, message: 'Order not completed' }));
  rec('F5 an ERROR answer to the early template request: the receipt is still asked for WITH the store template (asked again after Complete)', x.r.completed && x.bills.join() === 't1', x.bills.join());
  x = await sale(async () => { throw new Error('network blip'); });
  rec('F5 the early request fails (network blip): same, with the store template, one receipt', x.r.completed && x.bills.join() === 't1', x.bills.join());
  x = await sale(async () => ({ success: true, value: {} }));
  rec('F5 an empty answer (no template list): asked again after Complete', x.r.completed && x.bills.join() === 't1', x.bills.join());
  // ================= F1: rows shift under a queued qty / Delete / F4 (the real server + the fake AIR POS, 150 ms per call, instant scan ON)
  const PORT = Number(process.env.INSTANT_FIX_PORT || 5263), B = 'http://127.0.0.1:' + PORT, DD = tmp('fx-data-');
  const srv = spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { cwd: ROOT, env: { ...process.env, FAKE_PORT: String(PORT), FAKE_LATENCY_MS: '150', FAKE_HOOK_PORT: 'off', FAKE_DATA_DIR: DD }, stdio: 'ignore' });
  const post = (r, b) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(q => q.json());
  const st = () => fetch(B + '/api/state').then(q => q.json());
  try {
    for (let i = 0; i < 100; i++) { try { await st(); break; } catch { await sleep(100); } }
    await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' }); await post('instant-scan', { on: true });
    for (let i = 0; i < 60; i++) { const s = await st(); if (s.instant && s.instant.ready) break; await sleep(200); }
    // Gift bag (1004) confirmed, then Rope (1003) lands instantly; the cashier acts on Gift bag, and Bulk candy (1001) lands before the request runs
    const run = async (route, body) => {
      await post('new-sale'); await post('scan', { code: '1004' }); await sleep(1200);
      const rB = post('scan', { code: '1003' }); await sleep(20);
      const q = post(route, body); await sleep(20); await post('scan', { code: '1001' });
      const out = await q; await rB; await sleep(2500); return { cart: (await st()).cart, out };
    };
    let { cart: c } = await run('qty', { row: 1, qty: 5 });
    let gb = c.find(l => l.number === '1004');
    rec('F1 qty 5 sent for row 1 (Gift bag) goes to Gift bag even though instant scans land while it waits', gb && gb.quantity === 5 && c.filter(l => l.quantity === 5).length === 1, 'cart ' + c.map(l => l.number + 'x' + l.quantity).join(' '));
    ({ cart: c } = await run('remove', { row: 1 }));
    rec('F1b Delete on row 1 (Gift bag) removes Gift bag, not Rope or Bulk candy', !c.some(l => l.number === '1004') && c.some(l => l.number === '1003') && c.some(l => l.number === '1001'), 'left: ' + c.map(l => l.name).join(', '));
    ({ cart: c } = await run('line-discount', { row: 1, kind: 'percent', value: 50 }));
    gb = c.find(l => l.number === '1004'); const wrongDisc = c.filter(l => l.number !== '1004' && l.discountAmount > 0);
    rec('F1c F4 50% off on row 1 (Gift bag) goes on Gift bag only', gb && gb.discountAmount > 0 && !wrongDisc.length, 'discount on ' + c.filter(l => l.discountAmount > 0).map(l => l.name).join(', '));
    ({ cart: c } = await run('qty-plus', { row: 1 }));
    gb = c.find(l => l.number === '1004'); rec('F1d Qty + on row 1 (Gift bag) adds to Gift bag only', gb && gb.quantity === 2 && c.filter(l => l.quantity > 1).length === 1, 'cart ' + c.map(l => l.number + 'x' + l.quantity).join(' '));
    // the screen sends the id of the line it showed: a row that has moved on since does not matter (a dialog left open while scans land)
    await post('new-sale'); await post('scan', { code: '1004' }); await sleep(1200); await post('scan', { code: '1003' }); await sleep(1200);
    let s0 = await st(); const idGift = s0.lineIds[s0.cart.findIndex(l => l.number === '1004')];
    rec('F1e /api/state lists the line ids in screen order (lineIds)', s0.lineIds.length === s0.cart.length && new Set(s0.lineIds).size === s0.cart.length && !!idGift, s0.lineIds.length + ' ids for ' + s0.cart.length + ' lines');
    const qr = await post('qty', { row: 0, lineId: idGift, qty: 7 }); await sleep(1500); s0 = await st();
    rec('F1f a request with the line id acts on that line even when its row says another (row 0 = Rope, id = Gift bag)', qr.ok && s0.cart.find(l => l.number === '1004').quantity === 7 && s0.cart.find(l => l.number === '1003').quantity === 1, JSON.stringify(s0.cart.map(l => l.number + 'x' + l.quantity)));
    const before = JSON.stringify((await st()).cart), gone = await post('qty', { row: 0, lineId: 'no-such-line', qty: 9 }); await sleep(1000);
    rec('F1g a line that is no longer on the sale: refused with a message, nothing else changes', !gone.ok && gone.lineGone && JSON.stringify((await st()).cart) === before, gone.message);
    const rm = await post('remove', { row: 0, lineId: idGift }); await sleep(1500); s0 = await st();
    rec('F1h Delete with the line id removes that line only', rm.ok && !s0.cart.some(l => l.number === '1004') && s0.cart.some(l => l.number === '1003'), JSON.stringify(s0.cart.map(l => l.number)));
    //@@F2
  } finally { srv.kill(); }
  // ================= F2 / F3: crash journal and restored "not confirmed" lines (InstantScan on a mocked AIR POS)
  const { InstantScan } = require(ROOT + '/app/instantscan');
  const LIST = [{ n: '1003', u: '', name: 'Rope (ft)', price: 2, tax: 8, unit: '', id: 'i1003', pid: 'p1003', cat: '' }, { n: '1004', u: '', name: 'Gift bag', price: 1.5, tax: 0, unit: '', id: 'i1004', pid: 'p1004', cat: '' }];
  const mkIS = (reg, dir, enqueue) => { const is = new InstantScan({ reg, dataDir: dir, shopKey: () => 'k', enqueue: enqueue || (() => Promise.resolve()) }); is.on = true; is.setList({ at: new Date().toISOString(), shop: 'k', rows: LIST.map(e => ({ ...e })) }, 'test'); Object.defineProperty(reg.api, 'loggedIn', { get: () => true }); return is; };
  const ropeAnswer = () => ({ success: true, value: { itemId: 'i1003', productId: 'p1003', number: '1003', upc: '', name: 'Rope (ft)', price: 2, taxRate: 8, rate: 1, unitName: '', type: 0 } });
  // F3: the instant line is written to the crash journal by the add itself (no other route needed)
  let dir = tmp('fx-is-'), reg = mkReg(dir, { scan: () => new Promise(() => {}) }), is = mkIS(reg, dir);
  const before = reg.journal.read(); is.scanNow('1003'); const after = reg.journal.read();
  rec('F3 an instant line is in the crash journal the moment it is added (a crash right now loses nothing)', reg.subs.length === 1 && after && after.kind === 'sale' && (after.subs || []).length === 1 && (after.subs[0].number === '1003'), `journal lines before ${(before && before.subs || []).length}, after ${(after && after.subs || []).length}, on screen ${reg.subs.length}`);
  // F2: after a restart the restored line is "not confirmed" with no check coming
  const j = reg.journal.read(), reg2 = mkReg(dir, { scan: async () => ropeAnswer() }); reg2.subs = j.subs; // recovery.js: this.subs = j.subs
  const is2 = mkIS(reg2, dir, fn => fn());
  const p0 = await reg2.startPay();
  rec('F2 (baseline) the restored line is unconfirmed, so Pay is refused until it is checked', !p0.ok && p0.unconfirmed && reg2.subs[0]._unconfirmed === true, p0.message);
  rec('F2 rescue() sees the restored unchecked line and starts its check', is2.rescue() === true, '');
  rec('F2 a second rescue() while that check is queued / running does nothing (no pile-up)', (() => { is2.queued = true; const r = is2.rescue(); is2.queued = false; return r === false; })(), '');
  await sleep(300);
  rec('F2 AIR POS checked it by itself: the line is confirmed (price / tax from AIR POS), nothing pending', reg2.subs.length === 1 && !reg2.subs[0]._unconfirmed && is2.pending() === 0 && reg2.subs[0].taxRate === 8, JSON.stringify(reg2.subs.map(x => [x.number, !!x._unconfirmed])));
  const p1 = await reg2.startPay();
  rec('F2 Pay now works (no "still checking")', p1.ok !== false && !p1.unconfirmed, p1.message || 'ok');
  // Hold on a second restored line
  dir = tmp('fx-is-'); reg = mkReg(dir, { scan: () => new Promise(() => {}) }); is = mkIS(reg, dir); is.scanNow('1004');
  const reg3 = mkReg(dir, { scan: async () => ({ success: true, value: { itemId: 'i1004', productId: 'p1004', number: '1004', upc: '', name: 'Gift bag', price: 1.5, taxRate: 0, rate: 1, unitName: '', type: 0 } }) }); reg3.subs = reg.journal.read().subs;
  const is3 = mkIS(reg3, dir, fn => fn()); const h0 = await reg3.hold(); is3.rescue(); await sleep(300);
  rec('F2 Hold: refused while unchecked, and after the automatic check it is no longer refused for that reason', !h0.ok && h0.unconfirmed && !reg3.subs.some(x => x._unconfirmed), h0.message);
  // a line AIR POS does not know any more is taken off with a message (not left stuck)
  dir = tmp('fx-is-'); reg = mkReg(dir, { scan: () => new Promise(() => {}) }); is = mkIS(reg, dir); is.scanNow('1003');
  const reg4 = mkReg(dir, { scan: async () => ({ success: false, message: 'not a valid item' }) }); reg4.subs = reg.journal.read().subs; const is4 = mkIS(reg4, dir, fn => fn()); is4.rescue(); await sleep(300);
  rec('F2 a restored line AIR POS no longer knows is taken off the sale with a message, not left stuck', reg4.subs.length === 0 && is4.notes.length === 1, (is4.notes[0] || {}).message);
  // wiring in the server: timer + before Pay / Hold / Complete + at login
  const srcServer = fs.readFileSync(ROOT + '/app/server.js', 'utf8');
  rec('F2 server.js: instant.rescue() runs on a timer, at login and before Pay / tender / Complete / Hold', /setInterval\(\(\) => \{ try \{ instant\.rescue\(\)/.test(srcServer) && /RESCUE_FIRST\.has\(name\)\) instant\.rescue\(\)/.test(srcServer) && /instant\.onLogin\(\); instant\.rescue\(\)/.test(srcServer) && /RESCUE_FIRST = new Set\(\['pay-start', 'pay-tender', 'pay-cash', 'finish-sale', 'hold'\]\)/.test(srcServer), '');
  //@@MORE
  console.log(`instant-fixes-1011: ${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

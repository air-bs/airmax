// Air Register 1.2.0 unit tests (offline, no AIR POS account): cash drawer pulse / wait / auto-open, Tax Off,
// bulk items, short-stock notice. Run: node tests/v120.test.js
'use strict';
const assert = require('assert');
const pc = require('../app/lib/printcmd');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const hex = b => Buffer.from(b).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a Register with a fake AIR POS and a fake printer helper. hang = ms the helper takes to answer a raw job
function mk({ settings = {}, hang = 0, manager = true, term = {}, products = {} } = {}) {
  const reg = new Register({ log: () => {} });
  const sent = [], api = reg.api, calls = [];
  reg.settingsPath = null;
  Object.assign(reg.settings, { printerName: 'EPSON TM-T20II Receipt5', hardware: 'builtin', ...settings });
  reg.identity = { userName: 'u', currency: 2, superAdmin: manager };
  reg.home = { terminalConfig: term, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale';
  reg.hw = {
    present: true,
    printers: async () => ({ ok: true, value: { printers: ['EPSON TM-T20II Receipt5'], default: 'EPSON TM-T20II Receipt5', resolved: 'EPSON TM-T20II Receipt5', details: [{ name: 'EPSON TM-T20II Receipt5', driver: 'EPSON TM-T20II Receipt5', port: 'ESDPRT001' }] } }),
    request: async (cmd, a, ms) => { sent.push({ cmd, wait: a && a.waitMs, timeout: ms, bytes: a && a.base64 ? Buffer.from(a.base64, 'base64') : null }); if (hang) await sleep(hang); return { ok: true, value: { state: 'printed' } }; },
    network: async (buf, host, port, ms) => { sent.push({ cmd: 'network', timeout: ms, bytes: buf }); if (hang) await sleep(hang); return { ok: true }; },
    serial: async () => ({ ok: true }), status: () => ({}),
  };
  api.openCashbox = async () => { calls.push('airpos-drawer'); return { success: true }; };
  api.verify = async () => ({ success: true });
  api.promotionGet = async s => { const tot = (s.subs || []).reduce((a, x) => a + x.price * x.quantity - (x.discountAmount || 0), 0); const tax = (s.subs || []).reduce((a, x) => a + (x.price * x.quantity - (x.discountAmount || 0)) * (x.taxRate || 0) / 100, 0);
    return { success: true, value: { subs: [], totalAmount: tot, totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot } }; };
  let id = 0;
  api.scan = async code => { const p = products[code]; if (!p) return { success: false, message: 'Item not found' }; return { success: true, value: { id: 's' + (++id), itemId: 'i' + code, productId: 'p' + code, number: code, name: p.name, quantity: 1, rate: 1, price: p.price, taxRate: p.taxRate == null ? 8 : p.taxRate, discount: 0, discountAmount: 0 } }; };
  api.productPaged = async code => ({ success: true, rows: products[code] ? [{ id: 'i' + code, number: code, quantityStock: products[code].stock == null ? 99 : products[code].stock }] : [] });
  reg.sent = sent; reg.calls = calls; return reg;
}
const P = { '111': { name: 'Bulk candy', price: 10, taxRate: 8 }, '222': { name: 'Toy car', price: 5, taxRate: 8, stock: 0 }, '333': { name: 'Rope', price: 2, taxRate: 0 } };

(async () => {
  // ---------- item 11: standard pulse ----------
  await t('Drawer pulse default = Epson standard ESC p 0 25 250 (50 ms on / 500 ms off)', () => assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'epson' }))), '1b700019fa'));
  await t('Drawer pulse default on pin 5 / generic: ESC p 1 25 250', () => assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'generic', pin: 5 }))), '1b700119fa'));
  await t('Advanced pulse 100 / 200 / 250 ms -> ESC p t1 = 50 / 100 / 125, off stays 500 ms', () => {
    assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'epson', pulse: 100 }))), '1b700032fa');
    assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'epson', pulse: 200 }))), '1b700064fa');
    assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'epson', pulse: 250 }))), '1b70007dfa');
  });
  await t('Unusual pulse values are not sent (999, 0, "x" fall back to the 50 ms standard)', () => { for (const v of [999, 0, 'x', -5]) assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'epson', pulse: v }))), '1b700019fa'); });
  await t('Star default: plain BEL (printer\'s own standard pulse); longer pulse: ESC BEL n1 20 then BEL', () => {
    assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'star' }))), '07');
    assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'star', pulse: 50 }))), '07');
    assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'star', pulse: 200 }))), '1b07141407');
    assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'star', pin: 5, pulse: 200 }))), '1a');
  });
  await t('Settings: drawer pulse only accepts 50/100/200/250; saved pulse reaches the bytes sent', async () => {
    const r = mk(); r.savePrinterSettings({ drawerPulse: 999 }); assert.strictEqual(r.printerSettings().drawerPulse, 50);
    r.savePrinterSettings({ drawerPulse: '200' }); assert.strictEqual(r.printerSettings().drawerPulse, 200);
    const x = await r.openDrawerRaw(); assert.ok(x.ok, x.message); assert.strictEqual(hex(r.sent.find(s => s.bytes).bytes), '1b700064fa');
  });
  // ---------- item 11 + 10: wait setting and 5 s give-up ----------
  await t('Settings: drawer wait default 5 s, clamped to 1..30, junk ignored', () => {
    const r = mk(); assert.strictEqual(r.printerSettings().drawerWaitSec, 5); assert.strictEqual(r.drawerWaitMs(), 5000);
    r.savePrinterSettings({ drawerWaitSec: 0 }); assert.strictEqual(r.printerSettings().drawerWaitSec, 1);
    r.savePrinterSettings({ drawerWaitSec: 99 }); assert.strictEqual(r.printerSettings().drawerWaitSec, 30);
    r.savePrinterSettings({ drawerWaitSec: 'abc' }); assert.strictEqual(r.printerSettings().drawerWaitSec, 30);
    r.savePrinterSettings({ drawerWaitSec: '7' }); assert.strictEqual(r.drawerWaitMs(), 7000);
    assert.strictEqual(r.state().settings.drawerWaitSec, 7);
  });
  await t('Drawer wait goes to the helper (waitMs) instead of the old 8 s + 40 s', async () => {
    const r = mk({ settings: { drawerWaitSec: 3 } }); await r.openDrawerRaw(); const s = r.sent.find(x => x.cmd === 'raw');
    assert.strictEqual(s.wait, '3000'); assert.ok(s.timeout <= 3000 + 40000);
  });
  await t('Network printer: drawer kick socket timeout = drawer wait', async () => {
    const r = mk({ settings: { printerConn: 'network', printerHost: '10.0.0.9', drawerWaitSec: 4 } }); await r.openDrawerRaw(); assert.strictEqual(r.sent.find(x => x.cmd === 'network').timeout, 4000);
  });
  await t('Printer never answers: Open Drawer gives up after the 5 s default with a short message (not ~45 s)', async () => {
    const r = mk({ hang: 60000 }); const t0 = Date.now(); const x = await r.openDrawerRaw(); const ms = Date.now() - t0;
    assert.ok(!x.ok && x.hw === 'timeout', JSON.stringify(x)); assert.ok(ms >= 4900 && ms < 6000, 'took ' + ms + ' ms');
    assert.ok(/signal sent/i.test(x.message) && /5 s/.test(x.message), x.message); assert.ok(r.sent.some(s => s.cmd === 'raw'), 'kick was sent');
  });
  await t('Drawer wait 1 s setting: gives up after ~1 s', async () => {
    const r = mk({ hang: 60000, settings: { drawerWaitSec: 1 } }); const t0 = Date.now(); const x = await r.openDrawerRaw(); const ms = Date.now() - t0;
    assert.ok(x.hw === 'timeout' && ms < 1600 && ms >= 950, ms + ' ' + x.message);
  });
  await t('Cash sale auto drawer with a dead printer: sale result comes back within wait + 1.5 s, drawer note is non-blocking', async () => {
    const r = mk({ hang: 60000, settings: { drawerWaitSec: 2 } });
    const t0 = Date.now(); const d = await Promise.race([r.drawer(true), sleep(20000).then(() => 'late')]); const ms = Date.now() - t0;
    assert.notStrictEqual(d, 'late'); assert.ok(ms < 3600, ms + ' ms'); assert.strictEqual(d.hw, 'timeout');
  });
  await t('Drawer error names the printer and what to check', async () => {
    const r = mk(); r.hw.request = async () => ({ ok: false, error: 'printer is offline' }); r.settings.hardware = 'builtin';
    const x = await r.openDrawerRaw(); assert.ok(!x.ok); assert.ok(/EPSON TM-T20II/.test(x.message) && /cable/i.test(x.message) && /offline/.test(x.message), x.message);
  });
  // ---------- item 1: auto-open rules + done-screen button ----------
  await t('Auto-open default (1.2.0): opens on cash/check even when AIR POS terminal auto-open is off; not on card', () => {
    const r = mk({ term: { autoOpenCashDrawer: false } }); assert.strictEqual(r.drawerAutoMode(), 'cash'); assert.strictEqual(r.autoDrawer(true), true); assert.strictEqual(r.autoDrawer(false), false);
  });
  await t('Auto-open modes: every / off / airpos (follows AIR POS terminal), and 1.1 "every sale" setting migrates', () => {
    let r = mk({ settings: { drawerAutoOpen: 'every' } }); assert.ok(r.autoDrawer(false));
    r = mk({ settings: { drawerAutoOpen: 'off' } }); assert.ok(!r.autoDrawer(true));
    r = mk({ settings: { drawerAutoOpen: 'airpos' }, term: { autoOpenCashDrawer: false } }); assert.ok(!r.autoDrawer(true));
    r = mk({ settings: { drawerAutoOpen: 'airpos' }, term: { autoOpenCashDrawer: true } }); assert.ok(r.autoDrawer(true) && !r.autoDrawer(false));
    r = mk({ settings: { drawerOnlyForCash: false } }); assert.strictEqual(r.drawerAutoMode(), 'every');
    r = mk(); r.savePrinterSettings({ drawerAutoOpen: 'bogus' }); assert.strictEqual(r.drawerAutoMode(), 'cash');
  });
  await t('Done-screen Open Drawer: a cashier without the no-sale right can open it right after the sale (was refused)', async () => {
    const r = mk({ manager: false }); r.lastSaleAt = Date.now();
    const x = await r.drawerForSale(); assert.ok(x.ok, x.message);
    r.lastSaleAt = Date.now() - 11 * 60 * 1000; const y = await r.drawerForSale(); assert.ok(!y.ok, 'after 10 min it is a normal no-sale open');
    const z = await r.drawer(false); assert.ok(!z.ok && /not allowed/.test(z.message), z.message);
  });
  // ---------- item 3: Tax Off ----------
  await t('Tax Off (F5): all lines tax 0, new scans tax 0, turning it off restores each line\'s rate', async () => {
    const r = mk({ products: P }); await r.scan('111'); await r.scan('333');
    assert.ok(r.totals.tax > 0);
    let x = await r.setTaxExempt(); assert.ok(x.ok && x.taxExempt); assert.strictEqual(r.totals.tax, 0); assert.ok(r.state().order.taxExempt);
    await r.scan('222'); assert.strictEqual(r.subs.find(s => s.number === '222').taxRate, 0); assert.strictEqual(r.totals.tax, 0);
    const lt = await r.lineTax(0, 5); assert.ok(!lt.ok && /Tax Off/.test(lt.message));
    x = await r.setTaxExempt(false); assert.ok(x.ok && !x.taxExempt);
    assert.deepStrictEqual(r.subs.map(s => [s.number, s.taxRate]).sort(), [['111', 8], ['222', 8], ['333', 0]]);
    assert.ok(r.totals.tax > 0);
  });
  await t('Tax Off is saved with the order (each line taxRate 0) and cleared on a new sale', async () => {
    const r = mk({ products: P }); await r.scan('111'); await r.setTaxExempt(true);
    const sv = r.saveSubmit(true); assert.ok(sv.subs.every(s => s.taxRate === 0));
    r.resetOrder(); assert.ok(!r.order.taxExempt);
  });
  await t('Tax Off refused in return mode', async () => { const r = mk({ products: P }); r.mode = 'return'; const x = await r.setTaxExempt(true); assert.ok(!x.ok); });
  // ---------- item 4: bulk items ----------
  await t('Bulk items: saved and cleaned (max 12, label/code trimmed, control chars removed, needs a product)', async () => {
    const r = mk(); let x = r.saveSettings({ bulkItems: [{ label: ' Candy\x07 ', code: '111', name: 'Bulk candy', askPrice: 1 }, { label: '', code: '' }] });
    assert.ok(x.ok, x.message); assert.deepStrictEqual(r.settings.bulkItems, [{ label: 'Candy', code: '111', name: 'Bulk candy', askPrice: true }]);
    x = r.saveSettings({ bulkItems: [{ label: 'No product', code: '' }] }); assert.ok(!x.ok && /pick a product/.test(x.message));
    r.saveSettings({ bulkItems: Array.from({ length: 20 }, (_, i) => ({ label: 'B' + i, code: '111' })) }); assert.strictEqual(r.settings.bulkItems.length, 12);
    assert.strictEqual(mk().state().settings.bulkItems.length, 0, 'ships empty');
  });
  await t('Bulk item button adds the existing product (never creates one)', async () => {
    const r = mk({ products: P }); r.saveSettings({ bulkItems: [{ label: 'Candy', code: '111' }] });
    let created = false; r.api.productSave = async () => { created = true; };
    const x = await r.addBulk(0); assert.ok(x.ok, x.message); assert.strictEqual(r.subs[0].number, '111'); assert.ok(!created);
    const e = await r.addBulk(5); assert.ok(!e.ok && /empty/.test(e.message));
  });
  await t('Bulk item with price prompt: lower price = line discount, higher price refused and removed, no price asked again', async () => {
    const r = mk({ products: P }); r.saveSettings({ bulkItems: [{ label: 'Candy', code: '111', askPrice: true }] });
    let x = await r.addBulk(0); assert.ok(!x.ok && x.needPrice);
    x = await r.addBulk(0, 7.5); assert.ok(x.ok, x.message); assert.strictEqual(r.subs[0].discountAmount, 2.5); assert.strictEqual(r.totals.itemAmount - r.totals.discountAmount, 7.5);
    const r2 = mk({ products: P }); r2.saveSettings({ bulkItems: [{ label: 'Candy', code: '111', askPrice: true }] });
    x = await r2.addBulk(0, 12); assert.ok(!x.ok && /above the AIR POS price/.test(x.message)); assert.strictEqual(r2.subs.length, 0);
  });
  await t('Bulk price item already on the sale: refused, quantity put back (a typed price never merges silently)', async () => {
    const r = mk({ products: P }); r.saveSettings({ bulkItems: [{ label: 'Candy', code: '111', askPrice: true }] });
    await r.addBulk(0, 8); const x = await r.addBulk(0, 6);
    assert.ok(!x.ok && /already on this sale/.test(x.message), x.message); assert.strictEqual(r.subs.length, 1); assert.strictEqual(r.subs[0].quantity, 1); assert.strictEqual(r.subs[0].discountAmount, 2);
  });
  // ---------- item 9: short stock ----------
  const payStubs = r => { r.api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } }); r.api.orderSave = async () => ({ success: true });
    r.api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } }); r.api.orderGet = async () => ({ success: true, value: { status: 1 } }); };
  await t('Short / zero stock: payment starts (never blocked), notice is one short line', async () => {
    const r = mk({ products: P }); payStubs(r); r.settings.stockWarn = true; await r.scan('222'); // 1.0.10-local.2: the notice is for the warning ON (default OFF)
    const x = await r.startPay(); assert.ok(x.ok !== false, x.message); const w = r.state().pay.stockWarning;
    assert.ok(/Toy car \(0 in stock, selling 1\)/.test(w), w); assert.ok(w.length < 140, w.length + ' chars');
  });
  await t('AIR POS refusing to complete on stock: plain message, payment kept, Finish sale retry', async () => {
    const r = mk({ products: P }); payStubs(r); await r.scan('222'); await r.startPay();
    let n = 0; r.api.complete = async () => (++n === 1 ? { success: false, message: 'Insufficient inventory, inventory write-down failed' } : { success: true });
    const x = await r.tender({ type: 10, tendered: 10 });
    const why = (x.completed ? '' : (x.message || '')) + ' ' + ((r.pay && r.pay.lastError) || '');
    assert.ok(/AIR POS/.test(why) && /stock/i.test(why) && /Finish sale/.test(why), why);
    assert.ok(r.pay && r.paidTotal() > 0, 'payment kept');
    const y = await r.finishSale(); assert.ok(y.ok && y.completed, y.message);
  });
  // ---------- item 12: several gift cards in one sale ----------
  const giftApi = (r, cards = {}) => {
    r.api.giftCardGet = async n => { const c = cards[n]; return c ? { success: true, value: c } : { success: false, message: 'not found' }; };
    r.api.giftCardAdd = async s => { cards[s.cardNo] = { id: s.id, cardNo: s.cardNo, faceValue: s.faceValue, isSold: false }; return { success: true }; };
    return cards;
  };
  await t('Gift cards: 10 new cards with the same amount -> 10 lines, each its own number, one total', async () => {
    const r = mk(); giftApi(r);
    for (let i = 1; i <= 10; i++) { const x = await r.addGiftLine({ number: '60000000' + String(i).padStart(4, '0'), amount: 25 }); assert.ok(x.ok, x.message); assert.strictEqual(x.gift.count, i); assert.strictEqual(x.gift.masked, '**** ' + String(i).padStart(4, '0')); }
    assert.strictEqual(r.giftLines().length, 10); assert.strictEqual(new Set(r.subs.map(s => s.number)).size, 10);
    assert.ok(r.subs.every(s => s.type === 30 && s.quantity === 1 && s.price === 25)); assert.strictEqual(r.totals.itemAmount, 250);
  });
  await t('Gift cards: different amounts, a sold card becomes a reload line, unsold card keeps its preset value', async () => {
    const r = mk(); giftApi(r, { A1: { id: 'g1', cardNo: 'A1', isSold: true, balance: 5 }, B2: { id: 'g2', cardNo: 'B2', isSold: false, faceValue: 50 } });
    assert.ok((await r.addGiftLine({ number: 'NEW1', amount: 10 })).ok); const re = await r.addGiftLine({ number: 'A1', amount: 20 }); assert.ok(re.ok && re.gift.kind === 'reload');
    const pre = await r.addGiftLine({ number: 'B2' }); assert.ok(pre.ok && pre.gift.value === 50, JSON.stringify(pre));
    assert.deepStrictEqual(r.giftLines().map(s => s.type).sort(), [30, 30, 40]); assert.strictEqual(r.totals.itemAmount, 80);
  });
  await t('Gift cards: the same card twice in one sale is refused (also with different case / spaces / scanner CR)', async () => {
    const r = mk(); giftApi(r); assert.ok((await r.addGiftLine({ number: 'GC777', amount: 10 })).ok);
    for (const n of ['GC777', ' gc777 ', 'GC777\r']) { const x = await r.addGiftLine({ number: n, amount: 10 }); assert.ok(!x.ok && x.duplicate && /already on this sale/.test(x.message), n + ': ' + x.message); assert.ok(!x.message.includes('GC777'), 'number masked in message'); }
    assert.strictEqual(r.giftLines().length, 1);
  });
  await t('Gift cards: quantity stays 1 per card; max 50 cards; not in return mode', async () => {
    const r = mk(); giftApi(r); await r.addGiftLine({ number: 'Q1', amount: 5 });
    assert.ok(!(await r.setQty(0, 3)).ok);
    for (let i = 2; i <= 50; i++) await r.addGiftLine({ number: 'Q' + i, amount: 5 });
    const x = await r.addGiftLine({ number: 'Q51', amount: 5 }); assert.ok(!x.ok && /Up to 50/.test(x.message)); assert.strictEqual(r.giftLines().length, 50);
    const r2 = mk(); giftApi(r2); r2.mode = 'return'; assert.ok(!(await r2.addGiftLine({ number: 'Z1', amount: 5 })).ok);
  });
  await t('Gift cards: one checkout pays them all; sale result + saved gift list show masked numbers and amounts only', async () => {
    const dir = require('fs').mkdtempSync(require('os').tmpdir() + '/ar-gc-');
    const r = mk(); r.dataDir = dir; giftApi(r); payStubs(r); r.api.complete = async () => ({ success: true });
    await r.addGiftLine({ number: '6000111122223333', amount: 25 }); await r.addGiftLine({ number: '6000444455556666', amount: 40 });
    await r.startPay(); const x = await r.tender({ type: 10, tendered: 65 });
    assert.ok(x.completed, x.message); assert.deepStrictEqual(x.giftCards.map(c => c.masked + ' ' + c.value), ['**** 3333 25', '**** 6666 40']);
    const lines = r.giftSlipLines(x.orderId); assert.ok(lines && /GIFT CARDS \(2\)/.test(lines[0]) && lines.some(l => /\*\*\*\* 3333.*\$25\.00/.test(l)) && /Total value.*\$65\.00/.test(lines[lines.length - 1]), JSON.stringify(lines));
    const raw = require('fs').readFileSync(dir + '/gift-slips.json', 'utf8'); assert.ok(!raw.includes('6000111122223333') && !raw.includes('6000444455556666'), 'full numbers never stored');
  });
  await t('Gift cards: printing the receipt also prints the masked gift card list', async () => {
    const dir = require('fs').mkdtempSync(require('os').tmpdir() + '/ar-gc-');
    const r = mk(); r.dataDir = dir; r.saveGiftsFor('o1', [{ masked: '**** 1234', kind: 'sale', value: 25, pays: 25 }]);
    const slips = []; r.printOrderCore = async () => ({ ok: true, message: 'Receipt printed' }); r.printSlip = async (lines, label) => { slips.push(lines); return { ok: true, message: label }; };
    const x = await r.printOrder('o1'); assert.ok(x.ok && /gift card list printed/.test(x.message), x.message); assert.ok(slips[0].some(l => l.includes('**** 1234')));
  });
  // ---------- printer auto-pick / method / diagnostics ----------
  const { isReceipt } = require('../app/lib/printing');
  await t('Receipt printer detection: Epson TM / Star / POS-80 / M804 / Xprinter yes; office, PDF, XPS, Fax no', () => {
    for (const n of ['EPSON TM-T20II Receipt5', 'Star TSP100 Cutter (TSP143)', 'POS-80', 'POS80 Printer', 'M804', 'XP-80C', 'Receipt Printer', '80mm Series Printer', 'Generic / Text Only']) assert.ok(isReceipt(n, '', ''), n);
    for (const n of ['HP LaserJet Pro M404', 'Brother HL-L2350DW', 'Microsoft Print to PDF', 'Microsoft XPS Document Writer', 'Fax', 'OneNote (Desktop)', 'Canon TS3100 series']) assert.ok(!isReceipt(n, '', ''), n);
    assert.ok(isReceipt('Printer1', 'Some driver', 'ESDPRT001'), 'Epson port');
  });
  const prnFake = (r, details, resolved) => { r.hw.printers = async () => ({ ok: true, value: { printers: details.map(d => d.name), default: details[0].name, resolved, reason: 'automatic: test', details } }); };
  await t('Auto method: receipt printer -> direct ESC/POS; any other printer -> Windows driver (so anything prints)', async () => {
    const r = mk(); r.settings.printerName = ''; prnFake(r, [{ name: 'HP LaserJet', driver: 'HP Universal', port: 'USB001', receipt: false }], 'HP LaserJet');
    assert.strictEqual(await r.methodNow(), 'driver');
    const r2 = mk(); r2.settings.printerName = ''; prnFake(r2, [{ name: 'POS-80', driver: 'POS-80C', port: 'USB002', receipt: true }], 'POS-80');
    assert.strictEqual(await r2.methodNow(), 'raw');
    r2.settings.printMethod = 'driver'; assert.strictEqual(await r2.methodNow(), 'driver');
  });
  await t('Office printer: receipt goes through the driver (printPdf), never raw bytes', async () => {
    const r = mk(); r.settings.printerName = ''; prnFake(r, [{ name: 'HP LaserJet', driver: 'HP', port: 'USB001', receipt: false }], 'HP LaserJet');
    let pdf = 0; r.hw.printPdf = async () => { pdf++; return { ok: true, value: { printer: 'HP LaserJet' } }; };
    const x = await r.printPdfBase64(Buffer.from('%PDF').toString('base64'), 'Receipt printed'); assert.ok(x.ok, x.message); assert.strictEqual(pdf, 1); assert.ok(!r.sent.some(s => s.cmd === 'raw'));
  });
  await t('Raw refused by the driver -> automatic fallback to driver printing; offline -> no fallback, plain error', async () => {
    const r = mk(); r.settings.printerName = ''; prnFake(r, [{ name: 'POS-80', driver: 'x', port: 'USB001', receipt: true }], 'POS-80');
    r.renderFor = async () => ({ ok: true, mono: { width: 8, height: 1, data: Buffer.alloc(1) } });
    let pdf = 0; r.hw.printPdf = async () => { pdf++; return { ok: true, value: {} }; };
    r.hw.request = async () => ({ ok: false, error: "Printer 'POS-80' refused the job (Windows error 1804)" });
    let x = await r.printPdfBase64('JVBERg==', 'Receipt printed'); assert.ok(x.ok, x.message); assert.strictEqual(pdf, 1);
    r._driverOnly = null; // request P: after a driver fallback the next receipts go straight to the driver (receipt-driveronly.test.js); clear it to test the raw path again
    r.hw.request = async () => ({ ok: false, error: "Printer 'POS-80' is not printing: it is offline (turned off, unplugged). The job was cancelled." });
    x = await r.printPdfBase64('JVBERg==', 'Receipt printed'); assert.ok(!x.ok && /offline/.test(x.message), x.message); assert.strictEqual(pdf, 1);
  });
  await t('Diagnostics: log file of picks / prints / drawer + one text report (no passwords)', async () => {
    const dir = require('fs').mkdtempSync(require('os').tmpdir() + '/ar-dg-'); const home = process.env.HOME; process.env.HOME = dir;
    try {
      const r = mk(); r.dataDir = dir; r.settings.printerName = ''; r.hw.exe = 'C:/x/AirRegisterHw.exe';
      prnFake(r, [{ name: 'POS-80', driver: 'POS-80C', port: 'USB001', receipt: true, isDefault: true, status: 0, jobs: 0 }, { name: 'Microsoft Print to PDF', driver: 'x', port: 'PORTPROMPT:', virtual: true, status: 0, jobs: 0 }], 'POS-80');
      await r.openDrawerRaw();
      const x = await r.printerDiagnostics(); assert.ok(x.ok, x.message);
      for (const re of [/Picked: POS-80/, /RECEIPT/, /virtual/, /Recent printer/, /drawer/i]) assert.ok(re.test(x.text), re + ' missing in: ' + x.text.replace(/\r?\n/g, ' | '));
      assert.ok(!/password/i.test(x.text.replace(/no passwords/i, '')), 'no password field');
      assert.ok(require('fs').existsSync(x.file));
    } finally { process.env.HOME = home; }
  });
  await t('History date range: reads pages newest first and keeps only orders in the range', async () => {
    const r = mk(); const now = Date.now(), H = 3600e3; const all = Array.from({ length: 120 }, (_, i) => ({ id: 'o' + i, number: 'N' + i, status: 20, amount: 1, tax: 0, createTime: new Date(now - i * H).toISOString() }));
    let calls = 0; r.api.orderPaged = async (f, page, size) => { calls++; return { total: all.length, rows: all.slice((page - 1) * size, page * size) }; };
    const x = await r.orders({ from: new Date(now - 30.5 * H).toISOString(), to: new Date(now + H).toISOString() });
    assert.strictEqual(x.rows.length, 31); assert.ok(calls === 1, 'stopped after the page that passed the start: ' + calls);
  });
  require('fs').writeFileSync(__dirname + '/v120-results.json', JSON.stringify(out, null, 2));
  console.log(`\n${n - bad}/${n} 1.2.0 unit tests passed`); process.exit(bad ? 1 : 0);
})();

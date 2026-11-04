// 1.0.11-local.6g (Ari OK 6:06 PM ET Nov 1, test build): pick-items gift receipt. Offline: Register + Reprint with a mocked AIR POS
// api (every call logged) and a fake printer helper (bytes captured). Print only: no payment / order / return call may come from it.
// Run: node tests/gift-pick.test.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { Register } = require('../app/lib/register');
const { Reprint, giftSlipLines, GIFT_MSG } = require('../app/reprint');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const SUBS = [{ id: 's-a', name: 'Teddy bear', quantity: 1, price: 12.5, amount: 12.5 }, { id: 's-b', name: 'Board game', quantity: 2, price: 24.99, amount: 49.98 }, { id: 's-c', name: 'Gift wrap', quantity: 1, price: 3.25, amount: 3.25 }];
const MONEY = /orderSave|receiveBegin|receiveAccess|complete|return|refund|cashTransaction|giftCard(Add|Recharge)|memberCard|orderDelete|void|pending|hold/i;
function mk({ star = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'));
  const reg = new Register({ log: () => {} }); const api = reg.api, calls = [], bills = [], sent = [], pdfs = []; const rcv = [];
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, shopName: 'TestShop' }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} } };
  const T = { promotionGet: async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; },
    authorizationCheck: async () => ({ success: true, value: { needAuthorization: false } }),
    orderSave: async s => ({ success: true }), receiveBegin: async s => { rcv.push({ id: s.id, paymentType: s.paymentType, amount: s.amount, status: 20 }); return { success: true, value: { isCompleted: true } }; }, // mgc1011: AIR POS keeps the receive; the order read-back after payment shows it (status 20)
    complete: async () => ({ success: true }),
    billTemplateConfigGet: async () => ({ success: true, value: { templates: [{ id: 't-std', name: 'Standard', fields: [] }, { id: 't-gift', name: 'Gift Receipt', fields: [] }], defaultTemplateId: 't-std', orderPrintId: 'op', orderSubs: [] } }),
    billContentGet: async (id, extra) => { bills.push(extra ? extra.templateId : 'default'); return { success: true, value: { billBase64: 'eA==' } }; },
    orderGet: async id => ({ success: true, value: { id, number: 'RO0188', orderTime: '2026-11-01T18:30:00', status: 20, amount: 65.73, subs: SUBS.map(s => ({ ...s })), receives: rcv.length ? rcv.map(r => ({ ...r })) : [{ amount: 65.73 }] } }),
    printBillContent: async () => ({ success: true }) };
  for (const [k, f] of Object.entries(T)) api[k] = async (...a) => { calls.push(k); return f(...a); };
  for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(api))) if (typeof api[k] === 'function' && !(k in T) && k !== 'constructor' && MONEY.test(k)) api[k] = async () => { calls.push(k); return { success: true, value: {} }; };
  reg.printPdfBase64 = async (b, msg) => { pdfs.push(msg); return { ok: true, message: msg }; };
  reg.drawer = async () => ({ ok: true, message: 'drawer' }); reg.mode = 'sale';
  reg.settings = { ...(reg.settings || {}), hardware: 'builtin', printerName: star ? 'Star TSP143IIIBI' : 'EPSON TM-T20II Receipt5', printerConn: 'windows', autoPrint: 'never' };
  const prn = star ? [{ name: 'Star TSP143IIIBI', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' }] : [{ name: 'EPSON TM-T20II Receipt5', driver: 'EPSON TM-T20II Receipt5', port: 'ESDPRT001' }];
  reg.hw = { present: true, printers: async () => ({ ok: true, value: { printers: prn.map(p => p.name), default: prn[0].name, resolved: prn[0].name, details: prn } }),
    request: async (cmd, a) => { if (cmd === 'ports') return { ok: true, value: [] }; sent.push({ via: cmd, bytes: Buffer.from(a.base64, 'base64') }); return { ok: true, value: { printer: a.printer, state: 'printed' } }; },
    renderMono: async (b64, dots) => { sent.push({ via: 'render', pdf: Buffer.from(b64, 'base64') }); return { ok: true, value: { width: dots, height: 2, data: Buffer.alloc(dots / 4, 0xff).toString('base64') } }; },
    printPdf: async () => { sent.push({ via: 'driver' }); return { ok: true }; } };
  const rp = new Reprint({ dataDir: dir, reg, log: () => {}, shopKey: () => 'testshop' });
  return { reg, rp, calls, bills, sent, pdfs, gift: () => bills.filter(b => /gift/i.test(b)), money: () => calls.filter(c => MONEY.test(c)) };
}
const slipText = t => t.sent.filter(s => s.bytes).map(s => s.bytes.toString('latin1')).join('\n');
const noPrice = txt => !/\$|\d+\.\d\d|12\.5|24\.99|49\.98|3\.25|65\.73|TOTAL|SUBTOTAL|TAX|CHANGE|PAID|CASH/i.test(txt);
function cart(reg) { reg.subs = SUBS.map((s, i) => ({ id: s.id, itemId: 'i' + i, productId: 'p' + i, name: s.name, quantity: s.quantity, rate: 1, price: s.price, discount: 0, discountAmount: 0, timestamp: 10 - i })); }
async function sell(t, { gift, exclude } = {}) {
  cart(t.reg); await t.reg.recalc(); if (gift) { t.reg.setGiftReceipt(true); t.rp.setPick(exclude); }
  await t.reg.startPay(); const r = await t.reg.tender({ type: 10, tendered: 100 });
  if (r && r.hwJob) for (const [k, v] of await r.hwJob) if (k === 'gift') r.giftReceipt = v;
  return r;
}
(async () => {
  // --- reprint (Ctrl+Alt+P / History): the picker list
  let t = mk(); const it = await t.rp.giftItems('ord-1');
  rec('Picker list = every line of the sale (the screen ticks them all), names and quantities only, no prices sent to the screen', it.ok && it.items.length === 3 && it.items.every(i => Object.keys(i).sort().join() === 'id,name,quantity') && it.number === 'RO0188', JSON.stringify(it.items));
  rec('Picker list reads the order only (RetailOrderGet), nothing printed', t.calls.join() === 'orderGet' && !t.sent.length && !t.bills.length, t.calls.join());
  const ui = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
  rec('Picker screen: every checkbox starts ticked; buttons Print (Enter) and Cancel (Esc)', /class="gp-cb"[^`]*\bchecked\b/.test(ui) && /okText = 'Print \(Enter\)'/.test(ui) && />Cancel \(Esc\)</.test(ui), 'app.js giftPicker');
  // --- untick one, print: only the ticked items, no prices anywhere
  t = mk(); const r1 = await t.rp.giftPick('ord-1', ['s-a', 's-c']); const tx1 = slipText(t);
  rec('Untick Board game, Print: slip printed with Teddy bear + Gift wrap only', r1.ok && r1.slip && r1.picked === 2 && /Teddy bear/.test(tx1) && /Gift wrap/.test(tx1) && !/Board game/.test(tx1), r1.message);
  rec('Slip has the store header, GIFT RECEIPT, order number, date, quantities and the gift message', /TestShop/.test(tx1) && /GIFT RECEIPT/.test(tx1) && /Order RO0188/.test(tx1) && /11\/01\/2026/.test(tx1) && /QTY/.test(tx1) && tx1.includes(GIFT_MSG), tx1.replace(/[^\x20-\x7e\n]/g, '').split('\n').filter(Boolean).join(' | ').slice(0, 300));
  rec('No price, total, tax or payment anywhere on the slip', noPrice(tx1.replace(/[^\x20-\x7e\n]/g, ' ')), 'checked for $, 0.00 style amounts, TOTAL/TAX/PAID/CASH/CHANGE');
  rec('Subset print: no AIR POS template call, no payment / order / return call', !t.bills.length && t.money().length === 0 && t.calls.join() === 'orderGet', t.calls.join());
  // --- Star TSP100: the same lines as a picture
  t = mk({ star: true }); const rs = await t.rp.giftPick('ord-1', ['s-b']); const rend = t.sent.find(s => s.via === 'render');
  const pdfTxt = rend ? rend.pdf.toString('latin1') : '';
  rec('Star printer: slip sent as a picture (raster), through the same local Star path as test pages', rs.ok && !!rend && t.sent.some(s => s.bytes && s.bytes.length > 50), rs.message);
  rec('Star slip PDF holds the ticked item and no price', /Board game/.test(pdfTxt) && !/Teddy bear|Gift wrap/.test(pdfTxt) && !/\$|24\.99|49\.98/.test(pdfTxt), 'pdf ' + pdfTxt.length + ' bytes');
  // --- all ticked: the old path, unchanged
  t = mk(); const r2 = await t.rp.giftPick('ord-1', ['s-a', 's-b', 's-c']); const t0 = mk(); const r0 = await t0.rp.gift('ord-1');
  rec('All ticked = the store\'s AIR POS gift template, same as before (same template, same message, no slip)', r2.ok && t.gift().join() === 't-gift' && !t.sent.length && r2.message === r0.message && t0.gift().join() === 't-gift', `${r2.message} | before: ${r0.message}`);
  rec('Nothing ticked: refused, nothing printed', !(await mk().rp.giftPick('ord-1', [])).ok, 'Tick at least one item');
  // --- Cancel: the screen sends nothing; server side nothing is pending
  t = mk(); await t.rp.giftItems('ord-1');
  rec('Cancel after the list: nothing printed (no slip, no template)', !t.sent.length && !t.bills.length && !t.pdfs.length, 'calls ' + t.calls.join());
  rec('Cancel (Esc) in the screen resolves without any print request', /\$\('gpCancel'\)\.onclick = \(\) => \{ closeModal\(\); finish\(null\); \}/.test(ui) && /if \(!pick\) return; \/\/ Cancel: nothing printed/.test(ui), 'app.js giftPickOrder');
  // --- F10 at the sale: unticked lines left off the slip printed after Complete
  const base = mk(); const rb = await sell(base, { gift: true, exclude: [] });
  rec('F10, all ticked: after the sale the AIR POS gift template prints exactly as before', rb.ok && base.gift().join() === 't-gift' && !base.sent.length, rb.giftReceipt && rb.giftReceipt.message);
  t = mk(); const rf = await sell(t, { gift: true, exclude: ['s-b'] }); const txf = slipText(t);
  rec('F10, Board game unticked: after the sale a no-price slip prints with the other 2 items', rf.ok && rf.giftReceipt && rf.giftReceipt.slip && rf.giftReceipt.picked === 2 && !/Board game/.test(txf) && /Teddy bear/.test(txf) && noPrice(txf.replace(/[^\x20-\x7e\n]/g, ' ')) && !t.gift().length, rf.giftReceipt && rf.giftReceipt.message);
  rec('F10 picker changes no money: same API calls, same total and change as the all-ticked sale (only the read-only order look-up added after)', JSON.stringify(t.calls.filter(c => c !== 'orderGet' && c !== 'billTemplateConfigGet' && c !== 'billContentGet')) === JSON.stringify(base.calls.filter(c => c !== 'orderGet' && c !== 'billTemplateConfigGet' && c !== 'billContentGet')) && rf.due === rb.due && rf.change === rb.change && t.calls.filter(c => c === 'orderGet').length === 3 /* airmax-fix-stock: + the read-only AIR POS total look-up before the payment is taken; mgc1011: + the read-only read-back after the payment */ && base.calls.filter(c => c === 'orderGet').length === 2, t.calls.join(' '));
  rec('The pick is for that sale only: the next sale is unmarked and has no pick', t.reg.state().giftReceipt === false && !t.rp.pick, 'state.giftReceipt=' + t.reg.state().giftReceipt);
  const u = mk(); cart(u.reg); u.reg.setGiftReceipt(true); u.rp.setPick(['s-a']); const old = u.reg.order.id; u.reg.resetOrder(); u.reg.setGiftReceipt(true);
  rec('A pick from a voided sale is never used for a new sale (all lines print the old way)', u.rp.pickNow() === null && old !== u.reg.order.id, 'pickNow null');
  // --- no payment / order / return call from any of it
  const all = mk(); await all.rp.giftItems('o'); await all.rp.giftPick('o', ['s-a']); await all.rp.giftPick('o', ['s-a', 's-b', 's-c']); all.rp.cartItems();
  rec('Picker + slip + all-ticked path: zero payment, order-save, complete or return calls', all.money().length === 0, all.calls.join(' '));
  // --- shortcuts and buttons unchanged
  const git = a => cp.execFileSync('git', a, { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const sc0 = git(['show', 'base-1011-repaired:app/shortcuts.json']), sc1 = fs.readFileSync(path.join(__dirname, '..', 'app', 'shortcuts.json'), 'utf8');
  const keys = JSON.parse(sc1).keys, act = k => keys.filter(x => x.key === k).map(x => x.action).join();
  const kk = t => JSON.parse(t).keys.map(x => x.key + '|' + x.action + '|' + x.label);
  const has1 = new Set(kk(sc1)), lost = kk(sc0).filter(x => !has1.has(x)); // 1.0.11: later branches (Print Labels) may ADD keys; none may be removed or changed
  rec('every 1.0.10 shortcut still there unchanged (F10 = gift-receipt, Ctrl+Alt+P = reprint-gift, Ctrl+P = reprint)', lost.length === 0, `F10 ${act('F10')} | Ctrl+Alt+P ${act('Ctrl+Alt+P')} | Ctrl+P ${act('Ctrl+P')}${lost.length ? ' | LOST ' + lost.join('; ') : ''}`);
  const removedAll = git(['diff', '-U0', 'base-1011-repaired', '--', 'app/public']).split('\n').filter(l => /^-[^-]/.test(l)), removed = removedAll.filter(l => /gift/i.test(l)); // lines of other later branches (labels, speed) are not this test's business; their own tests cover them
  rec('No button or key label removed from the screens (only the 2 gift functions\' bodies replaced)', removed.length <= 7 /* mgc1011: +3 lines whose gift-card MESSAGE text got an added hint (giftCapMsg, 2 lines of the Check-card handler); no label or key touched, checked by the 2nd condition */ && removedAll.every(l => !/\['[^']+', '(Ctrl|F\d|Alt|Shift)/.test(l)), removed.length + ' lines replaced');
  rec('Regular receipt / Reprint Receipt (Ctrl+P) code untouched', !/printOrder|reprintLast/.test(removed.join('\n')) && /async function reprintLast\(\) \{\n  if \(S\.lastOrderId\) return printOrder\(S\.lastOrderId(, null, r => \{ receiptPanel\(S\.lastOrderId, [^\n]*)?\);/.test(ui) /* #17: the same printOrder call, plus the Last receipt panel opened afterwards */, 'reprintLast unchanged');
  rec('Slip builder never adds a price even if given one', noPrice(giftSlipLines({ shop: 'S', number: 'RO1', items: [{ name: 'X', quantity: 1, price: 9.99, amount: 9.99 }] }).join('\n')), 'giftSlipLines');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} gift pick tests passed`);
  fs.writeFileSync(path.join(__dirname, 'gift-pick-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

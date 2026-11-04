// Work copy (NOT released). Offline, mocked AIR POS, made-up data only (test card numbers are public Luhn test numbers).
// O: gift card slip prints each card's balance AFTER the sale (sold / reloaded AND used to pay), read from AIR POS after Complete.
// N: Manual Credit = AIR POS Online Payment (30): Sola channel sends the typed card once inside ReceiveBegin; never stored / logged.
// AR-16: stock gate before any card / gift card is charged. P: a second print of the same sale while printing = "Already printing".
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TEST_CARD = '4242424242424242';
function mk(opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-onp-'));
  const logs = [];
  const reg = new Register({ log: m => logs.push(String(m)), dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.settings.stockWarn = opt.stockWarn !== false; // 1.0.10-local.2: AR-16 checks below = Settings "Warn before selling below zero stock" ON (default is OFF, tests/stockwarn.test.js)
  const api = reg.api, calls = [], begins = [], cards = opt.cards || {};
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: !!opt.autoPrint, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async s => { begins.push(JSON.parse(JSON.stringify(s))); if (s.paymentType === 40) for (const id of s.retailGiftCards) { const c = Object.values(cards).find(k => k.id === id); if (c) c.balance = Math.round((c.balance - s.amount) * 100) / 100; } return { success: true, value: { isCompleted: true } }; };
  api.complete = async () => { calls.push('complete'); for (const s of reg.subs) { const c = cards[s.number]; if (c && (s.type === 30 || s.type === 40)) c.balance += s.price; } if (opt.refuse) return { success: false, message: 'Insufficient inventory, inventory write-down failed' }; return { success: true }; };
  api.giftCardGet = async n => { calls.push('giftGet:' + String(n).slice(-4)); const c = cards[n]; return c ? { success: true, value: { ...c } } : { success: false, message: 'not found' }; };
  api.productPaged = async q => { const rows = (opt.stockRows || []).filter(x => x.number === q); return { success: true, rows, total: rows.length }; };
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' });
  reg.mode = 'sale';
  reg.subs = opt.subs || [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, calls, begins, cards, dir, logs };
}
const grepDir = (dir, s) => fs.readdirSync(dir, { recursive: true }).some(f => { const p = path.join(dir, String(f)); try { return fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').includes(s); } catch { return false; } });
(async () => {
  // ---- O: customer PAYS with a gift card ----
  let t = mk({ cards: { '7000000000008888': { id: 'gc-pay8', cardNo: '7000000000008888', balance: 30 } } });
  await t.reg.recalc(); await t.reg.startPay();
  let r = await t.reg.tender({ type: 40, amount: 10, giftCards: [{ id: 'gc-pay8', number: '7000000000008888', balance: 30 }] });
  if (r.hwJob) await r.hwJob; await sleep(50);
  let g = t.reg.giftsAll()[r.orderId] || {};
  rec('O: paying with a gift card completes the sale', r.ok && r.completed, JSON.stringify({ ok: r.ok, completed: r.completed, m: r.message }));
  rec('O: balance read from AIR POS AFTER Complete', t.calls.indexOf('complete') >= 0 && t.calls.indexOf('giftGet:8888') > t.calls.indexOf('complete'), t.calls.join(','));
  rec('O: used card saved masked with balance left $20.00', g.used && g.used.length === 1 && g.used[0].masked === '**** 8888' && g.used[0].balance === 20 && g.used[0].used === 10, JSON.stringify(g.used));
  let lines = t.reg.giftSlipLines(r.orderId) || [];
  rec('O: slip prints "GIFT CARDS USED", paid $10.00 and "Balance left $20.00"', lines.join('\n').includes('GIFT CARDS USED (1)') && /\*\*\*\* 8888 paid\s+\$10\.00/.test(lines.join('\n')) && /Balance left\s+\$20\.00/.test(lines.join('\n')), JSON.stringify(lines));
  rec('O: full gift card number never written to disk', !grepDir(t.dir, '7000000000008888'), 'data dir scanned');
  // ---- O: gift card SOLD ----
  t = mk({ cards: { '7000000000005555': { id: 'gc-new', cardNo: '7000000000005555', balance: 0 } },
    subs: [{ id: 'g1', itemId: 'gi', productId: null, number: '7000000000005555', name: 'Gift Card **** 5555', type: 30, quantity: 1, rate: 1, price: 25, oriPrice: 25, discount: 0, discountAmount: 0, timestamp: 1 }] });
  await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 10, tendered: 25 }); if (r.hwJob) await r.hwJob; await sleep(50);
  g = t.reg.giftsAll()[r.orderId] || {}; lines = t.reg.giftSlipLines(r.orderId) || [];
  rec('O: sold card: slip shows its balance now $25.00 (from AIR POS)', g.cards && g.cards[0] && g.cards[0].balance === 25 && /Balance now\s+\$25\.00/.test(lines.join('\n')), JSON.stringify({ cards: g.cards, lines }));
  // ---- O: look-up fails -> no guess ----
  t = mk({ cards: {} }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 40, amount: 10, giftCards: [{ id: 'gc-x', number: '7000000000001111', balance: 30 }] }); if (r.hwJob) await r.hwJob; await sleep(50);
  lines = t.reg.giftSlipLines(r.orderId) || [];
  rec('O: AIR POS look-up fails -> "check at counter", never a made-up balance', /Balance left\s+check at counter/.test(lines.join('\n')), JSON.stringify(lines));
  // ---- O: auto print on -> the slip is printed with the balance (printOrder runs after the look-up) ----
  t = mk({ autoPrint: true, cards: { '7000000000008888': { id: 'gc-pay8', cardNo: '7000000000008888', balance: 12 } } });
  let seenAtPrint = null; t.reg.printOrder = async id => { seenAtPrint = t.reg.giftSlipLines(id); return { ok: true, message: 'Receipt sent' }; };
  await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 40, amount: 10, giftCards: [{ id: 'gc-pay8', number: '7000000000008888', balance: 12 }] }); if (r.hwJob) await r.hwJob;
  rec('O: auto print: balance is already known when the receipt prints', seenAtPrint && /Balance left\s+\$2\.00/.test(seenAtPrint.join('\n')), JSON.stringify(seenAtPrint));

  // ---- N: Manual Credit on a Sola store = AIR POS Online Payment with the typed card ----
  t = mk(); t.reg.keyedCh = { channelType: 20, key: '' };
  rec('N (1.2.3): the Sola card form is OFF by default (Sola store gets the 1.2.1 "only Stripe" message, nothing typed)', !t.reg.keyedInfo().enabled && /only supports Stripe/.test(t.reg.keyedInfo().note), JSON.stringify(t.reg.keyedInfo()));
  t.reg.solaKeyedOn = true; // the rest checks the switched-off code path still works for a later release
  rec('N: Sola channel -> Manual Credit enabled (kind sola)', t.reg.keyedInfo().enabled && t.reg.keyedInfo().kind === 'sola', JSON.stringify(t.reg.keyedInfo()));
  await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, card: { cardNo: '4242 4242 4242 4241', expiration: '12/40', cvv: '123' } });
  rec('N: bad card number refused before anything is sent', !r.ok && /not valid/.test(r.message) && t.begins.length === 0, r.message);
  r = await t.reg.tender({ type: 30, amount: 10, card: { cardNo: TEST_CARD, expiration: '13/40', cvv: '123' } });
  rec('N: bad expiry refused (MM/YY, like AIR POS)', !r.ok && /MM\/YY/.test(r.message) && t.begins.length === 0, r.message);
  const body = { type: 30, amount: 10, card: { cardNo: '4242 4242 4242 4242', expiration: '12/40', cvv: '123' } };
  r = await t.reg.tender(body);
  const b0 = t.begins[0] || {};
  rec('N: ReceiveBegin paymentType 30 (Online Payment) with the card in creditCard', r.ok && b0.paymentType === 30 && b0.creditCard && b0.creditCard.cardNo === TEST_CARD && b0.creditCard.expiration === '12/40' && b0.creditCard.cvv === '123', JSON.stringify({ ok: r.ok, pt: b0.paymentType, last4: b0.creditCard && String(b0.creditCard.cardNo).slice(-4) }));
  rec('N: the request body no longer holds the card', !body.card, JSON.stringify(Object.keys(body)));
  const st = JSON.stringify(t.reg.state ? t.reg.state() : {}) + JSON.stringify(t.reg.pay || {}) + JSON.stringify(t.reg.lastSale || {});
  rec('N: card number / CVV not in app state or pay data', !st.includes(TEST_CARD) && !/"cvv":"123"/.test(st), 'state + pay scanned');
  rec('N: card number not in any file Air Register wrote (journal, logs)', !grepDir(t.dir, TEST_CARD) && !grepDir(t.dir, '4242 4242'), 'data dir scanned');
  rec('N: card number not in the log', !t.logs.join('\n').includes(TEST_CARD) && !t.logs.join('\n').includes('4242 4242'), t.logs.length + ' log lines');
  // Stripe store: unchanged (no card fields sent; Stripe's own form)
  t = mk(); t.reg.keyedCh = { channelType: 10, key: 'pk_test_madeup' }; await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, card: { cardNo: TEST_CARD, expiration: '12/40', cvv: '123' } });
  rec('N: Stripe store: typed card is ignored, creditCard stays blank (Stripe form only)', t.begins[0] && t.begins[0].creditCard && t.begins[0].creditCard.cardNo === '', JSON.stringify(t.begins[0] && t.begins[0].creditCard));
  t = mk(); t.reg.keyedCh = { channelType: 0, key: '' }; await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10 });
  rec('N: no Online Payment channel -> clear message, nothing sent', !r.ok && /keyed card channel is set up/.test(r.message) && t.begins.length === 0, r.message);

  // ---- AR-16: stock gate ----
  const short = [{ id: 'p0', number: '0001', name: 'Made-up item', quantityStock: 0 }];
  t = mk({ stockRows: short }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 40, amount: 10, giftCards: [{ id: 'g', number: '7000000000002222', balance: 50 }] });
  rec('AR-16: unknown store rule: gift card on a short-stock sale -> "Check first", nothing charged', !r.ok && r.needStockOk && t.begins.length === 0, r.message);
  r = await t.reg.tender({ type: 40, amount: 10, giftCards: [{ id: 'g', number: '7000000000002222', balance: 50 }], stockOk: true });
  rec('AR-16: "Take payment anyway" -> payment goes through', r.ok && t.begins.length === 1, JSON.stringify({ ok: r.ok, m: r.message }));
  t = mk({ stockRows: short }); t.reg.learnStockRule('refuses', 'test'); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 10, tendered: 20 });
  rec('AR-16: store known to refuse -> blocked BEFORE any payment (even cash)', !r.ok && r.stockBlocked && t.begins.length === 0, r.message);
  t = mk({ stockRows: short }); t.reg.learnStockRule('allows', 'test'); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 40, amount: 10, giftCards: [{ id: 'g', number: '7000000000002222', balance: 50 }] });
  rec('AR-16: store known to oversell -> no gate (out-of-stock sale goes through)', r.ok && t.begins.length === 1, JSON.stringify({ ok: r.ok, m: r.message }));
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 's' + i, itemId: 'i' + i, productId: 'p' + i, number: String(1000 + i), name: 'Made-up ' + i, quantity: 1, rate: 1, price: 1, discount: 0, discountAmount: 0, timestamp: i }));
  t = mk({ subs: many, stockRows: [{ id: 'p19', number: '1019', name: 'Made-up 19', quantityStock: 0 }] }); await t.reg.recalc();
  const ss = await t.reg.stockShort();
  rec('AR-16: all lines checked (line 20 of 20 found short; old check stopped at 12)', ss.short.length === 1 && ss.short[0].number === '1019', JSON.stringify(ss.short));
  t = mk({ stockRows: short, refuse: true }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 10, tendered: 20 });
  rec('AR-16: first refusal from AIR POS is learned (rule "refuses")', t.reg.stockRule() === 'refuses', t.reg.stockRule() + ' / ' + (r.message || ''));

  // ---- P: dedupe a print of the same sale ----
  t = mk(); delete t.reg.printOrder; let n = 0; t.reg.printOrderCore = async () => { n++; await sleep(200); return { ok: true, message: 'Receipt sent' }; };
  t.reg.printNote = async () => null; t.reg.printGiftSlip = async () => null;
  const [a, b] = await Promise.all([t.reg.printOrder('o1'), (async () => { await sleep(20); return t.reg.printOrder('o1'); })()]);
  rec('P: Reprint while the same receipt is printing -> "Already printing", printed once', n === 1 && a.ok && b.already && /Already printing/.test(b.message), JSON.stringify({ n, b }));
  const c = await t.reg.printOrder('o1');
  rec('P: after it finished, Reprint prints again', n === 2 && c.ok && !c.already, 'n=' + n);

  console.log(`onp: ${out.filter(x => x.pass).length}/${out.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'onp-results.json'), JSON.stringify(out, null, 1));
  process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

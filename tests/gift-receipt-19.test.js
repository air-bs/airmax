// AirMax #19 (owner review pending): the gift card's last 4 and its balance on the main receipt's PRINT COPY (app/disclines.js, the #18
// stamping), and no separate gift slip when that worked (lib/extras.js gc19 block). Offline: no AIR POS, no printer, made-up cards only.
// Run: node tests/gift-receipt-19.test.js
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { DiscLines, addDiscountLines, lineItems, _pdf } = require('../app/disclines');
const { receiptPdf } = require('./fake-receipt-pdf');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const texts = buf => { const pdf = _pdf.readPdf(buf), ex = _pdf.extract(pdf, _pdf.pageList(pdf)[0]); return _pdf.textLines(ex.glyphs).map(l => l.text); };
const next = (arr, s) => arr[arr.indexOf(s) + 1];
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RCPT = { lines: [{ name: 'Toy car', number: '1002', quantity: 1, price: 5, amount: 5 }], subtotal: 5, tax: 0.4, total: 5.4 };
const GIFTS = { o1: { used: [{ masked: '**** 8888', used: 5.4, balance: 2.6 }] }, o2: { cards: [{ masked: '**** 1234', kind: 'new', value: 25, balance: 25 }, { masked: '**** 9999', kind: 'reload', value: 10 }], used: [{ masked: '**** 8888', used: 2.6, balance: 0 }] } };
function mkReg(gifts = GIFTS) {
  const reg = new Register({ log: () => {} }), prints = [];
  reg.giftsAll = () => gifts; reg.sorted = () => []; reg.api.orderGet = async () => ({ value: { subs: [] } });
  reg.printSlip = async (lines, msg) => { prints.push(lines); return { ok: true, message: msg }; };
  const logs = [], dl = new DiscLines({ reg, log: m => logs.push(m) });
  return { reg, dl, prints, logs };
}
(async () => {
  // ---------------- A. the lines (same masking and balance wording as the slip)
  let t = mkReg();
  const g1 = t.dl.giftFor('o1'), g2 = t.dl.giftFor('o2');
  rec('A1 paid with a card: "Gift card **** 8888 paid $5.40", then (indented) "Balance left $2.60"', JSON.stringify(g1) === JSON.stringify([{ text: 'Gift card **** 8888 paid $5.40' }, { text: 'Balance left $2.60', indent: true }]), JSON.stringify(g1));
  rec('A2 sold / reloaded cards: "new $25.00 / Balance now $25.00", "reload $10.00 / Balance now check at counter" (no balance from AIR POS = no guess)', g2.map(x => x.text).join('|') === 'Gift card **** 8888 paid $2.60|Balance left $0.00|Gift card **** 1234 new $25.00|Balance now $25.00|Gift card **** 9999 reload $10.00|Balance now check at counter', g2.map(x => x.text).join(' | '));
  rec('A3 a sale with no gift card: nothing', t.dl.giftFor('nope') === null && mkReg({ o: { cards: [], used: [] } }).dl.giftFor('o') === null, 'null');
  rec('A4 only the last 4 digits ever, even if a full number were saved by mistake', mkReg({ o: { used: [{ masked: '7000000000008888', used: 1, balance: 7 }] } }).dl.giftFor('o')[0].text === 'Gift card **** 8888 paid $1.00', 'masked again');

  // ---------------- B. the stamp on the receipt PDF
  for (const style of ['flip', 'plain']) for (const objstm of [false, true]) {
    const b = receiptPdf(RCPT, { style, objstm }), r = addDiscountLines(b, [], g2), tx = r.changed ? texts(r.pdf) : [];
    rec(`B1 [${style}${objstm ? ', object streams' : ''}] gift lines at the end under "Gift cards"; the original receipt text unchanged and in order`, r.changed && r.gift === 6 && next(tx, 'Gift cards') === 'Gift card **** 8888 paid $2.60' && next(tx, 'Gift card **** 9999 reload $10.00') === 'Balance now check at counter' && JSON.stringify(tx.slice(0, texts(b).length)) === JSON.stringify(texts(b)), tx.slice(-7).join(' / '));
  }
  { const b = receiptPdf({ lines: [{ name: 'Bulk candy (lb)', number: '1001', quantity: 3, price: 10, amount: 20.1 }] }), r = addDiscountLines(b, lineItems([{ name: 'Bulk candy (lb)', number: '1001', discount: 33, discountAmount: 9.9 }]), g1), tx = r.changed ? texts(r.pdf) : [];
    rec('B2 together with a #18 discount: the discount under its item once, the gift card at the end once', r.changed && next(tx, '1001 x3 $10.00 $20.10') === '33% off -$9.90' && tx.filter(x => x === '33% off -$9.90').length === 1 && tx.filter(x => /^Gift card /.test(x)).length === 1 && !tx.includes('Item discounts'), tx.slice(-4).join(' / ')); }
  { const r = addDiscountLines(receiptPdf(RCPT), [], null); rec('B3 no discount and no gift card: the receipt is left as AIR POS sent it', !r.changed, r.why); }

  // ---------------- C. the slip: skipped only after a stamped receipt, once
  t = mkReg(); const b64 = receiptPdf(RCPT).toString('base64');
  let o = await t.dl.forReceipt('o1', b64, 'Receipt');
  let s = await t.reg.printGiftSlip('o1');
  rec('C1 stamped receipt -> printGiftSlip prints nothing (the receipt has the card)', o !== b64 && texts(Buffer.from(o, 'base64')).includes('Gift card **** 8888 paid $5.40') && s === null && t.prints.length === 0, t.logs.filter(l => /#19/.test(l)).join(' | '));
  s = await t.reg.printGiftSlip('o1');
  rec('C2 the "stamped" mark is used once: a later slip for the same sale (no new receipt) prints as before', s && s.ok && t.prints.length === 1 && /^GIFT CARDS USED \(1\)/.test(t.prints[0][0]), t.prints[0] && t.prints[0][0]);
  t = mkReg(); const plain = Buffer.from('%PDF-1.4 fake receipt').toString('base64');
  o = await t.dl.forReceipt('o1', plain, 'Receipt'); s = await t.reg.printGiftSlip('o1');
  rec('C3 the PDF cannot be stamped -> the receipt goes as AIR POS sent it, and the slip prints as before', o === plain && s && s.ok && t.prints.length === 1 && t.logs.some(l => /slip prints as before/.test(l)), t.logs.filter(l => /#19/.test(l)).join(' | '));
  t = mkReg(); o = await t.dl.forReceipt('o1', b64, 'Gift receipt'); s = await t.reg.printGiftSlip('o1');
  rec('C4 a gift receipt (no prices) gets no gift card lines; the slip is unchanged', o === b64 && s && s.ok && t.prints.length === 1, 'gift label');
  t = mkReg(); await t.dl.forReceipt('o1', b64, 'Receipt'); s = await t.reg.printGiftSlip('o2');
  rec('C5 the mark is per sale: another sale\'s slip still prints', s && s.ok && t.prints.length === 1, 'o2 slip');
  t = mkReg(); await t.dl.forReceipt('o1', b64, 'Receipt'); t.dl.stamped.set('o1', Date.now() - 61000); s = await t.reg.printGiftSlip('o1');
  rec('C6 a mark older than 60 s is not trusted: the slip prints', s && s.ok && t.prints.length === 1, 'stale mark');
  rec('C7 no log line has a card number or balance amount (only counts)', t.logs.concat(mkReg().logs).every(l => !/\d{4}|\$/.test(l)), t.logs.join(' | ') || 'none');

  // ---------------- D. code limits
  const ex = rd('app/lib/extras.js'), blk = ex.slice(ex.indexOf('// gc19+'), ex.indexOf('// gc19-'));
  rec('D1 lib/extras.js: one gc19 block, one line, it only asks giftStampedOn and returns (no AIR POS, totals or pay access)', (ex.match(/\/\/ gc19\+/g) || []).length === 1 && blk.split('\n').filter(l => l.trim() && !/gc19\+/.test(l)).length === 1 && /giftStampedOn\(orderId\)\) return null;/.test(blk) && !/this\.api|totals|pay|subs/.test(blk.replace(/\/\/ #19.*$/m, '')), blk.trim().slice(0, 120));
  rec('D2 app/disclines.js stays plain ASCII', !/[^\x00-\x7f]/.test(rd('app/disclines.js')), 'ascii');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

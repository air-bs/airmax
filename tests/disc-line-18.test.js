// AirMax #18 (Ari, Nov 2 2026): each discounted item shows its discount on its own line under it, e.g. "33% off -$9.90": green on
// the sale screen, and on the printed receipt. Display / print only: no total, tax or AIR POS call changes.
// Offline: no AIR POS, no printer, made-up items only. Receipt PDFs: tests/fixtures-18 (made by headless Chrome = Skia PDF, the
// family .NET receipt makers use) and tests/fake-receipt-pdf.js (the AIR POS TestShop layout, several PDF styles).
// Run: node tests/disc-line-18.test.js
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..'), FIX = path.join(__dirname, 'fixtures-18');
const { discLineText } = require('../app/public/discline');
const { DiscLines, addDiscountLines, lineItems, _pdf } = require('../app/disclines');
const { receiptPdf } = require('./fake-receipt-pdf');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const read = buf => { const pdf = _pdf.readPdf(buf), pages = _pdf.pageList(pdf), ex = _pdf.extract(pdf, pages[0]); return { pages: pages.length, mb: ex.mb, lines: _pdf.textLines(ex.glyphs) }; };
const texts = buf => read(buf).lines.map(l => l.text);
const next = (arr, s) => arr[arr.indexOf(s) + 1];
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RCPT = { lines: [{ name: 'Bulk candy (lb)', number: '1001', quantity: 3, price: 10, amount: 20.1 }, { name: 'Toy car', number: '1002', quantity: 1, price: 5, amount: 5 }, { name: 'Rope (ft)', number: '1003', quantity: 2, price: 2, amount: 3.6 }], subtotal: 28.7, tax: 2.3, total: 31, change: 0 };
const ITEMS = lineItems([{ name: 'Bulk candy (lb)', number: '1001', discount: 33, discountAmount: 9.9 }, { name: 'Toy car', number: '1002', discount: 0, discountAmount: 0 }, { name: 'Rope (ft)', number: '1003', discount: 10, discountAmount: 0.4 }]);
let pyOk = null; const py = () => { if (pyOk === null) { try { cp.execFileSync('python3', ['-c', 'import pypdfium2'], { stdio: 'ignore' }); pyOk = true; } catch { pyOk = false; } } return pyOk; };

(async () => {
  // ---------------- A. the text: the same function for the screen and the receipt
  rec('A1 owner example: 33% of a $30.00 line reads "33% off -$9.90"', discLineText({ discount: 33, discountAmount: 9.9 }) === '33% off -$9.90', discLineText({ discount: 33, discountAmount: 9.9 }));
  rec('A2 % shown with up to 2 decimals, no trailing zeros ($ off and New price give odd %)', discLineText({ discount: 12.5, discountAmount: 1.25 }) === '12.5% off -$1.25' && discLineText({ discount: 16.666667, discountAmount: 5 }) === '16.67% off -$5.00' && discLineText({ discount: 10, discountAmount: 1 }) === '10% off -$1.00', [discLineText({ discount: 12.5, discountAmount: 1.25 }), discLineText({ discount: 16.666667, discountAmount: 5 })].join(' | '));
  rec('A3 no discount, under 1 cent or negative: no line at all', ['', ''].join() === [discLineText({ discount: 0, discountAmount: 0 }), discLineText({ discount: 5, discountAmount: 0.004 })].join() && discLineText({ discount: 5, discountAmount: -1 }) === '' && discLineText(null) === '', 'empty');
  rec('A4 amount known but no %: still one line ("Discount -$2.00")', discLineText({ discountAmount: 2 }) === 'Discount -$2.00', discLineText({ discountAmount: 2 }));
  rec('A5 the screen passes its own currency sign (same as every other amount on the screen)', discLineText({ discount: 50, discountAmount: 1 }, '€') === '50% off -€1.00', discLineText({ discount: 50, discountAmount: 1 }, '€'));

  // ---------------- B. the sale screen (static: app.js / index.html; the live screen is in tests/e2e-disc-line-18.js)
  const app = rd('app/public/app.js'), html = rd('app/public/index.html');
  rec('B1 index.html loads discline.js before app.js', html.indexOf('<script src="/discline.js">') > 0 && html.indexOf('<script src="/discline.js">') < html.indexOf('<script src="/app.js">'), 'script order');
  rec('B2 sale lines (not return lines) get the line inside the item\'s own row, under the name: one row per item, so arrows / Delete / tests are unchanged', /\$\{ret \? '' : discLineHtml\(r\)\}<\/td>/.test(app) && /const discLineHtml = r => \{[^\n]*window\.discLineText\(r, S\.currency \|\| '\$'\)[^\n]*<div class="discline">/.test(app), 'app.js render');
  rec('B3 green, on its own line', /#cart \.discline \{ color:#1e7b34;/.test(html), 'index.html CSS');
  rec('B4 column headings unchanged (# Lookup Code Name Qty Price Discount Total)', (app.includes("$('cartHead').innerHTML = `<tr><th>#</th><th>Lookup Code</th><th>Name</th><th class=\"n\">Qty</th><th class=\"n\">Price</th><th class=\"n\">${ret ? 'Max' : 'Discount'}</th><th class=\"n\">Total</th></tr>`;") || app.includes("putHtml($('cartHead'), `<tr><th>#</th><th>Lookup Code</th><th>Name</th><th class=\"n\">Qty</th><th class=\"n\">Price</th><th class=\"n\">${ret ? 'Max' : 'Discount'}</th><th class=\"n\">Total</th></tr>`);")) /* speed-general: putHtml */, 'cartHead');

  // ---------------- C. the receipt PDF
  const skia = fs.readFileSync(path.join(FIX, 'receipt-skia.pdf'));
  let t0 = Date.now(); const r1 = addDiscountLines(skia, ITEMS); const ms1 = Date.now() - t0;
  const t1 = r1.changed ? texts(r1.pdf) : [], o1 = texts(skia);
  rec('C1 Chrome/Skia receipt (Type0 fonts + ToUnicode, flipped page): both discounted items get their line', r1.changed && r1.placed === 2 && r1.atEnd === 0, JSON.stringify({ changed: r1.changed, placed: r1.placed, atEnd: r1.atEnd, why: r1.why }));
  rec('C2 the line sits right under the item\'s number / qty / price / amount line', next(t1, '1001 x3 $10.00 $20.10') === '33% off -$9.90' && next(t1, '1003 x2 $2.00 $3.60') === '10% off -$0.40', `${next(t1, '1001 x3 $10.00 $20.10')} | ${next(t1, '1003 x2 $2.00 $3.60')}`);
  rec('C3 an item without a discount gets nothing (Toy car is followed by the next item)', next(t1, '1002 x1 $5.00 $5.00') === 'ROPE (FT)', next(t1, '1002 x1 $5.00 $5.00'));
  rec('C4 every original line is still there once, in the same order; only the 2 new lines are added', JSON.stringify(t1.filter(t => !/% off/.test(t))) === JSON.stringify(o1) && t1.length === o1.length + 2, `${o1.length} -> ${t1.length} lines`);
  { const a = read(skia), b = read(r1.pdf), shift = b.lines[b.lines.length - 1].y - a.lines[a.lines.length - 1].y, grow = (b.mb.y1 - b.mb.y0) - (a.mb.y1 - a.mb.y0);
    const same = a.lines.every((l, i) => { const m = b.lines.find(x => x.text === l.text && Math.abs(x.x0 - l.x0) < 0.01); return m && (l.y > r1.cuts[0].y ? Math.abs(m.y - l.y) < 0.01 : true); });
    rec('C5 nothing above the first discount moved; the page only got longer, by the two new lines', same && grow > 0 && Math.abs(-shift - grow) < 0.01 && Math.abs(b.mb.y1 - a.mb.y1) < 0.01, `page +${grow.toFixed(1)} pt, last line moved ${(-shift).toFixed(1)} pt`); }
  rec('C6 the new line uses the item\'s own text size and left edge', (() => { const b = read(r1.pdf).lines, nm = b.find(l => l.text === 'BULK CANDY (LB)'), d = b.find(l => l.text === '33% off -$9.90'); return d && Math.abs(d.x0 - nm.x0) < 0.01 && Math.abs(d.size - nm.size) < 0.01; })(), 'x / size');
  rec('C7 fast: a 3-item receipt in well under a second', ms1 < 1000, ms1 + ' ms');

  const rtl = fs.readFileSync(path.join(FIX, 'receipt-rtl-wrap.pdf'));
  const r2 = addDiscountLines(rtl, lineItems([{ name: 'Toy', number: '1002', discount: 20, discountAmount: 1 }, { name: 'שוקולד חלב', number: '2001', discount: 10, discountAmount: 0.9 },
    { name: 'Extra long deluxe remote control racing car with batteries', number: '3001', discount: 25, discountAmount: 12.5 }, { name: 'Gift bag', number: '1004' }]));
  const t2 = r2.changed ? texts(r2.pdf) : [];
  rec('C8 short name "Toy" is NOT put under the "SHOP NAME" header but under its own item', r2.changed && next(t2, 'SHOP NAME') === 'Fake shop #000007' && next(t2, '1002 x1 $5.00 $4.00') === '20% off -$1.00', `${next(t2, 'SHOP NAME')} | ${next(t2, '1002 x1 $5.00 $4.00')}`);
  rec('C9 Hebrew name (stored right-to-left in the PDF) and a name wrapped over 3 lines both found', next(t2, '2001 x2 $4.50 $8.10') === '10% off -$0.90' && next(t2, '3001 x1 $49.99 $37.49') === '25% off -$12.50' && next(t2, '1004 x1 $1.50 $1.50') === 'Sub Total $51.09' && r2.placed === 3, `placed ${r2.placed}`);

  for (const style of ['flip', 'plain']) for (const objstm of [false, true]) {
    const b = receiptPdf(RCPT, { style, objstm }), r = addDiscountLines(b, ITEMS), tx = r.changed ? texts(r.pdf) : [];
    const tail = r.changed ? r.pdf.slice(b.length).toString('latin1') : '';
    rec(`C10 AIR POS TestShop layout, ${style}${objstm ? ' + object stream / cross-reference stream' : ''}: lines under the items, update written in the file's own cross-reference kind`,
      r.changed && next(tx, '1001 x3 $10.00 $20.10') === '33% off -$9.90' && next(tx, '1003 x2 $2.00 $3.60') === '10% off -$0.40' && next(tx, '1002 x1 $5.00 $5.00') === 'ROPE (FT)' && r.pdf.slice(0, b.length).equals(b) && (objstm ? /\/Type \/XRef/.test(tail) && !/\ntrailer\n/.test(tail) : /\ntrailer\n/.test(tail)),
      JSON.stringify({ placed: r.placed, why: r.why }));
  }
  { const r = addDiscountLines(receiptPdf(RCPT), lineItems([{ name: 'Bulk candy (lb)', number: '1001', discount: 33, discountAmount: 9.9 }, { name: 'Gadget not on the paper', number: '9999', discount: 12.5, discountAmount: 1.25 }]));
    const tx = r.changed ? texts(r.pdf) : [];
    rec('C11 an item that cannot be found for sure goes in an "Item discounts" block at the end (name, then its line); the others stay under their items', r.changed && r.placed === 1 && r.atEnd === 1 && next(tx, '1001 x3 $10.00 $20.10') === '33% off -$9.90' && tx.slice(-3).join(' | ') === 'Item discounts | Gadget not on the paper | 12.5% off -$1.25', tx.slice(-4).join(' | ')); }
  { const b = receiptPdf({ ...RCPT, lines: [RCPT.lines[0], { ...RCPT.lines[0], number: '1001' }] }), r = addDiscountLines(b, lineItems([{ name: 'Bulk candy (lb)', number: '1001', discount: 33, discountAmount: 9.9 }, { name: 'Bulk candy (lb)', number: '1001', discount: 10, discountAmount: 3 }]));
    rec('C12 two lines with the same name but different discounts cannot be told apart: both listed at the end, never guessed', r.changed && r.placed === 0 && r.atEnd === 2, JSON.stringify({ placed: r.placed, atEnd: r.atEnd })); }
  { const b = receiptPdf(RCPT), r = addDiscountLines(b, lineItems([{ name: 'Toy car', number: '1002' }]));
    rec('C13 no discounted item: the receipt is left exactly as AIR POS sent it', !r.changed && /no item discounts/.test(r.why), r.why); }
  { const bad = [['garbage', Buffer.from('hello world, not a pdf at all')], ['cut short', skia.subarray(0, 4000)], ['encrypted', Buffer.from(receiptPdf(RCPT).toString('latin1').replace('<< /Size 7 /Root 1 0 R >>', '<< /Size 7 /Root 1 0 R /Encrypt 9 0 R >>'), 'latin1')],
      ['rotated', Buffer.from(receiptPdf(RCPT).toString('latin1').replace('/MediaBox [0 0 204', '/Rotate 90 /MediaBox [0 0 204'), 'latin1')],
      ['two pages', Buffer.from(receiptPdf(RCPT).toString('latin1').replace('/Kids [3 0 R] /Count 1', '/Kids [3 0 R 7 0 R] /Count 2').replace('\nxref\n', '\n7 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 204 100] /Contents 6 0 R >>\nendobj\nxref\n'), 'latin1')]];
    const res = bad.map(([k, b]) => { let r; try { r = addDiscountLines(b, ITEMS); } catch (e) { r = { threw: e.message }; } return [k, r]; });
    rec('C14 anything it cannot read for sure (not a PDF, cut short, encrypted, rotated, 2 pages): unchanged, with the reason, never an error', res.every(([, r]) => r && !r.threw && r.changed === false && r.why), res.map(([k, r]) => k + ': ' + (r.threw || r.why)).join(' | ')); }
  { const lines = [], subs = []; for (let i = 0; i < 40; i++) { lines.push({ name: 'Test item ' + (i + 1), number: String(5000 + i), quantity: 1, price: 10, amount: 9 }); subs.push({ name: 'Test item ' + (i + 1), number: String(5000 + i), discount: 10, discountAmount: 1 }); }
    const t = Date.now(), r = addDiscountLines(receiptPdf({ lines, subtotal: 360, tax: 28.8, total: 388.8 }), lineItems(subs)), ms = Date.now() - t, tx = r.changed ? texts(r.pdf) : [];
    rec('C15 40 discounted items: all 40 lines placed, each under its own item, in under 2 s', r.changed && r.placed === 40 && lines.every(l => next(tx, `${l.number} x1 $10.00 $9.00`) === '10% off -$1.00') && ms < 2000, ms + ' ms'); }
  if (py()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl18-')); fs.writeFileSync(path.join(dir, 'a.pdf'), skia); fs.writeFileSync(path.join(dir, 'b.pdf'), r1.pdf);
    // at the printer's own size: 576 dots wide, 1 bit (dark < 128), as the helper's renderMono does
    const pyOut = cp.execFileSync('python3', ['-I', '-c', `
import sys, json, pypdfium2 as p
a = p.PdfDocument(sys.argv[1])[0]; b = p.PdfDocument(sys.argv[2])[0]; cuts = json.loads(sys.argv[3]); top = float(sys.argv[4]); s = 576 / a.get_size()[0]
A = a.render(scale=s).to_pil().convert('L'); B = b.render(scale=s).to_pil().convert('L')
bits = lambda im, y0, y1: [1 if v < 128 else 0 for v in im.crop((0, y0, im.width, y1)).tobytes()]
cuts = sorted(cuts, key=lambda c: -c['y']); sh = 0; ink = []; flips = []; dots = []
for k in range(len(cuts) + 1):  # each band of the original against the same band, moved down, in the print copy
    y_hi = top if k == 0 else cuts[k - 1]['y']; y_lo = cuts[k]['y'] if k < len(cuts) else top - a.get_size()[1]
    r0 = int((top - y_hi) * s) + 1; r1 = int((top - y_lo) * s) - 1; d = round(sh * s); x = bits(A, r0, r1); y = bits(B, r0 + d, r1 + d)
    flips.append(sum(1 for i, j in zip(x, y) if i != j)); dots.append(sum(x))
    if k < len(cuts): g0 = int((top - cuts[k]['y'] + sh) * s) + 1; g1 = int((top - cuts[k]['y'] + sh + cuts[k]['gap']) * s) - 1; ink.append(sum(bits(B, g0, g1))); sh += cuts[k]['gap']
whole = all(abs(c['gap'] * s - round(c['gap'] * s)) < 0.01 for c in cuts)
print(json.dumps({ 'width': A.size[0] == B.size[0], 'grow': B.size[1] - A.size[1], 'wholeDots': whole, 'flips': flips, 'dots': dots, 'ink': ink }))`, path.join(dir, 'a.pdf'), path.join(dir, 'b.pdf'), JSON.stringify(r1.cuts), String(r1.top)]).toString().trim();
    const pv = JSON.parse(pyOut), want = Math.round(r1.cuts.reduce((s, c) => s + c.gap, 0) * 576 / (read(skia).mb.x1 - read(skia).mb.x0));
    rec('C16 pdfium (the engine the Air Max printer helper uses) at the printer\'s 576 dots, 1 bit: same width; longer by exactly the new lines (whole dots); every part of the receipt prints dot for dot as before, only lower (under 0.5% of a part\'s dots may differ by pdfium rounding); each new line has ink in its gap',
      pv.width && pv.wholeDots && Math.abs(pv.grow - want) <= 1 && pv.flips.every((f, i) => f <= Math.max(3, 0.005 * pv.dots[i])) && pv.ink.length === 2 && pv.ink.every(v => v > 50), pyOut);
  } else console.log('SKIPPED C16 pdfium render check: python3 pypdfium2 not installed');

  // ---------------- D. Air Max side: the after-sale receipt, reprints, gift receipts; nothing about the sale changes
  const PROD = { '1001': { name: 'Bulk candy (lb)', price: 10, taxRate: 8 }, '1002': { name: 'Toy car', price: 5, taxRate: 8 } };
  function mk(withLines, tplDisc) {
    const reg = new Register({ log: () => {} }), api = reg.api, calls = [], saved = [], printed = [], logs = []; let sid = 0;
    api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, shopName: 'TestShop' }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} } }; reg.mode = 'sale';
    const bill = o => receiptPdf({ lines: (o.subs || []).map(x => { const n = x.productId.slice(1), p = PROD[n]; return { disc: tplDisc && x.discountAmount >= 0.01 ? ['Discount -$' + x.discountAmount.toFixed(2)] : [], name: p.name, number: n, quantity: x.quantity, price: x.price, amount: Math.round((x.price * x.quantity - (x.discountAmount || 0)) * 100) / 100 }; }), subtotal: 0, tax: 0, total: 0 }).toString('base64');
    const T = {
      scan: async code => { const p = PROD[code]; return p ? { success: true, value: { id: 'sub' + (++sid), itemId: 'i' + code, productId: 'p' + code, number: code, upc: '', name: p.name, quantity: 1, rate: 1, price: p.price, taxRate: p.taxRate, discount: 0, discountAmount: 0 } } : { success: false, message: 'Item not found' }; },
      promotionGet: async s => { let tot = 0, tax = 0; for (const x of s.subs) { const a = x.price * x.quantity - (x.discountAmount || 0); tot += a; tax += a * (x.taxRate || 0) / 100; } return { success: true, value: { subs: [], totalAmount: tot, totalTax: Math.round(tax * 100) / 100, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot } }; },
      authorizationCheck: async () => ({ success: true, value: { needAuthorization: false } }),
      orderSave: async s => { saved.push(JSON.parse(JSON.stringify(s))); return { success: true }; }, receiveBegin: async () => ({ success: true, value: { isCompleted: true } }), complete: async () => ({ success: true }),
      billTemplateConfigGet: async () => ({ success: true, value: { templates: [{ id: 't-std', name: 'Standard', fields: [] }, { id: 't-gift', name: 'Gift Receipt', fields: [] }], defaultTemplateId: 't-std', orderPrintId: 'op', orderSubs: [] } }),
      billContentGet: async () => ({ success: true, value: { billBase64: bill(saved[saved.length - 1] || {}) } }),
      orderGet: async id => ({ success: true, value: { id, status: 20, subs: (saved[saved.length - 1].subs || []).map(x => ({ ...x, name: PROD[x.productId.slice(1)].name, number: x.productId.slice(1) })) } }),
    };
    for (const [k, f] of Object.entries(T)) api[k] = async (...a) => { calls.push(k); return f(...a); };
    reg.printPdfBase64 = async (b64, msg) => { printed.push({ b64, msg }); return { ok: true, message: msg }; };
    reg.drawer = async () => ({ ok: true, message: 'drawer' }); reg.diag = l => logs.push(l);
    const dl = withLines ? new DiscLines({ reg, log: l => logs.push(l) }) : null;
    return { reg, calls, saved, printed, logs, dl, bill };
  }
  async function sale(t) {
    await t.reg.scan('1001'); await t.reg.setQty(0, 3); await t.reg.lineDiscount(0, 'percent', 33); await t.reg.scan('1002');
    const st = JSON.parse(JSON.stringify({ cart: t.reg.state().cart, totals: t.reg.totals }));
    await t.reg.startPay(); const r = await t.reg.tender({ type: 10, tendered: 50 }); if (r && r.hwJob) await r.hwJob;
    return { r, st };
  }
  const A = mk(false), B = mk(true); const sa = await sale(A), sb = await sale(B);
  const strip = o => JSON.stringify(o, (k, v) => (k === 'id' && typeof v === 'string' && v.length > 20 ? 'ID' : v));
  rec('D1 same cart, same totals and tax with and without #18 (display only)', strip(sa.st) === strip(sb.st) && sb.st.totals.due === 27.11, `due ${sa.st.totals.due} / ${sb.st.totals.due}, tax ${sb.st.totals.tax}`);
  rec('D2 same AIR POS calls, in the same order, and the same saved order (what is sent to AIR POS is unchanged)', A.calls.join() === B.calls.join() && strip(A.saved) === strip(B.saved), B.calls.join(' '));
  rec('D3 no extra AIR POS call for the receipt (no order look-up after Complete; the stuck-sale check reads the order before Complete)', !B.calls.slice(B.calls.lastIndexOf('complete')).includes('orderGet') && B.calls.filter(c => c === 'billContentGet').length === 1, B.calls.slice(-3).join(' '));
  const pa = A.printed[0], pb = B.printed[0], tb = pb ? texts(Buffer.from(pb.b64, 'base64')) : [];
  rec('D4 after the sale the receipt prints with "33% off -$9.90" under Bulk candy, nothing under Toy car', pb && next(tb, '1001 x3 $10.00 $20.10') === '33% off -$9.90' && !tb.some((t, i) => /% off/.test(t) && tb[i - 1] === '1002 x1 $5.00 $5.00'), tb.join(' | ').slice(0, 160));
  rec('D5 without #18 the receipt is exactly what AIR POS sent (so #18 is the only difference)', pa && pa.b64 === A.bill(A.saved[A.saved.length - 1]) && pb.b64 !== pa.b64, 'bytes compared');
  rec('D6 the print log says what happened (count + ms, no amounts)', B.logs.some(l => /^receipt discount lines \(#18\): 1 under its item \(\d+ ms\)$/.test(l)), B.logs.join(' | '));
  const orderId = sb.r.orderId; B.printed.length = 0; const n0 = B.calls.length;
  await B.reg.printOrder(orderId); const tr = B.printed[0] ? texts(Buffer.from(B.printed[0].b64, 'base64')) : [];
  rec('D7 Reprint (same session): same line, from the sale kept at the end of the sale; no order look-up', next(tr, '1001 x3 $10.00 $20.10') === '33% off -$9.90' && !B.calls.slice(n0).includes('orderGet'), B.calls.slice(n0).join(' '));
  B.printed.length = 0; const n1 = B.calls.length;
  await B.reg.printOrderCore(orderId, { templateIds: ['t-gift'] }); const g = B.printed[0];
  rec('D8 a named template (the gift receipt) is never changed', g && g.b64 === B.bill(B.saved[B.saved.length - 1]) && /Gift Receipt/.test(g.msg), g && g.msg);
  const C = mk(true); C.saved.push(...B.saved); C.printed.length = 0;
  await C.reg.printOrder(orderId); const tc = C.printed[0] ? texts(Buffer.from(C.printed[0].b64, 'base64')) : [];
  rec('D9 Reprint of a sale from before a restart: the lines are read from AIR POS once (RetailOrderGet, read-only) and the line prints', next(tc, '1001 x3 $10.00 $20.10') === '33% off -$9.90' && C.calls.filter(c => c === 'orderGet').length === 1, C.calls.join(' '));
  { const E = mk(true); await E.reg.scan('1002'); await E.reg.startPay(); const r = await E.reg.tender({ type: 10, tendered: 10 }); if (r && r.hwJob) await r.hwJob;
    rec('D10 a sale without any item discount prints exactly the AIR POS receipt, with no extra work', E.printed[0] && E.printed[0].b64 === E.bill(E.saved[E.saved.length - 1]) && !E.logs.length && !E.calls.slice(E.calls.lastIndexOf('complete')).includes('orderGet'), E.calls.join(' ')); }
  { const F = mk(true); F.dl.forReceipt = async () => { throw new Error('boom'); }; F.reg.discLinesPdf = (o, b, l) => F.dl.forReceipt(o, b, l);
    await F.reg.scan('1001'); await F.reg.lineDiscount(0, 'percent', 10); await F.reg.startPay(); const r = await F.reg.tender({ type: 10, tendered: 20 }); const jobs = r && r.hwJob ? await r.hwJob : [];
    rec('D11 if the receipt step itself fails, the AIR POS receipt still prints (the sale is never held up)', r.completed && F.printed[0] && F.printed[0].b64 === F.bill(F.saved[F.saved.length - 1]), JSON.stringify(jobs).slice(0, 120)); }

  // ---------------- F. printed once (Gordon, Nov 3), on both printer kinds: the real print path (printing.js, raw picture) with a fake
  // helper; the PDF handed to the helper is read back, and the printer bytes are checked for the right command set
  const shows = (lines, amt, pct) => lines.filter(t => (new RegExp('(^|[^0-9.])' + amt.toFixed(2).replace('.', '\\.') + '(?!\\d)').test(t) && /-|discount|save|off/i.test(t)) || new RegExp('(^|[^0-9.])' + pct + '\\s?%').test(t));
  for (const type of ['star', 'generic']) for (const tpl of [false, true]) {
    const P = mk(true, tpl); delete P.reg.printPdfBase64; const sent = [];
    P.reg.settings = { ...(P.reg.settings || {}), hardware: 'builtin', printerName: type === 'star' ? 'Star TSP143IIIBI' : 'POS-80 Receipt', printerType: type, printerConn: 'windows', printMethod: 'raw' };
    P.reg.hw = { present: true, printers: async () => ({ ok: true, value: { printers: [P.reg.settings.printerName], default: '', resolved: P.reg.settings.printerName, details: [{ name: P.reg.settings.printerName, driver: type === 'star' ? 'Star TSP100 Cutter (TSP143)' : 'POS-80', port: 'USB001' }] } }),
      request: async (cmd, a) => { if (cmd === 'raw') sent.push(Buffer.from(a.base64, 'base64')); return { ok: true, value: { state: 'printed' } }; },
      renderMono: async (b64, dots) => { sent.push({ pdf: Buffer.from(b64, 'base64'), dots }); return { ok: true, value: { width: dots, height: 8, data: Buffer.alloc(dots, 0x0f).toString('base64') } }; },
      printPdf: async () => ({ ok: true }) };
    await P.reg.scan('1001'); await P.reg.setQty(0, 3); await P.reg.lineDiscount(0, 'percent', 33); await P.reg.startPay(); const r = await P.reg.tender({ type: 10, tendered: 50 }); if (r && r.hwJob) await r.hwJob;
    const pdf = sent.find(x => x.pdf), bytes = Buffer.concat(sent.filter(Buffer.isBuffer)), tl = pdf ? texts(pdf.pdf) : [], hits = shows(tl, 9.9, 33);
    const cmd = type === 'star' ? bytes.includes(Buffer.from([0x1b, 0x2a, 0x72, 0x52])) || bytes.includes(Buffer.from([0x1b, 0x2a, 0x72, 0x41])) : bytes.includes(Buffer.from([0x1d, 0x76, 0x30]));
    rec(`F1 ${type === 'star' ? 'StarLine (Star raster)' : 'Generic ESC/POS (GS v 0)'}, store template ${tpl ? 'prints "Discount -$9.90" itself' : 'prints no discount'}: the receipt picture shows the item discount exactly once, under the item`,
      pdf && pdf.dots === 576 && cmd && hits.length === 1 && hits.includes(tl[tl.indexOf('1001 x3 $10.00 $20.10') + 1]), `${hits.length}x: ${hits.join(' / ')}; ${bytes.length} printer bytes`);
  }
  { const r = addDiscountLines(receiptPdf({ ...RCPT, lines: [{ ...RCPT.lines[0], disc: ['You saved $9.90'] }, RCPT.lines[1], { ...RCPT.lines[2], disc: ['-10% -$0.40'] }] }), ITEMS);
    rec('F2 template already shows both item discounts ("You saved $9.90", "-10% -$0.40"): nothing added, the receipt prints as AIR POS sent it', !r.changed && r.already === 2, r.why); }
  { const r = addDiscountLines(receiptPdf({ ...RCPT, lines: [{ ...RCPT.lines[0], disc: ['Discount -$9.90'] }, RCPT.lines[1], RCPT.lines[2]] }), ITEMS), tx = r.changed ? texts(r.pdf) : [];
    rec('F3 template shows one item\'s discount but not the other: only the missing one is added (each once)', r.changed && r.placed === 1 && r.already === 1 && shows(tx, 9.9, 33).length === 1 && next(tx, '1003 x2 $2.00 $3.60') === '10% off -$0.40', JSON.stringify({ placed: r.placed, already: r.already })); }
  { const r = addDiscountLines(receiptPdf({ ...RCPT, extra: [['Discount', '-$3.00']] }), ITEMS), tx = r.changed ? texts(r.pdf) : [];
    rec('F4 a whole-sale "Discount" total does not count as the item discount: the item lines are still added', r.changed && r.placed === 2 && !r.already && next(tx, '1001 x3 $10.00 $20.10') === '33% off -$9.90', JSON.stringify({ placed: r.placed, already: r.already })); }
  { const r = addDiscountLines(receiptPdf({ ...RCPT, lines: [{ ...RCPT.lines[0], disc: ['3 for $5 -$1.00'] }, RCPT.lines[1], RCPT.lines[2]] }), ITEMS), tx = r.changed ? texts(r.pdf) : [];
    rec('F5 a different discount under the item (a multi-buy promotion) is not the item discount: the item line is still added once', r.changed && r.placed === 2 && shows(tx, 9.9, 33).length === 1 && tx.filter(t => /3 for/.test(t)).length === 1, JSON.stringify({ placed: r.placed, already: r.already })); }

  // ---------------- E. wiring and packaging
  const srv = rd('app/server.js'), lib = rd('app/lib/register.js');
  rec('E1 server.js installs it outside the frozen app/lib (new DiscLines({ reg, log }))', /require\('\.\/disclines'\)/.test(srv) && /new DiscLines\(\{ reg, log \}\)/.test(srv), 'server.js');
  rec('E2 the installer ships app/disclines.js (and app/public with discline.js)', /cp -r app\/lib app\/public [^\n]*app\/\*\.js/.test(rd('stage-app.sh')) && fs.existsSync(path.join(ROOT, 'app/disclines.js')), 'stage-app.sh');
  rec('E3 register.js: exactly two airmax-fix-18 blocks, around the two hook lines (tests/backend-frozen.test.js proves nothing else changed)', (lib.match(/^\s*\/\/ airmax-fix-18\+$/gm) || []).length === 2 && (lib.match(/^\s*\/\/ airmax-fix-18-$/gm) || []).length === 2 && /this\.discLinesKeep\(orderId\)/.test(lib) && /this\.discLinesPdf\(orderId, x\.b64, x\.label\)/.test(lib), 'register.js');
  rec('E4 no new setting, shortcut or button: shortcuts.json and settings.js do not mention it', !/disc-?line|airmax-fix-18/i.test(rd('app/shortcuts.json') + rd('app/public/settings.js')), 'shortcuts.json / settings.js');

  // ---------------- F. never twice (release branch): exactly ONE discount line per discounted item
  { const base = receiptPdf(RCPT), cnt = b => texts(b).filter(t => /% off/.test(t)).length;
    rec('F1 AIR POS receipt with no discount line of its own: one line per discounted item (2 items, 2 lines)', cnt(base) === 0 && cnt(addDiscountLines(base, ITEMS).pdf) === 2, `${cnt(base)} before, ${cnt(addDiscountLines(base, ITEMS).pdf)} after`);
    const once = addDiscountLines(base, ITEMS), again = addDiscountLines(once.pdf, ITEMS);
    rec('F2 a receipt that ALREADY has the line (the store template prints it, or a copy already stamped): nothing is added, still exactly one per item', !again.changed && /already/.test(again.why || '') && cnt(once.pdf) === 2, `second pass: changed=${again.changed} (${again.why}); lines ${cnt(once.pdf)}`);
    const one = lineItems([{ name: 'Bulk candy (lb)', number: '1001', discount: 33, discountAmount: 9.9 }, { name: 'Rope (ft)', number: '1003', discount: 10, discountAmount: 0.4 }]);
    const partial = addDiscountLines(addDiscountLines(base, one.slice(0, 1)).pdf, one);
    rec('F3 only one of two lines already there: just the missing one is added (2 lines in all, none doubled)', partial.changed && partial.placed === 1 && cnt(partial.pdf) === 2, `placed ${partial.placed}, lines ${partial.changed ? cnt(partial.pdf) : '-'}`); }

  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

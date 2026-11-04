// Test-only (AirMax #18): a receipt PDF laid out like the real AIR POS TestShop receipt: company,
// shop / receipt number, dashed rules, each item as its NAME in capitals and then "NUMBER  xQTY  $PRICE  $AMOUNT" (number and
// amount bold), totals, payment, a barcode, items sold, order number and date. Made-up data only; nothing real.
//   style 'flip'  : drawn the way Skia-based PDF makers do (the page matrix flips the y axis; every text has its own Tm)
//   style 'plain' : ordinary PDF coordinates (y up), text placed with Td
//   objstm: true  : PDF 1.5 packing: the small objects in an object stream and a cross-reference stream (PNG predictor)
'use strict';
const zlib = require('zlib');
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const textW = (s, size) => [...String(s)].reduce((a, ch) => { const c = ch.charCodeAt(0); return a + (c >= 32 && c <= 126 ? HELV[c - 32] : 556); }, 0) / 1000 * size;
const esc = s => String(s).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?');
const money = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

// lines: [{ name, number, quantity, price, amount }]
function receiptPdf(r = {}, { style = 'flip', objstm = false } = {}) {
  const W = 204, M = 8, items = r.lines || [];
  const draw = []; let y = 14; // top-down layout, converted below
  const text = (s, x, size, bold, align) => { const w = textW(s, size); const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x; draw.push({ t: 'text', s, x: x0, y, size, bold }); };
  const dashes = () => { for (let x = M; x + 3 <= W - M; x += 5) draw.push({ t: 'rect', x, y: y - 0.4, w: 3, h: 0.8 }); };
  text(r.company || 'BUSINESS TEST LLC', W / 2, 13, true, 'center'); if (r.title) { y += 16; text(r.title, W / 2, 11, true, 'center'); } y += 8; draw.push({ t: 'rect', x: M, y, w: W - 2 * M, h: 1 }); y += 14;
  text(r.shop || 'Fake shop', M, 9); text('#' + (r.receiptNo || '000006'), W - M, 9, false, 'right'); y += 14;
  text('OP#TESTER', M, 9); text('POS7', W - M, 9, false, 'right'); y += 10; dashes(); y += 16;
  for (const l of items) {
    text(String(l.name || 'ITEM').toUpperCase(), M, 9); y += 13;
    text(String(l.number || ''), M, 10, true); text('x' + (l.quantity ?? 1), 70, 9); text(money(l.price), 140, 9, false, 'right'); text(money(l.amount), W - M, 10, true, 'right'); y += 13;
    for (const d of l.disc || []) { text(d, 20, 9); y += 13; } // #18 test: what a store template may print under an item ("Discount -$9.90", "You saved $9.90", "3 for $5 -$1.00")
  }
  y -= 4; dashes(); y += 15;
  for (const [k, v] of [['Sub Total', r.subtotal], ...(r.extra || []), ['Tax', r.tax], ['Total', r.total]]) { text(k, M, 9); text(typeof v === 'string' ? v : money(v), W - M, 9, true, 'right'); y += 12; }
  y -= 4; dashes(); y += 15;
  text('Payment Type', M, 9); text(r.pay || 'Cash', W - M, 9, false, 'right'); y += 12; text('Change', M, 9); text(money(r.change), W - M, 9, true, 'right'); y += 10;
  for (let i = 0, x = 40; i < 34; i++) { const w = [0.8, 1.6, 2.4][i % 3]; draw.push({ t: 'rect', x, y, w, h: 26 }); x += w + 1.4 + (i % 4) * 0.5; }
  y += 40; text('#ITEMS SOLD: ' + items.length + (items.length === 1 ? ' ITEM' : ' ITEMS'), W / 2, 9, false, 'center'); y += 12;
  text('TR#' + (r.order || 'RO0125'), W / 2, 9, false, 'center'); y += 12; text(r.at || '10/28/2026 08:31', W / 2, 9, false, 'center'); y += 20;
  text('Thank You!', W / 2, 13, true, 'center'); y += 40; // blank paper under the text, as on the real receipt
  const H = Math.ceil(y);
  let c = '';
  if (style === 'flip') {
    c += `1 0 0 -1 0 ${H} cm\nq 0 0 ${W} ${H} re W n\n0 g\n`;
    for (const d of draw) {
      if (d.t === 'rect') c += `${d.x.toFixed(2)} ${d.y.toFixed(2)} ${d.w.toFixed(2)} ${d.h.toFixed(2)} re f\n`;
      else c += `BT /${d.bold ? 'F2' : 'F1'} ${d.size} Tf 1 0 0 -1 ${d.x.toFixed(2)} ${d.y.toFixed(2)} Tm (${esc(d.s)}) Tj ET\n`;
    }
    c += 'Q\n';
  } else {
    c += '0 g\n';
    for (const d of draw) {
      if (d.t === 'rect') c += `${d.x.toFixed(2)} ${(H - d.y - d.h).toFixed(2)} ${d.w.toFixed(2)} ${d.h.toFixed(2)} re f\n`;
      else c += `BT /${d.bold ? 'F2' : 'F1'} ${d.size} Tf ${d.x.toFixed(2)} ${(H - d.y).toFixed(2)} Td (${esc(d.s)}) Tj ET\n`;
    }
  }
  const content = zlib.deflateSync(Buffer.from(c, 'latin1'));
  const font = b => `<< /Type /Font /Subtype /Type1 /BaseFont /${b ? 'Helvetica-Bold' : 'Helvetica'} /Encoding /WinAnsiEncoding >>`;
  const small = { 1: '<< /Type /Catalog /Pages 2 0 R >>', 2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`, 4: font(false), 5: font(true) };
  const contentObj = Buffer.concat([Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]);
  const parts = [Buffer.from('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; let off = parts[0].length; const offs = {};
  const put = (n, body) => { offs[n] = off; const b = Buffer.concat([Buffer.from(`${n} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]); parts.push(b); off += b.length; };
  if (!objstm) {
    for (const n of [1, 2, 3, 4, 5]) put(n, small[n]); put(6, contentObj);
    const x = off; let t = 'xref\n0 7\n0000000000 65535 f \n'; for (let n = 1; n <= 6; n++) t += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
    parts.push(Buffer.from(t + `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(parts);
  }
  // object stream 7 holds objects 1-5; cross-reference stream 8 (W [1 2 2], PNG Up predictor, the way PDF 1.5 writers do it)
  let head = '', body = ''; const inStm = [1, 2, 3, 4, 5];
  for (const n of inStm) { head += `${n} ${body.length} `; body += small[n] + '\n'; }
  const stm = zlib.deflateSync(Buffer.from(head + body, 'latin1'));
  put(6, contentObj);
  put(7, Buffer.concat([Buffer.from(`<< /Type /ObjStm /N ${inStm.length} /First ${head.length} /Filter /FlateDecode /Length ${stm.length} >>\nstream\n`, 'latin1'), stm, Buffer.from('\nendstream', 'latin1')]));
  const rows = []; // [type, field2, field3] for objects 0..8
  rows.push([0, 0, 65535]); inStm.forEach((n, i) => { rows[n] = [2, 7, i]; }); rows[6] = [1, offs[6], 0]; rows[7] = [1, offs[7], 0];
  const xoff = off; rows[8] = [1, xoff, 0];
  const raw = Buffer.alloc(rows.length * 6); rows.forEach((r, i) => { raw[i * 6] = r[0]; raw.writeUInt16BE(r[1] & 0xffff, i * 6 + 1); raw.writeUInt16BE(r[2] & 0xffff, i * 6 + 3); });
  // PNG "Up" rows: filter byte 2 + each byte minus the one above
  const pred = Buffer.alloc(rows.length * 6); let prev = Buffer.alloc(5);
  for (let i = 0; i < rows.length; i++) { const row = raw.subarray(i * 6, i * 6 + 5); pred[i * 6] = 2; for (let j = 0; j < 5; j++) pred[i * 6 + 1 + j] = (row[j] - prev[j]) & 255; prev = row; }
  const packed = zlib.deflateSync(Buffer.concat(Array.from({ length: rows.length }, (_, i) => pred.subarray(i * 6, i * 6 + 6))));
  if (rows.some(r => r[1] > 0xffff)) throw new Error('receipt too big for the test xref layout');
  put(8, Buffer.concat([Buffer.from(`<< /Type /XRef /Size 9 /W [1 2 2] /Root 1 0 R /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >> /Length ${packed.length} >>\nstream\n`, 'latin1'), packed, Buffer.from('\nendstream', 'latin1')]));
  parts.push(Buffer.from(`startxref\n${xoff}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
module.exports = { receiptPdf };

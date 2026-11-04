'use strict';
// AirMax #18 (Nov 2 2026, Ari): "show each item's discount on its own line under the item" on the printed RECEIPT
// (the sale screen does the same in app.js with public/discline.js). Display / print only.
//
// The receipt is AIR POS's own PDF (RetailOrderBillContentGet: the AIR POS server builds it from the store's template); Air Max
// never makes receipts. So just before the receipt goes to the printer, the PRINT COPY gets the line written into it:
//   1. read the page: every text line (through the fonts' ToUnicode maps) and the area of every drawing (rules, boxes, barcode, logo);
//   2. find each discounted item: its name line (case, spaces and punctuation ignored), then the item's own lines right under it
//      (number / qty / price / amount, as on the TestShop receipt: "TEST PRODUCT 001" then "00001  x1  $1.00  $1.00");
//   3. open a gap one text line high just under the item, where nothing is drawn, and write "33% off -$9.90" in it. Everything
//      below moves down by that gap (the page gets longer); nothing is redrawn, scaled or re-typeset;
//   4. read the new page back and check every original line is still there exactly once, in the same order and place (only moved
//      down), plus the new lines. Anything unexpected: the receipt prints exactly as AIR POS sent it.
// An item that cannot be found for sure is listed in a short "Item discounts" block at the end of the receipt instead.
// No total, tax, payment or AIR POS call changes: this runs after the sale is final and only changes the copy sent to the printer
// (what AIR POS stored is untouched). Gift receipts and return receipts are never changed. Thermal printers print one colour, so
// the receipt line is black (green is on the screen).
const zlib = require('zlib');
const { discLineText, pctText } = require('./public/discline');

const MAX_PDF = 4 * 1024 * 1024; // bigger than any receipt: left alone
const ORDER_WAIT_MS = 3000; // reprint of an older sale: longest wait for its lines from AIR POS
const FONT = 'AMX18f', FONT_B = 'AMX18b', FORM = 'AMX18o'; // resource names of the print copy's own new objects

// ---------------------------------------------------------------- PDF objects and syntax (only what a receipt needs)
class Name { constructor(n) { this.n = n; } }
class Ref { constructor(num, gen) { this.num = num; this.gen = gen; } }
class PStr { constructor(b, hex) { this.b = b; this.hex = !!hex; } } // b = the raw bytes as a latin1 string
class Dict { constructor(m) { this.m = m || new Map(); } get(k) { return this.m.get(k); } set(k, v) { this.m.set(k, v); return this; } has(k) { return this.m.has(k); } del(k) { this.m.delete(k); return this; } }
class Kw { constructor(v) { this.v = v; } } // keywords and content-stream operators
const EOF = { t: 'eof' }, DOPEN = { t: '<<' }, DCLOSE = { t: '>>' }, AOPEN = { t: '[' }, ACLOSE = { t: ']' }, BOPEN = { t: '{' }, BCLOSE = { t: '}' };
const isName = (x, n) => x instanceof Name && (n === undefined || x.n === n);
const WS = new Uint8Array(256); [0, 9, 10, 12, 13, 32].forEach(c => { WS[c] = 1; });
const DL = new Uint8Array(256); '()<>[]{}/%'.split('').forEach(c => { DL[c.charCodeAt(0)] = 1; });
const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

function skipWs(s, p) {
  const n = s.length;
  while (p < n) { const c = s.charCodeAt(p); if (WS[c]) p++; else if (c === 37) { while (p < n && s.charCodeAt(p) !== 10 && s.charCodeAt(p) !== 13) p++; } else break; }
  return p;
}
function litStr(s, p) { // s[p] === '('
  let depth = 1, out = '', q = p + 1; const n = s.length;
  while (q < n) {
    const ch = s[q];
    if (ch === '\\') {
      const e = s[q + 1];
      if (e === 'n') { out += '\n'; q += 2; } else if (e === 'r') { out += '\r'; q += 2; } else if (e === 't') { out += '\t'; q += 2; }
      else if (e === 'b') { out += '\b'; q += 2; } else if (e === 'f') { out += '\f'; q += 2; }
      else if (e === '\r') { q += 2; if (s[q] === '\n') q++; } else if (e === '\n') q += 2;
      else if (e >= '0' && e <= '7') { let k = 1, v = ''; while (k <= 3 && s[q + k] >= '0' && s[q + k] <= '7') { v += s[q + k]; k++; } out += String.fromCharCode(parseInt(v, 8) & 255); q += k; }
      else if (e === undefined) q++; else { out += e; q += 2; }
    } else if (ch === '(') { depth++; out += ch; q++; }
    else if (ch === ')') { if (--depth === 0) return [new PStr(out, false), q + 1]; out += ch; q++; }
    else { out += ch; q++; }
  }
  throw new Error('unterminated string');
}
function tok(s, p) {
  p = skipWs(s, p); if (p >= s.length) return [EOF, p];
  const c = s.charCodeAt(p);
  if (c === 47) { let q = p + 1; while (q < s.length && !WS[s.charCodeAt(q)] && !DL[s.charCodeAt(q)]) q++; return [new Name(s.slice(p + 1, q).replace(/#([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))), q]; }
  if (c === 40) return litStr(s, p);
  if (c === 60) {
    if (s.charCodeAt(p + 1) === 60) return [DOPEN, p + 2];
    const e = s.indexOf('>', p); if (e < 0) throw new Error('bad hex string');
    let h = s.slice(p + 1, e).replace(/[^0-9a-fA-F]/g, ''); if (h.length % 2) h += '0';
    let b = ''; for (let i = 0; i < h.length; i += 2) b += String.fromCharCode(parseInt(h.substr(i, 2), 16));
    return [new PStr(b, true), e + 1];
  }
  if (c === 62) return s.charCodeAt(p + 1) === 62 ? [DCLOSE, p + 2] : [new Kw('>'), p + 1];
  if (c === 91) return [AOPEN, p + 1]; if (c === 93) return [ACLOSE, p + 1];
  if (c === 123) return [BOPEN, p + 1]; if (c === 125) return [BCLOSE, p + 1];
  if (c === 41) return [new Kw(')'), p + 1];
  let q = p; while (q < s.length && !WS[s.charCodeAt(q)] && !DL[s.charCodeAt(q)]) q++;
  const w = s.slice(p, q);
  return NUM_RE.test(w) ? [Number(w), q] : [new Kw(w), q];
}
function val(s, p, refs = true) { const [t, q] = tok(s, p); return from(t, s, q, refs); }
function from(t, s, q, refs) {
  if (t === DOPEN) {
    const d = new Dict();
    for (;;) {
      const [k, q2] = tok(s, q); if (k === DCLOSE) return [d, q2]; if (k === EOF) throw new Error('unterminated dictionary');
      if (!(k instanceof Name)) throw new Error('bad dictionary key');
      const [v, q3] = val(s, q2, refs); d.set(k.n, v); q = q3;
    }
  }
  if (t === AOPEN) {
    const a = [];
    for (;;) { const [k, q2] = tok(s, q); if (k === ACLOSE) return [a, q2]; if (k === EOF) throw new Error('unterminated array'); const [v, q3] = from(k, s, q2, refs); a.push(v); q = q3; }
  }
  if (typeof t === 'number') {
    if (refs && Number.isInteger(t) && t >= 0) {
      const [g, q2] = tok(s, q);
      if (typeof g === 'number' && Number.isInteger(g) && g >= 0) { const [r, q3] = tok(s, q2); if (r instanceof Kw && r.v === 'R') return [new Ref(t, g), q3]; }
    }
    return [t, q];
  }
  if (t instanceof Kw) { if (t.v === 'true') return [true, q]; if (t.v === 'false') return [false, q]; if (t.v === 'null') return [null, q]; }
  return [t, q];
}
// content stream -> [{ op, args }]; inline images are skipped whole
function parseOps(s) {
  const ops = []; let args = [], p = 0;
  for (;;) {
    const [t, q] = tok(s, p); if (t === EOF) break;
    if (t instanceof Kw) {
      if (t.v === 'BI') {
        let r = q;
        for (;;) { const [k, r2] = tok(s, r); if (k === EOF) throw new Error('inline image without ID'); if (k instanceof Kw && k.v === 'ID') { r = r2; break; } const [, r3] = val(s, r2, false); r = r3; }
        let e = r + 1;
        for (;;) { e = s.indexOf('EI', e); if (e < 0) throw new Error('inline image without EI'); const b = s.charCodeAt(e + 2); if (WS[s.charCodeAt(e - 1)] && (e + 2 >= s.length || WS[b] || DL[b])) break; e += 2; }
        ops.push({ op: 'BI', args: [] }); args = []; p = e + 2; continue;
      }
      ops.push({ op: t.v, args }); args = []; p = q; continue;
    }
    if (t === ACLOSE || t === DCLOSE || t === BOPEN || t === BCLOSE) { p = q; continue; }
    const [v, q2] = from(t, s, q, false); args.push(v); p = q2;
    if (args.length > 64) args.shift();
  }
  return ops;
}

// ---------------------------------------------------------------- streams
function inflate(b) {
  try { return zlib.inflateSync(b); } catch {
    try { return zlib.inflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return zlib.inflateRawSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
  }
}
function unpredict(data, parms) {
  const pred = parms instanceof Dict ? Number(parms.get('Predictor')) || 1 : 1;
  if (pred < 10) { if (pred === 2) throw new Error('TIFF predictor not supported'); return data; }
  const colors = Number(parms.get('Colors')) || 1, bpc = Number(parms.get('BitsPerComponent')) || 8, cols = Number(parms.get('Columns')) || 1;
  const bpp = Math.max(1, Math.ceil(colors * bpc / 8)), rowLen = Math.ceil(colors * bpc * cols / 8);
  const out = Buffer.alloc(Math.floor(data.length / (rowLen + 1)) * rowLen); let prev = Buffer.alloc(rowLen), o = 0;
  for (let i = 0; i + 1 + rowLen <= data.length; i += rowLen + 1) {
    const type = data[i], row = Buffer.from(data.subarray(i + 1, i + 1 + rowLen));
    for (let j = 0; j < rowLen; j++) {
      const a = j >= bpp ? row[j - bpp] : 0, b = prev[j], c = j >= bpp ? prev[j - bpp] : 0; let x = row[j];
      if (type === 1) x += a; else if (type === 2) x += b; else if (type === 3) x += (a + b) >> 1;
      else if (type === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[j] = x & 255;
    }
    row.copy(out, o); o += rowLen; prev = row;
  }
  return out.subarray(0, o);
}
function asciiHex(b) { const h = b.toString('latin1').replace(/>[\s\S]*$/, '').replace(/[^0-9a-fA-F]/g, ''); return Buffer.from(h.length % 2 ? h + '0' : h, 'hex'); }
function ascii85(b) {
  let s = b.toString('latin1').replace(/\s+/g, ''); if (s.startsWith('<~')) s = s.slice(2); const e = s.indexOf('~>'); if (e >= 0) s = s.slice(0, e);
  const out = []; let i = 0;
  while (i < s.length) {
    if (s[i] === 'z') { out.push(0, 0, 0, 0); i++; continue; }
    const ch = s.slice(i, i + 5); i += 5; const pad = 5 - ch.length; let v = 0;
    for (const c of ch.padEnd(5, 'u')) v = v * 85 + (c.charCodeAt(0) - 33);
    out.push(...[Math.floor(v / 16777216) & 255, Math.floor(v / 65536) & 255, Math.floor(v / 256) & 255, v & 255].slice(0, 4 - pad));
  }
  return Buffer.from(out);
}
const res = (pdf, x) => { for (let i = 0; x instanceof Ref && i < 32; i++) { const o = pdf.objs.get(x.num); x = o ? o.val : null; } return x; };
const numOf = (pdf, x) => Number(res(pdf, x));
function decode(pdf, o) {
  let data = o.data || Buffer.alloc(0); const d = o.val;
  const f = res(pdf, d.get('Filter')), pr = res(pdf, d.get('DecodeParms') || d.get('DP'));
  if (f == null) return data;
  const fl = Array.isArray(f) ? f.map(x => res(pdf, x)) : [f];
  const ps = Array.isArray(f) ? (Array.isArray(pr) ? pr.map(x => res(pdf, x)) : fl.map(() => pr)) : [pr];
  fl.forEach((x, i) => {
    const n = x instanceof Name ? x.n : '';
    if (n === 'FlateDecode' || n === 'Fl') data = unpredict(inflate(data), ps[i]);
    else if (n === 'ASCIIHexDecode' || n === 'AHx') data = asciiHex(data);
    else if (n === 'ASCII85Decode' || n === 'A85') data = ascii85(data);
    else throw new Error('stream filter ' + (n || '?') + ' not supported');
  });
  return data;
}

// ---------------------------------------------------------------- file: objects, trailer, pages
function readPdf(buf) {
  const s = buf.toString('latin1');
  if (s.slice(0, 1024).indexOf('%PDF-') < 0) throw new Error('not a PDF');
  const objs = new Map(), re = /(?<![0-9])(\d{1,10})[ \t\r\n\f\0]+(\d{1,5})[ \t\r\n\f\0]+obj(?![A-Za-z0-9])/g; let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]), gen = Number(m[2]); let v, p;
    try { [v, p] = val(s, re.lastIndex); } catch { continue; }
    let q = skipWs(s, p), data = null;
    if (v instanceof Dict && s.startsWith('stream', q)) {
      q += 6; if (s.charCodeAt(q) === 13 && s.charCodeAt(q + 1) === 10) q += 2; else if (s.charCodeAt(q) === 10 || s.charCodeAt(q) === 13) q++;
      const L = v.get('Length'); let end = -1;
      if (typeof L === 'number' && L >= 0 && q + L <= s.length && s.startsWith('endstream', skipWs(s, q + L))) end = q + L;
      if (end < 0) { const e = s.indexOf('endstream', q); if (e < 0) continue; end = e; if (s.charCodeAt(end - 1) === 10) end--; if (s.charCodeAt(end - 1) === 13) end--; if (end < q) end = q; }
      data = buf.subarray(q, end); re.lastIndex = end;
    } else re.lastIndex = p;
    objs.set(num, { num, gen, val: v, data, off: m.index });
  }
  const pdf = { buf, s, objs };
  for (const o of [...objs.values()]) {
    if (!(o.data && o.val instanceof Dict && isName(o.val.get('Type'), 'ObjStm'))) continue;
    try {
      const d = decode(pdf, o).toString('latin1'), n = numOf(pdf, o.val.get('N')) || 0, first = numOf(pdf, o.val.get('First')) || 0;
      const head = d.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i++) { const on = head[2 * i], off = head[2 * i + 1]; if (!Number.isInteger(on) || objs.has(on)) continue; const [v] = val(d, first + off); objs.set(on, { num: on, gen: 0, val: v, data: null, off: -1 }); }
    } catch { /* unreadable object stream: its objects stay unknown */ }
  }
  let trailer = null; const ti = s.lastIndexOf('trailer');
  if (ti >= 0) { try { const [t] = val(s, ti + 7); if (t instanceof Dict) trailer = t; } catch { /* not a trailer */ } }
  let xs = null; for (const o of objs.values()) if (o.val instanceof Dict && isName(o.val.get('Type'), 'XRef') && (!xs || o.off > xs.off)) xs = o;
  if (!(trailer && trailer.get('Root')) && xs) trailer = xs.val;
  const si = s.lastIndexOf('startxref'), sx = si >= 0 ? parseInt(s.slice(si + 9, si + 40).trim(), 10) : NaN;
  pdf.trailer = trailer; pdf.startxref = sx; pdf.xrefStream = Number.isFinite(sx) && !s.startsWith('xref', sx) && !!xs;
  return pdf;
}
function pageList(pdf) {
  const root = res(pdf, pdf.trailer && pdf.trailer.get('Root')); if (!(root instanceof Dict)) throw new Error('no catalog');
  const out = [], seen = new Set();
  const walk = (ref, inh, depth) => {
    if (depth > 30 || (ref instanceof Ref && seen.has(ref.num))) return; if (ref instanceof Ref) seen.add(ref.num);
    const node = res(pdf, ref); if (!(node instanceof Dict)) return;
    const inh2 = { ...inh }; for (const k of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) if (node.has(k)) inh2[k] = node.get(k);
    const kids = res(pdf, node.get('Kids'));
    if (!isName(node.get('Type'), 'Page') && Array.isArray(kids)) { for (const k of kids) walk(k, inh2, depth + 1); return; }
    out.push({ ref, dict: node, inh: inh2 });
  };
  walk(root.get('Pages'), {}, 0);
  return out;
}
function pageBox(pdf, page) {
  const a = res(pdf, page.inh.MediaBox); const v = Array.isArray(a) && a.length === 4 ? a.map(x => numOf(pdf, x)) : [0, 0, 612, 792];
  if (v.some(x => !Number.isFinite(x))) throw new Error('bad page size');
  return { x0: Math.min(v[0], v[2]), y0: Math.min(v[1], v[3]), x1: Math.max(v[0], v[2]), y1: Math.max(v[1], v[3]) };
}
function pageContent(pdf, page) {
  let c = res(pdf, page.dict.get('Contents')); const raw = page.dict.get('Contents');
  const list = Array.isArray(c) ? c : raw instanceof Ref ? [raw] : [];
  return list.map(r => { const o = r instanceof Ref ? pdf.objs.get(r.num) : null; if (!o || !o.data) throw new Error('page content missing'); return decode(pdf, o).toString('latin1'); }).join('\n');
}

// ---------------------------------------------------------------- fonts (enough to read receipt text)
// Helvetica widths (Adobe AFM), codes 32..126; also the widths of the print copy's own font
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const WINANSI = { 128: '\u20ac', 130: '\u201a', 131: '\u0192', 132: '\u201e', 133: '\u2026', 134: '\u2020', 135: '\u2021', 136: '\u02c6', 137: '\u2030', 138: '\u0160', 139: '\u2039', 140: '\u0152', 142: '\u017d',
  145: '\u2018', 146: '\u2019', 147: '\u201c', 148: '\u201d', 149: '\u2022', 150: '\u2013', 151: '\u2014', 152: '\u02dc', 153: '\u2122', 154: '\u0161', 155: '\u203a', 156: '\u0153', 158: '\u017e', 159: '\u0178' };
const AGL = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '\u2019', quoteleft: '\u2018',
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '\u2212', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3',
  four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  bullet: '\u2022', endash: '\u2013', emdash: '\u2014', Euro: '\u20ac', sterling: '\u00a3', yen: '\u00a5', cent: '\u00a2', degree: '\u00b0', multiply: '\u00d7',
  section: '\u00a7', paragraph: '\u00b6', copyright: '\u00a9', registered: '\u00ae', trademark: '\u2122', ellipsis: '\u2026', nbspace: ' ', uni00A0: ' ',
  germandbls: '\u00df', ae: '\u00e6', AE: '\u00c6', oslash: '\u00f8', Oslash: '\u00d8', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl' };
const ACCENT = { grave: '\u0300', acute: '\u0301', circumflex: '\u0302', tilde: '\u0303', dieresis: '\u0308', ring: '\u030a', cedilla: '\u0327', caron: '\u030c' };
function glyphUni(n) {
  if (AGL[n] !== undefined) return AGL[n];
  if (n.length === 1) return n;
  let m = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(n); if (m) return m[1].match(/.{4}/g).map(h => String.fromCharCode(parseInt(h, 16))).join('');
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(n); if (m) { try { return String.fromCodePoint(parseInt(m[1], 16)); } catch { return ''; } }
  m = /^([A-Za-z])(grave|acute|circumflex|tilde|dieresis|ring|cedilla|caron)$/.exec(n); if (m) return (m[1] + ACCENT[m[2]]).normalize('NFC');
  const dot = n.indexOf('.'); if (dot > 0) return glyphUni(n.slice(0, dot));
  if (n.indexOf('_') > 0) return n.split('_').map(glyphUni).join('');
  return '';
}
function parseCMap(bytes) { // ToUnicode: { map: code -> text, ranges, spaces }
  const s = bytes.toString('latin1'), map = new Map(), ranges = [], spaces = [], T = [];
  for (let p = 0; ;) { const [t, q] = tok(s, p); if (t === EOF) break; if (t === AOPEN) { const [a, q2] = from(t, s, q, false); T.push(a); p = q2; } else { T.push(t); p = q; } if (T.length > 400000) break; }
  const u16 = b => { let o = ''; for (let i = 0; i + 1 < b.length; i += 2) o += String.fromCharCode((b.charCodeAt(i) << 8) | b.charCodeAt(i + 1)); return o; };
  const int = b => { let v = 0; for (let i = 0; i < b.length; i++) v = v * 256 + b.charCodeAt(i); return v; };
  for (let i = 0; i < T.length; i++) {
    const t = T[i]; if (!(t instanceof Kw)) continue;
    if (t.v === 'begincodespacerange') { let j = i + 1; for (; j + 1 < T.length && T[j] instanceof PStr && T[j + 1] instanceof PStr; j += 2) spaces.push({ len: T[j].b.length, lo: T[j].b, hi: T[j + 1].b }); i = j - 1; }
    else if (t.v === 'beginbfchar') { let j = i + 1; for (; j + 1 < T.length && T[j] instanceof PStr; j += 2) { const d = T[j + 1]; map.set(T[j].b, d instanceof PStr ? u16(d.b) : d instanceof Name ? glyphUni(d.n) : ''); } i = j - 1; }
    else if (t.v === 'beginbfrange') {
      let j = i + 1;
      for (; j + 2 < T.length && T[j] instanceof PStr && T[j + 1] instanceof PStr; j += 3) {
        const lo = int(T[j].b), hi = int(T[j + 1].b), d = T[j + 2];
        if (hi >= lo && hi - lo < 65536) ranges.push({ len: T[j].b.length, lo, hi, dst: d instanceof PStr ? u16(d.b) : Array.isArray(d) ? d.map(x => (x instanceof PStr ? u16(x.b) : '')) : '' });
      }
      i = j - 1;
    }
  }
  return { map, ranges, spaces, int };
}
function cmapText(cm, code) {
  const t = cm.map.get(code); if (t !== undefined) return t;
  const v = cm.int(code);
  for (const r of cm.ranges) {
    if (r.len !== code.length || v < r.lo || v > r.hi) continue;
    if (Array.isArray(r.dst)) return r.dst[v - r.lo] || '';
    if (!r.dst) return '';
    return r.dst.slice(0, -1) + String.fromCharCode(r.dst.charCodeAt(r.dst.length - 1) + (v - r.lo));
  }
  return null;
}
function cidWidths(pdf, W) {
  const m = new Map(); if (!Array.isArray(W)) return m;
  for (let i = 0; i < W.length;) {
    const a = numOf(pdf, W[i]), b = res(pdf, W[i + 1]);
    if (Array.isArray(b)) { b.forEach((x, k) => m.set(a + k, numOf(pdf, x) || 0)); i += 2; }
    else { const last = Number(b), w = numOf(pdf, W[i + 2]) || 0; if (!(last >= a) || last - a > 65535) break; for (let c = a; c <= last; c++) m.set(c, w); i += 3; }
  }
  return m;
}
function simpleEncoding(pdf, f) {
  const enc = res(pdf, f.get('Encoding')), map = new Map(); let base = 'WinAnsiEncoding', diffs = null;
  if (enc instanceof Name) base = enc.n; else if (enc instanceof Dict) { const b = res(pdf, enc.get('BaseEncoding')); if (b instanceof Name) base = b.n; diffs = res(pdf, enc.get('Differences')); }
  for (let c = 0; c < 256; c++) map.set(c, c >= 128 && c < 160 ? WINANSI[c] || '' : base === 'StandardEncoding' && c === 39 ? '\u2019' : base === 'StandardEncoding' && c === 96 ? '\u2018' : String.fromCharCode(c));
  if (Array.isArray(diffs)) { let c = 0; for (const x of diffs) { const v = res(pdf, x); if (typeof v === 'number') c = v; else if (v instanceof Name) { map.set(c, glyphUni(v.n)); c++; } } }
  return map;
}
function loadFont(pdf, fref, cache) {
  if (fref instanceof Ref && cache.has(fref.num)) return cache.get(fref.num);
  const f = res(pdf, fref); const font = buildFont(pdf, f instanceof Dict ? f : new Dict());
  if (fref instanceof Ref) cache.set(fref.num, font);
  return font;
}
function buildFont(pdf, f) {
  const sub = res(pdf, f.get('Subtype')), type0 = isName(sub, 'Type0'), type3 = isName(sub, 'Type3');
  let tu = null; const tr = f.get('ToUnicode'), tuo = tr instanceof Ref ? pdf.objs.get(tr.num) : null;
  if (tuo && tuo.data) { try { tu = parseCMap(decode(pdf, tuo)); } catch { tu = null; } }
  let desc = res(pdf, f.get('FontDescriptor')), widths = null, dw = 1000, codeLen = 1, identity = false, scale = 1;
  if (type0) {
    const df = res(pdf, (res(pdf, f.get('DescendantFonts')) || [])[0]);
    if (df instanceof Dict) { desc = res(pdf, df.get('FontDescriptor')); dw = numOf(pdf, df.get('DW')) || 1000; widths = cidWidths(pdf, res(pdf, df.get('W'))); }
    const enc = res(pdf, f.get('Encoding')); identity = isName(enc, 'Identity-H') || isName(enc, 'Identity-V');
    codeLen = identity || !(tu && tu.spaces.length) ? 2 : 0; // 0 = split by the ToUnicode code space
  } else {
    const fc = numOf(pdf, f.get('FirstChar')) || 0, w = res(pdf, f.get('Widths'));
    if (Array.isArray(w)) { widths = new Map(); w.forEach((x, i) => widths.set(fc + i, numOf(pdf, x) || 0)); }
    if (type3) { const fm = res(pdf, f.get('FontMatrix')); if (Array.isArray(fm)) scale = Math.abs(numOf(pdf, fm[0])) * 1000 || 1; }
  }
  const enc = type0 ? null : simpleEncoding(pdf, f);
  let asc = 0.8, dsc = -0.21;
  if (desc instanceof Dict) { const a = numOf(pdf, desc.get('Ascent')), d = numOf(pdf, desc.get('Descent')); if (a > 300 && a < 1500) asc = a / 1000; if (d < -50 && d > -600) dsc = d / 1000; }
  const bf = res(pdf, f.get('BaseFont')), base = bf instanceof Name ? bf.n : '';
  const std = !widths && !type0 ? (/courier/i.test(base) ? 'courier' : 'helv') : null;
  return {
    asc, dsc,
    codes(b) {
      if (codeLen === 1) return b.split('');
      if (codeLen === 2) { const o = []; for (let i = 0; i < b.length; i += 2) o.push(b.substr(i, 2)); return o; }
      const o = [];
      for (let i = 0; i < b.length;) {
        let took = 0;
        for (let L = 1; L <= 4 && !took; L++) { const c = b.substr(i, L); if (c.length === L && tu.spaces.some(sp => sp.len === L && c >= sp.lo && c <= sp.hi)) took = L; }
        took = took || Math.min(2, b.length - i); o.push(b.substr(i, took)); i += took;
      }
      return o;
    },
    text(code) {
      if (tu) { const t = cmapText(tu, code); if (t != null) return t; }
      if (!type0) { const c = code.charCodeAt(0); const t = enc.get(c); return t != null ? t : String.fromCharCode(c); }
      return '';
    },
    width(code) {
      if (type0) { const cid = identity ? (code.charCodeAt(0) << 8) | code.charCodeAt(1) : -1; const w = widths && widths.get(cid); return w != null ? w : dw; }
      const c = code.charCodeAt(0);
      if (widths) { const w = widths.get(c); return (w != null ? w : 0) * scale; }
      if (std === 'courier') return 600;
      return c >= 32 && c <= 126 ? HELV[c - 32] : 556;
    },
  };
}

// ---------------------------------------------------------------- reading a page: glyphs and drawn areas
const ID = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const tpt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function boxOf(m, x0, y0, x1, y1) {
  const p = [tpt(m, x0, y0), tpt(m, x1, y0), tpt(m, x0, y1), tpt(m, x1, y1)];
  return { x0: Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), y0: Math.min(p[0][1], p[1][1], p[2][1], p[3][1]), x1: Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), y1: Math.max(p[0][1], p[1][1], p[2][1], p[3][1]) };
}
const inter = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
function extract(pdf, page) {
  const mb = pageBox(pdf, page), out = { mb, glyphs: [], boxes: [], ops: new Map() }, fonts = new Map();
  const r = res(pdf, page.inh.Resources);
  run(pdf, parseOps(pageContent(pdf, page)), r instanceof Dict ? r : new Dict(), ID, mb, 0, out, fonts);
  return out;
}
function run(pdf, ops, rd, ctm0, clip0, depth, out, fonts) {
  if (depth > 8) throw new Error('drawings nested too deep');
  let gs = { ctm: ctm0, clip: clip0, font: null, fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0, lw: 1 };
  const stack = []; let tm = ID, tlm = ID, path = [], sub = null, clipNext = false;
  const R = n => { const d = res(pdf, rd.get(n)); return d instanceof Dict ? d : null; };
  const addBox = b => { const c = inter(b, gs.clip); if (c.x1 >= c.x0 && c.y1 >= c.y0) out.boxes.push(c); };
  const flush = () => { if (sub) { path.push(sub); sub = null; } };
  const ext = (x, y) => { const [px, py] = tpt(gs.ctm, Number(x) || 0, Number(y) || 0); if (!sub) sub = { x0: px, y0: py, x1: px, y1: py }; else { sub.x0 = Math.min(sub.x0, px); sub.y0 = Math.min(sub.y0, py); sub.x1 = Math.max(sub.x1, px); sub.y1 = Math.max(sub.y1, py); } };
  const paint = stroke => { flush(); const pad = stroke ? Math.max(gs.lw, 0.1) / 2 * Math.hypot(gs.ctm[0], gs.ctm[1]) : 0; for (const b of path) addBox({ x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad }); };
  const endPath = () => {
    flush();
    if (clipNext && path.length) { const u = path.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })); gs.clip = inter(gs.clip, u); }
    clipNext = false; path = [];
  };
  const show = str => {
    const f = gs.font; if (!(str instanceof PStr) || !f) return;
    for (const code of f.codes(str.b)) {
      const w0 = f.width(code), trm = mul([gs.fs * gs.th, 0, 0, gs.fs, 0, gs.rise], mul(tm, gs.ctm));
      if (gs.tr !== 3 && gs.tr !== 7) {
        const size = Math.hypot(trm[2], trm[3]), up = trm[0] > 0 && trm[3] > 0 && Math.abs(trm[1]) <= 0.02 * trm[0] && Math.abs(trm[2]) <= 0.02 * trm[3];
        if (up && size > 0.05) {
          const x = trm[4], y = trm[5], g = { x, y, x1: x + Math.max(w0 / 1000 * trm[0], 0), size, ch: f.text(code), top: y + f.asc * size, bottom: y + f.dsc * size };
          const cx = (g.x + g.x1) / 2, cy = (g.top + g.bottom) / 2;
          if (cx >= gs.clip.x0 && cx <= gs.clip.x1 && cy >= gs.clip.y0 && cy <= gs.clip.y1) out.glyphs.push(g);
        } else if (size > 0.05) { addBox(boxOf(trm, 0, f.dsc, Math.max(w0 / 1000, 0.3), f.asc)); out.rotated = true; }
      }
      const sp = code.length === 1 && code.charCodeAt(0) === 32 ? gs.tw : 0;
      tm = mul([1, 0, 0, 1, (w0 / 1000 * gs.fs + gs.tc + sp) * gs.th, 0], tm);
    }
  };
  for (const { op, args: a } of ops) {
    const n = i => Number(a[i]) || 0;
    switch (op) {
      case 'q': stack.push({ ...gs }); break;
      case 'Q': if (stack.length) gs = stack.pop(); break;
      case 'cm': if (a.length >= 6) gs = { ...gs, ctm: mul(a.slice(-6).map(Number), gs.ctm) }; break;
      case 'w': gs.lw = n(0); break;
      case 'm': flush(); ext(a[0], a[1]); break;
      case 'l': ext(a[0], a[1]); break;
      case 'c': ext(a[0], a[1]); ext(a[2], a[3]); ext(a[4], a[5]); break;
      case 'v': case 'y': ext(a[0], a[1]); ext(a[2], a[3]); break;
      case 're': { flush(); const x = n(0), y = n(1), w = n(2), h = n(3); ext(x, y); ext(x + w, y); ext(x, y + h); ext(x + w, y + h); flush(); break; }
      case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*': paint(true); endPath(); break;
      case 'f': case 'F': case 'f*': paint(false); endPath(); break;
      case 'n': endPath(); break;
      case 'W': case 'W*': clipNext = true; break;
      case 'sh': addBox(gs.clip); break;
      case 'BI': addBox(boxOf(gs.ctm, 0, 0, 1, 1)); break;
      case 'BT': tm = ID; tlm = ID; break;
      case 'Tf': { const fd = R('Font'), fr = fd && a[0] instanceof Name ? fd.get(a[0].n) : null; gs.font = fr ? loadFont(pdf, fr, fonts) : null; gs.fs = n(1); break; }
      case 'Tc': gs.tc = n(0); break;
      case 'Tw': gs.tw = n(0); break;
      case 'Tz': gs.th = (a.length ? Number(a[0]) : 100) / 100; break;
      case 'TL': gs.tl = n(0); break;
      case 'Ts': gs.rise = n(0); break;
      case 'Tr': gs.tr = n(0); break;
      case 'Td': tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm); tm = tlm; break;
      case 'TD': gs.tl = -n(1); tlm = mul([1, 0, 0, 1, n(0), n(1)], tlm); tm = tlm; break;
      case 'Tm': if (a.length >= 6) { tlm = a.slice(-6).map(Number); tm = tlm; } break;
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; break;
      case 'Tj': show(a[a.length - 1]); break;
      case "'": tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; show(a[a.length - 1]); break;
      case '"': gs.tw = n(0); gs.tc = n(1); tlm = mul([1, 0, 0, 1, 0, -gs.tl], tlm); tm = tlm; show(a[2]); break;
      case 'TJ': for (const x of Array.isArray(a[a.length - 1]) ? a[a.length - 1] : []) { if (x instanceof PStr) show(x); else if (typeof x === 'number') tm = mul([1, 0, 0, 1, -x / 1000 * gs.fs * gs.th, 0], tm); } break;
      case 'Do': {
        const xd = R('XObject'), ref = xd && a[0] instanceof Name ? xd.get(a[0].n) : null, o = ref instanceof Ref ? pdf.objs.get(ref.num) : null;
        if (!o || !(o.val instanceof Dict)) break;
        const st = res(pdf, o.val.get('Subtype'));
        if (isName(st, 'Image')) addBox(boxOf(gs.ctm, 0, 0, 1, 1));
        else if (isName(st, 'Form') && o.data) {
          const fm = res(pdf, o.val.get('Matrix')), m = Array.isArray(fm) && fm.length === 6 ? fm.map(x => numOf(pdf, x)) : ID, ctm = mul(m, gs.ctm);
          const bb = res(pdf, o.val.get('BBox')); let clip = gs.clip;
          if (Array.isArray(bb) && bb.length === 4) { const b = bb.map(x => numOf(pdf, x)); clip = inter(clip, boxOf(ctm, b[0], b[1], b[2], b[3])); }
          const fr = res(pdf, o.val.get('Resources'));
          if (!out.ops.has(ref.num)) out.ops.set(ref.num, parseOps(decode(pdf, o).toString('latin1'))); // the same drawing used again (e.g. once per band) is read once
          run(pdf, out.ops.get(ref.num), fr instanceof Dict ? fr : rd, ctm, clip, depth + 1, out, fonts);
        }
        break;
      }
      default: break;
    }
  }
}
// glyphs -> text lines, top of the page first (PDF y grows upwards)
function textLines(glyphs) {
  const gl = glyphs.slice().sort((a, b) => b.y - a.y || a.x - b.x), L = [];
  for (const g of gl) {
    let line = null;
    for (let i = L.length - 1; i >= 0 && i >= L.length - 3; i--) if (Math.abs(L[i].y - g.y) <= 0.3 * Math.max(L[i].size, g.size)) { line = L[i]; break; }
    if (!line) { line = { y: g.y, size: g.size, gl: [] }; L.push(line); }
    line.gl.push(g); if (g.size > line.size) line.size = g.size;
  }
  for (const l of L) {
    l.gl.sort((a, b) => a.x - b.x); let t = '', prev = null;
    for (const g of l.gl) { if (prev && g.x - prev.x1 > 0.25 * Math.min(g.size, prev.size) && !/\s$/.test(t) && !/^\s/.test(g.ch)) t += ' '; t += g.ch; prev = g; }
    l.text = t.replace(/\s+/g, ' ').trim();
    l.top = Math.max(...l.gl.map(g => g.top)); l.bottom = Math.min(...l.gl.map(g => g.bottom));
    l.x0 = Math.min(...l.gl.map(g => g.x)); l.x1 = Math.max(...l.gl.map(g => g.x1)); l.y = l.gl.reduce((s, g) => s + g.y, 0) / l.gl.length;
  }
  return L.sort((a, b) => b.y - a.y);
}

// ---------------------------------------------------------------- where the lines go
const norm = s => String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
const TOTALS = ['SUBTOTAL', 'TOTAL', 'TAX', 'DISCOUNT', 'SAVINGS', 'PAYMENT', 'PAIDAMOUNT', 'AMOUNTPAID', 'CHANGE', 'BALANCE', 'POINTS', 'PONTS', 'ITEMSSOLD', 'TENDER'];
const DISC_WORD = /DISCOUNT|\bDISC\b|SAVE|SAVING|\bOFF\b|PROMO|MARKDOWN|REDUCTION|COUPON|DESCUENTO|\u05d4\u05e0\u05d7\u05d4/i;
const MONEY_RE = /\d[.,]\d\d(?!\d)/, QTY_RE = /(^|\s)[x\u00d7]\s?\d/i;
function plan(ex, lines, items) {
  const mb = ex.mb, H = mb.y1 - mb.y0;
  // everything drawn (text and pictures/rules), except page-tall boxes such as a background or a frame
  const solid = ex.boxes.filter(b => b.y1 - b.y0 < 0.5 * H).concat(ex.glyphs.map(g => ({ x0: g.x, y0: g.bottom, x1: g.x1, y1: g.top })));
  const free = y => !solid.some(b => b.y0 < y - 0.05 && b.y1 > y + 0.05);
  const L = lines.map((l, i) => ({ ...l, i, n: norm(l.text) }));
  // the receipt's own space between two lines of text (so a new line sits like the others)
  const whites = L.slice(1).map((l, i) => (L[i].bottom - l.top) / Math.max(L[i].size, l.size)).filter(w => w > 0 && w < 1).sort((a, b) => a - b);
  const white0 = whites.length ? Math.min(Math.max(whites[Math.floor(whites.length / 2)], 0.08), 0.6) : 0.25; // x font size
  const its = items.map((it, k) => ({ ...it, k, nn: norm(it.name), nr: norm(Array.from(String(it.name || '')).reverse().join('')), num: norm(it.number), upc: norm(it.upc) }));
  const taken = new Map();
  const isTotal = (l, it) => TOTALS.some(w => l.n.startsWith(w) && !it.nn.startsWith(w));
  const ownLine = (it, l) => (it.num && l.n.startsWith(it.num)) || (it.upc && it.upc.length >= 6 && l.n.includes(it.upc)) || MONEY_RE.test(l.text) || QTY_RE.test(l.text);
  // a name line counts only when the item's own number / price / quantity is on it or right under it (so a header such as
  // "SHOP NAME" is never taken for an item called "Toy"); wrapped name lines in between are fine
  const confirmed = (it, l) => {
    if (ownLine(it, l)) return true;
    for (let j = l.i + 1; j < L.length && j <= l.i + 3; j++) { const x = L[j]; if (taken.has(x.i) || isTotal(x, it)) return false; if (ownLine(it, x)) return true; if (!(x.n.length >= 2 && it.nn.includes(x.n))) return false; }
    return false;
  };
  // longest names first, so an item called "CANDY" never takes the line of "BULK CANDY"; same name = top line first
  for (const it of its.slice().sort((a, b) => b.nn.length - a.nn.length || a.k - b.k)) {
    if (it.nn.length < 2) continue;
    const hit = L.find(l => !taken.has(l.i) && !isTotal(l, it) && (l.n.includes(it.nn) || (it.nr !== it.nn && l.n.includes(it.nr)) || (l.n.length >= 6 && it.nn.startsWith(l.n))) && confirmed(it, l));
    if (hit) { it.line = hit; taken.set(hit.i, it.k); }
  }
  // two lines with the same name but different discounts cannot be told apart on the paper: those go in the end block
  const byName = new Map(); its.forEach(it => byName.set(it.nn, (byName.get(it.nn) || []).concat(it)));
  for (const g of byName.values()) if (g.length > 1 && new Set(g.map(x => x.text || '')).size > 1) g.forEach(x => { x.ambiguous = true; });
  // #18 printed once (Gordon, Nov 3): when the store's AIR POS template already prints this item's discount (its $ amount or its %,
  // with a discount word or a minus sign, e.g. "Discount -$9.90", "You saved $9.90", "-33%"), Air Max adds nothing for that item.
  const mentions = (it, l) => {
    const t = l.text, a = it.amt >= 0.01 && new RegExp('(^|[^0-9.,])' + it.amt.toFixed(2).replace('.', '[.,]') + '(?![0-9])').test(t);
    const p = it.pct > 0 && new RegExp('(^|[^0-9.,])' + pctText(it.pct).replace('.', '[.,]') + '\\s?%').test(t);
    return !!((a || p) && (p || DISC_WORD.test(t) || /-\s?[$\u20ac\u00a3]?\s?\d|\(\s?[$\u20ac\u00a3]?\s?\d|\d-(\s|$)/.test(t)));
  };
  const nearItem = it => { // the item's own lines and the few lines under it, up to the next item
    if (!it.line) return [];
    const out = [it.line];
    for (let j = it.line.i + 1; j < L.length && j <= it.line.i + 5; j++) { const l = L[j]; if (taken.has(l.i)) break; if (l.top < out[out.length - 1].bottom - 2 * Math.max(l.size, it.line.size)) break; out.push(l); }
    return out;
  };
  const cuts = [], unresolved = [], already = [];
  for (const it of its) {
    if (!it.text) continue;
    if (!it.ambiguous && nearItem(it).some(l => mentions(it, l))) { already.push(it); continue; }
    if (!it.line && L.some(l => !taken.has(l.i) && mentions(it, l) && DISC_WORD.test(l.text))) { already.push(it); continue; } // not found, but its discount is printed somewhere: never a second time at the end
    if (!it.line || it.ambiguous) { unresolved.push(it); continue; }
    let anchor = it.line;
    for (let j = it.line.i + 1, k = 0; j < L.length && k < 3; j++, k++) { // the item's own lines under its name
      const l = L[j]; if (taken.has(l.i)) break;
      if (anchor.bottom - l.top > 1.2 * Math.max(anchor.size, l.size)) break;
      const byNo = (it.num && l.n.startsWith(it.num)) || (it.upc && it.upc.length >= 6 && l.n.includes(it.upc));
      if (!byNo && isTotal(l, it)) break;
      if (!(byNo || ownLine(it, l) || (l.n.length >= 2 && it.nn.includes(l.n)))) break;
      anchor = l;
    }
    const below = L[anchor.i + 1], lo = below ? below.top : mb.y0, hi = anchor.bottom;
    let y = null;
    if (hi - lo > 0.2) {
      const cand = [hi - Math.min(0.15 * anchor.size, (hi - lo) / 2), ...solid.filter(b => b.y0 < hi && b.y0 > lo).map(b => b.y0 - 0.25)].filter(c => c > lo + 0.05 && c < hi).sort((a, b) => b - a);
      y = cand.find(free);
    }
    if (y == null) { unresolved.push(it); continue; }
    const size = Math.min(Math.max(it.line.size, 5), 18), nx = L[it.line.i + 1];
    const white = anchor !== it.line && nx ? Math.min(Math.max((it.line.bottom - nx.top) / size, 0.08), 0.6) : white0; // as between the item's own lines
    let c = cuts.find(x => Math.abs(x.y - y) < 0.01); if (!c) cuts.push(c = { y, lines: [], white: white * size, above: hi - y, below: y - lo });
    c.lines.push({ text: it.text, x: it.line.x0, size });
  }
  return { cuts, unresolved, already, white: white0 };
}
// the "Item discounts" block at the end, for items that could not be found for sure
function endCut(ex, lines, unresolved, white0, gift) {
  const mb = ex.mb, H = mb.y1 - mb.y0, W = mb.x1 - mb.x0;
  const solid = ex.boxes.filter(b => b.y1 - b.y0 < 0.5 * H).map(b => b.y0).concat(ex.glyphs.map(g => g.bottom));
  const sizes = lines.map(l => l.size).sort((a, b) => a - b), size = Math.min(Math.max(sizes.length ? sizes[Math.floor(sizes.length / 2)] : W / 22, 5), 18);
  const low = solid.length ? Math.min(...solid) : mb.y1, y = low - 0.5 * size > mb.y0 + 0.05 ? low - 0.5 * size : mb.y0;
  const x = lines.length ? Math.min(...lines.map(l => l.x0)) : mb.x0 + 0.05 * W;
  const out = unresolved.length ? [{ text: 'Item discounts', x, size, bold: true }] : [];
  for (const it of unresolved) { out.push({ text: winAnsiOk(it.name) ? String(it.name).trim() : 'Item ' + String(it.number || '').trim(), x, size }); out.push({ text: it.text, x: x + 0.8 * size, size }); }
  if (gift && gift.length) { out.push({ text: 'Gift cards', x, size, bold: true }); for (const g of gift) out.push({ text: g.text, x: x + (g.indent ? 0.8 * size : 0), size }); } // #19
  return { y, lines: out, white: (white0 || 0.25) * size, above: low - y, below: y - mb.y0, topW: 0.6 * size };
}

// ---------------------------------------------------------------- writing the print copy
const fmt = v => { if (!Number.isFinite(v)) return '0'; const r = Math.round(v * 100000) / 100000; return Object.is(r, -0) ? '0' : String(r); };
const encName = n => n.replace(/[^\x21-\x7e]|[#()<>[\]{}/%]/g, c => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));
const escLit = b => b.replace(/[\\()]/g, m => '\\' + m).replace(/\r/g, '\\r');
function ser(v) {
  if (v === null || v === undefined) return 'null';
  if (v === true || v === false) return String(v);
  if (typeof v === 'number') return fmt(v);
  if (v instanceof Name) return '/' + encName(v.n);
  if (v instanceof Ref) return v.num + ' ' + v.gen + ' R';
  if (v instanceof PStr) return v.hex ? '<' + Buffer.from(v.b, 'latin1').toString('hex') + '>' : '(' + escLit(v.b) + ')';
  if (Array.isArray(v)) return '[' + v.map(ser).join(' ') + ']';
  if (v instanceof Dict) return '<<' + [...v.m].map(([k, x]) => '/' + encName(k) + ' ' + ser(x)).join(' ') + '>>';
  if (v instanceof Kw) return v.v;
  throw new Error('cannot write value');
}
const WIN_REV = Object.fromEntries(Object.entries(WINANSI).map(([c, u]) => [u, Number(c)]));
const winAnsiOk = s => /^[\x20-\x7e\u00a0-\u00ff]*$/.test(String(s || '').replace(/[\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/g, '')) && /\S/.test(String(s || ''));
const toWinAnsi = s => Array.from(String(s)).map(ch => { const c = ch.codePointAt(0); return c >= 32 && c <= 126 ? ch : c >= 160 && c <= 255 ? String.fromCharCode(c) : WIN_REV[ch] ? String.fromCharCode(WIN_REV[ch]) : '?'; }).join('');
const helvFont = bold => new Dict().set('Type', new Name('Font')).set('Subtype', new Name('Type1')).set('BaseFont', new Name(bold ? 'Helvetica-Bold' : 'Helvetica'))
  .set('Encoding', new Name('WinAnsiEncoding')).set('FirstChar', 32).set('LastChar', 126).set('Widths', HELV.slice());
// a gap holds its lines with the receipt's own spacing: as much white above and below as between two receipt lines
const T_ASC = 0.75, T_H = 0.97; // Helvetica text: top of the letters / full height, x font size
// Every gap is a whole number of 1/64ths of the page width: a whole number of printer dots at 576, 512, 448, 384 and 640 dots wide
// (80 mm at 203 / 180 dpi, 58 mm...). So the receipt below a new line prints dot for dot as before, only lower: a gap of a
// fraction of a dot would re-round every letter edge under it (pdfium places the page from its bottom edge).
function layoutCut(c, q) {
  const size = Math.max(...c.lines.map(l => l.size)), min = 0.05 * size, white = c.white != null ? c.white : 0.25 * size;
  c.size = size; c.topW = c.topW != null ? c.topW : Math.max(white - (c.above || 0), min);
  const botW = Math.max(white - (c.below || 0), min);
  c.pitch = T_H * size + white;
  c.gap = c.topW + T_H * size + (c.lines.length - 1) * c.pitch + botW;
  if (q > 0) c.gap = Math.ceil(c.gap / q - 1e-6) * q; // the extra (under 1/64 of the width) stays under the new line
}
function build(pdf, page, ex, cuts) {
  const mb = ex.mb, W = mb.x1 - mb.x0;
  cuts = cuts.slice().sort((a, b) => b.y - a.y);
  cuts.forEach(c => layoutCut(c, W / 64));
  const total = cuts.reduce((s, c) => s + c.gap, 0);
  let maxNum = 0; for (const k of pdf.objs.keys()) if (k > maxNum) maxNum = k;
  const size0 = numOf(pdf, pdf.trailer && pdf.trailer.get('Size')); if (size0 - 1 > maxNum) maxNum = size0 - 1;
  const nForm = maxNum + 1, nCont = maxNum + 2, nFont = maxNum + 3, nBold = maxNum + 4;
  // the original page, unchanged, as one picture-like drawing (Form XObject) with the page's own resources
  const resources = page.inh.Resources instanceof Ref || page.inh.Resources instanceof Dict ? page.inh.Resources : new Dict();
  const formData = zlib.deflateSync(Buffer.from(pageContent(pdf, page), 'latin1'));
  const formDict = new Dict().set('Type', new Name('XObject')).set('Subtype', new Name('Form')).set('FormType', 1).set('BBox', [mb.x0, mb.y0, mb.x1, mb.y1])
    .set('Matrix', [1, 0, 0, 1, 0, 0]).set('Resources', resources).set('Filter', new Name('FlateDecode')).set('Length', formData.length);
  // the new page: the original drawn in bands (each moved down by the gaps above it), then the new lines in the gaps
  let s = '', shift = 0;
  for (let k = 0; k <= cuts.length; k++) {
    const top = k === 0 ? mb.y1 : cuts[k - 1].y, bot = k === cuts.length ? mb.y0 : cuts[k].y;
    if (top - bot > 0.001) s += `q 1 0 0 1 0 ${fmt(-shift)} cm ${fmt(mb.x0)} ${fmt(bot)} ${fmt(W)} ${fmt(top - bot)} re W n /${FORM} Do Q\n`;
    if (k < cuts.length) shift += cuts[k].gap;
  }
  shift = 0; let bold = false;
  for (const c of cuts) {
    const gapTop = c.y - shift;
    c.lines.forEach((l, j) => {
      const base = gapTop - c.topW - T_ASC * c.size - j * c.pitch; if (l.bold) bold = true;
      s += `q 0 g BT /${l.bold ? FONT_B : FONT} ${fmt(l.size)} Tf 0 Tc 0 Tw 100 Tz 0 Tr 0 Ts 1 0 0 1 ${fmt(l.x)} ${fmt(base)} Tm (${escLit(toWinAnsi(l.text))}) Tj ET Q\n`;
      l.base = base;
    });
    shift += c.gap;
  }
  const cont = Buffer.from(s, 'latin1');
  const pd = new Dict(new Map(page.dict.m));
  pd.set('MediaBox', [mb.x0, mb.y0 - total, mb.x1, mb.y1]);
  for (const k of ['CropBox', 'BleedBox', 'TrimBox', 'ArtBox']) pd.del(k);
  const fonts = new Dict().set(FONT, new Ref(nFont, 0)); if (bold) fonts.set(FONT_B, new Ref(nBold, 0));
  pd.set('Contents', new Ref(nCont, 0)).set('Resources', new Dict().set('ProcSet', [new Name('PDF'), new Name('Text')]).set('XObject', new Dict().set(FORM, new Ref(nForm, 0))).set('Font', fonts));
  const objs = [
    { num: page.ref.num, gen: page.ref.gen, body: Buffer.from(ser(pd), 'latin1') },
    { num: nForm, gen: 0, body: Buffer.concat([Buffer.from(ser(formDict) + '\nstream\n', 'latin1'), formData, Buffer.from('\nendstream', 'latin1')]) },
    { num: nCont, gen: 0, body: Buffer.concat([Buffer.from(ser(new Dict().set('Length', cont.length)) + '\nstream\n', 'latin1'), cont, Buffer.from('\nendstream', 'latin1')]) },
    { num: nFont, gen: 0, body: Buffer.from(ser(helvFont(false)), 'latin1') },
  ];
  if (bold) objs.push({ num: nBold, gen: 0, body: Buffer.from(ser(helvFont(true)), 'latin1') });
  return { pdf: appendUpdate(pdf, objs, nBold + 1), total, cuts };
}
// incremental update: the original bytes stay as they are; the changed page and the new objects are added at the end
function appendUpdate(pdf, objs, nextNum) {
  const parts = [pdf.buf]; let off = pdf.buf.length;
  const push = b => { parts.push(b); off += b.length; };
  if (pdf.buf[pdf.buf.length - 1] !== 10) push(Buffer.from('\n', 'latin1'));
  const entries = [];
  for (const o of objs) { entries.push({ num: o.num, gen: o.gen, off }); push(Buffer.concat([Buffer.from(`${o.num} ${o.gen} obj\n`, 'latin1'), o.body, Buffer.from('\nendobj\n', 'latin1')])); }
  const t = pdf.trailer || new Dict(), tr = new Dict();
  for (const k of ['Root', 'Info', 'ID']) if (t.has(k)) tr.set(k, t.get(k));
  if (Number.isFinite(pdf.startxref)) tr.set('Prev', pdf.startxref);
  if (!pdf.xrefStream) {
    entries.sort((a, b) => a.num - b.num);
    let x = 'xref\n0 1\n0000000000 65535 f\r\n';
    for (let i = 0; i < entries.length;) { let j = i; while (j + 1 < entries.length && entries[j + 1].num === entries[j].num + 1) j++; x += `${entries[i].num} ${j - i + 1}\n`; for (let k = i; k <= j; k++) x += `${String(entries[k].off).padStart(10, '0')} ${String(entries[k].gen).padStart(5, '0')} n\r\n`; i = j + 1; }
    tr.set('Size', Math.max(nextNum, numOf(pdf, t.get('Size')) || 0));
    const xo = off; push(Buffer.from(x + 'trailer\n' + ser(tr) + '\nstartxref\n' + xo + '\n%%EOF\n', 'latin1'));
  } else { // the original uses a cross-reference stream: so does the update
    const xn = nextNum, xo = off; entries.push({ num: xn, gen: 0, off: xo }); entries.sort((a, b) => a.num - b.num);
    const rows = Buffer.alloc(entries.length * 7), idx = [];
    entries.forEach((e, i) => { rows[i * 7] = 1; rows.writeUInt32BE(e.off, i * 7 + 1); rows.writeUInt16BE(e.gen, i * 7 + 5); idx.push(e.num, 1); });
    tr.set('Type', new Name('XRef')).set('Size', Math.max(xn + 1, numOf(pdf, t.get('Size')) || 0)).set('W', [1, 4, 2]).set('Index', idx).set('Length', rows.length);
    push(Buffer.concat([Buffer.from(`${xn} 0 obj\n${ser(tr)}\nstream\n`, 'latin1'), rows, Buffer.from(`\nendstream\nendobj\nstartxref\n${xo}\n%%EOF\n`, 'latin1')]));
  }
  return Buffer.concat(parts);
}
// read the print copy back: every original line once, same order and place (moved down by the gaps above it), plus the new lines
function selfCheck(newBuf, before, built) {
  const pdf = readPdf(newBuf), pages = pageList(pdf); if (pages.length !== 1) return 'the new page could not be read back';
  const ex = extract(pdf, pages[0]), got = textLines(ex.glyphs);
  const shiftAt = y => built.cuts.reduce((s, c) => s + (c.y > y ? c.gap : 0), 0);
  const want = before.map(l => ({ text: l.text, y: l.y - shiftAt(l.y), x0: l.x0 }));
  for (const c of built.cuts) for (const l of c.lines) want.push({ text: toWinAnsi(l.text).replace(/\s+/g, ' ').trim(), y: l.base, x0: l.x, added: true });
  want.sort((a, b) => b.y - a.y);
  if (got.length !== want.length) return `read back ${got.length} lines, expected ${want.length}`;
  for (let i = 0; i < want.length; i++) {
    const g = got[i], w = want[i];
    if (Math.abs(g.y - w.y) > 0.3 || Math.abs(g.x0 - w.x0) > 0.5 || g.text !== w.text) return `line ${i + 1} differs when read back ("${String(g.text).slice(0, 30)}")`;
  }
  const H0 = before.mb.y1 - before.mb.y0, H1 = ex.mb.y1 - ex.mb.y0;
  if (Math.abs(H1 - H0 - built.total) > 0.01) return 'page size is not as expected';
  return null;
}
// items: [{ name, number, upc, text }] for every line of the sale; text = the discount line ('' = no discount)
// gift (#19): [{ text, indent }] lines for a "Gift cards" block at the end of the receipt (masked card + amount + balance), or none
function addDiscountLines(buf, items, gift) {
  const disc = (items || []).filter(i => i && i.text), gl = Array.isArray(gift) && gift.length ? gift : null;
  if (!disc.length && !gl) return { changed: false, why: 'no item discounts' };
  if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.length > MAX_PDF) return { changed: false, why: 'the receipt is not a PDF that can be read' };
  let pdf, pages, ex, lines;
  try { pdf = readPdf(buf); pages = pageList(pdf); } catch (e) { return { changed: false, why: 'the receipt PDF could not be read (' + e.message + ')' }; }
  if (pdf.trailer && pdf.trailer.get('Encrypt')) return { changed: false, why: 'the receipt PDF is encrypted' };
  if (pages.length !== 1) return { changed: false, why: `the receipt has ${pages.length} pages` };
  const page = pages[0];
  if (!(page.ref instanceof Ref)) return { changed: false, why: 'the receipt page is not a separate object' };
  if ((numOf(pdf, page.inh.Rotate) || 0) % 360 !== 0) return { changed: false, why: 'the receipt page is rotated' };
  try { ex = extract(pdf, page); lines = textLines(ex.glyphs); } catch (e) { return { changed: false, why: 'the receipt page could not be read (' + e.message + ')' }; }
  lines.mb = ex.mb;
  const p = plan(ex, lines, items);
  if (!p.cuts.length && !p.unresolved.length && !gl) return { changed: false, why: 'every item discount is already on the AIR POS receipt', already: p.already.length };
  const cuts = p.cuts.slice(); if (p.unresolved.length || gl) cuts.push(endCut(ex, lines, p.unresolved, p.white, gl));
  let built;
  try { built = build(pdf, page, ex, cuts); } catch (e) { return { changed: false, why: 'the print copy could not be made (' + e.message + ')' }; }
  let bad; try { bad = selfCheck(built.pdf, lines, built); } catch (e) { bad = 'the print copy could not be read back (' + e.message + ')'; }
  if (bad) return { changed: false, why: 'check failed: ' + bad };
  const placed = disc.length - p.unresolved.length - p.already.length;
  return { changed: true, pdf: built.pdf, placed, atEnd: p.unresolved.length, already: p.already.length, gift: gl ? gl.length : 0, cuts: built.cuts.map(c => ({ y: c.y, gap: c.gap })), top: ex.mb.y1 };
}

// ---------------------------------------------------------------- Air Max side: which sale lines have a discount
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
function lineItems(subs) {
  return (subs || []).filter(Boolean).map(s => ({ name: s.name || '', number: s.number || '', upc: s.upc || '', text: discLineText(s, '$'), amt: r2(s.discountAmount), pct: r2(s.discount) }));
}
class DiscLines {
  constructor({ reg, log } = {}) {
    this.reg = reg; this.log = log || (() => {}); this.keep = new Map(); this.stamped = new Map();
    if (reg) { reg.discLinesKeep = orderId => this.remember(orderId); reg.discLinesPdf = (orderId, b64, label) => this.forReceipt(orderId, b64, label); reg.giftStampedOn = orderId => this.giftStampedOn(orderId); }
  }
  // finishSale, just before the cart is cleared: this sale's lines (names, numbers, discounts) for its receipt; nothing else is kept
  remember(orderId) {
    try {
      if (!orderId || !this.reg || typeof this.reg.sorted !== 'function') return;
      this.keep.set(String(orderId), lineItems(this.reg.sorted()));
      while (this.keep.size > 50) this.keep.delete(this.keep.keys().next().value);
    } catch (e) { this.log('receipt discount lines (#18): sale lines not kept: ' + e.message); }
  }
  // the sale's lines: kept at the sale; a reprint of an older sale reads them from AIR POS (RetailOrderGet, read-only). That look-up
  // gets 3 s at most, so a slow reply never holds up the reprint (it then prints as AIR POS sent it).
  async itemsFor(orderId) {
    const k = this.keep.get(String(orderId)); if (k) return k;
    let timer; const slow = new Promise(res => { timer = setTimeout(() => res('slow'), ORDER_WAIT_MS); });
    const r = await Promise.race([this.reg.api.orderGet(orderId), slow]); clearTimeout(timer);
    if (r === 'slow') { this.log('receipt discount lines (#18): the order look-up took over ' + ORDER_WAIT_MS / 1000 + ' s; the reprint goes as AIR POS sent it'); return null; }
    const o = r && typeof r === 'object' && 'value' in r ? r.value : r;
    if (!o || !Array.isArray(o.subs)) return null;
    const items = lineItems(o.subs.map(s => {
      const qty = s.quantityTotal != null ? Number(s.quantityTotal) : (Number(s.quantity) || 0) * (Number(s.rate) || 1);
      const amt = s.discountAmount != null ? s.discountAmount : (Number(s.discount) > 0 && Number(s.price) > 0 ? r2(Number(s.price) * qty * Number(s.discount) / 100) : 0);
      return { name: s.name || s.productName, number: s.number || s.productNumber, upc: s.upc, discount: s.discount, discountAmount: amt };
    }));
    this.keep.set(String(orderId), items); return items;
  }
  // #19 (Gordon): the gift cards of this sale for the main receipt: each card's last 4 (masked, as on the slip), what it paid / was
  // loaded with, and the balance AIR POS gave after Complete ("check at counter" when it gave none, as on the slip). Nothing else.
  giftFor(orderId) {
    const g = typeof this.reg.giftsAll === 'function' ? this.reg.giftsAll()[String(orderId)] : null; if (!g) return null;
    const m = n => '$' + r2(n).toFixed(2), bal = c => (typeof c.balance === 'number' ? m(c.balance) : 'check at counter'), last4 = c => '**** ' + String(c.masked || '').replace(/\D/g, '').slice(-4);
    const out = [];
    for (const c of g.used || []) { out.push({ text: `Gift card ${last4(c)} paid${c.used == null ? '' : ' ' + m(c.used)}` }); out.push({ text: 'Balance left ' + bal(c), indent: true }); }
    for (const c of g.cards || []) { out.push({ text: `Gift card ${last4(c)} ${c.kind === 'reload' ? 'reload' : 'new'} ${m(c.value)}` }); out.push({ text: 'Balance now ' + bal(c), indent: true }); }
    return out.length ? out : null;
  }
  // printGiftSlip asks (lib/extras.js, gc19 block): was the receipt just printed for this sale stamped with its gift cards? Once, within 60 s.
  giftStampedOn(orderId) { const k = String(orderId || ''), at = this.stamped.get(k); this.stamped.delete(k); return !!(at && Date.now() - at < 60000); }
  async forReceipt(orderId, b64, label) {
    const t0 = Date.now(); this.stamped.delete(String(orderId || ''));
    try {
      if (!b64 || /gift/i.test(String(label || ''))) return b64;
      const gift = this.giftFor(orderId);
      const items = (await this.itemsFor(orderId)) || []; if (!items.some(i => i.text) && !gift) return b64;
      const r = addDiscountLines(Buffer.from(b64, 'base64'), items, gift), ms = Date.now() - t0;
      if (r.changed && r.gift) { this.stamped.set(String(orderId), Date.now()); this.log(`receipt gift cards (#19): ${(gift.length / 2)} card line(s) on the receipt, no separate gift card slip`); }
      else if (gift) this.log('receipt gift cards (#19): not on the receipt (' + (r.why || 'not stamped') + '); the gift card slip prints as before');
      if (!items.some(i => i.text)) return r.changed ? r.pdf.toString('base64') : b64;
      const line = r.changed ? `receipt discount lines (#18): ${r.placed} under ${r.placed === 1 ? 'its item' : 'their items'}${r.atEnd ? `, ${r.atEnd} in the Item discounts block at the end` : ''}${r.already ? `, ${r.already} already printed by AIR POS (not added twice)` : ''} (${ms} ms)`
        : `receipt discount lines (#18): not added, the receipt prints as AIR POS sent it: ${r.why} (${ms} ms)`;
      if (typeof this.reg.diag === 'function') this.reg.diag(line); this.log(line);
      return r.changed ? r.pdf.toString('base64') : b64;
    } catch (e) { this.log('receipt discount lines (#18): skipped: ' + e.message); return b64; }
  }
}

module.exports = { DiscLines, addDiscountLines, lineItems, _pdf: { readPdf, pageList, extract, textLines, norm } };

// Work copy (NOT released). 1.0.10-local.2 (Nov 1, Ari 12:04): Hebrew item names on labels + Quick settings in Print Label.
// Mocked helper / AIR POS (sink folder), no hardware; read-only, nothing about sales or money is touched.
// Usage: node tests/hebrew-label.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const APP = path.join(__dirname, '..', 'app');
const { Labels } = require(path.join(APP, 'labels'));
const L = require(path.join(APP, 'public/label'));
const out = []; const rec = (n, pass, d) => { out.push({ n, pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${n}${d != null ? ' — ' + String(d).slice(0, 140) : ''}`); };
const HEB = 'שוקולד חלב מריר 100 גרם';
const item = { name: HEB, number: '1001', upc: '', price: 5.9, regular: null };
function mk(st) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heb-')), sink = path.join(dir, 'sink');
  const reg = { printerName: () => 'Star TSP100 Cutter (TSP143)', api: { scan: async () => ({ productId: 'p-1', name: HEB, number: '1001', upc: '', price: 5.9 }) }, hw: { present: false } };
  const lab = new Labels({ dataDir: dir, reg, log: () => {}, sink }); fs.writeFileSync(lab.file, JSON.stringify(st));
  const files = () => (fs.existsSync(sink) ? fs.readdirSync(sink).filter(f => !f.endsWith('.json')) : []);
  return { lab, files, sink };
}
const fakeImg = (lay, fill = 0xff) => { const b = Buffer.alloc(Math.ceil(lay.W / 8) * lay.H, 0); b.fill(fill, 0, Math.ceil(lay.W / 8) * 4); return { w: lay.W, h: lay.H, data: b.toString('base64') }; };
(async () => {
  const st = L.norm({ printer: 'TSC DA200', nameSize: 'xlarge' }), lay = L.layout(item, st);
  rec('H1 Hebrew name needs a picture; plain English and "…" do not', L.needsImage(lay) && !L.needsImage(L.layout({ ...item, name: 'TOY CAR' }, st)) && !L.needsImage(L.layout({ ...item, name: 'A VERY LONG TOY NAME THAT WILL NOT FIT ON TWO LINES OF THIS LABEL AT ALL REALLY NOT' }, L.norm({ size: '1.5x1', nameSize: 'xlarge' }))), 'ok');
  rec('H2 isRtl: Hebrew first → right-to-left; English first → left-to-right', L.isRtl(HEB) && L.isRtl('100 גרם') && !L.isRtl('LEGO לגו') && !L.isRtl('TOY CAR'), 'ok');
  const svg = L.toSvg(lay), names = lay.items.filter(p => p.role === 'name');
  rec('H3 preview SVG keeps the Hebrew text (no "?"), name lines are direction="rtl"', names.length >= 1 && names.every(p => svg.includes('>' + p.s + '<')) && !/\?\?/.test(svg) && /direction="rtl"[^>]*data-role="name"/.test(svg), names.map(p => p.s).join(' | '));
  rec('H4 preview font list has Hebrew-capable fonts (Arial on Windows; DejaVu/Noto fallbacks)', /font-family="Arial,[^"]*DejaVu Sans[^"]*Noto Sans Hebrew/.test(svg), 'ok');
  const ss = L.norm({ store: 'צעצועים בע"מ', show: { ...L.DEF.show, store: true } }), sl = L.layout(item, ss), ssvg = L.toSvg(sl), stp = sl.items.find(p => p.t === 'text' && p.align === 'left' && L.isRtl(p.s));
  rec('H5 left-aligned Hebrew line (store name) keeps its left edge at the margin (rtl + text-anchor end)', stp && new RegExp(`x="${stp.x}"[^>]*text-anchor="end" direction="rtl"`).test(ssvg), stp && stp.s);
  rec('H6 toSvg(lay, true) gives pixel width/height for drawing it as a picture', L.toSvg(lay, true).includes(`width="${lay.W}" height="${lay.H}"`), `${lay.W}x${lay.H}`);
  // server: driver (PDF) path, TSC DA200 on auto
  { const t = mk({ printer: 'TSC DA200', nameSize: 'xlarge' }); const r = await t.lab.print({ code: '1001' });
    rec('H7 Hebrew label without a picture: needImage, nothing sent to the printer', r.ok && r.needImage && r.item && r.item.name === HEB && t.files().length === 0, r.message);
    const l2 = L.layout(r.item, t.lab.settings()), r2 = await t.lab.print({ code: '1001', image: fakeImg(l2) }), f = t.files();
    const pdf = f.length === 1 ? fs.readFileSync(path.join(t.sink, f[0]), 'latin1') : '';
    rec('H8 TSC DA200 (driver/PDF): prints the picture — ImageMask XObject, no "?" text, no Hebrew bytes', r2.ok && r2.via === 'driver' && /\/Subtype \/Image \/Width \d+ \/Height \d+ \/ImageMask true/.test(pdf) && /\/XObject << \/Im1 6 0 R >>/.test(pdf) && /\/Im1 Do/.test(pdf) && !/\(\?+/.test(pdf) && !/[\u0590-\u05ff]/.test(pdf) && !/ Tj/.test(pdf.split('stream')[1] || ''), f[0]);
    rec('H9 PDF stays well-formed (xref offsets match)', (() => { const m = pdf.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/); if (!m) return false; const offs = m[2].trim().split('\n').slice(1).map(x => Number(x.slice(0, 10))); return offs.every((o, i) => pdf.slice(o).startsWith(`${i + 1} 0 obj`)); })(), 'xref');
    const bad = await t.lab.print({ code: '1001', image: { ...fakeImg(l2), w: l2.W - 8 } }), bad2 = await t.lab.print({ code: '1001', image: { w: l2.W, h: l2.H, data: 'AAAA' } });
    rec('H10 wrong picture size / short data is refused, nothing printed', !bad.ok && !bad2.ok && /did not match/.test(bad.message) && t.files().length === 1, bad.message); }
  // ZPL path
  { const t = mk({ printer: 'Zebra ZD220', nameSize: 'xlarge' }); const r = await t.lab.print({ code: '1001' });
    const l2 = L.layout(r.item, t.lab.settings()), img = fakeImg(l2), r2 = await t.lab.print({ code: '1001', image: img }), f = t.files();
    const z = f.length === 1 ? fs.readFileSync(path.join(t.sink, f[0]), 'latin1') : '', bpr = Math.ceil(l2.W / 8);
    rec('H11 ZPL printer: Hebrew goes as ^GFA picture, no garbled ^FD text', r.needImage && r2.ok && r2.via === 'zpl' && z.includes(`^GFA,${bpr * l2.H},${bpr * l2.H},${bpr},`) && !/\^FD/.test(z) && !/\?/.test(z) && /\^PQ1\^XZ/.test(z), f[0]);
    rec('H12 ^GFA hex = the picture bytes', z.includes(Buffer.from(img.data, 'base64').toString('hex').toUpperCase()), 'ok'); }
  { const t = mk({ printer: 'Zebra ZD220' }); const r = await t.lab.print({ test: true });
    rec('H13 English labels unchanged: text ZPL, no picture step', r.ok && !r.needImage && /\^FD/.test(fs.readFileSync(path.join(t.sink, t.files()[0]), 'latin1')), r.message); }
  { const t = mk({}); const r = await t.lab.print({ code: '1001' });
    rec('H14 no label printer: still the print window (the browser draws Hebrew itself)', r.ok && r.dialog && !r.needImage, r.why); }
  rec('H15 "…" prints as "..." in ZPL/PDF (was "?")', (() => { const s2 = L.norm({ size: '1.5x1', nameSize: 'xlarge' }), l3 = L.layout({ ...item, name: 'SUPERCALIFRAGILISTICEXPIALIDOCIOUS MEGA DELUXE TOY RACE CAR SET WITH LIGHTS' }, s2); const z = L.toZpl(l3, s2, 1), p = L.toPdf(l3, 1); return l3.items.some(x => /\u2026/.test(x.s || '')) ? z.includes('...') && !/\?/.test(z) && p.includes('...') : true; })(), 'ok');
  // Quick settings in the Print Label window (static: the page code)
  const pl = fs.readFileSync(path.join(APP, 'public/printlabel.js'), 'utf8');
  rec('Q1 header text and the Ctrl+, link kept', /Label printer: <b id="plPr">/.test(pl) && /Change in Settings \(Ctrl\+,\) &gt; Labels\. The sale is not changed\./.test(pl), 'ok');
  rec('Q2 Quick settings: printer, sticker size, name size (with Extra large), barcode and price', ['plqPr', 'plqSz', 'plqNs', 'plqBc', 'plqPc'].every(i => pl.includes(`id="${i}"`)) && /opt\('xlarge', 'Extra large'/.test(pl), 'ok');
  const qw = pl.slice(pl.indexOf('function quickWire'), pl.indexOf('async function openMode'));
  rec('Q3 Quick settings save to the same label-settings (Settings > Labels) and revert when refused', /api\('label-settings-save', \{ settings: next \}\)/.test(qw) && /\$\('plqPr'\)\.value = cur\.printer/.test(qw) && /await loadSet\(\)/.test(qw) && /render\(\)/.test(qw), 'ok');
  rec('Q4 receipt printer marked in the picker', /receipt printer, not for labels/.test(pl.slice(pl.indexOf('function quickHtml'))), 'ok');
  { const t = mk({ printer: 'TSC DA200' }); const x = t.lab.save({ settings: { ...t.lab.settings(), printer: 'Star TSP100 Cutter (TSP143)' } });
    rec('Q5 same receipt-printer guard: saving the receipt printer as label printer is refused', !x.ok && /receipt printer/i.test(x.message) && t.lab.settings().printer === 'TSC DA200', x.message);
    const y = t.lab.save({ settings: { ...t.lab.settings(), size: '1.5x1', nameSize: 'xlarge', show: { ...t.lab.settings().show, barcode: false } } }), s3 = t.lab.settings();
    rec('Q6 a quick change is what Settings > Labels reads (one file)', y.ok && s3.size === '1.5x1' && s3.nameSize === 'xlarge' && s3.show.barcode === false && s3.printer === 'TSC DA200', JSON.stringify({ size: s3.size, ns: s3.nameSize })); }
  rec('Q7 Hebrew labels are drawn on screen and resent (label-print → needImage → image)', /r\.needImage/.test(pl) && /api\('label-print', \{ \.\.\.body, image \}\)/.test(pl) && /getImageData/.test(pl), 'ok');
  const fails = out.filter(x => !x.pass);
  console.log(`\n${out.length - fails.length}/${out.length} Hebrew label / quick settings tests passed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

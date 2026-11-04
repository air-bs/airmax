// Air Max 1.0.11-local.9 (test build, Ari OK 6:30 PM ET Nov 1): Print Labels with layouts. OFFLINE: mocked AIR POS api and
// printer helper; every real network call (http/https/net/fetch) is blocked and counted, so "no AIR POS writes" is proven.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
// ---- the mocked network: any real connection attempt is recorded and refused
const NET = [];
for (const m of ['http', 'https']) { const mod = require(m); for (const f of ['request', 'get']) { mod[f] = (...a) => { NET.push(m + '.' + f + ' ' + String(a[0] && (a[0].href || a[0].host || a[0])).slice(0, 80)); throw new Error('network blocked in test'); }; } }
{ const net = require('net'); net.connect = net.createConnection = (...a) => { NET.push('net.connect ' + JSON.stringify(a[0]).slice(0, 80)); throw new Error('network blocked in test'); }; }
global.fetch = async u => { NET.push('fetch ' + String(u).slice(0, 80)); throw new Error('network blocked in test'); };
const L = require('../app/public/label.js');
const X = require('../app/public/labellayouts.js');
const { Labels } = require('../app/labels');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lly-'));
const ITEMS = {
  '075720000814': { productId: 'p1', number: '0814', name: 'Comic Kinder Comics Midosville', upc: '075720000814', price: 19.99, oriPrice: 24.99, categoryName: 'Books', costPrice: 11.5 },
  '1001': { productId: 'p2', number: '1001', name: 'Bulk candy (lb)', upc: '012345678905', price: 10, oriPrice: 10, categoryName: 'Candy', costPrice: 4 },
  '1003': { productId: 'p3', number: '1003', name: 'Rope (ft)', upc: '', price: 2, categoryName: 'Books' },
  '1004': { productId: 'p4', number: '1004', name: 'No price thing', upc: '444000000004', price: NaN, categoryName: '' },
  '1005': { productId: 'p5', number: '1005', name: 'שוקולד חלב', upc: '729000000005', price: 6.5, categoryName: 'Candy' },
};
function mk(opt = {}) {
  const dir = fs.mkdtempSync(path.join(TMP, 'd-')), calls = [], args = [], hwc = [];
  const find = code => ITEMS[code] || Object.values(ITEMS).find(x => x.number === code || x.upc === code);
  const reg = {
    printerName: () => 'EPSON TM-T88V Receipt',
    // every AIR POS api name used is recorded; anything but the read-only scan lookup throws
    api: new Proxy({}, { get: (_, k) => async (...a) => { calls.push(String(k)); args.push(JSON.stringify(a)); if (k !== 'scan') throw new Error('unexpected AIR POS api ' + String(k)); return { success: true, value: find(String(a[0])) || { productId: '00000000-0000-0000-0000-000000000000' } }; } }),
    priceCheck: async q => { calls.push('priceCheck'); args.push(JSON.stringify([q])); const l = Object.values(ITEMS).filter(x => x.name.toLowerCase().includes(String(q).toLowerCase())); return l.length ? { ok: true, list: l } : { ok: false, message: `Nothing found for "${q}"` }; },
    identity: { shopName: 'TestShop' },
    hw: opt.noHw ? { present: false } : { present: true, request: async (k, a) => { hwc.push({ k, a }); return { ok: true }; }, printPdf: async (b, p) => { hwc.push({ k: 'pdf', b, p }); return { ok: true }; } },
  };
  return { lab: new Labels({ dataDir: dir, reg, log: () => {}, sink: opt.sink || null }), dir, calls, args, hwc };
}
const pdfPages = pdf => (pdf.match(/\/Type \/Page\b/g) || []).length;
const boxes = pdf => [...pdf.matchAll(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [Math.round(+m[1]), Math.round(+m[2])]);
const decode = (pdfStr, page) => { const f = path.join(TMP, 'b' + Math.random().toString(36).slice(2) + '.pdf'); fs.writeFileSync(f, Buffer.from(pdfStr, 'latin1'));
  const r = cp.spawnSync('bash', ['-c', `pdftoppm -r 600 -f ${page} -l ${page} -png ${f} ${f}-p && python3 -c "import glob,zxingcpp,PIL.Image as I;r=zxingcpp.read_barcodes(I.open(sorted(glob.glob('${f}-p*.png'))[0]));print('|'.join(x.text for x in r))"`], { encoding: 'utf8' });
  return (r.stdout || '').trim() || (r.stderr || '').trim().slice(-120); };
const ITEM = { name: 'Comic Kinder Comics Midosville', number: '0814', upc: '075720000814', price: 19.99, regular: 24.99, dept: 'Books' };
(async () => {
  // 1. the 12 layouts: names, sizes, PDF pages and page size, ZPL size, barcode scans
  const want = ['2.25 x 1.25 label', '2.25 x 1.25 label Each', 'Custom 2.25 x 1.25 wPrice Label', 'Custom 2.25 x 1.25 Discounted Price', 'Item Label with List Price NEW FONT', 'Item-Label 1 X 2 - Barcode', 'Shelf Label 1.25 x 2.25', 'Shelf Label 1.5 x 3 Layout', 'Custom 2 x 4', 'PO Receiving 2.5 x 4', 'Custom Design STICKER2026', 'Custom Design CLEAR BIN LABELS'];
  rec('12 layouts with Ari\'s First Choice names, wPrice is the default', X.LAYOUTS.length === 12 && want.every(n => X.LAYOUTS.some(l => l.name === n)) && X.DEFAULT === 'wprice', X.LAYOUTS.map(l => l.id).join(','));
  rec('Only wPrice is marked matched to a sample; the others say "to be matched"', X.LAYOUTS.filter(l => l.matched).map(l => l.id).join() === 'wprice' && X.LAYOUTS.filter(l => !l.matched).every(l => /to be matched/i.test(l.note)), 'ok');
  for (const lay of X.LAYOUTS) {
    const parts = X.render(ITEM, lay.id, { dpi: 203, settings: L.norm({}), store: 'Sample Store', date: '11/1/2026' });
    const sizeOk = parts.every(p => p.W === Math.round(lay.w * 203) && p.H === Math.round(lay.h * 203));
    const svg = L.toSvg(parts[0]), vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) || [];
    const pdf = L.toPdfPages(parts.map(p => ({ L: p }))), bx = boxes(pdf);
    const zpl = L.toZpl(parts[0], L.norm({}), 1);
    const pdfOk = pdfPages(pdf) === lay.parts && bx.every(b => b[0] === Math.round(lay.w * 72) && b[1] === Math.round(lay.h * 72));
    const zplOk = new RegExp(`\\^PW${Math.round(lay.w * 203)}`).test(zpl) && new RegExp(`\\^LL${Math.round(lay.h * 203)}`).test(zpl);
    const inside = parts.every(p => p.items.every(i => i.t !== 'text' || (i.y >= 0 && i.y < p.H)));
    const hasBars = parts.some(p => p.items.some(i => i.t === 'bars'));
    const dec = hasBars ? decode(pdf, 1) : 'no barcode';
    rec(`Layout ${lay.id}: ${lay.w} x ${lay.h} in (SVG ${vb[1]}x${vb[2]} dots, PDF ${lay.parts} page(s) at ${Math.round(lay.w * 72)}x${Math.round(lay.h * 72)} pt, ZPL ^PW/^LL), text inside, barcode scans`,
      sizeOk && +vb[1] === parts[0].W && pdfOk && zplOk && inside && parts.length === lay.parts && (!hasBars || dec === '075720000814') && /\$19\.99/.test(parts.map(p => L.toSvg(p)).join('')),
      `${parts.length} part(s), boxes ${JSON.stringify(bx)}, decode ${dec}`);
  }
  // 2. wPrice like the sample: sticker 1 name/barcode/YOU PAY box/price; sticker 2 framed name + price
  { const [a, b] = X.render({ ...ITEM, regular: 19.99 }, 'wprice', { dpi: 203 }); const sa = L.toSvg(a), sb = L.toSvg(b);
    const box = a.items.find(i => i.t === 'box'), you = a.items.find(i => i.t === 'text' && i.s === 'YOU PAY'), fr = b.items.find(i => i.t === 'frame');
    rec('wPrice sticker 1: NAME IN CAPITALS on 2 lines, barcode, white YOU PAY in a black box, $19.99', /COMIC KINDER COMICS/.test(sa) && /MIDOSVILLE/.test(sa) && a.items.some(i => i.t === 'bars') && box && you && you.white && you.bold && /\$19\.99/.test(sa), JSON.stringify({ box: box && [box.x, box.y, box.w, box.h] }));
    rec('wPrice sticker 2: thin frame, Mixed Case name, bold $19.99 inside the frame', fr && /Comic Kinder Comics/.test(sb) && b.items.some(i => i.t === 'text' && i.role === 'price' && i.bold && i.x > fr.x && i.x < fr.x + fr.w && i.y > fr.y && i.y < fr.y + fr.h), JSON.stringify(fr && [fr.x, fr.y, fr.w, fr.h, fr.lw])); }
  // 3. frame primitive in all three outputs
  { const lay = { W: 100, H: 60, dpi: 203, items: [{ t: 'frame', x: 10, y: 10, w: 50, h: 30, lw: 2 }] };
    rec('Frame (outline) draws in SVG, PDF and ZPL', /fill="none"[^>]*stroke="#000"/.test(L.toSvg(lay)) && / re S/.test(L.toPdf(lay, 1)) && /\^GB50,30,2\^FS/.test(L.toZpl(lay, L.norm({}), 1)), 'ok'); }
  // 4. Label price: only the printout changes
  { const p = X.render(ITEM, 'wprice', { dpi: 203, labelPrice: 4.99 }), s = p.map(x => L.toSvg(x)).join('');
    rec('Label price 4.99 prints $4.99 instead of the AIR POS $19.99', /\$4\.99/.test(s) && !/\$19\.99/.test(s) && p[0].price === 4.99, 'ok');
    const d = X.render(ITEM, 'disc', { dpi: 203, labelPrice: 4.99 }), sd = L.toSvg(d[0]);
    rec('Discounted layout with a label price: was $24.99, now $4.99', /\$24\.99/.test(sd) && /\$4\.99/.test(sd), 'ok');
    rec('The item itself is not changed by a label price', ITEM.price === 19.99 && ITEM.regular === 24.99, JSON.stringify({ price: ITEM.price })); }
  // 5. barcode-in-price guard
  const G = (v, ap) => X.priceGuard(v, ap);
  const cases = [['', 19.99, true, null], ['4.99', 19.99, true, 4.99], ['$4.99', 19.99, true, 4.99], ['.5', 19.99, true, 0.5], ['12', 19.99, true, 12],
    ['075720000814', 19.99, false], ['75720000814', 19.99, false], ['123456', 19.99, false], ['12345', 19.99, false], ['1,299', 19.99, false], ['0', 19.99, false], ['abc', 19.99, false],
    ['4.999', 19.99, false], ['1500', 19.99, false], ['1500', 199.99, true, 1500], ['9999.99', 1000, true, 9999.99], ['-3', 19.99, false]];
  const bad = cases.filter(c => { const r = G(c[0], c[1]); return r.ok !== c[2] || (c[2] && r.value !== c[3]); });
  rec('Label price guard: prices pass; barcodes (6+ digits), 5-digit, commas, 0, text, 3 decimals, $1,000+ far above the AIR POS price are refused', !bad.length, bad.length ? JSON.stringify(bad) : cases.length + ' cases');
  rec('A barcode in the price box is sent to Lookup (toLookup), with a plain message', G('075720000814', 19.99).toLookup === true && /barcode/.test(G('075720000814').reason), G('075720000814').reason);
  const t0 = 1000, fast = Array.from({ length: 12 }, (_, i) => t0 + i * 8), slow = Array.from({ length: 12 }, (_, i) => t0 + i * 150);
  rec('Scanner burst detection: 12 digits at 8 ms = scanner; typed at 150 ms or short = not', X.isBurst(fast, '075720000814') && !X.isBurst(slow, '075720000814') && !X.isBurst(fast.slice(0, 4), '4.99') && !X.isBurst(fast, 'abcdefghijkl'), 'ok');
  // 6. defaults: item > department > all items > built-in; saved on this PC; override per row
  let m = mk({ sink: path.join(TMP, 'sink1') });
  let r = await m.lab.lookupRow('075720000814');
  rec('No defaults saved: built-in wPrice', r.ok && r.layout === 'wprice' && r.layoutFrom === 'built-in' && r.item.dept === 'Books' && r.item.cost === 11.5, JSON.stringify({ l: r.layout, f: r.layoutFrom }));
  m.lab.saveDefault({ kind: 'store', layout: 'std' }); r = await m.lab.lookupRow('1001');
  rec('"All items" default applies', r.layout === 'std' && r.layoutFrom === 'store', r.layout);
  m.lab.saveDefault({ kind: 'dept', key: 'BOOKS', layout: 'shelf15x3' }); r = await m.lab.lookupRow('1003');
  const r2 = await m.lab.lookupRow('1001');
  rec('Department default (any capitals) beats all-items; other departments keep all-items', r.layout === 'shelf15x3' && r.layoutFrom === 'department' && r2.layout === 'std', `${r.layout}/${r2.layout}`);
  m.lab.saveDefault({ kind: 'item', key: '0814', layout: 'c2x4' }); r = await m.lab.lookupRow('075720000814');
  rec('Item default beats department default', r.layout === 'c2x4' && r.layoutFrom === 'item', r.layout);
  const file = JSON.parse(fs.readFileSync(path.join(m.dir, 'label-layouts.json'), 'utf8'));
  rec('Defaults saved on this PC only (label-layouts.json), label-settings.json untouched', file.def === 'std' && file.items['0814'] === 'c2x4' && file.depts.books === 'shelf15x3' && !fs.existsSync(path.join(m.dir, 'label-settings.json')), JSON.stringify(file));
  r = await m.lab.printBatch({ rows: [{ code: '075720000814', copies: 1, layout: 'bc12' }], printer: 'DYMO LabelWriter 450' });
  let meta = lastMeta(m); rec('Override: a layout picked on the row beats the item default (prints bc12)', r.ok && meta.rows[0].layout === 'bc12', JSON.stringify(meta.rows));
  r = await m.lab.printBatch({ rows: [{ code: '075720000814', copies: 1 }], printer: 'DYMO LabelWriter 450' });
  meta = lastMeta(m); rec('No layout on the row: the item default is used', r.ok && meta.rows[0].layout === 'c2x4', meta.rows[0].layout);
  m.lab.saveDefault({ kind: 'item', key: '0814', layout: null }); r = await m.lab.lookupRow('075720000814');
  rec('Removing the item default falls back to the department', r.layout === 'shelf15x3' && r.layoutFrom === 'department', r.layout);
  rec('Unknown layout / no key refused', !m.lab.saveDefault({ kind: 'item', key: '1', layout: 'zzz' }).ok && !m.lab.saveDefault({ kind: 'dept', key: '', layout: 'std' }).ok, 'ok');
  rec('Print Labels printer: the receipt printer is refused', !m.lab.saveDefault({ kind: 'printer', printer: 'epson tm-t88v receipt' }).ok && m.lab.saveDefault({ kind: 'printer', printer: 'DYMO LabelWriter 450' }).ok && m.lab.layouts().printer === 'DYMO LabelWriter 450', 'ok');
  // 7. copies and several items (PDF driver path through the dev sink)
  m = mk({ sink: path.join(TMP, 'sink2') });
  r = await m.lab.printBatch({ rows: [{ code: '075720000814', copies: 3, layout: 'wprice' }, { code: '1001', copies: 2, layout: 'shelf15x3' }, { code: '1003', copies: 1, layout: 'bc12' }], printer: 'DYMO LabelWriter 450' });
  let pdf = lastFile(m, '.pdf'), bx = boxes(pdf);
  rec('3 items: wPrice x3 (2 stickers each) + shelf x2 + 1x2 x1 = 9 labels, 9 PDF pages, each at its own size', r.ok && r.total === 9 && pdfPages(pdf) === 9 && bx.slice(0, 6).every(b => b[0] === 162 && b[1] === 90) && bx.slice(6, 8).every(b => b[0] === 216 && b[1] === 108) && bx[8][0] === 144 && bx[8][1] === 72, `${r.total} labels, ${JSON.stringify(bx)}`);
  rec('Several items: the bars on the last page decode to the 3rd item', decode(pdf, 9) === '1003', decode(pdf, 9));
  r = await m.lab.printBatch({ rows: [{ code: '1001', copies: 0 }, { code: '1003', copies: 999 }], printer: 'DYMO LabelWriter 450' });
  rec('Copies kept to 1..50', r.ok && r.rows[0].copies === 1 && r.rows[1].copies === 50, JSON.stringify(r.rows.map(x => x.copies)));
  rec('Too many: 51 items or 500+ labels refused before printing', !(await m.lab.printBatch({ rows: Array(51).fill({ code: '1001' }) })).ok && !(await m.lab.printBatch({ rows: Array(11).fill({ code: '075720000814', copies: 50, layout: 'std' }) })).ok, 'ok');
  // 8. the label price only changes the printout; NO AIR POS writes; price never sent to AIR POS
  m = mk({ sink: path.join(TMP, 'sink3') });
  r = await m.lab.printBatch({ rows: [{ code: '075720000814', copies: 2, layout: 'wprice', labelPrice: '4.99' }, { code: '1001', copies: 1, layout: 'std', labelPrice: '' }], printer: 'DYMO LabelWriter 450' });
  pdf = lastFile(m, '.pdf'); meta = lastMeta(m);
  rec('Label price 4.99 is on the printout (meta), the other item keeps its AIR POS $10.00', r.ok && meta.rows[0].labelPrice === 4.99 && meta.rows[0].price === 19.99 && meta.rows[1].labelPrice == null && /\(\$4\.99\)/.test(pdf) && /\(\$10\.00\)/.test(pdf) && !/\(\$19\.99\)/.test(pdf), JSON.stringify(meta.rows));
  r = await m.lab.lookupRow('075720000814');
  rec('...and AIR POS still says $19.99 afterwards', r.item.price === 19.99, String(r.item.price));
  rec('Only the read-only scan lookup was called on AIR POS (no write calls at all)', m.calls.length > 0 && m.calls.every(k => k === 'scan' || k === 'priceCheck'), [...new Set(m.calls)].join(',') + ' x' + m.calls.length);
  rec('The label price never went to AIR POS (not in any api call)', !m.args.some(a => /4\.99/.test(a)), m.args.length + ' calls checked');
  // 9. server guard (even if the screen let it through)
  m = mk({ sink: path.join(TMP, 'sink4') });
  r = await m.lab.printBatch({ rows: [{ code: '075720000814', copies: 1, labelPrice: '075720000814' }], printer: 'DYMO LabelWriter 450' });
  rec('Server refuses a barcode as a label price; nothing printed', !r.ok && r.guard && /barcode/.test(r.message) && !lastFile(m, '.pdf'), r.message);
  r = await m.lab.printBatch({ rows: [{ code: '1001' }, { code: '075720000814', labelPrice: '1,999' }], printer: 'DYMO LabelWriter 450' });
  rec('One bad label price stops the whole batch (no half print)', !r.ok && !lastFile(m, '.pdf'), r.message);
  r = await m.lab.printBatch({ rows: [{ code: '1004', copies: 1 }], printer: 'DYMO LabelWriter 450' });
  const r3 = await m.lab.printBatch({ rows: [{ code: '1004', copies: 1, labelPrice: '3' }], printer: 'DYMO LabelWriter 450' });
  rec('No AIR POS price: refused unless a label price is typed', !r.ok && /no price/.test(r.message) && r3.ok, `${r.message} / ${r3.message}`);
  r = await m.lab.printBatch({ rows: [{ code: 'o' }], printer: 'DYMO LabelWriter 450' });
  rec('Several matches for a code: asks to pick one, nothing printed', !r.ok && /several/.test(r.message), r.message);
  // 10. printers: receipt refused, Zebra ZPL, PDF driver, no printer / no helper / Hebrew = print window
  m = mk();
  r = await m.lab.printBatch({ rows: [{ code: '1001' }], printer: 'EPSON TM-T88V Receipt' });
  rec('Never on the receipt printer', !r.ok && /receipt printer/.test(r.message) && m.hwc.length === 0, r.message);
  r = await m.lab.printBatch({ rows: [{ code: '075720000814', copies: 2, layout: 'wprice' }, { code: '1001', copies: 3, layout: 'std' }], printer: 'Zebra ZD220' });
  const z = m.hwc[0] && Buffer.from(m.hwc[0].a.base64, 'base64').toString('latin1');
  rec('Zebra: one ZPL job; wPrice 2 copies x 2 stickers = 4 labels, std ^PQ3', r.ok && r.via === 'zpl' && m.hwc.length === 1 && (z.match(/\^XA/g) || []).length === 5 && /\^PQ3/.test(z) && (z.match(/\^PQ1\b/g) || []).length === 4 && r.total === 7, `${r.total} labels, ${(z || '').length} bytes`);
  r = await m.lab.printBatch({ rows: [{ code: '1001', copies: 2, layout: 'c2x4' }], printer: 'DYMO LabelWriter 450' });
  const pd = m.hwc[1] && Buffer.from(m.hwc[1].b, 'base64').toString('latin1');
  rec('Other printers: PDF to the chosen printer at the label size (4 x 2 in)', r.ok && r.via === 'driver' && m.hwc[1].k === 'pdf' && m.hwc[1].p === 'DYMO LabelWriter 450' && pdfPages(pd) === 2 && boxes(pd).every(b => b[0] === 288 && b[1] === 144), JSON.stringify(boxes(pd || '')));
  r = await m.lab.printBatch({ rows: [{ code: '1001' }], printer: '' });
  rec('No printer picked: print window (with the reason)', r.ok && r.dialog && r.why === 'noPrinter' && m.hwc.length === 2, r.message);
  r = await m.lab.printBatch({ rows: [{ code: '1005' }], printer: 'DYMO LabelWriter 450' });
  rec('Hebrew name: print window (browser draws Hebrew)', r.ok && r.dialog && r.why === 'hebrew' && m.hwc.length === 2, r.message);
  r = await mk({ noHw: true }).lab.printBatch({ rows: [{ code: '1001' }], printer: 'DYMO LabelWriter 450' });
  rec('No printer helper on this PC: print window', r.ok && r.dialog && r.why === 'noHelper', r.message);
  // 11. PDF preview (nothing printed)
  m = mk();
  r = await m.lab.printBatch({ rows: [{ code: '075720000814', copies: 2, layout: 'wprice', labelPrice: '7.50' }, { code: '1001', layout: 'po' }], printer: 'Zebra ZD220', preview: true });
  const pv = r.pdf ? Buffer.from(r.pdf, 'base64').toString('latin1') : '';
  rec('Preview PDF: all 5 labels, real sizes, label price shown, nothing sent to a printer', r.ok && r.preview && pdfPages(pv) === 5 && /\(\$7\.50\)/.test(pv) && boxes(pv)[4][0] === 288 && boxes(pv)[4][1] === 180 && m.hwc.length === 0, JSON.stringify(boxes(pv)));
  // 12. wiring
  const app = p => fs.readFileSync(path.join(__dirname, '..', 'app', p), 'utf8');
  const srv = app('server.js'), sc = JSON.parse(app('shortcuts.json')), html = app('public/index.html'), ui = app('public/printlabels.js'), pl = app('public/printlabel.js');
  const all = []; (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { if (x.key && x.action) all.push(x); Object.values(x).forEach(walk); } })(sc);
  const ks = all.filter(e => e.key === 'Ctrl+Alt+L' || e.action === 'print-labels'), sp = all.filter(e => e.key === 'Ctrl+Shift+P');
  rec('No separate Ctrl+Alt+L / print-labels shortcut; Ctrl+Shift+P (action print-label, label text unchanged) is the only key and opens Print Labels', ks.length === 0 && sp.length === 1 && sp[0].action === 'print-label' && sp[0].label === 'Print Label: scan items to print price stickers on the label printer (the sale is not changed)' && /A\['print-label'\]\s*=\s*\(\)\s*=>\s*\(A\['print-labels'\]\s*\?\s*A\['print-labels'\]\(\)/.test(pl), JSON.stringify({ ks, sp }));
  rec('Routes need login and work when the register is locked like label-print', ['labels-layouts', 'labels-lookup', 'labels-default-save', 'labels-print'].every(k => new RegExp(`'${k}'\\s*:\\s*needLogin`).test(srv) && srv.includes(`'${k}'`) && new RegExp(`'label-print', [^\\n]*'${k}'`).test(srv)), 'ok');
  rec('Screen loaded after the label maker; A[print-labels]; button in Print Label mode', html.indexOf('/label.js') < html.indexOf('/labellayouts.js') && html.indexOf('/printlabel.js') < html.indexOf('/printlabels.js') && /A\['print-labels'\]\s*=/.test(ui) && /plLayouts/.test(pl), 'index.html');
  rec('Screen sends the label price only to labels-print (never to an AIR POS route)', !/api\('(?!labels-|printers)/.test(ui.replace(/api\('labels-(layouts|lookup|default-save|print)'/g, '')), 'printlabels.js api calls: ' + [...new Set(ui.match(/api\('[^']+'/g))].join(' '));
  rec('Mocked network: no real connection was attempted', NET.length === 0, NET.join(' | ') || 'none');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} label layouts tests passed`);
  fs.writeFileSync(path.join(__dirname, 'label-layouts-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
function lastFile(m, ext) { const d = m.lab.sink; let f = []; try { f = fs.readdirSync(d).filter(x => x.endsWith(ext)).sort(); } catch {} return f.length ? fs.readFileSync(path.join(d, f[f.length - 1]), 'latin1') : ''; }
function lastMeta(m) { const s = lastFile(m, '.json'); return s ? JSON.parse(s) : { rows: [] }; }

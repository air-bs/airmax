// Print Label (work copy, not released): the label maker (app/public/label.js) and the label service (app/labels.js)
// offline: a mocked AIR POS api + printer helper (no network, no real printer). Read-only: no sale, no inventory calls.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const L = require('../app/public/label.js');
const { Labels } = require('../app/labels');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const ITEMS = {
  '012345678912': { productId: 'p1', number: '1002', name: 'Toy car', upc: '012345678912', price: 3.99, oriPrice: 5 },
  '1001': { productId: 'p2', number: '1001', name: 'Bulk candy (lb)', upc: '012345678905', price: 10, oriPrice: 10 },
  '1003': { productId: 'p3', number: '1003', name: 'Rope (ft)', upc: '', price: 2 },
};
// item numbers the scan does not find directly (only by barcode), so the search returns A2, A20, A21 for "A2"
const AITEMS = {
  'A2': { productId: 'pa2', number: 'A2', name: 'Alpha ball', upc: '777000000002', price: 1.5, oriPrice: 2 },
  'A20': { productId: 'pa20', number: 'A20', name: 'Alpha cup', upc: '777000000020', price: 2.5 },
  'A21': { productId: 'pa21', number: 'A21', name: 'Alpha hat', upc: '777000000021', price: 3.5 },
};
function mk(opt = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-')), calls = [], hwc = [];
  const reg = {
    printerName: () => opt.receipt || 'EPSON TM-T88V Receipt',
    api: new Proxy({}, { get: (_, k) => async code => { calls.push(String(k)); if (k !== 'scan') throw new Error('unexpected api ' + String(k)); const s = ITEMS[code] || Object.values(ITEMS).find(x => x.number === code) || Object.values(AITEMS).find(x => x.upc === code); return { success: true, value: s || { productId: '00000000-0000-0000-0000-000000000000' } }; } }),
    priceCheck: async q => { calls.push('priceCheck'); const ql = String(q).toLowerCase(); const l = Object.values(ITEMS).filter(x => x.name.toLowerCase().includes(ql)).concat(Object.values(AITEMS).filter(x => x.number.toLowerCase().includes(ql))); return l.length ? { ok: true, list: l } : { ok: false, message: `Nothing found for "${q}"` }; },
    hw: opt.noHw ? { present: false } : { present: true, request: async (k, a) => { hwc.push({ k, a }); return opt.hwFail ? { ok: false, error: 'paper out' } : { ok: true }; }, printPdf: async (b, p) => { hwc.push({ k: 'pdf', b, p }); return { ok: true }; } },
  };
  return { lab: new Labels({ dataDir: dir, reg, log: () => {} }), dir, calls, hwc };
}
(async () => {
  // label maker
  const d = L.norm({});
  rec('Defaults: 2.25 x 1.25 in, tag YOU PAY, "Reg. $x" line off, 1 copy, no printer (system dialog)', d.w === 2.25 && d.h === 1.25 && d.tag === 'YOU PAY' && d.show.regPrice === false && d.show.name && d.show.price && d.show.barcode && d.copies === 1 && d.printer === '', JSON.stringify(d));
  const n = L.norm({ copies: 999, size: 'custom', w: 99, h: 0, method: 'evil', font: 'x', tag: 'A\u0000B', extra: 1, show: { regPrice: 1 } });
  rec('Settings are cleaned (copies 1..50, size limits, unknown values dropped)', n.copies === 50 && n.w === 6 && n.h === 0.5 && n.method === 'auto' && n.font === 'normal' && n.tag === 'AB' && !('extra' in n) && n.show.regPrice === true, JSON.stringify(n));
  const pr = L.prices({ price: 3.99, regular: 5 }, d), pr2 = L.prices({ price: 3.99, regular: 5 }, { ...d, priceMode: 'regular' }), pr3 = L.prices({ price: 10, regular: 10 }, d);
  rec('On sale the SALE price prints (regular only when set)', pr.price === 3.99 && pr.onSale && pr.regular === 5 && pr2.price === 5 && pr3.onSale === false && pr3.price === 10, JSON.stringify([pr, pr2, pr3]));
  const lay = L.layout({ name: 'Toy car', upc: '012345678912', price: 3.99, regular: 5 }, d), svg = L.toSvg(lay);
  rec('Label shows name (capitals), sale price and barcode; no Reg. line by default', /TOY CAR/.test(svg) && /\$3\.99/.test(svg) && !/Reg\./.test(svg) && /<rect/.test(svg) && lay.code === '012345678912', `code ${lay.code}, svg ${svg.length} chars`);
  const svgR = L.toSvg(L.layout({ name: 'Toy car', upc: '1', price: 3.99, regular: 5 }, { ...d, show: { ...d.show, regPrice: true } }));
  rec('"Reg. $x" line appears (struck) when ticked', /Reg\. \$5\.00/.test(svgR) && /<line/.test(svgR), 'ok');
  const c = L.code128('012345678912'), c2 = L.code128('AB-12');
  const chk = x => { const v = x.codes; const s = v.slice(0, -2).reduce((a, k, i) => a + (i ? k * i : k), 0) % 103; return s === v[v.length - 2] && v[v.length - 1] === 106; };
  rec('Code 128: digits use set C, text uses set B, checksum right', c.set === 'C' && c2.set === 'B' && chk(c) && chk(c2), `${c.codes.length}/${c2.codes.length} codes`);
  const zpl = L.toZpl(lay, d, 3);
  rec('ZPL: label size, copies, barcode, sale price', /^\^XA/.test(zpl) && /\^PW457/.test(zpl) && /\^LL254/.test(zpl) && /\^PQ3/.test(zpl) && /\^BC/.test(zpl) && /\$3\.99/.test(zpl) && /\^XZ\s*$/.test(zpl), zpl.length + ' bytes');
  rec('Printer detection: Zebra = ZPL, others = driver', L.isZpl('Zebra ZD220', 'auto') && L.isZpl('ZDesigner GK420d', 'auto') && !L.isZpl('DYMO LabelWriter 450', 'auto') && !L.isZpl('Zebra', 'driver'), 'ok');
  const pdf = L.toPdf(lay, 2), pf = path.join(os.tmpdir(), 'pl-unit.pdf'); fs.writeFileSync(pf, Buffer.from(pdf, 'latin1'));
  const pages = (pdf.match(/\/Type \/Page\b/g) || []).length;
  rec('PDF: one page per copy at 2.25 x 1.25 in', /^%PDF-/.test(pdf) && pages === 2 && /MediaBox \[0 0 16[12](\.\d+)? 90(\.\d+)?\]/.test(pdf), `${pages} pages`);
  // the barcode really scans (render the PDF, decode it)
  const dec = cp.spawnSync('bash', ['-c', `pdftoppm -r 600 -f 1 -l 1 -png ${pf} /tmp/pl-unit && python3 -c "import zxingcpp,PIL.Image as I;r=zxingcpp.read_barcodes(I.open('/tmp/pl-unit-1.png'));print('|'.join(x.format.name+':'+x.text for x in r))"`], { encoding: 'utf8' });
  rec('Printed barcode decodes back to the item code', (dec.stdout || '').trim() === 'Code128:012345678912', (dec.stdout || dec.stderr || '').trim().slice(0, 120));
  // label service
  let m = mk({ noHw: true });
  let r = await m.lab.print({ code: '012345678912' });
  rec('No label printer chosen: system print dialog, sale price from AIR POS', r.ok && r.dialog && r.price === 3.99 && r.onSale && r.regular === 5, JSON.stringify({ ok: r.ok, dialog: r.dialog, price: r.price }));
  rec('Read-only: only the item lookup was called', m.calls.every(k => k === 'scan' || k === 'priceCheck'), m.calls.join(','));
  m = mk();
  r = m.lab.save({ settings: { printer: 'EPSON TM-T88V Receipt' } });
  rec('Refuses the receipt printer as the label printer', !r.ok && /receipt printer/.test(r.message) && !fs.existsSync(path.join(m.dir, 'label-settings.json')), r.message);
  r = m.lab.save({ settings: { printer: 'Zebra ZD220', copies: 2, tag: 'NOW' } });
  const saved = JSON.parse(fs.readFileSync(path.join(m.dir, 'label-settings.json'), 'utf8'));
  rec('Saves settings on this PC only (label-settings.json)', r.ok && saved.printer === 'Zebra ZD220' && saved.tag === 'NOW' && m.lab.get().settings.copies === 2, JSON.stringify({ printer: saved.printer, tag: saved.tag }));
  r = await m.lab.print({ code: '012345678912', copies: 4 });
  const raw = m.hwc[0] && Buffer.from(m.hwc[0].a.base64, 'base64').toString('latin1');
  rec('Zebra: raw ZPL to the label printer, copies x4, sale price, tag', r.ok && r.via === 'zpl' && m.hwc.length === 1 && m.hwc[0].k === 'raw' && m.hwc[0].a.printer === 'Zebra ZD220' && /\^PQ4/.test(raw) && /\$3\.99/.test(raw) && /NOW/.test(raw), r.message);
  r = await m.lab.print({ code: '1001', copies: 0 });
  rec('Copies 0 -> uses the saved default (2)', r.ok && r.copies === 2, 'copies ' + r.copies);
  r = await m.lab.print({ code: '1001', copies: 500 });
  rec('Copies capped at 50', r.ok && r.copies === 50, 'copies ' + r.copies);
  r = await m.lab.print({ code: 'rope' });
  rec('One name match prints that item', r.ok && r.item.number === '1003', r.message);
  r = await m.lab.lookup('o');
  rec('Several matches: a pick list (nothing printed)', r.ok && Array.isArray(r.list) && r.list.length === 2, (r.list || []).length + ' items');
  r = await m.lab.lookup('A2');
  rec('Exact item number "A2" goes straight to that item (no pick list of A2, A20, A21)', r.ok && !r.list && r.item && r.item.number === 'A2' && r.item.price === 1.5 && r.item.regular === 2, JSON.stringify(r.item || r.list));
  r = await m.lab.lookup('a2');
  rec('Exact match ignores capitals ("a2" = A2)', r.ok && !r.list && r.item && r.item.number === 'A2', JSON.stringify(r.item || r.list));
  r = await m.lab.lookup('777000000020');
  rec('Exact barcode goes straight to that item', r.ok && !r.list && r.item && r.item.number === 'A20', JSON.stringify(r.item || r.list));
  r = await m.lab.lookup('A');
  rec('Partial "A" still shows the pick list (A2, A20, A21)', r.ok && Array.isArray(r.list) && ['A2', 'A20', 'A21'].every(n => r.list.some(x => x.number === n)) && !r.item, (r.list || []).map(x => x.number).join(','));
  let hw0 = m.hwc.length; r = await m.lab.print({ code: 'A2' });
  rec('Print Label "A2": prints the A2 label once', r.ok && r.item.number === 'A2' && m.hwc.length === hw0 + 1, r.message);
  hw0 = m.hwc.length; r = await m.lab.print({ code: 'A' });
  rec('Print Label "A": list only, nothing printed', r.ok && Array.isArray(r.list) && m.hwc.length === hw0, (r.list || []).length + ' items');
  const before = m.hwc.length; r = await m.lab.print({ code: 'nope-xyz' });
  rec('Unknown code: clear message, nothing printed', !r.ok && /Nothing found/.test(r.message) && m.hwc.length === before, r.message);
  m.lab.save({ settings: { printer: 'DYMO LabelWriter 450' } }); r = await m.lab.print({ test: true });
  rec('Other printers: PDF through the printer driver; test label uses the sample item', r.ok && r.via === 'driver' && m.hwc[m.hwc.length - 1].k === 'pdf' && r.item.name === L.SAMPLE.name, r.message);
  m = mk({ hwFail: true }); m.lab.save({ settings: { printer: 'Zebra ZD220' } }); r = await m.lab.print({ code: '1001' });
  rec('Printer error is reported, not hidden', !r.ok && /paper out/.test(r.message), r.message);
  // wiring
  const sj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'shortcuts.json'), 'utf8')), flat = JSON.stringify(sj);
  rec('Keys: Ctrl+Shift+P = Print Label, Ctrl+8 = Settings > Labels', /print-label/.test(flat) && /settings-labels/.test(flat), 'shortcuts.json');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'app', 'server.js'), 'utf8');
  rec('Server routes need login', ['label-settings', 'label-settings-save', 'label-lookup', 'label-print'].every(k => new RegExp(`'${k}'\\s*:\\s*needLogin`).test(srv)), 'routes');
  const bs = fs.readFileSync(path.join(__dirname, '..', 'build.sh'), 'utf8');
  rec('Installer build includes app/labels.js', /cp -r [^\n]*app\/\*\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'stage-app.sh'), 'utf8')) && fs.existsSync(path.join(__dirname, '..', 'app/labels.js')), 'stage-app.sh');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} print label tests passed`);
  fs.writeFileSync(path.join(__dirname, 'print-label-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

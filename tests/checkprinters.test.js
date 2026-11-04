// Work copy (NOT released). 1.0.10-local.2 (Nov 1): Check printers, Reprint Receipt = last receipt, Gift Receipt reprint,
// label messages and the bigger label name. Mocked helper / AIR POS, no hardware, nothing about sales or money is touched.
// Usage: node tests/checkprinters.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const APP = path.join(__dirname, '../app');
const { Register } = require(path.join(APP, 'lib/register'));
const { PrinterCheck, STEPS } = require(path.join(APP, 'printcheck'));
const { Reprint, NONE } = require(path.join(APP, 'reprint'));
const { Labels } = require(path.join(APP, 'labels'));
const L = require(path.join(APP, 'public/label'));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const STAR = { name: 'Star TSP100 Cutter (TSP143)', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001', datatype: 'RAW', printProcessor: 'STPrint' };
const COPY = { name: 'Star TSP100 Cutter (TSP143) (Copy 2)', driver: 'Generic / Text Only', port: 'USB001', datatype: 'RAW', printProcessor: 'winprint' };
const EPS = { name: 'EPSON TM-T88V Receipt', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB002' };
const PDF = { name: 'Microsoft Print to PDF', driver: 'Microsoft Print To PDF', port: 'PORTPROMPT:', virtual: true };
function make({ settings = {}, details = [STAR], resolved = STAR.name, raw, pdf, hw = true, templates } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-cp-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: '', printMethod: 'auto', printerType: 'auto', drawerPin: 2, drawerPulse: 200, drawerWaitSec: 5 }, settings);
  const calls = [];
  reg.hw = !hw ? { present: false } : { present: true,
    printers: async () => ({ ok: true, value: { printers: details.map(d => d.name), default: resolved, resolved, details } }),
    renderMono: async () => ({ ok: true, value: { width: 8, height: 1, data: 'AA==' } }),
    printPdf: async (b64, name) => { calls.push({ k: 'pdf', name }); return pdf ? pdf(name) : { ok: true, value: 'printed' }; },
    request: async (kind, a) => {
      if (kind === 'raw') { calls.push({ k: 'raw', name: a.printer, bytes: Buffer.from(a.base64, 'base64') }); return raw ? raw(a) : { ok: true, value: 'printed' }; }
      calls.push({ k: kind }); return { ok: true, value: [] };
    } };
  reg.api.billTemplateConfigGet = async () => ({ success: true, value: { orderPrintId: 'op', defaultTemplateId: 't1', templates: templates || [{ id: 't1', name: 'Receipt', fields: [] }, { id: 'tg', name: 'Gift Receipt', fields: [] }] } });
  reg.api.billContentGet = async (...a) => { calls.push({ k: 'content', a: JSON.stringify(a) }); return { success: true, value: { billBase64: 'JVBERi0x' } }; };
  reg.api.printBillContent = async () => { calls.push({ k: 'airpos-print' }); return { success: true }; };
  reg.api.openCashbox = async () => { calls.push({ k: 'airpos-drawer' }); return { success: true }; };
  return { reg, calls, dir };
}
const kinds = c => c.map(x => x.k).join(',');
(async () => {
  // ---------- A. Check printers: list + flags + suggestion, read-only ----------
  { const t = make({ settings: { printerName: COPY.name }, details: [STAR, COPY, EPS, PDF], resolved: COPY.name });
    const before = JSON.stringify(t.reg.settings), ck = new PrinterCheck({ reg: t.reg });
    const r = await ck.list(); const q = n => r.queues.find(x => x.name === n), fk = n => q(n).flags.map(f => f.k).join(',');
    rec('A1 lists every Windows queue with driver, port, datatype, print processor', r.ok && r.queues.length === 4 && q(STAR.name).datatype === 'RAW' && q(STAR.name).printProcessor === 'STPrint' && q(COPY.name).port === 'USB001', r.queues.map(x => `${x.name}|${x.driver}|${x.port}|${x.datatype}|${x.printProcessor}`).join(' / '));
    rec('A2 flags the "(Copy 2)" queue: copy + Generic / Text Only', /copy/.test(fk(COPY.name)) && /textOnly/.test(fk(COPY.name)), fk(COPY.name));
    rec('A3 flags a vendor name with another vendor\'s driver (EPSON name on a Star driver)', /mismatch/.test(fk(EPS.name)), fk(EPS.name));
    rec('A4 the plain Star futurePRNT queue has no problem flag; Print to PDF is only marked "not a real printer"', !q(STAR.name).flags.some(f => f.bad) && q(PDF.name).flags.every(f => !f.bad), fk(STAR.name) + ' / ' + fk(PDF.name));
    rec('A5 suggests the real Star queue (same name without "(Copy 2)")', r.suggest && r.suggest.name === STAR.name, JSON.stringify(r.suggest));
    rec('A6 read-only: no setting changed, nothing printed, nothing sent to Windows', JSON.stringify(t.reg.settings) === before && t.calls.length === 0, kinds(t.calls) || 'no calls');
    rec('A7 the message says what is wrong in plain words', /Copy N|copy/i.test(r.message) && /random symbols/.test(r.message), r.message); }
  { const t = make({ hw: false }); const r = await new PrinterCheck({ reg: t.reg }).list();
    rec('A8 helper missing: says so (AirRegisterHw.exe) and how to fix it', !r.ok && r.helperMissing && /AirRegisterHw\.exe/.test(r.message) && /Reinstall/.test(r.message), r.message);
    const tr = await new PrinterCheck({ reg: t.reg }).tests();
    rec('A9 helper missing: the test set sends nothing and repeats why', !tr.ok && tr.steps.length === 0 && /missing/.test(tr.message), tr.message); }
  // ---------- B. test set: text, logo, long, cut; direct + Windows driver; drawer never ----------
  { const t = make({ settings: { printerName: STAR.name }, details: [STAR], resolved: STAR.name }); const ck = new PrinterCheck({ reg: t.reg });
    const r = await ck.tests();
    rec('B1 8 steps: text / logo / long / cut, each Direct and through the Windows driver', r.steps.length === 8 && STEPS.every(s => r.steps.some(x => x.step === s.id && x.mode === 'raw') && r.steps.some(x => x.step === s.id && x.mode === 'driver')), r.steps.map(s => s.step + ':' + s.mode).join(' '));
    rec('B2 all sent: 4 raw jobs + 4 driver PDFs to the Star queue', r.ok && t.calls.filter(c => c.k === 'raw').length === 4 && t.calls.filter(c => c.k === 'pdf' && c.name === STAR.name).length === 4, kinds(t.calls));
    rec('B3 the drawer is never opened by the test set', !t.calls.some(c => /drawer/i.test(c.k)) && !t.calls.some(c => c.k === 'raw' && c.bytes.length <= 8), kinds(t.calls));
    rec('B4 results are in Save diagnostics (report)', /Check printers/.test(ck.report()) && /8\. Paper cut \(Windows driver\): sent ok/.test(ck.report()), ck.report().split('\r\n').slice(-2).join(' | ')); }
  { const t = make({ settings: { printerName: STAR.name }, details: [STAR], resolved: STAR.name, pdf: () => ({ ok: false, error: "Printer 'Star' is out of paper. [diag: job 0x2]" }) });
    const r = await new PrinterCheck({ reg: t.reg }).tests();
    rec('B5 a failed step is reported in plain words (step, name, mode, reason; no [diag] codes)', !r.ok && /Step 5 "Plain text" \(Windows driver\) failed: .*out of paper/.test(r.message) && !/\[diag/.test(r.message), r.message.split('\n')[0]); }
  { const t = make({ settings: { printerName: COPY.name }, details: [STAR, COPY], resolved: COPY.name });
    const r = await new PrinterCheck({ reg: t.reg }).tests();
    rec('B6 Star on a Text Only "(Copy 2)" queue: nothing sent in either mode (no "bbbb" paper), each step says why', !r.ok && t.calls.filter(c => c.k === 'raw' || c.k === 'pdf').length === 0 && r.steps.every(s => !s.ok && /Text Only|random symbols/.test(s.error)), kinds(t.calls) || 'nothing sent'); }
  // ---------- C. Reprint Receipt = the last receipt, never History ----------
  { const t = make(); const shop = () => 'testshop'; t.reg.lastOrderId = 'o-77';
    const rp = new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: shop }); rp.note();
    const r = await rp.lastReceipt();
    rec('C1 normal: the last sale of this session', r.ok && r.orderId === 'o-77' && r.via === 'this session', JSON.stringify(r));
    t.reg.lastOrderId = null; let looked = 0; t.reg.api.orderPaged = async () => { looked++; return { rows: [] }; };
    const r2 = await new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: shop }).lastReceipt();
    rec('C2 after a restart: the saved id is reprinted (no look-up needed)', r2.ok && r2.orderId === 'o-77' && /saved/.test(r2.via) && looked === 0, JSON.stringify(r2)); }
  { const t = make(); t.reg.lastOrderId = null; const asked = [];
    t.reg.api.orderPaged = async (...a) => { asked.push(a); return { rows: [{ id: 'v1', number: 'N9', status: 30 }, { id: 'c2', number: 'N8', status: 20 }, { id: 'c1', number: 'N7', status: 20 }] }; };
    const r = await new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: () => 'testshop' }).lastReceipt();
    rec('C3 nothing saved: read-only history look-up, newest COMPLETED sale only (a voided one is skipped)', r.ok && r.orderId === 'c2' && asked.length === 1 && !t.calls.length, JSON.stringify(r));
    t.reg.api.orderPaged = async () => ({ rows: [{ id: 'a', status: 20, terminalId: 'T2' }, { id: 'b', status: 20, terminalId: 'T1' }] }); t.reg.term = () => ({ id: 'T1' });
    const r2 = await new Reprint({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rp-')), reg: t.reg, shopKey: () => 'testshop' }).lastReceipt();
    rec('C4 when the history rows say which register: this register\'s sale', r2.ok && r2.orderId === 'b', JSON.stringify(r2)); }
  { const t = make(); t.reg.lastOrderId = null; t.reg.api.orderPaged = async () => ({ rows: [] });
    const r = await new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: () => 'testshop' }).lastReceipt();
    rec('C5 nothing found: "No recent receipt to reprint"', !r.ok && r.none && r.message === NONE && NONE === 'No recent receipt to reprint', JSON.stringify(r)); }
  { const app = fs.readFileSync(path.join(APP, 'public/app.js'), 'utf8'), body = (n) => { const i = app.indexOf('async function ' + n + '('); return app.slice(i, app.indexOf('\n}\n', i)); };
    rec('C6 screen: Reprint (Ctrl+P) prints the last receipt and never opens History', /'reprint': \(\) => reprintLast\(\)/.test(app) && !/historyDialog/.test(body('reprintLast')) && /No recent receipt to reprint/.test(body('reprintLast')), 'reprintLast');
    const sc = JSON.parse(fs.readFileSync(path.join(APP, 'shortcuts.json'), 'utf8')), list = Array.isArray(sc) ? sc : (sc.shortcuts || sc.keys || []);
    const keys = list.map(x => x.key), g = list.find(x => x.action === 'reprint-gift'), p = list.find(x => x.action === 'reprint');
    rec('C7 Gift Receipt key Ctrl+Alt+P is new and unique; Reprint stays Ctrl+P; History button still there', g && g.key === 'Ctrl+Alt+P' && keys.filter(k => k === 'Ctrl+Alt+P').length === 1 && p && p.key === 'Ctrl+P' && /\['Reprint Receipt', 'Ctrl \+ P', 'reprint'\]/.test(app) && /\['Gift Receipt', 'Ctrl \+ Alt \+ P', 'reprint-gift'\]/.test(app) && /historyDialog/.test(app), JSON.stringify(g));
    rec('C8 History: a "Gift receipt" button on completed orders', /data-gift/.test(app) && /gift-reprint/.test(app), 'data-gift'); }
  // ---------- D. Gift receipt reprint ----------
  { const t = make(); t.reg.lastOrderId = 'o-5';
    const r = await new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: () => 'testshop' }).gift();
    const c = t.calls.filter(x => x.k === 'content');
    rec('D1 gift: the AIR POS "Gift Receipt" template is used (template tg), not the priced receipt', r.ok && c.length === 1 && /"tg"/.test(c[0].a) && !/"t1"/.test(c[0].a) && /Gift receipt printed \(Gift Receipt\)/.test(r.message), JSON.stringify({ ok: r.ok, m: r.message, a: c[0] && c[0].a })); }
  { const t = make({ templates: [{ id: 't1', name: 'Receipt', fields: [] }] }); t.reg.lastOrderId = 'o-6';
    const r = await new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: () => 'testshop' }).gift();
    rec('D2 no gift template in AIR POS: NOTHING prints (never a receipt with prices) and the reason is shown', !r.ok && !t.calls.some(x => x.k === 'content' || x.k === 'raw' || x.k === 'pdf' || x.k === 'airpos-print') && /no gift receipt template/.test(r.message), r.message); }
  { const t = make(); t.reg.lastOrderId = null; t.reg.api.orderPaged = async () => ({ rows: [] });
    const r = await new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: () => 'testshop' }).gift();
    rec('D3 gift, nothing found: "No recent sale to print a gift receipt for", nothing printed', !r.ok && r.none && /No recent sale/.test(r.message) && !t.calls.length, r.message); }
  { const t = make(); const r = await new Reprint({ dataDir: t.dir, reg: t.reg, shopKey: () => 'testshop' }).gift('h-1');
    rec('D4 gift from History: that order id, gift template', r.ok && r.orderId === 'h-1' && /"tg"/.test((t.calls.find(x => x.k === 'content') || {}).a || ''), r.orderId); }
  { const src = fs.readFileSync(path.join(APP, 'lib/register.js'), 'utf8');
    rec('D5 register.js:691 note names the real keys (Reprint Receipt Ctrl+P / Gift Receipt Ctrl+Alt+P)', /Reprint Receipt \(Ctrl\+P\)/.test(src) && /Gift Receipt \(Ctrl\+Alt\+P\)/.test(src), 'ok'); }
  // ---------- E. Labels: clear message instead of a silent print window ----------
  { const mk = (st, hw) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-')); const reg = { printerName: () => 'Star TSP100 Cutter (TSP143)', api: {}, hw: hw ? { present: true, request: async () => ({ ok: true }), printPdf: async () => ({ ok: true }) } : { present: false } };
      const lab = new Labels({ dataDir: dir, reg, log: () => {} }); fs.writeFileSync(lab.file, JSON.stringify(st)); return lab; };
    const a = await mk({}, true).print({ test: true }), b = await mk({ printer: 'Zebra ZD220', method: 'dialog' }, true).print({ test: true }), c = await mk({ printer: 'Zebra ZD220' }, false).print({ test: true });
    rec('E1 no label printer: says why (no label printer set) and asks the cashier to open the print window', a.dialog && a.why === 'noPrinter' && /no label printer is set in Settings > Labels/.test(a.message) && /Open print window/.test(a.message), a.message);
    rec('E2 method = print window: says that Settings > Labels is set to the print window', b.dialog && b.why === 'method' && /set to print through the Windows print window/.test(b.message), b.message);
    rec('E3 helper missing: says the helper is not available and names the label printer', c.dialog && c.why === 'noHelper' && /printer helper is not available/.test(c.message) && /Zebra ZD220/.test(c.message), c.message);
    const pl = fs.readFileSync(path.join(APP, 'public/printlabel.js'), 'utf8');
    rec('E4 screen: the print window opens only from "Open print window" (button / Enter), never by itself', /PENDING = \(\) =>/.test(pl) && /Open print window/.test(pl) && !/if \(r && r\.ok && r\.dialog\) printDialog\(/.test(pl) && !/if \(r\.ok && r\.dialog\) printDialog\(/.test(pl), 'printlabel.js'); }
  // ---------- F. Label name size (Ari 11:53) ----------
  { const item = { name: 'Spinning Musical Dreidel', number: '20417', upc: '0718122034567', price: 8.99 }, short = { name: 'Toy car', number: '1', upc: '0718122034567', price: 3.99 };
    const names = l => l.items.filter(x => x.role === 'name'), price = l => l.items.find(x => x.role === 'price');
    const lw = L.layout(item, L.norm({}));
    rec('F1 long name wraps to 2 lines (full words, nothing cut) before shrinking', names(lw).length === 2 && names(lw).map(x => x.s).join(' ') === 'SPINNING MUSICAL DREIDEL' && names(lw)[0].size >= Math.round(lw.H * 0.11), names(lw).map(x => x.s + '@' + x.size).join(' | '));
    const n0 = names(L.layout(short, L.norm({})))[0].size, nL = names(L.layout(short, L.norm({ font: 'large' })))[0].size, nX = names(L.layout(short, L.norm({ nameSize: 'xlarge' })))[0].size;
    rec('F2 Extra large name is about 1.5x the normal name (and bigger than Large)', nX >= Math.round(n0 * 1.5) && nX > nL, `normal ${n0}, large ${nL}, extra large ${nX}`);
    const nb = names(L.layout(short, L.norm({ show: { barcode: false } })))[0].size;
    rec('F3 barcode hidden: the name gets that space (bigger)', nb > n0, `with barcode ${n0}, without ${nb}`);
    rec('F4 existing sizes kept: Small / Normal / Large and the default layout name size unchanged', JSON.stringify(L.FONTS) === '{"small":0.85,"normal":1,"large":1.15}' && n0 === Math.round(L.layout(short, L.norm({})).H * 0.13) && L.norm({}).nameSize === 'same' && L.norm({ nameSize: 'evil' }).nameSize === 'same', JSON.stringify(L.FONTS));
    // price must stay whole and readable, nothing overlapping, on every size incl. the smallest
    let bad = []; const minPs = [];
    for (const sz of L.SIZES.filter(x => x[0] !== 'custom').map(x => x[0])) for (const ns of ['same', 'large', 'xlarge']) for (const font of ['small', 'normal', 'large']) for (const bc of [true, false]) for (const dg of [false, true]) for (const it of [item, short, { ...item, name: 'Extra Long Deluxe Rainbow Spinning Musical Light Up Dreidel With Batteries', price: 1234.99 }]) {
      const s = L.norm({ size: sz, nameSize: ns, font, show: { barcode: bc, digits: dg, sku: true } }), l = L.layout(it, s), p = price(l);
      const tag = l.items.find(x => x.t === 'box'), bars = l.items.find(x => x.t === 'bars'), nm = names(l), nBottom = nm.length ? nm[nm.length - 1].y + nm[nm.length - 1].size : 0;
      const pad = Math.round(Math.min(l.W, l.H) * 0.06);
      const issues = [];
      if (!p || p.s !== L.money(it.price)) issues.push('price text ' + (p && p.s));
      if (p && (p.size < Math.round(l.H * 0.17) || p.y + p.size > l.H)) issues.push('price size/pos ' + (p && p.size));
      if (p && L.textW(p.s, p.size, false) > l.W - 2 * pad) issues.push('price too wide');
      if (bars && nBottom > bars.y + 1) issues.push('name over barcode');
      const top = tag ? tag.y : p.y; if (bars && bars.y + bars.h > top) issues.push('barcode over price');
      if (!bars && nBottom > top + 2) issues.push('name over price');
      if (issues.length) bad.push(`${sz}/${ns}/${font}/${bc ? 'bc' : '-'}${dg ? 'd' : ''}/${it.name.slice(0, 10)}: ${issues.join(', ')}`);
      if (sz === '1.5x1') minPs.push(p.size);
    }
    rec('F5 price stays whole ($1,234.99 too), readable and clear of the name / barcode on every sticker size, incl. the smallest 1.5 x 1 in', !bad.length, bad.length ? bad.slice(0, 4).join(' ; ') + (bad.length > 4 ? ` (+${bad.length - 4})` : '') : `smallest price on 1.5x1: ${Math.min(...minPs)} dots (${(Math.min(...minPs) / 203).toFixed(2)} in)`);
    const s = L.norm({ size: '1.5x1', nameSize: 'xlarge' }), l = L.layout(item, s), z = L.toZpl(l, s, 1), pdf = L.toPdf(l, 1), svg = L.toSvg(l);
    rec('F6 ZPL, PDF and the preview all carry both name lines and the full price', ['SPINNING', 'MUSICAL DREIDEL', '$8.99'].every(t => z.includes('^FD' + t + '^FS') && pdf.includes('(' + t + ')') && svg.includes('>' + t + '<')), 'zpl/pdf/svg'); }
  const fails = out.filter(x => !x.pass);
  console.log(`\n${out.length - fails.length}/${out.length} check-printers / reprint / gift / label tests passed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

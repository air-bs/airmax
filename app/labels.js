// AirMax Print Label (Ari OK 2:30 PM ET Oct 30, 2026). READ-ONLY: looks an item up (the same AIR POS scan lookup Price Check
// uses) and prints a sticker on the LABEL printer. Never adds a sale line, never touches the cart, totals, payments, inventory
// or AIR POS data. Kept OUT of app/lib (frozen) and out of settings.json: its own file label-settings.json on this PC.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./public/label');
const LL = require('./public/labellayouts'); // 1.0.11-local.9 Label Layouts (First Choice layouts, label price, default layout)

const EMPTY = '00000000-0000-0000-0000-000000000000';
const val = r => (r && typeof r === 'object' && 'success' in r && 'value' in r ? r.value : r);
const fail = (message, x) => ({ ok: false, message, ...(x || {}) });
const fromScan = s => { const reg = s.originalPrice ?? s.oriPrice ?? s.retailPrice; return { name: s.name || '', number: s.number || '', upc: s.upc || '', price: Number(s.price), regular: reg == null ? null : Number(reg), dept: s.categoryName || '', cost: s.costPrice == null ? null : Number(s.costPrice) }; }; // dept / cost: local9, shown on the Print Labels grid (read only)
const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

class Labels {
  constructor({ dataDir, reg, log, sink } = {}) {
    this.layFile = path.join(dataDir, 'label-layouts.json'); // local9: default layout per item / department, this PC only
    this.file = path.join(dataDir, 'label-settings.json'); this.reg = reg; this.log = log || (() => {}); this.sink = sink || null;
  }
  settings() { try { return L.norm(JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { return L.norm({}); } }
  receiptPrinter() { try { return (this.reg.printerName && this.reg.printerName()) || ''; } catch { return ''; } }
  hwPresent() { return !!(this.sink || (this.reg.hw && this.reg.hw.present)); }
  get() { return { ok: true, settings: this.settings(), receiptPrinter: this.receiptPrinter(), direct: this.hwPresent() }; }
  save(b) {
    const s = L.norm(b && b.settings);
    if (same(s.printer, this.receiptPrinter())) return fail('That is the receipt printer. Pick the label printer, so labels never come out on receipt paper.');
    try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 1)); fs.renameSync(tmp, this.file); }
    catch (e) { return fail('Could not save the label settings (' + e.message + ')'); }
    this.log('LABELS settings saved (printer: ' + (s.printer || 'system dialog') + ', ' + s.w + 'x' + s.h + ' in, ' + s.method + ')');
    return { ok: true, message: 'Label settings saved', settings: s };
  }
  // one item by its code: { item: { name, number, upc, price, regular } } or { list } when several match
  async lookup(code) {
    code = String(code || '').trim().slice(0, 64); if (!code) return fail('Scan or type an item');
    const r = await this.reg.api.scan(code), s = val(r);
    if (s && s.productId && s.productId !== EMPTY) return { ok: true, item: fromScan(s) };
    const pc = await this.reg.priceCheck(code); // same read-only search Price Check (Ctrl+I) uses when the code is not exact
    // exact item number / barcode / SKU typed (any case, e.g. "a2" for A2): that item, not a pick list of A2, A20, A21...
    const exact = pc && pc.ok && pc.list ? pc.list.filter(x => same(x.number, code) || same(x.upc, code) || same(x.sku, code)) : [];
    if (exact.length === 1) {
      const x = exact[0];
      for (const k of [x.upc, x.number]) if (k && k !== code) { const t = val(await this.reg.api.scan(k)); if (t && t.productId && t.productId !== EMPTY) return { ok: true, item: fromScan(t) }; }
      return { ok: true, item: { name: x.name || '', number: x.number || '', upc: x.upc || '', price: x.price == null ? null : Number(x.price), regular: null } };
    }
    if (pc && pc.ok && pc.list && pc.list.length === 1 && pc.list[0].number && pc.list[0].number !== code) return this.lookup(pc.list[0].number); // one match: that item
    if (pc && pc.ok && pc.list) return { ok: true, list: pc.list.map(x => ({ name: x.name, number: x.number, upc: x.upc, price: x.price })) };
    if (pc && pc.ok && pc.item) return { ok: true, item: { name: pc.item.name, number: pc.item.number, upc: pc.item.upc, price: Number(pc.item.price), regular: pc.item.originalPrice == null ? null : Number(pc.item.originalPrice) } };
    return fail((pc && pc.message) || `Nothing found for "${code}"`);
  }
  // b: { code, copies } or { test: true }. The price always comes from AIR POS here (never from the screen).
  async print(b = {}) {
    const st = this.settings(), copies = Math.round(Math.min(50, Math.max(1, Number(b.copies) || st.copies || 1)));
    let item;
    if (b.test) item = { ...L.SAMPLE };
    else { const f = await this.lookup(b.code); if (!f.ok || !f.item) return f; item = f.item; }
    const lay = L.layout(item, st), base = { item, copies, price: lay.price, onSale: lay.onSale, regular: lay.regular, code: lay.code };
    if (lay.price == null && st.show.price) return fail(`${item.name || 'This item'} has no price in AIR POS`, { item });
    // no label printer picked (or no printer helper on this PC): the screen prints it with the Windows print dialog
    // 1.0.10-local.2 (Ari 11:40): the screen says WHY and the cashier opens the print window (it never opens by itself)
    if (st.method === 'dialog' || !st.printer) return { ok: true, ...base, dialog: true, why: st.printer ? 'method' : 'noPrinter', message: st.printer ? 'Not printed yet: Settings > Labels is set to print through the Windows print window. Press Open print window (or Enter) to print it' : 'Not printed yet: no label printer is set in Settings > Labels, so Air Max cannot print the label by itself. Press Open print window (or Enter) to pick a printer' };
    if (same(st.printer, this.receiptPrinter())) return fail('The label printer is set to the receipt printer. Change it in Settings > Labels.', { item });
    if (!this.hwPresent()) return { ok: true, ...base, dialog: true, why: 'noHelper', message: `Not printed yet: the Air Max printer helper is not available on this PC, so the label cannot go straight to '${st.printer}'. Press Open print window (or Enter) to print it there` };
    const zpl = L.isZpl(st.printer, st.method), via = zpl ? 'zpl' : 'driver';
    // 1.0.10-local.2: Hebrew (any letter Helvetica / ZPL font 0 cannot draw) goes as a picture the screen draws from this same layout
    let img = null;
    if (L.needsImage(lay)) {
      img = b.image && typeof b.image === 'object' ? b.image : null;
      if (!img) return { ok: true, ...base, needImage: true, message: 'Drawing the label as a picture (Hebrew name)' };
      const want = Math.ceil(lay.W / 8) * lay.H, raw = typeof img.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(img.data) ? Buffer.from(img.data, 'base64') : null;
      if (img.w !== lay.W || img.h !== lay.H || !raw || raw.length !== want) return fail('The label picture did not match the sticker size; nothing printed. Try again.', { item });
      img = { w: lay.W, h: lay.H, data: raw.toString('base64') };
    }
    const bytes = Buffer.from(zpl ? (img ? L.toZplImage(lay, st, copies, img) : L.toZpl(lay, st, copies)) : L.toPdf(lay, copies, img), 'latin1');
    let r;
    try {
      if (this.sink) { fs.mkdirSync(this.sink, { recursive: true }); const n = Date.now() + '-' + Math.random().toString(36).slice(2, 6); fs.writeFileSync(path.join(this.sink, `${n}.${zpl ? 'zpl' : 'pdf'}`), bytes); fs.writeFileSync(path.join(this.sink, n + '.json'), JSON.stringify({ printer: st.printer, via, copies, item })); r = { ok: true }; }
      else if (zpl) r = await this.reg.hw.request('raw', { base64: bytes.toString('base64'), printer: st.printer, doc: 'AirMax label', waitMs: '8000' }, 48000);
      else r = await this.reg.hw.printPdf(bytes.toString('base64'), st.printer);
    } catch (e) { r = { ok: false, error: e.message }; }
    this.log(`LABEL ${r && r.ok ? 'printed' : 'FAILED'} ${item.number || '-'} x${copies} via ${via} on ${st.printer}${r && !r.ok ? ': ' + String(r.error || '').slice(0, 160) : ''}`);
    if (!r || !r.ok) return fail('Label printer did not print (' + String((r && r.error) || 'no answer').slice(0, 160) + '). Check it is on and has labels.', { ...base, via });
    return { ok: true, ...base, via, message: `Printed ${copies} label${copies > 1 ? 's' : ''}: ${item.name}` };
  }
}
// ---- 1.0.11-local.9 Label Layouts (Print Labels screen). READ-ONLY toward AIR POS: item lookups only (scan / search).
// The Label price changes ONLY what is printed; it is never sent to AIR POS. Defaults live in label-layouts.json on this PC.
Labels.prototype.defaults = function () { try { return LL.normDefaults(JSON.parse(fs.readFileSync(this.layFile, 'utf8'))); } catch { return LL.normDefaults({}); } };
Labels.prototype.store = function () { const st = this.settings(); try { return st.store || (this.reg.identity && this.reg.identity.shopName) || ''; } catch { return st.store || ''; } };
Labels.prototype.layouts = function () {
  const d = this.defaults(), st = this.settings();
  return { ok: true, layouts: LL.LAYOUTS, defaults: d, printer: d.printer || st.printer, settings: st, receiptPrinter: this.receiptPrinter(), direct: this.hwPresent(), store: this.store() };
};
Labels.prototype.saveDefault = function (b = {}) {
  const d = this.defaults(), kind = b.kind, key = String(b.key == null ? '' : b.key).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80), id = b.layout == null || b.layout === '' ? null : String(b.layout);
  if (id && !LL.byId(id)) return fail('Unknown layout');
  if (kind === 'store') { if (!id) return fail('Pick a layout'); d.def = id; }
  else if (kind === 'item' || kind === 'dept') {
    if (!key) return fail(kind === 'item' ? 'This item has no item number' : 'This item has no department in AIR POS');
    const m = kind === 'item' ? d.items : d.depts, k = kind === 'dept' ? key.toLowerCase() : key;
    if (id) m[k] = id; else delete m[k];
  } else if (kind === 'printer') {
    const p = String(b.printer || '').slice(0, 200); if (same(p, this.receiptPrinter())) return fail('That is the receipt printer. Pick the label printer.'); d.printer = p;
  } else return fail('Nothing to save');
  try { const tmp = this.layFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(LL.normDefaults(d), null, 1)); fs.renameSync(tmp, this.layFile); }
  catch (e) { return fail('Could not save the label layout defaults (' + e.message + ')'); }
  const nm = id ? LL.byId(id).name : '';
  this.log(`LABELS default saved: ${kind}${key ? ' ' + key : ''} -> ${id || (kind === 'printer' ? d.printer || 'system dialog' : 'cleared')}`);
  return { ok: true, defaults: this.defaults(), message: kind === 'printer' ? 'Label printer saved for Print Labels' : id ? `Default layout for ${kind === 'store' ? 'all items' : kind === 'item' ? 'item ' + key : 'department ' + key}: ${nm}` : 'Default removed' };
};
// one item for the grid: AIR POS item + which layout it gets by default (item, then department, then store)
Labels.prototype.lookupRow = async function (code) {
  const f = await this.lookup(code); if (!f.ok || !f.item) return f;
  const p = LL.pickDefault(f.item, this.defaults());
  return { ok: true, item: f.item, layout: p.id, layoutFrom: p.from, store: this.store() };
};
// b: { rows: [{ code, copies, layout, labelPrice }], printer, preview }
Labels.prototype.printBatch = async function (b = {}) {
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 51) : [];
  if (!rows.length) return fail('Add an item first');
  if (rows.length > 50) return fail('At most 50 items at a time');
  const st = this.settings(), d = this.defaults(), store = this.store(), date = new Date().toLocaleDateString('en-US');
  const jobs = []; let total = 0;
  for (const r of rows) {
    const f = await this.lookupRow(r && r.code); // the price comes from AIR POS again (never from the screen) ...
    if (!f.ok) return fail(`${String(r && r.code || '').slice(0, 30)}: ${f.message || 'not found'}`);
    if (!f.item) return fail(`"${String(r.code).slice(0, 30)}" matches several items. Pick one in the grid.`);
    const g = LL.priceGuard(r.labelPrice, f.item.price); // ... except a Label price typed on the screen, checked again here
    if (!g.ok) return fail(`${f.item.name || f.item.number}: Label price not used. ${g.reason}`, { row: r.code, guard: true });
    const id = LL.byId(r.layout) ? r.layout : f.layout, copies = Math.round(Math.min(50, Math.max(1, Number(r.copies) || 1)));
    const parts = LL.render(f.item, id, { dpi: st.dpi, settings: st, store, date, labelPrice: g.value });
    if (parts[0].price == null || !Number.isFinite(parts[0].price)) return fail(`${f.item.name || 'This item'} has no price in AIR POS. Type a Label price to print it.`);
    total += copies * parts.length; jobs.push({ item: f.item, layout: id, copies, labelPrice: g.value, parts });
  }
  if (total > 500) return fail(`That is ${total} labels. At most 500 at a time.`);
  const out = jobs.map(j => ({ item: j.item, layout: j.layout, copies: j.copies, labelPrice: j.labelPrice, stickers: j.parts.length }));
  const pages = []; for (const j of jobs) for (let c = 0; c < j.copies; c++) for (const p of j.parts) pages.push({ L: p });
  const hebrew = jobs.some(j => j.parts.some(p => L.needsImage(p)));
  if (b.preview) return { ok: true, preview: true, rows: out, total, pdf: hebrew ? null : Buffer.from(L.toPdfPages(pages), 'latin1').toString('base64'), dialog: hebrew, why: hebrew ? 'hebrew' : undefined, message: `Preview: ${total} label${total > 1 ? 's' : ''}` };
  const printer = String(b.printer == null ? (d.printer || st.printer) : b.printer).slice(0, 200);
  const dlg = why => ({ ok: true, rows: out, total, dialog: true, why, message: why === 'hebrew' ? 'Not printed yet: Hebrew names print through the print window. Press Open print window.' : why === 'noPrinter' ? 'Not printed yet: no label printer picked. Press Open print window to pick a printer.' : `Not printed yet: the Air Max printer helper is not available on this PC, so the labels cannot go straight to '${printer}'. Press Open print window.` });
  if (!printer || st.method === 'dialog') return dlg('noPrinter');
  if (same(printer, this.receiptPrinter())) return fail('That is the receipt printer. Pick the label printer, so labels never come out on receipt paper.');
  if (!this.hwPresent()) return dlg('noHelper');
  if (hebrew) return dlg('hebrew');
  const zpl = L.isZpl(printer, st.method), via = zpl ? 'zpl' : 'driver';
  const bytes = Buffer.from(zpl ? jobs.map(j => (j.parts.length === 1 ? L.toZpl(j.parts[0], st, j.copies) : Array.from({ length: j.copies }, () => j.parts.map(p => L.toZpl(p, st, 1)).join('')).join(''))).join('') : L.toPdfPages(pages), 'latin1');
  let r;
  try {
    if (this.sink) { fs.mkdirSync(this.sink, { recursive: true }); const n = Date.now() + '-' + Math.random().toString(36).slice(2, 6); fs.writeFileSync(path.join(this.sink, `${n}.${zpl ? 'zpl' : 'pdf'}`), bytes); fs.writeFileSync(path.join(this.sink, n + '.json'), JSON.stringify({ printer, via, total, rows: out.map(o => ({ number: o.item.number, layout: o.layout, copies: o.copies, labelPrice: o.labelPrice, price: o.item.price })) })); r = { ok: true }; }
    else if (zpl) r = await this.reg.hw.request('raw', { base64: bytes.toString('base64'), printer, doc: 'AirMax labels', waitMs: '8000' }, 48000);
    else r = await this.reg.hw.printPdf(bytes.toString('base64'), printer);
  } catch (e) { r = { ok: false, error: e.message }; }
  this.log(`LABELS ${r && r.ok ? 'printed' : 'FAILED'} ${total} label(s), ${jobs.length} item(s) [${jobs.map(j => `${j.item.number || '-'} ${j.layout} x${j.copies}${j.labelPrice != null ? ' label price ' + L.money(j.labelPrice) : ''}`).join('; ').slice(0, 300)}] via ${via} on ${printer}${r && !r.ok ? ': ' + String(r.error || '').slice(0, 160) : ''}`);
  if (!r || !r.ok) return fail('Label printer did not print (' + String((r && r.error) || 'no answer').slice(0, 160) + '). Check it is on and has labels.', { rows: out, via });
  return { ok: true, rows: out, total, via, printer, message: `Printed ${total} label${total > 1 ? 's' : ''} (${jobs.length} item${jobs.length > 1 ? 's' : ''})` };
};
module.exports = { Labels };

'use strict';
// AirMax 1.0.11 instant scan (Gordon, approved for 1.0.11; Nov 3 2026). Settings > "Instant scan", OFF by default.
//  OFF: nothing here runs. No product list is downloaded or saved, no AIR POS call is added; scan and search are exactly as before.
//  ON : 1. when the app opens (the first login of this run, or when the setting is switched on), the store's product list is read
//          from AIR POS (ProductPaged, page by page, in the background; the register never waits for it) and saved in the app data
//          folder: code, UPC, name, price, tax and the fields the sale line needs. No customer data.
//       2. once the WHOLE list is in, a scanned code (or a search pick) found in it goes on the sale at once, marked "not confirmed",
//          and AIR POS checks it in the background with the same call as today (RetailOrderSubGetByScan). AIR POS's answer wins:
//          a different price, name, tax or any other field updates the line; "not a valid item" takes the line off with a message.
//          Until the list is complete (or when the item is not in it, AIR POS is unreachable, a payment has started, return mode, ...)
//          the scan goes the old way.
//       3. the checks run in the register's own request queue, so anything after the scan (F4, quantity, Pay, Hold, Complete) waits
//          for them; the totals are then AIR POS's answer for the confirmed lines (recalc). lib/register.js refuses Pay / Complete /
//          Hold while any line is still unconfirmed (tagged "// is1011+" lines), so an unchecked price can never be charged.
//       The list is NOT refreshed during the day (Gordon: only when the app opens). A saved list is used only when this run's
//       download failed and the saved one is under 24 h old.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const PAGE = 500;                 // products per ProductPaged call
const SAVED_MAX_AGE = 24 * 3600 * 1000;
const RETRY_MS = 800;             // one retry of the check when AIR POS did not answer
const OFFLINE_MS = 60000;         // after a lost check, scans go the old way for a minute
const MAX_QTY = 9999;             // as lib/register.js
const SAFE_ROUTES = new Set(['scan', 'qty', 'qty-plus', 'qty-minus', 'remove', 'line-discount', 'line-tax', 'stock-note', 'instant-check']);
const norm = c => String(c == null ? '' : c).replace(/\s+/g, '').trim();
const money = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const val = r => (r && typeof r === 'object' && 'value' in r ? r.value : r);
const CHECKED = ['price', 'name', 'taxRate', 'taxNotSet', 'taxFree', 'rate', 'unitName', 'bulkPrice', 'bulkPriceQuantity', 'itemId', 'productId', 'type', 'productType', 'oriPrice', 'originalPrice'];

class InstantScan {
  // reg: Register; enqueue(fn): run fn in the server's request queue; listPrice(row, shop): the shop / standard price of a list row
  constructor({ reg, dataDir, log, shopKey, enqueue, listPrice, running }) {
    Object.assign(this, { reg, dataDir, log: log || (() => {}), shopKey: shopKey || (() => ''), enqueue, listPrice: listPrice || (p => p.price), running: running || new Set() });
    this.setFile = path.join(dataDir, 'instant-scan.json');
    this.on = this.readSetting(); this.list = null; this.loading = null; this.loadedFor = null; this.offlineUntil = 0;
    this.queued = false; this.dirty = false; this.notes = []; this.noteId = 0; this.stats = null;
  }
  readSetting() { try { return JSON.parse(fs.readFileSync(this.setFile, 'utf8')).on === true; } catch { return false; } }
  listFile(k) { return path.join(this.dataDir, 'products-' + crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 16) + '.json'); }
  setOn(on) {
    this.on = !!on;
    try { fs.writeFileSync(this.setFile, JSON.stringify({ on: this.on })); } catch (e) { return { ok: false, message: 'Could not save the setting: ' + e.message }; }
    if (!this.on) { // off: nothing kept, nothing downloaded
      this.list = null; this.loadedFor = null; if (this.loading) this.loading.cancel = true;
      try { for (const f of fs.readdirSync(this.dataDir)) if (/^products-[0-9a-f]{16}\.json$/.test(f)) fs.unlinkSync(path.join(this.dataDir, f)); } catch { /* nothing saved */ }
      return { ok: true, on: false, message: 'Instant scan is off: scanning works as before' };
    }
    this.startLoad();
    return { ok: true, on: true, message: 'Instant scan is on: the product list is loading in the background' };
  }
  // ---------------- product list: once per app run (first login), in pages, in the background
  onLogin() { if (this.on && this.reg.api.loggedIn && this.loadedFor !== this.shopKey()) this.startLoad(); }
  startLoad() {
    const k = this.shopKey(); if (!this.on || !k || !this.reg.api.loggedIn || (this.loading && this.loading.k === k)) return;
    if (this.loading) this.loading.cancel = true;
    const job = this.loading = { k, cancel: false, done: 0, total: null, t0: Date.now(), pages: 0 };
    this.list = null; this.loadedFor = k;
    this.load(job).catch(e => { this.log('instant scan: product list not loaded: ' + e.message); job.error = e.message; })
      .finally(() => { if (this.loading === job) this.loading = null; if (!this.list && !job.cancel) this.useSaved(k); });
  }
  async load(job) {
    const rows = [];
    for (let page = 1; ; page++) {
      if (job.cancel) return;
      const r = await this.reg.api.productPaged('', page, PAGE); job.pages++;
      if (!r || !Array.isArray(r.rows)) throw new Error((r && r.message) || 'no answer from AIR POS (page ' + page + ')');
      for (const p of r.rows) { const e = this.entry(p); if (e) rows.push(e); }
      job.total = Number(r.total) || null; job.done += r.rows.length;
      if (r.rows.length < PAGE || (job.total && job.done >= job.total)) break;
      await new Promise(res => setImmediate(res)); // the register keeps answering between pages
    }
    if (job.cancel) return;
    const data = { at: new Date().toISOString(), shop: job.k, count: rows.length, rows };
    const f = this.listFile(job.k); fs.writeFileSync(f + '.tmp', JSON.stringify(data)); fs.renameSync(f + '.tmp', f);
    this.setList(data, 'downloaded');
    this.stats = { ms: Date.now() - job.t0, pages: job.pages, count: rows.length, bytes: fs.statSync(f).size, at: data.at };
    this.log(`instant scan: ${rows.length} products loaded in ${this.stats.ms} ms (${job.pages} pages, ${Math.round(this.stats.bytes / 1024)} KB on disk)`);
  }
  entry(p) { // one list row -> what the sale line needs (no stock, no customer data)
    if (!p || !p.number) return null;
    const price = this.listPrice(p, this.reg.api.shop); if (!(price > 0)) return null;
    return { n: String(p.number), u: p.upc ? String(p.upc) : '', name: String(p.name || ''), price, tax: p.taxRate != null ? Number(p.taxRate) : null, unit: p.unitName || '', id: p.id || null, pid: p.productId || null, cat: p.categoryName || '' };
  }
  useSaved(k) { // this run's download failed: a saved list under 24 h old is used instead
    try { const d = JSON.parse(fs.readFileSync(this.listFile(k), 'utf8')); if (d && d.shop === k && Date.now() - Date.parse(d.at) < SAVED_MAX_AGE) { this.setList(d, 'saved'); this.log('instant scan: AIR POS list not loaded; using the saved list from ' + d.at); } } catch { /* none */ }
  }
  setList(d, how) {
    const by = new Map();
    for (const e of d.rows) { by.set(e.n, e); if (e.u && !by.has(e.u)) by.set(e.u, e); e.lc = e.name.toLowerCase(); }
    this.list = { at: d.at, k: d.shop, rows: d.rows, by, how };
  }
  ready() { return !!(this.on && this.list && this.list.k === this.shopKey()); }
  // ---------------- scan
  // true = this scan can go on the sale at once from the list (otherwise: the old way)
  canAdd(code) {
    const reg = this.reg, c = norm(code);
    if (!this.ready() || !c || !reg.api.loggedIn || reg.api.online === false || Date.now() < this.offlineUntil) return false;
    if (reg.mode !== 'sale' || reg.retOn || reg.pay || reg.recoveryPending || (reg.order && reg.order.taxExempt)) return false;
    for (const n of this.running) if (!SAFE_ROUTES.has(n)) return false; // Pay / Hold / New sale ... queued: the old way, behind them
    const e = this.list.by.get(c); if (!e) return false;
    const ex = reg.subs.find(x => this.same(x, e));
    return !(ex && ex.quantity + 1 > MAX_QTY);
  }
  same(x, e) { return !(x.type > 0) && (e.tpl ? x.itemId === e.tpl.itemId : x.number === e.n); }
  scanNow(code) {
    const reg = this.reg, c = norm(code), e = this.list.by.get(c), t0 = Date.now();
    const ex = reg.subs.find(x => this.same(x, e));
    if (ex) { ex.quantity += 1; ex.quantityTotal = ex.quantity * (ex.rate || 1); ex.timestamp = Date.now(); reg.applySubDiscount(ex); }
    else {
      const base = e.tpl ? { ...e.tpl } : { itemId: e.id, productId: e.pid, number: e.n, upc: e.u, name: e.name, rate: 1, price: e.price, taxRate: e.tax != null ? e.tax : 0, taxNotSet: e.tax == null, unitName: e.unit, type: 0 };
      const sub = { ...base, id: crypto.randomUUID(), quantity: 1, quantityTotal: base.rate || 1, discount: 0, discountAmount: 0, discountMethod: 10, isCustomDiscount: false, timestamp: Date.now(), _unconfirmed: true, _code: c };
      reg.applySubDiscount(sub); reg.subs.splice(0, 0, sub);
    }
    this.dirty = true; this.kick();
    try { reg.journalSnap('instant-add'); } catch (e) { this.log('instant scan: journal: ' + e.message); } // F3: the line is in the crash journal from the moment it is on screen
    this.lastAddMs = Date.now() - t0;
    return { ok: true, message: `Added ${e.name}`, instant: true };
  }
  // F2: a line that is still "not confirmed" and has no check coming (restored from the crash journal after a restart; the
  // check that was running died with the app) is checked with AIR POS now, so Pay and Hold are never stuck on "still checking"
  rescue() {
    const reg = this.reg;
    if (this.queued || this.checking || !reg.api.loggedIn || reg.recoveryPending || reg.mode !== 'sale' || !(reg.subs || []).some(s => s._unconfirmed)) return false;
    this.dirty = true; this.kick(); return true;
  }
  kick() { if (this.queued) return; this.queued = true; this.enqueue(() => this.check()).catch(e => this.log('instant scan check failed: ' + e.message)); }
  // ---------------- the background check, in the request queue
  async check() {
    this.queued = false; this.checking = true; const reg = this.reg;
    try {
    for (let round = 0; round < 6; round++) {
      const pend = reg.subs.filter(s => s._unconfirmed);
      if (!pend.length) break;
      await Promise.all(pend.map(s => this.confirm(s)));
    }
    if (this.dirty) { this.dirty = false; await reg.recalc(); } // totals = AIR POS's answer for the checked lines
    } finally { this.checking = false; }
  }
  async confirm(s) {
    const reg = this.reg, api = reg.api;
    let r = await api.scan(s._code);
    if (r && r.unreachable) { await new Promise(res => setTimeout(res, RETRY_MS)); r = await api.scan(s._code); }
    if (!reg.subs.includes(s)) return;
    const take = msg => { reg.subs.splice(reg.subs.indexOf(s), 1); this.dirty = true; this.note('err', msg); };
    if (r && r.unreachable) { this.offlineUntil = Date.now() + OFFLINE_MS; return take(`${s.name} could not be checked with AIR POS (no connection), so it was taken off the sale. Scan it again.`); }
    const v = val(r);
    if (!r || r.success === false || !v || !v.itemId) return take(`${s.name} was taken off the sale: AIR POS says ${(r && r.message) || 'it is not a valid item'}.`);
    const was = { price: s.price, name: s.name, taxRate: s.taxRate };
    const changed = CHECKED.filter(k => v[k] !== undefined && JSON.stringify(v[k]) !== JSON.stringify(s[k]));
    const keep = { id: s.id, quantity: s.quantity, timestamp: s.timestamp, isCustomDiscount: s.isCustomDiscount, discount: s.discount, discountMethod: s.discountMethod };
    for (const k of Object.keys(s)) if (!(k in keep)) delete s[k];
    Object.assign(s, v, keep); s.quantityTotal = s.quantity * (s.rate || 1);
    if (!s.isCustomDiscount) { s.discount = 0; s.discountMethod = 10; }
    reg.applySubDiscount(s);
    // AIR POS says it is the same item as another line: one line, as the old scan would have made it
    const twin = reg.subs.find(x => x !== s && !x._unconfirmed && x.itemId === s.itemId && !(x.type > 0));
    if (twin) { twin.quantity += s.quantity; twin.quantityTotal = twin.quantity * (twin.rate || 1); reg.applySubDiscount(twin); reg.subs.splice(reg.subs.indexOf(s), 1); }
    this.learn(s.number, v); this.dirty = true;
    const what = []; if (was.price !== v.price) what.push(`price ${money(was.price)} -> ${money(v.price)}`); if (was.name !== v.name) what.push(`name "${was.name}" -> "${v.name}"`); if (Number(was.taxRate) !== Number(v.taxRate)) what.push(`tax ${was.taxRate}% -> ${v.taxRate}%`);
    if (what.length) this.note('warn', `${v.name}: updated from AIR POS (${what.join(', ')})`);
    else if (changed.length) this.log('instant scan: line updated from AIR POS (' + changed.join(', ') + ')');
  }
  learn(code, v) { // AIR POS's answer becomes the list entry (used for the rest of this run)
    if (!this.list || !v || !v.number) return;
    const e = this.list.by.get(String(v.number)) || this.list.by.get(norm(code)); if (!e) return;
    const { id, quantity, quantityTotal, discount, discountAmount, discountMethod, isCustomDiscount, timestamp, ...tpl } = v;
    e.tpl = tpl; e.price = v.price; e.name = v.name || e.name; e.lc = e.name.toLowerCase(); e.tax = v.taxRate != null ? Number(v.taxRate) : e.tax;
  }
  note(kind, message) { this.notes.push({ id: ++this.noteId, kind, message }); if (this.notes.length > 20) this.notes.shift(); this.log('instant scan: ' + message); }
  pending() { return this.reg.subs.filter(s => s._unconfirmed).length + (this.dirty || this.queued || this.checking ? 1 : 0); }
  // ---------------- search from the list (shape of the old search route)
  search(keyword, page = 1, size = 24) {
    const t0 = Date.now(), k = String(keyword || '').trim().toLowerCase(), rows = this.list.rows;
    const hit = !k ? rows : rows.filter(e => e.lc.includes(k) || e.n === k || e.u === k || e.n.startsWith(k));
    const out = hit.slice((page - 1) * size, page * size).map(e => ({ number: e.n, upc: e.u, name: e.name, price: e.price, unitName: e.unit, categoryName: e.cat }));
    this.lastSearchMs = Date.now() - t0;
    return { ok: true, total: hit.length, rows: out, instant: true };
  }
  status() {
    const L = this.loading, rows = this.reg.sorted ? this.reg.sorted() : [];
    return { on: this.on, ready: this.ready(), loading: L ? { done: L.done, total: L.total } : null, count: this.list ? this.list.rows.length : 0, from: this.list ? this.list.how : null, at: this.list ? this.list.at : null,
      pending: this.pending(), pendingRows: rows.map((s, i) => (s._unconfirmed ? i : -1)).filter(i => i >= 0), notes: this.notes.slice(-5), stats: this.stats };
  }
}
module.exports = { InstantScan, PAGE, SAFE_ROUTES };

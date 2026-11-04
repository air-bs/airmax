'use strict';
// 1.0.10-local.2 (Ari 11:45 / 11:46, Nov 1): Reprint Receipt (Ctrl+P) and Gift Receipt (Ctrl+Alt+P) always print the LAST sale
// of this register, never open History. Print only: nothing about the sale, its money or the AIR POS records is changed.
//  1. this session's last completed sale (reg.lastOrderId);
//  2. else the id saved here the last time a sale completed (DATA/last-receipt.json, per store, survives a restart);
//  3. else a read-only look-up of the newest completed order in AIR POS order history (this register's when the rows say which).
// Gift: the store's own AIR POS gift template via printGiftReceipt(orderId); no gift template = nothing prints (never a priced receipt).
const fs = require('fs'), path = require('path');
const COMPLETED = 20; // AIR POS order status "Completed" (History shows Reprint/Return only for these)
const TERM_KEYS = ['terminalId', 'terminalConfigId', 'terminal', 'terminalName', 'deviceId'];
const NONE = 'No recent receipt to reprint';
// 1.0.11-local.6g (Ari OK 6:06 PM ET Nov 1, test build, TestShop only): pick-items gift receipt. Print only: reads the order
// (RetailOrderGet, read-only) and prints a no-price slip of the ticked items. All items ticked = the AIR POS gift template, as before.
// Why an Air Max slip: AIR POS's RetailOrderBillContentGet does take orderSubIds (TestShop, Nov 1: an id list drops the other lines),
// but the store templates still print the WHOLE order's total, payment and item count, and no TestShop template has
// allowDetailsSelection on. A slip built here can never show a price.
const GIFT_MSG = 'A gift for you - enjoy!';
const gval = r => (r && typeof r === 'object' && 'value' in r ? r.value : r);
function giftSlipLines({ shop, number, at, items }) { // the printers' text path folds runs of spaces, so each line is "QTY x ITEM", no columns
  const d = at ? new Date(at) : new Date(); const when = isNaN(d) ? '' : d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return [shop ? String(shop) : '', 'GIFT RECEIPT', number ? 'Order ' + number : '', when, '', 'QTY x ITEM',
    ...items.map(i => qtyText(i.quantity) + ' x ' + String(i.name || 'Item').replace(/\s+/g, ' ').trim()), '', GIFT_MSG].filter((l, i) => l !== '' || i > 3);
}
function qtyText(q) { const n = Number(q); return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '1'; }

class Reprint {
  constructor({ dataDir, reg, shopKey, log }) {
    this.file = path.join(dataDir, 'last-receipt.json'); this.reg = reg; this.shopKey = shopKey || (() => ''); this.log = log || (() => {});
    this.seen = null;
    if (reg) { reg.giftPickNow = () => this.pickNow(); reg.printGiftPick = (id, pk) => this.printPickAfterSale(id, pk); } // 1.0.11-local.6g
  }
  readAll() { try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
  // called after every screen request: saves the id once, when a new sale completed (cheap compare otherwise)
  note() {
    const id = this.reg.lastOrderId; if (!id || id === this.seen) return;
    const k = this.shopKey(); if (!k) return;
    this.seen = id;
    const all = this.readAll(); if (all[k] && all[k].orderId === id) return;
    all[k] = { orderId: id, at: new Date().toISOString() };
    try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(all, null, 1)); fs.renameSync(this.file + '.tmp', this.file); } catch (e) { this.log('last receipt not saved: ' + e.message); }
  }
  termIds() {
    const t = (this.reg.term && this.reg.term()) || {};
    return [t.id, t.terminalId, t.name, t.terminalName].filter(v => v != null && v !== '').map(String);
  }
  async lookup() { // read-only: AIR POS order history, newest first
    const r = await this.reg.api.orderPaged({ number: null, productNumber: null, memberNumber: '', orderDate: null }, 1, 20);
    const rows = ((r && r.rows) || []).filter(o => o && o.id && o.status === COMPLETED);
    const mine = this.termIds(); const key = TERM_KEYS.find(k => rows.some(o => o[k] != null));
    const pick = key && mine.length ? rows.find(o => mine.includes(String(o[key]))) : rows[0];
    return pick ? { orderId: pick.id, number: pick.number, via: key && mine.length ? 'order history (this register)' : 'order history (newest completed sale in this store)' } : null;
  }
  async last() {
    this.note();
    if (this.reg.lastOrderId) return { orderId: this.reg.lastOrderId, via: 'this session' };
    const k = this.shopKey(), s = k && this.readAll()[k];
    if (s && s.orderId) return { orderId: s.orderId, via: 'saved on this register' };
    try { return await this.lookup(); } catch (e) { this.log('last receipt look-up failed: ' + e.message); return null; }
  }
  async lastReceipt() {
    const x = await this.last();
    return x ? { ok: true, ...x } : { ok: false, none: true, message: NONE };
  }
  async gift(orderId) {
    const x = orderId ? { orderId: String(orderId), via: 'history' } : await this.last();
    if (!x) return { ok: false, none: true, message: 'No recent sale to print a gift receipt for' };
    if (typeof this.reg.printGiftReceipt !== 'function') return { ok: false, message: 'Gift receipt not printed: not available in this version' };
    const r = await this.reg.printGiftReceipt(x.orderId);
    return { ...(r || { ok: false, message: 'Gift receipt not printed' }), orderId: x.orderId, via: x.via };
  }
  // ---- 1.0.11-local.6g pick-items gift receipt (print only) ----
  async orderLines(orderId) { // read-only RetailOrderGet: number, time and the item lines (no amounts leave this function)
    const o = gval(await this.reg.api.orderGet(orderId));
    if (!o || !Array.isArray(o.subs)) return null;
    return { number: o.number || '', at: o.orderTime || null, items: o.subs.filter(s => s && s.id).map(s => ({ id: String(s.id), name: s.name || s.productName || 'Item', quantity: s.quantity })) };
  }
  async giftItems(orderId) { // the picker's list; nothing printed
    const x = orderId ? { orderId: String(orderId), via: 'history' } : await this.last();
    if (!x) return { ok: false, none: true, message: 'No recent sale to print a gift receipt for' };
    let o = null; try { o = await this.orderLines(x.orderId); } catch (e) { this.log('gift items look-up failed: ' + e.message); }
    return { ok: true, orderId: x.orderId, via: x.via, number: o ? o.number : '', items: o ? o.items : [] }; // no list = the screen prints the old way
  }
  async giftPick(orderId, ids) { // ticked lines only, no prices; every line ticked = the old AIR POS gift template path
    if (!orderId) return { ok: false, message: 'No sale chosen' };
    const want = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!want.size) return { ok: false, message: 'Tick at least one item' };
    const o = await this.orderLines(String(orderId));
    if (!o) return { ok: false, message: 'Gift receipt not printed: could not read the sale from AIR POS' };
    const items = o.items.filter(i => want.has(i.id));
    if (!items.length) return { ok: false, message: 'Gift receipt not printed: the ticked items are not on this sale' };
    if (items.length === o.items.length) return this.gift(orderId);
    return this.printPicked(String(orderId), { number: o.number, at: o.at, items });
  }
  async printPicked(orderId, { number, at, items }) {
    if (typeof this.reg.printSlip !== 'function') return { ok: false, message: 'Gift receipt not printed: not available in this version' };
    const lines = giftSlipLines({ shop: (this.reg.identity && this.reg.identity.shopName) || '', number, at, items });
    const label = `Gift receipt printed (${items.length} item${items.length === 1 ? '' : 's'}, no prices)`;
    const r = await this.reg.printSlip(lines, label);
    return { ...(r || { ok: false }), message: r && r.ok ? label : 'Gift receipt not printed: ' + ((r && r.message) || 'printer did not answer'), orderId, picked: items.length, slip: true };
  }
  // F10 (Add Gift Receipt) with items unticked: remembered for THIS sale only (by order id), used when the sale completes
  setPick(exclude) {
    const ex = (Array.isArray(exclude) ? exclude : []).map(String).filter(Boolean);
    this.pick = ex.length ? { orderId: this.reg.order.id, exclude: new Set(ex) } : null;
  }
  pickNow() { // called by register.js just before the sale is cleared: the ticked lines, or null = print as before
    const p = this.pick; this.pick = null;
    if (!p || p.orderId !== this.reg.order.id) return null;
    const all = this.reg.sorted(), keep = all.filter(s => !p.exclude.has(String(s.id)));
    if (!keep.length || keep.length === all.length) return null;
    return { at: new Date().toISOString(), items: keep.map(s => ({ id: String(s.id), name: s.name || 'Item', quantity: s.quantity })) };
  }
  async printPickAfterSale(orderId, pk) { // background job after Complete: order number read-only, then the slip
    let number = ''; try { const o = await this.orderLines(orderId); if (o) number = o.number; } catch (e) { this.log('gift receipt order number look-up failed: ' + e.message); }
    return this.printPicked(orderId, { number, at: pk.at, items: pk.items });
  }
  cartItems() {
    if (this.reg.mode !== 'sale') return { ok: false, message: 'Gift receipts are for sales' };
    return { ok: true, items: this.reg.sorted().map(s => ({ id: String(s.id), name: s.name || 'Item', quantity: s.quantity })) };
  }
}
module.exports = { Reprint, NONE, giftSlipLines, GIFT_MSG };

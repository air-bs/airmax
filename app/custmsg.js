// 1.0.9-local.5 (Ari OK 4:17 PM ET Oct 30 2026): the fixed texts on the customer screen, editable per shop in Settings.
// Display only: nothing here touches the sale, money or payments. Kept OUT of app/lib (frozen) and out of settings.json:
// own file customer-messages.json in the data folder, one entry per shop (key = company + shop id, lowercased).
// An empty value means the default text below. Plain text only (shown with textContent / escaped on the customer screen).
'use strict';
const fs = require('fs');
const path = require('path');

const FIELDS = Object.freeze({
  welcome: { def: 'Welcome', max: 40, label: 'Welcome message' },
  welcome2: { def: '', max: 80, label: 'Second line (empty = shop name)' },
  itemsHead: { def: 'Your items', max: 40, label: 'Heading over the items' },
  returnHead: { def: 'Return', max: 40, label: 'Heading during a return' },
  cardReader: { def: 'Please use the card reader', max: 60, label: 'While the card reader waits' },
  thankYou: { def: 'Thank you', max: 40, label: 'After the sale' },
});
const MAX_SHOPS = 50;

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const shopKey = (corp, shopId) => { const c = clean(corp, 100).toLowerCase(), s = clean(shopId, 100).toLowerCase(); return s ? c + '|' + s : ''; };

class CustMessages {
  constructor(dataDir, log) { this.file = path.join(dataDir, 'customer-messages.json'); this.log = log || (() => {}); this.data = this.load(); }
  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (j && typeof j === 'object' && j.shops && typeof j.shops === 'object') return { lastShop: typeof j.lastShop === 'string' ? j.lastShop : '', shops: j.shops };
    } catch (e) { /* none yet or unreadable: defaults */ }
    return { lastShop: '', shops: {} };
  }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2)); fs.renameSync(tmp, this.file); }
  // the saved values for a shop (only what was typed; '' = default)
  saved(key) {
    const e = (key && Object.prototype.hasOwnProperty.call(this.data.shops, key) && this.data.shops[key]) || {}, out = {};
    for (const [k, f] of Object.entries(FIELDS)) out[k] = typeof e[k] === 'string' ? clean(e[k], f.max) : '';
    return out;
  }
  // what the customer screen shows; logged out it uses the last shop that logged in on this PC
  shown(key) { const s = this.saved(key || this.data.lastShop), out = {}; for (const [k, f] of Object.entries(FIELDS)) out[k] = s[k] || f.def; return out; }
  seen(key) { if (key && key !== this.data.lastShop) { this.data.lastShop = key; try { this.save(); } catch (e) { this.log('CUSTOMER MESSAGES could not save: ' + e.message); } } }
  set(key, b) {
    if (!key) return { ok: false, message: 'No shop is logged in' };
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return { ok: false, message: 'Not a shop' };
    const cur = this.saved(key), next = {};
    for (const [k, f] of Object.entries(FIELDS)) next[k] = b && typeof b[k] === 'string' ? clean(b[k], f.max) : cur[k];
    const shops = Object.keys(this.data.shops);
    if (!this.data.shops[key] && shops.length >= MAX_SHOPS) return { ok: false, message: 'Too many shops saved on this PC' };
    this.data.shops[key] = next; this.data.lastShop = key;
    try { this.save(); } catch (e) { return { ok: false, message: 'Could not save the customer screen messages: ' + e.message }; }
    this.log('CUSTOMER MESSAGES saved for this shop (' + Object.keys(next).filter(k => next[k]).length + ' set)');
    return { ok: true, message: 'Customer screen messages saved', messages: this.saved(key) };
  }
}
const defaults = () => Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, { def: f.def, max: f.max, label: f.label }]));
module.exports = { CustMessages, FIELDS, defaults, shopKey, clean };

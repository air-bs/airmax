// AirMax Batch 4 (Items and stock), READ calls only. A plugin file: loaded by server.js from app/api/ (Step 0 loader).
// Calls AIR POS only through ctx.reg.api (retail / productPaged); app/lib is untouched. Nothing here writes to AIR POS.
//   23 ProductGet                      /Products/ProductGet                           items-get
//   28 RetailQuickSellingProductPaged  /Products/RetailQuickSellingProductPaged       items-quick
//   32 RetailInboundOrderPaged         /InboundOrders/RetailInboundOrderPaged         items-inbound
//   33 RetailInboundOrderGet           /InboundOrders/RetailInboundOrderGet           items-inbound-get
//   34 DashboardModelGet               /Dashboards/DashboardModelGet                  items-dashboard   (manager only: it shows sales totals)
//  143 RetailEslGet                    /Esls/RetailEslGet                             items-esl-get     (manager only, and only when the ESL setting is on)
// plus two helpers: items-access (what this login may see / do on the Items tab) and items-find (existing ProductPaged search, to pick an item to open).
// WRITES (approved, Nov 3 2026, proposal PROPOSAL-item-writes.md): a logged-in manager WITH the AIR POS "Product Management" menu is enough (no extra password).
//   25 ProductAdd (items-add)  26 ProductUpdate (items-update, items-disable)  27 ProductPriceSave (items-price-preview, items-price: confirm + re-read via 23 first)
//   29 QuickSellingProductAdd (items-quick-add)  30 QuickSellingProductRemove (items-quick-remove)
//   The add / edit form's pick-lists (departments, origins, tax kinds) are NOT read here: the screen uses Batch 1's route lookups-all.
// Every write route checks canEdit() HERE (the screen hiding the buttons is never the only guard). No picture upload: app/lib only sends text fields.
// Never logged: this file writes no log lines with data in them. Costs are sent to managers only.
'use strict';
const fs = require('fs');
const path = require('path');

const PERMISSION_MENU = 'Product Management'; // the AIR POS menu entry (Basic Data > Product Management, /product-manage) that lets an account add and edit items
const ID_RE = /^[\w-]{1,64}$/;
const int = (v, d, lo, hi) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const str = (v, n = 80) => (v == null ? '' : String(v)).trim().slice(0, n);
const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const fail = (message, x) => ({ ok: false, message, ...(x || {}) });
const isDate = v => (v == null || v === '' ? null : /^\d{4}[-/]\d{2}[-/]\d{2}([ T][\d:]{4,8})?$/.test(String(v)) ? String(v).replace(/\//g, '-') : false);

// AIR POS answers these reads either as a bare value or as { success, value }. { success:false } is a refusal.
function unwrap(r) {
  if (r == null) return { bad: 'No answer from AIR POS' };
  if (r.loggedOut) return { bad: 'Please log in again', loggedOut: true };
  if (typeof r === 'object' && !Array.isArray(r) && r.success === false) return { bad: str(r.message, 160) || 'AIR POS refused the request', unreachable: !!r.unreachable };
  if (typeof r === 'object' && !Array.isArray(r) && 'success' in r && 'value' in r) return { v: r.value };
  return { v: r };
}

// ---- price helpers (ProductPaged / ProductGet put prices in standardPrices (corp) and shopPrices (this shop) on the base unit, rate 1) ----
const baseLevel = list => { const a = Array.isArray(list) ? list : []; return a.find(x => x && Number(x.rate) === 1) || a[0] || null; };
function prices(p) {
  const shop = baseLevel(p.shopPrices), std = baseLevel(p.standardPrices);
  const s = shop ? num(shop.price) : null, g = std ? num(std.price) : null;
  return { shop: s, standard: g, price: s != null ? s : g, source: s != null ? 'shop' : g != null ? 'standard' : null };
}
const items = p => (Array.isArray(p.items) ? p.items : []).map(i => ({
  id: str(i.id, 64), unitName: str(i.unitName, 40), rate: num(i.rate), upcs: (Array.isArray(i.upcs) ? i.upcs : []).map(u => str(u, 50)).filter(Boolean),
  price: num(i.price), saleable: i.saleable !== false, weight: num(i.weight), volume: num(i.volume), length: num(i.length), width: num(i.width), height: num(i.height) }));

// the Item panel (one product). costPrice only goes to a manager.
function product(p, manager) {
  p = p || {};
  const o = {
    id: str(p.id, 64), number: str(p.number, 50), name: str(p.name, 200), upc: str(p.upc, 50) || (items(p)[0] || { upcs: [] }).upcs[0] || '',
    categoryId: str(p.categoryId, 64), categoryName: str(p.categoryName, 100), originId: str(p.originId, 64), originCode: str(p.originCode, 20), originName: str(p.originName, 100),
    brandName: str(p.brandName, 100), description: str(p.description, 500), imagePath: str(p.imagePath, 300),
    enabled: p.enabled !== false, isRetailRefund: p.isRetailRefund !== false,
    taxKindId: str(p.shopTaxKindId || p.standardTaxKindId || p.taxKindId, 64) || null, shopTaxKindId: str(p.shopTaxKindId, 64) || null, standardTaxKindId: str(p.standardTaxKindId, 64) || null, taxRate: num(p.taxRate),
    stock: num(p.quantityStock != null ? p.quantityStock : p.stockQuantity), // read only: AIR POS has no register-side call to change stock
    currency: str(p.saleCurrencyCode, 8), ...prices(p), items: items(p),
    standardPrices: (Array.isArray(p.standardPrices) ? p.standardPrices : []).map(x => ({ itemId: str(x.itemId, 64), unitName: str(x.unitName, 40), rate: num(x.rate), price: num(x.price) })),
    shopPrices: (Array.isArray(p.shopPrices) ? p.shopPrices : []).map(x => ({ itemId: str(x.itemId, 64), unitName: str(x.unitName, 40), rate: num(x.rate), price: num(x.price) })),
  };
  if (manager) o.costPrice = num(p.costPrice);
  return o;
}
const listRow = p => ({ id: str(p.id, 64), number: str(p.number, 50), upc: str(p.upc, 50), name: str(p.name, 200), categoryName: str(p.categoryName, 100), imagePath: str(p.imagePath, 300), stock: num(p.quantityStock != null ? p.quantityStock : p.stockQuantity), ...prices(p) });
const paged = (v, fn) => { const rows = Array.isArray(v && v.rows) ? v.rows : Array.isArray(v) ? v : null; return rows ? { rows: rows.map(fn), total: num(v && v.total) != null ? Number(v.total) : rows.length } : null; };

const inboundRow = o => ({ id: str(o.id, 64), number: str(o.number, 50), status: num(o.status), statusName: str(o.statusName, 40), feeSet: !!o.feeSet, quantity: num(o.quantity), createTime: str(o.createTime, 40), creatorName: str(o.creatorName, 80), description: str(o.description || o.bak, 300) });
const inboundDetail = o => ({ ...inboundRow(o || {}), bak: str((o || {}).bak, 500), subs: (Array.isArray(o && o.subs) ? o.subs : []).map(s => ({
  id: str(s.id, 64), productId: str(s.productId, 64), number: str(s.number, 50), name: str(s.name, 200), imagePath: str(s.imagePath, 300), unitName: str(s.unitName, 40), rate: num(s.rate),
  quantity: num(s.quantity), quantityTotal: num(s.quantityTotal), weight: num(s.weight), volume: num(s.volume) })) });

// The seven-number dashboard model (sales, inventory, receiving): numbers only, no customer data.
const grp = (o, keys) => { o = o || {}; const r = {}; for (const k of keys) r[k] = num(o[k]) || 0; return r; };
const chart = a => (Array.isArray(a) ? a : []).slice(0, 60).map(x => ({ ...(x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === 'number' || typeof v === 'string').map(([k, v]) => [str(k, 30), typeof v === 'string' ? str(v, 40) : v])) : {}) }));
const dashboard = m => { m = m || {}; return {
  orderSumToday: grp(m.orderSumToday, ['amount', 'cashAmount', 'creditCardAmount', 'onlinePaymentAmount', 'otherPaymentAmount', 'quantity', 'orderCount']),
  orderSumRecent: grp(m.orderSumRecent, ['amount', 'quantity', 'orderCount']),
  stockSum: grp(m.stockSum, ['activeCount', 'lowStockCount', 'quantity']),
  inboundOrderSum: grp(m.inboundOrderSum, ['amount', 'quantity', 'orderCount']),
  saleRateSum: grp(m.saleRateSum, ['quantityRate', 'amountRate', 'orderCountRate']),
  stockRateSum: grp(m.stockRateSum, ['quantityRate', 'activeCountRate', 'inboundQuantityRate']),
  saleChartItems: chart(m.saleChartItems), inboundChartItems: chart(m.inboundChartItems) }; };

const eslRow = e => { e = e || {}; return { id: str(e.id, 64), code: str(e.code || e.eslCode, 60), status: num(e.status), statusName: str(e.statusName, 40), productNumber: str(e.productNumber, 50), productName: str(e.productName, 200), price: num(e.price), battery: num(e.battery), templateName: str(e.templateName, 80), lastSyncTime: str(e.lastSyncTime || e.updateTime, 40) }; };


// ---------- write helpers ----------
const CTRL = /[\u0000-\u001f\u007f]/;
const text = (v, max) => { const t = String(v == null ? '' : v).trim(); return t.length <= max && !CTRL.test(t) ? t : false; };
// price: a number >= 0 with at most 2 decimals (a number or a plain numeric string)
const price = v => { if (typeof v === 'string' && !/^\d{1,7}(\.\d{1,2})?$/.test(v.trim())) return null; const n = Number(v); if (v === '' || v == null || typeof v === 'boolean' || !Number.isFinite(n) || n < 0 || n > 9999999) return null; return Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-7 ? Math.round(n * 100) / 100 : null; };
const writeResult = r => { // a write reply is { success, message, value }; anything else = not saved
  if (r == null) return { bad: 'No answer from AIR POS' };
  if (r.loggedOut) return { bad: 'Please log in again', loggedOut: true };
  if (r.success === true) return { v: r.value, message: str(r.message, 160) };
  return { bad: r.uncertain ? 'AIR POS did not answer clearly. Look the item up before trying again; it may have been saved.' : (str(r.message, 160) || 'AIR POS refused the change'), uncertain: !!r.uncertain, unreachable: !!r.unreachable };
};
const shopLevel = (p, itemId) => { const a = (Array.isArray(p.shopPrices) ? p.shopPrices : []).find(x => x && String(x.itemId) === String(itemId)); return a ? num(a.price) : null; };

module.exports = ctx => {
  const { reg } = ctx;
  const canManage = () => !!ctx.isManager();
  const canEdit = () => canManage() && !!ctx.hasMenu(PERMISSION_MENU); // add / edit items (writes come later): a manager WITH the AIR POS Product Management permission
  // the ESL setting lives on this PC (label-settings.json, key esl; written by the Settings > Labels switch). Missing / anything but true = off.
  const eslOn = () => { try { return JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'label-settings.json'), 'utf8')).esl === true; } catch (e) { return false; } };
  const id = b => { const v = String((b && (b.id || b.productId)) || '').trim(); return ID_RE.test(v) ? v : ''; };
  const page = b => ({ page: int(b && b.page, 1, 1, 100000), pageSize: int(b && b.pageSize, 20, 1, 100) });
  const pageInfo = b => { const p = page(b); return JSON.stringify({ page: p.page, pageSize: p.pageSize, amount: 0 }); };
  const read = async (path_, params, shape) => { // one read: call, unwrap, shape
    let r; try { r = await reg.api.retail(path_, params); } catch (e) { return fail('Could not reach AIR POS'); }
    const u = unwrap(r); if (u.bad) return fail(u.bad, u.loggedOut ? { loggedOut: true } : {});
    const out = shape(u.v); return out == null ? fail('AIR POS sent an answer AirMax could not read') : { ok: true, ...out };
  };


  const FORBID = () => fail('Adding and editing items needs a manager with the AIR POS Product Management permission', { forbidden: true });
  const raw = async (path_, params) => { try { return await reg.api.retail(path_, params); } catch (e) { return { success: false, message: 'Could not reach AIR POS', unreachable: true }; } };
  const readProduct = async pid => { const r = unwrap(await raw('/Products/ProductGet', { productId: pid })); return r.bad ? { bad: r.bad, loggedOut: r.loggedOut } : (r.v && typeof r.v === 'object' && (r.v.id || r.v.number) ? { p: r.v } : { bad: 'Item not found' }); };
  // AIR POS reads can lag a moment behind a write (seen on TestShop: ProductGet still shows the old value for a few seconds), so after a write we look again,
  // up to ~4 seconds, until the item shows what was just saved. If it never does we still answer ok (the write itself was accepted) with stale:true.
  const settle = async (pid, test) => { let last = { bad: 'x' }; for (let i = 0; i < 9; i++) { last = await readProduct(pid); if (last.p && test(last.p)) return { p: last.p, stale: false }; if (i < 8) await new Promise(r => setTimeout(r, 500)); } return { p: last.p || null, stale: true }; };
  const submitWrite = async (path_, obj, extra) => { const w = writeResult(await raw(path_, { submit: JSON.stringify(obj) })); return w.bad ? fail(w.bad, { ...(w.loggedOut ? { loggedOut: true } : {}), ...(w.uncertain ? { uncertain: true } : {}) }) : { ok: true, message: w.message, value: w.v, ...(extra || {}) }; };
  // the fields AIR POS saves for an item (ProductAdd / ProductUpdate submit); returns { f } or { bad }
  const itemFields = (b, cur) => {
    const c = cur || {}, pick = (k, d) => (b && b[k] !== undefined ? b[k] : d);
    const number = text(pick('number', c.number), 50), name = text(pick('name', c.name), 100), upc = text(pick('upc', c.upc), 50), originCode = text(pick('originCode', c.originCode), 20);
    const categoryId = String(pick('categoryId', c.categoryId) || '').trim();
    if (!number) return { bad: 'Lookup code is required (up to 50 characters)' }; if (!name) return { bad: 'Name is required (up to 100 characters)' };
    if (!ID_RE.test(categoryId)) return { bad: 'Pick a department' }; if (upc === false) return { bad: 'Barcode is too long (up to 50 characters)' }; if (originCode === false) return { bad: 'Origin is not valid' };
    return { f: { number, name, upc: upc || '', originCode: originCode || '', categoryId, enabled: pick('enabled', c.enabled !== false) !== false, isRetailRefund: pick('isRetailRefund', c.isRetailRefund !== false) !== false } };
  };
  // price lines for 27: validates, compares with a fresh 23 read. returns { lines, subs, p } or { bad }
  const priceLines = async b => {
    const pid = id(b); if (!pid) return { bad: 'Pick an item first' };
    const cur = await readProduct(pid); if (cur.bad) return { bad: cur.bad, loggedOut: cur.loggedOut };
    const items_ = items(cur.p), ids = new Set(items_.map(i => i.id)), np = (b && b.prices && typeof b.prices === 'object') ? b.prices : {};
    const keys = Object.keys(np); if (!keys.length) return { bad: 'Type a new price first' };
    const lines = [];
    for (const k of keys) {
      if (!ids.has(k)) return { bad: 'That packing does not belong to this item' };
      const n = price(np[k]); if (n === null) return { bad: 'A price must be a number, 0 or more, with at most 2 decimals' };
      const it = items_.find(i => i.id === k), old = shopLevel(cur.p, k), pct = old && old > 0 ? Math.round((n - old) / old * 1000) / 10 : null;
      lines.push({ itemId: k, unitName: it.unitName, old, new: n, pct, same: old === n });
    }
    const taxKindId = String((b && b.taxKindId) || cur.p.shopTaxKindId || '').trim();
    if (!ID_RE.test(taxKindId)) return { bad: 'Pick a tax kind' };
    const subs = items_.map(i => { const l = lines.find(x => x.itemId === i.id); return { itemId: i.id, price: l ? l.new : (shopLevel(cur.p, i.id) != null ? shopLevel(cur.p, i.id) : (i.price != null ? i.price : 0)) }; });
    return { p: cur.p, lines, subs, taxKindId, name: str(cur.p.name, 200), number: str(cur.p.number, 50) };
  };

  return {
    routes: {
      // What this login may see and do on the Items tab. Everyone may look; add / edit needs a manager with the AIR POS permission; the dashboard needs a manager.
      'items-access': async () => ({ ok: true, manager: canManage(), canEdit: canEdit(), canSeeCost: canManage(), canSeeDashboard: canManage(), eslOn: eslOn(), permissionMenu: PERMISSION_MENU }),

      // existing search (ProductPaged, already used by AirMax) so the screen can pick an item and open it with items-get
      'items-find': async b => {
        const p = page(b); const kw = str(b && b.keyword, 60);
        let r; try { r = await reg.api.productPaged(kw, p.page, p.pageSize); } catch (e) { return fail('Could not reach AIR POS'); }
        const u = unwrap(r); if (u.bad) return fail(u.bad); const s = paged(u.v, listRow); return s ? { ok: true, ...s, page: p.page } : fail('AIR POS sent an answer AirMax could not read');
      },
      // 23 ProductGet: one product with its items and prices (the Item panel)
      'items-get': async b => { const pid = id(b); if (!pid) return fail('Pick an item first');
        return read('/Products/ProductGet', { productId: pid }, v => (v && typeof v === 'object' && (v.id || v.number) ? { product: product(v, canManage()) } : null)); },
      // 28 RetailQuickSellingProductPaged: the quick-add grid saved in AIR POS
      'items-quick': async b => { const p = page(b);
        return read('/Products/RetailQuickSellingProductPaged', { filter: JSON.stringify({ number: '', keyword: str(b && b.keyword, 60), categoryCode: null }), pageInfo: pageInfo(b) },
          v => { const s = paged(v, x => ({ id: str(x.id, 64), productId: str(x.productId, 64), number: str(x.number, 50), name: str(x.name, 200), imagePath: str(x.imagePath, 300), ...prices(x) })); return s && { ...s, page: p.page }; }); },
      // 32 RetailInboundOrderPaged: receiving orders (view only)
      'items-inbound': async b => { const p = page(b), bd = isDate(b && b.beginDate), ed = isDate(b && b.endDate);
        if (bd === false || ed === false) return fail('Dates must look like 2026-11-03');
        const st = b && b.status !== '' && b.status != null ? int(b.status, null, 0, 99) : null;
        return read('/InboundOrders/RetailInboundOrderPaged', { filter: JSON.stringify({ number: str(b && b.number, 50), productNumber: str(b && b.productNumber, 50), status: st, beginDate: bd, endDate: ed }), pageInfo: pageInfo(b) },
          v => { const s = paged(v, inboundRow); return s && { ...s, page: p.page }; }); },
      // 33 RetailInboundOrderGet: one receiving order with its lines
      'items-inbound-get': async b => { const oid = id(b); if (!oid) return fail('Pick a receiving order first');
        return read('/InboundOrders/RetailInboundOrderGet', { id: oid }, v => (v && typeof v === 'object' ? { order: inboundDetail(v) } : null)); },
      // 34 DashboardModelGet: sales + inventory tiles. Shows sales totals, so managers only (AIR POS hides the sales blocks from non-managers too).
      'items-dashboard': async () => { if (!canManage()) return fail('Only a manager can see the dashboard', { forbidden: true });
        return read('/Dashboards/DashboardModelGet', {}, v => (v && typeof v === 'object' ? { model: dashboard(v) } : null)); },
      // 143 RetailEslGet: one electronic shelf label. Only runs when the ESL setting is on (otherwise no call is made).
      'items-esl-get': async b => { if (!canManage()) return fail('Only a manager can look at shelf labels', { forbidden: true });
        if (!eslOn()) return fail('Electronic shelf labels are off', { eslOff: true });
        const eid = id(b); if (!eid) return fail('Pick a label first');
        return read('/Esls/RetailEslGet', { id: eid }, v => (v && typeof v === 'object' ? { esl: eslRow(v) } : null)); },

      // ---------------- WRITES (manager + AIR POS Product Management permission, checked here on every call) ----------------
      // 25 ProductAdd: step 1 of a new item (no price yet; stock starts at 0)
      'items-add': async b => { if (!canEdit()) return FORBID();
        const v = itemFields(b, null); if (v.bad) return fail(v.bad);
        const newId = require('crypto').randomUUID(); // like the AIR POS screen: the new item's id is made here (a new GUID) and sent with the add
        const r = await submitWrite('/Products/ProductAdd', { id: newId, ...v.f, titleImageRemoved: false }); if (!r.ok) return r;
        let pid = r.value && typeof r.value === 'object' ? str(r.value.id, 64) : typeof r.value === 'string' ? str(r.value, 64) : '';
        if (!ID_RE.test(pid)) pid = newId;
        const chk = await settle(pid, () => true); // make sure the id we hand back opens the item (AIR POS reads can lag a moment); if not, find it by its lookup code
        if (!chk.p) { try { const f = unwrap(await reg.api.productPaged(v.f.number, 1, 20)); const row = f.v && (Array.isArray(f.v.rows) ? f.v.rows : []).find(x => String(x.number) === v.f.number); if (row && ID_RE.test(String(row.id))) pid = String(row.id); } catch (e) { /* keep pid */ } }
        return { ok: true, message: r.message || 'Item saved', id: pid, number: v.f.number }; },
      // 26 ProductUpdate: item details (not prices). Missing fields keep the current value (fresh 23 read first).
      'items-update': async b => { if (!canEdit()) return FORBID();
        const pid = id(b); if (!pid) return fail('Pick an item first');
        const cur = await readProduct(pid); if (cur.bad) return fail(cur.bad, cur.loggedOut ? { loggedOut: true } : {});
        const v = itemFields(b, cur.p); if (v.bad) return fail(v.bad);
        const r = await submitWrite('/Products/ProductUpdate', { id: pid, ...v.f, titleImageRemoved: false }); if (!r.ok) return r;
        const st = await settle(pid, q => q.number === v.f.number && q.name === v.f.name && q.categoryId === v.f.categoryId && (q.enabled !== false) === v.f.enabled); return { ok: true, message: r.message || 'Item saved', id: pid, ...(st.stale ? { stale: true } : {}) }; },
      // 26 ProductUpdate with enabled=false: "Disable Item" (the screen asks first; confirm:true is required here too)
      'items-disable': async b => { if (!canEdit()) return FORBID();
        const pid = id(b); if (!pid) return fail('Pick an item first'); if (!b || b.confirm !== true) return fail('Please confirm first', { needConfirm: true });
        const cur = await readProduct(pid); if (cur.bad) return fail(cur.bad, cur.loggedOut ? { loggedOut: true } : {});
        const v = itemFields({ enabled: false }, cur.p); if (v.bad) return fail(v.bad);
        const r = await submitWrite('/Products/ProductUpdate', { id: pid, ...v.f, titleImageRemoved: false }); if (!r.ok) return r;
        const st = await settle(pid, q => q.enabled === false); return { ok: true, message: r.message || 'Item disabled', id: pid, ...(st.stale ? { stale: true } : {}) }; },
      // 27 step 1: what WOULD change (old -> new price, %). Writes nothing. Feeds the confirm box.
      'items-price-preview': async b => { if (!canEdit()) return FORBID();
        const l = await priceLines(b); if (l.bad) return fail(l.bad, l.loggedOut ? { loggedOut: true } : {});
        return { ok: true, id: id(b), name: l.name, number: l.number, taxKindId: l.taxKindId, lines: l.lines, nothingChanges: l.lines.every(x => x.same) }; },
      // 27 ProductPriceSave (MONEY). Needs confirm:true and `seen` = the old prices the confirm box showed. The item is re-read via 23 right before
      // saving; if a price moved since the box was shown, nothing is written and the new numbers are returned.
      'items-price': async b => { if (!canEdit()) return FORBID();
        if (!b || b.confirm !== true) return fail('Please confirm the price change first', { needConfirm: true });
        const l = await priceLines(b); if (l.bad) return fail(l.bad, l.loggedOut ? { loggedOut: true } : {});
        const seen = (b.seen && typeof b.seen === 'object') ? b.seen : null; if (!seen) return fail('Please confirm the price change first', { needConfirm: true });
        for (const x of l.lines) { const sv = seen[x.itemId] === undefined || seen[x.itemId] === null ? null : Number(seen[x.itemId]); if (sv !== x.old) return fail('This price was changed by someone else just now. Nothing was saved. Check the new price and confirm again.', { changed: true, lines: l.lines }); }
        if (l.lines.every(x => x.same)) return fail('The price is the same as before. Nothing to save.', { unchanged: true });
        const r = await submitWrite('/Products/ProductPriceSave', { shopId: reg.api.shop, productId: id(b), taxKindId: l.taxKindId, subs: l.subs }); if (!r.ok) return r;
        const want = l.lines.filter(x => !x.same), after = await settle(id(b), q => want.every(x => { const a = (Array.isArray(q.shopPrices) ? q.shopPrices : []).find(y => String(y.itemId) === x.itemId); return a && Number(a.price) === x.new; }));
        return { ok: true, message: r.message || 'Price saved', lines: l.lines, ...(after.stale ? { stale: true } : {}), ...(after.p ? { product: product(after.p, canManage()) } : {}) }; },
      // 29 QuickSellingProductAdd / 30 QuickSellingProductRemove: the AIR POS-side Quick Add grid only. Remove takes the grid-entry id from items-quick (not the product id).
      'items-quick-add': async b => { if (!canEdit()) return FORBID(); const pid = id(b); if (!pid) return fail('Pick an item first');
        const r = await submitWrite('/Products/QuickSellingProductAdd', { productId: pid }); return r.ok ? { ok: true, message: r.message || 'Added to the Quick Add grid' } : r; },
      'items-quick-remove': async b => { if (!canEdit()) return FORBID(); const gid = id(b); if (!gid) return fail('Pick a tile first');
        const r = await submitWrite('/Products/QuickSellingProductRemove', { id: gid }); return r.ok ? { ok: true, message: r.message || 'Removed from the Quick Add grid' } : r; },
    },
    unlocked: ['items-price-preview', 'items-access', 'items-find', 'items-get', 'items-quick', 'items-inbound', 'items-inbound-get', 'items-dashboard', 'items-esl-get'], // read-only: skip the one-at-a-time sale queue
    once: ['items-add', 'items-update', 'items-disable', 'items-price', 'items-quick-add', 'items-quick-remove'], // a second save while one runs is refused
    noSnap: ['items-access', 'items-find', 'items-get', 'items-quick', 'items-inbound', 'items-inbound-get', 'items-dashboard', 'items-esl-get'],
  };
};
module.exports.PERMISSION_MENU = PERMISSION_MENU;

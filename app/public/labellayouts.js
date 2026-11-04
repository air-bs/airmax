// Air Max 1.0.11-local.9 (Ari OK 6:30 PM ET Nov 1, test build): Label Layouts. The 12 First Choice label layouts Ari uses,
// drawn with the same label maker (label.js primitives in printer dots), so preview, PDF and ZPL all agree.
// Only "Custom 2.25 x 1.25 wPrice Label" is matched to a printed sample (Ari's photo); the others are sensible first
// versions marked "to be matched to Ari's samples".
// Also: the Label price guard (a barcode scanned into the price box never becomes a price) and the default layout
// per item / department (saved on this PC only). Nothing here talks to AIR POS.
(function (g) {
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./label.js') : g.AirLabel;
  const money = L.money;
  // item: { name, number, upc, price (what the label shows), regular (the price before a sale / list price) }
  const onSale = it => Number(it.regular) > Number(it.price) + 0.004;
  function ctx(w, h, dpi) { const W = Math.round(w * dpi), H = Math.round(h * dpi); return { W, H, dpi, out: [] }; }
  const T = (c, x, y, size, s, o = {}) => { c.out.push({ t: 'text', x: Math.round(x), y: Math.round(y), size: Math.max(6, Math.round(size)), bold: !!o.bold, s: String(s), align: o.align || 'left', ...(o.role ? { role: o.role } : {}), ...(o.white ? { white: true } : {}), ...(o.strike ? { strike: true } : {}) }); };
  // name block: 1 line, else 2 lines; returns the y under it
  function nameAt(c, name, x, y, w, size, lines, o = {}) {
    if (!name) return y;
    const cx = x + w / 2; if (o.bold) { w = Math.round(w * 0.92); if (o.align === 'left') { /* keep x */ } else x = cx - w / 2; } // the width estimate runs a little narrow for bold mixed case
    if (o.greedy) return greedyAt(c, o.upper ? String(name).toUpperCase() : String(name), x, y, w, size, lines || 2, o);
    const f = L.fitName(o.upper ? String(name).toUpperCase() : String(name), Math.round(size), w, Math.round(size * 1.12 * (lines || 2)), Math.max(8, Math.round(size * 0.6)));
    const lh = o.lh || 1.12;
    for (const l of f.lines) { T(c, o.align === 'left' ? x : x + w / 2, y, f.s, l, { bold: o.bold, align: o.align === 'left' ? 'left' : 'center', role: 'name' }); y += Math.round(f.s * lh); }
    return y;
  }
  // First Choice wraps by filling the first line ("COMIC KINDER COMICS / MIDOSVILLE"); shrink only when it cannot fit
  function greedyAt(c, t, x, y, w, size, lines, o) {
    const words = t.split(/\s+/).filter(Boolean), lh = o.lh || 1.12;
    for (let s = Math.round(size); s >= 8; s--) {
      const out = []; let cur = '';
      for (const wd of words) { const nx = cur ? cur + ' ' + wd : wd; if (L.textW(nx, s, o.bold) <= w || !cur) cur = nx; else { out.push(cur); cur = wd; } }
      if (cur) out.push(cur);
      const fits = out.length <= lines && out.every(l => L.textW(l, s, o.bold) <= w);
      if (fits || s === 8) {
        const ls = out.slice(0, lines); if (out.length > lines) ls[lines - 1] = L.fit(out.slice(lines - 1).join(' '), s, w, o.bold, s).t;
        for (const l of ls) { const f = L.fit(l, s, w, o.bold, s); T(c, x + w / 2, y, s, f.t, { bold: o.bold, align: 'center', role: 'name' }); y += Math.round(s * lh); }
        return y;
      }
    }
    return y;
  }
  // Code 128 centred on cx, as wide as fits in maxW (module 1..4 dots); digits under it when asked
  function barsAt(c, code, cx, y, maxW, h, digits, target) {
    if (!code) return y;
    const b = L.code128(code), mc = L.moduleCount(b);
    let m = Math.max(1, Math.min(4, Math.floor(maxW / (mc + 20)) || 1));
    if (target) { m = Math.max(1, Math.min(4, Math.round(target / mc))); while (m > 1 && mc * m > maxW) m--; } // as close to the sample's bar width as whole dots allow
    const bw = mc * m;
    c.out.push({ t: 'bars', x: Math.round(cx - bw / 2), y: Math.round(y), h: Math.round(h), m, mods: L.modules(b), text: b.text, set: b.set });
    y += h + 2;
    if (digits) { const ds = Math.max(10, Math.round(c.H * 0.07)); T(c, cx, y, ds, b.text, { align: 'center' }); y += Math.round(ds * 1.1); }
    return y;
  }
  const priceAt = (c, p, x, y, size, maxW, o = {}) => { const f = L.fitAll(money(p) + (o.suffix || ''), Math.round(size), maxW, !!o.bold); T(c, x, y, f.s, f.t, { bold: o.bold, align: o.align, role: 'price' }); return f.s; };
  const fin = (c, item, id, extra) => ({ W: c.W, H: c.H, dpi: c.dpi, items: c.out, price: Number(item.price), onSale: onSale(item), regular: onSale(item) ? Number(item.regular) : null, code: L.barcodeText(item), layout: id, ...(extra || {}) });

  // ---- the layouts ----------------------------------------------------------------------------------------------
  // w x h = the printed label in inches (width across the roll x height along it)
  const B = {};
  B.std = (it, o) => { // the Air Max label as it is today (Settings > Labels choices), at 2.25 x 1.25
    const s = { ...(o.settings || {}), size: '2.25x1.25', dpi: o.dpi };
    return [L.layout(it, s)];
  };
  B.each = (it, o) => {
    const c = ctx(2.25, 1.25, o.dpi), { W, H } = c, pad = Math.round(H * 0.06);
    let y = nameAt(c, it.name, pad, pad, W - 2 * pad, H * 0.13, 2, { upper: true, bold: true });
    y = barsAt(c, L.barcodeText(it), W / 2, y + 2, W - 2 * pad, H * 0.22);
    const ps = Math.min(H * 0.3, H - pad - y);
    const f = priceAt(c, it.price, pad, H - pad - ps * 0.92, ps, W * 0.62);
    T(c, W - pad, H - pad - f * 0.6, Math.round(H * 0.13), 'EACH', { bold: true, align: 'right' });
    return [fin(c, it, 'each')];
  };
  // Ari's printed sample (2 stickers on the roll per copy): measured from the photo, as fractions of the sticker
  B.wprice = (it, o) => {
    const a = ctx(2.25, 1.25, o.dpi), W = a.W, H = a.H;
    nameAt(a, it.name, W * 0.04, H * 0.025, W * 0.92, H * 0.108, 2, { upper: true, lh: 1.15, greedy: true });
    barsAt(a, L.barcodeText(it), W / 2, H * 0.265, W * 0.9, H * 0.22, false, W * 0.65);
    a.out.push({ t: 'box', x: Math.round(W * 0.05), y: Math.round(H * 0.575), w: Math.round(W * 0.37), h: Math.round(H * 0.125) });
    T(a, W * 0.07, H * 0.585, H * 0.11, 'YOU PAY', { bold: true, white: true });
    priceAt(a, it.price, W * 0.02, H * 0.715, H * 0.27, W * 0.9);
    const b = ctx(2.25, 1.25, o.dpi);
    b.out.push({ t: 'frame', x: Math.round(W * 0.11), y: Math.round(H * 0.09), w: Math.round(W * 0.69), h: Math.round(H * 0.61), lw: 2 });
    nameAt(b, it.name, W * 0.13, H * 0.115, W * 0.65, H * 0.105, 2, { bold: false, lh: 1.25, greedy: true });
    priceAt(b, it.price, W * 0.455, H * 0.41, H * 0.25, W * 0.62, { bold: true, align: 'center' });
    return [fin(a, it, 'wprice', { part: 1 }), fin(b, it, 'wprice', { part: 2 })];
  };
  B.disc = (it, o) => {
    const c = ctx(2.25, 1.25, o.dpi), { W, H } = c, pad = Math.round(H * 0.05);
    let y = nameAt(c, it.name, pad, pad, W - 2 * pad, H * 0.12, 2, { upper: true, bold: true });
    y = barsAt(c, L.barcodeText(it), W / 2, y + 2, W * 0.7, H * 0.18);
    if (onSale(it)) {
      T(c, pad, y + H * 0.02, H * 0.1, 'Reg. ' + money(it.regular), { strike: true });
      c.out.push({ t: 'box', x: Math.round(W * 0.55), y: Math.round(y + H * 0.01), w: Math.round(W * 0.45 - pad), h: Math.round(H * 0.12) });
      T(c, W * 0.55 + (W * 0.45 - pad) / 2, y + H * 0.02, H * 0.1, 'SALE', { bold: true, white: true, align: 'center' });
    }
    priceAt(c, it.price, W / 2, H - pad - H * 0.27, H * 0.28, W - 2 * pad, { bold: true, align: 'center' });
    return [fin(c, it, 'disc')];
  };
  B.list = (it, o) => { // "NEW FONT": bigger, bolder name; List Price line, then Our Price
    const c = ctx(2.25, 1.25, o.dpi), { W, H } = c, pad = Math.round(H * 0.05);
    let y = nameAt(c, it.name, pad, pad, W - 2 * pad, H * 0.15, 2, { bold: true });
    y = barsAt(c, L.barcodeText(it), W / 2, y + 2, W * 0.7, H * 0.16);
    const list = onSale(it) ? Number(it.regular) : Number(it.price);
    T(c, pad, y + H * 0.02, H * 0.1, 'List Price ' + money(list), { strike: onSale(it) });
    T(c, pad, H - pad - H * 0.2, H * 0.09, onSale(it) ? 'Our Price' : 'Price', { bold: true });
    priceAt(c, it.price, W - pad, H - pad - H * 0.27, H * 0.27, W * 0.6, { bold: true, align: 'right' });
    return [fin(c, it, 'list')];
  };
  B.bc12 = (it, o) => { // 1 x 2: mostly barcode
    const c = ctx(2, 1, o.dpi), { W, H } = c, pad = Math.round(H * 0.06);
    let y = nameAt(c, it.name, pad, pad, W - 2 * pad, H * 0.13, 1, { upper: true, bold: true });
    y = barsAt(c, L.barcodeText(it), W / 2, y + 2, W - 2 * pad, H * 0.42, true);
    priceAt(c, it.price, W - pad, H - pad - H * 0.15, H * 0.15, W * 0.5, { bold: true, align: 'right' });
    if (it.number) T(c, pad, H - pad - H * 0.12, H * 0.11, '#' + it.number);
    return [fin(c, it, 'bc12')];
  };
  B.shelf125 = (it, o) => { // shelf: name left, big price right, barcode bottom left
    const c = ctx(2.25, 1.25, o.dpi), { W, H } = c, pad = Math.round(H * 0.05);
    if (o.store) T(c, pad, pad, H * 0.08, o.store, { bold: true });
    let y = nameAt(c, it.name, pad, pad + H * 0.1, W - 2 * pad, H * 0.12, 2, { bold: true, align: 'left' });
    priceAt(c, it.price, W - pad, y + H * 0.02, H * 0.3, W * 0.55, { bold: true, align: 'right' });
    barsAt(c, L.barcodeText(it), pad + W * 0.22, H - pad - H * 0.24, W * 0.44, H * 0.16, false);
    if (it.number) T(c, pad, H - pad - H * 0.07, H * 0.07, String(it.number));
    return [fin(c, it, 'shelf125')];
  };
  B.shelf15x3 = (it, o) => {
    const c = ctx(3, 1.5, o.dpi), { W, H } = c, pad = Math.round(H * 0.05);
    c.out.push({ t: 'box', x: 0, y: 0, w: W, h: Math.round(H * 0.14) });
    T(c, W / 2, H * 0.02, H * 0.1, o.store || ' ', { bold: true, white: true, align: 'center' });
    nameAt(c, it.name, pad, H * 0.18, W * 0.5, H * 0.13, 2, { bold: true, align: 'left' });
    if (onSale(it)) T(c, W - pad, H * 0.18, H * 0.09, 'Reg. ' + money(it.regular), { strike: true, align: 'right' });
    priceAt(c, it.price, W - pad, H * 0.3, H * 0.36, W * 0.42, { bold: true, align: 'right' });
    barsAt(c, L.barcodeText(it), pad + W * 0.25, H - pad - H * 0.26, W * 0.5, H * 0.17, false);
    if (it.number) T(c, pad, H - pad - H * 0.08, H * 0.08, 'Item ' + it.number);
    return [fin(c, it, 'shelf15x3')];
  };
  B.c2x4 = (it, o) => {
    const c = ctx(4, 2, o.dpi), { W, H } = c, pad = Math.round(H * 0.05);
    if (o.store) T(c, W / 2, pad, H * 0.07, o.store, { bold: true, align: 'center' });
    let y = nameAt(c, it.name, pad, pad + H * 0.1, W - 2 * pad, H * 0.13, 2, { bold: true });
    y = barsAt(c, L.barcodeText(it), W / 2, y + 4, W * 0.6, H * 0.17, true);
    const ps = Math.max(12, Math.min(H * 0.3, (H - pad - y - 4) / 0.95));
    if (onSale(it)) T(c, pad, H - pad - ps * 0.6, H * 0.08, 'Reg. ' + money(it.regular), { strike: true });
    priceAt(c, it.price, W / 2, H - pad - ps * 0.95, ps, W * 0.56, { bold: true, align: 'center' });
    return [fin(c, it, 'c2x4')];
  };
  B.po = (it, o) => { // receiving: item number + barcode big, price small; no cost on the label
    const c = ctx(4, 2.5, o.dpi), { W, H } = c, pad = Math.round(H * 0.05);
    T(c, pad, pad, H * 0.06, (o.store ? o.store + '  -  ' : '') + 'RECEIVED ' + (o.date || ''), { bold: true });
    let y = nameAt(c, it.name, pad, pad + H * 0.1, W - 2 * pad, H * 0.11, 2, { bold: true, align: 'left' });
    T(c, pad, y + 4, H * 0.12, 'Item # ' + (it.number || ''), { bold: true }); y += H * 0.16;
    barsAt(c, L.barcodeText(it), W / 2, y, W * 0.8, H * 0.26, true);
    priceAt(c, it.price, W - pad, H - pad - H * 0.12, H * 0.12, W * 0.4, { align: 'right' });
    if (it.dept) T(c, pad, H - pad - H * 0.08, H * 0.08, it.dept);
    return [fin(c, it, 'po')];
  };
  B.sticker2026 = (it, o) => { // guess: a 2 x 2 round-corner sticker, price in a frame
    const c = ctx(2, 2, o.dpi), { W, H } = c, pad = Math.round(H * 0.06);
    c.out.push({ t: 'frame', x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad, lw: 3 });
    let y = nameAt(c, it.name, pad * 2, pad * 2, W - 4 * pad, H * 0.1, 2, { bold: true });
    priceAt(c, it.price, W / 2, y + H * 0.06, H * 0.24, W - 5 * pad, { bold: true, align: 'center' });
    barsAt(c, L.barcodeText(it), W / 2, H - pad * 2 - H * 0.16, W * 0.7, H * 0.14, false);
    return [fin(c, it, 'sticker2026')];
  };
  B.clearbin = (it, o) => { // guess: 3 x 1 bin front, big name, price, barcode
    const c = ctx(3, 1, o.dpi), { W, H } = c, pad = Math.round(H * 0.06);
    nameAt(c, it.name, pad, pad, W * 0.62, H * 0.24, 2, { bold: true, align: 'left' });
    priceAt(c, it.price, W - pad, pad, H * 0.36, W * 0.34, { bold: true, align: 'right' });
    barsAt(c, L.barcodeText(it), pad + W * 0.3, H - pad - H * 0.3, W * 0.6, H * 0.28, false);
    if (it.number) T(c, W - pad, H - pad - H * 0.14, H * 0.13, '#' + it.number, { align: 'right' });
    return [fin(c, it, 'clearbin')];
  };
  // id, First Choice name, size (w x h in), stickers per copy, matched to a sample?
  const LAYOUTS = [
    ['std', '2.25 x 1.25 label', 2.25, 1.25, 1, false],
    ['each', '2.25 x 1.25 label Each', 2.25, 1.25, 1, false],
    ['wprice', 'Custom 2.25 x 1.25 wPrice Label', 2.25, 1.25, 2, true],
    ['disc', 'Custom 2.25 x 1.25 Discounted Price', 2.25, 1.25, 1, false],
    ['list', 'Item Label with List Price NEW FONT', 2.25, 1.25, 1, false],
    ['bc12', 'Item-Label 1 X 2 - Barcode', 2, 1, 1, false],
    ['shelf125', 'Shelf Label 1.25 x 2.25', 2.25, 1.25, 1, false],
    ['shelf15x3', 'Shelf Label 1.5 x 3 Layout', 3, 1.5, 1, false],
    ['c2x4', 'Custom 2 x 4', 4, 2, 1, false],
    ['po', 'PO Receiving 2.5 x 4', 4, 2.5, 1, false],
    ['sticker2026', 'Custom Design STICKER2026', 2, 2, 1, false],
    ['clearbin', 'Custom Design CLEAR BIN LABELS', 3, 1, 1, false],
  ].map(([id, name, w, h, parts, matched]) => Object.freeze({ id, name, w, h, parts, matched, note: matched ? 'Matched to Ari\'s printed sample' : 'To be matched to Ari\'s samples' }));
  const DEFAULT = 'wprice';
  const byId = id => LAYOUTS.find(l => l.id === id) || null;
  // item from AIR POS + an optional label price -> what the label shows (the item in AIR POS is never changed)
  function labelItem(item, labelPrice) {
    const it = { ...item }, now = Number(item.price), reg = Number(item.regular);
    if (labelPrice != null && Number.isFinite(Number(labelPrice))) { it.price = Number(labelPrice); it.regular = Math.max(Number.isFinite(reg) ? reg : 0, Number.isFinite(now) ? now : 0) || null; }
    return it;
  }
  // -> [sticker layouts] (one per sticker of ONE copy)
  function render(item, id, opts = {}) {
    const b = B[byId(id) ? id : DEFAULT], o = { dpi: [203, 300].includes(Number(opts.dpi)) ? Number(opts.dpi) : 203, settings: opts.settings, store: String(opts.store || '').slice(0, 40), date: opts.date || '' };
    return b(labelItem(item || {}, opts.labelPrice), o).map(x => ({ ...x, layout: byId(id) ? id : DEFAULT }));
  }

  // ---- Label price guard ------------------------------------------------------------------------------------------
  // First Choice photo: the barcode 75720000814 went into the Price box and the label said $75,720. Here a price is at
  // most 4 digits before the point (max $9,999.99), never 6+ digits in a row, and never wildly above the AIR POS price.
  const MAX = 9999.99;
  function priceGuard(raw, airposPrice) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return { ok: true, value: null };
    const digits = s.replace(/^\$/, '');
    if (/^\d{6,}$/.test(digits)) return { ok: false, toLookup: true, reason: 'That looks like a barcode, not a price. It went to Lookup.' };
    if (!/^\$?(\d{1,4}(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return { ok: false, reason: 'Type a price like 4.99 (no commas, at most $9,999.99).' };
    const v = Math.round(Number(digits) * 100) / 100;
    if (!(v > 0)) return { ok: false, reason: 'The label price must be more than $0.00.' };
    if (v > MAX) return { ok: false, reason: 'Too high for a label price.' };
    const ap = Number(airposPrice);
    if (v >= 1000 && !(Number.isFinite(ap) && ap > 0 && v <= ap * 10)) return { ok: false, reason: `${money(v)} looks wrong for this item${Number.isFinite(ap) && ap > 0 ? ` (AIR POS price ${money(ap)})` : ''}. Check the number.` };
    return { ok: true, value: v };
  }
  // a scanner types a whole code in a few ms per key; a person types 80 ms+ per key. times = key times in ms
  function isBurst(times, text) {
    const t = (times || []).filter(Number.isFinite); const s = String(text || '');
    if (t.length < 6 || s.replace(/\D/g, '').length < 6) return false;
    return (t[t.length - 1] - t[0]) / (t.length - 1) < 35;
  }

  // ---- default layout: item number, then department, then the store default ------------------------------------
  function pickDefault(item, d) {
    d = d || {}; const it = item || {};
    const k = String(it.number || '').trim(), dep = String(it.dept || '').trim().toLowerCase();
    if (k && d.items && byId(d.items[k])) return { id: d.items[k], from: 'item' };
    if (dep && d.depts && byId(d.depts[dep])) return { id: d.depts[dep], from: 'department' };
    if (byId(d.def)) return { id: d.def, from: 'store' };
    return { id: DEFAULT, from: 'built-in' };
  }
  function normDefaults(x) {
    x = x && typeof x === 'object' ? x : {};
    const clean = (m, lower) => { const o = {}; if (m && typeof m === 'object') for (const [k, v] of Object.entries(m).slice(0, 5000)) { const kk = String(k).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80); if (kk && byId(v)) o[lower ? kk.toLowerCase() : kk] = v; } return o; };
    return { def: byId(x.def) ? x.def : '', items: clean(x.items), depts: clean(x.depts, true), printer: String(x.printer || '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) };
  }
  const api = { LAYOUTS, DEFAULT, byId, render, labelItem, priceGuard, isBurst, pickDefault, normDefaults, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.AirLabelLayouts = api;
})(typeof window !== 'undefined' ? window : globalThis);

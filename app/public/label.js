// AirMax Print Label (Ari OK 2:30 PM ET Oct 30, 2026). ONE label layout shared by the live preview (SVG, browser), the
// Windows-driver print (PDF, server) and Zebra printers (ZPL, server). Read-only: it only draws name / price / barcode.
// Units are printer dots (dpi from the label settings, default 203). Code 128 barcode (set C for even all-digit codes, else B).
(function (g) {
  'use strict';
  const P = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
  // code values (start, data..., checksum, stop) for a text; null when nothing printable
  function code128(text) {
    const t = String(text == null ? '' : text).replace(/[^\x20-\x7e]/g, '');
    if (!t) return null;
    let codes;
    if (/^\d+$/.test(t) && t.length % 2 === 0 && t.length >= 4) { codes = [105]; for (let i = 0; i < t.length; i += 2) codes.push(Number(t.slice(i, i + 2))); }
    else { codes = [104]; for (const ch of t) codes.push(ch.charCodeAt(0) - 32); }
    let sum = codes[0]; for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
    codes.push(sum % 103, 106);
    return { text: t, codes, set: codes[0] === 105 ? 'C' : 'B' };
  }
  // bar/space widths in modules, starting with a bar
  function modules(c) { const out = []; for (const v of c.codes) for (const d of P[v]) out.push(Number(d)); return out; }
  function moduleCount(c) { return modules(c).reduce((a, b) => a + b, 0); }

  const DEF = Object.freeze({
    printer: '', method: 'auto', size: '2.25x1.25', w: 2.25, h: 1.25, dpi: 203, priceMode: 'sale',
    show: Object.freeze({ name: true, barcode: true, digits: false, price: true, tag: true, regPrice: false, sku: false, store: false }),
    tag: 'YOU PAY', store: '', font: 'normal', nameSize: 'same', copies: 1, darkness: 'normal',
  });
  const SIZES = [['2.25x1.25', '2.25 × 1.25 in (57 × 32 mm)', 2.25, 1.25], ['2x1', '2 × 1 in (51 × 25 mm)', 2, 1], ['1.5x1', '1.5 × 1 in (38 × 25 mm)', 1.5, 1], ['3x2', '3 × 2 in (76 × 51 mm)', 3, 2], ['custom', 'Custom size', 0, 0]];
  const FONTS = { small: 0.85, normal: 1, large: 1.15 };
  // 1.0.10-local.2 (Ari 11:53 'I want the name to be in bigger'): name size on its own; 'same' = follow Font size
  const NAMES = { same: 0, large: 1.25, xlarge: 1.6 };
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const str = (v, max) => String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, '').slice(0, max);
  // clean any saved / typed settings into a safe, complete object (unknown keys dropped)
  function norm(s) {
    s = s && typeof s === 'object' ? s : {};
    const o = { ...DEF, show: { ...DEF.show } };
    o.printer = str(s.printer, 200);
    o.method = ['auto', 'zpl', 'driver', 'dialog'].includes(s.method) ? s.method : 'auto';
    const sz = SIZES.find(x => x[0] === s.size);
    if (sz && sz[0] !== 'custom') { o.size = sz[0]; o.w = sz[2]; o.h = sz[3]; }
    else if (sz) { o.size = 'custom'; o.w = num(s.w, 0.75, 6, 2.25); o.h = num(s.h, 0.5, 6, 1.25); }
    o.dpi = [203, 300].includes(Number(s.dpi)) ? Number(s.dpi) : 203;
    o.priceMode = s.priceMode === 'regular' ? 'regular' : 'sale';
    const sh = s.show && typeof s.show === 'object' ? s.show : {};
    for (const k of Object.keys(DEF.show)) if (k in sh) o.show[k] = !!sh[k];
    o.tag = 'tag' in s ? str(s.tag, 24) : DEF.tag;
    o.store = str(s.store, 40);
    o.font = FONTS[s.font] ? s.font : 'normal';
    o.nameSize = s.nameSize in NAMES ? s.nameSize : 'same';
    o.copies = Math.round(num(s.copies, 1, 50, 1));
    o.darkness = ['light', 'normal', 'dark'].includes(s.darkness) ? s.darkness : 'normal';
    return o;
  }
  const money = n => '$' + (Math.round(Number(n) * 100) / 100).toFixed(2);
  // which price goes on the label: the price AIR POS gives now (the sale price when on sale) unless set to regular
  function prices(item, s) {
    const now = Number(item.price), reg = Number(item.regular);
    const onSale = Number.isFinite(now) && Number.isFinite(reg) && reg > now + 0.004;
    const price = s.priceMode === 'regular' && onSale ? reg : now;
    return { price: Number.isFinite(price) ? price : null, onSale, regular: onSale ? reg : null };
  }
  function barcodeText(item) { const u = String(item.upc || '').trim(); return u || String(item.number || '').trim(); }
  // rough Helvetica widths (em), same estimate everywhere so the preview and the print agree
  function textW(t, size, bold) {
    let w = 0; for (const ch of String(t)) w += ch === ' ' ? 0.28 : '.,:;!|il\''.includes(ch) ? 0.28 : /[0-9$]/.test(ch) ? 0.56 : /[MW]/.test(ch) ? 0.86 : /[A-Z]/.test(ch) ? (bold ? 0.7 : 0.66) : 0.56;
    return w * size;
  }
  function fit(t, size, maxW, bold, min) {
    let s = size; while (s > min && textW(t, s, bold) > maxW) s -= 1;
    if (textW(t, s, bold) <= maxW) return { t, s };
    let x = String(t); while (x.length > 1 && textW(x + '…', s, bold) > maxW) x = x.slice(0, -1);
    return { t: x.trimEnd() + '…', s };
  }
  // never cut the price: shrink until it fits (no '…')
  function fitAll(t, size, maxW, bold) { let s = size; while (s > 6 && textW(t, s, bold) > maxW) s -= 1; return { t, s }; }
  // the name: one line, else wrap to 2 lines at the SAME size, and only then shrink; maxH = room for the name block
  function wrap2(t, s, maxW, bold) {
    const w = String(t).split(/\s+/).filter(Boolean); if (w.length < 2) return null;
    let best = null;
    for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(' '), b = w.slice(i).join(' '), m = Math.max(textW(a, s, bold), textW(b, s, bold)); if (m <= maxW && (!best || m < best.m)) best = { m, l: [a, b] }; }
    return best && best.l;
  }
  function fitName(t, size, maxW, maxH, min) {
    const lh = 1.12; let s = Math.max(min, Math.min(size, Math.floor(maxH / lh)));
    for (; s >= min; s--) {
      if (textW(t, s, true) <= maxW && s * lh <= maxH) return { lines: [t], s };
      if (2 * s * lh <= maxH) { const l = wrap2(t, s, maxW, true); if (l) return { lines: l, s }; }
    }
    s = Math.max(6, Math.min(min, Math.floor(maxH / lh)));
    if (2 * s * lh <= maxH) { // still too long: 2 lines, '…' on the second
      const w = String(t).split(/\s+/); let a = ''; while (w.length && textW((a ? a + ' ' : '') + w[0], s, true) <= maxW) a = (a ? a + ' ' : '') + w.shift();
      if (a && w.length) return { lines: [a, fit(w.join(' '), s, maxW, true, s).t], s };
    }
    const f = fit(t, s, maxW, true, s); return { lines: [f.t], s: f.s };
  }
  // item: { name, number, upc, price, regular }  ->  { W, H, items: [primitives], price, onSale, code }
  function layout(item, settings) {
    const s = norm(settings), sh = s.show, k = FONTS[s.font];
    const W = Math.round(s.w * s.dpi), H = Math.round(s.h * s.dpi), pad = Math.round(Math.min(W, H) * 0.06), inner = W - 2 * pad;
    const pr = prices(item || {}, s), code = barcodeText(item || {}), out = [];
    let y = pad;
    if (sh.store && s.store) { const f = fit(s.store, Math.round(H * 0.085 * k), inner, true, 10); out.push({ t: 'text', x: pad, y, size: f.s, bold: true, s: f.t, align: 'left' }); y += Math.round(f.s * 1.1); }
    const c = sh.barcode ? code128(code) : null, k2 = Math.min(k, 1.15), big = s.nameSize !== 'same';
    const bhK = sh.digits ? (big ? 0.15 : 0.2) : (big ? 0.17 : 0.24); // a bigger name takes some barcode height (still scannable), never the price
    if (sh.name && item && item.name) {
      // room left for the name = label minus the barcode block and a floor kept for the price + tag (the price never gets squeezed out)
      const barH = c ? Math.round(H * bhK) + Math.round(H * 0.015) + (sh.digits ? Math.round(Math.max(10, Math.round(H * 0.07 * k2)) * 1.1) : 0) : 0;
      const floor = (sh.price && prices(item, s).price != null ? Math.round(H * 0.24 * k2) : 0) + (sh.tag && s.tag ? Math.round(H * 0.1 * k2) : 0) + Math.round(H * 0.02);
      const nk = NAMES[s.nameSize] || k, base = Math.round(H * (c ? 0.13 : 0.19) * nk); // no barcode: its space goes to the name
      const f = fitName(String(item.name).toUpperCase(), base, inner, Math.max(12, H - pad - y - barH - floor), 12);
      for (const l of f.lines) { out.push({ t: 'text', x: W / 2, y, size: f.s, bold: true, s: l, align: 'center', role: 'name' }); y += Math.round(f.s * 1.12); }
    }
    if (c) {
      const mc = moduleCount(c) + 20, m = Math.max(1, Math.min(4, Math.floor(inner / mc)));
      const bh = Math.round(H * bhK), bw = (mc - 20) * m;
      out.push({ t: 'bars', x: Math.round((W - bw) / 2), y, h: bh, m, mods: modules(c), text: c.text, set: c.set });
      y += bh + Math.round(H * 0.015);
      if (sh.digits) { const ds = Math.max(10, Math.round(H * 0.07 * k2)); out.push({ t: 'text', x: W / 2, y, size: ds, bold: false, s: c.text, align: 'center' }); y += Math.round(ds * 1.1); }
    }
    // bottom: tag box + big price on the left; Reg. / SKU on the right
    const bottom = H - pad, room = bottom - y - Math.round(H * 0.02);
    let tagH = sh.tag && s.tag ? Math.round(H * 0.15 * k) : 0, ps = sh.price && pr.price != null ? Math.round(H * 0.3 * k) : 0;
    if (tagH + ps > room && tagH + ps > 0) { const r = Math.max(0, room) / (tagH + ps); tagH = Math.floor(tagH * r); ps = Math.floor(ps * r); }
    const right = [];
    if (sh.regPrice && pr.onSale && pr.regular != null && s.priceMode === 'sale') right.push({ s: 'Reg. ' + money(pr.regular), strike: true });
    if (sh.sku && item && item.number) right.push({ s: 'SKU ' + String(item.number) });
    const rs = Math.max(10, Math.round(H * 0.075 * k));
    let leftMax = inner; if (right.length) leftMax = inner - Math.max(...right.map(r => textW(r.s, rs, false))) - pad;
    if (ps >= 8) { const f = fitAll(money(pr.price), ps, leftMax, false); out.push({ t: 'text', x: pad, y: bottom - Math.round(f.s * 0.92), size: f.s, bold: false, s: f.t, align: 'left', role: 'price' }); }
    if (tagH >= 8) {
      const ts = Math.round(tagH * 0.8), tf = fit(String(s.tag).toUpperCase(), ts, leftMax - Math.round(ts * 0.6), true, 8), bw = Math.round(textW(tf.t, tf.s, true) + tf.s * 0.6);
      const ty = bottom - (ps >= 8 ? Math.round(ps * 0.92) : 0) - tagH - Math.round(H * 0.01);
      out.push({ t: 'box', x: pad, y: ty, w: bw, h: tagH }); out.push({ t: 'text', x: pad + Math.round(tf.s * 0.3), y: ty + Math.round((tagH - tf.s) / 2), size: tf.s, bold: true, s: tf.t, align: 'left', white: true });
    }
    right.reverse().forEach((r, i) => out.push({ t: 'text', x: W - pad, y: bottom - Math.round(rs * (1.05 * (i + 1))), size: rs, bold: false, s: r.s, align: 'right', strike: !!r.strike }));
    return { W, H, dpi: s.dpi, items: out, price: pr.price, onSale: pr.onSale, regular: pr.regular, code };
  }
  // the strike line covers only the money part of "Reg. $12.99": [x from, x to] in dots
  function strikeX(p) { const w = textW(p.s, p.size, p.bold), x0 = p.align === 'center' ? p.x - w / 2 : p.align === 'right' ? p.x - w : p.x, i = p.s.indexOf('$'); return [x0 + (i > 0 ? textW(p.s.slice(0, i), p.size, p.bold) : 0), x0 + w]; }
  const xesc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // 1.0.10-local.2 Hebrew item names: right-to-left lines; Helvetica (PDF) / ZPL font 0 have no Hebrew, so such a label goes as a picture
  const RTL_RE = /[\u0590-\u05ff\u0600-\u06ff\ufb1d-\ufdff\ufe70-\ufeff]/, LTR_RE = /[A-Za-z\u00c0-\u024f]/;
  const isRtl = t => { for (const ch of String(t)) { if (RTL_RE.test(ch)) return true; if (LTR_RE.test(ch)) return false; } return false; }; // first strong letter
  const plain = t => String(t).replace(/\u2026/g, '...'); // '…' -> '...' (Helvetica / ZPL font 0)
  const needsImage = L => L.items.some(p => p.t === 'text' && /[^\x20-\x7e]/.test(plain(p.s)));
  function toSvg(L, size) {
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.W} ${L.H}" width="${size ? L.W : '100%'}" height="${size ? L.H : '100%'}" class="lblsvg" font-family="Arial,Helvetica,'Liberation Sans','DejaVu Sans','Noto Sans Hebrew','Segoe UI',Tahoma,sans-serif"><rect width="${L.W}" height="${L.H}" fill="#fff"/>`];
    for (const p of L.items) {
      if (p.t === 'box') parts.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#000"/>`);
      else if (p.t === 'frame') { const lw = p.lw || 2; parts.push(`<rect x="${p.x + lw / 2}" y="${p.y + lw / 2}" width="${p.w - lw}" height="${p.h - lw}" fill="none" stroke="#000" stroke-width="${lw}"/>`); } // labels-local9: outline box (Label Layouts)
      else if (p.t === 'bars') { let x = p.x; const r = []; p.mods.forEach((w, i) => { if (i % 2 === 0) r.push(`<rect x="${x}" y="${p.y}" width="${w * p.m}" height="${p.h}"/>`); x += w * p.m; }); parts.push(`<g fill="#000" shape-rendering="crispEdges" data-code="${xesc(p.text)}">${r.join('')}</g>`); }
      else if (p.t === 'text') {
        const rtl = isRtl(p.s), anchor = p.align === 'center' ? 'middle' : (p.align === 'right') !== rtl ? 'end' : 'start', by = p.y + Math.round(p.size * 0.82);
        parts.push(`<text x="${p.x}" y="${by}" font-size="${p.size}" font-weight="${p.bold ? 700 : 400}" text-anchor="${anchor}"${rtl ? ' direction="rtl"' : ''} fill="${p.white ? '#fff' : '#000'}"${p.role ? ` data-role="${p.role}"` : ''}>${xesc(p.s)}</text>`);
        if (p.strike) { const sx = strikeX(p); parts.push(`<line x1="${sx[0]}" x2="${sx[1]}" y1="${p.y + p.size * 0.5}" y2="${p.y + p.size * 0.5}" stroke="#000" stroke-width="${Math.max(1, p.size / 12)}"/>`); }
      }
    }
    parts.push('</svg>'); return parts.join('');
  }
  // ZPL for Zebra-style printers (^PW/^LL = label size in dots; text with font 0; Code 128 with ^BC; tag text reversed)
  const zesc = t => plain(t).replace(/[^\x20-\x7e]/g, '?').replace(/[\^~\\]/g, ' ');
  function toZpl(L, settings, copies) {
    const s = norm(settings), md = { light: 10, normal: 18, dark: 26 }[s.darkness], z = [`^XA^CI0^PW${L.W}^LL${L.H}^LH0,0~SD${md}`];
    for (const p of L.items) {
      if (p.t === 'box') z.push(`^FO${p.x},${p.y}^GB${p.w},${p.h},${p.h}^FS`);
      else if (p.t === 'frame') z.push(`^FO${p.x},${p.y}^GB${p.w},${p.h},${p.lw || 2}^FS`); // labels-local9
      else if (p.t === 'bars') z.push(`^FO${p.x},${p.y}^BY${p.m},2,${p.h}^BCN,${p.h},N,N,N${p.set === 'C' ? ',N' : ''}^FD${p.set === 'C' ? '>;' : '>:'}${zesc(p.text)}^FS`);
      else if (p.t === 'text') {
        const h = p.size, w = Math.round(h * (p.bold ? 0.9 : 0.8));
        if (p.align === 'left') z.push(`^FO${p.x},${p.y}^A0N,${h},${w}${p.white ? '^FR' : ''}^FD${zesc(p.s)}^FS`);
        else { const bw = p.align === 'center' ? L.W : p.x; z.push(`^FO0,${p.y}^A0N,${h},${w}^FB${bw},1,0,${p.align === 'center' ? 'C' : 'R'},0${p.white ? '^FR' : ''}^FD${zesc(p.s)}^FS`); }
        if (p.strike) { const sx = strikeX(p), t = Math.max(2, Math.round(h / 10)); z.push(`^FO${Math.round(sx[0])},${p.y + Math.round(h * 0.45)}^GB${Math.round(sx[1] - sx[0])},${t},${t}^FS`); }
      }
    }
    z.push(`^PQ${Math.round(num(copies, 1, 50, 1))}^XZ`); return z.join('\n') + '\n';
  }
  // img = { w, h, data: base64 1-bit rows, MSB first, 1 = black } drawn by the screen from the same layout (Hebrew etc.)
  const imgHex = img => { const b = typeof Buffer !== 'undefined' ? Buffer.from(img.data, 'base64') : Uint8Array.from(atob(img.data), c => c.charCodeAt(0)); let h = ''; for (const v of b) h += (v < 16 ? '0' : '') + v.toString(16).toUpperCase(); return h; };
  function toZplImage(L, settings, copies, img) {
    const s = norm(settings), md = { light: 10, normal: 18, dark: 26 }[s.darkness], bpr = Math.ceil(img.w / 8), tot = bpr * img.h;
    return [`^XA^CI0^PW${L.W}^LL${L.H}^LH0,0~SD${md}`, `^FO0,0^GFA,${tot},${tot},${bpr},${imgHex(img)}^FS`, `^PQ${Math.round(num(copies, 1, 50, 1))}^XZ`].join('\n') + '\n';
  }
  // one-page PDF the size of the label (Helvetica / Helvetica-Bold; bars and the tag box as filled rectangles)
  function pdfOps(L, img) {
    const k = 72 / L.dpi, ph = +(L.H * k).toFixed(2), pw = +(L.W * k).toFixed(2), f = n => (+n).toFixed(2);
    const pesc = t => plain(t).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1'), ops = ['0 g'];
    if (img) ops.push(`q ${f(pw)} 0 0 ${f(ph)} 0 0 cm /Im1 Do Q`); // the whole label as one picture (1-bit image mask)
    else for (const p of L.items) {
      if (p.t === 'box') ops.push(`${f(p.x * k)} ${f(ph - (p.y + p.h) * k)} ${f(p.w * k)} ${f(p.h * k)} re f`);
      else if (p.t === 'frame') { const lw = (p.lw || 2) * k; ops.push(`${f(lw)} w ${f(p.x * k + lw / 2)} ${f(ph - (p.y + p.h) * k + lw / 2)} ${f(p.w * k - lw)} ${f(p.h * k - lw)} re S`); } // labels-local9
      else if (p.t === 'bars') { let x = p.x; p.mods.forEach((w, i) => { if (i % 2 === 0) ops.push(`${f(x * k)} ${f(ph - (p.y + p.h) * k)} ${f(w * p.m * k)} ${f(p.h * k)} re f`); x += w * p.m; }); }
      else if (p.t === 'text') {
        const w = textW(p.s, p.size, p.bold), x = p.align === 'center' ? p.x - w / 2 : p.align === 'right' ? p.x - w : p.x, by = p.y + p.size * 0.82;
        ops.push(`${p.white ? '1 g ' : ''}BT /${p.bold ? 'F2' : 'F1'} ${f(p.size * k)} Tf ${f(x * k)} ${f(ph - by * k)} Td (${pesc(p.s)}) Tj ET${p.white ? ' 0 g' : ''}`);
        if (p.strike) { const sx = strikeX(p); ops.push(`${f(sx[0] * k)} ${f(ph - (p.y + p.size * 0.5) * k)} ${f((sx[1] - sx[0]) * k)} ${f(Math.max(0.5, p.size * k / 12))} re f`); }
      }
    }
    return { ops: ops.join('\n'), pw, ph };
  }
  function toPdf(L, copies, img) { const n = Math.round(num(copies, 1, 50, 1)), p = { L, img }; return toPdfPages(Array.from({ length: n }, () => p)); }
  // labels-local9: one PDF, one page per sticker; pages = [{ L, img }] (the same object twice = shared content stream)
  function toPdfPages(pages) {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
    const done = new Map(), kids = [];
    for (const pg of pages) {
      let d = done.get(pg);
      if (!d) {
        const o = pdfOps(pg.L, pg.img); objs.push(`<< /Length ${o.ops.length} >>\nstream\n${o.ops}\nendstream`); d = { c: objs.length, pw: o.pw, ph: o.ph };
        if (pg.img) { const hx = imgHex(pg.img) + '>'; objs.push(`<< /Type /XObject /Subtype /Image /Width ${pg.img.w} /Height ${pg.img.h} /ImageMask true /BitsPerComponent 1 /Decode [1 0] /Filter /ASCIIHexDecode /Length ${hx.length} >>\nstream\n${hx}\nendstream`); d.im = objs.length; }
        done.set(pg, d);
      }
      kids.push(objs.length + 1); objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${d.pw} ${d.ph}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${d.im ? ` /XObject << /Im1 ${d.im} 0 R >>` : ''} >> /Contents ${d.c} 0 R >>`);
    }
    objs[1] = `<< /Type /Pages /Kids [${kids.map(p => p + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    let pdf = '%PDF-1.4\n'; const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return pdf; // ASCII only
  }
  // Zebra-style names get ZPL when the method is Automatic; everything else goes through the Windows driver
  const isZpl = (name, method) => method === 'zpl' || (method === 'auto' && /zebra|\bzd\d|\bgk4|\bgx4|\bzp\d|\blp ?28|\btlp|\bzpl/i.test(String(name || '')));
  const SAMPLE = Object.freeze({ name: 'Spinning Musical Dreidel', number: '20417', upc: '0718122034567', price: 8.99, regular: 12.99 });
  const api = { code128, modules, moduleCount, DEF, SIZES, FONTS, NAMES, fitName, isRtl, needsImage, toZplImage, norm, prices, layout, toSvg, toZpl, toPdf, toPdfPages, isZpl, money, textW, fit, fitAll, barcodeText, SAMPLE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.AirLabel = api;
})(typeof window !== 'undefined' ? window : globalThis);

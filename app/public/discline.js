// AirMax #18 (Nov 2 2026, Ari): each discounted item gets its own line under it, e.g. "33% off -$9.90" (green on the sale screen).
// Display / print only: the text is made from the line's own discount (the % and the $ amount the sale line already carries).
// Nothing here changes a total, the tax or anything sent to AIR POS. The same function is used by the sale screen (app.js, in the
// browser) and by the receipt (app/disclines.js, in node), so the screen and the receipt always read the same.
(function (root) {
  'use strict';
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  // 33 -> "33", 12.5 -> "12.5", 16.666 -> "16.67" (at most 2 decimals, no trailing zeros)
  const pctText = p => { const v = r2(p); return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); };
  // l = a sale line: { discount: percent, discountAmount: dollars off the line }. No discount (or under 1 cent) = '' (no line).
  function discLineText(l, cur) {
    const amt = r2(l && l.discountAmount); if (!(amt >= 0.01)) return '';
    const pct = r2(l && l.discount), c = typeof cur === 'string' && cur ? cur : '$';
    return (pct > 0 ? pctText(pct) + '% off' : 'Discount') + ' -' + c + amt.toFixed(2);
  }
  const api = { discLineText, pctText };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.discLineText = discLineText;
})(typeof window !== 'undefined' ? window : this);

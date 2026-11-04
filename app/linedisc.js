'use strict';
// AirMax Step 0b C1 (Batch 11, Nov 3 2026): what discount each sale line got, for the Discount cell on the sale screen.
// DISPLAY ONLY. Reads what the register already holds (reg.sorted() lines, reg.promotionSubs = the last RetailOrderPromotionGet answer,
// reg.totals.promotionDiscount); it makes no AIR POS call and changes no total, tax or payment. Lives outside the frozen app/lib.
//
// Facts checked on TestShop (Nov 3): AIR POS answers ONE promotionSubs row per cart line (promotionType 0 "Others" when nothing applies), linked
// by retailOrderSubId = the line's own id, and there is NO per-row discount amount: only the sale-level totalPromotionDiscountAmount.
//
// PROVISIONAL (not yet seen with a real Sale / Multi-buy / promo code, TestShop has none and the back-office right is missing):
//   (1) which row counts as "promoted": promotionType > 0 or a real promotionId (not all zeros)       -> isPromoRow()
//   (2) the name shown: the row's discountName, else its promotionTypeName                              -> promoName()
//   (3) the line's amount (owner, Nov 3: with several promotions on one sale every promoted line shows its dollars too)         -> promoAmounts() / forSale()
//       a) a per-line signal when the row has one: originalPrice (or retailPrice) above price, times quantity = what that line was marked down;
//       b) the rest of the sale-level totalPromotionDiscountAmount is split over the lines WITHOUT a signal in proportion to each line's pre-promo
//          amount (price x quantity), cents fixed by largest remainder so the lines add up to the total exactly (one promoted line = the whole rest);
//       c) if the signals do not fit the total (they add up to more than it, or no line is left to take the rest) they are ignored for the split:
//          all lines share the total in proportion to the signals when every line has one, else to the pre-promo amounts.
//       Display only: the amounts are never sent anywhere and never feed a total.
// When the real rows are known only these three small functions change; the server line and the screen stay as they are.
const ZERO = '00000000-0000-0000-0000-000000000000';
const c2 = n => Math.round((Number(n) || 0) * 100) / 100;

// (1) provisional: is this AIR POS row a promotion row?
const isPromoRow = p => !!p && (Number(p.promotionType) > 0 || (!!p.promotionId && p.promotionId !== ZERO));
// (2) provisional: the name for the cell ('' when the row is not a promotion)
const promoName = p => (isPromoRow(p) ? String(p.discountName || p.promotionTypeName || '') : '');
// (3) provisional: dollars off for each promoted row. rows = [{ key, weight, signal }] (weight = pre-promo line amount, signal = per-line markdown in
// dollars or 0), total = totalPromotionDiscountAmount. Returns { key: amount }; the amounts sum to total exactly (to the cent), none is negative.
const cents = n => Math.round((Number(n) || 0) * 100);
function split(t, ws) { // t cents over weights ws by largest remainder; equal shares when every weight is 0
  const sw = ws.reduce((a, b) => a + b, 0), ex = ws.map(w => (sw > 0 ? t * w / sw : t / ws.length)), fl = ex.map(Math.floor); let left = t - fl.reduce((a, b) => a + b, 0);
  ex.map((e, i) => [e - fl[i], i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
  return fl;
}
function promoAmounts(rows, total) {
  const out = {}, t = cents(total); if (!(t > 0) || !rows.length) return out;
  const w = rows.map(r => Math.max(0, cents(r.weight))), sg = rows.map(r => Math.max(0, cents(r.signal))), has = sg.map(x => x > 0), sumSg = sg.reduce((a, b) => a + b, 0);
  const free = rows.map((_, i) => i).filter(i => !has[i]); let res;
  if (sumSg > 0 && sumSg <= t && (free.length || sumSg === t)) { // a) + b): signals as they are, the rest over the lines without one
    res = sg.slice(); if (free.length) split(t - sumSg, free.map(i => w[i])).forEach((c, k) => { res[free[k]] = c; });
  } else res = split(t, sumSg > 0 && !free.length ? sg : w); // c)
  rows.forEach((r, i) => { out[r.key] = res[i] / 100; });
  return out;
}

// subs = reg.sorted() (newest first, same order as the cart rows and /api/state lineIds); promotionSubs = reg.promotionSubs; total = reg.totals.promotionDiscount.
// Returns one entry per sub, same order: { name, promoName, promoType, promoAmount }. Never throws (bad data = empty entries).
function forSale(subs, promotionSubs, total) {
  const list = Array.isArray(subs) ? subs : [], rows = Array.isArray(promotionSubs) ? promotionSubs : [];
  const byLine = new Map(); for (const p of rows) if (p && p.retailOrderSubId && !byLine.has(p.retailOrderSubId)) byLine.set(p.retailOrderSubId, p);
  const ids = new Set(list.map(s => s && s.id));
  const promoted = list.filter(s => s && isPromoRow(byLine.get(s.id)));
  // an answer that names a promoted line which is no longer on the sale is out of date (the new total check is on its way): no amounts, names only
  const stale = rows.some(p => isPromoRow(p) && !ids.has(p.retailOrderSubId));
  const amt = stale ? {} : promoAmounts(promoted.map(s => {
    const p = byLine.get(s.id), q = Number(p.quantity) || 0, was = Math.max(Number(p.originalPrice) || 0, Number(p.retailPrice) || 0), now = Number(p.price) || 0;
    return { key: s.id, weight: now * q, signal: was > now ? (was - now) * q : 0 };
  }), total);
  return list.map(s => {
    if (!s) return { name: '', promoName: '', promoType: 0, promoAmount: 0 };
    const p = byLine.get(s.id), own = !s.isCustomDiscount && (Number(s.discountAmount) || 0) > 0 ? String(s.discountName || '') : '';
    return { name: own, promoName: promoName(p), promoType: isPromoRow(p) ? Number(p.promotionType) || 0 : 0, promoAmount: amt[s.id] || 0 };
  });
}
module.exports = { forSale, isPromoRow, promoName, promoAmounts };

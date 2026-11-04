// AirMax Step 0b (Batch 11, C1 / C2): fake AIR POS answers for Sale / Multi-buy / promo-code promotions, in the REAL promotionSubs shape.
// Real shape (checked on TestShop Nov 3 2026): RetailOrderPromotionGet answers ONE row per cart line, linked by retailOrderSubId = the line's own id,
// promotionType 0 "Others" when nothing applies, and NO per-row amount: only the sale-level totalPromotionDiscountAmount / totalDiscountAmount / totalAmount.
// PROVISIONAL (no real Sale / Multi-buy / code reply seen yet): which promotionType, promotionTypeName and discountName a promoted row carries (below: Sale = type 1
// "Discount", discountName "Sale"; Multi-buy = type 2 "DiscountMulti", discountName "Multi-buy 2 for $2"; promo code = type 1, discountName "Promo code SAVE10"),
// and that the code arrives in the call as promotionalCode (the register sends it that way). The per-line dollars the TEST needs live OUTSIDE the rows, in fake.dpAmt.
// Off by default: nothing changes for any other test until a hook turns a promotion on.
//   hook /dp-promo?sale=1&multi=1&code=SAVE10   (any of them; /dp-promo?off=1 = all off)    hook /dp-state = { on, amounts: { lineId: dollars } }
// Made-up data only (fake shop items: 1001 Bulk candy $10, 1003 Rope $2, 1004 Gift bag $1.50).
//   Sale        1001: 20% off the line
//   Multi-buy   1004: 2 for $2.00 (every 2 bags take $1.00 off)
//   Promo code  SAVE10: 10% off every line that has no Sale / Multi-buy
// With env DP_CUST=1 the fake also has ONE customer-type discount "Senior" 10% (RetailDiscountConfigGet), picked with the register route predefined-discount { id: 'dp-senior' }.
const crypto = require('crypto');
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  const ZERO = '00000000-0000-0000-0000-000000000000', IDS = { sale: 'b0000000-0000-4000-8000-000000000001', multi: 'b0000000-0000-4000-8000-000000000002', code: 'b0000000-0000-4000-8000-000000000003' };
  const c2 = n => Math.round(n * 100) / 100;
  fake.dp = fake.dp || { sale: false, multi: false, code: '' }; fake.dpAmt = fake.dpAmt || {};
  const prev = handlers['/Orders/RetailOrderPromotionGet'];
  handlers['/Orders/RetailOrderPromotionGet'] = p => {
    const r = prev(p), d = fake.dp; if (!r || !r.value || !(d.sale || d.multi || d.code)) return r;
    const s = J(p, 'submit'), codeOn = d.code && String(s.promotionalCode || '').trim().toUpperCase() === d.code.toUpperCase(); let promo = 0; const subs = []; fake.dpAmt = {};
    for (const x of s.subs || []) {
      const base = c2(x.price * x.quantity - (x.discountAmount || 0)); let kind = '', amt = 0;
      if (d.sale && x.productId === 'p1001') { kind = 'sale'; amt = c2(base * 0.2); }
      else if (d.multi && x.productId === 'p1004' && x.quantity >= 2) { kind = 'multi'; amt = Math.floor(x.quantity / 2) * 1; }
      else if (codeOn) { kind = 'code'; amt = c2(base * 0.1); }
      if (kind) { promo += amt; fake.dpAmt[x.id] = amt; }
      subs.push({ id: crypto.randomUUID(), retailOrderId: ZERO, retailOrderSubId: x.id, promotionId: kind ? IDS[kind] : ZERO, productId: x.productId, itemId: x.itemId, type: x.type || 0,
        promotionType: kind === 'multi' ? 2 : kind ? 1 : 0, promotionTypeName: kind === 'multi' ? 'DiscountMulti' : kind ? 'Discount' : 'Others', promotionDiscountType: kind === 'sale' || kind === 'code' ? 1 : 0,
        number: x.number, upc: x.upc || '', name: x.name, categoryName: '', imagePath: '', productType: 0, description: '',
        quantity: x.quantity, quantityTotal: x.quantityTotal != null ? x.quantityTotal : x.quantity * (x.rate || 1), quantityReturn: 0, originalPrice: x.originalPrice != null ? x.originalPrice : x.price, price: x.price, retailPrice: x.price, bulkPrice: 0, bulkPriceQuantity: 10,
        tax: 0, taxRate: x.taxRate || 0, taxFree: !!x.taxFree, discountTaxFree: false, costPrice: 0, unit: 1, unitName: x.unitName || 'PCS', rate: x.rate || 1, isGroupTitle: false, isBonus: false, ignoreOrderDiscount: !!x.ignoreOrderDiscount,
        discount: x.discount || 0, discountMethod: x.discountMethod || 0, discountName: kind === 'sale' ? 'Sale' : kind === 'multi' ? 'Multi-buy 2 for $2' : kind === 'code' ? 'Promo code ' + d.code : (x.discountName || ''), originalDiscount: x.discount || 0,
        isCustomDiscount: !!x.isCustomDiscount, isRetailRefund: true, sort: 0 });
    }
    promo = c2(promo); const v = r.value; if (!promo) return ok({ ...v, subs });
    const rate = v.totalAmount > 0 ? (v.totalAmount - promo) / v.totalAmount : 1;
    return ok({ ...v, subs, totalAmount: c2(v.totalAmount - promo), totalTax: c2(v.totalTax * rate), totalDiscountAmount: c2((v.totalDiscountAmount || 0) + promo), totalPromotionDiscountAmount: promo });
  };
  if (process.env.DP_CUST === '1') handlers['/Commons/RetailDiscountConfigGet'] = () => ok({ subs: [{ id: 'dp-senior', name: 'Senior', rate: 10, taxFree: false, customerType: 1, isPeriodicLimit: false, discountBasedOnProducts: false, productBasedSubs: [] }] });
  hooks['/dp-promo'] = (u, res) => { const q = u.searchParams; fake.dp = q.get('off') === '1' ? { sale: false, multi: false, code: '' } : { sale: q.get('sale') === '1', multi: q.get('multi') === '1', code: q.get('code') || '' }; res.end(JSON.stringify({ on: fake.dp })); };
  hooks['/dp-state'] = (u, res) => res.end(JSON.stringify({ on: fake.dp, amounts: fake.dpAmt }));
};

'use strict';
// Store request #26 (Gordon approved, Nov 3): a printout of the sale on screen that is clearly NOT a sale.
// "QUOTE / ESTIMATE - NOT A SALE - NOT PAID". It only READS what is on screen (reg.state(): cart + totals) and prints a short slip with
// reg.printSlip (the same path as the note slip / gift pick slip: no drawer kick). It never saves, holds, completes or pays anything in
// AIR POS, never touches the sale, never writes to disk and never logs item names, prices or customer data.
const money = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const clean = s => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();

// st = reg.state(). Returns { ok, lines } or { ok:false, message }.
function quoteLines(st, now = new Date()) {
  const cart = Array.isArray(st && st.cart) ? st.cart : [];
  if (!st || st.mode === 'return') return { ok: false, message: 'Quote not printed: a return is open. Finish or cancel it first.' };
  if (!cart.length) return { ok: false, message: 'Quote not printed: there are no items on the sale.' };
  const t = st.totals || {};
  if (t.updating || t.stale) return { ok: false, message: 'Quote not printed: the total is still updating. Try again in a moment.' };
  const w = 36, row = (l, r) => l.slice(0, Math.max(1, w - r.length - 1)).padEnd(w - r.length) + r;
  const p2 = n => String(n).padStart(2, '0');
  const when = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())} ${p2(now.getHours())}:${p2(now.getMinutes())}`;
  const out = ['QUOTE / ESTIMATE', 'NOT A SALE', 'NOT PAID', '------------------------------------', clean(st.user && st.user.shop), when];
  if (st.member && (st.member.name || st.member.number)) out.push('Customer: ' + clean(st.member.name || st.member.number));
  out.push('');
  for (const l of cart) {
    out.push(clean(l.name) || '(item)');
    const qty = Number(l.quantity) || 0;
    out.push(row(`  ${qty} x ${money(l.price)}${l.discountAmount ? '  (discount -' + money(l.discountAmount) + ')' : ''}`, money(l.total)));
  }
  out.push('------------------------------------');
  out.push(row('Items', money(t.itemAmount)));
  if (Number(t.discountAmount) > 0.004) out.push(row('Discount', '-' + money(t.discountAmount)));
  out.push(row('Tax (estimate)', money(t.tax)), row('TOTAL (estimate)', money(t.due)), '');
  out.push('NOT A SALE. NOT PAID.', 'No payment was taken. No receipt', 'was made. Prices, stock and tax may', 'change. Not valid as a receipt.');
  return { ok: true, lines: out };
}

class Quote {
  constructor({ reg, log }) { this.reg = reg; this.log = log || (() => {}); }
  async print() {
    const st = this.reg.state(), q = quoteLines(st);
    if (!q.ok) return { ok: false, message: q.message };
    if (typeof this.reg.printSlip !== 'function') return { ok: false, message: 'Quote not printed: not available in this version' };
    if (st.pay) return { ok: false, message: 'Quote not printed: a payment is open. Close it first.' };
    const label = 'Quote printed (NOT A SALE, not paid)';
    const r = await this.reg.printSlip(q.lines, label);
    this.log(`quote printed ok=${!!(r && r.ok)} lines=${q.lines.length}`); // counts only: never names, prices or customer
    return { ...(r || { ok: false }), message: r && r.ok ? label : 'Quote not printed: ' + ((r && r.message) || 'printer did not answer'), quote: true };
  }
}
module.exports = { Quote, quoteLines };

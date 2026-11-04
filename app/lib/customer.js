// Customer display (second monitor): what the customer sees of the current sale.
// Read-only: built from state(); served on GET /api/customer-state. Nothing here changes the sale.
'use strict';
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const DONE_SHOW_MS = 120000; // after a sale, the total and change stay up this long (or until the next item)

const Customer = {
  customerState() {
    const s = this.state();
    const out = { shop: (s.user && s.user.shop) || '', currency: typeof s.currency === 'string' && s.currency ? s.currency : '$', view: 'idle', lines: [], totals: null, pay: null };
    if (this.completed !== this._custDone) { this._custDone = this.completed; this._custDoneAt = Date.now(); }
    const st = this.settings || {}, lg = st.custLogo; // 1.2.1: store's own welcome message + logo (shown logged out too; no sale data)
    out.welcome = typeof st.custWelcome === 'string' ? st.custWelcome : ''; out.welcome2 = typeof st.custWelcome2 === 'string' ? st.custWelcome2 : '';
    out.logo = lg && lg.hash && /^[0-9a-f]+$/.test(lg.hash) ? '/customer-logo?v=' + lg.hash : null;
    if (!s.loggedIn) return out;
    if (s.mode === 'return' && s.ret) { // return with or without a receipt: the items going back and the refund
      out.lines = (s.ret.subs || []).map(x => ({ name: x.name, quantity: x.quantity, price: r2(x.price), total: -r2(x.price * x.quantity), ret: true }));
      if (out.lines.length) { out.view = 'return'; out.totals = { tax: r2(s.ret.totals.tax), refund: r2(s.ret.totals.refund) }; }
      return out;
    }
    const mix = (s.mix && s.mix.lines) || [];
    out.lines = s.cart.map(x => ({ name: x.name, quantity: x.quantity, price: r2(x.price), discount: r2(x.discountAmount), total: r2(x.total) }))
      .concat(mix.map(x => ({ name: x.name, quantity: -x.quantity, price: r2(x.price), total: r2(x.total), ret: true })));
    if (out.lines.length) {
      const t = s.totals, ret = mix.length ? r2(s.mix.totals.refund) : 0;
      out.view = s.pay ? 'pay' : 'sale';
      out.totals = { subtotal: r2(t.itemAmount), discount: r2((t.discountAmount || 0) + (t.pointDiscount || 0)), tax: r2(t.tax), taxOff: !!s.order.taxExempt, total: r2(t.due) };
      if (ret) { out.totals.returned = ret; out.totals.net = r2(s.mix.net); }
      if (s.pay) {
        const done = s.pay.tenders.filter(x => x.status === 'done');
        out.pay = { paid: r2(s.pay.paid), due: r2(s.pay.remaining), change: r2(done.reduce((a, x) => a + (x.giveAmount || 0), 0)) };
      }
      return out;
    }
    const c = s.completed;
    if (c && Date.now() - this._custDoneAt < DONE_SHOW_MS) { out.view = 'done'; out.pay = { total: r2(c.due), paid: r2(c.tendered), change: r2(c.change) }; }
    return out;
  },
};
module.exports = { Customer };

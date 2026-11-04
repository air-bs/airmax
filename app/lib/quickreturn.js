// Air Register 1.2.0: returns WITHOUT a receipt, the quick way (owner request).
// Ctrl+R / the Return button toggles "return scanning": every scan goes in as a NEGATIVE line (current price, red) and can
// be mixed with sale items. Enter -> payment screen. Nothing is asked; no option screens.
// AIR POS has no mixed sale+return order, so at payment Air Register records it the way AIR POS does it at the register:
//   * the returned items -> /ReturnOrders/NonOrderReturnOrderCreate (same endpoint and submit as NonOrderReturnDrawer.vue,
//     via confirmReturn(); refund tax per the "refund tax on returns without a receipt" setting = nonOrderPrice());
//   * exchange: the part of the refund that pays for the sale items is refunded in Cash on the return and taken in Cash
//     on the sale (drawer-neutral), the rest of the sale is paid normally; a refund bigger than the sale goes back by the
//     chosen tender (Cash default, or Credit Card).
'use strict';
const { newGuid } = require('./airpos');
const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const money = n => '$' + round(n).toFixed(2);
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
const Cash = 10, CreditCard = 20;

const QuickReturn = {
  mixList() { return this.mix || (this.mix = []); },
  mixOn() { return !!this.retOn; },
  toggleReturnScan(on) {
    if (this.mode !== 'sale') return fail('Finish the receipt return first');
    if (this.locked()) return fail('Payment has started; finish it first.');
    this.retOn = on == null ? !this.retOn : !!on;
    return { ok: true, message: this.retOn ? 'Return: scan the returned items' : 'Return off', on: this.retOn };
  },
  async mixScan(code) {
    code = String(code || '').trim(); if (!code) return fail('Nothing scanned');
    const g = this.guardCart(); if (g) return g;
    const r = await this.api.scan(code); if (!r || !r.success || !r.value) return fail((r && r.message) || 'Item not found');
    const s = r.value, list = this.mixList(), ex = list.find(x => x.itemId === s.itemId);
    if (ex) { ex.quantity += 1; ex.quantityTotal = ex.quantity * ex.rate; ex.timestamp = Date.now(); }
    else list.push({ id: newGuid(), productId: s.productId, itemId: s.itemId, number: s.number, upc: s.upc, name: s.name, rate: s.rate || 1, quantity: 1, quantityTotal: s.rate || 1, price: s.price, taxRate: s.taxRate ?? 0, taxFree: s.taxFree ?? true, timestamp: Date.now() });
    if (this.pay && !this.locked()) this.pay = null; // totals changed: payment starts over
    return { ok: true, message: `Return ${s.name}` };
  },
  mixRemove(i) { const g = this.guardCart(); if (g) return g; const list = this.mixList(); i = Number(i); if (!(i >= 0 && i < list.length)) return fail('No line'); const [x] = list.splice(i, 1); if (this.pay && !this.locked()) this.pay = null; return { ok: true, message: 'Removed ' + x.name }; },
  mixQty(i, d) { const g = this.guardCart(); if (g) return g; const x = this.mixList()[Number(i)]; if (!x) return fail('No line'); x.quantity = Math.max(1, x.quantity + d); x.quantityTotal = x.quantity * x.rate; return { ok: true }; },
  mixTotals() {
    const list = this.mixList();
    const amount = round(list.reduce((a, s) => a + s.price * s.quantity * s.rate, 0));
    const refund = round(list.reduce((a, s) => a + this.nonOrderPrice(s) * s.quantity * s.rate, 0));
    return { quantity: list.reduce((a, s) => a + s.quantity * s.rate, 0), amount, tax: round(refund - amount), refund, taxIncluded: this.settings.refundTaxNoReceipt !== false };
  },
  // mny109c: exchange credit owed to the sale = recorded on the return as cash out, not yet carried by a cash payment // mny109c+
  mixOwed() { const c = this.mixCredit || 0; return c > 0 && this.pay && this.pay.tenders.some(t => t.type === Cash && t.status === 'done') ? 0 : c; }, // mny109c+
  async mixTakeCredit() { // the credit alone, as the sale's one cash payment (used when nothing else is left to pay) // mny109c+
    const owed = this.mixOwed(); if (!(owed > 0)) return { ok: true, remaining: this.remaining() }; // mny109c+
    if (!this.pay) { const s = await this.startPay(); if (!s.ok || s.needManager) return s; this.pay.mixDone = true; } // mny109c+
    this._mixMerge = true; try { return await this.tender({ type: Cash, tendered: owed, _mix: true }); } finally { this._mixMerge = false; } // mny109c+
  }, // mny109c+
  mixPending() { return this.mixList().length > 0 && !(this.pay && this.pay.mixDone); },
  mixState() {
    const t = this.mixTotals(), list = this.mixList();
    return { on: !!this.retOn, lines: list.map(s => ({ number: s.number, name: s.name, quantity: s.quantity, price: round(this.nonOrderPrice(s), 2), total: -round(this.nonOrderPrice(s) * s.quantity * s.rate, 2) })), totals: t,
      net: round((this.subs.length ? this.totals.due : 0) - (this.mixPending() ? t.refund : 0)) };
  },
  // Record the returned items on AIR POS (NonOrderReturnOrderCreate) and, with sale items, take the exchange credit in cash.
  async mixSettle(refundType = Cash) {
    const list = this.mixList(); if (!list.length && this.mixOwed() > 0) { const t = await this.mixTakeCredit(); return t.ok ? t : { ...t, message: `The exchange credit ${money(this.mixOwed())} is still owed to this sale: ${t.message}` }; } // mny109c~
    if (!list.length) return fail('No returned items'); // mny109c+
    const Acct = 11; // AIR POS MemberAccount: Return to Account (NonOrderReturnDrawer paymentType 11 + the customer)
    if (Number(refundType) === Acct) { if (this.settings.returnToAccount === false) return fail('Return to Account is turned off in Settings (manager)'); if (!this.member) return fail('Add a customer to refund to their account'); }
    refundType = Number(refundType) === Acct ? Acct : Number(refundType) === CreditCard ? CreditCard : Cash;
    const R = this.mixTotals().refund, D = this.subs.length ? Math.max(round(this.totals.due - this.paidTotal()), 0) : 0;
    const credit = round(Math.min(R, D)), back = round(R - credit);
    const pays = []; if (refundType === Cash || !back) pays.push({ paymentType: Cash, name: 'Cash', amount: R });
    else { if (credit > 0) pays.push({ paymentType: Cash, name: 'Cash', amount: credit }); pays.push(refundType === Acct ? { paymentType: Acct, name: 'Customer account', amount: back } : { paymentType: CreditCard, name: 'Card', amount: back }); }
    if (!(this.ret.sent && this.ret.kind === 'nonorder')) { this.resetReturn(); this.ret.kind = 'nonorder'; this.ret.subs = list.map(x => ({ ...x })); this.ret.payments = pays; } // an unclear earlier refund keeps its id: checked first, never refunded twice // dbl109~
    const keepMode = this.mode;
    const r = await this.confirmReturn();
    this.mode = keepMode === 'return' ? 'sale' : keepMode;
    if (!r.ok) { if (!this.ret.sent) this.resetReturn(); return r; } // dbl109~
    this.mix = []; this.retOn = false;
    const info = { refund: R, credit, back, backType: back ? (refundType === CreditCard ? 'Card' : refundType === 11 ? 'Account' : 'Cash') : null, returnId: r.returnId, returnMessage: r.message };
    if (!this.subs.length) return { ...r, ok: true, completed: true, returnOnly: true, quickReturn: info, due: -R, change: back, tenders: pays.map(p => ({ name: p.name, amount: -p.amount })) };
    if (this.pay) this.pay.mixDone = true;
    if (credit > 0) {
      this.mixCredit = credit; this.mixInfo = info; // mny109c+ the credit is owed to the sale until a cash payment carries it // mny109c+
      if (!this.pay) { const s = await this.startPay(); if (!s.ok || s.needManager) return { ...s, quickReturn: info }; this.pay.mixDone = true; }
      if (this.remaining() > 0) return { ok: true, quickReturn: info, remaining: this.remaining(), message: `Return ${money(R)} applied. ${money(this.remaining())} left to pay.` }; // mny109c~
      const t = await this.mixTakeCredit(); // mny109c~
      if (!t.ok) return { ...t, quickReturn: info, message: `Return recorded (${money(R)}). The exchange credit ${money(credit)} is still owed to this sale (not lost): ${t.message} Press Pay again to apply it.` }; // mny109c+
      if (t.completed) return { ...t, quickReturn: info };
      return { ok: true, quickReturn: info, remaining: this.remaining(), message: `Return ${money(R)} applied. ${money(this.remaining())} left to pay.` };
    }
    return { ok: true, quickReturn: info };
  },
};

// Hooks into the sale: totals shown to the cashier are net of the pending return; the first tender settles the return first.
function install(Register) {
  const P = Register.prototype;
  const resetOrder = P.resetOrder, remaining = P.remaining, tender = P.tender, startPay = P.startPay, state = P.state;
  P.resetOrder = function () { resetOrder.call(this); this.mix = []; this.retOn = false; this.mixCredit = 0; this.mixInfo = null; }; // mny109c~
  P.remaining = function () { const r = remaining.call(this); return this.mixPending && this.mixPending() ? Math.max(round(r - this.mixTotals().refund), 0) : (!this._mixMerge && this.mixOwed() > 0 ? Math.max(round(r - this.mixOwed()), 0) : r); }; // mny109c~
  P.startPay = async function () {
    if (!this.subs.length && this.mixList().length) return { ok: true, refundOnly: true, message: 'Refund', remaining: 0 };
    return startPay.call(this);
  };
  P.tender = async function (b = {}) {
    if (!b._mix && this.mixPending()) { // settle the return + exchange credit first, then the cashier's tender for what is left
      const s = await this.mixSettle(Cash); if (!s.ok || s.completed) return s;
      if (!(this.remaining() > 0) && !(this.mixOwed() > 0)) return this.finishSale(); // mny109c~
    } // mny109c+
    const owed = b._mix ? 0 : this.mixOwed(); // mny109c+
    if (owed > 0) { // AIR POS keeps one cash payment per sale: the cash payment carries the exchange credit too // mny109c+
      if (Number(b.type) === Cash) { // mny109c+
        const tend = b.tendered == null || b.tendered === '' ? (b.amount == null || b.amount === '' ? this.remaining() : round(Number(b.amount))) : round(Number(b.tendered)); // mny109c+
        if (!Number.isFinite(tend) || !(tend > 0)) return fail('Enter the cash received'); // mny109c+
        this._mixMerge = true; try { return await tender.call(this, { ...b, amount: undefined, tendered: round(tend + owed) }); } finally { this._mixMerge = false; } // mny109c+
      } // mny109c+
      const net = this.remaining(), amt = b.amount == null || b.amount === '' ? net : round(Number(b.amount)); // mny109c+
      if (!(net > 0) || amt >= net - 0.004) { // this payment finishes the sale: apply the credit first (nothing else can carry it) // mny109c+
        const t = await this.mixTakeCredit(); // mny109c+
        if (!t.ok) return { ...t, message: `The exchange credit ${money(owed)} could not be applied yet, so nothing else was taken: ${t.message}` }; // mny109c+
        if (t.completed || !(this.remaining() > 0)) return t.completed ? t : this.finishSale(); // mny109c+
      } // mny109c+
    }
    return tender.call(this, b);
  };
  const finishSale = P.finishSale; P.finishSale = async function (...a) { // done screen: show the exchange credit, and the cash the customer really gave // mny109c+
    const c = this.mixCredit || 0; const r = await finishSale.apply(this, a); // mny109c+
    if (r && r.completed && c > 0 && Array.isArray(r.tenders)) { const t = r.tenders.find(x => x.name === 'Cash'); if (t) { t.amount = round(t.amount - c); if (t.receiveAmount) t.receiveAmount = round(t.receiveAmount - c); if (!(t.amount > 0) && !(t.receiveAmount > 0)) r.tenders.splice(r.tenders.indexOf(t), 1); } r.tenders.unshift({ name: 'Exchange credit', amount: c }); r.exchangeCredit = c; } // mny109c+
    return r; // mny109c+
  }; // mny109c+
  const hold = P.hold; P.hold = async function () { if (this.mixList().length) return fail('Take the returned items off first (or finish them at payment)'); return hold.call(this); };
  P.state = function () { const st = state.call(this); st.mix = this.mixState(); if (st.pay) st.pay.net = st.mix.net; // mny109c~
    const c = this.mixCredit || 0; if (st.pay && c > 0) { st.pay.net = round(this.totals.due - c); st.pay.exchangeCredit = c; // payment screen: Due / Paid net of the exchange credit // mny109c+
      const t = st.pay.tenders.find(x => x.type === Cash && x.status === 'done'); if (t) { t.amount = round(t.amount - c); if (t.receiveAmount) t.receiveAmount = round(t.receiveAmount - c); st.pay.paid = round(st.pay.paid - c); } } // mny109c+
    return st; }; // mny109c+
}
module.exports = { QuickReturn, install };

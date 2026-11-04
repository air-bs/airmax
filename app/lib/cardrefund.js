// Card refund check (receipt returns paid by card): AIR POS records the return, then its server refunds the card
// "original route". The register never moves card money itself; it only asks AIR POS whether that refund finished.
// Status lookup / retry are the ones AIR POS 1.9.11 uses (return-order-service.ts returnOrderGet / returnOrderRetry,
// ReturnOrderManage.vue:336 and 348-368; Retry is offered only while the return is Pending, line 149).
// Retry only re-asks AIR POS to finish the SAME return id: it never creates a new return.
// Waiting card refunds are kept in journal/card-refunds.json (same fsync'd writes as the sale journal) so a crash,
// a restart or the next sale never loses them. Holds only return id, order number, amount, status. No card data.
'use strict';
const { Journal } = require('./journal');

const ReturnStatus = { Canceled: -10, Pending: 0, Normal: 10 };     // enums.ts RetailReturnOrderStatus
const RefundStatus = { Canceled: -10, Pending: 10, Completed: 20 };  // enums.ts RetailReturnOrderRefundStatus
const CARD_TYPES = [20, 30];                                         // CreditCard (terminal), OnlinePayment (keyed)
const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const money = n => '$' + round(n).toFixed(2);
const val = r => (r && typeof r === 'object' && 'success' in r && 'value' in r ? r.value : r);
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOT_DONE = 'Card refund NOT finished — don\'t give cash.';

const CardRefund = {
  cardJ() { if (!this._cardJ) this._cardJ = new Journal(this.dataDir, this.log, 'card-refunds.json'); return this._cardJ; },
  company() { return String((this.identity || {}).corpName || '').toLowerCase(); },
  cardLoad() { // waiting card refunds of THIS company; other companies' entries are kept on disk untouched
    const j = this.cardJ().read(), items = (j && Array.isArray(j.items)) ? j.items : [], me = this.company();
    this.cardRefunds = items.filter(x => String(x.company || '').toLowerCase() === me);
    this.cardOther = items.filter(x => String(x.company || '').toLowerCase() !== me);
    this.cardLoaded = me;
  },
  cardList() { if (this.cardLoaded !== this.company()) this.cardLoad(); return this.cardRefunds; },
  cardSave() {
    const items = [...(this.cardOther || []), ...this.cardList()];
    if (items.length) this.cardJ().write({ kind: 'card-refunds', items }); else this.cardJ().clear('no card refund waiting');
  },
  cardRefundAdd({ retId, orderNumber, amount }) {
    const list = this.cardList();
    if (!list.some(x => x.retId === retId)) list.push({ retId, orderNumber: orderNumber || null, amount: round(amount), status: 'checking', company: (this.identity || {}).corpName || '', at: new Date().toISOString(), tries: 0 });
    this.cardSave();
  },
  // 'completed' | 'pending' | 'canceled' | 'unknown' (cannot reach AIR POS / reply without card lines)
  async cardRefundStatus(retId) {
    const g = await this.api.returnGet(retId);
    if (!g || g.unreachable || g.loggedOut || g.success === false) return { status: 'unknown', why: (g && g.message) || 'no reply' };
    const v = val(g);
    if (!v || !v.id) return { status: 'unknown', why: 'AIR POS has no such return' };
    const lines = (v.payments || []).filter(p => CARD_TYPES.includes(p.paymentType));
    const info = { returnStatus: v.status, number: v.number || null, lines: lines.map(p => ({ paymentType: p.paymentType, status: p.status, amount: p.amount })) };
    if (!lines.length) return { status: 'unknown', why: 'no card line on the return', ...info };
    if (lines.every(p => p.status === RefundStatus.Completed)) return { status: 'completed', ...info };
    if (v.status === ReturnStatus.Canceled || lines.some(p => p.status === RefundStatus.Canceled)) return { status: 'canceled', ...info };
    return { status: 'pending', ...info };
  },
  cardMessage(st, amount) {
    if (st === 'completed') return `Refunded ${money(amount)} to card.`;
    if (st === 'canceled') return `${NOT_DONE} AIR POS shows the card refund of ${money(amount)} as canceled. Check this return in AIR POS back office (Refund Management) before doing anything else.`;
    if (st === 'pending') return `${NOT_DONE} AIR POS shows the card refund of ${money(amount)} as still pending. Press Retry card refund.`;
    return `${NOT_DONE} Air Max could not confirm the card refund of ${money(amount)} with AIR POS. Press Retry card refund (it checks first; it never refunds twice).`; // ls9n~
  },
  // ask AIR POS (a few times: the card refund can take a moment) and update the saved entry
  async cardRefundCheck(retId, delays) {
    const it = this.cardList().find(x => x.retId === retId);
    let s = { status: 'unknown' };
    for (const d of delays || this.cardCheckDelays || [0, 800, 1500]) {
      if (d) await sleep(d);
      s = await this.cardRefundStatus(retId);
      if (s.status === 'completed' || s.status === 'canceled') break;
    }
    const amount = it ? it.amount : 0;
    this.log(`CARD REFUND ${retId.slice(0, 8)}: ${s.status}${s.returnStatus !== undefined ? ' (return ' + s.returnStatus + '; card ' + (s.lines || []).map(l => l.status).join('/') + ')' : ''}${s.why ? ' — ' + s.why : ''}`);
    if (it) {
      if (s.status === 'completed') this.cardRefunds = this.cardRefunds.filter(x => x !== it);
      else { it.status = s.status; it.checkedAt = new Date().toISOString(); }
      this.cardSave();
    }
    return { status: s.status, done: s.status === 'completed', amount, retId, orderNumber: it ? it.orderNumber : null, message: this.cardMessage(s.status, amount), airpos: s };
  },
  // "Retry card refund": check first; retry the SAME return only while AIR POS shows it Pending; never create a new return
  async retryCardRefund(retId) {
    const list = this.cardList(), it = retId ? list.find(x => x.retId === retId) : list[0];
    if (!it) return fail('No card refund is waiting.');
    if (this.cardRetryBusy) return fail('Still working on the last request…', { busy: true });
    this.cardRetryBusy = true;
    try {
      const pre = await this.cardRefundCheck(it.retId, [0]);
      if (pre.done) return { ok: true, card: pre, message: pre.message + ' (AIR POS had already finished it; nothing was sent again.)' };
      if (pre.status === 'unknown') return fail(pre.message, { retryable: true, card: pre });
      if (pre.airpos.returnStatus !== ReturnStatus.Pending) return fail(`${NOT_DONE} AIR POS does not show this return as pending, so it cannot be retried from here. Check it in AIR POS back office (Refund Management).`, { card: pre });
      it.tries = (it.tries || 0) + 1; it.lastTry = new Date().toISOString(); this.cardSave();
      const r = await this.api.returnRetry(it.retId);
      this.log(`CARD REFUND ${it.retId.slice(0, 8)} retry sent: ${r && r.success ? 'ok' : 'FAIL ' + String((r && r.message) || 'no reply').slice(0, 120)}`);
      const post = await this.cardRefundCheck(it.retId);
      if (post.done) return { ok: true, card: post, message: post.message };
      return fail(post.message + (r && r.success === false && r.message ? ` (AIR POS said: ${String(r.message).slice(0, 160)})` : ''), { retryable: post.status !== 'canceled', card: post });
    } finally { this.cardRetryBusy = false; }
  },
  // after login / restart: re-check every saved card refund of this company
  async recoverCardRefunds() {
    this.cardLoad();
    for (const it of [...this.cardRefunds]) { try { await this.cardRefundCheck(it.retId, [0]); } catch (e) { this.log('CARD REFUND check error: ' + e.message); } }
    const left = this.cardRefunds;
    if (!left.length) return null;
    const total = round(left.reduce((a, x) => a + x.amount, 0));
    return { ok: false, notice: `${NOT_DONE} ${left.length === 1 ? `A card refund of ${money(total)}${left[0].orderNumber ? ' for ' + left[0].orderNumber : ''} is` : `${left.length} card refunds (${money(total)}) are`} not finished in AIR POS. Press Retry card refund.` };
  },
  cardState() { return this.cardList().map(x => ({ retId: x.retId, orderNumber: x.orderNumber, amount: x.amount, status: x.status, message: this.cardMessage(x.status, x.amount) })); },
};
module.exports = { CardRefund, ReturnStatus, RefundStatus, CARD_TYPES };

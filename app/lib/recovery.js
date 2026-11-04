// Crash / network-loss recovery for the sale in progress (see journal.js).
// Rule: whenever a reply was lost, ask the AIR POS server what really happened before sending anything again.
'use strict';
const { newGuid } = require('./airpos');
const PaymentType = { Cash: 10, MemberAccount: 11, CreditCard: 20, Online: 30, GiftCard: 40, Check: 50 };
const PayName = { 10: 'Cash', 11: 'Store credit', 20: 'Card', 30: 'Keyed card', 40: 'Gift card', 50: 'Check', 99: 'Split' };
const OrderStatus = { Canceled: -10, Void: -5, Completed: 20 };
const ReceiveCompleted = 20;
const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const money = n => '$' + round(n).toFixed(2);
const val = r => (r && typeof r === 'object' && 'success' in r && 'value' in r ? r.value : r);
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });

const Recovery = {
  // what is on disk = what is on screen (called after every cart / payment change)
  journalSnap(stage) {
    if (!this.journal || this.recoveryPending || this.mode === 'return') return;
    if (!this.subs.length && !this.pay) { if (this.journal.exists()) { const j = this.journal.read(); if (!j || j.kind === 'sale') this.journal.clear('cart empty'); } return; }
    const id = this.identity || {}, p = this.pay;
    this.journal.write({ kind: 'sale', stage, company: id.corpName || '', shop: id.shopName || '', user: id.userName || '',
      order: this.order, subs: this.subs, memberNumber: this.member ? this.member.number : null, usingPoints: this.usingPoints || 0,
      pay: p ? { tenders: p.tenders, pendingSubmit: p.pendingSubmit || null, refusal: p.refusal || null, // airmax-fix-stock~
        card: p.card ? { kind: p.card.kind || 'terminal', type: p.card.type || (p.card.kind === 'keyed' ? PaymentType.Online : PaymentType.CreditCard), submit: p.card.submit, tenderId: p.card.tenderId, status: p.card.status } : null } : null });
  },
  // dbl109: an error / garbled reply (HTTP 5xx, not JSON), an expired session or no connection says NOTHING about what AIR POS recorded // dbl109+
  replyUnclear(g) { if (g && (g.unreachable || g.uncertain || g.loggedOut || g.success === false)) return true; const o = val(g); return o != null && !(typeof o === 'object' && o.id); }, // dbl109+
  // pb109e: real AIR POS answers RetailOrderGet for a Pending order that has payments with its own error (HTTP 500, errorCode 1000 // pb109e+
  // "Object reference not set..."; TestShop Oct 31 2026). Then each payment is asked on its own with RetailOrderReceiveCheck. // pb109e+
  getRefused(g) { return !!(g && g.success === false && !g.unreachable && !g.loggedOut && Number(g.errorCode) > 0); }, // pb109e+
  async receiveState(submit) { const rc = await this.api.receiveCheck(submit), v = rc && rc.value; if (rc && rc.success && v && typeof v === 'object') return v.isCompleted ? 'done' : 'begun'; return rc && rc.success === false && Number(rc.errorCode) === 1001 && !rc.loggedOut ? 'absent' : 'unknown'; }, // 1001 = "Combined payment infomation not found" // pb109e+
  async pendingFromReceives(j) { // the order as AIR POS has it, built from the journal's payments, each one confirmed by AIR POS; null = some could not be checked // pb109e+
    const p = j.pay || {}, list = [], add = (s, t) => { if (s && s.id && !list.some(x => x.id === s.id)) list.push({ s: { id: s.id, paymentType: s.paymentType != null ? s.paymentType : t.type, subPaymentType: null, retailOrderId: j.order.id, amount: s.amount, receiveAmount: s.receiveAmount, giveAmount: s.giveAmount }, t }); }; // pb109e+
    (p.tenders || []).forEach(t => add(t, t)); if (p.pendingSubmit && p.pendingSubmit.submit) add(p.pendingSubmit.submit, p.pendingSubmit); if (p.card && p.card.submit) add(p.card.submit, p.card); // pb109e+
    const receives = []; for (const x of list) { const st = await this.receiveState(x.s); if (st === 'unknown') return null; if (st !== 'absent') receives.push({ id: x.s.id, paymentType: x.s.paymentType, amount: x.s.amount, receiveAmount: x.s.receiveAmount, giveAmount: x.s.giveAmount, status: st === 'done' ? ReceiveCompleted : 10 }); } // pb109e+
    this.log(`RECOVERY: AIR POS does not show unfinished orders; checked ${list.length} payment(s) one by one, ${receives.length} on AIR POS`); // pb109e+
    return { success: true, value: { id: j.order.id, status: 15, receives } }; // pb109e+
  }, // pb109e+
  // 'done' | 'begun' (card still open) | 'absent' | 'unknown' (cannot reach the server)
  async checkReceive(submit) {
    const g = await this.api.orderGet(submit.retailOrderId || this.order.id);
    if (this.replyUnclear(g)) return this.getRefused(g) ? this.receiveState(submit) : 'unknown'; // pb109e~
    const o = val(g); if (!o || !o.id) return 'absent'; // the server answers null for an order it does not have
    const rc = (o.receives || []).find(r => r.id === submit.id);
    if (!rc) return 'absent';
    return rc.status === ReceiveCompleted ? 'done' : 'begun';
  },
  // a payment the server has although its reply was lost
  async adoptReceive(ps, st) {
    const pay = this.pay, s = ps.submit; pay.pendingSubmit = null;
    const t = { id: s.id, type: ps.type, name: PayName[ps.type], amount: ps.amount, receiveAmount: ps.receiveAmount, giveAmount: ps.giveAmount, checkNumber: ps.checkNumber, status: st === 'done' ? 'done' : 'waiting' };
    if (ps.replaces) pay.tenders = pay.tenders.filter(x => x.id !== ps.replaces); // merged cash receive
    if (!pay.tenders.some(x => x.id === t.id)) pay.tenders.push(t);
    this.log(`PAYMENT reply was lost; server shows receive ${st} (${PayName[ps.type]}) — adopted, not sent again`);
    if (st === 'begun' && ps.type === PaymentType.Online && this.keyedInfo().kind !== 'sola') { // Stripe keyed card: nothing is charged until the Stripe form is confirmed, so start it fresh (Sola: card already sent, keep checking) // sola109~
      pay.tenders = pay.tenders.filter(x => x !== t); await this.api.receiveCancel(s);
      return fail('The connection dropped while opening the keyed card form. Nothing was charged. Press Retry.', { retryable: true });
    }
    if (st === 'begun' && (ps.type === PaymentType.CreditCard || ps.type === PaymentType.Online)) {
      pay.card = { kind: ps.type === PaymentType.Online ? 'keyed' : undefined, type: ps.type, submit: s, tenderId: t.id, status: 'waiting', message: 'Checking the card payment with AIR POS…', subMessage: '', startedAt: Date.now(), polls: 0 };
      this.journalSnap('adopt'); this.pollCard(); return { ok: true, waiting: true, message: 'Connection is back: checking the card payment (it is not charged twice).' };
    }
    if (st === 'begun') { t.status = 'failed'; pay.tenders = pay.tenders.filter(x => x !== t); return fail('AIR POS has the payment but has not confirmed it. Check the order in AIR POS back office before taking it again.'); }
    this.journalSnap('adopt');
    const r = await this.afterTender(t);
    if (r && r.ok) r.message = (r.message || '') + ' (connection dropped, but AIR POS had already recorded this payment; it was not taken twice)';
    return r;
  },

  async recover() {
    const cmN = this.recoverCashMove ? await this.recoverCashMove().catch(e => { this.log('CASH recovery error: ' + e.message); return null; }) : null; // interrupted pay-in / pay-out (register.js) // ls9d+
    if (cmN) { this.notice = { at: Date.now(), message: cmN, ok: false, orderId: null }; this.log('RECOVERY: ' + cmN); } // ls9d+
    const j = this.journal && this.journal.read();
    if (!j) { this.recoveryPending = false; return this.recoverCards(null); }
    const id = this.identity || {};
    if (j.company && id.corpName && String(j.company).toLowerCase() !== String(id.corpName).toLowerCase()) { this.recoveryPending = false; this.log('JOURNAL belongs to another company; left alone'); return null; }
    try {
      let r = j.kind === 'return' ? await this.recoverReturn(j) : j.kind === 'sale' ? await this.recoverSale(j) : (this.journal.clear('unknown kind'), null);
      if (this.recoverCardRefunds) r = await this.recoverCards(r, true);
      if (r && r.notice) { this.notice = { at: Date.now(), message: r.notice, ok: r.ok !== false, orderId: j.kind === 'sale' && j.order && this.order.id === j.order.id ? j.order.id : null }; this.log('RECOVERY: ' + r.notice); } // orderId: shown only while that restored sale is on screen (display only)
      return r;
    } catch (e) { this.log('RECOVERY error: ' + e.message); return fail('Recovery check failed: ' + e.message); }
    finally { if (!(this.recoveryRetry)) this.recoveryPending = false; this.recoveryRetry = false; }
  },
  // waiting card refunds (cardrefund.js, own journal file): re-checked with AIR POS on every login / recovery
  async recoverCards(r, merge) {
    let c = null; try { c = this.recoverCardRefunds ? await this.recoverCardRefunds() : null; } catch (e) { this.log('CARD REFUND recovery error: ' + e.message); }
    if (!c) return r;
    if (merge) return r && r.notice ? { ...r, ok: false, notice: r.notice + ' ' + c.notice } : c;
    this.notice = { at: Date.now(), message: c.notice, ok: false, orderId: null }; this.log('RECOVERY: ' + c.notice);
    return c;
  },
  async recoverReturn(j) {
    const st = await this.returnRecorded(j.retId);
    if (st === 'unknown') { this.recoveryRetry = true; return { ok: false, notice: `A refund (${money(j.refund)}) was being sent when Air Max closed. AIR POS cannot be reached to check it. Do not refund again yet; Air Max checks again automatically.` }; } // ls9n~
    if (st === 'yes' && j.card > 0 && this.cardRefundAdd) this.cardRefundAdd({ retId: j.retId, orderNumber: j.orderNumber, amount: j.card }); // saved before the return note is cleared
    this.journal.clear('return ' + st);
    if (st === 'yes' && j.card > 0) { this.lastReturnId = j.retId; const cash = Math.round((j.refund - j.card) * 100) / 100; return { ok: true, notice: `The refund of ${money(j.refund)}${j.orderNumber ? ' for ' + j.orderNumber : ''} was recorded by AIR POS before Air Max closed. ${cash > 0 ? `Give the ${money(cash)} cash part if not done yet. ` : ''}The card part (${money(j.card)}) is checked with AIR POS now; don't give cash for it.` }; } // ls9n~
    if (st === 'yes') { this.lastReturnId = j.retId; return { ok: true, notice: `The refund of ${money(j.refund)}${j.orderNumber ? ' for ' + j.orderNumber : ''} was recorded by AIR POS before Air Max closed. Give the refund if not done yet; reprint the return receipt from History.` }; } // ls9n~
    return { ok: true, notice: `A refund of ${money(j.refund)} was being sent when Air Max closed, and AIR POS has no record of it: nothing was refunded. Do the return again.` }; // ls9n~
  },
  async recoverSale(j) {
    if (!j.order || !j.order.id) { this.journal.clear('no order'); return null; }
    let g = await this.api.orderGet(j.order.id); // pb109e~
    if (this.replyUnclear(g) && this.getRefused(g)) g = (await this.pendingFromReceives(j)) || g; // pb109e+
    if (this.replyUnclear(g)) { this.recoveryRetry = true; return { ok: false, notice: 'An unfinished sale was found, but AIR POS ' + (g && g.unreachable ? 'cannot be reached' : 'did not give a clear answer') + ' to check it. Do not ring it up again yet; Air Max checks again automatically.' }; } // dbl109~ // ls9n~
    const o = val(g), onServer = !!(o && o.id && g.success !== false);
    if (onServer && o.status === OrderStatus.Completed) {
      this.journal.clear('already completed'); this.lastOrderId = o.id; if (j.order.note) this.saveNoteFor(o.id, j.order.note);
      if (this.saveGiftsFor && Array.isArray(j.subs)) { const keep = this.subs; this.subs = j.subs; try { this.saveGiftsFor(o.id, this.giftSummary()); } catch {} this.subs = keep; }
      return { ok: true, notice: `Sale ${o.number || ''} was already completed before Air Max closed (${money(o.amount + (o.tax || 0))}). Nothing more to do; reprint it from History if needed.` }; // ls9n~
    }
    if (onServer && (o.status === OrderStatus.Void || o.status === OrderStatus.Canceled)) { this.journal.clear('voided'); return { ok: true, notice: `The unfinished sale ${o.number || ''} was cancelled in AIR POS; nothing to recover.` }; }
    // ls10h: Air Max closed while Hold was being saved and AIR POS HAD saved it (Pending, same items, nothing paid): it is held (Load Hold). Say so and do not put // ls10h+
    // it back on screen; remember it so ringing / holding the same items again is reported done once, not parked twice (like the pay-in / pay-out redo check). // ls10h+
    if (j.stage === 'holding' && onServer && o.status === 15 && !j.pay && !(o.receives || []).some(r => r.status === ReceiveCompleted) && Array.isArray(o.subs) && this.holdSig(o.subs) === this.holdSig(j.subs)) { // ls10h+
      this.journal.clear('already held'); if (j.order.note) this.saveNoteFor(o.id, j.order.note); this.holdDone = { sig: this.holdSig(j.subs), at: Date.now() }; const nH = Array.isArray(j.subs) ? j.subs.length : 0; // ls10h+
      return { ok: true, notice: `The sale that was being held when Air Max closed (${nH} line${nH === 1 ? '' : 's'}${o.number ? ', ' + o.number : ''}) WAS already held on AIR POS. Open it with Load Hold; do not ring it up or hold it again. Nothing was paid.` }; // ls10h+
    } // ls10h+
    // pb109b: never put the old sale over a different sale that is being rung now (its lines / payments would be lost); it comes back once the screen is free // pb109b+
    if (this.order.id !== j.order.id && (this.subs.length || this.pay)) { // pb109b+
      this.recoveryRetry = true; if (this.recoveryDeferred === j.order.id) return { ok: false }; this.recoveryDeferred = j.order.id; // pb109b+
      const paidA = onServer ? round((o.receives || []).filter(r => r.status === ReceiveCompleted).reduce((a, r) => a + (Number(r.amount) || 0), 0)) : 0, nA = Array.isArray(j.subs) ? j.subs.length : 0; // pb109b+
      return { ok: false, notice: `An unfinished sale from before (${nA} line${nA === 1 ? '' : 's'}${paidA > 0 ? `, ${money(paidA)} already paid on it in AIR POS` : ''}) was not put back, so the sale on screen is kept. Hold or clear the sale on screen: the earlier sale then comes back. Do not ring the earlier sale up again.` }; // pb109b+
    } // pb109b+
    this.recoveryDeferred = null; // pb109b+
    // rcv1011 (Gordon OK 6:41 PM ET Nov 3): the order read lists no receive for a payment the journal says was being sent. AIR POS can be one read behind (or the read hides it): // rcv1011+
    // ask AIR POS about that one payment (RetailOrderReceiveCheck, read-only) before saying nothing was paid. Never a new ReceiveBegin from here. // rcv1011+
    let vTender = null; // rcv1011+
    { const jv = j.pay && j.pay.pendingSubmit, sb = jv && jv.submit, jcd = j.pay && j.pay.card && j.pay.card.submit; // rcv1011+
      if (onServer && sb && sb.id && !(o.receives || []).some(r => r.id === sb.id) && !(jcd && jcd.id === sb.id)) { // rcv1011+
        const vs = await this.receiveState(sb), isCard = jv.type === PaymentType.CreditCard || jv.type === PaymentType.Online; // rcv1011+
        this.log(`RECOVERY: order read does not list journaled payment ${sb.id} (${PayName[jv.type] || jv.type}); ReceiveCheck says ${vs}`); // rcv1011+
        if (vs === 'unknown' || (vs === 'begun' && !(isCard && !jcd))) { this.recoveryRetry = true; return { ok: false, notice: vs === 'unknown' ? 'An unfinished sale was found with a payment that was being sent when Air Max closed, and AIR POS did not give a clear answer about that payment. It is NOT known whether it was paid: check the order in AIR POS back office. Do not take payment again yet; Air Max checks again automatically.' : 'An unfinished sale was found with a payment that AIR POS has but has not confirmed. Check the order in AIR POS back office. Do not take payment again yet; Air Max checks again automatically.' }; } // rcv1011+
        if (vs === 'done') { vTender = { id: sb.id, type: jv.type, name: PayName[jv.type] || 'Paid', amount: jv.amount, receiveAmount: jv.receiveAmount, giveAmount: jv.giveAmount, status: 'done' }; this.log(`PAYMENT reply was lost; server shows receive done (${PayName[jv.type] || jv.type}) — adopted, not sent again (recovery ReceiveCheck)`); } // rcv1011+
        else if (vs === 'begun') j.pay.card = { type: jv.type, submit: sb, status: jv.type === PaymentType.CreditCard || this.keyedInfo().kind === 'sola' ? 'waiting' : 'keyed' }; // the card is open on AIR POS: the card check below keeps checking / cancels it, as pb109c does // rcv1011+
      } } // rcv1011+
    // put the cart back exactly as it was
    this.resetOrder(); Object.assign(this.order, j.order); this.subs = Array.isArray(j.subs) ? j.subs : [];
    if (j.memberNumber) { try { await this.attachMember(j.memberNumber); } catch {} }
    this.usingPoints = j.usingPoints || 0;
    const totalOk = (await this.recalc()) !== false;
    const n = this.subs.length;
    if (!onServer) { this.recoveryPending = false; this.journalSnap('recovered'); return { ok: true, notice: `Recovered the unfinished sale (${n} line${n === 1 ? '' : 's'}). Nothing was paid yet; continue or press New sale.` }; }
    const done = (o.receives || []).filter(r => r.status === ReceiveCompleted);
    const tenders = done.map(r => ({ id: r.id, type: r.paymentType, name: PayName[r.paymentType] || 'Paid', amount: r.amount, receiveAmount: r.receiveAmount, giveAmount: r.giveAmount, status: 'done' }));
    if (vTender) tenders.push(vTender); // rcv1011+
    // pb109c: a terminal / keyed card payment the app was still starting (closed during ReceiveBegin) is open on AIR POS too: check it like the journal's card // pb109c+
    const jps = j.pay && j.pay.pendingSubmit, jpOpen = jps && jps.submit && (jps.type === PaymentType.CreditCard || jps.type === PaymentType.Online) && (o.receives || []).some(r => r.id === jps.submit.id && r.status !== ReceiveCompleted && !(r.status < 0)); // pb109c+
    const jc0 = j.pay && j.pay.card, jc = jc0 && jc0.submit && (jc0.status === 'waiting' || jc0.status === 'keyed') ? jc0 : jpOpen ? { type: jps.type, submit: jps.submit, status: jps.type === PaymentType.CreditCard || this.keyedInfo().kind === 'sola' ? 'waiting' : 'keyed' } : jc0; let cardNote = '', resumeCard = null; // sola109~
    if (jc && jc.submit && (jc.status === 'waiting' || jc.status === 'keyed') && !done.some(r => r.id === jc.submit.id)) {
      const rc = await this.api.receiveCheck(jc.submit); const v = (rc && rc.value) || {};
      if (rc && rc.success && v.isCompleted) tenders.push({ id: jc.submit.id, type: jc.type, name: PayName[jc.type], amount: jc.submit.amount, status: 'done' });
      else if (!v.shouldReissue && jc.status === 'waiting' && (jc.type === PaymentType.CreditCard || (jc.type === PaymentType.Online && this.keyedInfo().kind === 'sola'))) resumeCard = jc; // no clear answer: keep checking the same terminal / Sola payment, never cancel it and ask to take it again // sola109~
      else { await this.api.receiveCancel(jc.submit); cardNote = ` The ${PayName[jc.type] || 'card'} payment of ${money(jc.submit.amount)} that was open did not go through and was cancelled; take it again.`; }
    }
    this.pay = tenders.length || resumeCard ? { auth: await this.authCheck(), tenders, card: null, result: null, stockWarning: '' } : null;
    if (this.pay && j.pay && j.pay.refusal) { this.pay.refusal = j.pay.refusal; this.pay.lastError = this.refusalNote() + 'Your payments are safe. Press Finish sale to try again: it only retries the finish, nothing is charged again.'; } // the reason AIR POS gave before the restart // airmax-fix-stock+
    if (resumeCard) {
      this.pay.tenders.push({ id: resumeCard.submit.id, type: resumeCard.type, name: PayName[resumeCard.type], amount: resumeCard.submit.amount, status: 'waiting' });
      this.pay.card = { kind: resumeCard.type === PaymentType.Online ? 'keyed' : undefined, type: resumeCard.type, submit: resumeCard.submit, tenderId: resumeCard.submit.id, status: 'waiting', message: resumeCard.type === PaymentType.Online ? 'Reconnected: checking the card payment with AIR POS…' : 'Reconnected: still waiting for the card terminal…', subMessage: '', startedAt: Date.now(), polls: 0 }; // sola109~
      this.recoveryPending = false; this.journalSnap('recovered'); this.pollCard();
      return { ok: true, notice: `Recovered the unfinished sale. The card payment of ${money(resumeCard.submit.amount)} is still open ${resumeCard.type === PaymentType.Online ? 'with AIR POS' : 'on the terminal'}: Air Max keeps checking it (it is not charged twice).` }; // sola109~
    }
    this.recoveryPending = false; this.journalSnap('recovered');
    if (this.pay && !totalOk) return { ok: false, notice: `Recovered the unfinished sale: ${money(this.paidTotal())} already paid (kept, not taken again). AIR POS could not check the total yet, so the sale was not finished. Press Finish sale once the connection is back; do not take more money until it shows what is owed.` };
    if (this.pay && this.remaining() <= 0) {
      const f = await this.finishSale();
      return f.ok ? { ok: true, notice: `Recovered a sale that was fully paid (${money(f.due)}) and finished it now.${f.change > 0 ? ' Change ' + money(f.change) + '.' : ''}` }
        : { ok: false, notice: 'Recovered a fully paid sale, but AIR POS did not finish it yet: ' + f.message };
    }
    // ls10d: the sale being held IS on AIR POS as a held order (same order id, Pending, nothing paid) but AIR POS's copy differs (edited there, or an older // ls10d+
    // copy of a loaded hold): the cart is back exactly as Air Max had it (nothing lost). Say it WAS held; Hold updates that same order; the same items rung again are caught once. // ls10d+
    if (j.stage === 'holding' && onServer && o.status === 15 && !this.pay) { this.holdDone = { sig: this.holdSig(j.subs), at: Date.now(), id: o.id }; return { ok: true, notice: `The sale that was being held when Air Max closed (${n} line${n === 1 ? '' : 's'}${o.number ? ', ' + o.number : ''}) WAS already held on AIR POS, but AIR POS's copy is different now. It is back on screen as Air Max had it: press Hold to update that held sale with these lines (it is not held twice), or press New sale and open AIR POS's copy with Load Hold. Do not ring it up again. Nothing was paid.` }; } // ls10d+
    return { ok: true, notice: `Recovered the unfinished sale (${n} line${n === 1 ? '' : 's'})${this.pay ? `: ${money(this.paidTotal())} already paid, ${money(this.remaining())} left` : '; nothing was paid yet'}.${cardNote}` };
  },
  holdSig(subs) { return (Array.isArray(subs) ? subs : []).map(x => String(x.productId || x.itemId || x.name || '') + '|' + Number(x.quantity)).sort().join(','); }, // items + quantities, to match a held order // ls10h+
  // retried from the UI/state poll while a check could not reach the server
  async retryRecovery() { if (!this.recoveryPending || !this.api.loggedIn) return { ok: true }; return (await this.recover()) || { ok: true }; },
};
module.exports = { Recovery, newGuid };

// AirMax API Batch 8 - Gift cards: reads 57 60 66 71 72, writes 62 64 65 67 68 69 70, and the manager-only "Add credit, no payment".
// Also exports the shared money-safety helpers (makeLib) that storecredit.js and cashfixes.js use.
//
// What TestShop taught us (2026-11-03, test cards only):
//   - Complete (67) is NOT safe to repeat: a second Complete on the same order added the money a second time.
//     So Complete is sent at most once per order; if the reply is unclear we read the order and the card, never resend blind.
//   - ReceiveCheck (66) says "completed" for a CASH order that was never begun, so it is only trusted after we began a receive.
//   - Complete does not check that money was taken (cash). So who may start, pay and finish is decided HERE, not by AIR POS.
//   - Delete (70) works but a Get right after still shows the order; the list (72) is the truth. Cancel (69) answers HTTP 404 on TestShop.
//   - Update (62) zeroed the card's face value on TestShop (and ignored the value sent), so it stays OFF unless allowCardEdit is set.
//   - A top-up Save needs amount >= 1. Saving the same order id twice makes one order.
// Cards: the secret `password` field never leaves this file; card numbers are shown as ****1234; nothing here logs a number, a password or a name.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const RO = '/RetailGiftCardRechargeOrders/RetailGiftCardRechargeOrder', GC = '/RetailGiftCards/RetailGiftCard';
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const OPEN_DONE = new Set(['done', 'cancelled']);

// ---------- shared money-safety layer ----------
function makeLib(ctx, name) {
  const reg = ctx.reg, api = reg.api, dir = ctx.dataDir;
  const pfile = path.join(dir, name + '-pending.json'), lfile = path.join(dir, name + '-log.jsonl');
  const newId = () => crypto.randomUUID();
  const clean = o => (o == null ? o : JSON.parse(JSON.stringify(o, (k, v) => (k === 'password' || k === 'ide' || k === 'token' || k === 'cvv' ? undefined : v))));
  const mask = n => { const s = String(n || ''); return s ? '****' + s.slice(-4) : ''; };
  const msg = r => String((r && r.message) || '').slice(0, 200);
  // klass: what kind of answer is this?  none | unreachable | loggedOut | uncertain | refused | ok
  const klass = r => (r === null || r === undefined ? 'none' : r.unreachable ? 'unreachable' : r.loggedOut ? 'loggedOut' : r.uncertain ? 'uncertain' : r.success === false ? 'refused' : 'ok');
  const unclear = k => k === 'unreachable' || k === 'uncertain';
  const parseAmount = (v, lo, hi) => {
    const s = String(v == null ? '' : v).trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return { ok: false, message: 'Type an amount like 10 or 10.50' };
    const n = r2(s);
    if (n < lo) return { ok: false, message: 'The smallest amount is $' + lo.toFixed(2) };
    if (n > hi) return { ok: false, message: 'The largest amount is $' + hi.toFixed(2) };
    return { ok: true, n };
  };
  // pending file: one record per top-up in flight. Atomic write; holds ids, amounts, last 4 digits - never a card number.
  let mem = null;
  const load = () => { if (mem) return mem; try { mem = JSON.parse(fs.readFileSync(pfile, 'utf8')); if (!Array.isArray(mem)) mem = []; } catch (e) { mem = []; } return mem; };
  const flush = () => { const t = pfile + '.tmp'; fs.writeFileSync(t, JSON.stringify(mem)); fs.renameSync(t, pfile); };
  const pend = {
    all: () => load().slice(),
    open: () => load().filter(p => !OPEN_DONE.has(p.step)),
    get: id => load().find(p => p.id === id) || null,
    add: p => { load().push(p); flush(); return p; },
    set: (id, patch) => { const p = load().find(x => x.id === id); if (p) { Object.assign(p, patch, { at2: new Date().toISOString() }); flush(); } return p; },
    drop: id => { mem = load().filter(p => p.id !== id); flush(); },
    prune: () => { const keep = load().filter(p => !OPEN_DONE.has(p.step) || Date.now() - Date.parse(p.at2 || p.at) < 7 * 864e5); if (keep.length !== load().length) { mem = keep; flush(); } },
  };
  const audit = (file, entry) => { try { fs.appendFileSync(path.join(dir, file), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n'); } catch (e) { ctx.log('GIFT audit write failed: ' + (e && e.message)); } };
  const readLines = file => { try { return fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; } };
  // manager gate (the owner's rule): the caller is a manager, or the body carries a manager's name + password that AIR POS verifies. The password is never kept.
  const needMgr = async (b, what) => {
    if (ctx.isManager() && !(b && b.password)) return { ok: true, by: String((reg.identity && reg.identity.userName) || 'manager').slice(0, 40), typed: false };
    if (!b || (!b.user && !b.password)) return { ok: false, needManager: true, message: what + ' needs a manager. A manager types their password to approve it.' };
    const m = await reg.managerCheck({ user: b.user, password: b.password });
    if (!m || !m.ok) return { ok: false, needManager: true, message: (m && m.message) || 'Manager login did not work' };
    return { ok: true, by: String(b.user || '').trim().slice(0, 40), typed: true };
  };
  // one money write at a time on this register (the second gets "busy")
  let busy = false;
  const exclusive = async fn => { if (busy) return { ok: false, busy: true, message: 'Another gift card step is still running. Wait a moment.' }; busy = true; try { return await fn(); } catch (e) { ctx.log('GIFT step failed: ' + String(e && e.message || e).slice(0, 160)); return { ok: false, message: 'Something went wrong. Check the card and the top-up list before trying again.' }; } finally { busy = false; } };
  return { reg, api, newId, clean, mask, msg, klass, unclear, parseAmount, pend, audit, readLines, needMgr, exclusive, r2, dir };
}

// ---------- gift cards ----------
const plugin = ctx => {
  const L = makeLib(ctx, 'gift'), { api, reg } = L;
  const SET = path.join(ctx.dataDir, 'gift-settings.json');
  // the owner 2026-11-03: free credit has NO per-credit limit; expired cards are blocked. "Expired" is ONLY AIR POS's own
  // `expired` flag on the card (AIR POS sets it from the expireDate it stores, which exists only when the store's expiry
  // setting is on). AirMax never invents, computes or defaults an expiry date and has no expiry setting of its own.
  const settings = () => { let s = {}; try { s = JSON.parse(fs.readFileSync(SET, 'utf8')); } catch (e) { /* defaults */ } return { allowCardEdit: s.allowCardEdit === true, allowCardPay: s.allowCardPay === true }; };
  const fail = (message, extra) => ({ ok: false, message, ...(extra || {}) });

  const card = c => c && { id: c.id, cardMask: L.mask(c.cardNo), faceValue: c.faceValue, consumedAmount: c.consumedAmount, balance: c.balance, issueDate: c.issueDate, expireDate: c.expireDate, expired: !!c.expired, isSold: !!c.isSold, member: c.retailMemberName || '' };
  const order = o => o && { id: o.id, number: o.number, cardId: o.retailGiftCardId, cardMask: L.mask(o.cardNo), amount: o.amount, status: o.status, statusName: o.statusName, paymentType: o.paymentType, paymentTypeName: o.paymentTypeName, createTime: o.createTime, completedTime: o.completedTime };
  const sum = p => p && { id: p.id, kind: p.kind, step: p.step, amount: p.amount, cardMask: p.last4 ? '****' + p.last4 : '', method: p.method, number: p.number || '', at: p.at };
  const freeIds = () => new Set(L.readLines('gift-credit-log.jsonl').filter(e => e.result === 'done').map(e => e.orderId));

  const readCard = async by => {
    const r = by.id ? await api.retail(GC + 'GetById', { id: by.id }) : await api.retail(GC + 'Get', { number: by.number });
    const k = L.klass(r);
    if (k === 'none') return { state: 'none' };
    if (k === 'ok' && r.id) return { state: 'ok', card: r };
    return { state: L.unclear(k) ? 'unclear' : 'refused', message: L.msg(r) || 'AIR POS did not answer', k };
  };
  const readOrder = async id => {
    const r = await api.retail(RO + 'Get', { id });
    const k = L.klass(r);
    if (k === 'none') return { state: 'none' };
    if (k === 'ok' && r.id) return { state: 'ok', order: r };
    return { state: L.unclear(k) ? 'unclear' : 'refused', message: L.msg(r) || 'AIR POS did not answer', k };
  };
  const cardState = (c, st) => { // can this card be refilled?
    if (!c.isSold) return 'This card has not been sold yet. Sell it first.';
    if (c.expired === true) return 'This card has expired.';
    return '';
  };
  const saveBody = (p, c) => ({ id: p.id, retailGiftCardId: c.id, amount: p.amount, paymentAmount: p.payAmount, paymentType: p.method === 'card' ? 20 : 10, currencyCode: reg.identity.currencyCode, currency: reg.identity.currency, operatorId: reg.identity.userId });

  // Save (64), shared by the paid top-up and the free credit. Idempotent: the same id is one order.
  const doSave = async (p, c) => {
    L.pend.set(p.id, { step: 'saving' });
    const r = await api.submit(RO + 'Save', saveBody(p, c)), k = L.klass(r);
    if (k === 'loggedOut') { L.pend.drop(p.id); return fail('Logged out. Log in again.', { loggedOut: true }); }
    if (k === 'refused') { L.pend.drop(p.id); return fail(L.msg(r) || 'AIR POS refused the top-up'); }
    if (L.unclear(k) || k === 'none') {
      const o = await readOrder(p.id);
      if (o.state === 'none') { L.pend.drop(p.id); return fail('The top-up was not started (no answer from AIR POS). Nothing was added. Try again.'); }
      if (o.state !== 'ok') { L.pend.set(p.id, { step: 'unknown-saving' }); return fail('Not sure the top-up was started. Check Top-up orders before trying again.', { unknown: true, id: p.id }); }
    }
    const o = await readOrder(p.id);
    L.pend.set(p.id, { step: 'saved', number: o.state === 'ok' ? o.order.number : '' });
    return { ok: true };
  };
  // Complete (67): sent at most once. completeSent is saved BEFORE the call, so a crash cannot make us send it twice.
  const doComplete = async (p, tag) => {
    if (p.completeSent) return fail('Finish was already sent for this top-up. Use "Check what happened" first.', { id: p.id });
    L.pend.set(p.id, { step: 'completing', completeSent: true });
    const r = await api.retail(RO + 'Complete?id=' + encodeURIComponent(p.id), {}), k = L.klass(r);
    if (k === 'refused' || k === 'loggedOut') { L.pend.set(p.id, { step: 'paid', completeSent: false }); return fail(L.msg(r) || 'AIR POS refused to finish', k === 'loggedOut' ? { loggedOut: true } : {}); }
    if (k !== 'ok') { L.pend.set(p.id, { step: 'unknown-completing' }); return fail('AIR POS did not answer clearly. The money may or may not be on the card. Press "Check what happened". Do not take payment again.', { unknown: true, id: p.id }); }
    return settle(L.pend.get(p.id), tag);
  };
  // after a Complete (or a check): read order + card, decide, record
  const settle = async (p, tag) => {
    const o = await readOrder(p.id), cc = await readCard({ id: p.cardId });
    if (o.state !== 'ok' || cc.state !== 'ok') { L.pend.set(p.id, { step: 'unknown-completing' }); return fail('Could not read the result back. Press "Check what happened".', { unknown: true, id: p.id }); }
    if (o.order.status === 20) {
      const want = L.r2(p.balBefore + p.amount), got = L.r2(cc.card.balance);
      L.pend.set(p.id, { step: 'done', balAfter: got });
      L.audit('gift-log.jsonl', { kind: p.kind, orderId: p.id, number: o.order.number, last4: p.last4, amount: p.amount, method: p.method, balBefore: p.balBefore, balAfter: got, by: p.by });
      if (p.kind === 'free') L.audit('gift-credit-log.jsonl', { result: 'done', orderId: p.id, number: o.order.number, cardId: p.cardId, last4: p.last4, amount: p.amount, reason: p.reason, by: p.by, approvedWithPassword: !!p.typed, balBefore: p.balBefore, balAfter: got });
      return { ok: true, done: true, kind: p.kind, number: o.order.number, balBefore: p.balBefore, balAfter: got, amount: p.amount, balanceMatches: got === want, message: got === want ? undefined : 'Finished, but the card balance is $' + got.toFixed(2) + ' (expected $' + want.toFixed(2) + '). Check the card.', card: card(cc.card), order: order(o.order) };
    }
    return { ok: false, notFinished: true, id: p.id, status: o.order.status, message: 'AIR POS shows this top-up as not finished.' };
  };

  const routes = {
    // ----- reads (60, 57, 72, 71, 66) -----
    'gc-cards': async b => { // 60
      const page = Math.max(1, Math.min(500, parseInt(b.page, 10) || 1));
      const r = await api.retail(GC + 'Paged', { filter: JSON.stringify({ cardNo: String(b.keyword || '').trim().slice(0, 50) }), pageInfo: JSON.stringify({ page, pageSize: 20, amount: 0 }) });
      const k = L.klass(r); if (k !== 'ok' || !Array.isArray(r.rows)) return fail(L.msg(r) || 'Could not read the gift cards', { k });
      return { ok: true, rows: r.rows.map(card), total: r.total || 0, page };
    },
    'gc-card': async b => { // 57
      const by = b.id ? { id: String(b.id) } : { number: String(b.number || '').trim() };
      if (!by.id && !by.number) return fail('Type or scan the card number');
      const c = await readCard(by);
      if (c.state === 'none') return fail('No gift card with that number');
      if (c.state !== 'ok') return fail(c.message);
      return { ok: true, card: card(c.card) };
    },
    'gc-orders': async b => { // 72
      const page = Math.max(1, Math.min(500, parseInt(b.page, 10) || 1)), f = {};
      if (b.keyword) f.cardNo = String(b.keyword).trim().slice(0, 50);
      const r = await api.retail(RO + 'Paged', { filter: JSON.stringify(f), pageInfo: JSON.stringify({ page, pageSize: 20, amount: 0 }) });
      const k = L.klass(r); if (k !== 'ok' || !Array.isArray(r.rows)) return fail(L.msg(r) || 'Could not read the top-up orders', { k });
      const free = freeIds();
      return { ok: true, rows: r.rows.map(o => ({ ...order(o), free: free.has(o.id) })), total: r.total || 0, page };
    },
    'gc-order': async b => { // 71
      const o = await readOrder(String(b.id || '')); if (o.state === 'none') return fail('No such top-up order');
      if (o.state !== 'ok') return fail(o.message);
      return { ok: true, order: { ...order(o.order), free: freeIds().has(o.order.id) } };
    },
    'gc-pay-check': async b => { // 66: only for a payment this register began
      const p = L.pend.get(String(b.id || '')); if (!p || !p.receiveBegun) return fail('No card payment is open for that top-up');
      const r = await api.retail(RO + 'ReceiveCheck?id=' + encodeURIComponent(p.id), {}), k = L.klass(r);
      if (k !== 'ok') return fail(L.msg(r) || 'Could not check the payment', { k });
      const v = r.value || {};
      if (v.isCompleted && !v.isUncertain && p.step === 'receiving') L.pend.set(p.id, { step: 'paid' });
      return { ok: true, paid: !!(v.isCompleted && !v.isUncertain), waiting: !v.isCompleted, uncertain: !!v.isUncertain, message: String(v.message || '').slice(0, 200) };
    },
    'gc-open': async () => ({ ok: true, open: L.pend.open().map(sum), settings: settings() }),

    // ----- paid top-up: Start (64) -> Pay (65) -> Finish (67) -----
    'gc-topup-start': async b => L.exclusive(async () => {
      L.pend.prune();
      const am = L.parseAmount(b.amount, 1, 1000); if (!am.ok) return fail(am.message);
      const method = b.method === 'card' ? 'card' : 'cash';
      const open = L.pend.open(); if (open.length) return fail('A top-up is already open on this register. Finish or cancel it first.', { open: open.map(sum) });
      const c = await readCard(String(b.number || '').trim() ? { number: String(b.number).trim() } : { id: String(b.cardId || '') });
      if (c.state === 'none') return fail('No gift card with that number');
      if (c.state !== 'ok') return fail(c.message);
      const why = cardState(c.card, settings()); if (why) return fail(why);
      const p = L.pend.add({ id: L.newId(), kind: 'topup', step: 'saving', amount: am.n, payAmount: am.n, method, cardId: c.card.id, last4: String(c.card.cardNo).slice(-4), balBefore: L.r2(c.card.balance), at: new Date().toISOString(), by: String((reg.identity && reg.identity.userName) || '').slice(0, 40) });
      const s = await doSave(p, c.card); if (!s.ok) return s;
      return { ok: true, id: p.id, step: 'saved', amount: p.amount, method, card: card(c.card), number: L.pend.get(p.id).number };
    }),
    'gc-topup-pay': async b => L.exclusive(async () => { // 65
      const p = L.pend.get(String(b.id || '')); if (!p || p.kind !== 'topup') return fail('That top-up is not open on this register');
      if (p.step === 'paid') return { ok: true, id: p.id, step: 'paid', paid: true }; // pressing twice is harmless
      if (p.step !== 'saved') return fail('This top-up cannot take payment now (' + p.step + ').');
      const o = await readOrder(p.id); if (o.state !== 'ok' || o.order.status !== 10) return fail('AIR POS does not show this top-up as waiting for payment.');
      L.pend.set(p.id, { receiveBegun: true });
      const r = await api.submit(RO + 'ReceiveBegin', { id: p.id, creditCard: { cardNo: '', expiration: '', cvv: '' } }), k = L.klass(r);
      if (k === 'refused' || k === 'loggedOut') { L.pend.set(p.id, { receiveBegun: false }); return fail(L.msg(r) || 'AIR POS would not start the payment', k === 'loggedOut' ? { loggedOut: true } : {}); }
      if (k !== 'ok') { // a card payment may be live on the terminal: never start another
        if (p.method === 'cash') { L.pend.set(p.id, { receiveBegun: false }); return fail('No clear answer from AIR POS. Press Cash received again.'); }
        L.pend.set(p.id, { step: 'receiving', unknownBegin: true });
        return fail('No clear answer from AIR POS. A card payment may be open on the terminal. Check it; do not charge again.', { unknown: true, id: p.id });
      }
      const v = (r && r.value) || {};
      if (p.method === 'cash') { L.pend.set(p.id, { step: 'paid' }); return { ok: true, id: p.id, step: 'paid', paid: true }; }
      L.pend.set(p.id, { step: v.isCompleted && !v.isUncertain ? 'paid' : 'receiving' });
      return { ok: true, id: p.id, step: L.pend.get(p.id).step, paid: !!(v.isCompleted && !v.isUncertain), waiting: !v.isCompleted };
    }),
    'gc-topup-finish': async b => L.exclusive(async () => { // 67
      const p = L.pend.get(String(b.id || '')); if (!p || p.kind !== 'topup') return fail('That top-up is not open on this register');
      if (p.step === 'done') return fail('This top-up is already finished.', { done: true });
      if (p.step !== 'paid') return fail('Take the payment first.');
      if (p.method === 'card') { // the card terminal must say paid, right now
        const r = await api.retail(RO + 'ReceiveCheck?id=' + encodeURIComponent(p.id), {}), v = (r && r.value) || {};
        if (L.klass(r) !== 'ok' || !v.isCompleted || v.isUncertain) return fail('AIR POS does not show the card payment as complete.');
      }
      const o = await readOrder(p.id); if (o.state !== 'ok' || o.order.status !== 10) return fail('AIR POS does not show this top-up as waiting to finish.');
      const cc = await readCard({ id: p.cardId }); if (cc.state !== 'ok') return fail('Could not read the card. Try again.');
      const why = cardState(cc.card, settings()); if (why) return fail(why);
      L.pend.set(p.id, { balBefore: L.r2(cc.card.balance) });
      return doComplete(L.pend.get(p.id));
    }),
    'gc-topup-resolve': async b => L.exclusive(async () => { // "Check what happened": read, never resend
      const p = L.pend.get(String(b.id || '')); if (!p) return fail('That top-up is not open on this register');
      const o = await readOrder(p.id);
      if (o.state === 'none') { // AIR POS does not know this order: if Finish was never sent, nothing can have been added, so the stale record is cleared
        if (!p.completeSent) { L.pend.drop(p.id); return { ok: true, cleared: true, message: 'AIR POS has no such top-up. Nothing was added.' }; }
        return fail('AIR POS cannot find this top-up, but Finish was sent. Check Top-up orders and the card balance.'); }
      if (o.state !== 'ok') return fail(o.message);
      if (o.order.status === 20) { if (p.step === 'done') return { ok: true, done: true, message: 'Already finished.' }; return settle(p); }
      if (p.step === 'unknown-saving') { L.pend.set(p.id, { step: 'saved' }); return { ok: true, step: 'saved', message: 'The top-up was started. Continue.' }; }
      if (p.step === 'unknown-completing' || p.step === 'completing') {
        const cc = await readCard({ id: p.cardId });
        if (cc.state !== 'ok') return fail('Could not read the card.');
        if (L.r2(cc.card.balance) !== L.r2(p.balBefore)) return fail('The card balance changed but AIR POS shows the top-up as not finished. Ask a manager. Do not press Finish.', { id: p.id, hold: true });
        L.pend.set(p.id, { step: 'paid', completeSent: false });
        return { ok: true, step: 'paid', message: 'AIR POS did not finish it and nothing was added. You can press Finish again.' };
      }
      return { ok: true, step: p.step, message: 'Nothing to fix.' };
    }),
    'gc-topup-abandon': async b => L.exclusive(async () => { // a top-up THIS register started where nothing was paid: delete it (70), no manager needed
      const p = L.pend.get(String(b.id || '')); if (!p || p.kind !== 'topup') return fail('That top-up is not open on this register');
      if (p.step !== 'saved' || p.receiveBegun || p.completeSent) return fail('A payment step already started. Use Cancel payment or Check what happened.');
      const o = await readOrder(p.id);
      if (o.state === 'none') { L.pend.drop(p.id); return { ok: true, message: 'AIR POS has no such top-up. Nothing was added.' }; }
      if (o.state !== 'ok') return fail(o.message);
      if (o.order.status !== 10) return fail('AIR POS does not show this top-up as unfinished.');
      const r = await api.retail(RO + 'Delete', { command: JSON.stringify({ id: p.id }) }), k = L.klass(r);
      if (k !== 'ok') return fail(L.msg(r) || 'AIR POS did not delete it', { unknown: L.unclear(k) });
      L.pend.set(p.id, { step: 'cancelled' }); L.audit('gift-log.jsonl', { kind: 'abandon', orderId: p.id, last4: p.last4, by: p.by });
      return { ok: true, message: 'Top-up dropped. Nothing was added.' };
    }),
    'gc-pay-cancel': async b => L.exclusive(async () => { // 68
      const p = L.pend.get(String(b.id || '')); if (!p || p.kind !== 'topup') return fail('That top-up is not open on this register');
      if (p.step === 'done') return fail('Already finished');
      if (p.receiveBegun && p.method === 'card') { // look again right before: a payment that already went through is never cancelled
        const r = await api.retail(RO + 'ReceiveCheck?id=' + encodeURIComponent(p.id), {}), v = (r && r.value) || {};
        if (L.klass(r) !== 'ok') return fail('Could not check the card payment. Do not cancel yet.');
        if (v.isCompleted && !v.isUncertain) { L.pend.set(p.id, { step: 'paid' }); return fail('The card payment already went through. Finish the top-up instead.', { paid: true }); }
      }
      const r = await api.retail(RO + 'ReceiveCancel?id=' + encodeURIComponent(p.id), {}), k = L.klass(r);
      if (k !== 'ok') return fail(L.msg(r) || 'AIR POS did not confirm the cancel. Check it.', { unknown: L.unclear(k) });
      L.pend.set(p.id, { step: 'saved', receiveBegun: false, unknownBegin: false });
      return { ok: true, step: 'saved', message: 'Payment cancelled. The top-up is still open (nothing added).' };
    }),
    'gc-order-cancel': async b => L.exclusive(async () => { // 69 (manager)
      const g = await L.needMgr(b, 'Cancelling a top-up'); if (!g.ok) return g;
      const id = String(b.id || ''), o = await readOrder(id); if (o.state !== 'ok') return fail(o.state === 'none' ? 'No such top-up order' : o.message);
      if (o.order.status !== 10) return fail('Only an unfinished top-up can be cancelled.');
      const p = L.pend.get(id); if (p && (p.completeSent || p.step === 'receiving' || (p.step === 'paid' && p.method === 'card'))) return fail('A payment is involved. Use Check what happened first.');
      const r = await api.retail(RO + 'Cancel', { retailGiftCardRechargeOrderId: id }), k = L.klass(r);
      if (k === 'ok') { if (p) L.pend.set(id, { step: 'cancelled' }); L.audit('gift-log.jsonl', { kind: 'cancel', orderId: id, by: g.by }); return { ok: true, message: 'Top-up cancelled.' }; }
      if (r && /HTTP 404/.test(String(r.message))) return fail('This AIR POS server has no Cancel. Use Delete for an unpaid top-up.', { notAvailable: true });
      return fail(L.msg(r) || 'AIR POS did not cancel it', { unknown: L.unclear(k) });
    }),
    'gc-order-delete': async b => L.exclusive(async () => { // 70 (manager)
      const g = await L.needMgr(b, 'Deleting a top-up'); if (!g.ok) return g;
      const id = String(b.id || ''), o = await readOrder(id); if (o.state !== 'ok') return fail(o.state === 'none' ? 'No such top-up order' : o.message);
      if (o.order.status !== 10) return fail('Only an unfinished top-up can be deleted.');
      const p = L.pend.get(id);
      if (p && (p.completeSent || p.step === 'receiving' || (p.step === 'paid' && p.method === 'card'))) return fail('A card payment may be involved. Use Check what happened first.');
      if (o.order.paymentType !== 10) { const r = await api.retail(RO + 'ReceiveCheck?id=' + encodeURIComponent(id), {}), v = (r && r.value) || {}; if (L.klass(r) !== 'ok' || v.isCompleted || v.isUncertain) return fail('A payment may exist on this top-up. It was not deleted.'); }
      const r = await api.retail(RO + 'Delete', { command: JSON.stringify({ id }) }), k = L.klass(r);
      if (k !== 'ok') return fail(L.msg(r) || 'AIR POS did not delete it', { unknown: L.unclear(k) });
      const pg = await api.retail(RO + 'Paged', { filter: JSON.stringify({ cardNo: o.order.cardNo }), pageInfo: JSON.stringify({ page: 1, pageSize: 50, amount: 0 }) });
      const still = L.klass(pg) === 'ok' && (pg.rows || []).some(x => x.id === id);
      if (p) L.pend.set(id, { step: 'cancelled' });
      L.audit('gift-log.jsonl', { kind: 'delete', orderId: id, last4: String(o.order.cardNo).slice(-4), by: g.by });
      return { ok: true, message: still ? 'Delete sent, but AIR POS still lists it. Check again in a minute.' : 'Top-up deleted.', stillListed: still };
    }),
    'gc-card-update': async b => L.exclusive(async () => { // 62 (manager, OFF by default: it zeroed the face value on TestShop)
      const g = await L.needMgr(b, 'Editing a gift card'); if (!g.ok) return g;
      if (!settings().allowCardEdit) return fail('Editing a gift card is switched off: on the test server it wiped the card value.', { disabled: true });
      const c = await readCard({ id: String(b.id || '') }); if (c.state !== 'ok') return fail(c.state === 'none' ? 'No such card' : c.message);
      const cc = c.card, sub = { id: cc.id, cardNo: cc.cardNo, faceValue: cc.faceValue, issueDate: cc.issueDate, expireDate: b.expireDate === undefined ? cc.expireDate : (b.expireDate || null), retailMemberId: cc.retailMemberId };
      const r = await api.submit(GC + 'Update', sub), k = L.klass(r);
      const after = await readCard({ id: cc.id });
      const damaged = after.state === 'ok' && (L.r2(after.card.balance) !== L.r2(cc.balance) || L.r2(after.card.faceValue) !== L.r2(cc.faceValue));
      L.audit('gift-log.jsonl', { kind: 'card-update', last4: String(cc.cardNo).slice(-4), by: g.by, ok: k === 'ok', damaged });
      if (damaged) return fail('The card value changed after the edit! Balance was $' + L.r2(cc.balance).toFixed(2) + ', now $' + L.r2(after.card.balance).toFixed(2) + '. Tell the owner.', { damaged: true });
      return k === 'ok' ? { ok: true, card: after.state === 'ok' ? card(after.card) : undefined } : fail(L.msg(r) || 'AIR POS did not save the card', { unknown: L.unclear(k) });
    }),

    // ----- no-payment credit (manager only): Save with paymentAmount 0 -> $0 cash receive -> Complete (TestShop-checked, Route A) -----
    'gc-free-credit': async b => L.exclusive(async () => {
      const g = await L.needMgr(b, 'Adding credit with no payment'); if (!g.ok) return g;
      const st = settings();
      const a1 = L.parseAmount(b.amount, 1, 1e7), a2 = L.parseAmount(b.amount2, 1, 1e7);
      if (!a1.ok) return fail(a1.message);
      if (!a2.ok || a2.n !== a1.n) return fail('The two amounts do not match. Type the same amount twice.');
      const reason = String(b.reason || '').replace(/\s+/g, ' ').trim();
      if (reason.length < 3) return fail('Write a reason (at least a few words).');
      if (reason.length > 200) return fail('The reason is too long (200 letters at most).');
      L.pend.prune(); const open = L.pend.open(); if (open.length) return fail('A top-up is already open on this register. Finish or cancel it first.', { open: open.map(sum) });
      const c = await readCard(String(b.number || '').trim() ? { number: String(b.number).trim() } : { id: String(b.cardId || '') });
      if (c.state === 'none') return fail('No gift card with that number');
      if (c.state !== 'ok') return fail(c.message);
      const why = cardState(c.card, st); if (why) return fail(why);
      const p = L.pend.add({ id: L.newId(), kind: 'free', step: 'saving', amount: a1.n, payAmount: 0, method: 'cash', cardId: c.card.id, last4: String(c.card.cardNo).slice(-4), balBefore: L.r2(c.card.balance), reason, by: g.by, typed: g.typed, at: new Date().toISOString() });
      L.audit('gift-credit-log.jsonl', { result: 'intent', orderId: p.id, last4: p.last4, amount: p.amount, reason, by: g.by, approvedWithPassword: g.typed });
      const s = await doSave(p, c.card); if (!s.ok) { L.audit('gift-credit-log.jsonl', { result: s.unknown ? 'unknown' : 'not-started', orderId: p.id, note: s.message }); return s; }
      // $0 cash receive (what AIR POS would do for cash): nothing is charged
      L.pend.set(p.id, { receiveBegun: true });
      const r = await api.submit(RO + 'ReceiveBegin', { id: p.id, creditCard: { cardNo: '', expiration: '', cvv: '' } }), k = L.klass(r);
      if (k !== 'ok') { L.pend.set(p.id, { step: 'saved', receiveBegun: false }); return fail('The $0 payment step did not go through. Press "Check what happened", then try again.', { unknown: L.unclear(k), id: p.id }); }
      L.pend.set(p.id, { step: 'paid' });
      const res = await doComplete(L.pend.get(p.id));
      if (!res.ok) L.audit('gift-credit-log.jsonl', { result: res.unknown ? 'unknown' : 'failed', orderId: p.id, note: res.message });
      return res;
    }),
    'gc-free-list': async b => { // the free-credit list (manager)
      const g = await L.needMgr(b, 'The free-credit list'); if (!g.ok) return g;
      const rows = L.readLines('gift-credit-log.jsonl').filter(e => e.result === 'done').reverse().slice(0, 200).map(e => ({ at: e.at, number: e.number, cardMask: '****' + String(e.last4 || ''), amount: e.amount, reason: e.reason, by: e.by, balBefore: e.balBefore, balAfter: e.balAfter, withPassword: !!e.approvedWithPassword }));
      return { ok: true, rows, total: rows.reduce((s, x) => s + x.amount, 0) };
    },
    'gc-settings': async b => {
      if (!b || b.set === undefined) return { ok: true, settings: settings() };
      const g = await L.needMgr(b, 'Changing these settings'); if (!g.ok) return g;
      return fail('There are no free-credit settings to change (no limit; expired cards are always blocked).');
    },
  };
  const names = Object.keys(routes);
  return { routes, unlocked: ['gc-cards', 'gc-card', 'gc-orders', 'gc-order', 'gc-pay-check', 'gc-open', 'gc-settings'], once: names.filter(n => /^gc-(topup|pay-cancel|order-|card-update|free-credit)/.test(n)), noSnap: names };
};
module.exports = plugin;
module.exports.makeLib = makeLib;

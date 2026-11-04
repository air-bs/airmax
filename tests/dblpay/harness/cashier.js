'use strict';
// A simulated careful cashier: keeps pressing the sensible button (Retry / Finish / Check again) until the sale completes or gives up.
const L = require('./lib');
const GIFT = { a: '7000000000008888', b: '7000000000009999' };
async function giftCard(R, no) { const v = await R.post('gift-verify', { number: no }); return v.ok ? v.card : null; }
// build one tender body for kind given remaining
async function tenderBody(R, kind, rem, ctx) {
  if (kind === 'cash') return { type: 10, tendered: L.r2(rem + (ctx.extra || 0)) };
  if (kind === 'card') return { type: 20, amount: rem };
  if (kind === 'acct') return { type: 11, amount: rem };
  if (kind === 'check') return { type: 50, amount: rem, checkNumber: '1001' };
  if (kind === 'gift') { const c = ctx.gift || (ctx.gift = await giftCard(R, ctx.giftNo || GIFT.a)); if (!c) return null; const a = L.r2(Math.min(rem, c.balance)); if (!(a > 0)) return null; return { type: 40, amount: a, giftCards: [c] }; }
  return null;
}
// plan = list of kinds; the last kind pays whatever is left. part = fraction for non-last tenders.
async function settle(R, plan, ctx = {}) {
  const log = ctx.log = ctx.log || []; let step = 0, i = 0; const oid = (await R.state()).order.id; ctx.oid = oid;
  for (; i < (ctx.maxTries || 14); i++) {
    let s = await R.state().catch(e => null); if (!s) { log.push('state failed'); await L.sleep(500); continue; }
    if (!s.loggedIn) { log.push('relogin'); await R.login(); continue; }
    if (s.completed && s.completed.orderId === oid) { ctx.completed = s.completed; return { ok: true, s, tries: i }; }
    if (s.order && s.order.id !== oid) { log.push('order changed ' + s.order.id); return { ok: false, why: 'order id changed', s }; }
    const c = s.pay && s.pay.card;
    if (c && (c.status === 'waiting')) { await R.waitCard(ctx.cardWait || 20000); continue; }
    if (c && c.status === 'declined') { if (ctx.onDecline === 'retry') { log.push('card-retry'); ctx.retries = (ctx.retries || 0) + 1; ctx.onDecline = ctx.declineThen || 'cancel'; const r = await R.post('card-retry'); log.push(short(r)); } else { log.push('card-cancel'); const r = await R.post('card-cancel'); log.push(short(r)); plan = ctx.afterDecline || ['cash']; step = 0; } continue; }
    const rem = s.pay ? s.pay.remaining : s.totals.due; const last = s.pay && s.pay.lastError;
    if (s.pay && !(rem > 0)) { const r = await R.post(ctx.recheck && i % 2 ? 'pay-recheck' : 'finish-sale'); log.push('finish ' + short(r)); if (r.completed) { ctx.completed = r; continue; } await L.sleep(200); continue; }
    const kind = plan[Math.min(step, plan.length - 1)]; const isLast = step >= plan.length - 1;
    let amt = isLast ? rem : L.r2(Math.max(0.01, Math.floor(rem * (ctx.part || 0.4) * 100) / 100));
    const b = await tenderBody(R, kind, amt, ctx); if (!b) { log.push('no tender body for ' + kind); plan = ['cash']; step = 0; continue; }
    if (kind === 'cash' && !isLast) { delete b.tendered; b.amount = amt; b.tendered = amt; }
    const r = await R.post('pay-tender', b); log.push(`${kind} ${b.amount ?? b.tendered} -> ` + short(r));
    if (r.ok && !r.waiting) step++; else if (r.ok && r.waiting) step++;
    if (r.loggedOut || /log in/i.test(r.message || '')) { await R.login(); }
    if (!r.ok) await L.sleep(r.retryable ? 300 : 150);
    if (r.completed) ctx.completed = r;
  }
  return { ok: false, why: 'gave up after ' + i, s: await R.state().catch(() => null) };
}
const short = r => r ? (r.ok ? 'ok' : 'ERR') + (r.completed ? ' COMPLETED' : '') + (r.waiting ? ' waiting' : '') + (r.message ? ' ' + String(r.message).slice(0, 140) : '') : 'null';
// Money invariants on one finished sale (server = sim). exp: { done, due, change, multiCard, acct:{id,before,amount} }
async function verify(R, oid, exp = {}, ctx = {}) {
  const issues = []; const chk = await L.orderCheck(oid, { done: exp.done !== false ? true : false, due: exp.due, multiCard: exp.multiCard }); issues.push(...chk.issues);
  const led = await L.sim('/ledger', { orderId: oid });
  const comp = led.filter(e => e.path === 'OrderComplete' && e.success).length; if (exp.done !== false && comp !== 1) issues.push('COMPLETES x' + comp);
  const o = chk.o; if (o) { const good = o.rcv.filter(x => x.status === 20); const byType = {}; good.forEach(x => byType[x.paymentType] = (byType[x.paymentType] || 0) + 1); if ((byType[10] || 0) > 1) issues.push('CASH_RECEIVES x' + byType[10]); if ((byType[11] || 0) > 1 && !exp.multiAcct) issues.push('ACCT_RECEIVES x' + byType[11]);
    const open = o.rcv.filter(x => x.status === 10); if (o.done && open.length) issues.push('OPEN_RECEIVE_LEFT x' + open.length); }
  const cd = ctx.completed; if (cd && chk.due != null && cd.due != null && Math.abs(cd.due - chk.due) > 0.004) issues.push(`APP_DUE ${cd.due} vs AIR POS ${chk.due}`);
  if (cd && exp.change != null && Math.abs((cd.change || 0) - exp.change) > 0.004) issues.push(`CHANGE ${cd.change} expected ${exp.change}`);
  if (exp.acct) { const moved = L.r2(led.filter(e => e.path === 'ReceiveBegin' && e.success && !e.dupId && e.type === 11).reduce((a, e) => a + e.amount, 0)); const used = o ? L.r2(o.rcv.filter(x => x.status === 20 && x.paymentType === 11).reduce((a, x) => a + x.amount, 0)) : 0; if (Math.abs(moved - used) > 0.004) issues.push(`ACCT_BALANCE moved ${moved} but receives ${used}`); }
  const s = await R.state(); if (exp.done !== false && ((s.cart || []).length || s.pay)) issues.push('NEXT_SALE_NOT_CLEAN');
  return { issues, chk, led };
}
module.exports = { settle, verify, giftCard, GIFT, short };

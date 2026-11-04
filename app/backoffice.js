// AirMax Orders tab, phase 1 (PLAN-orders-tab.md). VIEW AND SEARCH ONLY: one read-only AIR POS call, /Orders/RetailOrderPaged
// (the order list AIR POS's own order screens read), made through the existing api.retail(). Nothing here saves, pays, prints,
// refunds, voids or changes an order, nothing is written to disk, and the sale on the RETAIL SALES screen is never touched.
// Lives outside the frozen app/lib (tests/backend-frozen.test.js), like labels.js / reprint.js.
'use strict';

const PATH = '/Orders/RetailOrderPaged';
const PAGE_SIZE = 50;
const MAX_TEXT = 60;
// Codes are AIR POS's (app/lib/register.js OrderStatus / PaymentType). Names: payment names as on the AirMax payment screen.
const STATUSES = [[20, 'Completed'], [15, 'Held (Pending)'], [17, 'Paid, not finished'], [10, 'New'], [-5, 'Void'], [-10, 'Canceled']];
const PAYMENTS = [[10, 'Cash'], [20, 'Credit Card'], [30, 'Manual Credit'], [40, 'Gift Card'], [50, 'Check'], [11, 'Account'], [99, 'Split (2+ payments)']];
const STATUS_NAME = Object.fromEntries(STATUSES), PAY_NAME = Object.fromEntries(PAYMENTS);

const clean = v => String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, MAX_TEXT);
const codes = (v, list) => { const want = new Set((Array.isArray(v) ? v : []).map(Number)); return list.map(x => x[0]).filter(c => want.has(c)); };
// 'YYYY-MM-DD' (what <input type="date"> gives): '' = no date, null = not a real calendar date
function day(v) {
  const s = clean(v); if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? s : null;
}
const dayStart = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const dayEnd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d + 1).getTime(); }; // exclusive (DST safe)

// What the cashier typed / ticked -> a checked query. Never throws; a bad date is refused before anything is asked of AIR POS.
function parseQuery(b) {
  b = b && typeof b === 'object' ? b : {};
  const q = {
    number: clean(b.number), productNumber: clean(b.productNumber),
    customer: clean(b.customer).replace(/[^\w]/g, ''), // AIR POS customer # = the phone without punctuation (MemberSaveDrawer rule)
    operator: clean(b.operator), remark: clean(b.remark),
    statuses: codes(b.statuses, STATUSES), payments: codes(b.payments, PAYMENTS),
    from: day(b.from), to: day(b.to),
    page: Math.min(10000, Math.max(1, Math.floor(Number(b.page)) || 1)),
  };
  if (q.from === null || q.to === null) return { error: 'That date is not a real date. Pick it again.' };
  if (q.from && q.to && q.from > q.to) return { error: 'The From date is after the To date.' };
  return { q };
}

// The filter AIR POS gets. Keys and their order follow the frozen store call to this same endpoint (register.js heldOrders, AIR POS
// 1.9.11 OrderCheckout): { number, productNumber, memberNumber, status, operatorName, paymentType, beginDate, endDate }. The list
// keys statuses / paymentTypes and remark are sent ONLY when that filter is used: they are still to be checked against AIR POS
// (PLAN-orders-tab.md section 4), so a search without them sends exactly the known shape.
function buildFilter(q) {
  const f = {
    number: q.number, productNumber: q.productNumber, memberNumber: q.customer,
    status: q.statuses.length === 1 ? q.statuses[0] : null,
    operatorName: q.operator || null,
    paymentType: q.payments.length === 1 ? q.payments[0] : null,
    beginDate: q.from ? q.from + 'T00:00:00' : null, endDate: q.to ? q.to + 'T23:59:59' : null, // local time, ISO form
  };
  if (q.statuses.length) f.statuses = q.statuses.slice();
  if (q.payments.length) f.paymentTypes = q.payments.slice();
  if (q.remark) f.bak = q.remark; // AIR POS's order note field is `bak` (TestShop Nov 3: filter `bak` narrows the list, `remark` is ignored)
  return f;
}
const used = q => [['number', 'Order #'], ['productNumber', 'Product #'], ['customer', 'Customer'], ['operator', 'Operator'], ['statuses', 'Status'], ['payments', 'Paid by'], ['from', 'From'], ['to', 'To'], ['remark', 'Remark']]
  .filter(([k]) => (Array.isArray(q[k]) ? q[k].length : q[k])).map(([, n]) => n);

const timeOf = o => o.createTime || o.creationTime || o.orderTime || o.completeTime || null; // same order as History (register.js orders)
const known = v => v !== null && v !== undefined;
const lc = v => String(v).toLowerCase();
// AIR POS ignores a filter key it does not know. When the answer visibly breaks a filter (a row with another status, outside the
// dates, ...), name it, so the screen says so instead of showing an unfiltered list as if it were filtered. Only fields the row
// really carries are checked (a missing field = cannot tell). Product # cannot be checked from a row (the lines are not in it).
function unapplied(q, rows) {
  const out = [], bad = (name, test) => { if (rows.some(o => o && typeof o === 'object' && test(o))) out.push(name); };
  if (q.number) bad('Order #', o => known(o.number) && !lc(o.number).includes(lc(q.number)));
  if (q.customer) bad('Customer', o => known(o.retailMemberNumber) && !lc(o.retailMemberNumber).includes(lc(q.customer)));
  if (q.operator) bad('Operator', o => known(o.operatorName) && !lc(o.operatorName).includes(lc(q.operator)));
  if (q.statuses.length) bad('Status', o => typeof o.status === 'number' && !q.statuses.includes(o.status));
  if (q.payments.length) bad('Paid by', o => typeof o.paymentType === 'number' && !q.payments.includes(o.paymentType));
  if (q.from || q.to) {
    const a = q.from ? dayStart(q.from) : -Infinity, z = q.to ? dayEnd(q.to) : Infinity;
    bad('Dates', o => { const t = Date.parse(timeOf(o) || ''); return Number.isFinite(t) && (t < a || t >= z); });
  }
  if (q.remark) bad('Remark', o => known(o.bak) && !lc(o.bak).includes(lc(q.remark)));
  return out;
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
// Display row. Total = amount + tax, as History shows it. Customer / operator / remark names are what this plan expects the row to
// carry (retailMemberName / memberName and retailMemberNumber are on AIR POS orders today: register.js returnAccountInfo / resume).
function mapRow(o) {
  o = o && typeof o === 'object' ? o : {};
  return {
    id: o.id, number: o.number == null ? '' : String(o.number), time: timeOf(o),
    status: o.status, statusName: o.statusName || STATUS_NAME[o.status] || '',
    paymentType: o.paymentType == null ? null : o.paymentType, paymentTypeName: o.paymentTypeName || PAY_NAME[o.paymentType] || '',
    customer: o.retailMemberName || o.memberName || '', customerNumber: o.retailMemberNumber || o.memberNumber || '',
    operator: o.operatorName || '',
    quantity: Number(o.quantity) || 0, quantityReturn: Number(o.quantityReturn) || 0,
    amount: r2(o.amount), tax: r2(o.tax), total: r2((Number(o.amount) || 0) + (Number(o.tax) || 0)), amountReturn: r2(o.amountReturn),
    remark: o.bak == null ? '' : String(o.bak), // order note = AIR POS `bak`
  };
}

class BackOffice {
  constructor({ reg, log } = {}) { this.reg = reg; this.log = log || (() => {}); }
  options() {
    return { ok: true, pageSize: PAGE_SIZE, statuses: STATUSES.map(([code, name]) => ({ code, name })), payments: PAYMENTS.map(([code, name]) => ({ code, name })) };
  }
  async orders(b) {
    const p = parseQuery(b);
    if (p.error) return { ok: false, bad: true, message: p.error };
    const q = p.q, t0 = Date.now();
    const r = await this.reg.api.retail(PATH, { filter: JSON.stringify(buildFilter(q)), pageInfo: JSON.stringify({ page: q.page, pageSize: PAGE_SIZE, amount: 0 }) });
    const box = r && (Array.isArray(r.rows) ? r : r.value && Array.isArray(r.value.rows) ? r.value : null);
    if (!box || r.success === false) {
      const why = String((r && r.message) || 'no answer').slice(0, 200);
      this.log(`ORDERS TAB search page ${q.page} -> not loaded: ${why}`);
      return { ok: false, loggedOut: !!(r && r.loggedOut), retryable: !!(r && (r.unreachable || r.uncertain)),
        message: `AIR POS did not send the orders (${why}). Nothing was changed. Press Search to try again.` };
    }
    const rows = box.rows.map(mapRow), total = Math.max(Number(box.total) || 0, (q.page - 1) * PAGE_SIZE + rows.length);
    const un = unapplied(q, box.rows);
    this.log(`ORDERS TAB search [${used(q).join(', ') || 'no filters'}] page ${q.page} -> ${rows.length} of ${total}${un.length ? '; NOT applied by AIR POS: ' + un.join(', ') : ''} (${Date.now() - t0}ms)`); // filter names only, never values
    return { ok: true, rows, total, page: q.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), pageSize: PAGE_SIZE, unapplied: un };
  }
}

module.exports = { BackOffice, parseQuery, buildFilter, unapplied, mapRow, PATH, PAGE_SIZE, STATUSES, PAYMENTS };

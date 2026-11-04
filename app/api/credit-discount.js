// AirMax Extra 12 (credit limit editor): the customer's Discount (a percent on the customer record), shown and edited in the top strip of the Customers > Credit box.
//   RetailMemberGet #74 -> cust-discount-get   (manager only, read)
//   RetailMemberGet #74 then RetailMemberUpdate #78 -> cust-discount-save   (manager only, write; needs confirmed:true)
// What the discount is (read-only research, Nov 3): `discount` on the customer record, a percent 0-100 (AIR POS's own customer form: "Member Discount", % suffix, 0-100).
// AIR POS's Checkout (and AirMax's) does NOT apply it to a sale (a price check with a 10% customer gave no discount), so the screen calls it "customer record".
// Who may use it: the same as the credit save: the AIR POS "Member Management" menu AND the manager flag (RetailManager), checked here on the server. A cashier gets "forbidden".
// A logged-in manager is not asked for a password again (Gordon, Nov 3). The screen asks first (old -> new); the server insists on confirmed:true.
// The save reads the customer fresh, sends the WHOLE record back (the same 19 fields AIR POS's own customer form sends) with only `discount` changed, then reads it back.
// Log: one line, "discount changed" + the customer id. Never the name, the values or anything else. One save at a time (`once`). app/lib is not touched.
'use strict';
const val = r => (r && typeof r === 'object' && !Array.isArray(r) && 'success' in r && 'value' in r ? r.value : r);
const bad = r => !r || (typeof r === 'object' && !Array.isArray(r) && r.success === false);
const msgOf = r => String((r && r.message) || 'AIR POS did not answer').slice(0, 200);
const failure = r => ({ ok: false, message: msgOf(r), ...(r && r.loggedOut ? { loggedOut: true } : {}), ...(r && r.uncertain ? { uncertain: true } : {}), ...(r && r.unreachable ? { unreachable: true } : {}) });
const idOk = s => typeof s === 'string' && /^[\w-]{1,64}$/.test(s);
const num = x => (typeof x === 'number' && isFinite(x) ? x : Number(x) || 0);
const round2 = x => Math.round(num(x) * 100) / 100;
const MSG = 'Discount must be a number from 0 to 100, like 10 or 12.5 (at most 2 decimals)';

// whole or decimal number 0-100, at most 2 decimals. Blank, negative, over 100, text, NaN, Infinity, exponent forms are all refused. Returns { v } or { error }.
function parseDiscount(x) {
  if (typeof x === 'number') { if (!isFinite(x) || x < 0 || x > 100 || Math.abs(x * 100 - Math.round(x * 100)) > 1e-6) return { error: MSG }; return { v: round2(x) }; }
  if (typeof x !== 'string') return { error: MSG };
  const t = x.trim(); if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { error: MSG };
  const n = Number(t); return n >= 0 && n <= 100 ? { v: round2(n) } : { error: MSG };
}

module.exports = ctx => {
  const { reg, log } = ctx;
  const MENU = 'Member Management';
  const noManager = () => (ctx.hasMenu(MENU) ? null : { ok: false, forbidden: true, message: 'This login does not have Member Management in AIR POS' }) || (ctx.isManager() ? null : { ok: false, forbidden: true, message: 'Only a manager can change a discount' });
  const gate = fn => async b => noManager() || fn(b || {});
  const pointByShop = async () => { try { return typeof reg.pointByShop === 'function' ? !!(await reg.pointByShop()) : true; } catch (e) { return true; } };

  const routes = {
    'cust-discount-get': gate(async b => {
      if (!idOk(b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
      const r = await reg.api.memberGet(b.retailMemberId), m = val(r);
      if (bad(r) || !m || !m.id) return failure(r || { message: 'Customer not found' });
      return { ok: true, discount: round2(m.discount) };
    }),
    'cust-discount-save': gate(async b => {
      if (!idOk(b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
      const d = parseDiscount(b.discount); if (d.error) return { ok: false, message: d.error };
      if (b.confirmed !== true) return { ok: false, needsConfirm: true, message: 'Confirm before changing the discount' };
      const r = await reg.api.memberGet(b.retailMemberId), m = val(r);                                  // a fresh read right before the save
      if (bad(r) || !m || !m.id) return failure(r || { message: 'Customer not found' });
      const before = round2(m.discount);
      if (before === d.v) return { ok: false, message: 'The discount is already ' + d.v + '%. Nothing to save', discount: before };
      // the credit pair goes back as the customer has it: the SHOP values when the shop keeps points per shop (the same mapping the credit save edits), else the company values
      const byShop = await pointByShop();
      const submit = { id: m.id, number: m.number, mobile: m.mobile, phone: m.phone, firstName: m.firstName, middleName: m.middleName, lastName: m.lastName, company: m.company, email: m.email, receiveAutoEmail: m.receiveAutoEmail,
        province: m.province, city: m.city, address: m.address, zipCode: m.zipCode, discount: d.v, remark: m.remark, status: m.status,
        creditAmount: byShop ? m.shopCreditAmount : m.creditAmount, allowCreditPayment: byShop ? m.shopAllowCreditPayment : m.allowCreditPayment };
      const u = await reg.api.memberUpdate(submit);
      if (!u || u.success === false) return failure(u);
      log('customers: discount changed (member ' + m.id + ')');
      // read back: what AIR POS shows now
      const r2 = await reg.api.memberGet(b.retailMemberId), m2 = val(r2);
      if (bad(r2) || !m2 || !m2.id) return { ok: true, message: String(u.message || 'Saved'), discount: d.v, readBack: false };
      const after = round2(m2.discount);
      if (after !== d.v) return { ok: false, message: 'AIR POS answered "saved" but now shows ' + after + '%. Check the customer in AIR POS', discount: after, readBack: true };
      return { ok: true, message: String(u.message || 'Saved'), discount: after, readBack: true };
    }),
  };
  return { routes, unlocked: [], once: ['cust-discount-save'], noSnap: Object.keys(routes) };
};
module.exports.parseDiscount = parseDiscount;

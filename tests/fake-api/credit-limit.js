// Fake AIR POS answers for Extra 12 (customer Discount in the credit box). Made-up data only; offline. Loads BEFORE customers.js (name order), so Batch 5's wrappers sit on top of this one.
// Hook (FAKE_PORT+1)  /disc-seed?id=m-edit2&discount=10   -> that customer's discount; also fills every other saved field with made-up values (so a round trip can be compared)
//                     /disc-state?id=m-edit2              -> { saves, last (the body AIR POS got), rec (the customer record now), before (the record just before the last save), bad }
//                     /disc-fail?mode=error|silent&n=1    -> the next n saves: error = AIR POS refuses; silent = answers success but keeps the old discount
//                     /disc-slow?ms=300                   -> every member save takes that long (to test two at once)
//                     /disc-reset                         -> clear the counters and the failure mode
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  const st = fake.disc = { slow: 0, saves: 0, last: null, before: null, fail: null, bad: [] };
  const get = handlers['/RetailMembers/RetailMemberGet'];
  const rec = id => { get({ id }); return (fake.members || {})[id] || null; };                 // get() makes the fake create its members
  const NEED = ['id', 'number', 'mobile', 'phone', 'firstName', 'middleName', 'lastName', 'company', 'email', 'receiveAutoEmail', 'province', 'city', 'address', 'zipCode', 'discount', 'remark', 'status', 'creditAmount', 'allowCreditPayment'];
  // wrapped after every fake-api file has loaded, so this one is the OUTERMOST layer (Batch 5's credit wrapper stays inside it and still sees plain answers)
  setImmediate(() => { const upd = handlers['/RetailMembers/RetailMemberUpdate']; handlers['/RetailMembers/RetailMemberUpdate'] = async p => {
    if (st.slow > 0) await new Promise(r => setTimeout(r, st.slow));
    const x = J(p, 'submit'); const r0 = rec(x.id);
    // every member save is counted (the Batch 5 credit saves pass through here too)
    st.saves++; st.before = r0 && { ...r0 }; st.last = x;
    const miss = NEED.filter(k => !(k in x)); if (miss.length) st.bad.push('record not whole: ' + miss.join(','));
    if (st.fail && st.fail.n > 0) { st.fail.n--; if (st.fail.mode === 'error') return { success: false, message: 'Discount could not be saved (fake)' };
      if (st.fail.mode === 'silent') { const keep = r0 ? r0.discount : 0; const r = upd(p); if (r0) r0.discount = keep; return r; } }
    return upd(p);
  }; });
  hooks['/disc-seed'] = (u, res) => { const q = k => u.searchParams.get(k), m = rec(q('id'));
    if (m) Object.assign(m, { discount: Number(q('discount') || 0), middleName: 'Q', phone: '555-000-1111', company: 'Made Up Co', province: 'NY', city: 'Testville', address: '1 Fake St', zipCode: '10001', remark: 'made-up remark', receiveAutoEmail: true, status: 10, statusName: 'Active' });
    res.end(JSON.stringify({ ok: !!m })); };
  hooks['/disc-state'] = (u, res) => res.end(JSON.stringify({ saves: st.saves, last: st.last, rec: rec(u.searchParams.get('id') || 'm-edit2'), before: st.before, bad: st.bad }));
  hooks['/disc-fail'] = (u, res) => { st.fail = { mode: u.searchParams.get('mode') || 'error', n: Number(u.searchParams.get('n') || 1) }; res.end('{}'); };
  hooks['/disc-slow'] = (u, res) => { st.slow = Number(u.searchParams.get('ms') || 0); res.end('{}'); };
  hooks['/disc-reset'] = (u, res) => { st.slow = 0; st.saves = 0; st.last = null; st.before = null; st.fail = null; st.bad = []; res.end('{}'); };
};

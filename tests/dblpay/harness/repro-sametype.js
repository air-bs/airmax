'use strict';
// 1.0.9-local.2 (a): real AIR POS keeps only the FIRST receive of a payment type (TestShop C33/S13). A second cash (or check)
// tender must be refused before anything is sent, and the sale must still finish exactly once with another payment type.
// FM = fault on the FIRST tender's ReceiveBegin (none | done500 | lost) so the first payment is adopted through the check path.
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', ROUNDS = Number(process.env.ROUNDS || 1), BASE = Number(process.env.BASE || 19100000), T = Number(process.env.T || 10), FM = process.env.FM || 'none';
const tb = (t, a) => t === 10 ? { type: 10, amount: a, tendered: a, stockOk: true } : t === 50 ? { type: 50, amount: a, checkNumber: '1001', stockOk: true } : { type: t, amount: a, stockOk: true };
(async () => { let bad = 0; for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); log.push('member ' + C.short(await R.post('member-attach', { number: '5550100' }))); await R.scan('1002'); await R.scan('1004'); s = await R.state(); const A = s.order.id; await R.post('pay-start'); s = await R.state(); const due0 = s.pay.remaining;
    if (FM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveBegin', mode: FM, n: 1 });
    let r1 = await R.post('pay-tender', tb(T, 1)); log.push(`first ${T} 1.00: ` + C.short(r1)); await L.sim('/faults-clear', { reg: REG });
    if (!r1.ok) { r1 = await R.post('pay-tender', tb(T, 1)); log.push('cashier presses again: ' + C.short(r1)); }
    const o1 = await L.sim('/order', { id: A }); const n1 = (o1 && o1.rcv || []).length;
    s = await R.state(); const rest = s.pay.remaining;
    const r2 = await R.post('pay-tender', tb(T, rest)); log.push(`second ${T} ${rest}: ` + C.short(r2));
    const o2 = await L.sim('/order', { id: A }); const n2 = (o2 && o2.rcv || []).length;
    const other = T === 10 ? 50 : 10; const r3 = await R.post('pay-tender', tb(other, rest)); log.push(`rest by ${other}: ` + C.short(r3));
    await L.sleep(1000); const o = await L.sim('/order', { id: A }); const rc = (o && o.rcv || []).filter(x => x.status === 20); const got = L.r2(rc.reduce((a, x) => a + x.amount, 0)); const sameN = rc.filter(x => x.paymentType === T).length;
    const iss = [];
    if (r2.ok) iss.push('SECOND_SAME_TYPE_ACCEPTED'); if (!/already taken on this sale/.test(r2.message || r2.error || '')) iss.push('NO_CLEAR_MESSAGE'); if (n2 !== n1) iss.push(`SECOND_SAME_TYPE_SENT ${n1}->${n2}`);
    if (sameN !== 1) iss.push(`SAME_TYPE_RECEIVES x${sameN}`); if (Math.abs(got - due0) > 0.004) iss.push(`AIR POS got ${got} for ${due0}`); if (!(o && o.done) || (await L.completesFor(A)) !== 1) iss.push('NOT_COMPLETED_ONCE');
    const res = iss.length ? 'FAIL' : 'PASS'; if (iss.length) bad++; console.log(res, seed, T, FM, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: 'mny109a', name: `second same-type tender refused [type ${T}, first reply ${FM}]`, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { bad++; console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: 'mny109a', name: `same-type [${T} ${FM}]`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } process.exit(bad ? 1 : 0); })();

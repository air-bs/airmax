'use strict';
// 1.0.9-local.2 (c): exchange (return the $1.50 gift bag, buy the $10.80 candy). The return is recorded first; the $1.50
// credit must stay on the sale even when the payment that carries it fails, so the customer pays $9.30, never $10.80.
// T = 10 (cash: one cash payment carries credit + cash) | 50 (check: the credit goes in as cash first). FM = fault on the
// first RetailOrderReceiveBegin (none | fail | done500 | lost). The done screen must show the credit and the real cash.
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', T = Number(process.env.T || 10), FM = process.env.FM || 'fail', SEED = Number(process.env.BASE || 19300000);
(async () => { const log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG); let bad = 0;
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); if (T === 50) log.push('member ' + C.short(await R.post('member-attach', { number: '5550100' })));
    await R.post('return-toggle', { on: true }); await R.post('scan', { code: '1004' }); await R.post('return-toggle', { on: false }); await R.post('scan', { code: '1001' });
    s = await R.state(); const A = s.order.id; const ps = await R.post('pay-start'); if (!ps.ok) throw new Error('pay-start ' + ps.message);
    if (FM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveBegin', mode: FM, n: 1 });
    const shown = [], netShown = []; let r = null, done = null;
    for (let i = 0; i < 4 && !done; i++) { s = await R.state(); if (s.completed && s.completed.orderId === A) { done = s.completed.result; break; }
      const left = s.pay ? s.pay.remaining : null; shown.push(left); netShown.push(s.pay ? s.pay.net : null);
      r = await R.post('pay-tender', T === 10 ? { type: 10, tendered: 20, stockOk: true } : { type: 50, amount: left, checkNumber: '2001', stockOk: true }, 90000);
      log.push(`press ${i + 1} (screen says ${left} left, Due ${netShown[i]}): ` + C.short(r)); await L.sim('/faults-clear', { reg: REG }); if (r.completed) done = r; }
    await L.sleep(800); s = await R.state(); if (!done && s.completed && s.completed.orderId === A) done = s.completed.result;
    const o = await L.sim('/order', { id: A }); const rc = (o && o.rcv || []).filter(x => x.status === 20); const got = L.r2(rc.reduce((a, x) => a + x.amount, 0));
    const cashR = rc.filter(x => x.paymentType === 10), iss = [];
    if (shown.some(x => Math.abs(x - 9.3) > 0.004)) iss.push('screen said left ' + shown.join(','));
    if (netShown.some(x => x != null && Math.abs(x - 9.3) > 0.004)) iss.push('Due shown ' + netShown.join(','));
    if (Math.abs(got - 10.8) > 0.004) iss.push(`AIR POS got ${got} for 10.80`);
    if (cashR.length !== 1) iss.push('cash receives x' + cashR.length);
    if (!(o && o.done) || (await L.completesFor(A)) !== 1) iss.push('NOT_COMPLETED_ONCE');
    if (T === 50 && rc.filter(x => x.paymentType === 50).reduce((a, x) => a + x.amount, 0) > 9.304) iss.push('CUSTOMER_OVERCHARGED check ' + rc.filter(x => x.paymentType === 50).map(x => x.amount).join('+'));
    if (!done) iss.push('no done screen'); else {
      const tl = (done.tenders || []).map(t => `${t.name} ${t.amount}${t.receiveAmount ? '/' + t.receiveAmount : ''}`).join(', '); log.push('done screen: Total ' + done.due + ' | ' + tl + ' | change ' + done.change);
      const ex = (done.tenders || []).find(t => t.name === 'Exchange credit'); if (!ex || Math.abs(ex.amount - 1.5) > 0.004) iss.push('done screen has no Exchange credit 1.50');
      if (T === 10) { const c = (done.tenders || []).find(t => t.name === 'Cash'); if (!c || Math.abs(c.amount - 9.3) > 0.004 || Math.abs((c.receiveAmount || 0) - 20) > 0.004) iss.push('done screen cash not 9.30/20'); if (Math.abs(done.change - 10.7) > 0.004) iss.push('change ' + done.change + ' not 10.70'); } }
    const res = iss.length ? 'FAIL' : 'PASS'; if (iss.length) bad++; console.log(res, SEED, T, FM, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: 'mny109c', name: `exchange credit kept [pay by ${T === 10 ? 'cash' : 'check'}, first payment ${FM}]`, seed: SEED, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { bad++; console.log('INVALID', e.message, log.join(' / ')); L.record({ area: 'mny109c', name: `exchange ${T} ${FM}`, seed: SEED, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); process.exit(bad ? 1 : 0); })();

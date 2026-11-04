'use strict';
// Crash after part of sale A was paid; at restart AIR POS answers RetailOrderGet with an error reply (http500/garbage/expire) instead of no reply.
// Does recovery forget the payment ("Nothing was paid yet") so the cashier collects the full amount again?
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R26', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18310000), GM = process.env.GM || 'http500', PT = process.env.PT || 'cash';
const brief = s => `cart=${(s.cart || []).length} oid=${s.order && s.order.id.slice(0, 8)} due=${s.pay ? s.pay.remaining : s.totals && s.totals.due} paid=${s.pay ? JSON.stringify((s.pay.tenders || []).map(t => t.amount)) : '-'} notice=${s.notice ? String(s.notice.message).slice(0, 140) : ''}`;
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; let pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.scan('1002'); await R.scan('1004'); s = await R.state(); const A = s.order.id; await R.post('pay-start'); s = await R.state(); const due0 = s.pay.remaining;
    log.push(`A due ${due0}; part ${PT} 2.00 ` + C.short(await R.post('pay-tender', PT === 'card' ? { type: 20, amount: 2, stockOk: true } : { type: 10, amount: 2, tendered: 2, stockOk: true }))); await L.sleep(1500); s = await R.state(); log.push('before crash ' + brief(s));
    L.kill(pid, 'SIGKILL'); await L.sleep(800); await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 1 }); pid = await L.startReg(REG, { wipe: false }); await R.login(); await L.sleep(1500);
    s = await R.state(); log.push(`after restart (Get ${GM}): ` + brief(s)); await L.sim('/faults-clear', { reg: REG });
    if (s.notice && /cannot be reached|did not give a clear answer/.test(s.notice.message)) { await L.sleep(25000); s = await R.state(); log.push('after the automatic recheck: ' + brief(s)); }
    const onA = s.order && s.order.id === A; await R.post('pay-start'); s = await R.state(); const due1 = s.pay ? s.pay.remaining : s.totals.due; log.push('app asks for ' + due1);
    log.push('cashier collects it in cash ' + C.short(await R.post('pay-tender', { type: 10, amount: due1, tendered: due1, stockOk: true }))); await L.sleep(1500); s = await R.state(); log.push('end ' + brief(s));
    const o = await L.sim('/order', { id: A }); const got = o ? L.r2((o.rcv || []).filter(x => x.status === 20).reduce((a, x) => a + x.amount, 0)) : 0; const cpl = await L.completesFor(A);
    log.push(`AIR POS sale A: received $${got} for due $${due0}, completes ${cpl}`);
    log.push('AIR POS receives ' + JSON.stringify((o && o.rcv || []).map(x => [x.paymentType, x.amount, x.status]))); const handed = L.r2(2 + due1); log.push(`customer handed over $${handed} in total`);
    const iss = []; if (handed > due0 + 0.009) iss.push(`CUSTOMER_PAID_TWICE: customer paid $${handed} for a $${due0} sale (app asked for the full amount again after $2.00 was taken)`); if (got > due0 + 0.009) iss.push(`OVERCHARGED $${L.r2(got - due0)}: AIR POS received $${got} on a $${due0} sale (the $2.00 paid before the crash was forgotten)`);
    if (/Nothing was paid yet/.test(log.join(' ')) ) iss.push('SAID_NOTHING_PAID although $2.00 was received');
    if (!onA) iss.push('sale A not restored');
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, seed, GM, PT, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: '18-chaos', name: `crash after part payment, recovery gets an error reply [Get ${GM}, ${PT}]`, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '18-chaos', name: `crash after part payment, recovery gets an error reply [Get ${GM}, ${PT}]`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

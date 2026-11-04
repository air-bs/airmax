'use strict';
// Session expires while a terminal card payment is waiting for the customer. What happens to the open terminal payment after re-login?
// Then the customer taps (fake terminal approves on the next check). Is the money tied to a sale on screen?
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18300000), WHERE = process.env.WHERE || 'ReceiveCheck';
const brief = s => `loggedIn=${s.loggedIn} cart=${(s.cart || []).length} oid=${s.order && s.order.id.slice(0, 8)} card=${s.pay && s.pay.card ? s.pay.card.status : '-'} paid=${s.pay ? JSON.stringify((s.pay.tenders || []).map(t => t.amount)) : '-'} notice=${s.notice ? String(s.notice.message).slice(0, 140) : ''}`;
const rcvs = async id => { const o = await L.sim('/order', { id }); return o ? (o.rcv || []).map(r => ({ st: r.status, amt: r.amount, t: r.paymentType, ch: r.checks })) : []; };
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'poll', polls: 100000, outcome: 'approve' });
    await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 }); await R.post('new-sale'); await R.scan('1002');
    s = await R.state(); const A = s.order.id; await R.post('pay-start'); s = await R.state(); const due = s.pay ? s.pay.remaining : s.totals.due;
    log.push('card ' + due + ' ' + C.short(await R.post('pay-tender', { type: 20, amount: due, stockOk: true }))); await L.sleep(2500);
    await L.sim('/fault', { reg: REG, path: WHERE, mode: 'expire', n: 1 }); let t0 = Date.now(); while (Date.now() - t0 < 20000) { s = await R.state(); if (!s.loggedIn) break; await L.sleep(300); }
    log.push('after expiry: ' + brief(s) + ' rcv ' + JSON.stringify(await rcvs(A))); await L.sim('/faults-clear', { reg: REG }); if (process.env.GETF) { await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: process.env.GETF, n: Number(process.env.GETN || 2) }); log.push('RetailOrderGet ' + process.env.GETF + ' x' + (process.env.GETN || 2) + ' at re-login'); }
    await R.login(); await L.sleep(1500); s = await R.state(); log.push('after re-login: ' + brief(s));
    for (let i = 0; i < 3 && !s.loggedIn; i++) { await L.sleep(1000); log.push('logged out again, cashier logs in ' + C.short(await R.login())); await L.sleep(1500); s = await R.state(); log.push('after login: ' + brief(s)); } // GETF=expire logs the register out again
    await L.sleep(15000); const before = await rcvs(A); s = await R.state(); log.push('15 s later: ' + brief(s) + ' rcv ' + JSON.stringify(before));
    if (process.env.RETAKE) { await L.sim('/term', { reg: REG, mode: 'poll', polls: 2, outcome: 'approve' }); await R.post('pay-start'); s = await R.state(); const d2 = s.pay ? s.pay.remaining : s.totals.due; log.push('cashier takes the card again ' + d2 + ' ' + C.short(await R.post('pay-tender', { type: 20, amount: d2, stockOk: true }))); await L.sleep(6000); s = await R.state(); log.push('after retake: ' + brief(s) + ' rcv ' + JSON.stringify(await rcvs(A))); }
    await L.sim('/term', { reg: REG, mode: 'poll', polls: 0, outcome: 'approve' }); log.push('customer taps the card now');
    await L.sleep(20000); const after = await rcvs(A); s = await R.state(); log.push('20 s later: ' + brief(s) + ' rcv ' + JSON.stringify(after));
    const paidA = L.r2(after.filter(r => r.st === 20).reduce((a, r) => a + r.amt, 0)), open = after.filter(r => r.st === 10).length;
    const onA = s.order && s.order.id === A, shownPaid = s.pay ? L.r2((s.pay.tenders || []).reduce((a, t) => a + t.amount, 0)) : 0;
    const doneA = await L.completesFor(A); log.push('sale A completes on AIR POS ' + doneA); const iss = [];
    if (open && !(s.pay && s.pay.card && s.pay.card.status === 'waiting')) iss.push(`OPEN_TERMINAL_PAYMENT_ABANDONED x${open} (still open on AIR POS, app not waiting on it, never checked again: checks ${JSON.stringify(after.map(r => r.ch))} vs ${JSON.stringify(before.map(r => r.ch))})`);
    if (paidA > 0 && !doneA && !(onA && shownPaid >= paidA) && !(s.notice && /paid|received|\$/i.test(s.notice.message))) iss.push(`ORPHANED_CARD $${paidA}`);
    if (!onA && !doneA) iss.push('SALE_GONE from screen after re-login (order ' + (s.order && s.order.id.slice(0, 8)) + ')');
    if (doneA > 1) iss.push('DOUBLE_COMPLETE x' + doneA); if (after.filter(r => r.st === 20).length > 1) iss.push(`CHARGED_TWICE: ${after.filter(r => r.st === 20).length} approved card receives on sale A ($${paidA}, due ${due})`); const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, seed, WHERE, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: '18-chaos', name: `session expires while terminal card waits [${WHERE}${process.env.GETF ? '+Get ' + process.env.GETF : ''}${process.env.RETAKE ? '+cashier retakes card' : ''}]`, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '18-chaos', name: `session expires while terminal card waits [${WHERE}${process.env.GETF ? '+Get ' + process.env.GETF : ''}${process.env.RETAKE ? '+cashier retakes card' : ''}]`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

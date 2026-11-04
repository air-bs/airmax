'use strict';
// 1.0.9-local.7 bug 3 (Stress Tester area 3 'midbegin-card-poll'): Air Register is killed while it starts a terminal card payment
// (ReceiveBegin slow, 2.5 s; AIR POS opens the terminal payment after the kill). After restart + login, is the open terminal payment
// checked (and resumed or cancelled) instead of being left open on AIR POS while the screen says "nothing was paid yet"?
// OUT = approve (the customer taps after restart) | never (the terminal keeps waiting; the cashier presses Cancel card, then pays cash)
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 19300000), OUT = process.env.OUT || 'approve', AT = process.env.AT || 'begin'; // AT=waiting: killed after the card is already waiting on the terminal (bug 1)
const brief = s => `cart=${(s.cart || []).length} oid=${s.order && s.order.id.slice(0, 8)} card=${s.pay && s.pay.card ? s.pay.card.status : '-'} paid=${s.pay ? JSON.stringify((s.pay.tenders || []).map(t => [t.amount, t.status])) : '-'} notice=${s.notice ? String(s.notice.message).slice(0, 160) : ''}`;
const rcvs = async id => { const o = await L.sim('/order', { id }); return o ? (o.rcv || []).map(r => [r.paymentType, r.amount, r.status]) : []; };
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; let pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG); const name = `killed while the terminal card ${AT === 'waiting' ? 'waits' : 'starts'} [${OUT}]`;
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'poll', polls: OUT === 'never' ? 100000 : (AT === 'waiting' ? 6 : 2), outcome: OUT === 'never' ? 'never' : 'approve' });
    await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.scan('1002'); await R.scan('1004'); s = await R.state(); const A = s.order.id; await R.post('pay-start'); s = await R.state(); const due = s.pay.remaining;
    if (AT !== 'waiting') await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveBegin', mode: 'slow', ms: 2500, n: 1 });
    const inflight = R.post('pay-tender', { type: 20, amount: due, stockOk: true }, 10000).catch(e => ({ ok: false, message: 'killed: ' + e.message }));
    if (AT === 'waiting') { log.push('tender ' + C.short(await inflight)); s = await R.state(); log.push('before kill: ' + brief(s)); await L.sleep(1200); } else await L.sleep(900);
    L.kill(pid, 'SIGKILL'); log.push('killed; inflight ' + C.short(await inflight)); await L.sleep(4200); log.push('AIR POS after the kill ' + JSON.stringify(await rcvs(A)));
    pid = await L.startReg(REG, { wipe: false }); log.push('login ' + C.short(await R.login())); await L.sleep(1500); s = await R.state(); log.push('after restart: ' + brief(s));
    const notice = s.notice ? s.notice.message : '';
    if (OUT === 'never') { await L.sleep(3000); s = await R.state(); log.push('3 s later: ' + brief(s)); if (s.pay && s.pay.card && s.pay.card.status === 'waiting') log.push('cashier presses Cancel card: ' + C.short(await R.post('card-cancel'))); }
    else { for (let i = 0; i < 20; i++) { s = await R.state(); if (!s.pay || !s.pay.card || s.pay.card.status !== 'waiting') break; await L.sleep(500); } log.push('after waiting: ' + brief(s)); }
    let o = await L.sim('/order', { id: A });
    if (!(o && o.done) && s.order && s.order.id === A) { const out = await C.settle(R, ['cash'], { log }); log.push('settle ' + (out.ok ? 'ok' : out.why)); }
    await L.sleep(1000); o = await L.sim('/order', { id: A }); const rc = await rcvs(A); s = await R.state(); log.push('end ' + brief(s) + ' AIR POS ' + JSON.stringify(rc));
    const v = await L.orderCheck(A, { done: true }); const iss = [...v.issues]; const cpl = await L.completesFor(A);
    const open = rc.filter(x => x[2] === 10).length; if (open) iss.push(`OPEN_RECEIVE_LEFT x${open} (a terminal payment is still open on AIR POS that the sale does not know about)`);
    if (/nothing was paid yet/i.test(notice) && JSON.stringify(log).includes(',10]')) iss.push('SAID_NOTHING_PAID while a terminal payment was open');
    if (cpl !== 1) iss.push('completes ' + cpl);
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, seed, OUT, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: AT === 'waiting' ? 'local7-bug1' : 'local7-bug3', name, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: AT === 'waiting' ? 'local7-bug1' : 'local7-bug3', name, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

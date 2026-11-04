'use strict';
// 1.0.9-local.7 bug 1 (Stress Tester CRITICAL 1c, "rings it up again" form): sale A is part-paid ($2.00), then Air Register crashes
// (TRIG=crash) or the session expires (TRIG=expire). At restart / re-login the check of sale A gets an unclear reply (GM = garbage |
// http500), so A is not on screen yet. The cashier rings the same items again as a new sale and takes the full amount; later the
// recheck brings sale A back and the cashier finishes what the screen asks. Oracle: the customer pays the sale total once, not more.
const L = require('./lib'), C = require('./cashier'); const PENDGET = process.env.PENDGET || 'ok';
const REG = process.env.REG || 'R5', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 19500000), TRIG = process.env.TRIG || 'crash', GM = process.env.GM || 'garbage', PT = process.env.PT || 'cash';
const brief = s => `loggedIn=${s.loggedIn} cart=${(s.cart || []).length} oid=${s.order && s.order.id.slice(0, 8)} pay=${s.pay ? JSON.stringify((s.pay.tenders || []).map(t => t.amount)) : '-'} notice=${s.notice ? String(s.notice.message).slice(0, 120) : ''}`;
const paidOn = async id => { const o = id && await L.sim('/order', { id }); return o ? L.r2((o.rcv || []).filter(x => x.status === 20).reduce((a, x) => a + x.amount, 0)) : 0; };
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; let pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG); const name = `sale rung again while the earlier one is checked [${TRIG}+${GM}+${PT}${PENDGET !== 'ok' ? '+pending Get ' + PENDGET : ''}]`;
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); await L.sim('/pending-get', { reg: REG, mode: PENDGET }); /* nullref = real AIR POS's reply to RetailOrderGet on a Pending order with payments */
    await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.scan('1004'); await R.scan('1001'); await R.post('pay-start'); s = await R.state(); const A = s.order.id, total = s.pay.remaining;
    log.push(`A ${PT} 2.00 ` + C.short(await R.post('pay-tender', PT === 'card' ? { type: 20, amount: 2, stockOk: true } : { type: 10, amount: 2, tendered: 2 }))); await L.sleep(800);
    if (TRIG === 'crash') { L.kill(pid, 'SIGKILL'); await L.sleep(800); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 2 }); pid = await L.startReg(REG, { wipe: false }); log.push('login ' + C.short(await R.login())); }
    else { await L.sim('/fault', { reg: REG, path: 'RetailOrderPromotionGet', mode: 'expire', n: 1 }); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 2 }); log.push('next tender (session expires on the price check) ' + C.short(await R.post('pay-tender', { type: 50, amount: 1, checkNumber: '101' }).catch(e => ({ ok: false, message: e.message }))));
      for (let i = 0; i < 3; i++) { s = await R.state(); if (s.loggedIn) break; log.push('login ' + C.short(await R.login())); } }
    await L.sleep(1000); s = await R.state(); log.push('after: ' + brief(s));
    const shownA = !!(s.order && s.order.id === A && (s.cart || []).length); if (shownA && PENDGET !== 'ok') log.push('sale A shown directly');
    else if (shownA) { log.push('sale A shown directly'); console.log('INVALID', seed, log.join(' / ')); L.record({ area: 'local7-bug1', name, seed, reg: REG, result: 'INVALID', why: 'trigger did not hide sale A | ' + log.join(' / ') }); L.kill(pid, 'SIGTERM'); await L.sleep(1500); continue; }
    // the cashier rings the same items again and asks for the full amount
    let B = null, refused = false; if (!shownA) { const r1 = await R.scan('1004'); const r2 = await R.scan('1001'); log.push('ring again ' + C.short(r1) + ' / ' + C.short(r2)); s = await R.state(); B = s.order && s.order.id !== A ? s.order.id : null;
    refused = !!(r1 && r1.ok === false && r1.recoveryPending);
    if (!refused && (s.cart || []).length) { const out = await C.settle(R, ['cash'], { log, maxTries: 8 }); log.push('B settle ' + (out.ok ? 'ok' : out.why)); }
    if (PENDGET === 'ok') await L.sim('/faults-clear', { reg: REG }); await L.sleep(32000); } /* PENDGET=nullref: AIR POS keeps refusing the order check, as the real one does */ s = await R.state(); log.push('after the recheck: ' + brief(s));
    if (s.order && s.order.id === A && (s.cart || []).length && !(await L.sim('/order', { id: A }) || {}).done) { const out = await C.settle(R, [PT === 'cash' ? 'card' : 'cash'], { log, maxTries: 8 }); log.push('A settle ' + (out.ok ? 'ok' : out.why)); }
    await L.sleep(800); const pA = await paidOn(A), pB = B ? await paidOn(B) : 0; s = await R.state(); log.push(`end ${brief(s)} | AIR POS A paid ${pA} of ${total}, B paid ${pB}`);
    const iss = []; if (L.r2(pA + pB) > total + 0.005) iss.push(`DOUBLE_CHARGE: customer paid $${L.r2(pA + pB)} for a $${total} sale (A $${pA} + rung again $${pB})`);
    if (L.r2(pA + pB) < total - 0.005) iss.push(`UNDERPAID: $${L.r2(pA + pB)} of $${total}`);
    const oA = await L.sim('/order', { id: A }); if (!(oA && oA.done) && pA > 0) iss.push('SALE_A_NOT_FINISHED with $' + pA + ' on it');
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, seed, TRIG, GM, PT, refused ? 'ring-again refused' : '', '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: 'local7-bug1', name, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: 'local7-bug1', name, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

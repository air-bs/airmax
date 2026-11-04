'use strict';
// Background recovery replaces the sale being rung now. TRIG=expire (session expires twice + RetailOrderGet lost) or TRIG=crash
// (kill -9 with sale A on screen, restart while RetailOrderGet is down). Then AIR POS comes back, the cashier rings sale B
// (PAY=1: and takes $1.00 cash on it), and we watch for 30 s.
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18220000), TRIG = process.env.TRIG || 'crash', PAY = process.env.PAY === '1';
const brief = s => `loggedIn=${s.loggedIn} cart=${(s.cart || []).length} oid=${s.order && s.order.id.slice(0, 8)} pay=${s.pay ? JSON.stringify((s.pay.tenders || []).map(t => t.amount)) : '-'} notice=${s.notice ? String(s.notice.message).slice(0, 100) : ''}`;
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k; const log = []; let pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.scan('1004'); await R.scan('1001'); s = await R.state(); const A = s.order.id; log.push('sale A ' + brief(s));
    if (TRIG === 'expire') { for (const [p, m, n, a] of [['RetailOrderAuthorizationCheck', 'garbage', 2, 0], ['RetailOrderGet', 'lost', 1, 1], ['RetailOrderPromotionGet', 'expire', 2, 1]]) await L.sim('/fault', { reg: REG, path: p, mode: m, n, after: a });
      log.push('tender ' + C.short(await R.post('pay-tender', { type: 10, amount: 1, tendered: 1 }))); for (let i = 0; i < 3; i++) { s = await R.state(); if (s.loggedIn) break; await R.login(); } }
    else { await L.sleep(1200); L.kill(pid, 'SIGKILL'); await L.sleep(800); await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: 'down', n: 1 }); pid = await L.startReg(REG, { wipe: false }); await R.login(); }
    s = await R.state(); log.push('after login: ' + brief(s)); await L.sim('/faults-clear', { reg: REG });
    if ((s.cart || []).length) { log.push('sale A shown directly'); console.log('INVALID', seed, log.join(' / ')); L.record({ area: '18-chaos', name: `recovery replaces sale being rung [${TRIG}${PAY ? '+paid' : ''}]`, seed, reg: REG, result: 'INVALID', why: 'trigger did not hide sale A | ' + log.join(' / ') }); L.kill(pid, 'SIGTERM'); await L.sleep(1500); continue; }
    const sc = await R.scan('1003'); s = await R.state(); const B = s.order.id; log.push('rang sale B ' + brief(s) + (sc && sc.ok === false ? ' scan refused: ' + C.short(sc) : ''));
    const held = sc && sc.ok === false && sc.recoveryPending; // 1.0.9-local.7: the register refuses a new sale until the earlier one is checked
    const q = await L.seq();
    if (PAY) { await R.post('pay-start'); if (process.env.PAYTYPE === 'card') { await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); log.push('B card 1.00 ' + C.short(await R.post('pay-tender', { type: 20, amount: 1 }))); await L.sleep(1500); } else log.push('B cash 1.00 ' + C.short(await R.post('pay-tender', { type: 10, amount: 1, tendered: 1 }))); s = await R.state(); log.push('B after pay ' + brief(s)); }
    await L.sleep(30000); s = await R.state(); log.push('30 s later: ' + brief(s));
    const ob = await L.sim('/order', { id: B }); const bPaid = ob ? L.r2((ob.rcv || []).filter(x => x.status === 20).reduce((a, x) => a + x.amount, 0)) : 0;
    const iss = []; const onB = s.order && s.order.id === B && (s.cart || []).length === 1;
    if (held) { // B was never rung: the earlier sale A must be back on screen, and nothing may have been taken on B
      if (!(s.order && s.order.id === A && (s.cart || []).length === 2)) iss.push('SALE_A_NOT_BACK after the check (' + brief(s) + ')');
      if (bPaid > 0) iss.push(`ORPHANED_PAYMENT: $${bPaid} taken on order ${B.slice(0, 8)} although it was refused`);
    } else if (!onB) iss.push(`SALE_B_REPLACED by ${s.order && s.order.id === A ? 'sale A' : 'order ' + (s.order && s.order.id.slice(0, 8))} (${(s.cart || []).length} lines)`);
    if (!onB && bPaid > 0) iss.push(`ORPHANED_PAYMENT: $${bPaid} taken on sale B is on AIR POS but sale B is gone from the screen`);
    if (s.pay && (s.pay.tenders || []).length && s.order.id !== B && bPaid > 0) iss.push('B payment shown under another sale');
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, REG, seed, TRIG, PAY ? 'paid' : '', '|', iss.join('; '), '|', log.join(' / '), '| B on AIR POS paid', bPaid);
    L.record({ area: '18-chaos', name: `recovery replaces sale being rung [${TRIG}${PAY ? '+paid' : ''}]`, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') + ' | B paid on AIR POS ' + bPaid });
  } catch (e) { console.log('INVALID', seed, e.message); L.record({ area: '18-chaos', name: `recovery replaces sale being rung [${TRIG}]`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

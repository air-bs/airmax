'use strict';
// "Check AIR POS again" (payRecheck) gets an error reply after the sale is fully paid but Complete failed.
const L = require('./lib');
const REG = process.env.REG || 'R22', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18410000), GM = process.env.GM || 'garbage', PT = Number(process.env.PT || 20);
const m = r => (r.ok ? 'ok ' : 'ERR ') + String(r.message || r.error || '').slice(0, 160);
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.scan('1002'); await R.scan('1004'); s = await R.state(); const A = s.order.id; await R.post('pay-start'); s = await R.state(); const due = s.pay.remaining;
    await L.sim('/fault', { reg: REG, path: 'RetailOrderComplete', mode: 'fail', n: 3 });
    log.push(`pay ${PT} ${due}: ` + m(await R.post('pay-tender', PT === 20 ? { type: 20, amount: due, stockOk: true } : { type: 10, amount: due, tendered: due, stockOk: true }))); await L.sleep(1500);
    await L.sim('/faults-clear', { reg: REG }); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 1 });
    const c = await R.post('pay-recheck', {}, 60000); log.push(`Check AIR POS again (Get ${GM}): ` + m(c)); await L.sim('/faults-clear', { reg: REG });
    s = await R.state(); const rem = s.pay ? s.pay.remaining : null; log.push('screen still owes ' + rem); let extra = 0;
    if (!c.ok && /take the payment again/.test(c.error || c.message || '') && rem > 0) { extra = rem; log.push('cashier takes it again in cash: ' + m(await R.post('pay-tender', { type: 10, amount: rem, tendered: rem, stockOk: true }))); }
    else if (!c.ok && /take the payment again/.test(c.error || c.message || '')) { log.push('message says take the payment again but nothing is owed on screen; cashier presses Finish: ' + m(await R.post('pay-recheck', {}, 60000))); }
    await L.sleep(1500); const o = await L.sim('/order', { id: A }); const got = o ? L.r2((o.rcv || []).filter(x => x.status === 20).reduce((a, x) => a + x.amount, 0)) : 0; log.push(`AIR POS received $${got} for due $${due}, completes ${await L.completesFor(A)}`);
    const said = /take the payment again/.test(c.error || c.message || ''); const res = (got > due + 0.009 || extra > 0) ? 'FAIL' : said ? 'FAIL' : 'PASS';
    const why = (got > due + 0.009 || extra > 0 ? `CUSTOMER_PAID_TWICE handed $${L.r2(due + extra)} for $${due} | ` : said ? 'MISLEADING_MESSAGE ("no record of this sale yet. Nothing was paid there; take the payment again" although AIR POS holds the payment) | ' : '') + log.join(' / ');
    console.log(res, seed, PT, GM, why); L.record({ area: '13-timeouts', name: `pay recheck after Complete fail, Get ${GM} (type ${PT})`, seed, reg: REG, result: res, why });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '13-timeouts', name: `pay recheck Get ${GM}`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

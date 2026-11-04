'use strict';
// Returns: AIR POS records the return but the reply drops (lost), and the "was it recorded?" check (return receipt PDF) gets an error reply.
const L = require('./lib');
const REG = process.env.REG || 'R35', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18390000), GM = process.env.GM || 'garbage', KIND = process.env.KIND || 'quick', CMODE = process.env.CMODE || 'lost';
const msg = r => (r.ok ? 'ok ' : 'ERR ') + String(r.message || r.error || '').slice(0, 170);
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    const q = await L.seq(); let act, cpath;
    if (KIND === 'quick') { await R.post('return-toggle', { on: true }); await R.post('scan', { code: '1004' }); cpath = 'NonOrderReturnOrderCreate'; act = () => R.post('mix-refund', { type: 10 }, 90000); }
    else if (KIND === 'exchange') { await R.post('return-toggle', { on: true }); await R.post('scan', { code: '1004' }); await R.post('return-toggle', { on: false }); await R.post('scan', { code: '1001' }); await R.post('scan', { code: '1002' }); const ps = await R.post('pay-start'); if (!ps.ok) throw new Error('pay-start ' + ps.message); cpath = 'NonOrderReturnOrderCreate'; act = async () => { const st = await R.state(); return R.post('pay-tender', { type: 10, tendered: Math.max(st.pay ? st.pay.remaining : 0, 0.01), stockOk: true }, 90000); }; }
    else if (KIND === 'noreceipt') { await R.post('return-start', { kind: 'noreceipt' }); await R.post('scan', { code: '1001' }); cpath = 'NonOrderReturnOrderCreate'; act = () => R.post('return-confirm', {}, 90000); }
    else { await R.post('return-start', { kind: 'receipt', orderId: 'o-ret-walkin' }); await R.post('scan', { code: '1001' }); cpath = 'RetailReturnOrderCreate'; act = () => R.post('return-confirm', {}, 90000); }
    await L.sim('/fault', { reg: REG, path: cpath, mode: CMODE, n: 1 }); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailReturnOrderBillGet', mode: GM, n: 1 }); if (process.env.RGM) await L.sim('/fault', { reg: REG, path: 'RetailReturnOrderGet', mode: process.env.RGM, n: 1 });
    const a = await act(); await L.sim('/faults-clear', { reg: REG }); log.push('1st: ' + msg(a));
    if (!a.ok && /nothing was refunded|Press Retry/i.test(a.error || a.message || '') && !/Do not hand out money/i.test(a.error || a.message || '')) { const b = await act(); log.push('cashier presses Retry: ' + msg(b)); }
    const n = (await L.ledger(q, REG)).filter(e => e.path === 'ReturnCreate' && e.success).length; log.push('returns recorded on AIR POS: ' + n);
    const res = n > 1 ? 'FAIL' : 'PASS'; const why = (n > 1 ? `DOUBLE_REFUND x${n} after "no record of this refund, so nothing was refunded" | ` : '') + log.join(' / ');
    console.log(res, seed, KIND, GM, why); L.record({ area: '13-timeouts', name: `${KIND} return: reply ${CMODE} + receipt check ${GM}`, seed, reg: REG, result: res, why });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '13-timeouts', name: `${KIND} return: reply ${CMODE} + receipt check ${GM}`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

'use strict';
// Refund to the customer's store account (paymentType 11) when AIR POS records the return but the reply drops (lost)
// and the "was it recorded?" check (return receipt) gets GM. Cashier presses Retry only when the screen says nothing was refunded.
// Oracle: successful ReturnCreate count and the sum credited to the account (type 11) on AIR POS.
const L = require('./lib');
const REG = process.env.REG || 'R36', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18520000), GM = process.env.GM || 'garbage', KIND = process.env.KIND || 'receipt', LOST = process.env.LOST !== '0';
const msg = r => (r.ok ? 'ok ' : 'ERR ') + String(r.message || r.error || '').slice(0, 170);
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    const q = await L.seq(); let act, cpath;
    if (KIND === 'quick') { const m = await R.post('member-attach', { number: '5550100' }); if (!m.ok) throw new Error('attach ' + m.message); await R.post('return-toggle', { on: true }); await R.post('scan', { code: '1004' }); cpath = 'NonOrderReturnOrderCreate'; act = () => R.post('mix-refund', { type: 11 }, 90000); }
    else { const st = await R.post('return-start', { kind: 'receipt', orderId: 'o-ret-acct' }); if (!st.ok) throw new Error('return-start ' + st.message); await R.post('scan', { code: '1001' }); const ra = await R.post('return-account', { on: true }); log.push('to account: ' + msg(ra)); if (!ra.ok) throw new Error('return-account ' + ra.message); cpath = 'RetailReturnOrderCreate'; act = () => R.post('return-confirm', {}, 90000); }
    if (LOST) await L.sim('/fault', { reg: REG, path: cpath, mode: process.env.CMODE || 'lost', n: 1 }); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailReturnOrderBillGet', mode: GM, n: 1 }); if (process.env.RGM) await L.sim('/fault', { reg: REG, path: 'RetailReturnOrderGet', mode: process.env.RGM, n: 1 });
    const a = await act(); await L.sim('/faults-clear', { reg: REG }); log.push('1st: ' + msg(a));
    if (!a.ok && /nothing was refunded|Press Retry/i.test(a.error || a.message || '') && !/Do not hand out money/i.test(a.error || a.message || '')) { const b = await act(); log.push('cashier presses Retry: ' + msg(b)); }
    const rc = (await L.ledger(q, REG)).filter(e => e.path === 'ReturnCreate' && e.success); const acct = Math.round(rc.flatMap(e => e.pays || []).filter(p => p.t === 11).reduce((x, p) => x + p.a, 0) * 100) / 100;
    log.push(`returns recorded on AIR POS: ${rc.length}; credited to account $${acct}; pay types ${JSON.stringify(rc.map(e => (e.pays || []).map(p => p.t)))}`);
    const iss = []; if (rc.length > 1) iss.push(`DOUBLE_REFUND x${rc.length} ($${acct} to account) after "nothing was refunded"`); if (rc.length && !rc.some(e => (e.pays || []).some(p => p.t === 11))) iss.push('REFUND_NOT_TO_ACCOUNT');
    if (!rc.length) iss.push('NO_RETURN_RECORDED');
    const res = iss.length ? 'FAIL' : 'PASS'; const why = iss.join('; ') + ' | ' + log.join(' / ');
    console.log(res, seed, KIND, GM, why); L.record({ area: '13-timeouts', name: `${KIND} return to account: ${LOST ? 'dropped reply' : 'no fault'} + receipt check ${GM}`, seed, reg: REG, result: res, why });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '13-timeouts', name: `${KIND} return to account: receipt check ${GM}`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

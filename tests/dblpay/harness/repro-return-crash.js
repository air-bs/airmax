'use strict';
// Crash while a quick return is being sent (AIR POS records it), then at restart the receipt check answers an error reply.
const L = require('./lib');
const REG = process.env.REG || 'R38', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18400000), GM = process.env.GM || 'garbage';
const note = s => (s.notice ? String(s.notice.message).slice(0, 200) : 'no notice');
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; let pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    const q = await L.seq(); await R.post('return-toggle', { on: true }); await R.post('scan', { code: '1004' });
    await L.sim('/fault', { reg: REG, path: 'NonOrderReturnOrderCreate', mode: 'slow', ms: 4000, n: 1 });
    R.post('mix-refund', { type: 10 }, 90000).catch(() => {}); await L.sleep(1500); L.kill(pid, 'SIGKILL'); await L.sleep(4500);
    const n0 = (await L.ledger(q, REG)).filter(e => e.path === 'ReturnCreate' && e.success).length; log.push('recorded before restart: ' + n0);
    if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailReturnOrderBillGet', mode: GM, n: 1 });
    pid = await L.startReg(REG, { wipe: false }); await R.login(); await L.sleep(2000); s = await R.state(); await L.sim('/faults-clear', { reg: REG }); log.push(`restart notice (check ${GM}): ` + note(s));
    if (s.notice && /Do the return again/.test(s.notice.message)) { await R.post('return-toggle', { on: true }); await R.post('scan', { code: '1004' }); const b = await R.post('mix-refund', { type: 10 }, 90000); log.push('cashier does the return again: ' + (b.ok ? 'ok ' : 'ERR ') + String(b.message || b.error || '').slice(0, 120)); }
    const n = (await L.ledger(q, REG)).filter(e => e.path === 'ReturnCreate' && e.success).length; log.push('returns recorded on AIR POS: ' + n);
    const res = n0 < 1 ? 'INVALID' : n > 1 ? 'FAIL' : 'PASS'; const why = (n0 < 1 ? 'harness: return not recorded before the crash | ' : n > 1 ? `DOUBLE_REFUND x${n} after restart said "AIR POS has no record of it: nothing was refunded. Do the return again" | ` : '') + log.join(' / ');
    console.log(res, seed, GM, why); L.record({ area: '13-timeouts', name: `crash during quick return + restart receipt check ${GM}`, seed, reg: REG, result: res, why });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '13-timeouts', name: `crash during quick return + restart receipt check ${GM}`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

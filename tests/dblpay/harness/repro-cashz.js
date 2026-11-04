'use strict';
// 1.0.9-local.2 (b): a cash pay-in / pay-out or a Z report that AIR POS recorded but answered badly (500, non-JSON,
// dropped, 30 s timeout) or that was cut by a crash must not be recorded twice when the cashier presses again.
// OP = in | out | z. FM = done500 | donegarbage | lost | lost-slow | crash | none. GM = fault on the follow-up check
// (none | http500 | garbage). PRE = http500 makes the drawer-balance read before the move fail.
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', OP = process.env.OP || 'in', FM = process.env.FM || 'done500', GM = process.env.GM || 'none', PRE = process.env.PRE || 'none', SEED = Number(process.env.BASE || 19200000);
const isZ = OP === 'z', act = isZ ? ['z-generate', {}] : ['cash-move', { kind: OP, amount: 20, remark: 'dblpay ' + OP }];
const sendPath = isZ ? 'GenerateStationZRead' : 'RetailCashTransactionAccess', checkPath = isZ ? 'StationZReadReportPaged' : 'RetailCashTransactionGet';
const count = async () => { if (isZ) return (await L.sim('/z')).filter(z => z.reg === REG).length; const g = (await L.sim('/regs'))[REG]; return g.cashTx.length; };
const msg = r => (r && (r.message || r.error)) || JSON.stringify(r);
(async () => { const log = []; let pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG); let bad = 0;
  try { await L.sim('/faults-clear', { reg: REG }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    const n0 = await count(), d0 = (await L.sim('/regs'))[REG].drawer; let r, firstOk = null, preSent = null;
    if (PRE !== 'none') { await L.sim('/fault', { reg: REG, path: 'LastestBalanceGet', mode: PRE, n: 1 }); r = await R.post(act[0], act[1], 60000); preSent = (await count()) - n0; log.push('balance read fails: ' + C.short(r)); firstOk = r.ok; await L.sim('/faults-clear', { reg: REG }); }
    if (FM !== 'none') await L.sim('/fault', { reg: REG, path: sendPath, mode: FM === 'crash' ? 'lost-slow' : FM, n: 1, ms: FM === 'crash' ? 15000 : 33000 });
    if (GM !== 'none') await L.sim('/fault', { reg: REG, path: checkPath, mode: GM, n: 1, after: isZ ? 1 : 0 });
    if (FM === 'crash') { R.post(act[0], act[1], 60000).catch(() => {}); await L.sleep(1500); L.kill(pid, 'SIGKILL'); await L.sleep(3000); pid = await L.startReg(REG, { wipe: false }); await R.login(); s = await R.state(); if (s.mode === 'clockin') log.push('asked to clock in again'); log.push('crashed and restarted'); }
    else { r = await R.post(act[0], act[1], 60000); log.push(`first (${FM}/${GM}): ` + C.short(r)); if (r.ok && FM !== 'none') log.push('first adopted'); }
    await L.sim('/faults-clear', { reg: REG });
    let tries = 0, last = r; if (FM === 'crash' || !(r && r.ok)) { while (tries < 3) { tries++; last = await R.post(act[0], act[1], 60000); log.push(`press again #${tries}: ` + C.short(last)); if (last.ok) break; } }
    const n = (await count()) - n0, d = (await L.sim('/regs'))[REG].drawer, iss = [];
    if (n !== 1) iss.push(`${isZ ? 'Z reports' : 'cash moves'} recorded x${n}`);
    if (!isZ && Math.abs(d - (d0 + (OP === 'out' ? -20 : 20))) > 0.004) iss.push(`drawer ${d0} -> ${d}`);
    if (!(last && last.ok)) iss.push('never confirmed: ' + msg(last));
    if (preSent !== null && (preSent !== 0 || firstOk)) iss.push(`balance read failed but ${firstOk ? 'reported ok' : ''} sent x${preSent}`);
    if (r && !r.ok && /nothing was recorded|nothing was generated/i.test(msg(r)) && n > 0 && FM !== 'none' && preSent === null) iss.push('SAID_NOTHING_RECORDED');
    const res = iss.length ? 'FAIL' : 'PASS'; if (iss.length) bad++; console.log(res, SEED, OP, FM, GM, PRE, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: 'mny109b', name: `no duplicate ${isZ ? 'Z report' : 'pay-' + OP} [send ${FM}, check ${GM}, pre-read ${PRE}]`, seed: SEED, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { bad++; console.log('INVALID', e.message, log.join(' / ')); L.record({ area: 'mny109b', name: `cash/Z ${OP} ${FM}`, seed: SEED, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); process.exit(bad ? 1 : 0); })();

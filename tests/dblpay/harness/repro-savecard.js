'use strict';
// 1.0.9-local.7 bug 4 (Stress Tester MEDIUM 8c, area 10/16): save card, AIR POS saves it but the reply to RetailMmeberCardAddComplete is
// lost / a 500 page / non-JSON / a timeout. Does the app say "did not save" (wrong), and does the cashier's retry save a second copy?
// FM = fault on AddComplete (done500 | lost | donegarbage | lost-slow | down | fail), DD = AIR POS dedupe (none | card), SM = fault mode on
// the card list read right after (optional: the read-back itself fails), RETRY = 1 (default): the cashier saves again when told it failed or is unknown.
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 19400000), FM = process.env.FM || 'done500', DD = process.env.DD || 'none', SM = process.env.SM || '';
const cofCount = async () => (await L.sim('/cof-cards', { member: 'm-sample' })).length;
async function saveCard(R, log) { const b = await R.post('member-card-add-begin', { id: 'm-sample' }); log.push('begin ' + C.short(b)); if (!b.ok) return { begin: b };
  const seti = String(b.clientSecret || '').split('_secret')[0];
  const c = await R.post('member-card-add-complete', { id: 'm-sample', setupIntentId: seti, holderName: 'Test Holder', billAddress: '1 Test St', zipCode: '00000' }, 60000); log.push('complete ' + C.short(c)); return c; }
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const name = `save card: Complete ${FM}${SM ? ' + list read ' + SM : ''}, retry (dedupe=${DD})`;
  await L.sim('/keyed', { reg: REG, mode: 'stripe' }); const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/cof-mode', { dedupe: DD }); await L.sim('/cof-reset', { member: 'm-sample' });
    await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await L.sim('/fault', { reg: REG, path: 'RetailMmeberCardAddComplete', mode: FM, n: 1 }); if (SM) await L.sim('/fault', { reg: REG, path: 'RetailMemberCardSelect', mode: SM, n: 2 });
    const a = await saveCard(R, log); const n1 = await cofCount(); log.push(`AIR POS after 1st: ${n1} saved`); await L.sim('/faults-clear', { reg: REG });
    const iss = []; const m1 = String((a && a.message) || '');
    if (!a.ok && n1 > 0 && /did not save|nothing was saved|not saved/i.test(m1)) iss.push(`MISLEADING "${m1.slice(0, 90)}" but the card WAS saved`);
    if (a.ok && n1 < 1) iss.push('SAID_SAVED but AIR POS has no card');
    if (!a.ok && process.env.RETRY !== '0') { const b = await saveCard(R, log); const mb = String((b && (b.message || (b.begin && b.begin.message))) || ''); if (n1 > 0 && !b.ok && !/already|was saved|may have saved/i.test(mb)) iss.push('retry message unclear: ' + mb.slice(0, 90)); }
    const n = await cofCount(); log.push(`saved cards ${n}`); if (n > 1) iss.push(`DUPLICATE_SAVED_CARD x${n}`); if (n < 1) iss.push('no card saved');
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, seed, FM, DD, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: 'local7-bug4', name, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: 'local7-bug4', name, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

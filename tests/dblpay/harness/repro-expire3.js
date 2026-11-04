'use strict';
// After the double-expire + lost RetailOrderGet, clear all faults and watch for 120 s: does the hidden sale come back? Then: does a
// *newer* sale get replaced by the old one at the next login? Fresh register each round.
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R22', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18200000);
const F = [['RetailOrderAuthorizationCheck', 'garbage', 2, 0], ['RetailOrderGet', 'lost', 1, 1], ['RetailOrderPromotionGet', 'expire', 2, 1]];
const brief = s => `loggedIn=${s.loggedIn} cart=${(s.cart || []).length} oid=${s.order && s.order.id.slice(0, 8)} notice=${s.notice ? String(s.notice.message).slice(0, 90) : ''}`;
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k; const log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.scan('1004'); await R.scan('1001'); s = await R.state(); const A = s.order.id, due = s.totals.due;
    for (const [p, m, n, a] of F) await L.sim('/fault', { reg: REG, path: p, mode: m, n, after: a });
    log.push('tender ' + C.short(await R.post('pay-tender', { type: 10, amount: 1, tendered: 1 })));
    for (let i = 0; i < 3; i++) { s = await R.state(); if (s.loggedIn) break; log.push('login ' + C.short(await R.login())); }
    s = await R.state(); log.push('after logins: ' + brief(s)); const hidden = !(s.order && s.order.id === A && (s.cart || []).length === 2);
    await L.sim('/faults-clear', { reg: REG });
    if (process.env.MODE === 'b') { // cashier sees an empty screen and rings the next customer right away
      await R.scan('1003'); s = await R.state(); const B = s.order.id; log.push('rang sale B ' + brief(s)); await L.sleep(30000); s = await R.state(); log.push('30 s later: ' + brief(s));
      const ledA = (await L.sim('/order', { id: A })), ledB = (await L.sim('/order', { id: B }));
      const iss = []; const onB = s.order && s.order.id === B; if (!onB) iss.push(`SALE_B_REPLACED: the screen switched from sale B to ${s.order && s.order.id === A ? 'old sale A' : 'another order'}; cart now ${(s.cart || []).length} lines`);
      if (onB && !(s.cart || []).some(x => /1003/.test(JSON.stringify(x)))) iss.push('SALE_B_LINES_CHANGED');
      const mergedA = onB && (s.cart || []).length > 1; if (mergedA) iss.push(`MERGED: sale B shows ${(s.cart || []).length} lines (old sale A lines added?)`);
      const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, REG, seed, '|', iss.join('; '), '|', log.join(' / '), '| A on AIR POS', !!ledA, 'B', !!ledB);
      L.record({ area: '18-chaos', name: 'session expires twice + RetailOrderGet lost; cashier rings a new sale during the recheck window', seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
      L.kill(pid, 'SIGTERM'); await L.sleep(1500); continue; }
    let back = false, t0 = Date.now();
    while (Date.now() - t0 < 120000) { s = await R.state(); if (s.order && s.order.id === A && (s.cart || []).length === 2) { back = true; break; } await L.sleep(3000); }
    log.push(`faults cleared, after ${Math.round((Date.now() - t0) / 1000)}s: ` + brief(s) + ` back=${back}`);
    // cashier rings a new sale B (normal thing to do if the screen is empty), then logs out and in again
    let B = null; if (!back) { await R.scan('1003'); s = await R.state(); B = s.order.id; log.push('new sale B ' + brief(s)); await R.post('logout'); await R.login(); s = await R.state(); log.push('after logout/login: ' + brief(s)); }
    const replaced = B && s.order && s.order.id !== B; const iss = []; if (hidden && !back) iss.push(`HIDDEN_SALE: ${2} lines $${due} not shown for 120 s after AIR POS came back`); if (replaced) iss.push(`NEWER_SALE_REPLACED: sale B (${(B || '').slice(0, 8)}) replaced by ${s.order && s.order.id.slice(0, 8)} at login`);
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, REG, seed, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: '18-chaos', name: 'session expires twice + RetailOrderGet lost during recovery: does the sale come back', seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message); L.record({ area: '18-chaos', name: 'session expires twice (recovery)', seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

'use strict';
// 1.0.9-local.2 (d): keyed card (Stripe form). Once Stripe accepted the card, "Cancel card" (and Esc, which presses the same
// button) must not cancel it on AIR POS; before any keyed cancel Air Register asks AIR POS whether it already recorded it.
// CASE = accepted (Stripe OK, AIR POS slow) | accepted-err (and the check errors) | recorded (form still open, AIR POS has it)
//      | open (form open, nothing charged: cancel must still work) | failed-recorded (Stripe said error, AIR POS has it)
//      | race (Stripe accepted, AIR POS records it at once, Cancel pressed at once: the sale must finish once, no second order)
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', CASE = process.env.CASE || 'accepted', SEED = Number(process.env.BASE || 19400000);
(async () => { const log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG); let bad = 0;
  try { await L.sim('/faults-clear', { reg: REG }); const never = CASE === 'accepted' || CASE === 'accepted-err' || CASE === 'open';
    await L.sim('/keyed', { reg: REG, mode: 'stripe', pi: '1', never: never ? '1' : '0' }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.post('scan', { code: '1001' }); s = await R.state(); const A = s.order.id; const q = await L.seq();
    const ps = await R.post('pay-start'); if (!ps.ok) throw new Error('pay-start ' + ps.message);
    const t = await R.post('pay-tender', { type: 30, amount: 10.8, stockOk: true }); log.push('keyed tender: ' + C.short(t)); if (!t.keyed) throw new Error('no keyed form: ' + C.short(t));
    if (CASE === 'race') await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveCheck', mode: 'slow', ms: 1500, n: 3 }); // both checks in flight together
    if (CASE.startsWith('accepted') || CASE === 'race') log.push('Stripe accepted -> ' + C.short(await R.post('keyed-confirmed')));
    if (CASE === 'accepted-err') await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveCheck', mode: 'http500', n: 50 });
    const x = CASE === 'failed-recorded' ? await R.post('keyed-failed', { message: 'network error' }) : await R.post('card-cancel'); log.push((CASE === 'failed-recorded' ? 'keyed-failed: ' : 'Cancel card (Esc): ') + C.short(x));
    const y = CASE.startsWith('accepted') ? await R.post('card-cancel') : null; if (y) log.push('Cancel again: ' + C.short(y));
    await L.sim('/faults-clear', { reg: REG }); if (never && CASE !== 'open') await L.sim('/keyed', { reg: REG, mode: 'stripe', pi: '1', never: '0' }); // AIR POS records it now
    let done = 0; for (let i = 0; i < 30 && CASE !== 'open'; i++) { s = await R.state(); if (s.completed && s.completed.orderId === A) { done = 1; break; } await L.sleep(500); }
    const led = (await L.ledger(q, REG)); const cancels = led.filter(e => e.path === 'ReceiveCancel' && e.success && !e.none).length, comp = await L.completesFor(A), iss = [];
    if (CASE === 'open') { s = await R.state(); if (cancels !== 1 || (s.pay && s.pay.card)) iss.push('cancel did not work on an open form (cancels ' + cancels + ')'); if (comp) iss.push('completed?'); }
    else { if (cancels) iss.push('CHARGED_BUT_CANCELLED: AIR POS receive cancelled x' + cancels); if (comp !== 1 || !done) iss.push('sale not completed once (completes ' + comp + ', done ' + done + ')'); if (CASE.startsWith('accepted') && x.ok) iss.push('cancel was not refused'); if (!CASE.startsWith('accepted') && (!x.ok || /went wrong/.test(x.message || x.error || ''))) iss.push('adopt reply not ok'); }
    const allComp = led.filter(e => e.path === 'OrderComplete' && e.success).length; if (allComp > 1) iss.push('EXTRA_COMPLETE: ' + allComp + ' orders completed on AIR POS for one sale');
    log.push(`AIR POS: cancels ${cancels}, completes ${comp}, all completes ${allComp}`);
    const res = iss.length ? 'FAIL' : 'PASS'; if (iss.length) bad++; console.log(res, SEED, CASE, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: 'mny109d', name: `keyed card cancel [${CASE}]`, seed: SEED, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { bad++; console.log('INVALID', e.message, log.join(' / ')); L.record({ area: 'mny109d', name: `keyed ${CASE}`, seed: SEED, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); process.exit(bad ? 1 : 0); })();

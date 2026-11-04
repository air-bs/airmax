'use strict';
// (A) LOSTGET: a tender's reply is dropped after AIR POS recorded it (ReceiveBegin lost), and the app's follow-up check (RetailOrderGet) gets an error reply.
// (B) EXPIRE: part paid, then the session expires at Complete and the order check at re-login gets an error reply.
const L = require('./lib'), C = require('./cashier'); const PENDGET = process.env.PENDGET || 'ok';
const REG = process.env.REG || 'R30', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18320000), GM = process.env.GM || 'http500', T = Number(process.env.T || 50), KIND = process.env.KIND || 'lostget';
const tb = (t, a) => t === 10 ? { type: 10, amount: a, tendered: a, stockOk: true } : t === 50 ? { type: 50, amount: a, checkNumber: '1001', stockOk: true } : { type: t, amount: a, stockOk: true };
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'instant', outcome: 'approve' }); await L.sim('/pending-get', { reg: REG, mode: PENDGET }); /* nullref = real AIR POS's reply to RetailOrderGet on a Pending order with payments */ await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); if (T === 11) await L.sim('/member-set', { id: 'm-sample', balance: 500 }); if (T === 50 || T === 11) { log.push('member ' + C.short(await R.post('member-attach', { number: '5550100' }))); } await R.scan('1002'); await R.scan('1004'); s = await R.state(); const A = s.order.id; await R.post('pay-start'); s = await R.state(); const due0 = s.pay.remaining; let handed = 0;
    if (KIND === 'lostget') {
      await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveBegin', mode: 'lost', n: 1 }); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 1 });
      const r1 = await R.post('pay-tender', tb(T, due0)); log.push(`tender ${T} ${due0}: ` + C.short(r1)); await L.sim('/faults-clear', { reg: REG }); s = await R.state();
      if (r1.ok) handed = due0; else { handed = due0; /* the customer's payment went through on AIR POS; the cashier follows the screen */ const st = s.order && s.order.id === A ? s : null; if (st && /Retry|nothing was charged|no record/i.test(r1.message || r1.error || JSON.stringify(r1))) { const r2 = await R.post('pay-tender', tb(T, (s.pay && s.pay.remaining) || due0)); log.push('cashier presses Retry: ' + C.short(r2)); if (!(r2.ok && /already recorded this payment|not taken twice/.test(r2.message || ''))) handed += (s.pay && s.pay.remaining) || due0; /* dblpay: the app adopted the payment AIR POS holds, so nothing new was handed over */ } }
    } else if (KIND === 'expire2') {
      log.push(`tender ${T} 2.00 ` + C.short(await R.post('pay-tender', tb(T, 2)))); handed = 2;
      await L.sim('/fault', { reg: REG, path: 'RetailOrderPromotionGet', mode: 'expire', n: 1 }); await L.sim('/fault', { reg: REG, path: 'RetailOrderSave', mode: 'expire', n: 1 });
      s = await R.state(); const rest = s.pay.remaining; log.push(`cash ${rest} (session expires here): ` + C.short(await R.post('pay-tender', tb(10, rest))));
      await L.sim('/faults-clear', { reg: REG }); s = await R.state(); log.push('loggedIn=' + s.loggedIn);
      const o1 = await L.sim('/order', { id: A }); log.push('AIR POS before re-login ' + JSON.stringify((o1 && o1.rcv || []).map(x => [x.paymentType, x.amount, x.status])));
      if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 1 });
      await R.login(); await L.sleep(1500); await L.sim('/faults-clear', { reg: REG }); s = await R.state();
      log.push(`after re-login: cart=${(s.cart || []).length} same=${s.order.id === A} due=${s.pay ? s.pay.remaining : s.totals.due} notice=${s.notice ? String(s.notice.message).slice(0, 140) : ''}`);
      if (s.order.id === A && (s.cart || []).length) { await R.post('pay-start'); s = await R.state(); const d = s.pay ? s.pay.remaining : s.totals.due; if (d > 0) { log.push(`app asks for ${d}; cashier collects cash ` + C.short(await R.post('pay-tender', tb(10, d)))); handed += d; } else log.push('finish ' + C.short(await R.post('finish-sale'))); }
      else if (s.recoveryRetry || /cannot be reached/i.test(s.notice ? s.notice.message : '')) { await L.sleep(25000); s = await R.state(); log.push('after recheck: ' + (s.notice ? s.notice.message.slice(0, 120) : '')); }
    } else {
      log.push('cash 2.00 ' + C.short(await R.post('pay-tender', tb(10, 2)))); handed = 2;
      await L.sim('/fault', { reg: REG, path: 'RetailOrderComplete', mode: 'expire', n: 1 }); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 2 });
      s = await R.state(); const rest = s.pay.remaining; log.push(`tender ${T} ${rest}: ` + C.short(await R.post('pay-tender', tb(T, rest)))); handed += rest;
      for (let i = 0; i < 3; i++) { s = await R.state(); if (s.loggedIn) break; await R.login(); await L.sleep(1500); } await L.sim('/faults-clear', { reg: REG }); await L.sleep(1000); s = await R.state();
      log.push(`after re-login: cart=${(s.cart || []).length} oid=${s.order.id.slice(0, 8)} due=${s.pay ? s.pay.remaining : s.totals.due} notice=${s.notice ? String(s.notice.message).slice(0, 120) : ''}`);
      if (s.order.id === A && (s.cart || []).length) { await R.post('pay-start'); s = await R.state(); const d = s.pay ? s.pay.remaining : s.totals.due; if (d > 0) { log.push(`app asks for ${d}; cashier collects cash ` + C.short(await R.post('pay-tender', tb(10, d)))); handed += d; } else log.push('finish ' + C.short(await R.post('finish-sale'))); }
    }
    await L.sleep(1500); const o = await L.sim('/order', { id: A }); const rc = (o && o.rcv || []).map(x => [x.paymentType, x.amount, x.status]); const got = L.r2((o && o.rcv || []).filter(x => x.status === 20).reduce((a, x) => a + x.amount, 0));
    log.push(`AIR POS receives ${JSON.stringify(rc)}; completes ${await L.completesFor(A)}; customer handed $${L.r2(handed)} for $${due0}`);
    const iss = []; if (got > due0 + 0.009) iss.push(`OVERCHARGED: AIR POS received $${got} for a $${due0} sale`); if (L.r2(handed) > due0 + 0.009) iss.push(`CUSTOMER_PAID_TWICE $${L.r2(handed)} for $${due0}`);
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, seed, KIND, GM, PENDGET, T, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: '18-chaos', name: `${KIND === 'lostget' ? 'dropped tender reply + order check error' : 'session expiry at Complete + order check error'} [tender ${T}, Get ${GM}${PENDGET !== 'ok' ? ', pending Get ' + PENDGET : ''}]`, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '18-chaos', name: `${KIND} [tender ${T}, Get ${GM}]`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

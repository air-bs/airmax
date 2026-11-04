'use strict';
// Terminal card (type 20, terminal waits for the tap): the ReceiveBegin reply is dropped after AIR POS opened the terminal payment,
// and the follow-up order check gets an error reply. Replays chaos seed 18008937 on purpose.
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', ROUNDS = Number(process.env.ROUNDS || 3), BASE = Number(process.env.BASE || 18420000), GM = process.env.GM || 'http500';
(async () => { for (let k = 0; k < ROUNDS; k++) { const seed = BASE + k, log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG);
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'poll', polls: 2, outcome: 'approve' }); await R.login(); let s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 });
    await R.post('new-sale'); await R.scan('1002'); await R.scan('1004'); s = await R.state(); const A = s.order.id; await R.post('pay-start'); s = await R.state(); const due = s.pay.remaining;
    await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveBegin', mode: 'lost', n: 1 }); if (GM !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderGet', mode: GM, n: 1 });
    const r1 = await R.post('pay-tender', { type: 20, amount: due, stockOk: true }); await L.sim('/faults-clear', { reg: REG }); log.push(`terminal card ${due}: ` + C.short(r1));
    let o = await L.sim('/order', { id: A }); log.push('AIR POS after 1st: ' + JSON.stringify((o && o.rcv || []).map(x => [x.paymentType, x.amount, x.status])));
    const said = /no record of this payment|nothing was charged/i.test(r1.message || r1.error || ''); let retried = false; if (!r1.ok && /check with AIR POS before taking it again/.test(r1.message || r1.error || '')) { await L.sleep(3000); s = await R.state(); log.push('cashier presses Retry (app checks first): ' + C.short(await R.post('pay-tender', { type: 20, amount: (s.pay && s.pay.remaining) || due, stockOk: true }))); }
    if (!r1.ok && said) { retried = true; s = await R.state(); const r2 = await R.post('pay-tender', { type: 20, amount: (s.pay && s.pay.remaining) || due, stockOk: true }); log.push('cashier presses Retry: ' + C.short(r2)); }
    for (let i = 0; i < 20; i++) { await L.sleep(1000); s = await R.state(); if (!s.pay || !s.pay.card || s.pay.card.status !== 'waiting') break; }
    await L.sleep(1500); o = await L.sim('/order', { id: A }); const rc = (o && o.rcv || []); const open = rc.filter(x => x.paymentType === 20 && x.status === 10).length, done = rc.filter(x => x.paymentType === 20 && x.status === 20).length;
    log.push(`AIR POS end: ${JSON.stringify(rc.map(x => [x.paymentType, x.amount, x.status]))}; completes ${await L.completesFor(A)}; screen: ${s.receipt ? 'receipt' : s.pay ? 'pay owes ' + s.pay.remaining : 'mode ' + s.mode}`);
    const iss = []; if (said) iss.push('SAID_NOTHING_CHARGED while AIR POS had the terminal payment open'); if (open) iss.push(`OPEN_TERMINAL_PAYMENT_LEFT x${open} (if the customer tapped the first prompt, that money sits on an orphan payment)`); if (done > 1) iss.push(`CARD_CHARGED x${done}`);
    const res = iss.length ? 'FAIL' : 'PASS'; console.log(res, seed, GM, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: '18-chaos', name: `terminal card: dropped tender reply + order check ${GM}`, seed, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { console.log('INVALID', seed, e.message, log.join(' / ')); L.record({ area: '18-chaos', name: `terminal card lostget ${GM}`, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  L.kill(pid, 'SIGTERM'); await L.sleep(1500); } })();

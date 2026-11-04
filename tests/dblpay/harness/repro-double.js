'use strict';
// Clean on-purpose repro: AIR POS records the payment, then the reply is an HTTP 500 / non-JSON page. The cashier presses the payment again.
// Control: the same with a lost reply (timeout / connection drop), which the app already handles.
const L = require('./lib'), fs = require('fs');
const REG = process.env.REG || 'R2', ROUNDS = Number(process.env.ROUNDS || 5);
const TYPES = { card: { type: 20 }, acct: { type: 11 }, check: { type: 50, checkNumber: '1001' } };
(async () => { const R = new L.Reg(REG); const out = []; let s = await R.state(); if (!s.loggedIn) await R.login();
  for (let k = 0; k < ROUNDS; k++) for (const mode of (process.env.MODES || 'done500,done502,donegarbage,lost').split(',')) for (const t of Object.keys(TYPES)) {
    await L.sim('/faults-clear', { reg: REG }); await L.sim('/term', { reg: REG, mode: 'instant' }); await L.sim('/member-set', { id: 'm-sample', balance: 500 });
    s = await R.state(); if (!s.loggedIn) await R.login(); await R.post('new-sale');
    await R.scan('1001'); if (t !== 'card') await R.post('member-attach', { number: '5550100' });
    s = await R.state(); const oid = s.order.id, due = s.totals.due; const since = await L.seq();
    await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveBegin', mode, n: 1 });
    const first = await R.post('pay-tender', { ...TYPES[t], amount: due });              // step 1: take the payment
    const screen1 = (await R.state()).pay; const retry = first.completed ? null : await R.post('pay-tender', { ...TYPES[t], amount: due }); // step 2: the cashier presses it again
    const led = (await L.ledger(since, REG)).filter(e => e.orderId === oid && /ReceiveBegin|ReceiveDone|OrderComplete/.test(e.path));
    const srv = await L.sim('/order', { id: oid }); const taken = L.r2(srv.rcv.filter(x => x.status === 20).reduce((a, x) => a + x.amount, 0));
    const charges = srv.rcv.filter(x => x.status === 20).length, bad = taken > due + 0.004;
    const row = { round: k + 1, mode, tender: t, orderId: oid, due, firstMsg: first.message, appPaidAfterError: screen1 ? screen1.paid : null, retryMsg: retry && retry.message, airposCharges: charges, airposTaken: taken, doubleCharged: bad, ledger: led.map(e => `${e.path} ${e.success === false ? 'FAIL' : 'ok'} ${e.amount ?? ''}`) };
    out.push(row); L.record({ area: '2-network', name: `REPRO ReceiveBegin:${mode} ${t} then retry`, seed: 990000 + out.length, reg: REG, result: bad ? 'FAIL' : 'PASS', why: bad ? `OVERCHARGE got ${taken} due ${due}; ${charges} charges | ${first.message} / ${retry && retry.message}` : `${first.message} / ${retry && retry.message}`, orderId: oid });
    await R.post('new-sale');
  }
  fs.writeFileSync(L.REP + '/evidence/double-charge-repro.json', JSON.stringify(out, null, 1));
  const g = {}; for (const r of out) { const k = r.mode + ' ' + r.tender; g[k] = g[k] || [0, 0]; g[k][1]++; if (r.doubleCharged) g[k][0]++; }
  for (const k in g) console.log(k.padEnd(20), `double-charged ${g[k][0]} of ${g[k][1]}`); console.log(JSON.stringify(out[0], null, 1)); console.log(JSON.stringify(out.find(r => r.mode === 'lost'), null, 1));
})();

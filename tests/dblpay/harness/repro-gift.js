'use strict';
// Gift card payment: AIR POS records it (deducts the card) then replies 500 / non-JSON / lost; cashier presses it again.
const L = require('./lib'); const REG = process.env.REG || 'R4', ROUNDS = Number(process.env.ROUNDS || 5), NO = '7000000000008888';
(async () => { const R = new L.Reg(REG); let k = 0; const tally = {};
 for (let i = 0; i < ROUNDS; i++) for (const mode of (process.env.MODES || 'done500,done502,donegarbage,lost,none').split(',')) { const seed = (Number(process.env.SEED || 9104000)) + k++;
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/gift-set', { no: NO, balance: 100 }); let s = await R.state(); if (!s.loggedIn) await R.login(); s = await R.state(); if (s.mode === 'clockin') await R.post('clock-in', { amount: 100 }); await R.post('new-sale');
   await R.scan('1001'); await R.post('pay-start'); s = await R.state(); const oid = s.order.id, due = s.totals.due;
   const v = await R.post('gift-verify', { number: NO, secret: '' }); const card = v.card || v.value || v; if (!card || !card.id) throw new Error('gift verify ' + JSON.stringify(v).slice(0, 200));
   if (mode !== 'none') await L.sim('/fault', { reg: REG, path: 'RetailOrderReceiveBegin', mode, n: 1 });
   const gc = [{ id: card.id, balance: card.balance }]; const a = await R.post('pay-tender', { type: 40, amount: due, giftCards: gc }); let b = null; if (!a.completed && !a.ok) b = await R.post('pay-tender', { type: 40, amount: due, giftCards: gc });
   const srv = await L.sim('/order', { id: oid }); const gifts = srv.rcv.filter(x => x.status === 20 && x.paymentType === 40); const taken = L.r2(gifts.reduce((x, y) => x + y.amount, 0));
   const iss = taken > due + 0.004 ? ['GIFT_CARD_CHARGED_TWICE ' + taken + ' for ' + due + ' (first said: ' + a.message + ')'] : [];
   tally[mode] = tally[mode] || [0, 0]; tally[mode][1]++; if (iss.length) tally[mode][0]++;
   L.record({ area: '2-network', name: 'REPRO gift card ReceiveBegin:' + mode + ' then retry', seed, reg: REG, result: iss.length ? 'FAIL' : 'PASS', why: iss.join('; ') + ' | ' + a.message + ' / ' + (b && b.message), orderId: oid });
   s = await R.state(); if (s.pay && !s.completed) { await L.sim('/faults-clear', { reg: REG }); await R.post('pay-tender', { type: 10, amount: Math.max(0, L.r2(due - (s.pay.paid || 0))), tendered: due }); await R.post('finish-sale'); } await R.post('new-sale');
  } catch (e) { L.record({ area: '2-network', name: 'REPRO gift card ' + mode, seed, reg: REG, result: 'INVALID', why: 'harness ' + e.message }); console.log('INVALID', mode, e.message); } }
 await L.sim('/faults-clear', { reg: REG }); await L.sim('/gift-set', { no: NO, balance: 100 }); console.log(JSON.stringify(tally)); L.progress('running'); })();

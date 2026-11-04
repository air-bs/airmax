// Card flow test with a simulated terminal (no server calls, no card). Proves Begin -> poll schedule ->
// approve / decline+retry / cancel / timeout message, and that paid amounts are tracked correctly.
const { Register } = require('../app/lib/register');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
function mk(script) {
  const reg = new Register({ log: () => {} });
  const calls = []; let checks = 0;
  const api = reg.api;
  api.ide = 'x';
  reg.identity = { userName: 'u', currency: 2 }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} } };
  api.promotionGet = async s => ({ success: true, value: { subs: [], totalAmount: 10, totalTax: 0.5, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: 10 } });
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async s => { calls.push('save:' + s.paymentType); return { success: true }; };
  api.receiveBegin = async s => { calls.push('begin:' + s.paymentType + ':' + s.amount); return { success: true, value: { isCompleted: s.paymentType !== 20 } }; };
  api.receiveCheck = async s => { checks++; calls.push('check'); return script(checks, s); };
  api.receiveCancel = async s => { calls.push('cancel'); return { success: true }; };
  api.complete = async c => { calls.push('complete'); return { success: true }; };
  reg.subs = [{ id: 'a', itemId: 'i', productId: 'p', name: 'Item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, calls, get checks() { return checks; } };
}
(async () => {
  // 1. approved on 4th poll, split with cash first
  let t = mk(n => ({ success: true, value: n >= 4 ? { isCompleted: true } : { isCompleted: false, message: 'Waiting for card' } }));
  await t.reg.recalc(); await t.reg.startPay();
  let r = await t.reg.tender({ type: 10, tendered: 5 });
  r = await t.reg.tender({ type: 20 });
  await sleep(2500);
  rec('Card approved after polling, split cash+card, sale completes', r.waiting && t.reg.completed && t.calls.includes('complete') && t.calls.filter(c => c === 'check').length === 4,
    `calls: ${t.calls.join(' ')}; completed tenders ${JSON.stringify(t.reg.completed && t.reg.completed.tenders)}`);
  // 2. decline -> retry -> approve
  t = mk(n => ({ success: true, value: n === 2 ? { isCompleted: false, shouldReissue: true, message: 'Card declined' } : n >= 4 ? { isCompleted: true } : { isCompleted: false, message: 'Waiting' } }));
  await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 20 }); await sleep(1200);
  const st1 = t.reg.state().pay; const paidAfterDecline = st1.paid;
  r = await t.reg.cardRetry(); await sleep(1500);
  rec('Card declined -> shows message, nothing counted as paid -> Retry -> approved', st1.card.status === 'declined' && /declined/.test(st1.card.message) && paidAfterDecline === 0 && t.reg.completed && t.calls.filter(c => c.startsWith('begin')).length === 2, `state after decline: ${st1.card.status} "${st1.card.message}" paid ${paidAfterDecline}; calls ${t.calls.join(' ')}`);
  // 3. cancel while waiting
  t = mk(() => ({ success: true, value: { isCompleted: false, message: 'Waiting' } }));
  await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 20 }); await sleep(1800);
  const polls = t.checks; r = await t.reg.cardCancel(); const n0 = t.checks; await sleep(1500);
  const cl = await t.reg.closePay();
  rec('Cancel card while waiting: ReceiveCancel sent, polling stops, paid stays $0, back to cart', r.ok && t.calls.includes('cancel') && t.checks === n0 && t.reg.paidTotal() === 0 && cl.ok && !t.reg.pay, `${polls} polls in 1.8 s (500 ms schedule), none after cancel; ${r.message}`);
  // 4. guard rails while waiting
  t = mk(() => ({ success: true, value: { isCompleted: false } }));
  await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 20, amount: 4 });
  const g1 = await t.reg.scan('x'), g2 = await t.reg.tender({ type: 10, tendered: 20 }), g3 = t.reg.logout(), g4 = await t.reg.closePay();
  rec('While card waits: cart locked, no 2nd tender, no logout, no close', !g1.ok && !g2.ok && !g3.ok && !g4.ok, [g1, g2, g3, g4].map(x => x.message).join(' / '));
  await t.reg.cardCancel();
  // 5. slow-terminal message after 2 min (fake clock)
  t = mk(() => ({ success: true, value: { isCompleted: false, message: 'Waiting' } }));
  await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 20 }); t.reg.pay.card.startedAt -= 121000; await sleep(1200);
  const s5 = t.reg.state().pay.card; await t.reg.cardCancel();
  rec('After 2 minutes: "check the terminal" hint, slower polling', s5.slow && /2 minutes/.test(s5.subMessage), s5.subMessage);
  // 6. amount guards
  t = mk(() => ({ success: true, value: { isCompleted: false } }));
  await t.reg.recalc(); await t.reg.startPay();
  const a1 = await t.reg.tender({ type: 20, amount: 50 }), a2 = await t.reg.tender({ type: 50, amount: 1 }), a3 = await t.reg.tender({ type: 11, amount: 1 }), a4 = await t.reg.tender({ type: 40, amount: 1, giftCards: [{ id: 'g', balance: 0.5 }] });
  rec('Tender validation (over-amount, check number, store credit needs member, gift balance)', !a1.ok && !a2.ok && !a3.ok && !a4.ok, [a1, a2, a3, a4].map(x => x.message).join(' / '));
  require('fs').writeFileSync(__dirname + '/card-mock-results.json', JSON.stringify(out, null, 2));
  process.exit(out.every(x => x.pass) ? 0 : 1);
})();

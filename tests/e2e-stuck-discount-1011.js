// airmax-fix-stock (a live-store sale, Nov 2 2026): ORDER % discount, then items added / removed / quantity changed, then card: the AIR POS due
// (worked out from the SAVED order the way AIR POS did on that sale) must equal the card charge, and Complete must finish.
// Strict fake AIR POS only (FAKE_STRICT_COMPLETE=1), made-up data. Run: FAKE_PORT=5180 node tests/e2e-stuck-discount-1011.js
'use strict';
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note || '').slice(0, 300)); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hookTxt = p => fetch(HOOK + p).then(r => r.text());
const strict = async () => JSON.parse(await hookTxt('/strict'));
const logText = () => fetch(BASE + '/export/log').then(r => r.text());
const r2 = x => Math.round(x * 100) / 100;
async function fresh() { await post('pay-close'); await post('new-sale'); await post('dismiss'); await hookTxt('/fault-clear'); await hookTxt('/stock-refuse?on=0'); await hookTxt('/complete-refuse?n=0'); await hookTxt('/due-skew?amt=0'); }
async function run(name, steps, pct) {
  await fresh(); for (const f of steps) await f();
  const st = await state(), id = st.order.id, shown = st.totals.due; await post('pay-start');
  const r = await post('pay-tender', { type: 20, amount: shown }), s = await strict(), c = s.completes.filter(x => x.id === id).pop(), rc = (s.rcv[id] || []).reduce((a, x) => a + x.amount, 0);
  rec(`${name}: AIR POS due ${c ? '$' + c.due : '?'} = card charged $${r2(rc)} = shown $${shown}, sale completes`, r.ok && r.completed && c && Math.abs(c.due - rc) < 0.005 && Math.abs(shown - rc) < 0.005, `${r.message || ''} ${JSON.stringify({ due: c && c.due, got: c && c.got })}`);
  await post('dismiss');
}
const scan = code => () => post('scan', { code }), disc = (kind, v) => () => post('discount', { kind, value: v });
(async () => {
  if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
  if ((await strict()).promoFail === undefined) throw new Error('fake server is not in FAKE_STRICT_COMPLETE=1 mode');
  await run('E1 33% off, THEN 3 more items (the reported sale)', [scan('1001'), disc('percent', 33), scan('1002'), scan('1003'), scan('1004')]);
  await run('E2 33% off on 4 items, THEN 2 removed', [scan('1001'), scan('1002'), scan('1003'), scan('1004'), disc('percent', 33), () => post('remove', { row: 0 }), () => post('remove', { row: 0 })]);
  await run('E3 33% off, THEN quantity raised', [scan('1001'), scan('1002'), disc('percent', 33), () => post('qty', { row: 0, qty: 4 })]);
  await run('E4 33% off, THEN quantity lowered', [scan('1001'), disc('percent', 33), () => post('qty', { row: 0, qty: 5 }), () => post('qty', { row: 0, qty: 2 })]);
  await run('E5 10% off, add, remove, change quantity, add again', [scan('1001'), disc('percent', 10), scan('1002'), () => post('remove', { row: 0 }), () => post('qty', { row: 0, qty: 3 }), scan('1003')]);
  await run('E6 $4 off (amount), THEN more items', [scan('1001'), disc('amount', 4), scan('1002'), scan('1003')]);
  await run('E7 no order discount (control)', [scan('1001'), scan('1002'), scan('1003')]);
  // what AIR POS was sent
  await fresh(); await post('scan', { code: '1001' }); await post('discount', { kind: 'percent', value: 33 }); await post('scan', { code: '1002' }); await post('scan', { code: '1003' }); await post('pay-start'); const t = (await state()).totals;
  const sent = (await state()).order.orderDiscountAmount, want = r2(0.33 * (10 + 5 + 2)); rec('E8 the order discount amount held for AIR POS is 33% of ALL three lines', Math.abs(sent - want) < 0.006, `sent ${sent}, want ${want}`);
  await post('pay-close'); await post('dismiss');
  // before the card: AIR POS's due differs -> nothing is charged
  await fresh(); await post('scan', { code: '1001' }); await post('scan', { code: '1002' }); await post('pay-start'); await hookTxt('/due-skew?amt=2.97');
  const id = (await state()).order.id; let r = await post('pay-tender', { type: 20, amount: (await state()).totals.due }); let s = await strict();
  rec('E9 AIR POS due differs by $2.97: NOTHING charged, message names both totals', !r.ok && r.dueMismatch && (s.rcv[id] || []).length === 0 && /AIR POS works out \$\d+\.\d\d for this sale, but Air Max has \$\d+\.\d\d/.test(r.message) && /Nothing was charged/.test(r.message), r.message);
  rec('E10 ...the log has a TOTAL MISMATCH line', /TOTAL MISMATCH/.test(await logText()), '');
  const cl = await post('pay-close'), sc = await post('scan', { code: '1003' }), st2 = await state(); rec('E11 ...Esc goes back to the sale (nothing paid), items can still be added, and once the totals agree again the card is taken once', cl.ok && sc.ok && !st2.pay, JSON.stringify([cl.message, sc.message]));
  await hookTxt('/due-skew?amt=0'); await post('pay-start'); r = await post('pay-tender', { type: 20, amount: (await state()).totals.due }); s = await strict();
  rec('E12 ...and then it completes with ONE card payment', r.ok && r.completed && (s.rcv[id] || []).length === 1, r.message);
  await hookTxt('/due-skew?amt=0'); await post('pay-close'); await post('dismiss'); await post('new-sale');
  const pass = out.filter(x => x.pass).length; console.log(`stuck-discount-1011: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

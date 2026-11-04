// AIR POS look app: this script targets the STORE dev folder / port 5057 or the real account; disabled here on purpose.
if (!process.env.ALLOW_STORE_SCRIPT) { console.error('SKIPPED: store-only script (see line 1)'); process.exit(2); }
// Real-account smoke for 1.2.0 on the TEST account only (business test / grock) via the running dev server (:5057).
// Password only from env AIRMAX_TEST_PW (never printed or written). Cash only, no cards.
'use strict';
const BASE = process.env.BASE || 'http://127.0.0.1:5057';
const post = (r, b) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(x => x.json());
const st = () => fetch(BASE + '/api/state').then(x => x.json());
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
(async () => {
  const blocked = await post('login', { company: 'blocked-demo-co', user: 'x', password: '<redacted>' });
  rec('blocked company refused locally', !blocked.ok && /block/i.test(blocked.message || ''), blocked.message);
  let s = await st();
  if (!s.loggedIn) { const pw = process.env.AIRMAX_TEST_PW; if (!pw) throw new Error('set AIRMAX_TEST_PW'); const l = await post('login', { company: 'business test', user: 'grock', password: pw }); rec('login TESTSHOP/grock', l.ok, l.message); }
  s = await st(); if (/blocked-demo-co/i.test(JSON.stringify(s.shop || s.user || ''))) throw new Error('wrong account');
  if (s.mode === 'clockin') { const c = await post('clock-in', { amount: 0 }); rec('clock in at $0', c.ok, c.message); s = await st(); }
  if (s.pay && s.pay.remaining === 0) { const f = await post('finish-sale'); console.log('finish stuck sale:', f.ok, f.message); s = await st(); }
  if (s.pay) { await post('pay-close'); s = await st(); }
  console.log('state: mode', s.mode, 'cart', s.cart.length, 'pay', !!s.pay);
  const p = { number: process.env.RET_CODE || '00001' }, q = { number: process.env.SALE_CODE || '00002' }; // test products (00001 = Test Product 001)
  // 1. no-receipt cash return
  let t = await post('return-toggle'); rec('return scanning on', t.ok && t.on, t.message);
  let r = await post('scan', { code: p.number }); s = await st();
  rec('return line added (negative, current price)', r.ok && s.mix.lines.length === 1 && s.mix.net < 0, `${r.message} | net ${s.mix.net} | refund ${s.mix.totals.refund} (tax ${s.mix.totals.tax}, refundTaxNoReceipt ${s.mix.totals.taxIncluded})`);
  r = await post('mix-refund', { type: 10 }); s = await st();
  rec('cash refund recorded on AIR POS (NonOrderReturnOrderCreate)', r.ok && r.quickReturn && r.quickReturn.backType === 'Cash' && !s.mix.lines.length, `${r.message || ''} | give back ${r.quickReturn && r.quickReturn.back} | returnId ${r.quickReturn && r.quickReturn.returnId ? 'yes' : 'no'}`);
  // 2. sale: add item, payment, cash
  if (s.mix.on) await post('return-toggle', { on: false });
  if (s.pay && s.pay.remaining === 0) { const f = await post('finish-sale'); console.log('finish stuck sale:', f.ok, f.message); }
  r = await post('scan', { code: q.number }); s = await st(); rec('add item', r.ok && s.cart.length === 1, r.message);
  r = await post('pay-start'); rec('Enter -> payment', r.ok && !r.needManager, r.message);
  s = await st(); const due = s.pay ? s.pay.remaining : s.totals.due;
  r = await post('pay-tender', { type: 10, tendered: due }); s = await st();
  rec('cash completes the sale', r.ok && r.completed && !s.cart.length, `${r.message} | due ${due}`);
  require('fs').writeFileSync(__dirname + '/smoke-real-120-results.json', JSON.stringify(out, null, 2));
  console.log(`${out.filter(x => x.pass).length}/${out.length} passed`);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

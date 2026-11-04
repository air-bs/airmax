// AIR POS look app: this script targets the STORE dev folder / port 5057 or the real account; disabled here on purpose.
if (!process.env.ALLOW_STORE_SCRIPT) { console.error('SKIPPED: store-only script (see line 1)'); process.exit(2); }
// Soak: N back-to-back sales on the TEST account (temporary items, cash / check+cash splits), checks every order in AIR POS
// (completed, payments = total, no duplicates) and samples server memory. Password only from env AIRMAX_TEST_PW.
const B = 'http://127.0.0.1:5057', N = +process.argv[2] || 50;
const api = async (p, b = {}) => (await fetch(B + '/api/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const st = async () => (await fetch(B + '/api/state')).json();
(async () => {
  let s = await st(); if (!s.user) { const l = await api('login', { company: 'business test', user: 'grock', password: process.env.AIRMAX_TEST_PW }); if (!l.ok) { console.log('login failed'); process.exit(1); } }
  const mem = []; const t0 = Date.now(); let ok = 0; const bad = []; const nums = new Set(); const times = []; let lag = 0;
  for (let i = 1; i <= N; i++) {
    const t = Date.now();
    try {
      s = await st(); if (s.completed) await api('dismiss'); if (s.cart.length || s.pay) throw new Error('previous sale still open');
      const lines = 1 + (i % 3);
      for (let k = 0; k < lines; k++) await api('temp-item', { price: +(1 + ((i * 7 + k * 3) % 50) / 10).toFixed(2), name: 'Soak item ' + i });
      if (i % 4 === 0) await api('qty', { row: 0, qty: 2 });
      const ps = await api('pay-start'); if (!ps.ok) throw new Error('pay-start ' + ps.message);
      s = await st(); const due = s.totals.due;
      let r;
      if (i % 5 === 0) { const half = Math.round(due * 50) / 100; const c = await api('pay-tender', { type: 50, amount: half, checkNumber: String(1000 + i) }); if (!c.ok) throw new Error('check ' + c.message); r = await api('pay-cash', { tendered: Math.ceil((due - half) * 100) / 100 + 1 }); }
      else r = await api('pay-cash', { tendered: Math.ceil(due) + (i % 2 ? 0 : 5) });
      if (!r.ok || !r.completed) throw new Error('pay ' + r.message);
      s = await st(); let o = (await api('order', { orderId: s.lastOrderId })).order;
      for (let w = 0; w < 6 && o.status !== 20; w++) { lag++; await new Promise(z => setTimeout(z, 500)); o = (await api('order', { orderId: s.lastOrderId })).order; } // AIR POS can show 15 for a moment after Complete
      const paid = (o.receives || []).filter(x => x.status === 20).reduce((a, x) => a + x.amount, 0);
      if (o.status !== 20 || Math.round(paid * 100) !== Math.round(due * 100) || nums.has(o.number)) throw new Error(`${o.number} status ${o.status} paid ${paid} due ${due}`);
      nums.add(o.number); ok++; await api('dismiss');
    } catch (e) { bad.push(i + ': ' + e.message); try { await api('pay-close'); await api('new-sale'); } catch {} }
    times.push(Date.now() - t);
    if (i === 1 || i % 10 === 0) { const d = await api('dev-fault', {}); mem.push(`#${i} rss ${Math.round((d.rss || 0) / 1048576)}MB heap ${Math.round((d.heap || d.heapUsed || 0) / 1048576)}MB`); }
  }
  times.sort((a, b) => a - b);
  const out = { sales: N, ok, failed: bad, orders: [...nums][0] + '…' + [...nums].slice(-1)[0], seconds: Math.round((Date.now() - t0) / 1000), medianMs: times[N >> 1], maxMs: times[N - 1], statusLagReads: lag, mem };
  console.log(JSON.stringify(out, null, 1)); require('fs').writeFileSync(__dirname + '/soak-results.json', JSON.stringify(out, null, 1));
  process.exit(bad.length ? 1 : 0);
})();

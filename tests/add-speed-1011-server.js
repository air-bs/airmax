// 1.0.11-speed.1 (Ari OK via parent 5:26 PM ET Nov 1 2026): the real app server against the OFFLINE fake AIR POS with a slow total
// check (FAKE_PROMO_DELAY) and a slow product search (FAKE_STOCK_DELAY): an add answers before its total, the in-stock note no
// longer holds up the next add, the customer screen says "updating" instead of an old total, and Payment waits for the final total.
// Own port (ADD_PORT, default 5191), no hook server, no network, made-up items.
'use strict';
const { spawn } = require('child_process'), path = require('path');
const PORT = Number(process.env.ADD_PORT || 5191), BASE = 'http://127.0.0.1:' + PORT, DELAY = 400;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const st = () => fetch(BASE + '/api/state').then(r => r.json()), cst = () => fetch(BASE + '/api/customer-state').then(r => r.json());
const timed = async (r, x) => { const a = Date.now(); const j = await post(r, x); return { j, ms: Date.now() - a }; };
const srv = spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: 'off', FAKE_PROMO_DELAY: String(DELAY), FAKE_STOCK_DELAY: String(DELAY) }, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = ''; srv.stdout.on('data', d => slog += d); srv.stderr.on('data', d => slog += d);
(async () => {
  for (let i = 0; i < 50; i++) { try { await st(); break; } catch { await sleep(200); } }
  let l = await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' }); await post('pay-close'); await post('new-sale');
  rec('S0 logged in to the fake AIR POS', l.ok !== false && (await st()).loggedIn, l.message);
  // add returns before its total
  let a = await timed('scan', { code: '1001' }); let s = await st(), c = await cst();
  rec(`S1 add answers in ${a.ms} ms with a ${DELAY} ms total check (before: the add waited for the total, ≥ ${DELAY} ms)`, a.j.ok && a.ms < DELAY / 2 && s.cart.length === 1 && s.totals.updating === true, `add ${a.ms} ms, rows ${s.cart.length}, updating ${s.totals.updating}`);
  rec('S2 customer screen is told "updating" while the total is out (no old total shown)', c.updating === true && c.lines && c.lines.length === 1, JSON.stringify({ updating: c.updating, lines: c.lines && c.lines.length }));
  await sleep(DELAY + 250); s = await st(); c = await cst();
  rec('S3 when the answer is in: total $10.80 (10 + 8% tax), updating cleared on both screens', s.totals.due === 10.8 && s.totals.tax === 0.8 && !s.totals.updating && !s.totals.stale && c.updating === false, JSON.stringify({ due: s.totals.due, tax: s.totals.tax, up: s.totals.updating, cup: c.updating }));
  // stock note no longer blocks the next add
  const sn = timed('stock-note', { code: '1001' }); await sleep(20); a = await timed('scan', { code: '1003' }); const snr = await sn;
  rec(`S4 in-stock note out (${DELAY} ms search): the next add does not wait behind it (add ${a.ms} ms, note ${snr.ms} ms)`, a.j.ok && a.ms < DELAY / 2 && snr.ms >= DELAY - 20, `add ${a.ms} ms, note ${snr.ms} ms`);
  // burst then Payment at once
  for (const code of ['1001', '1001', '1003']) await post('scan', { code });
  s = await st(); const midUp = s.totals.updating;
  a = await timed('pay-start'); s = await st(); // items: 3 x $10 + 2 x $2 = $34, tax 8% = 2.72
  rec(`S5 5-item sale, Payment pressed while the total is still out: waits (${a.ms} ms) and opens on the final $36.72`, midUp === true && a.j.ok && s.pay && s.totals.due === 36.72 && Math.abs((s.pay.remaining ?? s.pay.due ?? s.totals.due) - 36.72) < 0.001 && !s.totals.stale, JSON.stringify({ midUp, ok: a.j.ok, due: s.totals.due, remaining: s.pay && s.pay.remaining, msg: a.j.message }));
  c = await cst(); rec('S6 customer screen in the payment window: shows the amount due (not "updating")', c.updating === false && c.pay && Math.abs(c.pay.due - 36.72) < 0.001, JSON.stringify({ updating: c.updating, due: c.pay && c.pay.due }));
  await post('pay-close');
  // hold mid-check
  await post('scan', { code: '1004' }); a = await timed('hold'); s = await st(); const held = await post('held');
  rec(`S7 Hold pressed mid-check: waits for the total (${a.ms} ms), the sale is held, the screen is empty`, a.j.ok === true && s.cart.length === 0 && s.totals.updating !== true && a.ms >= DELAY - 100, JSON.stringify({ ok: a.j.ok, msg: a.j.message, rows: s.cart.length, up: s.totals.updating, held: JSON.stringify(held).slice(0, 300) }));
  await post('new-sale'); await post('logout');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`);
  if (/UNHANDLED|ERROR \/api/.test(slog)) console.log('FAIL server log has errors: ' + slog.split('\n').filter(x => /UNHANDLED|ERROR/.test(x)).slice(0, 3).join(' | '));
  srv.kill(); process.exit(pass === out.length && !/UNHANDLED|ERROR \/api/.test(slog) ? 0 : 1);
})().catch(e => { console.error('FAIL crash', e); srv.kill(); process.exit(1); });

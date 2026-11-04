// Air Register (AIR POS look): totals parity with the STORE Air Register 1.2.3.
// Runs the same sales through both apps (each on its own offline fake AIR POS) and compares the totals the server returns.
// The store app is copied READ-ONLY from /workspace/air-register-1.2.3-release into a temp folder (its logs go there, never into the store folder).
// Ports: ours 5180, store copy 5186 (never Coach's 5068-5075). No browser needed.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn, execFileSync } = require('child_process');
const STORE = process.env.STORE_SRC || '/workspace/air-register-1.2.3-release';
const OURS = path.join(__dirname, '..'), P_OURS = Number(process.env.PARITY_OURS_PORT || 5180), P_STORE = Number(process.env.STORE_PARITY_PORT || 5186);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'look-parity-store-'));
fs.mkdirSync(path.join(tmp, 'tests'));
execFileSync('cp', ['-a', path.join(STORE, 'app'), path.join(tmp, 'app')]);
for (const d of ['logs', 'journal']) fs.rmSync(path.join(tmp, 'app', d), { recursive: true, force: true });
fs.copyFileSync(path.join(STORE, 'tests', 'fake-server.js'), path.join(tmp, 'tests', 'fake-server.js'));
const kids = [];
const boot = (dir, port) => { const c = spawn(process.execPath, ['tests/fake-server.js'], { cwd: dir, env: { ...process.env, FAKE_PORT: String(port) }, stdio: process.env.PARITY_DEBUG ? 'inherit' : 'ignore' }); kids.push(c); return c; };
const mk = port => { const B = 'http://127.0.0.1:' + port;
  return { post: (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), state: () => fetch(B + '/api/state').then(r => r.json()) }; };
const up = async a => { for (let i = 0; i < 40; i++) { try { await a.state(); return true; } catch { await sleep(250); } } return false; };
const pick = s => ({ totals: s.totals, cart: (s.cart || []).map(l => ({ number: l.number, quantity: l.quantity, price: l.price, discountAmount: l.discountAmount || 0, total: l.total })), taxExempt: !!(s.order && s.order.taxExempt) });
const SALES = [
  ['one item', [['scan', { code: '1001' }]]],
  ['mixed tax + qty', [['scan', { code: '1001' }], ['scan', { code: '1003' }], ['qty', { row: 1, qty: 7 }], ['scan', { code: '1004' }]]],
  ['line % discount', [['scan', { code: '1001' }], ['scan', { code: '1003' }], ['line-discount', { row: 0, kind: 'percent', value: 15 }]]],
  ['line $ discount', [['scan', { code: '1001' }], ['qty', { row: 0, qty: 3 }], ['line-discount', { row: 0, kind: 'amount', value: 4.25 }]]],
  ['order % discount', [['scan', { code: '1001' }], ['scan', { code: '1004' }], ['discount', { kind: 'percent', value: 10 }]]],
  ['order $ discount', [['scan', { code: '1001' }], ['scan', { code: '1003' }], ['discount', { kind: 'amount', value: 3.33 }]]],
  ['qty +/- and remove', [['scan', { code: '1003' }], ['qty-plus', { row: 0 }], ['qty-plus', { row: 0 }], ['qty-minus', { row: 0 }], ['scan', { code: '1004' }], ['remove', { row: 1 }]]],
  ['tax off (manager)', [['scan', { code: '1001' }], ['scan', { code: '1003' }], ['tax-exempt', { on: true }]]],
];
(async () => {
  let code = 1;
  try {
    boot(OURS, P_OURS); boot(tmp, P_STORE);
    const A = mk(P_OURS), S = mk(P_STORE);
    rec('Both offline fake servers start (ours ' + P_OURS + ', store copy ' + P_STORE + ')', await up(A) && await up(S), '');
    for (const x of [A, S]) await x.post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    for (const [name, steps] of SALES) {
      const res = [];
      for (const x of [A, S]) { await x.post('pay-close'); await x.post('new-sale'); await x.post('dismiss'); const acks = [];
        for (const [r, b] of steps) { const k = await x.post(r, b); acks.push(!!(k && k.ok !== false)); }
        res.push({ acks, st: pick(await x.state()) }); }
      const same = JSON.stringify(res[0].st) === JSON.stringify(res[1].st) && JSON.stringify(res[0].acks) === JSON.stringify(res[1].acks);
      rec('Totals match the store app: ' + name, same && res[0].st.cart.length > 0, same ? `total ${res[0].st.totals.due}, tax ${res[0].st.totals.tax}, qty ${res[0].st.totals.quantity}` : `ours ${JSON.stringify(res[0])} | store ${JSON.stringify(res[1])}`);
    }
    for (const x of [A, S]) { await x.post('new-sale'); }
    code = out.every(o => o.pass) ? 0 : 1;
  } catch (e) { rec('parity run', false, e.message); }
  finally { for (const k of kids) k.kill(); await sleep(500); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`${out.filter(o => o.pass).length}/${out.length} passed`); process.exit(code);
})();

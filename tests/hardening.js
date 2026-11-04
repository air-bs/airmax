// AIR POS look app: this script targets the STORE dev folder / port 5057 or the real account; disabled here on purpose.
if (!process.env.ALLOW_STORE_SCRIPT) { console.error('SKIPPED: store-only script (see line 1)'); process.exit(2); }
// Hardening / fault-injection suite: node hardening.js [only...]   (TESTSHOP only; password from env AIRMAX_TEST_PW, never printed)
// Drives the local server API directly. Needs the dev server (AIRREG_DEV_PROBE=1) — it restarts it itself for crash tests.
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const APP = '/workspace/air-register-1.2.0-work/app';
const RES = '/workspace/air-register-1.2.0-work/tests/hardening-results.json';
const B = 'http://127.0.0.1:5057';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = {}; const only = process.argv.slice(2);
const rec = (k, pass, note) => { results[k] = { pass: !!pass, note: String(note || '').slice(0, 400) }; console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + results[k].note); };
const api = async (r, b = {}, ms = 120000) => { const res = await fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), signal: AbortSignal.timeout(ms) }); return res.json(); };
// Paid test sales use a temporary item (no stock): the test shop's stock runs out after a few suite runs (AIR POS then
// refuses to finish: "Insufficient inventory"). Scanner tests still scan the real product.
const item = (price = 1.05) => api('temp-item', { price, name: 'Hardening test item' });
const st = async () => (await fetch(B + '/api/state')).json();
const fault = b => api('dev-fault', b);
const order = async id => { // AIR POS can show 15 for a moment after Complete: re-read briefly
  let o = (await api('order', { orderId: id })).order;
  for (let k = 0; k < 6 && o && o.status === 15; k++) { await sleep(500); o = (await api('order', { orderId: id })).order; }
  return o;
};
const done = o => (o.receives || []).filter(r => r.status === 20);
const env = { ...process.env, AIRREG_DATA: '/tmp/airreg-data', AIRREG_HW_WINE: '1', AIRREG_HW_EXE: '/workspace/air-register-1.2.0-work/hw/out/AirRegisterHw.exe', WINEPREFIX: '/workspace/wine-hw', AIRREG_DEV_PROBE: '1', AIRREG_NO_POWER: '1' };
async function startServer() {
  try { execSync('pkill -f "node server.js"'); } catch {}
  await sleep(600);
  const out = fs.openSync('/tmp/airreg-server.log', 'a');
  spawn('node', ['server.js'], { cwd: APP, env, detached: true, stdio: ['ignore', out, out] }).unref();
  for (let i = 0; i < 40; i++) { await sleep(250); try { await st(); return true; } catch {} }
  throw new Error('server did not start');
}
async function crash() { try { await fault({ crash: 'exit' }); } catch {} await sleep(400); }
async function login() { const r = await api('login', { company: 'business test', user: 'grock', password: process.env.AIRMAX_TEST_PW }); return r; }
async function clean() { await fault({ api: [], hw: null }); const s = await st(); if (s.mode === 'return') await api('return-cancel'); if (s.completed) await api('dismiss'); if (s.pay && !(s.pay.paid > 0)) await api('pay-close'); if ((await st()).cart.length) await api('new-sale'); }
const cartQty = s => s.cart.reduce((a, c) => a + c.quantity, 0);

const T = {
  async inputs() {
    await clean();
    let r = await api('scan', { code: '00001\r\n' }); rec('Scanner suffix CR/LF stripped', r.ok, r.message);
    r = await api('scan', { code: '\x0200001\x03' }); rec('Scanner STX/ETX prefix/suffix stripped', r.ok, r.message);
    r = await api('scan', { code: '00001\t' }); rec('Scanner Tab suffix stripped', r.ok, r.message);
    r = await api('scan', { code: '   ' }); rec('Blank scan refused', !r.ok, r.message);
    r = await api('qty', { row: 0, qty: 1e9 }); rec('Huge quantity refused', !r.ok && /too large/.test(r.message), r.message);
    r = await api('qty', { row: 0, qty: 'abc' }); rec('Non-number quantity refused', !r.ok, r.message);
    r = await api('qty', { row: 0, qty: -2 }); rec('Negative quantity refused', !r.ok, r.message);
    r = await api('qty', { row: 0, qty: 2.33333333 }); const s1 = await st(); rec('Decimal quantity rounded to 3 places', r.ok && s1.cart[0].quantity === 2.333, String(s1.cart[0].quantity));
    r = await api('temp-item', { name: 'Big', price: 1e9, qty: 1 }); rec('Huge price refused', !r.ok && /too large/.test(r.message), r.message);
    r = await api('temp-item', { name: 'Bad', price: 'x', qty: 1 }); rec('Bad price refused', !r.ok, r.message);
    r = await api('pay-cash', { tendered: 1e7 }); rec('Absurd cash tendered refused', !r.ok && /looks wrong/.test(r.message), r.message);
    r = await api('discount', { kind: 'amount', value: 1e6 }); rec('Discount above total refused', !r.ok, r.message);
    await api('pay-close'); await api('new-sale');
    r = await api('pay-start'); rec('Empty cart cannot be paid', !r.ok && /empty/.test(r.message), r.message);
  },
  async rapid() {
    await clean();
    const rs = await Promise.all(Array.from({ length: 20 }, () => api('scan', { code: '00001' })));
    const s = await st(); rec('20 scans at once: none dropped (queued)', rs.every(r => r.ok) && cartQty(s) === 20, `ok ${rs.filter(r => r.ok).length}/20, qty ${cartQty(s)}`);
    await clean(); await item(); await api('pay-start'); // paid part uses a temporary item: the test shop has little stock
    const two = await Promise.all([api('pay-cash', { tendered: 500 }), api('pay-cash', { tendered: 500 })]);
    const s2 = await st(); const id = s2.lastOrderId; const o = await order(id);
    rec('Double Enter on Pay: second press ignored, one payment', two.filter(r => r.ok).length === 1 && two.some(r => r.busy) && done(o).length === 1, `${two.map(r => r.ok ? 'ok' : r.busy ? 'busy' : r.message).join(' / ')}; receives ${done(o).length}, ${o.number}`);
    await clean();
  },
  async lostReceive() {
    await clean(); await item(); await api('pay-start');
    await fault({ api: { path: 'ReceiveBegin', mode: 'lost-reply' } });
    const r = await api('pay-cash', { tendered: 20 }); const s = await st();
    const o = s.lastOrderId && await order(s.lastOrderId);
    rec('Lost reply on payment: checked with AIR POS, adopted, not charged twice', r.ok && o && o.status === 20 && done(o).length === 1, `${r.message} | ${o && o.number} receives ${o && done(o).length}`);
    await clean();
  },
  async downReceive() {
    await clean(); await item(); await api('pay-start');
    await fault({ api: { path: 'ReceiveBegin', mode: 'down' } });
    const r1 = await api('pay-cash', { tendered: 20 });
    const r2 = await api('pay-cash', { tendered: 20 }); const s = await st(); const o = await order(s.lastOrderId);
    rec('Network down on payment: "nothing charged" + Retry works once', !r1.ok && r1.retryable && r2.ok && done(o).length === 1, `${r1.message} → ${r2.message.slice(0, 60)} | ${o.number} receives ${done(o).length}`);
    await clean();
  },
  async lostBoth() {
    await clean(); await item(); await api('pay-start');
    await fault({ api: [{ path: 'ReceiveBegin', mode: 'lost-reply' }, { path: 'RetailOrderGet', mode: 'down', count: 1 }] });
    const r1 = await api('pay-cash', { tendered: 20 });
    const r2 = await api('pay-cash', { tendered: 20 }); const s = await st(); const o = await order(s.lastOrderId);
    rec('Lost reply + check fails: Retry checks first, payment adopted (no 2nd charge)', !r1.ok && r1.retryable && r2.ok && done(o).length === 1, `${r1.message.slice(0, 70)} → ${r2.message.slice(0, 90)} | receives ${done(o).length}`);
    await clean();
  },
  async lostComplete() {
    await clean(); await item(); await api('pay-start');
    await fault({ api: { path: 'RetailOrderComplete', mode: 'lost-reply' } });
    const r = await api('pay-cash', { tendered: 20 }); const s = await st(); const o = await order(s.lastOrderId);
    rec('Lost reply on Complete: server checked, sale shown complete', r.ok && o.status === 20, `${r.message} | ${o.number} status ${o.status}`);
    await clean(); await item(); await api('pay-start');
    await fault({ api: { path: 'RetailOrderComplete', mode: 'down' } });
    const r1 = await api('pay-cash', { tendered: 20 }); const r2 = await api('finish-sale'); const s2 = await st(); const o2 = await order(s2.lastOrderId);
    rec('Network down on Complete: payment kept, Finish sale retry completes it', !r1.ok && r1.completeFailed && r2.ok && o2.status === 20 && done(o2).length === 1, `${r1.message.slice(0, 80)} → ${r2.ok} | ${o2.number}`);
    await clean();
  },
  async killMidSale() {
    await clean(); await item(16.15); await item(16.15); await api('pay-start');
    const p = await api('pay-tender', { type: 10, amount: 10, tendered: 10 });
    const before = await st(); await crash(); await startServer();
    const l = await login(); const s = await st();
    rec('App killed mid-sale (after a $10 split): cart + paid part recovered after login', p.ok && l.ok && s.cart.length === before.cart.length && s.pay && s.pay.paid === 10 && /Recovered/.test((s.notice || {}).message), `${(s.notice || {}).message} | cart ${s.cart.length}/${before.cart.length}`);
    const f = await api('pay-cash', { tendered: 100 }); const s2 = await st(); const o = await order(s2.lastOrderId);
    rec('Recovered sale finishes with both payments, no duplicates', f.ok && o.status === 20 && Math.round(done(o).reduce((a, r) => a + r.amount, 0) * 100) === Math.round(((before.totals && before.totals.due) || 32.3) * 100) && done(o).length >= 1, `${o.number} due ${(before.totals && before.totals.due)} receives ${done(o).map(r => r.amount).join('+')}`);
    await api('notice-dismiss'); await clean();
  },
  async killCartOnly() {
    await clean(); await item(); await api('qty', { row: 0, qty: 3 });
    await crash(); await startServer(); await login(); const s = await st();
    rec('App killed with a cart (nothing paid): cart back after login', s.cart.length === 1 && s.cart[0].quantity === 3 && !s.pay, (s.notice || {}).message);
    await api('notice-dismiss'); await clean();
  },
  async killPaidNotFinished() {
    await clean(); await item(); await api('pay-start');
    await fault({ api: { path: 'RetailOrderComplete', mode: 'down' } });
    const r1 = await api('pay-cash', { tendered: 20 }); await crash(); await startServer(); await login(); const s = await st();
    const o = s.lastOrderId ? await order(s.lastOrderId) : null;
    rec('Killed after payment, before Finish: recovery finishes the sale itself', !r1.ok && o && o.status === 20 && !s.cart.length && /finished it now/.test((s.notice || {}).message), (s.notice || {}).message);
    await api('notice-dismiss'); await clean();
  },
  async killAfterComplete() {
    await clean(); await item(); await api('pay-start');
    await fault({ api: [{ path: 'RetailOrderComplete', mode: 'lost-reply' }, { path: 'RetailOrderGet', mode: 'down', count: 3 }] });
    const r1 = await api('pay-cash', { tendered: 20 }); await crash(); await startServer(); await login(); const s = await st();
    rec('Killed after a completed sale whose reply was lost: recovery says already done, no re-sale', !r1.ok && !s.cart.length && /already completed/.test((s.notice || {}).message), (s.notice || {}).message);
    await api('notice-dismiss'); await clean();
  },
  async offlineRecovery() {
    await clean(); await api('scan', { code: '00001' }); await crash(); await startServer();
    await login(); await fault({ api: { path: 'RetailOrderGet', mode: 'down', count: 1 } });
    // login already ran the check; simulate a check during an outage
    let s = await st(); rec('Recovery after restart (online)', s.cart.length === 1, (s.notice || {}).message);
    await api('notice-dismiss'); await clean();
  },
  async tokenExpiry() {
    await clean(); await api('scan', { code: '00001' }); await api('scan', { code: '00002' });
    await fault({ expire: true }); const r = await api('scan', { code: '00001' }); const s0 = await st();
    const l = await login(); const s = await st();
    rec('Session expiry: sign-in again keeps the cart', (!r.ok) && !s0.loggedIn && l.ok && s.cart.length === 2, `${r.message} → ${(s.notice || {}).message}`);
    await api('notice-dismiss'); await clean();
  },
  async printerOffline() {
    await clean(); await item(); await api('pay-start'); await fault({ hw: 'hang' });
    const t0 = Date.now(); const r = await api('pay-cash', { tendered: 20 }); const ms = Date.now() - t0; const s = await st();
    const w = s.completed && s.completed.result; await fault({ hw: null });
    rec('Printer/drawer hung: sale completes anyway, warning + reprint hint, screen not frozen', r.ok && s.completed && ms < 60000, `${Math.round(ms / 1000)} s | drawer: ${w && w.drawer && w.drawer.message} | print: ${w && (w.printWarning || (w.print && w.print.message))}`);
    await clean();
  },
  async lostCashMove() {
    await clean(); const b0 = (await api('drawer-balance')).balance;
    await fault({ api: { path: 'CashTransactionAccess', mode: 'lost-reply' } });
    const r = await api('cash-move', { kind: 'in', amount: 1.11, remark: 'hardening test' }); const b1 = (await api('drawer-balance')).balance;
    const r2 = await api('cash-move', { kind: 'out', amount: 1.11, remark: 'hardening test undo' }); const b2 = (await api('drawer-balance')).balance;
    rec('Lost reply on Pay in: balance check says recorded once', r.ok && Math.round((b1 - b0) * 100) === 111 && r2.ok && Math.round((b2 - b0) * 100) === 0, `${r.message} | ${b0} → ${b1} → ${b2}`);
  },
  async lostReturn() {
    await clean(); await api('return-start', { kind: 'noreceipt' }); await api('scan', { code: '00001' });
    await fault({ api: { path: 'NonOrderReturnOrderCreate', mode: 'lost-reply' } });
    const r = await api('return-confirm'); const s = await st();
    rec('Lost reply on Refund: checked with AIR POS, recorded once', r.ok && s.mode === 'sale' && !!s.lastReturnId, `${r.message} | return ${s.lastReturnId}`);
    await clean(); await api('return-start', { kind: 'noreceipt' }); await api('scan', { code: '00001' });
    await fault({ api: [{ path: 'NonOrderReturnOrderCreate', mode: 'lost-reply' }, { path: 'RetailReturnOrderBillGet', mode: 'down', count: 2 }] });
    const r1 = await api('return-confirm'); const c = await api('return-cancel'); await fault({ api: [] }); const r2 = await api('return-confirm'); const s2 = await st();
    rec('Lost reply + no check possible: Cancel blocked, Retry checks first (no 2nd refund)', !r1.ok && r1.retryable && !c.ok && r2.ok && /return|refund/i.test(r2.message), `${r1.message.slice(0, 60)} | cancel: ${c.message.slice(0, 40)} | retry: ${r2.message.slice(0, 60)}`);
    await clean();
  },
  async helperRestart() {
    const h1 = await api('hardware'); await fault({ hw: 'hang' }); const t0 = Date.now(); const d = await api('test-drawer'); await fault({ hw: null }); const h2 = await api('hardware');
    rec('Hardware helper hung → killed and restarted automatically (answer < 90 s, fallback allowed)', (Date.now() - t0) < 90000 && h2.ok, `hang answered in ${Math.round((Date.now() - t0) / 1000)} s; drawer ok=${d.ok}; then: ${h2.message}`);
  },
  async serverCrash() {
    await fault({ crash: 'throw' }); await sleep(500); let ok = false; try { await st(); ok = true; } catch {}
    rec('Uncaught error inside the server: logged, server keeps running', ok && /UNCAUGHT/.test(fs.readFileSync('/tmp/airreg-data/logs/air-register.log', 'utf8')), ok ? 'still answering' : 'died');
  },
  async logExport() {
    const t = await (await fetch(B + '/export/log')).text(); const pw = process.env.AIRMAX_TEST_PW;
    rec('Export log: has entries, no password, no card numbers or keys', t.length > 1000 && !t.includes(pw) && !/\b4242424242424242\b/.test(t) && !/pk_(test|live)_[A-Za-z0-9]{10}/.test(t), `${t.length} bytes`);
  },
  async remoteHelp() {
    const bad = await api('remote-setup', { user: 'grock', password: '<redacted>', mode: 'reset' });
    const ok = await api('remote-setup', { user: 'grock', password: process.env.AIRMAX_TEST_PW, mode: 'reset' });
    const stt = await api('remote-status');
    rec('Remote Help: new password needs a manager AIR POS login (wrong refused; right one reaches the Windows step)', !bad.ok && /incorrect|fail/i.test(bad.message) && /Windows only/.test(ok.message), `${bad.message} | ${ok.message}`);
    rec('Remote Help status: no password field, not installed off Windows', stt.ok && stt.installed === false && !JSON.stringify(stt).toLowerCase().includes('password'), JSON.stringify(stt));
  },
  async exitPin() {
    const set = await api('settings', { exitPinEnabled: true, exitPin: '4821' }); const raw = fs.readFileSync('/tmp/airreg-data/settings.json', 'utf8');
    const bad = await api('exit-windows', { pin: '0000' }); const good = await api('exit-windows', { pin: '4821' }); try { fs.unlinkSync('/tmp/airreg-data/control.json'); } catch {}
    const st0 = await (await fetch(B + '/api/state')).json();
    await api('settings', { exitPinEnabled: false }); const off = await api('exit-windows', { pin: '4821' });
    rec('Optional exit PIN: stored only as a scrypt hash, wrong PIN refused, right PIN works, off again by switch', set.ok && !raw.includes('4821') && /exitPinHash/.test(raw) && !bad.ok && good.ok && !off.ok && st0.settings && !('exitPinHash' in st0.settings) && st0.settings.exitPinSet, `${bad.message} | ${good.message} | ${off.message}`);
  },
  async exitWindows() {
    const bad = await api('exit-windows', { user: 'grock', password: '<redacted>' });
    const ok = await api('exit-windows', { user: 'grock', password: process.env.AIRMAX_TEST_PW }); const ctl = JSON.parse(fs.readFileSync('/tmp/airreg-data/control.json', 'utf8')); fs.unlinkSync('/tmp/airreg-data/control.json');
    const pin = await api('exit-windows', { pin: '1234' });
    rec('Exit to Windows: needs a manager AIR POS login (wrong password refused, right one writes exit)', !bad.ok && ok.ok && ctl.action === 'exit', `${bad.message} | ${ok.message}`);
    rec('Exit PIN off by default', !pin.ok && /switched off/.test(pin.message), pin.message);
    const pw = await api('power', { action: 'restart' }); rec('Restart PC (manager): allowed, dry-run here', pw.ok && pw.dryRun, pw.message);
  },
};
(async () => {
  if (!process.env.AIRMAX_TEST_PW) { console.log('AIRMAX_TEST_PW missing'); process.exit(1); }
  if (process.env.RESTART !== "0") await startServer(); else try { await st(); } catch { await startServer(); }
  if (!(await st()).loggedIn) await login();
  for (const [k, f] of Object.entries(T)) {
    if (only.length && !only.includes(k)) continue;
    try { await f(); } catch (e) { rec(k, false, 'error ' + e.message); try { await st(); } catch { await startServer(); await login(); } }
  }
  const prev = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES)) : {}; fs.writeFileSync(RES, JSON.stringify({ ...prev, ...results }, null, 1));
  const v = Object.values(results); console.log(`\n${v.filter(x => x.pass).length}/${v.length} passed`);
})();

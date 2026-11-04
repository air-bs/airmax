// AirMax Batch 6 (Gordon OK Nov 3 2026): fingerprint enrolment (148-152, 160, 162) and manager approval by fingerprint (8, 163, 162).
// OFFLINE: starts its OWN fake AIR POS servers + a FAKE reader service (made-up "templates" only), no real AIR POS, no real reader, no browser.
// NOT tested because NOT built: fingerprint login / unlock (7, 161, useFingerprint:true).
//   node tests/api-6-fingerprints.test.js     (ports: API6_PORT app M default 5263 (+hook 5264, reader 5267), cashier C 5265 (reader 5268), no-reader U 5266 (reader port 5269 left empty))
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const B0 = Number(process.env.API6_PORT || 5263), PM = B0, PH = B0 + 1, PC = B0 + 2, PU = B0 + 3, HM = B0 + 4, HC = B0 + 5, HU = B0 + 6;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api6-')), A = path.join(T, 'api'); fs.mkdirSync(A);
const APP = path.join(__dirname, '..', 'app', 'api');
const A2 = path.join(T, 'api2'); fs.mkdirSync(A2);   // A: plugin + Batch 3 stand-in (server M); A2: the plugin alone (cashier servers C and U: the fallback path, no Users session)
for (const d of [A, A2]) { fs.symlinkSync(path.join(APP, 'fingerprints.js'), path.join(d, 'fingerprints.js')); fs.symlinkSync(path.join(APP, 'fingerprints-hw.js'), path.join(d, 'fingerprints-hw.js')); }
// a stand-in for Batch 3's server file (ctx.usersSession): lets the test lock it, make it read-only, or take it away
fs.writeFileSync(path.join(A, 'zz-users-stub.js'), `module.exports = ctx => { const st = { locked: false, ro: false, gone: false };
  const mk = () => ({ api: () => (st.locked ? null : ctx.reg.api), canEdit: () => !st.ro });
  ctx.usersSession = mk();
  return { routes: { 'stub-users': async b => { Object.assign(st, b || {}); ctx.usersSession = st.gone ? undefined : mk(); return { ok: true, st }; } } }; };`);
const fails = []; let nPass = 0; const rec = (k, pass, note) => { if (!pass) fails.push(k); else nPass++; console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + String(note).slice(0, 160) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = (port) => { const B = 'http://127.0.0.1:' + port; return { B, post: (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), state: () => fetch(B + '/api/state').then(r => r.json()) }; };
const get = u => fetch(u).then(r => r.json());
const spawnFake = (port, env, logf) => cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(port), AIRMAX_API_DIR: env.FAKE_CASHIER ? A2 : A, ...env }, stdio: ['ignore', fs.openSync(logf, 'a'), fs.openSync(logf, 'a')] });
const waitUp = async (port) => { for (let i = 0; i < 60; i++) { try { await fetch('http://127.0.0.1:' + port + '/api/shortcuts'); return true; } catch (e) { await sleep(250); } } return false; };
(async () => {
  const LM = path.join(T, 'm.log'), LC = path.join(T, 'c.log'), LU = path.join(T, 'u.log');
  const procs = [spawnFake(PM, { FAKE_HOOK_PORT: String(PH), AIRMAX_FP_HW_PORT: String(HM) }, LM),
    spawnFake(PC, { FAKE_HOOK_PORT: 'off', FAKE_CASHIER: '1', AIRMAX_FP_HW_PORT: String(HC), AIRMAX_FP_WAIT_MS: '1800', AIRMAX_FP_TTL_MS: '3000' }, LC),
    spawnFake(PU, { FAKE_HOOK_PORT: 'off', FAKE_CASHIER: '1', AIRMAX_FP_HW_PORT: String(HU), FP_FAKE_HW: 'off' }, LU)];
  const M = mk(PM), C = mk(PC), U = mk(PU), hook = p => get('http://127.0.0.1:' + PH + p), hwM = p => get('http://127.0.0.1:' + HM + '/__fp/' + p), hwC = p => get('http://127.0.0.1:' + HC + '/__fp/' + p);
  const hasTpl = o => /TPL|FAKE-BUF/.test(JSON.stringify(o));
  const wait = async (X, route, body, pred, ms = 6000) => { const t0 = Date.now(); let r; while (Date.now() - t0 < ms) { r = await X.post(route, body); if (pred(r)) return r; await sleep(150); } return r; };
  try {
    for (const p of [PM, PC, PU]) if (!(await waitUp(p))) throw new Error('server on ' + p + ' did not start');
    const logOf = f => fs.readFileSync(f, 'utf8');
    rec('1 the plugin loads (fp routes registered) and the reader fake is up', /API plugins:.*fingerprints\.js \(\d+ routes\)/.test(logOf(LM)) && (await hwM('state')).ok === true, '');
    const nl = await M.post('fp-list', { operatorId: 'op-ann' });
    rec('2 every fingerprint route needs a login', nl.ok === false && nl.loggedOut === true && (await M.post('fp-mgr-start')).loggedOut === true && (await M.post('fp-enroll-save')).loggedOut === true, JSON.stringify(nl));
    for (const X of [M, C, U]) await X.post('login', { company: 'fake shop', user: 'tester', password: 'x' });

    // ------------------------------------------------ enrolment (manager server M; Batch 3 stand-in present and unlocked)
    const l1 = await M.post('fp-list', { operatorId: 'op-ann' });
    rec('3 148/149: fp-list shows the saved prints of one operator (id, finger no., count) and NO print data', l1.ok && l1.count === 2 && l1.prints.length === 2 && l1.prints[0].id === 'fp-a1' && l1.prints[0].count === 3 && l1.canEdit === true && !hasTpl(l1), JSON.stringify(l1).slice(0, 140));
    const mine = await M.post('fp-mine');
    rec('4 148: fp-mine answers with a count and finger numbers only', mine.ok && mine.count === 6 && Array.isArray(mine.indexes) && !hasTpl(mine), JSON.stringify(mine));
    const l0 = await M.post('fp-list', { operatorId: 'op-bob' });
    rec('5 an operator with no prints: count 0', l0.ok && l0.count === 0, JSON.stringify(l0));
    await hwM('reset');
    // happy path
    const s0 = await M.post('fp-enroll-start', { operatorId: 'op-bob' });
    rec('6 160: start enrolment answers waiting, step 0 of 3', s0.ok && s0.state === 'waiting' && s0.step === 0 && s0.of === 3, JSON.stringify(s0));
    const early = await M.post('fp-enroll-save');
    rec('7 Save before the 3 touches is refused and does NOT call AIR POS 150', early.ok === false && !(await hook('/fp-state')).log.some(x => x.path === '150'), early.message);
    const rd = await wait(M, 'fp-enroll-status', { operatorId: 'op-bob' }, r => r.state === 'ready');
    rec('8 three touches: status goes to ready (3 of 3), no print data in any answer', rd.state === 'ready' && rd.step === 3 && !hasTpl(rd) && !hasTpl(s0), JSON.stringify(rd));
    const calls = (await hwM('state')).calls.filter(c => c.name === 'FingerPrintInput');
    rec('9 160 was called 3 times; each call carried the prints known so far (0, then 1, then 2)', calls.length === 3 && calls.map(c => c.n).join() === '0,1,2', JSON.stringify(calls.map(c => c.n)));
    const sv = await M.post('fp-enroll-save');
    const fs1 = await hook('/fp-state'); const reg = fs1.log.filter(x => x.path === '150');
    rec('10 150: Save registers ONE fingerprint of 3 contents for that operator with a new id', sv.ok === true && reg.length === 1 && reg[0].operatorId === 'op-bob' && reg[0].n === 3 && reg[0].hasId === true && fs1.ops['op-bob'].length === 1, JSON.stringify(reg));
    rec('11 after Save the job is gone: a second Save is refused', (await M.post('fp-enroll-save')).ok === false && (await M.post('fp-enroll-status')).state === 'none', '');
    // failures
    for (const [mode, re, label] of [['dup', /already registered/, 'reader says the print already exists'], ['nofinger', /No finger/, 'no finger on the reader'], ['differ', /different finger/, 'a different finger']]) {
      await hwM('reset'); await hwM('mode?m=' + mode);
      await M.post('fp-enroll-start', { operatorId: 'op-bob' });
      const f = await wait(M, 'fp-enroll-status', {}, r => r.state === 'failed');
      rec('12-' + mode + ' ' + label + ': failed with the reader\'s plain message, nothing saved, reader stopped (162)', f.state === 'failed' && re.test(f.message) && (await M.post('fp-enroll-save')).ok === false && (await hwM('state')).calls.some(c => c.name === 'FingerPrintRegistStop'), f.message);
      await M.post('fp-enroll-cancel');
    }
    await hwM('reset'); await hwM('mode?m=hold');
    await M.post('fp-enroll-start', { operatorId: 'op-bob' });
    const w = await wait(M, 'fp-enroll-status', {}, r => r.state === 'waiting');
    const cc = await M.post('fp-enroll-cancel');
    rec('13 162: Cancel while the reader waits stops the reader, the job is gone, nothing saved', w.state === 'waiting' && cc.ok && (await hwM('state')).calls.some(c => c.name === 'FingerPrintRegistStop') && (await M.post('fp-enroll-status')).state === 'none' && (await hook('/fp-state')).ops['op-bob'].length === 1, '');
    await hwM('reset');
    // remove / clear need confirmation
    const rm0 = await M.post('fp-remove', { operatorId: 'op-ann', fingerprintId: 'fp-a2' }), cl0 = await M.post('fp-clear', { operatorId: 'op-cy' });
    let st = await hook('/fp-state');
    rec('14 152 / 151 without confirm: refused by the server, AIR POS not called', rm0.ok === false && cl0.ok === false && !st.log.some(x => x.path === '152' || x.path === '151'), rm0.message + ' / ' + cl0.message);
    const rm1 = await M.post('fp-remove', { operatorId: 'op-ann', fingerprintId: 'fp-a2', confirm: true });
    st = await hook('/fp-state');
    rec('15 152: Remove with confirm removes exactly that one print', rm1.ok && st.ops['op-ann'].length === 1 && st.ops['op-ann'][0].id === 'fp-a1' && st.log.filter(x => x.path === '152').length === 1, JSON.stringify(st.ops['op-ann']));
    const cl1 = await M.post('fp-clear', { operatorId: 'op-cy', confirm: true });
    st = await hook('/fp-state');
    rec('16 151: Clear all with confirm empties that operator only', cl1.ok && st.ops['op-cy'].length === 0 && st.ops['op-ann'].length === 1, JSON.stringify(st.ops));
    rec('17 a remove with a made-up id is refused by AIR POS and says so', (await M.post('fp-remove', { operatorId: 'op-ann', fingerprintId: 'nope', confirm: true })).ok === false, '');
    // Batch 3 session (stand-in)
    await M.post('stub-users', { locked: true });
    const lk = await M.post('fp-list', { operatorId: 'op-ann' }), lk2 = await M.post('fp-enroll-start', { operatorId: 'op-bob' });
    rec('18 Users manager session locked: every enrolment route says needUnlock and does nothing', lk.needUnlock === true && lk2.needUnlock === true && (await M.post('fp-clear', { operatorId: 'op-ann', confirm: true })).needUnlock === true && (await hook('/fp-state')).ops['op-ann'].length === 1, lk.message);
    await M.post('stub-users', { locked: false, ro: true });
    const ro = await M.post('fp-enroll-start', { operatorId: 'op-bob' }), ro2 = await M.post('fp-list', { operatorId: 'op-ann' });
    rec('19 Users session without the Operator Management menu: no list, no enrolment, no remove', ro.ok === false && ro2.ok === false && (await M.post('fp-remove', { operatorId: 'op-ann', fingerprintId: 'fp-a1', confirm: true })).ok === false && (await hook('/fp-state')).ops['op-ann'].length === 1, ro.message);
    await M.post('stub-users', { ro: false, gone: true });
    rec('20 no Users session at all (Batch 3 not loaded): falls back to this login\'s own menu (super admin here) and works', (await M.post('fp-list', { operatorId: 'op-ann' })).ok === true, '');
    await M.post('stub-users', { gone: false });

    // ------------------------------------------------ manager approval (cashier server C)
    await C.post('new-sale'); await C.post('dismiss'); await C.post('scan', { code: '1001' });
    const s1 = await C.state();
    rec('21 setup: C is a cashier (not an AIR POS manager) with one item', s1.user && s1.user.manager === false && s1.cart && s1.cart.length === 1, '');
    const tx0 = JSON.stringify((await C.state()).totals);
    const bad = await C.post('tax-exempt', { on: true, user: '@fingerprint', password: 'not-a-token' });
    rec('22 a made-up token is refused (tax unchanged)', bad.ok === false && /fingerprint approval/i.test(bad.message || '') && JSON.stringify((await C.state()).totals) === tx0, bad.message);
    const rnd = require('crypto').randomBytes(24).toString('hex'), bad2 = await C.post('price-approve', { user: '@fingerprint', password: rnd }), bad3 = await C.post('tax-exempt', { on: true, user: '@fingerprint', password: '' });
    rec('22b user @fingerprint with a random 48-hex password (or none) is refused', bad2.ok === false && bad3.ok === false && JSON.stringify((await C.state()).totals) === tx0, bad2.message);
    const spoof = [await C.post('tax-exempt', { on: true, user: '@fingerprint', password: 'mgr-1' }), await C.post('tax-exempt', { on: true, user: '@fingerprint', managerId: 'mgr-1' }), await C.post('price-approve', { user: '@fingerprint', password: 'mgr-2', managerId: 'mgr-2' })];
    rec('23 a manager id sent from the browser is NOT proof (as password or as an extra field)', spoof.every(x => x.ok === false), spoof.map(x => x.ok).join());
    await hwC('reset');
    const mgr0 = await C.post('fp-mgr-start');
    rec('24 fp-mgr-start answers at once (the work runs in the Node server)', mgr0.ok === true, JSON.stringify(mgr0));
    const ok1 = await wait(C, 'fp-mgr-status', {}, r => r.state === 'ok');
    const tk = (ok1.tokens || [])[0];
    rec('25 8 then 163: the Node server matched the finger; the browser gets ONLY one opaque random token (48 hex), no manager id, no print data', ok1.state === 'ok' && ok1.tokens.length === 1 && ok1.token === undefined && /^[0-9a-f]{48}$/.test(tk || '') && !/mgr-/.test(JSON.stringify(ok1)) && !hasTpl(ok1) && Object.keys(ok1).filter(k => k !== 'loggedIn').sort().join() === 'ok,state,tokens,ttl', JSON.stringify({ ...ok1, tokens: '(token)' }));
    const hc = (await hwC('state')).calls.filter(c => c.name === 'ManagerAuthorization');
    rec('26 163 got the managers\' prints that AIR POS (call 8) listed (2 managers, 6 prints) and nothing from the browser', hc.length === 1 && hc[0].n === 2, JSON.stringify(hc));
    const again = await C.post('fp-mgr-status');
    rec('27 the token is handed over once (the next status call has none)', again.state === 'ok' && !again.tokens && !again.token, JSON.stringify({ ...again }));
    const a1 = await C.post('price-approve', { user: '@fingerprint', password: tk }), a2 = await C.post('price-approve', { user: '@fingerprint', password: tk }), a3 = await C.post('tax-exempt', { on: true, user: '@fingerprint', password: tk });
    rec('28 the token approves ONCE (Price Change check); the same token a second time (price or Tax Off) is refused: single-use', a1.ok === true && a2.ok === false && a3.ok === false && !(await C.state()).order.taxExempt, JSON.stringify([a1.ok, a2.ok, a3.ok]));
    await hwC('reset'); await C.post('fp-mgr-start');
    const ok1b = await wait(C, 'fp-mgr-status', {}, r => r.state === 'ok');
    const tx = await C.post('tax-exempt', { on: true, user: '@fingerprint', password: ok1b.tokens[0] });
    rec('29 a fresh scan approves Tax Off (cashier, no password)', tx.ok === true && tx.taxExempt === true, JSON.stringify(tx).slice(0, 120));
    await C.post('tax-exempt', { on: false });
    // Price Change checks the manager twice (price-approve, then price-change): one scan, two one-time tokens
    await hwC('reset'); await C.post('fp-mgr-start', { tokens: 2 });
    const ok2t = await wait(C, 'fp-mgr-status', {}, r => r.state === 'ok'), [pa, pb] = ok2t.tokens || [];
    rec('29b Price Change: one scan gives exactly two different one-time tokens ', ok2t.tokens.length === 2 && pa !== pb && /^[0-9a-f]{48}$/.test(pa) && /^[0-9a-f]{48}$/.test(pb), '');
    const pc1 = await C.post('price-approve', { user: '@fingerprint', password: pa });
    const pc2 = await C.post('price-change', { row: 0, value: '9.50', user: '@fingerprint', password: pb });
    const pc3 = await C.post('price-approve', { user: '@fingerprint', password: pa }), pc4 = await C.post('price-approve', { user: '@fingerprint', password: pb });
    rec('29c token 1 approves price-approve, token 2 approves price-change (price applied); both are then dead', pc1.ok === true && pc2.ok === true && pc3.ok === false && pc4.ok === false, JSON.stringify([pc1.ok, pc2.ok, pc3.ok, pc4.ok]));
    await hwC('reset'); await C.post('fp-mgr-start', { tokens: 7 });
    const ok7 = await wait(C, 'fp-mgr-status', {}, r => r.state === 'ok');
    rec('29d asking for 7 tokens gives at most 2 (only 2 is honoured, anything else is 1)', ok7.tokens.length >= 1 && ok7.tokens.length <= 2, String(ok7.tokens.length));
    await C.post('fp-mgr-start'); await C.post('fp-mgr-cancel');
    // password approval unchanged
    const pw1 = await C.post('price-approve', { user: 'boss', password: 'boss-pw' }), pw2 = await C.post('price-approve', { user: 'boss', password: 'wrong' }), pw3 = await C.post('price-approve', {});
    rec('30 password approval works exactly as before: right login ok, wrong login refused, none asks for a manager', pw1.ok === true && pw2.ok === false && pw3.needManager === true, [pw1.ok, pw2.ok, pw3.needManager].join());
    // refusals
    await hwC('mode?m=nomatch'); await C.post('fp-mgr-start');
    const nm = await wait(C, 'fp-mgr-status', {}, r => r.state === 'failed');
    rec('31 a finger that matches no manager: failed with a plain message, no token', nm.state === 'failed' && !nm.token && /does not match|not recognised/.test(nm.message), nm.message);
    await hwC('mode?m=rogue'); await C.post('fp-mgr-start');
    const rg = await wait(C, 'fp-mgr-status', {}, r => r.state === 'failed');
    rec('32 the reader names a manager AIR POS never listed: refused, no token', rg.state === 'failed' && !rg.token, rg.message);
    await hwC('reset'); await hwC('mode?m=hold'); await C.post('fp-mgr-start');
    const hd = await wait(C, 'fp-mgr-status', {}, r => r.state === 'waiting');
    const cn = await C.post('fp-mgr-cancel'); await sleep(200);
    rec('33 162: Cancel while waiting stops the reader and the status is none', hd.state === 'waiting' && cn.ok && (await hwC('state')).calls.some(c => c.name === 'FingerPrintRegistStop') && (await C.post('fp-mgr-status')).state === 'none', '');
    await hwC('reset'); await hwC('mode?m=hold'); await C.post('fp-mgr-start');
    const to = await wait(C, 'fp-mgr-status', {}, r => r.state === 'failed', 6000);
    rec('34 162: nobody touches the reader: it times out (1.8 s in this test), says so, and the reader is stopped', to.state === 'failed' && /ran out/i.test(to.message) && (await hwC('state')).calls.some(c => c.name === 'FingerPrintRegistStop'), to.message);
    await hwC('reset'); await C.post('fp-mgr-start');
    const ok2 = await wait(C, 'fp-mgr-status', {}, r => r.state === 'ok');
    await sleep(3400);
    const ex = await C.post('price-approve', { user: '@fingerprint', password: ok2.tokens[0] });
    rec('35 a token expires (3 s in this test): refused', ok2.state === 'ok' && ex.ok === false, ex.message);
    await hwC('reset'); await C.post('fp-mgr-start');
    const ok3 = await wait(C, 'fp-mgr-status', {}, r => r.state === 'ok');
    await C.post('logout'); await C.post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    const lo = await C.post('price-approve', { user: '@fingerprint', password: ok3.tokens[0] });
    rec('36 a token does not survive a logout / new login', ok3.state === 'ok' && lo.ok === false, lo.message);
    // Gordon's rule: no fingerprint on Exit to Windows. Refused before managerCheck, so the token is not even used up.
    await hwC('reset'); await C.post('fp-mgr-start');
    const okx = await wait(C, 'fp-mgr-status', {}, r => r.state === 'ok');
    const ex1 = await C.post('exit-windows', { user: '@fingerprint', password: okx.tokens[0] });
    rec('36b a fingerprint is refused for Exit to Windows (nothing exits)', okx.state === 'ok' && ex1.ok === false && !ex1.exiting && /cannot be used here/.test(ex1.message || ''), JSON.stringify([ex1.ok]));
    const exOk = await C.post('price-approve', { user: '@fingerprint', password: okx.tokens[0] });
    rec('36c ...and the refusal did not use the token up (it still approves a normal approval once)', exOk.ok === true, JSON.stringify(exOk).slice(0, 100));
    const exPw = await C.post('exit-windows', { user: 'boss', password: 'wrong' });
    rec('36d Exit to Windows with a wrong manager password is refused as before (password path unchanged, not the fingerprint message)', exPw.ok === false && !/fingerprint/i.test(exPw.message || ''), exPw.message);
    // ------------------------------------------------ the token store itself, in this process (stub register, the real plugin file, the fake reader of server M)
    {
      process.env.AIRMAX_FP_HW_PORT = String(HM); process.env.AIRMAX_FP_TTL_MS = '1500'; process.env.AIRMAX_FP_WAIT_MS = '4000';
      const logs = [], reg = { identity: 'who-1', api: { loggedIn: true, retail: async () => [{ operatorId: 'mgr-1', fingerprints: [{ index: 1, contents: ['TPL-X'] }] }] } };
      const plugin = require(path.join(APP, 'fingerprints.js'))({ reg, log: m => logs.push(m), hasMenu: () => true });
      const grant = async (n) => { await hwM('reset'); await plugin.routes['fp-mgr-start']({ tokens: n }); let r; for (let i = 0; i < 60; i++) { r = await plugin.routes['fp-mgr-status'](); if (r.state === 'ok' && r.tokens) break; await sleep(100); } return r.tokens || []; };
      const T1 = await grant(1);
      rec('43 (in-process) a token passes once and is gone: the second check is refused', T1.length === 1 && reg.fpApproval(T1[0]) === true && reg.fpApproval(T1[0]) === false && reg.fpApproval(T1[0]) === false, '');
      const T2 = await grant(1);
      rec('44 a token from another register login is refused', (reg.identity = 'who-2', reg.fpApproval(T2[0]) === false), '');
      reg.identity = 'who-1';
      rec('45 ...and that failed check BURNED it: back on the original login it is still refused', reg.fpApproval(T2[0]) === false, '');
      const T3 = await grant(2);
      reg.identity = 'who-3'; const f1 = reg.fpApproval(T3[0]); reg.identity = 'who-1';
      rec('46 a failed check burns the sibling token of the same scan too (Price Change)', f1 === false && reg.fpApproval(T3[1]) === false, '');
      const T4 = await grant(1); await sleep(1700);
      rec('47 an expired token is refused (1.5 s here)', reg.fpApproval(T4[0]) === false, '');
      const T5 = await grant(1); await sleep(1700);
      const realNow = Date.now, t0 = realNow(); Date.now = () => t0 - 5000;   // pretend it is still early: only a token already DELETED at its expiry can still fail
      const late = reg.fpApproval(T5[0]); Date.now = realNow;
      rec('48 the token is deleted at its 120 s expiry (1.5 s here), not only refused when checked', late === false, '');
      const T6 = await grant(1); reg.api.loggedIn = false; const lo2 = reg.fpApproval(T6[0]); reg.api.loggedIn = true;
      rec('49 a logged-out register refuses a token and burns it', lo2 === false && reg.fpApproval(T6[0]) === false, '');
      const T7 = await grant(2), u1 = reg.fpApproval(T7[1]), u2 = reg.fpApproval(T7[0]);
      rec('50 the two tokens of one scan work in any order, once each', u1 === true && u2 === true && reg.fpApproval(T7[0]) === false && reg.fpApproval(T7[1]) === false, '');
      const st = await plugin.routes['fp-mgr-status']();
      const T8 = await grant(2); await sleep(1000); const first = reg.fpApproval(T8[0]); await sleep(900);   // 1.9 s after the scan: past the first expiry, but the sibling got a fresh window when the first was used
      const second = reg.fpApproval(T8[1]);
      rec('51 the second Price Change token gets its own window from the first use (still valid 1.9 s after the scan with a 1.5 s expiry), and only once', first === true && second === true, '');
      global.__fp6tokens = [...T1, ...T2, ...T3, ...T4, ...T5, ...T6, ...T7, ...T8];
      const lg2 = logs.join('\n');
      rec('52 nothing the plugin logged holds a token or a manager id', global.__fp6tokens.every(t => !lg2.includes(t)) && !/mgr-1|TPL-X/.test(lg2) && /FINGERPRINT/.test(lg2), logs.slice(0, 2).join(' | '));
      rec('53 status answers hold only opaque tokens: no manager id, no print data', !/mgr-1|TPL/.test(JSON.stringify(st)), JSON.stringify(st));
    }
    // no managers saved / no reader
    await hook('/fp-managers?none=1'); await M.post('fp-mgr-start');
    const nn = await wait(M, 'fp-mgr-status', {}, r => r.state !== 'loading');
    await hook('/fp-managers?none=0');
    rec('37 no manager has a saved print: state unavailable (the pop-up shows nothing extra)', nn.state === 'unavailable', nn.message);
    await U.post('fp-mgr-start');
    const nu = await wait(U, 'fp-mgr-status', {}, r => r.state !== 'loading' && r.state !== 'waiting');
    rec('38 no reader service on this PC (nothing on the port): state unavailable, plain message, register unaffected', nu.state === 'unavailable' && /reader service/.test(nu.message || ''), nu.message);
    // cashier cannot enrol
    const ce = [await C.post('fp-list', { operatorId: 'op-ann' }), await C.post('fp-enroll-start', { operatorId: 'op-bob' }), await C.post('fp-clear', { operatorId: 'op-ann', confirm: true }), await C.post('fp-remove', { operatorId: 'op-ann', fingerprintId: 'fp-a1', confirm: true })];
    rec('39 a cashier (no Operator Management menu) cannot list, enrol, clear or remove', ce.every(x => x.ok === false) && (await hook('/fp-state')).ops['op-ann'].length === 1, ce.map(x => x.ok).join());
    // login is NOT built
    const noLogin = fs.readFileSync(path.join(APP, 'fingerprints.js'), 'utf8') + fs.readFileSync(path.join(APP, 'fingerprints-hw.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'sections', 'fingerprints.js'), 'utf8');
    rec('40 NO fingerprint login: no FingerprintSelectByUserName (7), no FingerPrintVerification (161), no useFingerprint', !/FingerprintSelectByUserName|FingerPrintVerification|useFingerprint/.test(noLogin.replace(/\/\/.*$/gm, '')), '');
    // nothing sensitive in the logs
    const lg = logOf(LM) + logOf(LC) + logOf(LU), tokens = [tk, ok1b.tokens[0], pa, pb, ...ok7.tokens, ...ok2.tokens, ...ok3.tokens, ...(global.__fp6tokens || [])].filter(Boolean);
    rec('41 the server logs hold no print data and no token (outcomes only)', !/TPL|FAKE-BUF/.test(lg) && tokens.every(t => !lg.includes(t)) && /FINGERPRINT/.test(lg), (lg.match(/FINGERPRINT[^\n]*/g) || []).slice(0, 3).join(' | '));
    rec('42 the logs never name a manager id for an approval', !/mgr-1|mgr-2|mgr-evil/.test(lg), '');
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 500)); }
  finally { for (const p of procs) try { p.kill(); } catch (e) { /* gone */ } fs.rmSync(T, { recursive: true, force: true }); }
  console.log(fails.length ? `${nPass}/${nPass + fails.length} passed; ${fails.length} failed: ${fails.join('; ')}` : `${nPass}/${nPass} passed. ALL PASSED`);
  process.exit(fails.length ? 1 : 0);
})();

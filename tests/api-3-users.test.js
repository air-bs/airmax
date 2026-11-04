// AirMax Batch 3 (Users and operators): the server side. Starts its OWN fake AIR POS (offline, made-up data) twice:
//   A) the register is logged in as a CASHIER (FAKE_CASHIER=1): the manager session (a second in-memory login) must do the work
//   B) the register is logged in as a MANAGER: no password asked, the register's own session is used
//   node tests/api-3-users.test.js     (ports: API3_PORT, default 5235 (+hook 5236) and 5237 (+hook 5238); idle time shortened to 3 s for the test)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PA = Number(process.env.API3_PORT || 5235), PB = PA + 2, IDLE = 3000;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api3-'));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' - ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
function boot(port, extra) {
  const dir = path.join(T, 'data' + port), log = path.join(T, 'srv' + port + '.log'); fs.mkdirSync(dir);
  const out = fs.openSync(log, 'a');
  procs.push(cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(port), FAKE_HOOK_PORT: String(port + 1), FAKE_DATA_DIR: dir, AIRMAX_USERS_IDLE_MS: String(IDLE), ...extra }, stdio: ['ignore', out, out] }));
  const B = 'http://127.0.0.1:' + port, H = 'http://127.0.0.1:' + (port + 1);
  return { dir, log, post: (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), hook: p => fetch(H + p).then(r => r.json()), L: () => fs.readFileSync(log, 'utf8'), B };
}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
(async () => {
  const A = boot(PA, { FAKE_CASHIER: '1' }), Bm = boot(PB, {});
  try {
    for (const s of [A, Bm]) for (let i = 0; i < 40; i++) { try { await fetch(s.B + '/api/shortcuts'); break; } catch (e) { await sleep(250); } }
    const SECRETS = ['mgr-pw', 'nomenu-pw', 'cash-pw', 'mgr-token', 'nomenu-token', 'cash-token', 'fake-token', 'boss-pw'];
    const login = (s, u) => s.post('login', { company: 'fake shop', user: u || 'tester', password: 'x' });
    const st = async s => (await s.hook('/users-state'));

    // ---------- A: cashier register
    rec('1 logged out: every Users route needs the register login', (await A.post('users-list')).loggedOut === true && (await A.post('users-unlock', {})).loggedOut === true, '');
    await login(A);
    const me = await A.post('state'); rec('2 the register is logged in as a cashier (not a manager)', me.loggedIn && !(me.user && me.user.manager), JSON.stringify(me.user && { manager: me.user.manager }));
    const locks = await Promise.all(['users-list', 'users-get', 'users-pick', 'users-create', 'users-change'].map(n => A.post(n, { id: 'op-1', confirm: true, name: 'x' })));
    rec('3 before the unlock nothing is served: list, get, pick, create, change all answer "manager approval needed"', locks.every(r => r.ok === false && r.needUnlock === true), JSON.stringify(locks.map(r => r.needUnlock)));
    rec('3b ...and the fake AIR POS saw no operator call at all', (await st(A)).log.length === 0, '');
    const un = await A.post('users-unlock', {});
    rec('4 unlock without a manager user name and password is refused (cashier register)', un.ok === false && !un.needUnlock && /manager user name and password/i.test(un.message), JSON.stringify(un));
    rec('4b a wrong manager password is refused with the AIR POS message', (await A.post('users-unlock', { user: 'mgr1', password: 'nope' })).ok === false, '');
    const nm = await A.post('users-unlock', { user: 'cash2', password: 'cash-pw' });
    rec('4c a login that is not a manager is refused ("not a manager"), and its session is dropped', nm.ok === false && /not a manager/i.test(nm.message) && (await A.post('users-list')).needUnlock === true, JSON.stringify(nm));
    const ok1 = await A.post('users-unlock', { user: 'mgr1', password: 'mgr-pw' });
    rec('5 manager pop-up login (second in-memory login) unlocks: ok, manager name, Operator Management gate = true', ok1.ok === true && ok1.manager === 'mgr1' && ok1.canEdit === true && ok1.idleMs === IDLE && !('password' in ok1) && !('ide' in ok1), JSON.stringify(ok1));
    const me2 = await A.post('state'); rec('6 the register itself stays logged in as the cashier (the manager session is separate)', me2.loggedIn && me2.user && me2.user.user !== 'mgr1' && !me2.user.manager, JSON.stringify(me2.user && { user: me2.user.user, manager: me2.user.manager }));
    const l1 = await A.post('users-list', {});
    rec('7 list (144) works with the manager session: 3 rows, total 3, page 1', l1.ok && l1.rows.length === 3 && l1.total === 3 && l1.page === 1 && l1.canEdit === true, JSON.stringify(l1).slice(0, 200));
    rec('7b list rows carry only id, name, userName, position, createTime (no phone / email)', l1.rows.every(r => Object.keys(r).sort().join() === 'createTime,fingerPrintCount,fingerPrints,id,name,position,userName'), '');
    const fp1 = l1.rows.find(r => r.id === 'op-1'), fp2 = l1.rows.find(r => r.id === 'op-2'), fp3 = l1.rows.find(r => r.id === 'op-3'), raw = JSON.stringify(l1);
    rec('7c fingerprints: op-1 has fingerPrintCount 2 and fingerPrints [{ id, fingerIndex, createTime }, { id, fingerIndex }]; op-2 (empty array) and op-3 (none) count 0', fp1.fingerPrintCount === 2 && JSON.stringify(fp1.fingerPrints) === JSON.stringify([{ id: 'fp-1', fingerIndex: 1, createTime: '2026-10-05 08:00:00' }, { id: 'fp-2', fingerIndex: 6 }]) && fp2.fingerPrintCount === 0 && fp2.fingerPrints.length === 0 && fp3.fingerPrintCount === 0 && fp3.fingerPrints.length === 0, JSON.stringify([fp1, fp2.fingerPrintCount, fp3.fingerPrintCount]).slice(0, 300));
    rec('7d no biometric data leaves the server: contents / template / feature / buffer values and field names never appear in the list answer', !/BIOX|TPLY|FEAT-SECRET|BUF-SECRET|contents|captureTemplate|featureData|fingerprintBuffer|operatorId/.test(raw), '');
    const l2 = await A.post('users-list', { name: 'bob' });
    rec('8 name search: "bob" finds 1 operator', l2.ok && l2.rows.length === 1 && l2.rows[0].userName === 'zz.bob' && l2.total === 1, JSON.stringify(l2.rows));
    rec('8b a search with no match answers an empty list, not an error', (await A.post('users-list', { name: 'nobody-zz' })).total === 0, '');
    const g1 = await A.post('users-get', { id: 'op-1' });
    rec('9 get (145) loads one operator for Edit: name, phone, email, position, description, userId, userName', g1.ok && g1.operator.name === 'ZZ Test Alice' && g1.operator.phone === '555-0101' && g1.operator.userId === 'u-1' && g1.operator.position === 'Cashier', JSON.stringify(g1.operator));
    rec('9b get of an unknown id is a clean error', (await A.post('users-get', { id: 'nope' })).ok === false && (await A.post('users-get', {})).ok === false, '');
    const pk = await A.post('users-pick', {});
    rec('10 login picker (20, base host): 5 logins with id, userName, realName only', pk.ok && pk.rows.length === 5 && pk.rows.every(r => Object.keys(r).sort().join() === 'id,realName,userName'), JSON.stringify(pk).slice(0, 160));
    rec('10b picker search by user name: "dave" finds 1', (await A.post('users-pick', { text: 'dave' })).rows.length === 1, '');
    const s1 = await st(A);
    rec('11 the fake AIR POS saw 144, 145 and 20 from the MANAGER session and nothing from the register (it refuses non-manager callers)', ['144', '145', '20'].every(p => s1.log.some(x => x.path === p && x.caller === 'manager')) && !s1.log.some(x => x.caller === 'register' || x.refused), JSON.stringify(s1.log.map(x => x.path + ':' + x.caller)));
    // writes
    const body = { name: 'ZZ test Frank', phone: '555-0199', email: 'frank@example.com', position: 'Floor', description: 'made up', userId: 'u-4', userName: 'zz.dave' };
    rec('12 create without the confirm flag is refused (confirm step)', (await A.post('users-create', body)).ok === false, '');
    rec('12b create needs a name and a chosen login', (await A.post('users-create', { ...body, name: '', confirm: true })).ok === false && (await A.post('users-create', { ...body, userId: '', confirm: true })).ok === false && (await A.post('users-create', { ...body, email: 'bad', confirm: true })).ok === false, '');
    const c1 = await A.post('users-create', { ...body, confirm: true });
    const s2 = await st(A), added = s2.ops.find(o => o.name === 'ZZ test Frank');
    rec('13 create (146) saves the operator on the fake AIR POS with the manager session', c1.ok === true && !!added && added.userName === 'zz.dave' && added.position === 'Floor' && /^[0-9a-f-]{20,}$/i.test(added.id) && s2.log.some(x => x.path === '146' && x.caller === 'manager'), JSON.stringify(c1));
    rec('13b the same login cannot be added twice (AIR POS message shown, nothing added)', (await A.post('users-create', { ...body, name: 'ZZ test Gina', confirm: true })).ok === false && (await st(A)).ops.length === 4, '');
    await A.hook('/users-slow?ms=500');
    const two = await Promise.all([A.post('users-create', { ...body, name: 'ZZ test H1', userId: 'u-5', userName: 'zz.erin', confirm: true }), A.post('users-create', { ...body, name: 'ZZ test H2', userId: 'u-5', userName: 'zz.erin', confirm: true })]);
    await A.hook('/users-slow?ms=0');
    rec('13c two Save presses at once: the second is answered busy, only one operator is added', two.some(x => x.busy === true) && (await st(A)).ops.filter(o => o.userName === 'zz.erin').length === 1, JSON.stringify(two.map(x => x.busy ? 'busy' : x.ok)));
    const ch = await A.post('users-change', { id: 'op-2', name: 'ZZ Test Bob', phone: '555-0102', email: 'bob@example.com', position: 'Lead', description: '', userId: 'u-2', userName: 'zz.bob', confirm: true });
    const s3 = await st(A);
    rec('14 change (147) saves the edit; list shows the new position', ch.ok === true && s3.ops.find(o => o.id === 'op-2').position === 'Lead' && (await A.post('users-list', { name: 'bob' })).rows[0].position === 'Lead', JSON.stringify(ch));
    rec('14b change needs the confirm flag and an id', (await A.post('users-change', { id: 'op-2', name: 'x' })).ok === false && (await A.post('users-change', { name: 'x', confirm: true })).ok === false, '');
    rec('14c change of an unknown operator answers the AIR POS error', (await A.post('users-change', { id: 'zz-none', name: 'x', confirm: true })).ok === false, '');
    // lock
    const nLog = (await st(A)).log.length;
    await A.post('users-lock');
    const aft = await A.post('users-list');
    rec('15 users-lock (leaving the screen) drops the manager session: list needs approval again', aft.ok === false && aft.needUnlock === true && (await A.post('users-status')).unlocked === false, JSON.stringify(aft));
    rec('15b the manager token is no longer used after the lock', (await st(A)).log.length === nLog, '');

    // gate: manager without Operator Management
    const nmn = await A.post('users-unlock', { user: 'nomenu1', password: 'nomenu-pw' });
    rec('16 a manager WITHOUT the Operator Management menu unlocks, but canEdit is false (screen hides Add Operator / Edit)', nmn.ok === true && nmn.canEdit === false, JSON.stringify(nmn));
    const before = (await st(A)).log.length;
    const nl = await A.post('users-list'), np = await A.post('users-pick'), nc = await A.post('users-create', { ...body, userId: 'u-9', confirm: true }), ng = await A.post('users-change', { id: 'op-1', name: 'x', confirm: true });
    rec('17 without the menu: list still works; picker, create and change are refused by the server too, and no write reaches AIR POS', nl.ok && nl.canEdit === false && np.ok === false && nc.ok === false && ng.ok === false && !(await st(A)).log.slice(before).some(x => /^(146|147|20)$/.test(x.path)), JSON.stringify([np.message, nc.message]));
    await A.post('users-lock');

    // idle timeout
    const t0 = Date.now(); await A.post('users-unlock', { user: 'mgr1', password: 'mgr-pw' });
    await sleep(IDLE * 0.6); const tc = await A.post('users-touch');
    await sleep(IDLE * 0.6); const still = await A.post('users-list');
    rec('18 activity (users-touch) keeps the session open past the idle time counted from the unlock', tc.ok === true && still.ok === true && Date.now() - t0 > IDLE, JSON.stringify([tc.ok, still.ok]));
    await sleep(IDLE + 600);
    const gone = await A.post('users-list');
    rec('19 after the idle time with no use the session is dropped on its own (logged "closed (idle)"), list needs approval again', gone.needUnlock === true && /USERS manager session closed \(idle\)/.test(A.L()), JSON.stringify(gone));
    // register logout / a new register login
    await A.post('users-unlock', { user: 'mgr1', password: 'mgr-pw' }); await A.post('logout');
    await sleep(2600);
    rec('20 when the register logs out the manager session is dropped within seconds (logged "register user changed")', /USERS manager session closed \(register user changed\)/.test(A.L()), '');
    await login(A); rec('20b and a new register login starts locked', (await A.post('users-list')).needUnlock === true && (await A.post('users-status')).unlocked === false, '');
    // unlock replaced by a new unlock
    await A.post('users-unlock', { user: 'mgr1', password: 'mgr-pw' }); const n1 = (await st(A)).mgrLogins; await A.post('users-unlock', { user: 'mgr1', password: 'mgr-pw' });
    rec('21 a second unlock replaces the first (one manager session at a time)', (await st(A)).mgrLogins === n1 + 1 && (await A.post('users-list')).ok === true, '');
    await A.post('users-lock');

    // no secrets in the log or on disk
    const log = A.L();
    const leak = SECRETS.filter(s => log.includes(s));
    rec('22 no password or token in the server log', !leak.length && /USERS approved by manager login mgr1/.test(log), leak.join() || 'clean');
    rec('22b no operator data (names, phone, email) in the server log', !/Frank|555-01|@example\.com|ZZ Test Alice/.test(log), '');
    const files = walk(A.dir), onDisk = files.filter(f => { try { const t = fs.readFileSync(f, 'latin1'); return SECRETS.some(s => t.includes(s)); } catch (e) { return false; } });
    rec('22c no password or token written to the app data folder (' + files.length + ' files checked)', !onDisk.length, onDisk.map(f => path.basename(f)).join());

    // ---------- B: manager register
    await login(Bm);
    const mb = await Bm.post('users-unlock', {});
    rec('23 a logged-in manager unlocks with no password and no second login', mb.ok === true && mb.canEdit === true && (await Bm.hook('/users-state')).mgrLogins === 0, JSON.stringify(mb));
    const lb = await Bm.post('users-list');
    rec('24 and the list is read with the register\'s own session', lb.ok && lb.rows.length === 3 && (await Bm.hook('/users-state')).log.some(x => x.path === '144' && x.caller === 'register-manager'), '');
    await Bm.post('users-lock'); const lb2 = await Bm.post('users-list');
    rec('25 lock ends it for the manager register too (and does not log the register out)', lb2.needUnlock === true && (await Bm.post('state')).loggedIn === true, '');
    const lbLog = Bm.L(); rec('26 no password or token in the manager register log either', !SECRETS.some(s => lbLog.includes(s)), '');
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 500)); }
  finally { procs.forEach(p => p.kill()); fs.rmSync(T, { recursive: true, force: true }); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

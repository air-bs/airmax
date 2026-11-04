// AirMax Step 0: the two loaders (app/api/*.js in the server, tests/fake-api/*.js in the fake) and the perms / sections routes.
// Starts its OWN fake server (offline, made-up data) with sample plugin folders in a temp dir. No real AIR POS, no browser.
//   node tests/api-0-loaders.test.js     (port: API0_PORT, default 5190; hook server off)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PORT = Number(process.env.API0_PORT || 5190), BASE = 'http://127.0.0.1:' + PORT;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api0-')), A = path.join(T, 'api'), F = path.join(T, 'fake-api'); fs.mkdirSync(A); fs.mkdirSync(F);
fs.writeFileSync(path.join(A, 'a-good.js'), `module.exports = ctx => ({
  routes: {
    'x0-read': async b => { const r = await ctx.reg.api.retail('/X0/Read', { id: String(b.id || '') }); return { ok: true, got: r.value, manager: ctx.isManager(), menu: ctx.hasMenu('Operator Management') }; },
    'x0-save': async b => { await new Promise(r => setTimeout(r, 400)); const r = await ctx.reg.api.submit('/X0/Save', { n: Number(b.n) || 0 }); return { ok: !!r.success, saved: r.value }; },
    'scan': async () => ({ ok: true, hijacked: true }),   // clashes with a built-in route: must be refused
    'bad name!': async () => ({ ok: true }),
    'x0-open': async () => ({ ok: true, open: true }),
  }, unlocked: ['x0-read'], once: ['x0-save'], noSnap: ['x0-save'], open: ['x0-open'] });`);
fs.writeFileSync(path.join(A, 'b-plain-object.js'), `module.exports = { routes: { 'x0-plain': async () => ({ ok: true, plain: true }) } };`);
fs.writeFileSync(path.join(A, 'c-broken.js'), `throw new Error('sample plugin that fails to load');`);
fs.writeFileSync(path.join(A, 'd-noroutes.js'), `module.exports = () => ({});`);
fs.writeFileSync(path.join(A, 'notes.txt'), 'not a plugin');
fs.writeFileSync(path.join(F, 'a-x0.js'), `module.exports = ({ handlers, hooks, fake, ok }) => {
  handlers['/X0/Read'] = p => ok({ id: p.id, name: 'made-up' });
  handlers['/X0/Save'] = p => { (fake.x0 = fake.x0 || []).push(JSON.parse(p.submit)); return ok({ saved: fake.x0.length }); };
  hooks['/x0-state'] = (u, res, f) => res.end(JSON.stringify(f.x0 || []));
};`);
fs.writeFileSync(path.join(F, 'b-menus.js'), `module.exports = ({ handlers }) => { const h = handlers['/Home/Index'];   // AIR POS menu entries: one with only a uri, one nested with only a uri, one with a url
  handlers['/Home/Index'] = p => ({ ...h(p), menus: [{ name: 'Operator Management', uri: '/operator-manage' }, { title: 'Reports', children: [{ label: 'Shifts', uri: '/report/shifts' }] }, { name: 'Old Style', url: '/old-style' }] }); };`);
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(async r => ({ status: r.status, j: await r.json() }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const log = path.join(T, 'srv.log');
  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: 'off', AIRMAX_API_DIR: A, AIRMAX_FAKE_API_DIR: F }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/shortcuts'); break; } catch (e) { await sleep(250); } }
    const L = () => fs.readFileSync(log, 'utf8');
    rec('1 plugins load in name order; a broken file and a no-routes file are skipped with a log line, the register still starts', /API PLUGIN c-broken\.js not loaded/.test(L()) && /API PLUGIN d-noroutes\.js not loaded/.test(L()) && /API plugins: a-good\.js \(3 routes\), b-plain-object\.js \(1 routes\)/.test(L()), (L().match(/API[^\n]*/g) || []).join(' || ').slice(0, 300));
    rec('2 a route that clashes with a built-in (scan) or has a bad name is refused and logged', /route scan already exists/.test(L()) && /bad route bad name!/.test(L()), '');
    const nl = await post('x0-read', { id: 'q' });
    rec('3 a plugin route needs a login (logged out: Not logged in)', nl.j.ok === false && nl.j.loggedOut === true, JSON.stringify(nl.j));
    rec('4 an `open` route works logged out', (await post('x0-open')).j.open === true, '');
    await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    const r1 = await post('x0-read', { id: 'q7' });
    rec('5 plugin route calls the (fake) AIR POS through reg.api.retail; ctx.isManager / ctx.hasMenu answer', r1.j.ok && r1.j.got && r1.j.got.id === 'q7' && r1.j.got.name === 'made-up' && r1.j.manager === true && r1.j.menu === true, JSON.stringify(r1.j));
    const r2 = await post('x0-save', { n: 5 });
    rec('6 plugin route posts a JSON body through reg.api.submit', r2.j.ok && r2.j.saved && r2.j.saved.saved === 1, JSON.stringify(r2.j));
    rec('7 a second plugin file (plain object export) is served', (await post('x0-plain')).j.plain === true, '');
    const two = await Promise.all([post('x0-save', { n: 1 }), post('x0-save', { n: 2 })]);
    rec('8 `once` route started twice at once: the second is answered busy (never run twice)', two.some(x => x.j.busy === true) && two.some(x => x.j.ok === true), JSON.stringify(two.map(x => x.j.busy ? 'busy' : x.j.ok)));
    const pm = (await post('perms')).j;
    rec('9 /api/perms: manager, superAdmin, authorities[], menus[]', pm.ok === true && typeof pm.manager === 'boolean' && typeof pm.superAdmin === 'boolean' && Array.isArray(pm.authorities) && Array.isArray(pm.menus), JSON.stringify(pm).slice(0, 200));
    { const mn = pm.menus || [], by = n => mn.find(x => x.name === n);
      rec('9b flatMenus reads the AIR POS menu uri (also nested), still url: a menu item with only `uri` gets its path', by('Operator Management') && by('Operator Management').path === '/operator-manage' && by('Shifts') && by('Shifts').path === '/report/shifts' && by('Old Style') && by('Old Style').path === '/old-style', JSON.stringify(mn)); }
    const sec = await fetch(BASE + '/api/sections').then(r => r.json());
    rec('10 GET /api/sections lists app/public/sections/*.js (sorted .js names only)', Array.isArray(sec.files) && sec.files.every(f => /\.js$/.test(f)) && sec.files.join() === [...sec.files].sort().join(), JSON.stringify(sec));
    rec('11 the built-in routes are untouched (state, scan still answer)', (await fetch(BASE + '/api/state').then(r => r.json())).loggedIn === true && (await post('scan', { code: '1001' })).j.hijacked === undefined, '');
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 400)); }
  finally { srv.kill(); fs.rmSync(T, { recursive: true, force: true }); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

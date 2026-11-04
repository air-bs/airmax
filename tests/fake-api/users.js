'use strict';
// Fake AIR POS answers for Batch 3 (Users and operators). Made-up data only.
// Logins the fake knows (any password text works for the default cashier, as in the base fake):
//   mgr1 / mgr-pw       manager WITH the Operator Management menu
//   nomenu1 / nomenu-pw manager WITHOUT the Operator Management menu (Add Operator and Edit must be hidden)
//   cash2 / cash-pw     a cashier (not a manager)
// Operator calls are refused unless the caller is a manager session (the fake looks at WHICH AirPos instance is calling, by its login
// token), so a test proves the screen really runs 144/145/146/147/20 with the manager session and not the cashier's.
// Hooks (hook port = FAKE_PORT+1): /users-state (what the fake saw: paths and callers only, never a password), /users-reset.
const fs = require('fs'), path = require('path');
const APPDIR = process.env.FAKE_APP_DIR || path.join(__dirname, '..', '..', 'app');
const { AirPos } = require(path.join(APPDIR, 'lib/airpos'));

module.exports = ({ handlers, hooks, fake, ok, J }) => {
  const seed = () => ({
    ops: [
      { id: 'op-1', name: 'ZZ Test Alice', userName: 'zz.alice', userId: 'u-1', phone: '555-0101', email: 'alice@example.com', position: 'Cashier', description: 'made up', createTime: '2026-10-01 09:00:00', fingerPrints: [{ id: 'fp-1', operatorId: 'op-1', fingerIndex: 1, createTime: '2026-10-05 08:00:00', contents: 'BIO' + 'X'.repeat(400), captureTemplate: 'TPL' + 'Y'.repeat(400), featureData: 'FEAT-SECRET' }, { id: 'fp-2', operatorId: 'op-1', fingerIndex: 6, fingerprintBuffer: 'BUF-SECRET' }] },
      { id: 'op-2', name: 'ZZ Test Bob', userName: 'zz.bob', userId: 'u-2', phone: '555-0102', email: 'bob@example.com', position: 'Stock', description: '', createTime: '2026-10-02 09:00:00', fingerPrints: [] },
      { id: 'op-3', name: 'ZZ Test Carol', userName: 'zz.carol', userId: 'u-3', phone: '', email: '', position: '', description: '', createTime: '2026-10-03 09:00:00' },
    ],
    logins: [{ id: 'u-1', userName: 'zz.alice', realName: 'Alice Fake' }, { id: 'u-2', userName: 'zz.bob', realName: 'Bob Fake' }, { id: 'u-3', userName: 'zz.carol', realName: 'Carol Fake' }, { id: 'u-4', userName: 'zz.dave', realName: 'Dave Fake' }, { id: 'u-5', userName: 'zz.erin', realName: 'Erin Fake' }],
    log: [], mgrLogins: 0, mgrOpen: 0,
  });
  const U = () => (fake.users = fake.users || seed());
  // who is calling: wrap the shared call so the handler below can see the caller's token (the base fake passes only the params)
  let who = '';
  { const c0 = AirPos.prototype.call; AirPos.prototype.call = function (host, p, params) { who = this.ide || ''; return c0.call(this, host, p, params); }; }
  const isMgr = () => /^mgr-token/.test(who) || /^nomenu-token/.test(who) || (who === 'fake-token' && process.env.FAKE_CASHIER !== '1'); // the base fake's own login is a super admin unless FAKE_CASHIER=1

  const login0 = handlers['/Identities/Login'], home0 = handlers['/Home/Index'];
  handlers['/Identities/Login'] = p => {
    const s = J(p, 'submit'), u = U();
    const mk = (tok, name) => ok({ ide: tok + '-' + (++u.mgrLogins), corpName: s.corpName, shopName: 'Fake shop', userName: name, superAdmin: false, shopId: 'shop', operatorId: 'op-' + name, stationId: 'st', currency: 2 });
    if (s.userName === 'mgr1') return s.password === 'mgr-pw' ? mk('mgr-token', 'mgr1') : { success: false, message: 'Wrong user name or password' };
    if (s.userName === 'nomenu1') return s.password === 'nomenu-pw' ? mk('nomenu-token', 'nomenu1') : { success: false, message: 'Wrong user name or password' };
    if (s.userName === 'cash2') return s.password === 'cash-pw' ? mk('cash-token', 'cash2') : { success: false, message: 'Wrong user name or password' };
    return login0(p);
  };
  handlers['/Home/Index'] = () => {
    if (/^mgr-token/.test(who)) { U().mgrOpen++; return { ...home0(), authorities: ['RetailManager'], menus: [{ name: 'Retail', children: [{ name: 'Operator Management', path: '/operator-manage' }, { name: 'Items', path: '/items' }] }] }; }
    if (/^nomenu-token/.test(who)) return { ...home0(), authorities: ['RetailManager'], menus: [{ name: 'Retail', children: [{ name: 'Items', path: '/items' }] }] };
    if (/^cash-token/.test(who)) return { ...home0(), authorities: [], menus: [] };
    return home0();
  };
  const note = (p, extra) => U().log.push({ path: p, caller: /^mgr-token/.test(who) ? 'manager' : /^nomenu-token/.test(who) ? 'manager-nomenu' : who === 'fake-token' ? (isMgr() ? 'register-manager' : 'register') : 'other', ...extra });
  const refuse = p => { note(p, { refused: true }); return { success: false, message: 'No permission' }; };
  const page = (rows, p) => { const pi = J(p, 'pageInfo'), sz = Number(pi.pageSize) || 20, pg = Number(pi.page) || 1; return { rows: rows.slice((pg - 1) * sz, pg * sz), total: rows.length }; };

  handlers['/Operators/RetailOperatorPaged'] = p => { if (!isMgr()) return refuse('144'); note('144'); const f = J(p, 'filter'), n = String(f.name || '').toLowerCase(); return page(U().ops.filter(o => !n || o.name.toLowerCase().includes(n)), p); };
  handlers['/Operators/RetailOperatorGet'] = p => { if (!isMgr()) return refuse('145'); note('145'); const o = U().ops.find(x => x.id === p.id); return o ? { ...o } : { success: false, message: 'Operator not found' }; };
  handlers['/Operators/RetailOperatorCreate'] = async p => {
    if (!isMgr()) return refuse('146'); const s = J(p, 'submit'); note('146', { name: s.name });
    if (U().slow) await new Promise(r => setTimeout(r, U().slow)); // hook /users-slow?ms=N: the save answers late (double-press test)
    if (who.startsWith('nomenu-token')) return { success: false, message: 'No permission' };
    if (!s.name || !s.userId) return { success: false, message: 'Missing name or login' };
    if (U().ops.some(o => o.userId === s.userId)) return { success: false, message: 'This login is already an operator' };
    U().ops.push({ ...s, createTime: '2026-11-03 10:00:00' }); return ok({});
  };
  handlers['/Operators/RetailOperatorChange'] = p => {
    if (!isMgr()) return refuse('147'); const s = J(p, 'submit'); note('147', { name: s.name });
    if (who.startsWith('nomenu-token')) return { success: false, message: 'No permission' };
    const i = U().ops.findIndex(o => o.id === s.id); if (i < 0) return { success: false, message: 'Operator not found' };
    U().ops[i] = { ...U().ops[i], ...s }; return ok({});
  };
  handlers['/Users/UserPaged'] = p => { if (!isMgr()) return refuse('20'); note('20'); const f = J(p, 'filter'), n = String(f.userName || '').toLowerCase(); return page(U().logins.filter(u => !n || u.userName.includes(n) || u.realName.toLowerCase().includes(n)), p); };

  const send = (res, o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  hooks['/users-state'] = (u, res) => send(res, { ops: U().ops.map(o => ({ id: o.id, name: o.name, userName: o.userName, position: o.position, phone: o.phone, email: o.email })), log: U().log, mgrLogins: U().mgrLogins });
  hooks['/users-slow'] = (u, res) => { U().slow = Number(u.searchParams.get('ms') || 0); send(res, { ok: true }); };
  hooks['/users-reset'] = (u, res) => { fake.users = seed(); send(res, { ok: true }); };
};

'use strict';
// Batch 3: Users and operators (AirMax API plugin; loaded by the Step 0 plugin loader, nothing else edited).
// AIR POS calls: 144 RetailOperatorPaged, 145 RetailOperatorGet, 146 RetailOperatorCreate, 147 RetailOperatorChange (retail host)
//                and 20 UserPaged (base host, through api.call('base', ...), the login picker for Add Operator).
// Design B (approved, Nov 3): a cashier cannot manage operators, so the screen is opened with a MANAGER session that lives only in
// memory here: a second AirPos instance (same class, app/lib untouched) logged in with the manager's own user name and password.
// The register's own cashier session is never changed. If the register is already logged in as a manager (isManager) that session is used
// and no password is asked. The session is never written to disk; the password is used once for the login and dropped; no body, token or
// password is logged. It is discarded when the Users screen is left, after 5 minutes without use, when the register user changes, or on logout.
const { AirPos, newGuid } = require('../lib/airpos');

const IDLE_MS = Math.max(1000, Number(process.env.AIRMAX_USERS_IDLE_MS) || 5 * 60 * 1000); // AIRMAX_USERS_IDLE_MS: tests only
const PAGE = 20;
const MENU = 'Operator Management', MENU_PATH = '/operator-manage'; // AIR POS menu entry that gates the Operator pages (OperatorManage)

// AIR POS menu entries (/Home/Index menus) flattened to [{ name, path }]; same reading rules as server.js (its helper is not exported)
const flat = (m, out = [], d = 0) => { if (d > 6 || m == null) return out; if (typeof m === 'string') { out.push({ name: m.slice(0, 80), path: '' }); return out; }
  if (Array.isArray(m)) { m.forEach(x => flat(x, out, d + 1)); return out; }
  if (typeof m === 'object') { const name = m.name || m.title || m.label || m.text || '', path = m.path || m.uri || m.url || m.route || m.href || ''; if (name || path) out.push({ name: String(name).slice(0, 80), path: String(path).slice(0, 120) });
    for (const k of ['children', 'menus', 'subs', 'items']) if (m[k]) flat(m[k], out, d + 1); }
  return out; };
const hasOperatorMenu = (menus, superAdmin) => !!superAdmin || flat(menus).some(x => x.name.toLowerCase() === MENU.toLowerCase() || x.path.toLowerCase() === MENU_PATH);

// the AIR POS answer, whatever its wrapper: bare value, { success, value } or { success, rows, total }
const bad = r => !r || (typeof r === 'object' && r.success === false);
const failMsg = (r, dflt) => (r && typeof r.message === 'string' && r.message ? r.message : dflt);
const valueOf = r => (r && typeof r === 'object' && 'success' in r && 'value' in r ? r.value : r);
const rowsOf = r => { const v = valueOf(r) || {}; const rows = Array.isArray(v.rows) ? v.rows : Array.isArray(r && r.rows) ? r.rows : Array.isArray(v) ? v : []; const total = Number.isFinite(Number(v.total)) ? Number(v.total) : Number.isFinite(Number(r && r.total)) ? Number(r.total) : rows.length; return { rows, total }; };
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

module.exports = ctx => {
  const { reg, log } = ctx;
  let sess = null; // { api, own, who, cashier (the register's login this was opened under), canEdit, timer, watch, last }

  const discard = why => {
    const s = sess; sess = null;
    if (!s) return false;
    clearTimeout(s.timer); clearInterval(s.watch);
    if (!s.own) { try { s.api.reset(); } catch (e) { /* nothing to clear */ } } // forget ide / identity of the second instance (AIR POS logout is client-side only)
    log('USERS manager session closed (' + why + ')');
    return true;
  };
  const same = s => reg.api.loggedIn && reg.identity === s.cashier; // still the same register login (a logout or a new login makes a new identity)
  const arm = s => { clearTimeout(s.timer); s.last = Date.now(); s.timer = setTimeout(() => { if (sess === s) discard('idle'); }, IDLE_MS); if (s.timer.unref) s.timer.unref();
    if (!s.watch) { s.watch = setInterval(() => { if (sess === s && !same(s)) discard('register user changed'); }, 2000); if (s.watch.unref) s.watch.unref(); } };

  // the live manager session, or null (and cleaned up) when the register user changed / logged out / the session timed out
  const live = () => {
    if (!sess) return null;
    if (!same(sess)) { discard('register user changed'); return null; }
    if (!sess.api.loggedIn) { discard('AIR POS ended it'); return null; }
    if (Date.now() - sess.last > IDLE_MS) { discard('idle'); return null; }
    arm(sess); return sess;
  };
  const locked = (message) => ({ ok: false, needUnlock: true, message: message || 'Manager approval is needed.' });
  const endedBy = (s, r) => { if (r && (r.loggedOut || r.errorCode === 1003 || r.errorCode === 1004)) { discard('AIR POS ended it'); return locked('The manager approval ended. Open Users again.'); } return null; };
  // fingerprints: only the NON-biometric labels of AIR POS's fingerPrints rows (a whitelist: contents, template, feature, buffer and any other field never pass)
  const small = v => (typeof v === 'number' && Number.isFinite(v)) ? v : (typeof v === 'string' && v.length <= 64) ? v : undefined;
  const fpRow = f => { if (!f || typeof f !== 'object') return null; const o = {};
    for (const [out, keys] of [['id', ['id', 'fingerPrintId', 'fingerprintId']], ['fingerIndex', ['fingerIndex', 'index', 'finger']], ['name', ['fingerName', 'name']], ['createTime', ['createTime', 'createdAt']]]) for (const k of keys) { const v = small(f[k]); if (v !== undefined && v !== '') { o[out] = v; break; } }
    return o; };
  const fpOf = o => { const a = Array.isArray(o.fingerPrints) ? o.fingerPrints : []; return { fingerPrintCount: Array.isArray(o.fingerPrints) ? a.length : (Number.isFinite(Number(o.fingerPrintCount)) ? Math.max(0, Math.floor(Number(o.fingerPrintCount))) : 0), fingerPrints: a.map(fpRow).filter(Boolean).slice(0, 20) }; };
  const slim = o => ({ id: o.id, name: o.name || '', userName: o.userName || '', position: o.position || '', createTime: o.createTime || o.createdAt || o.createDate || '', ...fpOf(o) });
  // later batches (fingerprints ...) can reach the live manager session through ctx.usersSession (read at call time, never stored)
  ctx.usersSession = { api: () => { const s = live(); return s ? s.api : null; }, canEdit: () => { const s = live(); return !!(s && s.canEdit); } };

  const routes = {
    // Unlock: a logged-in manager passes with no password; anyone else needs a manager's user name and password (second in-memory login).
    async 'users-unlock'(b = {}) {
      discard('new unlock');
      if (ctx.isManager()) {
        const p = ctx.perms();
        sess = { api: reg.api, own: true, who: String((reg.identity || {}).userName || ''), cashier: reg.identity, canEdit: ctx.hasMenu(MENU) || ctx.hasMenu(MENU_PATH) };
        arm(sess); log('USERS opened by the logged-in manager' + (p.superAdmin ? ' (super admin)' : ''));
        return { ok: true, manager: sess.who, canEdit: sess.canEdit, idleMs: IDLE_MS };
      }
      const user = str(b.user, 80), password = typeof b.password === 'string' ? b.password : '';
      if (!user || !password) return { ok: false, message: 'Enter a manager user name and password.' };
      const corp = str((reg.identity || {}).corpName, 120); if (!corp) return { ok: false, message: 'The register is not logged in to a company.' };
      const api = new AirPos({ log }); api.device = { ...reg.api.device };
      const r = await api.login(corp, user, password);
      if (!r || !r.success) { api.reset(); return { ok: false, message: failMsg(r, 'Wrong user name or password.'), ...(r && r.unreachable ? { retryable: true } : {}) }; }
      const id = api.identity || {}, h = await api.homeIndex();
      const home = h && !(typeof h === 'object' && 'success' in h && !h.success) ? h : {};
      const manager = !!(id.superAdmin || (Array.isArray(home.authorities) ? home.authorities : []).map(String).includes('RetailManager'));
      if (!manager) { api.reset(); return { ok: false, message: 'That login is not a manager.' }; }
      if (!reg.api.loggedIn) { api.reset(); return locked('The register is not logged in.'); }
      sess = { api, own: false, who: str(id.userName || user, 80), cashier: reg.identity, canEdit: hasOperatorMenu(home.menus, id.superAdmin) };
      arm(sess); log('USERS approved by manager login ' + user + (sess.canEdit ? '' : ' (no Operator Management menu: view only)'));
      return { ok: true, manager: sess.who, canEdit: sess.canEdit, idleMs: IDLE_MS };
    },
    async 'users-lock'() { discard('left the screen'); return { ok: true }; },
    async 'users-touch'() { const s = live(); return s ? { ok: true, canEdit: s.canEdit } : locked('The manager approval ended. Open Users again.'); },
    async 'users-status'() { const s = sess && live(); return { ok: true, unlocked: !!s, canEdit: !!(s && s.canEdit), manager: s ? s.who : '', idleMs: IDLE_MS }; },

    // 144 RetailOperatorPaged: the operator list, name search
    async 'users-list'(b = {}) {
      const s = live(); if (!s) return locked();
      const page = Math.max(1, Math.floor(Number(b.page) || 1)), name = str(b.name, 80);
      const r = await s.api.retail('/Operators/RetailOperatorPaged', { filter: JSON.stringify({ name, userName: '' }), pageInfo: JSON.stringify({ page, pageSize: PAGE, amount: 0 }) });
      const e = endedBy(s, r); if (e) return e;
      if (bad(r)) return { ok: false, message: failMsg(r, 'Could not load the operators.'), ...(r && r.unreachable ? { retryable: true } : {}) };
      const { rows, total } = rowsOf(r);
      return { ok: true, rows: rows.map(slim), total, page, pageSize: PAGE, canEdit: s.canEdit };
    },
    // 145 RetailOperatorGet: one operator, to fill the Edit form
    async 'users-get'(b = {}) {
      const s = live(); if (!s) return locked();
      const id = str(b.id, 64); if (!id) return { ok: false, message: 'Choose an operator.' };
      const r = await s.api.retail('/Operators/RetailOperatorGet', { id });
      const e = endedBy(s, r); if (e) return e;
      const o = valueOf(r);
      if (bad(r) || !o || typeof o !== 'object') return { ok: false, message: failMsg(r, 'Could not load this operator.'), ...(r && r.unreachable ? { retryable: true } : {}) };
      return { ok: true, operator: { id: o.id || id, name: o.name || '', phone: o.phone || '', email: o.email || '', position: o.position || '', description: o.description || '', userId: o.userId || '', userName: o.userName || '' } };
    },
    // 20 UserPaged (base host): the AIR POS login to link on Add Operator
    async 'users-pick'(b = {}) {
      const s = live(); if (!s) return locked();
      if (!s.canEdit) return { ok: false, message: 'This manager login may not add operators.' };
      const page = Math.max(1, Math.floor(Number(b.page) || 1)), text = str(b.text, 80);
      const r = await s.api.call('base', '/Users/UserPaged', { filter: JSON.stringify({ userName: text, realName: '' }), pageInfo: JSON.stringify({ page, pageSize: PAGE, amount: 0 }) });
      const e = endedBy(s, r); if (e) return e;
      if (bad(r)) return { ok: false, message: failMsg(r, 'Could not load the logins.'), ...(r && r.unreachable ? { retryable: true } : {}) };
      const { rows, total } = rowsOf(r);
      return { ok: true, rows: rows.map(u => ({ id: u.id, userName: u.userName || '', realName: u.realName || u.name || '' })), total, page, pageSize: PAGE };
    },

    // 146 RetailOperatorCreate / 147 RetailOperatorChange: the form is the AIR POS drawer ({ id, name, phone, email, position, description, userId, userName })
    async 'users-create'(b = {}) {
      const s = live(); if (!s) return locked();
      if (!s.canEdit) return { ok: false, message: 'This manager login may not add operators.' };
      if (b.confirm !== true) return { ok: false, message: 'Confirm before saving.' };
      const o = form(b); if (o.error) return { ok: false, message: o.error };
      if (!str(b.userId, 64) || !str(b.userName, 80)) return { ok: false, message: 'Choose the login for this operator.' };
      const body = { id: newGuid(), ...o.v, userId: str(b.userId, 64), userName: str(b.userName, 80) };
      const r = await s.api.submit('/Operators/RetailOperatorCreate', body);
      const e = endedBy(s, r); if (e) return e;
      if (bad(r)) return { ok: false, message: failMsg(r, 'Could not add the operator.'), ...(r && r.uncertain ? { uncertain: true } : {}) };
      log('USERS operator added'); return { ok: true, message: 'Operator added.', id: body.id };
    },
    async 'users-change'(b = {}) {
      const s = live(); if (!s) return locked();
      if (!s.canEdit) return { ok: false, message: 'This manager login may not change operators.' };
      if (b.confirm !== true) return { ok: false, message: 'Confirm before saving.' };
      const id = str(b.id, 64); if (!id) return { ok: false, message: 'Choose an operator.' };
      const o = form(b); if (o.error) return { ok: false, message: o.error };
      const body = { id, ...o.v, userId: str(b.userId, 64), userName: str(b.userName, 80) }; // the login link stays as loaded by 145
      const r = await s.api.submit('/Operators/RetailOperatorChange', body);
      const e = endedBy(s, r); if (e) return e;
      if (bad(r)) return { ok: false, message: failMsg(r, 'Could not save the operator.'), ...(r && r.uncertain ? { uncertain: true } : {}) };
      log('USERS operator changed'); return { ok: true, message: 'Saved.' };
    },
  };
  function form(b) {
    const v = { name: str(b.name, 100), phone: str(b.phone, 40), email: str(b.email, 120), position: str(b.position, 80), description: str(b.description, 500) };
    if (!v.name) return { error: 'Enter the operator name.' };
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return { error: 'Enter a valid email.' };
    return { v };
  }
  // reads skip the one-at-a-time sale queue; unlock / create / change go through it, with `once` so a double press never runs twice
  return { routes, unlocked: ['users-lock', 'users-touch', 'users-status', 'users-list', 'users-get', 'users-pick'], once: ['users-unlock', 'users-create', 'users-change'], noSnap: Object.keys(routes) };
};

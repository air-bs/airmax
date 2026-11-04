'use strict';
// Batch 6: fingerprints (AirMax API plugin; loaded by the Step 0 plugin loader, no other app file edited except the one tagged block in app/lib/kiosk.js).
// AIR POS calls (retail host): 148 FingerprintsGet, 149 FingerprintSelect, 150 FingerPrintRegister, 151 FingerprintClear, 152 FingerprintRemove, 8 ManagerFingerprintSelect.
// Local reader service (this PC, port env AIRMAX_FP_HW_PORT, default 20001): 160 FingerPrintInput, 162 FingerPrintRegistStop, 163 ManagerAuthorization.
// NOT in this batch (owner, Nov 3): no fingerprint login or unlock (7 FingerprintSelectByUserName, 161 FingerPrintVerification, useFingerprint:true).
//
// Two jobs:
//  1) Users > Fingerprints (enrolment). Routes fp-list / fp-mine / fp-enroll-start / fp-enroll-status / fp-enroll-cancel / fp-enroll-save / fp-clear / fp-remove.
//     Only for a manager who may manage operators. When the Users screen's manager session exists (ctx.usersSession from app/api/users.js, read at
//     call time) its AIR POS session is used, otherwise the register's own login if that login has the "Operator Management" menu.
//  2) Manager approval by fingerprint (the pop-up "Manager approval"). Routes fp-mgr-start / fp-mgr-status / fp-mgr-cancel.
//     SECURITY: THIS Node server asks AIR POS for the managers' prints (8), asks the reader service to match (163) and takes the manager id from the
//     service's answer. The browser never sends a manager id. It only gets random single-use tokens (Node memory, 120 s, tied to this register login) and sends
//     { user: '@fingerprint', password: token } to the normal approval routes; app/lib/kiosk.js managerCheck asks reg.fpApproval(token).
// Never logged, never sent to the browser: fingerprint templates, tokens, passwords. The log gets route names and outcomes only.
const crypto = require('crypto');
const hw = require('./fingerprints-hw');

const MENU = 'Operator Management';
const CAPTURES = 3;                    // AIR POS takes 3 touches of the same finger
const APPROVE_TTL_MS = Number(process.env.AIRMAX_FP_TTL_MS) || 120 * 1000;     // a fingerprint approval token lives this long, and works once (AIRMAX_FP_TTL_MS: tests only)
const WAIT_MS = Number(process.env.AIRMAX_FP_WAIT_MS) || 40 * 1000; // how long the reader waits for a finger before we stop it (AIRMAX_FP_WAIT_MS: tests only)

const valueOf = r => (r && typeof r === 'object' && 'success' in r && 'value' in r ? r.value : r);
const isBad = r => !r || (typeof r === 'object' && !Array.isArray(r) && r.success === false);
const msgOf = (r, d) => (r && typeof r.message === 'string' && r.message ? r.message.slice(0, 200) : d);
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const arr = v => (Array.isArray(v) ? v : []);
const strs = v => arr(v).filter(x => typeof x === 'string' && x);

module.exports = ctx => {
  const { reg, log } = ctx;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------------------------------------------------------------- manager approval tokens
  // One finger scan makes one grant of 1 token (2 for Price Change, which checks the manager twice). EVERY token is single-use:
  // reg.fpApproval(token) deletes the token on the first check, whether it passes or not, and also at expiry (APPROVE_TTL_MS).
  // A token that is checked while expired or for another register login also takes its sibling(s) with it.
  const approvals = new Map();   // token -> { exp, who, grant, timer }  (who = the register login it was made for)
  const drop = token => { const t = approvals.get(token); if (t) { clearTimeout(t.timer); approvals.delete(token); } return t; };
  const arm = (token, t) => {    // delete the token at its expiry (re-armed when a sibling is used and gets a fresh 120 s)
    clearTimeout(t.timer);
    t.timer = setTimeout(() => { const x = approvals.get(token); if (!x) return; if (Date.now() >= x.exp) { drop(token); x.grant.delete(token); } else arm(token, x); }, Math.max(1, t.exp - Date.now()) + 5);
    if (t.timer.unref) t.timer.unref();
  };
  const dropGrant = g => { for (const k of g) drop(k); g.clear(); };
  reg.fpApproval = token => {    // read by app/lib/kiosk.js managerCheck (block fp6)
    const t = typeof token === 'string' ? drop(token) : null;    // burned by this very check, pass or fail
    if (!t) return false;
    t.grant.delete(token);
    if (Date.now() > t.exp || !reg.api.loggedIn || reg.identity !== t.who) { dropGrant(t.grant); return false; }
    for (const k of t.grant) { const x = approvals.get(k); if (x) { x.exp = Math.max(x.exp, Date.now() + APPROVE_TTL_MS); arm(k, x); } }   // the second check of Price Change gets its own 120 s from the first
    return true;
  };
  // Batch 6 rule: a fingerprint never approves Exit to Windows. The shared exit code is not touched: the register method is fenced here, in the
  // Batch 6 plugin, so a '@fingerprint' approval is refused BEFORE it reaches managerCheck (the token is not even used up).
  // (Restart / Shut down PC no longer ask for a manager at all, fix/exit-no-password, so there is nothing to fence there.)
  for (const name of ['exitToWindows']) {
    const orig = typeof reg[name] === 'function' ? reg[name] : null; if (!orig) continue;
    reg[name] = function (b) { if (b && b.user === '@fingerprint') return Promise.resolve({ ok: false, message: 'A fingerprint cannot be used here. A manager logs in with a user name and password.' }); return orig.apply(this, arguments); };
  }
  const mint = (who, n) => {
    const grant = new Set(), out = [];
    for (let i = 0; i < n; i++) {
      const token = crypto.randomBytes(24).toString('hex'), t = { exp: Date.now() + APPROVE_TTL_MS, who, grant, timer: null };
      approvals.set(token, t); grant.add(token); arm(token, t); out.push(token);
    }
    return out;
  };
  const prune = setInterval(() => { for (const [k, t] of approvals) if (Date.now() > t.exp || reg.identity !== t.who) { drop(k); t.grant.delete(k); } }, 15000);
  if (prune.unref) prune.unref();

  // ---------------------------------------------------------------- which AIR POS session the enrolment uses
  const target = () => {
    const u = ctx.usersSession;                       // Batch 3 (Users), when it is loaded
    if (u && typeof u.api === 'function') {
      const a = u.api();
      if (!a) return { locked: true };
      return { api: a, edit: !!(typeof u.canEdit === 'function' ? u.canEdit() : true) };
    }
    return { api: reg.api, edit: !!ctx.hasMenu(MENU) };
  };
  const deny = (t, write) => (t.locked ? { ok: false, needUnlock: true, message: 'Open Users and approve with a manager first.' }
    : write && !t.edit ? { ok: false, message: 'This login cannot manage operators.' } : null);
  const ended = (r) => (r && (r.loggedOut || r.errorCode === 1003 || r.errorCode === 1004) ? { ok: false, needUnlock: true, message: 'The manager approval ended. Open Users again.' } : null);

  // ---------------------------------------------------------------- enrolment
  let enroll = null;   // { id, operatorId, who, state, step, message, existing[{index,fingerprint}], byIndex{index: contents[]}, captures[], fingerIndex }
  const dropEnroll = (stop) => { const e = enroll; enroll = null; if (e && stop) e.state = 'cancelled'; return e; };
  const sameLogin = e => reg.api.loggedIn && reg.identity === e.who;
  const flatPrints = byIndex => Object.entries(byIndex).flatMap(([i, cs]) => cs.map(c => ({ index: Number(i), fingerprint: c })));

  // 149 FingerprintSelect -> [{ id, index, contents[], createTime }]
  const select = async (api, operatorId) => {
    const r = await api.retail('/Operators/FingerprintSelect', { operatorId });
    if (isBad(r)) return { fail: ended(r) || { ok: false, message: msgOf(r, 'Fingerprints could not be loaded.') } };
    return { list: arr(valueOf(r)).filter(x => x && typeof x === 'object') };
  };
  const slim = x => ({ id: x.id, index: Number(x.index) || 0, count: strs(x.contents).length, createTime: x.createTime || x.createdAt || '' });

  const runEnroll = async e => {
    for (let i = 0; i < CAPTURES; i++) {
      if (enroll !== e || e.state !== 'waiting') return;
      const list = flatPrints(e.byIndex);
      const r = await hw.input(list, WAIT_MS + 5000);
      if (enroll !== e || e.state !== 'waiting') return;      // cancelled while the reader waited
      const v = r.success && r.value && typeof r.value === 'object' ? r.value : null;
      if (!v || typeof v.captureTemplate !== 'string' || !v.captureTemplate) {
        e.state = 'failed'; e.message = r.success ? 'The fingerprint was not read. Try again.' : (r.message || 'The fingerprint was not read. Try again.');
        log('FINGERPRINT enrol: reader did not give a print (' + (r.unreachable ? 'service not reachable' : 'refused') + ')'); hw.stop(); return;
      }
      const idx = Number(v.fingerIndex);
      if (!Number.isFinite(idx)) { e.state = 'failed'; e.message = 'The fingerprint was not read. Try again.'; hw.stop(); return; }
      if (e.fingerIndex == null) e.fingerIndex = idx;
      else if (idx !== e.fingerIndex) { e.state = 'failed'; e.message = 'That was a different finger. Start again and use the same finger three times.'; hw.stop(); return; }
      (e.byIndex[idx] = e.byIndex[idx] || []).push(v.captureTemplate);
      e.step = i + 1; e.message = '';
    }
    if (enroll === e && e.state === 'waiting') e.state = 'ready';
  };

  const status = e => ({ ok: true, state: e ? e.state : 'none', step: e ? e.step : 0, of: CAPTURES, message: e ? e.message : '' });

  // ---------------------------------------------------------------- manager approval
  let mgr = null;   // { id, who, state: 'loading'|'waiting'|'ok'|'failed'|'unavailable'|'cancelled', message, tokens, want, given }
  const stopMgr = (why) => { const m = mgr; if (!m) return; mgr = null; if (m.state === 'loading' || m.state === 'waiting') { m.state = 'cancelled'; hw.stop(); log('FINGERPRINT manager approval stopped (' + why + ')'); } };

  const runMgr = async m => {
    const r8 = await reg.api.retail('/Operators/ManagerFingerprintSelect', {});
    if (mgr !== m) return;
    if (isBad(r8)) { m.state = 'unavailable'; m.message = msgOf(r8, 'Fingerprint approval is not available.'); return; }
    const list = [], ids = new Set();
    for (const mm of arr(valueOf(r8))) {
      if (!mm || typeof mm !== 'object' || !mm.operatorId) continue;
      const fps = [];
      for (const f of arr(mm.fingerprints)) for (const c of strs(f && f.contents)) fps.push({ index: f.index, fingerprint: c });
      if (!fps.length) continue;
      list.push({ operatorId: mm.operatorId, fingerprints: fps }); ids.add(String(mm.operatorId));
    }
    if (!list.length) { m.state = 'unavailable'; m.message = 'No manager has a saved fingerprint.'; return; }
    m.state = 'waiting'; m.message = '';
    const timer = setTimeout(() => { if (mgr === m && m.state === 'waiting') { m.state = 'failed'; m.message = 'Time ran out. Try again.'; hw.stop(); log('FINGERPRINT manager approval timed out'); } }, WAIT_MS);
    if (timer.unref) timer.unref();
    const r = await hw.managerAuthorization(list, WAIT_MS + 5000);
    clearTimeout(timer);
    if (mgr !== m || m.state !== 'waiting') return;
    const managerId = r.success && typeof r.value === 'string' ? r.value : '';
    if (r.unreachable && !r.success) { m.state = 'unavailable'; m.message = r.message; return; }
    if (!managerId || !ids.has(managerId)) { m.state = 'failed'; m.message = r.success ? 'The fingerprint was not recognised. Try again.' : (r.message || 'The fingerprint was not recognised. Try again.'); log('FINGERPRINT manager approval: no match'); return; }
    // the manager id came from the reader service's answer and is one of the managers AIR POS listed; the browser only ever gets a token
    m.tokens = mint(m.who, m.want); m.state = 'ok'; m.message = '';
    log('FINGERPRINT manager approval granted');
  };

  // ---------------------------------------------------------------- routes
  const routes = {
    // 149 for one operator: the saved fingerprints, without any print data
    'fp-list': async b => {
      const t = target(), d = deny(t, true); if (d) return d;
      const operatorId = str(b.operatorId, 80); if (!operatorId) return { ok: false, message: 'No operator chosen.' };
      const s = await select(t.api, operatorId); if (s.fail) return s.fail;
      return { ok: true, prints: s.list.map(slim), count: s.list.length, canEdit: t.edit };
    },
    // 148: the prints of the login that asks (count and finger numbers only)
    'fp-mine': async () => {
      const t = target(), d = deny(t, false); if (d) return d;
      const r = await t.api.retail('/Operators/FingerprintsGet', {});
      if (isBad(r)) return ended(r) || { ok: false, message: msgOf(r, 'Fingerprints could not be loaded.') };
      const l = arr(valueOf(r));
      return { ok: true, count: l.length, indexes: l.map(x => Number(x && x.index) || 0) };
    },
    // 160 x3: start a new enrolment for one operator (the browser polls fp-enroll-status)
    'fp-enroll-start': async b => {
      const t = target(), d = deny(t, true); if (d) return d;
      const operatorId = str(b.operatorId, 80); if (!operatorId) return { ok: false, message: 'No operator chosen.' };
      if (enroll) { dropEnroll(true); hw.stop(); }
      const s = await select(t.api, operatorId); if (s.fail) return s.fail;
      const byIndex = {};
      for (const x of s.list) { const i = Number(x.index); if (Number.isFinite(i)) byIndex[i] = [...(byIndex[i] || []), ...strs(x.contents)]; }
      const e = enroll = { id: crypto.randomBytes(6).toString('hex'), operatorId, who: reg.identity, state: 'waiting', step: 0, message: '', byIndex, fingerIndex: null };
      runEnroll(e).catch(() => { if (enroll === e && e.state === 'waiting') { e.state = 'failed'; e.message = 'The fingerprint was not read. Try again.'; } });
      return status(e);
    },
    'fp-enroll-status': async b => {
      const e = enroll;
      if (e && !sameLogin(e)) { dropEnroll(true); hw.stop(); return status(null); }
      if (e && b && b.operatorId && str(b.operatorId, 80) !== e.operatorId) return status(null);
      return status(e);
    },
    // 162: cancel (Cancel button, window closed, panel left)
    'fp-enroll-cancel': async () => { const e = dropEnroll(true); if (e) { await hw.stop(); log('FINGERPRINT enrol cancelled'); } return { ok: true }; },
    // 150: save the 3 touches as one fingerprint
    'fp-enroll-save': async () => {
      const e = enroll;
      if (!e || !sameLogin(e)) return { ok: false, message: 'There is no fingerprint to save. Scan the finger again.' };
      if (e.state !== 'ready') return { ok: false, message: 'Scan the finger three times first.' };
      const t = target(), d = deny(t, true); if (d) return d;
      const contents = e.byIndex[e.fingerIndex] || [];
      const r = await t.api.submit('/Operators/FingerPrintRegister', { fingerPrintId: crypto.randomUUID(), operatorId: e.operatorId, fingerIndex: e.fingerIndex, contents });
      if (isBad(r) || (r && typeof r === 'object' && r.success !== true)) return ended(r) || { ok: false, message: msgOf(r, 'The fingerprint could not be saved.') };
      enroll = null; log('FINGERPRINT saved for an operator');
      return { ok: true, message: 'Fingerprint saved.' };
    },
    // 151: remove all prints of one operator (the screen asks first; the server also needs confirm: true)
    'fp-clear': async b => {
      const t = target(), d = deny(t, true); if (d) return d;
      const operatorId = str(b.operatorId, 80); if (!operatorId) return { ok: false, message: 'No operator chosen.' };
      if (b.confirm !== true) return { ok: false, message: 'Please confirm first.' };
      const r = await t.api.retail('/Operators/FingerprintClear', { operatorId });
      if (isBad(r)) return ended(r) || { ok: false, message: msgOf(r, 'The fingerprints could not be cleared.') };
      log('FINGERPRINT all cleared for an operator');
      return { ok: true, message: 'All fingerprints cleared.' };
    },
    // 152: remove one saved fingerprint (confirm: true needed)
    'fp-remove': async b => {
      const t = target(), d = deny(t, true); if (d) return d;
      const operatorId = str(b.operatorId, 80), fingerprintId = str(b.fingerprintId, 80);
      if (!operatorId || !fingerprintId) return { ok: false, message: 'No fingerprint chosen.' };
      if (b.confirm !== true) return { ok: false, message: 'Please confirm first.' };
      const r = await t.api.retail('/Operators/FingerprintRemove', { operatorId, fingerprintId });
      if (isBad(r)) return ended(r) || { ok: false, message: msgOf(r, 'The fingerprint could not be removed.') };
      log('FINGERPRINT one removed for an operator');
      return { ok: true, message: 'Fingerprint removed.' };
    },

    // manager approval: start listening (8, then 163 in the background)
    'fp-mgr-start': async b => {
      stopMgr('new request');
      const m = mgr = { id: crypto.randomBytes(6).toString('hex'), who: reg.identity, state: 'loading', message: '', tokens: [], want: Number(b && b.tokens) === 2 ? 2 : 1, given: false };
      runMgr(m).catch(() => { if (mgr === m && (m.state === 'loading' || m.state === 'waiting')) { m.state = 'unavailable'; m.message = 'Fingerprint approval is not available.'; } });
      return { ok: true, state: m.state };
    },
    'fp-mgr-status': async () => {
      const m = mgr;
      if (!m) return { ok: true, state: 'none' };
      if (reg.identity !== m.who) { stopMgr('register user changed'); return { ok: true, state: 'none' }; }
      if (m.state === 'ok') { const give = !m.given; m.given = true; const list = m.tokens; m.tokens = []; return give ? { ok: true, state: 'ok', tokens: list, ttl: Math.round(APPROVE_TTL_MS / 1000) } : { ok: true, state: 'ok' }; }   // the tokens go to the browser once; only opaque tokens, never a manager id
      return { ok: true, state: m.state, message: m.message };
    },
    // 162: cancel (pop-up closed, password typed instead)
    'fp-mgr-cancel': async () => { stopMgr('cancel'); return { ok: true }; },
  };
  return {
    routes,
    unlocked: Object.keys(routes).filter(n => !['fp-enroll-save', 'fp-clear', 'fp-remove'].includes(n)),   // none of these touch the sale (the manager pop-up also opens while a sale is open); the three that write to AIR POS wait in the queue
    once: ['fp-enroll-save', 'fp-clear', 'fp-remove'],
    noSnap: Object.keys(routes),
  };
};

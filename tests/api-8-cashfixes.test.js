// AirMax API Batch 8 - cash fixes (calls 106 111 117), manager only. Own fake AIR POS + app, made-up data, offline.
//   node tests/api-8-cashfixes.test.js     ports: API8C_PORT (default 5286; hook +1), cashier server +2 (hook +3). Batch 8 range 5280-5289 (5290-5299 are Bot 9's)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const P1 = Number(process.env.API8C_PORT || 5286), P2 = P1 + 2;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api8-cf-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; let nPass = 0;
const rec = (k, pass, note) => { if (!pass) fails.push(k); else nPass++; console.log((pass ? 'PASS ' : 'FAIL ') + k + (note && !pass ? ' - ' + note : '')); };
const PW = process.env.AIRMAX_TEST_PW || 'x';
class Srv {
  constructor(port, env, dirName) { this.port = port; this.env = env || {}; this.dir = path.join(T, dirName); fs.mkdirSync(this.dir, { recursive: true }); this.logf = path.join(T, dirName + '.log'); this.base = 'http://127.0.0.1:' + port; this.hook = 'http://127.0.0.1:' + (port + 1); }
  async start() {
    this.p = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(this.port), FAKE_DATA_DIR: this.dir, B8_FAKE: '1', ...this.env }, stdio: ['ignore', fs.openSync(this.logf, 'a'), fs.openSync(this.logf, 'a')] });
    for (let i = 0; i < 60; i++) { try { await fetch(this.base + '/api/shortcuts'); break; } catch (e) { await sleep(250); } }
    return (await this.post('login', { company: 'fake shop', user: 'tester', password: PW })).j;
  }
  stop() { try { this.p.kill(); } catch (e) { /* gone */ } }
  async post(r, x) { const res = await fetch(this.base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }); const txt = await res.text(); this.replies = (this.replies || []).concat(txt); return { status: res.status, j: JSON.parse(txt) }; }
  async st() { return (await fetch(this.hook + '/cf-state')).json(); }
  async hk(p) { return (await fetch(this.hook + p)).json(); }
  fault(p, mode, n, skip) { return this.hk('/fault?path=' + p + '&mode=' + mode + '&n=' + (n || 1) + (skip ? '&skip=' + skip : '')); }
  file(n) { try { return fs.readFileSync(path.join(this.dir, n), 'utf8'); } catch (e) { return ''; } }
}
const sum = c => c.txHandle + c.sesHandle + c.zCancel;
const tx = (st, id) => st.txs.find(t => t.id === id);
let S, K;
const reset = async () => { await S.hk('/cf-reset'); await S.hk('/fault-clear'); };
(async () => {
  S = new Srv(P1, {}, 'main'); K = new Srv(P2, { FAKE_CASHIER: '1' }, 'cashier');
  try {
    const l1 = await S.start(), l2 = await K.start();
    rec('0 both servers up; plugin cashfixes.js loaded', l1.ok !== false && /cashfixes\.js \(\d+ routes\)/.test(fs.readFileSync(S.logf, 'utf8')) && l2.ok !== false);
    // reads
    let st = await S.st();
    const d = await S.post('cf-diffs', {}), sd = await S.post('cf-session-diffs', { sessionId: 'ses-1' }), sd2 = await S.post('cf-session-diffs', { sessionId: 'ses-2' }), zl = await S.post('cf-zreads', {}); st = await S.st();
    rec('1 reads: diff list (3 records, 2 unhandled), one shift (2 unhandled), shift without diff (0), Z-reads (new cancellable, old not); zero writes', d.j.ok && d.j.rows.length === 3 && d.j.unhandled === 2 && sd.j.unhandled === 2 && sd2.j.ok && sd2.j.rows.length === 0 && zl.j.ok && zl.j.rows.find(z => z.id === 'zr-new').canCancel && !zl.j.rows.find(z => z.id === 'zr-old').canCancel && sum(st.counters) === 0, JSON.stringify([d.j, zl.j]).slice(0, 250));
    // permissions
    const kw = [await K.post('cf-diffs', {}), await K.post('cf-tx-handle', { id: 'tx-1', reason: 'counted twice' }), await K.post('cf-session-handle', { sessionId: 'ses-1', reason: 'counted twice' }), await K.post('cf-zread-cancel', { id: 'zr-new', reason: 'printed in error' })];
    const ks = await K.st();
    rec('2 cashier: every read and write needs a manager; nothing sent', kw.every(r => !r.j.ok && r.j.needManager) && sum(ks.counters) === 0, JSON.stringify(kw.map(r => r.j.message)).slice(0, 250));
    const wrong = await K.post('cf-tx-handle', { id: 'tx-1', reason: 'counted twice', user: 'boss', password: 'wrong' }); const ks2 = await K.st();
    rec('3 cashier + wrong manager password: refused, nothing sent', !wrong.j.ok && sum(ks2.counters) === 0);
    const good = await K.post('cf-tx-handle', { id: 'tx-1', reason: 'counted twice', user: 'boss', password: 'boss-pw' }); const ks3 = await K.st();
    rec('4 cashier + right manager password (111): one send, handled; password not in reply, log or files', good.j.ok && ks3.counters.txHandle === 1 && tx(ks3, 'tx-1').diffHandled && !/boss-pw/.test(JSON.stringify(good.j) + K.file('cashfix-log.jsonl') + fs.readFileSync(K.logf, 'utf8')), JSON.stringify(good.j).slice(0, 200));
    // 111
    const bad = [await S.post('cf-tx-handle', { id: 'tx-2' }), await S.post('cf-tx-handle', { id: 'tx-2', reason: 'x' }), await S.post('cf-tx-handle', { reason: 'fine reason' }), await S.post('cf-tx-handle', { id: 'nope', reason: 'fine reason' }), await S.post('cf-tx-handle', { id: 'tx-4', reason: 'fine reason' }), await S.post('cf-tx-handle', { id: 'tx-3', reason: 'fine reason' })]; st = await S.st();
    rec('5 111: no reason / short reason / no id / unknown id / record with no short-over / already handled -> all refused, nothing sent', bad.every(r => !r.j.ok) && st.counters.txHandle === 0, JSON.stringify(bad.map(r => r.j.message)));
    await reset();
    const h = await S.post('cf-tx-handle', { id: 'tx-2', reason: 'drawer recounted' }); st = await S.st();
    const h2 = await S.post('cf-tx-handle', { id: 'tx-2', reason: 'drawer recounted' }); const st2 = await S.st();
    rec('6 111: handled once with the reason; pressing again is refused without sending', h.j.ok && h.j.done && st.counters.txHandle === 1 && st.remarks[0] === 'drawer recounted' && !h2.j.ok && h2.j.already && st2.counters.txHandle === 1);
    const two = await Promise.all([S.post('cf-tx-handle', { id: 'tx-1', reason: 'twice at once' }), S.post('cf-tx-handle', { id: 'tx-1', reason: 'twice at once' })]); st = await S.st();
    rec('7 111: two presses at once -> one send', st.counters.txHandle === 2 && two.filter(r => r.j.ok).length === 1, JSON.stringify(two.map(r => r.j.ok || r.j.message)));
    await reset();
    await S.fault('RetailCashTransactionDiffHandled', 'lost', 1);
    const lost = await S.post('cf-tx-handle', { id: 'tx-1', reason: 'reply lost' }); st = await S.st();
    rec('8 111: reply lost but AIR POS did it: read back shows handled -> success, one send', lost.j.ok && lost.j.done && st.counters.txHandle === 1 && tx(st, 'tx-1').diffHandled, JSON.stringify(lost.j));
    await reset(); await S.fault('RetailCashTransactionDiffHandled', 'http500', 1);
    const e5 = await S.post('cf-tx-handle', { id: 'tx-1', reason: 'server error' }); st = await S.st();
    const retry = await S.post('cf-tx-handle', { id: 'tx-1', reason: 'server error' }); const st3 = await S.st();
    rec('9 111: HTTP 500, nothing done: shown as not handled; a new press is allowed after a fresh read and works once', !e5.j.ok && !tx(st, 'tx-1').diffHandled && retry.j.ok && st3.counters.txHandle === 1 && tx(st3, 'tx-1').diffHandled, JSON.stringify([e5.j.message, retry.j]).slice(0, 250));
    await reset(); await S.fault('RetailCashTransactionDiffHandled', 'lost', 1); await S.fault('RetailCashTransactionGet', 'down', 2, 1);
    const unk = await S.post('cf-tx-handle', { id: 'tx-1', reason: 'cannot read back' }); st = await S.st();
    rec('10 111: reply lost AND cannot read back: "not sure", marked unknown in the log, no resend', !unk.j.ok && unk.j.unknown && st.counters.txHandle === 1 && /"step":"unknown"/.test(S.file('cashfix-log.jsonl')), JSON.stringify(unk.j));
    await S.hk('/fault-clear');
    // 106
    await reset();
    const sh = await S.post('cf-session-handle', { sessionId: 'ses-1', reason: 'shift recounted' }); st = await S.st();
    rec('11 106: shift with 2 short/over records: one send; both read back handled; reason stored', sh.j.ok && sh.j.done && sh.j.handled === 2 && st.counters.sesHandle === 1 && tx(st, 'tx-1').diffHandled && tx(st, 'tx-2').diffHandled && st.remarks[0] === 'shift recounted', JSON.stringify(sh.j));
    const sh2 = await S.post('cf-session-handle', { sessionId: 'ses-1', reason: 'again' }), sh3 = await S.post('cf-session-handle', { sessionId: 'ses-2', reason: 'no diff here' }), sh4 = await S.post('cf-session-handle', { sessionId: 'nope', reason: 'no such' }), sh5 = await S.post('cf-session-handle', { sessionId: 'ses-3', reason: 'handled before' }), sh6 = await S.post('cf-session-handle', { sessionId: 'ses-1' }); st = await S.st();
    rec('12 106: already handled / shift with no short-over / unknown shift / handled-before shift / no reason -> refused, still one send', [sh2, sh3, sh4, sh5, sh6].every(r => !r.j.ok) && st.counters.sesHandle === 1, JSON.stringify([sh2, sh3, sh4, sh5, sh6].map(r => r.j.message)));
    await reset(); await S.fault('RetailSessionDiffHandle', 'lost', 1);
    const sl = await S.post('cf-session-handle', { sessionId: 'ses-1', reason: 'reply lost' }); st = await S.st();
    rec('13 106: reply lost, AIR POS did it: read back shows handled -> success, one send', sl.j.ok && sl.j.done && st.counters.sesHandle === 1, JSON.stringify(sl.j));
    await reset(); await S.fault('RetailSessionDiffHandle', 'http500', 1);
    const s5 = await S.post('cf-session-handle', { sessionId: 'ses-1', reason: 'server error' }); st = await S.st();
    rec('14 106: HTTP 500, nothing done: not handled, can be tried again', !s5.j.ok && st.counters.sesHandle === 0 && !tx(st, 'tx-1').diffHandled, JSON.stringify(s5.j));
    await reset(); await S.hk('/cf-conf?noSession=1');
    const ns = await S.post('cf-session-handle', { sessionId: 'ses-1', reason: 'like TestShop' }); st = await S.st();
    rec('14b 106: server answers HTTP 404 (as TestShop does): reported as not available, records unchanged', !ns.j.ok && ns.j.notAvailable && !tx(st, 'tx-1').diffHandled, JSON.stringify(ns.j));
    // 117
    await reset();
    const zb = [await S.post('cf-zread-cancel', { id: 'zr-old', reason: 'try it' }), await S.post('cf-zread-cancel', { id: 'zr-new' }), await S.post('cf-zread-cancel', { id: 'nope', reason: 'no such' })]; st = await S.st();
    rec('15 117: Z-read with a sale after it / no reason / unknown -> refused, nothing sent', zb.every(r => !r.j.ok) && st.counters.zCancel === 0, JSON.stringify(zb.map(r => r.j.message)));
    const zw = [await S.post('cf-zread-cancel', { id: 'zr-new', reason: 'no number typed' }), await S.post('cf-zread-cancel', { id: 'zr-new', reason: 'wrong number typed', zNumber: 'ZR-OLD' })]; st = await S.st();
    rec('15b 117: the Z-read number not typed / typed wrong -> refused, nothing sent', zw.every(r => !r.j.ok && /Type the Z-read number/.test(r.j.message)) && st.counters.zCancel === 0, JSON.stringify(zw.map(r => r.j.message)));
    const zc = await S.post('cf-zread-cancel', { id: 'zr-new', reason: 'printed by mistake', zNumber: 'ZR-NEW' }); st = await S.st();
    const zc2 = await S.post('cf-zread-cancel', { id: 'zr-new', reason: 'printed by mistake', zNumber: 'ZR-NEW' }); const st4 = await S.st();
    rec('16 117: cancellable Z-read cancelled once; pressing again is refused without sending', zc.j.ok && zc.j.done && st.counters.zCancel === 1 && !st.zreads.includes('zr-new') && !zc2.j.ok && st4.counters.zCancel === 1);
    await reset(); await S.fault('CancelZRead', 'lost', 1);
    const zl2 = await S.post('cf-zread-cancel', { id: 'zr-new', reason: 'reply lost', zNumber: 'ZR-NEW' }); st = await S.st();
    rec('17 117: reply lost, AIR POS did it: read back shows it gone -> success, one send', zl2.j.ok && zl2.j.done && st.counters.zCancel === 1, JSON.stringify(zl2.j));
    await reset(); await S.fault('CancelZRead', 'http500', 1);
    const z5 = await S.post('cf-zread-cancel', { id: 'zr-new', reason: 'server error', zNumber: 'ZR-NEW' }); st = await S.st();
    rec('18 117: HTTP 500, nothing done: Z-read still there, can be tried again', !z5.j.ok && st.zreads.includes('zr-new'), JSON.stringify(z5.j));
    // audit
    const au = S.file('cashfix-log.jsonl').split('\n').filter(Boolean).map(l => JSON.parse(l));
    rec('18b logged-in manager (RetailManager): 111 / 106 / 117 went through with NO password; the log says approvedWithPassword false', au.filter(e => e.step === 'done').length >= 3 && au.filter(e => e.step === 'done').every(e => e.approvedWithPassword === false), JSON.stringify(au.filter(e => e.step === 'done').map(e => [e.kind, e.approvedWithPassword])));
    const kz = await K.post('cf-zread-cancel', { id: 'zr-new', reason: 'cashier no pw', zNumber: 'ZR-NEW' }), kzw = await K.post('cf-zread-cancel', { id: 'zr-new', reason: 'cashier wrong pw', zNumber: 'ZR-NEW', user: 'boss', password: 'nope' }), kzs = await K.st();
    const kzok = await K.post('cf-zread-cancel', { id: 'zr-new', reason: 'cashier + manager pw', zNumber: 'ZR-NEW', user: 'boss', password: 'boss-pw' }), kzs2 = await K.st();
    rec('18c cashier: 117 refused with no password and with a wrong one (nothing sent); a valid manager password cancels it once', !kz.j.ok && kz.j.needManager && !kzw.j.ok && kzs.counters.zCancel === 0 && kzok.j.ok && kzs2.counters.zCancel === 1, JSON.stringify([kz.j.message, kzw.j.message, kzok.j.message]));
    rec('19 audit log: an intent line before every send, a done line after; no passwords', au.some(e => e.step === 'intent') && au.some(e => e.step === 'done') && !/boss-pw|password/.test(S.file('cashfix-log.jsonl')));
    rec('20 no reply ever carries a password', !/boss-pw|"password"/i.test((S.replies || []).concat(K.replies || []).join('\n')));
  } catch (e) { rec('crash', false, String(e && e.stack || e)); }
  S.stop(); K.stop();
  console.log(fails.length ? nPass + ' passed, ' + fails.length + ' failed: ' + fails.join('; ') : nPass + ' passed, 0 failed - ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

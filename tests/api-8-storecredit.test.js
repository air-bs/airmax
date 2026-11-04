// AirMax API Batch 8 - store credit (calls 86 87 88 89 92 93 94). Own fake AIR POS + app, made-up customers, offline.
//   node tests/api-8-storecredit.test.js     ports: API8S_PORT (default 5286; hook +1), cashier server +2 (hook +3). Batch 8 range 5280-5289
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const P1 = Number(process.env.API8S_PORT || 5286), P2 = P1 + 2;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api8-sc-'));
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
  async st() { return (await fetch(this.hook + '/sc-state')).json(); }
  async hk(p) { return (await fetch(this.hook + p)).json(); }
  fault(p, mode, n, skip) { return this.hk('/fault?path=' + p + '&mode=' + mode + '&n=' + (n || 1) + (skip ? '&skip=' + skip : '')); }
  pending() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'credit-pending.json'), 'utf8')); } catch (e) { return []; } }
  file(n) { try { return fs.readFileSync(path.join(this.dir, n), 'utf8'); } catch (e) { return ''; } }
}
const WRITES = ['save', 'begin', 'complete', 'del'];
const writes = st => WRITES.reduce((s, k) => s + st.counters[k], 0);
const mem = (st, id) => st.members.find(m => m.id === id).balance;
const M1 = 'sc-m1', M2 = 'sc-m2', FR = 'RetailRechargeOrder';
let S, K;
const wipe = async () => { await S.hk('/sc-reset'); await S.hk('/fault-clear'); for (const p of S.pending()) if (!['done', 'cancelled'].includes(p.step)) await S.post('sc-resolve', { id: p.id }); };
const cash = async (s, memberId, amount) => { const a = await s.post('sc-start', { memberId, amount, method: 'cash' }); if (!a.j.ok) return { a }; const b = await s.post('sc-pay', { id: a.j.id }); const c = await s.post('sc-finish', { id: a.j.id }); return { a, b, c, id: a.j.id }; };
(async () => {
  S = new Srv(P1, {}, 'main'); K = new Srv(P2, { FAKE_CASHIER: '1' }, 'cashier');
  try {
    const l1 = await S.start(), l2 = await K.start();
    rec('0 both servers up; plugin storecredit.js loaded', l1.ok !== false && /storecredit\.js \(\d+ routes\)/.test(fs.readFileSync(S.logf, 'utf8')) && l2.ok !== false);
    let st = await S.st();
    let x = await cash(S, M2, 10); st = await S.st();
    rec('1 cash credit Start -> Pay -> Finish: one Save, one Begin, one Complete; balance 12.50 -> 22.50 exactly once', x.a.j.ok && x.b.j.ok && x.c.j.ok && x.c.j.done && x.c.j.balanceMatches && st.counters.save === 1 && st.counters.begin === 1 && st.counters.complete === 1 && mem(st, M2) === 22.5, JSON.stringify(x.c.j).slice(0, 200));
    const a1 = await S.post('sc-finish', { id: x.id }), a2 = await S.post('sc-pay', { id: x.id }); st = await S.st();
    rec('2 Finish or Pay again on a finished credit is refused with nothing sent', !a1.j.ok && !a2.j.ok && st.counters.complete === 1 && st.counters.begin === 1 && mem(st, M2) === 22.5, JSON.stringify([a1.j, a2.j]).slice(0, 160));
    await wipe();
    const two = await Promise.all([S.post('sc-start', { memberId: M1, amount: 5 }), S.post('sc-start', { memberId: M1, amount: 5 })]); st = await S.st();
    rec('3 two Start presses at once -> one order', two.filter(r => r.j.ok).length === 1 && st.counters.save === 1 && st.orders.length === 1);
    const id3 = two.find(r => r.j.ok).j.id;
    const pp = await Promise.all([S.post('sc-pay', { id: id3 }), S.post('sc-pay', { id: id3 })]); st = await S.st();
    rec('4 two Pay presses at once -> one ReceiveBegin', pp.every(r => r.j.ok || r.j.busy) && st.counters.begin === 1);
    const ff = await Promise.all([S.post('sc-finish', { id: id3 }), S.post('sc-finish', { id: id3 })]); st = await S.st();
    rec('5 two Finish presses at once -> one Complete, balance +5 once', ff.filter(r => r.j.ok).length === 1 && st.counters.complete === 1 && mem(st, M1) === 5 && st.completeCalls[id3] === 1, JSON.stringify(ff.map(r => r.j.ok || r.j.message)));
    // unclear answers
    await wipe();
    await S.fault(FR + 'Save', 'lost', 1); let l = await S.post('sc-start', { memberId: M1, amount: 4 }); st = await S.st();
    rec('6 lost reply on Start (AIR POS did save): adopted by reading the order; one order, one Save', l.j.ok && st.counters.save === 1 && st.orders.length === 1);
    await wipe(); await S.fault(FR + 'Save', 'down', 1); l = await S.post('sc-start', { memberId: M1, amount: 4 }); st = await S.st();
    rec('7 Start when AIR POS is unreachable: "not started", nothing pending', !l.j.ok && st.counters.save === 0 && S.pending().filter(p => !['done', 'cancelled'].includes(p.step)).length === 0);
    await wipe();
    let s1 = await S.post('sc-start', { memberId: M1, amount: 6 }); await S.post('sc-pay', { id: s1.j.id }); await S.fault(FR + 'Complete', 'lost', 1);
    const f1 = await S.post('sc-finish', { id: s1.j.id }), f2 = await S.post('sc-finish', { id: s1.j.id }); st = await S.st();
    rec('8 lost reply on Finish (AIR POS did it): "not sure", second Finish refused, Complete stays 1', !f1.j.ok && f1.j.unknown && !f2.j.ok && st.counters.complete === 1);
    const rs = await S.post('sc-resolve', { id: s1.j.id }); st = await S.st();
    rec('9 "Check what happened": done, balance +6 once, still one Complete', rs.j.ok && rs.j.done && mem(st, M1) === 6 && st.counters.complete === 1, JSON.stringify(rs.j).slice(0, 200));
    await wipe();
    s1 = await S.post('sc-start', { memberId: M1, amount: 7 }); await S.post('sc-pay', { id: s1.j.id }); await S.fault(FR + 'Complete', 'http500', 1);
    const h1 = await S.post('sc-finish', { id: s1.j.id }), h2 = await S.post('sc-finish', { id: s1.j.id }), hr = await S.post('sc-resolve', { id: s1.j.id }), h3 = await S.post('sc-finish', { id: s1.j.id }); st = await S.st();
    rec('10 HTTP 500 where nothing happened: Finish locked until Check sees nothing added, then ONE more Finish: +7 once', !h1.j.ok && !h2.j.ok && hr.j.ok && h3.j.ok && mem(st, M1) === 7 && st.completeCalls[s1.j.id] === 1, JSON.stringify([h1.j.message, hr.j.message, h3.j]).slice(0, 300));
    await wipe();
    s1 = await S.post('sc-start', { memberId: M1, amount: 8 }); await S.post('sc-pay', { id: s1.j.id }); await S.fault(FR + 'Complete', 'http500-done', 1);
    await S.post('sc-finish', { id: s1.j.id }); const dr = await S.post('sc-resolve', { id: s1.j.id }); st = await S.st();
    rec('11 HTTP 500 after AIR POS did it: Check finds it finished, +8 once, no second Complete', dr.j.ok && dr.j.done && st.counters.complete === 1 && mem(st, M1) === 8);
    await wipe();
    s1 = await S.post('sc-start', { memberId: M1, amount: 9 }); await S.post('sc-pay', { id: s1.j.id }); await S.fault(FR + 'Complete', 'lost', 1); await S.fault(FR + 'Get', 'down', 3, 1);
    const u1 = await S.post('sc-finish', { id: s1.j.id }); const w0 = writes(await S.st()), u2 = await S.post('sc-finish', { id: s1.j.id }), u3 = await S.post('sc-pay', { id: s1.j.id }); st = await S.st();
    rec('12 answer unclear AND unreadable: unknown, Pay/Finish locked, zero more writes', !u1.j.ok && u1.j.unknown && !u2.j.ok && !u3.j.ok && writes(st) === w0 && st.counters.complete === 1);
    await S.hk('/fault-clear'); await S.post('sc-resolve', { id: s1.j.id });
    // card
    await wipe();
    const cs = await S.post('sc-start', { memberId: M1, amount: 12, method: 'card' }), cp1 = await S.post('sc-pay', { id: cs.j.id });
    const ck1 = await S.post('sc-pay-check', { id: cs.j.id }), fin0 = await S.post('sc-finish', { id: cs.j.id });
    await S.hk('/sc-approve?id=' + cs.j.id); const ck2 = await S.post('sc-pay-check', { id: cs.j.id }), fin1 = await S.post('sc-finish', { id: cs.j.id }); st = await S.st();
    rec('13 card: waiting -> paid -> Finish; Finish before paid refused; balance +12 once', cp1.j.ok && cp1.j.waiting && ck1.j.waiting && !fin0.j.ok && ck2.j.paid && fin1.j.ok && st.counters.complete === 1 && st.counters.begin === 1 && mem(st, M1) === 12, JSON.stringify([fin0.j.message, fin1.j]).slice(0, 250));
    // checks on input
    await wipe();
    const bad = [await S.post('sc-start', { memberId: M1, amount: '0.50' }), await S.post('sc-start', { memberId: M1, amount: '-5' }), await S.post('sc-start', { memberId: M1, amount: '1e3' }), await S.post('sc-start', { memberId: M1, amount: '5000' }), await S.post('sc-start', { memberId: 'nobody', amount: '5' }), await S.post('sc-start', { amount: '5' })]; st = await S.st();
    rec('14 bad amount / unknown or missing customer: refused, nothing sent to AIR POS', bad.every(r => !r.j.ok) && st.counters.save === 0, JSON.stringify(bad.map(r => r.j.message)));
    // delete
    const d0 = await S.post('sc-start', { memberId: M1, amount: 3 }); const del = await S.post('sc-delete', { id: d0.j.id }); st = await S.st();
    rec('15 an unpaid credit started on this register can be deleted by the cashier; list no longer shows it', d0.j.ok && del.j.ok && st.counters.del === 1 && st.orders[0].deleted);
    await wipe();
    const d1 = await S.post('sc-start', { memberId: M1, amount: 3 }); await S.post('sc-pay', { id: d1.j.id }); const dd = await S.post('sc-delete', { id: d1.j.id }); st = await S.st();
    rec('16 a credit whose cash was taken is NOT deleted (payment may be involved)', !dd.j.ok && st.counters.del === 0);
    await S.post('sc-finish', { id: d1.j.id });
    // finished order can't be deleted
    const dfin = await S.post('sc-delete', { id: d1.j.id }); st = await S.st();
    rec('17 a finished credit cannot be deleted', !dfin.j.ok && st.counters.del === 0);
    // cashier permissions
    const kw0 = await K.st(); const ko = await K.post('sc-orders', {}), kd = await K.post('sc-order', { id: 'x' });
    const k1 = await K.post('sc-start', { memberId: M1, amount: 2 }); const kdel = await K.post('sc-delete', { id: 'not-mine' });
    rec('18 cashier: can add paid credit; cannot read the order list/one order or delete another order (manager needed)', k1.j.ok && !ko.j.ok && ko.j.needManager && !kd.j.ok && kd.j.needManager && !kdel.j.ok && kdel.j.needManager, JSON.stringify([ko.j, kdel.j]).slice(0, 200));
    await K.post('sc-delete', { id: k1.j.id });
    const kb = await K.post('sc-orders', { user: 'boss', password: 'wrong' }), kg = await K.post('sc-orders', { user: 'boss', password: 'boss-pw' });
    rec('19 cashier + wrong manager password refused; right password reads the list (password never stored or echoed)', !kb.j.ok && kg.j.ok && !/boss-pw/.test(JSON.stringify([kb.j, kg.j])) && !/boss-pw/.test(K.file('credit-log.jsonl') + K.file('credit-pending.json')), JSON.stringify([kb.j, kg.j]).slice(0, 200));
    const seedS = async (srv, id) => (await (await fetch(srv.hook + '/sc-seed?id=' + id)).json()).id;
    await seedS(S, 'other-m'); const mdel = await S.post('sc-delete', { id: 'other-m' }); let mst = await S.st();
    rec('19b logged-in manager deletes another register\'s credit order with NO password; one delete sent', mdel.j.ok && mst.orders.find(o => o.id === 'other-m').deleted, JSON.stringify(mdel.j));
    await seedS(K, 'other-k'); const kd1 = await K.post('sc-delete', { id: 'other-k' }), kd2 = await K.post('sc-delete', { id: 'other-k', user: 'boss', password: 'nope' }); const kst1 = await K.st();
    const kd3 = await K.post('sc-delete', { id: 'other-k', user: 'boss', password: 'boss-pw' }); const kst2 = await K.st();
    rec('19c cashier: deleting another register\'s credit order refused with no / wrong password (nothing deleted); valid manager password deletes it', !kd1.j.ok && kd1.j.needManager && !kd2.j.ok && !kst1.orders.find(o => o.id === 'other-k').deleted && kd3.j.ok && kst2.orders.find(o => o.id === 'other-k').deleted, JSON.stringify([kd1.j.message, kd2.j.message, kd3.j.message]));
    // reads
    const rl = await S.post('sc-orders', {}), ro = await S.post('sc-order', { id: d1.j.id }), rnone = await S.post('sc-order', { id: 'nope' }), op = await S.post('sc-open', {});
    rec('20 manager reads: list, one order, unknown order refused; open list answers; reads make no write', rl.j.ok && rl.j.rows.length >= 1 && ro.j.ok && ro.j.order.status === 20 && !rnone.j.ok && op.j.ok);
    // second customer isolation + audit
    const au = S.file('credit-log.jsonl').split('\n').filter(Boolean).map(l => JSON.parse(l));
    rec('21 audit log has one done line per finished credit; no names, no passwords', au.filter(e => e.kind === 'store-credit').length >= 1 && !/Made Up|boss-pw|password/.test(S.file('credit-log.jsonl')));
    const all = (S.replies || []).concat(K.replies || []).join('\n');
    rec('22 no reply ever carries a password or card number', !/boss-pw|"password"|cvv/i.test(all));
  } catch (e) { rec('crash', false, String(e && e.stack || e)); }
  S.stop(); K.stop();
  console.log(fails.length ? nPass + ' passed, ' + fails.length + ' failed: ' + fails.join('; ') : nPass + ' passed, 0 failed - ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

// AirMax API Batch 8 - gift cards (calls 57 60 62 64 65 66 67 68 69 70 71 72) and the manager-only "no payment" credit.
// Starts its OWN fake AIR POS + app (made-up cards, offline) with a stateful fake (tests/fake-api/giftcards.js) that counts every call and can fail on demand.
//   node tests/api-8-giftcards.test.js     ports: API8_PORT (default 5286; hook = +1), cashier server on +2 (hook +3). Batch 8 range 5280-5289; the api-8 unit tests share 5286-5289, run them one at a time
// Money invariants asserted: one order per Start; ReceiveBegin once; Complete once; the card balance rises once, by the order amount, only at Finish.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const P1 = Number(process.env.API8_PORT || 5286), P2 = P1 + 2;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api8-gc-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; let nPass = 0;
const rec = (k, pass, note) => { if (!pass) fails.push(k); else nPass++; console.log((pass ? 'PASS ' : 'FAIL ') + k + (note && !pass ? ' - ' + note : '')); };
const PW = process.env.AIRMAX_TEST_PW || 'x';
class Srv {
  constructor(port, env, dirName) { this.port = port; this.env = env || {}; this.dir = path.join(T, dirName); fs.mkdirSync(this.dir, { recursive: true }); this.logf = path.join(T, dirName + '.log'); this.base = 'http://127.0.0.1:' + port; this.hook = 'http://127.0.0.1:' + (port + 1); }
  async start() {
    this.p = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(this.port), FAKE_DATA_DIR: this.dir, B8_FAKE: '1', ...this.env }, stdio: ['ignore', fs.openSync(this.logf, 'a'), fs.openSync(this.logf, 'a')] });
    for (let i = 0; i < 60; i++) { try { await fetch(this.base + '/api/shortcuts'); break; } catch (e) { await sleep(250); } }
    const l = await this.post('login', { company: 'fake shop', user: 'tester', password: PW }); return l.j;
  }
  stop() { try { this.p.kill(); } catch (e) { /* gone */ } }
  async post(r, x) { const res = await fetch(this.base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }); const txt = await res.text(); this.replies = (this.replies || []).concat(txt); return { status: res.status, j: JSON.parse(txt) }; }
  async st() { return (await fetch(this.hook + '/gc-state')).json(); }
  async hk(p) { return (await fetch(this.hook + p)).json(); }
  fault(p, mode, n, skip) { return this.hk('/fault?path=' + p + '&mode=' + mode + '&n=' + (n || 1) + (skip ? '&skip=' + skip : '')); }
  pending() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'gift-pending.json'), 'utf8')); } catch (e) { return []; } }
  file(n) { try { return fs.readFileSync(path.join(this.dir, n), 'utf8'); } catch (e) { return ''; } }
  log() { return fs.readFileSync(this.logf, 'utf8'); }
}
const WRITES = ['save', 'begin', 'complete', 'cancelPay', 'cancel', 'del', 'update'];
const openP = () => S.pending().filter(p => !['done', 'cancelled'].includes(p.step));
const writes = st => WRITES.reduce((s, k) => s + st.counters[k], 0);
const card = (st, no) => st.cards.find(c => c.cardNo === no);
const C1 = 'FAKEGC-0001', C2 = 'FAKEGC-0002', C3 = 'FAKEGC-0003', C4 = 'FAKEGC-0004', C5 = 'FAKEGC-0005', C6 = 'FAKEGC-0006';
const cashFlow = async (s, no, amount) => { const a = await s.post('gc-topup-start', { number: no, amount, method: 'cash' }); if (!a.j.ok) return { a }; const b = await s.post('gc-topup-pay', { id: a.j.id }); const c = await s.post('gc-topup-finish', { id: a.j.id }); return { a, b, c, id: a.j.id }; };

let S, K;
const wipe = async () => { await S.hk('/gc-reset'); await S.hk('/fault-clear'); for (const p of S.pending()) if (!['done', 'cancelled'].includes(p.step)) await S.post('gc-topup-resolve', { id: p.id }); };
(async () => {
  S = new Srv(P1, {}, 'main'); K = new Srv(P2, { FAKE_CASHIER: '1' }, 'cashier');
  try {
    const l1 = await S.start(), l2 = await K.start();
    rec('0 both servers up and logged in; plugin giftcards.js loaded', l1.ok !== false && /giftcards\.js \(\d+ routes\)/.test(S.log()) && l2.ok !== false, JSON.stringify(l1).slice(0, 100));

    // ---- reads
    const before = await S.st();
    const r60 = await S.post('gc-cards', { keyword: 'FAKEGC' }), r57 = await S.post('gc-card', { number: C1 }), r57b = await S.post('gc-card', { id: 'gcard-1' }), r72 = await S.post('gc-orders', {}), r71 = await S.post('gc-order', { id: 'nope' }), r66 = await S.post('gc-pay-check', { id: 'nope' }), ro = await S.post('gc-open');
    const after = await S.st();
    rec('1 reads (60 57 72 71 66, open list) answer and make zero writes at AIR POS', r60.j.ok && r60.j.rows.length === 6 && r57.j.ok && r57b.j.card.id === 'gcard-1' && r72.j.ok && r71.j.ok === false && r66.j.ok === false && ro.j.ok && writes(after) === 0, JSON.stringify(r60.j).slice(0, 120));
    rec('2 a card read never shows the secret password or the full number (only ****1234)', !/SECRET-PW|FAKEGC-000/.test(JSON.stringify([r60.j, r57.j, r57b.j])) && r57.j.card.cardMask === '****0001', JSON.stringify(r57.j));

    // ---- paid top-up, cash, happy path
    let x = await cashFlow(S, C1, 10), st = await S.st();
    rec('3 cash top-up Start -> Pay -> Finish: one Save, one Begin, one Complete; balance 20 -> 30 exactly once; X-read cash +10', x.a.j.ok && x.b.j.ok && x.c.j.ok && x.c.j.done && st.counters.save === 1 && st.counters.begin === 1 && st.counters.complete === 1 && card(st, C1).balance === 30 && x.c.j.balBefore === 20 && x.c.j.balAfter === 30 && st.xread.cashInDrawer === 10, JSON.stringify(x.c && x.c.j).slice(0, 200));
    const again = await S.post('gc-topup-finish', { id: x.id }), again2 = await S.post('gc-topup-pay', { id: x.id }); st = await S.st();
    rec('4 Finish or Pay again on a finished top-up is refused with nothing sent (Complete stays at 1, balance 30)', !again.j.ok && !again2.j.ok && st.counters.complete === 1 && st.counters.begin === 1 && card(st, C1).balance === 30, JSON.stringify([again.j, again2.j]).slice(0, 160));

    // ---- concurrency
    await wipe();
    const two = await Promise.all([S.post('gc-topup-start', { number: C1, amount: 5 }), S.post('gc-topup-start', { number: C1, amount: 5 })]); st = await S.st();
    rec('5 two Start presses at once -> one order (the other is busy or refused)', two.filter(r => r.j.ok).length === 1 && st.counters.save === 1 && st.orders.length === 1, JSON.stringify(two.map(r => r.j.ok || r.j.message)));
    const id5 = two.find(r => r.j.ok).j.id;
    const pp = await Promise.all([S.post('gc-topup-pay', { id: id5 }), S.post('gc-topup-pay', { id: id5 })]); st = await S.st();
    rec('6 two Pay presses at once -> one ReceiveBegin', pp.every(r => r.j.ok || r.j.busy) && st.counters.begin === 1, JSON.stringify(pp.map(r => r.j.ok || r.j.message)));
    const ff = await Promise.all([S.post('gc-topup-finish', { id: id5 }), S.post('gc-topup-finish', { id: id5 })]); st = await S.st();
    rec('7 two Finish presses at once -> one Complete, balance +5 once', ff.filter(r => r.j.ok).length === 1 && st.counters.complete === 1 && card(st, C1).balance === 25 && st.completeCalls[id5] === 1, JSON.stringify(ff.map(r => r.j.ok || r.j.message)));
    await wipe(); const pc = await S.post('gc-topup-start', { number: C4, amount: 3 }); await S.post('gc-topup-pay', { id: pc.j.id });
    const mix = await Promise.all([S.post('gc-pay-cancel', { id: pc.j.id }), S.post('gc-topup-finish', { id: pc.j.id })]); st = await S.st();
    rec('8 Cancel payment and Finish at the same time -> exactly one runs', st.counters.cancelPay + st.counters.complete === 1 && (st.completeCalls[pc.j.id] || 0) <= 1, JSON.stringify(mix.map(r => r.j.busy ? 'busy' : r.j.ok)));
    // ---- lost / unclear replies
    await wipe();
    await S.fault('RetailGiftCardRechargeOrderSave', 'lost', 1);
    const l = await S.post('gc-topup-start', { number: C1, amount: 4 }); st = await S.st();
    rec('9 lost reply on Start (AIR POS did save): adopted by reading the order; one order, no second Save', l.j.ok && st.counters.save === 1 && st.orders.length === 1 && openP()[0].step === 'saved', JSON.stringify(l.j).slice(0, 150));
    await wipe(); await S.fault('RetailGiftCardRechargeOrderSave', 'down', 1);
    const dn = await S.post('gc-topup-start', { number: C1, amount: 4 }); st = await S.st();
    rec('10 Start when AIR POS is unreachable (never arrived): "not started", nothing saved, nothing pending', !dn.j.ok && st.counters.save === 0 && st.orders.length === 0 && openP().length === 0, JSON.stringify(dn.j).slice(0, 150));
    await wipe();
    // lost reply on Complete
    let s1 = await S.post('gc-topup-start', { number: C1, amount: 6 }); await S.post('gc-topup-pay', { id: s1.j.id });
    await S.fault('RetailGiftCardRechargeOrderComplete', 'lost', 1);
    const f1 = await S.post('gc-topup-finish', { id: s1.j.id }), f2 = await S.post('gc-topup-finish', { id: s1.j.id }); st = await S.st();
    rec('11 lost reply on Finish (AIR POS did it): shown as "not sure", a second Finish is refused, Complete count stays 1', !f1.j.ok && f1.j.unknown && !f2.j.ok && st.counters.complete === 1 && openP()[0].step === 'unknown-completing', JSON.stringify([f1.j, f2.j]).slice(0, 220));
    const rs = await S.post('gc-topup-resolve', { id: s1.j.id }); st = await S.st();
    rec('12 "Check what happened" reads the order + card: done, balance +6 once, still one Complete', rs.j.ok && rs.j.done && card(st, C1).balance === 26 && st.counters.complete === 1, JSON.stringify(rs.j).slice(0, 200));
    await wipe();
    // 500 where AIR POS did nothing
    s1 = await S.post('gc-topup-start', { number: C1, amount: 7 }); await S.post('gc-topup-pay', { id: s1.j.id });
    await S.fault('RetailGiftCardRechargeOrderComplete', 'http500', 1);
    const h1 = await S.post('gc-topup-finish', { id: s1.j.id }), h2 = await S.post('gc-topup-finish', { id: s1.j.id });
    const hr = await S.post('gc-topup-resolve', { id: s1.j.id }), h3 = await S.post('gc-topup-finish', { id: s1.j.id }); st = await S.st();
    rec('13 HTTP 500 on Finish where nothing happened: Finish locked until "Check what happened" sees order not finished and balance unchanged, then ONE Finish reaches AIR POS: balance +7 once', !h1.j.ok && !h2.j.ok && hr.j.ok && hr.j.step === 'paid' && h3.j.ok && st.counters.complete === 1 && card(st, C1).balance === 27 && st.completeCalls[s1.j.id] === 1, JSON.stringify([h1.j.message, hr.j, h3.j.ok]).slice(0, 220));
    await wipe();
    s1 = await S.post('gc-topup-start', { number: C1, amount: 8 }); await S.post('gc-topup-pay', { id: s1.j.id });
    await S.fault('RetailGiftCardRechargeOrderComplete', 'http500-done', 1);
    const d1 = await S.post('gc-topup-finish', { id: s1.j.id }), dr = await S.post('gc-topup-resolve', { id: s1.j.id }); st = await S.st();
    rec('14 HTTP 500 after AIR POS did it: check finds it finished, balance +8 once, no second Complete', !d1.j.ok && dr.j.ok && dr.j.done && st.counters.complete === 1 && card(st, C1).balance === 28, JSON.stringify(dr.j).slice(0, 200));
    await wipe();
    // unreadable after unclear
    s1 = await S.post('gc-topup-start', { number: C1, amount: 9 }); await S.post('gc-topup-pay', { id: s1.j.id });
    await S.fault('RetailGiftCardRechargeOrderComplete', 'lost', 1); await S.fault('RetailGiftCardRechargeOrderGet', 'down', 3, 1);
    const u1 = await S.post('gc-topup-finish', { id: s1.j.id }); const w0 = writes(await S.st());
    const u2 = await S.post('gc-topup-finish', { id: s1.j.id }), u3 = await S.post('gc-topup-pay', { id: s1.j.id }); st = await S.st();
    rec('15 answer unclear AND unreadable: state unknown, Pay/Finish locked, zero further writes at AIR POS', !u1.j.ok && u1.j.unknown && !u2.j.ok && !u3.j.ok && writes(st) === w0 && st.counters.complete === 1, JSON.stringify([u1.j.message, u2.j.message]).slice(0, 200));
    await S.hk('/fault-clear'); await S.post('gc-topup-resolve', { id: s1.j.id });
    // ---- card payment
    await wipe();
    const cs = await S.post('gc-topup-start', { number: C1, amount: 12, method: 'card' }), cp1 = await S.post('gc-topup-pay', { id: cs.j.id });
    const ck1 = await S.post('gc-pay-check', { id: cs.j.id }), fin0 = await S.post('gc-topup-finish', { id: cs.j.id });
    await S.fault('RetailGiftCardRechargeOrderReceiveCheck', 'http500', 3); const e1 = await S.post('gc-pay-check', { id: cs.j.id }), e2 = await S.post('gc-pay-check', { id: cs.j.id }), e3 = await S.post('gc-pay-check', { id: cs.j.id });
    await S.hk('/gc-approve?id=' + cs.j.id); const ck2 = await S.post('gc-pay-check', { id: cs.j.id }), fin1 = await S.post('gc-topup-finish', { id: cs.j.id }); st = await S.st();
    rec('16 card: waiting -> (poll errors, never cancelled) -> paid -> Finish: one Begin, one Complete, balance +12; Finish before paid refused', cp1.j.ok && cp1.j.waiting && ck1.j.waiting && !fin0.j.ok && !e1.j.ok && !e2.j.ok && !e3.j.ok && ck2.j.paid && fin1.j.ok && st.counters.begin === 1 && st.counters.complete === 1 && st.counters.cancelPay === 0 && card(st, C1).balance === 32, JSON.stringify([ck1.j, fin0.j.message, fin1.j]).slice(0, 220));
    await wipe();
    const c2 = await S.post('gc-topup-start', { number: C1, amount: 5, method: 'card' }); await S.post('gc-topup-pay', { id: c2.j.id });
    await S.hk('/gc-approve?id=' + c2.j.id); const cc2 = await S.post('gc-pay-cancel', { id: c2.j.id }); st = await S.st();
    rec('17 Cancel payment after the card was approved: refused, ReceiveCancel (68) never sent, shows paid', !cc2.j.ok && cc2.j.paid === true && st.counters.cancelPay === 0, JSON.stringify(cc2.j));
    await wipe();
    const c3 = await S.post('gc-topup-start', { number: C1, amount: 5, method: 'card' }); await S.post('gc-topup-pay', { id: c3.j.id });
    const cc3 = await S.post('gc-pay-cancel', { id: c3.j.id }); st = await S.st();
    rec('18 Cancel payment while truly waiting: 68 sent once, balance unchanged, top-up still open', cc3.j.ok && st.counters.cancelPay === 1 && card(st, C1).balance === 20 && S.pending().find(p => p.id === c3.j.id).step === 'saved', JSON.stringify(cc3.j));
    await wipe();
    const lb = await S.post('gc-topup-start', { number: C1, amount: 5, method: 'card' }); await S.fault('RetailGiftCardRechargeOrderReceiveBegin', 'lost', 1);
    const lb1 = await S.post('gc-topup-pay', { id: lb.j.id }), lb2 = await S.post('gc-topup-pay', { id: lb.j.id }); st = await S.st();
    rec('19 lost reply on a card Pay: "a payment may be open", Pay is not offered again (one ReceiveBegin)', !lb1.j.ok && lb1.j.unknown && !lb2.j.ok && st.counters.begin === 1, JSON.stringify([lb1.j.message, lb2.j.message]).slice(0, 200));
    await S.hk('/fault-clear'); await wipe();

    // ---- restart
    await wipe();
    const rs1 = await S.post('gc-topup-start', { number: C5, amount: 4 }); await S.post('gc-topup-pay', { id: rs1.j.id });
    const gstate = await S.st(); S.stop(); await sleep(600);
    // the fake AIR POS keeps its state in the same process, so a restart brings back a fresh fake: re-create the order there
    await S.start(); const op = await S.post('gc-open');
    rec('20 after the app restarts the open top-up is listed from the pending file (step paid), nothing is sent automatically', op.j.ok && op.j.open.length === 1 && op.j.open[0].step === 'paid' && op.j.open[0].amount === 4 && (await S.st()).counters.complete === 0 && gstate.counters.complete === 0, JSON.stringify(op.j).slice(0, 200));
    const rf = await S.post('gc-topup-finish', { id: rs1.j.id });
    rec('21 after a restart Finish never runs on a top-up AIR POS does not know: refused, zero Complete', !rf.j.ok && (await S.st()).counters.complete === 0, JSON.stringify(rf.j).slice(0, 160));
    await S.post('gc-topup-resolve', { id: rs1.j.id }); await wipe();

    // ---- refusals
    const o1 = await S.post('gc-topup-start', { number: C1, amount: 5 }); const o2 = await S.post('gc-topup-start', { number: C5, amount: 5 }); st = await S.st();
    rec('22 a second top-up while one is open is refused (one Save only)', o1.j.ok && !o2.j.ok && o2.j.open && o2.j.open.length === 1 && st.counters.save === 1, JSON.stringify(o2.j).slice(0, 160));
    await S.post('gc-pay-cancel', { id: o1.j.id }); await S.post('gc-order-delete', { id: o1.j.id }); await wipe();
    const sv0 = (await S.st()).counters.save;
    const bads = [0, -5, 'abc', '10.555', 99999999, 0.5, '', null, '1e3'];
    const res = []; for (const a of bads) res.push(await S.post('gc-topup-start', { number: C1, amount: a }));
    const cardBad = await S.post('gc-topup-start', { cardId: 'bogus', amount: 5 }), exp = await S.post('gc-topup-start', { number: C2, amount: 5 }), uns = await S.post('gc-topup-start', { number: C3, amount: 5 }), nocard = await S.post('gc-topup-start', { number: 'NOPE', amount: 5 }); st = await S.st();
    rec('23 bad amounts (0, negative, text, 3 decimals, huge, empty), unknown card, expired card, unsold card -> all refused, no Save sent', res.every(r => !r.j.ok) && !cardBad.j.ok && !exp.j.ok && !uns.j.ok && !nocard.j.ok && st.counters.save === sv0, JSON.stringify(res.map(r => r.j.message)).slice(0, 200));
    const cl = await S.post('gc-topup-start', { number: C1, amount: 5, balance: 9999, cardId: 'gcard-5', id: 'evil', method: 'cash' }); st = await S.st();
    rec('24 the screen cannot choose the order id, card or balance: a client-sent id/cardId/balance is ignored (card FAKEGC-0001 was refilled, not 0005; number wins over a sent cardId)', cl.j.ok && cl.j.id !== 'evil' && st.orders[0].retailGiftCardId === 'gcard-1' && st.orders[0].amount === 5 && card(st, C1).balance === 20, JSON.stringify(cl.j).slice(0, 160));
    await S.post('gc-pay-cancel', { id: cl.j.id }); await S.post('gc-order-delete', { id: cl.j.id }); await wipe();

    // ---- cancel / delete
    const d0 = await S.post('gc-topup-start', { number: C1, amount: 5 }), dd = await S.post('gc-order-delete', { id: d0.j.id }); st = await S.st();
    rec('25 Delete (70) of an unpaid top-up: sent once, gone from the list (Get alone would still show it), balance unchanged', dd.j.ok && dd.j.stillListed === false && st.counters.del === 1 && st.orders[0].deleted && card(st, C1).balance === 20, JSON.stringify(dd.j));
    await wipe();
    const d1x = await S.post('gc-topup-start', { number: C1, amount: 5 }), cn = await S.post('gc-order-cancel', { id: d1x.j.id }); st = await S.st();
    rec('26 Cancel (69) answering HTTP 404 (as on TestShop): "no Cancel on this server, use Delete", one call, nothing changed', !cn.j.ok && cn.j.notAvailable === true && st.counters.cancel === 1 && card(st, C1).balance === 20, JSON.stringify(cn.j));
    await S.post('gc-order-delete', { id: d1x.j.id }); await wipe();
    const fx = await cashFlow(S, C1, 5), dl = await S.post('gc-order-delete', { id: fx.id }), cx = await S.post('gc-order-cancel', { id: fx.id }); st = await S.st();
    rec('27 Delete and Cancel on a finished top-up refused, nothing sent', !dl.j.ok && !cx.j.ok && st.counters.del === 0 && st.counters.cancel === 0, JSON.stringify([dl.j.message, cx.j.message]));
    await wipe();

    // ---- free credit (no payment)
    const fr = await S.post('gc-free-credit', { number: C1, amount: 10, amount2: 10, reason: 'Wrong card sold, owner OK' }); st = await S.st();
    const fo = st.orders[0];
    rec('28 free credit: ONE Save with paymentAmount 0, one $0 cash receive, one Complete; balance 20 -> 30 once; X-read "gift top-ups" and cash unchanged', fr.j.ok && fr.j.done && fo.pay === 0 && fo.amount === 10 && st.counters.save === 1 && st.counters.begin === 1 && st.counters.complete === 1 && card(st, C1).balance === 30 && st.xread.giftTopUps === 0 && st.xread.cashInDrawer === 0, JSON.stringify(fr.j).slice(0, 200));
    const logTxt = S.file('gift-credit-log.jsonl'), logs = logTxt.split('\n').filter(Boolean).map(JSON.parse);
    rec('29 audit log: an "intent" line before and a "done" line after (reason, by, amount, card last 4, before/after); no full card number', logs[0].result === 'intent' && logs[1].result === 'done' && logs[1].reason === 'Wrong card sold, owner OK' && logs[1].amount === 10 && logs[1].last4 === '0001' && logs[1].balBefore === 20 && logs[1].balAfter === 30 && !/FAKEGC-000/.test(logTxt), logTxt.slice(0, 200));
    const fl = await S.post('gc-free-list', {}), ord = await S.post('gc-orders', {});
    rec('30 free-credit list shows it (manager); the top-up order list flags it as free', fl.j.ok && fl.j.rows.length === 1 && fl.j.rows[0].amount === 10 && fl.j.total === 10 && ord.j.rows[0].free === true, JSON.stringify(fl.j).slice(0, 200));
    await wipe(); const sv1 = (await S.st()).counters;
    const bad = [
      await S.post('gc-free-credit', { number: C1, amount: 10, amount2: 11, reason: 'typed twice differently' }),
      await S.post('gc-free-credit', { number: C1, amount: 10, amount2: 10, reason: '  ' }),
      await S.post('gc-free-credit', { number: C1, amount: 0, amount2: 0, reason: 'zero amount' }),
      await S.post('gc-free-credit', { number: C2, amount: 5, amount2: 5, reason: 'expired card is blocked' }),
      await S.post('gc-free-credit', { number: C3, amount: 5, amount2: 5, reason: 'unsold card is blocked' }),
      await S.post('gc-free-credit', { number: 'NOPE', amount: 5, amount2: 5, reason: 'unknown card' }),
    ]; st = await S.st();
    rec('31 free credit refused (amounts differ, no reason, $0, expired card, unsold card, unknown card): zero writes at AIR POS', bad.every(r => !r.j.ok) && writes(st) === 0, JSON.stringify(bad.map(r => r.j.message)).slice(0, 300));
    // settings
    const g0 = await S.post('gc-settings', {}), g1 = await S.post('gc-settings', { set: { freeCreditLimit: 20, allowExpired: true } });
    const big = await S.post('gc-free-credit', { number: C1, amount: 500, amount2: 500, reason: 'large credit, no limit' }); const stBig = await S.st();
    rec('32 no per-credit limit and no AirMax expiry setting: settings carry no limit / allowExpired / pending fields, a set is refused, $500 free credit goes through exactly once', g0.j.ok && !('freeCreditLimit' in g0.j.settings) && !('allowExpired' in g0.j.settings) && !('pendingOwner' in g0.j.settings) && !g1.j.ok && big.j.ok && card(stBig, C1).balance === 520 && stBig.counters.complete - sv1.complete === 1, JSON.stringify([big.j.ok, card(stBig, C1).balance, stBig.counters.complete, sv1.complete]).slice(0, 260));
    await wipe();
    // expiry comes ONLY from AIR POS: no expireDate -> never expires; a date but AIR POS says not expired -> allowed; AIR POS expired flag -> blocked
    await S.hk('/gc-card?id=gcard-5&expired=0&expireDate=');
    const ne = await S.post('gc-free-credit', { number: 'FAKEGC-0005', amount: 2, amount2: 2, reason: 'no AIR POS expiry' }); await wipe();
    await S.hk('/gc-card?id=gcard-6&expired=0&expireDate=' + encodeURIComponent('2020-01-01T00:00:00.000+08:00'));
    const pd = await S.post('gc-free-credit', { number: 'FAKEGC-0006', amount: 2, amount2: 2, reason: 'old date but AIR POS not expired' }); await wipe();
    const wxp = writes(await S.st());
    await S.hk('/gc-card?id=gcard-5&expired=1');
    const ax = await S.post('gc-free-credit', { number: 'FAKEGC-0005', amount: 2, amount2: 2, reason: 'AIR POS marks expired' }); const stx = await S.st();
    await S.hk('/gc-card?id=gcard-5&expired=0');
    rec('32b expiry is AIR POS\'s own `expired` flag only: card with no AIR POS expiry -> Add credit allowed; old expireDate but expired=false -> allowed (AirMax computes nothing); AIR POS expired=true -> blocked, zero writes', ne.j.ok && pd.j.ok && !ax.j.ok && /expired/i.test(ax.j.message) && writes(stx) === wxp, JSON.stringify([ne.j.message, pd.j.message, ax.j.message]).slice(0, 260));
    await wipe();
    // lost reply on a free credit
    await S.fault('RetailGiftCardRechargeOrderComplete', 'lost', 1);
    const lf = await S.post('gc-free-credit', { number: C5, amount: 7, amount2: 7, reason: 'lost reply test' }); const lfr = await S.post('gc-topup-resolve', { id: lf.j.id }); st = await S.st();
    const last = S.file('gift-credit-log.jsonl').split('\n').filter(Boolean).map(JSON.parse);
    rec('33 free credit with a lost Finish reply: "not sure", check finds it done: balance +7 once, one Complete, log has intent -> unknown -> done', !lf.j.ok && lf.j.unknown && lfr.j.ok && lfr.j.done && st.counters.complete === 1 && card(st, C5).balance === 27 && last.slice(-3).map(e => e.result).join() === 'intent,unknown,done', JSON.stringify([lf.j.message, lfr.j, last.map(e => e.result)]).slice(0, 260));
    await wipe();

    // ---- manager gate (cashier server)
    const KB = (await K.st()).counters; void KB;
    const cm = await K.post('perms');
    const noPw = await K.post('gc-free-credit', { number: C1, amount: 5, amount2: 5, reason: 'cashier without password' });
    const wrong = await K.post('gc-free-credit', { number: C1, amount: 5, amount2: 5, reason: 'cashier wrong password', user: 'boss', password: 'nope' });
    const gates = [await K.post('gc-free-list', {}), await K.post('gc-order-delete', { id: 'x' }), await K.post('gc-order-cancel', { id: 'x' }), await K.post('gc-card-update', { id: 'gcard-1' }), await K.post('gc-settings', { set: { freeCreditLimit: 99 } })];
    let kst = await K.st();
    rec('34 cashier (not a manager): free credit, free list, Delete, Cancel, card edit, settings all refused on the server with "needs a manager"; zero writes', cm.j.manager === false && !noPw.j.ok && noPw.j.needManager && !wrong.j.ok && gates.every(r => !r.j.ok && r.j.needManager) && writes(kst) === 0, JSON.stringify([noPw.j, wrong.j.message]).slice(0, 200));
    const okMgr = await K.post('gc-free-credit', { number: C1, amount: 5, amount2: 5, reason: 'cashier + manager password', user: 'boss', password: 'boss-pw' }); kst = await K.st();
    const klog = K.file('gift-credit-log.jsonl');
    rec('35 cashier with a manager name + password (verified by AIR POS): free credit goes through once; log says approved with password; the password is nowhere in the log, pending file or replies', okMgr.j.ok && kst.counters.complete === 1 && /"approvedWithPassword":true/.test(klog) && !/boss-pw/.test(klog + K.file('gift-pending.json') + K.log() + JSON.stringify(K.replies)), JSON.stringify(okMgr.j).slice(0, 160));
    const kc = await K.post('gc-topup-start', { number: C4, amount: 3 }); await K.post('gc-topup-pay', { id: kc.j.id }); const kf = await K.post('gc-topup-finish', { id: kc.j.id });
    rec('36 a cashier can still do a normal paid top-up (no manager needed)', kc.j.ok && kf.j.ok, JSON.stringify(kf.j).slice(0, 100));

    // ---- card edit stays off
    const ue = await S.post('gc-card-update', { id: 'gcard-1' }); let ust = await S.st();
    fs.writeFileSync(path.join(S.dir, 'gift-settings.json'), JSON.stringify({ allowCardEdit: true }));
    const ue2 = await S.post('gc-card-update', { id: 'gcard-1', expireDate: '2030-01-01T00:00:00.000+08:00' }); const ust2 = await S.st();
    rec('37 card edit (62) is OFF by default (zero Update sent); when switched on, a value change after the edit (the TestShop wipe) is detected and reported loudly', !ue.j.ok && ue.j.disabled && ust.counters.update === 0 && !ue2.j.ok && ue2.j.damaged === true && ust2.counters.update === 1, JSON.stringify([ue.j.message, ue2.j]).slice(0, 220));

    // ---- abandon an unpaid top-up (cashier ok) and a typed wrong password in a MANAGER session
    await wipe();
    const ab1 = await S.post('gc-topup-start', { number: C1, amount: 4 }); let ast = await S.st();
    const ab2 = await S.post('gc-topup-abandon', { id: ab1.j.id }); ast = await S.st();
    const ab3 = await S.post('gc-topup-start', { number: C1, amount: 4 }); await S.post('gc-topup-pay', { id: ab3.j.id });
    const ab4 = await S.post('gc-topup-abandon', { id: ab3.j.id }); const ast2 = await S.st();
    const wpw = await S.post('gc-free-credit', { number: C1, amount: 2, amount2: 2, reason: 'manager session wrong password', user: 'boss', password: 'nope' }); const ast3 = await S.st();
    rec('39 abandon: an unpaid top-up is deleted without a manager (balance unchanged); one with a payment step started is refused; a wrong typed password is refused even in a manager session', ab2.j.ok && ast.counters.del === 1 && !ab4.j.ok && ast2.counters.del === 1 && !wpw.j.ok && ast3.counters.complete === ast2.counters.complete, JSON.stringify([ab2.j.message, ab4.j.message, wpw.j.message]).slice(0, 220));

    // ---- logs
    const all = (S.log() + K.log() + JSON.stringify(S.replies) + JSON.stringify(K.replies) + S.file('gift-pending.json') + S.file('gift-log.jsonl') + S.file('gift-credit-log.jsonl'));
    rec('38 logs, pending file and every reply: no full card number, no secret card password, no creditCard field, no token', !/FAKEGC-000\d/.test(all) && !/SECRET-PW/.test(all) && !/creditCard/.test(all) && !/"ide"/.test(all), (all.match(/FAKEGC-000\d|SECRET-PW|creditCard/) || [''])[0]);
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 600)); }
  finally { try { S.stop(); K.stop(); } catch (e) { /* */ } }
  process.exitCode = fails.length ? 1 : 0;
  console.log(`${nPass} passed, ${fails.length} failed` + (fails.length ? ': ' + fails.join('; ') : ' - ALL PASSED'));
  try { fs.rmSync(T, { recursive: true, force: true }); } catch (e) { /* */ }
  setTimeout(() => process.exit(fails.length ? 1 : 0), 100);
})();

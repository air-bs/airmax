// AirMax 1.0.9-local.2 (Ari OK 10:56 AM ET Oct 30): no double charge / no double refund when AIR POS records a payment or a
// refund but its reply is lost or unclear. Fault injection over real HTTP against tests/dblpay/sim (a fake AIR POS, 127.0.0.1 only):
// 500, 502, non-JSON, dropped reply, an error on the follow-up check, crash/restart, session expiry, "Check AIR POS again".
// Cases: card, card on file / store credit (type 11), gift card, check, cash, quick return, exchange, receipt return,
// no-receipt return, refund to store credit. Harness: a copy of the AirMax Stress Tester's deep repros (oracles = what AIR POS holds).
// Ports: sim 5186, registers R5 5184 / R6 5185 only. Data in /tmp/airreg-dblpay. Run: node tests/dblpay-109.js
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const D = path.join(__dirname, 'dblpay'), WORK = process.env.DBL_WORK || '/tmp/airreg-dblpay';
fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
process.env.DBL_WORK = WORK; process.env.SIM_PORT = process.env.DBL_SIM_PORT || '5186'; // DBL_SIM_PORT / DBL_PORT_BASE: run beside another suite on other ports
const L = require('./dblpay/harness/lib');
const REG = 'R5';
// [script, env, what it covers]
const M = [
  ['repro-double', { MODES: 'done500,done502,donegarbage,lost' }, 'payment recorded, reply 500 / 502 / non-JSON / dropped; cashier presses it again (card, store credit, check)', true],
  ['repro-gift', { MODES: 'done500,done502,donegarbage,lost' }, 'gift card recorded, reply 500 / 502 / non-JSON / dropped; pressed again', true],
  ['repro-lostget', { T: '20', GM: 'http500' }, 'card: dropped reply + order check 500'],
  ['repro-lostget', { T: '50', GM: 'garbage' }, 'check: dropped reply + order check non-JSON'],
  ['repro-lostget', { T: '11', GM: 'http502' }, 'store credit: dropped reply + order check 502'],
  ['repro-lostget', { T: '10', GM: 'http500', KIND: 'expire2' }, 'session expires twice, order check 500 at re-login'],
  ['repro-recheck', { GM: 'garbage' }, 'Check AIR POS again gets non-JSON', true],
  ['repro-recheck', { GM: 'http500' }, 'Check AIR POS again gets 500', true],
  ['repro-recover-c', { GM: 'http500', PT: 'cash' }, 'crash after part cash, recovery check 500'],
  ['repro-recover-c', { GM: 'garbage', PT: 'card' }, 'crash after part card, recovery check non-JSON'],
  ['repro-return-get', { KIND: 'quick', CMODE: 'lost', GM: 'garbage' }, 'quick return: dropped reply, receipt check non-JSON'],
  ['repro-return-get', { KIND: 'quick', CMODE: 'done502', GM: 'http500', RGM: 'http500' }, 'quick return: 502 reply, both checks 500'],
  ['repro-return-get', { KIND: 'exchange', CMODE: 'lost', GM: 'garbage' }, 'exchange: dropped return reply, check non-JSON'],
  ['repro-return-get', { KIND: 'receipt', CMODE: 'done500', GM: 'garbage', RGM: 'garbage' }, 'receipt return: 500 reply, checks non-JSON'],
  ['repro-return-get', { KIND: 'noreceipt', CMODE: 'donegarbage', GM: 'http502' }, 'no-receipt return: non-JSON reply, check 502'],
  ['repro-return-acct', { KIND: 'receipt', CMODE: 'done500', GM: 'garbage' }, 'receipt refund to store credit: 500 reply'],
  ['repro-return-acct', { KIND: 'quick', CMODE: 'lost', GM: 'http500', RGM: 'garbage' }, 'quick refund to store credit: dropped reply, checks error'],
  ['repro-return-crash', { GM: 'garbage' }, 'crash while a quick return is sent, receipt check non-JSON at restart'],
  // part 2 (a): one cash / check payment per sale (real AIR POS keeps only the first of a type)
  ['repro-sametype', { T: '10', FM: 'none' }, '(a) cash then cash: second refused, nothing sent, rest by check'],
  ['repro-sametype', { T: '10', FM: 'done500' }, '(a) cash recorded with a 500 reply, adopted; second cash refused'],
  ['repro-sametype', { T: '50', FM: 'lost' }, '(a) check with a dropped reply, adopted; second check refused, rest by cash'],
  ['repro-cashz', { OP: 'in', FM: 'done500' }, '(b) pay-in recorded, reply 500: confirmed by id, not recorded twice'],
  ['repro-cashz', { OP: 'out', FM: 'donegarbage' }, '(b) pay-out recorded, non-JSON reply: confirmed by id'],
  ['repro-cashz', { OP: 'in', FM: 'lost', GM: 'http500' }, '(b) pay-in reply dropped and the check errors: unknown, next press checks first'],
  ['repro-cashz', { OP: 'in', FM: 'none', PRE: 'http500' }, '(b) drawer balance read fails before a pay-in: nothing sent'],
  ['repro-cashz', { OP: 'out', FM: 'crash' }, '(b) crash while a pay-out is sent (AIR POS recorded it): redo after restart not recorded twice'],
  ['repro-cashz', { OP: 'z', FM: 'lost' }, '(b) Z made, reply dropped: confirmed from the Z list'],
  ['repro-cashz', { OP: 'z', FM: 'done500', GM: 'http500' }, '(b) Z made, reply 500 and list check errors: next press checks, no second Z'],
  ['repro-cashz', { OP: 'z', FM: 'lost-slow' }, '(b) Z made, reply times out after 30 s: no second Z'],
  ['repro-cashz', { OP: 'z', FM: 'crash' }, '(b) crash while the Z is made: redo after restart makes no second Z'],
  ['repro-exchange', { T: '10', FM: 'none' }, '(c) exchange paid in cash: one cash payment carries the credit, customer pays $9.30, done screen right'],
  ['repro-exchange', { T: '10', FM: 'fail' }, '(c) exchange, cash payment refused once: credit kept, customer still pays $9.30'],
  ['repro-exchange', { T: '10', FM: 'done500' }, '(c) exchange, cash recorded with a 500 reply: adopted once, $9.30'],
  ['repro-exchange', { T: '50', FM: 'fail' }, '(c) exchange paid by check, credit payment fails: credit kept, check is $9.30 not $10.80'],
  ['repro-exchange', { T: '50', FM: 'lost' }, '(c) exchange paid by check, credit payment reply dropped: adopted, check $9.30'],
  ['repro-keyed', { CASE: 'accepted' }, '(d) keyed card: Stripe accepted, AIR POS slow: Cancel/Esc refused, sale finishes once'],
  ['repro-keyed', { CASE: 'accepted-err' }, '(d) keyed card: Stripe accepted and the AIR POS check errors: Cancel/Esc refused'],
  ['repro-keyed', { CASE: 'recorded' }, '(d) keyed form open but AIR POS already recorded it: Cancel adopts it instead of cancelling'],
  ['repro-keyed', { CASE: 'failed-recorded' }, '(d) Stripe reported an error but AIR POS recorded it: adopted, not cancelled'],
  ['repro-keyed', { CASE: 'open' }, '(d) keyed form open, nothing charged: Cancel card still works'],
  ['repro-keyed', { CASE: 'race' }, '(d) keyed card: Cancel pressed while the background check finishes the sale: one complete only (live TestShop find)'],
  ['repro-shopcredit', { CASE: 'shop' }, '(e) points kept per shop: customer find / profile show shopBalance, shopPoint, shop credit limit'],
  ['repro-shopcredit', { CASE: 'late' }, '(e) per-shop setting not in the login config: read from RetailConfigGet on demand'],
  ['repro-shopcredit', { CASE: 'corp' }, '(e) per-shop off: balance / point / credit limit as before'],
  // part 4 (1.0.9-local.7): the 4 remaining Stress Tester payment bugs
  ['repro-expire-term', {}, '(1) terminal card waiting, session expires: after login the same payment is checked, not taken again'],
  ['repro-expire-term', { RETAKE: '1' }, '(1) terminal card waiting, session expires, cashier tries the card again: one charge only'],
  ['repro-expire-term', { GETF: 'garbage', RETAKE: '1' }, '(1) terminal card waiting, session expires, recovery check non-JSON, cashier retries the card: one charge only'],
  ['repro-expire-term', { GETF: 'expire' }, '(1) terminal card waiting, session expires, and again on the recovery check: after the next login the payment is checked'],
  ['repro-expire-term', { GETF: 'expire', RETAKE: '1' }, '(1) same, cashier tries the card again: one charge only, first terminal payment not left open'],
  ['repro-rering', { TRIG: 'crash', GM: 'garbage', PT: 'cash' }, '(1) $2 cash, crash, recovery check non-JSON, cashier rings the sale again: refused until checked, customer pays once'],
  ['repro-rering', { TRIG: 'crash', GM: 'http500', PT: 'card' }, '(1) $2 card, crash, recovery check 500, rung again: customer pays once'],
  ['repro-rering', { TRIG: 'expire', GM: 'garbage', PT: 'card' }, '(1) $2 card, session expires, recovery check non-JSON at re-login, rung again: customer pays once'],
  ['repro-rering', { TRIG: 'expire', GM: 'http500', PT: 'cash' }, '(1) $2 cash, session expires, recovery check 500 at re-login, rung again: customer pays once'],
  ['repro-kill-term', { OUT: 'approve', AT: 'waiting' }, '(1) control: app killed while the terminal card waits, customer taps: one charge'],
  ['repro-kill-term', { OUT: 'never', AT: 'waiting' }, '(1) control: app killed while the terminal card waits, never tapped: Cancel card, paid by cash'],
  // pb109e: real AIR POS refuses RetailOrderGet for a Pending order with payments (HTTP 500 errorCode 1000, TestShop Oct 31 2026); sim /pending-get=nullref
  ['repro-rering', { TRIG: 'crash', GM: 'none', PT: 'cash', PENDGET: 'nullref' }, '(1) real AIR POS order check: $2 cash, crash, AIR POS refuses to show the unfinished order: sale A comes back, customer pays once'],
  ['repro-rering', { TRIG: 'expire', GM: 'none', PT: 'card', PENDGET: 'nullref' }, '(1) real AIR POS order check: $2 card, session expires, AIR POS refuses to show the unfinished order: sale A comes back, customer pays once'],
  ['repro-lostget', { T: '50', GM: 'none', PENDGET: 'nullref' }, 'real AIR POS order check: check, dropped reply, AIR POS refuses to show the unfinished order: payment found, not taken twice'],
  ['repro-lostget', { T: '20', GM: 'none', PENDGET: 'nullref', KIND: 'expire' }, 'real AIR POS order check: card, session expires at Complete, AIR POS refuses to show the unfinished order: not taken twice'],
  ['repro-lostget-term', { GM: 'http500' }, '(1) terminal card: dropped reply + order check 500, then a crash: one charge only'],
  ['repro-kill-term', { OUT: 'approve' }, '(3) app killed while the terminal card starts, customer taps after restart: payment resumed, one charge'],
  ['repro-kill-term', { OUT: 'never' }, '(3) app killed while the terminal card starts, never tapped: open payment found, Cancel card works, paid by cash'],
  ['repro-recover-b', { TRIG: 'crash' }, '(2) crash, recovery check fails, next sale rung: never replaced'],
  ['repro-recover-b', { TRIG: 'crash', PAY: '1' }, '(2) crash, recovery check fails, next sale paid $1 cash: no orphaned payment'],
  ['repro-recover-b', { TRIG: 'crash', PAY: '1', PAYTYPE: 'card' }, '(2) same, next sale paid $1 by card: no orphaned card charge'],
  ['repro-recover-b', { TRIG: 'expire', PAY: '1' }, '(2) session expiry, recovery check fails, next sale paid: no orphaned payment'],
  ['repro-savecard', { FM: 'done500' }, '(4) save card: AIR POS saved it, reply 500: says saved, no duplicate'],
  ['repro-savecard', { FM: 'lost' }, '(4) save card: AIR POS saved it, reply dropped: says saved, no duplicate'],
  ['repro-savecard', { FM: 'donegarbage' }, '(4) save card: AIR POS saved it, reply non-JSON: says saved, no duplicate'],
  ['repro-savecard', { FM: 'done500', SM: 'http500' }, '(4) save card: reply 500 and the card list read fails: unknown, retry checks first, no duplicate'],
  ['repro-savecard', { FM: 'down' }, '(4) control: request never reached AIR POS: "not saved", retry saves one card'],
  ['repro-savecard', { FM: 'fail' }, '(4) control: AIR POS refused: "not saved", retry saves one card'],
].filter(x => !process.env.ONLY || (x[0] + ' ' + x[2]).includes(process.env.ONLY));
const RES = path.join(WORK, 'reports', 'results.jsonl');
const lines = () => { try { return fs.readFileSync(RES, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
(async () => {
  const simPid = await L.startSim('sim'); let pass = 0, fail = 0; const out = [];
  try {
    for (const [s, env, what, prestart] of M) {
      const n0 = lines().length; let rp = null;
      if (prestart) rp = await L.startReg(REG, { wipe: true });
      const r = cp.spawnSync(process.execPath, [path.join(D, 'harness', s + '.js')], { env: { ...process.env, REG, ROUNDS: '1', ...env }, encoding: 'utf8', timeout: 400000 });
      if (rp) L.kill(rp); await L.sleep(500);
      try { const pid = Number(cp.execSync(`ss -ltnp | grep ':${Number(process.env.DBL_PORT_BASE || 5179) + 5} ' | grep -o 'pid=[0-9]*' | cut -d= -f2 | head -1`).toString().trim()); if (pid) L.kill(pid); } catch {}
      const rec = lines().slice(n0).map(l => JSON.parse(l));
      const bad = rec.filter(x => x.result !== 'PASS'); const ok = rec.length > 0 && !bad.length && r.status === 0;
      ok ? pass++ : fail++;
      const k = `${s} ${JSON.stringify(env)}: ${what} (${rec.length - bad.length}/${rec.length} checks)`;
      out.push({ k, pass: ok, note: ok ? undefined : (bad.map(x => x.result + ' ' + String(x.why).slice(0, 400)).join(' || ') || (r.stderr || r.stdout || '').slice(-400)) });
      console.log((ok ? 'ok   ' : 'FAIL ') + k + (ok ? '' : '\n     ' + out[out.length - 1].note));
    }
  } finally { L.kill(simPid); }
  fs.writeFileSync(path.join(__dirname, 'dblpay-109-results.json'), JSON.stringify({ when: new Date().toISOString(), pass, fail, out }, null, 1));
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

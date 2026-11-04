// 1.0.10-local.2 (Ari OK 2:03 PM ET Nov 1, "Yes, OK to fix the split card screen in the next test build, local only"):
// a card approved for PART of a split sale left pay.card at 'approved', so the payment window kept showing the card box with only
// "Cancel card" (which refuses: already approved) and never went on to the rest. After the fix the approved card is a paid line,
// the card box closes and the next payment (e.g. typed cash) goes on. Amounts, totals and AIR POS calls are unchanged.
// Offline: Register with a mocked AIR POS (no network, no terminal, made-up data only).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const TESTCARD = { cardNo: '4111111111111111', expiration: '12/30', cvv: '123' }; // public test card number, made up
const wait = ms => new Promise(r => setTimeout(r, ms));
function mk({ dir, sola = false, total = 10 } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-split-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'airpos', receiptAutoPrint: 'never', drawerAutoOpen: 'never' });
  const calls = []; const server = { receives: [] }; const approve = new Set();
  const api = reg.api; api.ide = 'x'; reg.identity = { userName: 'u', corpName: 'MadeUpCo', shopName: 'S', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  if (sola) reg.keyedInfo = () => ({ kind: 'sola', enabled: true });
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => { calls.push('save'); return { success: true }; };
  api.receiveBegin = async s => { calls.push('begin:' + s.paymentType + ':' + s.amount); const card = s.paymentType === 20 || s.paymentType === 30; server.receives.push({ id: s.id, paymentType: s.paymentType, amount: s.amount, receiveAmount: s.receiveAmount || s.amount, status: card ? 10 : 20 }); return { success: true, value: { isCompleted: !card } }; };
  api.receiveCheck = async s => { calls.push('check'); const ok = approve.has(s.id); if (ok) { const r = server.receives.find(x => x.id === s.id); if (r) r.status = 20; } return { success: true, value: { isCompleted: ok, message: ok ? '' : 'Waiting for card' } }; };
  api.receiveCancel = async () => { calls.push('cancel'); return { success: true }; };
  api.complete = async () => { calls.push('complete'); return { success: true }; };
  api.orderGet = async id => ({ success: true, value: { id, status: 1, receives: server.receives } });
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: total, discount: 0, discountAmount: 0, timestamp: 1 }];
  const approveOpen = () => { const c = reg.pay && reg.pay.card; if (c) approve.add(c.submit.id); };
  return { reg, calls, server, approveOpen, dir };
}
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await wait(20); } return false; };
const n = (calls, re) => calls.filter(c => re.test(c)).length;
(async () => {
  // ---- S1 terminal split: card $6 approved, $4 left ----
  let t = mk(); await t.reg.recalc(); await t.reg.startPay();
  let r = await t.reg.tender({ type: 20, amount: 6 });
  rec('S0 card $6 of $10 sent to the terminal (waiting)', r.ok && r.waiting && t.reg.pay.card && t.reg.pay.card.status === 'waiting', r.message);
  t.approveOpen(); await until(() => t.reg.pay && t.reg.pay.result);
  const st = t.reg.state().pay;
  rec('S1 card approved for part of the sale: the card box closes (pay.card is empty), so the window goes on to the rest', st && st.card == null, JSON.stringify(st && st.card));
  rec('S2 the approved card stays a PAID line ($6, done) and $4 is left; nothing else changed', st && st.tenders.length === 1 && st.tenders[0].status === 'done' && st.tenders[0].amount === 6 && t.reg.remaining() === 4 && t.reg.pay.result.remaining === 4, JSON.stringify(st && st.tenders) + ' left ' + t.reg.remaining());
  const j = t.reg.journal.read();
  rec('S3 the journal (crash file) has the approved card as paid and no open card', j && j.pay && j.pay.card == null && j.pay.tenders[0].status === 'done', JSON.stringify(j && j.pay));
  const cc = await t.reg.cardCancel();
  rec('S4 Cancel card can never void the approved card (refused, no cancel sent to AIR POS)', !cc.ok && n(t.calls, /^cancel$/) === 0 && t.reg.pay.tenders[0].status === 'done', cc.message);
  const checks = n(t.calls, /^check$/); await wait(1200);
  rec('S5 the terminal is not asked about that card again after approval', n(t.calls, /^check$/) === checks, `${checks} checks`);
  r = await t.reg.tender({ type: 10, amount: 4, tendered: 4 });
  rec('S6 typed cash $4 then finishes the sale (Complete once)', r.ok && r.completed && r.due === 10 && n(t.calls, /^complete$/) === 1, r.message);
  rec('S7 the card was sent once only (ReceiveBegin for the card exactly once)', n(t.calls, /^begin:20:/) === 1 && n(t.calls, /^begin:10:/) === 1, t.calls.join(','));
  // ---- S8 full-amount card: finishes as before ----
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 20, amount: 10 }); t.approveOpen();
  await until(() => t.reg.completed); r = t.reg.completed && t.reg.completed.result;
  rec('S8 a full-amount card still finishes the sale by itself (Complete once, card sent once)', r && r.completed && r.due === 10 && n(t.calls, /^complete$/) === 1 && n(t.calls, /^begin:20:/) === 1, t.calls.join(','));
  // ---- S9 two cards: second card goes to the terminal after the first one is approved ----
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 20, amount: 3 }); t.approveOpen(); await until(() => t.reg.pay && t.reg.pay.result);
  r = await t.reg.tender({ type: 20, amount: 7 });
  rec('S9 card $3 approved, then card $7: the second card is sent (not refused as "card open")', r.ok && r.waiting && t.reg.pay.card && t.reg.pay.card.submit.amount === 7, r.message);
  t.approveOpen(); await until(() => t.reg.completed);
  rec('S10 both cards approved: sale complete, each card sent exactly once', t.reg.completed && t.reg.completed.result.completed && n(t.calls, /^begin:20:3$/) === 1 && n(t.calls, /^begin:20:7$/) === 1 && n(t.calls, /^complete$/) === 1, t.calls.join(','));
  // ---- S11 Sola keyed card (polled like the terminal) ----
  t = mk({ sola: true }); await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 30, amount: 6, card: { ...TESTCARD } });
  const isSola = t.reg.pay.card && t.reg.pay.card.kind === 'keyed' && t.reg.pay.card.status === 'waiting';
  await until(() => t.calls.filter(x => x === 'check').length >= 1); const pend11 = !!(t.reg.pay.card && t.reg.pay.card.status === 'waiting');
  t.approveOpen(); await until(() => t.reg.pay && t.reg.pay.result);
  rec('S11 Sola keyed pending then completed: first check says pending (card box stays), next check completes it for part of the sale: card box closes, paid line kept, $4 left', isSola && pend11 && t.reg.pay.card == null && t.reg.pay.tenders[0].status === 'done' && t.reg.remaining() === 4, JSON.stringify({ isSola, card: t.reg.pay.card && t.reg.pay.card.status, left: t.reg.remaining() }));
  // ---- S12 keyed card confirmed through keyedVerify (Cancel pressed, AIR POS says it WAS paid; extras.js) ----
  t = mk({ sola: true }); await t.reg.recalc(); await t.reg.startPay(); const r12 = await t.reg.tender({ type: 30, amount: 6, card: { ...TESTCARD } }); if (!t.reg.pay.card) console.log('S12 setup', JSON.stringify(r12));
  t.reg.stopCardPoll(); t.reg.pay.card.accepted = true; t.approveOpen();
  r = await t.reg.cardCancel();
  rec('S12 Cancel on a keyed card AIR POS already recorded (part of the sale): not cancelled, card box closes, $4 left', r.ok && r.alreadyPaid && t.reg.pay.card == null && t.reg.pay.tenders[0].status === 'done' && t.reg.remaining() === 4 && n(t.calls, /^cancel$/) === 0, r.message + ' ' + JSON.stringify(t.reg.pay.card && t.reg.pay.card.status));
  // ---- S13 crash mid split: Air Max reopens ----
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 20, amount: 6 }); t.approveOpen(); await until(() => t.reg.pay && t.reg.pay.result);
  const t2 = mk({ dir: t.dir }); t2.server.receives = t.server.receives; t2.reg.api.orderGet = t.reg.api.orderGet; t2.reg.subs = []; t2.reg.recoveryPending = true;
  const rv = await t2.reg.recover();
  rec('S13 closed mid split and reopened: the approved card comes back as paid, no open card, $4 left (not taken again)', rv && rv.ok && t2.reg.pay && t2.reg.pay.card == null && t2.reg.pay.tenders.length === 1 && t2.reg.pay.tenders[0].status === 'done' && t2.reg.remaining() === 4 && n(t2.calls, /^begin/) === 0, (rv && rv.notice) + ' ' + JSON.stringify(t2.reg.pay && t2.reg.pay.tenders));
  // ---- S14 Stripe keyed card (secure form -> keyedConfirmed -> poll) approved for part of the sale ----
  t = mk(); t.reg.keyedInfo = () => ({ kind: 'stripe', enabled: true }); t.reg.keyedCh = { key: 'pk_madeup' };
  const rb0 = t.reg.api.receiveBegin; t.reg.api.receiveBegin = async s => { const x = await rb0(s); if (s.paymentType === 30) x.value.paymentIntent = { client_secret: 'pi_madeup_secret_x' }; return x; };
  await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 30, amount: 6 });
  const form14 = !!(t.reg.pay.card && t.reg.pay.card.status === 'keyed');
  const kc = await t.reg.keyedConfirmed(); await until(() => t.calls.filter(x => x === 'check').length >= 1);
  const pend14 = !!(t.reg.pay.card && t.reg.pay.card.status === 'waiting');
  t.approveOpen(); await until(() => t.reg.pay && t.reg.pay.result);
  rec('S14 Stripe keyed card (form, then AIR POS confirms) for part of the sale: card box closes, paid line kept, $4 left, card sent once', form14 && kc.ok && pend14 && t.reg.pay.card == null && t.reg.pay.tenders[0].status === 'done' && t.reg.remaining() === 4 && t.calls.filter(x => x.startsWith('begin:30')).length === 1, JSON.stringify({ r, form14, kc: kc.ok, pend14, card: t.reg.pay.card && t.reg.pay.card.status, left: t.reg.remaining() }));
  r = await t.reg.tender({ type: 10, amount: 4 });
  rec('S15 Stripe keyed split: cash for the rest finishes the sale', r.ok && r.completed, JSON.stringify(r).slice(0, 160));
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} split card tests passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

// AirMax 1.0.9-local.9 (Ari OK 9:24 PM ET Oct 31): Stress Tester local.7 M3, seed 6601013 (verified 3/3 on R23).
// A keyed (Stripe) card is accepted by Stripe, but AIR POS never records the payment. Before: after 2 minutes the screen said
// "Check the terminal screen ... press Cancel card" (there is no terminal for a keyed card) and Cancel card stayed refused for
// ever: no way out, the next sale could not start clean. Now: a keyed-card message, and after 2 minutes, once AIR POS clearly
// answers it has NO record, Cancel card offers a confirmed release (cashier checked Stripe). Never a blind cancel: AIR POS
// recorded it -> taken as paid; AIR POS unclear -> refused; release refused by AIR POS -> payment stays open.
// Offline, made-up data, nothing sent anywhere. Run: node tests/stress7-keyed-109.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mk(o = {}) {
  const reg = new Register({ log: m => logs.push(String(m)), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-s7k-')) }); const logs = [];
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  const api = reg.api, calls = []; api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  const S = { recorded: false, check: 'ok', cancel: 'ok' };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async s => { calls.push('begin'); if (s.paymentType === 10) return { success: true, value: { id: 'rcv-cash', isCompleted: true } }; return { success: true, value: { id: 'rcv1', isCompleted: false, paymentIntent: { client_secret: 'pi_madeup_secret_x' } } }; };
  api.receiveCheck = async () => { calls.push('check'); if (S.check === 'down') return { success: false, message: 'Network error', unreachable: true }; return { success: true, value: { isCompleted: S.recorded } }; };
  api.receiveCancel = async () => { calls.push('cancel'); return S.cancel === 'ok' ? { success: true } : { success: false, message: 'Payment is processing' }; };
  api.complete = async () => { calls.push('complete'); return { success: true, value: { id: 'o1', number: 'RO1' } }; };
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' });
  reg.keyedCh = { channelType: 10, key: 'pk_test_madeup' };
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, S, calls, logs };
}
async function accepted(o) { const t = mk(o); await t.reg.recalc(); await t.reg.startPay(); const r = await t.reg.tender({ type: 30, amount: 10 });
  const k = await t.reg.keyedConfirmed(); return { ...t, r, k }; }
const age = (t, ms) => { t.reg.pay.card.startedAt = Date.now() - ms; };
(async () => {
  try {
    // 1. the 2-minute message is about a keyed card, not a terminal
    let t = await accepted(); age(t, 125000); await sleep(2300);
    const sub = (t.reg.pay.card || {}).subMessage || '';
    rec('k) keyed card not recorded after 2 min: message does not send the cashier to a terminal; says Stripe accepted it and how to release',
      t.r.ok && t.k.ok && !/terminal/i.test(sub) && /Stripe/.test(sub) && /Cancel card/.test(sub), sub);
    t.reg.stopCardPoll();
    // 2. Cancel card after 2 min, AIR POS clearly has no record: refused, but the release is offered
    let c = await t.reg.cardCancel({});
    rec('k) Cancel card (no confirm): still refused, card kept, release offered (canRelease)', !c.ok && c.keyedAccepted && c.canRelease === true && t.reg.pay.card && !t.calls.includes('cancel'), JSON.stringify(c));
    t.reg.stopCardPoll();
    // 3. confirmed release: AIR POS told to cancel, payment off the sale, sale can be paid another way / cleared
    c = await t.reg.cardCancel({ release: true });
    rec('k) confirmed release: AIR POS cancel sent once, card off the sale, says to refund in Stripe if charged', c.ok && c.released && !t.reg.pay.card && t.reg.pay.tenders.length === 0 && t.calls.filter(x => x === 'cancel').length === 1 && /Stripe/.test(c.message), JSON.stringify(c));
    rec('k) release is logged', t.logs.some(l => /KEYED RELEASE/.test(l)), t.logs.filter(l => /KEYED/.test(l)).join(' | '));
    const cash = await t.reg.tender({ type: 10, tendered: 10 });
    rec('k) after the release the sale is paid in cash and completes (next sale clean)', cash.ok && cash.completed, JSON.stringify({ ok: cash.ok, completed: cash.completed, m: cash.message }));
    // 4. release before 2 minutes: refused (AIR POS may still record it)
    t = await accepted(); age(t, 30000); t.reg.stopCardPoll();
    c = await t.reg.cardCancel({ release: true });
    rec('k) release before 2 minutes: refused, nothing cancelled', !c.ok && t.reg.pay.card && !t.calls.includes('cancel') && !c.canRelease, JSON.stringify(c));
    t.reg.stopCardPoll();
    // 5. release but AIR POS DID record it: taken as paid, never cancelled
    t = await accepted(); age(t, 125000); t.reg.stopCardPoll(); t.S.recorded = true;
    c = await t.reg.cardCancel({ release: true });
    rec('k) release when AIR POS recorded the card: taken as paid (sale completes), no cancel', c.ok && c.alreadyPaid && !t.calls.includes('cancel'), JSON.stringify({ ok: c.ok, alreadyPaid: c.alreadyPaid, completed: c.completed }));
    // 6. release while AIR POS cannot be reached: refused
    t = await accepted(); age(t, 125000); t.reg.stopCardPoll(); t.S.check = 'down';
    c = await t.reg.cardCancel({ release: true });
    rec('k) release while AIR POS unreachable: refused, card kept', !c.ok && t.reg.pay.card && !t.calls.includes('cancel'), JSON.stringify(c));
    t.reg.stopCardPoll();
    // 7. AIR POS refuses the release: payment stays open
    t = await accepted(); age(t, 125000); t.reg.stopCardPoll(); t.S.cancel = 'refuse';
    c = await t.reg.cardCancel({ release: true });
    rec('k) AIR POS refuses the release: card stays on the sale, Air Max keeps checking', !c.ok && t.reg.pay.card && t.reg.pay.tenders.length === 1 && /stays open/.test(c.message), JSON.stringify(c));
    t.reg.stopCardPoll();
    // 8. a terminal card still gets the terminal wording
    t = mk(); await t.reg.recalc(); await t.reg.startPay(); t.reg.api.receiveBegin = async () => ({ success: true, value: { id: 'r2', isCompleted: false } });
    await t.reg.tender({ type: 20, amount: 10 }); if (t.reg.pay.card) { age(t, 125000); await sleep(2300); }
    rec('k) terminal card: 2-minute message still about the terminal', /terminal/i.test(((t.reg.pay.card || {}).subMessage) || ''), ((t.reg.pay.card || {}).subMessage) || 'no card');
    t.reg.stopCardPoll();
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'stress7-keyed-109-results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})();

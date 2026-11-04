// #1/#7 (Gordon OK Nov 3, branch claude/work): the receipt prints right after the card machine approves. AirMax learns of the
// approval at its next AIR POS Receive Check; checks now run every 0.5 s for the first 60 s of a card wait (was 10 s, then 1 s)
// and the gap is counted from the START of the previous check (was from its answer: 0.5 s + round trip). Read-only checks only:
// a payment is never sent again. Offline: Register with a mocked AIR POS (200 ms per check), made-up data, no card, no printer.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function mk() {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-poll-')) }); reg.settingsPath = null;
  const api = reg.api; api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  Object.assign(reg.settings, { receiptAutoPrint: 'never', drawerAutoOpen: 'off' });
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  const st = { begins: 0, checks: [], approveAt: Infinity, completes: 0 };
  api.receiveBegin = async () => { st.begins++; return { success: true, value: { isCompleted: false } }; }; // the terminal is waiting for the customer
  api.receiveCheck = async () => { st.checks.push(Date.now()); await sleep(200); return { success: true, value: { isCompleted: st.checks.length >= st.approveAt } }; };
  api.complete = async () => { st.completes++; return { success: true }; };
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, st };
}
const gaps = a => a.slice(1).map((t, i) => t - a[i]);
(async () => {
  let { reg, st } = mk(); await reg.recalc(); await reg.startPay();
  let r = await reg.tender({ type: 20, amount: 10 });
  await sleep(2700); let g = gaps(st.checks);
  rec('C1 card waiting: AIR POS checked every ~0.5 s from the start of each check (was 0.7 s with a 0.2 s round trip)', r.waiting && g.length >= 4 && g.every(x => x >= 450 && x <= 620), JSON.stringify(g));
  reg.pay.card.startedAt = Date.now() - 30000; st.checks.length = 0; await sleep(2200); g = gaps(st.checks);
  rec('C2 30 s into the wait: still every ~0.5 s (was 1 s after 10 s)', g.length >= 3 && g.every(x => x >= 450 && x <= 620), JSON.stringify(g));
  reg.pay.card.startedAt = Date.now() - 70000; st.checks.length = 0; await sleep(3300); g = gaps(st.checks);
  rec('C3 past 60 s: every ~1 s (load on AIR POS stays bounded)', g.length >= 2 && g.every(x => x >= 950 && x <= 1150), JSON.stringify(g));
  st.approveAt = st.checks.length + 1; const tA = Date.now(); while (!reg.completed && Date.now() - tA < 4000) await sleep(20);
  rec('C4 approval seen at the next check: sale completed once, payment sent once, no extra check after', !!reg.completed && st.completes === 1 && st.begins === 1, `completed after ${Date.now() - tA} ms, completes ${st.completes}, payments ${st.begins}`);
  const n = st.checks.length; await sleep(1500);
  rec('C5 checking stops once approved', st.checks.length === n, `${st.checks.length - n} checks after approval`);
  reg.stopCardPoll();
  const pass = out.filter(x => x.pass).length; console.log(`card-poll-1011: ${pass}/${out.length} passed`);
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

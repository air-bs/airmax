// Owner request J: "Return to Account" = AIR POS's own Member Account refund (OrderReturnDrawer RefundMethod.MemberAccount /
// NonOrderReturnDrawer paymentType 11). OFFLINE only: fake AIR POS calls, temp folders, made-up customers, no money.
// Run: node tests/return-account.test.js
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (k, fn) => { n++; try { await fn(); out.push({ k, pass: true }); console.log('ok   ' + k); } catch (e) { bad++; out.push({ k, pass: false, note: e.message }); console.log('FAIL ' + k + '\n     ' + e.message); } };
function mk({ manager = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-retacct-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: 'fake shop', shopName: 'Fake', currency: 2, superAdmin: manager };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  if (!manager) reg.isManager = () => false;
  const sent = { create: [], nonOrder: [] }, a = reg.api;
  a.returnCreate = async s => { sent.create.push(s); return { success: true, value: {} }; };
  a.nonOrderReturnCreate = async s => { sent.nonOrder.push(s); return { success: true }; };
  a.returnGet = async id => ({ id, status: 10, payments: [] }); a.fetchPdf = async () => ({ success: true });
  reg.drawer = async () => ({ ok: true, message: 'drawer' }); reg.printReturn = async () => ({ ok: true });
  return { reg, sent };
}
const sub = { id: 's1', productId: 'p1', itemId: 'i1', quantity: 1, rate: 1, discount: 0, price: 20, taxRate: 0 };
function receipt(reg, memberId = 'm-acct') {
  reg.mode = 'return';
  reg.ret = { id: 'ret-1', kind: 'receipt', order: { id: 'o1', number: 'T100', amount: 30, tax: 0, retailMemberId: memberId, receives: [{ id: 'rc-card', paymentType: 20, amount: 10 }, { id: 'rc-cash', paymentType: 10, amount: 20 }], returnPayments: [] }, subs: [{ ...sub, price: 30 }] };
}
function noReceipt(reg, member) { reg.mode = 'return'; reg.member = member || null; reg.ret = { id: 'ret-2', kind: 'nonorder', order: null, subs: [{ ...sub }] }; }

(async () => {
  await t('setting returnToAccount is ON by default', async () => { const { reg } = mk(); assert.strictEqual(reg.settings.returnToAccount, true); });
  await t('only a manager can turn it off', async () => {
    const c = mk({ manager: false }); const r = c.reg.saveSettings ? c.reg.saveSettings({ returnToAccount: false }) : c.reg.settingsSave({ returnToAccount: false });
    assert.ok(!r.ok && /manager/i.test(r.message), JSON.stringify(r)); assert.strictEqual(c.reg.settings.returnToAccount, true);
    const m = mk(); const r2 = m.reg.saveSettings ? m.reg.saveSettings({ returnToAccount: false }) : m.reg.settingsSave({ returnToAccount: false });
    assert.ok(r2.ok, JSON.stringify(r2)); assert.strictEqual(m.reg.settings.returnToAccount, false);
  });
  await t('receipt return: default = back the way they paid (unchanged): card 10 + cash 20', async () => {
    const { reg } = mk(); receipt(reg); const tt = reg.returnTotals();
    assert.strictEqual(tt.refund, 30); assert.deepStrictEqual(tt.payments.map(p => [p.paymentType, p.amount]), [[10, 20], [20, 10]]);
  });
  await t('receipt return to account: same refund, same split per receive, all type 11 with the SALE\'s customer', async () => {
    const { reg, sent } = mk(); receipt(reg); const before = reg.returnTotals();
    assert.ok(reg.setReturnToAccount(true).ok); const tt = reg.returnTotals();
    assert.strictEqual(tt.refund, before.refund); assert.strictEqual(tt.amount, before.amount); assert.strictEqual(tt.tax, before.tax);
    assert.deepStrictEqual(tt.payments.map(p => [p.paymentType, p.amount, p.receiveId, p.retailMemberId]), [[11, 20, 'rc-cash', 'm-acct'], [11, 10, 'rc-card', 'm-acct']]);
    const r = await reg.confirmReturn(); assert.ok(r.ok, r.message);
    const s = sent.create[0]; assert.strictEqual(s.paymentType, 99); assert.strictEqual(s.retailMemberId, 'm-acct');
    assert.deepStrictEqual(s.payments.map(p => [p.paymentType, p.amount, p.retailOrderReceiveId, p.retailMemberId]), [[11, 20, 'rc-cash', 'm-acct'], [11, 10, 'rc-card', 'm-acct']]);
    assert.ok(!r.card, 'no card refund check for an account refund');
  });
  await t('receipt return without a customer on the sale: Account refused, nothing changes', async () => {
    const { reg, sent } = mk(); receipt(reg, null); const r = reg.setReturnToAccount(true);
    assert.ok(!r.ok && /no customer/.test(r.message), r.message); assert.ok(!reg.ret.toAccount); assert.strictEqual(sent.create.length, 0);
    assert.ok(reg.returnTotals().payments.every(p => p.paymentType !== 11));
  });
  await t('no receipt, no customer: Account refused ("Add a customer…"), refund stays Cash', async () => {
    const { reg } = mk(); noReceipt(reg); const r = reg.setReturnToAccount(true);
    assert.ok(!r.ok && /Add a customer/.test(r.message)); assert.deepStrictEqual(reg.returnTotals().payments.map(p => p.paymentType), [10]);
  });
  await t('no receipt + customer: one type-11 line, same refund, customer id sent to AIR POS', async () => {
    const { reg, sent } = mk(); noReceipt(reg, { id: 'm-acct', name: 'House Account', availableBalance: 0 }); const before = reg.returnTotals();
    assert.ok(reg.setReturnToAccount(true).ok); const tt = reg.returnTotals();
    assert.strictEqual(tt.refund, before.refund); assert.deepStrictEqual(tt.payments.map(p => [p.paymentType, p.amount]), [[11, before.refund]]);
    const r = await reg.confirmReturn(); assert.ok(r.ok, r.message);
    const s = sent.nonOrder[0]; assert.strictEqual(s.retailMemberId, 'm-acct'); assert.deepStrictEqual(s.payments.map(p => [p.paymentType, p.amount]), [[11, before.refund]]);
  });
  await t('no receipt cash refund still sends retailMemberId null (unchanged)', async () => {
    const { reg, sent } = mk(); noReceipt(reg, { id: 'm-acct', name: 'House Account' }); const r = await reg.confirmReturn(); assert.ok(r.ok);
    assert.strictEqual(sent.nonOrder[0].retailMemberId, null); assert.deepStrictEqual(sent.nonOrder[0].payments.map(p => p.paymentType), [10]);
  });
  await t('setting off: Account refused even with a customer', async () => {
    const { reg } = mk(); reg.settings.returnToAccount = false; noReceipt(reg, { id: 'm-acct', name: 'House Account' });
    const r = reg.setReturnToAccount(true); assert.ok(!r.ok && /turned off/.test(r.message));
  });
  await t('switching back off restores the original split', async () => {
    const { reg } = mk(); receipt(reg); reg.setReturnToAccount(true); reg.setReturnToAccount(false);
    assert.deepStrictEqual(reg.returnTotals().payments.map(p => p.paymentType), [10, 20]);
  });
  await t('state() exposes account availability for the panel', async () => {
    const { reg } = mk(); receipt(reg); const s = reg.state().ret; assert.ok(s.account.allowed); assert.strictEqual(s.toAccount, false);
  });
  console.log(`${n - bad}/${n} return-to-account unit tests passed`);
  fs.writeFileSync(path.join(__dirname, 'return-account-results.json'), JSON.stringify({ when: new Date().toISOString(), passed: n - bad, total: n, results: out }, null, 2));
  process.exit(bad ? 1 : 0);
})();

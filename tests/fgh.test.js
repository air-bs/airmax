// Owner requests F/G/H (work copy, not released), offline with a mocked AIR POS api (no network, no card, no printer).
// F: Check only with a customer on the sale.  G: gift card pays the amount typed (existing tender path, unchanged math).
// H: scan sounds setting (on by default, manager only) and the built-in tone files.
'use strict';
const fs = require('fs'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
function mk(price = 10) {
  const reg = new Register({ log: () => {} }); const api = reg.api, calls = [];
  api.ide = 'x'; reg.identity = { userName: 'u', currency: 2 }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} } }; reg.mode = 'sale';
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async s => { calls.push('save'); return { success: true }; };
  api.receiveBegin = async s => { calls.push('begin:' + s.paymentType + ':' + s.amount + (s.retailGiftCards.length ? ':' + s.retailGiftCards.join('+') : '')); return { success: true, value: { isCompleted: true } }; };
  api.complete = async () => { calls.push('complete'); return { success: true }; };
  reg.drawer = async () => ({ ok: true, message: 'drawer' });
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', name: 'Item 0', quantity: 1, rate: 1, price, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, calls };
}
(async () => {
  // ---- F ----
  let t = mk(); await t.reg.recalc(); await t.reg.startPay();
  const c1 = await t.reg.tender({ type: 50, amount: 10, checkNumber: '123' });
  rec('F: Check with no customer: refused with the owner message, nothing saved or sent', !c1.ok && c1.message === 'Add a customer to pay by check' && t.calls.length === 0 && t.reg.paidTotal() === 0, `${c1.message}; calls [${t.calls}]`);
  t.reg.member = { id: 'm1', number: '5550001', name: 'Test', availableBalance: 0, creditAmount: 0 };
  const c2 = await t.reg.tender({ type: 50, amount: 10, checkNumber: '123' });
  rec('F: same Check with a customer attached: paid as before', c2.ok && t.calls.includes('begin:50:10'), t.calls.join(' '));
  // ---- G ----
  t = mk(); await t.reg.recalc(); await t.reg.startPay(); const card = [{ id: 'gc8', balance: 8 }];
  const g1 = await t.reg.tender({ type: 40, amount: 3, giftCards: card });
  rec('G: typed $3 on an $8 card for a $10 sale: exactly $3 taken, $7 still owed', g1.ok && t.calls.includes('begin:40:3:gc8') && t.reg.remaining() === 7, `${t.calls.join(' ')}; remaining ${t.reg.remaining()}`);
  const g2 = await t.reg.tender({ type: 40, amount: 7, giftCards: [{ id: 'gc8', balance: 5 }] });
  rec('G: more than the card balance: refused by the existing check, nothing sent', !g2.ok && t.calls.filter(c => c.startsWith('begin')).length === 1, g2.message);
  const g3 = await t.reg.tender({ type: 40, amount: 7.5, giftCards: [{ id: 'gc9', balance: 20 }] });
  rec('G: more than still owed: refused by the existing check, nothing sent', !g3.ok && t.calls.filter(c => c.startsWith('begin')).length === 1, g3.message);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
  rec('G: UI caps the typed gift amount at the lower of card balance and amount owed', /function giftCap\(\) \{ return Math\.max\(0, Math\.min\(giftBal\(\), /.test(ui) && /t === 40 && gift\.length && Number\(inp\.value\) > giftCap\(\)/.test(ui), 'giftCap() used on typing and before paying');
  // ---- I: Put on Account = AIR POS MemberAccount tender (11) ----
  t = mk(); await t.reg.recalc(); await t.reg.startPay();
  const a0 = await t.reg.tender({ type: 11, amount: 10 });
  rec('I: Put on Account with no customer: refused, nothing saved or sent', !a0.ok && t.calls.length === 0, a0.message);
  t.reg.member = { id: 'm2', number: '5550002', name: 'House Account', availableBalance: 0, allowCreditPayment: true, creditAmount: 50 };
  const a1 = await t.reg.tender({ type: 11, amount: 10 });
  rec('I: customer with a house account (Allow Credit Payment, limit $50): $10 sent as AIR POS tender 11 for that customer', a1.ok && t.calls.includes('begin:11:10'), t.calls.join(' '));
  t = mk(); await t.reg.recalc(); await t.reg.startPay();
  t.reg.member = { id: 'm3', number: '5550003', name: 'No Account', availableBalance: 0, allowCreditPayment: false, creditAmount: 50 };
  const a2 = await t.reg.tender({ type: 11, amount: 10 });
  rec('I: customer WITHOUT "Allow Credit Payment": the credit limit is not used, refused, nothing sent', !a2.ok && t.calls.length === 0, a2.message);
  t.reg.member.availableBalance = 4; const a3 = await t.reg.tender({ type: 11, amount: 4 });
  rec('I: store-credit balance still works as before ($4 of $4)', a3.ok && t.calls.includes('begin:11:4'), t.calls.join(' '));
  // ---- H ----
  t = mk(); t.reg.settingsPath = null;
  rec('H: scan sounds on by default', t.reg.state().settings.scanSound === true, 'scanSound=' + t.reg.state().settings.scanSound);
  t.reg.isManager = () => false; const h1 = t.reg.saveSettings({ scanSound: false });
  rec('H: a cashier cannot turn scan sounds off', !h1.ok && t.reg.settings.scanSound !== false, h1.message);
  const h1b = t.reg.saveSettings({ scanSound: true, drawerOnlyForCash: true });
  rec('H: a cashier saving other settings (sound unchanged) is not blocked', h1b.ok, h1b.message);
  t.reg.isManager = () => true; const h2 = t.reg.saveSettings({ scanSound: false });
  rec('H: a manager can turn them off (and on again)', h2.ok && t.reg.state().settings.scanSound === false && t.reg.saveSettings({ scanSound: true }).ok && t.reg.settings.scanSound === true, h2.message);
  const SD = path.join(__dirname, '..', 'app', 'public', 'sounds');
  const wav = f => { const b = fs.readFileSync(path.join(SD, f)); return { riff: b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE', sec: b.readUInt32LE(40) / b.readUInt32LE(28), bytes: b.length, b }; };
  const ok = wav('scan-ok.wav'), bad = wav('scan-bad.wav');
  rec('H: two built-in WAV tones, short (< 0.5 s) and different', ok.riff && bad.riff && ok.sec < 0.5 && bad.sec < 0.5 && !ok.b.equals(bad.b), `ok ${ok.sec.toFixed(2)} s, bad ${bad.sec.toFixed(2)} s`);
  rec('H: build copies them (build.sh copies app/public)', /cp -r app\/lib app\/public/.test(fs.readFileSync(path.join(__dirname, '..', 'stage-app.sh'), 'utf8')), 'app/public/sounds is inside app/public');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} F/G/H tests passed`);
  fs.writeFileSync(path.join(__dirname, 'fgh-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

// AirMax #19 (owner review pending) on the OFFLINE fake AIR POS (made-up items and made-up gift cards, nothing charged, no browser):
// the gift card's last 4 digits and its balance (read from AIR POS after the sale) are stamped onto the main sale receipt's PRINT COPY
// (same server-side stamping as #18, app/disclines.js); when that worked, the separate GIFT CARDS slip is not printed. When the receipt PDF
// cannot be stamped (the fake's plain receipt), the slip prints exactly as before. Nothing extra is sent to AIR POS; no full card number printed.
//   FAKE_PRINT_LOG=1 FAKE_REAL_RECEIPT=1 FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-gift-receipt-19.js
'use strict';
const { _pdf } = require('../app/disclines');
const FP = Number(process.env.FAKE_PORT || 5180), B = 'http://127.0.0.1:' + FP, H = 'http://127.0.0.1:' + (Number(process.env.FAKE_HOOK_PORT) || FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(B + '/api/state').then(r => r.json());
const hook = q => fetch(H + q).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const LOGIN = { company: 'fake shop', user: 'tester', password: 'fake-pw' }; // made up: the fake accepts any non-empty password
const lines = b64 => { try { const buf = Buffer.from(b64, 'base64'), pdf = _pdf.readPdf(buf), ex = _pdf.extract(pdf, _pdf.pageList(pdf)[0]); return _pdf.textLines(ex.glyphs).map(l => l.text); } catch { return null; } };
// what went to the printer since the last call: each print as its text lines (stamped receipt = parsed PDF; AirMax's own slip = its text)
async function prints() {
  const pdfs = (await hook('/printed?reset=1')).printed || [], log = await hook('/printlog?reset=1');
  return pdfs.map((b, i) => { const l = lines(b); return { receipt: !!l && l.some(x => /Total/.test(x)), slip: /^GIFT CARDS/.test((log[i] || {}).text || ''), text: l || String((log[i] || {}).text || '').split('\n') }; });
}
const all = p => p.map(x => x.text.join('\n')).join('\n');
const has = (p, s) => p.some(x => x.receipt && x.text.includes(s));
const after = (p, s) => { const r = p.find(x => x.receipt && x.text.includes(s)); return r ? r.text[r.text.indexOf(s) + 1] : null; };
const noFull = p => !/7000000000\d{6}|0000000\d{4}/.test(all(p));
const calls = async () => (await hook('/all-calls')).map(c => String(c).replace(/^.*\//, ''));
async function settle() { await sleep(2500); }
async function giftPay(amount) { const v = await post('gift-verify', { number: '7000000000008888', secret: '' }); return post('pay-tender', { type: 40, amount, giftCards: [v.card] }); }
async function fresh() { await post('pay-close'); await post('new-sale'); await post('dismiss'); await hook('/gift-add?no=7000000000008888&bal=8&sold=1'); for (const n of ['5678', '4321']) await hook('/gift-add?no=700000000000' + n + '&bal=0&sold=0'); await prints(); } // made-up cards back to a known state, so reruns give the same answers
(async () => {
  try {
    if (!(await state()).loggedIn) await post('login', LOGIN);
    if ((await fetch(H + '/printlog')).status !== 200) throw new Error('start the fake with FAKE_PRINT_LOG=1');
    await hook('/real-receipt?on=1'); await fresh();

    // P1 paid in full with a gift card ($5.40 of its $8)
    await post('scan', { code: '1002' }); await post('pay-start'); let c0 = (await calls()).length;
    let s = await giftPay((await state()).totals.due); await settle(); let pr = await prints(); const callsStamped = (await calls()).slice(c0);
    rec('P1 gift card pays $5.40: ONE print, the sale receipt, with "Gift card **** 8888 paid $5.40" and under it "Balance left $2.60"', s.completed && pr.length === 1 && pr[0].receipt && has(pr, 'Gift card **** 8888 paid $5.40') && after(pr, 'Gift card **** 8888 paid $5.40') === 'Balance left $2.60', pr.map(x => x.text.slice(-6).join(' / ')).join(' || '));
    rec('P2 no separate GIFT CARDS slip; the receipt keeps its own totals; the full card number is on no printout', !pr.some(x => x.slip) && has(pr, 'Total $5.40') && noFull(pr), pr.map(x => (x.slip ? 'SLIP ' : 'RECEIPT ') + x.text.length + ' lines').join(', '));
    const lastId = (await state()).lastOrderId;

    // P3 Reprint of that sale: receipt again with the same gift lines, still no slip
    await post('dismiss'); const rp = await post('print', {}); await settle(); pr = await prints();
    rec('P3 Reprint: the receipt again with the gift card lines (balance as read after the sale), no slip', rp.ok !== false && pr.length === 1 && has(pr, 'Gift card **** 8888 paid $5.40') && !pr.some(x => x.slip), (rp.message || '') + ' | ' + pr.length + ' print(s)');

    // P4 a new card sold + part paid with the $2.60 left on 8888, rest cash
    await fresh(); await hook('/gift-add?no=7000000000008888&bal=2.6&sold=1');
    await post('gift-line', { number: '7000000000005678', amount: 20 }); await post('pay-start'); await giftPay(2.6); s = await post('pay-cash', { tendered: 17.4 }); await settle(); pr = await prints();
    rec('P4 one sale selling a card AND paying with another: both on the receipt with last 4 and balance, no slip', s.completed && pr.length === 1 && after(pr, 'Gift card **** 5678 new $20.00') === 'Balance now $20.00' && after(pr, 'Gift card **** 8888 paid $2.60') === 'Balance left $0.00' && noFull(pr), pr.map(x => x.text.slice(-8).join(' / ')).join(' || '));

    // P5 balance look-up down: the receipt says "check at counter", never a guessed amount
    await fresh(); await post('gift-line', { number: '7000000000004321', amount: 15 }); await hook('/fault?path=RetailGiftCardGet&mode=down&n=5');
    await post('pay-start'); s = await post('pay-cash', { tendered: 15 }); await settle(); pr = await prints(); await hook('/fault-clear');
    rec('P5 AIR POS cannot give the balance: "Balance now check at counter" on the receipt, no slip', s.completed && pr.length === 1 && after(pr, 'Gift card **** 4321 new $15.00') === 'Balance now check at counter', pr.map(x => x.text.slice(-4).join(' / ')).join(' || '));

    // P6 no gift card: the receipt only, nothing added
    await fresh(); await post('scan', { code: '1003' }); await post('pay-start'); s = await post('pay-cash', { tendered: 20 }); await settle(); pr = await prints();
    rec('P6 a sale with no gift card: one receipt, no "Gift cards" section, no slip', s.completed && pr.length === 1 && pr[0].receipt && !/Gift card/.test(all(pr)), pr.length + ' print(s)');

    // P7 the receipt PDF cannot be stamped (the fake's plain receipt): the slip prints exactly as before
    await fresh(); await hook('/real-receipt?on=0');
    await post('scan', { code: '1002' }); await post('pay-start'); c0 = (await calls()).length;
    s = await giftPay((await state()).totals.due); await settle(); pr = await prints(); const callsSlip = (await calls()).slice(c0);
    const slip = pr.filter(x => x.slip).map(x => x.text.join('\n')).join('\n');
    rec('P7 not stamped: the receipt, then the GIFT CARDS USED slip "**** 8888 paid $5.40 / Balance left $2.60", as before', s.completed && pr.length === 2 && !pr[0].slip && pr[1].slip && /GIFT CARDS USED \(1\)\n\*\*\*\* 8888 paid\s+\$5\.40\n\s*Balance left\s+\$2\.60/.test(slip), JSON.stringify(slip));
    const strip = l => l.filter(x => !/PrintBillContent/.test(x));
    rec('P8 the same AIR POS calls with and without the stamp (nothing extra sent; only one print fewer)', JSON.stringify(strip(callsStamped)) === JSON.stringify(strip(callsSlip)) && callsStamped.filter(x => /PrintBillContent/.test(x)).length === callsSlip.filter(x => /PrintBillContent/.test(x)).length - 1, `stamped ${callsStamped.length} calls, slip ${callsSlip.length}`);
    const o = lastId ? await hook('/order?id=' + encodeURIComponent(lastId)) : null;
    rec('P9 the stamped sale as saved in AIR POS is unchanged: paid by gift card, its one item at $5.00, no gift text added to the order', o && o.done && o.paymentType === 40 && o.subs.length === 1 && o.subs[0].price === 5 && !/Gift card|Balance left/.test(JSON.stringify(o)), o ? `paymentType ${o.paymentType}, ${o.subs.length} line(s)` : 'no order');
    await hook('/real-receipt?on=1'); await fresh();
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

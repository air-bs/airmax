// Receipt variety (Gordon, Nov 3; tests + fake server only): every receipt prints EXACTLY ONCE and its totals match what AirMax charged
// or refunded. The REAL app/server.js on the OFFLINE fake AIR POS (tests/look-fake.js, FAKE_RECEIPT_TEXT=1: receipts are small text PDFs
// drawn from what the fake AIR POS recorded - the saved order and its payments, or the recorded return and its refund), printed through
// the fake AIR POS print service. Made-up items and a made-up gift card, no card machine, no real card, no printer. Own ports.
// Covered: cash sale, Reprint, receipt return, exchange (return + sale on one ticket), gift card payment, split tender (card + cash),
// Tax Off. A quote (#26) does not exist on any branch, so it is not covered.
// Run: node tests/receipt-variety.test.js   (RCPT_PORT=5261: fake 5261 + hook 5262)
'use strict';
const path = require('path'), cp = require('child_process');
const P = Number(process.env.RCPT_PORT || 5261), B = 'http://127.0.0.1:' + P, H = 'http://127.0.0.1:' + (P + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note: String(note || '').slice(0, 400) }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note || '').slice(0, 400)); };
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(B + '/api/state').then(r => r.json());
const hook = q => fetch(H + q).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
// the text lines of a PDF drawn with app/lib/hardware.js testPagePdf
const pdfLines = b64 => [...Buffer.from(String(b64 || ''), 'base64').toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(m => m[1].replace(/\\([\\()])/g, '$1'));
const amt = (L, label) => { const l = L.find(x => x.startsWith(label + ' ')); return l ? Number(l.slice(label.length + 1).replace('$', '')) : null; };
const paid = (L, word) => L.filter(x => x.startsWith(word + ' ')).map(x => { const m = /^\S+ (.+) \$([\d.]+)$/.exec(x); return m ? [m[1], Number(m[2])] : [x, null]; });
const r2 = n => Math.round(n * 100) / 100;
// one transaction: clear the print log, run it, wait for the background prints, return every document printed for it
async function printedBy(fn) {
  await hook('/receipts?reset=1'); const r = await fn();
  let n = -1; for (let i = 0; i < 40; i++) { await sleep(150); const c = (await hook('/receipts')).printed.length; if (c === n && c > 0) break; n = c; }
  await sleep(1200); return { r, docs: (await hook('/receipts')).printed.map(pdfLines) };
}
const fresh = async () => { await post('pay-close'); await post('return-cancel'); await post('return-toggle', { on: false }); await post('new-sale'); await post('dismiss'); await post('member-detach'); await post('tax-exempt', { on: false }); };
const kind = L => L[0];
(async () => {
  const ch = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { stdio: 'ignore', env: { ...process.env, FAKE_PORT: String(P), FAKE_RECEIPT_TEXT: '1' } });
  try {
    let upd = false; for (let i = 0; i < 100 && !upd; i++) { await sleep(100); upd = await state().then(() => true).catch(() => false); }
    if (!upd) throw new Error('fake did not start');
    await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' });
    const st = await post('settings', { hardware: 'airpos', receiptAutoPrint: 'always', returnReceiptAutoPrint: 'always', drawerAutoOpen: 'off' }); if (!st || st.ok === false) throw new Error('settings: ' + JSON.stringify(st));
    await hook('/card-wait?on=0');

    // 1. cash sale
    await fresh(); for (const c of ['1001', '1001', '1003']) await post('scan', { code: c });
    let x = await printedBy(async () => { await post('pay-start'); return post('pay-tender', { type: 10, tendered: 50 }); });
    let L = x.docs[0] || [];
    rec('1 cash sale: exactly one receipt printed', x.r.completed && x.docs.length === 1 && kind(L) === 'SALE RECEIPT', `${x.docs.length} docs`);
    rec('1 cash sale: receipt total = charged, cash and change match', amt(L, 'Total') === x.r.due && JSON.stringify(paid(L, 'Paid')) === JSON.stringify([['Cash', x.r.due]]) && amt(L, 'Change') === x.r.change, JSON.stringify({ L, due: x.r.due, change: x.r.change }));
    const firstId = x.r.orderId, firstTotal = x.r.due;

    // 2. Reprint Receipt: once, same totals
    x = await printedBy(() => post('print', { orderId: firstId })); L = x.docs[0] || [];
    rec('2 Reprint Receipt: exactly one receipt, same total as the sale', x.r.ok && x.docs.length === 1 && kind(L) === 'SALE RECEIPT' && amt(L, 'Total') === firstTotal, `${x.docs.length} docs, total ${amt(L, 'Total')}`);

    // 3. receipt return (a made-up earlier sale paid card + cash)
    await fresh(); await post('return-start', { kind: 'receipt', orderId: 'o-ret-walkin' }); await post('scan', { code: '1001' });
    x = await printedBy(() => post('return-confirm')); L = x.docs[0] || [];
    const refunded = r2((x.r.payments || []).reduce((a, p) => a + p.amount, 0));
    rec('3 receipt return: exactly one return receipt printed, no sale receipt', x.r.ok && x.docs.length === 1 && kind(L) === 'RETURN RECEIPT', `${x.docs.length} docs: ${x.docs.map(kind).join(', ')}`);
    rec('3 receipt return: refund on the receipt = what AirMax refunded, same payments', amt(L, 'Refund') === refunded && refunded > 0 && JSON.stringify(paid(L, 'Refunded')) === JSON.stringify((x.r.payments || []).map(p => [({ 10: 'Cash', 20: 'Card', 11: 'Account' })[p.paymentType] || String(p.paymentType), p.amount])), JSON.stringify({ L, payments: x.r.payments }));

    // 4. exchange: return a Gift bag ($1.50, no tax) and buy Bulk candy ($10.80) on one ticket, pay the difference in cash
    await fresh(); await post('return-toggle', { on: true }); await post('scan', { code: '1004' }); await post('return-toggle', { on: false }); await post('scan', { code: '1001' });
    x = await printedBy(async () => { await post('pay-start'); return post('pay-tender', { type: 10, tendered: 20 }); });
    const ret = x.docs.filter(d => kind(d) === 'RETURN RECEIPT'), sale = x.docs.filter(d => kind(d) === 'SALE RECEIPT');
    rec('4 exchange: exactly one return receipt and one sale receipt (no duplicates)', x.r.completed && ret.length === 1 && sale.length === 1 && x.docs.length === 2, `${x.docs.length} docs: ${x.docs.map(kind).join(', ')} | ${x.r.message}`);
    rec('4 exchange: return receipt refund $1.50; sale receipt total $10.80 = refund credit + the cash the customer paid', amt(ret[0] || [], 'Refund') === 1.5 && amt(sale[0] || [], 'Total') === 10.8 && r2(1.5 + ((x.r.tenders || []).find(t => t.name === 'Cash') || {}).amount) === 10.8, JSON.stringify({ ret: ret[0], sale: sale[0], tenders: x.r.tenders }));

    // 5. gift card payment ($3 of a made-up $8 card) + cash for the rest
    await fresh(); await post('scan', { code: '1001' }); const v = await post('gift-verify', { number: '7000000000008888' });
    x = await printedBy(async () => { await post('pay-start'); const g = await post('pay-tender', { type: 40, amount: 3, giftCards: v.card ? [v.card] : [] }); if (!g.ok) return g; return post('pay-tender', { type: 10, tendered: 20 }); }); L = x.docs[0] || [];
    const gs = x.docs.filter(d => /^GIFT CARDS USED/.test(d[0]));
    rec('5 gift card payment: exactly one receipt; total = charged; Gift card $3.00 + Cash $7.80', v.ok && x.r.completed && x.docs.filter(d => kind(d) === 'SALE RECEIPT').length === 1 && kind(L) === 'SALE RECEIPT' && amt(L, 'Total') === x.r.due && JSON.stringify(paid(L, 'Paid')) === JSON.stringify([['Gift card', 3], ['Cash', r2(x.r.due - 3)]]), JSON.stringify({ L, due: x.r.due, m: x.r.message }));

    // #19 (Gordon OK Nov 3): the gift card last 4 + balance are now ON the receipt's print copy, so the separate slip no longer prints (before #19: a second 'GIFT CARDS USED' slip)
    rec('5 gift card payment: ONE document (the receipt) shows the masked card, $3.00 paid and $5.00 left; no separate slip, no full card number (#19)', x.docs.length === 1 && gs.length === 0 && L.includes('Gift card **** 8888 paid $3.00') && L.includes('Balance left $5.00') && !L.join(' ').includes('7000000000008888'), JSON.stringify(x.docs));

    // 6. split tender: card machine $5 (made-up, approved at once by the fake) + cash for the rest
    await fresh(); await post('scan', { code: '1001' }); await post('scan', { code: '1003' });
    x = await printedBy(async () => { await post('pay-start'); const c = await post('pay-tender', { type: 20, amount: 5 }); if (!c.ok) return c; return post('pay-tender', { type: 10, tendered: 20 }); }); L = x.docs[0] || [];
    rec('6 split tender card + cash: exactly one receipt (not one per payment); total = charged; Card $5.00 + Cash the rest', x.r.completed && x.docs.filter(d => kind(d) === 'SALE RECEIPT').length === 1 && x.docs.length === 2 && kind(x.docs[1]) === 'CARD PAYMENT' /* release #12: the card payment slip prints once, separately */ && amt(L, 'Total') === x.r.due && JSON.stringify(paid(L, 'Paid')) === JSON.stringify([['Card', 5], ['Cash', r2(x.r.due - 5)]]), JSON.stringify({ L, due: x.r.due, m: x.r.message }));

    // 7. Tax Off
    await fresh(); const t = await post('tax-exempt', { on: true }); await post('scan', { code: '1001' }); await post('scan', { code: '1003' });
    x = await printedBy(async () => { await post('pay-start'); return post('pay-tender', { type: 10, tendered: 20 }); }); L = x.docs[0] || [];
    rec('7 Tax Off: exactly one receipt; tax $0.00 and total $12.00 = charged', t.ok && x.r.completed && x.docs.length === 1 && amt(L, 'Tax') === 0 && amt(L, 'Total') === 12 && x.r.due === 12, JSON.stringify({ L, due: x.r.due, t: t.message }));
  } catch (e) { rec('crashed', false, e.stack || e.message); }
  finally { try { ch.kill(); } catch {} }
  const pass = out.filter(x => x.pass).length; console.log(`receipt-variety: ${pass}/${out.length} passed`);
  process.exit(pass === out.length ? 0 : 1);
})();

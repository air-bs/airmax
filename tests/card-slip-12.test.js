// Fix #12 (Ari, Nov 2; branch claude/receipt-card-brand, print only, no money): card brand + last 4 after the receipt.
// The receipt is AIR POS's PDF (its template prints the payment line), so AirMax prints a small "CARD PAYMENT" slip right after it,
// like the sale note and the gift card list. Only real data: a card on file's AIR POS cardType + lastFourDigits. Card machine and
// typed cards: no slip (no card data reaches AirMax). Part A: label rules (Register, no network). Part B: the REAL app/server.js on
// the OFFLINE fake AIR POS (tests/look-fake.js, made-up cards only, own ports), printing through the fake AIR POS print service.
// Run: node tests/card-slip-12.test.js   (CARD12_PORT=5201: fake on 5201, hook 5202)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = Number(process.env.CARD12_PORT || 5201), BASE = 'http://127.0.0.1:' + PORT, HOOK = 'http://127.0.0.1:' + (PORT + 1);
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text());
const slipOf = docs => docs.filter(d => /CARD PAYMENT/.test(d));

(async () => {
  // ---- A. label rules (only real AIR POS card data; never guessed) ----
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-c12-')) }); reg.settingsPath = null;
  rec('A1 card on file Visa / 4242 -> "VISA ****4242"', reg.cardSlipLabel({ brand: 'Visa', last4: '4242' }) === 'VISA ****4242', reg.cardSlipLabel({ brand: 'Visa', last4: '4242' }));
  rec('A2 AIR POS gave no card type (cofCard default "Card") -> "CARD ON FILE ****4444", brand not guessed', reg.cardSlipLabel({ brand: 'Card', last4: '4444' }) === 'CARD ON FILE ****4444', reg.cardSlipLabel({ brand: 'Card', last4: '4444' }));
  rec('A3 last 4 missing or not 4 digits -> no slip', reg.cardSlipLabel({ brand: 'Visa', last4: '' }) === null && reg.cardSlipLabel({ brand: 'Visa', last4: '42' }) === null, 'null');
  reg.saveCardSlipFor('o-1', [{ label: 'VISA ****4242', amount: 10.8 }]);
  const L = reg.cardSlipLines('o-1') || [];
  rec('A4 slip lines: heading + "VISA ****4242 ... $10.80" (one row per card payment)', L[0] === 'CARD PAYMENT' && /^VISA \*\*\*\*4242 +\$10\.80$/.test(L[1]) && L.length === 2, JSON.stringify(L));
  rec('A5 an order without a card-on-file payment has no slip', reg.cardSlipLines('o-none') === null, 'null');

  { let slips = 0; reg.printSlip = async () => { slips++; return { ok: true }; }; reg.printOrderCore = async () => ({ ok: true, message: 'printed' });
    reg.templateList = () => ({ templates: [{ id: 't-gift', name: 'Gift Receipt', fields: [] }] });
    const g = await reg.printGiftReceipt('o-1'); const n0 = slips; const r = await reg.printOrder('o-1');
    rec('A6 gift receipt never gets the card slip (no payment on a gift receipt); the normal receipt does', g.ok && n0 === 0 && slips === 1 && r.cardSlip && r.cardSlip.ok, `gift slips ${n0}, receipt slips ${slips}`); delete reg.printSlip; delete reg.printOrderCore; delete reg.templateList; }
  // ---- B. real server on the offline fake AIR POS ----
  const env = { ...process.env, FAKE_PORT: String(PORT) };
  const ch = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; ch.stdout.on('data', d => { log += d; }); ch.stderr.on('data', d => { log += d; });
  try {
    let up = false; for (let i = 0; i < 100 && !up; i++) { await sleep(100); up = await state().then(() => true).catch(() => false); }
    if (!up) throw new Error('fake server did not start');
    await hook('/keyed?mode=stripe'); await hook('/cof?n=2'); // made-up saved cards on m-sample: mc-visa (Visa 4242), mc-other
    await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' });
    await post('settings', { hardware: 'airpos', receiptAutoPrint: 'always' }); // print through the fake AIR POS print service (keeps the text)
    const sale = async (member, tender) => {
      await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach');
      if (member) await post('member-attach', { number: '5550100' });
      await post('scan', { code: '1001' }); await post('pay-start'); const due = (await state()).totals.due;
      await hook('/printed?reset=1'); const r = await post('pay-tender', tender(due)); await sleep(1500);
      return { r, due, docs: (JSON.parse(await hook("/printed")).printed || []).map(x => Buffer.from(x, "base64").toString("latin1")) };
    };
    // B1 card on file
    const c = await sale(true, due => ({ type: 30, amount: due, savedCardId: 'mc-visa' }));
    const slips = slipOf(c.docs), money = '$' + c.due.toFixed(2);
    rec('B1 card-on-file sale completes as before (Keyed card, same amount)', c.r && c.r.completed && (c.r.tenders || []).length === 1 && c.r.tenders[0].name === 'Keyed card' && c.r.tenders[0].amount === c.due, JSON.stringify(c.r && c.r.tenders));
    rec('B2 receipt prints, then ONE card slip "CARD PAYMENT / VISA ****4242 ... ' + money + '" (receipt first)', c.docs.length >= 2 && slips.length === 1 && slips[0].includes('VISA ****4242') && slips[0].includes(money) && c.docs.indexOf(slips[0]) > 0, c.docs.length + ' docs; slip ' + (slips[0] ? 'found' : 'missing'));
    const cof = JSON.parse(await hook('/cof-state')); const lp = (cof.pays || [])[(cof.pays || []).length - 1] || {};
    rec('B3 AIR POS gets the same payment as before: type 30, saved card id, masked card only, recordCreditCard false, same amount', lp.retailMemberCardId === 'mc-visa' && lp.recordCreditCard === false && lp.amount === c.due && JSON.stringify(lp.creditCard) === JSON.stringify({ cardNo: '**** **** **** 4242', expiration: '12/28', cvv: '***' }), JSON.stringify(lp));
    // B4 reprint
    await hook('/printed?reset=1'); const rp = await post('print', {}); await sleep(500); const rdocs = (JSON.parse(await hook('/printed')).printed || []).map(x => Buffer.from(x, 'base64').toString('latin1'));
    rec('B4 Reprint Receipt prints the receipt + the same card slip again', rp && rp.ok && slipOf(rdocs).length === 1 && /card slip printed/.test(rp.message || ''), (rp && rp.message) + ' | ' + rdocs.length + ' docs');
    // B5 card machine (terminal): no card data -> slip says CARD only (store request #12: a card sale must never read as cash)
    await hook('/card-wait?on=0'); const t = await sale(false, due => ({ type: 20, amount: due }));
    rec('B5 card machine sale: receipt prints + a slip "CARD (brand/last 4 n/a)" with the amount, no brand or digits invented (AIR POS gives none)', t.r && t.r.completed && t.docs.length >= 2 && slipOf(t.docs).length === 1 && /CARD .{0,2}brand\/last 4 n\/a/.test(slipOf(t.docs)[0]) && !/VISA|MASTER|AMEX|DISCOVER|\*\*\*\*/.test(slipOf(t.docs)[0]), (t.r && t.r.message) + ' | ' + t.docs.length + ' docs');
    // B6 cash: no slip
    const k = await sale(false, due => ({ type: 10, tendered: Math.ceil(due) }));
    rec('B6 cash sale: NO card slip', k.r && k.r.completed && slipOf(k.docs).length === 0, k.docs.length + ' docs');
    // B7 nothing card-related leaks to the screen state or the server log
    const S = JSON.stringify(await state());
    rec('B7 last 4 not in the screen state nor the server log', !/4242/.test(S) && !/\*\*\*\*4242|cardSlip/.test(log), 'state ' + S.length + ' bytes, log ' + log.length + ' bytes');
  } catch (e) { rec('B crashed', false, e.message); }
  finally { ch.kill(); }
  const pass = out.filter(x => x.pass).length; console.log(`card-slip-12: ${pass}/${out.length} passed`);
  try { fs.writeFileSync(path.join(__dirname, 'card-slip-12-results.json'), JSON.stringify(out, null, 1)); } catch {}
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

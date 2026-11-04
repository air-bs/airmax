// AirMax 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31, local only). OFFLINE: mocked AIR POS, temp data folders, made-up
// customer, public test card numbers only (4242..., 5555...). No account, no network, no money.
// Covers: the per-store setting (off by default, manager only), Sola add / list / charge / refund / delete, lost replies
// (AddComplete, ReceiveBegin), a restart mid-charge, duplicate-save retry, card data never kept, and a Stripe regression.
// Run: node tests/sola-cof-109.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VISA = '4242424242424242', MC = '5555555555554444', CVV = '987';
const grepDir = (dir, s) => fs.readdirSync(dir, { recursive: true }).some(f => { const p = path.join(dir, String(f)); try { return fs.statSync(p).isFile() && fs.readFileSync(p, 'utf8').includes(s); } catch { return false; } });

// srv = the fake AIR POS (shared between two Registers for the restart tests)
function mkSrv() { return { cards: { m1: [] }, seq: 0, log: [], begins: [], rcv: {}, cancels: [], completes: 0, faults: [], wait: false, deletes: [] }; }
function mk(opt = {}) {
  const dir = opt.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-solacof-'));
  const logs = [], srv = opt.srv || mkSrv();
  const reg = new Register({ log: m => logs.push(String(m)), dataDir: dir });
  reg.settingsPath = path.join(dir, 'settings-test.json'); reg.settings.hardware = 'airpos';
  const api = reg.api; api.ide = 'x'; api.shop = opt.shop || 'shop1';
  reg.identity = { userName: 'u', corpName: 'Fake Corp', shopName: 'Fake shop', currency: 2, superAdmin: opt.manager !== false };
  reg.home = { terminalConfig: { autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.keyedCh = opt.stripe ? { channelType: 10, key: 'pk_test_madeup' } : { channelType: 20, key: '' };
  const fault = name => { const i = srv.faults.findIndex(f => f.name === name); if (i < 0) return null; return srv.faults.splice(i, 1)[0].mode; };
  const LOST = { success: false, message: 'Network error: ECONNRESET', unreachable: true };
  api.memberCardsSelect = async id => { srv.log.push('select'); const f = fault('select'); if (f) return LOST; return { success: true, value: (srv.cards[id] || []).map(c => ({ ...c })) }; };
  api.memberCardAddBegin = async id => { srv.log.push('begin'); const f = fault('begin'); if (f) return LOST; return opt.stripe ? { success: true, value: { success: true, setupIntent: { id: 'seti_x', client_secret: 'seti_x_secret_DONOTLOG' } } } : { success: true, value: { success: true } }; };
  api.memberCardAddComplete = async x => { const f = fault('complete'); srv.log.push('complete');
    srv.adds = srv.adds || []; srv.adds.push({ retailMemberId: x.retailMemberId, setupIntentId: x.setupIntentId, last4: String(x.cardNo || '').slice(-4), full: /^\d{13,19}$/.test(String(x.cardNo || '')), exp: x.expiration, cvvSet: !!x.cvv, holderName: x.holderName, billAddress: x.billAddress, zipCode: x.zipCode });
    if (f === 'down') return LOST;
    if (x.cardNo) (srv.cards[x.retailMemberId] = srv.cards[x.retailMemberId] || []).push({ id: 'mc-' + (++srv.seq), cardType: String(x.cardNo)[0] === '5' ? 'Mastercard' : 'Visa', lastFourDigits: String(x.cardNo).slice(-4), validityPeriod: x.expiration, usableForCurrentChannel: true });
    srv.lastReq = x; // kept by reference: the test checks it was wiped after the call
    return f === 'lost' ? LOST : { success: true, value: {} }; };
  api.memberCardDelete = async (id, cardId) => { srv.deletes.push({ id, cardId }); const l = srv.cards[id] || []; const i = l.findIndex(c => c.id === cardId); if (i < 0) return { success: false, message: 'Card not found' }; l.splice(i, 1); return { success: true, value: {} }; };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async s => { const f = fault('rbegin'); if (f === 'hang') return new Promise(() => {}); if (f === 'down') return LOST;
    srv.begins.push({ id: s.id, paymentType: s.paymentType, amount: s.amount, retailMemberCardId: s.retailMemberCardId, cardNo: s.creditCard && s.creditCard.cardNo, cvv: s.creditCard && s.creditCard.cvv, exp: s.creditCard && s.creditCard.expiration });
    (srv.rcv[s.retailOrderId] = srv.rcv[s.retailOrderId] || []).push({ id: s.id, paymentType: s.paymentType, amount: s.amount, receiveAmount: s.receiveAmount, giveAmount: s.giveAmount, status: srv.wait ? 10 : 20 });
    return f === 'lost' ? LOST : { success: true, value: { isCompleted: !srv.wait } }; };
  const findR = id => Object.values(srv.rcv).flat().find(r => r.id === id);
  api.receiveCheck = async s => { const r = findR(s.id); if (!r) return { success: false, errorCode: 1001, message: 'Combined payment infomation not found' }; return { success: true, value: { isCompleted: r.status === 20, shouldReissue: r.status < 0 } }; };
  api.receiveCancel = async s => { srv.cancels.push(s.id); const r = findR(s.id); if (r) r.status = -10; return { success: true }; };
  api.orderGet = async id => ({ success: true, value: { id, status: 15, receives: (srv.rcv[id] || []).map(r => ({ ...r })) } });
  api.complete = async () => { srv.completes++; return { success: true, value: {} }; };
  api.productPaged = async () => ({ success: true, rows: [], total: 0 });
  reg.printOrder = async () => ({ ok: true, message: 'Receipt sent' }); reg.drawer = async () => ({ ok: true });
  reg.attachMember = async () => { reg.member = { id: 'm1', number: '5550100', name: 'Sample Customer', availableBalance: 0, creditAmount: 0 }; return { ok: true }; };
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  reg.member = { id: 'm1', number: '5550100', name: 'Sample Customer', availableBalance: 0, creditAmount: 0 };
  if (opt.on) reg.setSolaCards(true);
  return { reg, dir, srv, logs };
}
const addBody = (cardNo = VISA, expiration = '12/30', extra = {}) => ({ id: 'm1', holderName: 'Sample Customer', billAddress: '100 Example St', zipCode: '00000', consent: true, card: { cardNo, expiration, cvv: CVV }, ...extra });
const count = (srv, op) => srv.log.filter(x => x === op).length;

(async () => {
  // ---- 1: per-store setting ----
  let t = mk();
  let k = t.reg.keyedInfo();
  rec('Setting: OFF by default on a Sola store (Manual Credit off, note says Settings > Cards, keeps "only supports Stripe")', !k.enabled && /Settings > Cards/.test(k.note) && /only supports Stripe/.test(k.note) && !t.reg.solaCardsOn(), k.note);
  let r = await t.reg.memberCards('m1');
  rec('Setting off: customer cards say "Stripe stores only" (old wording kept for tests / staff)', r.ok && r.sola === false && /Stripe stores only/.test(r.note), r.note);
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Setting off: a typed Sola card is refused, AIR POS never called', !r.ok && r.notStripe && count(t.srv, 'begin') === 0 && count(t.srv, 'complete') === 0, r.message);
  t = mk({ manager: false });
  r = t.reg.setSolaCards(true);
  rec('Setting: only a manager can turn it on', !r.ok && /manager/.test(r.message) && !t.reg.solaCardsOn(), r.message);
  t = mk(); r = t.reg.setSolaCards(true);
  const sf = fs.readFileSync(t.reg.settingsPath, 'utf8');
  rec('Setting: manager turns it on for THIS store; saved in settings under company|shop', r.ok && r.on && t.reg.solaCardsOn() && t.reg.keyedInfo().kind === 'sola' && JSON.parse(sf).solaCards['fake corp|shop1'] === true, JSON.stringify(JSON.parse(sf).solaCards));
  t.reg.api.shop = 'shop2';
  rec('Setting: another store of the same company stays OFF', !t.reg.solaCardsOn() && !t.reg.keyedInfo().enabled, '');
  t.reg.api.shop = 'shop1'; t.reg.setSolaCards(false);
  rec('Setting: turning it off works', !t.reg.solaCardsOn() && !t.reg.keyedInfo().enabled && JSON.parse(fs.readFileSync(t.reg.settingsPath, 'utf8')).solaCards['fake corp|shop1'] === undefined, '');
  t = mk({ on: true }); t.reg.pay = { tenders: [], card: { status: 'waiting' } };
  rec('Setting: cannot be changed while a card payment is open', !t.reg.setSolaCards(false).ok && t.reg.solaCardsOn(), '');

  // ---- 2: Sola add ----
  t = mk({ on: true });
  r = await t.reg.memberCardAddBegin('m1');
  rec('Add: add-begin route refuses on Sola (the card is typed and saved in one step)', !r.ok && /one step/.test(r.message) && count(t.srv, 'begin') === 0, r.message);
  r = await t.reg.memberCardAddComplete(addBody(VISA, '12/30', { consent: false }));
  rec('Add: refused without the customer consent tick; nothing sent', !r.ok && /agree/.test(r.message) && t.srv.log.length === 0, r.message);
  r = await t.reg.memberCardAddComplete(addBody('4242424242424241'));
  rec('Add: bad card number refused before AIR POS (cardError)', !r.ok && r.cardError && t.srv.log.length === 0, r.message);
  r = await t.reg.memberCardAddComplete(addBody(VISA, '13/30'));
  rec('Add: bad expiry refused before AIR POS', !r.ok && r.cardError && t.srv.log.length === 0, r.message);
  r = await t.reg.memberCardAddComplete(addBody(VISA, '12/30', { holderName: '' }));
  rec('Add: holder name / address / ZIP needed', !r.ok && /name/.test(r.message) && t.srv.log.length === 0, r.message);
  const body = addBody();
  r = await t.reg.memberCardAddComplete(body);
  const a0 = (t.srv.adds || [])[0] || {};
  rec('Add: list read first, then AddBegin, then ONE AddComplete (like AIR POS MemberCardAddDialog)', r.ok && t.srv.log.join() === 'select,begin,complete' && /ending 4242 saved/.test(r.message), t.srv.log.join() + ' / ' + r.message);
  rec('Add: AddComplete carries the typed card, blank setupIntentId, holder / address / ZIP', a0.full && a0.last4 === '4242' && a0.exp === '12/30' && a0.cvvSet && a0.setupIntentId === '' && a0.holderName === 'Sample Customer' && a0.billAddress && a0.zipCode, JSON.stringify(a0));
  rec('Add: the request body and the sent request no longer hold the card (wiped after the one call)', !body.card && t.srv.lastReq.cardNo === '' && t.srv.lastReq.cvv === '' && t.srv.lastReq.expiration === '', JSON.stringify(Object.keys(body)));
  r = await t.reg.memberCards('m1');
  rec('List: the saved Sola card shows brand / last 4 / expiry only', r.ok && r.sola === true && r.kind === 'sola' && r.cards.length === 1 && r.cards[0].last4 === '4242' && r.cards[0].exp === '12/30' && Object.keys(r.cards[0]).sort().join() === 'brand,exp,id,last4,usable', JSON.stringify(r.cards));
  t.srv.log = [];
  r = await t.reg.memberCardAddComplete(addBody(VISA, '12/30'));
  rec('Duplicate: the same card again is NOT saved twice (no AddBegin / AddComplete)', !r.ok && r.alreadySaved && t.srv.log.join() === 'select' && t.srv.cards.m1.length === 1, r.message);
  t.srv.log = [];
  r = await t.reg.memberCardAddComplete(addBody(MC, '03/31'));
  rec('Add: a second, different card is saved', r.ok && t.srv.cards.m1.length === 2 && /ending 4444/.test(r.message), r.message);

  // lost reply: AIR POS saved it but the reply was lost -> checked, not re-sent
  t = mk({ on: true }); t.srv.faults.push({ name: 'complete', mode: 'lost' });
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Lost reply (saved): checks the list, finds the new card, says saved; ONE AddComplete', r.ok && /AIR POS had saved it/.test(r.message) && count(t.srv, 'complete') === 1 && t.srv.cards.m1.length === 1, r.message);
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Duplicate-save retry after the lost reply: the press again is refused (already on file), nothing sent', !r.ok && r.alreadySaved && count(t.srv, 'complete') === 1 && t.srv.cards.m1.length === 1, r.message);
  // reply lost and it never arrived -> clearly absent -> may retry, saved once
  t = mk({ on: true }); t.srv.faults.push({ name: 'complete', mode: 'down' });
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Lost reply (not saved): list shows no new card -> "did not save", nothing on file', !r.ok && /AIR POS does not have it, so nothing was saved/.test(r.message) && t.srv.cards.m1.length === 0, r.message);
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Retry after that: saved exactly once', r.ok && t.srv.cards.m1.length === 1 && count(t.srv, 'complete') === 2, r.message);
  // reply lost AND the list cannot be read -> unknown; next press checks first
  t = mk({ on: true }); t.srv.faults.push({ name: 'complete', mode: 'lost' }, { name: 'select', mode: 'lost' });
  const sel0 = t.reg.api.memberCardsSelect; let nSel = 0; t.reg.api.memberCardsSelect = async id => { nSel++; if (nSel === 1) { t.srv.faults = t.srv.faults.filter(f => f.name !== 'select'); t.srv.faults.push({ name: 'select2', mode: 'x' }); return sel0(id); } if (nSel === 2) return { success: false, message: 'Network error: ECONNRESET', unreachable: true }; return sel0(id); };
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Lost reply + list unreadable: "do not add it again", marked pending', !r.ok && r.unknown && t.reg.cofPending && t.reg.cofPending.m1, r.message);
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Duplicate-save retry while pending: checks first, finds it saved, NOT sent again', !r.ok && r.alreadySaved && count(t.srv, 'complete') === 1 && t.srv.cards.m1.length === 1, r.message);
  t = mk({ on: true }); t.srv.faults.push({ name: 'select', mode: 'lost' });
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Add: list unreadable BEFORE saving -> refused (it checks first so a card is never saved twice)', !r.ok && r.retryable && count(t.srv, 'begin') === 0 && count(t.srv, 'complete') === 0, r.message);
  t = mk({ on: true }); t.srv.faults.push({ name: 'begin', mode: 'lost' });
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Add: AddBegin fails -> nothing saved, AddComplete never sent', !r.ok && count(t.srv, 'complete') === 0, r.message);

  // ---- 3: charge a saved card ----
  t = mk({ on: true }); await t.reg.memberCardAddComplete(addBody()); const cid = t.srv.cards.m1[0].id;
  await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: cid });
  let b0 = t.srv.begins[0] || {};
  rec('Charge saved card: ONE ReceiveBegin (Online 30) with the card id + masked card only; sale completes', r.ok && t.srv.begins.length === 1 && b0.paymentType === 30 && b0.retailMemberCardId === cid && b0.cardNo === '**** **** **** 4242' && b0.cvv === '***' && t.srv.completes === 1, JSON.stringify({ ok: r.ok, m: r.message, b0 }));
  // the typed boxes being left filled must not matter for a saved card
  t = mk({ on: true }); await t.reg.memberCardAddComplete(addBody()); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id, card: { cardNo: MC, expiration: '01/31', cvv: '111' } });
  rec('Charge saved card: a typed card sent along is ignored (never sent)', r.ok && t.srv.begins.length === 1 && t.srv.begins[0].cardNo === '**** **** **** 4242', JSON.stringify(t.srv.begins[0]));
  // other channel
  t = mk({ on: true }); t.srv.cards.m1 = [{ id: 'mc-other', cardType: 'Visa', lastFourDigits: '1111', validityPeriod: '01/30', usableForCurrentChannel: false }];
  await t.reg.recalc(); await t.reg.startPay(); r = await t.reg.tender({ type: 30, amount: 10, savedCardId: 'mc-other' });
  rec('Charge: a card saved under another payment channel is refused, nothing charged', !r.ok && t.srv.begins.length === 0, r.message);
  // waiting + poll
  t = mk({ on: true }); await t.reg.memberCardAddComplete(addBody()); t.srv.wait = true; await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id });
  rec('Charge (Sola still processing): payment stays open and is polled (ReceiveCheck), not finished yet', r.ok && r.waiting && t.reg.pay.card && t.reg.pay.card.status === 'waiting' && t.srv.completes === 0, JSON.stringify(r));
  const r2 = await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id });
  rec('Double charge blocked: a second Pay while the first is open is refused, ONE ReceiveBegin', !r2.ok && t.srv.begins.length === 1, r2.message);
  const j1 = JSON.parse(fs.readFileSync(path.join(t.dir, 'journal', 'current.json'), 'utf8'));
  rec('Journal knows the Sola payment is open (card-waiting) and holds no card number', j1.pay && j1.pay.card && j1.pay.card.status === 'waiting' && !JSON.stringify(j1).includes(VISA), j1.step || j1.reason || '');
  Object.values(t.srv.rcv).flat().forEach(x => { x.status = 20; }); await sleep(1600);
  rec('Charge: once AIR POS says done, the sale completes (one charge)', t.srv.completes === 1 && t.srv.begins.length === 1 && (!t.reg.pay || (t.reg.pay.result && t.reg.pay.result.ok)), JSON.stringify(t.reg.pay && t.reg.pay.result && t.reg.pay.result.message));
  t.reg.stopCardPoll();
  // lost reply on ReceiveBegin (charged) -> adopted, not sent again
  t = mk({ on: true }); await t.reg.memberCardAddComplete(addBody()); t.srv.faults.push({ name: 'rbegin', mode: 'lost' }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id });
  rec('Lost ReceiveBegin reply (AIR POS charged): checked and adopted, NOT sent again; sale completes', r.ok && t.srv.begins.length === 1 && t.srv.completes === 1, JSON.stringify({ ok: r.ok, m: r.message }));
  // lost reply while Sola still processing -> keeps checking, never cancels
  t = mk({ on: true }); await t.reg.memberCardAddComplete(addBody()); t.srv.wait = true; t.srv.faults.push({ name: 'rbegin', mode: 'lost' }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id });
  rec('Lost ReceiveBegin reply (Sola still processing): keeps checking the SAME payment, never cancels it', t.srv.cancels.length === 0 && t.reg.pay.card && t.reg.pay.card.status === 'waiting' && t.srv.begins.length === 1, JSON.stringify({ ok: r.ok, m: r.message, cancels: t.srv.cancels.length }));
  t.reg.stopCardPoll();
  // never arrived -> absent -> Retry charges once
  t = mk({ on: true }); await t.reg.memberCardAddComplete(addBody()); t.srv.faults.push({ name: 'rbegin', mode: 'down' }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id });
  const rr = await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id });
  rec('ReceiveBegin never arrived: "nothing was charged", Retry charges exactly once', !r.ok && /nothing was charged/i.test(r.message) && rr.ok && t.srv.begins.length === 1 && t.srv.completes === 1, r.message + ' / ' + rr.message);
  // typed (not saved) Sola card at checkout still works and is wiped
  t = mk({ on: true }); await t.reg.recalc(); await t.reg.startPay();
  const tb = { type: 30, amount: 10, card: { cardNo: VISA, expiration: '12/30', cvv: CVV } };
  r = await t.reg.tender(tb);
  rec('Typed Sola card at checkout (not saved): sent once inside ReceiveBegin, body wiped', r.ok && t.srv.begins.length === 1 && t.srv.begins[0].cardNo === VISA && !tb.card && t.srv.begins[0].retailMemberCardId == null, JSON.stringify({ ok: r.ok, last4: String(t.srv.begins[0] && t.srv.begins[0].cardNo).slice(-4) }));

  // ---- 4: restart mid-charge ----
  let srv = mkSrv(); t = mk({ on: true, srv }); await t.reg.memberCardAddComplete(addBody()); srv.wait = true; await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: srv.cards.m1[0].id }); t.reg.stopCardPoll();
  let t2 = mk({ srv, dir: t.dir }); t2.reg.settings.solaCards = { 'fake corp|shop1': true }; t2.reg.subs = []; t2.reg.member = null;
  let rv = await t2.reg.recover();
  rec('Restart mid-charge (Sola processing): sale back, the SAME payment is checked, not cancelled, not sent again', rv && rv.ok && /still open with AIR POS/.test(rv.notice) && t2.reg.pay && t2.reg.pay.card && t2.reg.pay.card.status === 'waiting' && srv.cancels.length === 0 && srv.begins.length === 1, rv && rv.notice);
  const r3 = await t2.reg.tender({ type: 30, amount: 10, savedCardId: srv.cards.m1[0].id });
  rec('Restart mid-charge: paying again is blocked while it is open', !r3.ok && srv.begins.length === 1, r3.message);
  Object.values(srv.rcv).flat().forEach(x => { x.status = 20; }); await sleep(1600);
  rec('Restart mid-charge: AIR POS finishes it -> sale completes, customer charged once', srv.completes === 1 && srv.begins.length === 1, JSON.stringify(t2.reg.pay && t2.reg.pay.result && t2.reg.pay.result.message));
  t2.reg.stopCardPoll();
  // closed while ReceiveBegin was being sent (journal has only the pending submit)
  srv = mkSrv(); t = mk({ on: true, srv }); await t.reg.memberCardAddComplete(addBody()); srv.wait = true; await t.reg.recalc(); await t.reg.startPay();
  const cid2 = srv.cards.m1[0].id; const origRB = t.reg.api.receiveBegin; t.reg.api.receiveBegin = async s => { await origRB(s); return new Promise(() => {}); }; // AIR POS got it, the app "dies" waiting
  t.reg.tender({ type: 30, amount: 10, savedCardId: cid2 }); await sleep(200);
  t2 = mk({ srv, dir: t.dir }); t2.reg.settings.solaCards = { 'fake corp|shop1': true }; t2.reg.subs = []; t2.reg.member = null;
  rv = await t2.reg.recover();
  rec('Restart during ReceiveBegin (Sola): the open payment is found and kept checking (never cancelled / re-sent)', rv && rv.ok && t2.reg.pay && t2.reg.pay.card && t2.reg.pay.card.status === 'waiting' && srv.cancels.length === 0 && srv.begins.length === 1, rv && rv.notice);
  Object.values(srv.rcv).flat().forEach(x => { x.status = 20; }); await sleep(1600);
  rec('... and completes with one charge', srv.completes === 1 && srv.begins.length === 1, '');
  t2.reg.stopCardPoll();

  // ---- 5: refund (receipt return of a Sola card payment: AIR POS refunds the card itself, same as Stripe / terminal) ----
  t = mk({ on: true });
  const rets = {}; t.reg.api.returnGet = async id => ({ success: true, value: { id, number: 'RO' + id, status: 10, payments: [{ paymentType: 30, amount: 10, status: 20, refundStatus: 20 }] } });
  t.reg.api.returnRetry = async () => ({ success: true }); t.reg.cardCheckDelays = [0, 1, 1];
  t.reg.ret = { kind: 'receipt', id: 'ret-sola-1', order: { number: 'S100' } }; t.reg.mode = 'return';
  r = await t.reg.returnDone({ payments: [{ paymentType: 30, name: 'Online Payment', amount: 10 }] }, [{ paymentType: 30, name: 'Online Payment', amount: 10 }]);
  rec('Refund: a receipt return of a Sola Online payment is refunded by AIR POS (original route) and checked, no card data needed', r.ok && r.card && /refund/i.test(r.message) && !/card machine/.test(r.message), r.message);

  // ---- 6: delete ----
  t = mk({ on: true }); await t.reg.memberCardAddComplete(addBody()); const did = t.srv.cards.m1[0].id;
  r = await t.reg.memberCardDelete('m1', did);
  rec('Delete: removes the Sola card in AIR POS (retailMemberId + cardId)', r.ok && t.srv.deletes[0].cardId === did && t.srv.cards.m1.length === 0, r.message);

  // ---- 7: card data never kept ----
  t = mk({ on: true }); t.srv.faults.push({ name: 'complete', mode: 'lost' }); await t.reg.memberCardAddComplete(addBody()); await t.reg.memberCardAddComplete(addBody(MC, '03/31'));
  await t.reg.recalc(); await t.reg.startPay(); await t.reg.tender({ type: 30, amount: 10, savedCardId: t.srv.cards.m1[0].id });
  const st = JSON.stringify(t.reg.state ? t.reg.state() : {}) + JSON.stringify(t.reg.pay || {}) + JSON.stringify(t.reg.lastSale || {}) + JSON.stringify(t.reg.cofPending || {});
  rec('Secrets: no card number / CVV in app state, pay data or pending notes', !st.includes(VISA) && !st.includes(MC) && !st.includes('"' + CVV + '"'), 'state scanned');
  rec('Secrets: no card number / CVV in any file written (journal, settings, logs)', !grepDir(t.dir, VISA) && !grepDir(t.dir, MC) && !grepDir(t.dir, '4242 4242'), 'data dir scanned');
  rec('Secrets: no card number / CVV / expiry in the log', !t.logs.join('\n').includes(VISA) && !t.logs.join('\n').includes(MC) && !/\b987\b/.test(t.logs.join('\n')), t.logs.length + ' log lines');

  // ---- 8: Stripe regression ----
  t = mk({ stripe: true });
  k = t.reg.keyedInfo();
  rec('Stripe: unchanged: enabled, kind stripe, no setting needed', k.enabled && k.kind === 'stripe' && k.test === true, JSON.stringify(k));
  r = await t.reg.memberCardAddBegin('m1');
  rec('Stripe: add-begin still gives the SetupIntent client secret', r.ok && r.clientSecret === 'seti_x_secret_DONOTLOG', '');
  r = await t.reg.memberCardAddComplete(addBody());
  rec('Stripe: a typed card is refused (Stripe box only), AddComplete not called', !r.ok && count(t.srv, 'complete') === 0 && /Stripe/.test(r.message), r.message);
  t.srv.log = [];
  r = await t.reg.memberCardAddComplete({ id: 'm1', setupIntentId: 'seti_x', holderName: 'A', billAddress: 'B', zipCode: 'C' });
  const sa = (t.srv.adds || []).pop() || {};
  rec('Stripe: add-complete as before (list, ONE AddComplete with the SetupIntent id and blank card fields, no AddBegin)', r.ok && t.srv.log.join() === 'select,complete' && sa.setupIntentId === 'seti_x' && !sa.full && !sa.cvvSet && sa.exp === '', t.srv.log.join() + ' ' + r.message);
  t.srv.cards.m1 = [{ id: 'mc-visa', cardType: 'Visa', lastFourDigits: '4242', validityPeriod: '12/28', usableForCurrentChannel: true }];
  await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, savedCardId: 'mc-visa', card: { cardNo: VISA, expiration: '12/30', cvv: CVV } });
  b0 = t.srv.begins[0] || {};
  rec('Stripe: saved-card charge unchanged (card id + masked card)', r.ok && b0.retailMemberCardId === 'mc-visa' && b0.cardNo === '**** **** **** 4242', JSON.stringify(b0));
  t = mk({ stripe: true }); t.reg.setSolaCards(true);
  rec('Stripe: the Sola switch has no effect on a Stripe store', t.reg.keyedInfo().kind === 'stripe', '');
  t = mk({ stripe: true }); await t.reg.recalc(); await t.reg.startPay();
  r = await t.reg.tender({ type: 30, amount: 10, card: { cardNo: VISA, expiration: '12/30', cvv: CVV } });
  rec('Stripe: typed card at checkout still ignored (Stripe form only)', t.srv.begins[0] && t.srv.begins[0].cardNo === '', JSON.stringify(t.srv.begins[0]));

  const bad = out.filter(x => !x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'sola-cof-109-results.json'), JSON.stringify(out, null, 2));
  console.log(`${out.length - bad}/${out.length} passed`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

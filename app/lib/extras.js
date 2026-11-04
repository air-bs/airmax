// Air Register 1.1 extras, mixed into Register: keyed cards (Stripe), customers, gift card sale/reload/lookup,
// Put Aside, price check, sale notes, drawer log. Kept apart from register.js so the AIR POS-mirroring core stays readable.
'use strict';
const fs = require('fs');
const path = require('path');
const { newGuid } = require('./airpos');
const { testPagePdf } = require('./hardware');

const EMPTY = '00000000-0000-0000-0000-000000000000';
const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const money = n => '$' + round(n).toFixed(2);
const val = r => (r && typeof r === 'object' && 'success' in r && 'value' in r ? r.value : r);
const msgOf = r => (r && ((r.value && typeof r.value === 'object' && r.value.message) || r.message)) || '';
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
const SubType = { GiftCardSales: 30, GiftCardRecharge: 40 };
const Online = 30, Stripe = 10;
const GIFT_MAX = 50; // gift card lines in one sale (1.2.0: several cards per sale)
const maskCard = n => { n = String(n || ''); return n.length > 4 ? '**** ' + n.slice(-4) : n; };

function readJson(p, d) { try { if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} return d; }
function writeJson(p, v) { if (!p) return; const t = p + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, p); }
const memberName = m => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || m.number;
// ESC/POS text block (Latin-1, no control chars from the user) printed after the receipt
function escposText(lines) {
  const clean = s => String(s).replace(/[^\x20-\x7e\u00a0-\u00ff]/g, ' ');
  const body = lines.map(clean).join('\n');
  return Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from(body + '\n\n\n\n', 'latin1'), Buffer.from([0x1d, 0x56, 0x42, 0x00])]).toString('base64');
}
const wrap = (s, w = 42) => { const out = []; String(s).split(/\r?\n/).forEach(par => { let line = ''; par.split(/\s+/).forEach(word => { if ((line + ' ' + word).trim().length > w) { if (line) out.push(line); line = word; } else line = (line + ' ' + word).trim(); }); out.push(line); }); return out; };

const Extras = {
  dataFile(name) { return this.dataDir ? path.join(this.dataDir, name) : null; },
  who() { const id = this.identity || {}; return { company: id.corpName || '', shop: id.shopName || '', user: id.userName || '' }; },

  // ---------------- keyed card (Stripe Elements) ----------------
  // OnlineCreditCardConfirmer: RetailReceiveChannelGet(OnlinePayment) -> { channelType, secretKey (publishable key) }
  async loadKeyed() {
    this.keyedCh = { channelType: 0, key: '' };
    try { const v = val(await this.api.receiveChannelGet(Online)) || {}; this.keyedCh = { channelType: v.channelType || 0, key: typeof v.secretKey === 'string' ? v.secretKey : '' }; } catch {}
  },
  keyedInfo() {
    const c = this.keyedCh || { channelType: 0, key: '' };
    const stripe = c.channelType === Stripe && /^pk_(test|live)_/.test(c.key);
    // Owner 3:57 PM: Manual Credit = AIR POS "Online Payment" (type 30), done the way AIR POS's OnlineCreditCardConfirmer does it:
    // Stripe channel (10) -> Stripe's own card form + client_secret; Sola channel (20) -> card number / MM/YY / CVV typed on screen
    // and sent ONCE inside RetailOrderReceiveBegin's creditCard (AIR POS CreditCardForm). Air Register never stores or logs them.
    // 1.2.3 (owner 4:18 PM: ship only what is confirmed): the Sola card form is NOT verified against a real AIR POS / Sola store,
    // so it stays switched OFF and a Sola store gets the 1.2.1 message. Only tests set solaKeyedOn = true.
    // sola109+ AirMax 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31, local only): a manager turns typed cards + cards on file on // sola109+
    // per store (Settings > Cards, off by default). solaKeyedOn stays a test-only override. // sola109+
    const sola = c.channelType === 20 && (this.solaKeyedOn === true || this.solaCardsOn()); // sola109~
    return { enabled: stripe || sola, kind: stripe ? 'stripe' : sola ? 'sola' : '', channelType: c.channelType, test: stripe && c.key.startsWith('pk_test_'),
      note: stripe || sola ? '' : c.channelType === 0 ? 'No online/keyed card channel is set up in AIR POS back office.' : c.channelType === 20 ? 'This store uses the Sola channel for keyed cards. Typed cards and cards on file for Sola are off on this register (until then Air Max only supports Stripe). A manager can turn them on in Settings > Cards.' : 'Keyed card channel is not usable.' }; // sola109~
  },
  // sola109+ per-store switch, saved in settings.solaCards by "company|shop" (the same key as the customer screen messages) // sola109+
  solaShopKey() { const c = String((this.identity || {}).corpName || '').trim().toLowerCase(), s = String((this.api && this.api.shop) || '').trim().toLowerCase(); return s ? c + '|' + s : ''; }, // sola109+
  solaCardsOn() { const k = this.solaShopKey(), m = (this.settings && this.settings.solaCards) || {}; return !!(k && m[k] === true); }, // sola109+
  solaCardsInfo() { return { ok: true, on: this.solaCardsOn(), sola: (this.keyedCh || {}).channelType === 20, channelType: (this.keyedCh || {}).channelType || 0, shop: (this.identity || {}).shopName || '', manager: this.isManager() }; }, // sola109+
  setSolaCards(on) { // sola109+
    if (!this.isManager()) return fail('Only a manager can change "Typed cards and cards on file for Sola stores"'); // sola109+
    const k = this.solaShopKey(); if (!k) return fail('Log in to the store first'); // sola109+
    if (this.pay && this.pay.card) return fail('A card payment is open. Finish or cancel it first.'); // sola109+
    const m = { ...((this.settings && this.settings.solaCards) || {}) }; if (on === true) m[k] = true; else delete m[k]; this.settings.solaCards = m; // sola109+
    try { if (this.settingsPath) fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2)); } catch (e) { return fail('Could not save settings: ' + e.message); } // sola109+
    this.log('SETTINGS Sola cards ' + (on === true ? 'ON' : 'OFF') + ' for this store'); // sola109+
    return { ...this.solaCardsInfo(), message: on === true ? 'Typed cards and cards on file are on for this Sola store' : 'Typed cards and cards on file are off for this store' }; // sola109+
  }, // sola109+
  keyedKey() { const k = this.keyedInfo(); return k.enabled ? { ok: true, key: this.keyedCh.key, test: k.test } : fail(k.note); },
  async keyedConfirmed() {
    const c = this.pay && this.pay.card; if (!c || c.kind !== 'keyed' || c.status !== 'keyed') return fail('No keyed card waiting');
    c.status = 'waiting'; c.message = 'Card accepted by Stripe. Waiting for AIR POS to record it…'; c.startedAt = Date.now(); c.accepted = true; // mny109d~ Stripe took the money: Cancel card is refused from now on // mny109d~
    this.pollCard(); return { ok: true, waiting: true, message: c.message };
  }, // mny109d+
  // mny109d+ keyed card: ask AIR POS before a cancel. Recorded -> take it as paid (returns the result); unknown -> refuse; not recorded -> null. // mny109d+
  async keyedVerify(c) { // mny109d+
    const done = { ok: true, alreadyPaid: true, message: 'AIR POS already recorded this card payment, so it was not cancelled.' }; // mny109d+
    const st = c.status; this.stopCardPoll(); // mny109d+ live TestShop: the background check and this one must not both finish the sale // mny109d+
    if (st === 'approved' || !this.pay || this.pay.card !== c) return { ...done, ...((this.pay && this.pay.result) || {}), ok: true }; // mny109d+
    const r = await this.api.receiveCheck(c.submit); const v = (r && r.value) || {}; // mny109d+
    if (!this.pay || this.pay.card !== c || c.status === 'approved') return { ...done, ...((this.pay && this.pay.result) || {}), ok: true }; // mny109d+
    if (r && r.success && v.isCompleted) { c.status = 'approved'; c.message = 'Card approved'; c.subMessage = ''; const t = this.pay.tenders.find(x => x.id === c.tenderId); if (t) t.status = 'done'; const res = await this.afterTender(t); if (this.pay) { this.pay.result = res; if (this.pay.card === c && !res.completed) { this.pay.card = null; this.journalSnap('card-approved'); } } return { ...res, ok: res.ok !== false, alreadyPaid: true, message: 'AIR POS already recorded this card payment, so it was not cancelled. ' + (res.message || '') }; } // mny109d+ // scf1010~
    if (!r || r.unreachable || r.uncertain || r.loggedOut || (c.accepted && r.success === false)) { if (c.status === 'waiting') this.pollCard(); return fail('Air Max could not check this card payment with AIR POS, so it was not cancelled (the card may have been charged). Wait a moment and try again.', { retryable: true }); } // mny109d+ // ls9n~
    return null; // mny109d+
  },
  // local.9 (Stress Tester local.7 M3, seed 6601013): Stripe accepted a keyed card, AIR POS still has no record after 2 minutes // ls9k+
  // and Cancel card was refused for ever (no way out). The cashier confirmed the Stripe dashboard shows no charge (or refunded // ls9k+
  // it there); keyedVerify has just had a CLEAR "not recorded" answer from AIR POS. AIR POS is told to cancel the payment; // ls9k+
  // only when it agrees is the card taken off the sale. Refused / unclear: the payment stays open and is still checked. // ls9k+
  async keyedRelease(c) { // ls9k+
    const amt = (c.submit && c.submit.amount) || 0, secs = Math.round((Date.now() - c.startedAt) / 1000); // ls9k+
    this.log(`KEYED RELEASE: keyed card ${money(amt)} accepted by Stripe ${secs} s ago, AIR POS has no record; cashier confirmed release (checked Stripe)`); // ls9k+
    const r = await this.api.receiveCancel(c.submit); // ls9k+
    if (!r || r.success === false || r.unreachable || r.uncertain || r.loggedOut) { // ls9k+
      this.log('KEYED RELEASE refused / unclear: ' + (msgOf(r) || 'no reply')); if (this.pay && this.pay.card === c && !this.cardTimer) this.pollCard(); // ls9k+
      return fail(`AIR POS did not confirm the release (${msgOf(r) || 'no clear reply'}), so this card payment stays open and Air Max keeps checking it. Try again in a moment.`, { retryable: true, keyedAccepted: true }); // ls9k+
    } // ls9k+
    this.pay.tenders = this.pay.tenders.filter(t => t.id !== c.tenderId); this.pay.card = null; // ls9k+
    return { ok: true, released: true, message: `Keyed card ${money(amt)} released: AIR POS has no record of it, so it is not on this sale. If the Stripe dashboard shows a charge for it, refund it there. Choose another way to pay.` }; // ls9k+
  }, // ls9k+
  async keyedFailed(message) {
    const c = this.pay && this.pay.card; if (!c || c.kind !== 'keyed') return fail('No keyed card payment open');
    this.stopCardPoll();
    const v = await this.keyedVerify(c); if (v) return v; // mny109d+ verify with AIR POS first: never cancel a payment it already recorded // mny109d+
    const r = await this.api.receiveCancel(c.submit);
    this.pay.tenders = this.pay.tenders.filter(t => t.id !== c.tenderId); this.pay.card = null;
    const why = String(message || 'cancelled').slice(0, 200);
    return fail('Card not charged: ' + why + (r && r.success === false ? ' (server cancel said: ' + msgOf(r) + ')' : ''), { keyedFailed: true });
  },

  // ---------------- customers ----------------
  // AIR POS member list only filters by name / mobile; we also match member number and e-mail.
  async findMembers(keyword) {
    const q = String(keyword || '').trim();
    const rowsOf = r => (r && r.rows) || (val(r) && val(r).rows) || [];
    const map = new Map(); const add = m => { if (m && m.id && !map.has(m.id)) map.set(m.id, m); };
    const shopP = this.pointByShop(); shopP.catch(() => {}); // search speed: the shop-points setting is read WHILE the customers are searched (it was read after) // su1011+
    if (!q) { rowsOf(await this.api.memberPaged({ mobile: '', name: '', status: null }, 1, 30)).forEach(add); }
    else if (q.includes('@')) {
      const needle = q.toLowerCase();
      for (let page = 1; page <= 10; page++) {
        const r = await this.api.memberPaged({ mobile: '', name: '', status: null }, page, 100); const rows = rowsOf(r);
        rows.filter(m => String(m.email || '').toLowerCase().includes(needle)).forEach(add);
        if (rows.length < 100) break;
      }
    } else {
      const digits = q.replace(/\D/g, '');
      const calls = [this.api.memberPaged({ mobile: '', name: q, status: null }, 1, 30)];
      if (digits.length >= 3) calls.push(this.api.memberPaged({ mobile: digits, name: '', status: null }, 1, 30));
      const exact = this.api.memberGetByNumber(q.replace(/[^\w]/g, '') || q);
      const res = await Promise.all([exact, ...calls]);
      const ex = val(res[0]); if (ex && ex.id) add(ex);
      res.slice(1).forEach(r => rowsOf(r).forEach(add));
    }
    const shop = await shopP; // the same read, started above // su1011~
    const rows = [...map.values()].slice(0, 50).map(m => ({ id: m.id, number: m.number, name: memberName(m), mobile: m.mobile || m.phone || '', email: m.email || '', points: (shop ? m.shopPoint : m.point ?? m.points) ?? 0, balance: (shop ? m.shopBalance : m.balance) ?? 0, status: m.statusName || '' })); // mny109e+
    return { ok: true, rows, message: rows.length ? '' : `No customer matches "${q}"` };
  },
  async memberDetails(id) {
    const r = await this.api.memberGet(id); const m = val(r);
    if (!m || !m.id) return fail(msgOf(r) || 'Customer not found');
    return { ok: true, member: { id: m.id, number: m.number, firstName: m.firstName, lastName: m.lastName, mobile: m.mobile, email: m.email, address: m.address, zipCode: m.zipCode, remark: m.remark,
      ...this.memberMoney(m, await this.pointByShop()), status: m.statusName, createTime: m.createTime } }; // mny109e~
  },
  // 1.0.9-local.2 (e): AccountDetailsDrawer / MemberManage: when the shop keeps points per shop (RetailConfig pointSetting.pointByShop) // mny109e+
  // the customer's store credit, points and credit limit are the shop* fields; balance/point are then the other (corp) figures // mny109e+
  memberMoney(m, shop) { // mny109e+
    return shop ? { points: m.shopPoint, balance: m.shopBalance, creditAmount: m.shopCreditAmount, allowCreditPayment: m.shopAllowCreditPayment } // mny109e+
      : { points: m.point, balance: m.balance, creditAmount: m.creditAmount, allowCreditPayment: m.allowCreditPayment }; // mny109e+
  }, // mny109e+
  async pointByShop() { // mny109e+
    let p = this.retailCfg().pointSetting; // mny109e+
    if (!p && this.home) { const rc = val(await this.api.retailConfigGet()); p = rc && rc.pointSetting; if (p) this.home.retailConfig = { ...this.retailCfg(), pointSetting: p }; } // mny109e+
    return !!(p && p.pointByShop); // mny109e+
  }, // mny109e+
  // MemberSaveDrawer executeMemberUpdate: send the whole record back with the edited fields
  async updateMember(b = {}) {
    const r = await this.api.memberGet(b.id); const m = val(r);
    if (!m || !m.id) return fail(msgOf(r) || 'Customer not found');
    const pick = k => (typeof b[k] === 'string' ? b[k].trim() : m[k]);
    const firstName = pick('firstName'), lastName = pick('lastName'), mobile = pick('mobile');
    if (!firstName || !lastName || !mobile) return fail('First name, last name and phone are required');
    const email = pick('email'); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That e-mail address does not look right');
    // request M (owner): the customer number follows the phone (AIR POS rule: number = phone without punctuation).
    // A changed number is checked first with MemberNumberValidate (passing this member's id), like the AIR POS form.
    const number = String(mobile).replace(/[^\w]/g, '');
    if (!number) return fail('The phone needs at least one digit');
    if (number !== m.number) { const dup = await this.memberNumberTaken(number, m.id, mobile); if (dup) return dup; }
    const submit = { id: m.id, number, mobile, phone: m.phone, firstName, middleName: m.middleName, lastName, company: m.company, email, receiveAutoEmail: m.receiveAutoEmail,
      province: m.province, city: m.city, address: pick('address'), zipCode: pick('zipCode'), discount: m.discount, remark: pick('remark'), status: m.status, creditAmount: m.creditAmount, allowCreditPayment: m.allowCreditPayment };
    const u = await this.api.memberUpdate(submit);
    if (!u || !u.success) { const dup = number !== m.number ? await this.memberNumberTaken(number, m.id, mobile, u) : null; return dup || fail('Could not save the customer: ' + msgOf(u)); }
    if (this.member && this.member.id === m.id && !this.locked()) await this.attachMember(number);
    return { ok: true, message: `Saved ${firstName} ${lastName}` + (number !== m.number ? ` (customer # is now ${number})` : ''), number, numberChanged: number !== m.number };
  },
  // request M: null when the number is free; otherwise a clear failure naming the customer who already has that phone
  async memberNumberTaken(number, id, mobile, failed) {
    let v = failed; if (!v) { try { v = await this.api.memberNumberValidate(number, id); } catch (e) { return { ok: false, message: `Could not check the phone with AIR POS (${(e && e.message) || e}). Nothing was saved.` }; } }
    if (v && v.success) return null;
    const ex = val(await this.api.memberGetByNumber(number).catch(() => null));
    const existing = ex && ex.id && ex.id !== id ? { id: ex.id, number: ex.number, name: memberName(ex) } : null;
    if (!existing && failed) return null; // the save failed for another reason
    if (existing) return { ok: false, duplicate: true, existing, message: `The phone ${mobile} is already used by ${existing.name || 'another customer'} (customer # ${number}). Nothing was saved.` };
    return { ok: false, message: `AIR POS did not accept customer # ${number}: ${msgOf(v) || 'no answer'}. Nothing was saved.` };
  },
  async memberOrders(number) {
    number = String(number || (this.member && this.member.number) || '').trim(); if (!number) return fail('Choose a customer first');
    const r = await this.api.orderPaged({ number: null, productNumber: null, memberNumber: number, orderDate: null }, 1, 30);
    const rows = ((r && r.rows) || []).map(o => ({ id: o.id, number: o.number, status: o.status, statusName: o.statusName, paymentTypeName: o.paymentTypeName, quantity: o.quantity, quantityReturn: o.quantityReturn, amount: o.amount, amountReturn: o.amountReturn, createTime: o.createTime || o.orderTime }));
    return { ok: true, rows, total: (r && r.total) || rows.length };
  },

  // ---------------- gift cards ----------------
  async giftLookup(number) {
    number = String(number || '').trim(); if (!number) return fail('Scan or type the gift card number');
    const r = await this.api.giftCardGet(number); const c = val(r);
    if (!c || !c.id) return fail(msgOf(r) || `Gift card ${number} is not in AIR POS`, { notFound: true });
    const card = { id: c.id, number: c.cardNo || number, isSold: !!c.isSold, balance: round(c.isSold ? c.balance : c.faceValue), faceValue: c.faceValue, used: c.consumedAmount,
      expired: !!c.expired, expireDate: c.expireDate, member: c.retailMemberName || c.retailMemberNumber || '', soldOn: c.retailOrderNumber || '' };
    return { ok: true, card, message: `Gift card ${card.number}: ${card.isSold ? 'balance ' + money(card.balance) : 'not sold yet (value ' + money(card.faceValue) + ')'}${card.expired ? ' — EXPIRED' : ''}` };
  },
  async giftCards(keyword) { const r = await this.api.giftCardSelect(keyword || ''); const l = val(r); return { ok: Array.isArray(l), rows: (Array.isArray(l) ? l : []).slice(0, 40).map(c => ({ id: c.id, number: c.cardNo, isSold: c.isSold, balance: c.isSold ? c.balance : c.faceValue, expired: c.expired })) }; },
  // GiftCardAddDialog: unsold card -> sale line (type 30), sold card -> recharge line (type 40), unknown number -> RetailGiftCardAdd then sale line
  async addGiftLine(b = {}) {
    const g = this.guardCart(); if (g) return g;
    if (this.mode === 'return') return fail('Gift cards are sold in sale mode');
    const number = String(b.number || '').replace(/[\x00-\x1f\x7f]/g, '').trim(); if (!number) return fail('Scan or type the gift card number');
    if (this.giftLines().length >= GIFT_MAX) return fail(`Up to ${GIFT_MAX} gift cards in one sale. Finish this sale, then start another.`);
    const amount = round(Number(b.amount) || 0); const pay = b.pay == null || b.pay === '' ? amount : round(Number(b.pay));
    if (this.giftLines().some(s => String(s.number).toLowerCase() === number.toLowerCase())) return fail(`Gift card ${maskCard(number)} is already on this sale (each card can be on a sale once)`, { duplicate: true });
    let r = await this.api.giftCardGet(number); let c = val(r);
    if (r && (r.unreachable || r.uncertain)) return fail('Could not check gift card ' + maskCard(number) + ' with AIR POS. Nothing was added. Try again.', { retryable: true }); // never treat "no reply" as "new card" // mny109k+
    let sub;
    const base = { id: newGuid(), retailOrderId: this.order.id, productId: EMPTY, quantity: 1, quantityTotal: 1, quantityReturn: 0, taxNotSet: true, taxRate: 0, costPrice: 0, discountMethod: 10, discountAmount: 0,
      description: '', number, name: 'Gift Card ' + maskCard(number), unit: 1, unitName: 'pcs', rate: 1, timestamp: Date.now() };
    if (c && c.id && c.expired) return fail(`Gift card ${number} is expired`);
    if (c && c.id && c.isSold) {
      if (!(amount > 0)) return fail('Enter the amount to load onto the card');
      if (!(pay >= 0) || pay > amount) return fail('The customer pays between $0 and the amount loaded');
      sub = { ...base, itemId: c.id, type: SubType.GiftCardRecharge, price: amount, discount: amount > 0 ? round(100 * (1 - pay / amount), 2) : 0, categoryName: 'Gift Card Recharge' };
    } else {
      let face;
      if (c && c.id) { face = round(c.faceValue || 0); if (!(face > 0)) face = amount; if (!(face > 0)) return fail('Enter the amount'); } // a card with no preset value takes the amount typed
      else {
        if (!(amount > 0)) return fail('Enter the value of the new gift card');
        const submit = { id: newGuid(), cardNo: number, faceValue: amount, issueDate: new Date().toISOString(), expireDate: null, retailMemberId: this.member ? this.member.id : null };
        const a = await this.api.giftCardAdd(submit); // mny109k~
        if (!a || !a.success) { const c2 = val(await this.api.giftCardGet(number).catch(() => null)); // lost reply / "already exists": the card is there now // mny109k+
          if (c2 && c2.id && !b._again) return this.addGiftLine({ ...b, _again: true }); // add it as the card it is (new sale or reload) // mny109k+
          return fail('Could not create the gift card in AIR POS: ' + msgOf(a)); } // mny109k+
        c = { id: submit.id, cardNo: number, faceValue: amount }; face = amount;
      }
      const price = b.pay == null || b.pay === '' ? face : pay;
      if (!(price >= 0)) return fail('Enter what the customer pays');
      sub = { ...base, itemId: c.id, type: SubType.GiftCardSales, price, oriPrice: face, discount: 0, categoryName: 'Gift Card Sales' };
    }
    this.subs.splice(0, 0, sub); await this.recalc();
    return { ok: true, gift: { number, masked: maskCard(number), kind: sub.type === SubType.GiftCardRecharge ? 'reload' : 'sale', value: round(sub.type === SubType.GiftCardRecharge ? sub.price : sub.oriPrice), pays: round(this.lineAmount(sub) - (sub.discountAmount || 0)), count: this.giftLines().length }, message: sub.type === SubType.GiftCardRecharge ? `Reload ${money(sub.price)} onto gift card ${number} added` : `Gift card ${number} (${money(sub.oriPrice)}) added — it is activated when the sale completes` };
  },

  // 1.2.0: several gift cards in one sale. Each line is one card (own number + amount); AIR POS activates / loads them all on Complete.
  giftLines() { return this.subs.filter(s => s.type === SubType.GiftCardSales || s.type === SubType.GiftCardRecharge); },
  giftSummary() { return this.giftLines().slice().reverse().map(s => ({ masked: maskCard(s.number), kind: s.type === SubType.GiftCardRecharge ? 'reload' : 'sale', value: round(s.type === SubType.GiftCardRecharge ? s.price : (s.oriPrice ?? s.price)), pays: round(this.lineAmount(s) - (s.discountAmount || 0)) })); },
  giftsAll() { return readJson(this.dataFile('gift-slips.json'), {}); },
  saveGiftsFor(orderId, list, used) {
    list = list || []; used = used || []; if (!orderId || (!list.length && !used.length)) return; const all = this.giftsAll(); all[orderId] = { at: new Date().toISOString(), cards: list, used }; // masked numbers only
    const keys = Object.keys(all); if (keys.length > 2000) keys.sort((a, b) => (all[a].at < all[b].at ? -1 : 1)).slice(0, keys.length - 2000).forEach(k => delete all[k]);
    try { writeJson(this.dataFile('gift-slips.json'), all); } catch (e) { this.log('gift slip save failed: ' + e.message); }
  },
  // Request O (owner): after Complete, read each gift card's balance from AIR POS (sold, reloaded and used to pay) and keep it
  // with the slip (masked numbers + balances only). A failed look-up prints "balance: check at the counter", never a guess.
  async giftBalances(orderId, sold, used) {
    const all = this.giftsAll(), g = all[orderId]; if (!g) return null;
    const look = async n => { if (!n) return null; const c = val(await this.api.giftCardGet(n).catch(() => null)); return c && typeof c.balance === 'number' ? round(c.balance) : null; };
    const sb = await Promise.all((sold || []).map(look)), ub = await Promise.all((used || []).map(u => look(u.number)));
    (g.cards || []).forEach((c, i) => { c.balance = sb[i] ?? null; }); (g.used || []).forEach((c, i) => { c.balance = ub[i] ?? null; });
    g.balancesAt = new Date().toISOString(); all[orderId] = g;
    try { writeJson(this.dataFile('gift-slips.json'), all); } catch (e) { this.log('gift slip save failed: ' + e.message); }
    return g;
  },
  giftSlipLines(orderId) {
    const g = this.giftsAll()[orderId]; const cards = (g && g.cards) || [], used = (g && g.used) || []; if (!cards.length && !used.length) return null;
    const w = 42, row = (l, r) => l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r;
    const bal = c => (typeof c.balance === 'number' ? money(c.balance) : 'check at counter');
    const out = [];
    if (cards.length) out.push(`GIFT CARDS (${cards.length})`, ...cards.flatMap(c => [row(`${c.masked} ${c.kind === 'reload' ? 'reload' : 'new'}`, money(c.value)), row('  Balance now', bal(c))]), row('Total value', money(cards.reduce((a, c) => a + c.value, 0))));
    if (used.length) { if (out.length) out.push(''); out.push(`GIFT CARDS USED (${used.length})`, ...used.flatMap(c => [row(`${c.masked} paid`, c.used == null ? '' : money(c.used)), row('  Balance left', bal(c))])); }
    return out;
  },
  async printGiftSlip(orderId) {
    // gc19+
    if (this.giftStampedOn && this.giftStampedOn(orderId)) return null; // #19 print only: the receipt just printed already shows these gift cards (last 4 + balance), so no separate slip; not stamped = the slip as before
    // gc19-
    const lines = this.giftSlipLines(orderId); if (!lines) return null;
    if (this.printSlip) return this.printSlip(lines, 'Gift card list printed');
    return this.hwDo('Gift card list printed', () => this.hw.raw(escposText(lines), this.printerName()), () => this.api.printBillContent({ billBase64: testPagePdf(lines) }, this.printerName()));
  },

  // ---------------- Put Aside (local park on this PC) ----------------
  asideAll() { return readJson(this.dataFile('aside.json'), []); },
  asideList() { const w = this.who(); return { ok: true, rows: this.asideAll().filter(a => a.company === w.company && a.shop === w.shop).map(a => ({ id: a.id, at: a.at, user: a.user, lines: a.subs.length, due: a.due, member: a.memberName || '', note: a.note || '' })) }; },
  putAside() {
    if (!this.subs.length) return fail('The cart is empty');
    if (this.locked()) return fail('Payment has started; finish it first.');
    if (this.order.resuming) return fail('This is a held order from the server; use Hold for it.');
    const w = this.who();
    const list = this.asideAll();
    list.push({ id: newGuid(), at: new Date().toISOString(), ...w, due: this.totals.due, order: { ...this.order }, subs: this.subs, memberNumber: this.member ? this.member.number : null, memberName: this.member ? this.member.name : null, note: this.order.note || '' });
    try { writeJson(this.dataFile('aside.json'), list); } catch (e) { return fail('Could not save on this PC: ' + e.message); }
    const n = this.subs.length; this.resetOrder();
    return { ok: true, message: `Put aside (${n} line${n === 1 ? '' : 's'}). Load Aside brings it back, even after a restart.` };
  },
  async loadAside(id) {
    if (this.subs.length || this.locked()) return fail('Finish or put aside the current sale first');
    const w = this.who(); const list = this.asideAll();
    const i = list.findIndex(a => a.id === id && a.company === w.company && a.shop === w.shop) ; if (i < 0) return fail('That parked sale is gone');
    const a = list[i];
    this.resetOrder();
    const keep = ['discountConfigSubId', 'orderDiscountMethod', 'orderDiscount', 'orderDiscountAmount', 'discount', 'discountName', 'discountRemark', 'discountTaxFree', 'discountCustomerType', 'promotionalCode', 'note'];
    keep.forEach(k => { if (a.order && k in a.order) this.order[k] = a.order[k]; });
    this.subs = a.subs.map(s => ({ ...s, retailOrderId: this.order.id }));
    if (a.memberNumber) await this.attachMember(a.memberNumber);
    await this.recalc();
    list.splice(i, 1); try { writeJson(this.dataFile('aside.json'), list); } catch {}
    return { ok: true, message: `Loaded parked sale (${a.subs.length} lines, ${money(this.totals.due)})` };
  },
  asideDelete(id) { const list = this.asideAll(); const i = list.findIndex(a => a.id === id); if (i < 0) return fail('Not found'); list.splice(i, 1); writeJson(this.dataFile('aside.json'), list); return { ok: true, message: 'Parked sale deleted' }; },

  // ---------------- price check (nothing added to the cart) ----------------
  async priceCheck(code) {
    code = String(code || '').trim(); if (!code) return fail('Scan or type an item');
    const r = await this.api.scan(code); const s = val(r);
    if (!s || !s.productId || s.productId === EMPTY) {
      const pp = await this.api.productPaged(code, 1, 10); const rows = (pp && pp.rows) || [];
      if (!rows.length) return fail(msgOf(r) || `Nothing found for "${code}"`);
      const top = rows.slice(0, 8); const priced = await Promise.all(top.map(p => this.api.scan(p.number).then(x => val(x)).catch(() => null))); // list rows carry no shop price; the scan has it
      return { ok: true, list: top.map((p, i) => ({ number: p.number, upc: p.upc, name: p.name, price: priced[i] && priced[i].productId === p.id ? priced[i].price : (priced[i] && priced[i].price) ?? null, stock: p.quantityStock })) };
    }
    let stock = null; const pp = await this.api.productPaged(s.number, 1, 5); const p = ((pp && pp.rows) || []).find(x => x.id === s.productId || x.number === s.number); if (p) stock = p.quantityStock;
    return { ok: true, item: { number: s.number, upc: s.upc, name: s.name, price: s.price, originalPrice: s.originalPrice, bulkPrice: s.bulkPrice, bulkPriceQuantity: s.bulkPriceQuantity, taxRate: s.taxNotSet ? null : s.taxRate, unitName: s.unitName, stock } };
  },

  // ---------------- sale note (local; AIR POS orders have no general note field) ----------------
  setNote(text) {
    if (this.mode !== 'sale') return fail('Notes are for sales');
    this.order.note = String(text || '').slice(0, 300).trim();
    return { ok: true, message: this.order.note ? 'Note added — it prints under the receipt' : 'Note removed' };
  },
  // ---------------- gift receipt (1.2.x, owner request) ----------------
  // AIR POS 1.9.11 has no gift-receipt option of its own: only the store's bill templates (RetailBillTemplateConfigGet).
  // "Add Gift Receipt" marks THIS sale (by order id, so a new sale is never marked); when the sale completes, the
  // store's own AIR POS template whose name contains "gift" is printed as well. Air Register never builds receipt
  // content or touches money: no gift template in AIR POS = nothing extra prints and the cashier is told why.
  setGiftReceipt(on) {
    if (this.mode !== 'sale') return fail('Gift receipts are for sales');
    this.giftReceiptFor = on ? this.order.id : null;
    return { ok: true, message: on ? 'Gift receipt added: it prints with this sale (no prices)' : 'Gift receipt removed' };
  },
  giftReceiptOn() { return !!this.giftReceiptFor && this.giftReceiptFor === this.order.id; },
  async printGiftReceipt(orderId) {
    const cfg = (this.templateList && this.templateList(orderId)) || (this.templateConfig ? await this.templateConfig(orderId) : val(await this.api.billTemplateConfigGet(orderId)) || {}); // P: the receipt's call just loaded the list
    const tpl = (cfg.templates || []).find(t => /gift/i.test(t.name || ''));
    if (!tpl) return fail('Gift receipt not printed: AIR POS has no gift receipt template. Ask AIR POS to add a bill template named "Gift Receipt" without prices.', { noTemplate: true });
    const r = await this.printOrderCore(orderId, { templateIds: [tpl.id] });
    if (r && r.ok) r.message = `Gift receipt printed (${tpl.name})`; else if (r) r.message = 'Gift receipt not printed: ' + r.message;
    return r;
  },
  // airmax-fix-12+
  // Fix #12 (card brand + last 4 after the receipt). The receipt itself is AIR POS's PDF (its template prints the payment line, AirMax
  // cannot change it), so AirMax prints a small slip right after it, like the sale note and the gift card list. Only real data: a card
  // on file's AIR POS cardType + lastFourDigits. Card machine (AIR POS ReceiveCheck gives no card data) and typed cards (Stripe: the
  // number never reaches AirMax; Sola: wiped after the request, brand unknown) get no slip. Print only: no payment, total or API call.
  cardSlipLabel(k) {
    const last4 = String((k && k.last4) || '').replace(/\D/g, ''); if (last4.length !== 4) return null;
    const b = String((k && k.brand) || '').trim(); const brand = b && b.toLowerCase() !== 'card' ? b.toUpperCase().slice(0, 20) : 'CARD ON FILE';
    return brand + ' ****' + last4;
  },
  cardSlipsAll() { return readJson(this.dataFile('card-slips.json'), {}); },
  saveCardSlipFor(orderId, cards) {
    if (!orderId || !Array.isArray(cards) || !cards.length) return; const all = this.cardSlipsAll(); all[orderId] = { cards, at: new Date().toISOString() };
    const keys = Object.keys(all); if (keys.length > 2000) keys.sort((a, b) => (all[a].at < all[b].at ? -1 : 1)).slice(0, keys.length - 2000).forEach(x => delete all[x]);
    try { writeJson(this.dataFile('card-slips.json'), all); } catch (e) { this.log('card slip save failed: ' + e.message); }
  },
  cardSlipLines(orderId) {
    const g = this.cardSlipsAll()[orderId]; const cards = (g && g.cards) || []; if (!cards.length) return null;
    const w = 42, row = (l, r) => l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r;
    return ['CARD PAYMENT', ...cards.map(c => row(String(c.label), money(c.amount)))];
  },
  async printCardSlip(orderId) {
    const lines = this.cardSlipLines(orderId); if (!lines) return null;
    if (this.printSlip) return this.printSlip(lines, 'Card slip printed');
    return this.hwDo('Card slip printed', () => this.hw.raw(escposText(lines), this.printerName()), () => this.api.printBillContent({ billBase64: testPagePdf(lines) }, this.printerName()));
  },
  // airmax-fix-12-
  notesAll() { return readJson(this.dataFile('notes.json'), {}); },
  saveNoteFor(orderId, note) {
    if (!orderId) return; const all = this.notesAll();
    if (note) all[orderId] = { note, at: new Date().toISOString(), user: this.who().user }; else delete all[orderId];
    const keys = Object.keys(all); if (keys.length > 2000) keys.sort((a, b) => (all[a].at < all[b].at ? -1 : 1)).slice(0, keys.length - 2000).forEach(k => delete all[k]);
    try { writeJson(this.dataFile('notes.json'), all); } catch (e) { this.log('note save failed: ' + e.message); }
  },
  noteFor(orderId) { const n = this.notesAll()[orderId]; return n ? n.note : ''; },
  async printNote(orderId) {
    const note = this.noteFor(orderId); if (!note) return null;
    const lines = ['NOTE:', ...wrap(note)];
    // built-in helper: raw ESC/POS slip; AIR POS service mode (or no helper): the same text as a small 80 mm PDF through PrintBillContent
    if (this.printSlip) return this.printSlip(lines, 'Note printed'); // printing.js: right commands for Epson / generic / Star
    return this.hwDo('Note printed', () => this.hw.raw(escposText(lines), this.printerName()), () => this.api.printBillContent({ billBase64: testPagePdf(lines) }, this.printerName()));
  },

  // receipt first (AIR POS server bill), then the local sale note as a short slip
  // Request P / L risk: pressing Reprint (P) while the background print of the same sale is still running used to print twice.
  async printOrder(orderId, choice) {
    const id = orderId || this.lastOrderId; this._printing = this._printing || new Map();
    const busy = id && this._printing.get(id);
    if (busy && Date.now() - busy.at < 45000) return { ok: true, already: true, message: 'Already printing this receipt' }; // a stuck print stops blocking reprints after 45 s
    const p = this.printOrderOnce(orderId, choice); const mark = { p, at: Date.now() }; if (id) this._printing.set(id, mark);
    try { return await p; } finally { if (id && this._printing.get(id) === mark) this._printing.delete(id); }
  },
  async printOrderOnce(orderId, choice) {
    const r = await this.printOrderCore(orderId, choice);
    if (r && r.ok) { const n = await this.printNote(orderId || this.lastOrderId); if (n) { r.note = n; r.message = (r.message || '') + (n.ok ? ' + note printed' : ' — ' + n.message); } }
    if (r && r.ok) { const gs = await this.printGiftSlip(orderId || this.lastOrderId); if (gs) { r.giftSlip = gs; r.message = (r.message || '') + (gs.ok ? ' + gift card list printed' : ' — ' + gs.message); } }
    // airmax-fix-12+
    if (r && r.ok) { const cs = await this.printCardSlip(orderId || this.lastOrderId); if (cs) { r.cardSlip = cs; r.message = (r.message || '') + (cs.ok ? ' + card slip printed' : ' — ' + cs.message); } }
    // airmax-fix-12-
    return r;
  },
  async drawer(ordering = false, managerPassword) {
    const r = await this.drawerCore(ordering, managerPassword);
    if (!(r && r.needPassword)) this.logDrawer(ordering ? 'sale' : 'no sale', r);
    return r;
  },
  // ---------------- drawer log (AIR POS has no API for drawer / no-sale events) ----------------
  logDrawer(reason, r) {
    const p = this.dataFile('drawer-log.json'); const list = readJson(p, []);
    list.push({ at: new Date().toISOString(), user: this.who().user, shop: this.who().shop, reason, ok: !!(r && r.ok), message: r && r.message ? String(r.message).slice(0, 120) : '' });
    try { writeJson(p, list.slice(-1000)); } catch {}
  },
  drawerLog() { const w = this.who(); const day = new Date().toDateString(); const rows = readJson(this.dataFile('drawer-log.json'), []).filter(x => x.shop === w.shop && new Date(x.at).toDateString() === day).reverse(); return { ok: true, rows, noSale: rows.filter(x => x.reason === 'no sale' && x.ok).length }; },
};

module.exports = { Extras, escposText };

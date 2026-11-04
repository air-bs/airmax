// Register state machine: one sale at a time. Server rules follow AIR POS 1.9.11 (OrderCheckout,
// order.ts, payment confirmers) so reports, inventory and card deposits stay correct; the flow and
// hardware layer are our own (built-in printing/drawer, one-screen tenders, background card polling).
'use strict';
const fs = require('fs');
const path = require('path');
const { AirPos, newGuid } = require('./airpos');
const { Hardware, testPagePdf } = require('./hardware');
const { Journal } = require('./journal');

const PaymentType = { Cash: 10, MemberAccount: 11, CreditCard: 20, Online: 30, GiftCard: 40, Check: 50, Combination: 99 };
const PayName = { 10: 'Cash', 11: 'Store credit', 20: 'Card', 30: 'Keyed card', 40: 'Gift card', 50: 'Check', 99: 'Split' };
const ReturnSort = [PaymentType.MemberAccount, PaymentType.GiftCard, PaymentType.Cash, PaymentType.CreditCard, PaymentType.Online, PaymentType.Check];
const DiscountMethod = { Percentage: 10, Amount: 20 };
const OrderStatus = { Canceled: -10, Void: -5, New: 10, Pending: 15, Paid: 17, Completed: 20 };
const SessionType = { NeedClockIn: 0, AtWork: 10, NeedForcedClockOut: 20 };
const SubType = { Normal: 0, Temporary: 10, ExtraCharge: 20, GiftCardSales: 30, GiftCardRecharge: 40 };
const CashTxn = { Deposit: 20, Withdraw: 30 };
const EMPTY = '00000000-0000-0000-0000-000000000000';
const ReceiveCompleted = 20;
// AIR POS card polling schedule (order.ts PAYMENT_CHECK_*)
const POLL = { fast: 500, slow: 1000, idle: 2000, fastFor: 60000, warnAfter: 120000 }; // #1/#7 receipt right after card approval (Gordon OK Nov 3): every 0.5 s for the first 60 s (was 10 s); read-only checks // rcp1011~
// local.9 (Stress Tester local.7 M3, seed 6601013): a keyed card has no terminal; Stripe took it, AIR POS has not recorded it // ls9k+
const KEYED_SLOW = 'Stripe accepted this keyed card, but AIR POS has not recorded it after 2 minutes. Do not take the card again: Air Max keeps checking. If it still does not show, look the payment up in the Stripe dashboard. Only if Stripe shows no charge (or you refunded it there), press Cancel card and confirm to release it.'; // ls9k+
const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
const money = n => '$' + round(n).toFixed(2);
const STALE_MSG = "Couldn't check the total with AIR POS. Nothing was charged. Check the connection, then press Payment again.";
const SHORT_RE = /received amount is less than|less than the amount due/i;
// commonUtils.getUnitPrice
const unitPrice = (q, bq, p, bp) => (bq > 0 && bp > 0 && q >= bq ? bp : p);
// F4 New price: what the line should cost at the typed price per item, in whole cents (399 c x 1.5 lb = 598.5 -> 599 c = $5.99) // f4m1011+
const f4Target = s => Math.round(Math.round(Number(s.f4NewPrice) * 100) * s.quantity * (s.rate || 1)) / 100; // f4m1011+
const val = r => (r && typeof r === 'object' && 'success' in r && 'value' in r ? r.value : r);
const msgOf = r => (r && ((r.value && typeof r.value === 'object' && r.value.message) || r.message)) || '';
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_QTY = 9999, MAX_PRICE = 99999.99, MAX_TENDER = 100000;
// printer/drawer after a sale must never hold the sale screen: the sale is already final on the server
const capHw = (p, ms, what) => Promise.race([Promise.resolve(p).catch(e => fail(what + ' failed: ' + e.message, { hw: 'error' })),
  sleep(ms).then(() => fail(/drawer/i.test(what) ? `${what} did not answer in ${Math.round(ms / 1000)} s. The sale is saved; press Open Drawer (Ctrl+D) or check the printer.` : `${what} did not answer in ${Math.round(ms / 1000)} s. The sale is saved; reprint from History once the printer is back.`, { hw: 'timeout' }))]);
const DRAWER_SALE_MS = 10 * 60 * 1000; // the done screen's Open Drawer counts as part of the sale for 10 minutes
const BULK_MAX = 12;
// bf105 begin: AirMax 1.0.5 bulk item folders (same data shape as AirRegister; see airpos-look-backups/bulk-folders-for-coach.md)
const BULK_TOP_MAX = 24, BULK_FOLDER_MAX = 24, BULK_FOLDER_ITEMS = 24, BULK_FOLDER_NAME = 20;
// bf105 end
// scanner suffix/prefix variants (CR, LF, Tab, STX/ETX, GS) and stray spaces
// Sola keyed card (Online Payment): checks AIR POS's CreditCardForm makes (required, MM/YY, not expired) + a digit/Luhn check.
function keyedCardError(c) {
  if (!c) return 'Type the card number, expiry (MM/YY) and CVV.';
  const no = String(c.cardNo || '').replace(/[\s-]/g, ''), ex = String(c.expiration || '').trim(), cvv = String(c.cvv || '').trim();
  if (!/^\d{12,19}$/.test(no)) return 'Card number should be 12-19 digits.';
  let sum = 0; for (let i = 0; i < no.length; i++) { let d = Number(no[no.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  if (sum % 10) return 'Card number is not valid (check the digits).';
  const m = /^(\d{2})\/(\d{2})$/.exec(ex); if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return 'The expiry format should be MM/YY.';
  const now = new Date(), y = 2000 + Number(m[2]); if (y < now.getFullYear() || (y === now.getFullYear() && Number(m[1]) < now.getMonth() + 1)) return 'Card has expired.';
  if (!/^\d{3,4}$/.test(cvv)) return 'CVV should be 3 or 4 digits.';
  return '';
}
function wipeCard(b) { if (b && b.card) { b.card.cardNo = b.card.cvv = b.card.expiration = ''; delete b.card; } }
const maskNo = n => { n = String(n || ''); return n.length > 4 ? '**** ' + n.slice(-4) : n; }; // gift card numbers: last 4 only on disk / paper
const cleanCode = c => String(c == null ? '' : c).replace(/[\x00-\x1f\x7f]/g, ' ').trim().replace(/\s{2,}/g, ' ').slice(0, 64);

function friendlyComplete(m) {
  m = String(m || 'no reply');
  if (/insufficient inventory/i.test(m)) return 'not enough stock for an item in this sale (' + m + '). AIR POS itself refuses to sell below zero stock. Add stock for that item in AIR POS back office (Inventory), then press Finish sale: the payment is kept.';
  return m + '.';
}
class Register {
  constructor({ blockedCompanies = [], log, appDir, dataDir } = {}) {
    this.blocked = blockedCompanies.map(c => c.trim().toLowerCase());
    this.log = log || console.log;
    this.api = new AirPos({ log: this.log });
    this.hw = new Hardware({ appDir, log: this.log });
    this.journal = new Journal(dataDir, this.log);
    this.recoveryPending = false; this.notice = null;
    this.dataDir = dataDir || null;
    this.settingsPath = dataDir ? path.join(dataDir, 'settings.json') : null;
    this.settings = this.loadSettings();
    this.hwStatus = { via: null, message: '' };
    this.preview = null; // last report PDF for the in-app preview window
    this.clearSession();
  }

  // ---------------- local settings (printer / drawer) ----------------
  loadSettings() {
    const d = { printerName: '', drawerKind: 'escpos', hardware: 'auto', drawerOnlyForCash: true, refundTaxNoReceipt: true, returnToAccount: true,
      touchKeyboard: 'keypad', fullScreen: false, registerMode: false, exitPinEnabled: false, scanSound: true };
    try { if (this.settingsPath && fs.existsSync(this.settingsPath)) return { ...d, ...JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) }; } catch (e) { this.log('settings read failed: ' + e.message); }
    return d;
  }
  saveSettings(b = {}) {
    const s = this.settings;
    const bf = (b.bulkItems !== undefined || b.bulkFolders !== undefined || b.bulkOrder !== undefined) ? this.checkBulk(b) : null; if (bf && bf.error) return fail(bf.error); // bf105+ whole bulk save checked first: nothing changes if any part is bad
    if (typeof b.printerName === 'string') s.printerName = b.printerName.trim();
    if (['escpos', 'star', 'both'].includes(b.drawerKind)) s.drawerKind = b.drawerKind;
    if (['auto', 'builtin', 'airpos'].includes(b.hardware)) s.hardware = b.hardware;
    if (typeof b.drawerOnlyForCash === 'boolean') s.drawerOnlyForCash = b.drawerOnlyForCash;
    if (b.bulkItems !== undefined) { const e = this.saveBulkItems(b.bulkItems); if (e) return e; }
    if (bf) { s.bulkFolders = bf.folders; s.bulkOrder = bf.order; } // bf105+
    if (typeof b.refundTaxNoReceipt === 'boolean' && b.refundTaxNoReceipt !== s.refundTaxNoReceipt) {
      if (!this.isManager()) return fail('Only a manager can change "Refund tax on returns without a receipt"');
      s.refundTaxNoReceipt = b.refundTaxNoReceipt;
    }
    if (typeof b.returnToAccount === 'boolean' && b.returnToAccount !== (s.returnToAccount !== false)) { // Return to Account: on by default, manager only
      if (!this.isManager()) return fail('Only a manager can change "Return to Account"');
      s.returnToAccount = b.returnToAccount;
    }
    if (typeof b.scanSound === 'boolean' && b.scanSound !== (s.scanSound !== false)) { // scan sounds: on by default, manager only
      if (!this.isManager()) return fail('Only a manager can change scan sounds');
      s.scanSound = b.scanSound;
    }
    if (this.savePrinterSettings) this.savePrinterSettings(b); // printer type / connection / options (printing.js)
    const k = this.kioskSettings(b, s); if (k) return k;
    try { if (this.settingsPath) fs.writeFileSync(this.settingsPath, JSON.stringify(s, null, 2)); } catch (e) { return fail('Could not save settings: ' + e.message); }
    return { ok: true, message: 'Settings saved', settings: this.state ? this.state().settings : s };
  }

  clearSession() {
    this.identity = null; this.home = null; this.session = null; this.discountConfig = { subs: [] };
    this.mode = 'login'; // login | clockin | sale | return
    this.recoveryPending = false;
    this.resetOrder(); this.resetReturn(); this.lastOrderId = null; this.lastReturnId = null;
    this.cardRefunds = []; this.cardOther = []; this.cardLoaded = null; // waiting card refunds (cardrefund.js); reloaded from disk per company
  }
  // order.ts resetOrderData + member.ts resetMemberData
  resetOrder() {
    this.stopCardPoll();
    this._logoutOk = 0; // a logout OK belongs to one sale: finish, new sale, hold, void and recovery all start over here // lgo1011+
    this._recalcTok = (this._recalcTok || 0) + 1; this._recalcP = null; // a total check still out for the sale before is ignored // add1011+
    this.order = {
      id: newGuid(), discountConfigSubId: null, orderDiscountMethod: DiscountMethod.Percentage, orderDiscount: 0, orderDiscountAmount: 0,
      discount: 0, discountName: '', discountRemark: '', receiveAmount: 0, giveAmount: 0, discountTaxFree: false, discountCustomerType: 0,
      paymentType: PaymentType.Cash, currency: this.identity ? this.identity.currency : 2, retailMemberId: null, promotionalCode: null, resuming: false,
    };
    this.subs = []; this.promotionSubs = [];
    this.member = null; this.usingPoints = 0;
    this.totals = { itemAmount: 0, orderAmount: 0, tax: 0, discountAmount: 0, discountRate: 0, promotionDiscount: 0, pointDiscount: 0, due: 0, quantity: 0 };
    this.pay = null; this.completed = null;
  }
  resetReturn() { this.ret = { id: newGuid(), kind: null, order: null, subs: [] }; }
  // a recovery notice about a restored sale goes away once that sale is no longer the current sale (completed, new sale, cleared…)
  currentNotice() { if (this.notice && this.notice.orderId && this.notice.orderId !== this.order.id) this.notice = null; return this.notice; }

  isManager() { return !!(this.identity && (this.identity.superAdmin || (this.home && (this.home.authorities || []).includes('RetailManager')))); }
  term() { return (this.home && this.home.terminalConfig) || {}; }
  retailCfg() { return (this.home && this.home.retailConfig) || {}; }
  basic() { return this.retailCfg().basicSetting || {}; }
  locked() { return !!(this.pay && (this.pay.tenders.some(t => t.status === 'done' || t.status === 'waiting') || (this.pay.card && this.pay.card.status === 'keyed'))); }

  // ---------------- login / logout ----------------
  async login(company, user, password) {
    company = String(company || '').trim(); user = String(user || '').trim();
    if (!company || !user || !password) return fail('Enter company, user and password.');
    if (this.blocked.includes(company.toLowerCase().replace(/\s+/g, ' '))) {
      this.log(`LOGIN refused for blocked company (dev build)`);
      return fail(`Company "${company}" is blocked in this dev build (live store).`);
    }
    await this.deviceInfo(); // device headers, same values AIR POS sends (station binding)
    const r = await this.api.login(company, user, password);
    if (!r || !r.success) return fail((r && r.message) || 'Login failed', r && r.unreachable ? { retryable: true } : {});
    this.recoveryPending = true;
    this.identity = r.value; this.resetOrder();
    const h = await this.api.homeIndex(); this.home = h && !('success' in h && !h.success) ? h : null;
    const [dc] = await Promise.all([this.api.discountConfigGet(), (async () => { if (!this.retailCfg().extraChargeSetting) { const rc = val(await this.api.retailConfigGet()); if (rc && this.home) this.home.retailConfig = { ...rc, ...this.retailCfg() }; } })(), this.checkSession(), this.loadKeyed()]); this.discountConfig = (val(dc) && val(dc).subs) ? val(dc) : { subs: [] }; // startup speed: after Home/Index (still first, as AIR POS does) the discount list, retail config, session check and card channel are read together (independent reads) // su1011~
    /* retail config: read together with the discount list above */ // su1011~
    /* session check: read together with the discount list above (sets this.mode before the recovery check below, as before) */ // su1011~
    /* card channel: read together with the discount list above */ // su1011~
    const rec = this.mode === 'sale' ? await this.recover() : null;
    if (this.printerInfo && this.hw && this.hw.present && this.settings.hardware !== 'airpos' && !this._prnInfo) { const w = setTimeout(() => this.printerInfo().catch(() => null), 1500); if (w.unref) w.unref(); } // spd1010+
    return { ok: true, message: `Logged in to ${this.identity.corpName} / ${this.identity.shopName} as ${this.identity.userName}`, recovery: rec };
  }
  logout() { // AIR POS Header.vue: identityUtils.removeIdentity() only; no server call
    if (this.pay && this.pay.card && (this.pay.card.status === 'waiting' || this.pay.card.status === 'keyed')) return fail('A card payment is open. Cancel it first.');
    const paidOpen = this.pay && (this.pay.tenders || []).filter(t => t.status === 'done').length; // payments taken, sale not finished (e.g. AIR POS refused Complete) // lgo1010+
    const lok = this._logoutOk; if (paidOpen && !(lok && lok.id === this.order.id && lok.pay === this.pay && Date.now() - lok.at < 30000)) { this._logoutOk = { at: Date.now(), id: this.order.id, pay: this.pay }; return fail(`Payments were already taken on this sale ($${this.paidTotal().toFixed(2)}) and it is not finished. Press Finish sale first. To log out anyway, press Log out again: the payments are kept and the sale comes back after you log in.`, { paidOpen: true }); } // lgo1011~
    this._logoutOk = 0; // lgo1010+
    this.api.reset(); this.clearSession();
    return { ok: true, message: 'Logged out (token wiped from memory).' };
  }
  async checkSession() {
    const s = await this.api.sessionCheck();
    this.session = s;
    this.mode = s && (s.type === SessionType.NeedClockIn || s.type === SessionType.NeedForcedClockOut) ? 'clockin' : 'sale';
    return s;
  }
  async clockIn(amount) {
    const a = round(Number(amount) || 0);
    let r = await this.api.clockIn(a); // mny109i~
    if (!r || !r.success) { const s0 = await this.api.sessionCheck(); // lost/bad reply or "already clocked in": ask AIR POS // mny109i+
      if (s0 && s0.type === SessionType.AtWork) { this.session = s0; r = { success: true, message: 'Clocked in (AIR POS already had this register clocked in).' }; } } // mny109i+
    if (r && r.success) { this.mode = 'sale'; await this.checkSession(); }
    const rec = r && r.success && this.mode === 'sale' ? await this.recover() : null;
    return { ok: !!(r && r.success), message: (r && r.message) || (r && r.success ? 'Clocked in' : 'Clock in failed'), recovery: rec };
  }
  async expectedClockOut() { const r = await this.api.latestBalanceGet(); return { ok: true, expected: Number(val(r)) || 0 }; }
  async clockOut(amount) {
    if (this.locked()) return fail('Finish or cancel the sale in progress first.');
    const r = await this.api.clockOut(round(Number(amount) || 0));
    if (r && r.success) { const m = r.message; this.api.reset(); this.clearSession(); return { ok: true, message: (m || 'Clocked out') + ' — logged out.' }; }
    const s0 = await this.api.sessionCheck(); // lost/bad reply: did AIR POS clock this register out anyway? // mny109i+
    if (s0 && s0.type === SessionType.NeedClockIn) { this.api.reset(); this.clearSession(); return { ok: true, message: 'Clocked out (AIR POS recorded it; the reply was lost) — logged out.' }; } // mny109i+
    if (!r || r.unreachable || r.uncertain || !(s0 && typeof s0.type === 'number')) return fail('No clear answer from AIR POS about the clock-out (' + (msgOf(r) || 'no reply') + '). Press Clock out again: Air Max checks first.', { retryable: true }); // mny109i+ // ls9n~
    return fail((r && r.message) || 'Clock out failed');
  }

  // ---------------- cart ----------------
  guardCart() { return this.locked() ? fail('Payment has started. Finish the payment (or cancel the waiting card) before changing the sale.') : null; }
  // Payment side panel (work copy): once money is taken, ONLY "add more" is allowed (scan an item, raise a quantity), so the
  // sale can never drop below what is already paid. Nothing while a card is waiting / the keyed form is open / a reply is unknown.
  guardGrow() {
    if (!this.locked()) return null; const p = this.pay, c = p.card;
    if ((c && (c.status === 'waiting' || c.status === 'keyed')) || p.pendingSubmit || p.tenders.some(t => t.status === 'waiting')) return fail('A card payment is open. Finish or cancel it first, then add items.');
    return null;
  }
  async scan(code) {
    const g = this.guardGrow(); if (g) return g; // side panel: adding an item after a partial payment is allowed
    code = cleanCode(code); if (!code) return fail('Nothing scanned');
    const r = await this.api.scan(code);
    if (!r || !r.success) return fail((r && r.message) || 'Item not found', r && r.unreachable ? { retryable: true } : {});
    const sub = r.value;
    const ex0 = this.subs.find(x => x.itemId === sub.itemId && !(x.type > 0));
    if (ex0 && ex0.quantity + 1 > MAX_QTY) return fail(`Quantity limit is ${MAX_QTY} per line`);
    const ex = this.subs.find(x => x.itemId === sub.itemId && !(x.type > 0));
    if (ex) { ex.quantity += 1; ex.quantityTotal = ex.quantity * ex.rate; ex.timestamp = Date.now(); this.applySubDiscount(ex); }
    else {
      sub.timestamp = Date.now(); sub.discountMethod = DiscountMethod.Percentage; sub.quantityTotal = sub.quantity * sub.rate;
      if (this.order.taxExempt) this.exemptSub(sub);
      this.applySubDiscount(sub); this.subs.splice(0, 0, sub);
    }
    if (this.fastScan && !this.pay) this.recalcLater(); else await this.recalc(); // line shown now, total checked in the background // add1011~
    return { ok: true, message: `Added ${sub.name}` };
  }
  configSub() { return (this.discountConfig.subs || []).find(x => x.id === this.order.discountConfigSubId) || null; }
  // order.ts setOrderSubDiscount
  applySubDiscount(sub) {
    if (sub.isCustomDiscount) { // OrderSubDiscountDialog keeps a custom % and recomputes the amount
      if (this.f4Price(sub) != null) { const a = this.lineAmount(sub), d = Math.max(0, round(a - f4Target(sub), 2)); sub.discountAmount = d; sub.discount = a > 0 ? d / a * 100 : 0; return; } // F4 New price (Gordon OK Nov 3): the typed price per item is kept when the qty changes, also across a multi-buy price point; never more than the line (no discount when the multi-buy price is already lower) // f4m1011+
      sub.discountAmount = round(this.lineAmount(sub) * (sub.discount || 0) / 100, 2); return;
    }
    const cfg = this.configSub(), up = unitPrice(sub.quantity * sub.rate, sub.bulkPriceQuantity, sub.price, sub.bulkPrice);
    if (cfg && cfg.discountBasedOnProducts) {
      if ((cfg.productBasedSubs || []).some(x => x.productId === sub.productId)) {
        sub.discount = cfg.rate; sub.discountMethod = DiscountMethod.Percentage; sub.discountName = cfg.name; sub.discountTaxFree = cfg.taxFree;
      } else { sub.discountName = ''; sub.discount = 0; sub.discountTaxFree = false; }
    } else {
      sub.discount = cfg ? cfg.rate : 0; sub.discountName = cfg ? cfg.name : ''; sub.discountMethod = DiscountMethod.Percentage; sub.discountTaxFree = cfg ? !!cfg.taxFree : false;
    }
    sub.discountAmount = round(up * sub.quantity * sub.rate * sub.discount / 100, 2);
  }
  lineAmount(sub) { return round(unitPrice(sub.quantity * sub.rate, sub.bulkPriceQuantity, sub.price, sub.bulkPrice) * sub.quantity * sub.rate, 2); }
  // F4 New price (Gordon OK Nov 3, 1.0.11): the typed price per item also lives on this PC in f4-prices.json (line id -> price and time; // f4m1011+
  // no customer data), so it survives Put Aside / Load Aside, Hold / Load Hold and a restart (the lines come back with the same ids). // f4m1011+
  // On the line it stays a hidden property, so the journal, aside.json and what goes to AIR POS never carry it. Entries go after 45 days. // f4m1011+
  f4File() { return this.dataDir ? path.join(this.dataDir, 'f4-prices.json') : null; } // f4m1011+
  f4All() { if (!this._f4) { let m = null; const f = this.f4File(); if (f) { try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { m = null; } } this._f4 = m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } return this._f4; } // f4m1011+
  f4Keep(sub, price) { // f4m1011+
    if (price == null) delete sub.f4NewPrice; else Object.defineProperty(sub, 'f4NewPrice', { value: price, writable: true, configurable: true, enumerable: false }); // f4m1011+
    const m = this.f4All(), id = sub.id; if (!id || (price == null && !(id in m))) return; // f4m1011+
    if (price == null) delete m[id]; else m[id] = { price, at: Date.now() }; // f4m1011+
    const old = Date.now() - 45 * 86400000; for (const k of Object.keys(m)) if (!(m[k] && m[k].at > old)) delete m[k]; // f4m1011+
    const f = this.f4File(); if (f) { try { fs.writeFileSync(f + '.tmp', JSON.stringify(m)); fs.renameSync(f + '.tmp', f); } catch (e) { this.log('F4 price not saved on this PC: ' + e.message); } } // f4m1011+
  } // f4m1011+
  f4Price(sub) { // the kept price; a rebuilt line (Load Aside, Load Hold, restart) gets it back from this PC by its id // f4m1011+
    if (sub.f4NewPrice != null) return sub.f4NewPrice; const e = sub.id ? this.f4All()[sub.id] : null; const v = e ? Number(e.price) : NaN; // f4m1011+
    if (!(Number.isFinite(v) && v >= 0)) return null; Object.defineProperty(sub, 'f4NewPrice', { value: v, writable: true, configurable: true, enumerable: false }); return v; // f4m1011+
  } // f4m1011+
  sorted() { return [...this.subs].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)); }
  lineAt(i) { const s = this.sorted(); if (i === 'last' || i == null) return s[0]; return s[Number(i)]; }
  async setQty(row, qty) {
    const g = this.guardGrow(); if (g) return g;
    const sub = this.lineAt(row); if (!sub) return fail('No line selected');
    if (sub.type === 30 || sub.type === 40) return fail('A gift card line is always quantity 1');
    qty = Number(String(qty == null ? '' : qty).trim()); if (!Number.isFinite(qty) || !(qty > 0)) return fail('Quantity must be more than 0 (use Delete to remove)');
    if (this.locked() && qty < sub.quantity) return fail(`${money(this.paidTotal())} is already paid: items can be added, but not lowered or removed. Finish the payment first.`); // side panel: never below what is paid
    if (qty > MAX_QTY) return fail(`Quantity ${qty} is too large (limit ${MAX_QTY}). Check the number.`);
    qty = round(qty, 3);
    sub.quantity = qty; sub.quantityTotal = qty * sub.rate; this.applySubDiscount(sub);
    await this.recalc(); return { ok: true, message: `${sub.name}: qty ${qty}` };
  }
  async addQty(row, d) { const sub = this.lineAt(row); if (!sub) return fail('No line selected'); return this.setQty(row, sub.quantity + d); }
  async remove(row) {
    const g = this.guardCart(); if (g) return g;
    const sub = this.lineAt(row); if (!sub) return fail('No line selected');
    this.subs.splice(this.subs.indexOf(sub), 1); await this.recalc(); return { ok: true, message: `Removed ${sub.name}` };
  }
  // OrderSubDiscountDialog: per-line discount by % or by amount; 'clear' returns to the predefined discount
  async lineDiscount(row, kind, value) {
    const g = this.guardCart(); if (g) return g;
    const sub = this.lineAt(row); if (!sub) return fail('No line selected');
    const amt = this.lineAmount(sub); value = Number(value) || 0;
    if (kind === 'price') { const per = sub.quantity * sub.rate, orig = per > 0 ? round(amt / per, 2) : 0, raw = arguments[2], np = round(Number(raw), 2); if (raw === '' || raw == null || !Number.isFinite(Number(raw))) return fail('Type the new price'); if (np < 0) return fail('The new price cannot be below $0.00'); if (np > orig + 0.004) return fail(`New price ${money(np)} is higher than the original ${money(orig)}. A new price can only lower the price.`); if (np >= orig - 0.004) { this.f4Keep(sub, null); if (sub.isCustomDiscount) { sub.isCustomDiscount = false; sub.discountMethod = DiscountMethod.Percentage; this.applySubDiscount(sub); await this.recalc(); } return { ok: true, message: `${sub.name}: same as the original price ${money(orig)}, no discount` }; } kind = 'amount'; value = Math.max(0, round(amt - f4Target({ f4NewPrice: np, quantity: sub.quantity, rate: sub.rate }), 2)); Object.defineProperty(sub, '_f4pending', { value: np, writable: true, configurable: true, enumerable: false }); } // New price (F4): discount = original - new, sent as the existing $-off line discount; item price never changed // f4m1011~
    if (kind === 'clear') { sub.isCustomDiscount = false; sub.discountMethod = DiscountMethod.Percentage; this.applySubDiscount(sub); }
    else {
      let pct;
      if (kind === 'amount') { if (value < 0 || value > amt) return fail(`Discount must be between $0 and ${money(amt)}`); pct = amt > 0 ? value / amt * 100 : 0; sub.discountMethod = DiscountMethod.Amount; }
      else { if (value < 0 || value > 100) return fail('Percent must be 0-100'); pct = value; sub.discountMethod = DiscountMethod.Percentage; }
      sub.isCustomDiscount = true; sub.discount = pct; sub.discountAmount = round(amt * pct / 100, 2);
    }
    if (sub._f4pending != null) { this.f4Keep(sub, sub._f4pending); delete sub._f4pending; } else this.f4Keep(sub, null); // F4 New price kept per item (also on this PC, see f4Keep; never sent to AIR POS); % off, $ off or Remove discount forget it // f4m1011+
    await this.recalc();
    return { ok: true, message: kind === 'clear' ? `${sub.name}: line discount cleared` : `${sub.name}: ${money(sub.discountAmount)} off` };
  }
  // OrderSubTaxDialog + OrderCheckout handleTaxUpdate
  async lineTax(row, rate) {
    const g = this.guardCart(); if (g) return g;
    const sub = this.lineAt(row); if (!sub) return fail('No line selected');
    rate = Number(rate); if (!(rate >= 0 && rate <= 100)) return fail('Tax rate must be 0-100');
    if (this.order.taxExempt) return fail('Tax Off is on for this sale. Press F5 to turn tax back on first.');
    if (sub.taxRate !== rate) sub.taxFree = false;
    sub.taxRate = rate; await this.recalc(); return { ok: true, message: `${sub.name}: tax ${rate}%` };
  }
  // Tax Off (F5): the whole sale tax-exempt (resale certificate, non-profit...). Same mechanism as AIR POS's per-line tax
  // dialog (taxRate 0 on each line), so the saved order, receipt and reports show no tax. Turning it off puts back
  // each line's own rate. New scans while it is on are added with no tax.
  exemptSub(sub) { if (sub._taxRate0 == null) sub._taxRate0 = Number(sub.taxRate) || 0; sub.taxRate = 0; }
  async setTaxExempt(on, b = {}) {
    const g = this.guardCart(); if (g) return g;
    if (this.mode === 'return') return fail('Tax Off is for sales');
    on = on == null ? !this.order.taxExempt : !!on;
    if (on && !this.order.taxExempt && !this.isManager()) { // AIR POS manager (RetailManager) only; a cashier needs a manager's login, same check as Restart PC
      if (!b.user && !b.password) return fail('Tax Off needs a manager. A manager logs in to approve it.', { needManager: true });
      const m = await this.managerCheck({ user: b.user, password: b.password }); // no exit PIN here
      if (!m.ok) return fail(m.message, { needManager: true });
      this.log('TAX OFF approved by manager login ' + String(b.user || '').trim());
    }
    if (on) this.subs.forEach(s => this.exemptSub(s));
    else this.subs.forEach(s => { if (s._taxRate0 != null) { if (s.taxRate !== s._taxRate0) s.taxFree = false; s.taxRate = s._taxRate0; delete s._taxRate0; } });
    this.order.taxExempt = on;
    await this.recalc();
    return { ok: true, taxExempt: on, message: on ? 'Tax Off: no tax on this sale (F5 turns tax back on)' : 'Tax back on for this sale' };
  }
  // Bulk items (side menu quick buttons, Settings): saved on this PC; each slot points at an existing AIR POS product.
  // Air Register never creates products.
  saveBulkItems(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const x of list.slice(0, BULK_MAX)) {
      if (!x || typeof x !== 'object') continue;
      const code = String(x.code || x.number || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 64);
      const label = String(x.label || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 30);
      if (!code && !label) continue;
      if (!code) return fail(`Bulk item "${label}": pick a product (search or scan it)`);
      out.push({ label: label || String(x.name || code).slice(0, 30), code, name: String(x.name || '').slice(0, 80), askPrice: !!x.askPrice });
    }
    this.settings.bulkItems = out; return null;
  }
  // bf105 begin: bulk item folders (AirMax 1.0.5). Saved on this PC next to bulkItems (which keeps its shape and its
  // 12-button limit). settings.bulkFolders = [{ id: 'f-…', name, items: [{ label, code, name, askPrice }] }],
  // settings.bulkOrder = ['i:0', 'f:f-…', …] = the top-level order (singles by bulkItems index, folders by id).
  // Top level: singles + folders <= 24. Items per folder <= 24. One level only. Products are never created here.
  cleanBulkList(list, max, where) {
    const out = [];
    for (const x of list) {
      if (!x || typeof x !== 'object') continue;
      if (x.items !== undefined) return { error: `${where}: folders inside folders are not allowed` };
      const code = String(x.code || x.number || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 64);
      const label = String(x.label || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 30);
      if (!code && !label) continue;
      if (!code) return { error: `Bulk item "${label}": pick a product (search or scan it)` };
      out.push({ label: label || String(x.name || code).slice(0, 30), code, name: String(x.name || '').slice(0, 80), askPrice: !!x.askPrice });
    }
    if (out.length > max) return { error: `${where} is full: up to ${max} items` };
    return { list: out };
  }
  // Checks bulkItems + bulkFolders + bulkOrder of one save together; returns { error } or the cleaned { folders, order }.
  checkBulk(b) {
    const s = this.settings;
    let items = s.bulkItems || [];
    if (b.bulkItems !== undefined) {
      if (!Array.isArray(b.bulkItems)) return { error: 'Bulk items: the list is not valid' };
      const c = this.cleanBulkList(b.bulkItems.slice(0, BULK_MAX), Infinity, 'Top level'); if (c.error) return c; items = c.list;
    }
    let raw = b.bulkFolders !== undefined ? b.bulkFolders : (s.bulkFolders || []);
    if (raw === null) raw = [];
    if (!Array.isArray(raw)) return { error: 'Bulk folders: the list is not valid' };
    if (raw.length > BULK_FOLDER_MAX) return { error: `Up to ${BULK_FOLDER_MAX} folders` };
    const folders = [], names = new Set(), ids = new Set();
    for (const f of raw) {
      if (!f || typeof f !== 'object') return { error: 'Bulk folders: a folder is not valid' };
      const name = String(f.name || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!name) return { error: 'Give every folder a name' };
      if (name.length > BULK_FOLDER_NAME) return { error: `Folder name "${name.slice(0, 24)}…" is too long (up to ${BULK_FOLDER_NAME} letters)` };
      if (names.has(name.toLowerCase())) return { error: `Two folders are called "${name}". Give each folder its own name.` };
      names.add(name.toLowerCase());
      if (f.items !== undefined && !Array.isArray(f.items)) return { error: `Folder ${name}: the item list is not valid` };
      const c = this.cleanBulkList(f.items || [], BULK_FOLDER_ITEMS, 'Folder ' + name); if (c.error) return c;
      let id = typeof f.id === 'string' && /^f-[A-Za-z0-9]{1,20}$/.test(f.id) ? f.id : '';
      while (!id || ids.has(id)) id = 'f-' + Math.random().toString(36).slice(2, 10);
      ids.add(id); folders.push({ id, name, items: c.list });
    }
    let order = b.bulkOrder !== undefined ? b.bulkOrder : s.bulkOrder;
    if (order != null && !Array.isArray(order)) return { error: 'Bulk order: the list is not valid' };
    order = this.bulkOrderOf({ bulkItems: items, bulkFolders: folders, bulkOrder: order });
    if (order.length > BULK_TOP_MAX) return { error: `Top level is full: up to ${BULK_TOP_MAX} spots (buttons and folders together). You have ${order.length}.` };
    return { folders, order };
  }
  // Clean list of folders for the screen (bad hand-edited entries are skipped, never a crash).
  bulkFoldersOf(st) {
    const out = [], ids = new Set();
    for (const f of Array.isArray(st.bulkFolders) ? st.bulkFolders : []) {
      if (!f || typeof f !== 'object' || typeof f.id !== 'string' || ids.has(f.id) || !String(f.name || '').trim()) continue;
      ids.add(f.id);
      out.push({ id: f.id, name: String(f.name).slice(0, BULK_FOLDER_NAME), items: (Array.isArray(f.items) ? f.items : []).filter(x => x && typeof x === 'object' && x.code).slice(0, BULK_FOLDER_ITEMS) });
      if (out.length >= BULK_FOLDER_MAX) break;
    }
    return out;
  }
  // Top-level order: unknown / duplicate refs dropped; missing ones added at the end (singles in bulkItems order, then folders).
  // No bulkOrder (old settings) = all singles then all folders, so an old file shows exactly as before.
  bulkOrderOf(st) {
    const n = Math.min((st.bulkItems || []).length, BULK_MAX), fids = this.bulkFoldersOf(st).map(f => f.id);
    const ok = new Set([...Array.from({ length: n }, (_, i) => 'i:' + i), ...fids.map(id => 'f:' + id)]), out = [];
    for (const r of Array.isArray(st.bulkOrder) ? st.bulkOrder : []) if (typeof r === 'string' && ok.has(r) && !out.includes(r)) out.push(r);
    for (const r of ok) if (!out.includes(r)) out.push(r);
    return out;
  }
  bulkFolderSlot(folder, i) {
    const f = this.bulkFoldersOf(this.settings).find(x => x.id === String(folder));
    return f ? f.items[Number(i)] : undefined;
  }
  // bf105 end
  // Add a bulk-item slot to the sale. With "ask price": the product is added and its line set to the typed price
  // (AIR POS has no free price change on a product, so a lower price is a line discount; a higher price is refused).
  async addBulk(i, price, folder) { // bf105~
    const g = this.guardCart(); if (g) return g;
    if (this.mode === 'return') return fail('Bulk items are for sales');
    const slot = folder != null ? this.bulkFolderSlot(folder, i) : (this.settings.bulkItems || [])[Number(i)]; if (!slot) return fail('That bulk item button is empty. Set it up in Settings (Ctrl+,) > Bulk items.'); // bf105~
    let want = null;
    if (slot.askPrice) {
      want = round(Number(price)); if (!Number.isFinite(want) || !(want > 0)) return fail('Enter the price for ' + slot.label, { needPrice: true });
      if (want > MAX_PRICE) return fail(`Price ${money(want)} is too large (limit ${money(MAX_PRICE)}). Check the number.`, { needPrice: true });
    }
    const before = this.subs.length;
    const r = await this.scan(slot.code); if (!r.ok) return fail(`${slot.label}: ${r.message}`, r.retryable ? { retryable: true } : {});
    if (want == null) return { ok: true, message: `Added ${slot.label}` };
    const sub = this.lineAt(0), amt = this.lineAmount(sub);
    if (this.subs.length === before && sub.quantity > 1) { // same product already on the sale: a typed price cannot share that line, so undo the +1
      await this.setQty(0, sub.quantity - 1);
      return fail(`${slot.label} is already on this sale. Remove that line first (or change its quantity / F4 line discount), then press ${slot.label} again.`);
    }
    if (want > amt + 0.004) { await this.remove(0); return fail(`${slot.label}: ${money(want)} is above the AIR POS price ${money(amt)}. Change the price in AIR POS back office, or use an Open Item (F7).`, { needPrice: true }); }
    if (want < amt - 0.004) { const d = await this.lineDiscount(0, 'amount', round(amt - want)); if (!d.ok) return d; }
    return { ok: true, message: `Added ${slot.label} ${money(want)}` };
  }
  // CheckoutMenu handleTemporaryItemAdd / handleExtraChargeItemAdd
  async addSpecial(kind, b = {}) {
    const g = this.guardCart(); if (g) return g;
    const price = round(Number(b.price) || 0), qty = Number(b.quantity) || 1;
    if (!Number.isFinite(price) || !(price > 0)) return fail('Enter a price above $0');
    if (price > MAX_PRICE) return fail(`Price ${money(price)} is too large (limit ${money(MAX_PRICE)}). Check the number.`);
    if (!Number.isFinite(qty) || !(qty > 0)) return fail('Quantity must be more than 0');
    if (qty > MAX_QTY) return fail(`Quantity is too large (limit ${MAX_QTY})`);
    let sub;
    const base = { id: newGuid(), retailOrderId: this.order.id, productId: EMPTY, quantity: qty, quantityTotal: qty, quantityReturn: 0, price, taxNotSet: true, taxRate: 0, costPrice: 0, discount: 0, discountAmount: 0, discountMethod: DiscountMethod.Percentage, description: '', unit: 1, unitName: 'pcs', rate: 1, timestamp: Date.now() };
    if (kind === 'temp') {
      const name = String(b.name || '').trim();
      sub = { ...base, itemId: EMPTY, type: SubType.Temporary, number: 'TEMP', name: name || 'Item', categoryName: 'Temporary' };
    } else {
      const list = this.retailCfg().extraChargeSetting || [];
      const item = list.find(x => x.id === b.chargeItemId); if (!item) return fail('Choose an extra charge (set them up in AIR POS back office)');
      sub = { ...base, itemId: item.id, type: SubType.ExtraCharge, number: item.name, name: item.name, categoryName: 'Extra Charge' };
    }
    if (kind === 'temp' && b.taxable !== false) { const t = await this.tempTax(); if (!t.ok) return t; sub.taxRate = t.kind.rate; sub.taxFree = false; sub.taxName = t.kind.name; } // tt1011+
    if (this.order.taxExempt) this.exemptSub(sub); // tt1011+
    this.subs.splice(0, 0, sub); await this.recalc();
    return { ok: true, message: `Added ${sub.name} ${money(price)}` };
  }
  // Temporary Item tax (Ari OK 6:26 PM ET Nov 1): Taxable (on by default) gives the temp line the store's sales tax rate from // tt1011+
  // AIR POS's own tax list (Commons/RetailTaxKindSelect), read fresh on every add, never typed in; AIR POS then works out the // tt1011+
  // tax like any taxed line (same field the AIR POS per-line Edit Tax sets). Which tax: the one a manager picked in Settings > // tt1011+
  // Returns (per company, this PC), else the only taxable one in AIR POS; if it can't tell, the add is refused (never guessed). // tt1011+
  async taxKinds() { // tt1011+
    const r = await this.api.retail('/Commons/RetailTaxKindSelect', {}); // tt1011+
    const v = Array.isArray(r) ? r : (r && r.success !== false && Array.isArray(r.value) ? r.value : null); // tt1011+
    if (!v) return { error: 'Could not read the taxes from AIR POS' + (r && r.message ? ': ' + r.message : '') + '. Try again, or switch Taxable off.' }; // tt1011+
    return { list: v.filter(k => k && k.id && Number.isFinite(Number(k.rate))).map(k => ({ id: k.id, name: String(k.name || ''), rate: Number(k.rate), taxFree: !!k.taxFree })) }; // tt1011+
  } // tt1011+
  async tempTax() { // tt1011+
    const t = await this.taxKinds(); if (t.error) return fail(t.error); // tt1011+
    const corp = this.identity && this.identity.corpName, p = this.settings.tempTaxKind, ok = k => !k.taxFree && k.rate > 0 && k.rate <= 100; // tt1011+
    const pk = p && p.corp === corp ? t.list.find(k => k.id === p.id && ok(k)) : null; if (pk) return { ok: true, kind: pk, picked: true, list: t.list }; // tt1011+
    const tx = t.list.filter(ok); if (tx.length === 1) return { ok: true, kind: tx[0], picked: false, list: t.list }; // tt1011+
    return fail(tx.length ? `AIR POS has ${tx.length} sales taxes, so Air Max can't tell which one is the store's. A manager picks it in Settings > Returns > Temporary Item tax, or switch Taxable off.` : 'AIR POS has no sales tax set up. Switch Taxable off, or add the tax in AIR POS back office.', { list: t.list }); // tt1011+
  } // tt1011+
  async tempTaxInfo() { const t = await this.tempTax(); return { ok: true, kind: t.kind || null, picked: !!t.picked, error: t.ok ? '' : t.message, list: (t.list || []).filter(k => !k.taxFree && k.rate > 0 && k.rate <= 100), taxOff: !!this.order.taxExempt, pickedId: this.settings.tempTaxKind && this.identity && this.settings.tempTaxKind.corp === this.identity.corpName ? this.settings.tempTaxKind.id : '' }; } // tt1011+
  async setTempTax(id) { // manager only; '' = automatic (the only taxable AIR POS tax) // tt1011+
    if (!this.isManager()) return fail('Only a manager can change the Temporary Item tax'); // tt1011+
    if (!id) delete this.settings.tempTaxKind; // tt1011+
    else { const t = await this.taxKinds(); if (t.error) return fail(t.error); const k = t.list.find(x => x.id === id && !x.taxFree && x.rate > 0 && x.rate <= 100); if (!k) return fail('Choose one of the AIR POS sales taxes'); this.settings.tempTaxKind = { corp: this.identity.corpName, id: k.id, name: k.name, rate: k.rate }; } // tt1011+
    return this.saveSettings({}); // tt1011+
  } // tt1011+
  async setPromoCode(code) {
    const g = this.guardCart(); if (g) return g;
    await this.settle(); // the total from the last item added is in first // add1011+
    code = String(code || '').trim() || null; const prevCode = this.order.promotionalCode; this.order.promotionalCode = code; // ls9b~
    const before = this.totals.due; const checked = await this.recalc(); // ls9b~
    if (!checked && !code) return { ok: true, message: 'Promo code removed. AIR POS could not work out the new total yet; it is checked again before any payment is taken.', stale: true }; // ls9b+
    if (!checked) { // reported as "applied" before; now: AIR POS refused it -> taken back off; AIR POS could not be asked -> kept, total rechecked before paying // ls9b+
      const rp = this.lastPromoReply; // ls9b+
      if (!rp || rp.unreachable || rp.uncertain) return fail(`Promo code ${code} is on the sale, but AIR POS could not check it yet (connection problem), so the total shown is not up to date. It is checked again before any payment is taken; if AIR POS then refuses the code, remove it.`, { promoUnchecked: true, stale: true }); // ls9b+
      const why = `AIR POS did not accept it${rp.message ? ': ' + rp.message : ''}`; // ls9b+
      this.order.promotionalCode = prevCode; await this.recalc(); // ls9b+
      return fail(`Promo code ${code} was not applied. ${why}. ${prevCode ? 'Promo code ' + prevCode + ' is still on the sale.' : 'The total is unchanged.'} Try again or check the code.`, { promoRefused: true }); // ls9b+
    } // ls9b+
    return { ok: true, message: code ? (this.totals.due < before ? `Promo code ${code} applied (${money(before - this.totals.due)} off)` : `Promo code ${code} was sent, but AIR POS gave no discount for it (unknown or expired code, or not for these items)`) : 'Promo code removed' }; // ls9b~
  }
  // OrderCheckout "Predefined discount" combo (order.ts setOrderDiscount + checkDiscountLimit)
  async setPredefinedDiscount(id) {
    const g = this.guardCart(); if (g) return g;
    const cfg = id ? (this.discountConfig.subs || []).find(x => x.id === id) : null;
    if (id && !cfg) return fail('Unknown discount');
    if (cfg && cfg.isPeriodicLimit && !this.member) return fail('This discount is for customers (members) only. Attach a customer first.');
    this.order.discountConfigSubId = cfg ? cfg.id : null;
    Object.assign(this.order, cfg ? { discount: cfg.rate, discountName: cfg.name, discountTaxFree: !!cfg.taxFree, discountCustomerType: cfg.customerType || 0 }
      : { discount: 0, discountName: '', discountRemark: '', discountTaxFree: false, discountCustomerType: 0 });
    this.subs.forEach(s => this.applySubDiscount(s));
    await this.recalc(); return { ok: true, message: cfg ? `Discount "${cfg.name}" (${cfg.rate}%) applied` : 'Predefined discount removed' };
  }
  // OrderDiscountDialog
  async setOrderDiscount(kind, value) {
    const g = this.guardCart(); if (g) return g;
    await this.settle(); // the total from the last item added is in first // add1011+
    value = Number(value) || 0; const item = this.totals.itemAmount;
    if (kind === 'amount') {
      if (!Number.isFinite(value) || value < 0) return fail('Bad amount');
      if (value > item) return fail(`The discount can't be more than the items (${money(item)})`);
      this.order.orderDiscountMethod = DiscountMethod.Amount; this.order.orderDiscountAmount = value;
      this.order.orderDiscountEntered = value; // the amount the cashier typed: recalc lowers only the applied amount to the items, never this // ls9c2+
      this.order.orderDiscount = item > 0 ? Math.min(value, item) / item * 100 : 0;
    } else if (kind === 'percent') {
      if (value < 0 || value > 100) return fail('Percent must be 0-100');
      this.order.orderDiscountMethod = DiscountMethod.Percentage; this.order.orderDiscount = value; this.order.orderDiscountAmount = value / 100 * item;
    } else { this.order.orderDiscountMethod = DiscountMethod.Percentage; this.order.orderDiscount = 0; this.order.orderDiscountAmount = 0; }
    await this.recalc(); return { ok: true, message: kind === 'clear' ? 'Order discount cleared' : 'Order discount set' };
  }
  // order.ts buildOrderSubs + the dueAmount watchEffect
  // add1011 (1.0.11-speed.1, Ari OK 5:26 PM ET Nov 1): latest-wins total check. Each call gets a number; an AIR POS reply that comes // add1011+
  // back after a newer call started (or after the sale was reset) is ignored. settle() waits for the newest one; a scan (fastScan) // add1011+
  // shows the line at once with the total marked stale + updating, and every other step waits for the total first. // add1011+
  recalc() { // add1011+
    const tok = this._recalcTok = (this._recalcTok || 0) + 1, t = this.totals; // add1011+
    const p = this.recalcCore(tok).finally(() => { if (tok === this._recalcTok && t === this.totals) delete t.updating; }); // gone once the newest check is back (totals look as before) // add1011+
    this._recalcP = p; return p; // add1011+
  } // add1011+
  recalcLater() { // add1011+
    const t = this.totals; t.stale = true; t.updating = true; // never paid on: startPay / tender check again, and a failure keeps it stale // add1011+
    this.recalc().catch(e => { t.stale = true; this.log('background total check failed: ' + ((e && e.message) || e)); }); // add1011+
  } // add1011+
  async settle() { // add1011+
    for (let p = this._recalcP; p; p = this._recalcP) { await p.catch(() => {}); if (p === this._recalcP) break; } // add1011+
    return !this.totals.stale; // add1011+
  } // add1011+
  async recalcCore(tok) { // add1011~
    const t = this.totals;
    t.pointDiscount = (this.usingPoints > 0 && this.member && this.member.pointExchangeRate > 0) ? round(this.usingPoints * this.member.pointExchangeRate / 100, 2) : 0;
    if (this.subs.length === 0) this.order.orderDiscountEntered = null; // empty sale: discount cleared as before, not brought back // ls9c2+
    if (this.subs.length === 0) {
      this.order.orderDiscount = 0; this.order.orderDiscountAmount = 0; this.promotionSubs = []; this.usingPoints = 0;
      Object.assign(t, { itemAmount: 0, orderAmount: 0, tax: 0, discountAmount: 0, discountRate: 0, promotionDiscount: 0, pointDiscount: 0, due: 0, quantity: 0 });
      t.stale = false; return true;
    }
    const r = await this.api.promotionGet({ shopId: this.api.shop, discountConfigSubId: this.order.discountConfigSubId, subs: this.subs, promotionalCode: this.order.promotionalCode, retailMemberId: this.member ? this.member.id : null });
    if (tok !== this._recalcTok) return this.settle(); // a newer total check was started (or the sale was reset): only its answer counts // add1011+
    this.lastPromoReply = r; // setPromoCode reads AIR POS's answer // ls9b+
    // 1.2.3 total check: a failed recalculation must never leave an old (too low) total to be paid (Register 2, 10/29)
    if (!r || !r.success || !r.value) { t.stale = true; this.log('promotion recalculation failed: total marked stale'); return false; }
    const v = r.value, o = this.order;
    this.promotionSubs = v.subs || [];
    t.itemAmount = v.totalAmount;
    let od = 0;
    if (o.orderDiscountMethod === DiscountMethod.Amount && o.orderDiscountEntered != null) o.orderDiscountAmount = o.orderDiscountEntered; // start from what the cashier entered each time (the ls9c cap below lowers only this recalc's amount) // ls9c2+
    if (o.orderDiscountMethod === DiscountMethod.Percentage) od = o.orderDiscount / 100 * t.itemAmount;
    if (o.orderDiscountMethod === DiscountMethod.Percentage) o.orderDiscountAmount = od; // the order % discount is always worked out over ALL current lines, so the amount sent to AIR POS (Save, Hold, Complete) is never the old one (a live order: 33% of the first item only) // nostore1103 // airmax-fix-stock+
    else if (o.orderDiscountMethod === DiscountMethod.Amount) od = o.orderDiscountAmount;
    if (o.orderDiscountMethod === DiscountMethod.Amount && od > Math.max(t.itemAmount, 0)) { od = Math.max(t.itemAmount, 0); this.log(`order discount ${money(o.orderDiscountAmount)} lowered to ${money(od)}: it can't be more than the items (an item was removed or its quantity lowered)`); o.orderDiscountAmount = od; } // ls9c+
    if (o.orderDiscountMethod === DiscountMethod.Amount) o.orderDiscount = t.itemAmount > 0 ? Math.min(od, t.itemAmount) / t.itemAmount * 100 : 0; // mon109+
    t.orderAmount = t.itemAmount - od;
    t.tax = v.totalTax * (1 - o.orderDiscount / 100);
    t.discountAmount = v.totalDiscountAmount + od;
    t.discountRate = v.originalTotalAmount > 0 ? round(t.discountAmount / v.originalTotalAmount * 100, 3) : 0;
    t.promotionDiscount = v.totalPromotionDiscountAmount;
    t.due = round(round(t.orderAmount, 2) + round(t.tax, 2) - round(t.pointDiscount, 2), 2);
    t.quantity = round(this.subs.reduce((a, s) => a + s.quantity * s.rate, 0), 2);
    t.stale = false; return true;
  }

  // ---------------- members ----------------
  // member.ts loadMemberInfo (MemberInfoGet by number/phone)
  async attachMember(number) {
    const g = this.guardCart(); if (g) return g;
    number = String(number || '').trim(); if (!number) return fail('Enter the customer number or phone');
    const r = await this.api.memberInfoGet(number.replace(/[^\w]/g, '') || number);
    const v = val(r);
    if (!v || !v.member || !v.member.id) return fail((r && r.success === false && r.message) || `No customer found for "${number}"`, { notFound: true });
    const m = v.member;
    this.member = { id: m.id, number: m.number, name: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || m.number, mobile: m.mobile, email: m.email,
      points: v.points || 0, availableBalance: v.availableBalance || 0, pointExchangeRate: v.pointExchangeRate || 0, allowCreditPayment: !!v.allowCreditPayment, creditAmount: v.creditAmount || 0, discount: m.discount || 0 };
    this.usingPoints = 0;
    await this.recalc();
    return { ok: true, message: `Customer ${this.member.name} (${this.member.number}) attached` };
  }
  async detachMember() {
    const g = this.guardCart(); if (g) return g;
    this.member = null; this.usingPoints = 0;
    const cfg = this.configSub(); if (cfg && cfg.isPeriodicLimit) { this.order.discountConfigSubId = null; Object.assign(this.order, { discount: 0, discountName: '', discountTaxFree: false, discountCustomerType: 0 }); this.subs.forEach(s => this.applySubDiscount(s)); }
    await this.recalc(); return { ok: true, message: 'Customer removed from this sale' };
  }
  // MemberSaveDrawer executeMemberAdd (number = phone without punctuation)
  async addMember(b = {}) {
    const mobile = String(b.mobile || '').trim(), firstName = String(b.firstName || '').trim(), lastName = String(b.lastName || '').trim();
    if (!mobile || !firstName || !lastName) return fail('Phone, first name and last name are required');
    const number = mobile.replace(/[^\w]/g, '');
    const dup = this.memberNumberTaken ? await this.memberNumberTaken(number, null, mobile) : null; if (dup) return dup; // request M: say who already has this phone
    const r = await this.api.memberAdd({ id: newGuid(), number, mobile, phone: '', firstName, middleName: '', lastName, company: '', email: String(b.email || '').trim(), receiveAutoEmail: false,
      province: null, city: null, address: '', zipCode: '', discount: 0, remark: String(b.remark || '').trim() });
    if (!r || !r.success) return fail('Could not add customer: ' + msgOf(r));
    const at = this.locked() ? { ok: true } : await this.attachMember(number);
    return { ok: true, message: `Customer ${firstName} ${lastName} added` + (at.ok ? ' and attached' : ''), number };
  }
  async findMembers(keyword) {
    const r = await this.api.memberPaged({ keyword: String(keyword || '').trim() }, 1, 20);
    return { ok: true, rows: ((r && r.rows) || []).map(m => ({ id: m.id, number: m.number, name: [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name, mobile: m.mobile, points: m.points })) };
  }
  async setPoints(points) {
    await this.settle(); // the total from the last item added is in first // add1011+
    if (!this.member) return fail('Attach a customer first');
    if (this.pay && this.pay.tenders.length) return fail('Points must be chosen before the first payment');
    points = Math.floor(Number(points) || 0);
    const rate = this.member.pointExchangeRate;
    if (points < 0) return fail('Bad points');
    if (points > 0 && !(rate > 0)) return fail('Points cannot be used as money in this store');
    const max = Math.min(Math.floor(this.member.points), Math.ceil(this.totals.orderAmount / (rate / 100))); // OrderConfirmNewDialog maxUsablePoints
    if (points > max) return fail(`At most ${max} points can be used on this sale`);
    this.usingPoints = points; await this.recalc();
    return { ok: true, message: points ? `${points} points = ${money(this.totals.pointDiscount)} off` : 'Points not used' };
  }

  // OrderCheckout handleOrderPending
  saveSubmit(isPending) {
    const o = this.order, m = this.member;
    return {
      id: o.id, isPending, currency: o.currency, paymentType: o.paymentType, discountConfigSubId: o.discountConfigSubId,
      orderDiscountMethod: o.orderDiscountMethod, orderDiscount: o.orderDiscount, orderDiscountAmount: o.orderDiscountAmount,
      discount: o.discount, discountName: o.discountName, discountRemark: o.discountRemark, receiveAmount: o.receiveAmount, giveAmount: o.giveAmount,
      discountTaxFree: o.discountTaxFree, discountCustomerType: o.discountCustomerType, retailMemberId: m ? m.id : null, points: m ? this.usingPoints : 0,
      promotionSubs: this.promotionSubs,
      subs: this.subs.map(x => ({
        id: x.id, productId: x.productId, itemId: x.itemId, type: x.type, quantity: x.quantity, rate: x.rate,
        price: unitPrice(x.quantity * x.rate, x.bulkPriceQuantity, x.price, x.bulkPrice),
        originalPrice: x.originalPrice ?? x.oriPrice, taxNotSet: x.taxNotSet, taxRate: x.taxRate, taxFree: x.taxFree,
        discountTaxFree: x.discountTaxFree, productType: x.productType, isCustomDiscount: x.isCustomDiscount,
        discountMethod: x.discountMethod, discount: x.discount, discountAmount: x.discountAmount,
      })),
    };
  }
  async hold() {
    if ((this.subs || []).some(s => s._unconfirmed)) return fail('AIR POS is still checking an item that was just scanned. Try again in a moment.', { retryable: true, unconfirmed: true }); // instant scan: never pay, complete or hold an unchecked line // is1011+
    await this.settle(); // the total from the last item added is in first // add1011+
    if (!this.subs.length) return fail('The order is empty');
    if (this.locked()) return fail('Payment has started; finish it first.');
    if (this.holdDone && this.holdDone.id && this.holdDone.id === this.order.id) this.holdDone = null; // the recovered held sale itself: Hold updates the same order (same id), never a second one // ls10d+
    const hd = this.holdDone; this.holdDone = null; // ls10h+
    if (hd && Date.now() - hd.at < 30 * 60000 && this.holdSig(this.subs) === hd.sig) return { ok: true, already: true, confirmNew: true, message: 'This sale was already held on AIR POS before Air Max closed (open it with Load Hold). It was not held again. Press New sale to clear it, or press Hold again if this is a NEW sale to hold.' }; // ls10h+
    this.journalSnap('holding'); // a crash after AIR POS saves the hold is recognised at the next start // ls10h+
    const r = await this.api.orderSave(this.saveSubmit(true));
    if (r && r.success) { this.saveNoteFor(this.order.id, this.order.note || ''); this.resetOrder(); return { ok: true, message: r.message || 'Order held' }; }
    const o = val(await this.api.orderGet(this.order.id).catch(() => null)); // bad or lost reply: did AIR POS hold it anyway? // mny109h+
    if (o && o.id && o.status === OrderStatus.Pending) { this.log('hold: no clear reply but AIR POS has it held'); this.saveNoteFor(this.order.id, this.order.note || ''); this.resetOrder(); return { ok: true, message: 'Order held (AIR POS had saved it; the reply was lost).' }; } // mny109h+
    if (!r || r.unreachable || r.uncertain || (o && o.id)) return fail('No clear answer from AIR POS about the hold (' + (msgOf(r) || 'no reply') + '). The sale is still here. Press Hold again: Air Max checks first and will not hold it twice.', { retryable: true }); // same id kept: a re-press updates this order, never a second one // mny109h+ // ls9n~
    this.order.id = newGuid(); return fail(msgOf(r) || 'Hold failed');
  }
  async heldOrders() {
    const r = await this.api.orderPaged({ number: '', productNumber: '', memberNumber: '', status: OrderStatus.Pending, operatorName: null, paymentType: null, beginDate: null, endDate: null }, 1, 20);
    return { ok: true, rows: ((r && r.rows) || []).map(o => ({ id: o.id, number: o.number, status: o.status, statusName: o.statusName, quantity: o.quantity, amount: o.amount, tax: o.tax, createTime: o.createTime || o.creationTime || o.orderTime })) };
  }
  // OrderCheckout handleResumeOrder + OrderConfirmNewDialog tryResumeOrder (completed receives are kept)
  async resume(orderId) {
    if (this.locked()) return fail('Finish the current payment first.');
    if (!orderId) { const h = await this.heldOrders(); if (!h.rows.length) return fail('No held orders'); orderId = h.rows[0].id; }
    await this.api.receiveAllCancel(orderId); // AIR POS does this first: drops unfinished receive attempts, keeps completed ones
    const g = await this.api.orderGet(orderId); const cur = val(g);
    if (!cur || !cur.subs) return fail(msgOf(g) || 'Could not load the held order');
    this.resetOrder(); Object.assign(this.order, cur); this.order.resuming = true; this.order.note = this.noteFor(cur.id || orderId);
    for (const s of cur.subs) { s.timestamp = Date.now(); this.subs.splice(0, 0, s); }
    if (cur.retailMemberNumber) await this.attachMember(cur.retailMemberNumber);
    const done = (cur.receives || []).filter(r => r.status === ReceiveCompleted);
    await this.recalc();
    if (done.length) { // a partly paid order: keep what was already paid, continue with the rest
      this.pay = { auth: null, tenders: done.map(r => ({ id: r.id, type: r.paymentType, name: PayName[r.paymentType] || 'Paid', amount: r.amount, receiveAmount: r.receiveAmount, giveAmount: r.giveAmount, status: 'done' })), card: null, result: null };
      const a = await this.authCheck(); this.pay.auth = a;
    }
    return { ok: true, message: `Resumed ${cur.number || orderId}` + (done.length ? ` — ${money(this.paidTotal())} already paid` : '') };
  }
  async newSale() {
    if (this.locked()) return fail('Payment has started; finish it first.');
    this.resetOrder(); return { ok: true, message: 'New sale' };
  }

  // ---------------- payment (one screen, any mix of tenders) ----------------
  // AIR POS flow per tender: authorization -> RetailOrderSave(isPending) -> ReceiveBegin -> (card: ReceiveCheck poll) -> Complete
  paidTotal() { return round((this.pay ? this.pay.tenders : []).filter(t => t.status === 'done').reduce((a, t) => a + t.amount, 0), 2); }
  remaining() { return Math.max(round(this.totals.due - this.paidTotal(), 2), 0); }
  async authCheck() {
    const auth = await this.api.authorizationCheck(this.promotionSubs);
    const v = val(auth) || {};
    return { needAuthorization: !!v.needAuthorization, authorizationType: v.authorizationType || 0, managerId: v.managerId || null };
  }
  async startPay() {
    if ((this.subs || []).some(s => s._unconfirmed)) return fail('AIR POS is still checking an item that was just scanned. Try again in a moment.', { retryable: true, unconfirmed: true }); // instant scan: never pay, complete or hold an unchecked line // is1011+
    if (!this.subs.length) return fail('The order is empty');
    if (this.pay) return { ok: true, message: 'Payment open', remaining: this.remaining() };
    if (!(await this.recalc())) return fail(STALE_MSG, { retryable: true, stale: true });
    if (!Number.isFinite(this.totals.due)) return fail('The total could not be worked out. Check the connection and try again.', { retryable: true });
    if (this.totals.due < 0) return fail(`The total is below $0 (${money(this.totals.due)}). Check the discounts and points.`);
    const [auth, st] = await Promise.all([this.authCheck(), this.stockWarnOn() || this.stockRule() === 'refuses' ? this.stockShort().catch(() => null) : null]); // cp1010~
    const rule = this.stockRule(), stockWarning = st && st.text ? (rule === 'refuses' ? st.text.replace(/AIR POS may refuse.*$/, "This store's AIR POS refuses sales below zero stock: payment can't be taken until the stock is fixed or the item removed.") : rule === 'allows' ? st.text.replace(/AIR POS may refuse.*$/, 'This store sells below zero stock (an oversold sale went through before).') : st.text) : '';
    this.pay = { auth, tenders: [], card: null, result: null, stockWarning, stockShort: (st && st.short) || [] };
    this.pay.dueSeen = this.totals.due; // the total the cashier was shown when payment opened (see dueRose) // ls9a+
    this.pay.dueSig = this.cartSig(); // and the sale it was for // ls9a+
    if (this.pay.auth.needAuthorization && !this.pay.auth.managerId) return { ok: true, needManager: true, message: 'Manager approval needed for this sale (price/discount below the allowed limit).' };
    return { ok: true, message: 'Take payment', remaining: this.remaining() };
  }
  // Before any money is taken: warn when AIR POS shows less stock than the sale needs (RetailOrderComplete would refuse with
  // "Insufficient inventory" after the card was already charged). Only a warning: stores that allow negative stock still sell.
  async stockCheck() { return (await this.stockShort()).text; }
  // AR-16 / AR-46 (boss, 3:51 PM): out-of-stock items stay in the sale, but a card must never be charged for a sale AIR POS
  // will then refuse. Every product line is checked (no 12-line cap), matched by product id first, then exact number (AR-17).
  async stockShort() {
    const need = new Map();
    for (const s of this.subs) { if (!s.productId || s.type === 10 || s.type === 30 || s.type === 40) continue; const k = s.productId; const e = need.get(k) || { id: k, number: s.number, name: s.name, qty: 0 }; e.qty += (s.quantity || 0) * (s.rate || 1); need.set(k, e); }
    const list = [...need.values()], short = []; let unknown = 0;
    for (let i = 0; i < list.length; i += 8) { // a few at a time
      await Promise.all(list.slice(i, i + 8).map(e => this.api.productPaged(e.number, 1, 5).then(pp => {
        const rows = (pp && pp.rows) || (pp && pp.value && pp.value.rows) || []; const p = rows.find(x => x.id === e.id) || rows.find(x => x.number === e.number);
        if (!p || typeof p.quantityStock !== 'number') { unknown++; return; }
        if (p.quantityStock < e.qty) short.push({ name: e.name, number: e.number, stock: p.quantityStock, qty: e.qty });
      }).catch(() => { unknown++; })));
    }
    const text = short.length ? 'Low stock: ' + short.map(x => `${x.name} (${x.stock} in stock, selling ${x.qty})`).join('; ') + '. AIR POS may refuse to finish a sale below zero stock.' : '';
    return { short, unknown, text, sig: short.map(x => x.number + ':' + x.qty).join('|') };
  }
  // What this store's AIR POS does with a sale below zero stock, learned from real Finish answers on this PC:
  // 'refuses' (Complete said "Insufficient inventory"), 'allows' (an oversold sale completed) or 'unknown'.
  stockRule() { if (!this._stockRule) { try { this._stockRule = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'stock-rule.json'), 'utf8')); } catch { this._stockRule = { rule: 'unknown' }; } } // stk1010~
    if (((this.retailCfg().inventorySetting || {}).retailOrderStockCheck) === false) return 'allows'; // AIR POS itself does not check stock on retail orders: never block before payment, whatever was learned before // airmax-fix-stock+
    const k = this.solaShopKey ? this.solaShopKey() : '', one = k && this._stockRule.shops && this._stockRule.shops[k]; if (one) return one.rule || 'unknown'; // learned per store (corp|shop) // stk1010+
    const g = this._stockRule.rule || 'unknown'; return k && g === 'allows' ? 'unknown' : g; } // older PC-wide file: "refuses" still counts for every store, "allows" only where no store is known // stk1010+
  learnStockRule(rule, why) {
    if (this.stockRule() === rule) return; const k = this.solaShopKey ? this.solaShopKey() : '', e = { rule, at: new Date().toISOString(), why: String(why || '').slice(0, 160) }; // stk1010~
    if (k) { const sh = { ...(this._stockRule.shops || {}) }; sh[k] = e; this._stockRule = { ...this._stockRule, shops: sh }; } else this._stockRule = { ...e, shops: this._stockRule.shops }; this.log(`stock rule learned: ${rule}${k ? ' for this store' : ''} (${why})`); // stk1010+
    if (this.dataDir) { try { fs.writeFileSync(path.join(this.dataDir, 'stock-rule.json'), JSON.stringify(this._stockRule, null, 1)); } catch (e) { this.log('stock rule save failed: ' + e.message); } }
  }
  // Called before every tender. Card / gift card money can't simply be handed back, so for a short sale they need one OK
  // from the cashier (unknown rule) or are stopped (store refuses). Cash / check / account: the warning only, unless refuses.
  async stockGate(type, b) {
    const pay = this.pay, rule = this.stockRule(); if (rule === 'allows' || (rule !== 'refuses' && !this.stockWarnOn())) return null; // cp1010~
    const st = await this.stockShort().catch(() => null); if (!st) return null; // can't look: never block on a lookup error
    pay.stockWarning = st.text; pay.stockShort = st.short;
    if (!st.short.length) return null;
    const items = st.short.map(x => `${x.name} (${x.stock} in stock, selling ${x.qty})`).join('; ');
    if (rule === 'refuses') return fail(`Not taken: this store's AIR POS refuses sales below zero stock, so it would not finish this sale. Short: ${items}. Add the stock in AIR POS back office (Inventory) or remove the item, then take payment again.`, { stockBlocked: true, stockShort: st.short });
    const hard = type === PaymentType.CreditCard || type === PaymentType.Online || type === PaymentType.GiftCard;
    if (hard && !(b && b.stockOk) && pay.stockAck !== st.sig) return fail(`Check first: ${items}. Some AIR POS stores refuse to finish a sale below zero stock, and the card would already be charged. Press "Take payment anyway" if this store sells below zero, or fix the stock first.`, { needStockOk: true, stockShort: st.short });
    if (b && b.stockOk) pay.stockAck = st.sig;
    return null;
  }
  // Owner request L: run printer / drawer jobs one after another WITHOUT holding the sale. Each is capped (capHw) so a hung
  // printer can't pile up; results land in this.hwNotes, which the screen shows as a small note that fades by itself.
  hwBackground(jobs, ref, tm) { /* tm = { t0, ST }: per-job ms from payment confirmed (Save diagnostics)*/ // spd1010~
    if (!jobs.length) return Promise.resolve([]);
    this.hwNotes = this.hwNotes || []; this.hwSeq = this.hwSeq || 0;
    const TXT = { drawer: "Cash drawer didn't open — press Open Drawer (Ctrl+D)", receipt: "Receipt didn't print: press Reprint Receipt (Ctrl+P) to print it again", gift: "Gift receipt didn't print: press Gift Receipt (Ctrl+Alt+P) to print it again", return: "Return receipt didn't print, reprint later (History)" }; // cp1010~
    const what = k => (k === 'drawer' ? 'The cash drawer' : 'The receipt printer');
    const run = (async () => {
      const out = [];
      for (const [kind, fn, ms] of jobs) {
        const tj = Date.now(); if (kind === 'receipt') this.lastPrintTimings = null; // spd1010+
        let r; try { r = await capHw(Promise.resolve().then(fn), ms, what(kind)); } catch (e) { r = fail(what(kind) + ' failed: ' + e.message, { hw: 'error' }); }
        out.push([kind, r]);
        if (tm) { const ST = tm.ST; ST[kind + 'StartMs'] = tj - tm.t0; ST[kind + 'EndMs'] = Date.now() - tm.t0; ST[kind + 'Ok'] = !!(r && r.ok); // spd1010+
          const P = kind === 'receipt' && this.lastPrintTimings; if (P) { { const h = (P.prints || []).map(p => p.handOffAt).find(Boolean) || P.printStartAt; if (h) ST.printStartMs = h - tm.t0; } ST.printedMs = Date.now() - tm.t0; ST.waitForAirposMs = P.waitForAirposMs; ST.templateConfigMs = P.templateConfigMs; ST.receiptPdfMs = P.receiptPdfMs; ST.prints = (P.prints || []).map(p => ({ method: p.method, methodLookupMs: p.methodLookupMs, driverPrintMs: p.driverPrintMs, driverFallbackMs: p.driverFallbackMs, rawFailed: p.rawFailed, totalMs: p.totalMs })); } } // spd1010+
        if (!r || !r.ok) {
          const why = String((r && r.message) || 'no answer').slice(0, 160);
          this.hwNotes.push({ id: ++this.hwSeq, at: Date.now(), kind, ref, message: kind === 'gift' && r && r.noTemplate ? r.message : TXT[kind], why });
          if (this.hwNotes.length > 8) this.hwNotes.splice(0, this.hwNotes.length - 8);
          this.log(`background ${kind} for ${ref} failed: ${why}`);
        }
      }
      if (tm) { tm.ST.allDoneMs = Date.now() - tm.t0; this.lastSaleTimings = tm.ST; this.recentSaleTimings = [...(this.recentSaleTimings || []), tm.ST].slice(-10); try { this.log('sale print timings ' + JSON.stringify(tm.ST)); } catch {} } // spd1010+
      if (this.refreshPrinterInfoLater) this.refreshPrinterInfoLater(); // spd1010+
      return out;
    })();
    run.catch(() => {}); return run;
  }
  hwNotesRecent() { const now = Date.now(); return (this.hwNotes || []).filter(n => now - n.at < 60000).map(({ id, kind, message, why }) => ({ id, kind, message, why })); }
  // Owner request K: after a scan, a read-only stock look-up for a small "Out of stock (qty 0)" note. The item is already in
  // the sale; this never removes or blocks anything (AIR POS itself may still refuse Finish with "Insufficient inventory").
  async stockNote(code) {
    code = cleanCode(code); if (!code) return fail('Nothing to look up');
    const pp = await this.api.productPaged(code, 1, 5).catch(() => null); const rows = (pp && pp.rows) || (pp && pp.value && pp.value.rows) || [];
    const p = rows.find(x => x.number === code || x.upc === code) || (rows.length === 1 ? rows[0] : null);
    if (!p || typeof p.quantityStock !== 'number') return { ok: true, known: false };
    const q = p.quantityStock; return { ok: true, known: true, out: q <= 0, qty: q, name: p.name, message: q <= 0 ? `Out of stock (qty ${q})` : '' };
  }
  async closePay() {
    if (!this.pay) return { ok: true };
    if (this.pay.card && (this.pay.card.status === 'waiting' || this.pay.card.status === 'keyed')) return fail('A card payment is open. Press Cancel card first.');
    if (this.paidTotal() > 0) return fail(`${money(this.paidTotal())} is already paid. Take the remaining ${money(this.remaining())} to finish the sale. (If the app is closed now, the sale stays held; resuming it cancels the earlier partial payments on the server, same as AIR POS, and payment starts over.)`);
    this.pay = null; return { ok: true, message: 'Back to the sale' };
  }
  // ManagerVerifyDialog -> /Identities/verify returns the manager id (fingerprint: not supported)
  async managerApprove(userName, password) {
    if (!userName || !password) return fail('Enter the manager user name and password');
    const r = await this.api.verify(String(userName).trim(), password);
    if (!r || !r.success || !r.value) return fail(msgOf(r) || 'Manager approval failed');
    if (this.pay && this.pay.auth) this.pay.auth.managerId = r.value;
    return { ok: true, message: 'Approved by manager', managerId: r.value };
  }
  async verifyGiftCard(number, secret) {
    number = String(number || '').trim(); if (!number) return fail('Enter the gift card number');
    const r = await this.api.giftCardVerify(number, String(secret || '').trim());
    if (!r || !r.success || !r.value) return fail(msgOf(r) || 'Gift card not valid');
    const c = r.value;
    if (c.expired) return fail(`Gift card ${number} is expired`);
    return { ok: true, card: { id: c.id, number: c.number || number, balance: round(c.balance || 0) }, message: `Gift card ${number}: balance ${money(c.balance || 0)}` };
  }
  // cof109 begin
  // AirMax 1.0.9 card on file (Ari OK 1:25 AM ET Oct 30). Stripe stores; Sola stores only when a manager turned it on (sola109). Cards are added only from // sola109~
  // the customer profile (typed into Stripe's own card box, customer consent ticked); AIR POS keeps the card reference, Stripe the card.
  // Nothing here logs or keeps card data, the SetupIntent client secret, or the holder's address (the API log is endpoint + outcome only).
  cofStripeOnly() { const k = this.keyedInfo(); if (k.kind === 'stripe' || k.kind === 'sola') return null; // sola109~
    return fail(k.channelType === 20 ? 'Cards on file work with Stripe stores only, unless a manager turns them on for this Sola store in Settings > Cards. This store uses the Sola channel and they are off, so cards cannot be saved or charged here.' : (k.note || 'Keyed card (Stripe) is not set up in AIR POS back office.'), { notStripe: true }); } // sola109~
  cofCard(c) { c = c || {}; return { id: c.id, brand: String(c.cardType || 'Card'), last4: String(c.lastFourDigits || '').replace(/\D/g, '').slice(-4), exp: String(c.validityPeriod || ''), usable: c.usableForCurrentChannel !== false }; }
  async memberCards(id) {
    if (!id) return fail('No customer');
    const r = await this.api.memberCardsSelect(id);
    if (!r || r.success === false) return fail('Could not read the cards on file: ' + (msgOf(r) || 'no reply'));
    const v = val(r), list = Array.isArray(v) ? v : (v && (v.rows || v.list)) || [];
    const k = this.keyedInfo();
    return { ok: true, stripe: k.kind === 'stripe', sola: k.kind === 'sola', kind: k.kind || '', test: !!k.test, note: k.kind === 'stripe' || k.kind === 'sola' ? '' : (this.cofStripeOnly() || {}).message, cards: list.map(c => this.cofCard(c)).filter(c => c.id != null) }; // sola109~
  }
  async memberCardAddBegin(id) {
    const no = this.cofStripeOnly(); if (no) return no;
    if (this.keyedInfo().kind === 'sola') return fail('On a Sola store the card is typed into the Add card window and saved in one step. Nothing was started.'); // sola109+
    if (!id) return fail('No customer');
    const pend = (this.cofPending || {})[id]; // pb109d+ the last save's reply was unclear: check the cards on file before a second card can be saved // pb109d+
    if (pend) { const now = await this.cofIds(id); if (!now) return fail('Air Max could not check yet whether the card from the last try was saved (AIR POS did not answer clearly). Nothing new was started. Try again in a moment.', { retryable: true }); // pb109d+ // ls9n~
      delete this.cofPending[id]; const nw = pend.ids ? now.filter(c => !pend.ids.includes(c.id)) : []; // pb109d+
      if (nw.length) return fail(`The card from the last try was saved (${nw[0].brand} ending ${nw[0].last4}). It is on file now, so it was not added again.`, { alreadySaved: true, cards: now }); // pb109d+
      if (!pend.ids && now.length) return fail(`The last try may have saved the card. This customer has ${now.length} card${now.length === 1 ? '' : 's'} on file now: check the list before adding it again (press Add card again to add another one).`, { maybeSaved: true, cards: now }); } // pb109d+
    const r = await this.api.memberCardAddBegin(id), v = val(r) || {};
    const si = (v && v.setupIntent) || (r && r.setupIntent), cs = si && typeof si.client_secret === 'string' ? si.client_secret : '';
    if (!r || r.success === false || v.success === false || !cs) return fail('AIR POS could not start adding the card: ' + (msgOf(r) || 'no setup reply') + '. Nothing was saved.');
    return { ok: true, clientSecret: cs, test: !!this.keyedInfo().test }; // client secret goes to the UI only, never logged or kept
  }
  async memberCardAddComplete(b = {}) {
    if (b && b.card) { // Sola: the typed card lives only in this call (memory), is sent once, then wiped; never logged, kept or journaled // sola109+
      const card = { cardNo: String(b.card.cardNo || '').replace(/[\s-]/g, ''), expiration: String(b.card.expiration || '').trim(), cvv: String(b.card.cvv || '').trim() }; wipeCard(b); // sola109+
      try { const k = this.keyedInfo(); return k.kind === 'sola' ? await this.solaCardAdd(b, card) : (this.cofStripeOnly() || fail('This store saves cards through Stripe\'s secure card box. Nothing was saved.')); } finally { card.cardNo = card.cvv = card.expiration = ''; } // sola109+
    } // sola109+
    if (this.keyedInfo().kind === 'sola') return fail('Type the card number, expiry (MM/YY) and CVV. Nothing was saved.'); // sola109+
    const no = this.cofStripeOnly(); if (no) return no;
    const s = k => String(b[k] == null ? '' : b[k]).trim();
    const id = b.id, setupIntentId = s('setupIntentId'), holderName = s('holderName'), billAddress = s('billAddress'), zipCode = s('zipCode');
    if (!id) return fail('No customer');
    if (!/^seti_[A-Za-z0-9_]+$/.test(setupIntentId)) return fail('Stripe did not confirm the card. Nothing was saved.');
    if (!holderName || !billAddress || !zipCode) return fail('Card holder name, billing address and ZIP are needed');
    // card fields are always blank: the card itself is only in Stripe (Air Register never sees it)
    const before = await this.cofIds(id); // cards on file before saving: a lost / garbled reply is then checked against them (never "did not save" when it did) // pb109d+
    const r = await this.api.memberCardAddComplete({ retailMemberId: id, setupIntentId, cardNo: '', expiration: '', cvv: '', holderName, billAddress, zipCode });
    if (!r || r.success === false || (val(r) && val(r).success === false)) { // pb109d~
      const clear = r && r.success === false && !r.unreachable && !r.uncertain && !r.loggedOut && !/^HTTP |^Non-JSON reply/.test(String(r.message || '')); // AIR POS itself answered "not saved" // pb109d+
      const now = await this.cofIds(id), nw = now && before ? now.filter(c => !before.some(x => x.id === c.id)) : []; // pb109d+
      if (nw.length) { this.log('CARD ON FILE: save reply was unclear; AIR POS has the new card (not saved again)'); return { ok: true, message: 'Card saved for this customer (the connection dropped, but AIR POS had saved it)', cards: now }; } // pb109d+
      if (!clear && !(now && before)) { (this.cofPending = this.cofPending || {})[id] = { ids: before ? before.map(c => c.id) : null, at: Date.now() }; return fail('The connection dropped while saving the card, and Air Max could not check yet whether AIR POS saved it. Do not add it again now: open the customer\'s cards in a moment. Add card checks this first.', { unknown: true }); } // pb109d+ // ls9n~
      return fail('AIR POS did not save the card: ' + (msgOf(r) || 'no reply')); // pb109d+
    } // pb109d+
    return { ok: true, message: 'Card saved for this customer' };
  }
  // Sola add (AIR POS MemberCardAddDialog.vue): AddBegin (must succeed), then ONE AddComplete with the typed card. Same safeguards as // sola109+
  // Stripe: an unclear last save is checked first (cofPendCheck = the pb109d check), the list is read BEFORE saving (a card already on // sola109+
  // file is never saved twice, and a lost reply is then checked against it), and the card is wiped right after the one call. // sola109+
  normExp(x) { x = String(x || '').trim(); let m = /^(\d{1,2})\D+(\d{2}|\d{4})$/.exec(x); if (m) return ('0' + m[1]).slice(-2) + m[2].slice(-2); m = /^(\d{4})\D+(\d{1,2})(\D.*)?$/.exec(x); if (m) return ('0' + m[2]).slice(-2) + m[1].slice(-2); m = /^(\d{2})(\d{2})$/.exec(x); return m ? x : ''; } // sola109+
  async cofPendCheck(id) { // sola109+
    const pend = (this.cofPending || {})[id]; if (!pend) return null; // sola109+
    const now = await this.cofIds(id); if (!now) return fail('Air Max could not check yet whether the card from the last try was saved (AIR POS did not answer clearly). Nothing new was started. Try again in a moment.', { retryable: true }); // sola109+
    delete this.cofPending[id]; const nw = pend.ids ? now.filter(c => !pend.ids.includes(c.id)) : []; // sola109+
    if (nw.length) return fail(`The card from the last try was saved (${nw[0].brand} ending ${nw[0].last4}). It is on file now, so it was not added again.`, { alreadySaved: true, cards: now }); // sola109+
    if (!pend.ids && now.length) return fail(`The last try may have saved the card. This customer has ${now.length} card${now.length === 1 ? '' : 's'} on file now: check the list before adding it again (press Add card again to add another one).`, { maybeSaved: true, cards: now }); // sola109+
    return null; // sola109+
  } // sola109+
  async solaCardAdd(b, card) { // sola109+
    const s = k => String(b[k] == null ? '' : b[k]).trim(); // sola109+
    const id = b.id, holderName = s('holderName'), billAddress = s('billAddress'), zipCode = s('zipCode'); // sola109+
    if (!id) return fail('No customer'); // sola109+
    if (b.consent !== true) return fail('The customer must agree first (tick the box). Nothing was saved.'); // sola109+
    if (!holderName || !billAddress || !zipCode) return fail('Card holder name, billing address and ZIP are needed'); // sola109+
    const ce = keyedCardError(card); if (ce) return fail(ce + ' Nothing was saved.', { cardError: true }); // sola109+
    const pc = await this.cofPendCheck(id); if (pc) return pc; // sola109+
    const before = await this.cofIds(id); // sola109+
    if (!before) return fail('Air Max could not read this customer\'s cards on file from AIR POS, so nothing was saved (it checks the list first so a card is never saved twice). Try again in a moment.', { retryable: true }); // sola109+
    const last4 = card.cardNo.slice(-4), ex = this.normExp(card.expiration); // sola109+
    const dup = before.find(c => c.usable && c.last4 === last4 && (!this.normExp(c.exp) || this.normExp(c.exp) === ex)); // sola109+
    if (dup) return fail(`This customer already has ${dup.brand} ending ${dup.last4} on file, so it was not saved again. If it is a different card, remove the old one first.`, { alreadySaved: true, cards: before }); // sola109+
    const r0 = await this.api.memberCardAddBegin(id), v0 = val(r0); // sola109+
    if (!r0 || r0.success === false || r0.unreachable || r0.uncertain || (v0 && typeof v0 === 'object' && v0.success === false)) return fail('AIR POS could not start adding the card: ' + (msgOf(r0) || 'no reply') + '. Nothing was saved.'); // sola109+
    const req = { retailMemberId: id, setupIntentId: '', cardNo: card.cardNo, expiration: card.expiration, cvv: card.cvv, holderName, billAddress, zipCode }; // sola109+
    let r; try { r = await this.api.memberCardAddComplete(req); } finally { req.cardNo = req.cvv = req.expiration = ''; } // sola109+
    if (!r || r.success === false || (val(r) && val(r).success === false)) { // sola109+
      const clear = r && r.success === false && !r.unreachable && !r.uncertain && !r.loggedOut && !/^HTTP |^Non-JSON reply/.test(String(r.message || '')); // sola109+
      const now = await this.cofIds(id), nw = now ? now.filter(c => !before.some(x => x.id === c.id)) : []; // sola109+
      if (nw.length) { this.log('CARD ON FILE (Sola): save reply was unclear; AIR POS has the new card (not saved again)'); return { ok: true, message: 'Card saved for this customer (the connection dropped, but AIR POS had saved it)', cards: now }; } // sola109+
      if (!clear && !now) { (this.cofPending = this.cofPending || {})[id] = { ids: before.map(c => c.id), at: Date.now() }; return fail('The connection dropped while saving the card, and Air Max could not check yet whether AIR POS saved it. Do not add it again now: open the customer\'s cards in a moment. Add card checks this first.', { unknown: true }); } // sola109+
      if (!clear) return fail('The connection dropped while saving the card. AIR POS does not have it, so nothing was saved. Type the card again to retry.', { retryable: true }); // sola109+
      return fail('AIR POS did not save the card: ' + (msgOf(r) || 'no reply')); // sola109+
    } // sola109+
    return { ok: true, message: `Card ending ${last4} saved for this customer` }; // sola109+
  } // sola109+
  async cofIds(id) { const r = await this.api.memberCardsSelect(id); if (!r || r.success === false || r.unreachable || r.uncertain || r.loggedOut) return null; const v = val(r), list = Array.isArray(v) ? v : (v && (v.rows || v.list)); return Array.isArray(list) ? list.map(c => this.cofCard(c)).filter(c => c.id != null) : null; } // null = could not read // pb109d+
  async memberCardDelete(id, cardId) {
    if (!id || cardId == null || cardId === '') return fail('No card picked');
    const r = await this.api.memberCardDelete(id, cardId);
    if (!r || r.success === false || (val(r) && val(r).success === false)) return fail('AIR POS did not remove the card: ' + (msgOf(r) || 'no reply'));
    return { ok: true, message: 'Card removed from this customer' };
  }
  // Pay with a saved card: only a card that AIR POS lists right now for the customer on this sale, and usable on this payment channel
  async cofSaved(cardId) {
    const no = this.cofStripeOnly(); if (no) return no;
    if (!this.member) return fail('Add the customer to the sale first to use a card on file. Nothing was charged.');
    const l = await this.memberCards(this.member.id); if (!l.ok) return fail(l.message + ' Nothing was charged.');
    const c = l.cards.find(x => String(x.id) === String(cardId));
    if (!c) return fail('That card is not on file for this customer. Nothing was charged.');
    if (!c.usable) return fail('That card was saved under another payment channel and cannot be charged here. Nothing was charged.');
    // airmax-fix-12+
    // Fix #12: the card on file's real AIR POS data (cardType -> brand, lastFourDigits -> last4) for the card slip after the receipt. Memory only.
    this._cofPicked = { id: c.id, brand: c.brand, last4: c.last4 };
    // airmax-fix-12-
    return { ok: true, id: c.id, masked: { cardNo: '**** **** **** ' + c.last4, expiration: c.exp, cvv: '***' } };
  }
  // cof109 end
  // one tender: { type, amount, tendered (cash), checkNumber, giftCards:[{id,balance}] }
  async tender(b = {}) {
    if ((this.subs || []).some(s => s._unconfirmed)) return fail('AIR POS is still checking an item that was just scanned. Try again in a moment.', { retryable: true, unconfirmed: true }); // instant scan: never pay, complete or hold an unchecked line // is1011+
    const typedCard = b && b.card ? { cardNo: String(b.card.cardNo || '').replace(/[\s-]/g, ''), expiration: String(b.card.expiration || '').trim(), cvv: String(b.card.cvv || '').trim() } : null;
    wipeCard(b); // Sola Online Payment card: from here on it lives only in typedCard (this call), never in pay / journal / logs
    try { return await this.tenderCore(b, typedCard); } finally { if (typedCard) typedCard.cardNo = typedCard.cvv = typedCard.expiration = ''; }
  }
  // local.9 (Stress Tester local.7, Ari OK 9:24 PM Oct 31): a promo code / coupon that AIR POS stops accepting after the cashier // ls9a+
  // saw the total (used up on another register, expired) makes the total go UP. Each payment rechecks the total first; when it // ls9a+
  // went up, nothing is charged for that payment and the cashier is shown the new total (before: the old amount was taken, // ls9a+
  // then "more left to pay", forcing a second card or a second cash payment AIR POS does not keep). // ls9a+
  cartSig() { const o = this.order; return JSON.stringify([(this.subs || []).map(x => [x.id, x.itemId, x.quantity, x.price, x.discount, x.discountAmount, x.discountMethod]), o.orderDiscountMethod, o.orderDiscountMethod === DiscountMethod.Amount ? o.orderDiscountAmount : o.orderDiscount, o.promotionalCode, o.discountConfigSubId, this.member ? this.member.id : null]); } // what the cashier set on the sale // ls9a+
  dueRose(pay) { // ls9a+
    const d = this.totals.due, was = pay.dueSeen; pay.dueSeen = d; // ls9a+
    const sig = this.cartSig(), same = pay.dueSig === undefined || pay.dueSig === sig; pay.dueSig = sig; // ls9a+
    if (!same) return null; // the cashier changed the sale (scanned an item, raised a quantity): the screen already shows the new total // ls9a+
    if (!(typeof was === 'number' && Number.isFinite(was)) || !(d > was + 0.004)) return null; // ls9a+
    const pc = this.order.promotionalCode, why = pc && !(this.totals.promotionDiscount > 0) ? ` AIR POS no longer accepts promo code ${pc} on this sale.` : ''; // ls9a+
    this.log(`payment stopped: total went up from ${money(was)} to ${money(d)}${pc ? ' (promo ' + pc + ')' : ''}`); // ls9a+
    return fail(`The total went up from ${money(was)} to ${money(d)}.${why} Nothing was charged for this payment. ${money(this.remaining())} is left to pay: tell the customer, then take the payment again.`, { totalChanged: true, due: d, remaining: this.remaining() }); // ls9a+
  } // ls9a+
  async tenderCore(b, typedCard) {
    const p = this.pay; if (!p) { const s = await this.startPay(); if (!s.ok || s.needManager) return s; }
    const pay = this.pay;
    if (!pay.pendingSubmit && !(await this.recalc())) return fail(STALE_MSG, { retryable: true, stale: true });
    if (!pay.pendingSubmit) { const up = this.dueRose(pay); if (up) return up; } // total went up since the cashier saw it: stop before charging // ls9a+
    if (pay.auth && pay.auth.needAuthorization && !pay.auth.managerId) return fail('Manager approval needed first', { needManager: true });
    if (pay.card && (pay.card.status === 'waiting' || pay.card.status === 'keyed')) return fail('A card payment is still waiting');
    const type = Number(b.type); const rem = this.remaining();
    if (!pay.pendingSubmit) { const sg = await this.stockGate(type, b); if (sg) return sg; } // AR-16: before any money is taken
    if (type === PaymentType.Check && !this.member) return fail('Add a customer to pay by check', { needCustomer: true }); // owner rule: checks only with a customer on the sale; nothing is sent
    if (!(rem > 0) && this.totals.due > 0) return fail('Nothing left to pay');
    const sameDone = (type === PaymentType.Cash || type === PaymentType.Check) ? pay.tenders.find(t => t.status === 'done' && t.type === type) : null; // mny109a+
    if (sameDone) return fail(`${PayName[type]} ${money(sameDone.amount)} is already taken on this sale. AIR POS keeps only one ${type === PaymentType.Cash ? 'cash' : 'check'} payment per sale, so a second one would not be saved. Nothing was taken. Take the ${money(rem)} left another way (${type === PaymentType.Cash ? 'card, check, store credit or gift card' : 'cash, card, store credit or gift card'}).`, { sameType: true }); // mny109a+
    const giftDone = type === PaymentType.GiftCard ? pay.tenders.find(t => t.status === 'done' && t.type === PaymentType.GiftCard) : null; // one gift card payment per sale (GiftCardConfirmer.vue: the gift line is locked once paid; AIR POS keeps only the first gift receive, TestShop RO11052) // mgc1011+
    if (giftDone) return fail(`Gift card ${money(giftDone.amount)} is already taken on this sale. AIR POS keeps only one gift card payment per sale, so a second one would not be saved. Nothing was taken. To use several gift cards, press Check for each card first and pay once. Take the ${money(rem)} left another way (cash, card, check or store credit).`, { sameType: true }); // mgc1011+
    let amount = b.amount == null || b.amount === '' ? rem : round(Number(b.amount));
    let receiveAmount = 0, giveAmount = 0, checkNumber = '', gift = [];
    if (type === PaymentType.Cash) {
      const tendered = b.tendered == null || b.tendered === '' ? amount : round(Number(b.tendered));
      if (!Number.isFinite(tendered) || !(tendered > 0)) return fail('Enter the cash received');
      if (tendered > MAX_TENDER) return fail(`Cash received ${money(tendered)} looks wrong. Check the amount.`);
      amount = Math.min(tendered, rem); receiveAmount = tendered; giveAmount = Math.max(round(tendered - amount), 0);
    } else if (!(amount > 0)) return fail('Enter an amount above $0');
    if (!Number.isFinite(amount)) return fail('Enter a valid amount');
    if (amount > rem) return fail(`Amount ${money(amount)} is more than what is left (${money(rem)})`);
    if (type === PaymentType.Check) { checkNumber = String(b.checkNumber || '').trim(); if (!checkNumber) return fail('Enter the check number'); }
    else if (type === PaymentType.GiftCard) {
      gift = Array.isArray(b.giftCards) ? b.giftCards : [];
      if (!gift.length) return fail('Scan or enter a gift card first');
      const bal = round(gift.reduce((a, c) => a + (Number(c.balance) || 0), 0));
      if (bal < amount) return fail(`Gift card balance ${money(bal)} is less than ${money(amount)}`);
    } else if (type === PaymentType.MemberAccount) {
      if (!this.member) return fail('Attach a customer to pay with store credit');
      // AIR POS MemberAccount (11): store balance, plus the house-account credit only when the customer has "Allow Credit Payment" on (MemberConfirmer.vue shows credit only then)
      const max = round(this.member.availableBalance + (this.member.allowCreditPayment ? this.member.creditAmount : 0));
      if (amount > max) return fail(`Customer can use at most ${money(max)}`);
    } else if (type === PaymentType.Online) { const k = this.keyedInfo(); if (!k.enabled) return fail(k.note || 'Keyed card is not set up');
      if (k.kind === 'sola' && (b.savedCardId == null || b.savedCardId === '')) { const ce = keyedCardError(typedCard); if (ce) return fail(ce + ' Nothing was charged.', { cardError: true }); } } // sola109~
    else if (type !== PaymentType.CreditCard && type !== PaymentType.Cash) return fail('Unsupported payment type');
    const saved = type === PaymentType.Online && b.savedCardId != null && b.savedCardId !== '' ? await this.cofSaved(b.savedCardId) : null; if (saved && !saved.ok) return saved; // cof109+

    // AIR POS sets paymentType to the tender, or Combination (99) when more than one tender is used.
    // A payment whose reply was lost: ask the server what happened before sending anything again (never double-charge).
    if (pay.pendingSubmit) {
      const ps = pay.pendingSubmit, st = await this.checkReceive(ps.submit);
      if (st === 'unknown') return fail('Still no connection to AIR POS. Air Max will check the earlier payment before taking it again. Press Retry when the connection is back.', { retryable: true }); // ls9n~
      if (st === 'done' || st === 'begun') return this.adoptReceive(ps, st);
      if (ps.submit.paymentType !== type) pay.pendingSubmit = null; // different payment now: the lost one never reached the server (same type: its id is reused)
    }
    this.order.paymentType = (pay.tenders.some(t => t.status === 'done') || amount < rem) ? PaymentType.Combination : type;
    // AIR POS keeps only the FIRST receive of a payment type (TestShop C33/S13): a second cash/check tender is refused above, // mny109a~
    // so nothing is merged here any more (old app CashConfirmer/CheckConfirmer: one payment item per type). // mny109a~
    const prevCash = null; // mny109a~
    if (prevCash) { amount = round(amount + prevCash.amount); receiveAmount = round(receiveAmount + (prevCash.receiveAmount || prevCash.amount)); }
    this.journalSnap('saving');
    const save = await this.api.orderSave(this.saveSubmit(true));
    if (!save || !save.success) return fail((save && save.unreachable ? 'No connection to AIR POS. Nothing was charged. Press Retry.' : 'Save failed: ' + msgOf(save)), save && save.unreachable ? { retryable: true } : {});
    { const dm = await this.dueMismatch(pay); if (dm) return dm; } // before ANY payment is taken: AIR POS's due must equal ours // airmax-fix-stock+
    const m = this.member;
    const reuse = pay.pendingSubmit && pay.pendingSubmit.submit;
    const submit = { id: reuse ? reuse.id : newGuid(), paymentType: type, subPaymentType: null, retailOrderId: this.order.id, retailMemberId: m ? m.id : null, retailMemberNumber: m ? m.number : null,
      amount, receiveAmount, giveAmount, retailGiftCards: gift.map(c => c.id), recordCreditCard: false, retailMemberCardId: saved ? saved.id : null, creditCard: type === PaymentType.Online ? (saved ? { ...saved.masked } : { cardNo: '', expiration: '', cvv: '' }) : null, checkNumber }; // cof109~
    // Keyed card (Stripe): the card is typed only into Stripe's iframe in the UI; nothing card-related passes through here.
    pay.pendingSubmit = { submit, type, amount, receiveAmount, giveAmount, checkNumber, replaces: prevCash ? prevCash.id : null }; this.journalSnap('receive');
    // Sola Online Payment: the typed card goes ONLY into this one request (the journal / retries keep the blank creditCard)
    const solaCard = type === PaymentType.Online && this.keyedInfo().kind === 'sola' && !saved ? typedCard : null; // saved card: AIR POS gets only its id + masked card // sola109~
    const rb0 = solaCard ? { ...submit, creditCard: { ...solaCard } } : submit;
    let rb; try { rb = await this.api.receiveBegin(rb0); } finally { if (solaCard) rb0.creditCard.cardNo = rb0.creditCard.cvv = rb0.creditCard.expiration = ''; }
    if (rb && (rb.unreachable || rb.uncertain)) { // dbl109~
      const st = await this.checkReceive(submit);
      if (st === 'unknown') return fail('The connection dropped while sending the payment. Air Max will check with AIR POS before taking it again, so it can never be charged twice. Press Retry.', { retryable: true }); // ls9n~
      if (st === 'done' || st === 'begun') return this.adoptReceive(pay.pendingSubmit, st);
      pay.pendingSubmit = null; this.journalSnap('receive-absent');
      if (!rb.unreachable) return fail((PayName[type] || 'Payment') + ' failed: ' + msgOf(rb) + '. AIR POS has no record of this payment, so nothing was charged.'); // dbl109+
      return fail('The connection dropped. AIR POS has no record of this payment, so nothing was charged. Press Retry.', { retryable: true });
    }
    pay.pendingSubmit = null;
    if (!rb || !rb.success) {
      const m = msgOf(rb);
      if (type === PaymentType.CreditCard && /receive device/i.test(m)) return fail('No card terminal is set up for this station. Add/enable the card reader in AIR POS back office (payment receive devices), or take another payment type. (Server: ' + m + ')');
      return fail((PayName[type] || 'Payment') + ' failed: ' + m);
    }
    const t = { id: submit.id, type, name: PayName[type], amount, receiveAmount, giveAmount, checkNumber, status: 'done' };
    // airmax-fix-12+
    // Fix #12: only a saved card has real brand / last 4 (AIR POS RetailMemberCards). Terminal and typed cards: the slip still says CARD (so a card sale is never read as cash) but shows no brand / last 4: nothing guessed.
    { const k = saved && this._cofPicked && String(this._cofPicked.id) === String(saved.id) ? this._cofPicked : null; this._cofPicked = null;
      const slip = k && this.cardSlipLabel ? this.cardSlipLabel(k) : null; if (slip) Object.defineProperty(t, 'cardSlip', { value: slip, enumerable: false }); }
    // airmax-fix-12-
    // Request O: remember which gift cards paid (memory only, not written to the journal) so the slip can show each balance after the sale
    if (type === PaymentType.GiftCard) Object.defineProperty(t, 'giftNos', { value: gift.map(c => ({ id: c.id, number: String(c.number || '') })).filter(c => c.number), enumerable: false });
    if (prevCash) pay.tenders = pay.tenders.filter(x => x !== prevCash);
    pay.tenders.push(t); this.journalSnap('tendered');
    if (type === PaymentType.MemberAccount && m) m.availableBalance = round(m.availableBalance - amount);
    if (type === PaymentType.Online && !(rb.value && rb.value.isCompleted)) {
      const cs = rb.value && rb.value.paymentIntent && rb.value.paymentIntent.client_secret;
      t.status = 'waiting';
      if (!cs) { pay.card = { kind: 'keyed', type, submit, tenderId: t.id, status: 'waiting', message: 'Waiting for the server to confirm the keyed card…', subMessage: '', startedAt: Date.now(), polls: 0 }; if (this.keyedInfo().kind === 'sola') this.journalSnap('card-waiting'); this.pollCard(); return { ok: true, waiting: true }; } // Sola: the journal must know the payment is open (a restart keeps checking it, never takes it again) // sola109~
      pay.card = { kind: 'keyed', type, submit, tenderId: t.id, status: 'keyed', message: 'Type the card into the secure Stripe form', subMessage: '', startedAt: Date.now(), polls: 0 };
      return { ok: true, keyed: true, clientSecret: cs, message: `Keyed card ${money(amount)}: enter the card` }; // client secret goes to the UI only, never logged
    }
    if (type === PaymentType.CreditCard && !(rb.value && rb.value.isCompleted)) {
      t.status = 'waiting';
      pay.card = { submit, tenderId: t.id, status: 'waiting', message: 'Waiting for the customer to tap, insert or swipe the card on the terminal…', subMessage: '', startedAt: Date.now(), polls: 0 };
      this.journalSnap('card-waiting'); // the journal must know the terminal payment is open (a crash / expired login resumes it, never takes it again) // pb109a+
      this.pollCard();
      return { ok: true, waiting: true, message: `Card ${money(amount)} sent to the terminal` };
    }
    if (!(rb.value && rb.value.isCompleted) && type !== PaymentType.CreditCard && type !== PaymentType.Online) { t.status = 'failed'; return fail('The server did not confirm the payment. Check the order in AIR POS back office.'); }
    if (type !== PaymentType.CreditCard && type !== PaymentType.Online) { const k = await this.keptCheck(t); if (k) return k; } // AIR POS said complete: show only what it really kept // mgc1011+
    return this.afterTender(t);
  }
  // AIR POS can answer success + isCompleted for a receive it then does not keep (TestShop RO11052: a second gift card receive). // mgc1011+
  // After a cash / check / gift card / store credit payment, read the order back and count only what AIR POS kept. Nothing is ever // mgc1011+
  // sent again here (the dropped receive charged nothing: a gift card is only taken when the sale completes, TestShop Nov 1). // mgc1011+
  // null = kept (or no clear read: then Complete's own check still guards the total); a fail = not kept, tenders = AIR POS's. // mgc1011+
  async keptCheck(t) { // mgc1011+
    const pay = this.pay; let g, o, clear, kept; // mgc1011+
    for (let n = 0; n < 5; n++) { // M1 (Gordon OK Nov 3): AIR POS can be one read behind a payment it reported complete, so read the order up to 5 times (0.8 s apart) before deciding // mgc1011+
      g = await this.api.orderGet(this.order.id); o = val(g); clear = !this.replyUnclear(g) && o && o.id === this.order.id && Array.isArray(o.receives); kept = clear ? (o.receives.find(r => r.id === t.id && r.status === ReceiveCompleted) || null) : undefined; // mgc1011+
      if ((kept && round(kept.amount) >= round(t.amount)) || n === 4) break; await new Promise(r => setTimeout(r, this.keptRetryMs != null ? this.keptRetryMs : 800)); } // mgc1011+
    if (!clear && this.getRefused(g)) { const st = await this.receiveState({ id: t.id, paymentType: t.type, subPaymentType: null, retailOrderId: this.order.id, amount: t.amount, receiveAmount: t.receiveAmount, giveAmount: t.giveAmount }); kept = st === 'done' ? { amount: t.amount } : st === 'absent' ? null : undefined; } // mgc1011+
    if (kept === undefined) { this.log(`kept check: AIR POS gave no clear order read after ${t.name} ${money(t.amount)}; counted as AIR POS answered (Complete checks the total)`); return null; } // mgc1011+
    if (kept && round(kept.amount) >= round(t.amount)) return null; // mgc1011+
    if (kept === null) { t.unconfirmed = true; this.journalSnap('unconfirmed-kept'); this.log(`PAYMENT NOT CONFIRMED: AIR POS answered OK for ${t.name} ${money(t.amount)} but the order read (5 tries) does not list it; KEPT as paid, not dropped (nothing re-sent; Complete checks the total, check the order in AIR POS back office)`); return null; } // M1: never drop a payment AIR POS reported complete // mgc1011+
    const was = t.amount, got = kept ? round(kept.amount) : 0; // mgc1011+
    if (clear) pay.tenders = o.receives.filter(r => r.status === ReceiveCompleted).map(r => { const l = pay.tenders.find(x => x.id === r.id); if (l) { l.amount = round(r.amount); l.status = 'done'; return l; } return { id: r.id, type: r.paymentType, name: PayName[r.paymentType] || 'Paid', amount: round(r.amount), receiveAmount: r.receiveAmount, giveAmount: r.giveAmount, status: 'done' }; }); // mgc1011+
    else if (kept) t.amount = got; else pay.tenders = pay.tenders.filter(x => x !== t); // mgc1011+
    if (t.type === PaymentType.MemberAccount && this.member) this.member.availableBalance = round(this.member.availableBalance + was - got); // mgc1011+
    this.journalSnap('not-kept'); // mgc1011+
    const left = this.remaining(); // mgc1011+
    this.log(`PAYMENT NOT KEPT: AIR POS answered OK for ${t.name} ${money(was)} but kept ${money(got)}; paid now ${money(this.paidTotal())}, owed ${money(left)} (nothing re-sent)`); // mgc1011+
    pay.dueSeen = this.totals.due; pay.dueSig = this.cartSig(); // mgc1011+
    return fail(`AIR POS did not keep this ${t.name.toLowerCase()} payment of ${money(was)}${got > 0 ? ` (it kept only ${money(got)})` : ''}, so ${got > 0 ? 'only that is' : 'it is not'} counted. Nothing more was taken for it. Paid so far: ${money(this.paidTotal())}. ${money(left)} is left to pay.${t.type === PaymentType.GiftCard && pay.tenders.some(x => x.status === 'done' && x.type === PaymentType.GiftCard) ? ' AIR POS keeps one gift card payment per sale: take the rest another way (cash, card, check or store credit).' : ''}`, { notKept: true, kept: got, remaining: left }); // mgc1011+
  } // mgc1011+
  async afterTender(t) {
    const left = this.remaining();
    if (left > 0) return { ok: true, message: `${t.name} ${money(t.amount)} received. ${money(left)} left to pay.`, remaining: left };
    return this.finishSale();
  }
  // order.ts useOrderCompleteManager.startPaymentCheck — runs here in the background, UI just watches state
  stopCardPoll() { if (this.cardTimer) clearTimeout(this.cardTimer); this.cardTimer = null; this.cardToken = (this.cardToken || 0) + 1; }
  pollCard() {
    this.stopCardPoll(); const token = this.cardToken;
    const once = async () => {
      const c = this.pay && this.pay.card; if (!c || c.status !== 'waiting' || token !== this.cardToken) return;
      c.polls++;
      const tc = Date.now(); // the next check is counted from the START of this one (was: from its answer, so 0.5 s + round trip) // rcp1011+
      const r = await this.api.receiveCheck(c.submit);
      if (token !== this.cardToken || c.status !== 'waiting') return;
      const v = (r && r.value) || {};
      if (r && r.success && v.isCompleted) {
        c.status = 'approved'; c.message = 'Card approved'; c.subMessage = '';
        const t = this.pay.tenders.find(x => x.id === c.tenderId); if (t) t.status = 'done';
        this.pay.result = await this.afterTender(t);
        // scf1010: card approved for only PART of the sale: it is a paid line now, so close the card box and go on to the rest (Ari OK 2:03 PM ET Nov 1) // scf1010+
        if (this.pay && this.pay.card === c && !(this.pay.result && this.pay.result.completed)) { this.pay.card = null; this.journalSnap('card-approved'); } // scf1010+
        return;
      }
      if (r && r.unreachable) { // network drop: keep checking the same payment; never start a new one
        c.offline = (c.offline || 0) + 1; c.subMessage = 'Connection to AIR POS lost. Still checking this card payment; do not take the card again.';
        this.cardTimer = setTimeout(once, POLL.idle); return;
      }
      if (r && r.loggedOut) { c.subMessage = 'Signed out of AIR POS. Log in again: this card payment is checked again right after login.'; return; }
      c.offline = 0; c.message = v.message || (r && r.message) || c.message; c.subMessage = v.subMessage || '';
      if (v.shouldReissue) { // declined / terminal error: stop and let the cashier retry or cancel
        c.status = 'declined'; const t = this.pay.tenders.find(x => x.id === c.tenderId); if (t) t.status = 'failed';
        return;
      }
      const el = Date.now() - c.startedAt;
      if (el >= POLL.warnAfter && !c.subMessage) { c.slow = true; c.subMessage = c.kind === 'keyed' && c.accepted ? KEYED_SLOW : 'Still waiting after 2 minutes. Check the terminal screen: if it shows Approved, wait a moment; otherwise press Cancel card.'; } // ls9k~
      this.cardTimer = setTimeout(once, Math.max(50, (el < POLL.fastFor ? POLL.fast : (el < POLL.warnAfter ? POLL.slow : POLL.idle)) - (Date.now() - tc))); // rcp1011~
    };
    once();
  }
  async cardCancel(opts) { // ls9k~
    const c = this.pay && this.pay.card; if (!c) return fail('No card payment to cancel');
    if (c.status === 'approved') return fail('The card was already approved');
    if (c.kind === 'keyed' && c.accepted) { const v = await this.keyedVerify(c); if (v) return v; const old2m = Date.now() - c.startedAt >= POLL.warnAfter; if (old2m && opts && opts.release === true) return this.keyedRelease(c); if (!this.cardTimer) this.pollCard(); return fail('Stripe already accepted this card, so it cannot be cancelled here (the customer would be charged with nothing on the sale). Air Max keeps checking AIR POS; the sale finishes as soon as AIR POS records it.', { keyedAccepted: true, canRelease: old2m }); } // mny109d+ // ls9n~ // ls9k~
    if (c.kind === 'keyed') { this.stopCardPoll(); const v = await this.keyedVerify(c); if (v) return v; } // mny109d+ form open: check AIR POS did not record it first // mny109d+
    this.stopCardPoll();
    const r = c.status === 'waiting' || c.status === 'keyed' ? await this.api.receiveCancel(c.submit) : { success: true };
    this.pay.tenders = this.pay.tenders.filter(t => t.id !== c.tenderId);
    this.pay.card = null;
    if (r && r.success === false) return fail('Cancel sent, but the server said: ' + msgOf(r) + ' — check the terminal before trying again.');
    return { ok: true, message: 'Card payment cancelled. Choose another way to pay or try the card again.' };
  }
  async cardRetry() {
    const c = this.pay && this.pay.card; if (!c || c.status !== 'declined') return fail('Nothing to retry');
    const amount = c.submit.amount; this.pay.tenders = this.pay.tenders.filter(t => t.id !== c.tenderId); this.pay.card = null;
    return this.tender({ type: c.type || PaymentType.CreditCard, amount });
  }
  // AIR POS refused Complete: "received amount is less than the amount due". Our total was out of date. Re-sync the paid lines
  // with what AIR POS recorded (never re-sent), recalculate, and reopen payment for what is still owed.
  // hf1231 begin
  // 1.2.3.1: one log line per refused Complete: order number, register total, AIR POS total, payments (type + amount only)
  async logRefusal(why, o) {
    try {
      if (o === undefined) o = val(await this.api.orderGet(this.order.id).catch(() => null));
      const paid = ((this.pay && this.pay.tenders) || []).filter(t => t.status === 'done').map(t => `${PayName[t.type] || t.type} ${money(t.amount)}`).join(', ') || 'none';
      const srv = o ? ((o.receives || []).filter(r => r.status === 20).map(r => `${PayName[r.paymentType] || r.paymentType} ${money(r.amount)}`).join(', ') || 'none') : '?';
      const ks = o ? Object.keys(o).filter(k => /amount|tax/i.test(k) && typeof o[k] === 'number') : [];
      const tot = o ? (ks.sort((a, b) => (/^(total|tax|order)/i.test(b) ? 1 : 0) - (/^(total|tax|order)/i.test(a) ? 1 : 0)).slice(0, 12).map(k => `${k} ${o[k]}`).join(', ') || 'no amounts in reply') : '?';
      this.log(`COMPLETE REFUSED ${(o && o.number) || this.order.number || this.order.id}: register total ${money(this.totals.due)}, AIR POS order [${tot}] (status ${o ? o.status : '?'}), register payments [${paid}], AIR POS payments [${srv}]: ${String(why || '').slice(0, 200)}`);
    } catch (e) { this.log('refusal log failed: ' + e.message); }
  }
  // 1.2.3.1: "Check AIR POS again". Reads the order; never sends a payment. Completed there: finish here (receipt as usual).
  // Not completed: the paid lines and the total are re-read from AIR POS and the screen shows what is still owed.
  async payRecheck() {
    const pay = this.pay; if (!pay) return fail('No payment is open');
    if (pay.card && (pay.card.status === 'waiting' || pay.card.status === 'keyed')) return fail('A card payment is open. Finish or cancel it first.');
    this.log(`CHECK AGAIN pressed ${this.order.number || this.order.id}: register paid ${money(this.paidTotal())} of ${money(this.totals.due)}; last Finish sale answer: ${pay.refusal ? '[' + pay.refusal.kind + '] ' + pay.refusal.text + (pay.refusal.items && pay.refusal.items.length ? ' | short: ' + pay.refusal.items.join('; ') : '') : 'none recorded since this screen opened'}`); // airmax-fix-stock+
    const g = await this.api.orderGet(this.order.id); if (g && g.unreachable) return fail('No connection to AIR POS. Your payments are safe; try again when the connection is back.', { retryable: true });
    if (this.replyUnclear(g)) return fail('AIR POS did not give a clear answer, so it is not known yet what was paid there. Payments already taken are kept; do not charge the customer again. Press Check AIR POS again in a moment.', { retryable: true }); // dbl109+
    const o = val(g);
    if (o && o.status === OrderStatus.Completed) { this.log('CHECK AGAIN: AIR POS shows the sale completed'); return this.finishSale(); }
    if (!o || !o.id) return fail('AIR POS has no record of this sale yet. Nothing was paid there; take the payment again.');
    this.log('CHECK AGAIN: order not completed in AIR POS, re-reading payments and total');
    const r = await this.shortRefused(pay, o); if (r.owed || r.stale) return r;
    const got = (o.receives || []).filter(x => x.status === 20).map(x => `${PayName[x.paymentType] || 'Paid'} ${money(x.amount)}`).join(', ') || 'none';
    pay.lastError = `AIR POS has not finished this sale yet. Payments AIR POS has: ${got}. Nothing was sent or charged. Press Finish sale to try again, or Esc to go back to the sale (payments kept).`;
    pay.lastError = this.refusalNote() + pay.lastError; // airmax-fix-stock+
    return fail(pay.lastError, { completeFailed: true });
  }
  // hf1231 end
  // airmax-fix-stock: the reason AIR POS (or the connection) gave when Finish sale did not finish is kept in its own field, pay.refusal, and logged with the short items. // airmax-fix-stock+
  // payRecheck / the red bar / a restart never replace it. Nothing here sends a payment: it only records and words what happened. // airmax-fix-stock+
  // Before any payment is taken (after the Save, so AIR POS has the order as we will finish it): compare AIR POS's own due (amount + tax of the saved order) // airmax-fix-stock+
  // with ours. A difference above 10 cents means Complete would refuse after the card is charged (a live order: AIR POS total differed from card). // nostore1103 // airmax-fix-stock+
  async dueMismatch(pay) { // airmax-fix-stock+
    try { // airmax-fix-stock+
      if (this.totals.pointDiscount > 0) return null; const sig = this.cartSig() + '|' + this.totals.due; if (pay.dueOkSig === sig) return null; // airmax-fix-stock+
      const o = val(await this.api.orderGet(this.order.id).catch(() => null)); if (!o || !Array.isArray(o.subs) || !o.subs.length || o.amount == null || o.tax == null) return null; const net = Number(o.amount), tax = Number(o.tax); if (!Number.isFinite(net) || !Number.isFinite(tax)) return null; // airmax-fix-stock+
      const theirs = round(round(net, 2) + round(tax, 2), 2), ours = this.totals.due, d = Math.abs(theirs - ours); // airmax-fix-stock+
      if (d <= 0.10) { pay.dueOkSig = sig; if (d > 0.02) this.log(`total check: AIR POS ${money(theirs)} vs Air Max ${money(ours)} (rounding, ok)`); return null; } // airmax-fix-stock+
      this.log(`TOTAL MISMATCH ${this.order.id}: AIR POS works out ${money(theirs)} (net ${money(net)} + tax ${money(tax)}), Air Max has ${money(ours)}; order discount sent ${o.orderDiscountAmount == null ? '?' : money(o.orderDiscountAmount)}, nothing charged`); // airmax-fix-stock+
      return fail(`AIR POS works out ${money(theirs)} for this sale, but Air Max has ${money(ours)}. Nothing was charged. Press Esc to go back to the sale and press Payment again; if it shows this again, call support (the sale is safe, no money was taken).`, { dueMismatch: true, due: ours, airposDue: theirs }); // airmax-fix-stock+
    } catch (e) { return null; } // airmax-fix-stock+
  } // airmax-fix-stock+
  // AIR POS refused Complete with "received amount is less than the amount due" although the register is fully paid: recalculate, re-send the order // airmax-fix-stock+
  // (order discount over all current lines) and ask Complete once more. Never sends a payment, only the order and the finish. // airmax-fix-stock+
  async resendAndComplete(pay, c0) { // airmax-fix-stock+
    try { // airmax-fix-stock+
      this.log('FINISH SALE: AIR POS says received < due; recalculating and re-sending the order, then Complete once more (no payment is re-sent)'); // airmax-fix-stock+
      if (!(await this.recalc()) || this.remaining() > 0.004) return c0; const sv = await this.api.orderSave(this.saveSubmit(true)); if (!sv || !sv.success) return c0; // airmax-fix-stock+
      const m = this.member, a = pay.auth || {}; const c2 = await this.api.complete({ id: this.order.id, retailMemberId: m ? m.id : null, points: m ? this.usingPoints : 0, needAuthorization: a.needAuthorization, authorizationType: a.authorizationType, authorizationOperatorId: a.managerId }); // airmax-fix-stock+
      return c2 && !c2.unreachable && !c2.uncertain ? c2 : c0; // airmax-fix-stock+
    } catch (e) { return c0; } // airmax-fix-stock+
  } // airmax-fix-stock+
  async noteRefusal(kind, raw) { // airmax-fix-stock+
    const pay = this.pay; if (!pay) return; // airmax-fix-stock+
    const text = String(raw || 'no reply').replace(/\s+/g, ' ').slice(0, 300); let items = []; // airmax-fix-stock+
    pay.refusal = { kind, text, items, at: new Date().toISOString() }; // saved first: a slow stock look-up below can never lose the reason // airmax-fix-stock+
    if (/insufficient inventory/i.test(text)) { let tm; try { const st = await Promise.race([this.stockShort(), new Promise(r => { tm = setTimeout(() => r(null), 5000); })]); items = [...new Set(((st && st.short) || []).map(x => `${x.name} (${x.stock} in stock, selling ${x.qty})`))]; pay.refusal.items = items; } catch (e) { /* the reason is kept without the item names */ } finally { clearTimeout(tm); } } // airmax-fix-stock+
    this.log(`FINISH SALE NOT DONE [${kind}] ${this.order.number || this.order.id}: ${text}${items.length ? ' | short: ' + items.join('; ') : ''} | register paid ${money(this.paidTotal())} of ${money(this.totals.due)}, nothing re-sent`); // airmax-fix-stock+
  } // airmax-fix-stock+
  refusalNote() { const r = this.pay && this.pay.refusal; if (!r) return ''; const lead = r.kind === 'no reply' ? 'AIR POS did not answer when the sale was finished' : r.kind === 'server error' ? 'AIR POS had an error finishing the sale' : 'AIR POS refused to finish the sale'; return `${lead}: ${r.text}${r.items && r.items.length ? ' | short: ' + r.items.join('; ') : ''}. `; } // airmax-fix-stock+
  async shortRefused(pay, o) {
    if (o && Array.isArray(o.receives)) {
      const done = o.receives.filter(r => r.status === 20);
      if (done.length) pay.tenders = done.map(r => { const l = pay.tenders.find(t => t.id === r.id) || {}; return { ...l, id: r.id, type: r.paymentType, name: l.name || PayName[r.paymentType] || 'Paid', amount: r.amount, receiveAmount: r.receiveAmount ?? l.receiveAmount, giveAmount: r.giveAmount ?? l.giveAmount, status: 'done' }; });
    }
    if (!(await this.recalc())) { pay.lastError = 'AIR POS says the sale is not fully paid. ' + STALE_MSG; this.journalSnap('short'); return fail('AIR POS says the sale is not fully paid, and the total could not be checked again. ' + STALE_MSG + ' Do not take more money until the amount owed shows.', { completeFailed: true, retryable: true, stale: true }); }
    const left = this.remaining();
    this.log(`complete refused (received < due): server total ${money(this.totals.due)}, paid ${money(this.paidTotal())}, owed ${money(left)}`);
    if (!(left > 0)) { pay.lastError = 'AIR POS says the sale is not fully paid, but its total matches the payments. Check the order in AIR POS back office before taking more money.'; return fail(pay.lastError, { completeFailed: true }); }
    return this.owedAfterRefusal(pay, left);
  }
  owedAfterRefusal(pay, left) {
    pay.dueSeen = this.totals.due; pay.dueSig = this.cartSig(); // the cashier is shown this total now: not a surprise rise later // ls9a+
    pay.lastError = null; this.journalSnap('owed');
    return fail(`AIR POS says ${money(left)} is still owed on this sale (total ${money(this.totals.due)}). Your payments are safe: the ${money(this.paidTotal())} already taken is kept. Take ${money(left)} more, or press Esc to go back to the sale (payments kept).`, { owed: left, remaining: left }); // hf1231~
  }
  // order.ts executeOrderComplete (+ auto drawer / auto print)
  async finishSale() {
    if ((this.subs || []).some(s => s._unconfirmed)) return fail('AIR POS is still checking an item that was just scanned. Try again in a moment.', { retryable: true, unconfirmed: true }); // instant scan: never pay, complete or hold an unchecked line // is1011+
    const tPaid = Date.now(); // spd1010+
    await this.settle(); // the total from the last item added is in first // add1011+
    if (!this.subs.length) return fail('This sale has no items, so there is nothing to finish. If a card was just approved, that sale is already finished.', { empty: true }); // mny109f+
    const pay = this.pay, a = (pay && pay.auth) || { needAuthorization: false, authorizationType: 0, managerId: null };
    if (this.totals.due <= 0 && !(pay && pay.tenders.length)) { // fully covered by points / 100% discount: Save(isPending=false) completes it
      const sv = await this.api.orderSave(this.saveSubmit(false)); if (!sv || !sv.success) return fail('Save failed: ' + msgOf(sv));
    }
    if (pay && pay.tenders.length && this.totals.stale) {
      if (!(await this.recalc())) return fail(STALE_MSG, { retryable: true, stale: true });
      const left = this.remaining(); if (left > 0) return this.owedAfterRefusal(pay, left);
    }
    const m = this.member;
    this.journalSnap('completing');
    if (this.autoPrintOn('sale')) { const oid = this.order.id; this._cfgEarly = { orderId: oid, p: this.templateConfig(oid).catch(() => null) }; } // receipt prefetch: ask for the receipt template list WHILE Complete runs (read only; used only once Complete succeeded, nothing printed before) // rp1011+
    let c = await this.api.complete({ id: this.order.id, retailMemberId: m ? m.id : null, points: m ? this.usingPoints : 0, needAuthorization: a.needAuthorization, authorizationType: a.authorizationType, authorizationOperatorId: a.managerId });
    const completeMs = Date.now() - tPaid; // spd1010+
    if (c && c.unreachable) { // reply lost: did the server finish it?
      let o = null; // AIR POS can show the order as not-finished for a moment after Complete: look up to 3 times
      for (let k = 0; k < 3; k++) { if (k) await new Promise(z => setTimeout(z, 700)); o = val(await this.api.orderGet(this.order.id)); if (o && o.status === OrderStatus.Completed) break; }
      if (!(o && o.status === OrderStatus.Completed)) await this.noteRefusal('no reply', msgOf(c)); // airmax-fix-stock+
      if (o && o.status === OrderStatus.Completed) c = { success: true };
      else { if (pay) pay.lastError = this.refusalNote() + 'No connection to AIR POS. The payment is safe; press Finish sale when the connection is back.'; return fail('Payment taken, but the connection to AIR POS dropped before the sale was finished. ' + this.refusalNote() + 'Nothing is lost: press Finish sale (Retry) when the connection is back.', { completeFailed: true, retryable: true }); } // airmax-fix-stock~
    }
    if (c && !c.success && pay && pay.tenders.length && SHORT_RE.test(msgOf(c))) { c = await this.resendAndComplete(pay, c); if (c && !c.success) await this.noteRefusal('refused', msgOf(c)); } // AIR POS says received < due: re-send the order with the discount over all lines, then Complete once more; if it still refuses keep the reason // airmax-fix-stock+
    if (c && !c.success && /insufficient inventory/i.test(msgOf(c))) this.learnStockRule('refuses', msgOf(c)); // from now on: stopped BEFORE payment
    if (c && c.success && pay && (pay.stockShort || []).length) this.learnStockRule('allows', 'oversold sale completed');
    if (c && !c.success) { // refused (e.g. pressing Finish again on a sale that did finish): if AIR POS shows it completed, it is done
      const o = val(await this.api.orderGet(this.order.id).catch(() => null)); if (o && o.status === OrderStatus.Completed) { this.log('complete refused but order is completed: treating as done'); c = { success: true }; }
      else if (pay && SHORT_RE.test(msgOf(c))) { this.logRefusal(msgOf(c), o); return this.shortRefused(pay, o); } // hf1231~
    }
    if (!c || !c.success) {
      let why = friendlyComplete(msgOf(c)); // stk1010~
      if (/insufficient inventory/i.test(msgOf(c))) { const st = await this.stockShort().catch(() => null); const names = [...new Set(((st && st.short) || []).map(x => x.name).filter(Boolean))].join(', '); why = `not enough stock (${msgOf(c)}). Payments are kept (nothing refunded, nothing charged again). Add stock for ${names || 'the item'} in AIR POS back office (Inventory), then press Finish sale`; } // stk1010+
      this.logRefusal(msgOf(c)); // 1.2.3.1: what was refused, with both totals and the payments (types and amounts only) // hf1231+
      await this.noteRefusal(c && c.uncertain ? 'server error' : 'refused', msgOf(c)); // airmax-fix-stock+
      const w = String(why || '').replace(/\.+$/, '') + '.'; // hf1231+
      if (pay) pay.lastError = 'AIR POS did not finish the sale: ' + w + ' Your payments are safe. Press Finish sale to try again, Check AIR POS again, or Esc to go back to the sale (payments kept).'; // hf1231~
      return fail('Payment taken, but AIR POS did not finish the sale: ' + w + ' Your payments are safe. Press Finish sale to try again, or Esc to go back to the sale (payments kept).', { completeFailed: true }); // hf1231~
    }
    if (pay) pay.lastError = null;
    if (pay) pay.refusal = null; // airmax-fix-stock+
    const tenders = pay ? pay.tenders.filter(t => t.status === 'done') : [];
    const change = round(tenders.reduce((s, t) => s + (t.giveAmount || 0), 0));
    const orderId = this.order.id; this.lastOrderId = orderId;
    if (this.order.note) this.saveNoteFor(orderId, this.order.note);
    const gifts = this.giftSummary ? this.giftSummary() : []; // masked numbers for the gift card list slip
    // Request O: gift cards SOLD / reloaded (full numbers from the lines) and USED to pay (from the tenders), for "balance after sale"
    const giftSold = this.giftLines ? this.giftLines().slice().reverse().map(s => String(s.number || '')) : [];
    const giftUsed = tenders.filter(t => t.type === PaymentType.GiftCard).flatMap(t => (t.giftNos || []).map(c => ({ number: c.number, used: (t.giftNos.length === 1 ? t.amount : null) })));
    if (gifts.length || giftUsed.length) this.saveGiftsFor(orderId, gifts, giftUsed.map(u => ({ masked: maskNo(u.number), used: u.used })));
    // airmax-fix-12+
    { const cs = tenders.filter(t => t.cardSlip || t.type === PaymentType.CreditCard || t.type === PaymentType.Online).map(t => ({ label: t.cardSlip || 'CARD (brand/last 4 n/a)', amount: t.amount })); if (cs.length && this.saveCardSlipFor) this.saveCardSlipFor(orderId, cs); }
    // airmax-fix-12-
    const result = { ok: true, completed: true, message: `Sale complete.${change > 0 ? ' Change ' + money(change) : ''}`, orderId, due: this.totals.due, change, tenders: tenders.map(t => ({ name: t.name, amount: t.amount, receiveAmount: t.receiveAmount })), drawer: null, print: null, giftCards: gifts };
    const cashLike = tenders.some(t => t.type === PaymentType.Cash || t.type === PaymentType.Check);
    const giftRcpt = this.giftReceiptOn ? this.giftReceiptOn() : false; this.giftReceiptFor = null;
    const giftPick = giftRcpt && this.giftPickNow ? this.giftPickNow() : null; // ticked lines (F10 picker, before the cart is cleared); null = the store template as before // gp1011+
    // airmax-fix-18+
    if (this.discLinesKeep) this.discLinesKeep(orderId); // #18 print only: this sale's lines and their discounts, read for its receipt before the cart is cleared
    // airmax-fix-18-
    this.resetOrder(); { const jo = this.recoveryPending && this.journal.read(); if (!(jo && jo.kind === 'sale' && jo.order && jo.order.id !== orderId)) this.journal.clear('sale complete ' + orderId); } // final on the server; an earlier unfinished sale still being checked keeps its journal // pb109b~
    this.lastSaleAt = Date.now();
    // Owner request L: the sale is final on the server, so drawer / receipt / gift receipt run in the BACKGROUND and never
    // hold the sale. A failure only leaves a small fading note (hwNotes); reprint stays available (History / Print Receipt).
    const jobs = [];
    if (this.autoDrawer(cashLike)) jobs.push(['drawer', () => this.drawer(true), this.drawerWaitMs() + 1500]);
    const giftBal = (gifts.length || giftUsed.length) && this.giftBalances ? () => this.giftBalances(orderId, giftSold, giftUsed).catch(e => this.log('gift balance look-up failed: ' + e.message)) : null;
    if (this.autoPrintOn('sale')) this.prefetchReceipt(orderId); // 4:01 PM: AIR POS builds the receipt PDF WHILE the drawer kicks // cp1010~
    if (this.autoPrintOn('sale')) jobs.push(['receipt', async () => { if (giftBal) await giftBal(); return this.printOrder(orderId); }, this.hwPrintMs || 30000]); // balances are read from AIR POS AFTER Complete, then printed // cp1010~
    else if (giftBal) giftBal(); // no auto print: still fetched in the background so a reprint shows the balances
    if (giftRcpt) jobs.push(['gift', giftPick ? () => this.printGiftPick(orderId, giftPick) : () => this.printGiftReceipt(orderId), this.hwPrintMs || 30000]); // the store's own AIR POS gift template; some items unticked = a no-price slip of the ticked ones // gp1011~
    const ST = { at: new Date().toISOString(), orderTail: String(orderId).slice(-6), completeMs, screenMs: Date.now() - tPaid, jobs: jobs.map(j => j[0]).join(',') }; // spd1010+
    result.hwPending = jobs.map(j => j[0]); Object.defineProperty(result, 'hwJob', { value: this.hwBackground(jobs, orderId, { t0: tPaid, ST }), enumerable: false }); // not sent to the screen; tests can await it // spd1010~
    const done = { orderId, due: result.due, change, tenders: result.tenders, tendered: round(tenders.reduce((s, t) => s + (t.receiveAmount || t.amount), 0)) };
    done.result = result; this.completed = done; // the UI picks this up when a card poll finished the sale in the background
    return result;
  }
  // kept for older UI/tests: cash for the full amount in one call
  async payCash(tendered) {
    const s = await this.startPay(); if (!s.ok) return s; if (s.needManager) return fail(s.message, { needManager: true });
    return this.tender({ type: PaymentType.Cash, tendered });
  }

  // ---------------- hardware: built-in helper first, AIR POS service (:20001) as fallback ----------------
  hwModes() { const m = this.settings.hardware; return m === 'builtin' ? ['builtin'] : m === 'airpos' ? ['airpos'] : ['builtin', 'airpos']; }
  printerName() { return this.settings.printerName || this.term().printerName || ''; }
  hwErr(e) {
    const zh = { '本机未安装任何打印机，无法打印或打开钱箱': 'No printer is installed on this PC, so nothing can be printed and the cash drawer cannot be opened.' };
    return zh[e] || e || 'failed';
  }
  async deviceInfo() {
    if (this.hwModes().includes('builtin') && this.hw.present) {
      const r = await this.hw.deviceInfo();
      if (r.ok && r.value && r.value.deviceId) { this.api.device = { deviceId: r.value.deviceId, oldDeviceId: r.value.oldDeviceId, deviceName: r.value.deviceName }; this.hwStatus = { via: 'builtin', message: 'Built-in printer/drawer support ready' }; return { ok: true, value: r.value }; }
      this.log('HW helper deviceInfo failed: ' + (r.error || ''));
    }
    if (this.hwModes().includes('airpos')) {
      const r = await this.api.deviceInfo();
      if (r && r.success) { this.hwStatus = { via: 'airpos', message: 'Using the AIR POS hardware service' }; return { ok: true, value: r.value }; }
    }
    this.hwStatus = { via: null, message: 'No printer/drawer support found on this PC' };
    return fail(this.hwStatus.message);
  }
  async hwDo(label, builtin, airpos) {
    const errs = [];
    for (const mode of this.hwModes()) {
      if (mode === 'builtin') {
        if (!this.hw.present) { errs.push('built-in helper not available on this system'); continue; }
        const r = await builtin(); if (r.ok) { this.hwStatus.via = 'builtin'; return { ok: true, message: label, via: 'builtin' }; }
        const e = this.hwErr(r.error); if (!r.crashed && !r.timeout && !r.unavailable) return fail(label.replace(/ (sent|opened).*$/, '') + ' failed: ' + e, { hw: 'error' });
        errs.push(e);
      } else {
        const r = await airpos();
        if (r && r.success) { this.hwStatus.via = 'airpos'; return { ok: true, message: label + ' (via AIR POS service)', via: 'airpos' }; }
        if (r && r.unreachable) { errs.push('AIR POS service not running'); continue; }
        return fail('Printer/drawer: ' + this.hwErr(r && r.message), { hw: 'error' });
      }
    }
    return fail('Printer/drawer not available: ' + errs.join('; ') + '. The sale is saved; you can reprint later.', { hw: 'absent' });
  }
  // Request P: RetailBillTemplateConfigGet. The store's template list (names, default, fields) is kept 10 min and reused by the
  // gift-receipt check; the call itself is still made per order because its answer carries that order's orderPrintId and
  // line ids (re-using another order's would print the wrong receipt). See PLAN-payment-side-panel.md, section P.
  async templateConfig(orderId) {
    const cfg = val(await this.api.billTemplateConfigGet(orderId)) || {};
    if (Array.isArray(cfg.templates)) this._tplCache = { at: Date.now(), orderId, templates: cfg.templates, defaultTemplateId: cfg.defaultTemplateId };
    return cfg;
  }
  // only the list loaded for THIS order (1.2.3 fix: a list cached from an earlier sale could name a template the store has since removed)
  templateList(orderId) { const c = this._tplCache; return c && c.orderId === orderId && Date.now() - c.at < 10 * 60 * 1000 ? c : null; }
  async printPdfBase64(b64, label) {
    return this.hwDo(label, () => this.hw.printPdf(b64, this.printerName()), () => this.api.printBillContent({ billBase64: b64 }, this.printerName()));
  }
  async openDrawerRaw() {
    return this.hwDo('Drawer opened', () => this.hw.drawer(this.printerName(), this.settings.drawerKind), () => this.api.openCashbox(this.printerName()));
  }
  async drawerCore(ordering = false, managerPassword) {
    // order.ts handleOpenCashbox: ordering || manager -> open; else cashBoxOpenNeedVerify -> identity verify first
    if (!ordering && !this.isManager()) {
      if (this.basic().cashBoxOpenNeedVerify) {
        if (!managerPassword) return fail('Password needed to open the drawer', { needPassword: true });
        const v = await this.api.verify(this.identity.userName, managerPassword);
        if (!v || !v.success) return fail(msgOf(v) || 'Verification failed');
      } else return fail('Your user is not allowed to open the drawer without a sale (same rule as AIR POS).');
    }
    return this.openDrawerRaw();
  }
  // When the drawer opens by itself after a sale / refund (Settings > "Open drawer after a sale"):
  //   cash (default) = when cash or a check was taken / given back; every = after every sale; off = never;
  //   airpos = follow the AIR POS terminal setting "auto open cash drawer" (the only rule before 1.2.0, which left the
  //   drawer shut on cash sales when that AIR POS setting was off).
  drawerAutoMode() { const m = this.settings.drawerAutoOpen; return ['cash', 'every', 'airpos', 'off'].includes(m) ? m : (this.settings.drawerOnlyForCash === false ? 'every' : 'cash'); }
  autoDrawer(cashLike) {
    const m = this.drawerAutoMode();
    if (m === 'off') return false; if (m === 'every') return true; if (m === 'cash') return !!cashLike;
    return !!this.term().autoOpenCashDrawer && (!!cashLike || this.settings.drawerOnlyForCash === false);
  }
  drawerWaitMs() { return 5000; } // overridden by printing.js (Settings > drawer wait)
  // "Open Drawer" on the Sale complete / Return complete screen: part of that sale (AIR POS opens for a sale without
  // asking), so a cashier without the no-sale right is not refused. After 10 minutes it is a normal no-sale open.
  async drawerForSale(managerPassword) {
    const recent = this.lastSaleAt && Date.now() - this.lastSaleAt < DRAWER_SALE_MS;
    return this.drawer(!!recent, managerPassword);
  }
  async printers() {
    if (this.hw.present && this.settings.hardware !== 'airpos') {
      const r = await this.hw.printers(this.printerName());
      if (r.ok) { const v = r.value || {}; const def = /not set/i.test(v.default || '') ? '' : v.default; return { ok: true, via: 'builtin', printers: v.printers || [], default: def || '', resolved: v.resolved || '' }; }
    }
    const r = await this.api.getPrinters();
    if (r && r.success) return { ok: true, via: 'airpos', printers: (val(r) || []).map(p => (typeof p === 'string' ? p : p.name || p.printerName)).filter(Boolean), default: '', resolved: '' };
    return { ok: true, via: null, printers: [], default: '', resolved: '', message: 'Printer list not available on this PC' };
  }
  async testPrint() {
    const id = this.identity || {};
    const b64 = testPagePdf(['Air Max test page', id.shopName ? 'Shop: ' + id.shopName : '', 'Printer: ' + (this.printerName() || '(automatic)'), new Date().toLocaleString('en-US'), 'If you can read this, printing works.'].filter(Boolean)); // ls9n~
    return this.printPdfBase64(b64, 'Test page sent to printer');
  }
  // BillPrint.ts handlePrintBill: RetailOrderBillContentGet returns the receipt PDF (billBase64)
  // Owner 4:01 PM ("very very slow to print"): every step of the receipt path is timed (this.lastPrintTimings, the log line
  // "print timings" and Printer diagnostics). The two AIR POS calls (template config, receipt PDF) are fetched as soon as the
  // sale completes, WHILE the drawer kick runs in the helper, instead of after it (prefetchReceipt).
  async receiptPdfs(orderId, choice) {
    const T = {}; let t0 = Date.now();
    const early = this._cfgEarly && this._cfgEarly.orderId === orderId ? this._cfgEarly : null; if (early) this._cfgEarly = null; const eCfg = early && await early.p, cfg = (eCfg && Array.isArray(eCfg.templates) ? eCfg : null) || await this.templateConfig(orderId); /* F5 fix: an error answer to the early request is not a template list: ask again, as before */ T.templateConfigMs = Date.now() - t0; T.templateConfigEarly = !!early; // receipt prefetch: the template list asked for while Complete ran (same order only) // rp1011~
    const t = cfg.templates || [], pdfs = [];
    // 1.2.3 fix: a named template (e.g. the gift receipt) that this order's list doesn't have must never fall back to the normal receipt (with prices)
    if (choice && choice.templateIds && choice.templateIds.length && !choice.templateIds.some(id => t.some(x => x.id === id))) return fail('That receipt template is no longer in AIR POS', { noTemplate: true });
    t0 = Date.now();
    if (t.length > 1 || (t.length === 1 && (t[0].fields || []).length > 0)) {
      // Owner (1.2.0): printing is ONE action, never a template/options dialog: no choice = the store's default template
      // (AIR POS BillPrintDrawer default, else the first) with its default field text.
      if (!choice || !choice.templateIds || !choice.templateIds.length) choice = { templateIds: [t.some(x => x.id === cfg.defaultTemplateId) ? cfg.defaultTemplateId : t[0].id] };
      for (const tplId of choice.templateIds) {
        const tpl = t.find(x => x.id === tplId); if (!tpl) continue;
        const ex = {}; (tpl.fields || []).forEach(f => { ex[f.name] = f.content || ''; });
        Object.assign(ex, (choice.extraInfos && choice.extraInfos[tplId]) || {});
        const extra = { orderPrintId: cfg.orderPrintId, templateId: tplId, extraInfos: ex };
        if (tpl.allowDetailsSelection) extra.orderSubIds = (cfg.orderSubs || []).map(x => x.id);
        const b = await this.api.billContentGet(orderId, extra);
        if (!b || !b.success || !b.value || !b.value.billBase64) pdfs.push(fail('Could not get the receipt: ' + msgOf(b)));
        else pdfs.push({ ok: true, b64: b.value.billBase64, label: `Receipt (${tpl.name}) sent to printer` });
      }
      if (!pdfs.length) return fail('No template chosen');
    } else {
      const b = await this.api.billContentGet(orderId);
      if (!b || !b.success || !b.value || !b.value.billBase64) return fail('Could not get the receipt: ' + msgOf(b));
      pdfs.push({ ok: true, b64: b.value.billBase64, label: 'Receipt sent to printer' });
    }
    T.receiptPdfMs = Date.now() - t0;
    return { ok: true, pdfs, timings: T };
  }
  prefetchReceipt(orderId) {
    if (!orderId) return; this._rcptPre = this._rcptPre || new Map();
    const p = this.receiptPdfs(orderId).catch(e => fail('Could not get the receipt: ' + e.message)); p.at = Date.now();
    this._rcptPre.set(orderId, p); setTimeout(() => { if (this._rcptPre.get(orderId) === p) this._rcptPre.delete(orderId); }, 120000).unref?.();
  }
  // BillPrint.ts handlePrintBill: RetailOrderBillContentGet returns the receipt PDF (billBase64)
  async printOrderCore(orderId, choice) {
    orderId = orderId || this.lastOrderId; if (!orderId) return fail('No sale to print');
    const tAll = Date.now();
    // Request P: read the Windows printer list WHILE AIR POS answers (they used to run one after the other)
    if (this.printerInfo && this.hw && this.hw.present && this.settings.hardware !== 'airpos') (this.printerInfoQuick ? this.printerInfoQuick() : this.printerInfo()).catch(() => null); // spd1010~
    const pre = !choice && this._rcptPre && this._rcptPre.get(orderId); if (pre) this._rcptPre.delete(orderId);
    const tW = Date.now(); const got = pre ? await pre : await this.receiptPdfs(orderId, choice);
    const T = { ...(got.timings || {}), prefetched: !!pre, waitForAirposMs: Date.now() - tW };
    if (!got.ok) { this.notePrintTimings(T, tAll); return got; }
    // airmax-fix-18+
    if (this.discLinesPdf && !(choice && choice.templateIds && choice.templateIds.length)) { const t18 = Date.now(); for (const x of got.pdfs) if (x.ok) x.b64 = await this.discLinesPdf(orderId, x.b64, x.label).catch(() => x.b64); T.discLinesMs = Date.now() - t18; } // #18 print only: each discounted item's "33% off -$9.90" line goes into the PRINT COPY of the AIR POS receipt (a named template such as the gift receipt, and AIR POS's own copy, are unchanged)
    // airmax-fix-18-
    const out = []; T.prints = [];
    for (const x of got.pdfs) { if (!x.ok) { out.push(x); continue; } this._pt = {}; const t1 = Date.now(); if (!T.printStartAt) T.printStartAt = t1; out.push(await this.printPdfBase64(x.b64, x.label)); T.prints.push({ ...this._pt, totalMs: Date.now() - t1 }); this._pt = null; } // spd1010~
    this.notePrintTimings(T, tAll);
    const bad = out.find(x => !x.ok); return bad || out[0] || fail('No template chosen');
  }
  notePrintTimings(T, t0) { T.totalMs = Date.now() - t0; T.at = new Date().toISOString(); this.lastPrintTimings = T; try { this.log('print timings ' + JSON.stringify(T)); } catch {} }
  async receiptPdf(orderId) {
    const b = await this.api.billContentGet(orderId || this.lastOrderId);
    return b && b.success && b.value && b.value.billBase64 ? { ok: true, base64: b.value.billBase64 } : fail('Could not get the receipt: ' + msgOf(b));
  }
  // hardwareService.printReturnBill: the server renders the PDF; we download it and print it ourselves
  async printReturn(id) {
    id = id || this.lastReturnId; if (!id) return fail('No return to print');
    const pdf = await this.api.fetchPdf('/ReturnOrders/RetailReturnOrderBillGet', { returnOrderId: id, stationId: this.api.stationId, shopId: this.api.shop }, 'return receipt');
    if (!pdf.success) return fail('Could not get the return receipt: ' + pdf.message);
    return this.printPdfBase64(pdf.value.toString('base64'), 'Return receipt sent to printer');
  }

  // ---------------- end of day: X / Z reports, cash in / out ----------------
  async xReport() {
    const r = await this.api.xReadReportGet(); const v = val(r);
    if (!v || (r && r.success === false)) return fail(msgOf(r) || 'Could not load the X report');
    const rec = await this.api.xReadPrintRecordPaged(1, 5);
    return { ok: true, report: v, prints: ((rec && rec.rows) || []).map(x => ({ operator: x.operatorName || x.printOperatorName, time: x.printTime || x.createTime, number: x.reportNumber || x.number })) };
  }
  async reportPdf(kind, id, isPrint) {
    const base = { stationId: this.api.stationId, operator: this.api.operator, isPrint: isPrint ? 'true' : 'false' };
    return kind === 'z' ? this.api.fetchPdf('/RetailReports/StationZReadReportExport', { id, ...base }, 'Z report') : this.api.fetchPdf('/RetailReports/XReadReportExport', base, 'X report');
  }
  async printReport(kind, id) {
    if (kind === 'z' && !id) return fail('Choose a Z report');
    if (kind !== 'z') { if (this.xPrinting) return fail('Still printing the X report…', { busy: true }); this.xPrinting = true; try { return await this.printX(); } finally { this.xPrinting = false; } } // one at a time (double press) // mny109j+
    const pdf = await this.reportPdf(kind, id, true);
    if (!pdf.success) return fail(`Could not get the ${kind.toUpperCase()} report: ` + pdf.message);
    return this.printPdfBase64(pdf.value.toString('base64'), `${kind.toUpperCase()} report sent to printer`);
  }
  // X report print: each isPrint export adds an X print record on AIR POS. A re-press within 2 minutes (printer // mny109j+
  // trouble, lost reply) prints the copy already fetched, or a no-record copy when AIR POS recorded the lost one. // mny109j+
  async printX() { // mny109j+
    const recs = async () => { const l = await this.api.xReadPrintRecordPaged(1, 10); return l && Array.isArray(l.rows) ? l.rows.map(x => x.id || [x.printTime || x.createTime, x.operatorName || x.printOperatorName].join('|')) : null; }; // mny109j+
    const px = this.xPrint && Date.now() - this.xPrint.at < 120000 ? this.xPrint : null; // mny109j+
    if (px && px.buf) return this.printPdfBase64(px.buf.toString('base64'), 'X report printed again (same copy; AIR POS was not asked to record another X print)'); // mny109j+
    if (px) { const now = await recs(); if (!now) return fail('Could not reach AIR POS to check whether the last X report print was recorded. Nothing was printed. Try again.', { retryable: true }); // mny109j+
      if (now.some(k => !px.seen.includes(k))) { const c = await this.reportPdf('x', null, false); if (!c.success) return fail('Could not get the X report: ' + c.message, { retryable: true }); px.buf = c.value; return this.printPdfBase64(c.value.toString('base64'), 'X report sent to printer (AIR POS had already recorded this print, so it was not recorded again)'); } } // mny109j+
    const seen = await recs(); if (!seen) return fail('Could not read the X report print list from AIR POS. Nothing was printed. Try again.', { retryable: true }); // mny109j+
    this.xPrint = { seen, at: Date.now(), buf: null }; // mny109j+
    const pdf = await this.reportPdf('x', null, true); // mny109j+
    if (!pdf.success) return fail('Could not get the X report: ' + pdf.message, pdf.unreachable ? { retryable: true } : {}); // mny109j+
    this.xPrint.buf = pdf.value; // mny109j+
    return this.printPdfBase64(pdf.value.toString('base64'), 'X report sent to printer'); // mny109j+
  } // mny109j+
  async previewReport(kind, id) {
    const pdf = await this.reportPdf(kind, id, false);
    if (!pdf.success) return fail(`Could not get the ${kind.toUpperCase()} report: ` + pdf.message);
    this.preview = { buf: pdf.value, name: kind.toUpperCase() + '-report.pdf' };
    return { ok: true, url: '/preview/' + this.preview.name + '?t=' + Date.now(), bytes: pdf.value.length };
  }
  async zGenerate() {
    if (this.locked()) return fail('Finish the sale in progress first.');
    const zIds = async () => { const l = await this.api.zReadPaged({ reportNumber: '', startDate: null, endDate: null }, 1, 20); return l && Array.isArray(l.rows) ? l.rows.map(z => z.id) : null; }; // mny109b+
    const zp = this.pendingRead('z'), seen = await zIds(); // mny109b+
    if (!seen) return fail(zp ? 'Could not reach AIR POS to check whether the last Z report was made. Nothing new was generated. Check Reports > Z list, then try again.' : 'Could not read the Z report list from AIR POS. Nothing was generated. Try again.', { retryable: true }); // mny109b+
    if (zp) { this.pendingWrite('z', null); if (seen.some(id => !zp.seen.includes(id))) return { ok: true, message: 'The earlier Z report was already generated on AIR POS. It was not generated again.', already: true }; } // mny109b+
    this.pendingWrite('z', { seen, at: Date.now() }); // mny109b+
    const r = await this.api.zReadGenerate();
    const clearNo = r && r.success === false && !r.unreachable && !r.uncertain; // mny109b+
    if (!r || !r.success) { const now = await zIds(); // mny109b~
      if (now && now.some(id => !seen.includes(id))) { this.pendingWrite('z', null); return { ok: true, message: 'Z report generated (AIR POS recorded it; the reply was lost).' }; } // mny109b+
      if (now && clearNo) { this.pendingWrite('z', null); return fail('Z report failed: ' + msgOf(r)); } // mny109b+
      return fail('No clear answer from AIR POS about the Z report (' + (msgOf(r) || 'no reply') + '). It may have been made. Press Generate Z again: Air Max checks first and will not make a second one.', { retryable: true, unknown: true }); } // mny109b+ // ls9n~
    this.pendingWrite('z', null); // mny109b+
    return { ok: true, message: r.message || 'Z report generated' };
  }
  async zList() {
    const r = await this.api.zReadPaged({ reportNumber: '', startDate: null, endDate: null }, 1, 10);
    return { ok: true, rows: ((r && r.rows) || []).map(z => ({ id: z.id, number: z.number, date: z.reportDate, from: z.bootTime, to: z.shutdownTime, time: z.reportTime, orders: z.orderCount, gross: z.grossAmount, net: z.netAmount })) };
  }
  // CashTransactionAccessDialog: Deposit (pay in) / Withdraw (pay out), then open the drawer
  async cashMove(kind, amount, remark) {
    amount = round(Number(amount) || 0); if (!(amount > 0)) return fail('Enter an amount above $0');
    const word = k => (k === 'out' ? 'pay-out' : 'pay-in'); // mny109b+
    const txState = async id => { const g = await this.api.retail('/RetailCashTransactions/RetailCashTransactionGet', { id }); return g === null ? 'absent' : (g && g.id === id ? 'done' : 'unknown'); }; // mny109b+
    const cp = this.pendingRead('cash'); // mny109b+
    if (cp) { const st = await txState(cp.id); // mny109b+
      if (st === 'unknown') return fail(`Could not reach AIR POS to check the earlier cash ${word(cp.kind)} of ${money(cp.amount)}. Nothing new was recorded. Try again when the connection is back.`, { retryable: true, unknown: true }); // mny109b+
      this.pendingWrite('cash', null); // mny109b+
      if (st === 'done' && !(cp.kind === kind && round(cp.amount) === amount)) this.cashDone = { kind: cp.kind, amount: round(cp.amount), at: Date.now() }; // a different cash move first: the interrupted one is still guarded // ls9d+
      if (st === 'done' && cp.kind === kind && round(cp.amount) === amount) return { ok: true, already: true, message: `The earlier ${word(kind)} of ${money(amount)} was already recorded on AIR POS. It was not recorded again.` }; } // mny109b+
    if (!cp && this.cashDone) { const dn = this.cashDone; if (Date.now() - dn.at > 30 * 60000) this.cashDone = null; // ls9d+
      else if (dn.kind === kind && round(dn.amount) === amount) { this.cashDone = null; return { ok: true, already: true, confirmNew: true, message: `The ${word(kind)} of ${money(amount)} that was interrupted earlier WAS already recorded on AIR POS. It was not recorded again. If this is a NEW ${word(kind)}, do it again.` }; } } // done, like the mny109b check (a refusal made the redo look failed) // ls9d+
    const br = await this.api.latestBalanceGet(), bv = val(br); // mny109b+
    if (bv == null || typeof bv === 'object' || !Number.isFinite(Number(bv))) return fail('Could not read the drawer balance from AIR POS. Nothing was recorded. Try again.', { retryable: true }); // mny109b+
    const bal = Number(bv) || 0; // mny109b~
    const type = kind === 'out' ? CashTxn.Withdraw : CashTxn.Deposit;
    if (type === CashTxn.Withdraw && amount > bal) return fail(`Only ${money(bal)} is in the drawer`);
    const expected = round(type === CashTxn.Withdraw ? bal - amount : bal + amount);
    const txId = newGuid(); this.pendingWrite('cash', { id: txId, kind, amount, at: Date.now() }); // mny109b+
    const r = await this.api.cashTransactionAccess({ id: txId, type, amount, remark: String(remark || '').trim(), balance: expected }); // mny109b~
    // unclear reply: ask AIR POS for this id before saying anything // mny109b+
    if (!r || !r.success) { // mny109b~
      const st = (r && r.success === false && !r.unreachable && !r.uncertain) ? 'absent' : await txState(txId); // mny109b~
      if (st === 'absent') { this.pendingWrite('cash', null); return fail(r && r.success === false && !r.unreachable && !r.uncertain ? 'Cash ' + word(kind) + ' failed: ' + msgOf(r) : 'The connection dropped and AIR POS has no record of it, so nothing was recorded. Press Retry.', { retryable: true }); } // mny109b~
      if (st === 'unknown') return fail(`No clear answer from AIR POS about the ${word(kind)} of ${money(amount)}. It may have been recorded. Press it again: Air Max checks first and will not record it twice.`, { retryable: true, unknown: true }); // mny109b~ // ls9n~
    } // mny109b~
    this.pendingWrite('cash', null); // mny109b+
    const d = await this.openDrawerRaw();
    return { ok: true, message: `${kind === 'out' ? 'Paid out' : 'Paid in'} ${money(amount)}. Drawer should now hold ${money(expected)}.` + (d.ok ? '' : ' (' + d.message + ')'), balance: expected };
  }
  // local.9 (Stress Tester local.7 seed 15001002): Air Max closed (crash / power) while a pay-in / pay-out was being recorded. // ls9d+
  // At the next login the cashier is told whether AIR POS has it, so it is not recorded twice (before: no word at all, and a // ls9d+
  // different cash move first cleared the check, so redoing the pay-out recorded it twice). Read-only: one RetailCashTransactionGet. // ls9d+
  async recoverCashMove() { // ls9d+
    const cp = this.pendingRead('cash'); if (!cp || !cp.id) return null; const w = cp.kind === 'out' ? 'pay-out' : 'pay-in'; // ls9d+
    const g = await this.api.retail('/RetailCashTransactions/RetailCashTransactionGet', { id: cp.id }), st = g === null ? 'absent' : (g && g.id === cp.id ? 'done' : 'unknown'); // ls9d+
    if (st === 'unknown') return `A cash ${w} of ${money(cp.amount)} was being recorded when Air Max closed. AIR POS cannot be reached to check it. Do not record it again yet: press ${w === 'pay-out' ? 'Pay Out' : 'Pay In'} again later and Air Max checks first.`; // ls9d+
    this.pendingWrite('cash', null); // ls9d+
    if (st === 'done') { this.cashDone = { kind: cp.kind, amount: round(cp.amount), at: Date.now() }; return `The cash ${w} of ${money(cp.amount)} that was being recorded when Air Max closed WAS recorded on AIR POS. Do not record it again.`; } // ls9d+
    return `A cash ${w} of ${money(cp.amount)} was being recorded when Air Max closed, and AIR POS has no record of it: nothing was recorded. Do it again if needed.`; // ls9d+
  } // ls9d+
  pendingRead(k) { if (!this.dataDir) return this['_pend_' + k] || null; try { return JSON.parse(fs.readFileSync(path.join(this.dataDir, k + '-pending.json'), 'utf8')); } catch { return null; } } // mny109b+
  pendingWrite(k, v) { this['_pend_' + k] = v; if (!this.dataDir) return; const f = path.join(this.dataDir, k + '-pending.json'); try { if (v) fs.writeFileSync(f, JSON.stringify(v)); else if (fs.existsSync(f)) fs.writeFileSync(f, ''); } catch (e) { this.log('pending save failed: ' + e.message); } } // mny109b+
  async drawerBalance() { return { ok: true, balance: Number(val(await this.api.latestBalanceGet())) || 0 }; }

  // ---------------- history ----------------
  async orders(q = {}) {
    // 1.2.0 date range (History presets). AIR POS filters by one date only, so a range reads newest-first pages
    // (max 15 x 50) and keeps the orders inside [from, to).
    if (q.from || q.to) {
      const from = q.from ? Date.parse(q.from) : -Infinity, to = q.to ? Date.parse(q.to) : Infinity, rows = []; let total = 0, capped = false;
      for (let page = 1; page <= 15; page++) {
        const r = await this.api.orderPaged({ number: q.number || null, productNumber: null, memberNumber: '', orderDate: null }, page, 50);
        const list = (r && r.rows) || []; total = (r && r.total) || total;
        let older = false;
        for (const o of list) { const tm = Date.parse(o.createTime || o.creationTime || o.orderTime || o.completeTime || ''); if (!Number.isFinite(tm)) continue; if (tm < from) { older = true; continue; } if (tm < to) rows.push(o); }
        if (older || list.length < 50) break; if (page === 15) capped = true;
      }
      const out = rows.map(o => ({ id: o.id, number: o.number, status: o.status, statusName: o.statusName, paymentTypeName: o.paymentTypeName, quantity: o.quantity, quantityReturn: o.quantityReturn, amount: o.amount, tax: o.tax, amountReturn: o.amountReturn, time: o.createTime || o.creationTime || o.orderTime || o.completeTime }));
      return { ok: true, total: out.length, rows: out, capped };
    }
    const r = await this.api.orderPaged({ number: q.number || null, productNumber: null, memberNumber: '', orderDate: null }, q.page || 1, 20);
    return { ok: true, total: (r && r.total) || 0, rows: ((r && r.rows) || []).map(o => ({ id: o.id, number: o.number, status: o.status, statusName: o.statusName, paymentTypeName: o.paymentTypeName, quantity: o.quantity, quantityReturn: o.quantityReturn, amount: o.amount, tax: o.tax, amountReturn: o.amountReturn, time: o.createTime || o.creationTime || o.orderTime || o.completeTime })) };
  }
  async orderDetails(id) { const g = await this.api.orderGet(id); const o = val(g); return o && o.id ? { ok: true, order: o } : fail(msgOf(g) || 'Not found'); }
  async voidHeld(id) { const r = await this.api.pendingVoid(id); return { ok: !!(r && r.success), message: (r && r.message) || '' }; }

  // ---------------- returns ----------------
  async startReturn(kind, orderId) {
    if (this.locked()) return fail('Finish the sale in progress first.');
    this.resetReturn(); this.ret.kind = kind;
    if (kind === 'receipt') {
      const d = await this.orderDetails(orderId); if (!d.ok) return d;
      if (d.order.status !== OrderStatus.Completed) return fail('Only completed sales can be returned');
      this.ret.order = d.order;
    }
    this.mode = 'return'; return { ok: true, message: kind === 'receipt' ? `Return for ${this.ret.order.number}: scan items from the receipt` : 'Return mode (no receipt): scan items' };
  }
  // Return to Account (owner request J): AIR POS's own Member Account refund. Receipt: RefundMethod.MemberAccount (only when the sale
  // had a customer; payments become type 11 per original receive, same split). No receipt: paymentType 11 + the attached customer.
  returnAccountInfo() {
    if (this.settings.returnToAccount === false) return { allowed: false, why: 'Return to Account is turned off in Settings (manager)' };
    if (this.ret.kind === 'receipt') { const o = this.ret.order || {}; return o.retailMemberId ? { allowed: true, memberId: o.retailMemberId, name: o.retailMemberName || o.memberName || 'the sale\'s customer' } : { allowed: false, why: 'This sale had no customer, so it can\'t go to an account' }; }
    return this.member ? { allowed: true, memberId: this.member.id, name: this.member.name } : { allowed: false, why: 'Add a customer to refund to their account' };
  }
  setReturnToAccount(on) {
    if (this.mode !== 'return' || !this.ret.kind) return fail('Not in a return');
    if (this.ret.sent) return fail('A refund was already sent; press Refund (Retry) first');
    if (!on) { this.ret.toAccount = false; return { ok: true, message: 'Refund goes back the way the customer paid' }; }
    const a = this.returnAccountInfo(); if (!a.allowed) return fail(a.why, { noAccount: true });
    this.ret.toAccount = true; return { ok: true, message: `Refund goes to ${a.name}'s account` };
  }
  cancelReturn(force) {
    if (this.ret.sent && !force) return fail('A refund was sent but its reply was lost. Press Refund (Retry) first so Air Max can check whether AIR POS recorded it.', { needForce: true }); // ls9n~
    if (this.ret.sent) this.journal.clear('return cancelled after a lost reply');
    this.resetReturn(); this.mode = 'sale'; return { ok: true, message: 'Return cancelled' }; }
  returnOrderSubs() {
    const o = this.ret.order, subs = o.subs || [];
    if (!(o.promotionSubs && o.promotionSubs.length)) return subs;
    return o.promotionSubs.map(p => ({ ...p, quantityOverSelling: (subs.find(x => x.id === p.retailOrderSubId) || {}).quantityOverSelling || 0 }));
  }
  returnLines() { // every returnable line, so the cashier can tap instead of scanning
    if (this.ret.kind !== 'receipt') return [];
    const promo = !!(this.ret.order.promotionSubs && this.ret.order.promotionSubs.length);
    return this.returnOrderSubs().filter(x => !promo || x.promotionType === 0).map(x => ({ code: x.upc || x.number, number: x.number, name: x.name, left: (x.quantityTotal - x.quantityReturn) / x.rate, price: x.price, refundable: !!x.isRetailRefund }));
  }
  async returnScan(code) {
    code = String(code || '').trim(); if (!code) return fail('Nothing scanned');
    if (this.ret.kind === 'receipt') {
      const all = this.returnOrderSubs(), promo = !!(this.ret.order.promotionSubs && this.ret.order.promotionSubs.length);
      let os = all.find(x => (x.upc === code || x.number === code) && (!promo || x.promotionType === 0));
      if (!os) { if (all.find(x => (x.upc === code || x.number === code) && x.promotionType > 0)) return fail('Promotion items cannot be returned here'); return fail('Item is not on this receipt'); }
      const max = (os.quantityTotal - os.quantityReturn) / os.rate;
      if (max <= 0) return fail('Nothing left to return for this item');
      if (!os.isRetailRefund) return fail('This item cannot be refunded');
      let rs = this.ret.subs.find(x => x.itemId === os.itemId);
      if (!rs) {
        rs = { id: newGuid(), productId: os.productId, itemId: os.itemId, number: os.number, name: os.name, rate: os.rate, quantity: 1, quantityTotal: os.rate, price: os.price,
          taxRate: os.taxRate, taxFree: os.taxFree, discountTaxFree: os.discountTaxFree, maxQuantity: max, discount: os.discount, ignoreOrderDiscount: os.ignoreOrderDiscount, timestamp: Date.now() };
        this.ret.subs.push(rs);
      } else { if (rs.quantity + 1 > max) return fail('Nothing left to return for this item'); rs.quantity += 1; rs.quantityTotal = rs.quantity * rs.rate; rs.timestamp = Date.now(); }
      return { ok: true, message: `Return ${rs.name} x${rs.quantity}` };
    }
    const r = await this.api.scan(code); if (!r || !r.success) return fail((r && r.message) || 'Item not found');
    const s = r.value; const ex = this.ret.subs.find(x => x.itemId === s.itemId);
    if (ex) { ex.quantity += 1; ex.quantityTotal = ex.quantity * ex.rate; ex.timestamp = Date.now(); }
    else this.ret.subs.push({ id: newGuid(), productId: s.productId, itemId: s.itemId, number: s.number, name: s.name, rate: s.rate, quantity: 1, quantityTotal: s.rate, price: s.price, taxRate: s.taxRate ?? 0, taxFree: s.taxFree ?? true, timestamp: Date.now() });
    return { ok: true, message: `Return ${s.name}` };
  }
  returnRemove(row) { const s = [...this.ret.subs].sort((a, b) => b.timestamp - a.timestamp)[row === 'last' || row == null ? 0 : Number(row)]; if (!s) return fail('No line'); this.ret.subs.splice(this.ret.subs.indexOf(s), 1); return { ok: true, message: 'Removed ' + s.name }; }
  // OrderReturnDrawer watchEffect (incl. member branch) + AllocateRefundAmount (refund to original payments)
  returnTotals() {
    const subs = this.ret.subs;
    if (this.ret.kind === 'receipt') {
      const o = this.ret.order, od = o.orderDiscount || 0; let amount = 0, tax = 0, qty = 0;
      for (const s of subs) {
        qty += s.quantity * s.rate;
        const base = s.price * s.quantity * s.rate * (s.ignoreOrderDiscount ? 1 : 1 - s.discount / 100) * (1 - od / 100);
        amount += base; tax += s.discountTaxFree ? 0 : (s.taxRate / 100) * base;
      }
      amount = round(amount); tax = round(tax);
      let refund = round(amount + tax), decreasePoints = 0;
      if (o.retailMemberId) {
        const actual = round(o.amount + o.tax - (o.amountReturn || 0) - (o.taxReturn || 0) - (o.pointDiscountAmount || 0));
        const maxInc = o.amount - (o.amountReturn || 0) - (o.pointDiscountAmount || 0);
        if (refund >= actual) refund = round(maxInc + tax);
        decreasePoints = Math.min(amount, maxInc) * ((o.pointEarnRate || 0) / 100);
      }
      let payments = this.allocateRefund(refund);
      if (this.ret.toAccount && o.retailMemberId) payments = payments.map(p => ({ ...p, paymentType: PaymentType.MemberAccount, name: 'Customer account', retailMemberId: o.retailMemberId, retailGiftCardId: null })); // OrderReturnDrawer member branch: same receives, same amounts, type 11
      return { quantity: qty, amount, tax, refund, decreasePoints, payments, toAccount: !!this.ret.toAccount };
    }
    // AIR POS NonOrderReturnDrawer refunds price x qty only (no tax) and the server stores tax 0 for no-receipt returns.
    // Air Register refunds the item's tax too (setting refundTaxNoReceipt, on by default) by sending the tax-inclusive unit price,
    // so the server's return amount always equals the cash handed back.
    const withTax = this.settings.refundTaxNoReceipt !== false;
    const amount = round(subs.reduce((a, s) => a + s.price * s.quantity * s.rate, 0));
    const refund = withTax ? round(subs.reduce((a, s) => a + this.nonOrderPrice(s) * s.quantity * s.rate, 0)) : amount;
    return { quantity: subs.reduce((a, s) => a + s.quantity * s.rate, 0), amount, tax: round(refund - amount), refund, taxIncluded: withTax, payments: this.ret.payments || [this.ret.toAccount && this.member ? { paymentType: PaymentType.MemberAccount, name: 'Customer account', amount: refund } : { paymentType: PaymentType.Cash, name: 'Cash', amount: refund }], toAccount: !!this.ret.toAccount };
  }
  nonOrderPrice(s) { return this.settings.refundTaxNoReceipt !== false ? round(s.price * (1 + (Number(s.taxRate) || 0) / 100), 4) : s.price; }
  allocateRefund(total) {
    const o = this.ret.order, out = []; let left = round(total);
    for (const pt of ReturnSort) {
      const rc = (o.receives || []).find(r => r.paymentType === pt); if (!rc) continue;
      const already = (o.returnPayments || []).filter(p => p.receivePaymentType === pt).reduce((a, p) => a + p.amount, 0);
      const refundable = round(rc.amount) - round(already);
      if (refundable <= 0 || left <= 0) continue;
      const amt = round(Math.min(refundable, left)); left = round(left - amt);
      const gc = (rc.retailGiftCardSelections || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))[0];
      out.push({ paymentType: pt, name: PayName[pt], amount: amt, receiveId: rc.id, retailMemberId: pt === PaymentType.MemberAccount ? o.retailMemberId : null, retailGiftCardId: gc ? gc.key : null });
    }
    return out;
  }
  async returnRecorded(id) { // the server renders a return receipt only for a return it has stored
    const pdf = await this.api.fetchPdf('/ReturnOrders/RetailReturnOrderBillGet', { returnOrderId: id, stationId: this.api.stationId, shopId: this.api.shop }, 'return check');
    if (pdf.success) return 'yes'; // dbl109+
    const g = await this.api.returnGet(id), o = val(g); // real AIR POS: the return object, or plain null when it has none // dbl109+
    return o && o.id === id && !this.replyUnclear(g) ? 'yes' : (o == null && !this.replyUnclear(g)) ? 'no' : 'unknown'; // dbl109~
  }
  async confirmReturn() {
    if (!this.ret.subs.length) return fail('Nothing to return');
    if (this.ret.sent) { // an earlier refund attempt lost its reply
      const st = await this.returnRecorded(this.ret.id);
      if (st === 'unknown') return fail('Still no connection to AIR POS. Do not hand out the refund yet; press Retry when the connection is back (Air Max checks first, so it is never refunded twice).', { retryable: true }); // ls9n~
      if (st === 'yes') return this.returnDone(this.returnTotals());
    }
    const t = this.returnTotals(); let r;
    const pays = t.payments.filter(p => p.amount > 0);
    const card = this.ret.kind === 'receipt' ? round(pays.filter(p => p.paymentType === PaymentType.CreditCard || p.paymentType === PaymentType.Online).reduce((a, p) => a + p.amount, 0)) : 0;
    this.journal.write({ kind: 'return', retId: this.ret.id, retKind: this.ret.kind, orderNumber: this.ret.order ? this.ret.order.number : null, refund: t.refund, card, company: (this.identity || {}).corpName });
    if (this.ret.kind === 'receipt') {
      const o = this.ret.order;
      if (this.ret.toAccount && !o.retailMemberId) return fail('This sale had no customer, so it can\'t go to an account');
      if (!pays.length) return fail('Nothing refundable left on this sale');
      if (pays.some(p => p.paymentType === PaymentType.GiftCard && !p.retailGiftCardId)) return fail('The gift card for this refund could not be found on the sale');
      r = await this.api.returnCreate({ id: this.ret.id, retailOrderId: o.id, currency: this.identity.currency, retailMemberId: o.retailMemberId, rechargePointRecordId: o.rechargePointRecordId, decreasePoints: t.decreasePoints || 0,
        paymentType: pays.length > 1 ? PaymentType.Combination : pays[0].paymentType,
        subs: this.ret.subs.map(x => ({ id: x.id, productId: x.productId, itemId: x.itemId, quantity: x.quantity, quantityTotal: x.quantity * x.rate, discount: x.discount })),
        payments: pays.map(p => { const q = { id: newGuid(), retailOrderReceiveId: p.receiveId, paymentType: p.paymentType, amount: p.amount, retailMemberId: p.retailMemberId }; if (p.paymentType === PaymentType.GiftCard) q.retailGiftCardId = p.retailGiftCardId; return q; }) });
      t.refund = round(pays.reduce((a, p) => a + p.amount, 0));
    } else {
      const toAcct = (this.ret.payments || t.payments).some(p => p.paymentType === PaymentType.MemberAccount);
      if (toAcct && !this.member) return fail('Add a customer to refund to their account');
      r = await this.api.nonOrderReturnCreate({ id: this.ret.id, currency: this.identity.currency, retailMemberId: toAcct ? this.member.id : null,
        subs: this.ret.subs.map(x => ({ id: x.id, productId: x.productId, itemId: x.itemId, quantity: x.quantity, quantityTotal: x.quantity * x.rate, price: this.nonOrderPrice(x) })),
        payments: (this.ret.payments || t.payments).map(p => ({ id: newGuid(), paymentType: p.paymentType, amount: p.amount, retailGiftCardId: null, checkNumber: '' })) });
    }
    if (r && (r.unreachable || r.uncertain)) { // dbl109~
      this.ret.sent = true; const st = await this.returnRecorded(this.ret.id);
      if (st === 'yes') return this.returnDone(t, pays);
      const why = r.unreachable ? 'The connection dropped' : 'AIR POS answered with an error (' + (msgOf(r) || 'no clear reply') + ')'; // ls9r+
      if (st === 'unknown') return fail(why + ' while the refund was being sent. Do not hand out money yet: press Retry when the connection is back. Air Max checks first, so it is never refunded twice.', { retryable: true }); // ls9n~ // ls9r~
      this.journal.clear('return not recorded'); return fail(why + ' and AIR POS has no record of this refund, so nothing was refunded. Press Retry.', { retryable: true }); // ls9r~
    }
    if (!r || !r.success) { if (!this.ret.sent) this.journal.clear('return failed'); return fail('Return failed: ' + msgOf(r)); }
    return this.returnDone(t, pays);
  }
  async returnDone(t, pays) {
    pays = pays || t.payments.filter(p => p.amount > 0); if (this.ret.kind === 'receipt') t.refund = round(pays.reduce((a, p) => a + p.amount, 0));
    const id = this.ret.id, kind = this.ret.kind; this.lastReturnId = id;
    const cardOf = p => p.paymentType === PaymentType.CreditCard || p.paymentType === PaymentType.Online;
    const card = round(pays.filter(cardOf).reduce((a, p) => a + p.amount, 0));
    // receipt return to card: AIR POS refunds the card itself; keep a crash-safe note until AIR POS says Completed
    if (kind === 'receipt' && card > 0) this.cardRefundAdd({ retId: id, orderNumber: this.ret.order ? this.ret.order.number : null, amount: card });
    this.journal.clear('return recorded ' + id);
    const cash = round(pays.filter(p => p.paymentType === PaymentType.Cash).reduce((a, p) => a + p.amount, 0));
    const parts = pays.map(p => `${p.name} ${money(p.amount)}`).join(', ');
    const res = { ok: true, message: `Return done. Refund: ${parts}.` + (cash > 0 ? ` Give back ${money(cash)} cash.` : ''), returnId: id, refund: t.refund, payments: pays, drawer: null, print: null };
    this.resetReturn(); this.mode = 'sale';
    this.lastSaleAt = Date.now();
    if (kind === 'receipt' && card > 0) { res.card = await this.cardRefundCheck(id); res.message += ' ' + res.card.message; }
    else if (card > 0) res.message += ` Refund ${money(card)} on the card machine now (Air Max only records it in AIR POS).`; // ls9n~
    const jobs = []; // owner request L: same for returns — drawer / return receipt in the background, failures as a small note
    if (this.autoDrawer(cash > 0)) jobs.push(['drawer', () => this.drawer(true), this.drawerWaitMs() + 1500]);
    if (this.autoPrintOn('return')) jobs.push(['return', () => this.printReturn(id), this.hwPrintMs || 30000]); // cp1010~
    res.hwPending = jobs.map(j => j[0]); Object.defineProperty(res, 'hwJob', { value: this.hwBackground(jobs, id), enumerable: false });
    return res;
  }

  // AIR POS shows identity.stationNumber (login) / session.stationNumber; only fall back to the PC name when the store has no station name
  stationLabel() {
    const id = this.identity || {}, ss = (this.session && (this.session.session || this.session)) || {}, tc = (this.home && this.home.terminalConfig) || {};
    const pick = [id.stationName, id.stationNumber, ss.stationName, ss.stationNumber, tc.stationName, tc.saleStationName, tc.name, id.stationCode].find(v => typeof v === 'string' && v.trim());
    return pick ? pick.trim() : '';
  }
  // ---------------- state for UI ----------------
  state() {
    const id = this.identity, p = this.pay;
    return {
      mode: this.mode, loggedIn: this.api.loggedIn,
      user: id ? { company: id.corpName, shop: id.shopName, user: id.userName, manager: this.isManager() } : null,
      session: this.session && this.session.session ? { number: this.session.session.number, initialAmount: this.session.session.initialAmount, expectedAmount: this.session.expectedAmount } : (this.session ? { type: this.session.type, expectedAmount: this.session.expectedAmount } : null),
      hw: { via: this.hwStatus.via, message: this.hwStatus.message, builtin: this.hw.present }, device: this.api.device.deviceName,
      order: { id: this.order.id, resuming: this.order.resuming, number: this.order.number || null, orderDiscount: round(this.order.orderDiscount, 3), orderDiscountMethod: this.order.orderDiscountMethod, orderDiscountAmount: round(this.order.orderDiscountAmount), discountConfigSubId: this.order.discountConfigSubId, promotionalCode: this.order.promotionalCode, taxExempt: !!this.order.taxExempt },
      cart: this.sorted().map(s => { const up = unitPrice(s.quantity * s.rate, s.bulkPriceQuantity, s.price, s.bulkPrice); return { number: s.number, upc: s.upc, name: s.name, type: s.type || 0, quantity: s.quantity, unitName: s.unitName, price: up, discount: round(s.discount || 0, 2), discountAmount: s.discountAmount || 0, custom: !!s.isCustomDiscount, dm: s.discountMethod, taxRate: s.taxRate, total: round(up * s.quantity * s.rate - (s.discountAmount || 0)) }; }), // f4p1011~
      member: this.member ? { ...this.member, usingPoints: this.usingPoints } : null,
      discounts: (this.discountConfig.subs || []).map(d => ({ id: d.id, name: d.name, rate: d.rate, membersOnly: !!d.isPeriodicLimit })),
      extraCharges: (this.retailCfg().extraChargeSetting || []).map(x => ({ id: x.id, name: x.name, defaultAmount: x.defaultAmount })),
      pay: p ? { stockWarning: p.stockWarning || '', stockRule: this.stockRule(), stockShort: (p.stockShort || []).length, needManager: !!(p.auth && p.auth.needAuthorization && !p.auth.managerId), lastError: p.lastError || null, paid: this.paidTotal(), remaining: this.remaining(),
        tenders: p.tenders.map(t => ({ name: t.name, type: t.type, amount: t.amount, receiveAmount: t.receiveAmount, giveAmount: t.giveAmount, status: t.status })),
        card: p.card ? { kind: p.card.kind || 'terminal', status: p.card.status, amount: p.card.submit.amount, message: p.card.message, subMessage: p.card.subMessage, seconds: Math.round((Date.now() - p.card.startedAt) / 1000), slow: !!p.card.slow } : null,
        result: p.result || null } : null,
      totals: this.totals, completed: this.completed, lastOrderId: this.lastOrderId, lastReturnId: this.lastReturnId,
      ret: this.mode === 'return' ? { kind: this.ret.kind, order: this.ret.order ? { number: this.ret.order.number, amount: this.ret.order.amount, tax: this.ret.order.tax, payments: (this.ret.order.receives || []).map(r => PayName[r.paymentType] || r.paymentTypeName).join(' + ') } : null,
        lines: this.returnLines(),
        subs: [...this.ret.subs].sort((a, b) => b.timestamp - a.timestamp).map(s => ({ number: s.number, name: s.name, quantity: s.quantity, price: s.price, max: s.maxQuantity })), totals: this.returnTotals(), toAccount: !!this.ret.toAccount, account: this.returnAccountInfo(), origTypes: this.ret.kind === 'receipt' ? [...new Set(this.allocateRefund(this.returnTotals().refund).filter(p => p.amount > 0).map(p => p.paymentType))] : [] } : null,
      settings: (({ exitPinHash, ...x }) => ({ ...x, exitPinSet: !!exitPinHash, bulkItems: x.bulkItems || [], bulkFolders: this.bulkFoldersOf(x), bulkOrder: this.bulkOrderOf(x), drawerAutoOpen: this.drawerAutoMode(), drawerWaitSec: this.drawerWaitMs() / 1000, drawerPulse: this.printerSettings ? this.printerSettings().drawerPulse : 50 }))(this.settings), // bf105~
      keyed: this.keyedInfo(), note: this.order.note || '', giftReceipt: this.giftReceiptOn ? this.giftReceiptOn() : false, asideCount: this.asideList().rows.length,
      station: { name: this.stationLabel(), device: this.api.device.deviceName || '' },
      online: this.api.online !== false, notice: this.currentNotice(), recoveryPending: !!this.recoveryPending, cardRefunds: this.identity ? this.cardState() : [],
      currency: id ? id.currencyCode : '$',
    };
  }
}
Object.assign(Register.prototype, require('./extras').Extras, require('./recovery').Recovery, require('./kiosk').Kiosk, require('./cardrefund').CardRefund,
  require('./quickreturn').QuickReturn, require('./printing').Printing, require('./customer').Customer); // direct printer/drawer support, overrides hwDo/printPdfBase64/openDrawerRaw/printers/testPrint above
require('./quickreturn').install(Register);
// The 1.2.3.1 "not fully paid" answer (shortRefused) is left exactly as it was; the reason AIR POS gave is put in front of it here, so it is never lost. // airmax-fix-stock+
{ const sr0 = Register.prototype.shortRefused; Register.prototype.shortRefused = async function (pay, o) { const r = await sr0.call(this, pay, o); try { const n = this.refusalNote(); if (pay && pay.refusal && n && pay.lastError && !String(pay.lastError).startsWith(n)) { pay.lastError = n + pay.lastError; if (r && r.message) r.message = n + r.message; this.journalSnap('short'); } } catch (e) { /* the reason is only an extra */ } return r; }; } // airmax-fix-stock+
module.exports = { Register, PaymentType, OrderStatus };

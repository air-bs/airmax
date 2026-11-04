// AIR POS API client: sends exactly what AIR POS 1.9.11 sends (see api-map.md).
// Session token (ide) lives ONLY in this process's memory. Never logged.
'use strict';
const crypto = require('crypto');

const HOSTS = {
  retail: 'https://rtlserv.pfa.com',
  base: 'https://baseserv.pfa.com',
  local: 'http://localhost:20001',
};
const SERVICE = 'YWGFX';                                   // identityUtils.getService()
const LANG_EN = '83713766-C9E0-4B3C-BD6D-0808836ADC45_en'; // locales.en -> `${id}_${code}`
const APP_VERSION = '1.9.11';

// AIR POS utils.newGuid(): random lowercase hex in 8-4-4-4-12 form
const newGuid = () => crypto.randomUUID();

class AirPos {
  constructor({ log } = {}) {
    this.log = log || (() => {});
    this.reset();
    this.device = { deviceId: '', oldDeviceId: '', deviceName: '' };
    this.localOk = null;
  }
  reset() {
    this.ide = '';          // session token, memory only
    this.identity = null;   // login response (minus ide)
    this.shop = ''; this.operator = ''; this.stationId = '';
  }
  get loggedIn() { return !!this.ide; }

  headers() {
    // identityUtils.getHeaders() (identity.ts:201-216)
    return {
      ide: this.ide,
      lang: LANG_EN,
      service: SERVICE,
      shop: this.shop || '',
      operator: this.operator || '',
      offset_hours: String(-(new Date().getTimezoneOffset() / 60)),
      stationid: this.stationId || '',
      deviceid: this.device.deviceId || '',
      olddeviceid: this.device.oldDeviceId || '',
      devicename: this.device.deviceName || '',
      appversion: APP_VERSION,
    };
  }

  // httpClient.request: POST multipart/form-data (isFormData) or JSON (no isFormData)
  async call(host, path, params, { form = true, quiet = false, timeoutMs = 30000 } = {}) {
    const url = HOSTS[host] + path;
    const opts = { method: 'POST', headers: this.headers(), signal: AbortSignal.timeout(timeoutMs) };
    if (form) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(params || {})) fd.append(k, v == null ? 'null' : String(v));
      opts.body = fd;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(params || {});
    }
    const t0 = Date.now();
    let res, data;
    // dev-only fault injection (set through the dev route, needs AIRREG_DEV_PROBE=1): 'down' = network gone before sending,
    // 'lost-reply' = the server gets the request but the reply never arrives (worst case for double charges)
    const f = (this.faults || []).find(x => x.count > 0 && path.includes(x.path)) || null;
    if (f) f.count--;
    try {
      if (f && f.mode === 'down') throw Object.assign(new Error('fault'), { cause: { code: 'ENETUNREACH (test)' } });
      res = await fetch(url, opts);
      const text = await res.text();
      if (f && f.mode === 'lost-reply') { res = null; throw Object.assign(new Error('fault'), { name: 'TimeoutError (test)' }); }
      try { data = JSON.parse(text); } catch { data = { success: false, message: 'Non-JSON reply (HTTP ' + res.status + ')' }; }
      if (res.status >= 500 || (data && data.success === false && /^Non-JSON reply/.test(String(data.message)))) data = Object.assign(data && typeof data === 'object' ? data : { success: false, message: 'HTTP ' + res.status }, { uncertain: true }); // dbl109+
    } catch (e) {
      data = { success: false, message: (host === 'local' ? 'Local hardware service not reachable: ' : 'Network error: ') + (e.cause?.code || e.name || e.message), unreachable: true, code: e.cause?.code || e.name };
    }
    // Log endpoint + outcome only. Never headers, never bodies (they can hold passwords/tokens).
    if (!quiet) this.log(`${host.toUpperCase()} ${path} -> ${res ? res.status : 'ERR'} ${data && data.success === false ? 'FAIL: ' + String(data.message || '').slice(0, 160) : 'ok'} (${Date.now() - t0}ms)`);
    if (host === 'retail') { this.online = !(data && data.unreachable); this.lastContact = Date.now(); }
    if (data && (data.errorCode === 1003 || data.errorCode === 1004)) { this.reset(); data.loggedOut = true; }
    return data;
  }
  retail(path, params, o) { return this.call('retail', path, params, o); }
  submit(path, obj) { return this.retail(path, { submit: JSON.stringify(obj) }); }

  // ---------- local hardware service ----------
  async deviceInfo() {
    const r = await this.call('local', '/Hardwares/GetDeviceInfo', {}, { form: false, timeoutMs: 4000 });
    this.localOk = !!(r && r.success);
    if (r && r.success && r.value) this.device = { deviceId: r.value.deviceId, oldDeviceId: r.value.oldDeviceId, deviceName: r.value.deviceName };
    return r;
  }
  openCashbox(printerName) { return this.call('local', '/Hardwares/OpenCashbox', printerName ? { printerName } : {}, { form: false, timeoutMs: 8000 }); }
  getPrinters() { return this.call('local', '/Hardwares/GetPrinters', {}, { form: false, timeoutMs: 5000 }); }
  printBillContent(bill, printerName) {
    // AIR POS passes RetailOrderBillContentGet's value straight through (withPrinterName adds printerName)
    const s = printerName ? { ...bill, printerName } : { ...bill };
    return this.call('local', '/Hardwares/PrintBillContent', { submit: JSON.stringify(s) }, { timeoutMs: 30000 });
  }
  printReturnBill(returnOrderId, printerName) {
    // hardwareService.printReturnBill -> setupQueryString puts ide in the URL (same as AIR POS); URL is never logged.
    const q = new URLSearchParams({ returnOrderId, stationId: this.stationId, shopId: this.shop, ide: this.ide, service: SERVICE, shop: this.shop, lang: LANG_EN, offset_hours: String(-(new Date().getTimezoneOffset() / 60)) });
    const billPdfUrl = HOSTS.retail + '/ReturnOrders/RetailReturnOrderBillGet?' + q.toString();
    const s = printerName ? { billPdfUrl, printerName } : { billPdfUrl };
    return this.call('local', '/Hardwares/PrintBill', { submit: JSON.stringify(s) }, { timeoutMs: 30000 });
  }

  // ---------- identity ----------
  retailConfigGetByCorp(corpName) { return this.retail('/Commons/RetailConfigGetByCorp', { corpName }); }
  async login(corpName, userName, password) {
    const r = await this.retail('/Identities/Login', { submit: JSON.stringify({ corpName, userName, password, useFingerprint: false }) });
    if (r && r.success && r.value) {
      const v = r.value;
      this.ide = v.ide || '';
      this.shop = v.shopId || ''; this.operator = v.operatorId || ''; this.stationId = v.stationId || '';
      const { ide, ...rest } = v; this.identity = rest; // never keep the token in the identity copy we expose
      r.value = rest;
    }
    return r;
  }
  homeIndex() { return this.retail('/Home/Index', {}, { form: false }); }
  verify(userName, password) { return this.submit('/Identities/verify', { userName, password }); }
  getIdentity() { return this.retail('/Identities/GetIdentity', {}, { form: false }); }

  // ---------- session ----------
  sessionCheck() { return this.retail('/RetailSessions/SessionCheck', {}, { form: false }); }
  clockIn(initialAmount) { return this.submit('/RetailSessions/ClockIn', { initialAmount }); }
  latestBalanceGet() { return this.retail('/RetailCashTransactions/LastestBalanceGet', {}); }
  clockOut(finalAmount) { return this.submit('/RetailSessions/ClockOut', { finalAmount }); }

  // ---------- config ----------
  retailConfigGet() { return this.retail('/Commons/RetailConfigGet', {}); }
  discountConfigGet() { return this.retail('/Commons/RetailDiscountConfigGet', {}); }
  terminalConfigGet() { return this.retail('/Commons/RetailTerminalConfigGet', {}); }

  // ---------- products ----------
  scan(number) { return this.retail('/Orders/RetailOrderSubGetByScan', { number }); }
  productPaged(keyword, page = 1, pageSize = 24) {
    return this.retail('/Products/ProductPaged', { filter: JSON.stringify({ keyword, categoryCode: null }), pageInfo: JSON.stringify({ page, pageSize, amount: 0 }) });
  }

  // ---------- orders ----------
  promotionGet(s) { return this.submit('/Orders/RetailOrderPromotionGet', s); }
  orderSave(s) { return this.submit('/Orders/RetailOrderSave', s); }
  authorizationCheck(subs) { return this.retail('/Orders/RetailOrderAuthorizationCheck', { subs: JSON.stringify(subs) }); }
  receiveBegin(s) { return this.submit('/Orders/RetailOrderReceiveBegin', s); }
  complete(c) { return this.retail('/Orders/RetailOrderComplete', { command: JSON.stringify(c) }); }
  receiveCheck(s) { return this.submit('/Orders/RetailOrderReceiveCheck', s); }
  receiveCancel(s) { return this.submit('/Orders/RetailOrderReceiveCancel', s); }

  // ---------- members ----------
  memberInfoGet(number) { return this.retail('/RetailMembers/MemberInfoGet', { number }); }
  memberGetByNumber(number) { return this.retail('/RetailMembers/RetailMemberGetByNumber', { number }); }
  memberAdd(s) { return this.submit('/RetailMembers/RetailMemberAdd', s); }
  memberGet(id) { return this.retail('/RetailMembers/RetailMemberGet', { id }); }
  memberUpdate(s) { return this.submit('/RetailMembers/RetailMemberUpdate', s); }
  // AirMax 1.0.9 card on file (Stripe stores only): AIR POS keeps the card reference; Stripe keeps the card. // cof109+
  memberCardsSelect(retailMemberId) { return this.retail('/RetailMembers/RetailMemberCardSelect', { retailMemberId }); } // cof109+
  memberCardAddBegin(retailMemberId) { return this.retail('/RetailMembers/RetailMemberCardAddBegin', { retailMemberId }); } // cof109+
  memberCardAddComplete(s) { return this.submit('/RetailMembers/RetailMmeberCardAddComplete', s); } // AIR POS's own spelling // cof109+
  memberCardDelete(retailMemberId, cardId) { return this.retail('/RetailMembers/RetailMemberCardDelete', { retailMemberId, cardId }); } // cof109+
  // MemberSaveDrawer form rule: is this customer number free? (id = the member being edited, null for a new one)
  memberNumberValidate(number, id) { return this.retail('/RetailMembers/MemberNumberValidate', { number, id: id || null }); }
  memberPaged(filter, page = 1, pageSize = 20) {
    return this.retail('/RetailMembers/RetailMemberPaged', { filter: JSON.stringify(filter), pageInfo: JSON.stringify({ page, pageSize, amount: 0 }) });
  }

  // ---------- gift cards ----------
  giftCardVerify(number, secret) { return this.retail('/RetailGiftCards/RetailGiftCardVerify', { number, secret }); }
  giftCardGet(number) { return this.retail('/RetailGiftCards/RetailGiftCardGet', { number }); }
  giftCardSelect(keyword) { return this.retail('/RetailGiftCards/RetailGiftCardSelect', { keyword: keyword == null ? '' : keyword }); }
  giftCardAdd(s) { return this.submit('/RetailGiftCards/RetailGiftCardAdd', s); }
  giftCardTransactions(filter, page = 1, pageSize = 20) {
    return this.retail('/RetailGiftCards/RetailGiftCardTransactionPaged', { filter: JSON.stringify(filter), pageInfo: JSON.stringify({ page, pageSize, amount: 0 }) });
  }
  // payment channel for keyed / online cards: { channelType (0 none, 10 Stripe, 20 Sola), secretKey (Stripe publishable key) }
  receiveChannelGet(paymentType) { return this.retail('/Commons/RetailReceiveChannelGet', { paymentType }); }

  // ---------- cash drawer money ----------
  cashTransactionAccess(s) { return this.submit('/RetailCashTransactions/RetailCashTransactionAccess', s); }

  // ---------- X / Z reports ----------
  xReadReportGet() { return this.retail('/RetailReports/xReadReportGet', {}, { form: false }); }
  xReadPrintRecordPaged(page = 1, pageSize = 10) { return this.retail('/RetailReports/XReadPrintRecordPaged', { pageInfo: JSON.stringify({ page, pageSize, amount: 0 }) }); }
  zReadGenerate() { return this.retail('/RetailReports/GenerateStationZRead', {}, { form: false }); }
  zReadPaged(filter = {}, page = 1, pageSize = 10) {
    return this.retail('/RetailReports/StationZReadReportPaged', { filter: JSON.stringify(filter), pageInfo: JSON.stringify({ page, pageSize, amount: 0 }) });
  }
  // PDF download of a server-rendered report/receipt. Same URL AIR POS gives its hardware service
  // (identityUtils.setupQueryString puts ide in the query). The URL is never logged.
  reportUrl(path, params) {
    const q = new URLSearchParams({ ...params, ide: this.ide, service: SERVICE, shop: this.shop, lang: LANG_EN, offset_hours: String(-(new Date().getTimezoneOffset() / 60)) });
    return HOSTS.retail + path + '?' + q.toString();
  }
  async fetchPdf(path, params, label) {
    const t0 = Date.now();
    const f = (this.faults || []).find(x => x.count > 0 && path.includes(x.path)) || null; // dev-only fault injection
    if (f) f.count--;
    try {
      if (f) throw Object.assign(new Error('fault'), { name: 'TimeoutError (test)' });
      const res = await fetch(this.reportUrl(path, params), { headers: this.headers(), signal: AbortSignal.timeout(45000) });
      const buf = Buffer.from(await res.arrayBuffer());
      const isPdf = buf.slice(0, 5).toString() === '%PDF-';
      this.log(`RETAIL ${path} (${label || 'pdf'}) -> ${res.status} ${isPdf ? 'pdf ' + buf.length + 'b' : 'NOT PDF'} (${Date.now() - t0}ms)`);
      if (!isPdf) {
        let msg = 'The server did not return a PDF (HTTP ' + res.status + ')';
        let code = null; try { const j = JSON.parse(buf.toString()); if (j && j.message) msg = j.message; code = j && j.errorCode; } catch {}
        if (code === 1003 || code === 1004) { this.reset(); return { success: false, message: msg, status: res.status, loggedOut: true }; }
        return { success: false, message: msg, status: res.status };
      }
      return { success: true, value: buf };
    } catch (e) {
      this.log(`RETAIL ${path} -> ERR ${e.name}`);
      return { success: false, message: 'Network error: ' + (e.cause?.code || e.name), unreachable: true };
    }
  }
  receiveAllCancel(id) { return this.retail('/Orders/RetailOrderReceiveAllCancel', { id }); }
  orderGet(orderId) { return this.retail('/Orders/RetailOrderGet', { orderId }); }
  orderPaged(filter, page = 1, pageSize = 20) {
    return this.retail('/Orders/RetailOrderPaged', { filter: JSON.stringify(filter), pageInfo: JSON.stringify({ page, pageSize, amount: 0 }) });
  }
  pendingVoid(retailOrderId) { return this.retail('/Orders/RetailOrderPendingVoid', { retailOrderId }); }
  billTemplateConfigGet(id) { return this.retail('/Commons/RetailBillTemplateConfigGet', { id }); }
  billContentGet(id, extra) { return this.submit('/Orders/RetailOrderBillContentGet', { id, ...(extra || {}) }); }

  // ---------- returns ----------
  returnCreate(s) { return this.submit('/ReturnOrders/RetailReturnOrderCreate', s); }
  nonOrderReturnCreate(s) { return this.submit('/ReturnOrders/NonOrderReturnOrderCreate', s); }
  // return-order-service.ts returnOrderGet / returnOrderRetry (ReturnOrderManage.vue:336, 355): form field { id }
  returnGet(id) { return this.retail('/ReturnOrders/RetailReturnOrderGet', { id }); }
  returnRetry(id) { return this.retail('/ReturnOrders/RetailReturnOrderRetry', { id }); }
}

module.exports = { AirPos, newGuid, HOSTS };

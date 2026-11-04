// Air Register (AIR POS look) — local server. Serves the register UI and talks to the AIR POS
// cloud API directly; printing and the cash drawer go through the bundled helper (hw/), with the
// AIR POS hardware service (localhost:20001) only as an optional fallback. Binds to 127.0.0.1 only.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Register } = require('./lib/register');
const { Updater } = require('./lib/updater');
const { LogFile, scrub } = require('./lib/logfile');
const { RemoteHelp } = require('./lib/remote');
const { ScreenPics, MAX_BYTES: PIC_MAX } = require('./screenpics'); // 1.0.10 welcome picture + register logo (outside frozen app/lib)
const { CustMessages, defaults: custMsgDefaults, shopKey } = require('./custmsg'); // 1.0.9-local.5 (outside frozen app/lib)
const { MemberNote } = require('./membernote'); // store request #21
const { Quote } = require('./quote'); // store request #26
const { Reprint } = require('./reprint'); // 1.0.10-local.2: Reprint Receipt / Gift Receipt = the last sale, never History
const { PrinterCheck } = require('./printcheck'); // 1.0.10-local.2: Settings > Printer & Drawer > Check printers (read-only)
const { InstantScan } = require('./instantscan'); // 1.0.11 instant scan (Settings > Instant scan, off by default; outside frozen app/lib)
const { Labels } = require('./labels'); // Print Label (read-only item lookup + label printer; outside frozen app/lib)
const { BackOffice } = require('./backoffice'); // Orders tab: view and search only, one read-only AIR POS list (PLAN-orders-tab.md; outside frozen app/lib)
const LineDisc = require('./linedisc'); // AirMax Step 0b C1: what discount each sale line got, for the Discount cell (display only; outside frozen app/lib)
const { DiscLines } = require('./disclines'); // AirMax #18: "33% off -$9.90" under each discounted item on the printed receipt (print copy only; outside frozen app/lib)
const { DrawerLog } = require('./drawerlog'); // one log line per cash drawer attempt: why, printer, methods tried, answers (docs/DRAWER-TROUBLESHOOTING.md)

// Product search price, display only (what is added to a sale still comes from the scan). Real AIR POS ProductPaged rows
// have retailPrice 0; the price is in shopPrices (this shop) or standardPrices (base unit, rate 1). TestShop Oct 31
// (read-only): 72/72 rows matched the scan price; 737 of 751 items have no price at all (scan: "price not set") -> null, shown as "—".
const basePrice = (arr, ok) => { const x = (arr || []).find(q => q && (q.rate == null || q.rate === 1) && Number(q.price) > 0 && ok(q)); return x ? Number(x.price) : null; };
const shopPriceOf = (p, shop) => basePrice(p.shopPrices, q => !shop || q.shopId === shop), stdPriceOf = p => basePrice(p.standardPrices, () => true);
function listPrice(p, shop) {
  const sp = shopPriceOf(p, shop); if (sp != null) return sp;
  const st = stdPriceOf(p); if (st != null) return st;
  for (const k of ['retailPrice', 'price']) if (Number(p[k]) > 0) return Number(p[k]);
  return null;
}
// Not seen on TestShop: a shop price AND a different standard price. Ask the scan (same read-only look-up as Price Check)
// for up to 8 such rows, capped at 2.5 s so search stays fast; no answer keeps the shop price.
async function fillTwoPrice(list, rows) {
  const two = list.map((p, i) => i).filter(i => { const a = shopPriceOf(list[i], reg.api.shop), c = stdPriceOf(list[i]); return a != null && c != null && a !== c; }).slice(0, 8);
  if (!two.length) return;
  const cap = new Promise(res => setTimeout(res, 2500));
  await Promise.race([cap, Promise.all(two.map(i => reg.api.scan(list[i].number).then(x => { const v = x && x.success && x.value; if (v && (v.productId === list[i].id || v.number === list[i].number) && Number(v.price) > 0) rows[i].price = Number(v.price); }).catch(() => {})))]);
}
const CFG_PATH = process.env.AIRREG_CONFIG || path.join(__dirname, 'config.json');
const cfg = Object.assign({ port: 5157, blockedCompanies: [], build: 'customer' }, fs.existsSync(CFG_PATH) ? JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) : {});
// Dev/test boxes: the real names of companies that must never be signed in to come from the environment, not from a committed file.
// AIRMAX_BLOCKED_COMPANIES="company one,company two" (comma separated, any case). The customer installer never sets it.
cfg.blockedCompanies = [...(cfg.blockedCompanies || []), ...String(process.env.AIRMAX_BLOCKED_COMPANIES || '').split(',').map(s => s.trim()).filter(Boolean)];
const DATA = process.env.AIRREG_DATA || path.dirname(CFG_PATH);
try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { /* reported when a save fails */ }
const logFile = new LogFile(DATA); // DATA/logs/air-register.log, 1 MB x 5, scrubbed of card numbers / keys / passwords
const log = m => { const line = new Date().toLocaleTimeString('en-US', { hour12: false }) + ' ' + scrub(String(m)); console.log(line); logFile.write(new Date().toISOString().slice(0, 10) + ' ' + line); }; // never passwords/tokens
// crash safety: log and keep serving (the launcher restarts the process if it still dies)
process.on('uncaughtException', e => log('UNCAUGHT ' + (e && e.stack || e)));
process.on('unhandledRejection', e => log('UNHANDLED ' + (e && e.stack || e)));
const reg = new Register({ blockedCompanies: cfg.blockedCompanies || [], log, appDir: __dirname, dataDir: DATA });
reg.fastScan = true; // 1.0.11-speed.1: a scan shows the line at once; the total is checked in the background (every other route waits for it, below)
const pics = new ScreenPics(DATA, log);
const custMsgs = new CustMessages(DATA, log); // 1.0.9-local.5 customer screen texts per shop (display only)
// dev-only test sink (never in customer builds: needs AIRREG_DEV_PROBE=1): label bytes go to files instead of a printer
const labels = new Labels({ dataDir: DATA, reg, log, sink: process.env.AIRREG_DEV_PROBE === '1' && process.env.AIRMAX_LABEL_SINK ? process.env.AIRMAX_LABEL_SINK : null });
const reprint = new Reprint({ dataDir: DATA, reg, log, shopKey: () => curShopKey() });
new DiscLines({ reg, log }); // AirMax #18: hooks reg.discLinesKeep / reg.discLinesPdf (called from the airmax-fix-18 blocks in lib/register.js)
const prnCheck = new PrinterCheck({ reg, log });
const quote = new Quote({ reg, log }); // store request #26: print the sale on screen as a quote (not a sale, nothing saved)
const memNote = new MemberNote({ reg, log }); // store request #21: the customer's saved note (read only, memory only)
const backoffice = new BackOffice({ reg, log });
const drawerLog = new DrawerLog({ reg, log }).install(); // watches only: the drawer code itself is unchanged
const remote = new RemoteHelp({ scriptsDir: path.join(__dirname, '..', 'remote'), log }); // <install>\remote (staged by build.sh)
const updater = new Updater({ appDir: __dirname, dataDir: DATA, userCfg: cfg, log });
const PUB = path.join(__dirname, 'public');
const shortcuts = JSON.parse(fs.readFileSync(path.join(__dirname, 'shortcuts.json'), 'utf8'));

const needLogin = fn => async b => (reg.api.loggedIn ? fn(b) : { ok: false, message: 'Not logged in', loggedOut: true });
async function priceManagerOk(b) { // store request #23: manager-only Price Change
  if (reg.isManager()) return { ok: true };
  if (!b || (!b.user && !b.password)) return { ok: false, needManager: true, message: 'Price Change needs a manager. A manager logs in to approve it.' };
  const m = await reg.managerCheck({ user: b.user, password: b.password });
  if (!m.ok) return { ok: false, needManager: true, message: m.message };
  reg.log('PRICE CHANGE approved by manager login ' + String(b.user || '').trim()); return { ok: true };
}
const routes = {
  'login': async b => { const r = await reg.login(b.company, b.user, b.password); if (r && r.ok) { instant.onLogin(); instant.rescue(); } return r; }, // 1.0.11: instant scan list loads at the first login of this run (only when the setting is on)
  'logout': async () => reg.logout(),
  'clock-in': needLogin(b => reg.clockIn(b.amount)),
  'clock-out-expected': needLogin(() => reg.expectedClockOut()),
  'clock-out': needLogin(b => reg.clockOut(b.amount)),
  'scan': needLogin(b => (reg.mode === 'return' ? reg.returnScan(b.code) : reg.retOn ? reg.mixScan(b.code) : reg.scan(b.code))),
  'return-toggle': needLogin(b => reg.toggleReturnScan(b.on)),
  'mix-remove': needLogin(b => reg.mixRemove(b.row)),
  'mix-qty': needLogin(b => reg.mixQty(b.row, Number(b.d) || 0)),
  'mix-refund': needLogin(b => reg.mixSettle(b.type)),
  'search': needLogin(async b => { if (instant.ready()) return instant.search(b.keyword, b.page || 1, 24); /* 1.0.11 instant scan on + list loaded: from the saved list at once */  const r = await reg.api.productPaged(b.keyword || '', b.page || 1, 24); const list = (r && r.rows) || []; const rows = list.map(p => ({ number: p.number, upc: p.upc, name: p.name, price: listPrice(p, reg.api.shop), unitName: p.unitName, categoryName: p.categoryName })); await fillTwoPrice(list, rows); return { ok: !!(r && r.rows), total: r && r.total, rows }; }),
  'qty': needLogin(b => reg.setQty(b.row, b.qty)),
  'qty-plus': needLogin(b => reg.addQty(b.row, 1)),
  'qty-minus': needLogin(b => reg.addQty(b.row, -1)),
  'remove': needLogin(b => (reg.mode === 'return' ? reg.returnRemove(b.row) : reg.remove(b.row))),
  'discount': needLogin(b => reg.setOrderDiscount(b.kind, b.value)),
  'new-sale': needLogin(() => reg.newSale()),
  'hold': needLogin(() => reg.hold()),
  'held': needLogin(() => reg.heldOrders()),
  'resume': needLogin(b => reg.resume(b.orderId)),
  'void-held': needLogin(b => reg.voidHeld(b.orderId)),
  'line-discount': needLogin(b => reg.lineDiscount(b.row, b.kind, b.value)),
  // Store request #23/#6 (Gordon, Nov 3 2026): the left-column Price Change button is manager-only. An AIR POS manager goes straight through; a cashier needs a manager's
  // login (same check as Tax Off / Restart PC, reg.managerCheck), verified HERE on every call (the screen is not trusted). Still this sale only, lower price only (reg.lineDiscount 'price').
  'price-approve': needLogin(async b => priceManagerOk(b)),
  'price-change': needLogin(async b => { const m = await priceManagerOk(b); return m.ok ? reg.lineDiscount(b.row, 'price', b.value) : m; }),
  'line-tax': needLogin(b => reg.lineTax(b.row, b.rate)),
  'tax-exempt': needLogin(b => reg.setTaxExempt(b.on, b)),
  'bulk-add': needLogin(b => reg.addBulk(b.index, b.price, b.folder).then(r => (r && typeof r.message === 'string' ? { ...r, message: r.message.replace('use an Open Item (F7)', 'use a Temporary Item (F7)') } : r))), // 1.0.5: folder = bulk folder id (none = top-level button). Open Item is called Temporary Item now (Ari 11:05 PM Oct 31); register.js is frozen, so its one refusal text is renamed here
  'temp-item': needLogin(b => reg.addSpecial('temp', b)),
  'temp-tax': needLogin(() => reg.tempTaxInfo()), 'temp-tax-set': needLogin(b => reg.setTempTax(b.id)), // tt1011: Temporary Item tax (Taxable switch)
  'extra-charge': needLogin(b => reg.addSpecial('extra', b)),
  'promo-code': needLogin(b => reg.setPromoCode(b.code)),
  'predefined-discount': needLogin(b => reg.setPredefinedDiscount(b.id)),
  'member-attach': needLogin(b => reg.attachMember(b.number)),
  'member-detach': needLogin(() => reg.detachMember()),
  'member-add': needLogin(b => reg.addMember(b)),
  'member-find': needLogin(b => reg.findMembers(b.keyword)),
  'points': needLogin(b => reg.setPoints(b.points)),
  'pay-start': needLogin(() => reg.startPay()),
  'pay-close': needLogin(() => reg.closePay()),
  'pay-recheck': needLogin(() => reg.payRecheck()), // 1.2.3.1: read AIR POS again (never posts a payment)
  'pay-tender': needLogin(b => reg.tender(b)),
  'manager-approve': needLogin(b => reg.managerApprove(b.user, b.password)),
  // Remote Help (RustDesk). Shows the ID only; the password is never read or returned (Administrators-only file + one-time popup).
  'remote-status': needLogin(() => remote.status()),
  'remote-setup': needLogin(async b => { b.password = null; return ({ ok: false, message: 'Remote Help is managed from the regular Air Register, not this app' }); }), // AIR POS look app never installs/changes RustDesk
  'gift-verify': needLogin(b => reg.verifyGiftCard(b.number, b.secret)),
  'card-cancel': needLogin(b => reg.cardCancel({ release: !!(b && b.release === true) })), // local.9: release = cashier confirmed (keyed card, see register.cardCancel)
  'card-retry': needLogin(() => reg.cardRetry()),
  'finish-sale': needLogin(() => reg.finishSale()),
  'keyed-key': needLogin(async () => reg.keyedKey()),
  'keyed-confirmed': needLogin(() => reg.keyedConfirmed()),
  'keyed-failed': needLogin(b => reg.keyedFailed(b.message)),
  'member-details': needLogin(b => reg.memberDetails(b.id)),
  // AirMax 1.0.9 card on file (Stripe stores only; any cashier). The SetupIntent client secret goes back to this screen only.
  'member-cards': needLogin(b => reg.memberCards(b.id)),
  'member-card-add-begin': needLogin(b => reg.memberCardAddBegin(b.id)),
  'member-card-add-complete': needLogin(b => reg.memberCardAddComplete(b)),
  'member-card-delete': needLogin(b => reg.memberCardDelete(b.id, b.cardId)),
  // 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31): per-store switch, off by default, manager only to change. The Sola Add card
  // request (member-card-add-complete with card) is never logged: the route body is not logged and the card is wiped in the register.
  'sola-cards': needLogin(async () => reg.solaCardsInfo()),
  'sola-cards-set': needLogin(async b => reg.setSolaCards(!!(b && b.on === true))),
  'member-update': needLogin(b => reg.updateMember(b)),
  'member-orders': needLogin(b => reg.memberOrders(b.number)),
  'gift-lookup': needLogin(b => reg.giftLookup(b.number)),
  'gift-cards': needLogin(b => reg.giftCards(b.keyword)),
  'gift-line': needLogin(b => reg.addGiftLine(b)),
  'aside-put': needLogin(async () => reg.putAside()),
  'aside-list': needLogin(async () => reg.asideList()),
  'aside-load': needLogin(b => reg.loadAside(b.id)),
  'aside-delete': needLogin(async b => reg.asideDelete(b.id)),
  'price-check': needLogin(b => reg.priceCheck(b.code)),
  'note': needLogin(async b => reg.setNote(b.text)),
  'gift-receipt': needLogin(async b => { const r = reg.setGiftReceipt(!!b.on); reprint.setPick(r && r.ok && b.on ? b.exclude : null); const n = Array.isArray(b.exclude) && b.on && r && r.ok ? b.exclude.length : 0; return n && Number(b.of) > n ? { ...r, message: `Gift receipt will print with this sale: ${Number(b.of) - n} of ${Number(b.of)} items, no prices` } : r; }), // 1.0.11-local.6g: exclude = unticked lines
  'gift-cart-items': needLogin(async () => reprint.cartItems()), // 1.0.11-local.6g picker list (cart lines; nothing printed)
  // Print Label: read-only (item lookup + label printer); never touches the sale
  'label-settings': needLogin(async () => labels.get()),
  'label-settings-save': needLogin(async b => labels.save(b)),
  'label-lookup': needLogin(b => labels.lookup(b.code)),
  'label-print': needLogin(b => labels.print(b)),
  // 1.0.11-local.9 Print Labels (layouts): read-only lookups; defaults saved on this PC only; label price = printout only
  'labels-layouts': needLogin(async () => labels.layouts()),
  'labels-lookup': needLogin(b => labels.lookupRow(b.code)),
  'labels-default-save': needLogin(async b => labels.saveDefault(b)),
  'labels-print': needLogin(b => labels.printBatch(b)),
  // Orders tab (top bar, next to RETAIL SALES): view and search only. Never touches the sale; both are UNLOCKED (never wait for the sale queue)
  'backoffice-options': needLogin(async () => backoffice.options()),
  'backoffice-orders': needLogin(b => backoffice.orders(b)),
  'drawer-log': needLogin(async () => reg.drawerLog()),
  'pay-cash': needLogin(b => reg.payCash(b.tendered)),
  'drawer': needLogin(b => reg.drawer(false, b.password)),
  'drawer-sale': needLogin(b => reg.drawerForSale(b.password)),
  'print': needLogin(b => reg.printOrder(b.orderId, b.choice)),
  'print-return': needLogin(b => reg.printReturn(b.returnId)),
  'orders': needLogin(b => reg.orders(b)),
  'order': needLogin(b => reg.orderDetails(b.orderId)),
  'return-start': needLogin(b => reg.startReturn(b.kind, b.orderId)),
  'return-cancel': needLogin(async () => reg.cancelReturn()),
  'return-confirm': needLogin(() => reg.confirmReturn()),
  'return-account': needLogin(b => reg.setReturnToAccount(!!b.on)),
  'card-refund-retry': needLogin(b => reg.retryCardRefund(b && b.retId)), // same return id only; never a new return
  'x-report': needLogin(() => reg.xReport()),
  'report-print': needLogin(b => reg.printReport(b.kind, b.id)),
  'report-preview': needLogin(b => reg.previewReport(b.kind, b.id)),
  'z-generate': needLogin(() => reg.zGenerate()),
  'z-list': needLogin(() => reg.zList()),
  'cash-move': needLogin(b => reg.cashMove(b.kind, b.amount, b.remark)),
  'drawer-balance': needLogin(() => reg.drawerBalance()),
  'printers': async () => reg.printers(),
  'settings': async b => { // 1.0.9-local.5: a welcome change through Settings also updates this shop's saved welcome lines (one truth)
    const r = await reg.saveSettings(b);
    try {
      const k = curShopKey(), w = {};
      if (b && typeof b.custWelcome === 'string') w.welcome = b.custWelcome;
      if (b && typeof b.custWelcome2 === 'string') w.welcome2 = b.custWelcome2;
      if (r && r.ok !== false && k && Object.keys(w).length && picMgr()) custMsgs.set(k, w);
    } catch (e) { log('customer messages mirror: ' + e.message); }
    return r;
  },
  'test-print': async () => reg.testPrint(),
  'test-drawer': async () => reg.openDrawerRaw(),
  'printer-diagnostics': async () => { // 1.0.10-local.2: the last Check printers results go into the same file
    const r = await reg.printerDiagnostics(); if (!r || !r.text) return r;
    const add = prnCheck.report(); r.text += add;
    if (r.ok && r.file) { try { fs.appendFileSync(r.file, add); } catch (e) { log('diagnostics: check printers part not saved: ' + e.message); } }
    return r;
  },
  'printer-check': async () => prnCheck.list(),
  'printer-check-print': async b => prnCheck.tests(b || {}),
  'last-receipt': needLogin(async () => reprint.lastReceipt()),
  'quote-print': needLogin(async () => quote.print()), // store request #26: read-only, prints "QUOTE / ESTIMATE - NOT A SALE - NOT PAID"
  'gift-reprint': needLogin(async b => reprint.gift(b && b.orderId)),
  'gift-items': needLogin(async b => reprint.giftItems(b && b.orderId)), // 1.0.11-local.6g picker list (read-only RetailOrderGet)
  'gift-pick-print': needLogin(async b => reprint.giftPick(b && b.orderId, b && b.ids)), // 1.0.11-local.6g ticked items, no prices
  // 1.2.3 (owner 4:27 PM): tapping the version runs this. Answers within ~1.5 s with the status so far; a long download keeps
  // going in the updater (the screen polls /api/state). Same check() as the automatic 20 s / 6 h checks (busy flag: never two at once).
  'update-check': async () => { if (updater.status.state === 'ready') return { ok: true, update: updater.status }; const p = updater.check(); await Promise.race([p, new Promise(r => setTimeout(r, 1500))]); return { ok: true, update: updater.status }; },
  'hw-notes': needLogin(async () => ({ ok: true, notes: reg.hwNotesRecent() })), // request L: background printer/drawer failures
  'stock-note': needLogin(b => reg.stockNote(b.code)), // request K: read-only, after a scan
  'dismiss': async () => { reg.completed = null; if (reg.pay) reg.pay.result = null; return { ok: true }; },
  'hardware': async () => { const r = await reg.deviceInfo(); return { ok: r.ok, message: reg.hwStatus.message }; },
  'client-error': async b => { log('UI ERROR ' + String(b.message || '').slice(0, 500) + (b.where ? ' @ ' + String(b.where).slice(0, 200) : '')); return { ok: true }; },
  'recover-check': needLogin(() => reg.retryRecovery()),
  'notice-dismiss': async () => { reg.notice = null; return { ok: true }; },
  'exit-windows': b => reg.exitToWindows(b),
  'power': needLogin(b => reg.power(b)),
  // 1.2.3 (owner 4:29 PM): "Update now". Only a downloaded, sha512-verified update; never during an open sale or payment.
  // The launcher (AirRegister.ps1) sees control.json {action:'update'}, closes the window, installs silently, restarts Air Register.
  'update-install': async () => {
    const u = updater.status; if (u.state !== 'ready') return { ok: false, message: 'No downloaded update yet. Tap the version number to check.' };
    if (reg.pay || reg.subs.length || reg.locked()) return { ok: false, message: 'Finish or hold the current sale first.', openSale: true };
    log('UPDATE NOW requested: ' + u.current + ' -> ' + u.available); reg.control('update');
    return { ok: true, installing: true, message: 'Installing update ' + u.available + '. Air Max will close and open again in a moment…' };
  },
};
// Routes that change the sale run one at a time (scans queue up instead of being dropped), and a money route
// already running is never started a second time by a double click / double Enter (no double charge).
const UNLOCKED = new Set(['remote-status', 'held', 'search', 'member-find', 'member-details', 'member-cards', 'member-orders', 'gift-lookup', 'gift-cards', 'aside-list', 'price-check', 'drawer-log',
  'print', 'print-return', 'orders', 'order', 'x-report', 'report-print', 'report-preview', 'z-list', 'drawer-balance', 'label-settings', 'label-settings-save', 'label-lookup', 'label-print', 'labels-layouts', 'labels-lookup', 'labels-default-save', 'labels-print', 'printers', 'test-print', 'test-drawer', 'printer-diagnostics', 'printer-check', 'printer-check-print', 'last-receipt', 'gift-reprint', 'gift-items', 'gift-pick-print',
  'update-check', 'hardware', 'drawer', 'drawer-sale', 'keyed-key', 'sola-cards', 'clock-out-expected', 'client-error', 'notice-dismiss', 'dev-fault', 'dev-probe',
  'stock-note', // 1.0.11-speed.1: the in-stock note after a scan is read-only, so it no longer waits behind the next scan / total check
  'backoffice-options', 'backoffice-orders', 'quote-print']); // Orders tab: read-only, so it never holds up a scan or a payment and is never journalled
const ONCE = new Set(['mix-refund', 'sola-cards-set', 'member-card-add-begin', 'member-card-add-complete', 'member-card-delete', 'pay-recheck', 'remote-setup', 'pay-tender', 'pay-cash', 'finish-sale', 'return-confirm', 'card-refund-retry', 'hold', 'card-retry', 'clock-out', 'clock-in', 'z-generate', 'cash-move', 'keyed-confirmed', 'login', 'exit-windows', 'power', 'void-held', 'resume', 'update-install']);
const NO_SNAP = new Set(['remote-setup', 'login', 'logout', 'clock-in', 'clock-out', 'exit-windows', 'power', 'update-install']);
const running = new Set(); let chain = Promise.resolve();
// 1.0.9-local.7 (pb109b): while Air Register is still checking an unfinished sale from before with AIR POS (unclear reply at restart /
// login), no new sale is rung or paid: the earlier sale may already have money on it, and the recheck must never replace a sale being paid.
const RECOVER_WAIT = new Set(['scan', 'bulk-add', 'temp-item', 'extra-charge', 'gift-line', 'resume', 'aside-load', 'pay-start', 'pay-tender', 'pay-cash']);
const RECOVER_WAIT_MSG = () => ({ ok: false, recoveryPending: true, message: 'Air Max is still checking the unfinished sale from before with AIR POS (it may already have a payment on it), so nothing new can be rung or paid yet. Press Check again on the notice, or wait: it checks again automatically.' });
const locked = (name, fn) => b => {
  if (ONCE.has(name) && running.has(name)) return Promise.resolve({ ok: false, busy: true, message: 'Still working on the last request…' });
  running.add(name);
  const p = chain.then(async () => { try { if (RECOVER_WAIT.has(name) && reg.recoveryPending && reg.api.loggedIn && reg.mode === 'sale' && ((reg.journal && reg.journal.read()) || {}).kind === 'sale') return RECOVER_WAIT_MSG(); if (name !== 'scan') await reg.settle(); return await fn(b); } finally { if (!NO_SNAP.has(name)) { try { reg.journalSnap('route'); } catch (e) { log('JOURNAL ' + e.message); } } } });
  chain = p.catch(() => {}); return p.finally(() => running.delete(name));
};
// 1.0.11 (F1, review of instant scan): qty / Delete / F4 / tax are asked for by ROW (position, newest first). An instant scan adds its line
// at once, outside the queue, so rows can shift while such a request waits. The line is pinned by its id when the request arrives (the screen
// sends the id of the line it showed; without one, the line at that row right now) and the row is looked up again when the request runs.
const LINE_ROUTES = new Set(['qty', 'qty-plus', 'qty-minus', 'remove', 'line-discount', 'line-tax', 'price-change']);
const pinLine = (name, b) => { if (!LINE_ROUTES.has(name) || !b || reg.mode !== 'sale' || b.lineId != null) return; const l = reg.sorted()[b.row == null ? 0 : Number(b.row)]; if (l) b.lineId = l.id; };
const RESCUE_FIRST = new Set(['pay-start', 'pay-tender', 'pay-cash', 'finish-sale', 'hold']);
const lineGone = b => { // runs inside the queue: null = go on (b.row is the line's row now)
  if (!b || b.lineId == null || reg.mode !== 'sale') return null;
  const i = reg.sorted().findIndex(s => s.id === b.lineId);
  if (i < 0) return { ok: false, lineGone: true, message: 'That line is no longer on the sale (it was taken off or changed). Select the line again.' };
  b.row = i; return null;
};
// 1.0.11 instant scan: background checks run in the same request queue as everything else (so Pay, F4, Hold ... wait for them)
const instant = new InstantScan({ reg, dataDir: DATA, log, shopKey: () => curShopKey(), listPrice, running, enqueue: fn => locked('instant-check', fn)({}) });
routes['instant-scan'] = b => (b && typeof b.on === 'boolean' ? instant.setOn(b.on) : { ok: true, ...instant.status() });
// dev-only fault injection for the hardening tests (never in customer builds: needs AIRREG_DEV_PROBE=1)
if (process.env.AIRREG_DEV_PROBE === '1') routes['dev-fault'] = async b => {
  if (b.api !== undefined) reg.api.faults = (Array.isArray(b.api) ? b.api : b.api ? [b.api] : []).map(f => ({ path: String(f.path || ''), mode: f.mode === 'lost-reply' ? 'lost-reply' : 'down', count: Number(f.count) || 1 }));
  if (b.expire) reg.api.ide = 'expired-' + Date.now(); // the next call gets "session expired" from the server
  if (b.hw !== undefined) reg.hw.fault = b.hw || null;
  if (b.update) updater.set(String(b.update.state), String(b.update.message || ''), b.update.available ? { available: String(b.update.available) } : {}); // e2e-update-tap: pretend a verified download is ready
  if (b.orderGet) { const g = await reg.api.orderGet(b.orderGet); return { ok: true, raw: g && g.value ? { success: g.success, id: g.value.id, status: g.value.status, receives: (g.value.receives || []).map(r => ({ id: r.id, status: r.status, amount: r.amount, paymentType: r.paymentType })) } : g }; }
  if (b.crash === 'exit') setTimeout(() => process.exit(3), 50);
  if (b.crash === 'throw') setTimeout(() => { throw new Error('test crash'); }, 10);
  return { ok: true, api: reg.api.faults, hw: reg.hw.fault || null, rss: process.memoryUsage().rss, heap: process.memoryUsage().heapUsed };
};
// dev-only shape probe (never in customer builds: needs AIRREG_DEV_PROBE=1). Returns field names, not secrets.
if (process.env.AIRREG_DEV_PROBE === '1') routes['dev-probe'] = needLogin(async b => {
  const shape = o => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' ? (Array.isArray(v) ? 'array' + v.length : 'obj') : (typeof v === 'string' && /key|secret/i.test(k) ? (v ? v.slice(0, 8) + '…' : '') : v)])) : o);
  const a = reg.api, out = {};
  const ch = await a.receiveChannelGet(30); out.channel = shape(ch && 'value' in ch ? ch.value : ch); out.channelRaw = shape(ch);
  const ch20 = await a.receiveChannelGet(20); out.channel20 = shape(ch20 && 'value' in ch20 ? ch20.value : ch20);
  const sc = await a.scan(b.code || '00001'); out.scan = shape(sc && sc.value);
  // 1.2.0: any AIR POS settings about stock / negative inventory (to see whether selling below zero can be allowed)
  const stockKeys = o => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => /stock|inventor|negative|minus|zero|oversell|writedown|write_down/i.test(k)).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : v])) : {});
  const home = reg.home || {}; out.stockSettings = { retail: stockKeys(home.retailConfig), basic: stockKeys(home.retailConfig && home.retailConfig.basicSetting), terminal: stockKeys(home.terminalConfig), top: stockKeys(home) };
  const pp = await a.productPaged(b.code || '00001', 1, 2); out.product = shape(pp && pp.rows && pp.rows[0]);
  const gs = await a.giftCardSelect(''); const gl = (gs && 'value' in gs ? gs.value : gs) || []; out.giftSelect = Array.isArray(gl) ? gl.slice(0, 3).map(shape) : shape(gs);
  if (Array.isArray(gl) && gl[0]) { const gg = await a.giftCardGet(gl[0].cardNo || gl[0].number); out.giftGet = shape(gg && gg.value); }
  const op = await a.orderPaged({ number: null, productNumber: null, memberNumber: '', orderDate: null }, 1, 1); const o = op && op.rows && op.rows[0];
  if (o) { const g = await a.orderGet(o.id); out.order = shape(g && g.value); }
  const mp = await a.memberPaged({ mobile: '', name: '', status: null }, 1, 50); out.memberCount = mp && mp.total; const m = mp && mp.rows && mp.rows[0]; out.memberRow = shape(m);
  if (m) { const mg = await a.memberGet(m.id); out.memberGet = shape(mg && 'value' in mg ? mg.value : mg); }
  return { ok: true, out };
});

// 1.0.10: picture settings (manager only). Upload is its own raw-bytes route below (5 MB); this one is JSON (remove / fit / fill).
const picMgr = () => reg.api.loggedIn && reg.isManager();
routes['screen-picture-set'] = needLogin(b => picMgr() ? pics.set(b) : { ok: false, message: 'Only a manager can change the screen pictures' });
// 1.0.9-local.5: customer screen texts for the logged-in shop (manager only to change; display only, no sale data)
const curShopKey = () => { try { return reg.api.loggedIn ? shopKey((reg.api.identity || {}).corpName, reg.api.shop) : ''; } catch (e) { return ''; } };
routes['cust-messages'] = needLogin(() => ({ ok: true, messages: custMsgs.saved(curShopKey()), fields: custMsgDefaults(), manager: picMgr() }));
routes['cust-messages-set'] = needLogin(b => picMgr() ? custMsgs.set(curShopKey(), b || {}) : { ok: false, message: 'Only a manager can change the customer screen messages' });
// 1.0.10 customer screen: read-only extras. cardWait only while a terminal card payment is waiting (display only, nothing changed)
const custExtras = () => {
  const w = pics.state().welcome, x = { welcomePic: w ? w.src : null, welcomePicFit: w ? w.fit : null, welcomePicFill: w ? w.fill : null, cardWait: null };
  try {
    const p = reg.pay, c = p && p.card;
    if (c && c.status === 'waiting' && c.kind !== 'keyed') {
      const t = (p.tenders || []).find(t => t.id === c.tenderId);
      const cs = reg.customerState(), due = cs && cs.pay ? cs.pay.due : null;
      const amount = t && Number(t.amount) > 0 ? Number(t.amount) : due;
      if (amount != null) x.cardWait = { amount };
    }
  } catch (e) { /* display only */ }
  try { // 1.0.9-local.5 per-shop texts; the welcome falls back to this PC's older welcome setting, then "Welcome"
    const k = curShopKey(); if (k) custMsgs.seen(k);
    const m = custMsgs.shown(k), sv = custMsgs.saved(k || custMsgs.data.lastShop), st = reg.settings || {};
    x.msgs = { itemsHead: m.itemsHead, returnHead: m.returnHead, cardReader: m.cardReader, thankYou: m.thankYou };
    x.welcome = sv.welcome || (typeof st.custWelcome === 'string' ? st.custWelcome : '');
    x.welcome2 = sv.welcome2 || (typeof st.custWelcome2 === 'string' ? st.custWelcome2 : '');
  } catch (e) { /* display only: the screen keeps its built-in texts */ }
  return x;
};

// ---- AirMax API plugins (Step 0, api/step-0-plumbing). Every app/api/*.js is loaded here, once, at start-up, so a batch only ADDS a file
// and never edits this one. A plugin file is `module.exports = ctx => ({ routes, unlocked, once, noSnap, open })` (or the same object):
//   routes   { 'name': async body => ({ ok: true, ... }) }  served as POST /api/<name>; wrapped in needLogin unless listed in `open`
//   unlocked [names]  read-only routes that skip the one-at-a-time sale queue (same as the UNLOCKED list above)
//   once     [names]  routes that must never run twice at once (money / save routes; same as ONCE above)
//   noSnap   [names]  routes that must not write the sale journal after they run (same as NO_SNAP above)
//   open     [names]  routes that work while logged out (rare)
// ctx = { reg, log, needLogin, isManager, perms, hasMenu, dataDir }  (hasMenu('Operator Management') / hasMenu('/operator-manage'): is that AIR POS menu entry (reg.home.menus) there for this login; super admin = yes). A name already used by a built-in route or another plugin is refused (logged).
// app/lib is never touched: a plugin calls AIR POS through ctx.reg.api.retail(path, params) / ctx.reg.api.submit(path, obj).
// AIR POS menu entries this login can see (reg.home.menus), flattened to [{ name, path }]. The shape is not fixed, so strings, { name | title | label, path | uri | url | route } and nested children / menus / subs are all read.
const flatMenus = (m, out = [], d = 0) => { if (d > 6 || m == null) return out; if (typeof m === 'string') { out.push({ name: m.slice(0, 80), path: '' }); return out; }
  if (Array.isArray(m)) { m.forEach(x => flatMenus(x, out, d + 1)); return out; }
  if (typeof m === 'object') { const name = m.name || m.title || m.label || m.text || '', path = m.path || m.uri || m.url || m.route || m.href || ''; if (name || path) out.push({ name: String(name).slice(0, 80), path: String(path).slice(0, 120) });
    for (const k of ['children', 'menus', 'subs', 'items']) if (m[k]) flatMenus(m[k], out, d + 1); }
  return out; };
const permsNow = () => { const id = reg.identity || {}, h = reg.home || {}; return { manager: !!(reg.api.loggedIn && reg.isManager()), superAdmin: !!id.superAdmin, authorities: Array.isArray(h.authorities) ? h.authorities.map(String) : [], menus: flatMenus(h.menus) }; };
routes['perms'] = needLogin(async () => ({ ok: true, ...permsNow() })); UNLOCKED.add('perms'); // what this login may do in AIR POS (read-only; screens use it to hide / disable tabs and buttons)
const hasMenu = (want, p = permsNow()) => { const w = String(want).toLowerCase(); return p.superAdmin || p.menus.some(x => x.name.toLowerCase() === w || x.path.toLowerCase() === w); };
const apiCtx = { reg, log, needLogin, isManager: () => permsNow().manager, perms: permsNow, hasMenu, dataDir: DATA };
const API_DIR = process.env.AIRMAX_API_DIR || path.join(__dirname, 'api'), apiLoaded = []; // AIRMAX_API_DIR: tests only (a folder of sample plugins)
const listJs = dir => { try { return fs.readdirSync(dir).filter(f => /^[\w.-]+\.js$/.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort(); } catch (e) { return []; } };
for (const f of listJs(API_DIR)) {
  try {
    const mod = require(path.join(API_DIR, f)), def = typeof mod === 'function' ? mod(apiCtx) : mod;
    if (!def || typeof def.routes !== 'object') throw new Error('no routes object');
    const open = new Set(def.open || []), added = [];
    for (const [name, fn] of Object.entries(def.routes)) {
      if (!/^[\w-]+$/.test(name) || typeof fn !== 'function') { log('API PLUGIN ' + f + ': bad route ' + String(name).slice(0, 40) + ' skipped'); continue; }
      if (routes[name]) { log('API PLUGIN ' + f + ': route ' + name + ' already exists, skipped'); continue; }
      routes[name] = open.has(name) ? fn : needLogin(fn); added.push(name);
    }
    const mine = list => (list || []).filter(n => added.includes(n));
    for (const n of mine(def.unlocked)) UNLOCKED.add(n);
    for (const n of mine(def.once)) ONCE.add(n);
    for (const n of mine(def.noSnap)) NO_SNAP.add(n);
    apiLoaded.push(f + ' (' + added.length + ' routes)');
  } catch (e) { log('API PLUGIN ' + f + ' not loaded: ' + (e && e.message || e)); } // one bad plugin never stops the register
}
if (apiLoaded.length) log('API plugins: ' + apiLoaded.join(', '));

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Only accept browser requests from our own origin (blocks other sites calling the local API)
  const origin = req.headers.origin; const host = req.headers.host || '';
  if (origin && origin !== 'http://' + host) return send(res, 403, { ok: false, message: 'forbidden' });
  if (url.pathname === '/api/state') return send(res, 200, { ...reg.state(), instant: instant.status(), lineIds: reg.mode === 'sale' ? reg.sorted().map(s => s.id) : [], lineDisc: reg.mode === 'sale' ? (() => { try { return LineDisc.forSale(reg.sorted(), reg.promotionSubs, reg.totals && reg.totals.promotionDiscount); } catch (e) { return []; } })() : [], memberNote: (() => { try { return memNote.current(); } catch (e) { return null; } })(), build: cfg.build, version: updater.current, update: updater.status, blocked: (cfg.blockedCompanies || []).length > 0, screenPics: pics.state() });
  if (url.pathname === '/api/customer-state') return send(res, 200, { ...reg.customerState(), ...custExtras(), updating: !!(reg.totals && (reg.totals.updating || (reg.totals.stale && reg.subs.length && !reg.pay))) }); // customer display (read-only GET)
  if (url.pathname === '/customer-logo') { // 1.2.1 customer screen logo: fixed file, fixed type (read-only GET)
    const l = reg.customerLogoFile(); if (!l) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); return res.end('no logo'); }
    res.writeHead(200, { 'Content-Type': l.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    return fs.createReadStream(l.file).pipe(res);
  }
  if (url.pathname === '/screen-picture/welcome' || url.pathname === '/screen-picture/salelogo') { // 1.0.10: fixed file, fixed type (read-only GET)
    const l = pics.file(url.pathname.endsWith('welcome') ? 'welcome' : 'saleLogo'); if (!l) { res.writeHead(404, { 'X-Content-Type-Options': 'nosniff' }); return res.end('no picture'); }
    res.writeHead(200, { 'Content-Type': l.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
    return fs.createReadStream(l.file).pipe(res);
  }
  if (url.pathname === '/api/screen-picture') { // 1.0.10 upload: raw PNG/JPEG bytes, own 5 MB limit; custom header forces a same-origin-only request
    if (req.method !== 'POST' || req.headers['x-airmax-upload'] !== '1') return send(res, 404, { ok: false, message: 'unknown' });
    const kind = url.searchParams.get('kind') === 'salelogo' ? 'saleLogo' : url.searchParams.get('kind') === 'welcome' ? 'welcome' : '';
    if (!kind) return send(res, 400, { ok: false, message: 'Unknown picture' });
    if (!reg.api.loggedIn) return send(res, 200, { ok: false, message: 'Log in first', loggedIn: false });
    if (!reg.isManager()) return send(res, 200, { ok: false, message: 'Only a manager can change the screen pictures', loggedIn: true });
    if (Number(req.headers['content-length']) > PIC_MAX) { req.resume(); return send(res, 413, { ok: false, message: 'The picture is bigger than 5 MB. Save it smaller and try again.' }); }
    const parts = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > PIC_MAX) { res.setHeader('Connection', 'close'); return send(res, 413, { ok: false, message: 'The picture is bigger than 5 MB. Save it smaller and try again.' }); } parts.push(c); }
    try { return send(res, 200, { ...pics.put(kind, Buffer.concat(parts)), loggedIn: true }); }
    catch (e) { log('SCREEN PICTURE ' + e.message); return send(res, 500, { ok: false, message: 'Could not save the picture (' + e.message + ')' }); }
  }
  if (url.pathname === '/api/shortcuts') return send(res, 200, shortcuts);
  if (url.pathname === '/api/sections') return send(res, 200, { files: listJs(path.join(PUB, 'sections')) }); // top bar: screen files app/public/sections/*.js, loaded by the page in this order (read-only GET)
  if (url.pathname === '/export/log') { // Settings > Export log (already scrubbed of card data and passwords)
    const txt = logFile.exportText(`Air Max ${updater.current} log export ${new Date().toISOString()}\nCompany: ${(reg.identity && reg.identity.corpName) || '-'}\n`);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="air-register-log-' + new Date().toISOString().slice(0, 10) + '.txt"', 'Cache-Control': 'no-store' });
    return res.end(txt);
  }
  if (url.pathname.startsWith('/preview/')) { // last X/Z report PDF, shown inside the app
    if (!reg.preview || !reg.api.loggedIn) { res.writeHead(404); return res.end('no preview'); }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="' + reg.preview.name + '"', 'Cache-Control': 'no-store' });
    return res.end(reg.preview.buf);
  }
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5), raw = routes[name];
    const fn = raw && (UNLOCKED.has(name) ? raw : locked(name, LINE_ROUTES.has(name) ? (bb => lineGone(bb) || raw(bb)) : raw));
    if (!fn || req.method !== 'POST') return send(res, 404, { ok: false, message: 'unknown' });
    let body = ''; for await (const c of req) { body += c; if (body.length > 1e6) return send(res, 413, {}); }
    let b = {}; try { b = body ? JSON.parse(body) : {}; } catch { return send(res, 400, { ok: false, message: 'bad json' }); }
    if (RESCUE_FIRST.has(name)) instant.rescue(); // 1.0.11 (F2): a restored unchecked line is checked BEFORE this Pay / Hold runs
    pinLine(name, b); // 1.0.11 (F1): the line is fixed by its id the moment the request arrives
    try { const out = await drawerLog.run(name, () => (name === 'scan' && reg.api.loggedIn && b && instant.canAdd(b.code) ? instant.scanNow(b.code) : fn(b))); /* 1.0.11 instant scan: from the list at once, AIR POS checks it next in the queue */ b = null; try { reprint.note(); } catch (e) { /* print-only helper, never blocks a request */ } return send(res, 200, { ...(out || {}), loggedIn: reg.api.loggedIn }); }
    catch (e) { log('ERROR ' + url.pathname + ': ' + (e && e.stack || e)); return send(res, 500, { ok: false, retryable: true, message: 'Something went wrong (' + e.message + '). Nothing was lost; press Retry. If it keeps happening, use Settings > Export log.' }); }
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname === '/customer' ? '/customer.html' : url.pathname;
  const f = path.join(PUB, path.normalize(p).replace(/^([.][.][/\\])+/, ''));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  // CSP: only our own scripts, plus Stripe.js for the keyed-card form (card fields live in Stripe's iframe)
  const csp = "default-src 'self'; script-src 'self' https://js.stripe.com https://*.js.stripe.com; frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.stripe.com https://m.stripe.network; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.stripe.com; object-src 'none'; base-uri 'none'; form-action 'none'";
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  fs.createReadStream(f).pipe(res);
});
// 1.0.11 (F2): a line restored "not confirmed" after a crash is checked by itself (also when instant scan is off now)
setInterval(() => { try { instant.rescue(); } catch (e) { log('instant rescue: ' + e.message); } }, 2000).unref();
// re-check a recovery that could not reach the server, as soon as the connection is back
setInterval(() => { if (reg.recoveryPending && reg.api.loggedIn && reg.mode === 'sale' && !running.size) locked('recover-check', () => reg.retryRecovery())({}).catch(() => {}); }, 15000).unref();
server.on('error', e => { log('SERVER ' + e.message); if (e.code === 'EADDRINUSE') process.exit(2); });
server.listen(cfg.port, '127.0.0.1', () => { log(`Air Max on http://127.0.0.1:${cfg.port} (build: ${cfg.build}; blocked companies: ${(cfg.blockedCompanies || []).length ? cfg.blockedCompanies.join(', ') : 'none'})`); updater.start(); reg.appVersion = updater.current; setTimeout(() => { if (reg.hw && reg.hw.present && reg.printerInfo) reg.printerInfo(true).catch(() => {}); }, 1500); });

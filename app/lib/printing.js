// Direct receipt printing + cash drawer for Air Register, with no AIR POS installed.
// Mixed into Register (Object.assign at the end of register.js) and overrides the simple versions there.
//   Printer type  : auto (from the Windows queue / driver / port name) | epson (TM-T20II) | generic ESC/POS (M804 & clones) | star (TSP100)
//   Connection    : windows (RAW bytes through the Windows spooler, works with Epson APD, Star futurePRNT and
//                   "Generic / Text Only" / POS-80 drivers) | network (TCP 9100) | serial (COM port, incl. Epson TM Virtual Port)
//   Method        : raw (default: receipt PDF -> 1-bit picture -> printer commands, cut + drawer by us)
//                   driver (print the PDF through the Windows driver, like AIR POS does; Windows printers only)
// Printer problems never stop a sale: the sale is saved and the done screen offers Print Receipt (P) to reprint.
'use strict';
const pc = require('./printcmd');
const { testPagePdf } = require('./hardware');

const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
const DEF = { printerType: 'auto', printerConn: 'windows', printerHost: '', printerPort: 9100, serialPort: '', serialBaud: 9600,
  printMethod: 'auto', printerCols: 48, printerCut: true, drawerPin: 2, codePage: 'pc437', imageMode: 'gsv0', drawerWaitSec: 5, drawerPulse: 50, printDarkness: 'normal' };
// 4:09 PM (receipts WAY too dark): the helper printed every dot darker than 160/255 black (anti-aliased letter edges turned
// solid, grey boxes solid black). Default is now Normal (128), the plan's option B; Light 100; Dark = the old 160.
const DARKNESS = { light: 100, normal: 128, dark: 160 };
const DRAWER_WAIT = { min: 1, max: 30, def: 5 }; // seconds the register waits for the drawer before it carries on
const RAW_WAIT_MS = 8000;
// Request P (PLAN-faster-lighter-receipts.md step 1): the Windows printer list was re-read when older than 10 s, i.e. on almost
// every sale (0.3-1 s each). Now kept 10 min; cleared at once on a printer settings save, a failed print or a test print.
const PRN_CACHE_MS = 10 * 60 * 1000;
const PRN_STALE_OK_MS = 12 * 60 * 60 * 1000; // spd1010+
// 1.0.10-local.1 (Star TSP143IIIBI on futurePRNT, Nov 1): the queue refused every RAW job ("it reports an error"), Windows driver // star110+
// jobs print. Automatic now retries such a job once through the driver and remembers that printer for the whole session; a Star // star110+
// drawer then opens through the driver too (Star's documented "Control" device font: A..E = drawer 1 for 50..250 ms, d = drawer 2). // star110+
const TEXT_ONLY_RE = /generic \/ text only|^tty$/i; // Unidrv TTY driver (LOCALE.GPD / TTY.GPD): text only, no pictures // star110+
const RAW_REJECTED_RE = /reports an error/i; // star110+
const RAW_REJECTED_FILE = 'printer-raw-refused.json', RAW_REJECTED_KEEP_MS = 30 * 24 * 3600 * 1000; // drw1011+
const STAR_DRIVER_RE = /futureprnt|^star\b.*\btsp ?\d/i; // Star's own Windows driver names ("Star TSP100 Cutter (TSP143)", "Star TSP650II", futurePRNT) // drw1011+
const HARD_PROBLEM_RE = /offline|out of paper|cover|paused|jam|unplugged|turned off/i; // star110+
const STAR_CTRL = { 50: 'A', 100: 'B', 150: 'C', 200: 'D', 250: 'E' }; // star110+
const starControlChar = p => (Number(p.pin) === 5 ? 'd' : STAR_CTRL[Number(p.pulse) || 50] || 'A'); // star110+
const DIAG_MAX = 256 * 1024;
// receipt printers by name / driver / port. Unknown printers get the Windows driver path so anything prints.
const RECEIPT_RE = /pos[- _]?(58|80)|(^|[^a-z])pos([^a-z]|$)|receipt|thermal|小票|票据|热敏|tm-?[tmhlpu]\d|tsp ?\d|(^|[^a-z])star([^a-z]|$)|futureprnt|m804|xprinter|xp-?\d{2}|rongta|gprinter|bixolon|srp-|80 ?mm|58 ?mm|generic \/ text only|citizen ct|sewoo|zjiang|munbyn|hoin|epson tm/i;
const isReceipt = (name, driver, port) => RECEIPT_RE.test(`${name || ''} | ${driver || ''}`) || /^(ESDPRT|TMUSB)/i.test(String(port || '')); // how long a Windows printer gets to take a job before we call it offline and cancel it

const Printing = {
  printerSettings() {
    const s = this.settings || {}; const o = {}; for (const k of Object.keys(DEF)) o[k] = s[k] == null ? DEF[k] : s[k];
    if (s.printerType == null && s.drawerKind === 'star') o.printerType = 'star'; // 1.1 setting "Cash drawer type: Star printers"
    return o;
  },
  // 1.0.10-local.2 (Ari 12:16): Air Max per-PC "Print receipt after every sale / return": always (default, new + upgrades), // cp1010+
  // airpos (follow the AIR POS terminal checkoutAutoPrint / returnAutoPrint) or never. One decision per sale, so it prints once. // cp1010+
  autoPrintMode(kind) { const m = (this.settings || {})[kind === 'return' ? 'returnReceiptAutoPrint' : 'receiptAutoPrint']; return ['always', 'airpos', 'never'].includes(m) ? m : 'always'; }, // cp1010+
  autoPrintOn(kind) { const m = this.autoPrintMode(kind); if (m !== 'airpos') return m === 'always'; const t = (this.term && this.term()) || {}; return !!(kind === 'return' ? t.returnAutoPrint : t.checkoutAutoPrint); }, // cp1010+
  // 1.0.10-local.2 (Ari 12:22): "Warn before selling below zero stock" (per PC, default OFF = payment opens straight away). // cp1010+
  stockWarnOn() { return (this.settings || {}).stockWarn === true; }, // cp1010+

  // called from saveSettings; only touches the printer keys
  savePrinterSettings(b = {}) {
    const s = this.settings;
    if (pc.TYPES.includes(b.printerType)) s.printerType = b.printerType;
    if (['windows', 'network', 'serial'].includes(b.printerConn)) s.printerConn = b.printerConn;
    if (typeof b.printerHost === 'string') s.printerHost = b.printerHost.trim().slice(0, 100);
    if (b.printerPort != null && Number(b.printerPort) > 0 && Number(b.printerPort) < 65536) s.printerPort = Math.round(Number(b.printerPort));
    if (typeof b.serialPort === 'string') s.serialPort = b.serialPort.trim().slice(0, 40);
    if ([9600, 19200, 38400, 57600, 115200].includes(Number(b.serialBaud))) s.serialBaud = Number(b.serialBaud);
    if (['auto', 'raw', 'driver'].includes(b.printMethod)) s.printMethod = b.printMethod;
    if ([48, 42, 32].includes(Number(b.printerCols))) s.printerCols = Number(b.printerCols);
    if (typeof b.printerCut === 'boolean') s.printerCut = b.printerCut;
    if ([2, 5].includes(Number(b.drawerPin))) s.drawerPin = Number(b.drawerPin);
    if (b.drawerWaitSec != null && b.drawerWaitSec !== '') { const w = Math.round(Number(b.drawerWaitSec)); if (Number.isFinite(w)) s.drawerWaitSec = Math.min(DRAWER_WAIT.max, Math.max(DRAWER_WAIT.min, w)); }
    if (pc.PULSES.includes(Number(b.drawerPulse))) s.drawerPulse = Number(b.drawerPulse);
    if (['cash', 'every', 'airpos', 'off'].includes(b.drawerAutoOpen)) s.drawerAutoOpen = b.drawerAutoOpen;
    if (['always', 'airpos', 'never'].includes(b.receiptAutoPrint)) s.receiptAutoPrint = b.receiptAutoPrint; // cp1010+
    if (['always', 'airpos', 'never'].includes(b.returnReceiptAutoPrint)) s.returnReceiptAutoPrint = b.returnReceiptAutoPrint; // cp1010+
    if (typeof b.stockWarn === 'boolean') s.stockWarn = b.stockWarn; // cp1010+
    if (pc.CODEPAGE[b.codePage] != null) s.codePage = b.codePage;
    if (['gsv0', 'escstar'].includes(b.imageMode)) s.imageMode = b.imageMode;
    if (DARKNESS[b.printDarkness] != null) s.printDarkness = b.printDarkness;
    if (b.printerName !== undefined || b.printerType !== undefined || b.printMethod !== undefined) { this._prnInfo = null; this._driverOnly = null; }
    if (b.printerName !== undefined || b.printerType !== undefined || b.printMethod !== undefined || b.printerConn !== undefined) { this._rawRejected = null; this._drawerViaDriver = null; this.forgetRawRejected(); } // drw1011~
    return null;
  },

  // Windows printer details from the helper (driver + port drive "Auto"), cached for a minute
  async printerInfo(force) {
    if (!this.hw.present || this.settings.hardware === 'airpos') return null;
    if (!force && this._prnInfo && Date.now() - this._prnInfo.at < PRN_CACHE_MS && this._prnInfo.for === this.printerName()) return this._prnInfo.v;
    // one helper call at a time: a second caller while the list is being read waits for the same answer
    if (!force && this._prnInflight && this._prnInflight.for === this.printerName()) return this._prnInflight.p;
    const p = this.printerInfoRead(); this._prnInflight = { for: this.printerName(), p };
    try { return await p; } finally { if (this._prnInflight && this._prnInflight.p === p) this._prnInflight = null; }
  },
  // Receipt speed (1.0.10-local.2): the helper runs one command at a time, so a printer-list read (Windows WMI, seconds) queued on the print path sat IN FRONT // spd1010+
  // of the receipt every 10 min. The print / drawer path now takes the last list (same printer, up to 12 h) and marks it for a re-read // spd1010+
  // after the job (refreshPrinterInfoLater). No list yet = read it now (as before). A failed print, a settings change, a test print // spd1010+
  // or Check printers still re-read it right away, so a renamed / unplugged printer is picked up the same as before. // spd1010+
  async printerInfoQuick() { // spd1010+
    const c = this._prnInfo; // spd1010+
    if (c && c.for === this.printerName() && Date.now() - c.at < PRN_STALE_OK_MS && this.hw.present && this.settings.hardware !== 'airpos') { if (Date.now() - c.at >= PRN_CACHE_MS) this._prnStale = true; return c.v; } // spd1010+
    return this.printerInfo(); // spd1010+
  }, // spd1010+
  refreshPrinterInfoLater() { if (!this._prnStale) return; this._prnStale = false; this.printerInfo(true).catch(() => null); }, // spd1010+
  // 4:01 PM speed: with "automatic" printer, pass the name already picked (cached list) so the helper's Resolve finds it by
  // name instead of re-scanning every printer on each print. If that printer is gone, Resolve still falls back to its auto pick.
  rawPrinterName() {
    const n = this.printerName(); if (n) return n;
    const c = this._prnInfo; return c && c.for === '' && Date.now() - c.at < PRN_STALE_OK_MS && c.v && c.v.resolved ? c.v.resolved : ''; // // spd1010~
  },
  async printerInfoRead() {
    const r = await this.hw.printers(this.printerName());
    if (!r.ok) return null;
    const v = r.value || {}; const details = Array.isArray(v.details) ? v.details : [];
    const one = details.find(d => d.name === v.resolved) || null;
    const out = { printers: v.printers || [], default: /not set/i.test(v.default || '') ? '' : (v.default || ''), resolved: v.resolved || '', reason: v.reason || '', details, one, helper: v.helper, clr: v.clr, os: v.os };
    const prev = this._prnInfo && this._prnInfo.v && this._prnInfo.v.resolved;
    if (prev !== out.resolved) this.diag(`printer pick: ${out.resolved || '(none)'} — ${out.reason || ''}`);
    this._prnInfo = { at: Date.now(), for: this.printerName(), v: out };
    return out;
  },
  detectType(info) {
    const ps = this.printerSettings();
    if (ps.printerConn === 'serial') {
      const port = (this._ports || []).find(x => String(x.port).toUpperCase() === String(ps.serialPort).toUpperCase());
      return port && port.epsonVirtual ? 'epson' : /tmv|esdprt|epson/i.test(ps.serialPort) ? 'epson' : 'generic';
    }
    const one = info && info.one;
    return pc.guessType(one ? one.name : this.printerName(), one && one.driver, one && one.port);
  },
  async profileNow() {
    const ps = this.printerSettings();
    let type = ps.printerType, auto = false;
    if (type === 'auto') {
      auto = true;
      if (ps.printerConn === 'serial' && !this._ports && this.hw.present) { const pr = await this.hw.request('ports', {}, 15000); this._ports = pr.ok && Array.isArray(pr.value) ? pr.value : []; }
      type = ps.printerConn === 'network' ? 'generic' : this.detectType(ps.printerConn === 'windows' ? await this.printerInfoQuick() : null); // // spd1010~
    }
    const p = pc.profile({ type, cols: ps.printerCols, cut: ps.printerCut, pin: ps.drawerPin, pulse: ps.drawerPulse, codePage: ps.codePage, image: ps.imageMode });
    p.auto = auto; return p;
  },
  // 'raw' = our ESC/POS / Star commands; 'driver' = the Windows driver prints the PDF (any printer).
  // Auto: raw for receipt printers (Epson TM, Star, POS-58/80, M804 & clones), driver for everything else.
  async methodNow() {
    const ps = this.printerSettings();
    if (ps.printerConn !== 'windows') return 'raw';
    if (ps.printMethod === 'raw' || ps.printMethod === 'driver') return ps.printMethod;
    // 4:06 PM (every receipt slow): once raw failed and the Windows driver printed, later receipts on the SAME printer go straight to
    // the driver for the next 10 min instead of re-trying raw (render + up to 8-25 s waiting on the queue + cancel) EVERY time.
    // (_driverOnly used to be set here but never read.) A settings change, a test print or another printer starts over with raw.
    if (this._driverOnly && this._driverOnly.for === this.printerName() && Date.now() - this._driverOnly.at < PRN_CACHE_MS) return 'driver';
    if (this.rawRejected()) return 'driver'; // this queue refused raw earlier this session (not cleared by a test print) // star110+
    const info = await this.printerInfoQuick(); const one = info && info.one; // spd1010~
    if (!one) return 'raw';
    return (one.receipt != null ? one.receipt : isReceipt(one.name, one.driver, one.port)) ? 'raw' : 'driver';
  },
  diag(line) {
    const f = this.dataFile && this.dataFile('printer-diag.log'); if (!f) return;
    try { const fs = require('fs'); try { if (fs.statSync(f).size > DIAG_MAX) fs.renameSync(f, f + '.old'); } catch {} fs.appendFileSync(f, new Date().toISOString() + ' ' + String(line).replace(/\s+/g, ' ').slice(0, 600) + '\n'); } catch {}
  },
  // raw first; a Windows printer that refuses / mangles raw bytes (not offline, not timed out) gets the driver path
  async printVia(b64, label, rawFn) {
    const ps = this.printerSettings(); let t0 = Date.now(); const m = await this.methodNow(); if (this._pt) { this._pt.method = m; this._pt.methodLookupMs = Date.now() - t0; }
    if (m === 'driver') { const to = await this.textOnlyQueue(label); if (to) return to; const td = Date.now(); if (this._pt) this._pt.handOffAt = td; const r = await this.hw.printPdf(b64, this.rawPrinterName()); if (this._pt) this._pt.driverPrintMs = Date.now() - td; this.diag(`${label}: driver -> ${r.ok ? 'ok ' + JSON.stringify(r.value) : 'FAIL ' + r.error}`); return r; } // star110~ // spd1010~
    if (m === 'raw') { const to = await this.textOnlyQueue(label, true); if (to) return to; } // cp1010+
    const r = await rawFn();
    this.diag(`${label}: raw -> ${r.ok ? 'ok ' + JSON.stringify(r.value) : 'FAIL ' + r.error}`);
    if (r.ok || ps.printerConn !== 'windows' || ps.printMethod === 'raw' || r.timeout || r.crashed || r.unavailable || (!RAW_REJECTED_RE.test(r.error || '') && /offline|out of paper|cover|paused|not printing|jam/i.test(r.error || ''))) return r; // star110~
    if (RAW_REJECTED_RE.test(r.error || '') && !(await this.queueRefusesRaw(r, label))) return r; // star110+
    const to = await this.textOnlyQueue(label); if (to) return r; // star110+
    const tf = Date.now(); const d = await this.hw.printPdf(b64, this.rawPrinterName()); if (this._pt) { this._pt.driverFallbackMs = Date.now() - tf; this._pt.rawFailed = String(r.error || '').slice(0, 120); } // star110~
    this.diag(`${label}: driver fallback -> ${d.ok ? 'ok' : 'FAIL ' + d.error}`);
    if (d.ok && RAW_REJECTED_RE.test(r.error || '')) this.markRawRejected(label + ': raw print failed (' + String(r.error || '').slice(0, 160) + '), retried once through the Windows driver: ok'); // star110+
    if (d.ok) { this._driverOnly = { for: this.printerName(), at: Date.now(), why: String(r.error || '').slice(0, 120) }; this.log && this.log('raw print failed, the Windows driver worked: next receipts use the driver (' + this._driverOnly.why + ')'); return d; }
    return r;
  },
  // Nov 1 11:27 (garbled receipt, 'LOCALE.GPD' on top): a queue on the Windows "Generic / Text Only" driver (Unidrv TTY) cannot print // star110+
  // a PDF: it keeps only text and turns the receipt's embedded-font glyphs into random symbols (Air Max's Helvetica test page still // star110+
  // looks fine, so the test page hid it). Never send a PDF there: say which queue to pick instead. Raw ESC/POS to such a queue is unchanged. // star110+
  async textOnlyQueue(label, raw) { // cp1010~
    const info = await this.printerInfoQuick(); const one = info && info.one; if (!one || !TEXT_ONLY_RE.test(one.driver || '')) return null; // star110+ // spd1010~
    const star = raw && this.printerSettings().printerConn === 'windows' && (await this.profileNow()).type === 'star'; if (raw && !star) return null; // cp1010+
    const alt = (info.details || []).filter(d => d && d.name !== one.name && !d.virtual && !TEXT_ONLY_RE.test(d.driver || '') && isReceipt(d.name, d.driver, d.port)).map(d => d.name); // star110+
    const e = `Printer '${one.name}' uses the Windows "Generic / Text Only" driver, which prints ${star ? 'Star receipts' : 'receipts through the Windows driver'} as random symbols, so nothing was sent. In Settings > Printer choose ${alt.length ? "'" + alt[0] + "'" : 'the printer that has its own driver (Star: the futurePRNT "Star TSP100" queue)'}, ${star ? '' : ', or set Print receipts to Direct to printer'}`; // cp1010~
    this.diag(`${label}: ${star ? 'direct' : 'driver'} path refused on a text-only queue: ${e}`); if (this.log) this.log(`${label}: ${e}`); return { ok: false, error: e, textOnly: true }; // cp1010~
  }, // star110+
  // "reports an error" on a Windows queue: retry through the driver only when the queue does not ALSO say offline / paper / cover // star110+
  // (then a driver job would only wait in the queue and print later by surprise). // star110+
  async queueRefusesRaw(r, label) { // star110+
    const ps = this.printerSettings(); if (ps.printerConn !== 'windows' || ps.printMethod === 'raw' || !RAW_REJECTED_RE.test(r.error || '') || HARD_PROBLEM_RE.test(r.error || '')) return false; // star110+
    const info = await this.printerInfo(true).catch(() => null); const one = info && info.one; // star110+
    if (one && (one.workOffline || one.paused || HARD_PROBLEM_RE.test(one.problem || ''))) { this.diag(`${label}: raw refused but the queue says ${one.problem || (one.paused ? 'paused' : 'offline')}: no driver retry`); return false; } // star110+
    return true; // star110+
  }, // star110+
  // 1.0.11 drawer fix (#10; built Nov 2 on branch claude/step0-measure, approved by Ari Nov 3; not yet released): the "this queue refuses raw" note is also saved (printer-raw-refused.json, 30 days), so an // drw1011+
  // app restart no longer repeats raw try + refusal + forced printer-list re-read before the first receipt. A printer settings change forgets it. // drw1011+
  rawRejected() { // drw1011~
    if (this._rawRejected === undefined) { this._rawRejected = null; try { const f = this.dataFile && this.dataFile(RAW_REJECTED_FILE); const x = f && JSON.parse(require('fs').readFileSync(f, 'utf8')); if (x && typeof x.for === 'string' && Date.now() - Number(x.at) < RAW_REJECTED_KEEP_MS) this._rawRejected = { for: x.for, at: Number(x.at), why: String(x.why || '').slice(0, 240), saved: true }; } catch {} } // drw1011+
    const x = this._rawRejected; return x && x.for === this.printerName() ? x : null; // drw1011+
  }, // drw1011+
  markRawRejected(why) { // star110+
    if (this.rawRejected()) return; this._rawRejected = { for: this.printerName(), at: Date.now(), why: String(why).slice(0, 240) }; // star110+
    try { const f = this.dataFile && this.dataFile(RAW_REJECTED_FILE); if (f) require('fs').writeFileSync(f, JSON.stringify(this._rawRejected)); } catch {} // drw1011+
    const line = `printer ${this.printerName() || '(automatic)'} refuses raw jobs; it uses the Windows driver (receipts) and the driver drawer signal (Star) from now on (until the printer settings change). ${why}`; // drw1011~
    this.diag(line); if (this.log) this.log(line); // star110+
  }, // star110+
  forgetRawRejected() { try { const f = this.dataFile && this.dataFile(RAW_REJECTED_FILE); if (f) require('fs').unlinkSync(f); } catch {} }, // drw1011+
  // Star drawer through the Windows driver: a tiny driver job with one character in the futurePRNT "Control" device font. // star110+
  async driverDrawer(p) { // star110+
    const to = await this.textOnlyQueue('drawer'); if (to) return to; // never print the drawer letter on a text-only queue // star110+
    const ch = starControlChar(p); const r = await this.hw.request('drawerDriver', { printer: this.rawPrinterName(), ch }, 40000); // star110+
    this.diag(`drawer via Windows driver (Star Control font '${ch}', pin ${p.pin}): ${r.ok ? 'ok ' + JSON.stringify(r.value) : 'FAIL ' + r.error}`); return r; // star110+
  }, // star110+
  // 1.0.11 drawer fix (#10): a Star printer on a queue that uses Star's own Windows driver (futurePRNT "Star TSP100 Cutter (TSP143)") gets // drw1011+
  // the driver drawer signal FIRST, also on Automatic (was: raw BEL first, which that queue refuses after ~1 s, then a forced printer-list // drw1011+
  // re-read, then the driver: ~5 s, past the 5 s drawer wait). Other Star-mode queues keep raw BEL first. If the driver signal fails (no // drw1011+
  // Star "Control" font, text-only queue), openDrawerRaw still sends the raw BEL as backup. Print receipts = Direct: raw only, unchanged. // drw1011+
  starDriverQueue() { const c = this._prnInfo, one = c && c.for === this.printerName() && c.v && c.v.one; return !!(one && !TEXT_ONLY_RE.test(one.driver || '') && STAR_DRIVER_RE.test(one.driver || '')); }, // drw1011+
  starDrawerViaDriver(p) { const ps = this.printerSettings(); return p.type === 'star' && ps.printerConn === 'windows' && ps.printMethod !== 'raw' && (ps.printMethod === 'driver' || !!this.rawRejected() || (this._drawerViaDriver && this._drawerViaDriver.for === this.printerName()) || this.starDriverQueue()); }, // drw1011~
  connLabel() {
    const ps = this.printerSettings();
    return ps.printerConn === 'network' ? 'network ' + ps.printerHost + ':' + ps.printerPort : ps.printerConn === 'serial' ? 'port ' + (ps.serialPort || 'COM1') : 'Windows printer ' + (this.printerName() || '(automatic)');
  },

  // bytes -> printer. Returns the helper-style { ok, value } / { ok:false, error }.
  async sendRaw(bytes, doc, opt = {}) {
    const ps = this.printerSettings(); const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const waitMs = opt.waitMs || RAW_WAIT_MS;
    if (ps.printerConn === 'network') {
      if (!ps.printerHost) return { ok: false, error: 'no printer address set (Settings > Printer > Network)' };
      return this.hw.network(buf, ps.printerHost, ps.printerPort || 9100, opt.waitMs || 10000);
    }
    if (ps.printerConn === 'serial') return this.hw.serial(buf.toString('base64'), ps.serialPort || 'COM1', ps.serialBaud || 9600, 'rtscts');
    const r = await this.hw.request('raw', { base64: buf.toString('base64'), printer: this.rawPrinterName(), doc: doc || 'Air Register', waitMs: String(waitMs) }, waitMs + 40000); // star110~
    const m = !r.ok && /\s*\[diag: ([^\]]*)\]/.exec(r.error || ''); if (m) { r.error = r.error.replace(m[0], ''); r.diagInfo = m[1]; this.diag(`${doc || 'raw'}: helper detail ${m[1]}`); } // star110+
    if (!r.ok && /cancelled/i.test(r.error || '')) this.diag(`${doc || 'raw'}: the helper CANCELLED the job on ${this.rawPrinterName() || '(automatic)'}${/may have printed/i.test(r.error) ? ' (part of it may have printed: check the paper before reprinting)' : ''}: ${r.error}`); // star110+
    return r; // star110+
  },
  async renderFor(p, b64) {
    const thr = DARKNESS[this.printerSettings().printDarkness] || DARKNESS.normal; if (this._pt) this._pt.threshold = thr;
    const m = await this.hw.renderMono(b64, p.dots, thr); // always exactly p.dots wide (576 = 72 mm at 203 dpi): same size every time
    if (!m.ok) return m;
    const v = m.value || {};
    return { ok: true, mono: { width: Number(v.width), height: Number(v.height), data: Buffer.from(v.data || '', 'base64') } };
  },

  // same contract as register.js hwDo, plus: network/serial never fall back to the AIR POS service (it would print
  // somewhere else), and a failed receipt says how to reprint.
  async hwDo(label, builtin, airpos) {
    const ps = this.printerSettings();
    const what = label.replace(/ (sent|opened|printed).*$/, '');
    const reprint = /receipt/i.test(label) ? ' The sale is saved: fix the printer, then press Print Receipt (P) to print it again.' : '';
    const modes = ps.printerConn === 'windows' ? this.hwModes() : ['builtin'];
    const errs = [];
    for (const mode of modes) {
      if (mode === 'builtin') {
        if (!this.hw.present && ps.printerConn === 'windows') { errs.push('built-in helper not available on this system'); continue; }
        let r; try { r = await builtin(); } catch (e) { r = { ok: false, error: e.message }; }
        if (r.ok) { if (this.hwStatus) this.hwStatus.via = 'builtin'; return { ok: true, message: label, via: 'builtin' }; }
        const e = this.hwErr(r.error);
        if (!r.crashed && !r.timeout && !r.unavailable) return fail(what + ' failed: ' + e + (/[.!?]$/.test(e) ? '' : '.') + reprint, { hw: 'error', error: e });
        errs.push(e);
      } else {
        const r = await airpos();
        if (r && r.success) { if (this.hwStatus) this.hwStatus.via = 'airpos'; return { ok: true, message: label + ' (via AIR POS service)', via: 'airpos' }; }
        if (r && r.unreachable) { errs.push('AIR POS service not running'); continue; }
        return fail(what + ' failed: ' + this.hwErr(r && r.message) + '.' + reprint, { hw: 'error' });
      }
    }
    return fail('Printer/drawer not available: ' + errs.join('; ') + '.' + (reprint || ' The sale is saved; you can reprint later.'), { hw: 'absent' });
  },

  async printPdfBase64(b64, label) {
    const ps = this.printerSettings();
    const pt = this._pt, tick = (k, t) => { if (pt) pt[k] = (pt[k] || 0) + (Date.now() - t); };
    if (pt && !pt.startAt) pt.startAt = Date.now(); // spd1010+
    const r = await this.hwDo(label, () => this.printVia(b64, label, async () => {
      let t = Date.now(); const p = await this.profileNow(); tick('printerLookupMs', t); if (pt) pt.printer = p.label;
      t = Date.now(); const r = await this.renderFor(p, b64); tick('rasterizeMs', t); if (!r.ok) return r;
      t = Date.now(); const bytes = pc.raster(p, r.mono); tick('buildCommandsMs', t); if (pt) pt.bytes = bytes.length;
      t = Date.now(); const s = await this.sendRaw(bytes, label); tick('sendAndWaitPrintedMs', t); return s;
    }), () => this.api.printBillContent({ billBase64: b64 }, this.printerName()));
    if (!r || !r.ok) this._prnInfo = null; // a failed print re-reads the printer list next time
    return r;
  },

  drawerBytes(p) {
    const k = pc.drawer(p);
    if (this.settings.drawerKind === 'both') return p.type === 'star' ? [...pc.drawer({ ...p, type: 'epson' }), ...k] : [...k, 0x07];
    return k;
  },
  drawerWaitMs() { const w = Number(this.printerSettings().drawerWaitSec); return 1000 * (Number.isFinite(w) ? Math.min(DRAWER_WAIT.max, Math.max(DRAWER_WAIT.min, Math.round(w))) : DRAWER_WAIT.def); },
  // The kick is sent at once; the register waits at most drawerWaitSec (Settings, default 5 s) for the printer to take it,
  // then carries on with a short message. A late answer is only logged. Errors say which printer / connection and what to check.
  async openDrawerRaw() {
    const waitMs = this.drawerWaitMs(), where = this.connLabel();
    const run = this.hwDo('Drawer opened', async () => {
      const p = await this.profileNow();
      let first = null; if (this.starDrawerViaDriver(p)) { first = await this.driverDrawer(p); if (first.ok) return first; } // star110+
      if (first) { const r0 = await this.sendRaw(this.drawerBytes(p), 'Air Register drawer', { waitMs }); this.diag(`drawer (${p.type}, pin ${p.pin}) raw after the driver signal failed: ${r0.ok ? 'ok' : 'FAIL ' + r0.error}`); return r0.ok ? r0 : { ...r0, error: 'the driver drawer signal failed (' + first.error + ') and the direct signal failed too: ' + r0.error }; } // star110+
      const r = await this.sendRaw(this.drawerBytes(p), 'Air Register drawer', { waitMs });
      this.diag(`drawer (${p.type}, pin ${p.pin}): ${r.ok ? 'ok ' + JSON.stringify(r.value) : 'FAIL ' + r.error}`); if (r.ok || p.type !== 'star' || this.starDrawerViaDriver(p) || !(await this.queueRefusesRaw(r, 'drawer'))) return r; // star110~
      const d = await this.driverDrawer(p); if (!d.ok) return { ...r, error: r.error + ' The driver drawer signal also failed: ' + d.error }; // star110+
      this._drawerViaDriver = { for: this.printerName(), at: Date.now() }; this.markRawRejected('drawer: raw BEL failed (' + String(r.error || '').slice(0, 160) + '), sent through the Windows driver: ok'); return d; // star110+
    }, () => this.api.openCashbox(this.printerName()));
    let timer; const late = new Promise(res => { timer = setTimeout(() => res(null), waitMs); });
    const r = await Promise.race([run.catch(e => fail('Drawer failed: ' + e.message, { hw: 'error' })), late]);
    clearTimeout(timer);
    if (!r) {
      run.then(x => this.log && this.log('drawer answer after the ' + waitMs / 1000 + ' s wait: ' + (x && x.ok ? 'ok' : (x && x.message) || '?'))).catch(() => {});
      return fail(`Drawer signal sent to ${where}, but no answer in ${waitMs / 1000} s. If the drawer did not open: check the printer is on and has paper, and the drawer cable is in the printer's DK / drawer port.`, { hw: 'timeout', drawerTimeout: true });
    }
    if (r.ok) return { ...r, message: 'Drawer opened' + (r.via === 'airpos' ? ' (via AIR POS service)' : '') };
    return { ...r, message: `Cash drawer did not open (${where}): ${String(r.message || '').replace(/^(Drawer|Printer\/drawer)( failed| not available)?:\s*/i, '')} Check: printer on, cable/USB in, the right printer in Settings (Ctrl+,), and the drawer cable in the printer's DK port.` };
  },
  async testDrawer() { return this.openDrawerRaw(); },

  // short text slips (test page, notes). ESC/POS printers get text; Star TSP100 gets the same lines as a picture.
  async printSlip(lines, label, { test } = {}) {
    if (test) { this._prnInfo = null; this._driverOnly = null; } // test print always re-reads the printer list
    const ps = this.printerSettings();
    const pdf = () => testPagePdf(lines.flatMap(l => pc.wrap(l, 36))); // the 80 mm PDF fits ~36 chars a line
    return this.hwDo(label, () => this.printVia(pdf(), label, async () => {
      const p = await this.profileNow();
      if (p.type === 'star') { const r = await this.renderFor(p, pdf()); if (!r.ok) return r; return this.sendRaw(pc.raster(p, r.mono), label); }
      return this.sendRaw(test ? pc.testPage(p, test) : pc.textSlip(p, lines), label);
    }), () => this.api.printBillContent({ billBase64: pdf() }, this.printerName()));
  },
  async testPrint() {
    const id = this.identity || {}; const ps = this.printerSettings();
    const p = await this.profileNow().catch(() => pc.profile({}));
    const via = (await this.methodNow().catch(() => 'raw')) === 'driver' ? 'Windows driver' : this.connLabel() + ' (raw)';
    const info = { printer: ps.printerConn === 'windows' ? (this.printerName() || (this._prnInfo && this._prnInfo.v.resolved) || '(automatic)') : this.connLabel(), auto: p.auto, via, shop: id.shopName };
    const lines = ['TEST PAGE - Air Max', ...pc.testLines(p, info), 'If you can read this, printing works.']; // ls9n~
    const r = await this.printSlip(lines, 'Test page sent to printer', { test: info });
    if (r.ok) r.message = `Test page sent to ${info.printer} as ${p.label}${p.auto ? ' (auto)' : ''}`;
    return r;
  },

  // Receipt speed (1.0.10-local.2): ms per step for the last receipts, counted from the moment the payment was confirmed (cash Enter / card approved) // spd1010+
  printDiagLines() { // spd1010+
    const L = []; // spd1010+
    if (this.lastPrintTimings) L.push('Last receipt timings (ms): ' + JSON.stringify(this.lastPrintTimings)); // spd1010+
    const r = this.recentSaleTimings || []; // spd1010+
    if (r.length) { L.push('Recent sale print timings (ms from payment confirmed; completeMs = AIR POS Complete, printStartMs = receipt handed to the printer, printedMs = printer answered):'); for (const x of r) L.push('  ' + JSON.stringify(x)); } // spd1010+
    return L; // spd1010+
  }, // spd1010+
  // Settings > Printer > Save diagnostics: one text file the owner can send (no passwords, no card data)
  async printerDiagnostics() {
    const fs = require('fs'), os = require('os'), path = require('path');
    const ps = this.printerSettings(), L = [];
    L.push('Air Max printer diagnostics — ' + new Date().toString()); // ls9n~
    L.push('App ' + (this.appVersion || '') + ' · node ' + process.version + ' · ' + os.platform() + ' ' + os.release() + ' ' + os.arch());
    L.push('Helper file: ' + (this.hw.exe || '?') + ' · present: ' + this.hw.present + ' · last error: ' + (this.hw.lastError || 'none') + ' · restarts: ' + (this.hw.restarts || 0));
    L.push(...this.printDiagLines()); // spd1010~
    L.push('Settings: ' + JSON.stringify({ printerName: this.settings.printerName || '(automatic)', hardware: this.settings.hardware || 'builtin', ...ps }));
    const ping = this.hw.present ? await this.hw.request('ping', {}, 15000) : { ok: false, error: 'helper not present' };
    L.push('Helper ping: ' + (ping.ok ? 'ok' : 'FAIL ' + ping.error) + (ping.ok ? '' : '  (the helper needs .NET Framework 4.8, built into Windows 10 1903+ and Windows 11)'));
    const v = await this.printerInfo(true).catch(e => ({ error: e.message }));
    if (v && !v.error) {
      L.push('Helper ' + (v.helper || '?') + ' · CLR ' + (v.clr || '?') + ' · ' + (v.os || ''));
      L.push('Windows default: ' + (v.default || '(none)'));
      L.push('Picked: ' + (v.resolved || '(none)') + ' — ' + (v.reason || ''));
      L.push('Method now: ' + await this.methodNow().catch(e => 'error ' + e.message));
      L.push('Printers:');
      for (const d of v.details || []) L.push(`  - ${d.name} | driver: ${d.driver} | port: ${d.port} | ${d.receipt ? 'RECEIPT' : d.virtual ? 'virtual' : 'other'}${d.isDefault ? ' | default' : ''}${d.xpsDriver ? ' | v4/XPS driver (raw sent as XPS_PASS)' : ''}${d.workOffline ? ' | USE OFFLINE' : ''}${d.paused ? ' | PAUSED' : ''}${d.problem ? ' | ' + d.problem : ''} | jobs ${d.jobs} | status 0x${Number(d.status || 0).toString(16)}`);
      for (const d of v.details || []) if (d.printProcessor || d.datatype) L.push(`  - ${d.name} | print processor: ${d.printProcessor || '?'} | queue datatype: ${d.datatype || '?'}`); // star110+
      if (this.rawRejected()) L.push('This session: ' + this.rawRejected().why); // star110+
    } else L.push('Printer list: not available' + (v && v.error ? ' (' + v.error + ')' : ''));
    const f = this.dataFile && this.dataFile('printer-diag.log');
    let tail = ''; try { tail = fs.readFileSync(f, 'utf8').split('\n').slice(-80).join('\n'); } catch {}
    L.push('', 'Recent printer / drawer log:', tail || '(empty)');
    const text = L.join('\r\n');
    const desk = path.join(os.homedir(), 'Desktop'); const dir = fs.existsSync(desk) ? desk : (this.dataDir || os.tmpdir());
    const file = path.join(dir, 'AirRegister-printer-diagnostics.txt');
    try { fs.writeFileSync(file, text); } catch (e) { return { ok: false, message: 'Could not save the diagnostics file: ' + e.message, text }; }
    return { ok: true, file, text, message: 'Diagnostics saved to ' + file + ' — send this file.' };
  },

  async printers() {
    const ps = this.printerSettings();
    if (this.hw.present && this.settings.hardware !== 'airpos') {
      const v = await this.printerInfo(true);
      if (v) {
        const pr = await this.hw.request('ports', {}, 15000);
        if (pr.ok && Array.isArray(pr.value)) this._ports = pr.value;
        const p = await this.profileNow();
        return { ok: true, via: 'builtin', printers: v.printers, default: v.default, resolved: v.resolved, reason: v.reason, method: await this.methodNow(),
          details: v.details.map(d => ({ ...d, type: pc.guessType(d.name, d.driver, d.port) })),
          ports: pr.ok && Array.isArray(pr.value) ? pr.value : [], detected: { type: p.type, label: p.label, auto: p.auto }, printer: ps };
      }
    }
    const r = await this.api.getPrinters();
    const val = x => (x && typeof x === 'object' && 'success' in x && 'value' in x ? x.value : x) || [];
    if (r && r.success) return { ok: true, via: 'airpos', printers: val(r).map(p => (typeof p === 'string' ? p : p.name || p.printerName)).filter(Boolean), default: '', resolved: '', details: [], ports: [], printer: ps };
    return { ok: true, via: null, printers: [], default: '', resolved: '', details: [], ports: [], printer: ps, message: 'Printer list not available on this PC' };
  },
};

module.exports = { Printing, PRINTER_DEFAULTS: DEF, isReceipt };

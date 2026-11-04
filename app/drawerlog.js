// Cash drawer log (docs/DRAWER-TROUBLESHOOTING.md): ONE plain line in the Air Max log for every drawer attempt, saying why it
// was opened, which printer / connection / printer type / drawer pin, every method tried (Windows driver drawer character,
// direct kick bytes, AIR POS hardware service) and what each answered. So a store can compare two PCs ("Ctrl+D works here,
// not there") from Settings > Export log. No customer, sale or card data: printer names, ports and error texts only.
// It only WATCHES: the register's own drawer code (app/lib, frozen) is wrapped on the running object and called unchanged,
// with the same arguments, the same result and no extra helper or AIR POS call.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');

// why the drawer was opened, by the screen action (route) that started it; after-sale jobs run in the background but keep it
const WHY = {
  drawer: 'Ctrl+D / Open Drawer', 'drawer-sale': 'Open Drawer on the Sale complete screen', 'test-drawer': 'Settings: test the drawer', 'cash-move': 'Cash in / out',
  'pay-cash': 'after a sale', 'pay-tender': 'after a sale', 'finish-sale': 'after a sale', 'card-retry': 'after a sale', 'keyed-confirmed': 'after a sale', 'pay-recheck': 'after a sale',
  'return-confirm': 'after a return', 'mix-refund': 'after a return', 'card-refund-retry': 'after a return',
};
const STAR_LETTER = { A: 'drawer 1, 50 ms', B: 'drawer 1, 100 ms', C: 'drawer 1, 150 ms', D: 'drawer 1, 200 ms', E: 'drawer 1, 250 ms', d: 'drawer 2' };
const hex = b => Array.from(b || []).map(x => x.toString(16).padStart(2, '0')).join(' ');
// what the kick bytes are, in words (printcmd.js drawer(): Star BEL / SUB / ESC BEL n1 n2 BEL, ESC/POS ESC p m t1 t2)
function kickName(bytes) {
  const b = Array.from(bytes || []), parts = [];
  for (let i = 0; i < b.length;) {
    if (b[i] === 0x1b && b[i + 1] === 0x70) { parts.push(`ESC/POS "ESC p" (pin ${b[i + 2] === 1 ? 5 : 2})`); i += 5; }
    else if (b[i] === 0x1b && b[i + 1] === 0x07) { const bel = b[i + 4] === 0x07; parts.push(`Star "ESC BEL" pulse ${b[i + 2] * 10} ms${bel ? ' + "BEL" (drawer 1)' : ''}`); i += bel ? 5 : 4; }
    else if (b[i] === 0x07) { parts.push('Star "BEL" (drawer 1)'); i += 1; }
    else if (b[i] === 0x1a) { parts.push('Star "SUB" (drawer 2)'); i += 1; }
    else i += 1;
  }
  return parts.join(' + ') || 'bytes';
}
const short = (v, n = 220) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

class DrawerLog {
  constructor({ reg, log }) { this.reg = reg; this.log = log || (() => {}); this.why = new AsyncLocalStorage(); this.cur = new AsyncLocalStorage(); this.mark = new AsyncLocalStorage(); }
  // run a route with its reason attached (server.js), so a drawer job it starts later still knows why
  run(route, fn) { return this.why.run(WHY[route] || route, fn); }
  write(line) { this.log(line); try { if (this.reg.diag) this.reg.diag(line); } catch { /* the printer diagnostics file is optional */ } }
  printerText(trace) {
    const reg = this.reg, st = reg.settings || {}; let ps = {}; try { ps = reg.printerSettings ? reg.printerSettings() : st; } catch {}
    const c = reg._prnInfo && reg._prnInfo.v && reg._prnInfo.v.one; // the printer list already read (no new helper call)
    const name = (c && c.name) || (reg.printerName && reg.printerName()) || '(automatic)';
    const conn = ps.printerConn === 'network' ? `network ${ps.printerHost || '(no address)'}:${ps.printerPort || 9100}` : ps.printerConn === 'serial' ? `COM port ${ps.serialPort || 'COM1'} (serial / Bluetooth)` : 'Windows printer';
    const where = c ? ` port ${c.port || '?'}, driver "${short(c.driver, 80)}"` : '';
    const p = trace.profile;
    const type = p ? `type ${p.type === 'star' ? 'Star (StarLine)' : p.type === 'epson' ? 'Epson ESC/POS' : 'Generic ESC/POS'} (${p.auto ? 'Automatic: guessed from ' + (ps.printerConn === 'windows' ? 'the printer name / driver' : ps.printerConn === 'network' ? 'network = Generic' : 'the COM port') : 'set in Settings'}), pin ${p.pin === 5 ? '5 (drawer 2)' : '2 (drawer 1)'}, pulse ${p.pulse || 50} ms` : 'type not read';
    return `printer "${short(name, 80)}" (${conn}${where}); ${type}; print method ${ps.printMethod || 'auto'}; hardware ${st.hardware || 'auto'}${st.drawerKind && st.drawerKind !== 'escpos' ? '; drawer kind ' + st.drawerKind : ''}`;
  }
  install() {
    const reg = this.reg, self = this;
    const step = (what, r) => { const t = self.cur.getStore(); const ok = !!(r && (r.ok || r.success)); const err = r ? (r.error || r.message || '') : 'no answer';
      const s = `${what} -> ${ok ? 'ok' : 'FAILED: ' + short(err)}`; if (!t) return; if (t.done) self.write(`DRAWER [${t.why}] after the wait: ${s}`); else t.steps.push(s); };
    if (typeof reg.drawerBytes === 'function') { const f = reg.drawerBytes; reg.drawerBytes = function (p) { const b = f.apply(this, arguments); const t = self.cur.getStore(); if (t) t.profile = p; return b; }; }
    if (typeof reg.driverDrawer === 'function') { const f = reg.driverDrawer; reg.driverDrawer = async function (p) { const t = self.cur.getStore(); if (t && p) t.profile = p; const r = await f.apply(this, arguments);
      const ch = p && Number(p.pin) === 5 ? 'd' : ({ 50: 'A', 100: 'B', 150: 'C', 200: 'D', 250: 'E' })[Number(p && p.pulse) || 50] || 'A';
      step(`Windows driver drawer character '${ch}' (Star "Control" font, ${STAR_LETTER[ch]})`, r); return r; }; }
    if (typeof reg.sendRaw === 'function') { const f = reg.sendRaw; reg.sendRaw = async function (bytes, doc) { const r = await f.apply(this, arguments);
      if (/drawer/i.test(String(doc || ''))) step(`direct kick ${kickName(bytes)} [${hex(bytes)}]`, r); return r; }; }
    if (reg.api && typeof reg.api.openCashbox === 'function') { const f = reg.api.openCashbox; reg.api.openCashbox = async function () { const r = await f.apply(this, arguments);
      step('AIR POS hardware service (OpenCashbox on localhost:20001)', r); return r; }; }
    if (typeof reg.openDrawerRaw === 'function') { const f = reg.openDrawerRaw; reg.openDrawerRaw = function () {
      const m = self.mark.getStore(); if (m) m.sent = true;
      const t = { why: self.why.getStore() || 'drawer', steps: [], profile: null, t0: Date.now(), done: false };
      return self.cur.run(t, async () => {
        let r; try { r = await f.apply(this, arguments); } catch (e) { r = { ok: false, message: e.message }; }
        t.done = true; const ms = Date.now() - t.t0;
        if (!t.steps.length && r && !r.ok) t.steps.push('built-in helper and AIR POS service not used: ' + short(r.message)); // e.g. "built-in helper not available"
        self.write(`DRAWER [${t.why}] ${self.printerText(t)} | tried: ${t.steps.map((s, i) => `${i + 1}) ${s}`).join('; ') || 'nothing'} | result: ${r && r.ok ? 'drawer signal sent' : r && r.drawerTimeout ? 'NO ANSWER in ' + Math.round((reg.drawerWaitMs ? reg.drawerWaitMs() : 5000) / 1000) + ' s (still waiting; any late answer is logged)' : 'FAILED: ' + short(r && r.message, 300)} (${ms} ms)`);
        return r;
      });
    }; }
    // Ctrl+D / after a sale: a refusal BEFORE any signal (password, not allowed without a sale) is logged too
    if (typeof reg.drawer === 'function') { const f = reg.drawer; reg.drawer = async function () { const mark = { sent: false }; const r = await self.mark.run(mark, () => f.apply(this, arguments));
      if (r && !r.ok && !mark.sent) self.write(`DRAWER [${self.why.getStore() || 'drawer'}] not sent: ${short(r.message)}`); return r; }; }
    return this;
  }
}
module.exports = { DrawerLog, kickName, WHY };

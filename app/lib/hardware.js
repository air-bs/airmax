// Built-in hardware layer: replaces the AIR POS local hardware service (localhost:20001).
// Talks to hw/AirRegisterHw.exe (bundled .NET Framework 4.8 helper + PDFium) over stdin/stdout.
// The helper does exactly what the AIR POS service does: device id, printer pick,
// PDF receipt printing through the Windows printer driver, raw ESC/POS drawer kick.
// If the helper cannot run, callers fall back to the AIR POS service on :20001 when it is present.
'use strict';
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

class Hardware {
  constructor({ appDir, log } = {}) {
    this.log = log || (() => {});
    this.exe = process.env.AIRREG_HW_EXE || path.join(appDir || __dirname, 'hw', 'AirRegisterHw.exe');
    this.proc = null; this.buf = ''; this.waiting = new Map(); this.seq = 0;
    this.lastError = null;
  }
  get present() { return fs.existsSync(this.exe) && (process.platform === 'win32' || !!process.env.AIRREG_HW_WINE); }

  start() {
    if (this.proc) return true;
    if (!this.present) { this.lastError = 'helper not available on this system'; return false; }
    const wine = process.platform !== 'win32';
    const cmd = wine ? 'wine' : this.exe, args = wine ? [this.exe, '--serve'] : ['--serve'];
    try {
      this.proc = spawn(cmd, args, { cwd: path.dirname(this.exe), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: wine ? { ...process.env, WINEDEBUG: '-all' } : process.env });
    } catch (e) { this.lastError = e.message; this.proc = null; return false; }
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', d => {
      this.buf += d; let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        const w = this.waiting.get(m.id); if (w) { this.waiting.delete(m.id); clearTimeout(w.t); w.resolve(m); }
      }
    });
    this.proc.stderr.on('data', d => { const s = String(d).trim(); if (s) this.log('HW helper: ' + s.slice(0, 200)); });
    const dead = (why) => {
      this.lastError = why; this.proc = null;
      for (const [, w] of this.waiting) { clearTimeout(w.t); w.resolve({ ok: false, error: 'Hardware helper stopped (' + why + ')', crashed: true }); }
      this.waiting.clear();
    };
    const me = this.proc;
    this.proc.on('exit', c => { if (this.proc === me || !this.proc) { if (c) this.log('HW helper exited (' + c + '); it restarts on the next print/drawer'); dead('exit ' + c); } });
    this.proc.on('error', e => dead(e.message));
    return true;
  }
  stop() {
    const p = this.proc; this.proc = null;
    for (const [, w] of this.waiting) { clearTimeout(w.t); w.resolve({ ok: false, error: 'Hardware helper restarted', crashed: true }); }
    this.waiting.clear(); this.buf = '';
    try { p && p.kill(); } catch {}
  }

  // returns { ok, value } or { ok:false, error }
  request(cmd, args = {}, timeoutMs = 45000) {
    if (!this.start()) return Promise.resolve({ ok: false, error: this.lastError || 'helper not available', unavailable: true });
    const id = ++this.seq;
    return new Promise(resolve => {
      const t = setTimeout(() => {
        this.waiting.delete(id);
        // a hung helper (stuck printer driver) is killed so the next print/drawer starts a fresh one
        this.log('HW helper timed out on ' + cmd + '; restarting it'); this.restarts = (this.restarts || 0) + 1; this.stop();
        resolve({ ok: false, error: 'Hardware helper timed out (' + cmd + ')', timeout: true });
      }, timeoutMs);
      if (this.fault === 'hang') return; // dev fault injection: request never answered
      this.waiting.set(id, { resolve, t });
      try { this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n'); }
      catch (e) { clearTimeout(t); this.waiting.delete(id); resolve({ ok: false, error: e.message, unavailable: true }); }
    });
  }
  deviceInfo() { return this.request('deviceInfo', {}, 60000); }
  printers(printer) { return this.request('printers', { printer: printer || '' }, 20000); }
  printPdf(base64, printer) { return this.request('printPdf', { base64, printer: printer || '' }, 90000); }
  drawer(printer, kind) { return this.request('drawer', { printer: printer || '', kind: kind || 'escpos' }, 20000); }
  raw(base64, printer) { return this.request('raw', { base64, printer: printer || '' }, 20000); }
  renderMono(base64, dots, threshold) { return this.request('renderMono', { base64, dots: String(dots || 576), ...(threshold ? { threshold: String(threshold) } : {}) }, 60000); } // the helper already reads "threshold" (default 160)
  serial(base64, port, baud, handshake) { return this.request('serial', { base64, port: port || 'COM1', baud: String(baud || 9600), handshake: handshake || 'rtscts' }, 30000); }
  // network receipt printer (Epson/Star/clone Ethernet or Wi-Fi interface, raw port 9100); no helper needed
  network(buf, host, port = 9100, timeoutMs = 10000) {
    return new Promise(resolve => {
      let done = false; const end = r => { if (!done) { done = true; clearTimeout(t); try { sock.destroy(); } catch {} resolve(r); } };
      const sock = net.connect({ host, port: Number(port) || 9100 });
      const t = setTimeout(() => end({ ok: false, error: `printer at ${host}:${port} did not answer in ${Math.round(timeoutMs / 1000)} s` }), timeoutMs);
      sock.on('connect', () => sock.end(buf, () => end({ ok: true, value: host + ':' + port })));
      sock.on('error', e => end({ ok: false, error: `printer at ${host}:${port}: ${e.code || e.message}` }));
    });
  }
  renderPng(base64, out, dpi) { return this.request('renderPng', { base64, out, dpi: String(dpi || 203) }, 60000); }
}

// A tiny valid one-page PDF (80 mm wide) for "Print test page". Helvetica, plain text lines.
function testPagePdf(lines) {
  const esc = s => String(s).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?');
  const W = 226, H = 40 + lines.length * 16;
  let content = 'BT /F1 10 Tf 12 ' + (H - 24) + ' Td 14 TL\n';
  lines.forEach((l, i) => { content += (i ? 'T* ' : '') + '(' + esc(l) + ') Tj\n'; });
  content += 'ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf).toString('base64');
}

module.exports = { Hardware, testPagePdf };

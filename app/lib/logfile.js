// Rotating local log for support. Scrubs anything that looks like a card number, password, token or API key
// before it is written, so "Export log" is safe to e-mail. Files: <data>/logs/air-register.log (+ .1 .. .4).
'use strict';
const fs = require('fs');
const path = require('path');

const MAX = 1024 * 1024, KEEP = 5;
function scrub(s) {
  return String(s)
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, m => (m.replace(/\D/g, '').length >= 13 ? '[number removed]' : m)) // card-like digit runs
    .replace(/\b(pk|sk|rk)_(test|live)_[0-9A-Za-z]+/g, '$1_$2_[removed]')
    .replace(/\b(pi|seti|pm|tok)_[0-9A-Za-z]{10,}(_secret_[0-9A-Za-z]+)?/g, '$1_[removed]')
    .replace(/(password|passwd|pwd|secret|token|authorization|cvv|cvc)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1$2[removed]')
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [removed]');
}
class LogFile {
  constructor(dataDir) {
    this.dir = dataDir ? path.join(dataDir, 'logs') : null;
    this.file = this.dir ? path.join(this.dir, 'air-register.log') : null;
    if (this.dir) try { fs.mkdirSync(this.dir, { recursive: true }); } catch {}
  }
  write(line) {
    if (!this.file) return;
    try {
      let size = 0; try { size = fs.statSync(this.file).size; } catch {}
      if (size > MAX) this.rotate();
      fs.appendFileSync(this.file, scrub(line) + '\n');
    } catch { /* logging must never break a sale */ }
  }
  rotate() {
    for (let i = KEEP - 1; i >= 1; i--) { const a = this.file + '.' + i, b = this.file + '.' + (i + 1); try { if (fs.existsSync(a)) fs.renameSync(a, b); } catch {} }
    try { fs.renameSync(this.file, this.file + '.1'); } catch {}
    try { fs.unlinkSync(this.file + '.' + (KEEP + 1)); } catch {}
  }
  // newest last; for "Export log"
  exportText(header) {
    const parts = [header || ''];
    for (let i = KEEP; i >= 1; i--) { try { parts.push(fs.readFileSync(this.file + '.' + i, 'utf8')); } catch {} }
    try { parts.push(fs.readFileSync(this.file, 'utf8')); } catch {}
    return scrub(parts.join('\n'));
  }
}
module.exports = { LogFile, scrub };

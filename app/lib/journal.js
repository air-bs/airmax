// On-disk journal of the sale in progress: written (atomically, fsync'd) before every server call that can
// take or record money, and after every cart change. If the app, the PC or the network dies mid-sale, the
// next login reads it back and asks the AIR POS server what really happened before doing anything again.
// Holds only what the cart already shows (items, prices, customer number, tender ids/amounts). Never card
// numbers (keyed cards are typed into Stripe's iframe and never reach this app), passwords or tokens.
'use strict';
const fs = require('fs');
const path = require('path');

class Journal {
  constructor(dataDir, log, name = 'current.json') { // name: a second journal file (card-refunds.json) uses the same safe writes
    this.log = log || (() => {});
    this.dir = dataDir ? path.join(dataDir, 'journal') : null;
    this.file = this.dir ? path.join(this.dir, name) : null;
    this.last = '';
  }
  write(obj) {
    if (!this.file) return false;
    const body = JSON.stringify(obj);
    if (body === this.last) return true;
    const s = JSON.stringify({ v: 1, at: new Date().toISOString(), ...obj });
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      const fd = fs.openSync(tmp, 'w'); fs.writeSync(fd, s); fs.fsyncSync(fd); fs.closeSync(fd);
      fs.renameSync(tmp, this.file); this.last = body; return true;
    } catch (e) { this.log('JOURNAL write failed: ' + e.message); return false; }
  }
  exists() { return !!this.file && (fs.existsSync(this.file) || fs.existsSync(this.file + '.tmp')); }
  read() {
    if (!this.file) return null;
    for (const f of [this.file, this.file + '.tmp']) {
      try { if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && j.v === 1) return j; } } catch (e) { this.log('JOURNAL unreadable (' + path.basename(f) + '): ' + e.message); }
    }
    return null;
  }
  clear(why) {
    if (!this.file) return;
    this.last = '';
    for (const f of [this.file, this.file + '.tmp']) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { this.log('JOURNAL clear failed: ' + e.message); } }
    if (why) this.log('JOURNAL cleared: ' + why);
  }
}
module.exports = { Journal };

// 1.0.10 (Ari, Oct 30 2026): pictures the owner picks for the screens.
//  * welcome  – full-screen picture on the customer screen while nothing is being sold
//  * saleLogo – store logo in the empty band above the total on the register screen
// PNG or JPEG only, checked by the file's own bytes (never by its name); max 5 MB, max 4096 x 4096 px.
// Kept OUT of app/lib (frozen) and out of settings.json: own file screen-pictures.json + the picture files.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 5 * 1024 * 1024, MAX_PX = 4096;
const KINDS = Object.assign(Object.create(null), { welcome: 'screen-welcome', saleLogo: 'screen-salelogo' });
const FITS = ['contain', 'cover'];
const DEF_FILL = '#1f3b57';

// returns { type, ext, w, h } or { error }
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { error: 'The file is empty.' };
  if (buf.length > MAX_BYTES) return { error: 'The picture is bigger than 5 MB. Save it smaller and try again.' };
  let w = 0, h = 0, type = '', ext = '';
  if (buf.length >= 24 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString('latin1', 12, 16) === 'IHDR') {
    type = 'image/png'; ext = 'png'; w = buf.readUInt32BE(16); h = buf.readUInt32BE(20);
  } else if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    type = 'image/jpeg'; ext = 'jpg';
    let i = 2; // walk the JPEG markers to the frame header (SOF0..SOF15, not DHT/JPG/DAC)
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      if (m === 0xda || len < 2) break;
      i += 2 + len;
    }
  } else return { error: 'Only PNG or JPEG pictures can be used (this file is not one, whatever its name says).' };
  if (!w || !h) return { error: 'This picture file looks damaged (no size inside). Save it again as PNG or JPEG.' };
  if (w > MAX_PX || h > MAX_PX) return { error: `The picture is ${w} x ${h} px. The most is ${MAX_PX} x ${MAX_PX}; make it smaller.` };
  return { type, ext, w, h };
}

class ScreenPics {
  constructor(dataDir, log) { this.dir = dataDir; this.log = log || (() => {}); this.metaFile = path.join(dataDir, 'screen-pictures.json'); this.meta = this.load(); }
  load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) || {};
      const out = {};
      for (const k of Object.keys(KINDS)) { const m = j[k]; if (m && /^image\/(png|jpeg)$/.test(m.type) && fs.existsSync(this.fileFor(k, m.type))) out[k] = m; }
      return out;
    } catch { return {}; }
  }
  saveMeta() { const tmp = this.metaFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.meta, null, 2)); fs.renameSync(tmp, this.metaFile); }
  fileFor(kind, type) { return path.join(this.dir, KINDS[kind] + (type === 'image/png' ? '.png' : '.jpg')); }
  file(kind) { const m = KINDS[kind] && this.meta[kind]; if (!m) return null; const f = this.fileFor(kind, m.type); return fs.existsSync(f) ? { file: f, type: m.type } : null; }
  put(kind, buf) {
    if (!KINDS[kind]) return { ok: false, message: 'Unknown picture' };
    const s = sniff(buf); if (s.error) return { ok: false, message: s.error };
    const f = this.fileFor(kind, s.type), tmp = f + '.tmp';
    fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
    const other = this.fileFor(kind, s.type === 'image/png' ? 'image/jpeg' : 'image/png'); // only our own fixed-name file of the other type
    try { if (fs.existsSync(other)) fs.unlinkSync(other); } catch {}
    const old = this.meta[kind] || {};
    this.meta[kind] = { type: s.type, bytes: buf.length, w: s.w, h: s.h, hash: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12), at: new Date().toISOString(),
      ...(kind === 'welcome' ? { fit: FITS.includes(old.fit) ? old.fit : 'contain', fill: old.fill || DEF_FILL } : {}) };
    this.saveMeta(); this.log(`SCREEN PICTURE ${kind} set (${s.type}, ${s.w}x${s.h}, ${buf.length} bytes)`);
    return { ok: true, message: kind === 'welcome' ? 'Welcome picture saved' : 'Register logo saved', pics: this.state() };
  }
  set(b) {
    const kind = b && b.kind; if (!KINDS[kind]) return { ok: false, message: 'Unknown picture' };
    if (b.remove) {
      const m = this.meta[kind];
      if (m) { delete this.meta[kind]; this.saveMeta(); for (const t of ['image/png', 'image/jpeg']) { try { const f = this.fileFor(kind, t); if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} } this.log(`SCREEN PICTURE ${kind} removed`); }
      return { ok: true, message: kind === 'welcome' ? 'Welcome picture removed' : 'Register logo removed', pics: this.state() };
    }
    if (kind !== 'welcome') return { ok: false, message: 'Nothing to change' };
    const m = this.meta.welcome; if (!m) return { ok: false, message: 'Choose a welcome picture first' };
    if (b.fit !== undefined) { if (!FITS.includes(b.fit)) return { ok: false, message: 'Fit must be contain or cover' }; m.fit = b.fit; }
    if (b.fill !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(String(b.fill))) return { ok: false, message: 'Colour must look like #1f3b57' }; m.fill = String(b.fill).toLowerCase(); }
    this.saveMeta(); return { ok: true, message: 'Welcome picture settings saved', pics: this.state() };
  }
  // what the screens may know (no paths)
  state() {
    const w = this.meta.welcome, l = this.meta.saleLogo;
    return {
      welcome: w ? { src: '/screen-picture/welcome?v=' + w.hash, fit: w.fit || 'contain', fill: w.fill || DEF_FILL, w: w.w, h: w.h, bytes: w.bytes, type: w.type } : null,
      saleLogo: l ? { src: '/screen-picture/salelogo?v=' + l.hash, w: l.w, h: l.h, bytes: l.bytes, type: l.type } : null
    };
  }
}
module.exports = { ScreenPics, sniff, MAX_BYTES, MAX_PX, DEF_FILL };

// Register Mode (full-screen kiosk) and PC power controls. The launcher (AirRegister.ps1) does the Windows side:
// it reads settings.json at start (fullScreen / registerMode) and watches control.json for exit / restart requests.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fail = (message, extra = {}) => ({ ok: false, message, ...extra });
const pinHash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const CUST_MAX1 = 40, CUST_MAX2 = 80, LOGO_MAX_BYTES = 500 * 1024, LOGO_MAX_PX = 2000;
// PNG / JPG from the first bytes; width and height read from the header. Anything else (SVG, GIF, WebP, BMP…) is refused.
function checkLogo(v) {
  const m = /^data:image\/(png|jpe?g);base64,/i.exec(String(v)); const b64 = String(v).slice(m ? m[0].length : 0).replace(/\s+/g, '');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { error: 'That file is not a picture Air Max can use (PNG or JPG only)' }; // ls9n~
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > LOGO_MAX_BYTES) return { error: 'The logo is too big. Use a PNG or JPG of 500 KB or less' };
  let ext = null, w = 0, h = 0;
  if (buf.length > 24 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && buf.toString('latin1', 12, 16) === 'IHDR') { ext = 'png'; w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
  else if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    ext = 'jpg'; let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const mk = buf[i + 1]; if (mk === 0xff) { i++; continue; }
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      if ((mk >= 0xc0 && mk <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(mk)) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      if (len < 2) break; i += 2 + len;
    }
  }
  if (!ext) return { error: 'Only PNG or JPG pictures can be used as the logo' };
  if (!w || !h) return { error: 'That picture looks damaged. Try saving it again as PNG or JPG' };
  if (w > LOGO_MAX_PX || h > LOGO_MAX_PX) return { error: `The logo is too large (${w} x ${h}). Use a picture no bigger than 2000 x 2000` };
  return { ext, buf, w, h };
}

const Kiosk = {
  kioskSettings(b, s) { // called from saveSettings; returns an error result or null
    if (['keypad', 'windows', 'off'].includes(b.touchKeyboard)) s.touchKeyboard = b.touchKeyboard;
    if (typeof b.fullScreen === 'boolean') s.fullScreen = b.fullScreen;
    if (typeof b.customerDisplay === 'boolean') s.customerDisplay = b.customerDisplay; // second monitor; not set = on when there is one
    const w = this.customerBranding(b, s); if (w) return w; // 1.2.1: store's own welcome message + logo (manager only)
    const mgr = ['registerMode', 'exitPinEnabled', 'exitPin'].some(k => b[k] !== undefined && (k === 'exitPin' ? !!b.exitPin : b[k] !== s[k]));
    if (mgr && !this.isManager()) return fail('Only a manager can change Register Mode or its exit PIN');
    if (b.exitPin && !/^\d{4,8}$/.test(String(b.exitPin).trim())) return fail('The exit PIN must be 4 to 8 digits');
    if (b.exitPinEnabled === true && !s.exitPinHash && !b.exitPin) return fail('Set the exit PIN first (4 to 8 digits), or switch the PIN off');
    if (typeof b.registerMode === 'boolean') s.registerMode = b.registerMode;
    if (typeof b.exitPinEnabled === 'boolean') s.exitPinEnabled = b.exitPinEnabled;
    if (b.exitPin) {
      const pin = String(b.exitPin).trim();
      const salt = crypto.randomBytes(16).toString('hex'); s.exitPinHash = salt + ':' + pinHash(pin, salt);
    }
    return null;
  },
  // 1.2.1 customer screen welcome message + logo. Text: one line, control characters stripped, 40 / 80 chars.
  // Logo: PNG or JPG only (checked from the file's own bytes), max 500 KB and 2000 x 2000 px, saved as its own file in the
  // data folder (temp file then rename). settings.json keeps only { type, bytes, hash }.
  customerBranding(b, s) {
    const keys = ['custWelcome', 'custWelcome2', 'custLogo', 'custLogoRemove'];
    if (!keys.some(k => b[k] !== undefined)) return null;
    const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
    const t1 = b.custWelcome !== undefined ? clean(b.custWelcome) : null, t2 = b.custWelcome2 !== undefined ? clean(b.custWelcome2) : null;
    const changed = (t1 !== null && t1 !== (s.custWelcome || '')) || (t2 !== null && t2 !== (s.custWelcome2 || '')) || b.custLogo != null || (b.custLogoRemove === true && s.custLogo);
    if (!changed) return null;
    if (!this.isManager()) return fail('Only a manager can change the customer screen message or logo');
    if (t1 !== null && t1.length > CUST_MAX1) return fail(`The welcome message can be at most ${CUST_MAX1} characters`);
    if (t2 !== null && t2.length > CUST_MAX2) return fail(`The second line can be at most ${CUST_MAX2} characters`);
    let logo = null;
    if (b.custLogo != null) { logo = checkLogo(b.custLogo); if (logo.error) return fail(logo.error); }
    if (!this.dataDir && (logo || b.custLogoRemove === true)) return fail('No data folder to keep the logo in');
    if (logo) {
      const f = path.join(this.dataDir, 'customer-logo.' + logo.ext), tmp = f + '.tmp';
      try { fs.writeFileSync(tmp, logo.buf); fs.renameSync(tmp, f); } catch (e) { try { fs.unlinkSync(tmp); } catch {} return fail('Could not save the logo: ' + e.message); }
      const other = path.join(this.dataDir, 'customer-logo.' + (logo.ext === 'png' ? 'jpg' : 'png')); try { if (fs.existsSync(other)) fs.unlinkSync(other); } catch {}
      s.custLogo = { type: logo.ext, bytes: logo.buf.length, hash: crypto.createHash('sha256').update(logo.buf).digest('hex').slice(0, 12) };
    } else if (b.custLogoRemove === true) {
      ['png', 'jpg'].forEach(x => { try { const f = path.join(this.dataDir, 'customer-logo.' + x); if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
      s.custLogo = null;
    }
    if (t1 !== null) s.custWelcome = t1;
    if (t2 !== null) s.custWelcome2 = t2;
    return null;
  },
  customerLogoFile() { // fixed path + fixed type; never taken from the request
    const l = this.settings && this.settings.custLogo; if (!l || !this.dataDir || !['png', 'jpg'].includes(l.type)) return null;
    const f = path.join(this.dataDir, 'customer-logo.' + l.type); return fs.existsSync(f) ? { file: f, type: l.type === 'png' ? 'image/png' : 'image/jpeg' } : null;
  },
  control(action) {
    const f = this.dataDir ? path.join(this.dataDir, 'control.json') : null; if (!f) return;
    try { fs.writeFileSync(f, JSON.stringify({ action, at: new Date().toISOString() })); } catch (e) { this.log('control write failed: ' + e.message); }
  },
  // Exit to Windows: a manager's AIR POS login (checked by the server, same as manager approvals); optional local PIN.
  async managerCheck(b = {}) {
    if (b.pin != null && b.pin !== '') {
      const s = this.settings; if (!s.exitPinEnabled || !s.exitPinHash) return fail('The exit PIN is switched off. Use a manager login.');
      const [salt, h] = s.exitPinHash.split(':');
      const ok = crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(pinHash(String(b.pin).trim(), salt), 'hex'));
      return ok ? { ok: true, via: 'pin' } : fail('Wrong PIN');
    }
    // fp6+
    if (b.user === '@fingerprint') return this.fpApproval && this.fpApproval(b.password) ? { ok: true, via: 'fingerprint' } : fail('The fingerprint approval did not go through or ran out of time. Touch the reader again, or use a manager login.');
    // fp6-
    if (!b.user || !b.password) return fail('Enter a manager user name and password');
    const r = await this.api.verify(String(b.user).trim(), b.password);
    if (r && r.unreachable) return fail('No connection to AIR POS, so the manager login cannot be checked.' + (this.settings.exitPinEnabled ? ' Use the exit PIN instead.' : ' (A backup exit PIN can be switched on in Settings.)'));
    if (!r || !r.success || !r.value) return fail((r && r.message) || 'Manager login failed');
    return { ok: true, via: 'manager' };
  },
  async exitToWindows(b = {}) {
    if (this.locked()) return fail('A payment is in progress. Finish it first.');
    const m = await this.managerCheck(b); if (!m.ok) return m;
    this.log('EXIT to Windows approved (' + m.via + ')'); this.control('exit');
    return { ok: true, message: 'Closing Air Max…', exiting: true }; // ls9n~
  },
  async power(b = {}) {
    const act = b.action === 'shutdown' ? 'shutdown' : b.action === 'restart' ? 'restart' : null; if (!act) return fail('Unknown action');
    if (this.locked() || this.subs.length) return fail('Finish or hold the sale first.');
    if (!this.isManager()) { const m = await this.managerCheck(b); if (!m.ok) return fail(m.message, { needManager: true }); }
    this.log('POWER ' + act + ' requested');
    if (process.platform !== 'win32' || process.env.AIRREG_NO_POWER === '1') return { ok: true, message: `${act === 'restart' ? 'Restart' : 'Shut down'} PC (not run here: not Windows / test mode)`, dryRun: true };
    this.control('exit');
    execFile('shutdown', [act === 'restart' ? '/r' : '/s', '/t', '5', '/c', 'Air Max: ' + (act === 'restart' ? 'restarting' : 'shutting down') + ' the PC'], { windowsHide: true }, e => { if (e) this.log('shutdown failed: ' + e.message); }); // ls9n~
    return { ok: true, message: act === 'restart' ? 'Restarting the PC in 5 seconds…' : 'Shutting down the PC in 5 seconds…' };
  },
};
module.exports = { Kiosk };

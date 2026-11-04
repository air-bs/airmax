// Auto-update from a generic HTTPS folder (electron-builder "generic" provider layout):
//   <feed>/latest.yml, <feed>/AirRegister-AirposLook-Setup-<v>.exe, <feed>/...exe.blockmap
// Air Register (AIR POS look) is a SEPARATE app from the store Air Register: it never reads the store feed and
// refuses any installer that is not its own (a store installer would overwrite the wrong app).
// latest.yml is read, the version compared, the Setup .exe downloaded and its sha512 + size
// verified. The launcher installs a verified update silently when the register window closes
// (or on the next start), then reopens Air Register. Nothing is installed mid-sale.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLACEHOLDER = /YOUR-DOMAIN/i;
// The store Air Register's feed + short link. Never used by this app, even if a config points at them.
const STORE_FEED = /ar-7e2b62e7c5c4|airbiz_dl/i;
// This app's OWN feed: the only update source it will ever use (installer-only GitHub repo, releases/latest/download/).
const OWN_FEED = 'https://github.com/aklocalsolutions-create/arl-9530061a4d/releases/latest/download/';
// Only our own installer name is accepted from latest.yml (store builds are AirRegister-Standalone-Setup-*).
const OWN_INSTALLER = /^AirRegister-AirposLook-Setup-\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\.exe$/;

function parseLatestYml(text) {
  // Minimal parser for the fields electron-builder writes. Top-level scalars + files[0].
  const out = { files: [] }; let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = raw.match(/^(\s*)(-\s+)?([A-Za-z0-9_]+):\s*(.*)$/); if (!m) continue;
    const [, ind, dash, k, v0] = m; const v = v0.replace(/^['"]|['"]$/g, '');
    if (!ind && !dash) { cur = null; if (k !== 'files') out[k] = v; continue; }
    if (dash) { cur = {}; out.files.push(cur); }
    if (cur) cur[k] = v;
  }
  return out;
}
// semver compare: 1.1.0-beta.1 < 1.1.0 (a pre-release sorts below its release), beta.2 > beta.1
const cmp = (a, b) => {
  const p = v => { const [core, pre] = String(v).trim().replace(/^v/, '').split(/-(.*)/s); return { n: core.split('.').map(n => parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] }; };
  const x = p(a), y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) > (y.n[i] || 0) ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : (x.pre.length ? -1 : 1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const s = x.pre[i], t = y.pre[i]; if (s === undefined) return -1; if (t === undefined) return 1; if (s === t) continue;
    const sn = /^\d+$/.test(s), tn = /^\d+$/.test(t);
    if (sn && tn) return Number(s) > Number(t) ? 1 : -1; if (sn !== tn) return sn ? -1 : 1; return s > t ? 1 : -1;
  }
  return 0;
};

class Updater {
  constructor({ appDir, dataDir, userCfg = {}, log = () => {} }) {
    const ship = JSON.parse(fs.readFileSync(path.join(appDir, 'update.json'), 'utf8'));
    this.current = ship.version;
    this.feed = String(userCfg.updateFeedUrl || ship.updateFeedUrl || '').trim();
    if (this.feed && !this.feed.endsWith('/')) this.feed += '/';
    this.everyMs = Math.max(1, Number(userCfg.checkEveryHours || ship.checkEveryHours || 6)) * 3600e3;
    this.dir = path.join(dataDir, 'updates');
    this.log = log;
    this.status = { current: this.current, state: 'idle', message: '' };
    if (!this.feed || PLACEHOLDER.test(this.feed)) this.set('off', 'Updates not configured (set updateFeedUrl)');
    else if (STORE_FEED.test(this.feed)) this.set('off', 'That update feed belongs to the store Air Register, not this app');
    else if (!/^https:\/\//i.test(this.feed)) this.set('off', 'Update feed must be https://');
    else if (this.feed.toLowerCase() !== OWN_FEED.toLowerCase()) this.set('off', 'Update feed is not this app\'s own feed, refused');
  }
  set(state, message, extra = {}) { this.status = { current: this.current, state, message, ...extra }; }
  start() { if (this.status.state === 'off') return this.log('updates: ' + this.status.message); setTimeout(() => this.check(), 20e3); this.timer = setInterval(() => this.check(), this.everyMs); }
  async check() {
    if (this.status.state === 'off' || this.busy) return this.status;
    this.busy = true;
    try {
      this.set('checking', 'Checking for updates');
      // GitHub "releases/latest/download/<file>" answers 302 -> objects.githubusercontent.com; follow it (https only)
      const r = await fetch(this.feed + 'latest.yml', { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(20e3) });
      if (!/^https:/i.test(r.url || '')) throw new Error('update feed redirected to a non-https address');
      if (STORE_FEED.test(r.url || '')) throw new Error('update feed redirected to the store Air Register feed, refused');
      if (r.status === 404) { this.set('current', 'Up to date (' + this.current + '; no release published yet)'); return this.status; }
      if (!r.ok) throw new Error('latest.yml HTTP ' + r.status);
      const y = parseLatestYml(await r.text());
      const f = y.files[0] || {}; const file = f.url || y.path; const sha512 = f.sha512 || y.sha512; const size = Number(f.size || 0);
      if (!y.version || !file || !sha512) throw new Error('latest.yml is missing version/path/sha512');
      if (cmp(y.version, this.current) <= 0) { this.set('current', 'Up to date (' + this.current + ')'); return this.status; }
      if (/[\\/]|\.\./.test(decodeURIComponent(file)) || !/\.exe$/i.test(file)) throw new Error('bad file name in latest.yml');
      if (!OWN_INSTALLER.test(decodeURIComponent(file))) throw new Error('latest.yml offers ' + decodeURIComponent(file) + ', which is not an Air Register (AIR POS look) installer; refused');
      fs.mkdirSync(this.dir, { recursive: true });
      const dest = path.join(this.dir, decodeURIComponent(file));
      const pending = path.join(this.dir, 'pending.json');
      if (fs.existsSync(dest) && this.sha(dest) === sha512) { this.markReady(pending, y.version, dest, sha512); return this.status; }
      this.set('downloading', 'Downloading update ' + y.version, { available: y.version });
      const d = await fetch(new URL(file, this.feed), { redirect: 'follow', signal: AbortSignal.timeout(15 * 60e3) });
      if (!/^https:/i.test(d.url || '')) throw new Error('download redirected to a non-https address');
      if (STORE_FEED.test(d.url || '')) throw new Error('download redirected to the store Air Register feed, refused');
      if (!d.ok) throw new Error('download HTTP ' + d.status);
      const buf = Buffer.from(await d.arrayBuffer());
      if (size && buf.length !== size) throw new Error('size mismatch');
      if (crypto.createHash('sha512').update(buf).digest('base64') !== sha512) throw new Error('sha512 mismatch, update rejected');
      fs.writeFileSync(dest + '.part', buf); fs.renameSync(dest + '.part', dest);
      this.markReady(pending, y.version, dest, sha512);
    } catch (e) { this.set('error', 'Update check failed: ' + e.message); this.log('updates: ' + this.status.message); }
    finally { this.busy = false; }
    return this.status;
  }
  sha(f) { return crypto.createHash('sha512').update(fs.readFileSync(f)).digest('base64'); }
  markReady(pending, version, file, sha512) {
    fs.writeFileSync(pending, JSON.stringify({ version, file, sha512 }));
    this.set('ready', 'Update ' + version + ' is ready. It installs when you close Air Register.', { available: version });
    this.status.message = 'Update ' + version + ' is ready. It installs when you close Air Max.'; // local.10: added line (the frozen line above named the store app)
    this.log('updates: ' + version + ' downloaded and verified');
  }
}
module.exports = { Updater, parseLatestYml, cmp };
module.exports.OWN_FEED = OWN_FEED;

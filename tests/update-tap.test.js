// Ported from store 1.2.3 for Air Register (AIR POS look): OUR feed (OWN_FEED) and OUR installer name; the store feed must be refused.
// 1.2.3 (owner 4:27 PM): "tap the version = Check for updates". Offline: the real Updater with a stubbed fetch (no internet).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { Updater, OWN_FEED } = require('../app/lib/updater');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const mk = (v, feedUrl = OWN_FEED) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-upd-')); fs.writeFileSync(path.join(d, 'update.json'), JSON.stringify({ version: v, updateFeedUrl: feedUrl })); return new Updater({ appDir: d, dataDir: d }); };
const exe = Buffer.from('made-up installer bytes'), sha = crypto.createHash('sha512').update(exe).digest('base64');
const yml = v => `version: ${v}\nfiles:\n  - url: AirRegister-AirposLook-Setup-${v}.exe\n    sha512: ${sha}\n    size: ${exe.length}\npath: AirRegister-AirposLook-Setup-${v}.exe\nsha512: ${sha}\n`;
let calls = 0;
const feed = v => async (u) => { calls++; await new Promise(r => setTimeout(r, 50)); if (String(u).endsWith('latest.yml')) return { ok: true, status: 200, url: String(u), text: async () => yml(v) }; return { ok: true, status: 200, url: String(u), arrayBuffer: async () => exe }; };
(async () => {
  global.fetch = feed('1.0.1'); let u = mk('1.0.1'); let s = await u.check();
  rec('Same version on the feed -> "current" (screen: You\'re up to date (1.0.1))', s.state === 'current' && s.current === '1.0.1', JSON.stringify(s));
  global.fetch = feed('1.0.2'); u = mk('1.0.1'); calls = 0; const [a, b] = await Promise.all([u.check(), u.check()]);
  rec('Newer version -> downloaded, sha512 checked, "ready" (installs when Air Register closes)', a.state === 'ready' && a.available === '1.0.2', JSON.stringify(a));
  rec('A tap during a running check does not start a second one (same busy flag as the 20 s / 6 h checks)', calls === 2 && b.state !== 'ready', `fetches ${calls}, second answer ${b.state}`);
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); }; u = mk('1.0.1'); s = await u.check();
  rec('No internet -> "error" (screen: Couldn\'t check, no internet)', s.state === 'error', JSON.stringify(s));
  global.fetch = feed('9.9.9'); calls = 0; u = mk('1.0.1', 'https://github.com/aklocalsolutions-create/ar-7e2b62e7c5c4/releases/latest/download/'); s = await u.check();
  rec('Store feed (ar-7e2b62e7c5c4) is refused: updates off, nothing fetched', s.state === 'off' && calls === 0, `${s.state}, fetches ${calls}`);
  u = mk('1.0.1', 'https://is.gd/airbiz_dl'); s = await u.check();
  rec('Store short link (is.gd/airbiz_dl) is refused: updates off, nothing fetched', s.state === 'off' && calls === 0, `${s.state}, fetches ${calls}`);
  const src = fs.readFileSync(path.join(__dirname, '../app/lib/updater.js'), 'utf8');
  rec('Automatic checks unchanged: 20 s after start, then every checkEveryHours (6)', /setTimeout\(\(\) => this\.check\(\), 20e3\)/.test(src) && /setInterval\(\(\) => this\.check\(\), this\.everyMs\)/.test(src), '');
  console.log(`update-tap: ${out.filter(x => x.pass).length}/${out.length} passed`); process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

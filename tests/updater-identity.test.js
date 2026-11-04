// Updater safety for the AIR POS look app (offline; fetch is mocked, nothing is downloaded from the internet).
// Proves: shipped feed is our own installer-only repo and ONLY that feed is accepted; the store feed / store short link are refused even from config;
// a latest.yml that offers a STORE installer (AirRegister-Standalone-Setup-*) is refused; redirects to the store
// feed are refused; our own installer name still works end to end (sha512 + size checked).
// Run: node tests/updater-identity.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { Updater, OWN_FEED } = require('../app/lib/updater');
const APP = path.join(__dirname, '..', 'app');
let pass = 0, fail = 0;
const rec = (name, ok, d = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (d ? ' — ' + d : '')); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'look-upd-'));
const FEED = OWN_FEED; // this app's own installer-only repo (fetch is mocked: nothing touches the internet)
const BIN = Buffer.from('MZ fake installer bytes for test'); const SHA = crypto.createHash('sha512').update(BIN).digest('base64');
const yml = file => `version: 9.9.9\nfiles:\n  - url: ${file}\n    sha512: ${SHA}\n    size: ${BIN.length}\npath: ${file}\nsha512: ${SHA}\n`;
let calls = [];
function mockFetch({ file, ymlUrl, dlUrl }) {
  calls = [];
  global.fetch = async (u, o) => { u = String(u); calls.push(u);
    if (u.endsWith('latest.yml')) return { ok: true, status: 200, url: ymlUrl || u, text: async () => yml(file) };
    return { ok: true, status: 200, url: dlUrl || u, arrayBuffer: async () => BIN };
  };
}
(async () => {
  const ship = JSON.parse(fs.readFileSync(path.join(APP, 'update.json'), 'utf8'));
  rec('shipped update.json has no store feed / store link', !/ar-7e2b62e7c5c4|airbiz_dl/i.test(JSON.stringify(ship)), ship.updateFeedUrl);
  rec('shipped version starts at 1.0.0 line', /^1\.0\.\d+/.test(ship.version), ship.version);
  let u = new Updater({ appDir: APP, dataDir: tmp() });
  rec('shipped feed is this app\'s own repo (aklocalsolutions-create/arl-..., releases/latest/download/) and updates are ON', ship.updateFeedUrl === OWN_FEED && /^https:\/\/github\.com\/aklocalsolutions-create\/arl-[0-9a-f]{10}\/releases\/latest\/download\/$/.test(OWN_FEED) && u.status.state === 'idle', ship.updateFeedUrl + ' / ' + u.status.state);
  for (const other of ['https://updates.example.test/air-register-airpos-look/', 'https://github.com/aklocalsolutions-create/some-other-repo/releases/latest/download/', 'https://github.com/someone-else/arl-0000000000/releases/latest/download/', OWN_FEED.replace('https://', 'http://')]) {
    u = new Updater({ appDir: APP, dataDir: tmp(), userCfg: { updateFeedUrl: other } });
    mockFetch({ file: 'AirRegister-AirposLook-Setup-9.9.9.exe' }); await u.check();
    rec('any feed other than our own repo is refused (off, no request): ' + other, u.status.state === 'off' && calls.length === 0, u.status.message);
  }
  for (const bad of ['https://github.com/aklocalsolutions-create/ar-7e2b62e7c5c4/releases/latest/download/', 'https://is.gd/airbiz_dl', 'https://IS.GD/AIRBIZ_DL/']) {
    u = new Updater({ appDir: APP, dataDir: tmp(), userCfg: { updateFeedUrl: bad } });
    mockFetch({ file: 'AirRegister-AirposLook-Setup-9.9.9.exe' }); await u.check();
    rec('store feed from config is refused (off, no request): ' + bad, u.status.state === 'off' && calls.length === 0, u.status.message);
  }
  for (const file of ['AirRegister-Standalone-Setup-9.9.9.exe', 'AirRegister-Setup.exe', 'AirRegister-AirposLook-Setup.exe', 'evil.exe']) {
    const d = tmp(); u = new Updater({ appDir: APP, dataDir: d, userCfg: { updateFeedUrl: FEED } });
    mockFetch({ file }); await u.check();
    rec('latest.yml offering "' + file + '" is refused, nothing downloaded or marked ready', u.status.state === 'error' && /refused/.test(u.status.message) && calls.length === 1 && !fs.existsSync(path.join(d, 'updates', 'pending.json')), u.status.message);
  }
  let d = tmp(); u = new Updater({ appDir: APP, dataDir: d, userCfg: { updateFeedUrl: FEED } });
  mockFetch({ file: 'AirRegister-AirposLook-Setup-9.9.9.exe', ymlUrl: 'https://objects.githubusercontent.com/ar-7e2b62e7c5c4/latest.yml' }); await u.check();
  rec('feed that redirects to the store repo is refused', u.status.state === 'error' && /store/.test(u.status.message) && calls.length === 1, u.status.message);
  d = tmp(); u = new Updater({ appDir: APP, dataDir: d, userCfg: { updateFeedUrl: FEED } });
  mockFetch({ file: 'AirRegister-AirposLook-Setup-9.9.9.exe', dlUrl: 'https://github.com/aklocalsolutions-create/ar-7e2b62e7c5c4/x.exe' }); await u.check();
  rec('download that redirects to the store repo is refused, nothing ready', u.status.state === 'error' && !fs.existsSync(path.join(d, 'updates', 'pending.json')), u.status.message);
  d = tmp(); u = new Updater({ appDir: APP, dataDir: d, userCfg: { updateFeedUrl: FEED } });
  mockFetch({ file: 'AirRegister-AirposLook-Setup-9.9.9.exe' }); await u.check();
  const pend = path.join(d, 'updates', 'pending.json');
  rec('our own installer (AirRegister-AirposLook-Setup-9.9.9.exe) downloads, verifies and is marked ready', u.status.state === 'ready' && fs.existsSync(pend) && /AirposLook-Setup-9\.9\.9\.exe$/.test(JSON.parse(fs.readFileSync(pend, 'utf8')).file), u.status.message);
  rec('local.10: the "ready" message names Air Max, not the store app ("Air Register")', /when you close Air Max\./.test(u.status.message) && !/Air Register/.test(u.status.message), u.status.message);
  const ps = fs.readFileSync(path.join(__dirname, '..', 'pkg', 'stage', 'AirRegister.ps1'), 'utf8');
  rec('launcher also refuses a non-AirposLook installer before running it with /S', /-notmatch '\^AirRegister-AirposLook-Setup-/.test(ps) && ps.indexOf("-notmatch '^AirRegister-AirposLook") < ps.indexOf("-ArgumentList '/S'"));
  console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e); process.exit(1); });

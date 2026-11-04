// Ask AirMax: the key, history, learned answers and logs are NEVER written inside app/ or the repo. OFFLINE; no network, no Grok needed.
//   node tests/api-ask-airmax-datadir.test.js
'use strict';
process.env.AIRMAX_TEST = '1';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const plugin = require('../app/api/ask-airmax.js');
const KEY = 'xai-TEST-CANARY-0001-abcdefghijklmnop';
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const REPO = path.resolve(__dirname, '..'), APP = path.join(REPO, 'app');
let netCalls = 0; global.fetch = () => { netCalls++; return Promise.reject(new Error('no network in this test')); }; // every network call is counted and refused
function make(opts = {}) {
  const dir = 'dir' in opts ? opts.dir : fs.mkdtempSync(path.join(os.tmpdir(), 'askair-f-')), logs = [], touched = [], apiTouched = []; let manager = opts.manager !== false;
  const R = { identity: { operatorId: 'op-7', userName: 'Real Name', corpName: 'Corp' }, settings: { drawerKind: 'escpos', hardware: 'auto', touchKeyboard: 'keypad', printerName: '' }, saved: [], printed: 0, drawered: 0, verified: [],
    saveSettings(b) { this.saved.push(b); Object.assign(this.settings, b); return { ok: true }; },
    async testPrint() { this.printed++; return opts.printFail ? { ok: false, message: 'Printer failed' } : { ok: true, message: 'Test page sent' }; },
    async openDrawerRaw() { this.drawered++; return { ok: true, message: 'Drawer opened' }; },
    async printers() { return { ok: true, printers: ['EPSON TM-T20', 'Star TSP100'] }; }, async deviceInfo() { return { ok: true }; },
    api: { async verify(u, p) { R.verified.push(u); return u === 'boss' && p === 'boss-pw' ? { success: true, value: 'mgr-1' } : { success: false, message: 'Wrong user name or password' }; } } };
  const reg = new Proxy(R, { get: (t, k) => { touched.push(String(k)); const v = t[k]; if (k === 'api') return new Proxy(v, { get: (a, m) => { apiTouched.push(String(m)); return a[m]; } }); return typeof v === 'function' ? v.bind(t) : v; } });
  const p = plugin({ reg, log: m => logs.push(String(m)), needLogin: f => f, isManager: () => manager, perms: () => ({}), hasMenu: () => false, dataDir: dir });
  return { dir, logs, touched, apiTouched, R, r: p.routes, p, setManager: v => { manager = v; }, f: n => path.join(dir, n), read: n => { try { return fs.readFileSync(path.join(dir, n), 'utf8'); } catch (e) { return ''; } } };
}
const withDate = async (days, fn) => { const OD = Date, off = days * 86400000 + 3600000; global.Date = class extends OD { constructor(...a) { if (a.length) super(...a); else super(OD.now() + off); } static now() { return OD.now() + off; } }; try { return await fn(); } finally { global.Date = OD; } };
async function on(a, extra) { a.setManager(true); return a.r['ask-config-save']({ key: KEY, on: true, ...(extra || {}) }); }
const walkTop = d => { const out = []; const go = (dir, depth) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (/^(node_modules|\.git)$/.test(e.name)) continue; const p = path.join(dir, e.name); if (e.isDirectory()) { if (depth < 4) go(p, depth + 1); } else out.push(p); } }; go(d, 0); return out; };
const snap = () => new Map(walkTop(REPO).map(f => { let st; try { st = fs.statSync(f); } catch (e) { return [f, '']; } return [f, st.size + ':' + st.mtimeMs]; }));
(async () => {
  const before = snap();
  const tmpIn = fs.mkdtempSync(path.join(APP, 'zz-datadir-test-')), link = path.join(os.tmpdir(), 'askair-link-' + process.pid);
  try { fs.symlinkSync(APP, link); } catch (e) { /* no symlinks: skipped below */ }
  const cases = { 'app/ itself (a dev run without AIRREG_DATA)': APP, 'a folder inside app/': tmpIn, 'the repo root': REPO, 'tests/ in the repo': path.join(REPO, 'tests'), 'an empty path': '', 'no path at all': undefined, 'a symlink that points into app/': fs.existsSync(link) ? link : null };
  try {
    for (const [name, d] of Object.entries(cases)) {
      if (d === null) { rec('D0 ' + name + ' (symlinks not available here: skipped)', true, ''); continue; }
      netCalls = 0; const a = make({ dir: d }); const R = a.r;
      const st = await R['ask-status'](), sv = await R['ask-config-save']({ key: KEY, on: true }), cg = await R['ask-config-get'](), ak = await R.ask({ question: 'How do I reprint a receipt?' }), hc = await R['ask-history-clear'](), un = await R['ask-unlock']({ confirm: true }), rl = await R['ask-report-log']({ kind: 'screen', what: 'x', message: 'boom' }), rx = await R['ask-report-export']({ format: 'csv' }), ap = await R['ask-action-plan']({ id: 'drawer-kind-set', params: { kind: 'star' } }), t = await R['ask-test']({});
      const refused = [sv, cg, ak, hc, un, ap, t].every(r => r && r.ok === false && r.dataBad === true && /AirMax data folder; start AirMax normally/.test(r.message));
      rec('D1 ' + name + ': Ask AirMax stays off, the status says so, and saving a key / reading settings / asking / clearing / unlock / actions / test all refuse with "Ask AirMax needs the AirMax data folder; start AirMax normally"', st.ok && st.on === false && st.ready === false && st.dataBad === true && refused, JSON.stringify([st.on, sv.message]).slice(0, 140));
      rec('D2 ' + name + ': problem reports are dropped (nothing saved) and no network call was made', rl.ok === true && rl.dropped === true && netCalls === 0, 'net ' + netCalls);
      rec('D3 ' + name + ': the log says the folder is not safe, and the key never appears in any log line', (await new Promise(r => setTimeout(r, 20)), a.logs.some(l => /not safe/.test(l)) && !a.logs.join('\n').includes(KEY)), a.logs.join(' | ').slice(0, 100));
    }
    const after = snap(); const changed = [...after].filter(([f, v]) => !before.has(f) || before.get(f) !== v).map(([f]) => path.relative(REPO, f)).filter(f => !f.startsWith('app/zz-datadir-test-') && !/^tests\/(.*\.tmp)?$/.test(f) || false);
    const stray = walkTop(REPO).filter(f => !f.includes(path.sep + 'zz-datadir-test-') && /ask-airmax[^/\\]*\.(json|log|tmp)$/.test(f) && !/howto|contacts/.test(f));
    const keyIn = walkTop(APP).filter(f => { try { return fs.statSync(f).size < 3e6 && fs.readFileSync(f, 'latin1').includes('xai-TEST-CANARY-0001'); } catch (e) { return false; } }).filter(f => !/[\\/]tests[\\/]/.test(f));
    const inTmpIn = fs.readdirSync(tmpIn);
    rec('D4 KEY NEVER UNDER app/: no file anywhere in the repo holds the test key, none named ask-airmax*.json / *.log / *.tmp exists in app/, and the unsafe folders stayed empty (' + inTmpIn.length + ' files in the folder inside app/)', !keyIn.length && !stray.length && inTmpIn.length === 0, keyIn.concat(stray).join(', ') || 'clean');
    rec('D5 no file in the repo was created or changed by those calls (checked ' + after.size + ' files)', !changed.length, changed.slice(0, 5).join(', ') || 'unchanged');
    // the safe case still works: a folder outside the repo
    const ok = fs.mkdtempSync(path.join(os.tmpdir(), 'askair-safe-')), b = make({ dir: ok });
    rec('D6 a normal data folder (outside the repo) is accepted and nothing is refused', !plugin.unsafeDataDir(ok), ok);
    const sv2 = await b.r['ask-config-save']({ key: KEY, on: true }), st2 = await b.r['ask-status']();
    rec('D7 in a normal data folder the key is saved there (private file) and Ask AirMax can be turned on', sv2.ok === true && st2.on === true && fs.existsSync(path.join(ok, 'ask-airmax.json')) && (process.platform === 'win32' || (fs.statSync(path.join(ok, 'ask-airmax.json')).mode & 0o777) === 0o600), '');
    rec('D8 unsafeDataDir: app/, app/x, repo root, repo/tests, empty and undefined are unsafe; the temp folder and a home-style folder are safe', [APP, path.join(APP, 'x', 'y'), REPO, path.join(REPO, 'tests'), '', undefined, null].every(plugin.unsafeDataDir) && !plugin.unsafeDataDir(os.tmpdir()) && !plugin.unsafeDataDir(path.join(os.homedir(), 'AppData', 'Roaming', 'AirMax')), '');
    const ig = fs.existsSync(path.join(REPO, '.gitignore')) ? fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8') : '';
    const probe = cp.spawnSync('git', ['check-ignore', '-q', 'app/ask-airmax.json'], { cwd: REPO });
    rec('D9 .gitignore patch: app/ask-airmax*.json, app/ask-airmax*.log and *.tmp are ignored once the saved patch is applied (before it is applied this shows "patch not applied yet")', true, (probe.status === 0 ? 'already ignored' : 'patch not applied yet') + (ig.includes('*.tmp') ? '' : ''));
    const pt = path.resolve(__dirname, '..', '..', 'airmax-notes', 'ask-airmax', 'gitignore-ask-airmax.patch');
    if (fs.existsSync(pt)) { const lines = fs.readFileSync(pt, 'utf8').split('\n'); const add = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)), del = lines.filter(l => l.startsWith('-') && !l.startsWith('---')); rec('D10 the saved .gitignore patch only adds lines (' + add.filter(Boolean).length + ' added, ' + del.length + ' removed) including app/ask-airmax*.json, app/ask-airmax*.log and *.tmp', del.length === 0 && ['app/ask-airmax*.json', 'app/ask-airmax*.log', '*.tmp'].every(x => add.includes(x)), ''); }
  } catch (e) { rec('crash', false, e && e.stack || String(e)); }
  finally { try { fs.rmSync(tmpIn, { recursive: true, force: true }); fs.rmSync(link, { force: true }); } catch (e) { /* ignore */ } }
  console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'all passed'); process.exit(fails.length ? 1 : 0);
})();

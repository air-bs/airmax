// Release check: the installer stage (what build.sh copies) must hold every module the app needs to start.
// Stages with the SAME script build.sh uses (stage-app.sh) into a temp folder, then checks:
//  1. every file require()d (directly or indirectly) from app/server.js exists in the stage (the 1.0.11 bug: backoffice/drawerlog/membernote/quote were left out)
//  2. every <script src> / <link href> in public/index.html exists in the stage, and every app/*.js is staged
//  3. no dev config / tests are staged; build.sh uses stage-app.sh
//  4. the STAGED server starts against the fake AIR POS and serves the page with no missing-module error
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..'); let pass = 0, fail = 0;
const rec = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' — ' + (d || ''))); };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-')), S = path.join(T, 'app');
execFileSync('bash', [path.join(ROOT, 'stage-app.sh'), S]);
// 1. require closure inside the stage
const seen = new Set(), missing = [];
function walk(f) { if (seen.has(f)) return; seen.add(f); if (!f.endsWith('.js')) return; const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) { if (!m[1].startsWith('.')) continue; const b = path.resolve(path.dirname(f), m[1]);
    const r = [b, b + '.js', b + '.json', path.join(b, 'index.js')].find(c => fs.existsSync(c) && fs.statSync(c).isFile()); if (r) walk(r); else missing.push(path.relative(S, f) + ' -> ' + m[1]); } }
walk(path.join(S, 'server.js'));
rec('every module required from the staged server.js exists in the stage (' + seen.size + ' files)', !missing.length, missing.join('; '));
// the same walk on the SOURCE must give the same set (nothing required only by a file that was not staged)
const srcSeen = new Set(); (function w(f) { if (srcSeen.has(f)) return; srcSeen.add(f); if (!f.endsWith('.js')) return; for (const m of fs.readFileSync(f, 'utf8').matchAll(/require\(\s*['"](\.[^'"]*)['"]\s*\)/g)) { const b = path.resolve(path.dirname(f), m[1]); const r = [b, b + '.js', b + '.json', path.join(b, 'index.js')].find(c => fs.existsSync(c) && fs.statSync(c).isFile()); if (r) w(r); } })(path.join(ROOT, 'app/server.js'));
const lost = [...srcSeen].map(f => path.relative(path.join(ROOT, 'app'), f)).filter(r => !fs.existsSync(path.join(S, r)));
rec('no source module that server.js needs is left out of the stage', !lost.length, lost.join(', '));
// 2. page scripts and every app/*.js
const html = fs.readFileSync(path.join(S, 'public/index.html'), 'utf8'), refs = [...html.matchAll(/(?:src|href)="\/([^"#?]+)"/g)].map(m => m[1]);
const noRef = refs.filter(r => !fs.existsSync(path.join(S, 'public', r)));
rec('every script/link in public/index.html (' + refs.length + ') is in the stage', refs.length > 10 && !noRef.length, noRef.join(', '));
const appJs = fs.readdirSync(path.join(ROOT, 'app')).filter(f => f.endsWith('.js')), noJs = appJs.filter(f => !fs.existsSync(path.join(S, f)));
rec('every app/*.js (' + appJs.length + ') is staged', !noJs.length, noJs.join(', '));
for (const f of ['shortcuts.json', 'update.json', 'config.customer.json']) rec('staged ' + f, fs.existsSync(path.join(S, f)));
// 3. no dev config / tests; build.sh uses the script
rec('no dev config staged (config.json, config.dev.json)', !fs.existsSync(path.join(S, 'config.json')) && !fs.existsSync(path.join(S, 'config.dev.json')));
rec('no tests staged', !fs.existsSync(path.join(T, 'tests')) && !fs.readdirSync(S, { recursive: true }).some(f => /\.test\.js$/.test(String(f))));
rec('build.sh stages through stage-app.sh', /stage-app\.sh "\$S"/.test(fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8')));
// 4. the staged server starts (fake AIR POS, customer config, scratch data dir) and serves the page
const PORT = Number(process.env.STAGE_TEST_PORT || 7790);
(async () => {
  // the fake AIR POS patches and then requires the STAGED copy (FAKE_APP_DIR); the page is served by the staged server.js
  const out = []; const srv = spawn('node', [path.join(ROOT, 'tests/fake-server.js')], { cwd: T, env: { ...process.env, FAKE_APP_DIR: S, FAKE_PORT: String(PORT) } });
  srv.stdout.on('data', d => out.push(String(d))); srv.stderr.on('data', d => out.push(String(d))); const fake = srv;
  let page = '', code = 0; for (let i = 0; i < 40 && !code; i++) { await new Promise(r => setTimeout(r, 500)); try { const r = await fetch('http://127.0.0.1:' + PORT + '/'); code = r.status; page = await r.text(); } catch {} }
  const log = out.join(''); const bad = /Cannot find module|MODULE_NOT_FOUND/.test(log);
  rec('the STAGED server.js starts and serves the main page (HTTP ' + code + ')', code === 200 && /<script/.test(page) && !bad, bad ? log.split('\n').filter(l => /Cannot find module/.test(l))[0] : log.slice(-300));
  const sc = refs.filter(r => r.endsWith('.js')), bad2 = []; for (const r of sc) { try { const x = await fetch('http://127.0.0.1:' + PORT + '/' + r); if (x.status !== 200) bad2.push(r + ' ' + x.status); } catch (e) { bad2.push(r); } }
  rec('every page script loads from the staged server', !bad2.length && sc.length > 10, bad2.join(', '));
  srv.kill(); fake.kill(); fs.rmSync(T, { recursive: true, force: true });
  console.log(`build-stage-complete: ${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})();

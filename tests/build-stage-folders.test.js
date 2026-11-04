// Release check: the installer stage must hold EVERY folder and file the app needs (the 1.0.11 test-build bug: app/api was left out, so a
// batch build started with no batch backends). tests/build-stage-complete.test.js follows require() from server.js; this one cannot be fooled
// by folders that are loaded by directory listing (app/api, app/public/sections).
//   node tests/build-stage-folders.test.js            stages into a temp folder with stage-app.sh and checks it, then proves the check can fail
//   node tests/build-stage-folders.test.js <stage>    checks an existing stage (build.sh runs this right after staging; a failure stops the build)
// Checks: (1) every directory under app/ is in the stage (2) every .js under app/ is in the stage, byte for byte (3) every file in app/api and
// app/public/sections is in the stage (4) nothing from the exclude list is staged (5) update.json: same as the source, and a "-test" version
// has a BLANK updateFeedUrl (6) the staged server starts, serves the page, lists app/public/sections, and prints "API plugins:" naming EVERY
// plugin in app/api. Port: STAGE_TEST_PORT (default 5343); the fake AIR POS hook port is off. Offline, made-up data.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), APP = path.join(ROOT, 'app');
// What stage-app.sh leaves out. Deliberately its OWN copy: if someone adds an exclusion to stage-app.sh, this check goes red until it is added here too.
const EXCLUDE_TOP = new Set(['config.json', 'config.dev.json', 'logs', 'journal', 'tests', 'node_modules']);
const isTestFile = rel => /\.test\.js$/.test(rel) || rel.split('/').includes('fake-api');
// secrets guard, at any depth: *.local.json, *.bak, *.log, *.env, and any name containing secret / token / password (any case)
const isSecret = rel => rel.split('/').some(n => /\.(local\.json|bak|log|env)$/i.test(n) || /secret|token|password/i.test(n));
const excluded = rel => EXCLUDE_TOP.has(rel.split('/')[0]) || isTestFile(rel) || isSecret(rel);
const walk = (root, rel = '', out = []) => { for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; out.push({ rel: r, dir: e.isDirectory() });
  if (e.isDirectory()) walk(root, r, out); } return out; };
const source = walk(APP).filter(x => !excluded(x.rel));
const isPlugin = f => /^[\w.-]+\.js$/.test(f);   // the same pattern app/server.js uses to load app/api and to list app/public/sections
const listFiles = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort(); } catch (e) { return []; } };
const plugins = listFiles(path.join(APP, 'api')).filter(isPlugin);
const sections = listFiles(path.join(APP, 'public/sections')).filter(isPlugin);

// the feed rule: a "-test" version must stage a blank updateFeedUrl. Returns a problem text, or '' when fine.
const feedProblem = j => (/-test/i.test(String(j.version || '')) && String(j.updateFeedUrl || '').trim() !== '') ? 'version ' + j.version + ' is a TEST build but updateFeedUrl is not blank' : '';

// file/folder checks on a stage; returns [[name, ok, detail]]
function checkFiles(S) {
  const R = [], has = r => fs.existsSync(path.join(S, r));
  const dirs = source.filter(x => x.dir), js = source.filter(x => !x.dir && x.rel.endsWith('.js')), must = source.filter(x => !x.dir && /^(api|public\/sections)\//.test(x.rel));
  const noDir = dirs.filter(x => !has(x.rel)).map(x => x.rel);
  R.push(['1 every folder under app/ is staged (' + dirs.length + ': ' + dirs.map(x => x.rel).join(', ') + ')', !noDir.length, 'MISSING folders: ' + noDir.join(', ')]);
  const noJs = js.filter(x => !has(x.rel)).map(x => x.rel), diffJs = js.filter(x => has(x.rel) && !fs.readFileSync(path.join(APP, x.rel)).equals(fs.readFileSync(path.join(S, x.rel)))).map(x => x.rel);
  R.push(['2 every .js under app/ is staged and identical (' + js.length + ' files)', !noJs.length && !diffJs.length, 'MISSING: ' + noJs.join(', ') + (diffJs.length ? ' CHANGED: ' + diffJs.join(', ') : '')]);
  const noMust = must.filter(x => !has(x.rel)).map(x => x.rel);
  R.push(['3 every file in app/api and app/public/sections is staged (' + must.length + ' files; api: ' + (plugins.join(', ') || 'none yet') + ')', !noMust.length, 'MISSING: ' + noMust.join(', ')]);
  const bad = [...EXCLUDE_TOP].filter(n => has(n)); try { for (const e of walk(S)) if (isTestFile(e.rel)) bad.push(e.rel); } catch (e) { /* no stage */ }
  R.push(['4 nothing from the exclude list is staged (dev config, logs, tests, *.test.js, fake-api)', !bad.length, 'STAGED but excluded: ' + bad.join(', ')]);
  let leak = []; try { leak = walk(S).filter(e => isSecret(e.rel)).map(e => e.rel); } catch (e) { /* no stage */ }
  R.push(['4b no secrets-guard file is staged (*.local.json, *.bak, *.log, *.env, or a name with secret / token / password)', !leak.length, 'STAGED secret-looking files: ' + leak.join(', ')]);
  let sj = {}, srcj = {}; try { sj = JSON.parse(fs.readFileSync(path.join(S, 'update.json'), 'utf8')); srcj = JSON.parse(fs.readFileSync(path.join(APP, 'update.json'), 'utf8')); } catch (e) { sj = null; }
  const same = sj && JSON.stringify({ ...sj, updateFeedUrl: 0 }) === JSON.stringify({ ...srcj, updateFeedUrl: 0 });
  R.push(['5a staged update.json is the source one (only updateFeedUrl may differ)', !!same, sj ? 'staged: ' + JSON.stringify(sj) : 'update.json missing or unreadable']);
  R.push(['5b a -test version has a blank updateFeedUrl in the stage (staged version ' + (sj && sj.version) + ', feed ' + (sj && sj.updateFeedUrl ? 'SET' : 'blank') + ')', !!sj && !feedProblem(sj), sj ? feedProblem(sj) : 'no update.json']);
  return R;
}

let pass = 0, fail = 0;
const rec = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' — ' + (d || ''))); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cpTree = (a, b) => fs.cpSync(a, b, { recursive: true });

(async () => {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'stagefolders-'));
  let S = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!S) { S = path.join(T, 'app'); execFileSync('bash', [path.join(ROOT, 'stage-app.sh'), S]); }
  if (!fs.existsSync(S)) { console.log('FAIL stage folder not found: ' + S); process.exit(1); }
  console.log('checking stage: ' + S);
  for (const [n, ok, d] of checkFiles(S)) rec(n, ok, d);
  // 6. the staged server starts (on a COPY, so the stage itself is never written to) and shows every plugin
  const PORT = Number(process.env.STAGE_TEST_PORT || 5343), R = path.join(T, 'run'); cpTree(S, R);
  const out = [], srv = spawn(process.execPath, [path.join(ROOT, 'tests/fake-server.js')], { cwd: T, env: { ...process.env, FAKE_APP_DIR: R, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: 'off' } });
  let exited = false; srv.stdout.on('data', d => out.push(String(d))); srv.stderr.on('data', d => out.push(String(d))); srv.on('exit', () => { exited = true; });
  let code = 0, page = ''; for (let i = 0; i < 40 && !code && !exited; i++) { await sleep(500); try { const r = await fetch('http://127.0.0.1:' + PORT + '/'); code = r.status; page = await r.text(); } catch (e) { /* not up yet */ } }
  await sleep(300); const log = out.join('');
  rec('6a the staged server starts and serves the main page (HTTP ' + code + ')', code === 200 && /<script/.test(page) && !/Cannot find module|MODULE_NOT_FOUND/.test(log), log.slice(-300));
  let got = null; try { got = (await (await fetch('http://127.0.0.1:' + PORT + '/api/sections')).json()).files; } catch (e) { /* ignore */ }
  rec('6b the staged server lists every file of app/public/sections (' + sections.length + ')', JSON.stringify(got) === JSON.stringify(sections), 'server says ' + JSON.stringify(got) + ', source has ' + JSON.stringify(sections));
  const line = (log.split('\n').find(l => /API plugins: /.test(l)) || '').replace(/^.*API plugins: /, '');
  const notLoaded = log.split('\n').filter(l => /API PLUGIN .* not loaded/.test(l)).map(l => l.trim());
  if (plugins.length) rec('6c the staged server prints "API plugins:" naming every plugin in app/api (' + plugins.length + ')', plugins.every(f => line.includes(f + ' (')) && !notLoaded.length,
    'line was "' + line.slice(0, 300) + '"' + (notLoaded.length ? '; ' + notLoaded.join('; ') : ''));
  else rec('6c app/api holds no plugin yet, so no "API plugins:" line is expected (and none is printed)', !line, line);
  if (line) console.log('     server printed: API plugins: ' + line.trim().slice(0, 400));
  srv.kill();
  // 7. the check itself can fail: break a copy of the stage three ways and each must be caught (no server needed)
  const P = path.join(T, 'pristine'); execFileSync('bash', [path.join(ROOT, 'stage-app.sh'), P]);   // always break a fresh good stage, never the one being checked
  const broken = (name, fn, want) => { const B = path.join(T, 'broken-' + name); cpTree(P, B); fn(B); const bad = checkFiles(B).filter(x => !x[1]).map(x => x[0].split(' ')[0]);
    rec('7' + name + ' the check goes red when ' + want.what, want.codes.every(c => bad.includes(c)), 'failed checks were: ' + (bad.join(', ') || 'none')); };
  const dirsAll = source.filter(x => x.dir && !x.rel.includes('/')).map(x => x.rel);
  broken('a', B => { fs.rmSync(path.join(B, 'api'), { recursive: true, force: true }); }, { what: 'the whole api folder is missing from the stage', codes: ['1', '3'] });
  broken('b', B => { const f = source.find(x => !x.dir && x.rel.startsWith('lib/') && x.rel.endsWith('.js')); fs.rmSync(path.join(B, f.rel)); }, { what: 'a .js file is missing from the stage', codes: ['2'] });
  broken('c', B => { const u = path.join(B, 'update.json'), j = JSON.parse(fs.readFileSync(u, 'utf8')); j.version = '1.0.11-test.apiX'; j.updateFeedUrl = 'https://example.invalid/feed/'; fs.writeFileSync(u, JSON.stringify(j)); }, { what: 'a -test version is staged with a non-blank feed', codes: ['5b'] });
  broken('d', B => { for (const n of ['lib/prod.local.json', 'lib/notes.bak', 'public/debug.log', 'api/live.env', 'api/My-Secret.js', 'lib/TokenStore.json', 'public/sections/PASSWORD.txt']) fs.writeFileSync(path.join(B, n), 'x'); }, { what: 'secret-looking files (*.local.json, *.bak, *.log, *.env, secret/token/password names) are staged', codes: ['4b'] });
  console.log(`build-stage-folders: ${pass}/${pass + fail} passed (source folders: ${dirsAll.join(', ')})`);
  fs.rmSync(T, { recursive: true, force: true }); process.exit(fail ? 1 : 0);
})();

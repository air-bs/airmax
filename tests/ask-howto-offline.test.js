// tools/build-howto.js runs FULLY OFFLINE: no network, no DNS, no Grok call, no key. Proof 1: the source requires only fs / path / vm and has no
// http / https / net / dns / fetch / child_process / env. Proof 2: run it as a child process (on a temp copy, and on the real tree with --check) with a
// preload that makes net, http, https, http2, tls, dns, dgram, fetch, WebSocket and child_process THROW and records every attempt, with no key in the env.
//   node tests/ask-howto-offline.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const REAL = path.join(__dirname, '..'), TOOL = path.join(REAL, 'tools', 'build-howto.js');
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const src = fs.readFileSync(TOOL, 'utf8').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n'); // code only: // comments dropped (the tool has no /* */ comments)
const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
rec('1 the tool requires only fs, path and vm', reqs.length > 0 && reqs.every(r => ['fs', 'path', 'vm'].includes(r)), reqs.join(', '));
const bad = [/\brequire\(\s*['"](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|worker_threads|cluster|undici)/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bimport\s*\(/, /process\.env/, /api\.x\.ai|console\.x\.ai|grok/i, /\bxai\b(?!-)/i, /\bhttps?:\/\//];
rec('2 no require of http / https / net / dns / child_process, no fetch, no WebSocket, no process.env, no Grok / xAI name or URL in the code', bad.every(re => !re.test(src)), bad.filter(re => re.test(src)).join(' '));
// the preload
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'howto-offline-')), pre = path.join(tmp, 'nonet.js'), log = path.join(tmp, 'attempts.log');
fs.writeFileSync(pre, `'use strict';
const fs = require('fs'), L = ${JSON.stringify(log)}; const hit = n => { try { fs.appendFileSync(L, n + '\\n'); } catch (e) {} throw new Error('NETWORK BLOCKED: ' + n); };
const wrap = (mod, names, label) => { for (const n of names) if (typeof mod[n] === 'function') mod[n] = function () { return hit(label + '.' + n); }; };
wrap(require('net'), ['connect', 'createConnection', 'createServer'], 'net'); require('net').Socket.prototype.connect = function () { return hit('net.Socket.connect'); };
wrap(require('http'), ['request', 'get', 'createServer'], 'http'); wrap(require('https'), ['request', 'get', 'createServer'], 'https'); wrap(require('http2'), ['connect', 'createServer', 'createSecureServer'], 'http2');
wrap(require('tls'), ['connect', 'createServer'], 'tls'); wrap(require('dgram'), ['createSocket'], 'dgram');
const dns = require('dns'); wrap(dns, ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse', 'lookupService'], 'dns'); wrap(dns.promises, ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse'], 'dns.promises');
wrap(require('child_process'), ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'], 'child_process');
globalThis.fetch = function () { return hit('fetch'); }; globalThis.WebSocket = function () { return hit('WebSocket'); }; globalThis.XMLHttpRequest = function () { return hit('XMLHttpRequest'); };
`);
const env = { PATH: process.env.PATH, HOME: tmp, NODE_OPTIONS: '--require ' + pre }; // no XAI_API_KEY, no GROK_*, no AIRMAX_*, nothing else
const run = (...a) => cp.spawnSync(process.execPath, [TOOL, ...a], { encoding: 'utf8', env });
// the preload itself works (a guard that guards nothing proves nothing)
const probe = cp.spawnSync(process.execPath, ['-e', "try { require('http').get('http://127.0.0.1:9/'); console.log('NOT BLOCKED'); } catch (e) { console.log('blocked: ' + e.message); } try { fetch('http://127.0.0.1:9/'); console.log('NOT BLOCKED'); } catch (e) { console.log('blocked: ' + e.message); }"], { encoding: 'utf8', env });
rec('3 the preload really blocks http and fetch (control run)', /blocked: NETWORK BLOCKED: http\.get/.test(probe.stdout) && /blocked: NETWORK BLOCKED: fetch/.test(probe.stdout) && !/NOT BLOCKED/.test(probe.stdout), probe.stdout.trim().replace(/\n/g, ' | '));
try { fs.unlinkSync(log); } catch (e) { /* none */ }
const copy = path.join(tmp, 'tree'), a = path.join(copy, 'app'); fs.mkdirSync(path.join(a, 'public'), { recursive: true });
for (const f of ['app.js', 'extras.js', 'topbar.js', 'settings.js']) fs.copyFileSync(path.join(REAL, 'app', 'public', f), path.join(a, 'public', f));
for (const f of ['shortcuts.json', 'update.json']) fs.copyFileSync(path.join(REAL, 'app', f), path.join(a, f));
fs.cpSync(path.join(REAL, 'app', 'howto'), path.join(a, 'howto'), { recursive: true });
const r1 = run('--root', copy), r2 = run('--root', copy, '--check'), r3 = run('--check');
rec('4 the update run succeeds with the network blocked and no key in the environment', r1.status === 0 && /updated in place/.test(r1.stdout) && !/BLOCKED|Error/.test(r1.stdout + r1.stderr), (r1.stdout + r1.stderr).split('\n')[0]);
rec('5 --check succeeds the same way (temp copy and the real tree)', r2.status === 0 && r3.status === 0 && /up to date/.test(r2.stdout) && /up to date/.test(r3.stdout), '');
rec('6 not one network, DNS or process attempt was made (the preload logged none)', !fs.existsSync(log), fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : 'no attempts');
rec('7 the environment had no key: nothing named like a key reached the process', !Object.keys(env).some(k => /KEY|TOKEN|SECRET|XAI|GROK|AIRMAX/i.test(k)), Object.keys(env).join(','));
const failing = (() => { fs.writeFileSync(path.join(a, 'howto', 'topics', 'how-zz.md'), '<!-- HAND-WRITTEN: x -->\n## x\nPress [Nope].\n'); const x = run('--root', copy); fs.unlinkSync(path.join(a, 'howto', 'topics', 'how-zz.md')); return x; })();
rec('8 a failing build is offline too (exit 1 with the message, no attempts)', failing.status === 1 && /\[Nope\] is not a button/.test(failing.stderr) && !fs.existsSync(log), '');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'all passed'); process.exit(fails.length ? 1 : 0);

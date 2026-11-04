// tools/build-howto.js is idempotent: a second run on the same tree changes ZERO files (not even a modified time), the output is byte-identical
// (version stamp included), and nothing in it depends on the clock, the time zone, the folder or the machine.
//   node tests/ask-howto-idempotent.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const REAL = path.join(__dirname, '..'), TOOL = path.join(REAL, 'tools', 'build-howto.js');
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'howto-idem-')), a = path.join(d, 'app'); fs.mkdirSync(path.join(a, 'public'), { recursive: true });
  for (const f of ['app.js', 'extras.js', 'topbar.js', 'settings.js']) fs.copyFileSync(path.join(REAL, 'app', 'public', f), path.join(a, 'public', f));
  for (const f of ['shortcuts.json', 'update.json']) fs.copyFileSync(path.join(REAL, 'app', f), path.join(a, f));
  fs.cpSync(path.join(REAL, 'app', 'howto'), path.join(a, 'howto'), { recursive: true }); return d; };
const run = (root, env, cwd) => cp.spawnSync(process.execPath, [TOOL, '--root', root], { encoding: 'utf8', env: { PATH: process.env.PATH, ...(env || {}) }, cwd: cwd || root });
const walk = (d, o = {}) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, o); else { const st = fs.statSync(f); o[path.relative(d.split(path.sep + 'app')[0], f)] = { sha: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'), mtime: st.mtimeMs, ino: st.ino, size: st.size }; } } return o; };
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const T = mk(), howto = path.join(T, 'app', 'howto'), tmps = [T];
// bring the copy to a built state, then run twice more
const r0 = run(T); const s1 = walk(howto); sleep(1200);
const r1 = run(T), s2 = walk(howto);
const changed = Object.keys({ ...s1, ...s2 }).filter(k => !s1[k] || !s2[k] || s1[k].sha !== s2[k].sha || s1[k].mtime !== s2[k].mtime || s1[k].ino !== s2[k].ino);
rec('1 the second run changes ZERO files (same bytes, same modified time, same inode; none added, none removed)', r0.status === 0 && r1.status === 0 && changed.length === 0 && Object.keys(s2).length > 80, Object.keys(s2).length + ' files' + (changed.length ? '; changed: ' + changed.slice(0, 5).join(', ') : ''));
rec('2 the second run says so: added 0, updated 0, removed 0, and the guide file "already up to date"', /added 0, updated 0, removed 0/.test(r1.stdout) && /airmax-howto\.md already up to date/.test(r1.stdout), r1.stdout.split('\n').slice(2, 5).join(' | '));
const g = fs.readFileSync(path.join(howto, 'airmax-howto.md'), 'utf8'), ver = JSON.parse(fs.readFileSync(path.join(T, 'app', 'update.json'), 'utf8')).version;
rec('3 the version stamp is in the guide and is the app version', g.startsWith('# AirMax how-to text (version ' + ver + ')\n'), g.split('\n')[0]);
const out1 = r0.stdout.replace(/\n\s+[+~-] .*/g, ''), out2 = r1.stdout;
rec('4 nothing in the guide or the generated files looks like a date or a time (no timestamps, no build number)', !/\b(19|20)\d\d-\d\d-\d\d\b|\b\d{1,2}:\d{2}(:\d{2})?\b|\b(GMT|UTC)\b|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b[ ,]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(g + Object.entries(s2).map(([k]) => (k.includes('generated') ? fs.readFileSync(path.join(T, k), 'utf8') : '')).join('')), '');
// 5. different clock / zone / folder / working folder / language: same bytes
const T2 = mk(); tmps.push(T2); run(T2, { TZ: 'Pacific/Auckland', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, os.tmpdir()); const A = walk(path.join(T2, 'app', 'howto'));
const T3 = mk(); tmps.push(T3); run(T3, { TZ: 'America/Los_Angeles', LANG: 'C' }, REAL); const B = walk(path.join(T3, 'app', 'howto'));
const bytesDiffer = Object.keys({ ...s2, ...A, ...B }).filter(k => !s2[k] || !A[k] || !B[k] || s2[k].sha !== A[k].sha || s2[k].sha !== B[k].sha);
rec('5 another time zone, language, folder and working folder give byte-identical guide and generated files', bytesDiffer.length === 0, bytesDiffer.slice(0, 5).join(', '));
// 6. the version stamp moves with the version, and then is stable again
const uj = path.join(T, 'app', 'update.json'), j = JSON.parse(fs.readFileSync(uj, 'utf8')); j.version = '9.8.7'; fs.writeFileSync(uj, JSON.stringify(j, null, 2) + '\n');
const sB = walk(howto); sleep(1100); const v1 = run(T); const sC = walk(howto); const v2 = run(T); const sD = walk(howto);
const moved = Object.keys(sC).filter(k => !sB[k] || sB[k].sha !== sC[k].sha);
rec('6 a new app version re-stamps ONLY the guide file (version 9.8.7); every other file is untouched', v1.status === 0 && moved.join() === path.relative(T, path.join(howto, 'airmax-howto.md')) && fs.readFileSync(path.join(howto, 'airmax-howto.md'), 'utf8').startsWith('# AirMax how-to text (version 9.8.7)'), moved.join(', '));
rec('6b ... and the run after that changes zero files again', v2.status === 0 && JSON.stringify(sC) === JSON.stringify(sD), '');
// 7. --check never writes
const before = walk(howto); sleep(1100); const ck = cp.spawnSync(process.execPath, [TOOL, '--root', T, '--check'], { encoding: 'utf8' }); rec('7 --check writes nothing', ck.status === 0 && JSON.stringify(walk(howto)) === JSON.stringify(before), '');
// 8. the REAL tree is already at its fixed point
const real = cp.spawnSync(process.execPath, [TOOL, '--check'], { encoding: 'utf8' }); rec('8 the real app/howto is already at the fixed point (--check passes)', real.status === 0, real.stdout.split('\n')[0]);
tmps.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'all passed'); process.exit(fails.length ? 1 : 0);

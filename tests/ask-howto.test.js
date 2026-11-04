// Ask AirMax how-to file (app/howto/airmax-howto.md, built by tools/build-howto.js from the app's own screens). Offline, no server.
//   node tests/ask-howto.test.js
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, 'app', 'howto', 'airmax-howto.md'), B = require('../tools/build-howto.js');
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const txt = fs.readFileSync(FILE, 'utf8'), r = B.build();
rec('1 the build has no errors (every [Button] and {Key} named in a topic exists on the real screen / shortcuts.json)', r.errors.length === 0, r.errors.join('; '));
rec('2 the file on disk is exactly what the build makes (reproducible; nothing hand-edited)', txt === r.text && B.build().text === r.text, '');
const chk = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-howto.js'), '--check'], { encoding: 'utf8' });
rec('3 tools/build-howto.js --check passes', chk.status === 0, (chk.stdout + chk.stderr).trim());
rec('4 size: under ' + B.MAX_BYTES + ' bytes', Buffer.byteLength(txt) < B.MAX_BYTES, Buffer.byteLength(txt) + ' bytes');
const missing = r.labels.filter(l => !txt.includes('[' + l + ']') && !txt.includes(l.toUpperCase()) && !txt.includes('- ' + l));
rec('5 every button, tab and settings tab on the screen is named in the file', missing.length === 0 && r.labels.length > 40, r.labels.length + ' names' + (missing.length ? '; missing ' + missing.join(', ') : ''));
const sc = []; (function w(x) { if (Array.isArray(x)) x.forEach(w); else if (x && typeof x === 'object') { if (x.key && x.action && !/^local:block/.test(x.action)) sc.push(x); Object.values(x).forEach(w); } })(JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'shortcuts.json'), 'utf8')));
const lostK = sc.filter(s => !txt.includes('{' + s.key + '}'));
rec('6 every shortcut in shortcuts.json is listed with its label', lostK.length === 0 && sc.length > 40, sc.length + ' keys' + (lostK.length ? '; missing ' + lostK.map(s => s.key).join(', ') : ''));
rec('7 no e-mail, phone/card-like number, key or file path in the file', !/[\w.+-]+@[\w-]+\.[\w.]+/.test(txt) && !/\d[\d\s().-]{8,}\d/.test(txt) && !/xai-[A-Za-z0-9]/.test(txt) && !/[A-Za-z]:\\|\/home\/|\/Users\/|\/tmp\//.test(txt), '');
rec('8 the version in the file is the app version', new RegExp('\\(version ' + JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'update.json'), 'utf8')).version.replace(/\./g, '\\.') + '\\)').test(txt), '');
const SYS = require('../app/api/ask-airmax.js').SYSTEM_RULES;
rec('9 the "Limits" part says what the helper cannot do; the fixed rules say it cannot press buttons and must answer NO_ANSWER when the text has no answer', /# Limits/.test(txt) && /(cannot|can't|never)/i.test(txt.split('# Limits')[1] || '') && /cannot press buttons/.test(SYS) && /NO_ANSWER/.test(SYS), '');
const sh = fs.readdirSync(path.join(ROOT, 'app', 'howto', 'topics')).length;
rec('10 the topic files are all in the built file (' + sh + ' topics)', fs.readdirSync(path.join(ROOT, 'app', 'howto', 'topics')).every(f => txt.includes(fs.readFileSync(path.join(ROOT, 'app', 'howto', 'topics', f), 'utf8').replace(/\r/g, '').trim().split('\n').filter(l => !/^<!--/.test(l))[0])), '');
console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'all passed'); process.exit(fails.length ? 1 : 0);

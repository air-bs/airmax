// nostore1103: the build's store-name guard (tools/stage-guard.sh, called by build.sh) must stop the build for EVERY spelling of a store's
// name, its order numbers, town, street address and phone (read from a private pattern file; here a MADE-UP store "Acme Toys 9" is used, the
// real words are never in this repo), in any case and in a binary file too, must still pass the allowed TestShop order mention, and build.sh
// must really call the guard. The order numbers and the password variable name are built from pieces so this file itself is not a hit.
// Run: node tests/stage-guard.test.js     (STAGE_GUARD_PORT, default 5392, only for the end-to-end build.sh cases)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), GUARD = path.join(ROOT, 'tools', 'stage-guard.sh');
let pass = 0, fail = 0;
const rec = (n, ok, d = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' — ' + d)); };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'stageguard-'));
const ro = 'R' + 'O', pwv = 'AIRMAX' + '_TEST_' + 'PW';
// made-up store: name, town, street, phone (these go into the private pattern file the guard reads)
const PRIVATE = path.join(T, 'private-patterns.txt');
fs.writeFileSync(PRIVATE, '# test patterns\nacme[ _-]?toys[ _-]?9\nacme[ _-]?for[ _-]?kids\nelm ?grove\n17 oak lane\n555-0142\n');
process.env.STAGE_GUARD_PRIVATE_FILE = PRIVATE;
const nm = ['Acme', 'Toys', '9'], nm2 = ['Acme', 'for', 'Kids'];
const SPELLINGS = {
  'name, one word': nm.join('').toLowerCase(), 'name, capitals': nm.join('').toUpperCase(), 'name, mixed case': 'AcmeToys9',
  'name, spaces': nm.join(' '), 'name, spaces, capitals': nm.join(' ').toUpperCase(), 'name, dashes': nm.join('-'), 'name, underscores': nm.join('_'),
  'name, as words, spaces': nm2.join(' '), 'name, as words, one word': nm2.join(''), 'name, as words, dashes': nm2.join('-'), 'name, as words, underscores': nm2.join('_'),
  'name, as words, mixed case': 'AcmeForKids',
  'order number': ro + '11088', 'order number, lower case': (ro + '11088').toLowerCase(), 'order number, any 5 digits': ro + '12345',
  'town, two words': 'Elm Grove', 'town, one word': 'Elmgrove', 'town, capitals': 'ELM GROVE',
  'street address': '17 Oak Lane', 'phone number': '555-0142', 'test secret name': pwv,
};
const run = (args, extra = {}) => spawnSync('bash', [GUARD, ...args], { encoding: 'utf8', env: { ...process.env, ...extra } });
const mk = (name, files) => { const d = fs.mkdtempSync(path.join(T, name + '-')); const stage = path.join(d, 'app'); fs.mkdirSync(stage, { recursive: true });
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(stage, f)), { recursive: true }); fs.writeFileSync(path.join(stage, f), c); }
  fs.writeFileSync(path.join(d, 'Read Me.txt'), (files['Read Me.txt'] || 'Air Max\r\n').toString()); return { stage, readme: path.join(d, 'Read Me.txt') }; };

// 1 a clean stage passes (also a word that only looks close: "ground", "robot 1234", "TestShop RO11052")
const clean = mk('clean', { 'a.js': "// plain comment\nconst x = 'ground 12345 robot';\n", 'lib/b.js': '// TestShop RO11052: a second gift card receive\n' });
let r = run([clean.stage, clean.readme]); rec('1 clean stage passes (exit 0, no output)', r.status === 0 && !r.stdout.trim(), r.stdout);
r = run([clean.stage, clean.readme]); rec('1b "TestShop RO11052" (the approved test order) is allowed', r.status === 0);
const both = mk('both', { 'a.js': '// TestShop RO11052 and also ' + ro + '11088\n' }); r = run([both.stage, both.readme]);
rec('1c a line with the allowed TestShop order AND another order number still stops', r.status === 1 && /11088/.test(r.stdout), r.stdout);
const other = mk('otherts', { 'a.js': '// TestShop ' + ro + '11053\n' }); r = run([other.stage, other.readme]);
rec('1d a different TestShop order number is NOT allowed (exact words only)', r.status === 1, r.stdout);

// 2 each spelling stops, in a js file, in a nested folder, in a json file, and in the Read Me
let n = 0;
for (const [label, sp] of Object.entries(SPELLINGS)) {
  n++;
  const a = mk('js' + n, { 'x.js': 'const a = 1; // note about ' + sp + ' here\n' }); r = run([a.stage, a.readme]);
  rec('2.' + n + ' ' + label + ' in a .js file stops the build', r.status === 1 && r.stdout.trim().length > 0, 'exit ' + r.status + ' ' + r.stdout);
  const b = mk('deep' + n, { 'public/sections/y.json': JSON.stringify({ k: sp }) }); r = run([b.stage, b.readme]);
  rec('2.' + n + 'b ' + label + ' in a nested .json stops the build', r.status === 1, 'exit ' + r.status);
  const c = mk('rd' + n, { 'a.js': '// ok\n', 'Read Me.txt': 'Air Max\r\n' + sp + '\r\n' }); r = run([c.stage, c.readme]);
  rec('2.' + n + 'c ' + label + ' in the Read Me stops the build', r.status === 1, 'exit ' + r.status);
}
// 3 binary file (NUL bytes around the text)
const bin = mk('bin', {}); fs.writeFileSync(path.join(bin.stage, 'tool.dll'), Buffer.concat([Buffer.from([0, 1, 2, 0, 255]), Buffer.from(SPELLINGS['name, one word']), Buffer.from([0, 0, 7])]));
r = run([bin.stage, bin.readme]); rec('3 a spelling inside a binary file stops the build', r.status === 1, 'exit ' + r.status);
// 4 output never prints more than 20 hits and the guard names the file
r = run([mk('many', Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['f' + i + '.js', '// ' + ro + '1108' + (i % 10) + '\n']))).stage]);
rec('4 output is capped at 20 lines and names the file', r.status === 1 && r.stdout.trim().split('\n').length === 20 && /f\d+\.js/.test(r.stdout), r.stdout.split('\n').length + ' lines');

// 5 build.sh really calls the guard (static) ...
const bs = fs.readFileSync(path.join(ROOT, 'build.sh'), 'utf8');
rec('5 build.sh calls tools/stage-guard.sh on the stage and the Read Me, and stops the build', /bash tools\/stage-guard\.sh "\$S" "pkg\/stage\/Read Me\.txt" \|\| \{[^}]*exit 1/.test(bs));
rec('5b build.sh keeps the First Choice allowlist', /FC_OK=/.test(bs) && /first \?choice/.test(bs));
rec('5c the guard still covers the test password variable name and reads the private pattern file', /AIRMAX_TES\[T\]_P\[W\]/.test(fs.readFileSync(GUARD, 'utf8')) && /STAGE_GUARD_PRIVATE_FILE/.test(fs.readFileSync(GUARD, 'utf8')));
// ... and end to end: build.sh in a copy of this tree stops at the guard (before the installer is made) for one spelling per family
const COPY = path.join(T, 'tree'); fs.mkdirSync(COPY);
const tar = spawnSync('bash', ['-c', `cd "${ROOT}" && tar --exclude=./.git --exclude=./screens --exclude=./docs --exclude=./pkg/out --exclude=./pkg/stage/app --exclude=./pkg/stage/node --exclude=./node_modules -cf - . | tar -xf - -C "${COPY}"`], { encoding: 'utf8' });
rec('6 copy of the tree for the end-to-end build.sh cases', tar.status === 0 && fs.existsSync(path.join(COPY, 'build.sh')), tar.stderr);
if (tar.status === 0) {
  const port = String(process.env.STAGE_GUARD_PORT || 5392), target = path.join(COPY, 'app', 'disclines.js'), orig = fs.readFileSync(target, 'utf8');
  const E2E = { 'name, one word': SPELLINGS['name, one word'], 'name, spaces, capitals': SPELLINGS['name, spaces, capitals'], 'name, as words, dashes': SPELLINGS['name, as words, dashes'],
    'order number': SPELLINGS['order number'], 'town': SPELLINGS['town, two words'], 'phone number': SPELLINGS['phone number'] };
  let k = 0;
  for (const [label, sp] of Object.entries(E2E)) {
    k++; fs.writeFileSync(target, orig + '\n// ' + sp + '\n');
    const b = spawnSync('bash', ['build.sh', '1.0.11'], { cwd: COPY, encoding: 'utf8', env: { ...process.env, STAGE_TEST_PORT: port }, timeout: 120000 });
    const out = (b.stdout || '') + (b.stderr || '');
    rec('7.' + k + ' build.sh stops with "dev/test strings found in stage" for ' + label, b.status === 1 && /dev\/test strings found in stage/.test(out) && !/Built pkg\/out/.test(out), 'exit ' + b.status + ' ' + out.slice(-300));
  }
  fs.writeFileSync(target, orig);
}
fs.rmSync(T, { recursive: true, force: true });
console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);

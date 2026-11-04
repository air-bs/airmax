// Ask AirMax how-to guide: tools/build-howto.js updates app/howto IN PLACE (hand-written topics kept; generated topics added / updated / removed;
// a topic naming a button or key that is not on the real screen FAILS the build). Works on a temp COPY of the tree: nothing real is changed.
//   node tests/ask-howto-merge.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const REAL = path.join(__dirname, '..'), B = require('../tools/build-howto.js'), TOOL = path.join(REAL, 'tools', 'build-howto.js');
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const mk = () => { // a private copy: just the files the build reads
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'howto-merge-')), a = path.join(d, 'app');
  fs.mkdirSync(path.join(a, 'public'), { recursive: true });
  for (const f of ['app.js', 'extras.js', 'topbar.js', 'settings.js']) fs.copyFileSync(path.join(REAL, 'app', 'public', f), path.join(a, 'public', f));
  for (const f of ['shortcuts.json', 'update.json']) fs.copyFileSync(path.join(REAL, 'app', f), path.join(a, f));
  fs.cpSync(path.join(REAL, 'app', 'howto'), path.join(a, 'howto'), { recursive: true });
  return d;
};
const run = (root, ...args) => { const r = cp.spawnSync(process.execPath, [TOOL, '--root', root, ...args], { encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr }; };
const H = root => path.join(root, 'app', 'howto'), rd = (root, ...p) => fs.readFileSync(path.join(H(root), ...p), 'utf8');
const gen = root => fs.readdirSync(path.join(H(root), 'generated')).sort();
const snap = root => { const o = {}; for (const sub of ['topics', 'generated']) for (const f of fs.readdirSync(path.join(H(root), sub))) o[sub + '/' + f] = rd(root, sub, f); o['airmax-howto.md'] = rd(root, 'airmax-howto.md'); o['contacts.json'] = rd(root, 'contacts.json'); return o; };
const edit = (root, rel, fn) => { const f = path.join(root, 'app', rel); const s = fs.readFileSync(f, 'utf8'), t = fn(s); if (s === t) throw new Error('edit did not change ' + rel); fs.writeFileSync(f, t); };
const clean = [];

// 1. the real tree: passes, and is already up to date
let r = run(REAL, '--check'); rec('1 the current tree passes --check (guide up to date, no stale name)', r.code === 0, r.out.split('\n')[0]);
const T = mk(); clean.push(T);
r = run(T); const s1 = snap(T); rec('2 a build on a copy of the current tree passes', r.code === 0 && /updated in place/.test(r.out), r.out.split('\n').slice(0, 3).join(' | '));
r = run(T); rec('3 running it again changes nothing (same bytes, 0 added / updated / removed)', r.code === 0 && /added 0, updated 0, removed 0/.test(r.out) && JSON.stringify(snap(T)) === JSON.stringify(s1), '');

// 4. hand-written topics are kept
const hand = fs.readdirSync(path.join(H(T), 'topics')).filter(f => /\.md$/.test(f)), mark = B.HAND_MARK;
rec('4 every hand-written topic is marked HAND-WRITTEN and the built guide holds its text', hand.length >= 20 && hand.every(f => rd(T, 'topics', f).split('\n')[0] === mark) && hand.every(f => { const first = rd(T, 'topics', f).split('\n').filter(l => !/^<!--/.test(l))[0]; return rd(T, 'airmax-howto.md').includes(first); }), hand.length + ' topics');
fs.appendFileSync(path.join(H(T), 'topics', 'how-drawer.md'), 'Extra hand-written line: ask a manager if unsure.\n');
fs.writeFileSync(path.join(H(T), 'topics', 'how-newjob.md'), mark + '\n## How do I do a new job?\n1. Press [Hold] {Ctrl+H}.\nSource: Checkout\n');
const before = { d: rd(T, 'topics', 'how-drawer.md'), n: rd(T, 'topics', 'how-newjob.md') };
r = run(T); const g = rd(T, 'airmax-howto.md');
rec('5 an edited hand-written topic and a NEW hand-written topic are kept byte for byte and appear in the guide', r.code === 0 && rd(T, 'topics', 'how-drawer.md') === before.d && rd(T, 'topics', 'how-newjob.md') === before.n && g.includes('Extra hand-written line') && g.includes('How do I do a new job?') && !g.includes('<!--'), '');
rec('5b a hand-written topic file with an unknown name (no how- / trouble- prefix) still reaches the guide', (() => { fs.writeFileSync(path.join(H(T), 'topics', 'notes-misc.md'), mark + '\n## A misc note\nSee [Hold].\nSource: Checkout\n'); const x = run(T); return x.code === 0 && rd(T, 'airmax-howto.md').includes('A misc note'); })(), '');

// 6. a new feature: a new generated topic is ADDED
edit(T, 'public/app.js', s => s.replace('  actions: [\n', "  actions: [\n    ['Zeta Test', 'Ctrl + 9', '', 'zeta-test'],\n"));
const g0 = gen(T); r = run(T);
rec('6 a new button in the app ADDS its generated topic (and nothing else is rewritten)', r.code === 0 && gen(T).length === g0.length + 1 && gen(T).includes('gen-button-zeta-test.md') && /added 1, updated 0, removed 0/.test(r.out) && rd(T, 'airmax-howto.md').includes('[Zeta Test]') && rd(T, 'generated', 'gen-button-zeta-test.md').startsWith(B.GEN_MARK), r.out.split('\n')[2]);
// 7. a changed feature: the generated topic is UPDATED
edit(T, 'public/app.js', s => s.replace("['Open Drawer', 'Ctrl + D'", "['Open Drawer', 'Ctrl + Shift + D'"));
const other = rd(T, 'generated', 'gen-button-hold.md'); r = run(T);
rec('7 a changed shortcut label UPDATES only that generated topic', r.code === 0 && /added 0, updated 1, removed 0/.test(r.out) && /updated gen-button-open-drawer\.md/.test(r.out) && rd(T, 'generated', 'gen-button-open-drawer.md').includes('Ctrl + Shift + D') && rd(T, 'generated', 'gen-button-hold.md') === other, r.out.split('\n').filter(l => /~/.test(l)).join(' '));
// 8. a feature that is gone: the generated topic is REMOVED (hand-written ones never are)
edit(T, 'public/app.js', s => s.replace("['Zeta Test', 'Ctrl + 9', '', 'zeta-test'],", '').replace(" ['Print Quote', 'Estimate · not a sale', '≡', 'quote'],", ''));
const handBefore = fs.readdirSync(path.join(H(T), 'topics')).sort(); r = run(T);
rec('8 a button removed from the app REMOVES its generated topic (Zeta Test and Print Quote gone from the folder and the guide)', r.code === 0 && !gen(T).includes('gen-button-zeta-test.md') && !gen(T).includes('gen-button-print-quote.md') && !/\[Zeta Test\]|\[Print Quote\]/.test(rd(T, 'airmax-howto.md')) && /removed 2/.test(r.out), r.out.split('\n')[2]);
rec('8b no hand-written topic was deleted or renamed by that', JSON.stringify(fs.readdirSync(path.join(H(T), 'topics')).sort()) === JSON.stringify(handBefore), '');

// 9. the guard: a topic naming a button / key that does not exist FAILS the build and writes nothing
const T2 = mk(); clean.push(T2); run(T2); const s2 = snap(T2);
fs.appendFileSync(path.join(H(T2), 'topics', 'how-drawer.md'), 'Then press [Fake Button] {F99} to finish.\n');
r = run(T2); const s2b = snap(T2); s2['topics/how-drawer.md'] = s2b['topics/how-drawer.md'];
rec('9 a topic naming a fake button and a fake key FAILS the build (exit 1) with a clear message naming the file, line and name', r.code === 1 && /how-to build FAILED/.test(r.err) && /how-drawer\.md line \d+: \[Fake Button\] is not a button, tab or setting on the real screen/.test(r.err) && /how-drawer\.md line \d+: \{F99\} is not a key in shortcuts\.json/.test(r.err), r.err.split('\n').slice(0, 4).join(' | '));
rec('9b a failed build writes nothing (guide, generated and contacts unchanged)', JSON.stringify(s2b) === JSON.stringify({ ...s2, 'topics/how-drawer.md': s2b['topics/how-drawer.md'] }), '');
r = run(T2, '--check'); rec('9c --check also fails on it', r.code === 1 && /Fake Button/.test(r.err), '');
// 10. a hand-written topic naming a button that has since been removed from the app also fails
const T3 = mk(); clean.push(T3); run(T3);
edit(T3, 'public/app.js', s => s.replace(" ['Print Quote', 'Estimate · not a sale', '≡', 'quote'],", ''));
fs.writeFileSync(path.join(H(T3), 'topics', 'how-quote.md'), mark + '\n## How do I print a quote?\n1. Press [Print Quote].\nSource: Checkout\n');
r = run(T3); rec('10 a topic that names a button the app no longer has FAILS the build', r.code === 1 && /how-quote\.md line 3: \[Print Quote\] is not a button/.test(r.err), r.err.split('\n')[1]);
fs.unlinkSync(path.join(H(T3), 'topics', 'how-quote.md')); r = run(T3); rec('10b ... and passes once the topic is removed again', r.code === 0, '');

// 11. contacts.json, foreign files, override, check
const T4 = mk(); clean.push(T4); const c0 = rd(T4, 'contacts.json');
run(T4); fs.writeFileSync(path.join(H(T4), 'contacts.json'), '{ not json at all'); run(T4);
rec('11 contacts.json is never read, rewritten or deleted (even a broken one is left exactly as it is)', rd(T4, 'contacts.json') === '{ not json at all', '');
fs.unlinkSync(path.join(H(T4), 'contacts.json')); r = run(T4); rec('11b a missing contacts.json is not created and does not fail the build', r.code === 0 && !fs.existsSync(path.join(H(T4), 'contacts.json')), '');
fs.writeFileSync(path.join(H(T4), 'generated', 'my-own-notes.md'), 'my own file, no marker\n'); fs.writeFileSync(path.join(H(T4), 'generated', 'gen-old-feature.md'), B.GEN_MARK + '\n## Button: [Old]\n');
r = run(T4); rec('12 a file in generated/ WITHOUT the marker is left alone (warned); one WITH the marker for a gone feature is removed', r.code === 0 && fs.existsSync(path.join(H(T4), 'generated', 'my-own-notes.md')) && !fs.existsSync(path.join(H(T4), 'generated', 'gen-old-feature.md')) && /my-own-notes\.md has no GENERATED marker/.test(r.err), '');
fs.writeFileSync(path.join(H(T4), 'topics', 'gen-keys.md'), mark + '\n## All keys\nMy own key list: {Ctrl+D} opens the drawer.\nSource: Keys\n'); r = run(T4);
rec('13 a hand-written topic with the same file name as a generated one wins (the generated one is dropped)', r.code === 0 && !gen(T4).includes('gen-keys.md') && rd(T4, 'airmax-howto.md').includes('My own key list') && !rd(T4, 'airmax-howto.md').includes('## All keys\n- {'), r.out.split('\n')[1]);
fs.writeFileSync(path.join(H(T4), 'topics', 'how-bad.md'), B.GEN_MARK + '\n## x\n'); r = run(T4); rec('14 a hand-written topic carrying the GENERATED marker is an error (so it can never be deleted by mistake)', r.code === 1 && /GENERATED marker: hand-written topics must not/.test(r.err), '');
fs.unlinkSync(path.join(H(T4), 'topics', 'how-bad.md'));
fs.appendFileSync(path.join(H(T4), 'topics', 'how-drawer.md'), 'Call me at 212 555 1234.\n'); r = run(T4); rec('15 a phone-like number in a topic fails the build', r.code === 1 && /looks like an email, number, key or path/.test(r.err), '');
const T5 = mk(); clean.push(T5); run(T5); r = run(T5, '--check'); rec('16 --check passes on an up-to-date tree', r.code === 0, '');
fs.unlinkSync(path.join(H(T5), 'generated', 'gen-button-hold.md')); r = run(T5, '--check'); rec('16b --check fails when a generated topic is missing, and changes nothing', r.code === 1 && /out of date/.test(r.err) && !fs.existsSync(path.join(H(T5), 'generated', 'gen-button-hold.md')), r.err.split('\n')[0]);
// 17. the real tree was not touched by any of this
r = cp.spawnSync('git', ['status', '--short', '--', 'app/howto'], { cwd: REAL, encoding: 'utf8' }); rec('17 the real app/howto folder is exactly what the build makes (nothing here wrote to it)', run(REAL, '--check').code === 0, '');
clean.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'all passed'); process.exit(fails.length ? 1 : 0);

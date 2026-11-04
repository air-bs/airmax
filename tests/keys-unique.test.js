// OWNER RULE (1.2.0): no two actions may share the same shortcut key anywhere in the app. This test FAILS THE BUILD
// (build.sh runs it first) when:
//   1. a key in app/shortcuts.json is bound to two different actions;
//   2. a hard-coded keydown handler in app/public/*.js uses a key that shortcuts.json gives to another action
//      (every hard-coded global key handler must be listed in HARD below, so new ones cannot slip in unnoticed);
//   3. a button shows a key that does not run that button's action (wrong or stale label);
//   4. an action button shows no key at all.
// Same action on two keys (F12 and Ctrl+C = payment) is fine. Keys inside one dialog (Enter, Ctrl+Enter = save) are local.
'use strict';
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'app'), PUB = path.join(APP, 'public');
const norm = c => c.replace(/\s*\+\s*(?=.)/g, '+').split('+').map(p => p.length === 1 ? p.toUpperCase() : p).join('+')
  .replace(/^(.*\+)?Del$/, '$1Delete').replace(/^(.*\+)?Esc$/, '$1Escape');
const fails = [], ok = m => console.log('PASS ' + m), bad = m => { fails.push(m); console.log('FAIL ' + m); };

// hard-coded global keydown handlers (file, regex that proves the handler is there, key, action)
const HARD = [
  ['pos.js', /e\.ctrlKey && e\.shiftKey && \(e\.key === 'Q'/, 'Ctrl+Shift+Q', 'exit'],
  ['pos.js', /e\.ctrlKey && !e\.shiftKey && \(e\.key === 'p'/, 'Ctrl+P', 'reprint'], // done screen: print this sale = reprint
  ['extras.js', /e\.code === 'NumpadAdd' \|\| e\.key === '\+'/, 'Ctrl++', 'zoom-in'],
  ['extras.js', /e\.code === 'NumpadSubtract' \|\| e\.key === '_'/, 'Ctrl+_', 'zoom-out'],
];
const ALLOW_GLOBAL = [ // global keydown listeners that are not actions
  /if \(!e\.altKey \|\| e\.ctrlKey \|\| e\.metaKey \|\| !modalOpen\(\)\) return;/, // dlgkeys.js: Alt+letter = a button inside an open window (checked below)
  /e\.key === 'F5' \|\| \(e\.ctrlKey && \['r', 'R', 'w', 'W'\]/, // stops the browser's own reload/close on F5, Ctrl+R, Ctrl+W
  /const d = document\.querySelector\('\.btdrop'\); if \(!d\) return;/, // settings.js: Up/Down/Enter/Esc only while a Buttons-tab dropdown is open
];

const map = new Map(); // key -> action
const bind = (key, action, where) => {
  const k = norm(key), a = map.get(k);
  if (a && a.action !== action) bad(`duplicate key ${k}: "${a.action}" (${a.where}) and "${action}" (${where})`);
  else if (!a) map.set(k, { action, where });
};
const sc = JSON.parse(fs.readFileSync(path.join(APP, 'shortcuts.json'), 'utf8')).keys;
for (const x of sc) bind(x.key, x.action, 'shortcuts.json');
for (const [f, re, key, action] of HARD) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  if (!re.test(src)) bad(`HARD list is stale: ${key} handler not found in ${f}`); else bind(key, action, f);
}
// any global keydown listener that is not in HARD/ALLOW is a new, unchecked binding
for (const f of fs.readdirSync(PUB).filter(f => f.endsWith('.js') && f !== 'shortcut-core.js')) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  const re = /(?:window|document)\.addEventListener\('keydown',[^\n]*(?:\n[^\n]*){0,3}/g; let m;
  while ((m = re.exec(src))) {
    const s = m[0]; if (!/e\.(ctrlKey|altKey|key ===|code ===)/.test(s)) continue;
    if (/AirposShortcuts|installAirposShortcuts/.test(s)) continue;
    if (HARD.some(h => h[0] === f && h[1].test(s)) || ALLOW_GLOBAL.some(r => r.test(s))) continue;
    if (/modalOpen\(\)|\$\('(pay|gm|ref|rd)/.test(s) && !/e\.ctrlKey/.test(s)) continue; // dialog-local keys
    bad(`unlisted global key handler in ${f}: ${s.split('\n')[0].slice(0, 120)} — add it to HARD in tests/keys-unique.test.js`);
  }
}
ok(`${map.size} keys, each bound to one action`);

// buttons: the key shown must run that button's action; every action button shows a key
const btn = /\[\s*'([^'\]]+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*(?:,\s*'([^']*)')?/g;
const ACTION = /^[a-z][a-z0-9-]*$/;
const NOKEY = new Set(['na', '']); // placeholders
const KEYLESS = new Set(['price-change', 'quote']); // store requests #23/#6 and #26 (Nov 2026): these two new left-column buttons are mouse/touch only on purpose (no new shortcut key, so shortcuts.json stays identical to the store's); NOT F4, which stays Item discount
let shown = 0;
for (const f of ['app.js', 'extras.js', 'side.js']) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  const lay = src.match(/(LAYOUT\s*=\s*\{[\s\S]*?\n\};|LAYOUT\.(?:actions|right)\.splice\([\s\S]*?\);)/g) || [];
  for (const blk of lay) {
    let m; btn.lastIndex = 0;
    while ((m = btn.exec(blk))) {
      const [, label, keyText, c3, c4] = m;
      const action = ACTION.test(c3) ? c3 : (c4 && ACTION.test(c4) ? c4 : null);
      if (!action || NOKEY.has(action)) continue;
      const k = (keyText.match(/((?:Ctrl|Shift|Alt)\s*\+\s*)*(F\d+|Del|Esc|Enter|[A-Z0-9,=+\-*]|−)(?=$|\s|·)/) || [])[0];
      if (!k) { if (KEYLESS.has(action)) continue; bad(`button "${label}" (${action}) shows no key`); continue; }
      const kk = norm(k.replace('−', '-')), b = map.get(kk); shown++;
      if (!b) bad(`button "${label}" shows ${kk} but no such shortcut exists`);
      else if (b.action !== action && !(action === 'qty-edit' && b.action === 'qty-star')) bad(`button "${label}" (${action}) shows ${kk}, which runs "${b.action}"`);
    }
  }
}
ok(`${shown} buttons checked against their keys`);

// dialog buttons (dlgkeys.js): Alt+letter only inside a window; never a letter that a global Alt key uses
{
  const src = fs.readFileSync(path.join(PUB, 'dlgkeys.js'), 'utf8');
  const skip = new Set((src.match(/DLG_SKIP = new Set\(\[([^\]]*)\]/) || [, ''])[1].match(/[A-Z0-9]/g) || []);
  const letters = (src.match(/DLG_LETTERS = '([A-Z0-9]+)'/) || [, ''])[1].split('').filter(c => !skip.has(c));
  if (!letters.length) bad('dlgkeys.js: DLG_LETTERS not found');
  for (const [k, v] of map) { const m = k.match(/^Alt\+([A-Z0-9])$/); if (m && letters.includes(m[1])) bad(`dialog letter Alt+${m[1]} is also the global key for "${v.action}"`); }
  if (letters.some(c => /[0-9]/.test(c))) bad('dialog letters must not use digits (Alt+digit = bulk items)');
  const bulk = (src.match(/BULK_KEYS = \[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g) || [];
  bulk.forEach((q, i) => { const b = map.get(norm('Alt+' + q.slice(1, -1))); if (!b || b.action !== 'bulk-' + (i + 1)) bad(`bulk item ${i + 1} key Alt+${q.slice(1, -1)} not in shortcuts.json`); });
  if (!map.has('Ctrl+B') || map.get('Ctrl+B').action !== 'sidebars') bad('Ctrl+B must toggle the sidebars');
  { const bb = map.get(norm('Alt+Backspace')); if (!bb || bb.action !== 'bulk-back') bad('1.0.5: Alt+Backspace must be bulk-back (Back to folders)'); } // the map is built from unique keys above, so no other entry uses it
  ok(`dialog buttons: Alt + ${letters.join('')} (never a global key); ${bulk.length} bulk keys; Ctrl+B = sidebars; Alt+Backspace = bulk-back`);
}
if (fails.length) { console.log(`${fails.length} key problem(s)`); process.exit(1); }
console.log('keys unique: OK');

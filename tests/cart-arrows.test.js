// Air Register 1.2.1: Up / Down in the scan box move the selected sale line. Unit checks (no browser):
// runs the real moveCartSel() from app/public/app.js against a tiny fake table, and checks the key guard in the scan box.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const fn = src.match(/function moveCartSel\(d\) \{[\s\S]*?\n\}/);
rec('moveCartSel() exists in app.js', !!fn, fn ? 'found' : 'missing');
const mk = n => Array.from({ length: n }, (_, i) => { const cl = new Set(i === 0 ? ['row', 'sel'] : ['row']); return { dataset: { row: String(i) }, scrolled: 0, classList: { toggle: (c, on) => on ? cl.add(c) : cl.delete(c), has: c => cl.has(c) }, scrollIntoView(o) { this.scrolled++; this.opt = o; } }; });
const run = (n, start, moves) => {
  const trs = mk(n); const ctx = { selectedRow: start, document: { querySelectorAll: s => s === '#cart tr.row' ? trs : [] }, res: [] };
  vm.createContext(ctx); vm.runInContext(fn[0] + ';for (const d of ' + JSON.stringify(moves) + ') res.push(moveCartSel(d));', ctx);
  return { sel: ctx.selectedRow, hi: trs.filter(t => t.classList.has('sel')).map(t => +t.dataset.row), trs, res: ctx.res };
};
let r = run(3, 0, [1]); rec('Down moves from line 1 to line 2', r.sel === 1 && r.hi.join() === '1', `selected ${r.sel}, highlighted [${r.hi}]`);
r = run(3, 2, [-1]); rec('Up moves from line 3 to line 2', r.sel === 1 && r.hi.join() === '1', `selected ${r.sel}, highlighted [${r.hi}]`);
r = run(3, 0, [-1, -1]); rec('Up on the top line stays on the top line', r.sel === 0 && r.hi.join() === '0', `selected ${r.sel}`);
r = run(3, 2, [1, 1, 1]); rec('Down on the bottom line stays on the bottom line', r.sel === 2 && r.hi.join() === '2', `selected ${r.sel}`);
r = run(3, null, [1]); rec('No line picked yet (null = line 1): Down goes to line 2', r.sel === 1, `selected ${r.sel}`);
r = run(0, null, [1, -1]); rec('Empty sale: nothing happens, selection stays empty, key not taken', r.sel === null && r.res.every(x => x === false), `selected ${r.sel}, returned [${r.res}]`);
r = run(4, 0, [1, 1]); rec('Exactly one line highlighted, and it is scrolled into view (nearest)', r.hi.length === 1 && r.trs[2].scrolled === 1 && r.trs[2].opt.block === 'nearest', `highlighted [${r.hi}]`);
const h = src.match(/\$\('scanInput'\)\.addEventListener\('keydown', e => \{\n\s*if \(\(e\.key === 'ArrowUp' \|\| e\.key === 'ArrowDown'\)[^\n]*\n([^\n]*)\n\s*return;/);
rec('Scan-box handler only takes plain Up/Down (no Ctrl/Alt/Shift/Meta)', h && /!e\.ctrlKey && !e\.altKey && !e\.shiftKey && !e\.metaKey/.test(h[0]), h ? 'guard present' : 'handler missing');
rec('Not while a window / payment screen / help is open, or before login / at clock-in', h && /S\.loggedIn/.test(h[1]) && /S\.mode !== 'clockin'/.test(h[1]) && /!modalOpen\(\)/.test(h[1]) && /__airpos_help/.test(h[1]), h ? h[1].trim().slice(0, 140) : '');
rec('Arrow keys never reach the Enter / Tab scan code (returns first)', h && src.indexOf(h[0]) < src.indexOf("if (e.key !== 'Enter' && e.key !== 'Tab') return;"), 'order ok');
rec('No new global key listener for arrows (only the scan box listens)', !/(window|document)\.addEventListener\('keydown'[^\n]*Arrow/.test(src), 'none');
rec('moveCartSel calls no server action (no act/api/refresh)', !/\b(act|api|refresh)\(/.test(fn[0]), 'local highlight only');
fs.writeFileSync(path.join(__dirname, 'cart-arrows-results.json'), JSON.stringify(out, null, 1));
const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);

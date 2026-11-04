// Air Register 1.2.1: Up / Down on the payment screen move between tender lines. Unit checks (no browser):
// runs the real arrow block from app/public/app.js (wireLines -> amount field keydown) with stand-in move/commit.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const m = src.match(/\n(\s*if \(\(e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'\) && !e\.ctrlKey[^\n]*\n[^\n]*\n[^\n]*\n\s*\})\n\s*\};/);
rec('Arrow block exists inside the amount-field keydown (wireLines)', !!m && src.indexOf(m[1]) > src.indexOf('function wireLines()') && src.indexOf(m[1]) < src.indexOf('async function commit()'), m ? 'found' : 'missing');
const LS = [[20], [10], [40], [50]];
const run = (hi, key, mods = {}, value = '7.5') => {
  const ctx = { hi, ls: LS, t: LS[hi][0], amounts: { 20: '', 10: '', 40: '', 50: '' }, moved: [], commits: 0, tenders: 0, prevented: false, scrolled: 0,
    inp: { value }, e: { key, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: false, preventDefault() { ctx.prevented = true; } } };
  ctx.move = to => { ctx.moved.push(to); ctx.hi = to; }; ctx.commit = () => ctx.commits++; ctx.api = () => ctx.tenders++; ctx.runQueue = () => ctx.tenders++;
  ctx.$ = id => id === 'payBody' ? { querySelector: () => ({ scrollIntoView: o => { ctx.scrolled++; ctx.opt = o; } }) } : null;
  vm.createContext(ctx); vm.runInContext('(function(){' + m[1] + '})()', ctx); return ctx;
};
let c = run(0, 'ArrowDown'); rec('Down on Credit Card goes to Cash', c.moved.join() === '1' && c.prevented, `moved to [${c.moved}]`);
c = run(2, 'ArrowUp'); rec('Up on Gift Card goes to Cash', c.moved.join() === '1', `moved to [${c.moved}]`);
c = run(0, 'ArrowUp'); rec('Up on the first line stays there (no wrap to the bottom)', c.moved.length === 0 && c.prevented, `moved [${c.moved}], key blocked ${c.prevented}`);
c = run(3, 'ArrowDown'); rec('Down on the last line stays there (no wrap to the top)', c.moved.length === 0 && c.prevented, `moved [${c.moved}]`);
c = run(1, 'ArrowDown', {}, '12.34'); rec('The typed amount is kept exactly as typed (not rounded, not changed)', c.amounts[10] === '12.34' && c.inp.value === '12.34' && c.amounts[20] === '' && c.amounts[40] === '', JSON.stringify(c.amounts));
c = run(1, 'ArrowDown'); rec('Arrow key never pays: no commit, no tender call', c.commits === 0 && c.tenders === 0, `commit ${c.commits}, tenders ${c.tenders}`);
c = run(1, 'ArrowDown'); rec('Browser default blocked (no caret move / number spinner)', c.prevented, String(c.prevented));
c = run(1, 'ArrowUp'); rec('Highlighted line scrolled into view (nearest)', c.scrolled === 1 && c.opt.block === 'nearest', `scrolled ${c.scrolled}`);
c = run(1, 'ArrowDown', { shift: true }); rec('Shift+Down is not taken', c.moved.length === 0 && !c.prevented, `moved [${c.moved}]`);
c = run(1, 'ArrowDown', { ctrl: true }); rec('Ctrl+Down is not taken', c.moved.length === 0 && !c.prevented, `moved [${c.moved}]`);
const wl = src.slice(src.indexOf('function wireLines()'), src.indexOf('async function commit()'));
rec('Quick-cash buttons, check number and gift card boxes have no arrow handling added', !/Arrow/.test((wl.match(/\$\('chkNo'\)\.onkeydown[^\n]*/) || [''])[0]) && !/Arrow/.test((wl.match(/\$\('gcNo'\)\.onkeydown[^\n]*/) || [''])[0]) && !/Arrow/.test((wl.match(/\.quick button\[data-v\][^\n]*/) || [''])[0]), 'unchanged');
rec('Enter and + lines unchanged from 1.2.0', /if \(e\.key === '\+' \|\| e\.code === 'NumpadAdd'\) \{ e\.preventDefault\(\); (?:const|let) rest = Math\.max\(0, round2\(amountLeft\(\) - \(typed\(\) - \(Number\(amounts\[t\]\) \|\| 0\)\)\)\);(?: if \(t === 40 && gift\.length\) rest = Math\.min\(rest, giftBal\(\)\);)? amounts\[t\] = rest \? rest\.toFixed\(2\) : ''; inp\.value = amounts\[t\]; updNums\(\); return; \}/.test(wl) && /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); amounts\[t\] = inp\.value; if \(PAY_ENTER_COMPLETES && typed\(\) > 0 && typedDue\(\) <= 0\.004\) return commit\(\); move\(hi \+ 1\); \}/.test(wl), 'same text');
rec('Arrow block calls no money code (commit/api/runQueue/updNums/round2)', m && !/\b(commit|api|runQueue|updNums|round2|amountLeft|typed)\(/.test(m[1]), 'none');
fs.writeFileSync(path.join(__dirname, 'pay-arrows-results.json'), JSON.stringify(out, null, 1));
const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);

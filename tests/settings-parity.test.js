// Air Register (AIR POS look): SETTINGS parity with the store Air Register (owner rule: same settings, defaults and
// settings-screen options; only the look and identity differ). Store reference is read-only, copied to a temp folder.
// Default reference: /workspace/air-register-1.2.3-release (store 1.2.3, published Oct 29).
// Ports: ours 5180, store copy 5186. No browser.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn, execFileSync } = require('child_process');
const STORE = process.env.STORE_SRC || '/workspace/air-register-1.2.3-release';
const OURS = path.join(__dirname, '..'), P_OURS = Number(process.env.PARITY_OURS_PORT || 5180), P_STORE = Number(process.env.STORE_PARITY_PORT || 5186);
// Known, approved identity differences (NOT settings): Remote Help tab body (RustDesk belongs to the store app).
// AirMax Batch 1 (Gordon OK Nov 3, via the parent): the Settings left section menu. Allowed: the block between the `AirMax Batch 1 begin/end` comments in settings.js
// (menu data, styles, six new section builders) and the two functions that draw the page, stDecorate and settingsPage. No setting, default or shortcut changes.
const ALLOWED_FN_DIFF = { 'settings.js': ['remoteTab', 'stDecorate', 'settingsPage'] };
const noAb1 = src => src.replace(/\/\/ -{10} AirMax Batch 1 begin[\s\S]*?\/\/ -{10} AirMax Batch 1 end -{10}\n/, '');
// AirMax 1.0.5 (Ari OK 10:46 PM ET Oct 29): bulk item FOLDERS ship in AirMax first; AirRegister gets the same feature from Coach
// (PLAN-airregister-bulk-folders.md, spec airpos-look-backups/bulk-folders-for-coach.md). Until the store reference has it, these are the
// ONLY allowed differences: the tagged `// bf105+` lines in saveSettings, the one Alt+Backspace "bulk-back" shortcut, and the two new
// settings keys bulkFolders / bulkOrder (empty on a fresh install). Everything else must still be identical.
const BF105_SHORTCUT = 'bulk-back', BF105_KEYS = ['bulkFolders', 'bulkOrder'];
const noBf105 = src => src.split('\n').filter(l => !/\/\/ bf105\+/.test(l)).join('\n');
const noBf105Keys = j => { if (Array.isArray(j)) return j.filter(x => !(x && x.action === BF105_SHORTCUT)).map(noBf105Keys); if (j && typeof j === 'object') { const o = {}; for (const k of Object.keys(j)) o[k] = noBf105Keys(j[k]); return o; } return j; };
// AirMax Print Label (Ari OK 2:30 PM ET Oct 30): AirMax-only label printing. Allowed differences: the tagged `// pl+` lines in
// settings.js (the Labels tab) and the two new shortcuts Ctrl+Shift+P print-label / Ctrl+8 settings-labels. Nothing else.
const PL_SHORTCUTS = ['print-label', 'settings-labels'];
const noPl = src => src.split('\n').filter(l => !/\/\/ pl\+/.test(l)).join('\n');
const noPlKeys = j => { if (Array.isArray(j)) return j.filter(x => !(x && PL_SHORTCUTS.includes(x.action))).map(noPlKeys); if (j && typeof j === 'object') { const o = {}; for (const k of Object.keys(j)) o[k] = noPlKeys(j[k]); return o; } return j; };
// Temporary Item (Ari 11:05 PM ET Oct 31): the F7 label says "Temporary Item" (store: "Open Item"). Same key, same action; only the words.
const TI_LABEL = ['Temporary Item: type a price (name optional), Enter adds it', 'Open Item: type a price (name optional), Enter adds it'];
const tiLabel = j => { if (Array.isArray(j)) return j.map(tiLabel); if (j && typeof j === 'object') { const o = {}; for (const k of Object.keys(j)) o[k] = k === 'label' && j[k] === TI_LABEL[0] && j.action === 'open-item' ? TI_LABEL[1] : tiLabel(j[k]); return o; } return j; };
// 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31, local only): allowed differences are the tagged `// sola109+` lines in settings.js
// (the Cards tab), its one checkbox id="seSola", the Ctrl+9 settings-cards shortcut and the per-store solaCards key (absent on a fresh install).
const SOLA_SHORTCUTS = ['settings-cards'], SOLA_TOKENS = ['id="seSola"'];
const noSola = src => src.split('\n').filter(l => !/\/\/ sola109\+$/.test(l)).join('\n');
const noSolaKeys = j => { if (Array.isArray(j)) return j.filter(x => !(x && SOLA_SHORTCUTS.includes(x.action))).map(noSolaKeys); if (j && typeof j === 'object') { const o = {}; for (const k of Object.keys(j)) o[k] = noSolaKeys(j[k]); return o; } return j; };
// 1.0.10-local.2 (Ari 12:16 auto print, 12:22 stock warning, 11:xx Check printers; work copy, local only): allowed differences are
// the Ctrl+Alt+P reprint-gift shortcut, and in settingsDialog the two "Print receipt after every sale / return" selects, the
// "Warn before selling below zero stock" checkbox (seSW/seSWnote), the Check printers button (seChk) and the new auto-print note.
// L2_SD maps each exact local.2 text back to the store text; anything else must still be identical.
// 1.0.11 instant scan (Gordon, approved for 1.0.11): one AirMax-only setting, Settings > Printer & Drawer "Instant scan" (OFF by default).
// It is NOT a register setting: it lives in its own file (DATA/instant-scan.json), its switch is drawn by public/instant.js, and loadSettings /
// saveSettings / settingsDialog / settings.js are unchanged, so the comparisons below see no difference. Allowed difference, by approval.
const INSTANT_TOGGLE = { file: 'public/instant.js', id: 'seIS', default: false };
const L2_SHORTCUTS = ['reprint-gift'], L2_TOKENS = ['id="seSW"', 'id="seSWnote"', 'id="seChk"'];
const noL2Keys = j => { if (Array.isArray(j)) return j.filter(x => !(x && L2_SHORTCUTS.includes(x.action))).map(noL2Keys); if (j && typeof j === 'object') { const o = {}; for (const k of Object.keys(j)) o[k] = noL2Keys(j[k]); return o; } return j; };
const L2_SD = [
  [/\n    <label class="f">Print receipt after every sale<\/label>\$\{sel\('seAP', .*\n    <label class="f">Print receipt after every return<\/label>\$\{sel\('seAPR', .*\n    <label class="f chk"[^\n]*id="seSW"[^\n]*\n    <p class="note" id="seSWnote">[^\n]*/, ''],
  ['. Receipts print by themselves after each sale and return (Print receipt after every sale / return above, this PC). "Follow the AIR POS terminal setting" uses the AIR POS back office terminal settings. Each sale prints once.</p>', '. Auto print is switched on or off in AIR POS back office (terminal settings).</p>'],
  ['<button class="pbtn s" id="seChk">Check printers</button>', ''],
  [" receiptAutoPrint: $('seAP').value, returnReceiptAutoPrint: $('seAPR').value, stockWarn: $('seSW').checked,", ''],
  ["\n    $('seChk').onclick = () => printerCheckDialog();", ''],
];
const noL2Sd = src => L2_SD.reduce((t, [a, b]) => t.replace(a, () => b), src);
// 1.0.11-local.8 Temporary Item Taxable switch (Ari OK 6:26 PM ET Nov 1, TestShop only): allowed differences are, in the Returns tab,
// the "Temporary Item tax" picker (seTT / seTTi), the two lines that fill it from AIR POS, and the Save button also saving the pick.
// TT_SS maps each exact new text back to the store text; anything else must still be identical.
const TT_TOKENS = ['id="seTT"', 'id="seTTi"'];
const TT_SS = [
  [/\n    <label class="f">Temporary Item tax \(used when Taxable is on\)[^\n]*<small id="seTTi"><\/small>/, ''],
  [/\n    \/\/ 1\.0\.11-local\.8: which AIR POS tax a Taxable Temporary Item gets[^\n]*\n    api\('temp-tax'\)[^\n]*/, ''],
  ["let x = await api('settings', { refundTaxNoReceipt: $('seRT').checked, returnToAccount: $('seRA').checked }); if (x.ok && $('seTT') && $('seTT').options.length > 1) x = await api('temp-tax-set', { id: $('seTT').value });", "const x = await api('settings', { refundTaxNoReceipt: $('seRT').checked, returnToAccount: $('seRA').checked });"],
];
const noTt = src => TT_SS.reduce((t, [a, b]) => t.replace(a, () => b), src);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const rd = (root, f) => fs.readFileSync(path.join(root, 'app', f), 'utf8');
const fnText = (src, name) => { const i = src.search(new RegExp('(async )?function ' + name + '\\(')); if (i < 0) return null; const j = src.indexOf('\n}\n', i); return src.slice(i, j < 0 ? undefined : j + 3); };
const stripFns = (src, names) => { for (const n of names) { const t = fnText(src, n); if (t) src = src.replace(t, `/*${n}*/\n`); } return src; };
const tokens = src => new Set([...src.matchAll(/id="(se|st)[A-Za-z0-9_]*"|<option value="[^"$]*"|data-tab="[^"]*"/g)].map(m => m[0]));
const keyDiff = (a, b) => { const k = new Set([...Object.keys(a), ...Object.keys(b)]); return [...k].filter(x => JSON.stringify(a[x]) !== JSON.stringify(b[x])); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'look-setparity-store-'));
fs.mkdirSync(path.join(tmp, 'tests'));
execFileSync('cp', ['-a', path.join(STORE, 'app'), path.join(tmp, 'app')]);
for (const d of ['logs', 'journal']) fs.rmSync(path.join(tmp, 'app', d), { recursive: true, force: true });
for (const f of ['settings.json', 'aside.json', 'notes.json', 'drawer-log.json']) fs.rmSync(path.join(tmp, 'app', f), { force: true });
fs.copyFileSync(path.join(STORE, 'tests', 'fake-server.js'), path.join(tmp, 'tests', 'fake-server.js'));
const kids = [];
const boot = (dir, port) => { const c = spawn(process.execPath, ['tests/fake-server.js'], { cwd: dir, env: { ...process.env, FAKE_PORT: String(port) }, stdio: 'ignore' }); kids.push(c); };
const mk = port => { const B = 'http://127.0.0.1:' + port; return { post: (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), state: () => fetch(B + '/api/state').then(r => r.json()) }; };
const up = async a => { for (let i = 0; i < 40; i++) { try { await a.state(); return true; } catch { await sleep(250); } } return false; };
(async () => {
  let code = 1;
  try {
    console.log('store reference: ' + STORE);
    // 1. static: defaults and settings screen
    const pd = r => require(path.join(r, 'app/lib/printing.js')).PRINTER_DEFAULTS;
    const d1 = keyDiff(pd(OURS), pd(tmp)); rec('Printer/receipt setting defaults (PRINTER_DEFAULTS) are identical', !d1.length, d1.length ? 'differ: ' + d1.join(', ') : Object.keys(pd(OURS)).length + ' keys');
    const ld = r => (fnText(rd(r, 'lib/register.js'), 'loadSettings') || (rd(r, 'lib/register.js').match(/loadSettings\(\) \{[\s\S]*?\n  \}/) || [''])[0]);
    rec('Register setting defaults (loadSettings) are identical', ld(OURS) && ld(OURS) === ld(tmp), '');
    const sv = r => (rd(r, 'lib/register.js').match(/saveSettings\(b = \{\}\) \{[\s\S]*?\n  \}/) || [''])[0];
    rec('Which settings can be saved and who may change them (saveSettings) is identical (apart from the 1.0.5 bulk-folder lines)', sv(OURS) && noBf105(sv(OURS)) === sv(tmp), (sv(OURS).match(/\/\/ bf105\+/g) || []).length + ' bf105 lines set aside');
    const sc = JSON.stringify(noL2Keys(tiLabel(noSolaKeys(noPlKeys(noBf105Keys(JSON.parse(rd(OURS, 'shortcuts.json')))))))) === JSON.stringify(JSON.parse(rd(tmp, 'shortcuts.json')));
    rec('Keyboard shortcuts (shortcuts.json) are identical (apart from the 1.0.5 Alt+Backspace bulk-back, the Print Label keys, the Sola Cards key, the Temporary Item label and the 1.0.10-local.2 Ctrl+Alt+P gift receipt)', sc, '');
    const sd = noL2Sd((fnText(rd(OURS, 'public/app.js'), 'settingsDialog') || '').replace(/Air Max/g, 'Air Register')) || null, // shown name only (rename, Ari OK 4:17 PM ET Oct 30)
      sd2 = fnText(rd(tmp, 'public/app.js'), 'settingsDialog');
    rec('Settings screen: printer / drawer / receipt dialog (settingsDialog) is identical (apart from the 1.0.10-local.2 auto print, stock warning and Check printers lines)', sd && sd === sd2, sd ? sd.length + ' chars' : 'not found');
    const ss = stripFns(noTt(noSola(noPl(noAb1(rd(OURS, 'public/settings.js'))))), ALLOWED_FN_DIFF['settings.js']), ss2 = stripFns(rd(tmp, 'public/settings.js'), ALLOWED_FN_DIFF['settings.js']);
    rec('Settings screen tabs (settings.js) identical apart from the Remote Help tab body, the tagged Labels tab lines and the 1.0.11-local.8 Temporary Item tax picker', ss === ss2, ss === ss2 ? '' : 'settings.js differs outside remoteTab');
    const t1 = tokens(rd(OURS, 'public/app.js') + rd(OURS, 'public/settings.js') + rd(OURS, 'public/extras.js')), t2 = tokens(rd(tmp, 'public/app.js') + rd(tmp, 'public/settings.js') + rd(tmp, 'public/extras.js'));
    const miss = [...t2].filter(x => !t1.has(x)), extra = [...t1].filter(x => !t2.has(x) && !SOLA_TOKENS.includes(x) && !L2_TOKENS.includes(x) && !TT_TOKENS.includes(x));
    rec('Same settings fields and option values on screen', !miss.length && !extra.length, `${t1.size} tokens` + (miss.length ? '; missing ' + miss.join(' ') : '') + (extra.length ? '; extra ' + extra.join(' ') : ''));
    const cc = (r) => { const c = JSON.parse(rd(r, 'config.customer.json')); delete c.port; return c; };
    rec('Customer config identical apart from the port', JSON.stringify(cc(OURS)) === JSON.stringify(cc(tmp)), '');
    // 2. runtime: the settings the server reports after login on a fresh install
    boot(OURS, P_OURS); boot(tmp, P_STORE);
    const A = mk(P_OURS), S = mk(P_STORE);
    rec('Both offline fake servers start (ours ' + P_OURS + ', store copy ' + P_STORE + ')', await up(A) && await up(S), '');
    for (const x of [A, S]) await x.post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const [a, s] = [(await A.state()).settings || {}, (await S.state()).settings || {}];
    const bfFresh = BF105_KEYS.every(k => Array.isArray(a[k]) && a[k].length === 0); for (const k of BF105_KEYS) if (!(k in s)) delete a[k];
    const d2 = keyDiff(a, s);
    rec('Fresh-install settings reported by the server: same keys and values (+ empty 1.0.5 bulkFolders/bulkOrder)', Object.keys(a).length > 5 && !d2.length && bfFresh, d2.length ? 'differ: ' + d2.join(', ') : Object.keys(a).length + ' keys; bulkFolders/bulkOrder empty ' + bfFresh);
    code = out.every(o => o.pass) ? 0 : 1;
  } catch (e) { rec('settings parity run', false, e.message); }
  finally { for (const k of kids) k.kill(); await sleep(500); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(`${out.filter(o => o.pass).length}/${out.length} passed`); process.exit(code);
})();

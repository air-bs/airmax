// AirMax API batch 1 (calls 11, 12, 14-19): lookup lists + terminal settings (read, and the one save, call 12). Starts its OWN fake AIR POS server (offline, made-up data).
//   node tests/api-1-lookups.test.js     (ports: API1_PORT default 5215 (+hook 5216); cashier run on +2 (+hook +3))
'use strict';
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const PORT = Number(process.env.API1_PORT || 5215), HOOK = PORT + 1, PORT2 = PORT + 2, HOOK2 = PORT + 3;
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api1-'));
const mk = (port, hook, env) => { const log = path.join(T, 'srv' + port + '.log'); const c = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(port), FAKE_HOOK_PORT: String(hook), ...env }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] }); return { c, log, base: 'http://127.0.0.1:' + port, hook: 'http://127.0.0.1:' + hook }; };
const post = (s, r, x) => fetch(s.base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = s => fetch(s.hook + '/lookups-state').then(r => r.json());
const up = async s => { for (let i = 0; i < 40; i++) { try { await fetch(s.base + '/api/shortcuts'); return true; } catch (e) { await sleep(250); } } return false; };
const ROUTES = ['lookup-tax-kinds', 'lookup-payment-types', 'lookup-sub-payment-types', 'lookup-origins', 'lookup-categories', 'lookup-regions', 'lookups-all', 'terminal-config-get', 'settings-access'];
(async () => {
  const A = mk(PORT, HOOK, {}), B = mk(PORT2, HOOK2, { FAKE_CASHIER: '1' });
  try {
    rec('0 both fake servers start', (await up(A)) && (await up(B)));
    const L = () => fs.readFileSync(A.log, 'utf8');
    rec('1 the plugin loads with its 11 routes (9 reads, store-settings-get, the one save) (logged once, no error line)', /API plugins:[^\n]*lookups\.js \(11 routes\)/.test(L()) && !/API PLUGIN lookups\.js/.test(L()), (L().match(/API[^\n]*/g) || []).join(' || ').slice(0, 200));
    const nl = await post(A, 'lookups-all'); rec('2 logged out: every route answers Not logged in (needLogin)', nl.ok === false && nl.loggedOut === true && (await Promise.all(ROUTES.map(r => post(A, r)))).every(x => x.ok === false && x.loggedOut === true), JSON.stringify(nl));
    await post(A, 'login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post(B, 'login', { company: 'fake shop', user: 'cashier', password: process.env.AIRMAX_TEST_PW || 'x' });

    const tx = await post(A, 'lookup-tax-kinds');
    rec('3 call 14 tax kinds: bare array -> rows { id, name, rate, taxFree, sort }, in sort order', tx.ok && tx.count === 2 && tx.rows[0].name === 'Sales Tax' && tx.rows[0].rate === 8 && tx.rows[0].taxFree === false && tx.rows[1].taxFree === true, JSON.stringify(tx).slice(0, 220));
    const pt = await post(A, 'lookup-payment-types');
    rec('4 call 15 payment types: the server answers HTTP 404 (as TestShop does) -> ok:true, available:false, no rows, a plain message', pt.ok === true && pt.available === false && pt.count === 0 && /does not offer/.test(pt.message), JSON.stringify(pt));
    const sp = await post(A, 'lookup-sub-payment-types');
    rec('5 call 16 sub payment types: { 10: [], 20: [], 30: [] } -> byType with the three keys, count 0', sp.ok && ['10', '20', '30'].every(k => Array.isArray(sp.byType[k]) && sp.byType[k].length === 0) && sp.count === 0, JSON.stringify(sp));
    const og = await post(A, 'lookup-origins');
    rec('6 call 17 origins: rows { key, name, code }', og.ok && og.count === 3 && og.rows[1].name === 'Argentina' && og.rows[1].code === 'AR' && og.rows[0].key === 'AA001', JSON.stringify(og).slice(0, 200));
    const ct = await post(A, 'lookup-categories');
    const dolls = ct.flat && ct.flat.find(x => x.label === 'Dolls'), dc = ct.flat && ct.flat.find(x => x.label === 'Doll clothes');
    rec('7 call 18 category tree: 2 top, 5 in all, flat list has depth + "A > B > C" path, disabled flag kept', ct.ok && ct.top === 2 && ct.count === 5 && dolls && dolls.disable === true && dolls.depth === 1 && dc && dc.depth === 2 && dc.path === 'Made-up Toys > Dolls > Doll clothes' && ct.tree[0].childs[1].childs[0].label === 'Doll clothes', JSON.stringify(ct.flat && ct.flat.map(x => x.path)));
    const rg = await post(A, 'lookup-regions');
    rec('8 call 19 regions (baseserv): default type 2 + US -> 3 states with code / stateCode', rg.ok && rg.type === 2 && rg.countryCode === 'US' && rg.count === 3 && rg.rows[2].name === 'New York' && rg.rows[2].stateCode === 'NY', JSON.stringify(rg).slice(0, 200));
    const rg2 = await post(A, 'lookup-regions', { type: 9, countryCode: 'USA; drop' }), rg3 = await post(A, 'lookup-regions', { type: 2, countryCode: 'ca' });
    const st1 = await state(A);
    rec('9 regions input is checked: a bad type / country falls back to 2 / US; a lower-case country is upper-cased; an empty answer is ok with 0 rows', rg2.type === 2 && rg2.countryCode === 'US' && rg3.ok && rg3.countryCode === 'CA' && rg3.count === 0 && st1.regionBodies.length === 3 && st1.regionBodies[1].countryCode === 'US' && st1.regionBodies[2].countryCode === 'CA', JSON.stringify(st1.regionBodies));
    const tc = await post(A, 'terminal-config-get');
    rec('10 call 11 terminal settings: 7 switches + printer + shortcuts; whole record kept for the later save; all-zero station = registerStation false', tc.ok && tc.settings.checkoutAutoPrint === true && tc.settings.useVirtualKeyboard === false && tc.settings.soundAlerts === true && tc.settings.printerName === 'Made-up Receipt Printer' && tc.settings.shortcuts === '' && tc.config && tc.config.id === 'tc-1' && tc.registerStation === false, JSON.stringify(tc.settings));
    const all = await post(A, 'lookups-all');
    rec('11 lookups-all: the six lists in one answer, no errors', all.ok && ['taxKinds', 'paymentTypes', 'subPaymentTypes', 'origins', 'categories', 'regions'].every(k => all[k] && all[k].ok) && Object.keys(all.errors).length === 0 && all.regions.count === 3 && all.paymentTypes.available === false, Object.keys(all).join());
    const ac = await post(A, 'settings-access');
    rec('12 settings-access (fake login = super admin + RetailManager): canView / canChange true, via "super admin"', ac.ok && ac.canView === true && ac.canChange === true && ac.via === 'super admin' && ac.superAdmin === true, JSON.stringify(ac));
    const acB = await post(B, 'settings-access'), tcB = await post(B, 'lookup-regions');
    rec('13 a cashier login (not super admin, no RetailManager): settings-access says no; the plain lists (regions for the customer form) still read', acB.ok && acB.canView === false && acB.canChange === false && acB.via === '' && acB.manager === false && tcB.ok && tcB.count === 3, JSON.stringify(acB));
    await fetch(A.hook + '/lookups-fail?on=1');
    const bad = await Promise.all(['lookup-tax-kinds', 'lookup-origins', 'lookup-categories', 'lookup-regions', 'terminal-config-get', 'lookup-payment-types'].map(r => post(A, r))), badAll = await post(A, 'lookups-all');
    await fetch(A.hook + '/lookups-fail?on=0');
    rec('14 AIR POS down / timeout: every route answers ok:false with a plain message (never a stack, never a thrown error); lookups-all lists each failure', bad.every(x => x.ok === false && /Network error/.test(x.message) && x.unreachable === true) && badAll.ok === true && Object.keys(badAll.errors).length === 6, JSON.stringify(bad[0]));
    const again = await post(A, 'lookup-tax-kinds'); rec('15 and it recovers when AIR POS is back', again.ok && again.count === 2);
    const st = await state(A);
    rec('16 until a save is asked for, RetailTerminalConfigSave was never called (0 save calls) and each read hit its own AIR POS path', st.saveCalls === 0 && ['/Commons/RetailTerminalConfigGet', '/Commons/RetailTaxKindSelect', '/Commons/RetailOrderPaymentTypeSelect', '/Commons/RetailOrderSubPaymentTypeSelect', '/Commons/ProductOriginSelect', '/Categories/CategorySelectAsTreeNode', '/Regions/RegionSelect'].every(p => st.calls[p] > 0), JSON.stringify(st.calls));
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'lookups.js'), 'utf8'), code = src.replace(/^\s*\/\/.*$/gm, '');
    rec('17 the plugin source has ONE write: a single reg.api.submit to RetailTerminalConfigSave (nothing else is sent, no other save path) and never logs', (code.match(/\.submit\(/g) || []).length === 1 && /api\.submit\('\/Commons\/RetailTerminalConfigSave'/.test(code) && !/log\(/.test(code), '');
    const sec = await fetch(A.base + '/api/sections').then(r => r.json());
    rec('19 the section file is listed by /api/sections', Array.isArray(sec.files) && sec.files.includes('lookups.js'), JSON.stringify(sec));
    const js = await fetch(A.base + '/sections/lookups.js').then(r => r.text());
    rec('20 the section file does NOT register the Settings tab (the old Settings dialog stays) and adds no Checkout button', !/AirMaxSections\.register/.test(js.replace(/^\s*\/\/.*$/gm, '')) && !/checkout\.tx-actions/.test(js.replace(/^\s*\/\/.*$/gm, '')) && /AirMaxMounts\.add\('settings\.store\.terminal'/.test(js), '');
    // ---- call 12: save the terminal switches ----
    await fetch(A.hook + '/lookups-reset'); await fetch(B.hook + '/lookups-reset');
    const SW = ['checkoutAutoPrint', 'returnAutoPrint', 'autoOpenCashDrawer', 'useVirtualKeyboard', 'cashCheckoutConfirm', 'soundAlerts'];
    const s1 = await post(A, 'terminal-config-save', { useVirtualKeyboard: true, soundAlerts: false }), g1 = await post(A, 'terminal-config-get'), st2 = await state(A);
    const sent = st2.saves[0] || {};
    rec('21 call 12 as a manager login: saves, and AIR POS then reads back the new values', s1.ok && s1.saved === true && s1.settings.useVirtualKeyboard === true && s1.settings.soundAlerts === false && g1.settings.useVirtualKeyboard === true && g1.settings.soundAlerts === false && g1.settings.checkoutAutoPrint === true, JSON.stringify(s1.settings));
    rec('22 the body sent to AIR POS is exactly what AIR POS\'s own screen sends: id + the six switches + printerName (printer kept as it was; no shortcuts, station or corp ids)', st2.saveCalls === 1 && JSON.stringify(Object.keys(sent).sort()) === JSON.stringify(['id', 'printerName'].concat(SW).sort()) && sent.id === 'tc-1' && sent.printerName === 'Made-up Receipt Printer' && sent.useVirtualKeyboard === true && sent.autoOpenCashDrawer === true, JSON.stringify(sent));
    const s2 = await post(A, 'terminal-config-save', { useVirtualKeyboard: true }), st3 = await state(A);
    rec('23 saving the same values again sends nothing to AIR POS ("Nothing changed")', s2.ok && s2.unchanged === true && st3.saveCalls === 1, JSON.stringify(s2).slice(0, 120));
    const refused = await Promise.all([post(A, 'terminal-config-save', {}), post(A, 'terminal-config-save', { soundAlerts: 'yes' }), post(A, 'terminal-config-save', { printerName: 'Hacked', shortcuts: 'x', id: 'other' })]), st4 = await state(A);
    rec('24 bad input is refused with a plain message and nothing is sent: no switch, a non-boolean, or fields that are not switches (printer, shortcuts, id cannot be changed here)', refused.every(x => x.ok === false && typeof x.message === 'string') && st4.saveCalls === 1, JSON.stringify(refused.map(x => x.message)));
    const c1 = await post(B, 'terminal-config-save', { soundAlerts: false }), c2 = await post(B, 'terminal-config-save', { soundAlerts: false, user: 'nobody', password: 'wrong' }), stB = await state(B);
    rec('25 a cashier login with no manager password: refused, needManager, nothing sent; a wrong manager password: refused too', c1.ok === false && c1.needManager === true && c2.ok === false && c2.needManager === true && stB.saveCalls === 0, JSON.stringify([c1.message, c2.message]));
    const c3 = await post(B, 'terminal-config-save', { soundAlerts: false, user: 'boss', password: 'boss-pw' }), stB2 = await state(B), gB = await post(B, 'terminal-config-get');
    rec('26 a cashier login with a manager typing a right user name and password: saved once, "manager approval", read back; the manager password is not kept', c3.ok && c3.saved && c3.via === 'manager approval' && stB2.saveCalls === 1 && gB.settings.soundAlerts === false && !/boss-pw/.test(JSON.stringify(stB2) + JSON.stringify(c3)), JSON.stringify(c3.settings));
    await fetch(A.hook + '/lookups-fail?on=1'); const dn = await post(A, 'terminal-config-save', { soundAlerts: true }); await fetch(A.hook + '/lookups-fail?on=0');
    const stD = await state(A), gD = await post(A, 'terminal-config-get');
    rec('27 AIR POS down while saving: a plain "Network error" message, nothing saved, the old values stay', dn.ok === false && /Network error/.test(dn.message) && stD.saveCalls === 1 && gD.settings.soundAlerts === false, JSON.stringify(dn));
    // ---- store and account settings: read only, manager only ----
    const ss = await post(A, 'store-settings-get'), ssB = await post(B, 'store-settings-get'), flat = JSON.stringify(ss);
    rec('28 store-settings-get (manager): the yes/no switches and numbers of five AIR POS groups + the business name and receipt lines; canChange false with the reason', ss.ok && ss.groups.length === 5 && ss.groups[1].rows.some(r => r.key === 'shopDiscountRateLimit' && r.value === 20) && ss.business.name === 'Fake Shop' && ss.canChange === false && /back office/.test(ss.why), flat.slice(0, 160));
    rec('29 no secret leaves the register: text values, payment keys, API keys and the tax id are not in the answer', !/SECRET|secretKeyText|sk_|apiKeys|paymentSetting|TAX-/.test(flat), '');
    rec('30 a cashier login is told "for a manager login" and gets no data', ssB.ok === false && ssB.denied === true && /manager login/.test(ssB.message) && !/groups|business/.test(JSON.stringify(ssB)), JSON.stringify(ssB));
    const lg = L() + fs.readFileSync(B.log, 'utf8');
    rec('18 the server log holds no reply data (printer name, state names) and no password', !/Made-up Receipt Printer|Alabama|Made-up Toys|boss-pw|SECRET/.test(lg) && !(process.env.AIRMAX_TEST_PW && lg.includes(process.env.AIRMAX_TEST_PW)), '');
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 500)); }
  finally { A.c.kill(); B.c.kill(); fs.rmSync(T, { recursive: true, force: true }); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

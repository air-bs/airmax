// Cash drawer: every open path, with a FAKE printer helper (no printer, no store, made-up data), and the new DRAWER log line
// (app/drawerlog.js) for each: why, printer, type, every method tried and its answer. The drawer code itself (app/lib) is not changed.
// Last check: the real server (tests/look-fake.js, offline fake AIR POS) writes the line for Ctrl+D (route "drawer").
// Run: node tests/drawer-paths.test.js   (uses port DRAWER_TEST_PORT, default 5196, for the last check)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { Register } = require('../app/lib/register');
const { DrawerLog, kickName } = require('../app/drawerlog');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STAR = { name: 'Star TSP100 Cutter (TSP143)', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' };
const TEXTQ = { name: 'Star TSP100 Cutter (TSP143) (Copy 1)', driver: 'Generic / Text Only', port: 'USB001' };
const EPSON = { name: 'EPSON TM-T20II Receipt', driver: 'EPSON TM-T20II Receipt5', port: 'ESDPRT001' };
const REFUSED = "Printer 'Star TSP100 Cutter (TSP143)' is not printing: it reports an error. The job was cancelled.";
// fake helper: raw / drawerDriver / network / serial answers are set per case; every call is recorded
function mk({ settings = {}, printer = STAR, raw, driver, net, serial, present = true, manager = true, basic = {}, airpos } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-drp-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'auto', printerConn: 'windows', printerName: '', printMethod: 'auto', printerType: 'auto', drawerPin: 2, drawerPulse: 50, drawerWaitSec: 5 }, settings);
  const calls = [], lines = [];
  reg.hw = { present,
    printers: async () => ({ ok: true, value: { printers: [printer.name], default: printer.name, resolved: printer.name, details: [printer] } }),
    request: async (kind, a) => {
      if (kind === 'raw') { calls.push({ k: 'raw', doc: a.doc, bytes: [...Buffer.from(a.base64, 'base64')], printer: a.printer }); return raw ? raw(a) : { ok: true, value: { state: 'printed' } }; }
      if (kind === 'drawerDriver') { calls.push({ k: 'drawerDriver', ch: a.ch, printer: a.printer }); return driver ? driver(a) : { ok: true, value: { state: 'driver-drawer' } }; }
      return { ok: true, value: [] };
    },
    network: async (buf, host, port) => { calls.push({ k: 'network', bytes: [...buf], host, port }); return net ? net() : { ok: true, value: 'sent' }; },
    serial: async (b64, port) => { calls.push({ k: 'serial', bytes: [...Buffer.from(b64, 'base64')], port }); return serial ? serial() : { ok: true, value: 'sent' }; } };
  const api = reg.api; api.ide = 'x'; reg.identity = { userName: 'cashier1', currency: 2, superAdmin: manager };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false }, retailConfig: { basicSetting: { ...basic } }, authorities: manager ? ['RetailManager'] : [] };
  api.openCashbox = async () => { calls.push({ k: 'airpos-drawer' }); return airpos ? airpos() : { success: true, value: {} }; };
  api.verify = async (u, pw) => (pw === 'right-pw' ? { success: true, value: 'u1' } : { success: false, message: 'Wrong password' }); // made-up
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true }); api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } }); api.complete = async () => ({ success: true });
  api.orderGet = async () => ({ success: true, value: { status: 1, receives: [] } });
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  const dl = new DrawerLog({ reg, log: m => lines.push(m) }).install();
  const kicks = () => calls.filter(c => c.k === 'drawerDriver' || c.k === 'airpos-drawer' || c.k === 'network' || c.k === 'serial' || (c.k === 'raw' && /drawer/i.test(c.doc || '')));
  return { reg, calls, lines, dl, kicks, ctrlD: (pw) => dl.run('drawer', () => reg.drawer(false, pw)) };
}
const last = t => t.lines.filter(l => /^DRAWER /.test(l)).slice(-1)[0] || '';

(async () => {
  // ---- Ctrl+D on a Star TSP143 (USB, futurePRNT) -----------------------------------------------------------------
  let t = mk(); let r = await t.ctrlD(); let L = last(t);
  // release branch (drw1011, Claude's #10): on a Star futurePRNT queue the Windows driver drawer character goes FIRST on Automatic too; the raw BEL is the fallback (P2b)
  rec('P1 Ctrl+D, Star on USB, type Automatic: the Windows driver drawer character A goes to the printer once (drw1011: driver first), no raw job', r.ok && t.kicks().length === 1 && t.kicks()[0].k === 'drawerDriver' && t.kicks()[0].ch === 'A', JSON.stringify(t.kicks()));
  rec('P1 log: why (Ctrl+D), printer, port, driver, type Star guessed from the name, the kick and its answer, the result', /^DRAWER \[Ctrl\+D \/ Open Drawer\] printer "Star TSP100 Cutter \(TSP143\)" \(Windows printer port USB001, driver "Star TSP100 Cutter \(TSP143\)"\); type Star \(StarLine\) \(Automatic: guessed from the printer name \/ driver\), pin 2 \(drawer 1\), pulse 50 ms/.test(L) && /tried: 1\) Windows driver drawer character 'A' \(Star "Control" font, drawer 1, 50 ms\) -> ok \| result: drawer signal sent/.test(L), L);
  // the store case: the futurePRNT queue refuses raw jobs ("it reports an error"); AirMax then uses the Windows driver drawer character
  t = mk({ raw: () => ({ ok: false, error: REFUSED }) }); r = await t.ctrlD(); L = last(t);
  rec('P2 Star queue refuses raw jobs: on the release branch the driver drawer character \'A\' goes first, so the refusal is never hit and the drawer opens', r.ok && t.kicks().map(k => k.k).join() === 'drawerDriver' && t.kicks()[0].ch === 'A', t.kicks().map(k => k.k + (k.ch ? ':' + k.ch : '')).join(', '));
  rec('P2 log: the driver character first and its answer', /tried: 1\) Windows driver drawer character 'A' \(Star "Control" font, drawer 1, 50 ms\) -> ok \| result: drawer signal sent/.test(L), L);
  { const t2 = mk({ driver: () => ({ ok: false, error: 'driver drawer failed (fake)' }) }); const r2 = await t2.ctrlD(); const L2 = last(t2);
    rec('P2b driver drawer fails: the raw Star BEL (07) is the fallback, both tries in order in the log', r2.ok && t2.kicks().map(k => k.k).join() === 'drawerDriver,raw' && JSON.stringify(t2.kicks()[1].bytes) === '[7]' && /tried: 1\) Windows driver drawer character 'A'.*FAILED.*2\) direct kick Star "BEL" \(drawer 1\) \[07\] -> ok/.test(L2), L2); }
  t.calls.length = 0; r = await t.ctrlD(); L = last(t);
  rec('P2 the next Ctrl+D goes straight to the driver character (raw refused this session)', r.ok && t.kicks().map(k => k.k).join() === 'drawerDriver' && /tried: 1\) Windows driver drawer character 'A'/.test(L), t.kicks().map(k => k.k).join());
  t = mk({ settings: { printMethod: 'driver', drawerPulse: 200 } }); r = await t.ctrlD(); L = last(t);
  rec('P3 Print method = Windows driver: the driver character first (\'D\' = 200 ms), no raw job', r.ok && t.kicks().map(k => k.k).join() === 'drawerDriver' && t.kicks()[0].ch === 'D' && /print method driver/.test(L), L.split('|')[1]);
  t = mk({ settings: { printMethod: 'driver' }, driver: () => ({ ok: false, error: 'unknown command' }), raw: () => ({ ok: false, error: REFUSED }) }); r = await t.ctrlD(); L = last(t);
  rec('P4 an older helper without the driver drawer command: both fail, the log says "unknown command" (= update the helper)', !r.ok && /Windows driver drawer character 'A'[^;]* -> FAILED: unknown command/.test(L) && /result: FAILED/.test(L), L.split('|').slice(1).join('|'));
  t = mk({ settings: { printMethod: 'driver' }, driver: () => ({ ok: false, error: 'the printer driver has no Star "Control" font (got "Arial"); is this a Star futurePRNT printer?' }), raw: () => ({ ok: false, error: REFUSED }) }); r = await t.ctrlD(); L = last(t);
  rec('P5 a queue whose driver is not Star futurePRNT (no "Control" font): logged as such', !r.ok && /no Star "Control" font/.test(L), L.split('|')[1]);
  // ---- printer type ------------------------------------------------------------------------------------------------
  t = mk({ settings: { printerType: 'generic' } }); r = await t.ctrlD(); L = last(t);
  rec('P6 a Star set to "Generic ESC/POS" in Settings gets the ESC/POS kick ESC p (1b 70 00 19 fa), which a Star in StarLine mode ignores; the log shows it', r.ok && JSON.stringify(t.kicks()[0].bytes) === JSON.stringify([0x1b, 0x70, 0, 25, 250]) && /type Generic ESC\/POS \(set in Settings\)/.test(L) && /direct kick ESC\/POS "ESC p" \(pin 2\) \[1b 70 00 19 fa\] -> ok/.test(L), L.split('|')[0].slice(-120));
  t = mk({ printer: EPSON }); r = await t.ctrlD(); L = last(t);
  rec('P7 an Epson TM (Automatic): ESC p, logged as Epson ESC/POS', r.ok && t.kicks()[0].bytes[0] === 0x1b && /type Epson ESC\/POS \(Automatic/.test(L), '');
  t = mk({ settings: { drawerKind: 'both', printerType: 'star' } }); r = await t.ctrlD(); L = last(t);
  rec('P8 Settings drawer kind "both": ESC p and BEL in one job, both named in the log', r.ok && /ESC\/POS "ESC p" \(pin 2\) \+ Star "BEL" \(drawer 1\)/.test(L) && /drawer kind both/.test(L), L.split('|')[1]);
  t = mk({ settings: { drawerPin: 5 } }); r = await t.ctrlD(); L = last(t);
  rec('P9 drawer pin 5 (drawer 2) on a Star: driver character d (drawer 2) first (drw1011), logged as drawer 2', r.ok && t.kicks()[0].k === 'drawerDriver' && t.kicks()[0].ch === 'd' && /pin 5 \(drawer 2\)/.test(L) && /Windows driver drawer character 'd' \(Star "Control" font, drawer 2/.test(L), t.kicks().map(k => k.k + (k.ch ? ':' + k.ch : '')).join(', ') + ' | ' + L.split('|')[1]);
  { const t9 = mk({ settings: { drawerPin: 5 }, driver: () => ({ ok: false, error: 'driver drawer failed (fake)' }) }); const r9 = await t9.ctrlD(); const L9 = last(t9);
    rec('P9b pin 5 on a Star when the driver drawer fails: the raw SUB (1a) is the fallback, logged as drawer 2', r9.ok && JSON.stringify(t9.kicks()[1].bytes) === '[26]' && /Star "SUB" \(drawer 2\)/.test(L9), L9); }
  // ---- the "(Copy N)" Generic / Text Only queue (support notes) ----------------------------------------------------
  t = mk({ printer: TEXTQ, settings: { printMethod: 'driver' } }); r = await t.ctrlD(); L = last(t);
  rec('P10 a "Generic / Text Only" copy of the Star queue: the driver character is NOT printed on it (would print a letter); the log says why', !t.kicks().some(k => k.k === 'drawerDriver') && /Windows driver drawer character 'A'[^;]* -> FAILED: [^;]*[Tt]ext[ -][Oo]nly/.test(L), L.split('|')[1]);
  // ---- connection: network, COM / Bluetooth -------------------------------------------------------------------------
  t = mk({ settings: { printerConn: 'network', printerHost: '192.168.1.50', printerPort: 9100 } }); r = await t.ctrlD(); L = last(t);
  rec('P11 network printer, type Automatic: treated as Generic ESC/POS (ESC p to 192.168.1.50:9100); a Star LAN in StarLine mode needs type Star', r.ok && t.kicks()[0].k === 'network' && t.kicks()[0].host === '192.168.1.50' && t.kicks()[0].bytes[0] === 0x1b && /network 192\.168\.1\.50:9100/.test(L) && /Automatic: guessed from network = Generic/.test(L), L.split(';')[1]);
  t = mk({ settings: { printerConn: 'network', printerHost: '192.168.1.50', printerPort: 9100, printerType: 'star' } }); r = await t.ctrlD();
  rec('P12 network printer with type Star: BEL (07) to the printer', r.ok && JSON.stringify(t.kicks()[0].bytes) === '[7]', '');
  t = mk({ settings: { printerConn: 'serial', serialPort: 'COM5' } }); r = await t.ctrlD(); L = last(t);
  rec('P13 Bluetooth / COM port (e.g. TSP143IIIBI paired as COM5), type Automatic: Generic ESC/POS (ESC p); the log names the COM port', r.ok && t.kicks()[0].k === 'serial' && t.kicks()[0].port === 'COM5' && t.kicks()[0].bytes[0] === 0x1b && /COM port COM5 \(serial \/ Bluetooth\)/.test(L) && /Generic ESC\/POS \(Automatic: guessed from the COM port\)/.test(L), L.split(';')[1]);
  t = mk({ settings: { printerConn: 'serial', serialPort: 'COM5', printerType: 'star' } }); r = await t.ctrlD();
  rec('P14 Bluetooth / COM with type Star: BEL (07)', r.ok && JSON.stringify(t.kicks()[0].bytes) === '[7]', '');
  t = mk({ settings: { printerConn: 'network', printerHost: '' } }); r = await t.ctrlD(); L = last(t);
  rec('P15 network printer with no address: fails, no AIR POS service fallback (it would open another drawer), logged', !r.ok && !t.calls.some(c => c.k === 'airpos-drawer') && /no printer address set/.test(L), L.split('|')[1]);
  // ---- fallback to the AIR POS hardware service ----------------------------------------------------------------------
  t = mk({ present: false }); r = await t.ctrlD(); L = last(t);
  rec('P16 no built-in helper (hardware Automatic): the AIR POS hardware service opens it; logged', r.ok && t.kicks().map(k => k.k).join() === 'airpos-drawer' && /tried: 1\) AIR POS hardware service \(OpenCashbox on localhost:20001\) -> ok/.test(L), L.split('|')[1]);
  t = mk({ present: false, airpos: () => ({ success: false, message: 'Local hardware service not reachable: ECONNREFUSED', unreachable: true }) }); r = await t.ctrlD(); L = last(t);
  rec('P17 neither the helper nor the AIR POS service: "not available", both reasons in the log', !r.ok && /AIR POS hardware service[^;]* -> FAILED: Local hardware service not reachable/.test(L) && /built-in helper not available/.test(L), L.split('|').slice(1).join('|').slice(0, 220));
  t = mk({ settings: { hardware: 'airpos' } }); r = await t.ctrlD(); L = last(t);
  rec('P18 hardware = AIR POS service in Settings: only the service is used (the helper is not), logged as "hardware airpos"', r.ok && t.kicks().map(k => k.k).join() === 'airpos-drawer' && /hardware airpos/.test(L), '');
  // ---- slow / no answer ----------------------------------------------------------------------------------------------
  t = mk({ settings: { drawerWaitSec: 1 }, driver: () => sleep(1600).then(() => ({ ok: true, value: { state: 'driver-drawer' } })) }); r = await t.ctrlD(); L = last(t);
  rec('P19 the printer does not answer within the drawer wait (1 s): "NO ANSWER in 1 s", the sale screen is not held', !r.ok && r.drawerTimeout && /result: NO ANSWER in 1 s/.test(L), L.split('|').slice(-1)[0]);
  await sleep(900);
  rec('P19 ...the late answer is logged as its own line ("after the wait")', t.lines.some(l => /^DRAWER \[Ctrl\+D \/ Open Drawer\] after the wait: Windows driver drawer character 'A' \(Star "Control" font, drawer 1, 50 ms\) -> ok/.test(l)), t.lines.filter(l => /after the wait/.test(l))[0] || 'none');
  // ---- who may open it with no sale (Ctrl+D) ----------------------------------------------------------------------------
  t = mk({ manager: false }); r = await t.ctrlD(); L = last(t);
  rec('P20 a cashier (not an AIR POS manager), AIR POS "verify to open cash box" off: Ctrl+D refused before any signal; logged "not sent"', !r.ok && !t.kicks().length && /^DRAWER \[Ctrl\+D \/ Open Drawer\] not sent: Your user is not allowed to open the drawer without a sale/.test(L), L);
  t = mk({ manager: false, basic: { cashBoxOpenNeedVerify: true } }); r = await t.ctrlD(); const r2 = await t.ctrlD('right-pw');
  rec('P21 cashier with "verify to open cash box" on: asked for the password, then opens with it', !r.ok && r.needPassword && r2.ok && t.kicks().length === 1, r.message);
  // ---- after a sale ----------------------------------------------------------------------------------------------------
  const sale = async (type, opt = {}) => { const s = mk(opt); s.reg.home.terminalConfig.autoOpenCashDrawer = true; await s.reg.recalc(); await s.reg.startPay();
    const res = await s.dl.run('pay-tender', () => s.reg.tender({ type, amount: 10, tendered: 10 })); if (res && res.hwJob) await res.hwJob; await sleep(50); return s; };
  t = await sale(10); L = last(t);
  rec('P22 after a CASH sale the drawer opens once by itself; logged as "after a sale"', t.kicks().length === 1 && /^DRAWER \[after a sale\] /.test(L) && /result: drawer signal sent/.test(L), L.slice(0, 80));
  t = await sale(20);
  rec('P23 after a CARD sale the drawer does not open and nothing is logged', t.kicks().length === 0 && !t.lines.some(l => /^DRAWER /.test(l)), t.kicks().length + ' kicks');
  t = await sale(10, { raw: () => ({ ok: false, error: REFUSED }) }); L = last(t);
  rec('P24 after a cash sale on the refusing Star queue: the driver character goes first (drw1011), the raw refusal is never hit', t.kicks().map(k => k.k).join() === 'drawerDriver' && /\[after a sale\].*1\) Windows driver drawer character/.test(L), t.kicks().map(k => k.k).join());
  // ---- the log line never carries customer / sale data, and the wrapper changes nothing --------------------------------
  t = mk(); t.reg.member = { id: 'm1', number: '5550100', name: 'Sample Customer', mobile: '555-0100' }; await t.ctrlD(); L = last(t);
  rec('P25 no customer or sale data in the line (no name, number, phone, user, amounts)', !/5550100|Sample Customer|555-0100|cashier1|\$\d/.test(L), '');
  const bare = mk(); delete bare.reg.openDrawerRaw; delete bare.reg.sendRaw; delete bare.reg.driverDrawer; delete bare.reg.drawerBytes; delete bare.reg.drawer; bare.reg.api.openCashbox = async () => ({ success: true }); // the prototype code, not watched
  const a1 = await bare.reg.drawer(false), a2 = await mk().ctrlD();
  rec('P26 watching changes nothing: same result as the unwatched drawer code', JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a2));
  rec('kickName names every kick', kickName([0x1b, 0x07, 20, 20, 0x07]) === 'Star "ESC BEL" pulse 200 ms + "BEL" (drawer 1)' && kickName([0x1b, 0x70, 1, 25, 250]) === 'ESC/POS "ESC p" (pin 5)', '');

  // ---- the real server: Ctrl+D (route "drawer") writes the line, in Settings > Export log ---------------------------------
  const PORT = Number(process.env.DRAWER_TEST_PORT || 5196), B = 'http://127.0.0.1:' + PORT;
  const srv = spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(PORT) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(B + '/api/state'); break; } catch { await sleep(100); } }
    const post = (n, x) => fetch(B + '/api/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(q => q.json());
    await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' }); const d = await post('drawer', {}); await sleep(300);
    const logText = await fetch(B + '/export/log').then(q => q.text()), dl = logText.split('\n').filter(l => / DRAWER \[/.test(l));
    rec('S1 real server: Ctrl+D writes "DRAWER [Ctrl+D / Open Drawer] ..." in the log export (here: no helper on this PC, so the AIR POS service path)', d.ok && dl.length === 1 && /DRAWER \[Ctrl\+D \/ Open Drawer\].*AIR POS hardware service \(OpenCashbox on localhost:20001\) -> ok/.test(dl[0]), (dl[0] || logText.slice(-300)).replace(/^.*DRAWER/, 'DRAWER').slice(0, 220));
  } finally { srv.kill(); }

  const pass = out.filter(x => x.pass).length; console.log(`drawer-paths: ${pass}/${out.length} passed`);
  fs.writeFileSync(path.join(__dirname, 'drawer-paths-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

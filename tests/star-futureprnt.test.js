// Work copy (NOT released). 1.0.10-local.1 (Nov 1): Star TSP143IIIBI on the futurePRNT driver. Mocked helper, no hardware.
//  A. Automatic: a queue that refuses RAW jobs ("it reports an error") gets ONE driver retry, remembered for the session.
//  B. No driver retry when the printer is offline / out of paper (the job would print later by surprise).
//  C. Star drawer through the Windows driver ("Control" font letter), raw BEL backup, raw -> driver fallback.
//  D. Garbled receipt (11:27, 'LOCALE.GPD'): a "Generic / Text Only" queue never gets a PDF (receipt, test page) or the drawer letter.
//  E. Helper detail text is stripped from the message; a cancelled job is always logged.
// Usage: node tests/star-futureprnt.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const lib = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../app/lib');
const { Register } = require(path.join(lib, 'register'));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const STAR = { name: 'Star TSP100 Cutter (TSP143)', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' };
const TTY = { name: 'Generic / Text Only', driver: 'Generic / Text Only', port: 'USB001' };
function make({ settings = {}, details = [STAR], resolved = STAR.name, raw, drawerDriver, pdf, dir: keepDir } = {}) { // dir: same data folder = an app restart (1.0.11 drawer fix)
  const dir = keepDir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-star-'));
  const logs = [];
  const reg = new Register({ log: l => logs.push(String(l)), dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: '', printMethod: 'auto', printerType: 'auto', drawerPin: 2, drawerPulse: 200, drawerWaitSec: 5 }, settings);
  const calls = []; const st = { details, resolved };
  reg.hw = { present: true,
    printers: async () => ({ ok: true, value: { printers: st.details.map(d => d.name), default: st.resolved, resolved: st.resolved, details: st.details } }),
    renderMono: async () => ({ ok: true, value: { width: 8, height: 1, data: 'AA==' } }),
    printPdf: async (b64, name) => { calls.push({ k: 'pdf', name }); return pdf ? pdf(name) : { ok: true, value: 'printed' }; },
    request: async (kind, a) => {
      if (kind === 'raw') { calls.push({ k: 'raw', name: a.printer, doc: a.doc, bytes: Buffer.from(a.base64, 'base64') }); return raw ? raw(a) : { ok: true, value: 'printed' }; }
      if (kind === 'drawerDriver') { calls.push({ k: 'drawerDriver', name: a.printer, ch: a.ch }); return drawerDriver ? drawerDriver(a) : { ok: true, value: { state: 'driver-drawer' } }; }
      return { ok: true, value: [] };
    } };
  reg.api.billTemplateConfigGet = async () => ({ success: true, value: { orderPrintId: 'op', defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }] } });
  reg.api.billContentGet = async () => ({ success: true, value: { billBase64: 'JVBERi0x' } });
  reg.api.printBillContent = async () => { calls.push({ k: 'airpos-print' }); return { success: true }; };
  reg.api.openCashbox = async () => { calls.push({ k: 'airpos-drawer' }); return { success: true }; };
  const diagText = () => { try { return fs.readFileSync(path.join(dir, 'printer-diag.log'), 'utf8'); } catch { return ''; } };
  return { reg, calls, logs, st, diagText, dir };
}
const kinds = c => c.map(x => x.k).join(',');
const REFUSED = "Printer 'Star TSP100 Cutter (TSP143)' is not printing: it reports an error. The job was cancelled. [diag: job 0x2, printer 0x2, processor STPrint, queue datatype RAW, datatype RAW, pages printed 0, bytes 32, was printing no]";
(async () => {
  // ---- D. the 11:27 garbled receipt ----
  { const t = make({ settings: { printMethod: 'driver' }, details: [TTY, STAR], resolved: TTY.name });
    const r = await t.reg.printOrder('o1');
    rec('D1 Print receipts = Windows driver, automatic pick = "Generic / Text Only": the receipt PDF is NOT sent there (no garbage)', !r.ok && !t.calls.some(c => c.k === 'pdf' || c.k === 'raw' || c.k === 'airpos-print'), kinds(t.calls) + ' | ' + (r.message || ''));
    rec('D2 ...and the message names the Star futurePRNT queue to pick instead + how to reprint', /Generic \/ Text Only/.test(r.message) && /Star TSP100 Cutter \(TSP143\)/.test(r.message) && /Print Receipt/.test(r.message), r.message);
    const tp = await t.reg.testPrint();
    rec('D3 the test page is refused on the same text-only queue too (it no longer hides the problem)', !tp.ok && !t.calls.some(c => c.k === 'pdf'), tp.message);
    const dr = await t.reg.testDrawer();
    rec('D4 Star drawer on a text-only queue: no driver drawer letter is printed (raw BEL instead)', !t.calls.some(c => c.k === 'drawerDriver') && t.calls.some(c => c.k === 'raw' && c.bytes.length <= 8), kinds(t.calls) + ' ' + JSON.stringify(dr.ok));
    rec('D5 the refusal is in printer-diag.log', /text-only queue/.test(t.diagText()), 'diag log'); }
  { const t = make({ settings: { printMethod: 'driver' }, details: [TTY, STAR], resolved: STAR.name });
    const r = await t.reg.printOrder('o2');
    rec('D6 Print receipts = Windows driver on the Star futurePRNT queue: the receipt PDF goes to THAT queue by name, never raw', r.ok && t.calls.length === 1 && t.calls[0].k === 'pdf' && t.calls[0].name === STAR.name, JSON.stringify(t.calls.map(c => c.k + ':' + c.name))); 
    const tp = await t.reg.testPrint();
    rec('D7 ...and the test page takes the same path to the same queue', tp.ok && t.calls[1] && t.calls[1].k === 'pdf' && t.calls[1].name === STAR.name, JSON.stringify(t.calls.map(c => c.k + ':' + c.name))); }
  { const t = make({ settings: { printMethod: 'auto' }, details: [TTY], resolved: TTY.name });
    const r = await t.reg.printOrder('o3');
    rec('D8 Automatic on a text-only queue (ESC/POS printers like M804): raw still used, unchanged', r.ok && kinds(t.calls) === 'raw', kinds(t.calls)); }
  { const COPY = { name: 'Star TSP100 Cutter (TSP143) (Copy 2)', driver: 'Generic / Text Only', port: 'USB001' };
    const t = make({ settings: { printMethod: 'driver', printerName: COPY.name }, details: [STAR, COPY], resolved: COPY.name });
    const r = await t.reg.printOrder('o4');
    rec('D9 store case 11:32: saved queue "Star TSP100 Cutter (TSP143) (Copy 2)" on the Generic / Text Only driver: nothing sent, points to the plain Star queue', !r.ok && !t.calls.length && /choose 'Star TSP100 Cutter \(TSP143\)'/.test(r.message), kinds(t.calls) + ' | ' + r.message); }
  { const COPY = { name: 'Star TSP100 Cutter (TSP143) (Copy 2)', driver: 'Generic / Text Only', port: 'USB001' }; // 1.0.10-local.2: the 'bbbb' photo = Star raster rows read as text
    for (const pm of ['auto', 'raw']) { const t = make({ settings: { printMethod: pm, printerName: COPY.name }, details: [STAR, COPY], resolved: COPY.name });
      const r = await t.reg.printOrder('o5'); const tp = await t.reg.testPrint();
      rec(`D10 Print receipts = ${pm}, Star name on a Generic / Text Only queue: no Star picture sent (receipt + test page), points to the plain Star queue, no "use Direct" advice`, !r.ok && !tp.ok && !t.calls.length && /choose 'Star TSP100 Cutter \(TSP143\)'/.test(r.message) && !/Direct to printer/.test(r.message), kinds(t.calls) + ' | ' + r.message); } }
  // ---- A. "reports an error" -> one driver retry, remembered ----
  { const t = make({ raw: () => ({ ok: false, error: REFUSED }) });
    const r1 = await t.reg.printOrder('a1');
    rec('A1 Automatic: raw "reports an error" -> retried once through the Windows driver and printed', r1.ok && kinds(t.calls) === 'raw,pdf', kinds(t.calls));
    rec('A2 the switch is logged clearly', t.logs.some(l => /refuses raw jobs/.test(l)), t.logs.filter(l => /refuses/.test(l)).join(' | ').slice(0, 200));
    t.calls.length = 0; await t.reg.printOrder('a2');
    rec('A3 the next receipt goes straight to the driver (no raw try)', kinds(t.calls) === 'pdf', kinds(t.calls));
    t.calls.length = 0; await t.reg.testPrint(); await t.reg.printOrder('a3');
    rec('A4 the session memory survives a test print', !t.calls.some(c => c.k === 'raw' && c.doc !== 'Air Register drawer'), kinds(t.calls));
    t.reg.savePrinterSettings({ printerName: STAR.name }); t.calls.length = 0; await t.reg.printOrder('a4');
    rec('A5 a printer settings change starts over with raw', t.calls[0] && t.calls[0].k === 'raw', kinds(t.calls)); }
  // ---- B. no retry when offline / no paper ----
  { const t = make({ raw: () => ({ ok: false, error: "Printer 'Star TSP100 Cutter (TSP143)' is offline. The job was cancelled." }) });
    const r = await t.reg.printOrder('b1');
    rec('B1 offline: no driver retry, receipt reported failed with reprint hint', !r.ok && kinds(t.calls) === 'raw' && /Print Receipt/.test(r.message), kinds(t.calls)); }
  { const t = make({ raw: () => ({ ok: false, error: "Printer 'Star TSP100 Cutter (TSP143)' is not printing: it reports an error, out of paper. The job was cancelled." }) });
    const r = await t.reg.printOrder('b2');
    rec('B2 "reports an error" + out of paper: no driver retry', !r.ok && kinds(t.calls) === 'raw', kinds(t.calls)); }
  { const t = make({ details: [{ ...STAR, workOffline: true }], raw: () => ({ ok: false, error: REFUSED }) });
    const r = await t.reg.printOrder('b3');
    rec('B3 "reports an error" but Windows says the queue is offline: no driver retry', !r.ok && kinds(t.calls) === 'raw', kinds(t.calls)); }
  // ---- C. drawer ----
  { const t = make({ settings: { printMethod: 'driver' } });
    const r = await t.reg.testDrawer();
    rec('C1 Print receipts = Windows driver: Star drawer via the driver "Control" letter D (drawer 1, 200 ms), no raw', r.ok && kinds(t.calls) === 'drawerDriver' && t.calls[0].ch === 'D' && t.calls[0].name === STAR.name, JSON.stringify(t.calls)); }
  { const t = make({ settings: { printMethod: 'driver', drawerPin: 5 } });
    await t.reg.testDrawer();
    rec('C2 pin 5 (drawer 2) uses letter d', t.calls[0] && t.calls[0].ch === 'd', JSON.stringify(t.calls)); }
  { const t = make({ settings: { printMethod: 'driver' }, drawerDriver: () => ({ ok: false, error: "the printer has no 'Control' font" }) });
    const r = await t.reg.testDrawer();
    rec('C3 driver drawer fails -> raw BEL backup is sent', r.ok && kinds(t.calls) === 'drawerDriver,raw', kinds(t.calls)); }
  { const t = make({ raw: () => ({ ok: false, error: REFUSED }) });
    const r = await t.reg.testDrawer();
    // 1.0.11 drawer fix (#10, Ari OK Nov 2): was 'raw,drawerDriver' (raw BEL refused, forced printer-list re-read, then the driver: ~5 s on the register)
    rec('C4 Automatic on the Star futurePRNT queue: driver drawer FIRST, no raw try (1.0.11 drawer fix)', r.ok && kinds(t.calls) === 'drawerDriver', kinds(t.calls));
    t.calls.length = 0; await t.reg.testDrawer();
    rec('C5 second drawer: driver again', kinds(t.calls) === 'drawerDriver', kinds(t.calls)); }
  { const ODD = { name: 'Receipt', driver: 'Receipt', port: 'USB001' }; // Star-mode printer on a driver that is not Star's own: raw BEL first, as before
    const t = make({ settings: { printerType: 'star', printerName: ODD.name }, details: [ODD], resolved: ODD.name, raw: () => ({ ok: false, error: REFUSED }) });
    const r = await t.reg.testDrawer();
    rec('C4b Automatic, Star-mode printer on another driver: raw BEL first, refused -> driver drawer (unchanged path)', r.ok && kinds(t.calls) === 'raw,drawerDriver', kinds(t.calls)); }
  // ---- R. 1.0.11: "this queue refuses raw" is remembered across an app restart (30 days), forgotten on a printer settings change ----
  { const t = make({ raw: () => ({ ok: false, error: REFUSED }) }); await t.reg.printOrder('r1');
    const t2 = make({ dir: t.dir, raw: () => ({ ok: false, error: REFUSED }) }); await t2.reg.printOrder('r2');
    rec('R1 after an app restart the first receipt goes straight to the driver (no raw try, no refusal wait)', kinds(t.calls) === 'raw,pdf' && kinds(t2.calls) === 'pdf', kinds(t.calls) + ' | restart: ' + kinds(t2.calls));
    t2.reg.savePrinterSettings({ printerName: STAR.name }); const t3 = make({ dir: t.dir, settings: { printerName: STAR.name } }); await t3.reg.printOrder('r3');
    rec('R2 a printer settings change forgets it (also after the next restart): raw first again', t3.calls[0] && t3.calls[0].k === 'raw' && !fs.existsSync(path.join(t.dir, 'printer-raw-refused.json')), kinds(t3.calls));
    fs.writeFileSync(path.join(t.dir, 'printer-raw-refused.json'), JSON.stringify({ for: '', at: Date.now() - 31 * 24 * 3600 * 1000, why: 'old' }));
    const t4 = make({ dir: t.dir }); await t4.reg.printOrder('r4');
    rec('R3 a note older than 30 days is ignored (raw first)', t4.calls[0] && t4.calls[0].k === 'raw', kinds(t4.calls)); }
  { const t = make({ settings: { printMethod: 'raw' }, raw: () => ({ ok: false, error: REFUSED }) });
    const r = await t.reg.testDrawer();
    rec('C6 Print receipts = Direct: no driver drawer (setting honored)', !r.ok && kinds(t.calls) === 'raw', kinds(t.calls)); }
  // ---- E. diag + cancel log ----
  { const t = make({ settings: { printMethod: 'raw' }, raw: () => ({ ok: false, error: "Printer 'Star TSP100 Cutter (TSP143)' is not printing: it reports an error. The job was cancelled (it had started, so part of it may have printed). [diag: job 0x2, printer 0x2, processor STPrint, queue datatype RAW, datatype RAW, pages printed 1, bytes 9000, was printing yes]" }) });
    const r = await t.reg.printOrder('e1');
    rec('E1 helper detail is not shown to the cashier', !r.ok && !/\[diag:/.test(r.message), r.message);
    rec('E2 the cancelled job is logged, incl. "part of it may have printed"', /CANCELLED/.test(t.diagText()) && /may have printed/.test(t.diagText()) && /helper detail job 0x2/.test(t.diagText()), 'diag log'); }
  console.log(`star-futureprnt: ${out.filter(x => x.pass).length}/${out.length} passed`); process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

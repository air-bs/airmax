// Work copy (NOT released). 4:06 PM: a Star TSP100 whose Windows queue never reports the RAW job as printed. Before: EVERY
// receipt re-rendered, sent raw, waited (made-up 8 s here scaled to 800 ms), was cancelled, then printed through the driver.
// After: the first receipt learns "driver works" and the next ones go straight to the driver. Offline, made-up delays.
// Usage: node tests/receipt-driveronly.test.js [path-to-app-lib] [label]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const lib = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../app/lib');
const { Register } = require(path.join(lib, 'register'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D = { render: 250, rawWaitThenFail: 800, driverPrint: 400, tpl: 50, pdf: 50 };
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
(async () => {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-drv-')) }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: 'Made-up TSP143', printMethod: 'auto', printerType: 'auto' });
  const n = { raw: 0, render: 0, driver: 0 };
  reg.hw = { present: true,
    printers: async () => ({ ok: true, value: { printers: ['Made-up TSP143'], default: 'Made-up TSP143', resolved: 'Made-up TSP143', details: [{ name: 'Made-up TSP143', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' }] } }),
    renderMono: async () => { n.render++; await sleep(D.render); return { ok: true, value: { width: 8, height: 1, data: 'AA==' } }; },
    printPdf: async () => { n.driver++; await sleep(D.driverPrint); return { ok: true, value: 'printed' }; },
    request: async kind => { if (kind !== 'raw') return { ok: true, value: [] }; n.raw++; await sleep(D.rawWaitThenFail); return { ok: false, error: "Printer 'Made-up TSP143' did not finish the job: it did not answer" }; } };
  reg.api.billTemplateConfigGet = async () => { await sleep(D.tpl); return { success: true, value: { orderPrintId: 'op', defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }] } }; };
  reg.api.billContentGet = async () => { await sleep(D.pdf); return { success: true, value: { billBase64: 'JVBERi0x' } }; };
  reg.api.printBillContent = async () => ({ success: true }); reg.diag = () => {};
  const ms = [];
  for (let i = 0; i < 4; i++) { const t0 = Date.now(); const r = await reg.printOrder('o' + i); ms.push(Date.now() - t0); if (!r.ok) console.log('fail', r); }
  console.log(JSON.stringify({ lib: path.relative(process.cwd(), lib), delaysMs: D, perReceiptMs: ms, calls: n }));
  rec('All 4 receipts printed', n.driver === 4, JSON.stringify(n));
  if (process.argv[3] !== 'before') rec('Only the first receipt tries raw; receipts 2-4 go straight to the driver', n.raw === 1 && n.render === 1, JSON.stringify(n));
  fs.writeFileSync(path.join(__dirname, 'receipt-driveronly-' + (process.argv[3] || 'now') + '.json'), JSON.stringify({ delaysMs: D, perReceiptMs: ms, calls: n, results: out }, null, 1));
  console.log(`receipt-driveronly: ${out.filter(x => x.pass).length}/${out.length} passed`); process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

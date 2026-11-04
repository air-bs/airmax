// Work copy (NOT released). Request P: before/after timing of receipt printing, offline with made-up delays that match
// the measured AIR POS/helper times in PLAN-faster-lighter-receipts.md (printer list 0.6 s, template call 0.4 s,
// receipt PDF 1.0 s, print 0.3 s). Usage: node tests/receipt-speed.test.js [path-to-app-lib]  (default: ../app/lib)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const lib = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../app/lib');
const { Register } = require(path.join(lib, 'register'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const D = { printers: 600, tpl: 400, pdf: 1000, print: 300 };
let skew = 0; const realNow = Date.now; Date.now = () => realNow() + skew;
function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-speed-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: 'Made-up TM-T20', printMethod: 'auto', printerType: 'auto' });
  const n = { printers: 0, tpl: 0, pdf: 0, print: 0 };
  reg.hw = { present: true,
    printers: async () => { n.printers++; await sleep(D.printers); return { ok: true, value: { printers: ['Made-up TM-T20'], default: 'Made-up TM-T20', resolved: 'Made-up TM-T20', details: [{ name: 'Made-up TM-T20', driver: 'EPSON TM-T20', port: 'USB001' }] } }; },
    printPdf: async () => { n.print++; await sleep(D.print); return { ok: true, value: 'printed' }; },
    renderMono: async () => ({ ok: true, value: { width: 8, height: 1, data: Buffer.from([0]).toString('base64') } }),
    request: async kind => { if (kind === 'raw') { n.print++; await sleep(D.print); } return { ok: true, value: kind === 'raw' ? 'printed' : [] }; } };
  reg.api.billTemplateConfigGet = async id => { n.tpl++; await sleep(D.tpl); return { success: true, value: { orderPrintId: 'op-' + id, defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }], orderSubs: [] } }; };
  reg.api.billContentGet = async () => { n.pdf++; await sleep(D.pdf); return { success: true, value: { billBase64: 'JVBERi0x' } }; };
  reg.api.printBillContent = async () => ({ success: true });
  reg.diag = () => {};
  return { reg, n };
}
(async () => {
  const { reg, n } = mk(); const ms = [];
  for (let i = 0; i < 4; i++) { if (i) skew += 15000; const t0 = realNow(); const r = await reg.printOrder('order-' + i); ms.push(realNow() - t0); if (!r || !r.ok) { console.log('print failed', r); } }
  const avg = Math.round(ms.slice(1).reduce((a, b) => a + b, 0) / (ms.length - 1));
  console.log(JSON.stringify({ lib: path.relative(process.cwd(), lib), perSaleMs: ms, avgAfterFirstMs: avg, calls: n }));
  rec('Receipts print (4 sales, 15 s apart)', n.print === 4, `printed ${n.print}`);
  // a changed printer setting / test print / failure re-reads the list (the long cache never keeps a wrong printer)
  if (reg.printerSettings && reg.saveSettings) {}
  const before = n.printers; reg._prnInfo && (reg._prnInfo = null); await reg.printOrder('order-x'); rec('Cleared cache re-reads the printer list', n.printers === before + 1, `${before} -> ${n.printers}`);
  fs.writeFileSync(path.join(__dirname, 'receipt-speed-' + (process.argv[3] || 'now') + '.json'), JSON.stringify({ delaysMs: D, perSaleMs: ms, avgAfterFirstMs: avg, calls: n }, null, 1));
  console.log(`receipt-speed: ${out.filter(x => x.pass).length}/${out.length} passed`);
  process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

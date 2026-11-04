// Work copy (NOT released). 4:09 PM: receipts too dark / cut off / different every time on a Star TSP100.
// Checks, offline with made-up data: the helper is asked for exactly 576 dots (72 mm at 203 dpi) on every receipt, with the
// Normal threshold 128 by default (1.2.1 used 160), Light/Dark settings work, and the bytes sent are identical every time.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const lib = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../app/lib');
const { Register } = require(path.join(lib, 'register'));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
(async () => {
  const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-dark-')) }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: 'Made-up TSP143', printMethod: 'auto', printerType: 'auto' });
  const asks = [], sent = []; let driver = 0;
  reg.hw = { present: true,
    printers: async () => ({ ok: true, value: { printers: ['Made-up TSP143'], default: 'Made-up TSP143', resolved: 'Made-up TSP143', details: [{ name: 'Made-up TSP143', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' }] } }),
    renderMono: async (b64, dots, thr) => { asks.push({ dots, thr }); const h = 20, data = Buffer.alloc(72 * h, 0); for (let y = 0; y < h; y++) data[y * 72 + (y % 72)] = 0xff; return { ok: true, value: { width: dots, height: h, data: data.toString('base64') } }; },
    printPdf: async () => { driver++; return { ok: true, value: 'printed' }; },
    request: async (kind, args) => { if (kind === 'raw') sent.push(String(args && (args.base64 || args.data) || JSON.stringify(args))); return { ok: true, value: 'printed' }; } };
  reg.api.billTemplateConfigGet = async () => ({ success: true, value: { orderPrintId: 'op', defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }] } });
  reg.api.billContentGet = async () => ({ success: true, value: { billBase64: 'JVBERi0x' } });
  reg.api.printBillContent = async () => ({ success: true }); reg.diag = () => {};
  for (let i = 0; i < 3; i++) { const r = await reg.printOrder('d' + i); if (!r.ok) console.log('fail', JSON.stringify(r)); }
  rec('Every receipt is rendered exactly 576 dots wide (72 mm at 203 dpi)', asks.length === 3 && asks.every(a => Number(a.dots) === 576), JSON.stringify(asks));
  rec('Default darkness is Normal (threshold 128, was 160)', asks.every(a => a.thr === 128), JSON.stringify(asks.map(a => a.thr)));
  rec('Printed directly (no Windows driver scaling / margins)', sent.length === 3 && driver === 0, `raw ${sent.length}, driver ${driver}`);
  rec('Same receipt = same bytes to the printer every time', sent.length === 3 && sent.every(s => s === sent[0]), `${sent[0] ? sent[0].length : 0} chars each`);
  const t = {}; for (const v of ['light', 'dark', 'bogus', 'normal']) { reg.savePrinterSettings({ printDarkness: v }); asks.length = 0; await reg.printOrder('s' + v); t[v] = asks[0] && asks[0].thr; }
  rec('Settings: Light 100, Dark 160 (old), Normal 128; an unknown value is ignored', t.light === 100 && t.dark === 160 && t.bogus === 160 && t.normal === 128, JSON.stringify(t));
  console.log(`receipt-darkness: ${out.filter(x => x.pass).length}/${out.length} passed`); process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

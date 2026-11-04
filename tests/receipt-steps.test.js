// Work copy (NOT released). Owner 4:01 PM: time each step of the receipt path after a cash sale, offline, with made-up
// delays (no real printer, no real AIR POS). The helper is modelled as ONE-AT-A-TIME, like AirRegisterHw.exe.
// Usage: node tests/receipt-steps.test.js [path-to-app-lib] [label]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const lib = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../app/lib');
const { Register } = require(path.join(lib, 'register'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D = { printers: 600, tpl: 400, pdf: 1000, drawerJobPrinted: 700, render: 250, receiptJobPrinted: 2500 };
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
let q = Promise.resolve(); const serial = fn => { const p = q.then(fn, fn); q = p.catch(() => {}); return p; };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-steps-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: 'Made-up TSP100', printMethod: 'auto', printerType: 'auto' });
  const ev = {}; let t0 = 0; const mark = k => { if (!(k in ev)) ev[k] = Date.now() - t0; };
  reg.hw = { present: true,
    printers: () => serial(async () => { await sleep(D.printers); return { ok: true, value: { printers: ['Made-up TSP100'], default: 'Made-up TSP100', resolved: 'Made-up TSP100', details: [{ name: 'Made-up TSP100', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' }] } }; }),
    renderMono: () => serial(async () => { await sleep(D.render); return { ok: true, value: { width: 8, height: 1, data: Buffer.from([0]).toString('base64') } }; }),
    printPdf: () => serial(async () => { await sleep(D.receiptJobPrinted); return { ok: true, value: 'printed' }; }),
    request: (kind, a) => serial(async () => {
      if (kind !== 'raw' && kind !== 'drawerDriver') return { ok: true, value: [] };
      const drawer = kind === 'drawerDriver' || /drawer/i.test(a.doc || ''); // 1.0.11: Star futurePRNT drawer goes through the driver first
      if (!drawer) mark('receiptBytesToPrinter');
      await sleep(drawer ? D.drawerJobPrinted : D.receiptJobPrinted);
      mark(drawer ? 'drawerDone' : 'receiptPrinted'); return { ok: true, value: 'printed' };
    }) };
  reg.api.billTemplateConfigGet = async id => { await sleep(D.tpl); mark('templateConfigBack'); return { success: true, value: { orderPrintId: 'op-' + id, defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }], orderSubs: [] } }; };
  reg.api.billContentGet = async () => { await sleep(D.pdf); mark('receiptPdfBack'); return { success: true, value: { billBase64: 'JVBERi0x' } }; };
  reg.api.printBillContent = async () => ({ success: true });
  reg.diag = () => {};
  reg.autoDrawer = () => true;
  // same job list finishSale builds for a cash sale (drawer, then receipt), and the same prefetch call finishSale makes
  t0 = Date.now(); const id = 'order-1';
  if (reg.prefetchReceipt) reg.prefetchReceipt(id);
  const jobs = [['drawer', () => reg.drawer(true), 6500], ['receipt', () => reg.printOrder(id), 30000]];
  const res = await reg.hwBackground(jobs, id); ev.allDone = Date.now() - t0;
  const ok = res.every(([, r]) => r && r.ok);
  console.log(JSON.stringify({ lib: path.relative(process.cwd(), lib), delaysMs: D, eventsMsAfterSaleComplete: ev, steps: reg.lastPrintTimings || null }));
  rec('Drawer and receipt both succeed', ok, JSON.stringify(res.map(([k, r]) => [k, r && r.ok])));
  rec('Receipt bytes reach the printer', ev.receiptBytesToPrinter > 0, ev.receiptBytesToPrinter + ' ms after sale complete');
  if (reg.prefetchReceipt) {
    rec('AIR POS receipt PDF fetched while the drawer kicks', ev.receiptPdfBack < ev.drawerDone + D.tpl, `pdf back ${ev.receiptPdfBack} ms, drawer done ${ev.drawerDone} ms`);
    const s = reg.lastPrintTimings || {}; const p = (s.prints || [])[0] || {};
    rec('Each step is timed', s.templateConfigMs >= 0 && s.receiptPdfMs >= 0 && p.rasterizeMs >= 0 && p.sendAndWaitPrintedMs >= 0 && p.printerLookupMs >= 0, JSON.stringify(s));
  }
  fs.writeFileSync(path.join(__dirname, 'receipt-steps-' + (process.argv[3] || 'now') + '.json'), JSON.stringify({ delaysMs: D, events: ev, steps: reg.lastPrintTimings || null, results: out }, null, 1));
  console.log(`receipt-steps: ${out.filter(x => x.pass).length}/${out.length} passed`);
  process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

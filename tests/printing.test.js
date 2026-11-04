// Printer/drawer flow tests (app/lib/printing.js) with a fake hardware helper: what bytes go where for each
// printer type, auto detection, offline errors (sale must still be reprintable), no AIR POS fallback for network.
// Run: node tests/printing.test.js
'use strict';
const assert = require('assert');
const { Printing } = require('../app/lib/printing');
const pc = require('../app/lib/printcmd');
let n = 0, bad = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log('ok   ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const hex = b => Buffer.from(b).toString('hex');

function reg(settings = {}, hwOver = {}, printers = [{ name: 'EPSON TM-T20II Receipt5', driver: 'EPSON TM-T20II Receipt5', port: 'ESDPRT001' }]) {
  const sent = [];
  const hw = {
    present: true,
    printers: async () => ({ ok: true, value: { printers: printers.map(p => p.name), default: printers[0].name, resolved: (printers.find(p => p.name === settings.printerName) || printers[0]).name, details: printers } }),
    request: async (cmd, a) => { if (cmd === 'ports') return { ok: true, value: [{ port: 'COM3', device: '\\Device\\TMVPORT0', epsonVirtual: true }] };
      sent.push({ via: cmd, printer: a.printer, wait: a.waitMs, ch: a.ch, bytes: a.base64 != null ? Buffer.from(a.base64, 'base64') : null }); return { ok: true, value: { printer: a.printer, state: 'printed' } }; }, // ch / no bytes: Star driver drawer (1.0.11)
    renderMono: async (b64, dots) => ({ ok: true, value: { width: dots, height: 2, data: Buffer.alloc(dots / 4, 0xff).toString('base64') } }),
    printPdf: async (b64, p) => { sent.push({ via: 'driver', printer: p }); return { ok: true }; },
    network: async (buf, host, port) => { sent.push({ via: 'network', host, port, bytes: buf }); return { ok: true }; },
    serial: async (b64, port) => { sent.push({ via: 'serial', port, bytes: Buffer.from(b64, 'base64') }); return { ok: true }; },
    ...hwOver,
  };
  const airpos = [];
  const r = Object.assign(Object.create(null), Printing, {
    settings: { printerName: '', drawerKind: 'escpos', hardware: 'auto', ...settings }, hw, hwStatus: {}, identity: { shopName: 'Test shop' },
    hwModes() { const m = this.settings.hardware; return m === 'builtin' ? ['builtin'] : m === 'airpos' ? ['airpos'] : ['builtin', 'airpos']; },
    printerName() { return this.settings.printerName || ''; }, hwErr: e => e || 'failed',
    api: { printBillContent: async () => { airpos.push('print'); return { success: true }; }, openCashbox: async () => { airpos.push('drawer'); return { success: true }; }, getPrinters: async () => ({ success: true, value: [] }) },
  });
  r.sent = sent; r.airpos = airpos; return r;
}
const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');

(async () => {
  await t('Auto + TM-T20II queue: receipt = GS v 0 picture + cut, RAW to that queue, watched for offline', async () => {
    const r = reg(); const x = await r.printPdfBase64(PDF, 'Receipt sent to printer');
    assert.ok(x.ok, x.message); const s = r.sent[0];
    assert.strictEqual(s.via, 'raw'); assert.strictEqual(s.wait, '8000');
    assert.strictEqual(hex(s.bytes.subarray(0, 13)), '1b401b74001d76300048000200');
    assert.strictEqual(hex(s.bytes.subarray(-4)), '1d564203');
  });
  await t('Auto + TM-T20II drawer: ESC p 0 25 250', async () => { const r = reg(); assert.ok((await r.openDrawerRaw()).ok); assert.strictEqual(hex(r.sent[0].bytes), '1b700019fa'); });
  await t('Auto + M804 on a Generic/Text Only queue: generic init with FS ., drawer pin 5 when set', async () => {
    const r = reg({ printerName: 'M804', drawerPin: 5, printerCut: false }, {}, [{ name: 'M804', driver: 'Generic / Text Only', port: 'USB001' }]);
    await r.printPdfBase64(PDF, 'Receipt sent to printer'); await r.openDrawerRaw();
    assert.strictEqual(hex(r.sent[0].bytes.subarray(0, 7)), '1b401c2e1b7400'); assert.strictEqual(hex(r.sent[0].bytes.subarray(-3)), '1b6405');
    assert.strictEqual(hex(r.sent[1].bytes), '1b700119fa');
  });
  await t('Auto + Star TSP143 queue: receipt is Star raster, drawer through the Star driver "Control" letter (1.0.11 drawer fix; was raw BEL)', async () => {
    const r = reg({ printerName: 'Star TSP100 Cutter (TSP143)' }, {}, [{ name: 'Star TSP100 Cutter (TSP143)', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' }]);
    await r.printPdfBase64(PDF, 'Receipt sent to printer'); await r.openDrawerRaw();
    assert.strictEqual(hex(r.sent[0].bytes.subarray(0, 8)), '1b2a72521b2a7241'); assert.strictEqual(hex(r.sent[0].bytes.subarray(-7)), '1b0c041b2a7242');
    assert.strictEqual(r.sent[1].via, 'drawerDriver'); assert.strictEqual(r.sent[1].ch, 'A'); // futurePRNT queue (real TSP143 refuses raw): driver letter A = drawer 1, 50 ms
  });
  await t('Star test page and notes go as a picture (never ESC/POS text)', async () => {
    const r = reg({ printerType: 'star' }); assert.ok((await r.testPrint()).ok); assert.ok((await r.printSlip(['note'], 'Note printed')).ok);
    for (const s of r.sent) assert.strictEqual(hex(s.bytes.subarray(0, 4)), '1b2a7252');
  });
  await t('Epson test page is ESC/POS text with ruler + barcode + cut', async () => {
    const r = reg(); const x = await r.testPrint(); assert.ok(x.ok); assert.match(x.message, /Epson TM-T20II/);
    assert.ok(r.sent[0].bytes.includes(Buffer.from('123456789012345678901234567890123456789012345678\n'))); assert.strictEqual(hex(r.sent[0].bytes.subarray(-4)), '1d564203');
  });
  await t('drawerKind "both" still sends ESC p and BEL', async () => { const r = reg({ drawerKind: 'both' }); await r.openDrawerRaw(); assert.strictEqual(hex(r.sent[0].bytes), '1b700019fa07'); });
  await t('Method "Windows driver" prints the PDF through the driver', async () => { const r = reg({ printMethod: 'driver' }); await r.printPdfBase64(PDF, 'Receipt sent to printer'); assert.strictEqual(r.sent[0].via, 'driver'); });
  await t('Network 9100: bytes go to host:port, never to AIR POS even if it fails', async () => {
    const r = reg({ printerConn: 'network', printerHost: '192.168.1.50', printerType: 'epson' }); await r.openDrawerRaw();
    assert.deepStrictEqual([r.sent[0].via, r.sent[0].host, r.sent[0].port, hex(r.sent[0].bytes)], ['network', '192.168.1.50', 9100, '1b700019fa']);
    const r2 = reg({ printerConn: 'network', printerHost: '10.0.0.9' }, { network: async () => ({ ok: false, error: 'printer at 10.0.0.9:9100: ECONNREFUSED', unavailable: true }) });
    const x = await r2.printPdfBase64(PDF, 'Receipt sent to printer'); assert.ok(!x.ok); assert.strictEqual(r2.airpos.length, 0); assert.match(x.message, /ECONNREFUSED/);
  });
  await t('Epson TM Virtual Port (COM): serial send, Auto picks Epson', async () => {
    const r = reg({ printerConn: 'serial', serialPort: 'COM3' }); await r.openDrawerRaw(); assert.strictEqual((await r.profileNow()).type, 'epson');
    assert.strictEqual(r.sent[0].via, 'serial'); assert.strictEqual(r.sent[0].port, 'COM3'); assert.strictEqual(hex(r.sent[0].bytes), '1b700019fa');
  });
  await t('Offline Windows printer: plain error, says the sale is saved and how to reprint, no AIR POS retry', async () => {
    const r = reg({}, { request: async (cmd) => cmd === 'ports' ? { ok: true, value: [] } : ({ ok: false, error: "Printer 'EPSON TM-T20II Receipt5' is not printing: it is offline (turned off, unplugged, or the USB cable is loose). The job was cancelled." }) });
    const x = await r.printPdfBase64(PDF, 'Receipt sent to printer');
    assert.ok(!x.ok); assert.strictEqual(x.hw, 'error'); assert.match(x.message, /^Receipt failed: Printer .* offline/); assert.match(x.message, /sale is saved.*Print Receipt \(P\)/);
    assert.strictEqual(r.airpos.length, 0);
  });
  await t('Helper missing: falls back to AIR POS service (old behaviour kept)', async () => {
    const r = reg(); r.hw.present = false; const x = await r.printPdfBase64(PDF, 'Receipt sent to printer'); assert.ok(x.ok); assert.strictEqual(x.via, 'airpos');
  });
  await t('Settings: only valid printer values are saved', async () => {
    const r = reg(); r.savePrinterSettings({ printerType: 'generic', printerCols: '42', drawerPin: '5', codePage: 'pc858', printerCut: false, printerConn: 'bogus', serialBaud: 1234, imageMode: 'escstar' });
    const ps = r.printerSettings(); assert.deepStrictEqual([ps.printerType, ps.printerCols, ps.drawerPin, ps.codePage, ps.printerCut, ps.printerConn, ps.serialBaud, ps.imageMode], ['generic', 42, 5, 'pc858', false, 'windows', 9600, 'escstar']);
  });
  await t('Printer list: details with detected type, COM ports, current profile', async () => {
    const r = reg({}, {}, [{ name: 'EPSON TM-T20II Receipt5', driver: 'EPSON TM-T20II Receipt5', port: 'ESDPRT001' }, { name: 'M804', driver: 'Generic / Text Only', port: 'USB002' }]);
    const x = await r.printers(); assert.deepStrictEqual(x.details.map(d => d.type), ['epson', 'generic']); assert.strictEqual(x.ports[0].epsonVirtual, true); assert.strictEqual(x.detected.type, 'epson');
  });
  await t('Old 1.1 setting "drawer type: Star" keeps working (Star raster + BEL)', async () => { const r = reg({ drawerKind: 'star', printerName: 'Receipt' }, {}, [{ name: 'Receipt', driver: 'Receipt', port: 'USB001' }]); await r.openDrawerRaw(); assert.strictEqual(hex(r.sent[0].bytes), '07'); });
  await t('1.2.0: saved printer present is used as-is, no strict flag (helper may fall back to the Windows default only if it disappears)', async () => { const r = reg({ printerName: 'M804' }, {}, [{ name: 'M804', driver: 'x', port: 'USB001' }]); let a; const old = r.hw.request; r.hw.request = async (c, x) => { if (c === 'ports' || c === 'printers') return old(c, x); a = x; return { ok: true }; }; await r.openDrawerRaw(); assert.ok(a && !a.strict, JSON.stringify(a)); assert.match(JSON.stringify(a), /M804/); });
  console.log(`\n${n - bad}/${n} printing flow tests passed`); process.exit(bad ? 1 : 0);
})();

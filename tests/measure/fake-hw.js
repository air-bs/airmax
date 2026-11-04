// Step 0 measurement only (test tool, not shipped). A stand-in for hw/AirRegisterHw.exe --serve that speaks the same
// JSON-lines protocol on stdin/stdout and, like the real helper (hw/Program.cs Main loop), runs ONE command at a time.
// Each command takes a made-up time from MEASURE_HW (JSON, ms per command) so the app's own sequencing can be timed.
// No printer, no Windows, no network. Every command start/end is appended to MEASURE_EVENTS as one JSON line.
//   Star futurePRNT model (store notes): MEASURE_HW_RAW=refuse makes every raw job fail the way the Star queue does on
//   the real register ("it reports an error"), after rawRefuseMs.
'use strict';
const fs = require('fs');
const D = Object.assign({ ping: 0, deviceInfo: 0, printers: 0, ports: 0, raw: 0, rawRefuseMs: 0, drawer: 0, drawerDriver: 0, printPdf: 0, renderMono: 0 }, JSON.parse(process.env.MEASURE_HW || '{}'));
const EV = process.env.MEASURE_EVENTS || '';
const RAW = process.env.MEASURE_HW_RAW || 'ok';
// MEASURE_HW_PRINTER (drawer-rules-1011 test): which receipt printer the fake Windows has. star = Star TSP143 on its futurePRNT queue (default),
// epson = Epson TM-T20II (APD driver, ESDPRT port), generic = an ESC/POS clone (M804) on "Generic / Text Only", staralt = Star-mode printer on another driver.
const PRINTERS = { star: { name: 'Star TSP100 Cutter (TSP143)', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' }, epson: { name: 'EPSON TM-T20II Receipt5', driver: 'EPSON TM-T20II Receipt5', port: 'ESDPRT001' },
  generic: { name: 'M804', driver: 'Generic / Text Only', port: 'USB002' }, staralt: { name: 'Receipt', driver: 'Receipt', port: 'USB003' } };
const STAR = { ...(PRINTERS[process.env.MEASURE_HW_PRINTER || 'star'] || PRINTERS.star), receipt: true, virtual: false, isDefault: true, jobs: 0, status: 0 };
const ev = o => { if (EV) try { fs.appendFileSync(EV, JSON.stringify({ t: Date.now(), src: 'hw', ...o }) + '\n'); } catch {} };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function handle(m) {
  const cmd = m.cmd, doc = m.doc || '';
  const ms = cmd === 'raw' && RAW === 'refuse' ? D.rawRefuseMs : (D[cmd] || 0);
  ev({ cmd, doc, phase: 'start', id: m.id, ...(cmd === 'raw' && /drawer/i.test(doc) ? { hex: Buffer.from(m.base64 || '', 'base64').toString('hex') } : {}), ...(cmd === 'drawerDriver' ? { ch: m.ch } : {}) });
  await wait(ms);
  let r;
  switch (cmd) {
    case 'ping': r = { ok: true, value: 'pong' }; break;
    case 'deviceInfo': r = { ok: true, value: { deviceName: 'MEASURE-PC', deviceId: 'measure-device', oldDeviceId: 'measure-device' } }; break;
    case 'printers': r = { ok: true, value: { printers: [STAR.name], default: STAR.name, resolved: STAR.name, reason: 'Windows default', details: [STAR], helper: '1.2.1', clr: '4.0', os: 'fake' } }; break;
    case 'ports': r = { ok: true, value: [] }; break;
    case 'raw': r = RAW === 'refuse' ? { ok: false, error: `Printer '${STAR.name}' is not printing: it reports an error. The job was cancelled.` } : { ok: true, value: { printer: STAR.name, state: 'printed', datatype: 'RAW' } }; break;
    case 'drawer': r = { ok: true, value: STAR.name }; break;
    case 'drawerDriver': r = { ok: true, value: { printer: STAR.name, state: 'driver-drawer' } }; break;
    case 'printPdf': r = { ok: true, value: { printer: STAR.name, state: 'driver' } }; break;
    case 'renderMono': r = { ok: true, value: { width: 576, height: 8, data: Buffer.alloc(576).toString('base64') } }; break;
    default: r = { ok: false, error: 'unknown command ' + cmd };
  }
  ev({ cmd, doc, phase: 'end', id: m.id, ok: r.ok });
  return r;
}
let buf = '', chain = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    chain = chain.then(() => handle(m)).then(r => { process.stdout.write(JSON.stringify({ ...r, id: m.id }) + '\n'); }).catch(() => {});
  }
});
process.stdin.on('end', () => chain.then(() => process.exit(0)));

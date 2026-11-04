'use strict';
// 1.0.10-local.2 "Check printers" (Ari OK 11:40, Nov 1). Settings > Printer & Drawer.
//  - list(): every Windows printer queue with its real driver, port, datatype and print processor, as the Air Max helper reads
//    them (read-only: nothing in Windows is changed). Flags: "(Copy N)" queues, "Generic / Text Only" drivers, a receipt printer
//    whose name says Star / Epson but whose driver does not, offline / paused queues, and a missing helper.
//  - a suggestion (the real Star futurePRNT / vendor queue). Air Max only switches its OWN printer setting after the cashier
//    confirms it on screen (the screen then saves it through the normal Settings save). Never automatic.
//  - tests(): plain text, logo (picture), long receipt and cut, sent direct and through the Windows driver; each step is
//    reported in plain words. The cash drawer is never opened here (it has its own button the cashier taps).
//  - report(): the last results as text, added to Save diagnostics.
// Print only: no sale, payment, total or stored record is touched.
const pc = require('./lib/printcmd');
const { isReceipt } = require('./lib/printing');
const { testPagePdf } = require('./lib/hardware');

const TEXT_ONLY_RE = /generic \/ text only|^tty$/i;
const COPY_RE = /\s*\(copy \d+\)\s*$/i;
const VENDORS = [ // a receipt printer's name -> what its own driver is called
  { id: 'star', name: /\bstar\b|\btsp\s?\d|\bsp7\d\d|\bmc-?print|\bmpop\b/i, driver: /star|tsp|futureprnt/i, label: 'Star', hint: 'the Star futurePRNT queue (driver "Star TSP100 ...")' },
  { id: 'epson', name: /\bepson\b|\btm-?[a-z]?\d/i, driver: /epson|tm-?[a-z]?\d|apd/i, label: 'Epson', hint: 'the Epson APD queue (driver "EPSON TM-...")' },
];
const vendorOf = s => VENDORS.find(v => v.name.test(String(s || ''))) || null;

function pdf(build, H) { // minimal one-page 80 mm PDF (226 pt wide); build(add) writes content ops
  const W = 226; let content = ''; build(op => { content += op + '\n'; }, W, H);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`];
  let s = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(s)); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(s);
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s).toString('base64');
}
const esc = s => String(s).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e]/g, '?');
function logoPdf(title) { // black block, stripes 1-4 pt and a frame to the paper edges: shows picture printing and clipping
  return pdf((add, W, H) => {
    add(`BT /F1 10 Tf 12 ${H - 20} Td (${esc(title)}) Tj ET`);
    add(`0 g 40 ${H - 80} ${W - 80} 44 re f`);
    add(`1 g BT /F1 16 Tf 62 ${H - 64} Td (AIR MAX LOGO) Tj ET 0 g`);
    for (let i = 0, x = 20; i < 8; i++, x += 8 + i) add(`${x} ${H - 120} ${1 + (i % 4)} 30 re f`);
    add(`2 w 3 3 ${W - 6} ${H - 140} re S`);
    add(`BT /F1 8 Tf 8 12 Td (|<- left edge          the frame should show on both sides          right edge ->|) Tj ET`);
  }, 170);
}
const STEPS = [
  { id: 'text', name: 'Plain text' }, { id: 'logo', name: 'Logo / picture' }, { id: 'long', name: 'Long receipt' }, { id: 'cut', name: 'Paper cut' },
];
const MODES = { raw: 'Direct to printer', driver: 'Windows driver' };

class PrinterCheck {
  constructor({ reg, log }) { this.reg = reg; this.log = log || (() => {}); this.lastList = null; this.lastRun = null; }
  helperOk() { return !!(this.reg.hw && this.reg.hw.present && this.reg.settings.hardware !== 'airpos'); }
  async list() {
    const reg = this.reg, at = new Date().toISOString();
    if (!this.helperOk()) {
      const airpos = reg.settings.hardware === 'airpos';
      const r = { ok: false, at, helperMissing: !airpos, queues: [], message: airpos
        ? 'Hardware is set to "AIR POS service", so Air Max does not read the Windows printers itself. Set Hardware to Automatic to check them.'
        : 'The Air Max printer helper (AirRegisterHw.exe) is missing or cannot run, so Air Max cannot read the Windows printers. Reinstall Air Max to put it back; until then receipts go through the AIR POS service if it is installed.' };
      this.lastList = r; return r;
    }
    let v; try { const r = await reg.hw.printers(reg.printerName()); v = r && r.ok ? r.value : null; if (!v) throw new Error((r && r.error) || 'no answer'); }
    catch (e) { const r = { ok: false, at, queues: [], message: 'Could not read the Windows printer list: ' + e.message }; this.lastList = r; return r; }
    const details = (v.details && v.details.length ? v.details : (v.printers || []).map(n => ({ name: n })));
    const current = reg.settings.printerConn === 'windows' ? (reg.printerName() || v.resolved || v.default || '') : '';
    const queues = details.map(d => this.flagsFor(d, current));
    const cur = queues.find(q => q.current) || null;
    const r = { ok: true, at, current, conn: reg.settings.printerConn, method: reg.settings.printMethod, queues, richDetails: details.some(d => d.datatype || d.printProcessor) };
    if (current && !cur) r.problem = `The receipt printer saved in Air Max ('${current}') is not in the Windows printer list.`;
    const bad = cur && cur.flags.filter(f => f.bad);
    if (!cur || (bad && bad.length)) r.suggest = this.suggest(queues, cur, current);
    r.message = !current ? 'Receipt printer is not a Windows printer (network / serial), so only the list is shown.'
      : r.problem || (bad && bad.length ? `Problem with the receipt printer '${current}': ${bad.map(f => f.text).join(' ')}` : `Receipt printer '${current}' looks right.`);
    this.lastList = r; return r;
  }
  flagsFor(d, current) {
    const flags = [], name = d.name || '', drv = d.driver || '';
    if (COPY_RE.test(name)) flags.push({ k: 'copy', bad: true, text: 'This queue is a Windows copy ("(Copy N)") of another printer; copies often end up with the wrong driver. Use the original queue.' });
    if (TEXT_ONLY_RE.test(drv)) flags.push({ k: 'textOnly', bad: true, text: 'It uses the "Generic / Text Only" driver: receipts come out as random symbols.' });
    const ven = vendorOf(name);
    if (ven && drv && !TEXT_ONLY_RE.test(drv) && !ven.driver.test(drv)) flags.push({ k: 'mismatch', bad: true, text: `Its name says ${ven.label} but its driver is "${drv}", not the ${ven.label} driver.` });
    if (d.workOffline) flags.push({ k: 'offline', bad: true, text: 'Windows has it set to "Use printer offline".' });
    if (d.paused) flags.push({ k: 'paused', bad: true, text: 'The queue is paused in Windows.' });
    if (d.problem) flags.push({ k: 'problem', bad: true, text: 'Windows reports a problem: ' + d.problem + '.' });
    if (d.virtual) flags.push({ k: 'virtual', bad: false, text: 'Not a real printer (' + (d.virtual === true ? 'PDF / XPS / OneNote / fax' : d.virtual) + ').' });
    return { name, driver: drv, port: d.port || '', datatype: d.datatype || '', printProcessor: d.printProcessor || '', status: d.status || '', jobs: d.jobs,
      receipt: d.receipt != null ? !!d.receipt : isReceipt(name, drv, d.port), virtual: !!d.virtual, current: !!current && name === current, flags };
  }
  suggest(queues, cur, current) {
    const ven = vendorOf(current) || vendorOf(cur && cur.driver);
    const ok = queues.filter(q => !q.current && !q.virtual && !q.flags.some(f => f.bad) && (ven ? ven.driver.test(q.driver) : q.receipt));
    if (!ok.length) return { none: true, why: ven ? `No working ${ven.label} queue found. Install the ${ven.label} driver (${ven.hint}) or ask for help; Air Max changes nothing in Windows.` : 'No other receipt printer queue with its own driver was found.' };
    const base = String(current || '').replace(COPY_RE, '').trim().toLowerCase();
    const pick = ok.find(q => q.name.toLowerCase() === base) || ok.find(q => q.port && cur && q.port === cur.port) || ok[0];
    return { name: pick.name, driver: pick.driver, port: pick.port, why: `'${pick.name}' uses its own ${ven ? ven.label + ' ' : ''}driver ("${pick.driver}")${pick.port ? ' on ' + pick.port : ''}.` };
  }
  stepJob(step, mode, n, total) {
    const title = `Air Max printer check ${n}/${total}: ${step.name} (${MODES[mode]})`;
    if (step.id === 'logo') return { title, pdf: logoPdf(title) };
    const lines = step.id === 'long'
      ? [title, ...Array.from({ length: 60 }, (_, i) => `Line ${String(i + 1).padStart(2, '0')} of 60  ....................`), 'End of the long receipt: all 60 lines should be here.']
      : step.id === 'cut' ? [title, 'The paper should be cut (or ready to tear) right below this line.', '----------------------------------']
        : [title, 'Plain text: ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz 0123456789', '$ 12.34   # @ % & * ( ) - + = / ?'];
    return { title, lines, pdf: testPagePdf(lines.flatMap(l => pc.wrap(l, 36))) };
  }
  async runStep(job, mode, label) {
    const reg = this.reg;
    if (mode === 'driver') {
      const to = await reg.textOnlyQueue(label); if (to) return to;
      return reg.hw.printPdf(job.pdf, reg.rawPrinterName());
    }
    if (reg.settings.printerConn === 'windows') { const to = await reg.textOnlyQueue(label, true); if (to) return to; }
    const p = await reg.profileNow();
    if (p.type === 'star' || job.lines == null) { const r = await reg.renderFor(p, job.pdf); if (!r.ok) return r; return reg.sendRaw(pc.raster(p, r.mono), label); }
    return reg.sendRaw(pc.textSlip(p, job.lines), label);
  }
  async tests(b = {}) {
    const reg = this.reg, at = new Date().toISOString();
    if (!this.helperOk()) { const r = { ok: false, at, steps: [], message: (await this.list()).message }; this.lastRun = r; return r; }
    const windows = reg.settings.printerConn === 'windows';
    const modes = (b.modes && b.modes.length ? b.modes : windows ? ['raw', 'driver'] : ['raw']).filter(m => MODES[m] && (m === 'raw' || windows));
    const total = modes.length * STEPS.length, steps = []; let n = 0;
    for (const mode of modes) for (const step of STEPS) {
      n++; const job = this.stepJob(step, mode, n, total), label = `printer check ${n}/${total} ${step.id} ${mode}`; const t0 = Date.now();
      let r; try { r = await this.runStep(job, mode, label); } catch (e) { r = { ok: false, error: e.message }; }
      const err = r && !r.ok ? String(r.error || r.message || 'no answer').replace(/\s*\[diag:[^\]]*\]/g, '') : '';
      steps.push({ n, step: step.id, name: step.name, mode, modeName: MODES[mode], ok: !!(r && r.ok), ms: Date.now() - t0, error: err });
      if (reg.diag) reg.diag(`${label}: ${r && r.ok ? 'sent ok' : 'FAIL ' + err}`); // every job is logged, also one that was cancelled after it started
    }
    const failed = steps.filter(s => !s.ok);
    const r = { ok: !failed.length, at, printer: reg.printerName(), steps,
      message: failed.length ? failed.map(s => `Step ${s.n} "${s.name}" (${s.modeName}) failed: ${s.error}`).join('\n')
        : `All ${steps.length} test slips were sent. Look at the paper: each slip shows its number 1-${steps.length}. A missing, cut-off or garbled slip is the step that failed (tell us its number).`,
      note: 'Paper cut through the Windows driver follows the driver\'s own cut setting (Star: Printing Preferences > Page cut type).' };
    this.lastRun = r; return r;
  }
  report() {
    const L = ['', '=== Check printers (Air Max 1.0.10-local.2) ==='];
    const l = this.lastList;
    if (!l) L.push('Printer list: not checked yet (Settings > Printer & Drawer > Check printers).');
    else {
      L.push(`Checked ${l.at}: ${l.message}`);
      for (const q of l.queues || []) L.push(`  ${q.current ? '*' : '-'} ${q.name} | driver: ${q.driver || '?'} | port: ${q.port || '?'} | datatype: ${q.datatype || '?'} | print processor: ${q.printProcessor || '?'}${q.flags.length ? ' | ' + q.flags.map(f => f.k).join(', ') : ''}`);
      if (l.suggest) L.push('  Suggested: ' + (l.suggest.name ? `${l.suggest.name} (${l.suggest.why})` : l.suggest.why));
    }
    const t = this.lastRun;
    if (!t) L.push('Print tests: not run.');
    else { L.push(`Print tests ${t.at} on '${t.printer || ''}':`); for (const s of t.steps || []) L.push(`  ${s.n}. ${s.name} (${s.modeName}): ${s.ok ? 'sent ok' : 'FAILED: ' + s.error} [${s.ms} ms]`); }
    return L.join('\r\n');
  }
}
module.exports = { PrinterCheck, STEPS, MODES, logoPdf };

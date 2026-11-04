// Receipt-printer command sets, built as plain bytes so they can be tested byte-for-byte (tests/printcmd.test.js).
//   epson   : Epson ESC/POS. Tuned for the TM-T20II (Ari's "M267D" sticker): 80 mm, 576 dots, 48 chars Font A,
//             autocutter (GS V 66 3), drawer on the RJ11 port (ESC p). Same commands work on TM-T20/T20III/T88/m30.
//   generic : ESC/POS clones (the "M804", Xprinter, HOIN, Rongta, "POS-80" ...). Same commands as Epson plus
//             FS . (leave Chinese double-byte mode, which many clones start in), smaller image bands, and options:
//             chars per line 48/42/32, cut on/off, drawer pin 2/5, code page, image command GS v 0 or ESC * (old clones).
//   star    : Star TSP100 / TSP143 (futurePRNT). These are raster-only ("Star Graphic Mode"), so everything,
//             test page and notes included, is sent as a picture: ESC * r A ... b n1 n2 data ... ESC FF EOT, ESC * r B.
// Drawer kick: ESC p m 25 250 (m 0 = connector pin 2, m 1 = pin 5; standard 50 ms on / 500 ms off, longer pulse optional);
//              Star: BEL (drawer 1) / SUB (drawer 2), or ESC * r D n NUL at the start of a raster job.
'use strict';
const ESC = 0x1b, GS = 0x1d, FS = 0x1c;

// chars per line -> printable width in dots (Font A is 12 dots wide)
const WIDTH = { 48: 576, 42: 512, 32: 384 };
const CODEPAGE = { pc437: 0, pc850: 2, pc858: 19, wpc1252: 16 };
const TYPES = ['auto', 'epson', 'generic', 'star'];
// the few accented letters receipts actually use, for the DOS code pages (wpc1252 is Latin-1 for these)
const DOS = { 'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97, 'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, '£': 0x9c, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, '¿': 0xa8, '¡': 0xad };
const DOS850 = { ...DOS, 'ø': 0x9b, 'Ø': 0x9d, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, '©': 0xb8, 'ã': 0xc6, 'Ã': 0xc7, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, 'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ó': 0xe0, 'ß': 0xe1, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4, 'Õ': 0xe5, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb, 'ý': 0xec, 'Ý': 0xed };
const PUNCT = { '\u2014': 0x2d, '\u2013': 0x2d, '\u2019': 0x27, '\u2018': 0x27, '\u201c': 0x22, '\u201d': 0x22, '\u00a0': 0x20, '\t': 0x20 };
// text -> printer bytes. Control characters typed by a user (ESC, GS ...) never reach the printer: they become '?'.
function encode(text, cp = 'pc437') {
  const out = [];
  for (const ch of String(text).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (ch === '\n') { out.push(0x0a); continue; }
    if (c >= 0x20 && c < 0x7f) { out.push(c); continue; }
    if (PUNCT[ch] != null) { out.push(PUNCT[ch]); continue; }
    if (ch === '€') { out.push(cp === 'pc858' ? 0xd5 : cp === 'wpc1252' ? 0x80 : 0x45); continue; }
    if (cp === 'wpc1252') { out.push(c >= 0xa1 && c <= 0xff ? c : 0x3f); continue; }
    const m = (cp === 'pc437' ? DOS : DOS850)[ch]; out.push(m != null ? m : 0x3f);
  }
  return out;
}

// settings (Register.settings.printer) -> a concrete profile. `type` must already be resolved (see guessType).
function profile(o = {}) {
  const type = ['epson', 'generic', 'star'].includes(o.type) ? o.type : 'epson';
  let cols = [48, 42, 32].includes(Number(o.cols)) ? Number(o.cols) : 48;
  if (type === 'star') cols = 48; // TSP100: 72 mm print width, 576 dots
  const pin = String(o.pin) === '5' ? 5 : 2;
  const pulse = o.pulse == null ? null : pulseMs(o.pulse);
  const cut = type === 'generic' ? o.cut !== false : true; // TM-T20II and TSP100 always have a cutter
  const codePage = CODEPAGE[o.codePage] != null ? o.codePage : 'pc437';
  const image = type === 'generic' && o.image === 'escstar' ? 'escstar' : type === 'star' ? 'star' : 'gsv0';
  return { type, cols, dots: WIDTH[cols], cut, pin, pulse, codePage, image, band: type === 'generic' ? 64 : 256,
    label: type === 'star' ? 'Star TSP100 (raster)' : type === 'generic' ? 'Generic ESC/POS' : 'Epson TM-T20II (ESC/POS)' };
}

const b = (...a) => a.flat();
const ascii = s => [...String(s)].map(c => c.charCodeAt(0));
// ---------------- drawer ----------------
// Standard pulse: ESC p m 25 250 = 50 ms on, 500 ms off (the usual Epson / ESC-POS value, same as python-escpos and
// most POS software). Star: BEL / SUB use the printer's own drive time (memory switch, Star default); a longer pulse
// for drawer 1 is set with ESC BEL n1 n2 (n1 x 10 ms on, n2 x 10 ms delay; Star default n2 = 20) only when chosen.
const PULSES = [50, 100, 200, 250];
const DEF_PULSE = 50;
function pulseMs(v) { const n = Number(v); return PULSES.includes(n) ? n : DEF_PULSE; }
function drawer(p) {
  const ms = pulseMs(p.pulse);
  if (p.type === 'star') {
    if (p.pin === 5) return [0x1a];
    return ms === DEF_PULSE || p.pulse == null ? [0x07] : [ESC, 0x07, ms / 10, 20, 0x07];
  }
  return [ESC, 0x70, p.pin === 5 ? 1 : 0, ms / 2, 250];
}

// ---------------- text slips (ESC/POS only; Star gets the same lines as a picture) ----------------
function init(p) { return p.type === 'generic' ? [ESC, 0x40, FS, 0x2e, ESC, 0x74, CODEPAGE[p.codePage]] : [ESC, 0x40, ESC, 0x74, CODEPAGE[p.codePage]]; }
const align = n => [ESC, 0x61, n];
const bold = on => [ESC, 0x45, on ? 1 : 0];
const big = on => [GS, 0x21, on ? 0x11 : 0x00];
function cut(p) { return p.cut ? [GS, 0x56, 66, 3] : [ESC, 0x64, 5]; } // feed to the cutter + partial cut / just feed past the tear bar
function barcode128(data) {
  const d = ascii(data).filter(c => c >= 0x20 && c < 0x7f).slice(0, 40);
  return b(align(1), [GS, 0x48, 2, GS, 0x68, 80, GS, 0x77, 2, GS, 0x6b, 73, d.length + 2, 0x7b, 0x42], d, [0x0a]); // GS k 73 {B
}
const wrap = (s, w) => { const out = []; String(s).split(/\r?\n/).forEach(par => { let line = ''; par.split(/[ \t]+/).forEach(word => { while (word.length > w) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, w)); word = word.slice(w); } if ((line + ' ' + word).trim().length > w) { if (line) out.push(line); line = word; } else line = (line + ' ' + word).trim(); }); out.push(line); }); return out; };
function textSlip(p, lines, { title, kick } = {}) {
  if (p.type === 'star') throw new Error('Star printers take pictures only: use raster()');
  const body = lines.flatMap(l => wrap(l, p.cols));
  return Buffer.from(b(init(p), kick ? drawer(p) : [], title ? b(align(1), bold(true), encode(title + '\n', p.codePage), bold(false)) : [], align(0), encode(body.join('\n') + '\n', p.codePage), cut(p)));
}
function testLines(p, info = {}) {
  return [`Printer: ${info.printer || '(automatic)'}`, `Type: ${p.label}${info.auto ? ' (picked automatically)' : ''}`, `Width: ${p.cols} characters, ${p.dots} dots`,
    p.type === 'star' ? 'Drawer: ' + (p.pin === 5 ? 'drawer 2' : 'drawer 1') : `Code page: ${p.codePage}   Cut: ${p.cut ? 'on' : 'off'}   Drawer pin: ${p.pin}`,
    info.via ? 'Sent by: ' + info.via : '', info.shop ? 'Store: ' + info.shop : '', new Date(info.time || Date.now()).toLocaleString('en-US')].filter(Boolean);
}
function testPage(p, info = {}) {
  if (p.type === 'star') throw new Error('Star printers take pictures only: use raster()');
  const line = '-'.repeat(p.cols);
  const ruler = '1234567890'.repeat(Math.ceil(p.cols / 10)).slice(0, p.cols);
  return Buffer.from(b(init(p), align(1), big(true), encode('TEST PAGE\n', p.codePage), big(false), bold(true), encode('Air Max\n', p.codePage), bold(false), align(0), // ls9n~
    encode([...testLines(p, info), line, ruler, 'Accents: café niño €', line].join('\n') + '\n', p.codePage), barcode128(info.barcode || 'AIRREG-TEST'), align(0),
    encode('If the ruler fits on one line and the barcode prints, the settings are right.\n', p.codePage), cut(p)));
}

// ---------------- raster (server receipt PDF -> 1-bit picture -> printer) ----------------
// mono: { width (multiple of 8), height, data: Buffer, rows MSB-first, 1 = black } (from the helper's renderMono)
function fit(mono, dots) { // crop or pad each row to the head width (helper renders at p.dots, so this is normally a no-op)
  const wb = mono.width / 8, ob = dots / 8; if (wb === ob) return mono;
  const out = Buffer.alloc(ob * mono.height);
  for (let y = 0; y < mono.height; y++) mono.data.copy(out, y * ob, y * wb, y * wb + Math.min(wb, ob));
  return { width: dots, height: mono.height, data: out };
}
const starNum = (cmd, n) => b([ESC, 0x2a, 0x72, cmd.charCodeAt(0)], ascii(String(n)), [0]); // ESC * r <cmd> "<n>" NUL
function raster(p, mono0, { kick } = {}) {
  const mono = fit(mono0, p.dots), wb = mono.width / 8, parts = [];
  if (p.type === 'star') {
    parts.push(Buffer.from(b([ESC, 0x2a, 0x72, 0x52], [ESC, 0x2a, 0x72, 0x41], starNum('P', 0), starNum('E', p.cut ? 13 : 2), kick ? starNum('D', p.pin === 5 ? 2 : 1) : [])));
    for (let y = 0; y < mono.height; y++) {
      const row = mono.data.subarray(y * wb, (y + 1) * wb); let n = wb; while (n > 1 && row[n - 1] === 0) n--; // trailing white is implied
      parts.push(Buffer.from([0x62, n & 0xff, n >> 8])); parts.push(row.subarray(0, n));
    }
    parts.push(Buffer.from([ESC, 0x0c, 0x04, ESC, 0x2a, 0x72, 0x42])); // execute EOT (feed + cut), leave raster mode
    return Buffer.concat(parts);
  }
  parts.push(Buffer.from(b(init(p), kick ? drawer(p) : [])));
  if (p.image === 'escstar') { // ESC * 33: 24-dot double-density columns, for old clones without GS v 0
    parts.push(Buffer.from([ESC, 0x33, 24]));
    for (let y = 0; y < mono.height; y += 24) {
      const col = Buffer.alloc(mono.width * 3);
      for (let x = 0; x < mono.width; x++) for (let k = 0; k < 24 && y + k < mono.height; k++)
        if (mono.data[(y + k) * wb + (x >> 3)] & (0x80 >> (x & 7))) col[x * 3 + (k >> 3)] |= 0x80 >> (k & 7);
      parts.push(Buffer.from([ESC, 0x2a, 33, mono.width & 0xff, mono.width >> 8])); parts.push(col); parts.push(Buffer.from([0x0a]));
    }
    parts.push(Buffer.from([ESC, 0x32]));
  } else {
    for (let y = 0; y < mono.height; y += p.band) { // GS v 0 m xL xH yL yH d...
      const h = Math.min(p.band, mono.height - y);
      parts.push(Buffer.from([GS, 0x76, 0x30, 0, wb & 0xff, wb >> 8, h & 0xff, h >> 8])); parts.push(mono.data.subarray(y * wb, (y + h) * wb));
    }
  }
  parts.push(Buffer.from(cut(p)));
  return Buffer.concat(parts);
}

// printer type for "Auto", from the Windows queue name, driver name and port
function guessType(name, driver = '', port = '') {
  const n = [name, driver].map(x => String(x || '')).join(' | ');
  if (/(^|[^a-z])star([^a-z]|$)|tsp ?\d|futureprnt|mc-?print|(^|[^a-z])sp7\d\d/i.test(n)) return 'star'; // '_' counts as a separator (CUPS / share names)
  if (/epson|\btm-?[tmhlpu]\d|\bm267/i.test(n) || /^ESDPRT/i.test(String(port || ''))) return 'epson';
  return 'generic';
}
module.exports = { PULSES, DEF_PULSE, pulseMs, WIDTH, CODEPAGE, TYPES, profile, drawer, textSlip, testLines, testPage, raster, guessType, encode, wrap, init, cut };

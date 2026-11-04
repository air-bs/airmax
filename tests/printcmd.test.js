// Byte-level tests of the receipt printer commands (app/lib/printcmd.js). Run: node tests/printcmd.test.js
'use strict';
const assert = require('assert');
const pc = require('../app/lib/printcmd');
const ESC = 0x1b, GS = 0x1d, FS = 0x1c;
let n = 0, bad = 0;
const t = (name, fn) => { n++; try { fn(); console.log('ok   ' + name); } catch (e) { bad++; console.log('FAIL ' + name + '\n     ' + e.message); } };
const hex = b => Buffer.from(b).toString('hex');
const has = (buf, seq) => Buffer.from(buf).indexOf(Buffer.from(seq)) >= 0;
const at = (buf, seq) => Buffer.from(buf).indexOf(Buffer.from(seq));
// a 576x3 test picture: row0 all black, row1 first byte only, row2 white
const mono = (w = 576, rows = [0xff, 0x80, 0x00]) => { const wb = w / 8, d = Buffer.alloc(wb * rows.length); rows.forEach((r, y) => { if (r === 0xff) d.fill(0xff, y * wb, (y + 1) * wb); else d[y * wb] = r; }); return { width: w, height: rows.length, data: d }; };

// ---------------- Epson TM-T20II ----------------
const ep = pc.profile({ type: 'epson' });
t('TM-T20II profile: 48 cols, 576 dots, cutter, pin 2, PC437', () => assert.deepStrictEqual([ep.cols, ep.dots, ep.cut, ep.pin, ep.codePage, ep.image], [48, 576, true, 2, 'pc437', 'gsv0']));
t('TM-T20II cutter cannot be turned off by mistake', () => assert.strictEqual(pc.profile({ type: 'epson', cut: false }).cut, true));
t('TM-T20II drawer: ESC p 0 25 250 (pin 2, standard 50 ms / 500 ms pulse)', () => assert.strictEqual(hex(pc.drawer(ep)), '1b700019fa'));
t('TM-T20II drawer pin 5: ESC p 1 25 250', () => assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'epson', pin: 5 }))), '1b700119fa'));
t('TM-T20II text slip: ESC @, ESC t 0, text, GS V 66 3 at the end, no FS .', () => {
  const b = pc.textSlip(ep, ['Hello']);
  assert.strictEqual(hex(b.subarray(0, 5)), '1b401b7400');
  assert.ok(!has(b, [FS, 0x2e]));
  assert.ok(has(b, Buffer.from('Hello\n')));
  assert.strictEqual(hex(b.subarray(-4)), '1d564203');
});
t('TM-T20II text slip with kick: drawer right after init', () => assert.strictEqual(hex(pc.textSlip(ep, ['x'], { kick: true }).subarray(0, 10)), '1b401b74001b700019fa'));
t('TM-T20II raster: GS v 0 0 72 0 3 0 + 216 data bytes, then cut', () => {
  const b = pc.raster(ep, mono());
  assert.strictEqual(hex(b.subarray(0, 5)), '1b401b7400');
  assert.strictEqual(hex(b.subarray(5, 13)), '1d76300048000300');
  assert.strictEqual(b.length, 5 + 8 + 216 + 4);
  assert.strictEqual(b[13], 0xff); assert.strictEqual(b[13 + 72], 0x80); assert.strictEqual(b[13 + 144], 0);
  assert.strictEqual(hex(b.subarray(-4)), '1d564203');
});
t('TM-T20II raster splits tall receipts into 256-row bands', () => {
  const m = { width: 576, height: 600, data: Buffer.alloc(72 * 600) };
  const b = pc.raster(ep, m);
  assert.strictEqual(b.length, 5 + 3 * 8 + 72 * 600 + 4);
  assert.strictEqual(hex(b.subarray(5, 13)), '1d76300048000001'); // 256 rows
  assert.strictEqual(hex(b.subarray(5 + 8 + 72 * 256, 5 + 16 + 72 * 256)), '1d76300048000001');
  assert.strictEqual(hex(b.subarray(5 + 16 + 72 * 512, 5 + 24 + 72 * 512)), '1d76300048005800'); // 88 rows
});
t('TM-T20II raster with kick: drawer before the picture (drawer opens while it prints)', () => assert.ok(at(pc.raster(ep, mono(), { kick: true }), [ESC, 0x70, 0, 25, 250]) === 5));
t('Wider render is cropped to the head width', () => { const b = pc.raster(ep, mono(640)); assert.strictEqual(hex(b.subarray(5, 13)), '1d76300048000300'); assert.strictEqual(b.length, 5 + 8 + 216 + 4); });
t('Test page: ruler is exactly 48 chars, CODE128 barcode, cut', () => {
  const b = pc.testPage(ep, { printer: 'EPSON TM-T20II Receipt' });
  assert.ok(has(b, Buffer.from('\n' + '1234567890'.repeat(5).slice(0, 48) + '\n')));
  assert.ok(has(b, [GS, 0x6b, 73, 13, 0x7b, 0x42, ...Buffer.from('AIRREG-TEST')]));
  assert.ok(has(b, Buffer.from('EPSON TM-T20II Receipt')));
  assert.strictEqual(hex(b.subarray(-4)), '1d564203');
});

// ---------------- Generic ESC/POS (M804 and clones) ----------------
const ge = pc.profile({ type: 'generic' });
t('Generic init: ESC @, FS . (leave Chinese mode), ESC t 0', () => assert.strictEqual(hex(pc.init(ge)), '1b401c2e1b7400'));
t('Generic 42 cols -> 512 dots, 32 cols -> 384 dots', () => { assert.strictEqual(pc.profile({ type: 'generic', cols: 42 }).dots, 512); assert.strictEqual(pc.profile({ type: 'generic', cols: '32' }).dots, 384); });
t('Generic cut off: feed 5 lines (ESC d 5), no GS V', () => { const b = pc.textSlip(pc.profile({ type: 'generic', cut: false }), ['x']); assert.strictEqual(hex(b.subarray(-3)), '1b6405'); assert.ok(!has(b, [GS, 0x56])); });
t('Generic cut on: GS V 66 3', () => assert.strictEqual(hex(pc.textSlip(ge, ['x']).subarray(-4)), '1d564203'));
t('Generic drawer pin 5: ESC p 1 25 250', () => assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'generic', pin: '5' }))), '1b700119fa'));
t('Code pages: PC850 = ESC t 2, PC858 = 19, WPC1252 = 16', () => {
  assert.strictEqual(hex(pc.init(pc.profile({ type: 'generic', codePage: 'pc850' }))), '1b401c2e1b7402');
  assert.strictEqual(hex(pc.init(pc.profile({ type: 'generic', codePage: 'pc858' }))), '1b401c2e1b7413');
  assert.strictEqual(hex(pc.init(pc.profile({ type: 'generic', codePage: 'wpc1252' }))), '1b401c2e1b7410');
  assert.strictEqual(pc.profile({ type: 'generic', codePage: 'bogus' }).codePage, 'pc437');
});
t('Accents/euro follow the code page', () => {
  assert.deepStrictEqual(pc.encode('é€', 'pc437'), [0x82, 0x45]);
  assert.deepStrictEqual(pc.encode('é€', 'pc858'), [0x82, 0xd5]);
  assert.deepStrictEqual(pc.encode('é€', 'wpc1252'), [0xe9, 0x80]);
});
t('Typed control characters never reach the printer', () => assert.deepStrictEqual(pc.encode('a\x1bp\x00b'), [0x61, 0x3f, 0x70, 0x3f, 0x62]));
t('Generic 32 cols: lines wrap at 32', () => { const b = pc.textSlip(pc.profile({ type: 'generic', cols: 32 }), ['word '.repeat(20)]); const lines = b.toString('latin1').split('\n'); assert.ok(lines.slice(1, -1).every(l => l.length <= 32)); });
t('Generic raster: GS v 0 in 64-row bands', () => {
  const m = { width: 576, height: 100, data: Buffer.alloc(72 * 100) };
  const b = pc.raster(ge, m);
  assert.strictEqual(hex(b.subarray(0, 7)), '1b401c2e1b7400');
  assert.strictEqual(hex(b.subarray(7, 15)), '1d76300048004000');
  assert.strictEqual(hex(b.subarray(15 + 72 * 64, 23 + 72 * 64)), '1d76300048002400');
});
t('Generic ESC * image mode: ESC 3 24, ESC * 33 576 cols x 3 bytes, ESC 2', () => {
  const p = pc.profile({ type: 'generic', image: 'escstar' });
  const b = pc.raster(p, mono());
  assert.strictEqual(hex(b.subarray(7, 10)), '1b3318');
  assert.strictEqual(hex(b.subarray(10, 15)), '1b2a214002');
  // column 0: rows 0 and 1 black -> first byte 0b11000000; column 1: only row 0 -> 0b10000000
  assert.strictEqual(b[15], 0xc0); assert.strictEqual(b[18], 0x80);
  assert.strictEqual(b[15 + 1728], 0x0a);
  assert.strictEqual(hex(b.subarray(16 + 1728, 18 + 1728)), '1b32');
});
t('ESC * mode only applies to generic', () => assert.strictEqual(pc.profile({ type: 'epson', image: 'escstar' }).image, 'gsv0'));

// ---------------- Star TSP100 ----------------
const st = pc.profile({ type: 'star', cols: 32 });
t('Star profile: always 576 dots, raster, cutter', () => assert.deepStrictEqual([st.cols, st.dots, st.image, st.cut], [48, 576, 'star', true]));
t('Star drawer: BEL (drawer 1), SUB (drawer 2)', () => { assert.strictEqual(hex(pc.drawer(st)), '07'); assert.strictEqual(hex(pc.drawer(pc.profile({ type: 'star', pin: 5 }))), '1a'); });
t('Star text slip is refused (TSP100 is raster only)', () => { assert.throws(() => pc.textSlip(st, ['x'])); assert.throws(() => pc.testPage(st)); });
t('Star raster: ESC*rR, ESC*rA, ESC*rP"0", ESC*rE"13", rows "b n1 n2" trimmed, ESC FF EOT, ESC*rB', () => {
  const b = pc.raster(st, mono());
  const head = '1b2a7252' + '1b2a7241' + '1b2a7250' + '3000' + '1b2a7245' + '313300';
  assert.strictEqual(hex(b.subarray(0, head.length / 2)), head);
  let o = head.length / 2;
  assert.strictEqual(hex(b.subarray(o, o + 3)), '624800'); o += 3 + 72;      // full black row: 72 bytes
  assert.strictEqual(hex(b.subarray(o, o + 4)), '62010080'); o += 4;         // one byte, trailing white trimmed
  assert.strictEqual(hex(b.subarray(o, o + 4)), '62010000'); o += 4;         // white row keeps 1 byte
  assert.strictEqual(hex(b.subarray(o)), '1b0c041b2a7242');
});
t('Star raster with kick: ESC*rD"1" before the first row; no ESC/POS bytes anywhere', () => {
  const b = pc.raster(st, mono(576, [0, 0]), { kick: true });
  assert.ok(has(b.subarray(0, 40), [ESC, 0x2a, 0x72, 0x44, 0x31, 0]));
  assert.ok(!has(b, [ESC, 0x40]) && !has(b, [GS, 0x56]) && !has(b, [ESC, 0x70]));
});

// ---------------- Auto detection ----------------
t('Auto: Epson names/drivers/ports -> epson', () => {
  assert.strictEqual(pc.guessType('EPSON TM-T20II Receipt'), 'epson');
  assert.strictEqual(pc.guessType('Receipt', 'EPSON TM-T20II Receipt5'), 'epson');
  assert.strictEqual(pc.guessType('M267D'), 'epson');
  assert.strictEqual(pc.guessType('Front', 'Generic / Text Only', 'ESDPRT001'), 'epson');
});
t('Auto: Star names/drivers -> star', () => { assert.strictEqual(pc.guessType('Star TSP100 Cutter (TSP143)'), 'star'); assert.strictEqual(pc.guessType('Receipt', 'TSP143IIIU'), 'star'); assert.strictEqual(pc.guessType('Star_TSP100_Cutter_TSP143'), 'star'); assert.strictEqual(pc.guessType('Startech POS'), 'generic'); });
t('Auto: M804 / POS-80 / Generic Text Only -> generic', () => { for (const x of ['M804', 'POS-80', 'POS80 Printer', 'XP-80C']) assert.strictEqual(pc.guessType(x, 'Generic / Text Only', 'USB001'), 'generic'); });

console.log(`\n${n - bad}/${n} printer command tests passed`);
process.exit(bad ? 1 : 0);

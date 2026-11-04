// Air Register 1.2.1: the store's own welcome message and logo on the customer screen. Offline, no AIR POS.
// Run: node tests/customer-welcome-logo.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), http = require('http'), { spawn } = require('child_process');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = []; const q = [];
const t = (name, fn) => q.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-cw-'));
const mk = (dir, who = 'manager') => { const r = new Register({ log: () => {}, dataDir: dir }); if (who === 'manager') r.identity = { superAdmin: true }; else if (who === 'cashier') { r.identity = { superAdmin: false }; r.home = { authorities: [] }; } return r; };
const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const png = (w, h) => { const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const raw = Buffer.alloc((w * 3 + 1) * h, 0x80); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); };
const jpg = (w, h) => { const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]); return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), sof, Buffer.from([0xff, 0xd9])]); };
const d64 = (b, mime = 'image/png') => 'data:' + mime + ';base64,' + b.toString('base64');
const PNG = png(4, 3), JPG = jpg(5, 6);
const logoFiles = dir => fs.readdirSync(dir).filter(f => f.startsWith('customer-logo'));

t('1 no settings: welcome "", welcome2 "", logo null (today\'s screen)', () => {
  const c = mk(tmp()).customerState(); assert.strictEqual(c.welcome, ''); assert.strictEqual(c.welcome2, ''); assert.strictEqual(c.logo, null); assert.strictEqual(c.view, 'idle');
});
t('2 message + second line saved; over 40 / 80 refused; line breaks and control characters stripped', () => {
  const dir = tmp(), r = mk(dir);
  assert.ok(r.saveSettings({ custWelcome: '  Welcome to\nTestShop!\u0007 ', custWelcome2: 'Have a\r\ngreat day\t' }).ok);
  assert.strictEqual(r.settings.custWelcome, 'Welcome to TestShop!'); assert.strictEqual(r.settings.custWelcome2, 'Have a great day');
  const f = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))); assert.strictEqual(f.custWelcome, 'Welcome to TestShop!');
  assert.ok(r.saveSettings({ custWelcome: 'x'.repeat(40), custWelcome2: 'y'.repeat(80) }).ok);
  let x = r.saveSettings({ custWelcome: 'x'.repeat(41) }); assert.strictEqual(x.ok, false); assert.match(x.message, /40/);
  x = r.saveSettings({ custWelcome2: 'y'.repeat(81) }); assert.strictEqual(x.ok, false); assert.match(x.message, /80/);
  assert.strictEqual(r.settings.custWelcome, 'x'.repeat(40), 'old value kept after a refused save');
});
t('3 <script> text saved and returned exactly as typed (plain text)', () => {
  const r = mk(tmp()); assert.ok(r.saveSettings({ custWelcome: '<script>alert(1)</script>' }).ok);
  assert.strictEqual(r.customerState().welcome, '<script>alert(1)</script>');
});
t('4 welcome returned while logged out, with no sale lines or totals', () => {
  const r = mk(tmp()); r.saveSettings({ custWelcome: 'Hi', custWelcome2: 'There' }); r.state = () => ({ loggedIn: false, user: null, cart: [{ name: 'X', quantity: 1, price: 1, total: 1 }] });
  const c = r.customerState(); assert.strictEqual(c.welcome, 'Hi'); assert.strictEqual(c.welcome2, 'There'); assert.deepStrictEqual(c.lines, []); assert.strictEqual(c.totals, null); assert.strictEqual(c.pay, null);
});
t('5 small PNG and JPG accepted, file written, logo has ?v= checksum', () => {
  const dir = tmp(), r = mk(dir);
  assert.ok(r.saveSettings({ custLogo: d64(PNG) }).ok); assert.deepStrictEqual(logoFiles(dir), ['customer-logo.png']);
  assert.ok(fs.readFileSync(path.join(dir, 'customer-logo.png')).equals(PNG)); assert.match(r.customerState().logo, /^\/customer-logo\?v=[0-9a-f]{12}$/);
  assert.ok(r.saveSettings({ custLogo: d64(JPG, 'image/jpeg') }).ok); assert.deepStrictEqual(logoFiles(dir), ['customer-logo.jpg']); assert.strictEqual(r.settings.custLogo.type, 'jpg');
  assert.ok(!('custLogo' in JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))) && JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))).custLogo).length > 200), 'no picture inside settings.json');
});
t('6 refused: SVG, GIF, fake .png, over 500 KB, over 2000x2000, empty / damaged base64', () => {
  const dir = tmp(), r = mk(dir); r.saveSettings({ custLogo: d64(PNG) }); const before = r.settings.custLogo.hash;
  const bads = [
    d64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml'),
    d64(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1'), 'image/gif'),
    d64(Buffer.from('hello this is a text file renamed to .png')),
    d64(Buffer.concat([PNG, Buffer.alloc(501 * 1024)])),
    d64(png(2001, 10)), d64(jpg(10, 2400), 'image/jpeg'),
    '', 'data:image/png;base64,', 'data:image/png;base64,@@@!!', d64(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  ];
  for (const v of bads) { const x = r.saveSettings({ custLogo: v }); assert.strictEqual(x.ok, false, 'should refuse: ' + String(v).slice(0, 40)); }
  assert.strictEqual(r.settings.custLogo.hash, before, 'old logo kept'); assert.deepStrictEqual(logoFiles(dir), ['customer-logo.png']);
});
t('7 cashier and logged-out user cannot change message or logo; other settings still work', () => {
  for (const who of ['cashier', 'none']) {
    const dir = tmp(), r = mk(dir, who);
    assert.strictEqual(r.saveSettings({ custWelcome: 'Nope' }).ok, false); assert.strictEqual(r.saveSettings({ custLogo: d64(PNG) }).ok, false);
    assert.deepStrictEqual(logoFiles(dir), []); assert.ok(!r.settings.custWelcome);
    assert.ok(r.saveSettings({ customerDisplay: false, touchKeyboard: 'off' }).ok); assert.strictEqual(r.settings.touchKeyboard, 'off');
    assert.ok(r.saveSettings({ customerDisplay: true, custWelcome: '', custWelcome2: '' }).ok, 'unchanged (empty) branding fields do not block a cashier save');
  }
});
t('8 Remove logo deletes the file and sets logo null', () => {
  const dir = tmp(), r = mk(dir); r.saveSettings({ custLogo: d64(PNG) }); assert.ok(r.saveSettings({ custLogoRemove: true }).ok);
  assert.deepStrictEqual(logoFiles(dir), []); assert.strictEqual(r.customerState().logo, null); assert.strictEqual(r.customerLogoFile(), null);
});
t('9 replaced logo gets a new checksum; old file gone; no temp file left', () => {
  const dir = tmp(), r = mk(dir); r.saveSettings({ custLogo: d64(PNG) }); const a = r.customerState().logo;
  r.saveSettings({ custLogo: d64(png(8, 8)) }); const b = r.customerState().logo; assert.notStrictEqual(a, b);
  assert.deepStrictEqual(logoFiles(dir), ['customer-logo.png']); assert.ok(fs.readFileSync(path.join(dir, 'customer-logo.png')).equals(png(8, 8)));
});
t('10 old settings.json without the new keys loads fine', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ printerName: 'P', customerDisplay: true, registerMode: false }));
  const r = mk(dir); assert.strictEqual(r.settings.printerName, 'P'); const c = r.customerState(); assert.strictEqual(c.welcome, ''); assert.strictEqual(c.logo, null);
  assert.ok(r.saveSettings({ custWelcome: 'Hi' }).ok); const f = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'))); assert.strictEqual(f.printerName, 'P'); assert.strictEqual(f.customerDisplay, true);
});

const get = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(b) })); }).on('error', rej));
async function serverTest() {
  const name = '11 GET /customer-logo: right Content-Type, nosniff, 404 with no logo, ?f=../settings.json ignored';
  n++; const dir = tmp(), port = Number(process.env.LOGO_PORT || 5185), cfgp = path.join(dir, 'config.json');
  fs.writeFileSync(cfgp, JSON.stringify({ port, build: 'dev', blockedCompanies: [], updateFeedUrl: 'http://127.0.0.1:1/' }));
  const p = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], { env: { ...process.env, AIRREG_CONFIG: cfgp, AIRREG_DATA: dir }, stdio: 'ignore' });
  try {
    let ok = false; for (let i = 0; i < 50 && !ok; i++) { await new Promise(r => setTimeout(r, 100)); ok = await get(port, '/api/customer-state').then(() => true, () => false); }
    let r = await get(port, '/customer-logo'); assert.strictEqual(r.status, 404); assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    p.kill(); await new Promise(r => setTimeout(r, 300));
    fs.writeFileSync(path.join(dir, 'customer-logo.png'), PNG); fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ custLogo: { type: 'png', bytes: PNG.length, hash: 'abc123abc123' } }));
    const p2 = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], { env: { ...process.env, AIRREG_CONFIG: cfgp, AIRREG_DATA: dir }, stdio: 'ignore' });
    try {
      ok = false; for (let i = 0; i < 50 && !ok; i++) { await new Promise(r => setTimeout(r, 100)); ok = await get(port, '/api/customer-state').then(() => true, () => false); }
      const cs = JSON.parse((await get(port, '/api/customer-state')).body); assert.strictEqual(cs.logo, '/customer-logo?v=abc123abc123');
      r = await get(port, '/customer-logo?v=abc123abc123'); assert.strictEqual(r.status, 200); assert.strictEqual(r.headers['content-type'], 'image/png'); assert.strictEqual(r.headers['x-content-type-options'], 'nosniff'); assert.ok(r.body.equals(PNG));
      r = await get(port, '/customer-logo?f=../settings.json&file=settings.json'); assert.ok(r.body.equals(PNG), 'query ignored, still the logo');
    } finally { p2.kill(); }
    out.push({ k: name, pass: true }); console.log('ok   ' + name);
  } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } finally { p.kill(); }
}
(async () => {
  for (const [name, fn] of q) { n++; try { fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } }
  await serverTest();
  console.log(`\n${n - bad}/${n} passed`); fs.writeFileSync(path.join(__dirname, 'customer-welcome-logo-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: n - bad, total: n, out }, null, 2));
  process.exit(bad ? 1 : 0);
})();

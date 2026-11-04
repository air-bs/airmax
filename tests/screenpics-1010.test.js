// 1.0.10 (Ari OK 11:12 AM ET Oct 30): offline checks for the welcome picture + register logo storage (app/screenpics.js)
// and the read-only server routes. No AIR POS, no network. Server part uses PIC_PORT (default 5187).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const { ScreenPics, sniff, MAX_BYTES } = require('../app/screenpics');
const FX = path.join(__dirname, 'fixtures-1010');
let n = 0, pass = 0; const rec = (k, ok, note = '') => { n++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pic1010-'));
const png = (w, h) => { const b = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const logoPng = fs.readFileSync(path.join(FX, 'sample-store-logo.png')), wJpg = fs.readFileSync(path.join(FX, 'welcome-1920x1080.jpg')), pJpg = fs.readFileSync(path.join(FX, 'welcome-portrait-1200x1600.jpg'));

function unit() {
  let s = sniff(logoPng); rec('1 real PNG: type + size read from its bytes', s.type === 'image/png' && s.w === 659 && s.h === 160, JSON.stringify(s));
  s = sniff(wJpg); rec('2 real JPEG: type + size read from its bytes', s.type === 'image/jpeg' && s.w === 1920 && s.h === 1080, JSON.stringify(s));
  s = sniff(pJpg); rec('3 portrait JPEG 1200 x 1600', s.w === 1200 && s.h === 1600, JSON.stringify(s));
  rec('4 SVG (even named .png) refused', !!sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')).error);
  rec('5 HTML refused', !!sniff(Buffer.from('<!doctype html><script>alert(1)</script>')).error);
  rec('6 GIF refused', !!sniff(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')).error);
  rec('7 WebP refused', !!sniff(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')).error);
  rec('8 empty file refused', !!sniff(Buffer.alloc(0)).error);
  const big = Buffer.concat([logoPng, Buffer.alloc(MAX_BYTES + 1 - logoPng.length)]);
  rec('9 over 5 MB refused (5 MB + 1 byte)', /5 MB/.test(sniff(big).error || ''));
  const atMax = Buffer.concat([logoPng, Buffer.alloc(MAX_BYTES - logoPng.length)]);
  rec('10 exactly 5 MB accepted', !sniff(atMax).error);
  rec('11 4097 px wide refused, 4096 accepted', !!sniff(png(4097, 10)).error && !sniff(png(4096, 4096)).error);
  rec('12 JPEG with no frame header (damaged) refused', !!sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])).error);
  rec('13 PNG signature but no IHDR refused', !!sniff(Buffer.concat([logoPng.slice(0, 8), Buffer.alloc(40)])).error);

  const d = tmp(), sp = new ScreenPics(d);
  let r = sp.put('welcome', wJpg);
  rec('14 welcome saved as screen-welcome.jpg + screen-pictures.json; default fit contain, bars #1f3b57', r.ok && fs.existsSync(path.join(d, 'screen-welcome.jpg')) && sp.state().welcome.fit === 'contain' && sp.state().welcome.fill === '#1f3b57', JSON.stringify(r.pics));
  rec('15 settings.json not created or touched', !fs.existsSync(path.join(d, 'settings.json')));
  r = sp.set({ kind: 'welcome', fit: 'cover', fill: '#FFAA00' }); rec('16 fit cover + colour saved (lower case)', r.ok && sp.state().welcome.fit === 'cover' && sp.state().welcome.fill === '#ffaa00');
  rec('17 bad fit / colour refused, nothing changed', !sp.set({ kind: 'welcome', fit: 'stretch' }).ok && !sp.set({ kind: 'welcome', fill: 'red;background:url(x)' }).ok && sp.state().welcome.fit === 'cover' && sp.state().welcome.fill === '#ffaa00');
  r = sp.put('welcome', logoPng);
  rec('18 replacing JPEG with PNG keeps fit/colour, old .jpg gone, only fixed names', r.ok && fs.existsSync(path.join(d, 'screen-welcome.png')) && !fs.existsSync(path.join(d, 'screen-welcome.jpg')) && sp.state().welcome.fit === 'cover');
  rec('19 a refused file changes nothing', !sp.put('welcome', Buffer.from('<svg/>')).ok && sp.state().welcome.type === 'image/png');
  rec('20 state() gives only /screen-picture/... URLs (no paths)', /^\/screen-picture\/welcome\?v=[0-9a-f]{12}$/.test(sp.state().welcome.src) && !JSON.stringify(sp.state()).includes(d));
  r = sp.put('saleLogo', logoPng); rec('21 register logo saved separately (screen-salelogo.png)', r.ok && fs.existsSync(path.join(d, 'screen-salelogo.png')) && /^\/screen-picture\/salelogo\?v=/.test(sp.state().saleLogo.src));
  rec('22 unknown kind refused', !sp.put('../x', logoPng).ok && !sp.set({ kind: '__proto__', remove: true }).ok);
  const sp2 = new ScreenPics(d); rec('23 survives restart', !!sp2.state().welcome && !!sp2.state().saleLogo && sp2.state().welcome.fill === '#ffaa00');
  r = sp.set({ kind: 'welcome', remove: true });
  rec('24 Remove picture: back to no picture, only its own file removed, logo kept', r.ok && !sp.state().welcome && !fs.existsSync(path.join(d, 'screen-welcome.png')) && fs.existsSync(path.join(d, 'screen-salelogo.png')) && !!sp.state().saleLogo);
  rec('25 fit without a picture refused', !sp.set({ kind: 'welcome', fit: 'cover' }).ok);
  fs.writeFileSync(path.join(d, 'screen-pictures.json'), JSON.stringify({ welcome: { type: 'image/svg+xml', hash: 'abc' }, saleLogo: { type: 'text/html', hash: 'x' } }));
  rec('26 hand-edited json with other types ignored', !new ScreenPics(d).state().welcome && !new ScreenPics(d).state().saleLogo);
}

const req = (port, p, o = {}, body) => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port, path: p, method: o.method || 'GET', headers: o.headers || {} }, r => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(b) })); }); q.on('error', rej); if (body) q.write(body); q.end(); });
async function server() {
  const dir = tmp(), port = Number(process.env.PIC_PORT || 5187), cfgp = path.join(dir, 'config.json');
  fs.writeFileSync(cfgp, JSON.stringify({ port, build: 'dev', blockedCompanies: [], updateFeedUrl: 'http://127.0.0.1:1/' }));
  const pre = new ScreenPics(dir); pre.put('welcome', wJpg); pre.put('saleLogo', logoPng);
  const p = spawn(process.execPath, [path.join(__dirname, '../app/server.js')], { env: { ...process.env, AIRREG_CONFIG: cfgp, AIRREG_DATA: dir }, stdio: 'ignore' });
  try {
    let ok = false; for (let i = 0; i < 60 && !ok; i++) { await new Promise(r => setTimeout(r, 100)); ok = await req(port, '/api/customer-state').then(() => true, () => false); }
    rec('27 server up on ' + port, ok);
    let r = await req(port, '/screen-picture/welcome');
    rec('28 GET /screen-picture/welcome: image/jpeg, nosniff, default-src none', r.status === 200 && r.headers['content-type'] === 'image/jpeg' && r.headers['x-content-type-options'] === 'nosniff' && /default-src 'none'/.test(r.headers['content-security-policy'] || '') && r.body.equals(wJpg));
    r = await req(port, '/screen-picture/salelogo?f=../config.json'); rec('29 GET /screen-picture/salelogo: image/png, query ignored', r.status === 200 && r.headers['content-type'] === 'image/png' && r.body.equals(logoPng));
    r = await req(port, '/screen-picture/../config.json'); rec('30 no other files via /screen-picture/', r.status === 404 || !r.body.toString().includes('blockedCompanies'));
    const cs = JSON.parse((await req(port, '/api/customer-state')).body);
    rec('31 customer-state: welcomePic URL + fit + colour, no card message', /^\/screen-picture\/welcome\?v=/.test(cs.welcomePic) && cs.welcomePicFit === 'contain' && cs.welcomePicFill === '#1f3b57' && cs.cardWait === null && cs.view === 'idle', JSON.stringify({ v: cs.view, w: cs.welcomePic, c: cs.cardWait }));
    const st = JSON.parse((await req(port, '/api/state')).body);
    rec('32 /api/state has screenPics (register logo URL)', st.screenPics && /^\/screen-picture\/salelogo\?v=/.test(st.screenPics.saleLogo.src));
    r = await req(port, '/api/screen-picture?kind=welcome', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } }, logoPng);
    rec('33 upload without X-AirMax-Upload header refused', r.status === 404);
    r = await req(port, '/api/screen-picture?kind=welcome', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-AirMax-Upload': '1', Origin: 'http://evil.example' } }, logoPng);
    rec('34 upload from another site refused (403)', r.status === 403);
    r = await req(port, '/api/screen-picture?kind=welcome', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-AirMax-Upload': '1' } }, logoPng);
    rec('35 upload when not logged in refused, picture unchanged', JSON.parse(r.body).ok === false && fs.existsSync(path.join(dir, 'screen-welcome.jpg')), r.body.toString());
    r = await req(port, '/api/screen-picture-set', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, JSON.stringify({ kind: 'welcome', remove: true }));
    rec('36 remove when not logged in refused, picture kept', JSON.parse(r.body).ok === false && fs.existsSync(path.join(dir, 'screen-welcome.jpg')), r.body.toString());
    r = await req(port, '/api/screen-picture', { method: 'GET' }); rec('37 GET on upload route: 404', r.status === 404);
    rec('38 settings.json not written by the picture code', !fs.existsSync(path.join(dir, 'settings.json')) || !/screen|welcomePic/.test(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')));
  } finally { p.kill(); }
}

// static checks of the UI files
function statics() {
  const P = f => fs.readFileSync(path.join(__dirname, '../app/public', f), 'utf8');
  const cj = P('customer.js'), ch = P('customer.html'), ix = P('index.html'), pj = P('pos.js'), aj = P('app.js');
  rec('39 customer screen: still no POST / buttons / inputs', !/method:\s*'POST'|<button|<input/.test(cj + ch));
  rec('40 card message is escaped text (default "Please use the card reader", 1.0.9-local.5 per-shop text) + money() of the amount (no HTML from the server)', /\$\{esc\(msgs\.cardReader\)\}<b>\$\{money\(c\.cardWait\.amount\)\}<\/b>/.test(cj) && /cardReader: 'Please use the card reader'/.test(cj));
  rec('41 Hold group: one column (two lines), labels/keys not changed in CSS', /\.actions \.list \.hgrp \{ grid-template-columns:1fr; \}/.test(ix));
  rec('42 register logo only from the fixed /screen-picture/salelogo URL', /\\\/screen-picture\\\/salelogo\\\?v=\[0-9a-f\]\+\$/.test(aj));
  rec('43 Settings: Choose picture / Remove picture / Choose register logo / Remove register logo buttons present', ['Choose picture…', 'Remove picture', 'Choose register logo…', 'Remove register logo'].every(t => pj.includes('>' + t + '</button>')));
  rec('44 old Settings buttons still there (Choose logo… / Remove logo / Restart / Shut down PC… / Close (Esc) / Save)', ['Choose logo…', 'Remove logo', 'Restart / Shut down PC…', 'Close (Esc)', '>Save<'].every(t => pj.includes(t)));
  const lib = fs.readdirSync(path.join(__dirname, '../app/lib'));
  rec('45 nothing new in app/lib (storage is app/screenpics.js)', !lib.includes('screenpics.js'));
  rec('46 build.sh ships app/screenpics.js', /cp -r [^\n]*app\/\*\.js/.test(fs.readFileSync(path.join(__dirname, '../stage-app.sh'), 'utf8')) && fs.existsSync(path.join(__dirname, '../app/screenpics.js')));
}

(async () => {
  try { unit(); statics(); await server(); } catch (e) { rec('crash', false, e.stack); }
  console.log(`\n${pass}/${n} passed`); process.exit(pass === n ? 0 : 1);
})();

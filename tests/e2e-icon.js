// Air Register 1.2.0: window/taskbar icon. The page used <link rel="icon" href="data:,"> (an empty icon), so the Edge
// app window showed a blank taskbar icon. Checks the icon files, the manifest and that Chrome picks them up. Offline.
// Run: FAKE_PORT=5068 node tests/e2e-icon.js   (fake server + Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const BASE = 'http://127.0.0.1:' + Number(process.env.FAKE_PORT || 5058);
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const pngSize = b => [b.readUInt32BE(16), b.readUInt32BE(20)];
(async () => {
  for (const [f, type, size] of [['/icon.ico', 'image/x-icon'], ['/icon-192.png', 'image/png', 192], ['/icon-512.png', 'image/png', 512]]) {
    const r = await fetch(BASE + f); const b = Buffer.from(await r.arrayBuffer());
    const ok = r.status === 200 && r.headers.get('content-type') === type && (size ? pngSize(b).join() === size + ',' + size : b.readUInt16LE(2) === 1 && b.readUInt16LE(4) >= 4);
    rec('serves ' + f, ok, `${r.status} ${r.headers.get('content-type')} ${b.length} bytes${size ? ' ' + pngSize(b).join('x') : ', ' + b.readUInt16LE(4) + ' sizes'}`);
  }
  const ico = fs.readFileSync(path.join(__dirname, '..', 'app/public/icon.ico')), inst = fs.readFileSync(path.join(__dirname, '..', 'pkg/stage/AirRegister.ico'));
  rec('window icon is the same Air Register icon as the installer/shortcut', ico.equals(inst), 'byte-identical to pkg/stage/AirRegister.ico');
  const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    for (const [u, title] of [['/', 'Air Max'], ['/customer', 'Air Max customer display']]) {
      const p = await b.newPage(); const bad = []; p.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
      await p.goto(BASE + u); await new Promise(r => setTimeout(r, 1200));
      const links = await p.$$eval('link[rel~="icon"], link[rel="manifest"], link[rel="apple-touch-icon"]', x => x.map(l => l.getAttribute('href')));
      const cdp = await p.target().createCDPSession(); const m = await cdp.send('Page.getAppManifest');
      const man = JSON.parse(m.data || '{}');
      rec(u + ': icon + manifest links, manifest parses with no errors', links.join() === '/icon.ico,/icon-192.png,/icon-192.png,/manifest.json' && !m.errors.length && man.name === 'Air Max' && man.icons.length === 3, `links ${links.join(' ')}; manifest "${man.name}", ${m.errors.length} errors`);
      rec(u + ': window title "' + title + '", no failed requests (no data: icon)', (await p.title()) === title && !bad.length && !(await p.$('link[href="data:,"]')), bad.join('; ') || 'ok');
      await p.close();
    }
  } finally {
    b.disconnect();
    const passed = out.filter(x => x.pass).length; console.log(`\n${passed}/${out.length} passed`);
    fs.writeFileSync(path.join(__dirname, 'e2e-icon-results.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: out.length, out }, null, 1));
    process.exit(passed === out.length ? 0 : 1);
  }
})().catch(e => { console.error(e); process.exit(1); });

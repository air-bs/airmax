// Work copy (NOT released). 1.0.10-local.2: draws a Hebrew label with the REAL page code (printlabel.js raster + label.js)
// in a private headless Chrome (own port 9471 and profile, not the shared 9433), then prints it to a sink (no printer).
// SKIPPED when Chrome is missing. Usage: node tests/hebrew-raster.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn, execSync } = require('child_process');
const APP = path.join(__dirname, '..', 'app'), L = require(path.join(APP, 'public/label')), { Labels } = require(path.join(APP, 'labels'));
const out = []; const rec = (n, pass, d) => { out.push({ pass: !!pass }); console.log(`${pass ? 'PASS' : 'FAIL'} ${n}${d != null ? ' — ' + String(d).slice(0, 140) : ''}`); };
let bin = ''; try { bin = execSync('command -v google-chrome || command -v chromium || true', { shell: '/bin/bash' }).toString().trim(); } catch {}
if (!bin) { console.log('SKIPPED (no Chrome on this machine)'); process.exit(0); }
const HEB = 'שוקולד חלב מריר 100 גרם', item = { name: HEB, number: '1001', upc: '', price: 5.9, regular: null }, st = L.norm({ printer: 'TSC DA200', nameSize: 'xlarge' });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hebr-')), src = fs.readFileSync(path.join(APP, 'public/printlabel.js'), 'utf8');
const raster = src.slice(src.indexOf('  async function raster('), src.indexOf('  async function labelPrint('));
fs.copyFileSync(path.join(APP, 'public/label.js'), path.join(dir, 'label.js'));
fs.writeFileSync(path.join(dir, 't.html'), `<!doctype html><meta charset=utf-8><body><pre id=o>wait</pre><script src="label.js"></script><script>const L=window.AirLabel;\n${raster}\n(async()=>{ window.R = await raster(${JSON.stringify(item)}, L.norm(${JSON.stringify(st)})); document.getElementById('o').textContent='DONE'; })().catch(e=>document.getElementById('o').textContent='ERR '+e);</script>`);
(async () => {
  const ch = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${path.join(dir, 'ud')}`, '--remote-debugging-port=9471', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
  const sleep = ms => new Promise(r => setTimeout(r, ms)); let tabs;
  try {
    for (let i = 0; i < 60; i++) { try { tabs = await (await fetch('http://127.0.0.1:9471/json')).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
    const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => (ws.onopen = r));
    let id = 0; const pend = {}; ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Page.navigate', { url: 'file://' + path.join(dir, 't.html') });
    let txt = ''; for (let i = 0; i < 60; i++) { await sleep(250); const r = await send('Runtime.evaluate', { expression: "document.getElementById('o')&&document.getElementById('o').textContent" }); txt = (r.result.result && r.result.result.value) || ''; if (/DONE|ERR/.test(txt)) break; }
    const img = txt === 'DONE' ? (await send('Runtime.evaluate', { expression: 'window.R', returnByValue: true })).result.result.value : null; ws.close();
    const lay = L.layout(item, st), bpr = Math.ceil(lay.W / 8), b = img ? Buffer.from(img.data, 'base64') : Buffer.alloc(0);
    rec('R1 page code draws the Hebrew label as a 1-bit picture of the sticker size', img && img.w === lay.W && img.h === lay.H && b.length === bpr * lay.H, txt + (img ? ` ${img.w}x${img.h}` : ''));
    const black = (y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < lay.W; x++) if (b[y * bpr + (x >> 3)] & (0x80 >> (x & 7))) n++; return n; };
    const nm = lay.items.filter(p => p.role === 'name'), area = nm.map(p => black(p.y, p.y + p.size));
    rec('R2 both Hebrew name lines have ink (Hebrew glyphs drawn, not blank)', nm.length === 2 && area.every(n => n > 400), area.join(', '));
    const ink = (y0, y1, x0, x1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (b[y * bpr + (x >> 3)] & (0x80 >> (x & 7))) n++; return n; };
    const l2 = nm[1], half = Math.round(lay.W / 2), L2 = ink(l2.y, l2.y + l2.size, 0, half), R2 = ink(l2.y, l2.y + l2.size, half, lay.W);
    rec('R3 centered line 2 drawn around the middle (both halves inked)', L2 > 100 && R2 > 100, `${L2} / ${R2}`);
    const sink = path.join(dir, 'sink'), lab = new Labels({ dataDir: dir, reg: { printerName: () => 'Star TSP100 Cutter (TSP143)', api: { scan: async () => ({ productId: 'p-1', ...item }) }, hw: { present: false } }, log: () => {}, sink });
    fs.writeFileSync(lab.file, JSON.stringify(st)); const r = img ? await lab.print({ code: '1001', image: img }) : { ok: false };
    const f = fs.existsSync(sink) ? fs.readdirSync(sink).filter(x => x.endsWith('.pdf')) : [];
    rec('R4 that picture prints on the TSC (driver/PDF) path', r.ok && r.via === 'driver' && f.length === 1 && /ImageMask true/.test(fs.readFileSync(path.join(sink, f[0]), 'latin1')), r.message);
  } finally { ch.kill(); }
  const fails = out.filter(x => !x.pass); console.log(`\n${out.length - fails.length}/${out.length} Hebrew raster tests passed`); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

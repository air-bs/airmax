// AIR POS look app: this script targets the STORE dev folder / port 5057 or the real account; disabled here on purpose.
if (!process.env.ALLOW_STORE_SCRIPT) { console.error('SKIPPED: store-only script (see line 1)'); process.exit(2); }
const puppeteer = require('puppeteer-core');
(async () => { const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433') }); const [p] = (await b.pages()).filter(x => x.url().includes('5057'));
  const r = await p.evaluate(() => [['F5', {}], ['w', { ctrlKey: true }], ['R', { ctrlKey: true, shiftKey: true }], ['r', { ctrlKey: true }]].map(([k, m]) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...m }); document.body.dispatchEvent(e); return k + (m.ctrlKey ? '+ctrl' : '') + (m.shiftKey ? '+shift' : '') + ':' + e.defaultPrevented; }));
  console.log(r.join(' ')); const s = await p.evaluate(() => fetch('/api/state').then(r => r.json())); console.log('mode after Ctrl+R toggle:', s.mode); b.disconnect(); })();

// dev: screenshots of Settings (offline fake server). Usage: FAKE_PORT=5068 node tests/shots-settings.js before|after
const puppeteer = require('puppeteer-core');
const BASE = 'http://127.0.0.1:' + (process.env.FAKE_PORT || 5068), tag = process.argv[2] || 'x', SCR = __dirname + '/../screens/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => { const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 800 } }); const p = await b.newPage();
  await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: 'fake shop', user: 't', password: 'x' }) });
  await p.goto(BASE + '/'); await sleep(1500);
  await p.screenshot({ path: SCR + `settings-${tag}-0-sale.png` });
  await p.keyboard.down('Control'); await p.keyboard.press(','); await p.keyboard.up('Control'); await sleep(1500);
  await p.screenshot({ path: SCR + `settings-${tag}-1.png` });
  if (tag === 'before') {
    await p.evaluate(() => touchSettingsDialog()); await sleep(500); await p.screenshot({ path: SCR + `settings-before-2-touch.png` });
    await p.evaluate(() => bulkSettingsDialog()); await sleep(500); await p.screenshot({ path: SCR + `settings-before-3-bulk.png` });
    await p.evaluate(() => remoteDialog()); await sleep(1500); await p.screenshot({ path: SCR + `settings-before-4-remote.png` });
  } else {
    const tabs = await p.$$eval('#stTabs button', x => x.map(t => t.dataset.tab));
    for (let i = 0; i < tabs.length; i++) { await p.click(`#stTabs button[data-tab="${tabs[i]}"]`); await sleep(1200); await p.screenshot({ path: SCR + `settings-after-${i + 1}-${tabs[i]}.png` }); }
  }
  await p.keyboard.press('Escape'); await sleep(300); await p.close(); b.disconnect(); })();

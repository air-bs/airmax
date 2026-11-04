// dev probe: list on-screen buttons (offline fake server)
const puppeteer = require('puppeteer-core');
const BASE = 'http://127.0.0.1:' + (process.env.FAKE_PORT || 5068);
(async () => { const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433') }); const p = await b.newPage();
  await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ company: 'fake shop', user: 't', password: 'x' }) });
  await p.goto(BASE + '/'); await new Promise(r => setTimeout(r, 1500));
  console.log(await p.evaluate(() => ['actions', 'right', 'tiles'].map(id => id + ': ' + [...document.getElementById(id).querySelectorAll('h3,[data-a],[data-bulk]')].map(e => e.tagName === 'H3' ? '\n ## ' + e.textContent : (e.dataset.a || 'bulk' + e.dataset.bulk) + '|' + e.innerText.replace(/\s+/g, ' ')).join(' ; ')).join('\n')));
  await p.close(); b.disconnect(); })();

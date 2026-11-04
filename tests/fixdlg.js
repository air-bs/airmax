const puppeteer = require('puppeteer-core');
(async () => { const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433') }); const ps = await b.pages();
  for (const p of ps) { const s = await p.target().createCDPSession(); await s.send('Page.enable'); try { await s.send('Page.handleJavaScriptDialog', { accept: true }); console.log('accepted dialog'); } catch (e) { console.log('no dialog', p.url()); } }
  b.disconnect(); })();

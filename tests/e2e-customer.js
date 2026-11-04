// Air Register 1.2.0: customer display (/customer, read-only) + F5 Tax Off manager login, against the OFFLINE fake AIR POS.
// Needs Chrome with --remote-debugging-port=9333 and two fake servers:
//   FAKE_PORT=5068 node tests/fake-server.js &   FAKE_PORT=5070 FAKE_CASHIER=1 node tests/fake-server.js &
//   FAKE_PORT=5068 CASHIER_PORT=5070 node tests/e2e-customer.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5058), CP = Number(process.env.CASHIER_PORT || 5070);
const BASE = 'http://127.0.0.1:' + FP, CBASE = 'http://127.0.0.1:' + CP;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (base, r, x) => fetch(base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const cstate = base => fetch(base + '/api/customer-state').then(r => r.json());
async function login(base, user) { const s = await fetch(base + '/api/state').then(r => r.json()); if (!s.loggedIn) await post(base, 'login', { company: 'fake shop', user, password: '<redacted>' }); await post(base, 'pay-close'); await post(base, 'new-sale'); await post(base, 'dismiss'); }
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    await login(BASE, 'tester');
    // ---- customer display ----
    const cp = await b.newPage(); const errs = []; cp.on('pageerror', e => errs.push(e.message));
    const reqs = []; cp.on('request', q => reqs.push(q.method() + ' ' + new URL(q.url()).pathname));
    const resp = await cp.goto(BASE + '/customer'); await sleep(900);
    const csp = resp.headers()['content-security-policy'] || '';
    const vis = id => cp.$eval('#' + id, e => getComputedStyle(e).display !== 'none').catch(() => false);
    const txt = sel => cp.$eval(sel, e => e.innerText).catch(() => '');
    rec('/customer route serves the customer page with the same CSP', resp.status() === 200 && /script-src 'self'/.test(csp) && (await cp.title()) === 'Air Max customer display', `HTTP ${resp.status()}, title "${await cp.title()}"`);
    let c = await cstate(BASE);
    rec('No sale: clean Welcome screen with the shop name', c.view === 'idle' && await vis('idle') && !(await vis('sale')) && /Welcome/.test(await txt('#idle')) && /Fake shop/.test(await txt('#idle')), `view ${c.view}, "${(await txt('#idle')).replace(/\n/g, ' / ')}"`);
    await cp.screenshot({ path: SCR + 'cust-1-welcome.png' });
    const controls = await cp.$$eval('input, button, select, textarea, a, form, [contenteditable]', x => x.length);
    rec('Customer page has no buttons, inputs, links or forms', controls === 0, `${controls} controls`);
    const helper = (await cp.evaluate(() => document.body.innerText)).trim();
    rec('No helper text on the idle screen (only Welcome + shop name)', helper.replace(/\s+/g, ' ') === 'Welcome Fake shop', `"${helper.replace(/\n/g, ' / ')}"`);

    await post(BASE, 'scan', { code: '1001' }); await post(BASE, 'scan', { code: '1004' }); await sleep(900);
    c = await cstate(BASE);
    const lines = await cp.$$eval('#list .row', x => x.map(r => r.innerText.replace(/\s+/g, ' ')));
    const side = (await txt('#side')).replace(/\s+/g, ' ');
    rec('Scanning updates the display: lines, subtotal, tax, total', c.view === 'sale' && lines.length === 2 && /Bulk candy/.test(lines.join()) && /Subtotal \$11\.50/.test(side) && /Tax \$0\.80/.test(side) && /Total \$12\.30/.test(side), `${lines.join(' | ')} || ${side}`);
    await cp.screenshot({ path: SCR + 'cust-2-sale.png' });
    await post(BASE, 'tax-exempt', { on: true }); await sleep(900);
    const side2 = (await txt('#side')).replace(/\s+/g, ' ');
    rec('Tax Off shows on the customer display (tax 0, total = pre-tax)', /Tax \(none\) \$0\.00/.test(side2) && /Total \$11\.50/.test(side2), side2);
    await post(BASE, 'tax-exempt', { on: false }); await sleep(600);

    // read-only: keys / clicks on the customer screen change nothing
    const before = JSON.stringify((await cstate(BASE)).lines);
    await cp.mouse.click(300, 300); await cp.keyboard.press('Delete'); await cp.keyboard.press('F5'); await cp.keyboard.press('Escape'); await cp.keyboard.type('1003\n'); await sleep(900);
    const after = JSON.stringify((await cstate(BASE)).lines);
    rec('Clicks and keys on the customer screen do not change the sale', before === after && cp.url().endsWith('/customer'), `lines unchanged: ${before === after}`);

    await post(BASE, 'pay-start'); const t1 = await post(BASE, 'pay-tender', { type: 20, amount: 5, stockOk: true }); await sleep(900); // mny109a: one cash payment per sale, so the first part is by card (the fake terminal approves at once)
    c = await cstate(BASE); const side3 = (await txt('#side')).replace(/\s+/g, ' ');
    rec('Payment: paid so far and amount due shown', c.view === 'pay' && /Paid \$5\.00/.test(side3) && /Amount due \$7\.30/.test(side3), `${t1.message} || ${side3}`);
    await cp.screenshot({ path: SCR + 'cust-3-due.png' });
    const t2 = await post(BASE, 'pay-tender', { type: 10, tendered: 10 }); if (!t2.completed && t2.ok) await post(BASE, 'finish-sale'); await sleep(900);
    c = await cstate(BASE); const sum = (await txt('#sum')).replace(/\s+/g, ' ');
    rec('Sale done: Thank you with total, paid and change', c.view === 'done' && await vis('done') && /Total \$12\.30/.test(sum) && /Change \$2\.70/.test(sum), `${t2.message} || view ${c.view} || ${sum}`);
    await cp.screenshot({ path: SCR + 'cust-4-done.png' });
    await post(BASE, 'scan', { code: '1003' }); await sleep(900); c = await cstate(BASE);
    rec('Next item after a finished sale replaces the Thank you screen', c.view === 'sale' && await vis('sale') && c.lines.length === 1, `view ${c.view}`);
    await cp.setViewport({ width: 900, height: 150 }); await post(BASE, 'scan', { code: '1004' }); await post(BASE, 'scan', { code: '1001' }); await sleep(900);
    const fit = await cp.evaluate(() => { const l = document.getElementById('list'), r = l.lastElementChild; const a = l.getBoundingClientRect(), b = r.getBoundingClientRect(); return { last: r.innerText.split('\n')[0], inside: b.bottom <= a.bottom + 1, n: l.children.length }; });
    c = await cstate(BASE);
    rec('Small screen: older lines drop off, newest line stays visible', fit.inside && fit.last === c.lines[c.lines.length - 1].name && fit.n < c.lines.length, `${fit.n} of ${c.lines.length} rows shown, last "${fit.last}"`);
    await cp.setViewport({ width: 1280, height: 800 });
    await post(BASE, 'new-sale'); await sleep(900);
    rec('Cleared sale goes back to Welcome', (await cstate(BASE)).view === 'idle' && await vis('idle'), 'idle');
    const posts = reqs.filter(r => !r.startsWith('GET'));
    rec('Customer page only made GET requests (never POST)', posts.length === 0 && reqs.some(r => r === 'GET /api/customer-state'), `${reqs.length} requests, non-GET: ${posts.join(', ') || 'none'}`);
    rec('No page errors on the customer page', errs.length === 0, errs.join('; ') || 'none');
    // 1.0.10: + welcomePic / welcomePicFit / welcomePicFill (picture URL, fit, bars colour) and cardWait ({amount} or null): display only
    const keys = Object.keys(await cstate(BASE)).sort().join(',');
    rec('customer-state carries only display fields (no settings, user, tokens)', keys === 'cardWait,currency,lines,logo,msgs,pay,shop,totals,updating,view,welcome,welcome2,welcomePic,welcomePicFill,welcomePicFit', keys);
    await cp.close();

    // ---- Settings switch, remembered on this PC (settings.json) ----
    const pg = await b.newPage(); await pg.goto(BASE + '/'); await sleep(1500);
    await pg.evaluate(() => settingsPage('screen')); await sleep(600);
    const def = await pg.$eval('#tkCD', e => e.checked).catch(() => null);
    await pg.click('#tkCD'); await pg.click('#tkOk'); await sleep(700);
    const s1 = await fetch(BASE + '/api/state').then(r => r.json());
    await pg.evaluate(() => closeModal()); await pg.evaluate(() => settingsPage('screen')); await sleep(600);
    const shown = await pg.$eval('#tkCD', e => e.checked);
    await pg.click('#tkCD'); await pg.click('#tkOk'); await sleep(700);
    const s2 = await fetch(BASE + '/api/state').then(r => r.json());
    rec('Settings "Customer display": on by default, switch off/on is saved', def === true && s1.settings.customerDisplay === false && shown === false && s2.settings.customerDisplay === true, `default ${def}, saved ${s1.settings.customerDisplay}, reopened ${shown}, back on ${s2.settings.customerDisplay}`);
    await pg.screenshot({ path: SCR + 'cust-5-settings.png' }); await pg.evaluate(() => closeModal()); await pg.close();

    // ---- 1.2.1: store's own welcome message + logo (manager; fake AIR POS) ----
    {
      const zlib = require('zlib');
      const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
      const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
      const W = 240, H = 90, ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
      const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * (W * 3 + 1) + 1 + x * 3; const ring = ((x - 45) ** 2 + (y - 45) ** 2) < 1600; raw[i] = ring ? 255 : 250; raw[i + 1] = ring ? 196 : 250; raw[i + 2] = ring ? 0 : 250; }
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
      const lf = path.join(require('os').tmpdir(), 'e2e-logo.png'); fs.writeFileSync(lf, png);
      await post(BASE, 'settings', { custWelcome: '', custWelcome2: '', custLogoRemove: true }); // clean start
      const pg = await b.newPage(); pg.on('dialog', d => d.dismiss().catch(() => {})); await pg.goto(BASE + '/'); await sleep(1500);
      await pg.evaluate(() => settingsPage('screen')); await sleep(600);
      await pg.type('#cwW', 'Welcome to Fake shop!'); await pg.type('#cwW2', 'Have a great day');
      const [fc] = await Promise.all([pg.waitForFileChooser(), pg.click('#cwPick')]); await fc.accept([lf]); await sleep(700);
      const pv = await pg.evaluate(() => ({ w: document.getElementById('cwPW').textContent, w2: document.getElementById('cwPW2').textContent, img: getComputedStyle(document.getElementById('cwPI')).display !== 'none' && document.getElementById('cwPI').naturalWidth > 0, n: document.getElementById('cwWn').textContent }));
      rec('Settings preview shows message, second line, logo and counter before Save', pv.w === 'Welcome to Fake shop!' && pv.w2 === 'Have a great day' && pv.img && pv.n === '21 / 40', JSON.stringify(pv));
      await pg.screenshot({ path: SCR + 'cust-7-welcome-settings.png' });
      await pg.click('#tkOk'); await sleep(900);
      const cp2 = await b.newPage(); const e2 = []; cp2.on('pageerror', e => e2.push(e.message)); await cp2.goto(BASE + '/customer'); await sleep(1200);
      const idle = () => cp2.evaluate(() => ({ h: document.getElementById('wel').textContent, p: document.getElementById('shop').textContent, logo: !document.getElementById('logo').hidden && document.getElementById('logo').naturalWidth > 0, on: document.getElementById('idle').classList.contains('on'), html: document.getElementById('wel').innerHTML }));
      let v = await idle();
      rec('After Save, /customer shows the logo and both lines', v.on && v.logo && v.h === 'Welcome to Fake shop!' && v.p === 'Have a great day', JSON.stringify(v));
      await cp2.screenshot({ path: SCR + 'cust-8-welcome-logo.png' });
      const bad = await post(BASE, 'settings', { custLogo: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') });
      rec('SVG logo refused with a clear message; old logo kept', bad.ok === false && /PNG or JPG/.test(bad.message) && (await cstate(BASE)).logo, bad.message);
      await post(BASE, 'settings', { custWelcome: '<b>hi</b>' }); await sleep(900); v = await idle();
      rec('A <b>hi</b> message is shown as plain letters', v.h === '<b>hi</b>' && !/<b>/.test(v.html) && /&lt;b&gt;/.test(v.html), v.html);
      await cp2.screenshot({ path: SCR + 'cust-9-plain-text.png' });
      await post(BASE, 'scan', { code: '1001' }); await sleep(900);
      const sv = await cp2.evaluate(() => document.getElementById('sale').classList.contains('on') && document.querySelectorAll('#list .row').length);
      await post(BASE, 'new-sale'); await sleep(900); v = await idle();
      rec('During a sale the items show; after it the Welcome comes back with the logo', sv === 1 && v.on && v.logo, `sale rows ${sv}, idle ${v.on}, logo ${v.logo}`);
      await cp2.bringToFront().catch(() => {}); await pg.bringToFront(); await sleep(300);
      await pg.reload(); await sleep(1500); await pg.evaluate(() => settingsPage('screen')); await sleep(600);
      await pg.click('#cwW', { clickCount: 3 }); await pg.keyboard.press('Backspace'); await pg.click('#cwW2', { clickCount: 3 }); await pg.keyboard.press('Backspace');
      await pg.click('#cwRm'); await pg.click('#tkOk'); await sleep(1000); v = await idle(); const cs = await cstate(BASE);
      rec('Remove logo + empty lines: back to "Welcome" + shop name', v.on && !v.logo && v.h === 'Welcome' && v.p === 'Fake shop' && cs.logo === null && cs.welcome === '', JSON.stringify(v));
      await cp2.bringToFront(); await sleep(500); await cp2.screenshot({ path: SCR + 'cust-10-back-to-default.png' });
      rec('No page errors on the customer page (welcome/logo)', e2.length === 0, e2.join('; ') || 'none');
      await pg.close(); await cp2.close();
    }

    // ---- F5 Tax Off as a cashier (fake user without RetailManager) ----
    await login(CBASE, 'cashier');
    const q = await b.newPage(); await q.goto(CBASE + '/'); await sleep(1500);
    const st = () => fetch(CBASE + '/api/state').then(r => r.json());
    const s0 = await st();
    await post(CBASE, 'scan', { code: '1001' }); await q.evaluate(() => refresh()); await sleep(400);
    await q.focus('#scanInput'); await q.keyboard.press('F5'); await sleep(900);
    const h = await q.$eval('#modalRoot h2', e => e.textContent).catch(() => '');
    let s = await st();
    rec('Cashier: F5 opens the manager login, tax stays on', !s0.user.manager && h === 'Tax Off' && !s.order.taxExempt && s.totals.tax === 0.8, `manager ${s0.user.manager}, dialog "${h}", tax ${s.totals.tax}`);
    await q.type('#mlU', 'boss'); await q.type('#mlP', 'wrong'); await q.click('#mlOk'); await sleep(900);
    const m1 = await q.$eval('#mlMsg', e => e.textContent).catch(() => ''); s = await st();
    rec('Cashier: wrong manager password is refused', /Wrong/.test(m1) && !s.order.taxExempt, `"${m1}"`);
    await q.click('#mlU', { clickCount: 3 }); await q.type('#mlU', 'boss'); await q.type('#mlP', 'boss-pw'); await q.click('#mlOk'); await sleep(1100);
    s = await st(); const open = await q.$('#modalRoot h2');
    rec('Cashier: manager login approves Tax Off (tax 0, dialog closed)', s.order.taxExempt && s.totals.tax === 0 && s.totals.due === 10 && !open, `taxExempt ${s.order.taxExempt}, tax ${s.totals.tax}, due ${s.totals.due}`);
    await q.screenshot({ path: SCR + 'cust-6-taxoff-cashier.png' });
    await q.focus('#scanInput'); await q.keyboard.press('F5'); await sleep(900); s = await st();
    rec('Cashier: F5 again turns tax back on with no login', !s.order.taxExempt && s.totals.tax === 0.8 && !(await q.$('#modalRoot h2')), `tax ${s.totals.tax}`);
    await post(CBASE, 'new-sale'); await q.close();
  } catch (e) { rec('e2e run finished without an error', false, String(e && e.message || e).split('\n')[0]); } finally {
    b.disconnect();
    const passed = out.filter(x => x.pass).length;
    console.log(`\n${passed}/${out.length} passed`);
    fs.writeFileSync(path.join(__dirname, 'e2e-customer-results.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: out.length, out }, null, 1));
    process.exit(passed === out.length && out.length ? 0 : 1);
  }
})().catch(e => { console.error(e); process.exit(1); });

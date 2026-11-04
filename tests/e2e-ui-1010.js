// AirMax 1.0.10 UI (Ari OK 11:12 AM ET Fri Oct 30), against the OFFLINE fake AIR POS (made-up shop, no account):
//  1) welcome picture on the customer screen (Settings picker, PNG/JPEG by bytes, 5 MB, fit, bars colour, Remove, only when idle)
//  2) register logo above the total (Settings picker, only when set, totals unchanged)
//  3) Hold / Load Hold on two lines (same labels + keys)
//  4) customer screen "Please use the card reader" + amount while a terminal card payment waits (display only)
// Screenshots at 1366 x 768 and 1024 x 768: screens/v1010-*.png
// Run: FAKE_PORT=5187 node tests/look-fake.js &   FAKE_PORT=5187 CHROME_URL=http://127.0.0.1:9434 node tests/e2e-ui-1010.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), os = require('os'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5187), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/'; fs.mkdirSync(SCR, { recursive: true });
const FX = path.join(__dirname, 'fixtures-1010') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note = '') => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const cstate = () => fetch(BASE + '/api/customer-state').then(r => r.json());
const upload = (kind, buf) => fetch(BASE + '/api/screen-picture?kind=' + kind, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-airmax-upload': '1' }, body: buf }).then(async r => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
const SIZES = [[1366, 768], [1024, 768]];
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9434'), defaultViewport: { width: 1366, height: 768 } });
  const errs = [];
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); p.on('pageerror', e => errs.push('pos: ' + e.message)); p.on('dialog', d => d.accept());
    const c = await b.newPage(); c.on('pageerror', e => errs.push('customer: ' + e.message));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    await c.setViewport({ width: 1366, height: 768 }); await c.goto(BASE + '/customer', { waitUntil: 'domcontentloaded' }); await sleep(1000);

    // ---------- 3) Hold / Load Hold (before anything else changes the screen) ----------
    await p.bringToFront();
    const hold = () => p.evaluate(() => { const g = document.querySelector('#actions .hgrp'); const bs = [...g.querySelectorAll('[data-a]')].map(x => { const r = x.getBoundingClientRect(), k = x.querySelector('.k'); return { a: x.dataset.a, text: x.innerText.replace(/\s+/g, ' ').trim(), l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), kFits: !k || k.scrollWidth <= k.clientWidth + 1 }; }); const gr = g.getBoundingClientRect(); return { gw: Math.round(gr.width), bs }; });
    for (const [w, h] of SIZES) {
      await p.setViewport({ width: w, height: h }); await sleep(700);
      const H = await hold(), [h1, h2] = H.bs;
      rec(`3 Hold group ${w}: Hold and Load Hold each on its own full-width line`, H.bs.length === 2 && h2.t > h1.t + h1.h - 2 && Math.abs(h1.l - h2.l) <= 1 && h1.w >= H.gw - 2 && h2.w >= H.gw - 2, JSON.stringify(H));
      rec(`3 Hold labels + keys unchanged ${w} (Hold Ctrl + H / Load Hold Ctrl + Shift + H), key text not cut`, h1.a === 'hold' && h2.a === 'load-hold' && /^Hold Ctrl \+ H$/.test(h1.text) && /^Load Hold Ctrl \+ Shift \+ H$/.test(h2.text) && h1.kFits && h2.kFits, h1.text + ' | ' + h2.text);
      const clip = await p.evaluate(() => { const r = document.querySelector('#actions .hgrp').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 120), width: Math.min(innerWidth, r.right + 40), height: Math.min(innerHeight - Math.max(0, r.top - 120), r.height + 240) }; });
      await p.screenshot({ path: SCR + `v1010-hold-${w}.png`, clip });
    }
    await p.setViewport({ width: 1366, height: 768 }); await sleep(400);
    const keyNow = await p.evaluate(() => [...document.querySelectorAll('#actions [data-a]')].map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    rec('3 every Actions button label + key still there', ['New Ctrl + Shift + N', 'Hold Ctrl + H', 'Load Hold Ctrl + Shift + H', 'Return Ctrl + R'].every(t => keyNow.includes(t)), JSON.stringify(keyNow));

    // ---------- Settings dialog: new controls, old Alt letters unchanged ----------
    const openSet = async () => { await p.bringToFront(); await p.evaluate(() => { closeModal && closeModal(); }).catch(() => {}); await sleep(200); await p.evaluate(() => touchSettingsDialog()); await sleep(900); };
    await openSet();
    const alts = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#modalRoot button')].map(x => [x.childNodes[0].textContent.trim(), x.dataset.dk || ''])));
    rec('Settings: old Alt letters unchanged (Choose logo… C, Remove logo R, Restart / Shut down PC… S, Save A)', alts['Choose logo…'] === 'C' && alts['Remove logo'] === 'R' && alts['Restart / Shut down PC…'] === 'S' && alts['Save'] === 'A', JSON.stringify(alts));
    rec('Settings: new buttons get their own Alt letters (Choose picture… H, Remove picture M, Choose register logo… O, Remove register logo V)', alts['Choose picture…'] === 'H' && alts['Remove picture'] === 'M' && alts['Choose register logo…'] === 'O' && alts['Remove register logo'] === 'V', '');
    const allL = Object.values(alts).filter(Boolean); rec('Settings: no Alt letter used twice', new Set(allL).size === allL.length, allL.join(''));
    const msg = () => p.$eval('#tkMsg', e => e.textContent).catch(() => '');
    // refused files (type read from the bytes, not the name)
    const bad = path.join(os.tmpdir(), 'ui1010-not-a-picture.png'); fs.writeFileSync(bad, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    await (await p.$('#wpF')).uploadFile(bad); await sleep(500);
    rec('1 Settings: an SVG named .png is refused at once, no preview', /Only PNG or JPG/.test(await msg()) && await p.$eval('#wpPI', e => e.style.display === 'none'), await msg());
    const badH = path.join(os.tmpdir(), 'ui1010-page.jpg'); fs.writeFileSync(badH, '<!doctype html><script>alert(1)</script>');
    await (await p.$('#slF')).uploadFile(badH); await sleep(500);
    rec('2 Settings: an HTML file named .jpg is refused for the register logo', /Only PNG or JPG/.test(await msg()) && await p.$eval('#slPI', e => e.style.display === 'none'), await msg());
    // pick real pictures, preview, Save
    await (await p.$('#wpF')).uploadFile(FX + 'welcome-1920x1080.jpg'); await (await p.$('#slF')).uploadFile(FX + 'sample-store-logo.png'); await sleep(900);
    const prev = await p.evaluate(() => ({ w: $('wpPI').style.display, wsrc: ($('wpPI').getAttribute('src') || '').slice(0, 5), wn: $('wpPI').naturalWidth, l: $('slPI').style.display, ln: $('slPI').naturalWidth }));
    rec('1+2 Settings: chosen picture + logo previewed before Save (blob:)', prev.w === 'block' && prev.wsrc === 'blob:' && prev.wn === 1920 && prev.l === 'block' && prev.ln === 659, JSON.stringify(prev));
    rec('1+2 nothing saved before Save', !(await state()).screenPics.welcome && !(await state()).screenPics.saleLogo, '');
    for (const [w, h] of SIZES) { await p.setViewport({ width: w, height: h }); await sleep(500); await p.evaluate(() => { const e = $('wpPrev'); e && e.scrollIntoView({ block: 'center' }); }); await sleep(200); await p.screenshot({ path: SCR + `v1010-settings-${w}.png` }); }
    await p.setViewport({ width: 1366, height: 768 }); await sleep(300);
    await p.click('#tkOk'); await sleep(2000);
    let sp = (await state()).screenPics;
    rec('1+2 Save: welcome picture + register logo stored (JPEG 1920x1080, PNG 659x160), fit contain, bars #1f3b57', sp.welcome && sp.welcome.type === 'image/jpeg' && sp.welcome.w === 1920 && sp.welcome.fit === 'contain' && sp.welcome.fill === '#1f3b57' && sp.saleLogo && sp.saleLogo.type === 'image/png' && sp.saleLogo.w === 659, JSON.stringify(sp) + ' msg: ' + await msg());
    rec('1+2 Save message', /^Saved/.test(await msg()), await msg());
    await p.evaluate(() => closeModal()); await sleep(300);

    // ---------- 1) customer screen welcome picture ----------
    const cinfo = () => c.evaluate(() => { const wp = document.getElementById('wp'), r = wp.getBoundingClientRect(); return { idle: document.getElementById('idle').classList.contains('on'), pic: document.getElementById('idle').classList.contains('pic'), hidden: wp.hidden, nw: wp.naturalWidth, fit: getComputedStyle(wp).objectFit, w: Math.round(r.width), h: Math.round(r.height), wel: getComputedStyle(document.getElementById('wel')).display, bg: getComputedStyle(document.getElementById('idle')).backgroundColor, sale: document.getElementById('sale').classList.contains('on') }; });
    await c.bringToFront();
    for (const [w, h] of SIZES) {
      await c.setViewport({ width: w, height: h }); await sleep(1200); const I = await cinfo();
      rec(`1 customer ${w}: picture full screen on Welcome (contain), message hidden`, I.idle && I.pic && !I.hidden && I.nw === 1920 && I.fit === 'contain' && I.w === w && I.h === h && I.wel === 'none', JSON.stringify(I));
      await c.screenshot({ path: SCR + `v1010-welcome-contain-${w}.png` });
    }
    let r = await post('screen-picture-set', { kind: 'welcome', fit: 'cover' }); await sleep(1200);
    for (const [w, h] of SIZES) { await c.setViewport({ width: w, height: h }); await sleep(900); const I = await cinfo(); rec(`1 customer ${w}: "Fill the whole screen" = cover`, r.ok && I.fit === 'cover' && I.pic, JSON.stringify(I)); await c.screenshot({ path: SCR + `v1010-welcome-cover-${w}.png` }); }
    await post('screen-picture-set', { kind: 'welcome', fit: 'contain', fill: '#000000' }); await upload('welcome', fs.readFileSync(FX + 'welcome-portrait-1200x1600.jpg')); await sleep(1300);
    await c.setViewport({ width: 1366, height: 768 }); await sleep(900); let I = await cinfo();
    rec('1 customer: portrait picture, contain, black bars colour', I.pic && I.nw === 1200 && /rgb\(0, 0, 0\)/.test(I.bg), JSON.stringify(I));
    await c.screenshot({ path: SCR + 'v1010-welcome-portrait-bars-1366.png' });
    await upload('welcome', fs.readFileSync(FX + 'welcome-1920x1080.jpg')); await post('screen-picture-set', { kind: 'welcome', fit: 'contain', fill: '#1f3b57' });
    // API refusals (server checks bytes + size, whatever the page sends)
    const big = Buffer.concat([fs.readFileSync(FX + 'sample-store-logo.png'), Buffer.alloc(5 * 1024 * 1024)]);
    // over 5 MB by Content-Length: the server answers 413 and throws the rest away (nothing kept in memory)
    r = await new Promise(res => { const q = require('http').request({ host: '127.0.0.1', port: FP, path: '/api/screen-picture?kind=welcome', method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-airmax-upload': '1', 'content-length': big.length } }, rs => { let t = ''; rs.on('data', d => t += d); rs.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch { } res({ status: rs.statusCode, ...j }); }); rs.on('error', () => res({ status: rs.statusCode })); }); q.on('error', e => res({ status: 0, message: e.code })); q.end(big); }); rec('1 server: over 5 MB refused (413), picture kept', r.status === 413 && (await state()).screenPics.welcome.w === 1920, JSON.stringify({ s: r.status, m: r.message }));
    r = await upload('salelogo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')); rec('2 server: SVG bytes refused, logo kept', r.ok === false && /Only PNG or JPEG/.test(r.message) && (await state()).screenPics.saleLogo.type === 'image/png', r.message);
    r = await upload('salelogo', Buffer.from('<html><script>alert(1)</script></html>')); rec('2 server: HTML bytes refused', r.ok === false, r.message);
    // only when idle: sale / done screens are the same as before
    await post('scan', { code: '1003' }); await post('scan', { code: '1004' }); await sleep(1300); I = await cinfo();
    rec('1 customer: picture NOT shown during a sale (sale view as before)', I.sale && !I.idle, JSON.stringify(I));

    // ---------- 2) register logo above the total ----------
    await p.bringToFront(); await p.evaluate(() => refresh()); await sleep(900);
    const logo = () => p.evaluate(() => { const box = document.getElementById('saleLogo'), t = document.getElementById('totals'); if (!box) return null; const br = box.getBoundingClientRect(), tr = t.getBoundingClientRect(), img = box.querySelector('img'); return { hidden: box.hidden, disp: getComputedStyle(box).display, next: box.nextElementSibling === t, h: Math.round(br.height), bottom: Math.round(br.bottom), ttop: Math.round(tr.top), nw: img.naturalWidth, ih: Math.round(img.getBoundingClientRect().height), totals: t.innerText.replace(/\s+/g, ' ') }; });
    for (const [w, h] of SIZES) {
      await p.setViewport({ width: w, height: h }); await sleep(900); const L = await logo();
      rec(`2 register ${w}: logo band right above the totals (${w > 1100 ? 72 : 60} px), picture loaded, no overlap`, L && !L.hidden && L.disp === 'flex' && L.next && L.h === (w > 1100 ? 72 : 60) && L.nw === 659 && L.bottom <= L.ttop && L.ih > 20, JSON.stringify(L));
      await p.screenshot({ path: SCR + `v1010-logo-sale-${w}.png` });
    }
    const withLogo = (await logo()).totals;
    // ---------- 4) card reader message ----------
    await c.bringToFront(); await fetch(HOOK + '/card-wait?on=1').then(r => r.text());
    await post('pay-start'); await sleep(300); const due0 = (await cstate()).pay.due;
    r = await post('pay-tender', { type: 20, amount: due0 }); await sleep(1300);
    let cs = await cstate();
    rec('4 fake terminal: card payment waiting (no real terminal)', r.ok && r.waiting && cs.cardWait && cs.cardWait.amount === due0, JSON.stringify({ r: r.message, cw: cs.cardWait, due0 }));
    const money = n => '$' + Math.abs(Number(n)).toFixed(2);
    const cm = () => c.evaluate(() => { const m = document.getElementById('cardmsg'); const s = document.getElementById('side'); return { on: !!m, text: m ? m.innerText.replace(/\s+/g, ' ').trim() : '', side: s.innerText.replace(/\s+/g, ' '), fits: m ? m.getBoundingClientRect().bottom <= innerHeight && m.getBoundingClientRect().top >= 0 : null }; });
    for (const [w, h] of SIZES) {
      await c.setViewport({ width: w, height: h }); await sleep(900); const M = await cm();
      rec(`4 customer ${w}: "Please use the card reader" + ${money(due0)} shown, Amount due still shown`, M.on && M.text === 'Please use the card reader ' + money(due0) && M.side.includes('Amount due') && M.side.includes(money(due0)) && M.fits, JSON.stringify(M));
      await c.screenshot({ path: SCR + `v1010-card-reader-${w}.png` });
    }
    r = await post('card-cancel'); await sleep(1300); let M = await cm();
    rec('4 card cancelled: message gone', !M.on && !(await cstate()).cardWait, JSON.stringify({ r: r.message, M }));
    // split: card for part of the total shows what the terminal asks for
    r = await post('pay-tender', { type: 20, amount: 1 }); await sleep(1300); M = await cm();
    rec('4 split: card for $1.00 of the sale shows $1.00 (what the terminal asks for)', r.waiting && M.on && M.text === 'Please use the card reader $1.00', JSON.stringify({ r: r.message, M }));
    await c.setViewport({ width: 1366, height: 768 }); await sleep(600); await c.screenshot({ path: SCR + 'v1010-card-reader-split-1366.png' });
    await post('card-cancel'); await sleep(800);
    await fetch(HOOK + '/card-wait?on=0').then(r => r.text());
    // register: totals text the same with and without the logo
    await post('screen-picture-set', { kind: 'saleLogo', remove: true }); await p.bringToFront(); await p.evaluate(() => refresh()); await sleep(900);
    const noLogo = await p.evaluate(() => ({ box: document.getElementById('saleLogo') ? document.getElementById('saleLogo').hidden : 'none', totals: document.getElementById('totals').innerText.replace(/\s+/g, ' ') }));
    rec('2 Remove register logo: band gone, totals text identical with and without the logo', noLogo.box === true && noLogo.totals === withLogo, JSON.stringify({ noLogo, withLogo }));
    await post('pay-close'); await post('new-sale'); await c.bringToFront(); await sleep(1500);
    I = await cinfo(); rec('1 customer: back to the picture after the sale is cleared', I.idle && I.pic, JSON.stringify(I));
    // Remove picture from Settings
    await openSet(); await p.click('#wpRm'); await sleep(300); await p.click('#tkOk'); await sleep(2000);
    await c.bringToFront(); await sleep(800); I = await cinfo(); const wel = await c.$eval('#wel', e => e.textContent);
    rec('1 Settings > Remove picture + Save: customer screen back to the normal Welcome', !(await state()).screenPics.welcome && I.idle && !I.pic && I.hidden && wel === 'Welcome', JSON.stringify(I) + ' ' + await msg());
    await c.setViewport({ width: 1366, height: 768 }); await sleep(700); await c.screenshot({ path: SCR + 'v1010-welcome-removed-1366.png' });
    await p.evaluate(() => closeModal && closeModal()).catch(() => {});
    rec('no page errors in the whole run', !errs.length, JSON.stringify(errs));
    await p.close(); await c.close();
  } catch (e) { rec('run', false, e.stack || e.message); }
  b.disconnect();
  const pass = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(os.tmpdir(), 'e2e-ui-1010-results.json'), JSON.stringify({ when: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  console.log(`\n${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

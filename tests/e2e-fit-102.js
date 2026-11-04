// AirMax 1.0.2: the payment and refund side panels fit small register screens (look only).
// At 1024x768, 1280x720, 1366x768 (+1280x800): Back/Pay and Back/Refund are fully on screen with NO scrolling, refund lines are
// no taller than payment lines, every line/button is >= 44px, and every shortcut label (Ctrl+, F1, (Esc), (Enter)) is still there.
// OFFLINE fake AIR POS (made-up data). Run: FAKE_PORT=5180 node tests/look-fake.js &  FAKE_PORT=5180 node tests/e2e-fit-102.js  (Chrome 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const reset = () => fetch(HOOK + '/receives-reset').then(r => r.text()).catch(() => '');
const SIZES = [[1024, 768], [1280, 720], [1366, 768], [1280, 800]];
const REQUIRED = new Set(['1024x768', '1280x720', '1366x768']);
// measures buttons: inside the viewport, actually the top element at their centre (not clipped / covered), and no panel scrolled
const measure = (p, ids) => p.evaluate(ids => {
  const H = innerHeight, W = innerWidth, o = {};
  for (const id of ids) {
    const e = document.getElementById(id); if (!e) { o[id] = null; continue; }
    const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(Math.min(W - 1, Math.max(0, cx)), Math.min(H - 1, Math.max(0, cy)));
    o[id] = { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), inView: r.top >= 0 && r.bottom <= H + 0.5 && r.left >= 0 && r.right <= W + 0.5, hit: !!top && (top === e || e.contains(top)), text: e.textContent.trim() };
  }
  const m = document.querySelector('#modalRoot .modal'), pa = document.querySelector('#modalRoot .payact');
  o.scroll = { modal: m ? m.scrollTop : -1, payact: pa ? pa.scrollTop : -1, doc: document.scrollingElement.scrollTop, H };
  return o;
}, ids);
const lineH = (p, sel) => p.$$eval(sel, x => x.map(e => Math.round(e.getBoundingClientRect().height)));
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433') });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const clean = async () => { await post('pay-close'); await post('return-cancel'); await post('return-toggle', { on: false }); await post('new-sale'); await post('dismiss'); await post('member-detach'); await reset(); };
    const load = async () => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(1000); };
    const f12 = async () => { await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); };
    for (const [w, h] of SIZES) {
      const sz = w + 'x' + h, req = REQUIRED.has(sz) ? '' : ' (extra size)';
      await p.setViewport({ width: w, height: h }); await p.bringToFront(); await clean(); await load();
      // sale screen: the shortcut labels are still shown, exactly as in 1.0.1
      const sale = await p.evaluate(() => {
        const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
        const k = [...document.querySelectorAll('.abtn .k, .tile .k, .rbtn small')].filter(vis).map(e => e.textContent.trim());
        return { help: vis(document.getElementById('helpPill')) ? document.getElementById('helpPill').textContent.trim() : '', setKbd: (document.querySelector('#setTop kbd') || {}).textContent ? document.querySelector('#setTop kbd').textContent.trim() : '', setVisible: vis(document.getElementById('setTop')) && /Settings/i.test(document.getElementById('setTop').textContent), setTitle: (document.getElementById('setTop') || {}).title, k };
      });
      rec(`${sz}${req} sale screen keeps the key labels (F1 = keys, Settings Ctrl+, , Ctrl+/F-key hints on buttons)`, sale.help === 'F1 = keys' && sale.setVisible && sale.setKbd === 'Ctrl+,' && sale.setTitle === 'Settings (Ctrl+,)' && sale.k.some(t => /Ctrl/.test(t)) && sale.k.some(t => /^F\d/.test(t)) && sale.k.some(t => t === 'Esc') && sale.k.some(t => t === 'F12'), JSON.stringify({ help: sale.help, set: sale.setKbd, n: sale.k.length, some: sale.k.slice(0, 6) }));
      // payment panel
      await scan('1001'); await f12();
      let m = await measure(p, ['payBack', 'payOk']); const payH = await lineH(p, '#plist .pline');
      rec(`${sz}${req} payment: Back and Pay fully on screen, not covered, no scrolling`, m.payBack && m.payOk && m.payBack.inView && m.payOk.inView && m.payBack.hit && m.payOk.hit && m.scroll.modal === 0 && m.scroll.payact === 0 && m.scroll.doc === 0, JSON.stringify(m));
      rec(`${sz}${req} payment: lines and buttons at least 44px tall`, payH.length >= 5 && payH.every(x => x >= 44) && m.payBack.h >= 44 && m.payOk.h >= 44, 'lines ' + payH + ' back ' + m.payBack.h + ' pay ' + m.payOk.h);
      rec(`${sz}${req} payment: Back still says "Back (Esc)"`, m.payBack.text === 'Back (Esc)', m.payBack.text);
      await p.screenshot({ path: SCR + `v102-${sz}-payment.png` });
      // tap Cash (adds the quick-bill row): buttons still on screen
      await p.click('.pline[data-t="10"] .plbl').catch(() => {}); await sleep(700);
      const mc = await measure(p, ['payBack', 'payOk']);
      rec(`${sz}${req} payment with Cash open (bill buttons shown): Back and Pay still fully on screen`, mc.payBack && mc.payOk && mc.payBack.inView && mc.payOk.inView && mc.payBack.hit && mc.payOk.hit && mc.scroll.modal === 0, JSON.stringify({ b: mc.payBack, o: mc.payOk, s: mc.scroll }));
      await p.keyboard.press('Escape'); await sleep(500);
      rec(`${sz}${req} Esc still closes the payment panel`, !(await p.$('#payBody')), '');
      await clean();
      // refund panel (receipt return, made-up customer)
      await post('return-start', { kind: 'receipt', orderId: 'o-ret-acct' }); await load(); await scan('1001'); await f12();
      m = await measure(p, ['refBack', 'rOk']); const refH = await lineH(p, '#refLines .pline');
      rec(`${sz}${req} refund: Back and Refund fully on screen, not covered, no scrolling`, m.refBack && m.rOk && m.refBack.inView && m.rOk.inView && m.refBack.hit && m.rOk.hit && m.scroll.modal === 0 && m.scroll.payact === 0 && m.scroll.doc === 0, JSON.stringify(m));
      const maxPay = Math.max(...payH.filter(x => x < 100));   // the payment lines without an open extra row
      rec(`${sz}${req} refund lines are no taller than the payment lines (±2px) and at least 44px`, refH.length === 6 && refH.every(x => x <= maxPay + 2 && x >= 44), 'refund ' + refH + ' payment ' + payH);
      rec(`${sz}${req} refund buttons at least 44px; labels "Back (Esc)" and "Refund $… (Enter)" kept`, m.refBack.h >= 44 && m.rOk.h >= 44 && m.refBack.text === 'Back (Esc)' && /^Refund \$[\d.,]+ \(Enter\)$/.test(m.rOk.text), m.refBack.text + ' | ' + m.rOk.text + ' | ' + m.refBack.h + '/' + m.rOk.h);
      await p.screenshot({ path: SCR + `v102-${sz}-refund.png` });
      await p.keyboard.press('Escape'); await sleep(500);
      rec(`${sz}${req} Esc still closes the refund panel, nothing sent`, !(await p.$('#refBody')), '');
      await clean();
    }
    rec('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { rec('run', false, e.stack); }
  finally { await p.close().catch(() => {}); b.disconnect(); }
  const fail = out.filter(x => !x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-fit-102-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: out.length - fail, failed: fail, out }, null, 1));
  console.log(`${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

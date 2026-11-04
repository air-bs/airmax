// AirMax 1.0.3 "color stripes" look (Ari approved the mock-up Oct 29 8:15 PM ET; bigger SCANNING INPUT, still on top). LOOK ONLY.
// Checks: left stripe in the right group colour (sample per group), no icons shown, dark totals bar with the Total in the lighter
// AIR POS blue, the scan box is bigger than 1.0.2 and still at the top, every button (same data-a list as 1.0.2) and every shortcut
// label is still there, left-column text lines up (Return / Log Out no longer further right), and at 1024x768, 1280x720 and 1366x768
// nothing in the payment / refund panels is cut off (tests/e2e-fit-102.js still runs on its own as well).
// OFFLINE fake AIR POS (made-up data). Run: FAKE_PORT=5180 node tests/look-fake.js &  FAKE_PORT=5180 node tests/e2e-stripes-103.js  (Chrome 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const reset = () => fetch(HOOK + '/receives-reset').then(r => r.text()).catch(() => '');
const C = { green: 'rgb(24, 160, 88)', red: 'rgb(229, 36, 59)', blue: 'rgb(20, 108, 255)', orange: 'rgb(255, 136, 0)', gray: 'rgb(184, 191, 199)' };
const BLUE_L = 'rgb(72, 138, 253)', DARK = 'rgb(13, 23, 38)';
const SAMPLES = {
  green: ['#actions .abtn[data-a="new-sale"]', '#actions .abtn[data-a="hold"]', '#actions .abtn[data-a="open-item"]', '#right .rbtn[data-a="open-item"]', '#right .rbtn[data-a="remove"]', '#tiles .tile[data-a="checkout"]'],
  red: ['#actions .abtn[data-a="return"]', '#right .rbtn[data-a="return"]', '#right .rbtn[data-a="history"]'],
  blue: ['#actions .abtn[data-a="customer"]', '#tiles .tile[data-a="customer"]', '#right .rbtn[data-a="clear-customer"]'],
  orange: ['#right .rbtn[data-a="gift-card"]', '#right .rbtn[data-a="gift-multi"]', '#right .rbtn[data-a="gift-balance"]'], // Add Gift Receipt moved to the left column (Print Label build)
  gray: ['#actions .abtn[data-a="logout"]', '#actions .abtn[data-a="history"]', '#right .rbtn[data-a="settings"]', '#tiles .tile[data-a="close"]'],
};
// every action button of 1.0.2 (data-a, in order): nothing may be removed. (The "Parked sales (N)" button only shows while a sale
// is parked, exactly as in 1.0.2, so it is not in this list.)
const BUTTONS_102 = ['new-sale', 'history', 'hold', 'load-hold', 'drawer', 'return', 'print-label', 'gift-receipt', 'open-item' /* Temporary Item, left column (Ari 11:05 PM Oct 31) */, 'customer', 'end-of-day', 'clock-out', 'logout', 'customer', 'close', 'checkout', '', 'open-item', 'return', 'history', 'reprint', 'reprint-gift' /* Gift Receipt for the last sale, Ctrl+Alt+P (1.0.10-local.2) */, 'search', 'discount', 'tax-off', 'promo', 'extra-charge', 'clear-customer', 'gift-card', 'gift-multi', 'gift-balance', 'price-check', 'cart-search', 'note', 'calculator', 'zoom-reset', 'qty-plus', 'qty-minus', 'qty-edit', 'remove', 'item-discount', 'cash-move', 'settings', 'local:help', 'hw'];
const KEYS = ['Ctrl + Shift + N', 'Ctrl + L', 'Ctrl + H', 'Ctrl + Shift + H', 'Ctrl + D', 'Ctrl + R', 'F3', 'Ctrl + E', 'Ctrl + Shift + X', 'Ctrl + Shift + U', 'Esc', 'F12', 'F7', 'Ctrl + P', 'Ctrl + F', 'F6', 'F5', 'F9', 'F8', 'Shift + F3', 'Ctrl + G', 'Ctrl + Shift + G', 'Ctrl + Shift + B', 'F10', 'Ctrl + I', 'Ctrl + Shift + F', 'Ctrl + N / Alt + N', 'Ctrl + Shift + C', 'Del', 'F4', 'Ctrl + K', 'Ctrl + ,', 'F1', 'Ctrl + Shift + D'];
const SIZES = [[1366, 768], [1280, 720], [1024, 768]];
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433') });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const clean = async () => { await post('pay-close'); await post('return-cancel'); await post('return-toggle', { on: false }); await post('new-sale'); await post('dismiss'); await post('member-detach'); await reset(); };
    const load = async () => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(1000); };
    const f12 = async () => { await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); };
    // whole panel: buttons + lines inside the screen and not covered, nothing wider than the panel, nothing scrolled
    const panelFit = (ids) => p.evaluate(ids => {
      const H = innerHeight, W = innerWidth, m = document.querySelector('#modalRoot .modal'); if (!m) return { ok: false, why: 'no panel' };
      const mr = m.getBoundingClientRect(), bad = [];
      for (const id of ids) { const e = document.getElementById(id); if (!e) { bad.push(id + ' missing'); continue; }
        const r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!(r.top >= 0 && r.bottom <= H + .5 && r.left >= 0 && r.right <= W + .5) || !(t && (t === e || e.contains(t)))) bad.push(id + ' not fully on screen'); }
      for (const e of m.querySelectorAll('.pline, .pline .plbl, .pline .pamt, .paynums .pn, .row2 .pbtn')) { if (!e.getClientRects().length) continue;
        const r = e.getBoundingClientRect(); if (r.right > mr.right + 1 || r.left < mr.left - 1) bad.push((e.id || e.className) + ' wider than the panel');
        if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible') bad.push((e.id || e.className) + ' text cut'); }
      const pa = m.querySelector('.payact');
      return { ok: !bad.length && m.scrollTop === 0 && (!pa || pa.scrollTop === 0) && document.scrollingElement.scrollTop === 0, bad };
    }, ids);
    for (const [w, h] of SIZES) {
      const sz = w + 'x' + h; await p.setViewport({ width: w, height: h }); await p.bringToFront(); await clean(); await load();
      if (w === 1366) {
        const r = await p.evaluate((SAMPLES, C) => {
          const o = {}; for (const [g, sels] of Object.entries(SAMPLES)) o[g] = sels.map(s => { const e = document.querySelector(s); if (!e) return s + ' missing'; const c = getComputedStyle(e);
            return { s, ok: c.boxShadow.includes(C[g]) && /inset/.test(c.boxShadow) && / 8px 0px 0px 0px/.test(c.boxShadow) && c.backgroundColor === 'rgb(255, 255, 255)', sh: c.boxShadow }; });
          return o; }, SAMPLES, C);
        for (const g of Object.keys(SAMPLES)) rec(`${sz} ${g} group: white button with an 8px ${g} stripe on the left`, r[g].every(x => x && x.ok), JSON.stringify(r[g].filter(x => !x.ok)) || 'ok');
        const ic = await p.evaluate(() => [...document.querySelectorAll('.abtn .ic, .tile .ic, .rbtn .ic, .cotitle .coico')].filter(e => getComputedStyle(e).display !== 'none' && e.getClientRects().length).length);
        rec(`${sz} no icons shown on buttons or the title`, ic === 0, ic + ' visible');
        const btns = await p.evaluate(() => [...document.querySelectorAll('.abtn, .tiles .tile, .rbtn')].filter(e => getComputedStyle(e).display !== 'none').map(e => e.dataset.a || '').filter(a => a !== 'price-change' && a !== 'quote' /* store requests #23/#26 added these two buttons; the original buttons must still be there in the same order */));
        rec(`${sz} every 1.0.2 button is still there (${BUTTONS_102.length}, same order)`, JSON.stringify(btns) === JSON.stringify(BUTTONS_102), btns.length + ' buttons');
        const k = await p.evaluate(() => { const vis = e => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0 && parseFloat(getComputedStyle(e).fontSize) >= 8;
          return { k: [...document.querySelectorAll('.abtn .k, .tile .k, .rbtn small')].filter(vis).map(e => e.textContent.trim()), help: document.getElementById('helpPill').textContent.trim(), setTop: document.getElementById('setTop').textContent.trim(), setVis: vis(document.getElementById('setTop')), setKbd: (document.querySelector('#setTop kbd') || {}).textContent || '', setTitle: document.getElementById('setTop').title }; });
        const miss = KEYS.filter(x => !k.k.some(t => t === x || t.includes(x)));
        rec(`${sz} every shortcut label still shown (${KEYS.length} checked) + "F1 = keys" + the top-bar Settings tab with its Ctrl+, key (tooltip; the tab bar hides the kbd text)`, !miss.length && k.help === 'F1 = keys' && /Settings/i.test(k.setTop) && k.setKbd === 'Ctrl+,' && k.setTitle === 'Settings (Ctrl+,)' && k.setVis, 'missing ' + JSON.stringify(miss) + ' | ' + k.help + ' | ' + k.setTop);
        const al = await p.evaluate(() => [...document.querySelectorAll('#actions .abtn')].filter(e => !e.closest('.hgrp') || e === e.closest('.hgrp').firstElementChild).map(e => ({ a: e.dataset.a, d: Math.round(e.querySelector('.t').getBoundingClientRect().left - e.getBoundingClientRect().left) })));
        rec(`${sz} left column: every button's text starts at the same place (Return / Log Out no longer further right)`, al.every(x => x.d === al[0].d), JSON.stringify(al));
      }
      const sc = await p.evaluate(() => { const i = document.getElementById('scanInput'), r = i.getBoundingClientRect(), c = getComputedStyle(i), g = document.querySelector('.gridbox').getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width), fs: parseFloat(c.fontSize), lbl: parseFloat(getComputedStyle(document.querySelector('.scanrow label')).fontSize), above: r.bottom <= g.top, inView: r.top >= 0 && r.bottom <= innerHeight }; });
      rec(`${sz} SCANNING INPUT bigger than 1.0.2 (was 33px tall, 14px text, max 440px wide) and still at the top`, sc.h >= 44 && sc.fs >= 20 && sc.lbl >= 14 && sc.above && sc.inView && (w < 1280 || sc.w > 440), JSON.stringify(sc));
      await scan('1001'); await scan('1004');
      const lines = await p.$$eval('#cart tr.row', x => x.length); rec(`${sz} scanning still works (2 lines added)`, lines === 2, lines + ' lines');
      const t = await p.evaluate(() => { const g = s => document.querySelector(s); const tot = g('.totals'), v = g('.totals .total span:last-child'), l = g('.totals .total span:first-child');
        return { bg: getComputedStyle(tot).backgroundColor, c: getComputedStyle(v).color, fs: parseFloat(getComputedStyle(v).fontSize), lbl: l.textContent.trim(), v: v.textContent.trim(), inView: tot.getBoundingClientRect().bottom <= innerHeight }; });
      rec(`${sz} totals: one dark bar, big Total in the lighter AIR POS blue`, t.bg === DARK && t.c === BLUE_L && t.fs >= 30 && /^Total/i.test(t.lbl) && /^\$\d/.test(t.v) && t.inView, JSON.stringify(t));
      await f12();
      let f = await panelFit(['payBack', 'payOk']); rec(`${sz} payment panel: nothing cut off, Back and Pay on screen, no scrolling`, f.ok, JSON.stringify(f));
      const pv = await p.evaluate(() => ({ bal: getComputedStyle(document.querySelector('.paynums .pn.left b')).color, bg: getComputedStyle(document.querySelector('.paynums .pn.left')).backgroundColor, cash: getComputedStyle(document.querySelector('.pline[data-t="10"]')).boxShadow, gift: getComputedStyle(document.querySelector('.pline[data-t="40"]')).boxShadow, back: document.getElementById('payBack').textContent.trim(), pay: document.getElementById('payOk').textContent.trim() }));
      rec(`${sz} payment: dark Balance strip in the lighter blue, Cash green / Gift Card orange stripes, "Back (Esc)" + "Pay Alt+P" kept`, pv.bg === DARK && pv.bal === BLUE_L && pv.cash.includes(C.green) && pv.gift.includes(C.orange) && pv.back === 'Back (Esc)' && /^Pay/.test(pv.pay) && /Alt\+P/.test(pv.pay), JSON.stringify(pv));
      await p.keyboard.press('Escape'); await sleep(500); rec(`${sz} Esc still closes the payment panel`, !(await p.$('#payBody')), '');
      await clean(); await post('return-start', { kind: 'receipt', orderId: 'o-ret-acct' }); await load(); await scan('1001'); await f12();
      f = await panelFit(['refBack', 'rOk']); rec(`${sz} refund panel: nothing cut off, Back and Refund on screen, no scrolling`, f.ok, JSON.stringify(f));
      const rv = await p.evaluate(() => ({ line: getComputedStyle(document.querySelector('#refLines .pline')).boxShadow, back: document.getElementById('refBack').textContent.trim(), ok: document.getElementById('rOk').textContent.trim() }));
      rec(`${sz} refund: red stripes on the refund lines; "Back (Esc)" and "Refund $… (Enter)" kept`, rv.line.includes(C.red) && rv.back === 'Back (Esc)' && /^Refund \$[\d.,]+ \(Enter\)$/.test(rv.ok), JSON.stringify(rv));
      await p.keyboard.press('Escape'); await sleep(500); rec(`${sz} Esc still closes the refund panel, nothing sent`, !(await p.$('#refBody')), '');
      await clean();
    }
    rec('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { rec('run', false, e.stack); }
  finally { await p.close().catch(() => {}); b.disconnect(); }
  const fail = out.filter(x => !x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-stripes-103-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: out.length - fail, failed: fail, out }, null, 1));
  console.log(`${out.length - fail} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

// AirMax 1.0.8 payment pop-up (Ari OK 12:50 AM ET Oct 30, mock-up /workspace/airpos-look-backups/payment-popup-mockup/).
// Payment, refund, split and the 1.2.3.1 stuck states open as a centred pop-up over the dimmed option-A sale screen.
// CSS/layout only: the checks here are about place, size, fit and the dim layer (tapping outside does nothing, Esc/Back as before).
// Offline strict fake AIR POS only (made-up data, no account).
// Run: FAKE_STRICT_COMPLETE=1 FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-popup-108.js  (Chrome on 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/'; fs.mkdirSync(SCR, { recursive: true });
const WIDTHS = [1366, 1280, 1024], SHOT = [1366, 1024], POP_W = w => Math.min(900, w - 48);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = async p => JSON.parse(await (await fetch(HOOK + p)).text());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const p = await b.newPage(); const errs = [];
  try {
    if ((await hook('/strict')).promoFail === undefined) throw new Error('fake server is not in FAKE_STRICT_COMPLETE=1 mode');
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    const clean = async () => { await post('pay-close'); await post('return-cancel'); await post('return-toggle', { on: false }); await post('new-sale'); await post('dismiss'); await post('member-detach'); };
    await clean();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {})); await p.bringToFront();
    await p.setViewport({ width: 1366, height: 768 });
    const load = async () => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const f12 = async () => { await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1300); };
    const mtxt = () => p.$eval('#modalRoot', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    // place + fit of the pop-up: centred, on screen, no scrolling, every button / label / box inside it and not cut off; dim layer covers the sale
    const pop = ids => p.evaluate(ids => {
      const m = document.querySelector('#modalRoot .modal'), o = document.getElementById('ov'); if (!m || !o) return { open: false };
      const r = m.getBoundingClientRect(), vis = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const els = [...m.querySelectorAll('button, input, .plbl, kbd, .paynums > *, h2, .note')].filter(vis);
      const bad = els.filter(e => { const q = e.getBoundingClientRect(); return q.left < r.left - 1 || q.right > r.right + 1 || q.top < r.top - 1 || q.bottom > r.bottom + 1 || (e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 1); })
        .map(e => (e.id || e.className || e.tagName) + ':' + (e.innerText || e.value || '').slice(0, 20));
      const scrolls = [m, ...m.querySelectorAll('#payBody, #refBody, .paygrid, .payact')].filter(e => e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map(e => e.id || e.className);
      const hits = [[8, innerHeight / 2], [innerWidth - 8, innerHeight / 2], [innerWidth / 2, 6], [innerWidth / 2, innerHeight - 6]].map(([x, y]) => { const h = document.elementFromPoint(x, y); return !!h && o.contains(h) && !m.contains(h); });
      const ob = o.getBoundingClientRect(), bg = getComputedStyle(o).backgroundColor, a = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg);
      const miss = ids.filter(id => { const e = document.getElementById(id); return !e || !vis(e); });
      return { open: true, w: Math.round(r.width), mid: Math.round(r.x + r.width / 2), top: Math.round(r.top), bottom: Math.round(r.bottom), onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        bad, scrolls, dimAll: ob.width >= innerWidth - 1 && ob.height >= innerHeight - 1, dimA: a ? Number(a[1]) : (bg === 'transparent' ? 0 : 1), blocked: hits.every(Boolean), miss, cls: m.className };
    }, ids || []);
    const popOk = (q, w) => q.open && Math.abs(q.w - POP_W(w)) <= 1 && Math.abs(q.mid - w / 2) <= 2 && q.onScreen && !q.bad.length && !q.scrolls.length && q.dimAll && q.dimA >= 0.3 && q.blocked && !q.miss.length;
    const short = q => JSON.stringify({ w: q.w, mid: q.mid, top: q.top, bottom: q.bottom, bad: q.bad, scrolls: q.scrolls, dimA: q.dimA, blocked: q.blocked, miss: q.miss });
    const allWidths = async (name, ids, shot) => { for (const w of WIDTHS) { await p.setViewport({ width: w, height: 768 }); await sleep(600); const q = await pop(ids);
      rec(`${name} at ${w}: centred pop-up ${POP_W(w)}px, sale dimmed + blocked, nothing cut off, no scrolling`, popOk(q, w), short(q));
      if (shot && SHOT.includes(w)) await p.screenshot({ path: `${SCR}v108-popup-${shot}-${w}.png` }); }
      await p.setViewport({ width: 1366, height: 768 }); await sleep(500); };

    // ---- 1: payment ----
    await load(); await scan('1001'); await scan('1003'); await f12();
    await allWidths('Payment', ['payBack', 'payOk'], 'payment');
    let t = await mtxt();
    rec('Payment: note says press Back (no "tap the sale")', /Press Back \(Esc\) to add items/.test(t) && !/tap the sale/i.test(t), t.slice(0, 90));
    rec('Payment: buttons and key labels kept (6 tenders, Back (Esc), Pay Alt+P)', /Back \(Esc\)/.test(t) && await p.$$eval('.pline .plbl', x => x.length) === 6 && await p.$eval('#payOk', e => /Pay/.test(e.innerText) && /Alt\+P/i.test(e.innerText)).catch(() => false), t.slice(0, 220));
    const s0 = await state();
    for (const [x, y] of [[20, 380], [1340, 380], [683, 10], [683, 740]]) { await p.mouse.click(x, y); await sleep(400); }
    const s1 = await state(); t = await mtxt();
    rec('Tapping outside the pop-up (actions, right panel, top bar, boxes) does nothing', !!(await p.$('#payBody')) && /Payment/.test(t) && !/History|Settings|Customer number/.test(t.replace(/Press Back.*/, '')) && s1.cart.length === s0.cart.length && !(s1.pay && s1.pay.paid), `pop-up ${!!(await p.$('#payBody'))}, cart ${s0.cart.length}->${s1.cart.length}`);
    await p.keyboard.press('Escape'); await sleep(800);
    const s2 = await state();
    rec('Esc = Back: pop-up closes, sale unchanged (as before)', !(await p.$('#payBody')) && s2.cart.length === 2 && !s2.pay, `pop-up ${!!(await p.$('#payBody'))}, cart ${s2.cart.length}`);
    // ---- 2: split (Cash $5.00 applied, rest left) ----
    await f12(); await p.click('.pline[data-i="1"] .plbl'); await sleep(300);
    await p.$eval('.pline[data-i="1"] .pamt', e => { e.focus(); e.select && e.select(); }); await p.keyboard.type('5'); await sleep(200); await p.click('#payOk'); await sleep(1300);
    const sp = await state(); t = await mtxt();
    rec('Split: Cash $5.00 taken, the rest still due, pop-up stays open', sp.pay && sp.pay.paid === 5 && sp.pay.remaining > 0 && !!(await p.$('#payBody')), `paid ${sp.pay && sp.pay.paid}, remaining ${sp.pay && sp.pay.remaining}`);
    await allWidths('Split', ['payOk'], 'split');
    // mny109a: one cash payment per sale, so the rest goes on a card (the fake terminal approves at once)
    const rest = await post('pay-tender', { type: 20, amount: sp.pay.remaining, stockOk: true }); await sleep(300); const se = await state();
    rec('Split: a card pays the rest and the sale completes (payment logic as before)', rest.ok && !se.pay && !se.cart.length, JSON.stringify({ ok: rest.ok, pay: !!se.pay, cart: se.cart.length }));
    await load();
    await clean();
    // ---- 3: refund (1.0.2 refund fit kept: all 6 lines, Back (Esc), Refund $X (Enter), no scrolling) ----
    await post('return-start', { kind: 'receipt', orderId: 'o-ret-acct' }); await load(); await scan('1001'); await f12();
    t = await mtxt();
    rec('Refund: opens in the pop-up, note says press Back, 6 lines, Back (Esc), Refund $X (Enter)', /Refund/.test(t) && /press Back \(Esc\) to change items/.test(t) && !/tap the sale/i.test(t) && await p.$$eval('.pline .plbl', x => x.length) === 6 && /Back \(Esc\)/.test(t) && /Refund \$[\d.]+ \(Enter\)/.test(t), t.slice(0, 160));
    await allWidths('Refund', ['refBack', 'rOk'], 'refund');
    for (const [x, y] of [[20, 380], [1340, 380]]) { await p.mouse.click(x, y); await sleep(400); }
    rec('Refund: tapping outside does nothing', !!(await p.$('#refBody')), `open ${!!(await p.$('#refBody'))}`);
    await p.keyboard.press('Escape'); await sleep(800);
    rec('Refund: Esc = Back, pop-up closes', !(await p.$('#refBody')), `open ${!!(await p.$('#refBody'))}`);
    await clean();
    // ---- 4: 1.2.3.1 stuck: paid, AIR POS refuses to finish ----
    await load(); await scan('1001'); await hook('/complete-refuse?n=2');
    let st = await state(); const due = st.totals.due;
    const r1 = await post('pay-cash', { tendered: due }); await sleep(300); await load();
    t = await mtxt();
    rec('Stuck: way out shown inside the pop-up (Back to sale (payments kept) (Esc), Check AIR POS again, Finish sale)', !r1.ok && /Back to sale \(payments kept\) \(Esc\)/.test(t) && /Check AIR POS again/.test(t) && /Finish sale/.test(t), t.slice(0, 200));
    await allWidths('Stuck (paid, not finished)', ['payKeepBack', 'payRecheck', 'payFinish'], 'stuck-keepback');
    await p.mouse.click(20, 380); await sleep(500); st = await state();
    rec('Stuck: tapping outside does nothing (pop-up stays, payment kept)', !!(await p.$('#payBody')) && st.pay && st.pay.paid === due, `open ${!!(await p.$('#payBody'))}, paid ${st.pay && st.pay.paid}`);
    await p.keyboard.press('Escape'); await sleep(900); st = await state();
    const bar = await p.$eval('#payStuck', e => e.offsetParent ? e.innerText : '').catch(() => '');
    rec('Stuck: Esc closes the pop-up, payment kept, red bar on the sale with Back to payment (F12)', !(await p.$('#payBody')) && st.pay && st.pay.paid === due && /sale not finished/.test(bar) && /Back to payment \(F12\)/.test(bar), bar.replace(/\s+/g, ' '));
    for (const w of SHOT) { await p.setViewport({ width: w, height: 768 }); await sleep(500); await p.screenshot({ path: `${SCR}v108-popup-stuck-redbar-${w}.png` });
      const fit = await p.evaluate(() => [...document.querySelectorAll('#psBack,#psCheck')].map(e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && e.scrollWidth <= e.clientWidth + 1; }));
      rec(`Stuck red bar at ${w}: Back to payment (F12) and Check AIR POS again fully on screen`, fit.length === 2 && fit.every(Boolean), JSON.stringify(fit)); }
    await p.setViewport({ width: 1366, height: 768 }); await sleep(400);
    await f12(); await p.keyboard.press('Enter'); await sleep(1300); await p.keyboard.press('Enter'); await sleep(1500);
    rec('Stuck: F12 + Finish (twice: AIR POS refuses once more, then accepts) completes the sale', /Sale complete/.test(await mtxt()), (await mtxt()).slice(0, 80));
    await clean();
    const mock = await p.evaluate(() => /MOCK-UP/i.test(document.body.innerText));
    rec('No MOCK-UP tag on screen', !mock, '');
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
  } catch (e) { rec('ran without crashing', false, e.stack); }
  finally { await p.close().catch(() => {}); b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-popup-108-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} payment pop-up checks passed (AirMax 1.0.8)`); process.exit(f ? 1 : 0);
})();

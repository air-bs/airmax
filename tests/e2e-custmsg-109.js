// 1.0.9-local.5 (Ari OK 4:17 PM ET Oct 30 2026): "Air Max" name on screen + per-shop customer screen messages in Settings,
// and the 4:20 PM display-only items (no "$0.00 store credit"; no "Nothing was paid" claim). OFFLINE fake AIR POS only.
//   FAKE_PORT=5180 CASHIER_PORT=5182 node tests/e2e-custmsg-109.js   (Chrome on CHROME_URL, default 9433). Screens at 1366 x 768.
'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), CP = Number(process.env.CASHIER_PORT || 5182);
const BASE = 'http://127.0.0.1:' + FP, CBASE = 'http://127.0.0.1:' + CP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, pass = 0; const rec = (k, ok, note = '') => { n++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (base, r, x) => fetch(base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const cstate = () => fetch(BASE + '/api/customer-state').then(r => r.json());
const state = base => fetch(base + '/api/state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9433', defaultViewport: { width: 1366, height: 768 } });
  try {
    // ---- rename: login screen + top bar ----
    const lp = await b.newPage(); await lp.goto(CBASE + '/'); await sleep(1500);
    const lt = await lp.evaluate(() => ({ title: document.title, h1: (document.querySelector('h1') || {}).innerText || '', body: document.body.innerText }));
    rec('R1 login screen + window title say "Air Max"', lt.title === 'Air Max' && /Air Max/.test(lt.h1) && !/Air Register|AIR POS look/.test(lt.h1), JSON.stringify({ t: lt.title, h1: lt.h1 }));
    await lp.screenshot({ path: SCR + 'rename-1-login-1366.png' }); await lp.close();
    if (!(await state(BASE)).loggedIn) await post(BASE, 'login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post(BASE, 'pay-close'); await post(BASE, 'new-sale');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '/'); await sleep(1800);
    const top = await p.evaluate(() => { const a = document.querySelector('.apname'); return { name: a ? a.innerText : '', bar: (a && a.parentElement ? a.parentElement.innerText : '').replace(/\s+/g, ' '), title: document.title, btns: document.querySelectorAll('button').length }; });
    rec('R2 top bar shows "Air Max", not the old name', top.name === 'Air Max' && !/Air Register|AIR POS look/.test(top.bar) && top.title === 'Air Max', JSON.stringify(top));
    await p.screenshot({ path: SCR + 'rename-2-sale-1366.png' });
    const man = await fetch(BASE + '/manifest.json').then(r => r.json()).catch(() => ({}));
    rec('R3 app manifest name "Air Max"', man.name === 'Air Max' && man.short_name === 'Air Max', JSON.stringify({ n: man.name, s: man.short_name }));

    // ---- customer messages: defaults ----
    await post(BASE, 'cust-messages-set', { welcome: '', welcome2: '', itemsHead: '', returnHead: '', cardReader: '', thankYou: '' }); // start clean
    let c = await cstate();
    rec('M1 defaults on the customer screen', c.msgs && c.msgs.itemsHead === 'Your items' && c.msgs.cardReader === 'Please use the card reader' && c.msgs.thankYou === 'Thank you' && c.msgs.returnHead === 'Return', JSON.stringify(c.msgs));
    // ---- Settings dialog (manager) ----
    await p.evaluate(() => touchSettingsDialog()); await sleep(1200);
    const has = await p.evaluate(() => ['cm_itemsHead', 'cm_returnHead', 'cm_cardReader', 'cm_thankYou'].map(id => { const e = document.getElementById(id); return e ? { id, ph: e.placeholder, dis: e.disabled } : null; }));
    rec('M2 Settings shows the 4 message fields, placeholders = today\'s texts, editable for a manager', has.every(x => x && !x.dis) && /Please use the card reader/.test(has[2].ph) && /Thank you/.test(has[3].ph), JSON.stringify(has));
    const fill = async (id, v) => { await p.click('#' + id, { clickCount: 3 }); await p.keyboard.press('Backspace'); if (v) await p.type('#' + id, v); };
    await fill('cwW', 'Welcome to Fake shop'); await fill('cm_itemsHead', 'Your basket'); await fill('cm_cardReader', 'Tap, insert or swipe your card'); await fill('cm_thankYou', 'Thanks! See you soon');
    await p.evaluate(() => { const h = [...document.querySelectorAll('h3')].find(x => /Customer screen messages/.test(x.innerText)); if (h) h.scrollIntoView({ block: 'start' }); }); await sleep(300);
    await p.screenshot({ path: SCR + 'custmsg-1-settings-1366.png' });
    await p.click('#tkOk'); await sleep(1800);
    const sm = await p.evaluate(() => document.getElementById('tkMsg').innerText);
    c = await cstate();
    rec('M3 Save: "Saved." and the customer screen gets the new texts', /Saved/.test(sm) && c.msgs.itemsHead === 'Your basket' && c.msgs.cardReader === 'Tap, insert or swipe your card' && c.msgs.thankYou === 'Thanks! See you soon' && c.welcome === 'Welcome to Fake shop', sm + ' ' + JSON.stringify(c.msgs));
    await p.evaluate(() => closeModal && closeModal()).catch(() => {});
    // ---- customer screen ----
    const cp = await b.newPage(); await cp.goto(BASE + '/customer'); await sleep(1200);
    rec('M4 customer Welcome shows the shop\'s welcome', /Welcome to Fake shop/.test(await cp.$eval('#idle', e => e.innerText)));
    await cp.screenshot({ path: SCR + 'custmsg-2-welcome-1366.png' });
    await post(BASE, 'scan', { code: '1001' }); await sleep(1000);
    rec('M5 sale: heading uses the shop\'s text', (await cp.$eval('#head', e => e.innerText)) === 'Your basket');
    await fetch(HOOK + '/card-wait?on=1').then(r => r.text()).catch(() => '');
    await post(BASE, 'pay-start'); await sleep(300); const due = (await cstate()).pay.due;
    let r = await post(BASE, 'pay-tender', { type: 20, amount: due }); await sleep(1300);
    const cm = await cp.evaluate(() => { const m = document.getElementById('cardmsg'); return m ? m.innerText.replace(/\s+/g, ' ').trim() : ''; });
    rec('M6 card reader waiting: shop\'s text + amount (amount unchanged)', r.waiting && cm === 'Tap, insert or swipe your card $' + due.toFixed(2), JSON.stringify({ r: r.message, cm }));
    await cp.screenshot({ path: SCR + 'custmsg-3-card-reader-1366.png' });
    r = await post(BASE, 'card-cancel'); await sleep(800);
    await fetch(HOOK + '/card-wait?on=0').then(r => r.text()).catch(() => '');
    r = await post(BASE, 'pay-tender', { type: 10, tendered: 20 }); if (r.ok && !r.completed) r = await post(BASE, 'finish-sale'); await sleep(1300);
    const done = await cp.evaluate(() => ({ on: document.getElementById('done').classList.contains('on'), h: document.getElementById('thx').innerText }));
    rec('M7 after the sale: shop\'s thank-you text', done.on && done.h === 'Thanks! See you soon', JSON.stringify({ done, r: r.message }));
    await cp.screenshot({ path: SCR + 'custmsg-4-thanks-1366.png' });
    // empty = default again
    await post(BASE, 'cust-messages-set', { itemsHead: '', cardReader: '', thankYou: '', welcome: '' }); await post(BASE, 'settings', { custWelcome: '' });
    c = await cstate();
    rec('M8 emptied = today\'s texts again', c.msgs.itemsHead === 'Your items' && c.msgs.cardReader === 'Please use the card reader' && c.msgs.thankYou === 'Thank you' && !c.welcome, JSON.stringify(c.msgs));
    // cashier cannot change them
    if (!(await state(CBASE)).loggedIn) await post(CBASE, 'login', { company: 'fake shop', user: 'cashier', password: '<redacted>' });
    r = await post(CBASE, 'cust-messages-set', { thankYou: 'hacked' });
    rec('M9 a cashier cannot change the messages', r.ok === false && /manager/i.test(r.message), r.message);
    // ---- 4:20 PM (a): no "$0.00 store credit" ----
    const sc = await p.evaluate(() => ({ zero: custCard({ name: 'Zero Balance', number: '5550101', points: 0, balance: 0 }), some: custCard({ name: 'Sample', number: '5550100', points: 120, balance: 42.5 }) }));
    rec('A1 customer card: no store credit line at $0.00, shown when there is some', !/Store credit/.test(sc.zero) && /Store credit<\/span><b>\$42\.50/.test(sc.some), sc.zero.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120));
    // ---- (b): honest wording on screen ----
    const hw = await p.evaluate(() => honestReply({ ok: false, message: 'AIR POS has no record of this sale yet. Nothing was paid there; take the payment again.' }).message);
    rec('B1 "Check AIR POS again" message no longer says nothing was paid', !/othing was paid/.test(hw) && /already taken on this screen are kept/.test(hw), hw);
    rec('Z no page errors', errs.length === 0, errs.join(' | '));
    await cp.close(); await p.close();
  } catch (e) { rec('crash', false, e.stack); }
  finally { b.disconnect(); }
  console.log(`\n${pass}/${n} passed`); process.exit(pass === n ? 0 : 1);
})();

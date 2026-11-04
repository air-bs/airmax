// Batch 8 browser test: the Gift Cards tab (reload, free credit, orders), store credit in the Customers account-box slot,
// cash fixes in the Reports slots. OFFLINE fake AIR POS only (made-up cards and customers).   B8_FAKE=1 FAKE_PORT=5281 node tests/e2e-api-8-giftcards.js (the fake server must also have B8_FAKE=1)
// run-env: B8_FAKE=1
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5281), BASE = 'http://127.0.0.1:' + FP, HOOK = "http://127.0.0.1:" + (process.env.FAKE_HOOK_PORT || (FP + 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; let n = 0; const rec = (k, pass, note) => { n++; if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = path => fetch(HOOK + path).then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9458'), defaultViewport: { width: 1366, height: 800 } });
  let p; const errs = [];
  const txt = sel => p.$eval(sel, e => e.innerText).catch(() => '');
  const body = () => p.evaluate(() => document.body.innerText);
  const click = async (sel) => { await p.waitForSelector(sel, { timeout: 5000 }); await p.click(sel); };
  const clickText = async (tag, text) => { const ok = await p.evaluate((tag, text) => { const e = [...document.querySelectorAll(tag)].find(x => x.innerText.trim().startsWith(text) && !x.disabled); if (e) e.click(); return !!e; }, tag, text); if (!ok) throw new Error('no ' + tag + ' "' + text + '"'); };
  const type = async (sel, v) => { await p.waitForSelector(sel, { timeout: 5000 }); await p.$eval(sel, e => { e.value = ''; }); await p.type(sel, v); };
  const manager = async (user, pw) => { await p.waitForSelector('#mlU', { timeout: 5000 }); await type('#mlU', user); await type('#mlP', pw); await click('#mlOk'); await sleep(900); };
  // a logged-in manager gets a confirm card (#b8mOk), never the password window (#mlU)
  const confirmMgr = async () => { await p.waitForSelector('#b8mOk', { timeout: 5000 }); const noPw = !(await p.$('#mlU')); await click('#b8mOk'); await sleep(900); return noPw; };
  let pwAsked = 0; const noteMl = async () => { if (await p.$('#mlU')) pwAsked++; };
  try {
    await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    await hook('/gc-reset'); await hook('/sc-reset'); await hook('/cf-reset');
    p = await b.newPage(); p.on('pageerror', e => errs.push(e.message)); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="giftcards"]').click()); await sleep(900);
    let t = await body();
    rec('E1 Gift Cards tab: sub-menu has Cards, Sell / reload, Add credit no payment (manager), Top-up orders', /Cards/.test(t) && /Sell \/ reload a card/.test(t) && /Add credit, no payment/.test(t) && /Top-up orders/.test(t), '');
    rec('E2 cards list shows masked numbers only, never the full number', /\*\*\*\*0001/.test(t) && !/FAKEGC-0001/.test(t), '');
    // paid reload (cash)
    await clickText('.b8nav button', 'Sell / reload'); await sleep(500);
    await type('#b8n', 'FAKEGC-0001'); await type('#b8a', '5'); await click('#b8st'); await sleep(900);
    rec('E3 Start shows the open top-up with a Cash received button (nothing paid yet)', /Cash received/.test(await body()) && (await hook('/gc-state')).cards.find(c => c.id === 'gcard-1').balance === 20, '');
    await click('#b8pay'); await sleep(700);
    rec('E4 after Cash received the Finish button appears; still nothing added', /Finish: add it to the card/.test(await body()) && (await hook('/gc-state')).cards.find(c => c.id === 'gcard-1').balance === 20, '');
    await click('#b8fin'); await sleep(900); t = await body(); let st = await hook('/gc-state');
    rec('E5 Finish adds $5.00 once: the done box shows before $20.00, added $5.00, now $25.00; one Complete sent', /Gift card topped up/.test(t) && /\$25\.00/.test(t) && st.cards.find(c => c.id === 'gcard-1').balance === 25 && st.counters.complete === 1, JSON.stringify(st.counters));
    // free credit
    await clickText('.b8nav button', 'Add credit, no payment'); await sleep(700); t = await body();
    if (process.env.B8_SHOT) await p.screenshot({ path: process.env.B8_SHOT, fullPage: true });
    rec('E6 free-credit screen says no money is taken, X/Z-reads do not count it, no per-credit limit, AIR POS-expired cards blocked, nothing "pending"', /No money is taken/.test(t) && /X-read and Z-read do not count free credit/.test(t) && /No limit per credit/.test(t) && /AIR POS marks as expired are blocked/.test(t) && !/pending/i.test(t) && !/\$50\.00/.test(t) && !(await p.$('#b8lim')), '');
    await type('#b8n', 'FAKEGC-0001'); await type('#b8a', '10'); await type('#b8a2', '12'); await type('#b8r', 'EXAMPLE apology credit'); await click('#b8rev'); await sleep(500);
    rec('E7 two different amounts: refused on the screen, no manager window, nothing sent', /do not match/.test(await body()) && !(await p.$('#mlU')) && (await hook('/gc-state')).counters.save === 1, '');
    await type('#b8a2', '10'); await click('#b8rev'); await sleep(600);
    t = await body();
    rec('E8 manager logged in: Review opens a confirm card saying what will happen (FREE credit) and NO password window', !!(await p.$('#b8mOk')) && !(await p.$('#mlU')) && /FREE credit/.test(t) && !/types their password/.test(t), '');
    await p.keyboard.press('Escape'); await sleep(400); st = await hook('/gc-state');
    rec('E9 Cancel on the confirm card: nothing given, the form (reason, amount twice) stays', !(await p.$('#b8mOk')) && st.cards.find(c => c.id === 'gcard-1').balance === 25 && st.counters.save === 1 && (await p.$eval('#b8a2', e => e.value)) === '10', '');
    await click('#b8rev'); await sleep(600); const e10np = await confirmMgr(); t = await body(); st = await hook('/gc-state');
    rec('E10 OK on the confirm card (no password): free credit added once ($25.00 -> $35.00), no payment step, the card closes', e10np && /Free credit added/.test(t) && /\$35\.00/.test(t) && !(await p.$('#mlU')) && !(await p.$('#b8mOk')) && st.cards.find(c => c.id === 'gcard-1').balance === 35 && st.counters.save === 2 && st.counters.begin === 2 && st.counters.complete === 2, JSON.stringify(st.counters));
    rec('E11 the free-credit list shows it with the reason and the total; the card number only masked', /EXAMPLE apology credit/.test(t) && /\*\*\*\*0001/.test(t) && !/FAKEGC-0001/.test(t), '');
    await clickText('.b8nav button', 'Top-up orders'); await sleep(900); t = await body();
    rec('E12 Top-up orders lists both orders; the free one is tagged "free credit"', /free credit/.test(t) && /Completed/.test(t), '');
    // Delete a top-up (70): manager gets the confirm card only
    await clickText('.b8nav button', 'Sell / reload'); await sleep(500); await type('#b8n', 'FAKEGC-0001'); await type('#b8a', '2'); await click('#b8st'); await sleep(900);
    await clickText('.b8nav button', 'Top-up orders'); await sleep(900); const del0 = (await hook('/gc-state')).counters.del;
    await clickText('#b8out button', 'Delete'); await sleep(500); t = await body();
    const dnp = !(await p.$('#mlU')) && /Delete this unfinished top-up/.test(t) && !/types their password/.test(t); await confirmMgr(); st = await hook('/gc-state');
    rec('E12b manager: Delete a top-up asks no password (confirm card only); one Delete sent; balance unchanged', dnp && st.counters.del === del0 + 1 && st.cards.find(c => c.id === 'gcard-1').balance === 35, JSON.stringify(st.counters));
    // no limit: $60 goes through once; an expired card (AIR POS expired flag) is refused
    await clickText('.b8nav button', 'Add credit, no payment'); await sleep(600);
    await type('#b8n', 'FAKEGC-0001'); await type('#b8a', '60'); await type('#b8a2', '60'); await type('#b8r', 'EXAMPLE larger credit'); await click('#b8rev'); await sleep(500); await noteMl(); await confirmMgr();
    st = await hook('/gc-state');
    rec('E13 no per-credit limit: $60.00 free credit is added once ($35.00 -> $95.00)', st.cards.find(c => c.id === 'gcard-1').balance === 95 && st.counters.complete === 3, JSON.stringify(st.counters));
    await clickText('.b8nav button', 'Add credit, no payment'); await sleep(600);
    await type('#b8n', 'FAKEGC-0002'); await type('#b8a', '5'); await type('#b8a2', '5'); await type('#b8r', 'EXAMPLE expired card'); await click('#b8rev'); await sleep(500); await noteMl(); if (await p.$('#b8mOk')) await click('#b8mOk'); await sleep(900);
    st = await hook('/gc-state');
    rec('E13b a card AIR POS marks expired is refused; nothing added', st.cards.find(c => c.id === 'gcard-2').balance === 5 && st.counters.complete === 3 && /expired/i.test((await body()) + ((await p.$('#b8mMsg')) ? await txt('#b8mMsg') : '')), '');
    await p.keyboard.press('Escape'); await sleep(300); if (await p.$('#b8mOk')) await p.evaluate(() => closeModal());
    // cashier view: perms say not a manager -> the manager-only items never show
    await p.setRequestInterception(true);
    const h = r => { if (/\/api\/perms$/.test(r.url())) r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, manager: false, superAdmin: false, authorities: [], menus: [] }) }); else r.continue(); }; p.on('request', h);
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="checkout"]').click()); await sleep(300);
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="giftcards"]').click()); await sleep(900); t = await body();
    rec('E14 a cashier: no "Add credit, no payment" item and no Delete buttons ever show', !/Add credit, no payment/.test(t) && /Sell \/ reload a card/.test(t), '');
    p.off('request', h); await p.setRequestInterception(false);
    // store credit mount
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="checkout"]').click()); await sleep(300);
    await p.evaluate(() => { const e = document.createElement('div'); e.id = 'phSc'; e.style.cssText = 'position:fixed;top:60px;left:20px;width:560px;background:#fff;z-index:50;padding:8px'; document.body.appendChild(e); AirMaxMounts.fill(e, 'customers.account-box', { customer: { id: 'sc-m1', name: 'Made Up One' } }); }); await sleep(1000);
    await type('#b8ca', '3'); await click('#b8cs'); await sleep(800);
    rec('S1 account box: Add store credit starts a credit order; Cash received shows next', /Cash received/.test(await txt('#phSc')), '');
    await click('#b8pay'); await sleep(600); await click('#b8fin'); await sleep(900); t = await txt('#phSc'); const sc = await hook('/sc-state');
    rec('S2 Finish: "Store credit added" with before and now, one Complete, order finished', /Store credit added/.test(t) && /\$3\.00/.test(t) && sc.counters.complete === 1, t.replace(/\s+/g, ' ').slice(0, 160));
    await hook('/sc-seed?id=sc-other&member=sc-m1'); await click('#b8more'); await sleep(800);
    await click('#b8cl'); await sleep(900); const scd0 = (await hook('/sc-state')).counters.del;
    await clickText('#b8cx button', 'Delete'); await sleep(500); t = await body();
    const snp = !(await p.$('#mlU')) && /Delete this unfinished credit order/.test(t) && !/types their password/.test(t); await confirmMgr(); const sc2 = await hook('/sc-state');
    rec('S3 manager: Delete a credit order asks no password (confirm card only); one Delete sent', snp && sc2.counters.del === scd0 + 1, JSON.stringify(sc2.counters));
    await p.evaluate(() => { document.getElementById('phSc').remove(); });
    // cash fixes mounts
    await p.evaluate(() => { const e = document.createElement('div'); e.id = 'phCf'; e.style.cssText = 'position:fixed;top:60px;left:20px;width:760px;background:#fff;z-index:50;padding:8px'; e.innerHTML = '<div id="phSh"></div><div id="phZn"></div><div id="phZo"></div><div id="phFx"></div>'; document.body.appendChild(e);
      AirMaxMounts.fill(document.getElementById('phSh'), 'reports.shifts.row-actions', { row: { id: 'ses-1', number: 'RSS-ses-1' } });
      AirMaxMounts.fill(document.getElementById('phZn'), 'reports.zreads.row-actions', { row: { id: 'zr-new', number: 'ZR-NEW', hasNewOrder: false } });
      AirMaxMounts.fill(document.getElementById('phZo'), 'reports.zreads.row-actions', { row: { id: 'zr-old', number: 'ZR-OLD', hasNewOrder: true } });
      AirMaxMounts.fill(document.getElementById('phFx'), 'reports.fixes', {}); }); await sleep(1200);
    const bt = await p.evaluate(() => ({ sh: document.getElementById('phSh').innerText, zn: document.getElementById('phZn').innerText, zo: document.getElementById('phZo').innerText, fx: document.getElementById('phFx').innerText }));
    rec('C1 manager sees: shift "Mark short/over handled", Z-read "Cancel Z-read" only where no sale followed, and the cash records button', /Mark short\/over handled/.test(bt.sh) && /Cancel Z-read/.test(bt.zn) && bt.zo.trim() === '' && /Cash short\/over records/.test(bt.fx), JSON.stringify(bt));
    await clickText('#phFx button', 'Cash short/over records'); await sleep(900);
    const rows = await txt('#phFx');
    rec('C5 records list shows the short/over amounts and Open/Handled status', /-\$129\.39/.test(rows) && /Handled/.test(rows) && /Open/.test(rows), rows.replace(/\s+/g, ' ').slice(0, 120));
    await clickText('#phFx button', 'Mark handled'); await sleep(500); await type('#b8rs', 'EXAMPLE single record'); await click('#b8rn'); await sleep(500); const c6np = await confirmMgr(); let cf = await hook('/cf-state');
    rec('C6 Mark handled on one record (111): one call, remark saved', c6np && cf.counters.txHandle === 1 && cf.remarks.length === 1, JSON.stringify(cf.counters));
    await clickText('#phCf button', 'Mark short/over handled'); await sleep(500); await click('#b8rn'); await sleep(300);
    rec('C2 no reason: refused on the screen, nothing sent', /Write a reason/.test(await body()) && (await hook('/cf-state')).counters.sesHandle === 0, '');
    await type('#b8rs', 'EXAMPLE count was re-done'); await click('#b8rn'); await sleep(500); const c3np = await confirmMgr(); cf = await hook('/cf-state');
    rec('C3 manager: reason + confirm card, NO password: shift short/over handled (106), remark saved, window closes', c3np && cf.counters.sesHandle === 1 && cf.remarks.length === 2 && /re-done/.test(cf.remarks[1]) && !(await p.$('#mlU')), JSON.stringify(cf.counters));
    await clickText('#phCf button', 'Cancel Z-read'); await sleep(500); await type('#b8rs', 'EXAMPLE wrong day'); await type('#b8zn', 'ZR-OLD'); await click('#b8rn'); await sleep(500);
    rec('C4a Cancel Z-read: a wrong typed Z-read number is refused on the screen, no confirm card, nothing sent', !(await p.$('#b8mOk')) && !(await p.$('#mlU')) && (await hook('/cf-state')).counters.zCancel === 0 && /Z-read number/.test(await body()), '');
    await type('#b8zn', 'zr-new'); await click('#b8rn'); await sleep(500); const c4np = await confirmMgr(); cf = await hook('/cf-state');
    rec('C4 manager: Cancel Z-read (117) with the Z number typed + confirm card, NO password: goes through once', c4np && cf.counters.zCancel === 1 && !(await p.$('#mlU')), JSON.stringify(cf.counters));
    await p.evaluate(() => document.getElementById('phCf').remove());
    rec('M1 manager: the password window never appeared in any of the manager steps', pwAsked === 0, String(pwAsked));
    // ---- cashier (not a manager): the manager-only actions are hidden; the shared helper still asks for a manager password
    await p.setRequestInterception(true);
    const h2 = r => { if (/\/api\/perms$/.test(r.url())) r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, manager: false, superAdmin: false, authorities: [], menus: [] }) }); else r.continue(); }; p.on('request', h2);
    await p.evaluate(() => { S.user.manager = false; }); await post('perms');
    await p.evaluate(() => { const e = document.createElement('div'); e.id = 'phK'; e.style.cssText = 'position:fixed;top:60px;left:20px;width:760px;background:#fff;z-index:50;padding:8px'; e.innerHTML = '<div id="kSh"></div><div id="kZn"></div><div id="kFx"></div><div id="kSc"></div>'; document.body.appendChild(e);
      AirMaxMounts.fill(document.getElementById('kSh'), 'reports.shifts.row-actions', { row: { id: 'ses-1', number: 'RSS-ses-1' } });
      AirMaxMounts.fill(document.getElementById('kZn'), 'reports.zreads.row-actions', { row: { id: 'zr-old2', number: 'ZR-X', hasNewOrder: false } });
      AirMaxMounts.fill(document.getElementById('kFx'), 'reports.fixes', {});
      AirMaxMounts.fill(document.getElementById('kSc'), 'customers.account-box', { customer: { id: 'sc-m1', name: 'Made Up One' } }); }); await sleep(1200);
    const kt = await txt('#phK');
    rec('K1 cashier: no shift fix (106), no Cancel Z-read (117), no cash records (111), no credit-order list / Delete in the account box', !/Mark short\/over handled|Cancel Z-read|Cash short\/over records/.test(kt) && !(await p.$('#b8cl')), kt.replace(/\s+/g, ' ').slice(0, 160));
    await p.evaluate(() => document.getElementById('phK').remove());
    await p.evaluate(() => AirMaxB8.manager('Add free credit', 'Add FREE credit. A manager types their password to approve.', m => fetch('/api/gc-free-credit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: 'FAKEGC-0001', amount: 1, amount2: 1, reason: 'EXAMPLE cashier', ...m }) }).then(r => r.json()))); await sleep(500);
    rec('K2 cashier: the manager step opens the password window (not the plain confirm card)', !!(await p.$('#mlU')) && !(await p.$('#b8mOk')), '');
    const kb0 = (await hook('/gc-state')).cards.find(c => c.id === 'gcard-1').balance;
    await manager('boss', 'wrong-pw'); const kb1 = (await hook('/gc-state')).cards.find(c => c.id === 'gcard-1').balance;
    rec('K3 cashier: a wrong manager password is refused, the window stays, nothing given', !!(await p.$('#mlU')) && kb1 === kb0, (await txt('#mlMsg')).slice(0, 80));
    await manager('boss', 'boss-pw'); const kb2 = (await hook('/gc-state')).cards.find(c => c.id === 'gcard-1').balance;
    rec('K4 cashier: the right manager password approves it once and the window closes', !(await p.$('#mlU')) && kb2 === kb0 + 1, kb0 + ' -> ' + kb2);
    p.off('request', h2); await p.setRequestInterception(false);
    rec('X0 no page errors', !errs.length, errs.join(' | ').slice(0, 200) || 'none');
  } catch (e) { rec('X1 run finished', false, String(e && e.stack || e).slice(0, 400)); }
  finally { if (p) await p.close().catch(() => {}); await b.disconnect(); }
  console.log(`${n - fails.length} passed, ${fails.length} failed${fails.length ? ': ' + fails.join('; ') : ' - ALL PASSED'}`); process.exit(fails.length ? 1 : 0);
})();

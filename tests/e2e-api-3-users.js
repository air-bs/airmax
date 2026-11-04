// run-env: FAKE_CASHIER=1 AIRMAX_USERS_IDLE_MS=6000
// AirMax Batch 3 (Users and operators), browser test: the USERS tab behind the manager unlock, on the OFFLINE fake AIR POS only.
// The register is a CASHIER. FAKE_PORT=5230 node tests/e2e-api-3-users.js     (USERS_SHOTS_DIR=/some/dir also saves screenshots there)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const FP = Number(process.env.FAKE_PORT || 5230), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SHOTS = process.env.USERS_SHOTS_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' - ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(HOOK + '/users-state').then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: process.env.CHROME_URL || 'http://127.0.0.1:9453', defaultViewport: { width: 1366, height: 768 } });
  let p;
  const host = () => p.evaluate(() => { const h = document.getElementById('sectionHost'); return { hidden: h.hidden, text: h.innerText.replace(/\s+/g, ' ').trim(), html: h.innerHTML.length }; });
  const modalText = () => p.$eval('#modalRoot', e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  const tab = id => p.evaluate(x => document.querySelector('#tabbar .tab[data-tab="' + x + '"]').click(), id);
  const btns = () => p.evaluate(() => [...document.querySelectorAll('#sectionHost button')].map(e => e.textContent.trim()));
  const clickText = (sel, t) => p.evaluate((s, t) => { const e = [...document.querySelectorAll(s)].find(x => x.textContent.trim() === t); if (e) e.click(); return !!e; }, sel, t);
  const rows = () => p.$$eval('#usRows tr[data-i]', t => t.map(r => r.children[0].textContent + '|' + r.children[1].textContent + '|' + r.children[2].textContent));
  const unlock = async (u, pw) => { await tab('users'); await sleep(500); await p.type('#mlU', u); await p.type('#mlP', pw); await p.click('#mlOk'); await sleep(900); };
  const shot = async n => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + '/' + n }); } };
  try {
    await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' }); await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    // before the unlock
    const t0 = await p.evaluate(() => ({ tab: !!document.querySelector('#tabbar .tab[data-tab="users"]'), shown: document.getElementById('sectionHost').hidden, body: /ZZ Test|Operator Management|Add Operator/.test(document.body.innerText) }));
    rec('U1 on the register nothing of Users is drawn: the tab is there, the screen area hidden, no operator text anywhere', t0.tab && t0.shown && !t0.body, JSON.stringify(t0));
    rec('U1b no operator data was read before the unlock', (await state()).log.length === 0, '');
    // pop-up
    await tab('users'); await sleep(600);
    const m1 = await modalText(), h1 = await host();
    rec('U2 clicking Users opens the manager approval pop-up (user name + password); behind it only "Manager approval needed", no operator data', /Manager approval/.test(m1) && !!(await p.$('#mlU')) && !!(await p.$('#mlP')) && /Manager approval needed/.test(h1.text) && !/ZZ Test|Add Operator/.test(h1.text), m1.slice(0, 80) + ' | ' + h1.text);
    await p.click('#modalRoot [data-close]'); await sleep(700);
    const c1 = await host(), onTab = await p.evaluate(() => document.querySelector('#tabbar .tab.on').dataset.tab);
    rec('U3 Cancel in the pop-up goes back to Checkout; nothing shown, nothing read', c1.hidden && c1.html === 0 && onTab === 'checkout' && (await state()).log.length === 0, onTab);
    await tab('users'); await sleep(600); await p.keyboard.press('Escape'); await sleep(800);
    rec('U3b Esc in the pop-up goes back to Checkout too', (await host()).hidden && (await p.evaluate(() => document.querySelector('#tabbar .tab.on').dataset.tab)) === 'checkout', '');
    // wrong password
    await tab('users'); await sleep(500); await p.type('#mlU', 'mgr1'); await p.type('#mlP', 'wrong'); await p.click('#mlOk'); await sleep(900);
    const w = await p.$eval('#mlMsg', e => e.textContent).catch(() => 'gone');
    rec('U4 a wrong manager password shows the message in the pop-up and unlocks nothing', /Wrong user name or password/i.test(w) && !!(await p.$('#mlOk')) && !/ZZ Test/.test((await host()).text), w);
    // a cashier login is not a manager
    await p.evaluate(() => { document.getElementById('mlU').value = ''; }); await p.type('#mlU', 'cash2'); await p.type('#mlP', 'cash-pw'); await p.click('#mlOk'); await sleep(900);
    rec('U4b a login that is not a manager is refused in the pop-up', /not a manager/i.test(await p.$eval('#mlMsg', e => e.textContent).catch(() => '')), '');
    // correct manager login
    await p.evaluate(() => { document.getElementById('mlU').value = ''; }); await p.type('#mlU', 'mgr1'); await p.type('#mlP', 'mgr-pw');
    await p.evaluate(() => AirMaxMounts.add('users.extra', { id: 't-us-extra', render(h, c) { h.innerHTML = '<i class="tEx" data-n="' + c.user.fingerPrintCount + '" data-f="' + (c.user.fingerPrints || []).map(f => f.id + '/' + f.fingerIndex).join(';') + '" data-k="' + Object.keys(c.user).sort().join() + '">x:' + c.user.userName + '</i>'; } }));
    await p.click('#mlOk'); await sleep(1100);
    const h2 = await host();
    rec('U5 the right manager login closes the pop-up and draws Operator Management with the list (3 operators)', !(await p.$('#mlOk')) && /Operator Management/.test(h2.text) && /Approved by mgr1/.test(h2.text) && (await rows()).length === 3, h2.text.slice(0, 120));
    const bt = await btns();
    rec('U6 buttons are AIR POS words: Add Operator, Edit (x3); no View, no Delete, no Lock, no Unlock', bt.includes('Add Operator') && bt.filter(x => x === 'Edit').length === 3 && !bt.some(x => /^(View|Delete|Lock|Unlock)/i.test(x)), bt.join(','));
    const ex = await p.$$eval('#usRows .tEx', e => e.map(x => x.textContent));
    rec('U7 every row has the users.extra slot, filled through ctx.mount with { user }', ex.join() === 'x:zz.alice,x:zz.bob,x:zz.carol', ex.join());
    const exd = await p.$$eval('#usRows .tEx', e => e.map(x => [x.dataset.n, x.dataset.f, x.dataset.k]));
    rec('U7b ctx.user in users.extra = { id, name, userName, position, createTime, fingerPrintCount, fingerPrints } (alice: 2 prints, labels only; others 0)', exd.map(x => x[0]).join() === '2,0,0' && exd[0][1] === 'fp-1/1;fp-2/6' && exd.every(x => x[2] === 'createTime,fingerPrintCount,fingerPrints,id,name,position,userName'), JSON.stringify(exd));
    await shot('users-after-unlock.png');
    rec('U8 the cashier register stayed a cashier; the operator calls came from the manager session', (await state()).log.every(x => x.caller === 'manager') && (await state()).log.some(x => x.path === '144'), '');
    // search
    await p.type('#usQ', 'bob'); await p.click('#usSearch'); await sleep(600);
    rec('U9 name search "bob" lists 1 operator', (await rows()).join() === 'ZZ Test Bob|zz.bob|Stock', (await rows()).join());
    await p.evaluate(() => { document.getElementById('usQ').value = ''; }); await p.click('#usSearch'); await sleep(600);
    // edit
    await p.evaluate(() => document.querySelector('#usRows tr[data-i="0"] [data-edit]').click()); await sleep(700);
    const ed = await p.evaluate(() => ({ title: document.querySelector('#usCard h3').textContent, name: document.getElementById('fName').value, phone: document.getElementById('fPhone').value, un: document.getElementById('fUser').textContent, pick: !!document.getElementById('fPick') }));
    rec('U10 Edit opens the form filled from the operator (145); the username is fixed (no picker on Edit)', ed.title === 'Edit' && ed.name === 'ZZ Test Alice' && ed.phone === '555-0101' && ed.un === 'zz.alice' && !ed.pick, JSON.stringify(ed));
    await p.evaluate(() => { document.getElementById('fPos').value = 'Manager on duty'; });
    await p.click('#fSave'); await sleep(300);
    const cf = await p.$eval('#usCard', e => e.innerText.replace(/\s+/g, ' '));
    rec('U11 Save asks to confirm first (nothing saved yet)', /Confirm/.test(cf) && /ZZ Test Alice/.test(cf) && (await state()).ops.find(o => o.id === 'op-1').position === 'Cashier', cf.slice(0, 100));
    await p.click('#fBack'); await sleep(200);
    rec('U11b Back returns to the form with the typed value kept', (await p.$eval('#fPos', e => e.value)) === 'Manager on duty', '');
    await p.click('#fSave'); await sleep(200); await p.click('#fOk'); await sleep(900);
    const sv = await state();
    rec('U12 Confirm saves (147) with the manager session; the form closes and the list shows the change', sv.ops.find(o => o.id === 'op-1').position === 'Manager on duty' && sv.log.some(x => x.path === '147' && x.caller === 'manager') && !(await p.$('#usCard')) && (await rows())[0] === 'ZZ Test Alice|zz.alice|Manager on duty', (await rows())[0]);
    // add
    await p.click('#usAdd'); await sleep(500);
    await p.click('#fSave'); await sleep(200);
    rec('U13 Add Operator: Save with no name is refused on the form', /Enter the operator name/.test(await p.$eval('#fMsg', e => e.textContent)), '');
    await p.type('#fName', 'ZZ test Frank'); await p.type('#fPhone', '555-0199'); await p.type('#fEmail', 'frank@example.com'); await p.type('#fPos', 'Floor'); await p.type('#fDesc', 'made up');
    await p.click('#fSave'); await sleep(200);
    rec('U13b Save with no user chosen is refused on the form', /Select the user/.test(await p.$eval('#fMsg', e => e.textContent)), '');
    await p.click('#fPick'); await sleep(700);
    const pk = await p.$$eval('#pList tr', t => t.map(r => r.children[0].textContent));
    rec('U14 Select User lists the AIR POS logins (call 20, picker is on Add only)', pk.length === 5 && pk.includes('zz.dave'), pk.join());
    await p.type('#pQ', 'dave'); await p.click('#pGo'); await sleep(600);
    rec('U14b the picker searches by user name', (await p.$$eval('#pList tr', t => t.length)) === 1, '');
    await p.click('#pList [data-i="0"]'); await sleep(400);
    const af = await p.evaluate(() => ({ un: document.getElementById('fUser').textContent, name: document.getElementById('fName').value }));
    rec('U15 choosing a login returns to the form with the name kept and the username set', af.un === 'zz.dave' && af.name === 'ZZ test Frank', JSON.stringify(af));
    await shot('add-operator-form.png');
    await p.click('#fSave'); await sleep(200); await p.click('#fOk'); await sleep(900);
    const s4 = await state();
    rec('U16 Confirm creates the operator (146) with the manager session and the list shows it', s4.ops.some(o => o.name === 'ZZ test Frank' && o.userName === 'zz.dave') && s4.log.some(x => x.path === '146' && x.caller === 'manager') && (await rows()).some(r => r.startsWith('ZZ test Frank|zz.dave')), (await rows()).join(' ; '));
    // Esc closes the form first, not the screen
    await p.click('#usAdd'); await sleep(300); await p.keyboard.press('Escape'); await sleep(300);
    rec('U17 Esc with a form open closes the form only; the screen stays', !(await p.$('#usCard')) && /Operator Management/.test((await host()).text), '');
    // leaving
    await tab('checkout'); await sleep(700);
    const lv = await host(), stt = await post('users-status');
    rec('U18 leaving the tab clears the screen and drops the manager session', lv.hidden && lv.html === 0 && stt.unlocked === false, JSON.stringify(stt));
    await tab('users'); await sleep(600);
    rec('U19 opening Users again asks for the manager password again', !!(await p.$('#mlU')) && !/ZZ Test/.test((await host()).text), '');
    await p.keyboard.press('Escape'); await sleep(600);
    // idle
    await unlock('mgr1', 'mgr-pw'); const up = (await host()).text;
    await sleep(7300);
    const idl = await host(), on2 = await p.evaluate(() => document.querySelector('#tabbar .tab.on').dataset.tab), st2 = await post('users-status');
    rec('U20 after the idle time with no use the screen clears and drops back to Checkout; the manager session is gone', /Operator Management/.test(up) && idl.hidden && idl.html === 0 && on2 === 'checkout' && st2.unlocked === false, on2 + ' ' + JSON.stringify(st2));
    // gate
    await unlock('nomenu1', 'nomenu-pw');
    const gb = await btns(), gh = await host();
    rec('U21 a manager without Operator Management sees the list but Add Operator and Edit are not drawn (hidden, not disabled)', /Operator Management/.test(gh.text) && (await rows()).length >= 3 && !gb.includes('Add Operator') && !gb.includes('Edit') && !(await p.$('#usAdd')) && !(await p.$('[data-edit]')), gb.join(','));
    await tab('checkout'); await sleep(500);
    // checkout untouched
    const co = await p.evaluate(() => ({ wrap: !!document.querySelector('.wrap').offsetParent, hidden: document.getElementById('sectionHost').hidden }));
    rec('U22 Checkout is back and shown as before', co.wrap && co.hidden, JSON.stringify(co));
    rec('U23 no page errors', !errs.length, errs.join(' | ').slice(0, 200) || 'none');
  } catch (e) { rec('U0 run finished', false, String(e && e.stack || e).slice(0, 400)); }
  finally { try { await post('users-lock'); } catch {} if (p) await p.close().catch(() => {}); b.disconnect(); }
  console.log(`${fails.length ? 'FAILED' : 'ALL PASSED'}: ${fails.length} failed${fails.length ? ': ' + fails.join('; ') : ''}`); process.exit(fails.length ? 1 : 0);
})();

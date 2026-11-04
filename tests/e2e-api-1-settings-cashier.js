// run-env: FAKE_CASHIER=1
// AirMax API batch 1, Settings page for a CASHIER login (not a manager): manager-only sections are not drawn at all; Terminal switches is there,
// and saving needs a manager's user name + password (checked with AIR POS). OFFLINE fake AIR POS only (manager = boss / boss-pw).
//   FAKE_PORT=5180 node tests/e2e-api-1-settings-cashier.js        (SHOTS_DIR=<folder> also saves screenshots)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1), SHOTS = process.env.SHOTS_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = p => fetch(HOOK + p).then(r => r.json());
(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    await post('login', { company: 'fake shop', user: 'cashier', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await fetch(HOOK + '/lookups-reset');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss().catch(() => {})); await p.setCacheEnabled(false);
    await p.goto(BASE + '/'); await sleep(2000);
    const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'settings-cashier-' + n + '.png') }); };
    await p.evaluate(() => { window.__r = { m: AirMaxSettings.add({ key: 'dummy-m', label: 'Dummy M', group: 'Receipts & Printing', after: 'labels', render: h => { h.textContent = 'mgr only'; } }), a: AirMaxSettings.add({ key: 'dummy-a', label: 'Dummy A', group: 'Receipts & Printing', after: 'labels', who: 'all', render: (h, c) => { h.textContent = 'for all ' + c.manager; } }), d: AirMaxSettings.add({ key: 'dummy-m', label: 'x', group: 'Receipts & Printing', render() {} }) }; });
    await p.evaluate(() => document.getElementById('setTop').click()); await sleep(1300);
    const nav = await p.evaluate(() => [...document.querySelectorAll('#stTabs [data-tab]')].map(b => b.dataset.tab));
    const HIDDEN = ['paytypes', 'taxkinds', 'account', 'lists', 'access'];
    rec('K1 a cashier does not see Payment types, Tax kinds, Account, Store lists or Roles & permissions (not drawn at all)', HIDDEN.every(k => !nav.includes(k)) && !(await p.evaluate(() => /Roles & permissions|Account|Tax kinds/.test(document.getElementById('stTabs').innerText))), nav.join(','));
    rec('K2 a cashier still sees the nine old tabs and Terminal switches', ['returns', 'bulk', 'buttons', 'printer', 'labels', 'screen', 'touch', 'cards', 'remote', 'terminal'].every(k => nav.includes(k)) && nav.filter(k => !/^dummy/.test(k)).length === 10, String(nav.length));
    const ex = await p.evaluate(() => ({ r: window.__r, mgr: !!document.querySelector('#stTabs [data-tab="dummy-m"]'), txt: document.getElementById('stTabs').innerText.includes('Dummy M'), all: !!document.querySelector('#stTabs [data-tab="dummy-a"]') }));
    rec('K13 AirMaxSettings: a "manager" entry is not drawn at all for a cashier, a "who: all" entry is, a duplicate key is refused', ex.r.m === true && ex.r.a === true && ex.r.d === false && !ex.mgr && !ex.txt && ex.all, JSON.stringify(ex));
    await p.evaluate(() => settingsPage('dummy-m')); await sleep(700);
    rec('K14 asking for the hidden manager-only entry opens Printer & Drawer instead', await p.evaluate(() => document.querySelector('#stTabs .on').dataset.tab === 'printer'));
    await p.evaluate(() => document.querySelector('#stTabs [data-tab="dummy-a"]').click()); await sleep(600);
    rec('K15 the "who: all" entry opens for a cashier with manager=false', await p.evaluate(() => /for all false/.test(document.querySelector('#modalRoot .stbody').innerText)));
    await p.evaluate(() => document.querySelector('#stTabs [data-tab="printer"]').click()); await sleep(600);
    await p.evaluate(() => settingsPage('access')); await sleep(900);
    rec('K3 asking for a hidden section opens Printer & Drawer instead', await p.evaluate(() => document.querySelector('#stTabs .on').dataset.tab === 'printer'));
    await p.evaluate(() => document.querySelector('#stTabs [data-tab="terminal"]').click()); await sleep(1500); await shot('terminal');
    const t0 = await p.evaluate(() => ({ n: document.querySelectorAll('[data-sw]').length, save: document.getElementById('lkSave').disabled, appr: document.getElementById('lkAppr').hidden }));
    rec('K4 Terminal switches opens for a cashier: switches shown, Save off, manager box not shown until a change', t0.n === 6 && t0.save && t0.appr);
    await p.click('[data-sw="cashCheckoutConfirm"]'); await sleep(250); await shot('terminal-needs-manager');
    const t1 = await p.evaluate(() => ({ appr: document.getElementById('lkAppr').hidden, save: document.getElementById('lkSave').disabled }));
    rec('K5 after a change the manager user name + password box appears (this needs a manager\'s approval)', !t1.appr && !t1.save);
    await p.click('#lkSave'); await sleep(900);
    let st = await hook('/lookups-state');
    rec('K6 Save without a manager name and password is refused and AIR POS gets nothing', st.saveCalls === 0 && /manager/i.test(await p.evaluate(() => document.getElementById('lkMsg').textContent)), String(st.saveCalls));
    await p.type('#lkMu', 'boss'); await p.type('#lkMp', 'wrong-pw'); await p.click('#lkSave'); await sleep(1500);
    st = await hook('/lookups-state'); const m2 = await p.evaluate(() => ({ m: document.getElementById('lkMsg').textContent, pw: document.getElementById('lkMp').value }));
    rec('K7 a wrong manager password is refused and AIR POS gets nothing; the password field is cleared', st.saveCalls === 0 && !m2.pw && /wrong|manager/i.test(m2.m), m2.m.slice(0, 80));
    await p.evaluate(() => { document.getElementById('lkMu').value = 'boss'; }); await p.type('#lkMp', 'boss-pw'); await p.click('#lkSave'); await sleep(1800);
    st = await hook('/lookups-state'); const m3 = await p.evaluate(() => ({ boxes: [...document.querySelectorAll('[data-sw]')].map(x => x.dataset.sw + '=' + x.checked), flash: document.getElementById('stFlash').textContent, appr: document.getElementById('lkAppr').hidden }));
    rec('K8 with the manager\'s name and password the change goes through: call 12 once, switch on, read back, "Saved to AIR POS."', st.saveCalls === 1 && st.saves[0].cashCheckoutConfirm === true && m3.boxes.includes('cashCheckoutConfirm=true') && /Saved to AIR POS/.test(m3.flash) && m3.appr, JSON.stringify(m3).slice(0, 200));
    await shot('terminal-saved');
    rec('K9 the manager password is not in the page text or the register\'s own state afterwards', !(await p.evaluate(() => document.body.innerText.includes('boss-pw') || JSON.stringify(Object.keys(localStorage).map(k => localStorage.getItem(k))).includes('boss-pw'))));
    await post('terminal-config-save', { cashCheckoutConfirm: false, user: 'boss', password: 'boss-pw' }); // put the fake back
    await p.click('#stTabs [data-tab="printer"]'); await sleep(800); await shot('printer');
    const fr = await fetch(BASE + '/api/perms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json());
    rec('K10 the server says this login is not a manager', fr && fr.manager === false, JSON.stringify(Object.keys(fr || {})));
    const sg = await post('store-settings-get');
    rec('K11 the store settings route is closed to a cashier (server side)', sg.ok === false && sg.denied === true);
    rec('K12 no page error', errs.length === 0, errs.join(' | ').slice(0, 200));
    await p.close();
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 600)); }
  finally { try { if (p && !p.isClosed()) await p.close(); } catch (e) {} b.disconnect(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

// AirMax API batch 1: the new Settings page (left section menu, as in the owner's 1.0.11 reference picture) as a MANAGER login. OFFLINE fake AIR POS only.
//   FAKE_PORT=5180 node tests/e2e-api-1-settings.js        (SHOTS_DIR=<folder> also saves one screenshot per section; none by default)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1), SHOTS = process.env.SHOTS_DIR || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = p => fetch(HOOK + p).then(r => r.json());
const OLD = { returns: 'Ctrl+2', bulk: 'Ctrl+5', buttons: 'Ctrl+6', printer: 'Ctrl+1', labels: 'Ctrl+8', screen: 'Ctrl+3', touch: 'Ctrl+4', cards: 'Ctrl+9', remote: 'Ctrl+7' };
const OLDNAME = { returns: 'Returns', bulk: 'Bulk items', buttons: 'Buttons', printer: 'Printer & Drawer', labels: 'Labels', screen: 'Screen', touch: 'Touch', cards: 'Cards', remote: 'Remote help' };
(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await fetch(HOOK + '/lookups-reset');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.dismiss().catch(() => {})); await p.setCacheEnabled(false);
    await p.evaluateOnNewDocument(() => { window.AirMaxSettings = { _q: [], add(e) { this._q.push(e); } }; window.AirMaxSettings.add({ key: 'early-y', label: 'Early Y', group: 'Store & Account', render: h => { h.innerHTML = '<i id="earlyHi">early</i>'; } }); }); // a section file that loaded BEFORE settings.js
    const warns = []; p.on('console', m => { if (/warn/.test(m.type())) warns.push(m.text()); });
    await p.goto(BASE + '/'); await sleep(2000);
    const open = async tab => { await p.evaluate(async t => { if (!document.getElementById('stTabs')) { document.getElementById('setTop').click(); await new Promise(r => setTimeout(r, 900)); } document.querySelector('#stTabs [data-tab="' + t + '"]').click(); }, tab); await sleep(1500); };
    const shot = async n => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'settings-' + n + '.png') }); };
    await p.evaluate(() => document.getElementById('setTop').click()); await sleep(1200);
    const nav = await p.evaluate(() => ({ groups: [...document.querySelectorAll('#stTabs .stgh')].map(e => e.textContent.trim()), items: [...document.querySelectorAll('#stTabs [data-tab]')].map(b => ({ k: b.dataset.tab, t: b.childNodes[0].textContent.trim(), key: (b.querySelector('kbd') || {}).textContent || '', tags: [...b.querySelectorAll('.sttg')].map(x => x.textContent) })),
      top: document.getElementById('tabbar') ? document.getElementById('tabbar').getBoundingClientRect().bottom : 0, ovTop: document.getElementById('ov').getBoundingClientRect().top, ovBottom: document.getElementById('ov').getBoundingClientRect().bottom, h1: (document.querySelector('.sthead h1') || {}).textContent }));
    rec('S1 the left menu has the six sections in order', JSON.stringify(nav.groups) === JSON.stringify(['Sales & Checkout', 'Receipts & Printing', 'Hardware & Screen', 'Payments & Tax', 'Store & Account', 'Users & Permissions']) && nav.h1 === 'Settings', nav.groups.join(' | '));
    const bad = Object.keys(OLD).filter(k => { const i = nav.items.find(x => x.k === k); return !i || i.t !== OLDNAME[k] || i.key !== OLD[k] || i.tags.join() !== 'this PC'; });
    rec('S2 all 9 existing tabs are still there with the same name and the same Ctrl+1..9 key, tagged "this PC"', !bad.length, bad.join(',') || '9 of 9');
    const NEW = { terminal: 'Terminal switches', paytypes: 'Payment types', taxkinds: 'Tax kinds', account: 'Account', lists: 'Store lists', access: 'Roles & permissions' };
    const badN = Object.keys(NEW).filter(k => { const i = nav.items.find(x => x.k === k); return !i || i.t !== NEW[k] || i.key !== '' || i.tags.join() !== 'new,AIR POS'; });
    rec('S3 the six new sections are in the menu, tagged "new" + "AIR POS", with no new shortcut key', !badN.length && nav.items.length === 16, badN.join(',') || nav.items.length + ' items (15 + the queued early-y)');
    rec('S4 the Step 0 top bar stays on screen (the Settings page opens below it, above the status line)', nav.ovTop >= 55 && nav.ovBottom <= 768 - 25, JSON.stringify({ ovTop: nav.ovTop, ovBottom: nav.ovBottom }));
    // the old tabs still work from the new menu
    await open('printer'); const pr = await p.evaluate(() => ({ on: document.querySelector('#stTabs .on').dataset.tab, ids: ['seDW', 'seOk', 'seTP', 'seTD', 'seDiag'].filter(i => document.getElementById(i)) }));
    rec('S5 Printer & Drawer (Ctrl+1) still shows its own settings and Save / Print test / Test drawer / Save diagnostics', pr.on === 'printer' && pr.ids.length === 5, pr.ids.join(','));
    await shot('printer');
    await p.keyboard.down('Control'); await p.keyboard.press('6'); await p.keyboard.up('Control'); await sleep(1200);
    rec('S6 Ctrl+6 on the open page still goes to Buttons', await p.evaluate(() => document.querySelector('#stTabs .on').dataset.tab === 'buttons'));
    await shot('buttons');
    // Terminal switches
    await open('terminal'); await shot('terminal');
    const t0 = await p.evaluate(() => ({ boxes: [...document.querySelectorAll('[data-sw]')].map(x => x.dataset.sw + '=' + x.checked), save: document.getElementById('lkSave').disabled, appr: document.getElementById('lkAppr').hidden }));
    rec('S7 Terminal switches: six switches from AIR POS, Save is off until something changes, no manager box for a manager login', t0.boxes.length === 6 && t0.boxes.includes('checkoutAutoPrint=true') && t0.boxes.includes('useVirtualKeyboard=false') && t0.save && t0.appr, t0.boxes.join(' '));
    await p.click('[data-sw="useVirtualKeyboard"]'); await p.click('[data-sw="soundAlerts"]'); await sleep(200);
    rec('S8 changing a switch turns Save on', await p.evaluate(() => !document.getElementById('lkSave').disabled));
    await shot('terminal-changed');
    await p.click('#lkSave'); await sleep(1800);
    const st = await hook('/lookups-state'), after = await p.evaluate(() => ({ boxes: [...document.querySelectorAll('[data-sw]')].map(x => x.dataset.sw + '=' + x.checked), msg: (document.getElementById('lkMsg') || {}).textContent, flash: (document.getElementById('stFlash') || {}).textContent, save: document.getElementById('lkSave').disabled }));
    rec('S9 Save sends call 12 once with the two changes; the page reads the values back from AIR POS and says "Saved to AIR POS."', st.saveCalls === 1 && st.saves[0].useVirtualKeyboard === true && st.saves[0].soundAlerts === false && after.boxes.includes('useVirtualKeyboard=true') && after.boxes.includes('soundAlerts=false') && /Saved to AIR POS/.test(after.msg + after.flash) && after.save, JSON.stringify(after).slice(0, 220));
    await post('terminal-config-save', { useVirtualKeyboard: false, soundAlerts: true }); // put the fake back
    // read-only sections
    await open('paytypes'); await shot('paytypes'); const pt = await p.evaluate(() => document.getElementById('lkHost').innerText.replace(/\s+/g, ' '));
    rec('S10 Payment types: view only, says the server does not offer the list; sub-types listed; no input or button', /Payment types/.test(pt) && /not offered by AIR POS/.test(pt) && await p.evaluate(() => !document.querySelector('#lkHost input, #lkHost button')), pt.slice(0, 160));
    await open('taxkinds'); await shot('taxkinds'); const tx = await p.evaluate(() => document.getElementById('lkHost').innerText.replace(/\s+/g, ' '));
    rec('S11 Tax kinds: the two kinds with their rates, view only', /Sales Tax/.test(tx) && /8%/.test(tx) && /Tax free/.test(tx) && await p.evaluate(() => !document.querySelector('#lkHost input, #lkHost button')), tx.slice(0, 160));
    await open('account'); await shot('account'); const ac = await p.evaluate(() => ({ t: document.getElementById('lkHost').innerText.replace(/\s+/g, ' '), groups: document.querySelectorAll('#lkHost [data-g]').length, inputs: document.querySelectorAll('#lkHost input, #lkHost button').length }));
    rec('S12 Account: business name, five AIR POS groups of switches and numbers, a line saying changes are made in the AIR POS back office; nothing to click; no secret shown', /Fake Shop/.test(ac.t) && ac.groups === 5 && /back office/.test(ac.t) && !ac.inputs && !/SECRET|sk_|TAX-/.test(ac.t), ac.t.slice(0, 200));
    await open('lists'); await shot('lists'); const ls = await p.evaluate(() => document.getElementById('lkHost').innerText.replace(/\s+/g, ' '));
    rec('S13 Store lists: product origins, categories and states (counts), view only', /Product origins/.test(ls) && /Categories/.test(ls) && /States/.test(ls) && !/Tax kinds/.test(ls), ls.slice(0, 160));
    await open('access'); await shot('access'); const ax = await p.evaluate(() => document.getElementById('lkHost').innerText.replace(/\s+/g, ' '));
    rec('S14 Roles & permissions: says this login is a super admin / manager, lists RetailManager', /Super admin|Manager/.test(ax) && /RetailManager/.test(ax) && /back office only/i.test(ax), ax.slice(0, 200));
    await p.keyboard.press('Escape'); await sleep(600);
    rec('S15 Esc closes the Settings page and the sale screen is back with its Checkout buttons', await p.evaluate(() => !document.getElementById('stTabs') && ['Gift Card', 'Customer add', 'Items', 'Checkout'].every(m => [...document.querySelectorAll('#actions .abtn, #right .rbtn, #tiles .tile')].some(e => e.textContent.includes(m)))));
    // ---- window.AirMaxSettings.add: other batches add Settings menu entries from their own files ----
    const A1 = await p.evaluate(() => {
      window.__cl = 0;
      const r = {
        add: AirMaxSettings.add({ key: 'dummy-x', label: 'Dummy X', group: 'Receipts & Printing', after: 'labels', render: (h, c) => { h.innerHTML = '<b id="dumHi">hi ' + c.manager + ' ' + c.name + ' ' + (typeof c.api) + '</b>'; return () => { window.__cl++; }; } }),
        dup: AirMaxSettings.add({ key: 'dummy-x', label: 'Again', group: 'Receipts & Printing', render: () => {} }), dupOld: AirMaxSettings.add({ key: 'printer', label: 'P', group: 'Receipts & Printing', render: () => {} }),
        badGroup: AirMaxSettings.add({ key: 'dummy-z', label: 'Z', group: 'Nope', render: () => {} }),
        boom: AirMaxSettings.add({ key: 'dummy-boom', label: 'Boom', group: 'Users & Permissions', render: () => { throw new Error('x'); } }),
        asyn: AirMaxSettings.add({ key: 'dummy-async', label: 'Async', group: 'Users & Permissions', after: 'access', tags: ['new', 'air'], who: 'all', render: async h => { await new Promise(r => setTimeout(r, 100)); h.textContent = 'async done'; } }),
      };
      return r;
    });
    rec('S17 AirMaxSettings.add accepts a good entry and refuses a duplicate key (its own or an existing one), an unknown group', A1.add === true && A1.dup === false && A1.dupOld === false && A1.badGroup === false && warns.filter(w => /AirMaxSettings.add refused/.test(w)).length === 3, JSON.stringify(A1) + ' warnings ' + warns.length);
    await p.evaluate(() => document.getElementById('setTop').click()); await sleep(1200);
    const nv = await p.evaluate(() => { const g = {}; let cur = ''; [...document.getElementById('stTabs').children].forEach(e => { if (e.classList.contains('stgh')) { cur = e.textContent.trim(); g[cur] = []; } else if (e.dataset && e.dataset.tab) g[cur].push(e.dataset.tab); }); const d = document.querySelector('#stTabs [data-tab="dummy-x"]'); return { g, tags: d ? [...d.querySelectorAll('.sttg')].map(x => x.textContent) : [], lab: d ? d.childNodes[0].textContent.trim() : '' }; });
    rec('S18 a dummy entry shows for a manager in its group, right after "labels", tagged "new"; a queued entry from before settings.js is there too', nv.g['Receipts & Printing'].join() === 'printer,labels,dummy-x' && nv.tags.join() === 'new' && nv.lab === 'Dummy X' && nv.g['Store & Account'].slice(-1)[0] === 'early-y' && nv.g['Users & Permissions'].join() === 'access,dummy-async,dummy-boom', JSON.stringify(nv.g));
    await p.click('#stTabs [data-tab="dummy-x"]'); await sleep(900);
    const dx = await p.evaluate(() => ({ t: (document.getElementById('dumHi') || {}).textContent, on: document.querySelector('#stTabs .on').dataset.tab, h2: (document.querySelector('.stcardh h2') || {}).textContent }));
    rec('S19 its render() gets a host and the ctx (manager=true, name settings.dummy-x, api)', dx.t === 'hi true settings.dummy-x function' && dx.on === 'dummy-x' && dx.h2 === 'Dummy X', JSON.stringify(dx));
    await shot('dummy-entry');
    await p.click('#stTabs [data-tab="dummy-async"]'); await sleep(700);
    const as = await p.evaluate(() => ({ txt: document.querySelector('#modalRoot .stbody').innerText, cl: window.__cl }));
    rec('S20 an async render works, and the previous entry\'s cleanup ran when the page moved on', /async done/.test(as.txt) && as.cl === 1, JSON.stringify(as));
    await p.click('#stTabs [data-tab="dummy-boom"]'); await sleep(700);
    const bm = await p.evaluate(() => ({ body: document.querySelector('#modalRoot .stbody').innerText.replace(/\s+/g, ' '), tabs: document.querySelectorAll('#stTabs [data-tab]').length }));
    await p.click('#stTabs [data-tab="early-y"]'); await sleep(500);
    rec('S21 a render that throws shows nothing but its title and never breaks the page (other entries still open)', !/error|undefined/i.test(bm.body) && bm.tabs === 19 && await p.evaluate(() => !!document.getElementById('earlyHi')), JSON.stringify(bm));
    await p.evaluate(() => AirMaxSettings.add({ key: 'late-w', label: 'Late W', group: 'Sales & Checkout', render: h => { h.textContent = 'late'; } })); await sleep(900);
    rec('S22 an entry added while Settings is open appears in the menu at once, and the open section stays selected', await p.evaluate(() => !!document.querySelector('#stTabs [data-tab="late-w"]') && document.querySelector('#stTabs .on').dataset.tab === 'early-y'));
    await p.keyboard.press('Escape'); await sleep(500);
    rec('S16 no page error', errs.length === 0, errs.join(' | ').slice(0, 200));
    await p.close();
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 600)); }
  finally { try { if (p && !p.isClosed()) await p.close(); } catch (e) {} b.disconnect(); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

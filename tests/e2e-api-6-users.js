// run-env: AIRMAX_FP_HW_PORT=5267
// AirMax Batch 6, Users > Fingerprints in the real app (OFFLINE: fake AIR POS + FAKE reader service on 5267, made-up operators).
// Uses the REAL Users screen of Batch 3 (docs/batch-3-slots.md): the tab, the unlock (the register login is an AIR POS manager, so no pop-up),
// and the slot users.extra drawn once per row with ctx.user. Everything inside the slot is Batch 6's real file. Batch 3's fake users: op-1 Alice, op-2 Bob, op-3 Carol.
// FAKE_PORT = manager fake (hook FAKE_PORT+1). Set SHOT_DIR to also save PNG screenshots. Run via tests/run-all-look.sh (picked up by the e2e-api-* glob).
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), HW = Number(process.env.AIRMAX_FP_HW_PORT || 5267), SHOT = process.env.SHOT_DIR || '';
const B = 'http://127.0.0.1:' + FP, sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const hook = p => fetch('http://127.0.0.1:' + (FP + 1) + p).then(r => r.json()), hw = p => fetch('http://127.0.0.1:' + HW + '/__fp/' + p).then(r => r.json());
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note || '').slice(0, 150)); };
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    await hook('/fp-reset'); await hw('reset');
    if (!(await fetch(B + '/api/state').then(r => r.json())).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(B + '/'); await sleep(1500);
    const shot = async n => { if (SHOT) await p.screenshot({ path: SHOT + '/' + n + '.png' }); };
    await p.evaluate(() => document.querySelector('#tabbar .tab[data-tab="users"]').click()); await sleep(2500);   // the REAL Users screen of Batch 3 (the register login is an AIR POS manager: no pop-up)
    const btns = await p.$$eval('.fp6-btn', bs => bs.map(x => x.textContent.replace(/\s+/g, ' ').trim().replace(/(\D)(\d+)$/, '$1 $2')));
    rec('1 each operator row gets a Fingerprints button with its count (Alice 2, Bob 0, Carol 1)', btns.length === 3 && btns.join('|') === 'Fingerprints 2|Fingerprints 0|Fingerprints 1', btns.join('|'));
    await shot('real-users-list');
    await p.click('.fp6-btn[data-fp="op-1"]'); await sleep(900);
    const ptxt = () => p.$eval('.fp6-ov', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    let t = await ptxt();
    rec('2 the panel opens with the saved prints (Fingerprint 1, Fingerprint 2), "2 saved.", Save greyed, no print data on screen', /ZZ Test Alice/.test(t) && /2 saved\./.test(t) && /Fingerprint 1/.test(t) && /Fingerprint 2/.test(t) && !/TPL/.test(t) && await p.$eval('#fp6Save', e => e.disabled), t.slice(0, 120));
    await p.click('.fp6-ov #fp6Close'); await sleep(300);
    rec('3 Close closes the panel', !(await p.$('.fp6-ov')), '');
    // enrol Bob
    await hw('delay?ms=900');
    await p.click('.fp6-btn[data-fp="op-2"]'); await sleep(800);
    await p.click('#fp6Scan'); await sleep(1500);
    t = await ptxt(); const scanning = await p.$eval('#fp6Scan', e => e.disabled);
    rec('4 Scan finger: panel shows progress while the reader waits (Scan greyed, Cancel on, Save greyed)', scanning && /Waiting for finger|same finger again/.test(t) && !(await p.$eval('#fp6Cancel', e => e.disabled)) && await p.$eval('#fp6Save', e => e.disabled), t.slice(0, 160));
    await shot('real-users-fingerprints-scanning');
    for (let i = 0; i < 40 && !/Ready to save/.test(await ptxt()); i++) await sleep(300);
    t = await ptxt();
    rec('5 after 3 touches: "Ready to save", Save is on', /Ready to save/.test(t) && !(await p.$eval('#fp6Save', e => e.disabled)), t.slice(0, 100));
    await hw('delay?ms=250');
    await p.click('#fp6Save'); await sleep(1200);
    t = await ptxt(); const st = await hook('/fp-state');
    rec('6 Save: "1 saved.", the row count is 1, AIR POS got one 3-touch print for Bob', /1 saved\./.test(t) && st.ops['op-2'].length === 1 && st.ops['op-2'][0].n === 3 && (await p.$eval('.fp6-btn[data-fp="op-2"]', e => e.textContent.replace(/\s+/g, ' ').trim().replace(/(\D)(\d+)$/, '$1 $2'))) === 'Fingerprints 1', JSON.stringify(st.ops['op-2']));
    await shot('real-users-fingerprints');
    // remove with confirmation
    await p.click('[data-rm="0"]'); await sleep(500);
    const mt = await p.$eval('#modalRoot .modal', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    rec('7 Remove asks first ("Remove this fingerprint?", Cancel (Esc) / Remove), nothing removed yet', /Remove this fingerprint\?/.test(mt) && /Cancel \(Esc\)/.test(mt) && (await hook('/fp-state')).ops['op-2'].length === 1, mt.slice(0, 120));
    await p.keyboard.press('Escape'); await sleep(400);
    rec('8 Esc in the question keeps the fingerprint', (await hook('/fp-state')).ops['op-2'].length === 1 && !!(await p.$('.fp6-ov')), '');
    await p.click('[data-rm="0"]'); await sleep(400); await p.click('#fp6Yes'); await sleep(1000);
    rec('9 confirming Remove removes it ("0 saved.")', (await hook('/fp-state')).ops['op-2'].length === 0 && /0 saved\./.test(await ptxt()), '');
    // clear all on Alice
    await p.click('.fp6-ov #fp6Close'); await sleep(300); await p.click('.fp6-btn[data-fp="op-1"]'); await sleep(800);
    await p.click('#fp6Clear'); await sleep(500);
    const ct = await p.$eval('#modalRoot .modal', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    rec('10 Clear all asks first, naming the operator and the number', /Clear all fingerprints\?/.test(ct) && /all 2 saved/.test(ct) && /ZZ Test Alice/.test(ct) && (await hook('/fp-state')).ops['op-1'].length === 2, ct.slice(0, 140));
    await shot('real-users-clear-all-confirm');
    await p.click('#fp6Yes'); await sleep(1000);
    rec('11 confirming Clear all empties Alice (count 0), Carol untouched', (await hook('/fp-state')).ops['op-1'].length === 0 && (await hook('/fp-state')).ops['op-3'].length === 1 && (await p.$eval('.fp6-btn[data-fp="op-1"]', e => e.textContent.replace(/\s+/g, ' ').trim().replace(/(\D)(\d+)$/, '$1 $2'))) === 'Fingerprints 0', '');
    // leaving the screen stops the reader
    await hw('mode?m=hold'); await hw('reset').catch(() => 0); await hw('mode?m=hold');
    await p.click('.fp6-ov #fp6Close'); await sleep(300); await p.click('.fp6-btn[data-fp="op-3"]'); await sleep(800); await p.click('#fp6Scan'); await sleep(900);
    await p.evaluate(() => AirMaxSections.show('checkout')); await sleep(2500);
    const calls = (await hw('state')).calls, ss = await post('fp-enroll-status');
    rec('12 leaving Users while the reader waits closes the panel and stops the reader (162); no job is left', !(await p.$('.fp6-ov')) && calls.some(c => c.name === 'FingerPrintRegistStop') && ss.state === 'none', JSON.stringify(calls.map(c => c.name)));
    rec('13 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } catch (e) { rec('test ran', false, e.stack || e.message); }
  const n = out.filter(x => x.pass).length; console.log(`${n}/${out.length} passed`); b.disconnect(); process.exit(n === out.length ? 0 : 1);
})();

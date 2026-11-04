// Work copy (NOT released): owner requests F (Check needs a customer), G (gift card amount), H (scan sounds),
// I (Put on Account = AIR POS MemberAccount tender 11) against the OFFLINE fake AIR POS. Made-up test data only.
// Run: FAKE_PORT=5074 node tests/fake-server.js &  [FAKE_PORT=5070 FAKE_CASHIER=1 node tests/fake-server.js &]
//      FAKE_PORT=5074 [CASHIER_PORT=5070] node tests/e2e-fghi.js   (Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5074), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const CP = process.env.CASHIER_PORT ? Number(process.env.CASHIER_PORT) : 0;
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const postTo = (base, r, x) => fetch(base + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const post = (r, x) => postTo(BASE, r, x);
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const resetRx = () => fetch(HOOK + '/receives-reset').then(r => r.text());
const receives = async () => (await (await fetch(HOOK + '/')).json()).receives;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach'); await resetRx();
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {})); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(1000); };
    const openPay = async () => { await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); };
    const line = async t => { const i = await p.$$eval('.pline', (x, t) => x.findIndex(e => e.querySelector('.plbl') && e.querySelector('.plbl').textContent === t), t); await p.click(`.pline[data-i="${i}"] .plbl`); await sleep(400); return i; };
    const msg = () => p.$eval('#payMsg', e => e.innerText).catch(() => '');
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const done = async () => { await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 12000 }).catch(() => {}); await sleep(600); return /Sale complete/.test(await modalTxt()); };
    const fresh = async () => { await resetRx(); await post('pay-close'); await post('new-sale'); await post('dismiss'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    // ================= F: Check needs a customer =================
    await scan('1001'); await openPay(); await line('Check'); const fMsg1 = await msg();
    await p.keyboard.press('+'); await sleep(300); await p.click('#payOk'); await sleep(900);
    const fMsg2 = await msg(), s1 = await state(), r1 = await receives();
    rec('F: Check highlighted with no customer shows "Add a customer to pay by check"', /Add a customer to pay by check/.test(fMsg1), fMsg1);
    rec('F: pressing Pay on Check with no customer takes nothing (no AIR POS payment, still on Payment)', /Add a customer to pay by check/.test(fMsg2) && r1.length === 0 && s1.pay && s1.pay.tenders.length === 0 && !/Sale complete/.test(await modalTxt()), `msg "${fMsg2}", payments sent ${r1.length}`);
    await p.screenshot({ path: SCR + 'check-needs-customer.png' });
    await post('pay-close'); await post('member-attach', { number: '5550001' }); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    await openPay(); await line('Check'); await p.keyboard.press('+'); await sleep(300); await p.click('#payOk'); await sleep(900);
    if (await p.$('#chkNo')) { await p.focus('#chkNo'); await p.keyboard.type('1234'); await p.keyboard.press('Enter'); }
    const fOk = await done(), r2 = await receives();
    rec('F: with the test customer attached, the same Check payment goes through as before', fOk && r2.length === 1 && r2[0].paymentType === 50 && r2[0].amount === 10.8, JSON.stringify(r2));
    await fresh(); await post('member-detach'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    // ================= G: gift card amount =================
    await scan('1001'); await openPay(); await line('Gift Card');
    await p.focus('#gcNo'); await p.keyboard.type('7000000000008888'); await p.keyboard.press('Enter'); await sleep(1500);
    const gFocus = await p.evaluate(() => document.activeElement && document.activeElement.id), gAuto = await p.$eval('#pa-40', e => e.value), gMsg = await msg();
    rec('G: after the card is typed, focus jumps to the gift amount with the cap ($8 card, $10.80 owed -> $8.00)', gFocus === 'pa-40' && Number(gAuto) === 8 && /up to \$8\.00/.test(gMsg), `focus ${gFocus}, amount ${gAuto}, "${gMsg}"`);
    await p.click('#pa-40', { clickCount: 3 }); await p.keyboard.type('9'); await sleep(400);
    const gClamp = await p.$eval('#pa-40', e => e.value), gMsg2 = await msg();
    rec('G: typing more than the card balance is held at $8.00 with an explanation', Number(gClamp) === 8 && /at most \$8\.00/.test(gMsg2), `amount ${gClamp}, "${gMsg2}"`);
    await p.click('#pa-40', { clickCount: 3 }); await p.keyboard.type('3'); await sleep(300);
    await p.screenshot({ path: SCR + 'gift-card-amount.png' });
    await p.click('#payOk'); await sleep(1500);
    const s3 = await state(), r3 = await receives();
    rec('G: Pay takes exactly the typed $3 from the gift card; $7.80 still owed', r3.length === 1 && r3[0].paymentType === 40 && r3[0].amount === 3 && r3[0].gift === 1 && Math.abs(s3.pay.remaining - 7.8) < 0.005, `${JSON.stringify(r3)}; remaining ${s3.pay && s3.pay.remaining}`);
    await line('Cash'); await p.keyboard.press('+'); await sleep(300); await p.click('#payOk');
    const gOk = await done(), r4 = await receives();
    rec('G: the rest ($7.80) is paid in cash and the sale completes', gOk && r4.length === 2 && r4[1].paymentType === 10 && r4[1].amount === 7.8, JSON.stringify(r4));
    await fresh();
    // ================= I: Put on Account =================
    await scan('1001'); await openPay(); const iLbls = await p.$$eval('.pline .plbl', x => x.map(e => e.textContent));
    await line('Put on Account'); const iMsg1 = await msg();
    await p.keyboard.press('+'); await sleep(300); await p.click('#payOk'); await sleep(900);
    const iMsg2 = await msg(), r5 = await receives();
    rec('I: "Put on Account" is always listed; with no customer it says "Add a customer to put the sale on account"', iLbls.includes('Put on Account') && /Add a customer to put the sale on account/.test(iMsg1), `${iLbls.join(', ')}; "${iMsg1}"`);
    rec('I: Pay on account with no customer takes nothing', /Add a customer to put the sale on account/.test(iMsg2) && r5.length === 0 && !/Sale complete/.test(await modalTxt()), `"${iMsg2}", payments sent ${r5.length}`);
    await post('pay-close'); await post('member-attach', { number: '5550002' }); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    await openPay(); await line('Put on Account'); const iMsg3 = await msg();
    rec('I: house-account customer: shows how much can go on account ($50 limit)', /up to \$50\.00 on account/.test(iMsg3), iMsg3);
    await p.keyboard.press('+'); await sleep(300); await p.screenshot({ path: SCR + 'put-on-account.png' });
    await p.click('#payOk'); const iOk = await done(), r6 = await receives();
    rec('I: $10.80 charged with AIR POS\'s own MemberAccount tender (11) for that customer; sale completes', iOk && r6.length === 1 && r6[0].paymentType === 11 && r6[0].amount === 10.8 && r6[0].retailMemberId === 'm-acct', JSON.stringify(r6));
    await fresh(); await post('member-attach', { number: '5550001' }); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    await scan('1002'); await openPay(); const iLbls2 = await p.$$eval('.pline .plbl', x => x.map(e => e.textContent));
    await line(iLbls2[iLbls2.length - 1]); const iMsg4 = await msg();
    await p.keyboard.press('+'); await sleep(300); await p.click('#payOk'); await sleep(1200);
    const r7 = await receives(), s7 = await state();
    rec('I: customer without a house account: line reads "Store credit", explains, and AIR POS is not charged', iLbls2[iLbls2.length - 1] === 'Store credit' && /no house account/.test(iMsg4) && r7.length === 0 && s7.pay && s7.pay.tenders.length === 0, `"${iMsg4}"; payments sent ${r7.length}; ${await msg()}`);
    await fresh(); await post('member-detach'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    // ================= H: scan sounds =================
    await p.evaluate(() => { window.__scanSounds = { ok: 0, bad: 0 }; });
    await scan('1001'); await scan('NOPE-404');
    const h1 = await p.evaluate(() => window.__scanSounds);
    rec('H: good scan plays the success tone, unknown code plays the other tone (on by default)', h1.ok === 1 && h1.bad === 1 && (await state()).settings.scanSound === true, JSON.stringify(h1));
    const wav = await p.evaluate(async () => { const a = await fetch('/sounds/scan-ok.wav'), c = await fetch('/sounds/scan-bad.wav'); return [a.status, a.headers.get('content-type'), c.status]; });
    rec('H: both tones are served from the app itself (audio/wav)', wav[0] === 200 && wav[1] === 'audio/wav' && wav[2] === 200, wav.join(' '));
    await p.keyboard.press('Escape'); await sleep(300);
    await p.focus('#scanInput'); await p.keyboard.down('Control'); await p.keyboard.press(','); await p.keyboard.up('Control'); await sleep(1500);
    await p.click('[data-tab="screen"]'); await sleep(800);
    const set1 = await p.$eval('#seSnd', e => ({ on: e.checked, dis: e.disabled, txt: e.parentElement.innerText })).catch(() => null);
    rec('H: Settings > Screen has "Scan sounds", on, changeable by the manager', set1 && set1.on && !set1.dis, JSON.stringify(set1));
    await p.screenshot({ path: SCR + 'scan-sounds-setting.png' });
    await p.click('#seSnd'); await sleep(900);
    const sOff = (await state()).settings.scanSound;
    await p.keyboard.press('Escape'); await sleep(800); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    await p.evaluate(() => { window.__scanSounds = { ok: 0, bad: 0 }; }); await scan('1001'); await scan('NOPE-404');
    const h2 = await p.evaluate(() => window.__scanSounds);
    rec('H: manager turns them off -> no scan sounds', sOff === false && h2.ok === 0 && h2.bad === 0, `setting ${sOff}, played ${JSON.stringify(h2)}`);
    const back = await post('settings', { scanSound: true });
    rec('H: turned back on (restored for later tests)', back.ok && (await state()).settings.scanSound === true, back.message);
    if (CP) {
      const CB = 'http://127.0.0.1:' + CP, cst = await fetch(CB + '/api/state').then(r => r.json());
      if (!cst.loggedIn) await postTo(CB, 'login', { company: 'fake shop', user: 'cashier', password: '<redacted>' });
      const c1 = await postTo(CB, 'settings', { scanSound: false });
      const q = await b.newPage(); await q.goto(CB + '/'); await sleep(1500);
      await q.focus('#scanInput'); await q.keyboard.down('Control'); await q.keyboard.press(','); await q.keyboard.up('Control'); await sleep(1500);
      await q.click('[data-tab="screen"]'); await sleep(800);
      const set2 = await q.$eval('#seSnd', e => ({ on: e.checked, dis: e.disabled, txt: e.parentElement.innerText })).catch(() => null);
      rec('H: a cashier cannot turn scan sounds off (server refuses; box greyed, "manager only")', !c1.ok && set2 && set2.on && set2.dis && /manager only/.test(set2.txt), `${c1.message}; ${JSON.stringify(set2)}`);
      await q.screenshot({ path: SCR + 'scan-sounds-cashier.png' }); await q.close();
    }
    await post('new-sale'); await post('dismiss');
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    await p.close();
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} F/G/H/I e2e passed`);
  fs.writeFileSync(path.join(__dirname, 'e2e-fghi-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  b.disconnect(); process.exit(pass === out.length ? 0 : 1);
})();

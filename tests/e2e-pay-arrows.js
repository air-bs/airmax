// Air Register 1.2.1: Up / Down on the full-screen payment screen, against the OFFLINE fake AIR POS.
// Run: FAKE_PORT=5074 node tests/fake-server.js &   FAKE_PORT=5074 node tests/e2e-pay-arrows.js   (Chrome --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const payCalls = async () => JSON.parse(await (await fetch(HOOK + '/')).text()).calls.filter(c => /Receive|Complete|Tender/i.test(typeof c === 'string' ? c : JSON.stringify(c))).length;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const hiAt = () => p.$eval('.pline.on .plbl', e => e.textContent).catch(() => null);
    const focus = () => p.evaluate(() => document.activeElement && document.activeElement.id);
    const vals = () => p.$$eval('.pline .pamt', x => x.map(e => e.value));
    const dueTxt = () => p.$eval('#payDue', e => e.textContent).catch(() => null);
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await sleep(150); } await sleep(250); };
    const scanPay = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); await p.keyboard.press('Enter'); await sleep(900); };
    // ---- sale 1: 1001 = $10.80 ----
    await scanPay('1001');
    rec('Payment screen open, Credit Card highlighted first', !!(await p.$('#payBody')) && await hiAt() === 'Credit Card', `highlight ${await hiAt()}`);
    const lines = await p.$$eval('.pline .plbl', x => x.map(e => e.textContent));
    await key('ArrowDown'); const d1 = [await hiAt(), await focus()];
    await key('ArrowDown'); const d2 = await hiAt(); await key('ArrowDown'); const d3 = await hiAt();
    rec('Down moves Credit Card -> Cash -> Gift Card -> Check, focus follows the amount field', d1[0] === 'Cash' && d1[1] === 'cashIn' && d2 === 'Gift Card' && d3 === 'Check', `${d1[0]} (${d1[1]}) -> ${d2} -> ${d3}`);
    await key('ArrowDown', 3); const bot = await hiAt();
    rec('Down on the last line stays on it (no wrap)', bot === lines[lines.length - 1], `lines ${lines.join(', ')}; now ${bot}`);
    await key('ArrowUp', 8); const top = [await hiAt(), await focus()];
    rec('Up moves back and stops at Credit Card (no wrap)', top[0] === 'Credit Card' && top[1] === 'pa-20', `${top.join(' / ')}`);
    await key('ArrowDown'); await p.keyboard.type('5'); await sleep(200);
    const c0 = await payCalls(), s0 = (await state()).pay;
    await key('ArrowDown'); await key('ArrowUp'); await key('ArrowUp'); await key('ArrowDown');
    const v1 = await vals(), s1 = (await state()).pay;
    rec('Typed 5 on Cash: arrows leave every amount unchanged', v1[1] === '5' && v1.filter((v, i) => i !== 1).every(v => v === '') && await hiAt() === 'Cash', `fields [${v1.join(' | ')}], highlight ${await hiAt()}`);
    rec('Balance still shows $5.80 after the arrows (nothing rounded or filled)', await dueTxt() === '$5.80', String(await dueTxt()));
    rec('Arrows paid nothing: no tender saved, nothing sent to AIR POS, still on Payment', s1 && s1.tenders.length === 0 && s1.paid === s0.paid && (await payCalls()) === c0 && !/Sale complete/.test(await modalTxt()), `tenders ${s1 && s1.tenders.length}, paid ${s1 && s1.paid}, pay calls ${c0} -> ${await payCalls()}`);
    await p.screenshot({ path: SCR + 'pay-arrows-1.png' });
    // + still fills the rest; arrows after that still do not pay
    await key('+'); const plus = (await vals())[1], dueP = await dueTxt();
    rec('+ still fills the whole amount due on the line (as before)', plus === '10.80' && dueP === '$0.00', `cash ${plus}, balance ${dueP}`);
    await key('ArrowUp'); await key('ArrowDown'); await sleep(600);
    const s2 = (await state()).pay;
    rec('Fully typed out, then arrows: still not paid or finished', s2 && s2.tenders.length === 0 && !/Sale complete/.test(await modalTxt()) && (await vals())[1] === '10.80' && await hiAt() === 'Cash', `tenders ${s2 && s2.tenders.length}, cash ${(await vals())[1]}, highlight ${await hiAt()}`);
    await key('Enter'); await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 10000 }).catch(() => {});
    rec('Enter then finishes the sale as before (cash 10.80)', /Sale complete/.test(await modalTxt()), (await modalTxt()).replace(/\s+/g, ' ').slice(0, 90));
    await p.click('#dNew').catch(() => {}); await sleep(700);
    // ---- sale 2: split, Enter moves down, + fills the rest, check number box keeps its own keys ----
    // work copy: Check needs a customer on the sale -> attach the made-up fake test customer before Payment
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900);
    await post('member-attach', { number: '5550001' }); await p.evaluate(() => refresh()); await sleep(400);
    await p.focus('#scanInput'); await p.keyboard.press('Enter'); await sleep(900); await key('ArrowDown'); await p.keyboard.type('5'); await sleep(150);
    await key('Enter'); const afterEnter = await hiAt();
    rec('Enter still moves down one line while money is still due (Cash -> Gift Card)', afterEnter === 'Gift Card', String(afterEnter));
    await key('ArrowDown'); await key('+'); const chk = (await vals())[3];
    rec('+ on Check fills only the rest (5.80), digits on Cash kept (5)', chk === '5.80' && (await vals())[1] === '5' && await dueTxt() === '$0.00', `fields [${(await vals()).join(' | ')}]`);
    await key('ArrowUp'); await key('ArrowDown');
    rec('Up then Down on Check: both amounts still 5 and 5.80', (await vals())[1] === '5' && (await vals())[3] === '5.80' && (await state()).pay.tenders.length === 0, `fields [${(await vals()).join(' | ')}]`);
    await key('Enter'); await sleep(400); const askFocus = await focus();
    const hiChk = await hiAt();
    await key('ArrowUp'); await key('ArrowDown');
    rec('Check-number box keeps its own keys: arrows there do not move the line or pay', askFocus === 'chkNo' && await focus() === 'chkNo' && await hiAt() === hiChk && (await state()).pay.tenders.length === 0, `focus ${askFocus} -> ${await focus()}, highlight ${hiChk} -> ${await hiAt()}`);
    await p.screenshot({ path: SCR + 'pay-arrows-2-check.png' });
    await p.keyboard.type('1234'); await p.keyboard.press('Enter'); await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 10000 }).catch(() => {});
    rec('Check number + Enter finishes the split sale as before', /Sale complete/.test(await modalTxt()), (await modalTxt()).replace(/\s+/g, ' ').slice(0, 120));
    await p.click('#dNew').catch(() => {}); await sleep(700);
    // ---- quick cash buttons untouched ----
    await scanPay('1001'); await key('ArrowDown'); const qb = await p.$$eval('.quick button', x => x.length);
    await p.click('.quick button[data-l="20"]'); await sleep(250); const q20 = (await vals())[1];
    rec('Quick cash buttons still there and $20 still fills 20 on Cash', qb > 0 && q20 === '20', `${qb} buttons, cash ${q20}`);
    await key('Escape'); await sleep(600); await post('pay-close'); await post('new-sale');
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-pay-arrows-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

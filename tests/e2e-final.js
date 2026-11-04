// Work copy (NOT released): screens + checks for the button change, request M (Edit Customer), AR-16 (stock warning BEFORE
// the card is charged) and N (Manual Credit = AIR POS Online Payment, Sola card form) against the OFFLINE fake AIR POS.
// Made-up test data and a made-up test card number only. Needs a FRESH fake server (keyed mode is set before login):
//   FAKE_PORT=5090 node tests/fake-server.js &   then   FAKE_PORT=5090 node tests/e2e-final.js   (Chrome :9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), os = require('os');
const FP = Number(process.env.FAKE_PORT || 5090), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = p => fetch(HOOK + p).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const CARD = '4242424242424242'; // well-known made-up test number (passes Luhn), never a real card
(async () => {
  await hook('/keyed?mode=sola'); await hook('/stock-refuse?on=0');
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach');
    const p = await b.newPage(); const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { dialogs.push(d.type() + ':' + d.message()); d.accept().catch(() => {}); }); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    const openPay = async () => { await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200); };
    const line = async t => { const i = await p.$$eval('.pline', (x, t) => x.findIndex(e => e.querySelector('.plbl') && e.querySelector('.plbl').textContent === t), t); await p.click(`.pline[data-i="${i}"] .plbl`); await sleep(400); return i; };
    const modalTxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const fresh = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };

    // ================= buttons: Put Aside / Load Aside hidden, Hold / Load Hold kept =================
    const labels = () => p.$$eval('#actions .abtn .t, #right .rbtn', x => x.map(e => e.childNodes[0].textContent.trim()));
    const L = await labels();
    rec('Buttons: no on-screen "Put Aside" / "Load Aside"', !L.includes('Put Aside') && !L.includes('Load Aside'), L.join(' | '));
    rec('Buttons: "Hold" and "Load Hold" still shown', L.includes('Hold') && L.includes('Load Hold'), '');
    rec('Buttons: "Add Gift Receipt" is in the left column (moved from the right side, Print Label build)', (await p.$$eval('#actions [data-a]', x => x.map(e => e.textContent))).some(t => /Add Gift Receipt/.test(t)), '');
    const noPark = await p.$eval('#asideMenu', e => getComputedStyle(e).display === 'none' || !e.offsetParent).catch(() => true);
    await p.screenshot({ path: SCR + 'buttons-no-aside.png' });
    await scan('1001'); const pa = await post('aside-put'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const park = await p.$eval('#asideMenu', e => e.offsetParent ? e.innerText : '').catch(() => '');
    rec('Buttons: with a parked sale, a small "Parked sales (1)" button shows (none before)', noPark && /Parked sales \(1\)/.test(park), `put-aside ok ${pa.ok}, button "${park.replace(/\s+/g, ' ')}"`);
    await p.screenshot({ path: SCR + 'buttons-parked-sales.png' });
    await p.click('#asideMenu'); await sleep(900); const am = await modalTxt();
    rec('Buttons: "Parked sales" opens Load Aside', /1001|Bulk candy|aside/i.test(am), am.replace(/\s+/g, ' ').slice(0, 120));
    const lb = await p.$('[data-load]'); if (lb) { await lb.click(); await sleep(1200); }
    rec('Buttons: the parked sale comes back', (await state()).cart.length === 1, JSON.stringify((await state()).cart.map(l => l.number)));
    await fresh();

    // ================= M: F3 Edit Customer =================
    await hook('/members-reset');
    await p.focus('#scanInput'); await p.keyboard.press('F3'); await sleep(900);
    await p.type('#mQ', '555'); await p.keyboard.press('Enter'); await sleep(1200); // 1.0.10-local.2: a single match is now added straight away, so search a text that finds both made-up customers (Mike first)
    const eb = await p.$eval('#mEdit', e => ({ shown: e.style.display !== 'none', t: e.textContent })).catch(() => ({}));
    const nb = await p.$eval('#mNew', e => e.className).catch(() => '');
    rec('M: after a search the main button is "Edit Customer"; "New customer…" is secondary', eb.shown && /Edit Customer/.test(eb.t) && / s\b|pbtn s/.test(nb), JSON.stringify(eb) + ' new=' + nb);
    await p.click('#mEdit'); await sleep(1000); if (await p.$('#cvEdit')) { await p.click('#cvEdit'); await sleep(800); }
    const setPhone = async v => { await p.click('#ecPhone', { clickCount: 3 }); await p.keyboard.type(v); await sleep(300); };
    await setPhone('555-987-6543'); await p.click('#ecSave'); await sleep(1500);
    const dup = await modalTxt(), openBtn = await p.$eval('#ecOpen', e => e.style.display !== 'none' ? e.textContent : '').catch(() => '');
    const m1 = await hook('/members');
    rec('M: a phone used by another customer shows a message and "Open existing customer"', /Open existing customer/.test(openBtn) && m1.members['m-edit1'].number === '5551234567', `msg "${(dup.match(/[^\n]*(already|exists|used)[^\n]*/i) || [''])[0]}", button "${openBtn}"`);
    rec('M: MemberNumberValidate was asked before saving', m1.validates.some(v => v.number === '5559876543'), JSON.stringify(m1.validates));
    await p.screenshot({ path: SCR + 'customer-edit-duplicate.png' });
    await setPhone('555-123-0000'); const hint = await p.$eval('#ecNum', e => e.textContent).catch(() => '');
    rec('M: the screen shows the customer number will follow the phone', /5551230000/.test(hint), hint);
    await p.click('#ecSave'); await sleep(1500);
    const m2 = await hook('/members');
    rec('M: saving changes the phone AND the customer number (phone digits)', m2.members['m-edit1'].number === '5551230000' && m2.members['m-edit1'].mobile === '555-123-0000', JSON.stringify(m2.members['m-edit1']));
    await p.keyboard.press('Escape'); await hook('/members-reset'); await fresh();

    // ================= N (1.2.3): Sola card form is OFF; AR-16: stock warning BEFORE a gift card is charged =================
    const st0 = await state();
    rec('N (1.2.3): on a Sola store Manual Credit stays off with the 1.2.1 message (card form not shipped)', st0.keyed && !st0.keyed.enabled && /only supports Stripe/.test(st0.keyed.note || ''), JSON.stringify(st0.keyed));
    await hook('/receives-reset');
    await scan('1002'); await openPay(); await line('Manual Credit'); await p.keyboard.press('+'); await sleep(300);
    rec('N (1.2.3): no card number field anywhere on the Payment screen', !(await p.$('#mcNo')) && !(await p.$('#mcCvv')), '');
    await p.screenshot({ path: SCR + 'manual-credit-off-sola.png' });
    await p.$$eval('.pline input', xs => xs.forEach(x => { x.value = ''; x.dispatchEvent(new Event('input', { bubbles: true })); }));
    await post('settings', { stockWarn: true }); // 1.0.10-local.2: AR-16 = Settings "Warn before selling below zero stock" ON (default OFF)
    await line('Gift Card'); await p.focus('#gcNo'); await p.keyboard.type('7000000000008888'); await p.keyboard.press('Enter'); await sleep(1500);
    await p.click('#payOk'); await sleep(2000);
    const warn = await p.$('#payStockOk'), r0 = (await hook('/')).receives || [];
    const vis = warn ? await p.evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, warn) : false;
    rec('AR-16: short stock (Toy car, 0) warns BEFORE the gift card is taken; nothing sent to AIR POS; the button is on screen', !!warn && r0.length === 0 && vis, `button ${!!warn} visible ${vis}, receives ${JSON.stringify(r0)}`);
    await p.screenshot({ path: SCR + 'stock-check-before-card.png' });
    const msgBefore = await p.$eval('#payMsg', e => e.innerText).catch(() => '-');
    const atPt = warn ? await p.evaluate(e => { const r = e.getBoundingClientRect(); const x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return JSON.stringify(r) + ' -> ' + (x ? x.tagName + '#' + x.id + '.' + x.className : 'none'); }, warn) : '-';
    if (warn) await p.click('#payStockOk');
    await sleep(1500); const msgAfter = await p.$eval('#payMsg', e => e.innerText).catch(() => '-'); const stx = await state();
    const done = await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 15000, polling: 100 }).then(() => true).catch(() => false);
    const r1 = (await hook('/')).receives || [];
    rec('AR-16: after "Take payment anyway" the gift card pays and the sale completes', done && r1.some(x => x.paymentType === 40 && Math.abs(x.amount - 5.4) < 0.005), JSON.stringify(r1) + ' | at: ' + atPt + ' | before: ' + msgBefore + ' | after: ' + msgAfter + ' | pay ' + JSON.stringify(stx.pay || null).slice(0, 300) + ' | errs ' + errs.join(';'));
    await post('settings', { stockWarn: false }); // back to the default
    const st1 = JSON.stringify(await state());
    const dirs = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('airreg-fake-')).map(d => path.join(os.tmpdir(), d)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(0, 1);
    const hits = []; const walk = d => { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); const s = fs.statSync(q); if (s.isDirectory()) walk(q); else if (s.size < 5e6 && fs.readFileSync(q, 'utf8').includes(CARD)) hits.push(q); } };
    dirs.forEach(walk); const logf = ['/tmp/f' + FP + '.log', '/tmp/sf-' + FP + '.log'].find(f => fs.existsSync(f)) || '(no log)'; if (fs.existsSync(logf) && fs.readFileSync(logf, 'utf8').includes(CARD)) hits.push(logf);
    rec('N: the card number is in no state, saved file or log', !st1.includes(CARD) && hits.length === 0, `checked ${dirs.join(', ')} + ${logf}; hits ${JSON.stringify(hits)}`);
    await p.keyboard.press('Enter'); await sleep(600);
    await post('new-sale'); await post('dismiss'); await hook('/keyed?mode=');
    rec('No page errors', errs.length === 0, errs.join(' | ') || 'none');
    rec('No browser dialogs (except the leave-page check when the test itself reloads)', dialogs.filter(d => !/^beforeunload:/.test(d)).length === 0, dialogs.join(' | ') || 'none');
  } finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-final-results.json'), JSON.stringify(out, null, 1));
  console.log(`e2e-final: ${out.filter(x => x.pass).length}/${out.length} passed`);
  process.exit(out.every(x => x.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

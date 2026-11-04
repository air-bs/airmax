// 1.0.10-local.2 (Ari 1:36 PM ET Nov 1): ONE-Enter add customer from F3.
// (a) type and ONE Enter searches; (b) exactly one match = on the sale, window closed; (c) several = first row highlighted,
// Enter adds it, Up/Down pick another; (d) none = "No customer found" + New customer… (Enter opens it, no search loop);
// the adding Enter never fires Payment on the sale screen. Fake AIR POS only, made-up customers (Mike Fake / Dana Sample).
// FAKE_PORT=<port> node tests/e2e-customer-enter.js (Chrome CHROME_URL, default :9433)
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5090), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = p => fetch(HOOK + p).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const p = await b.newPage(); const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { if (d.type() === 'beforeunload') return d.accept().catch(() => {}); dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await hook('/members-reset');
    const mtxt = () => p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const focusId = () => p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    const fresh = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach'); await p.goto('about:blank'); await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500);
      await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(1000); };
    const f3 = async q => { await p.focus('#scanInput'); await p.keyboard.press('F3'); await sleep(800); await p.type('#mQ', q); };
    const ok = async name => { const s = await state(); return s.member && new RegExp(name).test(s.member.name) && !s.pay && s.cart.length === 1 && !(await mtxt()).trim(); };
    const why = async () => { const s = await state(); return `member ${s.member && s.member.name} pay ${!!s.pay} cart ${s.cart.length} focus ${await focusId()} modal "${(await mtxt()).replace(/\s+/g, ' ').slice(0, 120)}"`; };

    // (a)+(b) exact customer number, one match
    await fresh(); await f3('5559876543'); await p.keyboard.press('Enter'); await sleep(1800);
    rec('(a)(b) number + ONE Enter: the only match is on the sale, window closed, no Payment, back on the scan box', (await ok('Dana')) && (await focusId()) === 'scanInput', await why());
    // (b) name, one match
    await fresh(); await f3('Mike'); await p.keyboard.press('Enter'); await sleep(1800);
    rec('(b) name + ONE Enter: the only match is on the sale, window closed, no Payment', await ok('Mike'), await why());
    // (c) several matches: first highlighted, one Enter adds it
    await fresh(); await f3('555'); await p.keyboard.press('Enter'); await sleep(1500);
    const rows = await p.$$eval('#mRes tr.row', x => x.map(e => ({ sel: e.classList.contains('sel'), t: e.innerText.replace(/\s+/g, ' ') }))).catch(() => []);
    const buttons = await p.$$eval('#modalRoot button', x => x.map(e => e.innerText.trim()));
    rec('(c) several matches: listed, first row highlighted, nothing added yet, Edit Customer / New customer… / Close kept', rows.length >= 2 && rows[0].sel && !rows.slice(1).some(r => r.sel) && !(await state()).member && buttons.some(t => /^Edit Customer/.test(t)) && buttons.some(t => /^New customer/.test(t)) && buttons.some(t => /^Close \(Esc\)/.test(t)), JSON.stringify(rows) + ' ' + JSON.stringify(buttons));
    await p.keyboard.press('Enter'); await sleep(1800);
    rec('(c) ONE Enter adds the highlighted (first) customer and closes, no Payment', await ok('Mike'), await why());
    await fresh(); await f3('555'); await p.keyboard.press('Enter'); await sleep(1500); await p.keyboard.press('ArrowDown'); await sleep(300);
    const sel2 = await p.$$eval('#mRes tr.row', x => x.findIndex(e => e.classList.contains('sel'))).catch(() => -1);
    await p.keyboard.press('Enter'); await sleep(1800);
    rec('(c) Down arrow picks the 2nd row, Enter adds that one', sel2 === 1 && await ok('Dana'), 'sel ' + sel2 + ' ' + await why());
    // (d) no match
    await fresh(); await f3('Zzqxw'); await p.keyboard.press('Enter'); await sleep(1500);
    const t = await mtxt(), fd = await focusId();
    rec('(d) no match: "No customer found" + New customer… focused, nothing added', /No customer found/.test(t) && fd === 'mNew' && !(await state()).member, `focus ${fd} msg "${(t.match(/No customer[^\n]*/) || [''])[0]}"`);
    await p.keyboard.press('Enter'); await sleep(900);
    const nm = await p.$('#nmPhone'); const calls0 = ((await hook('/')).calls || []).length;
    rec('(d) Enter then opens New customer (no loop back to the search)', !!nm && /New customer/.test(await mtxt()), 'new dialog ' + !!nm);
    await p.keyboard.press('Escape'); await sleep(500);
    await fresh(); await f3('Zzqxw'); await p.keyboard.press('Enter'); await sleep(1500); await p.keyboard.type('a'); await sleep(200);
    rec('(d) typing after "No customer found" goes back into the search box', (await focusId()) === 'mQ' && /Zzqxwa$/.test(await p.$eval('#mQ', e => e.value)), 'focus ' + (await focusId()));
    // no accidental checkout: a second Enter right after the add (key bounce / old habit)
    await fresh(); await f3('5559876543'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => !document.getElementById('modalRoot').innerText.trim(), { timeout: 8000, polling: 20 }).catch(() => {});
    await p.keyboard.press('Enter'); await sleep(1500);
    rec('The adding Enter (and a bounce Enter right after it) never opens Payment', await ok('Dana'), await why());
    // mouse path kept: a click on a row opens the customer card (Use on this sale)
    await fresh(); await f3('555'); await p.keyboard.press('Enter'); await sleep(1500); await p.click('#mRes tr.row'); await sleep(1500);
    rec('Click on a row still opens the customer card with "Use on this sale (Enter)"', /Use on this sale/.test(await mtxt()) && !(await state()).member, (await mtxt()).replace(/\s+/g, ' ').slice(0, 120));
    rec('No page errors, no browser pop-ups', !errs.length && !dialogs.length, JSON.stringify(errs.concat(dialogs)).slice(0, 300));
  } catch (e) { rec('test ran to the end', false, String(e && e.stack || e).slice(0, 400)); } finally {
    await post('pay-close').catch(() => {}); await post('new-sale').catch(() => {}); await post('dismiss').catch(() => {}); await post('member-detach').catch(() => {});
    await p.close().catch(() => {}); b.disconnect();
    const pass = out.filter(x => x.pass).length; console.log(`e2e-customer-enter: ${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
  }
})().catch(e => { console.error(e); process.exit(1); });

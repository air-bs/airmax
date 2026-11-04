// AirMax 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31: "Build Sola card on file now and test it on the pretend server, local only").
// Offline fake AIR POS only: made-up customer, public TEST card numbers (4111 1111 1111 1111 / 5555 5555 5555 4444), no account, no internet.
// Needs a FRESH fake server (keyed mode is set before login) and its log file:
//   FAKE_STRICT_COMPLETE=1 FAKE_PORT=5280 node tests/look-fake.js > /tmp/look-f5280.log 2>&1 &   FAKE_PORT=5280 CHROME_URL=http://127.0.0.1:9633 node tests/e2e-sola-cof-109.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), cp = require('child_process');
const FP = Number(process.env.FAKE_PORT || 5280), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const FLOG = process.env.FAKE_LOG || `/tmp/look-f${FP}.log`;
const SCR = path.join(__dirname, '..', 'screens') + '/'; fs.mkdirSync(SCR, { recursive: true });
const VISA = '4111111111111111', MC = '5555555555554444', CVV = '737';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + String(note).replace(/\d{12,19}/g, '[CARD]')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = async p => JSON.parse(await (await fetch(HOOK + p)).text() || '{}');
const cofState = () => hook('/cof-state'), solaState = () => hook('/sola-state');
const dataDir = () => { const os = require('os'); const l = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('airreg-fake-')).map(n => path.join(os.tmpdir(), n)).filter(d => { try { return JSON.parse(fs.readFileSync(path.join(d, 'config.json'), 'utf8')).port === FP; } catch { return false; } }).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs); return l[0] || ''; };
const grepDir = (d, re) => { const hits = []; const walk = x => { for (const f of fs.readdirSync(x, { withFileTypes: true })) { const q = path.join(x, f.name); if (f.isDirectory()) walk(q); else if (re.test(fs.readFileSync(q, 'latin1'))) hits.push(q); } }; if (d) walk(d); return hits; };
const addBody = (cardNo, expiration, extra) => ({ id: 'm-sample', holderName: 'Sample Customer', billAddress: '100 Example St', zipCode: '00000', consent: true, card: { cardNo, expiration, cvv: CVV }, ...(extra || {}) });
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9633'), defaultViewport: { width: 1366, height: 768 } });
  const p = await b.newPage(); const errs = []; let blocked = 0;
  try {
    const relogin = async mode => { await hook('/keyed?mode=' + mode); await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach'); await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' }); };
    await relogin('sola'); await hook('/cof?n=0'); await hook('/sola-reset');
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
    await p.setRequestInterception(true);
    p.on('request', r => { const u = r.url(); if (u.startsWith(BASE) || u.startsWith('data:')) return r.continue(); if (/^(https?|wss?):/.test(u)) blocked++; return r.abort(); /* only web requests count as internet; a box Chrome extension script is still blocked, not counted */ });
    await p.bringToFront(); await p.setViewport({ width: 1366, height: 768 });
    const load = async () => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const mtxt = () => p.$eval('#modalRoot', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    const profile = async () => { await p.evaluate(() => customerView('m-sample')); await sleep(1200); };
    const shot = async name => { for (const w of [1366, 1024]) { await p.setViewport({ width: w, height: 768 }); await sleep(500); await p.screenshot({ path: `${SCR}v109-sola-${name}-${w}.png` }); } await p.setViewport({ width: 1366, height: 768 }); await sleep(300); };

    // ---- 1: off by default ----
    let r = await post('sola-cards');
    rec('Setting: Sola store, off by default, manager can change it', r.ok && r.sola === true && r.on === false && r.manager === true, JSON.stringify(r));
    r = await post('member-cards', { id: 'm-sample' });
    rec('Off: member-cards on a Sola store says off, old wording kept, no cards read', r.stripe === false && !(r.cards || []).length && /Stripe stores only/.test(r.note) && /Settings > Cards/.test(r.note), r.note);
    r = await post('member-card-add-complete', addBody(VISA, '12/30'));
    rec('Off: a Sola add is refused and nothing reaches AIR POS', !r.ok && !(await cofState()).log.some(x => x.op === 'complete'), r.message);
    await load(); await profile();
    rec('Off: no Cards on file box in the profile', !(await p.$('#cofBox')), '');
    await p.keyboard.press('Escape'); await sleep(400);

    // ---- 2: Settings > Cards (UI) ----
    await p.keyboard.down('Control'); await p.keyboard.press('9'); await p.keyboard.up('Control'); await sleep(1500);
    let t = await mtxt();
    rec('Settings > Cards opens with Ctrl+9 and shows the switch (off)', /Allow typed cards and cards on file for Sola stores/.test(t) && /Sola/.test(t) && await p.$eval('#seSola', e => !e.checked && !e.disabled).catch(() => false), t.slice(0, 160));
    await p.click('#seSola'); await sleep(1500);
    r = await post('sola-cards');
    rec('Settings > Cards: ticking it turns it on for this store only (saved)', r.ok && r.on === true && await p.$eval('#seSola', e => e.checked), JSON.stringify(r));
    t = await mtxt(); rec('Settings > Cards: the Sola channel and the card-handling note are visible', /through Sola/.test(t) && /never keeps, prints or logs the card number/.test(t) && /Off by default/.test(t), t.slice(-260));
    await shot('setting');
    await p.keyboard.press('Escape'); await sleep(400);

    // ---- 3: add a card in the UI ----
    await load(); await profile();
    t = await mtxt();
    rec('On: profile shows Cards on file kept by AIR POS and Sola', !!(await p.$('#cofBox')) && /Kept by AIR POS and Sola/.test(t) && /No cards on file/.test(t), t.slice(0, 200));
    await p.click('#cofAdd'); await sleep(800);
    t = await mtxt();
    const dlg = await p.evaluate(() => ({ no: !!$('cofNo'), exp: !!$('cofExp'), cvv: ($('cofCvv') || {}).type, save: ($('cofSave') || {}).disabled, stripe: !!document.querySelector('.fakeStripeBox, #cofStripe'), btns: [...document.querySelectorAll('#modalRoot button')].map(b => b.innerText) }));
    rec('Sola Add card dialog: typed number / MM/YY / CVV (hidden), consent tick, Save locked until ticked, no Stripe box', dlg.no && dlg.exp && dlg.cvv === 'password' && dlg.save === true && !dlg.stripe && dlg.btns.join('|') === 'Cancel (Esc)|Save card (Enter)', JSON.stringify(dlg));
    await p.type('#cofNo', VISA); await p.type('#cofExp', '1230'); await p.type('#cofCvv', CVV);
    rec('Sola Add card dialog: expiry auto-formats to MM/YY', await p.$eval('#cofExp', e => e.value) === '12/30', '');
    await p.click('#cofOk'); await sleep(300);
    await shot('addcard');
    await p.click('#cofSave'); await sleep(2500);
    let st = await cofState(); const comp = st.log.filter(x => x.op === 'complete');
    t = await mtxt();
    rec('Sola add: one AddBegin + one AddComplete with the typed card; listed as Visa ending 1111', st.log.filter(x => x.op === 'begin').length === 1 && comp.length === 1 && comp[0].p.last4 === '1111' && comp[0].p.cardNo === 'FULL-NUMBER-ending-1111' && /1111/.test(t), JSON.stringify(comp.map(c => ({ cardNo: c.p.cardNo, exp: c.p.expiration, cvv: c.p.cvv }))));
    rec('Sola add: the card boxes are gone from the page after saving', await p.evaluate(v => !document.documentElement.outerHTML.includes(v) && ![...document.querySelectorAll('input')].some(i => i.value.includes(v)), VISA), '');

    // ---- 4: duplicate, lost replies (routes) ----
    r = await post('member-card-add-complete', addBody(VISA, '12/30'));
    rec('Duplicate: the same card again is refused before AIR POS (list checked first)', !r.ok && r.alreadySaved && (await cofState()).log.filter(x => x.op === 'complete').length === 1, r.message);
    await hook('/fault?path=RetailMmeberCardAddComplete&mode=lost&n=1');
    r = await post('member-card-add-complete', addBody(MC, '01/31'));
    st = await cofState();
    rec('Lost reply (AIR POS did save): reported saved, not sent twice', r.ok && /had saved it/.test(r.message) && (st.cards['m-sample'] || []).filter(c => c.lastFourDigits === '4444').length === 1, r.message);
    r = await post('member-card-add-complete', addBody(MC, '01/31'));
    rec('Duplicate-save retry after the lost reply: refused, still one Mastercard', !r.ok && r.alreadySaved && ((await cofState()).cards['m-sample'] || []).filter(c => c.lastFourDigits === '4444').length === 1, r.message);
    await hook('/fault?path=RetailMmeberCardAddComplete&mode=down&n=1');
    r = await post('member-card-add-complete', addBody('4000056655665556', '03/32'));
    rec('Lost reply (never arrived): checked, says nothing was saved', !r.ok && /nothing was saved/.test(r.message) && !((await cofState()).cards['m-sample'] || []).some(c => c.lastFourDigits === '5556'), r.message);
    await hook('/fault?path=RetailMmeberCardAddComplete&mode=lost&n=1'); await hook('/fault?path=RetailMemberCardSelect&mode=down&n=1&skip=1'); // the list check before passes, the recheck after the lost reply fails
    r = await post('member-card-add-complete', addBody('4000056655665556', '03/32'));
    const r2 = await post('member-card-add-complete', addBody('4000056655665556', '03/32'));
    st = await cofState();
    rec('Lost reply and the check failed too: says do not add again; the retry finds it saved, never saved twice', !r.ok && /Do not add it again/.test(r.message) && (st.cards['m-sample'] || []).filter(c => c.lastFourDigits === '5556').length === 1 && !r2.ok && r2.alreadySaved !== false && /last try was saved|already has/.test(r2.message) && (st.log || []).filter(x => x.op === 'complete' && x.p.last4 === '5556').length === 1, r.message + ' / ' + r2.message);
    await hook('/fault-clear');
    r = await post('member-cards', { id: 'm-sample' });
    rec('List: 3 Sola cards, brand / last 4 / exp only', r.ok && r.sola === true && r.cards.length === 3 && r.cards.every(c => Object.keys(c).sort().join() === 'brand,exp,id,last4,usable'), JSON.stringify(r.cards));
    const visaId = r.cards.find(c => c.last4 === '1111').id, k5556 = r.cards.find(c => c.last4 === '5556').id;

    // ---- 5: delete (UI) ----
    await load(); await profile();
    await p.click(`[data-cofdel="${k5556}"]`); await sleep(400); await p.click('#cofYes'); await sleep(1500);
    r = await post('member-cards', { id: 'm-sample' });
    rec('Delete: Remove → Yes removes the card in AIR POS', r.ok && r.cards.length === 2 && !r.cards.some(c => c.last4 === '5556') && (await cofState()).log.some(x => x.op === 'delete'), JSON.stringify(r.cards.map(c => c.last4)));
    await p.keyboard.press('Escape'); await sleep(400);

    // ---- 6: charge a saved Sola card in the UI ----
    await post('member-attach', { number: '5550100' }); await load();
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900);
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1300);
    await p.click('.pline[data-t="30"]'); await sleep(1500);
    await p.click(`.cofopt[data-c="${visaId}"]`); await sleep(500);
    await p.focus('#pa-30'); await p.keyboard.press('+'); await sleep(500);
    let pk = await p.evaluate(() => ({ on: [...document.querySelectorAll('.cofopt.on')].map(e => e.dataset.c), chg: ($('cofChg') || {}).innerText, mc: !!($('mcBox') && $('mcBox').offsetParent), lbl: [...document.querySelectorAll('.pline .plbl')].map(e => e.innerText).join('|') }));
    rec('Checkout: saved Sola card picked, typed-card boxes hidden, Manual Credit label kept', pk.on.join() === visaId && /Visa •••• 1111 exp 12\/30 will be charged/.test(pk.chg) && !pk.mc && /Manual Credit/.test(pk.lbl), JSON.stringify(pk));
    await shot('pay-savedcard');
    let s0 = (await solaState()).begins || []; const n0 = s0.length;
    await p.click('#payOk'); await sleep(3000);
    let sb = (await solaState()).begins || []; const bg = sb[sb.length - 1] || {};
    rec('Checkout: Pay sends ONE ReceiveBegin with the Sola card id, masked card only; the sale completes', sb.length === n0 + 1 && bg.retailMemberCardId === visaId && JSON.stringify(bg.creditCard) === JSON.stringify({ cardNo: '**** **** **** 1111', expiration: '12/30', cvv: '***' }) && /complete|Change/i.test(await mtxt()), JSON.stringify(bg));
    await p.keyboard.press('Escape'); await sleep(600);

    // ---- 7: open Sola payment: poll, double-charge block, approve ----
    const sale = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-attach', { number: '5550100' }); await post('scan', { code: '1001' }); await post('pay-start'); };
    await sale(); await hook('/sola-wait?on=1');
    const nb = ((await solaState()).begins || []).length;
    r = await post('pay-tender', { type: 30, amount: 10.8, savedCardId: visaId });
    let s1 = await state();
    rec('Open Sola payment: tender waits (polls AIR POS), not charged twice', r.ok !== false && /waiting|Waiting|checking|AIR POS/i.test(JSON.stringify(s1.pay && s1.pay.card || r)), JSON.stringify((s1.pay && s1.pay.card) || r).slice(0, 200));
    r = await post('pay-tender', { type: 30, amount: 10.8, savedCardId: visaId });
    rec('Double charge: a second tender while one is open is refused', !r.ok && ((await solaState()).begins || []).length === nb + 1, r.message);
    const lo = (await state()).lastOrderId; await hook('/sola-done?ok=1'); await sleep(4500);
    s1 = await state();
    rec('Open Sola payment: approved by AIR POS → sale completes once', ((await solaState()).begins || []).length === nb + 1 && !!s1.completed && s1.lastOrderId && s1.lastOrderId !== lo, JSON.stringify({ completed: !!s1.completed, lastOrderId: s1.lastOrderId, before: lo }));
    await hook('/sola-wait?on=0');
    await post('pay-close'); await post('new-sale'); await post('dismiss');

    // ---- 8: lost ReceiveBegin reply on a saved card: checked, never re-sent ----
    await sale(); const nb2 = ((await solaState()).begins || []).length;
    await hook('/fault?path=RetailOrderReceiveBegin&mode=lost&n=1');
    r = await post('pay-tender', { type: 30, amount: 10.8, savedCardId: visaId }); await sleep(4000);
    s1 = await state();
    rec('Lost charge reply: AIR POS is asked, the card is NOT charged again', ((await solaState()).begins || []).length === nb2 + 1, JSON.stringify(r).slice(0, 160) + ' | ' + JSON.stringify((s1.pay && s1.pay.card) || s1.lastSale || {}).slice(0, 160));
    await hook('/fault-clear'); await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach');

    // ---- 9: Stripe regression on the same server ----
    await relogin('stripe'); await hook('/cof?n=2');
    r = await post('member-cards', { id: 'm-sample' });
    rec('Stripe regression: member-cards unchanged (stripe true, 2 cards)', r.ok && r.stripe === true && r.cards.length === 2 && r.cards.every(c => Object.keys(c).sort().join() === 'brand,exp,id,last4,usable'), JSON.stringify(r).slice(0, 200));
    r = await post('member-card-add-begin', { id: 'm-sample' });
    rec('Stripe regression: AddBegin still hands out the SetupIntent secret only', r.ok && typeof r.clientSecret === 'string' && Object.keys(r).filter(k => k !== 'loggedIn').sort().join() === 'clientSecret,ok,test', JSON.stringify(Object.keys(r)));
    r = await post('member-card-add-complete', addBody(VISA, '12/30', { setupIntentId: 'seti_fake109' }));
    rec('Stripe regression: a typed card body is not used on Stripe (SetupIntent path)', r.ok !== undefined && !((await cofState()).log.some(x => x.op === 'complete' && x.p.cardNo)), r.message);
    r = await post('sola-cards');
    rec('Stripe store: the Sola switch is not used here', r.ok && r.sola === false && r.channelType === 10, JSON.stringify(r));
    await relogin('sola');
    r = await post('sola-cards-set', { on: false });
    rec('Setting: turning it off again works', r.ok && r.on === false, r.message);

    // ---- 10: no card data anywhere on disk or in logs ----
    const D = dataDir(), RE = new RegExp([VISA, MC, '4000056655665556', '411111', '555555'].join('|'));
    const hits = grepDir(D, RE);
    rec('Disk: no card number in the Air Max data dir (journal, settings, logs)', !!D && !hits.length, (D ? 'dir found' : 'data dir not found') + ' ' + hits.map(h => path.basename(h)).join(','));
    if (fs.existsSync(FLOG)) { const L = fs.readFileSync(FLOG, 'utf8'); rec('Logs: no card number or CVV in the server log', !RE.test(L) && !/cvv["':= ]+737/i.test(L), L.length + ' bytes'); }
    else rec('Logs: server log found', false, 'missing ' + FLOG);
    const S = JSON.stringify(await solaState()) + JSON.stringify(await cofState());
    rec('Fake AIR POS keeps only masked copies (no number, no CVV)', !RE.test(S) && !/"cvv":"737"/.test(S), '');
    rec('No page errors; nothing reached the internet', !errs.length && !blocked, errs.join(' | ') + ' blocked=' + blocked);
  } catch (e) { rec('test run', false, e.stack); }
  finally { try { await post('sola-cards-set', { on: false }); await relogin(''); } catch {} await p.close().catch(() => {}); b.disconnect(); }
  const n = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-sola-cof-109-results.json'), JSON.stringify(out, null, 1));
  console.log(`\n${n}/${out.length} Sola card on file checks passed`); process.exit(n === out.length ? 0 : 1);
})();

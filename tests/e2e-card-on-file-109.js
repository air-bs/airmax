// AirMax 1.0.9 card on file (Ari OK 1:25 AM ET Oct 30; plan /workspace/airpos-look-backups/card-on-file-mockup/PLAN-card-on-file.md).
// Offline fake AIR POS only (made-up customer and Stripe TEST last-4s, no account). Stripe.js is replaced by a tiny fake served
// through request interception, so nothing goes to the internet (every other outside request is blocked).
// Needs a FRESH fake server (keyed mode is set before login):
//   FAKE_STRICT_COMPLETE=1 FAKE_PORT=5180 node tests/look-fake.js > /tmp/look-f5180.log &   FAKE_PORT=5180 node tests/e2e-card-on-file-109.js
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const FLOG = process.env.FAKE_LOG || `/tmp/look-f${FP}.log`;
const SCR = path.join(__dirname, '..', 'screens') + '/'; fs.mkdirSync(SCR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = async p => JSON.parse(await (await fetch(HOOK + p)).text() || '{}');
const cofState = () => hook('/cof-state');
const FAKE_STRIPE = `window.Stripe = function (key) { window.__stripeKey = key; return {
  elements() { return { create(type, o) { return { mount(sel) { const d = document.querySelector(sel); d.innerHTML = '<div class="fakeStripeBox">FAKE Stripe card box (test)</div>'; (window.__mounted = window.__mounted || []).push(type + (o && o.hidePostalCode ? ':nozip' : '')); }, on(ev, f) { if (ev === 'ready') setTimeout(f, 10); }, focus() {}, destroy() {}, unmount() {} }; } }; },
  confirmCardSetup(cs, data) { const pm = data && data.payment_method || {}; window.__setup = { csOk: /^seti_/.test(cs), hasCard: !!pm.card, billing: pm.billing_details };
    return Promise.resolve(window.__stripeFail ? { error: { type: 'card_error', message: 'Your card was declined (fake)' } } : { setupIntent: { id: 'seti_fake109', status: 'succeeded' } }); },
  confirmCardPayment() { return Promise.resolve({ paymentIntent: { status: 'succeeded' } }); } }; };`;
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const p = await b.newPage(); const errs = []; let blocked = 0;
  try {
    const relogin = async mode => { await hook('/keyed?mode=' + mode); await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach'); await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' }); };
    await relogin('stripe'); await hook('/cof?n=0');
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept().catch(() => {}));
    await p.setRequestInterception(true);
    p.on('request', r => { const u = r.url(); if (u.startsWith('https://js.stripe.com/')) return r.respond({ status: 200, contentType: 'application/javascript', body: FAKE_STRIPE });
      if (u.startsWith(BASE) || u.startsWith('data:')) return r.continue(); blocked++; return r.abort(); });
    await p.bringToFront(); await p.setViewport({ width: 1366, height: 768 });
    const load = async () => { await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await sleep(1500); };
    const mtxt = () => p.$eval('#modalRoot', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    const profile = async () => { await p.evaluate(() => customerView('m-sample')); await sleep(1200); };
    const shot = async name => { for (const w of [1366, 1024]) { await p.setViewport({ width: w, height: 768 }); await sleep(500); await p.screenshot({ path: `${SCR}v109-cof-${name}-${w}.png` }); } await p.setViewport({ width: 1366, height: 768 }); await sleep(300); };
    const fits = () => p.evaluate(() => { const m = document.querySelector('#modalRoot .modal'); if (!m) return 'no modal'; const r = m.getBoundingClientRect();
      const bad = [...m.querySelectorAll('button, input, .cofrow, .cofstripe')].filter(e => { const q = e.getBoundingClientRect(); return q.width && (q.left < r.left - 1 || q.right > r.right + 1 || (e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 1)); }).map(e => e.id || e.className);
      return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1 && !bad.length ? 'ok' : JSON.stringify({ bad, r: [r.left, r.right, r.bottom] }); });

    // ---- 1: server routes (fake AIR POS) ----
    let r = await post('member-cards', { id: 'm-sample' });
    rec('Route member-cards: Stripe store, no cards yet', r.ok && r.stripe === true && Array.isArray(r.cards) && r.cards.length === 0, JSON.stringify(r));
    await hook('/cof?n=2'); r = await post('member-cards', { id: 'm-sample' });
    rec('Route member-cards: 2 cards, brand / last 4 / exp only, the other-channel card marked not usable',
      r.ok && r.cards.length === 2 && r.cards[0].brand === 'Visa' && r.cards[0].last4 === '4242' && r.cards[0].exp === '12/28' && r.cards[0].usable === true && r.cards[1].usable === false
      && r.cards.every(c => Object.keys(c).sort().join() === 'brand,exp,id,last4,usable'), JSON.stringify(r.cards));
    r = await post('member-card-add-begin', { id: 'm-sample' });
    rec('Route member-card-add-begin: gives the screen the SetupIntent client secret (and only that)', r.ok && r.clientSecret === 'seti_fake109_secret_DONOTLOG' && (await cofState()).log.some(x => x.op === 'begin' && x.p.retailMemberId === 'm-sample'), JSON.stringify(Object.keys(r)));
    r = await post('member-card-add-complete', { id: 'm-sample', setupIntentId: 'bogus', holderName: 'A', billAddress: 'B', zipCode: 'C' });
    let st = await cofState();
    rec('Route member-card-add-complete: refuses a bad SetupIntent id before calling AIR POS', !r.ok && !st.log.some(x => x.op === 'complete'), r.message);
    r = await post('member-card-add-complete', { id: 'm-sample', setupIntentId: 'seti_fake109', holderName: '', billAddress: 'B', zipCode: 'C' });
    rec('Route member-card-add-complete: needs holder name, address and ZIP', !r.ok && /name|address|ZIP/i.test(r.message), r.message);
    r = await post('member-card-delete', { id: 'm-sample', cardId: 'nope' });
    rec('Route member-card-delete: unknown card refused', !r.ok, r.message);

    // ---- 2: customer profile, Cards on file ----
    await hook('/cof?n=0'); await load(); await profile();
    let t = await mtxt();
    rec('Profile: "Cards on file" box with the note, Add card… button and the empty text', /Cards on file/.test(t) && /Air Max never stores card numbers/.test(t) && await p.$('#cofAdd') !== null && /No cards on file\. Press Add card… to save one \(the customer must agree\)/.test(t), t.slice(0, 200));
    rec('Profile: no MOCK-UP badge; old buttons kept (Edit)', !/MOCK/i.test(t) && await p.$('#cvEdit') !== null, '');
    rec('Profile (no cards) fits at 1366', (await fits()) === 'ok', await fits());
    await shot('profile-nocards');
    await hook('/cof?n=2'); await profile(); t = await mtxt();
    const rows = await p.$$eval('.cofrow', x => x.map(e => ({ off: e.classList.contains('off'), t: e.innerText.replace(/\s+/g, ' '), rm: !!e.querySelector('[data-cofdel]') })));
    rec('Profile: 2 cards listed with Remove; the other-channel card greyed with its note', rows.length === 2 && /Visa •••• 4242 exp 12\/28/.test(rows[0].t) && !rows[0].off && rows[1].off && /Mastercard •••• 4444/.test(rows[1].t) && /Saved under another payment channel: cannot be charged here/.test(rows[1].t) && rows.every(x => x.rm), JSON.stringify(rows));
    const op = await p.$eval('.cofrow.off .cofname', e => getComputedStyle(e).opacity).catch(() => 'none');
    rec('Profile: greyed card text is faded (opacity .5)', Number(op) <= 0.6, 'opacity ' + op);
    for (const w of [1366, 1024]) { await p.setViewport({ width: w, height: 768 }); await sleep(400); const f = await fits(); rec(`Profile (2 cards) fits at ${w}`, f === 'ok', f); }
    await p.setViewport({ width: 1366, height: 768 });
    await shot('profile-2cards');

    // ---- 3: Remove asks first ----
    await p.click('.cofrow [data-cofdel="mc-visa"]'); await sleep(400); t = await mtxt();
    rec('Remove: asks "are you sure" in the row (No, keep it / Yes, remove)', /Are you sure\?/.test(t) && await p.$('#cofKeep') !== null && await p.$('#cofYes') !== null, t.slice(0, 160));
    await p.click('#cofKeep'); await sleep(900);
    st = await cofState();
    rec('Remove: "No, keep it" keeps the card (nothing sent to AIR POS)', !st.log.some(x => x.op === 'delete') && (await p.$$('.cofrow')).length === 2, '');
    await p.click('.cofrow [data-cofdel="mc-visa"]'); await sleep(400); await p.click('#cofYes'); await sleep(1300);
    st = await cofState(); t = await mtxt();
    rec('Remove: "Yes, remove" deletes it in AIR POS (retailMemberId + cardId, like the real AIR POS app) and the list reloads', st.log.some(x => x.op === 'delete' && x.p.retailMemberId === 'm-sample' && x.p.cardId === 'mc-visa' && !('id' in x.p)) && (await p.$$('.cofrow')).length === 1 && /Card removed from this customer/.test(t), t.slice(0, 160));

    // ---- 4: Add card dialog ----
    await hook('/cof?n=0'); await profile(); await p.click('#cofAdd'); await sleep(1500); t = await mtxt();
    const dlg = await p.evaluate(() => ({ h: (document.querySelector('#modalRoot h2') || {}).innerText, holder: $('cofHolder') && $('cofHolder').value, addr: $('cofAddr') && $('cofAddr').value, zip: $('cofZip') && $('cofZip').value,
      inputs: [...document.querySelectorAll('#modalRoot input')].map(i => i.id), save: $('cofSave') && $('cofSave').disabled, saveT: $('cofSave') && $('cofSave').innerText, cancelT: $('cofCancel') && $('cofCancel').innerText,
      mounted: window.__mounted || [], key: window.__stripeKey, box: $('cofStripe') && $('cofStripe').innerText }));
    rec('Add card: title, name / address / ZIP filled in from the customer', dlg.h === 'Add card · Sample Customer' && dlg.holder === 'Sample Customer' && dlg.addr === '100 Example St' && dlg.zip === '00000', JSON.stringify(dlg));
    rec("Add card: card goes in Stripe's secure box (one 'card' element, no ZIP in it, test key); no card-number box of our own", dlg.mounted.join() === 'card:nozip' && dlg.key === 'pk_test_madeup' && /FAKE Stripe/.test(dlg.box) && dlg.inputs.join() === 'cofHolder,cofAddr,cofZip,cofOk' && /typed into Stripe's secure card box/.test(t), JSON.stringify(dlg.inputs) + ' ' + dlg.mounted);
    rec('Add card: Save is off until the consent box is ticked; labels kept', dlg.save === true && /Customer agrees to save this card for future purchases/.test(t) && dlg.saveT === 'Save card (Enter)' && dlg.cancelT === 'Cancel (Esc)', dlg.saveT + ' / ' + dlg.cancelT);
    rec('Add card fits at 1366', (await fits()) === 'ok', await fits());
    await p.focus('#cofHolder'); await p.keyboard.press('Enter'); await sleep(700);
    rec('Add card: Enter does nothing before consent (AIR POS not called)', !(await cofState()).log.some(x => x.op === 'begin'), '');
    await shot('addcard');
    await p.click('#cofOk'); await sleep(300);
    rec('Add card: ticking consent turns Save on', await p.$eval('#cofSave', e => !e.disabled), '');
    await p.setViewport({ width: 1024, height: 768 }); await sleep(400); { const f = await fits(); rec('Add card fits at 1024', f === 'ok', f); }
    await p.setViewport({ width: 1366, height: 768 }); await sleep(300);
    await shot('addcard-agreed');
    // a declined card: nothing saved
    await p.evaluate(() => { window.__stripeFail = true; }); await p.click('#cofSave'); await sleep(1500); t = await mtxt(); st = await cofState();
    rec('Add card: Stripe declines → message, nothing saved, dialog stays', /declined \(fake\)\. Nothing was saved\./.test(t) && !st.log.some(x => x.op === 'complete') && await p.$('#cofSave') !== null && await p.$eval('#cofSave', e => !e.disabled), t.slice(-140));
    await p.evaluate(() => { window.__stripeFail = false; });
    await p.focus('#cofZip'); await p.keyboard.press('Enter'); await sleep(2000);
    st = await cofState(); const setup = await p.evaluate(() => window.__setup); t = await mtxt();
    const comp = st.log.filter(x => x.op === 'complete').pop() || {};
    rec('Add card: Enter saves: AddBegin → Stripe confirmCardSetup (with billing name/address/ZIP) → AddComplete', st.log.filter(x => x.op === 'begin').length === 2 && setup && setup.csOk && setup.hasCard && setup.billing.name === 'Sample Customer' && setup.billing.address.line1 === '100 Example St' && setup.billing.address.postal_code === '00000' && !!comp.p, JSON.stringify(setup));
    rec('Add card: AddComplete gets the SetupIntent id and blank card fields (no number, exp or CVV ever)', comp.p && comp.p.setupIntentId === 'seti_fake109' && comp.p.retailMemberId === 'm-sample' && comp.p.cardNo === '' && comp.p.expiration === '' && comp.p.cvv === '' && comp.p.holderName === 'Sample Customer' && comp.p.zipCode === '00000', JSON.stringify(comp.p));
    rec('Add card: back on the profile with the new card listed', /Card saved for this customer|Cards on file/.test(t) && (await p.$$('.cofrow')).length === 1 && /Visa •••• 4242 exp 12\/30/.test(t), t.slice(0, 200));
    await p.click('#cofAdd'); await sleep(1000); await p.keyboard.press('Escape'); await sleep(1000);
    rec('Add card: Esc goes back to the customer profile', await p.$('#cofBox') !== null && await p.$('#cofSave') === null, (await mtxt()).slice(0, 80));
    await p.keyboard.press('Escape'); await sleep(600);

    // ---- 5: Sola and no-channel stores: no section, routes refuse ----
    await relogin('sola'); await load(); await profile();
    r = await post('member-card-add-begin', { id: 'm-sample' });
    const rc = await post('member-cards', { id: 'm-sample' });
    rec('Sola store: no Cards on file box; add-begin refused (Stripe stores only)', await p.$('#cofBox') === null && !r.ok && /Stripe stores only/.test(r.message) && rc.stripe === false && /Stripe stores only/.test(rc.note), r.message);
    await relogin(''); await load(); await profile();
    r = await post('member-card-add-begin', { id: 'm-sample' });
    rec('Store with no card channel: no box; add-begin refused', await p.$('#cofBox') === null && !r.ok, r.message);
    await relogin('stripe');

    // ---- 6: checkout picker ----
    await hook('/cof?n=2');
    await post('member-attach', { number: '5550100' }); await load();
    await p.focus('#scanInput'); await p.keyboard.type('1001'); await p.keyboard.press('Enter'); await sleep(900);
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1300);
    await p.click('.pline[data-t="30"]'); await sleep(1500);
    let pk = await p.evaluate(() => ({ pick: !!$('cofPick'), on: [...document.querySelectorAll('.cofopt.on')].map(e => e.dataset.c), off: [...document.querySelectorAll('.cofopt.off')].map(e => e.dataset.c), opts: [...document.querySelectorAll('.cofopt')].map(e => e.innerText.trim()),
      lbl: [...document.querySelectorAll('.pline .plbl')].map(e => e.innerText).join('|'), hint: ($('cofPick') || {}).innerText || '' }));
    rec('Checkout: saved cards listed under Manual Credit (label kept), nothing preselected', pk.pick && pk.on.length === 0 && /Manual Credit/.test(pk.lbl) && pk.opts.length === 3 && /Type a new card/.test(pk.opts[2]) && /add cards in Customers/.test(pk.hint), JSON.stringify(pk));
    await p.click('.cofopt[data-c="mc-other"]'); await sleep(500);
    pk = await p.evaluate(() => ({ on: [...document.querySelectorAll('.cofopt.on')].map(e => e.dataset.c), msg: ($('payMsg') || {}).innerText }));
    rec('Checkout: the other-channel card is greyed and cannot be picked', pk.on.length === 0 && /another payment channel/.test(pk.msg), JSON.stringify(pk));
    await p.click('.cofopt[data-c="mc-visa"]'); await sleep(500);
    await p.focus('#pa-30'); await p.keyboard.press('+'); await sleep(500);
    pk = await p.evaluate(() => ({ on: [...document.querySelectorAll('.cofopt.on')].map(e => e.dataset.c), chg: ($('cofChg') || {}).innerText, v: ($('pa-30') || {}).value }));
    rec('Checkout: picking the Visa marks it and says what will be charged', pk.on.join() === 'mc-visa' && /^Visa •••• 4242 exp 12\/28 will be charged \$\d+\.\d\d when you press Pay$/.test(pk.chg), JSON.stringify(pk));
    t = await mtxt();
    rec('Checkout: no "Remember card" box anywhere', !/remember/i.test(t) && await p.$('#modalRoot input[type=checkbox]') === null, '');
    await shot('pay-savedcards');
    const before = (await cofState()).pays.length;
    await p.click('#payOk'); await sleep(2500);
    st = await cofState(); const pay = st.pays[st.pays.length - 1] || {}; const s1 = await state();
    rec('Checkout: Pay charges the saved card; the sale completes', st.pays.length === before + 1 && /Sale complete|Change|complete/i.test(await mtxt() + JSON.stringify(s1.lastSale || '')), (await mtxt()).slice(0, 120));
    rec('Checkout: AIR POS gets paymentType 30 + retailMemberCardId, masked card only, recordCreditCard false',
      pay.retailMemberCardId === 'mc-visa' && pay.recordCreditCard === false && pay.retailMemberId === 'm-sample' && JSON.stringify(pay.creditCard) === JSON.stringify({ cardNo: '**** **** **** 4242', expiration: '12/28', cvv: '***' }), JSON.stringify(pay));
    await p.keyboard.press('Escape'); await sleep(600);

    // ---- 7: tender route checks (the payments change is only the card id) ----
    const sale = async () => { await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-attach', { number: '5550100' }); await post('scan', { code: '1001' }); await post('pay-start'); };
    await sale(); let n0 = (await cofState()).pays.length;
    r = await post('pay-tender', { type: 30, amount: 1, savedCardId: 'mc-other' });
    rec('Tender: other-channel card refused, nothing charged', !r.ok && /another payment channel/.test(r.message) && /Nothing was charged/.test(r.message) && (await cofState()).pays.length === n0, r.message);
    r = await post('pay-tender', { type: 30, amount: 1, savedCardId: 'mc-gone' });
    rec('Tender: a card no longer on file refused, nothing charged', !r.ok && !/Add the customer/.test(r.message) && /Nothing was charged/.test(r.message) && (await cofState()).pays.length === n0, r.message);
    await post('pay-close'); await post('member-detach'); await post('pay-start');
    r = await post('pay-tender', { type: 30, amount: 1, savedCardId: 'mc-visa' });
    rec('Tender: saved card refused when no customer is on the sale', !r.ok && /Add the customer/.test(r.message) && /Nothing was charged/.test(r.message) && (await cofState()).pays.length === n0, r.message);
    r = await post('pay-tender', { type: 30, amount: 1 });
    st = await cofState(); const np = st.pays[st.pays.length - 1] || {};
    rec('Tender: a new typed card is unchanged (no card id, blank card, recordCreditCard false)', st.pays.length === n0 + 1 && np.retailMemberCardId === null && np.recordCreditCard === false && np.creditCard && np.creditCard.cardNo === '', JSON.stringify(np));
    await post('pay-close'); await post('new-sale'); await post('dismiss');

    // ---- 8: no secrets / card data in the logs ----
    if (fs.existsSync(FLOG)) { const L = fs.readFileSync(FLOG, 'utf8');
      rec('Logs: no client secret, SetupIntent id, card last-4 or masked card in the server log', !/seti_|DONOTLOG|client_secret|\*\*\*\* \*\*\*\*|4242|4444|sk_(test|live)_/.test(L), FLOG + ' ' + L.length + ' bytes');
    } else rec('Logs: server log found', false, 'missing ' + FLOG);
    rec('No page errors; nothing reached the internet (fake Stripe.js only)', !errs.length, errs.join(' | ') + ' blocked=' + blocked);
  } catch (e) { rec('test run', false, e.stack); }
  finally { try { await relogin(''); } catch {} await p.close().catch(() => {}); b.disconnect(); }
  const n = out.filter(x => x.pass).length;
  fs.writeFileSync(path.join(__dirname, 'e2e-card-on-file-109-results.json'), JSON.stringify(out, null, 1));
  console.log(`\n${n}/${out.length} card on file checks passed`); process.exit(n === out.length ? 0 : 1);
})();

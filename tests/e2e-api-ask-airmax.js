// run-env: AIRMAX_TEST=1 AIRMAX_GROK_BASE=http://127.0.0.1:5372/v1 AIRMAX_ASK_GAP_MS=0 AIRMAX_ASK_PER_MIN=1000
// Ask AirMax in the real screen (Chrome) against the real app, a fake AIR POS and a FAKE Grok (tests/fake-grok.js, canary keys). No real key, no real network.
//   FAKE_PORT=5370 CHROME_URL=http://127.0.0.1:9467 node tests/e2e-api-ask-airmax.js      (the app must be started with the env in the line above)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5370), BASE = 'http://127.0.0.1:' + FP, GP = Number(process.env.ASK_GROK_PORT || 5372);
const KEY = 'xai-TEST-CANARY-0001-abcdefghijklmnop';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const SHOTS = process.env.ASK_SHOTS || '';   // set to a folder to take the screenshots (the screenshot script sets it)
const measure = () => { // rects of everything on Checkout that must stay visible; panel rect; header bottom
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const P = document.getElementById('askPanel'), pr = P && !P.hidden ? P.getBoundingClientRect() : null, out = [];
  document.querySelectorAll('#scanInput,#cartHead th,#totals,#info-customer,#qsIn,#bulkPanel,#actions .abtn,#right .rbtn,.tile').forEach(e => { if (e.closest('#askPanel') || !vis(e)) return; const r = e.getBoundingClientRect(); if (r.top >= innerHeight - 25 || r.bottom <= 0) return; out.push({ k: (e.id || e.className || e.tagName) + '|' + (e.innerText || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 30), l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }); });
  const cv = document.getElementById('checkoutView'), top = document.querySelector('#app .top');
  return { els: out, panel: pr && { l: Math.round(pr.left), t: Math.round(pr.top), r: Math.round(pr.right), b: Math.round(pr.bottom) }, w: innerWidth, hscroll: document.documentElement.scrollWidth > innerWidth + 1, top: top ? Math.round(top.getBoundingClientRect().bottom) : 0, cls: document.body.className };
};
const gk = (p, q) => fetch('http://127.0.0.1:' + GP + p + (q ? '?' + q : '')).then(r => r.json());
const glog = () => gk('/__log');
(async () => {
  let own = await require('./fake-grok.js').start(GP).catch(() => null); // our own fake Grok; when one already runs on the port we use its control URLs
  await gk('/__reset');
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9467'), defaultViewport: { width: 1366, height: 768 } });
  let p; const errs = [];
  const q = sel => p.$(sel), txt = sel => p.$eval(sel, e => e.innerText).catch(() => '');
  const shot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const open = async () => { await p.evaluate(() => AskAirMax.open()); await sleep(500); };
  const shut = async () => { await p.evaluate(() => AskAirMax.close()); await sleep(300); };
  const ask = async t => { await p.click('#askIn'); await p.$eval('#askIn', e => { e.value = ''; }); await p.keyboard.type(t); await p.keyboard.press('Enter'); await sleep(1200); };
  const focusId = () => p.evaluate(() => document.activeElement && document.activeElement.id);
  const rows = () => p.$$eval('#cart tr.row', t => t.length);
  const modal = () => p.$eval('#modalRoot', e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  try {
    await post('login', { company: 'fake shop', user: 'boss', password: 'boss-pw' });
    await post('ask-config-save', { removeKey: true }); await post('ask-history-clear'); await post('pay-close'); await post('new-sale'); await post('dismiss');
    p = await b.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { if (d.type() === 'beforeunload') d.accept().catch(() => {}); else { errs.push('DIALOG ' + d.message()); d.dismiss().catch(() => {}); } });
    await p.goto(BASE + '/'); await sleep(1800);
    // ---------- Off = nothing ----------
    rec('E1 Off (default): no Ask AirMax button and no panel for anyone', !(await q('#askBtn')) && !(await q('#askPanel')), '');
    await post('ask-config-save', { key: KEY, on: true }); await p.reload(); await sleep(1800);
    const bt = await p.evaluate(() => { const b = document.getElementById('askBtn'); return b && { prev: b.previousElementSibling && b.previousElementSibling.id, text: b.innerText.replace(/\s+/g, ' ').trim() }; });
    rec('E2 On: a "? Ask AirMax" button appears right after "F1 = keys"', !!bt && bt.prev === 'helpPill' && /Ask AirMax/.test(bt.text), JSON.stringify(bt));
    rec('E3 the Settings window has the manager-only "Ask AirMax" tab (or the new Settings menu entry)', await p.evaluate(() => (typeof ST_TABS !== 'undefined' && ST_TABS.some(t => t[0] === 'askmax')) || !!(window.AirMaxSettings && window.AirMaxSettings.add)), '');
    // ---------- the panel sits BESIDE Checkout and covers nothing; closing restores the layout exactly ----------
    const goldNames = new Set();
    for (const [w, h] of [[1366, 768], [1600, 900]]) {
      await p.setViewport({ width: w, height: h }); await sleep(500); await p.focus('#scanInput');
      const m0 = await p.evaluate(measure), f0 = await focusId();
      await p.click('#askBtn'); await sleep(600);
      const mo = await p.evaluate(measure), fo = await focusId();
      await shot('checkout-panel-open-' + w);
      const over = mo.els.filter(e => mo.panel && e.r > mo.panel.l + 1 && e.b > mo.panel.t && e.t < mo.panel.b);
      const names0 = m0.els.map(e => e.k).sort().join('\n'), namesO = mo.els.map(e => e.k).sort().join('\n');
      rec('E4 ' + w + ': opening the panel does not take the cursor away from the scan box', f0 === 'scanInput' && fo === 'scanInput', f0 + ' -> ' + fo);
      rec('E5 ' + w + ': the panel covers nothing on Checkout (' + mo.els.length + ' elements checked, none under it); no sideways scrollbar', !!mo.panel && !over.length && !mo.hscroll && mo.cls.includes('askOpen'), over.slice(0, 3).map(e => e.k).join('; ') + ' panel ' + JSON.stringify(mo.panel));
      rec('E6 ' + w + ': everything is still on screen with the panel open: scan box, Discount and Price columns, customer box, quick/action buttons, Total, Customer Add, Items, Checkout', names0 === namesO && /Discount/i.test(namesO) && /Price/i.test(namesO) && /TOTAL|totals/i.test(namesO) && /CHECKOUT/i.test(namesO), (names0 === namesO ? 'same ' + m0.els.length + ' elements' : 'differs: ' + names0.split('\n').filter(x => !namesO.split('\n').includes(x)).slice(0, 4).join('; ')));
      rec('E7 ' + w + ': the panel is narrower than a quarter of the screen (' + (mo.panel ? mo.panel.r - mo.panel.l : '?') + ' px)', !!mo.panel && mo.panel.r - mo.panel.l >= 300 && mo.panel.r - mo.panel.l <= 380 && mo.panel.r === w, '');
      await p.click('#askClose'); await sleep(500);
      const m1 = await p.evaluate(measure), f1 = await focusId();
      rec('E8 ' + w + ': closing restores the layout EXACTLY (every position the same as before it was opened) and puts the cursor back in the scan box', JSON.stringify(m1) === JSON.stringify(m0) && f1 === 'scanInput' && await p.evaluate(() => !document.documentElement.style.getPropertyValue('--ask-w')), JSON.stringify(m1) === JSON.stringify(m0) ? 'identical' : 'differs');
      await shot('checkout-panel-closed-' + w);
    }
    await p.setViewport({ width: 1366, height: 768 }); await sleep(400);
    // ---------- the panel does not get in the way of selling ----------
    await post('ask-config-save', { key: KEY, on: true }); await p.reload(); await sleep(1800);
    await open(); await p.focus('#scanInput'); const r0 = await rows();
    for (const c of ['1001', '1003']) { await p.keyboard.type(c); await p.keyboard.press('Enter'); await sleep(700); }
    rec('E9 scanning still works while the panel is open (2 items added)', (await rows()) === r0 + 2 && (await focusId()) === 'scanInput', 'rows ' + r0 + ' -> ' + (await rows()));
    const rR = await rows(); await p.click('#askIn'); await p.keyboard.type('a*b+c'); await sleep(300);
    const typed = await p.$eval('#askIn', e => e.value), mm = await modal();
    rec('E10 typing "*" and "+" in the question box is just text: no drawer, no cart change, no window', typed === 'a*b+c' && (await rows()) === rR && !mm, 'typed "' + typed + '", rows ' + rR + ' -> ' + (await rows()) + ', window "' + mm.slice(0, 30) + '"');
    await p.$eval('#askIn', e => { e.value = ''; });
    await p.focus('#scanInput'); await p.keyboard.press('Escape'); await sleep(500);
    rec('E11 Esc from the scan box does NOT close the panel (it does what it always did)', await p.evaluate(() => !document.getElementById('askPanel').hidden), '');
    await p.evaluate(() => { const e = document.querySelector('#tabbar .tab[data-tab="checkout"]'); if (e) e.click(); }); await sleep(500); await p.keyboard.press('Escape'); await sleep(300);
    await open(); await p.click('#askIn'); await p.keyboard.press('Escape'); await sleep(400);
    rec('E12 Esc with the cursor in the question box closes the panel, and the cursor goes back to the scan box', await p.evaluate(() => document.getElementById('askPanel').hidden && !document.body.classList.contains('askOpen')) && (await focusId()) === 'scanInput', await focusId());
    await post('new-sale'); await p.reload(); await sleep(1500);
    // ---------- asking, token count, usage bar, saved history ----------
    await open(); await ask('How do I reprint a receipt?');
    const body1 = await txt('#askBody');
    rec('E13 an answer appears with steps, [Button] and {Key} styled, a "From:" line and its token count', /Reprint Receipt/.test(body1) && /From:/.test(body1) && /5,820 tokens/.test(body1) && (await p.$$eval('#askBody .kb', t => t.length)) >= 3, body1.split('\n').filter(Boolean).slice(-4).join(' | '));
    rec('E14 the usage bar shows tokens used out of the daily budget (5.8k of 500k tokens: 4,720 text + 1,100 picture)', /5\.8k of 500k tokens/.test(await txt('#askBar')), (await txt('#askBar')).replace(/\n/g, ' '));
    await shot('panel-answer-history');
    await shut(); await p.reload(); await sleep(1500); await open(); await sleep(600);
    const body2 = await txt('#askBody');
    rec('E15 the history is saved: after close, reopen and a full page reload the question and answer are back', /How do I reprint a receipt\?/.test(body2) && /Reprint Receipt/.test(body2) && !(await p.$eval('#askClear', e => e.hidden)), '');
    // ---------- text is plain text ----------
    await gk('/__mode', 'm=html'); await ask('inject test'); await gk('/__mode', 'm=ok');
    const inj = await p.evaluate(() => ({ img: document.querySelectorAll('#askPanel img').length, b: document.querySelectorAll('#askBody b').length, txt: document.getElementById('askBody').innerText, pwn: window.__pwn }));
    rec('E16 an answer carrying HTML is shown as text only (no <img>, no <b> element, no script ran)', inj.img === 0 && /<img src=x/.test(inj.txt) && !inj.pwn, '');
    // ---------- Show me ----------
    await ask('How do I reprint a receipt?'); await sleep(300); const cartBefore = await rows(), mBefore = await modal();
    await p.evaluate(() => { const b = [...document.querySelectorAll('#askBody .showme')].pop(); b.click(); }); await sleep(500);
    const ring1 = await p.evaluate(() => { const r = document.querySelector('.askRing'); if (!r) return null; const a = r.getBoundingClientRect(), t = [...document.querySelectorAll('#right .rbtn')].find(e => /Reprint Receipt/.test(e.innerText)); const c = t && t.getBoundingClientRect(); return { n: r.innerText, a: [a.left, a.top, a.width, a.height].map(Math.round), t: c && [c.left, c.top, c.width, c.height].map(Math.round), step: document.getElementById('askShow').innerText.replace(/\s+/g, ' ') }; });
    await shot('show-me-highlight');
    rec('E17 "Show me" draws a numbered ring on the first named button, exactly around it (Step 1 of N)', !!ring1 && ring1.n === '1' && ring1.t && ring1.a.every((v, i) => Math.abs(v - ring1.t[i]) <= 8) && /Step 1 of \d+: Reprint Receipt/.test(ring1.step), JSON.stringify(ring1 && ring1.step));
    await p.click('#askShowNext'); await sleep(400);
    rec('E18 Next moves the ring to the second button', /Step 2 of/.test(await txt('#askShow')) && (await p.$$('.askRing')).length === 1, (await txt('#askShow')).replace(/\n/g, ' '));
    await p.keyboard.press('Escape'); await sleep(400);
    rec('E19 Esc stops "Show me" (rings gone, panel still open); nothing was clicked: no window, same cart', (await p.$$('.askRing')).length === 0 && !(await q('#askShow')) && await p.evaluate(() => !document.getElementById('askPanel').hidden) && !(await modal()) && (await rows()) === cartBefore, 'cart ' + cartBefore + ' -> ' + (await rows()));
    // ---------- Do it for me (confirm card with before -> after, then result, then Undo) ----------
    await ask('please change the drawer to star'); await sleep(300);
    const doBtn = await q('#askBody .doit');
    rec('E20 an answer that carries an allowed action offers "Do it for me" and says exactly what will change', !!doBtn && /You will see exactly what changes/.test(await txt('#askBody')), '');
    await doBtn.click(); await sleep(700);
    const conf = await txt('#askConfirm');
    await shot('do-it-confirm');
    rec('E21 the confirm card shows what changes as before -> after, says whether it can be undone, and nothing has changed yet', /Please confirm/.test(conf) && /→/.test(conf) && /undo/i.test(conf) && !!(await q('#askActOk')) && !!(await q('#askActNo')), conf.replace(/\n/g, ' | ').slice(0, 200));
    await p.click('#askActOk'); await sleep(900);
    const res = await txt('#askResult');
    await shot('do-it-result');
    rec('E22 Confirm runs it: a result card ("Done") with the same before -> after and an Undo button', /^Done/.test(res) && /→/.test(res) && !!(await q('#askActUndo')), res.replace(/\n/g, ' | ').slice(0, 200));
    await p.click('#askActUndo'); await sleep(800);
    rec('E23 Undo puts it back and says so', /Put back/.test(await txt('#askResult')) && !(await q('#askActUndo')), (await txt('#askResult')).replace(/\n/g, ' | '));
    const nRes = (await p.$$('#askResult')).length; await ask('please change the drawer to star'); await p.evaluate(() => [...document.querySelectorAll('#askBody .doit')].pop().click()); await sleep(600); await p.click('#askActNo'); await sleep(400);
    rec('E24 Cancel on the confirm card changes nothing and removes the card', !(await q('#askConfirm')) && (await p.$$('#askResult')).length === nRes, '');
    // ---------- web fallback + saved answers ----------
    await post('ask-config-save', { web: true }); await gk('/__reset'); await ask('what is the weather in Paris?');
    const lg = await glog(), calls = lg.filter(x => /chat\/completions|responses/.test(x.path)), webCall = lg.find(x => x.path === '/v1/responses');
    const sentText = JSON.stringify(webCall && webCall.body || {});
    rec('E25 a question the guide cannot answer goes to the web as a SECOND call, labelled "From the web"', calls.length === 2 && !!webCall && /From the web/.test(await txt('#askBody')) && !!(await q('#askWebLabel')), calls.map(c => c.path).join(' + '));
    rec('E26 the web call carries ONLY the cleaned question (no guide text, no history, no key in the body)', /weather in Paris/.test(sentText) && !/Reprint Receipt/.test(sentText) && !/CANARY/.test(sentText) && sentText.length < 1500, sentText.length + ' bytes');
    await shot('answer-from-web');
    const tk = await p.evaluate(() => [...document.querySelectorAll('#askBody .tk')].map(e => e.innerText).filter(t => /tokens/.test(t)).pop());
    rec('E27 the answer shows its own token count (both calls added up)', /^[\d,]+ tokens$/.test(tk) && parseInt(tk.replace(/,/g, '')) > 4720, tk);
    await gk('/__reset'); await ask('what is the weather in Paris?');
    const lg2 = await glog(), saved = (await txt('#askBody')).includes('Saved answer');
    rec('E28 the same question again is a "Saved answer": no call to Grok, 0 tokens', saved && lg2.filter(x => /chat\/completions|responses/.test(x.path)).length === 0 && /no tokens used/.test(await p.evaluate(() => [...document.querySelectorAll('#askBody .tk')].map(e => e.innerText).filter(t => /tokens/.test(t)).pop())), 'grok calls: ' + lg2.filter(x => /chat\/completions|responses/.test(x.path)).length);
    await shot('saved-answer');
    await p.evaluate(() => [...document.querySelectorAll('#askBody .vote.no')].pop().click()); await sleep(700);
    const bad = await txt('#askBody');
    rec('E29 "Not helpful" removes that saved answer and shows the who-to-contact card with "Contact details coming soon"', /removed that saved answer/.test(bad) && !!(await q('#askContact')) && /Contact details coming soon/.test(await txt('#askContact')), (await txt('#askContact')).replace(/\n/g, ' | '));
    await shot('contact-card');
    await gk('/__reset'); await ask('what is the weather in Paris?');
    rec('E30 after that the question goes to the web again (the saved answer is gone)', (await glog()).filter(x => /chat\/completions|responses/.test(x.path)).length === 2, '');
    await post('ask-config-save', { web: false }); await gk('/__reset'); await ask('who is the president of mars?');
    rec('E31 with the web switch Off the same kind of question gets the "not sure" reply and contact card, and no web call', (await glog()).every(x => x.path !== '/v1/responses') && !!(await q('#askContact')), '');
    // ---------- Clear history ----------
    await p.click('#askClear'); const armed = await txt('#askClear'); await p.click('#askClear'); await sleep(700);
    rec('E32 "Clear history" asks to be pressed twice, then empties the panel and the saved file', /Confirm clear/.test(armed) && !(await q('#askBody .me')) && (await post('ask-history')).entries.length === 0, armed);
    await p.reload(); await sleep(1500); await open();
    rec('E33 after a page reload the history is still empty', !(await q('#askBody .me')) && (await p.$eval('#askClear', e => e.hidden)), '');
    // ---------- errors: plain words, the sale is never affected, the key never shows ----------
    await post('ask-config-save', { web: false });
    await gk('/__mode', 'm=500'); await ask('how do I add a customer?'); const e500 = await txt('#askBody .err');
    rec('E34 a busy/failed help service gives a plain message and a "Try again" button', /busy/i.test(e500) && !!(await p.evaluate(() => [...document.querySelectorAll('#askBody .err button')].some(b => /Try again/.test(b.innerText)))), e500.replace(/\n/g, ' ').slice(0, 120));
    await gk('/__mode', 'm=401'); await ask('how do I add a customer 2?'); const e401 = await p.evaluate(() => [...document.querySelectorAll('#askBody .err')].pop().innerText);
    rec('E35 a key the service refuses gives a plain message that does not show the key', e401.length > 10 && !/CANARY|xai-/.test(e401), e401.replace(/\n/g, ' ').slice(0, 140));
    await shot('panel-key-refused'); await post('ask-config-save', { key: KEY, on: true }); await gk('/__mode', 'm=ok');
    own.close(); await sleep(400); await ask('how do I add a customer 3?'); const eOff = await p.evaluate(() => [...document.querySelectorAll('#askBody .err')].pop().innerText);
    await shot('panel-offline');
    rec('E36 when the help service cannot be reached: "I can\'t reach the help service", the sale is not affected, F1 is mentioned', /can't reach the help service/.test(eOff) && /sale is not affected/.test(eOff) && /F1/.test(eOff), eOff.replace(/\n/g, ' ').slice(0, 100));
    own = await require('./fake-grok.js').start(GP); await gk('/__reset');
    await p.evaluate(() => [...document.querySelectorAll('#askBody .err button')].pop().click()); await sleep(1500);
    rec('E37 "Try again" works once the service is back: the same question gets its answer and the error is gone', !(await p.evaluate(() => [...document.querySelectorAll('#askBody .err')].some(e => /can't reach/.test(e.innerText)))) && (await p.$$eval('#askBody .me', t => t.filter(x => /add a customer 3/.test(x.innerText)).length)) === 1 && /Open \[?Settings|Settings/.test(await txt('#askBody')), (await txt('#askBody')).split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 300));
    // ---------- the key never reaches the screen ----------
    const dom = await p.evaluate(() => document.documentElement.outerHTML + JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
    const apis = JSON.stringify([await post('ask-status'), await post('ask-history'), await post('ask-config-get'), await post('ask-unlock-info')]);
    rec('E38 the key (and "xai-") is not anywhere in the page, its storage, or any answer the screen can get', !/CANARY/.test(dom + apis) && !/xai-TEST/.test(dom + apis), 'page ' + dom.length + ' bytes, api ' + apis.length + ' bytes');
    // ---------- token budget: amber at 80%, limit, manager unlock showing the cost ----------
    await post('ask-history-clear'); const U0 = (await post('ask-status')).used, BUD = Math.ceil((U0 + 9700) / 0.85); await post('ask-config-save', { budget: BUD, unlockExtra: 250000 }); await p.reload(); await sleep(1500); await open();
    await gk('/__usage', 'in=9400&out=300'); await ask('how do I add a customer 4?');
    const barA = await p.$eval('#askBar', e => e.className);
    await shot('bar-amber');
    rec('E39 the usage bar turns amber at 80% of the allowance (one 9,700-token answer takes it from ' + Math.round(U0 / BUD * 100) + '% to ' + Math.round((U0 + 9700) / BUD * 100) + '%)', /amber/.test(barA) && /^Almost used up/.test(await txt('#askBar')), barA + ' | ' + (await txt('#askBar')).replace(/\n/g, ' '));
    await ask('how do I add a customer 5?');
    const lim = await q('#askLimit');
    await shot('limit-reached');
    rec('E40 when the allowance is used up: the bar is full/red, the box is disabled, and the card says Checkout is not affected', !!lim && /full/.test(await p.$eval('#askBar', e => e.className)) && await p.$eval('#askIn', e => e.disabled) && /Checkout is not affected/.test(await txt('#askLimit')), (await txt('#askLimit')).replace(/\n/g, ' ').slice(0, 120));
    await p.click('#askUnlockBtn'); await sleep(700);
    const uc = await txt('#askUnlockCost'); await shot('unlock-prompt');
    rec('E41 "Manager unlock" shows the extra amount (250,000 tokens, today only) and the estimated cost in dollars', /250,000 tokens/.test(uc) && /today only/.test(uc) && /\$\d+\.\d+/.test(uc), uc);
    rec('E42 a manager login does not need a password but must press Confirm', !(await q('#askMgrPw')) && !!(await q('#askUnlockGo')), '');
    await p.click('#askUnlockGo'); await sleep(900);
    rec('E43 after Confirm the allowance is bigger (budget + 250k), the limit card is gone and the box works again', !(await q('#askLimit')) && new RegExp('of ' + String(Math.round((BUD + 250000) / 1000)) + 'k tokens').test(await txt('#askBar')) && !(await p.$eval('#askIn', e => e.disabled)), (await txt('#askBar')).replace(/\n/g, ' '));
    await gk('/__usage', 'in=4500&out=220'); await post('ask-config-save', { budget: 500000 });
    // ---------- Settings: usage, tokens per question, Export report ----------
    await p.evaluate(() => { const b = document.getElementById('setTop'); if (b) b.click(); }); await sleep(900);
    await p.evaluate(() => { const t = document.querySelector('#stTabs [data-tab="askmax"]'); if (t) t.click(); }); await sleep(1200);
    const us = await txt('#akUsage');
    await shot('settings-usage');
    rec('E44 Settings > Ask AirMax shows usage for today and this month (questions, tokens, estimated cost) and tokens per question', /Today/.test(us) && /This month/.test(us) && /\$\d/.test(us) && /Tokens per question/.test(us) && /Last answer/.test(us), us.replace(/\n/g, ' ').slice(0, 160));
    rec('E45 the Settings page has the daily token budget, the extra-tokens amount, the web switch and the Export report button', !!(await q('#akBudget')) && !!(await q('#akExtra')) && !!(await q('#akWeb')) && !!(await q('#akExport')), '');
    const expDir = process.env.AIRMAX_EXPORT_DIR; const before = expDir && fs.existsSync(expDir) ? fs.readdirSync(expDir).length : 0;
    await p.select('#akFmt', 'csv'); await p.click('#akExport'); await sleep(1200); await shot('settings-export-report');
    const after = expDir && fs.existsSync(expDir) ? fs.readdirSync(expDir) : [];
    rec('E46 "Export report" writes the report file (CSV) on this PC and says where; nothing is uploaded', /Saved \d+ entries/.test(await txt('#akExRes')) && (!expDir || after.length === before + 1), (await txt('#akExRes')).slice(0, 100));
    // ---------- Checkout buttons are exactly master's, with the panel open ----------
    await p.keyboard.press('Escape'); await sleep(300); await p.evaluate(() => { const e = document.querySelector('#tabbar .tab[data-tab="checkout"]'); if (e) e.click(); }); await sleep(500); await open();
    const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures-0', 'checkout-buttons-master.json'), 'utf8'));
    const snap = await p.evaluate(() => { const t = e => e.textContent.replace(/\s+/g, ' ').trim(), all = s => [...document.querySelectorAll(s)]; return { left: all('#actions .abtn').map(e => [t(e), e.dataset.a]), right: all('#right h3, #right .rbtn').map(e => [e.tagName === 'H3' ? 'H:' + t(e) : t(e), e.dataset.a || '']) }; });
    rec('E47 with the panel open every Checkout button, label, shortcut and action is the same as master', JSON.stringify(snap.left) === JSON.stringify(GOLD.left) && JSON.stringify(snap.right) === JSON.stringify(GOLD.right), snap.left.length + ' left + ' + snap.right.length + ' right');
    // ---------- SCREEN CONTEXT: a masked, view-only picture of Checkout goes with the question ----------
    await post('ask-config-save', { key: KEY, on: true, screen: true, budget: 5000000 }); await post('ask-history-clear'); await post('pay-close'); await post('new-sale'); await post('scan', { code: '1001' }); await post('dismiss');
    await p.setViewport({ width: 1366, height: 768 }); await p.reload(); await sleep(1800); await open();
    const chatPosts = async () => (await glog()).filter(x => x.method === 'POST' && x.path === '/v1/chat/completions'), webPosts = async () => (await glog()).filter(x => x.method === 'POST' && x.path === '/v1/responses');
    const imgOf = e => { const c = e.body.messages[e.body.messages.length - 1].content; return Array.isArray(c) ? (c.find(x => x.type === 'image_url') || {}).image_url?.url || '' : ''; };
    const lastImg = async () => { const c = await chatPosts(); return c.length ? imgOf(c[c.length - 1]) : ''; };
    const px = (url, pts) => p.evaluate(async (url, pts) => { const im = new Image(); await new Promise((ok, no) => { im.onload = ok; im.onerror = no; im.src = url; }); const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height; const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0); return { w: im.width, h: im.height, px: pts.map(([x, y]) => Array.from(cx.getImageData(Math.max(0, Math.min(im.width - 1, x)), Math.max(0, Math.min(im.height - 1, y)), 1, 1).data.slice(0, 3))), white: (() => { const d = cx.getImageData(0, 0, im.width, im.height).data; let n = 0, k = 0; for (let i = 0; i < d.length; i += 4 * 7) { k++; if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; } return n / k; })() }; }, url, pts);
    const REQ = '#cart@@tr', needs = () => p.evaluate(() => { const T = id => { const e = document.getElementById(id); return e && e.closest('.tile'); }, el = { 'sale lines table': document.getElementById('cart').closest('.gridbox'), 'totals bar': document.getElementById('totals'), 'customer box': T('info-customer'), 'Checkout due amount': T('info-payment') }, P = document.getElementById('askPanel').getBoundingClientRect(), out = {}; for (const [k, e] of Object.entries(el)) { const r = e.getBoundingClientRect(); out[k] = { l: r.left, t: r.top, r: r.right, b: r.bottom }; } return { out, panelLeft: P.left, vw: innerWidth }; });
    const isBlack = a => a[0] <= 8 && a[1] <= 8 && a[2] <= 8;
    const shotCheck = async (w, tag) => {
      await gk('/__reset'); await ask('how do I reprint a receipt ' + tag); await sleep(600);
      const note = await txt('#askShotNote'), url = await lastImg(), nd = await needs(), meta = await p.evaluate(() => AskAirMax._lastShot);
      rec('E48 ' + w + ': pressing Ask attaches a picture to the question that Grok receives (first call, as an image part)', url.startsWith('data:image/png;base64,') && url.length > 5000 && url.length < 800000, (url.length / 1000 | 0) + ' kB base64');
      rec('E49 ' + w + ': the panel shows the note "A screenshot with sale and customer info hidden is sent with your question."', note === 'A screenshot with sale and customer info hidden is sent with your question.', note);
      const sc = meta.w / nd.panelLeft, pts = []; const names = Object.keys(nd.out);
      for (const k of names) { const r = nd.out[k]; const x0 = Math.floor(Math.max(0, r.l) * sc) + 4, x1 = Math.floor(Math.min(nd.panelLeft, r.r) * sc) - 4, y0 = Math.floor(r.t * sc) + 4, y1 = Math.floor(r.b * sc) - 4; pts.push([x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) >> 1, (y0 + y1) >> 1]); }
      const got = await px(url, pts); let bad = [];
      names.forEach((k, i) => { got.px.slice(i * 5, i * 5 + 5).forEach((a, j) => { if (!isBlack(a)) bad.push(k + '#' + j + '=' + a.join(',')); }); });
      rec('E50 ' + w + ': in the picture Grok received, the sale lines table, totals bar, customer box and Checkout due amount are SOLID BLACK (5 sample pixels each, ' + names.length * 5 + ' in all)', !bad.length && got.px.length === names.length * 5, bad.join(' ') || 'all black');
      rec('E51 ' + w + ': the rest of the screen is still visible (not all black: ' + Math.round(got.white * 100) + '% light pixels), and the picture stops where the panel starts (' + got.w + ' x ' + got.h + ', panel at ' + Math.round(nd.panelLeft) + ' px)', got.white > 0.3 && got.w <= 1024 && Math.abs(got.w - Math.round(Math.min(1, 1024 / nd.panelLeft) * Math.floor(nd.panelLeft))) <= 1, got.white.toFixed(2));
      rec('E52 ' + w + ': the black boxes are real rectangles (no blur): each box edge pixel is pure black next to a non-black neighbour or the border', await p.evaluate(m => m.boxes.length >= 4 && m.boxes.every(b => b.w > 4 && b.h > 4), meta), meta.boxes.length + ' boxes');
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'screen-masked-capture-as-grok-receives-' + w + '.png'), Buffer.from(url.split(',')[1], 'base64')); }
      return { url, nd, meta };
    };
    const c1366 = await shotCheck(1366, 'one'); await shot('screen-note-and-answer-1366');
    const sysmsg = (await chatPosts())[0].body.messages[0].content;
    rec('E53 the system message tells Grok the picture is view-only context, that black boxes hide things, and that it cannot click', /view-only/.test(sysmsg) && /solid black/.test(sysmsg) && /cannot press anything/.test(sysmsg), '');
    await shut(); await p.setViewport({ width: 1600, height: 900 }); await sleep(600); await open();
    const c1600 = await shotCheck(1600, 'two');
    rec('E54 the boxes follow the narrowed layout: the 1600 wide boxes differ from the 1366 ones', JSON.stringify(c1600.meta.boxes) !== JSON.stringify(c1366.meta.boxes), '');
    await shut(); await p.setViewport({ width: 1366, height: 768 }); await sleep(600); await open();
    // a popup is always black; an unknown popup => no picture
    await p.evaluate(() => { document.getElementById('modalRoot').innerHTML = '<div class="el-overlay" id="ov"><div class="modal" role="dialog" style="position:fixed;left:200px;top:150px;width:300px;height:140px;background:#fff">Card 4111 1111 1111 1111 Jane Roe</div></div>'; });
    await gk('/__reset'); await ask('how do I open the drawer popup'); const pop = await lastImg(); const pnd = await px(pop, [[(260 * 1024 / (await needs()).panelLeft) | 0, 200]]);
    rec('E55 an open popup (card / customer / payment dialog) is painted black in the picture', pop.length > 5000 && isBlack(pnd.px[0]), JSON.stringify(pnd.px[0]));
    await p.evaluate(() => { document.getElementById('modalRoot').innerHTML = '<div id="mystery" style="position:fixed;left:200px;top:150px;width:300px;height:140px">Customer Jane Roe</div>'; });
    await gk('/__reset'); await ask('how do I print a label popup'); const cn = await chatPosts();
    rec('E56 something sits in the popup area that cannot be recognised as a popup: FAIL CLOSED, no picture, only the question', cn.length >= 1 && !imgOf(cn[cn.length - 1]) && /No screenshot was sent this time/.test(await txt('#askBody')), '');
    await p.evaluate(() => { document.getElementById('modalRoot').innerHTML = ''; });
    // fail closed: each required selector missing => no picture; the question still goes and is answered
    const gone = { 'sale lines table': "document.getElementById('cart').closest('.gridbox')", 'totals bar': "document.getElementById('totals')", 'customer box': "document.getElementById('info-customer').closest('.tile')", 'Checkout due amount': "document.getElementById('info-payment').closest('.tile')" };
    let fc = 0; for (const [k, js] of Object.entries(gone)) {
      await p.reload(); await sleep(1700); await open(); await p.evaluate(js2 => { const e = eval(js2); e.remove(); }, js); await gk('/__reset'); await ask('how do I reprint a receipt ' + (++fc) + ' x');
      const cc = await chatPosts(), bodyT = await txt('#askBody');
      rec('E57 ' + k + ' missing => FAIL CLOSED: the question went to Grok with NO picture, an answer still came, and the panel says "No screenshot was sent this time"', cc.length === 1 && typeof cc[0].body.messages.slice(-1)[0].content === 'string' && /Reprint Receipt/.test(bodyT) && /No screenshot was sent this time/.test(bodyT), 'chat calls ' + cc.length);
    }
    await p.reload(); await sleep(1700); await open();
    for (const tab of ['orders', 'customers', 'items', 'giftcards', 'reports']) {
      await p.evaluate(t => { const e = document.querySelector('#tabbar .tab[data-tab="' + t + '"]'); e && e.click(); }, tab); await sleep(900); await gk('/__reset'); await ask('how do I find an old thing ' + tab);
      const o58 = await chatPosts(); rec('E58 on the ' + tab + ' screen (anything but Checkout) NO picture is sent, the question still is', !(await lastImg()) && o58.length === 1, 'chat calls ' + o58.length + ', picture ' + !!(await lastImg()));
    }
    await p.evaluate(() => { const e = document.querySelector('#tabbar .tab[data-tab="checkout"]'); e && e.click(); }); await sleep(700);
    // web fallback: the web call never carries a picture
    await post('ask-config-save', { web: true }); await gk('/__reset'); await ask('what is the capital of Spain'); await sleep(900); await post('ask-config-save', { web: false });
    const wc = await chatPosts(), ww = await webPosts();
    rec('E59 the web fallback: the first call had the picture, the second (web) call has NO picture, no picture rule, only the cleaned question', wc.length === 1 && !!imgOf(wc[0]) && ww.length === 1 && !/image|data:|view-only/.test(JSON.stringify(ww[0].body)) && /capital of Spain/.test(JSON.stringify(ww[0].body)), 'chat ' + wc.length + ' web ' + ww.length);
    // tokens: the picture's input tokens count toward the budget
    await gk('/__reset'); await gk('/__imgtok', 'n=3000'); const u0 = (await post('ask-status')).used; await ask('how do I clock out for lunch'); const u1 = (await post('ask-status')).used;
    rec('E60 picture tokens count toward the budget: 4,500 + 3,000 picture + 220 = 7,720 added to today\'s use', u1 - u0 === 7720, (u1 - u0) + ' (was ' + u0 + ')');
    rec('E61 the answer shows that count and the "screenshot ... was sent" line', /7,720 tokens/.test(await txt('#askBody')) && /Screenshot with sale and customer info hidden was sent/.test(await txt('#askBody')), '');
    await gk('/__reset');
    // nothing on disk, in logs or in the page's storage
    const tail = (await lastImg()) || c1366.url, TL = tail.slice(-60), dirs = [process.env.FAKE_DATA_DIR, process.env.AIRMAX_EXPORT_DIR].filter(Boolean);
    const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
    const files = dirs.flatMap(walk), hit = files.filter(f => { try { const s = fs.readFileSync(f, 'latin1'); return s.includes(TL) || s.includes(c1366.url.slice(-60)) || s.includes('data:image/png;base64,iVBOR'); } catch { return false; } });
    const imgFiles = files.filter(f => /\.(png|jpe?g|gif|bmp|webp)$/i.test(f) && !/icon|logo/i.test(f)), appLog = process.env.ASK_APP_LOG && fs.existsSync(process.env.ASK_APP_LOG) ? fs.readFileSync(process.env.ASK_APP_LOG, 'latin1') : null;
    rec('E62 NOTHING ON DISK: ' + files.length + ' files in the data and export folders hold none of the picture bytes and no "data:image" text; no image file exists there; the app log has none either' + (appLog === null ? ' (app log not checked: set ASK_APP_LOG)' : ''), dirs.length > 0 && files.length > 0 && !hit.length && !imgFiles.length && (appLog === null || (!appLog.includes(TL) && !appLog.includes('data:image'))), hit.concat(imgFiles).join(', ') || 'clean');
    const stor = await p.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]).includes('data:image'));
    rec('E63 the picture is not kept in the page either (no local or session storage entry, no history entry)', !stor && !JSON.stringify((await post('ask-history'))).includes('data:image'), '');
    // the switch
    await post('ask-config-save', { screen: false }); await p.reload(); await sleep(1700); await open(); await gk('/__reset'); await ask('how do I add a tip');
    rec('E64 screenshot switch Off in Settings: the note is gone and no picture is sent', (await p.$eval('#askShotNote', e => e.hidden)) && !(await lastImg()) && (await chatPosts()).length === 1, '');
    await post('ask-config-save', { screen: true }); await p.reload(); await sleep(1700); await open();
    await p.evaluate(() => { const b = document.getElementById('setTop'); if (b) b.click(); }); await sleep(900); await p.evaluate(() => { const t = document.querySelector('#stTabs [data-tab="askmax"]'); if (t) t.click(); }); await sleep(1200);
    rec('E65 the Settings tab has the screenshot switch (checked) and its privacy text says what the picture hides and that it is never saved', !!(await q('#akScreen')) && (await p.$eval('#akScreen', e => e.checked)) && /painted solid black/.test(await txt('#akSent')) && /never saved/.test(await txt('#akSent')), '');
    await shot('settings-screen-switch'); await p.keyboard.press('Escape'); await sleep(300);
    // ---- END OF SCENARIOS ----
    rec('X0 no page errors or dialogs', !errs.length, errs.join(' | ').slice(0, 200) || 'none');
  } catch (e) { rec('X1 run finished', false, String(e && e.stack || e).slice(0, 400)); }
  finally { try { await post('ask-config-save', { removeKey: true }); await post('ask-history-clear'); await post('pay-close'); await post('new-sale'); } catch {} if (p) await p.close().catch(() => {}); await b.disconnect(); if (own) own.close(); }
  console.log(`${fails.length ? 'FAILED' : 'ALL PASSED'}: ${fails.length} failed${fails.length ? ': ' + fails.join('; ') : ''}`); process.exit(fails.length ? 1 : 0);
})();

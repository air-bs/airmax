// Store request #21 (Nov 2): a note saved on the customer account pops up as soon as the customer is on the sale; a customer with no note
// gets no pop-up; the note never reaches the customer-facing display; the sale stays as it was. OFFLINE fake AIR POS started with
// FAKE_MEMBER_NOTE=1 (Sample Customer 5550100 has the note; Zero Balance has none).
'use strict';
const puppeteer = require('puppeteer-core');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP;
const LOGF = process.env.FAKE_LOG || '/tmp/req21-fake.log';
const NOTE = 'Account locked - needs approval from the owner <b>before</b> any sale';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const get = r => fetch(BASE + '/api/' + r).then(r => r.json());
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1280, height: 800 } });
  try {
    if (!(await get('state')).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'x' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach');
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1500);
    const modalText = () => p.evaluate(() => { const m = document.querySelector('#modalRoot .modal'); return m ? m.innerText : null; });
    await post('scan', { code: '1001' });
    const items0 = JSON.stringify((await get('state')).cart.map(l => l.name + l.quantity)), tot0 = JSON.stringify((await get('state')).totals);
    let st = await get('state');
    rec('N1 no customer on the sale: state has no note, no window', !st.memberNote && !(await modalText()), JSON.stringify(st.memberNote));
    await post('member-attach', { number: '5550100' }); await p.evaluate(() => refresh()); await sleep(2000);
    const mt = await modalText(); st = await get('state');
    rec('N2 customer with a note attached: the "Customer note" window opens by itself with the name and the note', !!mt && /Customer note/.test(mt) && /Sample Customer/.test(mt) && mt.includes('Account locked - needs approval from the owner'), JSON.stringify(mt && mt.slice(0, 120)));
    const html = await p.evaluate(() => (document.querySelector('#cnText') || {}).innerHTML || '');
    rec('N3 the note is shown as plain text (HTML in the note is not run)', /&lt;b&gt;before&lt;\/b&gt;/.test(html) && !(await p.$('#cnText b')), html.slice(0, 140));
    rec('N4 the sale behind it is unchanged (same items and totals; the customer is attached)', JSON.stringify(st.cart.map(l => l.name + l.quantity)) === items0 && !!st.member, `${items0}`);
    const cs = JSON.stringify(await get('customer-state'));
    rec('N5 the customer-facing display never gets the note', !cs.includes('Account locked') && !cs.includes('approval'), 'customer-state checked');
    await p.keyboard.press('Enter'); await sleep(500);
    rec('N6 Enter closes the window; it does not open again while this customer stays on the sale', !(await modalText()), 'closed');
    await sleep(2500); rec('N7 still not shown again after more screen refreshes', !(await modalText()), '');
    await post('member-detach'); await p.evaluate(() => refresh()); await sleep(800); await post('member-attach', { number: '5550100' }); await p.evaluate(() => refresh()); await sleep(2000);
    rec('N8 customer removed and added again: the note shows again', /Customer note/.test((await modalText()) || ''), '');
    await p.keyboard.press('Escape'); await sleep(500);
    rec('N9 Esc closes it too', !(await modalText()), '');
    await post('member-detach'); await sleep(800);
    const noNote = await post('member-attach', { number: '5559876543' }); await sleep(2000); await p.evaluate(() => refresh()); await sleep(2000);
    await post('member-detach'); await p.evaluate(() => refresh());
    rec('N10 a customer with no saved note gets no note window', !(await modalText()), noNote.message || '');
    const logs = require('fs').existsSync(LOGF) ? require('fs').readFileSync(LOGF, 'utf8') : '';
    rec('N11 the note text is not in the server log', !logs.includes('Account locked'), 'log checked (' + logs.length + ' bytes)');
    rec('N12 no page errors', errs.length === 0, errs.join('; ') || 'none');
    await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

// AirMax Extra 12 (customer Discount, top strip of the Credit box): server routes cust-discount-get / cust-discount-save (manager only), on the FAKE AIR POS only.
// Starts its OWN fake AIR POS (offline, made-up data; the real app/api/credit-discount.js is loaded). No real AIR POS, no live store, no real customer data.
//   node tests/api-12-credit-limit.test.js     (port: API12_PORT, default 5322, hook port +1)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PORT = Number(process.env.API12_PORT || 5322), HOOK = PORT + 1, BASE = 'http://127.0.0.1:' + PORT, HB = 'http://127.0.0.1:' + HOOK;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api12-'));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(async r => ({ status: r.status, j: await r.json() }));
const hook = (p) => fetch(HB + p).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ID = 'm-edit2', KEYS = ['id', 'number', 'mobile', 'phone', 'firstName', 'middleName', 'lastName', 'company', 'email', 'receiveAutoEmail', 'province', 'city', 'address', 'zipCode', 'discount', 'remark', 'status', 'creditAmount', 'allowCreditPayment'];
(async () => {
  const log = path.join(T, 'srv.log');
  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: String(HOOK), AIRREG_DATA: T }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/shortcuts'); await hook('/disc-state'); break; } catch (e) { await sleep(250); } }
    const L = () => fs.readFileSync(log, 'utf8');
    const relog = async mode => { await fetch(HB + '/cust-role?mode=' + mode); await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' }); };
    const S = () => hook('/disc-state?id=' + ID), seed = (d) => hook('/disc-seed?id=' + ID + '&discount=' + d);
    rec('1 the discount plugin loads with its 2 routes', /API plugins:[^\n]*credit-discount\.js \(2 routes\)/.test(L()), (L().match(/API plugin[^\n]*/g) || []).join(' || ').slice(0, 200));
    const nl = await post('cust-discount-get', { retailMemberId: ID }), nl2 = await post('cust-discount-save', { retailMemberId: ID, discount: 5, confirmed: true });
    rec('2 logged out: both routes answer "not logged in"; nothing is saved', nl.j.ok === false && nl.j.loggedOut === true && nl2.j.ok === false && (await S()).saves === 0, JSON.stringify([nl.j, nl2.j]).slice(0, 160));
    // ---------- manager
    await hook('/cust-reset'); await hook('/disc-reset'); await relog('manager'); await seed(10); await fetch(HB + '/cust-credit-seed?id=' + ID + '&allow=0&amount=0&shopAllow=1&shopAmount=100');
    const g1 = await post('cust-discount-get', { retailMemberId: ID }), g2 = await post('cust-discount-get', {}), g3 = await post('cust-discount-get', { retailMemberId: '../x; drop' });
    rec('3 manager: get shows the customer\'s Discount (10); no / a bad customer id is refused', g1.j.ok === true && g1.j.discount === 10 && g2.j.ok === false && g3.j.ok === false, JSON.stringify([g1.j, g2.j, g3.j]).slice(0, 200));
    const badVals = ['', ' ', '   ', '-1', -1, '-0.5', '100.01', 100.01, '101', 101, 1000, 'abc', '10%', '1e1', '1,5', '1.234', 1.234, '.5', '10.', '0x10', 'NaN', 'Infinity', NaN, Infinity, null, undefined, true, {}, [], [5]];
    const br = await Promise.all(badVals.map(v => post('cust-discount-save', { retailMemberId: ID, discount: v, confirmed: true })));
    const sb = await S();
    rec('4 save: blank, negative, over 100, text, too many decimals, exponent, NaN, Infinity, null, objects are ALL refused with a message; AIR POS is not called', br.every(x => x.j.ok === false && x.j.message && !x.j.needsConfirm) && sb.saves === 0, 'refused ' + br.filter(x => x.j.ok === false).length + '/' + badVals.length + ', saves ' + sb.saves);
    const nc = await Promise.all([post('cust-discount-save', { retailMemberId: ID, discount: 15 }), post('cust-discount-save', { retailMemberId: ID, discount: 15, confirmed: 'true' }), post('cust-discount-save', { retailMemberId: ID, discount: 15, confirmed: 1 })]);
    rec('5 save without confirmed:true (missing / "true" / 1) is refused (needsConfirm) and AIR POS is not called', nc.every(x => x.j.needsConfirm === true && x.j.ok === false) && (await S()).saves === 0, JSON.stringify(nc.map(x => x.j)).slice(0, 160));
    const ok1 = await post('cust-discount-save', { retailMemberId: ID, discount: '15', confirmed: true }), s1 = await S();
    rec('6 save with confirmed:true: no manager password needed (a logged-in manager); AIR POS gets ONE update; the reply is read back from AIR POS (15)', ok1.j.ok === true && !ok1.j.needManager && ok1.j.discount === 15 && ok1.j.readBack === true && s1.saves === 1 && s1.rec.discount === 15, JSON.stringify(ok1.j));
    const same = Object.keys(s1.last).length === KEYS.length && KEYS.every(k => k in s1.last);
    const CR = ['creditAmount', 'allowCreditPayment'];                                                  // the credit pair lives in Batch 5's seeded store, checked next to the others below
    const others = KEYS.filter(k => k !== 'discount' && !CR.includes(k) && JSON.stringify(s1.last[k]) !== JSON.stringify(s1.before[k]));
    rec('7 round trip: the whole record (19 fields) went to AIR POS and EVERY field except discount equals what the fresh read gave', same && others.length === 0 && s1.last.creditAmount === 0 && s1.last.allowCreditPayment === false && s1.last.discount === 15 && s1.before.discount === 10 && s1.last.middleName === 'Q' && s1.last.remark === 'made-up remark' && s1.last.company === 'Made Up Co', 'differing: ' + JSON.stringify(others) + '; keys ' + Object.keys(s1.last).length);
    const afterOthers = KEYS.filter(k => k !== 'discount' && !CR.includes(k) && JSON.stringify(s1.rec[k]) !== JSON.stringify(s1.before[k]));
    rec('8 and the stored record afterwards: only discount changed (15), all the others are as before', afterOthers.length === 0 && s1.rec.discount === 15, JSON.stringify(afterOthers));
    rec('9 saving the SAME discount (15 to 15) is refused ("nothing to save") and AIR POS is not called again', (await post('cust-discount-save', { retailMemberId: ID, discount: 15, confirmed: true })).j.ok === false && (await S()).saves === s1.saves, '');
    // fresh read right before the save: another till changes the customer's phone-side fields after our get; the save carries the new value
    await hook('/disc-reset'); await seed(15);
    const gg = await post('cust-discount-get', { retailMemberId: ID });
    await fetch(HB + '/cust-credit-seed?id=' + ID + '&allow=1&amount=77&shopAllow=0&shopAmount=0');          // someone else changes this customer's credit after our get
    const fr2 = await post('cust-discount-save', { retailMemberId: ID, discount: 20, confirmed: true }), s2 = await S();
    rec('10 fresh read before the save: a credit change made after our get is carried as it NOW is (Allow on, 77), not an old copy', gg.j.discount === 15 && fr2.j.ok && s2.last.allowCreditPayment === true && s2.last.creditAmount === 77 && s2.last.discount === 20, JSON.stringify({ allow: s2.last && s2.last.allowCreditPayment, amt: s2.last && s2.last.creditAmount }));
    // points per shop: the credit pair goes back as the SHOP values (what the credit editor edits), the corp pair is not pushed over it
    await hook('/cust-reset'); await hook('/disc-reset'); await fetch(HB + '/cust-shop?on=1'); await relog('manager'); await seed(5);
    await fetch(HB + '/cust-credit-seed?id=' + ID + '&allow=0&amount=5&shopAllow=1&shopAmount=100');
    const ps = await post('cust-discount-save', { retailMemberId: ID, discount: 7.5, confirmed: true }), s3 = await S(), cg = await post('cust-credit-get', { retailMemberId: ID });
    rec('11 points per shop: the credit pair sent is the shop one (Allow on, 100); reading the credit back still shows Allow on, 100.00 (discount 7.5 saved)', ps.j.ok && ps.j.discount === 7.5 && s3.last.allowCreditPayment === true && s3.last.creditAmount === 100 && cg.j.allow === true && cg.j.amount === 100 && cg.j.pointByShop === true, JSON.stringify({ ps: ps.j, cg: cg.j }).slice(0, 220));
    // AIR POS refuses
    await hook('/cust-reset'); await hook('/disc-reset'); await relog('manager'); await seed(5);
    const l0 = (L().match(/discount changed/g) || []).length;
    await fetch(HB + '/disc-fail?mode=error&n=1'); const fe = await post('cust-discount-save', { retailMemberId: ID, discount: 9, confirmed: true }), s4 = await S();
    rec('12 AIR POS refuses the save: the reply says so, nothing is logged as changed, the stored discount is unchanged (5)', fe.j.ok === false && /could not be saved/i.test(fe.j.message) && s4.rec.discount === 5 && (L().match(/discount changed/g) || []).length === l0, JSON.stringify(fe.j));
    await fetch(HB + '/disc-fail?mode=silent&n=1'); const fs2 = await post('cust-discount-save', { retailMemberId: ID, discount: 9, confirmed: true });
    rec('13 AIR POS answers "saved" but keeps the old value: the read-back catches it (ok false, discount 5 shown)', fs2.j.ok === false && fs2.j.discount === 5 && /now shows 5%/.test(fs2.j.message), JSON.stringify(fs2.j));
    // once: two saves at the same moment -> one runs, the other is told to wait
    await hook('/disc-reset'); await seed(5); await hook('/disc-slow?ms=400');
    const pp = await Promise.all([post('cust-discount-save', { retailMemberId: ID, discount: 20, confirmed: true }), post('cust-discount-save', { retailMemberId: ID, discount: 25, confirmed: true })]), s5 = await S(); await hook('/disc-slow?ms=0');
    rec('14 once-only: two saves at the same moment -> AIR POS gets exactly ONE update, the other is told "still working" (busy)', s5.saves === 1 && pp.filter(x => x.j.ok).length === 1 && pp.filter(x => x.j.busy).length === 1, JSON.stringify(pp.map(x => x.j)).slice(0, 220));
    const z = await post('cust-discount-save', { retailMemberId: ID, discount: 0, confirmed: true }), s6 = await S();
    rec('15 a discount of 0 (turn it off) and 100 are accepted values', z.j.ok === true && s6.rec.discount === 0 && (await post('cust-discount-save', { retailMemberId: ID, discount: '100', confirmed: true })).j.discount === 100, JSON.stringify(z.j));
    // ---------- cashier and no menu
    await hook('/cust-reset'); await hook('/disc-reset'); await relog('cashier'); await seed(10);
    const ck = await Promise.all([post('cust-discount-get', { retailMemberId: ID }), post('cust-discount-save', { retailMemberId: ID, discount: 50, confirmed: true }), post('cust-discount-save', { retailMemberId: ID, discount: 50, confirmed: true, user: 'boss', password: 'boss-pw' })]), sk = await S();
    rec('16 a cashier: get and save (even with a manager name + password in the call) answer "forbidden"; AIR POS is never asked; the discount stays 10', ck.every(x => x.j.ok === false && x.j.forbidden === true) && sk.saves === 0 && sk.rec.discount === 10, JSON.stringify(ck.map(x => x.j)).slice(0, 220));
    await relog('nomenu'); const nm = await Promise.all([post('cust-discount-get', { retailMemberId: ID }), post('cust-discount-save', { retailMemberId: ID, discount: 50, confirmed: true })]), sn = await S();
    rec('17 a manager WITHOUT the Member Management menu: both routes answer "forbidden"; nothing is saved', nm.every(x => x.j.ok === false && x.j.forbidden === true) && sn.saves === 0, JSON.stringify(nm.map(x => x.j)).slice(0, 160));
    await hook('/cust-reset'); await relog('super');
    // ---------- log
    const text = L(), lines = text.split('\n').filter(x => /discount changed/.test(x));
    rec('18 the log: only "discount changed (member <id>)" lines; no name, no value, no amount, nothing else of the customer', lines.length >= 5 && lines.every(x => /customers: discount changed \(member m-edit2\)\s*$/.test(x)) && !/Dana|Sample|Made Up|made-up remark|555-000|Testville|1 Fake St/.test(text), 'lines ' + lines.length + ': ' + (lines[0] || '').slice(0, 120));
    rec('19 the fake saw no malformed AIR POS call (every update carried all 19 fields)', (await S()).bad.length === 0, JSON.stringify((await S()).bad));
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 400)); }
  finally { srv.kill(); fs.rmSync(T, { recursive: true, force: true }); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

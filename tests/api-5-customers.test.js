// AirMax Batch 5 (Customers: files, history, manager credit): server routes cust-files-list (83), cust-file-upload (31), cust-file-attach (84), cust-file-add (31+84), cust-file-remove (85),
// cust-tx-list (80), cust-bal-list (81), cust-pts-list (82), cust-credit-get / cust-credit-save (manager only).
// Starts its OWN fake AIR POS (offline, made-up data; the real app/api/customers.js is loaded). No real AIR POS, no live store, no real customer data.
//   node tests/api-5-customers.test.js     (port: API5_PORT, default 5258, hook port +1)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PORT = Number(process.env.API5_PORT || 5258), HOOK = PORT + 1, BASE = 'http://127.0.0.1:' + PORT, HB = 'http://127.0.0.1:' + HOOK;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api5-'));
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(async r => ({ status: r.status, j: await r.json() }));
const hook = (p) => fetch(HB + p).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = s => Buffer.from(s).toString('base64');
(async () => {
  const log = path.join(T, 'srv.log');
  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env: { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: String(HOOK), AIRREG_DATA: T }, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/shortcuts'); await hook('/cust-state'); break; } catch (e) { await sleep(250); } }
    const L = () => fs.readFileSync(log, 'utf8');
    rec('1 the customers plugin loads with its 10 routes', /API plugins:[^\n]*customers\.js \(10 routes\)/.test(L()), (L().match(/API plugin[^\n]*/g) || []).join(' || ').slice(0, 200));
    const nl = await post('cust-files-list', { retailMemberId: 'm-edit2' });
    rec('2 logged out: the files list answers "not logged in", not files', nl.j.ok === false && nl.j.loggedOut === true, JSON.stringify(nl.j).slice(0, 100));
    await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    // ---- 83 read
    const l1 = await post('cust-files-list', { retailMemberId: 'm-edit2' });
    rec('3 83 list: the 2 made-up files come back as { id, name, path, extension } (bare array reply handled)', l1.j.ok && l1.j.rows.length === 2 && l1.j.rows.every(f => f.id && f.name && f.path && f.extension) && l1.j.rows[0].name === 'sample-photo.png', JSON.stringify(l1.j).slice(0, 160));
    const l2 = await post('cust-files-list', { retailMemberId: 'm-edit1' });
    rec('4 83 list: a customer with no files = empty list, ok', l2.j.ok === true && Array.isArray(l2.j.rows) && l2.j.rows.length === 0, JSON.stringify(l2.j));
    const l3 = await post('cust-files-list', {}), l4 = await post('cust-files-list', { retailMemberId: '../x; drop' });
    const st0 = await hook('/cust-state');
    rec('5 83 list: no customer / a bad id is refused here, AIR POS is not asked', l3.j.ok === false && l4.j.ok === false && st0.listCalls === 2, JSON.stringify({ listCalls: st0.listCalls }));
    // ---- 31 upload only
    const u1 = await post('cust-file-upload', { files: [{ name: 'one.txt', data: b64('hello made-up file') }] });
    const st1 = await hook('/cust-state');
    rec('6 31 upload: a multipart POST with field "files" and the session header reaches baseserv; the stored path + extension come back', u1.j.ok && u1.j.files.length === 1 && u1.j.files[0].path && u1.j.files[0].extension === '.txt' && st1.uploads === 1 && st1.lastUploadNames[0] === 'one.txt' && st1.bad.length === 0, JSON.stringify({ r: u1.j, bad: st1.bad }).slice(0, 220));
    rec('7 31 upload alone links nothing to a customer (no Add call)', st1.adds === 0 && st1.files['m-edit1'] === undefined, JSON.stringify(st1.files));
    // ---- 84 attach
    const a1 = await post('cust-file-attach', { retailMemberId: 'm-edit1', files: u1.j.files });
    const l5 = await post('cust-files-list', { retailMemberId: 'm-edit1' });
    const st2 = await hook('/cust-state');
    rec('8 84 attach: the uploaded file is linked (new GUID id, name, path, extension as AIR POS sends) and shows in the list', a1.j.ok && a1.j.attached === 1 && l5.j.rows.length === 1 && l5.j.rows[0].name === 'one.txt' && st2.adds === 1 && st2.bad.length === 0, JSON.stringify({ a: a1.j, rows: l5.j.rows.length, bad: st2.bad }));
    const a2 = await post('cust-file-attach', { retailMemberId: 'm-edit1', files: [{ name: 'ghost.txt', path: 'never/uploaded.txt', extension: '.txt' }] });
    const a3 = await post('cust-file-attach', { retailMemberId: 'm-edit1', files: [{ name: 'x.txt', path: '../../etc/passwd', extension: '.txt' }] }), a4 = await post('cust-file-attach', { retailMemberId: 'm-edit1', files: [] });
    rec('9 84 attach: a path AIR POS never stored is refused by AIR POS (shown); "..", an empty list are refused here', a2.j.ok === false && /Bad file entry/.test(a2.j.message) && a3.j.ok === false && a4.j.ok === false, JSON.stringify([a2.j.message, a3.j.message, a4.j.message]));
    // ---- 31 + 84
    const ad = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'a.pdf', data: b64('%PDF fake a') }, { name: '../evil/a:b?.PNG', data: b64('png-ish') }] });
    const l6 = await post('cust-files-list', { retailMemberId: 'm-new1' }), st3 = await hook('/cust-state');
    rec('10 31+84 in one go: two files uploaded and attached; unsafe characters in a name become "_" and a leading dot is dropped', ad.j.ok && ad.j.attached === 2 && l6.j.rows.length === 2 && l6.j.rows[0].name === 'a.pdf' && l6.j.rows[1].name === '_evil_a_b_.PNG' && l6.j.rows[1].extension.toLowerCase().replace('.', '') === 'png' && st3.bad.length === 0, JSON.stringify({ ad: ad.j, names: l6.j.rows.map(r => r.name) }));
    // ---- refusals (nothing sent to AIR POS)
    const before = await hook('/cust-state');
    const big = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'big.bin', data: Buffer.alloc(660 * 1024, 1).toString('base64') }] });
    const many = await post('cust-file-add', { retailMemberId: 'm-new1', files: Array.from({ length: 11 }, (_, i) => ({ name: 'f' + i + '.txt', data: b64('x') })) });
    const none = await post('cust-file-add', { retailMemberId: 'm-new1', files: [] }), badb = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'x.txt', data: '***not base64***' }] });
    const emp = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'x.txt', data: '' }] }), nonm = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: '', data: b64('x') }] }), noc = await post('cust-file-add', { files: [{ name: 'x.txt', data: b64('x') }] });
    const after = await hook('/cust-state');
    rec('11 too big / 11 files / none / bad base64 / empty / no name / no customer: all refused with a message, nothing sent to AIR POS', [big, many, none, badb, emp, nonm, noc].every(x => x.j.ok === false && x.j.message) && after.uploads === before.uploads && after.adds === before.adds, JSON.stringify([big, many, none, badb, emp, nonm, noc].map(x => x.j.message)));
    // ---- 85 remove
    const id0 = l5.j.rows[0].id;
    const r0 = await post('cust-file-remove', { retailMemberId: 'm-edit1', attachmentId: id0 }), r0b = await post('cust-file-remove', { retailMemberId: 'm-edit1', attachmentId: id0, confirmed: 'yes' });
    const st4 = await hook('/cust-state');
    rec('12 85 remove without confirmed:true is refused (needsConfirm) and AIR POS is not called', r0.j.ok === false && r0.j.needsConfirm === true && r0b.j.needsConfirm === true && st4.deletes === 0, JSON.stringify([r0.j, st4.deletes]));
    const r1 = await post('cust-file-remove', { retailMemberId: 'm-edit1', attachmentId: id0, confirmed: true }), l7 = await post('cust-files-list', { retailMemberId: 'm-edit1' });
    rec('13 85 remove with confirmed:true deletes exactly that file (list now empty, AIR POS message passed on)', r1.j.ok && /Removed/.test(r1.j.message) && l7.j.rows.length === 0, JSON.stringify([r1.j, l7.j.rows.length]));
    const r2 = await post('cust-file-remove', { retailMemberId: 'm-edit1', attachmentId: id0, confirmed: true }), r3 = await post('cust-file-remove', { retailMemberId: 'm-edit1', confirmed: true });
    rec('14 85 remove: an unknown file = AIR POS refusal shown; a missing id is refused here', r2.j.ok === false && /not found/i.test(r2.j.message) && r3.j.ok === false, JSON.stringify([r2.j.message, r3.j.message]));
    // ---- failures
    await hook('/cust-reset');
    await fetch(HB + '/cust-fail?op=upload&n=1&mode=error'); const f1 = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'x.txt', data: b64('x') }] }); const s5 = await hook('/cust-state');
    rec('15 upload refused by AIR POS: ok false with its message, no attach call', f1.j.ok === false && /Upload failed/.test(f1.j.message) && s5.adds === 0 && s5.uploads === 1, JSON.stringify([f1.j, s5.adds]));
    await fetch(HB + '/cust-fail?op=upload&n=1&mode=http500'); const f2 = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'x.txt', data: b64('x') }] });
    rec('16 upload HTTP 500: ok false, flagged uncertain, no attach call', f2.j.ok === false && f2.j.uncertain === true && (await hook('/cust-state')).adds === 0, JSON.stringify(f2.j));
    await fetch(HB + '/cust-fail?op=add&n=1&mode=error'); const f3 = await post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'x.txt', data: b64('x') }] });
    rec('17 uploaded but the link fails: ok false, message says "Uploaded, but could not attach", uploaded:true, never retried on its own', f3.j.ok === false && f3.j.uploaded === true && /^Uploaded, but could not attach/.test(f3.j.message) && (await hook('/cust-state')).adds === 1, JSON.stringify(f3.j));
    await fetch(HB + '/cust-fail?op=delete&n=1&mode=error'); const f4 = await post('cust-file-remove', { retailMemberId: 'm-edit2', attachmentId: 'att-1', confirmed: true }), l8 = await post('cust-files-list', { retailMemberId: 'm-edit2' });
    rec('18 remove refused by AIR POS: ok false, the file is still listed', f4.j.ok === false && l8.j.rows.some(r => r.id === 'att-1'), JSON.stringify(f4.j));
    // ---- once
    await hook('/cust-reset'); await hook('/cust-slow?ms=500');
    const two = await Promise.all([post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'p.txt', data: b64('p') }] }), post('cust-file-add', { retailMemberId: 'm-new1', files: [{ name: 'q.txt', data: b64('q') }] })]);
    rec('19 two uploads started at once: the second is answered busy (never both)', two.some(x => x.j.busy === true) && two.some(x => x.j.ok === true), JSON.stringify(two.map(x => x.j.busy ? 'busy' : x.j.ok)));
    // ---- no private data in the log, other routes untouched
    const text = L();
    rec('20 the server log holds counts and outcomes only: no file name, no file content, no customer id of a file call', !/sample-photo|agreement\.pdf|one\.txt|a\.pdf|evil|p\.txt|q\.txt|hello made-up/.test(text) && /\/Files\/FileMultipleUpload \(\d file\(s\)\) -> 200 ok/.test(text), (text.match(/[^\n]*FileMultipleUpload[^\n]*/g) || []).slice(0, 2).join(' || '));
    const fin = await hook('/cust-state');
    rec('21 the fake saw no malformed call (every upload / add / delete was shaped like AIR POS 1.9.11 sends it)', fin.bad.length === 0, JSON.stringify(fin.bad));
    rec('22 built-in routes untouched (state answers) and the section file is listed in /api/sections', (await fetch(BASE + '/api/state').then(r => r.json())).loggedIn === true && (await fetch(BASE + '/api/sections').then(r => r.json())).files.includes('customers.js'), '');

    // ================= 80 / 81 / 82 history =================
    await hook('/cust-reset');
    const H = () => hook('/cust-hist');
    const t1 = await post('cust-tx-list', { retailMemberId: 'm-edit2' }), h1 = await H();
    rec('23 80 transactions: page 1 = 20 rows, 34 in total (Only Balance Affected ON by default, like AIR POS); mapped to number/type/time/payments/amounts/balance', t1.j.ok && t1.j.rows.length === 20 && t1.j.total === 34 && t1.j.page === 1 && t1.j.rows.every(r => r.number && r.typeName && r.time && r.payments.length === 1 && typeof r.amount === 'number' && typeof r.balanceAffected === 'number' && r.balanceAffected !== 0), JSON.stringify({ n: t1.j.rows && t1.j.rows.length, total: t1.j.total, first: t1.j.rows && t1.j.rows[0] }).slice(0, 300));
    rec('24 80: AIR POS gets filter + pageInfo as two JSON texts, exactly the keys its drawer sends', JSON.stringify(Object.keys(h1.last.tx.filter).sort()) === JSON.stringify(['beginDate', 'endDate', 'onlyBalanceAffected', 'retailMemberId', 'transactionType']) && h1.last.tx.filter.onlyBalanceAffected === true && JSON.stringify(h1.last.tx.pageInfo) === JSON.stringify({ page: 1, pageSize: 20, amount: 0 }), JSON.stringify(h1.last.tx));
    const t2 = await post('cust-tx-list', { retailMemberId: 'm-edit2', page: 2 }), t3 = await post('cust-tx-list', { retailMemberId: 'm-edit2', onlyBalanceAffected: false }), t4 = await post('cust-tx-list', { retailMemberId: 'm-edit2', transactionType: 20, onlyBalanceAffected: false }), t5 = await post('cust-tx-list', { retailMemberId: 'm-edit1' });
    rec('25 80: page 2 = 14 rows; Only Balance Affected off = 45; type filter Recharge = only Recharge rows; a customer with none = empty list', t2.j.rows.length === 14 && t2.j.page === 2 && t3.j.total === 45 && t4.j.rows.length > 0 && t4.j.rows.every(r => r.type === 20) && t4.j.total === 15 && t5.j.ok && t5.j.rows.length === 0 && t5.j.total === 0, JSON.stringify([t2.j.rows.length, t3.j.total, t4.j.total, t5.j.total]));
    const d1 = await post('cust-tx-list', { retailMemberId: 'm-edit2', onlyBalanceAffected: false, beginDate: '2026-10-05', endDate: '2026-10-10' }), h2 = await H();
    rec('26 80: dates (YYYY-MM-DD) go to AIR POS as local-midnight ISO text like its date picker; the list narrows', d1.j.ok && d1.j.total < 45 && d1.j.total > 0 && h2.last.tx.filter.beginDate === new Date(2026, 9, 5).toISOString() && h2.last.tx.filter.endDate === new Date(2026, 9, 10).toISOString(), JSON.stringify([d1.j.total, h2.last.tx.filter.beginDate]));
    const cb = await H(); const bads = await Promise.all([post('cust-tx-list', { retailMemberId: 'm-edit2', beginDate: '10/05/2026' }), post('cust-tx-list', { retailMemberId: 'm-edit2', endDate: '2026-02-31' }), post('cust-tx-list', { retailMemberId: 'm-edit2', transactionType: 99 }), post('cust-tx-list', {}), post('cust-bal-list', { retailMemberId: 'm-edit2', type: 5 }), post('cust-pts-list', { retailMemberId: 'm-edit2', status: 9 }), post('cust-pts-list', { retailMemberId: 'm-edit2', type: 'x' }), post('cust-bal-list', { retailMemberId: 'm-edit2', targetNumber: 'x'.repeat(60) })]), ca = await H();
    rec('27 80/81/82: a bad date / type / status / number / no customer is refused here with a message; AIR POS is not asked', bads.every(x => x.j.ok === false && x.j.message) && JSON.stringify(ca.calls) === JSON.stringify(cb.calls), JSON.stringify(bads.map(x => x.j.message)));
    await post('cust-tx-list', { retailMemberId: 'm-edit2', pageSize: 5000, page: -4 }); const pc = await H();
    rec('28 page size is capped at 100 and a page below 1 becomes 1', pc.last.tx.pageInfo.pageSize === 100 && pc.last.tx.pageInfo.page === 1, JSON.stringify(pc.last.tx.pageInfo));
    const b1 = await post('cust-bal-list', { retailMemberId: 'm-edit2' }), b2 = await post('cust-bal-list', { retailMemberId: 'm-edit2', type: 10 }), b3 = await post('cust-bal-list', { retailMemberId: 'm-edit2', targetNumber: '100299' }), hb = await H();
    rec('29 81 account balance: 6 records mapped (target, type, amount, time); Expense filter = 2; Order NO. search = 1; filter keys as AIR POS sends', b1.j.ok && b1.j.rows.length === 6 && b1.j.rows.every(r => r.target && r.typeName && typeof r.amount === 'number' && r.time) && b2.j.rows.length === 2 && b2.j.rows.every(r => r.type === 10) && b3.j.rows.length === 1 && JSON.stringify(Object.keys(hb.last.bal.filter).sort()) === JSON.stringify(['retailMemberId', 'status', 'targetNumber', 'type']), JSON.stringify([b1.j.rows.length, b2.j.rows.length, b3.j.rows.length, Object.keys(hb.last.bal.filter)]));
    const p1 = await post('cust-pts-list', { retailMemberId: 'm-edit2' }), p2 = await post('cust-pts-list', { retailMemberId: 'm-edit2', status: 3 }), p3 = await post('cust-pts-list', { retailMemberId: 'm-edit2', type: 3 }), hp = await H();
    rec('30 82 point records: 5 records mapped (target, type, status, points, used points, created, expires); Used filter and type filter narrow; filter keys as AIR POS sends', p1.j.ok && p1.j.rows.length === 5 && p1.j.rows.every(r => r.target && r.typeName && r.statusName && typeof r.points === 'number' && typeof r.usedPoints === 'number' && r.time && r.expires) && p2.j.rows.length > 0 && p2.j.rows.every(r => r.status === 3) && p3.j.rows.every(r => r.type === 3) && JSON.stringify(Object.keys(hp.last.pts.filter).sort()) === JSON.stringify(['retailMemberId', 'status', 'targetNumber', 'type']), JSON.stringify([p1.j.rows.length, p2.j.rows.length, p3.j.rows.length]));
    await fetch(HB + '/cust-fail?op=tx&n=1'); const tf = await post('cust-tx-list', { retailMemberId: 'm-edit2' });
    rec('31 AIR POS refuses the read: ok false with its message', tf.j.ok === false && /not available/.test(tf.j.message), JSON.stringify(tf.j));
    const sh0 = (await post('cust-tx-list', { retailMemberId: 'm-edit2' })).j;
    await fetch(HB + '/cust-shop?on=1'); await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
    const sh1 = (await post('cust-tx-list', { retailMemberId: 'm-edit2' })).j;
    rec('32 Balance column follows the store setting: the corp snapshot (100) normally, the shop snapshot (40) when points are kept per shop', sh0.pointByShop === false && sh0.rows[0].balance === 100 && sh1.pointByShop === true && sh1.rows[0].balance === 40, JSON.stringify([sh0.pointByShop, sh0.rows[0].balance, sh1.pointByShop, sh1.rows[0].balance]));

    // ================= manager credit editor =================
    const relog = async mode => { await fetch(HB + '/cust-role?mode=' + mode); await post('logout'); await post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' }); };
    await hook('/cust-reset'); await relog('manager');
    await fetch(HB + '/cust-credit-seed?id=m-edit2&allow=0&amount=0&shopAllow=1&shopAmount=100');
    const pm = await post('perms');
    const c1 = await post('cust-credit-get', { retailMemberId: 'm-edit2' });
    rec('33 manager (RetailManager + Member Management): credit-get shows Allow off, Credit Amount 0 and the store credit balance 12.50 (corp values, points not per shop)', pm.j.manager === true && c1.j.ok && c1.j.allow === false && c1.j.amount === 0 && c1.j.balance === 12.5 && c1.j.pointByShop === false, JSON.stringify(c1.j));
    const n0 = await post('cust-credit-save', { retailMemberId: 'm-edit2', allow: true, amount: 250 }), n1 = await post('cust-credit-save', { retailMemberId: 'm-edit2', allow: true, amount: 250, confirmed: 'yes' }), hc0 = await H();
    rec('34 credit-save without confirmed:true is refused (needsConfirm) and AIR POS is not called', n0.j.needsConfirm === true && n1.j.needsConfirm === true && hc0.creditSaves === 0, JSON.stringify([n0.j, hc0.creditSaves]));
    const pw0 = await post('cust-credit-save', { retailMemberId: 'm-edit2', allow: true, amount: 250, confirmed: true }), hpw = await H();
    rec('34b a logged-in manager (RetailManager) is NOT asked for the manager password again: confirmed:true alone saves (no needManager), AIR POS gets the save once', pw0.j.ok === true && !pw0.j.needManager && hpw.creditSaves === 1 && hpw.lastCredit.allow === true && hpw.lastCredit.amount === 250, JSON.stringify([pw0.j, hpw.creditSaves]));
    const badAmt = await Promise.all([{ allow: true, amount: -1 }, { allow: true, amount: 'abc' }, { allow: true, amount: 1.234 }, { allow: true, amount: 1e12 }, { allow: 'yes', amount: 5 }, { allow: true }].map(x => post('cust-credit-save', { retailMemberId: 'm-edit2', confirmed: true, ...x }))), hc1 = await H();
    rec('35 credit-save: negative, text, 3 decimals, huge, allow not true/false, no amount are all refused here; AIR POS is not called', badAmt.every(x => x.j.ok === false && x.j.message) && hc1.creditSaves === 1, JSON.stringify(badAmt.map(x => x.j.message)));
    const s1 = await post('cust-credit-save', { retailMemberId: 'm-edit2', allow: true, amount: 250, confirmed: true, user: 'boss', password: 'boss-pw' }), hc2 = await H(), c2 = await post('cust-credit-get', { retailMemberId: 'm-edit2' });
    rec('36 credit-save with confirmed:true: AIR POS gets the WHOLE customer record (19 fields) with only the credit pair changed; reading back shows Allow on, 250.00; the store credit balance did not move', s1.j.ok && hc2.creditSaves === 2 && hc2.lastCredit.allow === true && hc2.lastCredit.amount === 250 && hc2.lastCredit.keys === 19 && hc2.lastCredit.other === 'Dana|Sample|dana@example.com' && c2.j.allow === true && c2.j.amount === 250 && c2.j.balance === 12.5 && hc2.bad.length === 0, JSON.stringify([s1.j, hc2.lastCredit, c2.j]));
    await fetch(HB + '/cust-fail?op=credit&n=1'); const sf = await post('cust-credit-save', { retailMemberId: 'm-edit2', allow: false, amount: 5, confirmed: true, user: 'boss', password: 'boss-pw' }), c3 = await post('cust-credit-get', { retailMemberId: 'm-edit2' });
    rec('37 AIR POS refuses the save: ok false with its message and the values are unchanged', sf.j.ok === false && /could not be saved/.test(sf.j.message) && c3.j.allow === true && c3.j.amount === 250, JSON.stringify([sf.j, c3.j]));
    // shop-level
    await hook('/cust-reset'); await fetch(HB + '/cust-shop?on=1'); await relog('manager'); await fetch(HB + '/cust-credit-seed?id=m-edit2&allow=0&amount=5&shopAllow=1&shopAmount=100');
    const g1 = await post('cust-credit-get', { retailMemberId: 'm-edit2' }), sv = await post('cust-credit-save', { retailMemberId: 'm-edit2', allow: false, amount: 40.5, confirmed: true, user: 'boss', password: 'boss-pw' }), hs = await H();
    rec('38 points per shop: credit-get shows the SHOP values (Allow on, 100, shop balance 7.25); a save changes the shop values only, the corp pair stays', g1.j.pointByShop === true && g1.j.allow === true && g1.j.amount === 100 && g1.j.balance === 7.25 && sv.j.ok && hs.credit['m-edit2'].shopCreditAmount === 40.5 && hs.credit['m-edit2'].shopAllowCreditPayment === false && hs.credit['m-edit2'].creditAmount === 5, JSON.stringify([g1.j, hs.credit]));
    // who may use it
    await hook('/cust-reset'); await relog('cashier'); await fetch(HB + '/cust-credit-seed?id=m-edit2&allow=0&amount=0');
    const ck = await Promise.all([post('cust-credit-get', { retailMemberId: 'm-edit2' }), post('cust-credit-save', { retailMemberId: 'm-edit2', allow: true, amount: 999, confirmed: true, user: 'boss', password: 'boss-pw' })]), tk = await post('cust-tx-list', { retailMemberId: 'm-edit2' }), hk = await H();
    rec('39 a cashier (no manager flag): the credit routes answer "forbidden" and AIR POS is never asked; history still works (menu present)', ck.every(x => x.j.ok === false && x.j.forbidden === true) && hk.creditSaves === 0 && tk.j.ok === true, JSON.stringify([ck.map(x => x.j.message), tk.j.ok]));
    await relog('nomenu'); const hn0 = await H(), sn0 = await hook('/cust-state'); const nm = await Promise.all([post('cust-credit-get', { retailMemberId: 'm-edit2' }), post('cust-tx-list', { retailMemberId: 'm-edit2' }), post('cust-bal-list', { retailMemberId: 'm-edit2' }), post('cust-pts-list', { retailMemberId: 'm-edit2' }), post('cust-files-list', { retailMemberId: 'm-edit2' }), post('cust-file-add', { retailMemberId: 'm-edit2', files: [{ name: 'x.txt', data: b64('x') }] }), post('cust-file-remove', { retailMemberId: 'm-edit2', attachmentId: 'att-1', confirmed: true })]), hn = await H(), sn = await hook('/cust-state');
    rec('40 a manager WITHOUT the Member Management menu: every Customers route (files, history, credit) answers "forbidden"; AIR POS is not asked (no history call, no upload, no delete)', nm.every(x => x.j.ok === false && x.j.forbidden === true) && hn.calls.tx === hn0.calls.tx && hn.calls.bal === hn0.calls.bal && hn.calls.pts === hn0.calls.pts && sn.uploads === sn0.uploads && sn.deletes === sn0.deletes && sn.listCalls === sn0.listCalls && hn.creditSaves === hn0.creditSaves, JSON.stringify(nm.map(x => x.j.forbidden)));
    await hook('/cust-reset'); await relog('super');
    const text2 = L(), fin2 = await hook('/cust-state');
    rec('41 the log still holds no customer data (no name, no amount) and the fake saw no malformed call in the new calls either', !/Dana|Sample|250|40\.5/.test(text2) && /credit settings changed for 1 customer/.test(text2) && fin2.bad.length === 0, JSON.stringify(fin2.bad));
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 400)); }
  finally { srv.kill(); fs.rmSync(T, { recursive: true, force: true }); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')}` : 'ALL PASSED');
  process.exit(fails.length ? 1 : 0);
})();

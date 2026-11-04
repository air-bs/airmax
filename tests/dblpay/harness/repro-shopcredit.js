'use strict';
// 1.0.9-local.2 (e): store credit per shop. When RetailConfig pointSetting.pointByShop is on (Business Test has it on),
// AIR POS keeps the customer's store credit / points / credit limit in shopBalance / shopPoint / shopCreditAmount /
// shopAllowCreditPayment (AccountDetailsDrawer, MemberManage); balance/point are then not this shop's figures.
// CASE = shop (per shop, on at login) | late (turned on after login: config read on demand) | corp (off: balance/point as before)
const L = require('./lib'), C = require('./cashier');
const REG = process.env.REG || 'R5', CASE = process.env.CASE || 'shop', SEED = Number(process.env.BASE || 19500000);
(async () => { const log = []; const pid = await L.startReg(REG, { wipe: true }); const R = new L.Reg(REG); let bad = 0;
  try { await L.sim('/faults-clear', { reg: REG }); await L.sim('/shop', { on: CASE === 'shop' ? '1' : '0' }); await R.login(); if (CASE === 'late') await L.sim('/shop', { on: '1' });
    const f = await R.post('member-find', { keyword: 'Mike' }); const row = (f.rows || []).find(x => x.id === 'm-edit1');
    const d = await R.post('member-details', { id: 'm-edit1' }); const m = d.member || {};
    log.push(`find: credit ${row && row.balance} points ${row && row.points}`, `details: credit ${m.balance} points ${m.points} limit ${m.allowCreditPayment ? m.creditAmount : 'off'}`);
    const want = CASE === 'corp' ? { bal: 0, pts: 5, allow: false } : { bal: 2, pts: 9, allow: true, lim: 25 }; const iss = [];
    if (!row || row.balance !== want.bal || row.points !== want.pts) iss.push(`find shows credit ${row && row.balance}/points ${row && row.points}, want ${want.bal}/${want.pts}`);
    if (m.balance !== want.bal || m.points !== want.pts || !!m.allowCreditPayment !== want.allow || (want.allow && m.creditAmount !== want.lim)) iss.push(`details show credit ${m.balance}/points ${m.points}/limit ${m.allowCreditPayment}:${m.creditAmount}, want ${JSON.stringify(want)}`);
    const res = iss.length ? 'FAIL' : 'PASS'; if (iss.length) bad++; console.log(res, SEED, CASE, '|', iss.join('; '), '|', log.join(' / '));
    L.record({ area: 'mny109e', name: `store credit per shop [${CASE}]`, seed: SEED, reg: REG, result: res, why: iss.join('; ') + ' | ' + log.join(' / ') });
  } catch (e) { bad++; console.log('INVALID', e.message, log.join(' / ')); L.record({ area: 'mny109e', name: `shop credit ${CASE}`, seed: SEED, reg: REG, result: 'INVALID', why: 'harness ' + e.message + ' | ' + log.join(' / ') }); }
  await L.sim('/shop', { on: '0' }).catch(() => {}); L.kill(pid, 'SIGTERM'); await L.sleep(1500); process.exit(bad ? 1 : 0); })();

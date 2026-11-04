// Air Register 1.2.0: card refund check after a receipt return (AIR POS RetailReturnOrderGet / RetailReturnOrderRetry).
// OFFLINE only: fake AIR POS calls, temp data folders, no account, no network, no money.
// Run: node tests/card-refund.test.js
'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');

if (process.argv[2] === 'server') return serverChild(); // HTTP double-tap check: real app/server.js, fake AIR POS

const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n     ')); } };
const NOT_DONE = "Card refund NOT finished — don't give cash";
const cardFile = dir => path.join(dir, 'journal', 'card-refunds.json');
const mainFile = dir => path.join(dir, 'journal', 'current.json');

// fake AIR POS return store: per return id, the return status (0 Pending / 10 Normal / -10 Canceled) and card line status (10 / 20 / -10)
function mk({ dir, srv, company = 'fake shop', create, pdf, wrap = false, getDown = false, retryDown = false } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-cardref-'));
  const logs = [], reg = new Register({ log: m => logs.push(String(m)), dataDir: dir });
  reg.settingsPath = null; reg.settings.hardware = 'airpos';
  reg.identity = { userName: 'u', corpName: company, shopName: 'Fake', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] };
  reg.mode = 'sale'; reg.cardCheckDelays = [0, 1, 1];
  srv = srv || {}; const calls = { create: 0, nonOrder: 0, get: 0, retry: 0, retryIds: [], getDown, retryDown };
  const a = reg.api;
  a.returnCreate = async s => { calls.create++; if (create) return create(s); srv[s.id] = srv[s.id] || { status: 0, card: 10, payments: s.payments }; return { success: true, value: {} }; };
  a.nonOrderReturnCreate = async () => { calls.nonOrder++; return { success: true }; };
  a.fetchPdf = async () => pdf || { success: true };
  a.returnGet = async id => {
    calls.get++; if (calls.getDown) return { success: false, unreachable: true, message: 'AIR POS unreachable' };
    const r = srv[id]; if (!r) return { success: true, value: null };
    const v = { id, number: 'RO' + id, status: r.status, payments: (r.payments || [{ paymentType: 20, amount: 30 }]).map(p => ({ paymentType: p.paymentType, amount: p.amount, status: p.paymentType === 20 || p.paymentType === 30 ? r.card : 20 })) };
    return wrap ? { success: true, value: v } : v; // AIR POS httpClient returns the raw object; also accept {success,value}
  };
  a.returnRetry = async id => { calls.retry++; calls.retryIds.push(id); if (srv.slowRetry) await new Promise(r => setTimeout(r, srv.slowRetry)); if (calls.retryDown) return { success: false, unreachable: true }; const r = srv[id]; if (r && r.onRetry) Object.assign(r, r.onRetry); return { success: true }; };
  reg.drawer = async () => ({ ok: true, message: 'drawer' }); reg.printReturn = async () => ({ ok: true });
  return { reg, dir, srv, calls, logs };
}
// receipt return of order T100 paid by `receives`; refund `refund` (AIR POS order: member, gift, cash, card, keyed, check)
function receiptReturn(reg, { id = 'ret-1', receives = [{ id: 'rc-card', paymentType: 20, amount: 30 }], returned = [], refund = 30 } = {}) {
  reg.mode = 'return';
  reg.ret = { id, kind: 'receipt', order: { id: 'o1', number: 'T100', receives, returnPayments: returned, retailMemberId: null }, subs: [{ id: 's1', productId: 'p1', itemId: 'i1', quantity: 1, rate: 1, discount: 0 }] };
  reg.returnTotals = () => ({ refund, payments: reg.allocateRefund(refund), quantity: 1, amount: refund, tax: 0, decreasePoints: 0 });
}

(async () => {
  await t('Completed: "Refunded $30.00 to card" only when AIR POS says Completed; nothing left waiting', async () => {
    const m = mk(); m.srv['ret-1'] = { status: 10, card: 20 }; receiptReturn(m.reg);
    const r = await m.reg.confirmReturn();
    assert.ok(r.ok, r.message); assert.ok(r.card && r.card.done && r.card.status === 'completed', JSON.stringify(r.card));
    assert.ok(/Refunded \$30\.00 to card\./.test(r.message), r.message); assert.ok(!r.message.includes(NOT_DONE));
    assert.strictEqual(m.calls.create, 1); assert.ok(!fs.existsSync(cardFile(m.dir)) && !fs.existsSync(mainFile(m.dir)));
    assert.deepStrictEqual(m.reg.state().cardRefunds, []);
  });
  await t('Completed reply in {success,value} form is read the same way', async () => {
    const m = mk({ wrap: true }); m.srv['ret-1'] = { status: 10, card: 20 }; receiptReturn(m.reg);
    const r = await m.reg.confirmReturn(); assert.ok(r.card.done, r.message);
  });
  await t('Pending: "Card refund NOT finished — don\'t give cash", checked 3 times, kept on disk and in state', async () => {
    const m = mk(); receiptReturn(m.reg);
    const r = await m.reg.confirmReturn();
    assert.ok(r.ok, 'the return itself is recorded'); assert.strictEqual(r.card.status, 'pending');
    assert.ok(r.message.includes(NOT_DONE) && !/Refunded \$/.test(r.message) && !/Give back/.test(r.message), r.message);
    assert.strictEqual(m.calls.get, 3, 'polled 3 times'); assert.strictEqual(m.calls.retry, 0, 'no retry without the cashier');
    const j = JSON.parse(fs.readFileSync(cardFile(m.dir), 'utf8')); assert.strictEqual(j.items[0].retId, 'ret-1'); assert.strictEqual(j.items[0].amount, 30);
    assert.ok(!fs.existsSync(mainFile(m.dir)), 'the return note itself is cleared (return recorded)');
    const st = m.reg.state().cardRefunds; assert.strictEqual(st.length, 1); assert.ok(st[0].message.includes(NOT_DONE));
  });
  await t('Canceled card line: NOT finished, retry not sent while AIR POS does not show the return Pending', async () => {
    const m = mk(); m.srv['ret-1'] = { status: -10, card: -10 }; receiptReturn(m.reg);
    const r = await m.reg.confirmReturn(); assert.strictEqual(r.card.status, 'canceled'); assert.ok(r.message.includes(NOT_DONE));
    const x = await m.reg.retryCardRefund(); assert.ok(!x.ok && x.message.includes(NOT_DONE), x.message); assert.strictEqual(m.calls.retry, 0);
  });
  await t('Retry: same return id, one retry call, never a new return; then "Refunded" and cleared', async () => {
    const m = mk(); receiptReturn(m.reg); await m.reg.confirmReturn();
    m.srv['ret-1'].onRetry = { status: 10, card: 20 };
    const x = await m.reg.retryCardRefund();
    assert.ok(x.ok && /Refunded \$30\.00 to card/.test(x.message), x.message);
    assert.deepStrictEqual(m.calls.retryIds, ['ret-1']); assert.strictEqual(m.calls.create, 1, 'returnCreate only once');
    assert.ok(!fs.existsSync(cardFile(m.dir))); assert.deepStrictEqual(m.reg.state().cardRefunds, []);
    const again = await m.reg.retryCardRefund(); assert.ok(!again.ok && /No card refund is waiting/.test(again.message)); assert.strictEqual(m.calls.retry, 1);
  });
  await t('Retry still pending: stays NOT finished and on disk', async () => {
    const m = mk(); receiptReturn(m.reg); await m.reg.confirmReturn();
    const x = await m.reg.retryCardRefund(); assert.ok(!x.ok && x.message.includes(NOT_DONE) && x.retryable, x.message);
    assert.strictEqual(m.calls.retry, 1); assert.ok(fs.existsSync(cardFile(m.dir)));
  });
  await t('Retry when AIR POS already finished it: checks first and sends nothing', async () => {
    const m = mk(); receiptReturn(m.reg); await m.reg.confirmReturn();
    Object.assign(m.srv['ret-1'], { status: 10, card: 20 });
    const x = await m.reg.retryCardRefund(); assert.ok(x.ok && /nothing was sent again/.test(x.message), x.message); assert.strictEqual(m.calls.retry, 0);
  });
  await t('Double tap (register): two Retry taps at once send ONE retry', async () => {
    const m = mk(); receiptReturn(m.reg); await m.reg.confirmReturn();
    m.srv.slowRetry = 50; m.srv['ret-1'].onRetry = { status: 10, card: 20 };
    const [a, b] = await Promise.all([m.reg.retryCardRefund(), m.reg.retryCardRefund()]);
    assert.ok([a, b].filter(x => x.busy).length === 1, JSON.stringify([a.message, b.message])); assert.strictEqual(m.calls.retry, 1);
  });
  await t('Double tap (HTTP, real server.js single-flight guard): one busy, ONE retry call', async () => { await httpDoubleTap(); });
  await t('Lost reply on the return itself, AIR POS recorded it: card status is still checked (pending → NOT finished); no second return', async () => {
    const m = mk({ create: s => { m.srv[s.id] = { status: 0, card: 10 }; return { success: false, unreachable: true }; } }); receiptReturn(m.reg);
    const r = await m.reg.confirmReturn(); assert.ok(r.ok, r.message); assert.ok(r.message.includes(NOT_DONE), r.message); assert.strictEqual(m.calls.create, 1);
  });
  await t('Lost reply on the status lookup: never says Refunded; Retry refuses to send while AIR POS cannot be reached', async () => {
    const m = mk({ getDown: true }); receiptReturn(m.reg);
    const r = await m.reg.confirmReturn(); assert.strictEqual(r.card.status, 'unknown'); assert.ok(r.message.includes(NOT_DONE) && /could not confirm/.test(r.message), r.message);
    const x = await m.reg.retryCardRefund(); assert.ok(!x.ok && x.retryable, x.message); assert.strictEqual(m.calls.retry, 0);
    m.calls.getDown = false; m.srv['ret-1'].onRetry = { status: 10, card: 20 };
    const y = await m.reg.retryCardRefund(); assert.ok(y.ok, y.message); assert.strictEqual(m.calls.retry, 1); assert.strictEqual(m.calls.create, 1);
  });
  await t('Lost reply on the retry call: re-checked; Refunded only if AIR POS then says Completed', async () => {
    const m = mk({ retryDown: true }); receiptReturn(m.reg); await m.reg.confirmReturn();
    const x = await m.reg.retryCardRefund(); assert.ok(!x.ok && x.message.includes(NOT_DONE), x.message);
    Object.assign(m.srv['ret-1'], { status: 10, card: 20 });
    const y = await m.reg.retryCardRefund(); assert.ok(y.ok && /nothing was sent again/.test(y.message), y.message); assert.strictEqual(m.calls.retry, 1);
  });
  await t('Crash before the done screen (return journal with card part): recovery re-checks the card, notice says don\'t give cash', async () => {
    const m = mk(); receiptReturn(m.reg);
    m.reg.api.returnCreate = async s => { m.calls.create++; m.srv[s.id] = { status: 0, card: 10 }; throw new Error('simulated crash'); };
    await m.reg.confirmReturn().catch(() => {});
    const j = JSON.parse(fs.readFileSync(mainFile(m.dir), 'utf8')); assert.strictEqual(j.kind, 'return'); assert.strictEqual(j.card, 30);
    const m2 = mk({ dir: m.dir, srv: m.srv }); const r = await m2.reg.recover();
    const nt = m2.reg.state().notice; assert.ok(nt && nt.message.includes(NOT_DONE) && /card part \(\$30\.00\)/.test(nt.message), JSON.stringify(nt));
    assert.ok(!/Give the refund if not done yet/.test(nt.message)); assert.ok(!fs.existsSync(mainFile(m.dir)) && fs.existsSync(cardFile(m.dir)));
    assert.strictEqual(m2.reg.state().cardRefunds.length, 1); assert.ok(r);
    Object.assign(m.srv['ret-1'], { status: 10, card: 20 });
    const m3 = mk({ dir: m.dir, srv: m.srv }); await m3.reg.recover();
    assert.ok(!fs.existsSync(cardFile(m.dir)), 'Completed on the next check: cleared'); assert.deepStrictEqual(m3.reg.state().cardRefunds, []); assert.ok(!m3.reg.state().notice);
  });
  await t('Crash/restart with a waiting card refund: kept across restart and next sales; reminded on login', async () => {
    const m = mk(); receiptReturn(m.reg); await m.reg.confirmReturn();
    m.reg.journalSnap('route'); // empty sale after the return
    assert.ok(fs.existsSync(cardFile(m.dir)), 'a new sale journal does not overwrite it');
    const m2 = mk({ dir: m.dir, srv: m.srv }); await m2.reg.recover();
    assert.ok(m2.reg.state().notice.message.includes(NOT_DONE)); assert.strictEqual(m2.reg.state().cardRefunds[0].retId, 'ret-1');
    m.srv['ret-1'].onRetry = { status: 10, card: 20 }; const x = await m2.reg.retryCardRefund(); assert.ok(x.ok, x.message);
    assert.strictEqual(m2.calls.retry, 1); assert.strictEqual(m.calls.create + m2.calls.create, 1);
  });
  await t('Another company\'s waiting card refund is left alone (not shown, not retried, kept on disk)', async () => {
    const m = mk({ company: 'Other Co' }); receiptReturn(m.reg); await m.reg.confirmReturn();
    const m2 = mk({ dir: m.dir, srv: m.srv }); await m2.reg.recover();
    assert.deepStrictEqual(m2.reg.state().cardRefunds, []); assert.strictEqual(m2.calls.get, 0);
    receiptReturn(m2.reg, { id: 'ret-2' }); await m2.reg.confirmReturn();
    const j = JSON.parse(fs.readFileSync(cardFile(m.dir), 'utf8')); assert.deepStrictEqual(j.items.map(x => x.retId).sort(), ['ret-1', 'ret-2']);
  });
  await t('Split cash + card: give back the cash part; card part checked separately', async () => {
    const receives = [{ id: 'rc-cash', paymentType: 10, amount: 20 }, { id: 'rc-card', paymentType: 20, amount: 30 }];
    const m = mk(); m.srv['ret-1'] = { status: 0, card: 10, payments: [{ paymentType: 10, amount: 20 }, { paymentType: 20, amount: 30 }] };
    receiptReturn(m.reg, { receives, refund: 50 });
    const r = await m.reg.confirmReturn();
    assert.ok(/Give back \$20\.00 cash/.test(r.message) && r.message.includes(NOT_DONE) && /\$30\.00/.test(r.card.message), r.message);
    assert.strictEqual(r.card.amount, 30);
    const m2 = mk(); m2.srv['ret-1'] = { status: 10, card: 20, payments: [{ paymentType: 10, amount: 20 }, { paymentType: 20, amount: 30 }] };
    receiptReturn(m2.reg, { receives, refund: 50 }); const r2 = await m2.reg.confirmReturn();
    assert.ok(/Give back \$20\.00 cash/.test(r2.message) && /Refunded \$30\.00 to card/.test(r2.message), r2.message);
  });
  await t('Partial return: only the card part of THIS return is checked; cash-only part makes no card check', async () => {
    const receives = [{ id: 'rc-cash', paymentType: 10, amount: 20 }, { id: 'rc-card', paymentType: 20, amount: 30 }];
    const m = mk(); receiptReturn(m.reg, { receives, returned: [{ receivePaymentType: 20, amount: 10 }], refund: 35 });
    const r = await m.reg.confirmReturn(); assert.strictEqual(r.card.amount, 15, JSON.stringify(r.card)); assert.ok(/Give back \$20\.00 cash/.test(r.message));
    const m2 = mk(); receiptReturn(m2.reg, { receives, refund: 10 }); const r2 = await m2.reg.confirmReturn();
    assert.ok(!r2.card, 'no card part'); assert.strictEqual(m2.calls.get, 0); assert.ok(!r2.message.includes(NOT_DONE));
  });
  await t('Keyed card (Online 30) sale is checked like a terminal card', async () => {
    const m = mk(); m.srv['ret-1'] = { status: 10, card: 20, payments: [{ paymentType: 30, amount: 30 }] };
    receiptReturn(m.reg, { receives: [{ id: 'rc-k', paymentType: 30, amount: 30 }] });
    const r = await m.reg.confirmReturn(); assert.ok(r.card && r.card.done, r.message);
  });
  await t('No-receipt card refund: no AIR POS status check; tells the cashier to refund on the card machine', async () => {
    const m = mk(); m.reg.mode = 'return';
    m.reg.ret = { id: 'nr-1', kind: 'nonorder', order: null, subs: [{ id: 's1', productId: 'p1', itemId: 'i1', quantity: 1, rate: 1, price: 10, taxRate: 0 }], payments: [{ paymentType: 20, name: 'Card', amount: 10 }] };
    m.reg.returnTotals = () => ({ refund: 10, payments: [{ paymentType: 20, name: 'Card', amount: 10 }], quantity: 1, amount: 10, tax: 0 });
    const r = await m.reg.confirmReturn(); assert.ok(r.ok, r.message); assert.ok(!r.card && /on the card machine/.test(r.message), r.message);
    assert.strictEqual(m.calls.get, 0); assert.strictEqual(m.calls.nonOrder, 1); assert.ok(!fs.existsSync(cardFile(m.dir)));
    const ex = fs.readFileSync(path.join(__dirname, '../app/public/extras.js'), 'utf8'); assert.ok(ex.includes("'Card — refund on card machine'") || fs.readFileSync(path.join(__dirname, '../app/public/app.js'), 'utf8').includes("'Credit Card — refund on card machine'")); // label now lives in the shared refund panel (owner request J)
    const rd = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8'); assert.ok(!/No-receipt returns refund cash only/.test(rd));
  });
  await t('Server route card-refund-retry exists and is single-flight (ONCE)', async () => {
    const s = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');
    assert.ok(/'card-refund-retry': needLogin/.test(s)); assert.ok(/const ONCE = new Set\(\[[^\]]*'card-refund-retry'/.test(s));
    const ap = fs.readFileSync(path.join(__dirname, '../app/lib/airpos.js'), 'utf8');
    assert.ok(ap.includes("'/ReturnOrders/RetailReturnOrderGet', { id }") && ap.includes("'/ReturnOrders/RetailReturnOrderRetry', { id }"));
  });
  console.log(`\n${n - bad}/${n} passed`);
  fs.writeFileSync(path.join(__dirname, 'card-refund-results.json'), JSON.stringify({ at: new Date().toISOString(), passed: n - bad, total: n, out }, null, 1));
  process.exit(bad ? 1 : 0);
})();

// ---------- HTTP double tap: real server.js + its ONCE/locked guard, fake AIR POS in a child process ----------
function post(port, name, body) {
  return new Promise((res, rej) => { const d = JSON.stringify(body || {}); const q = http.request({ host: '127.0.0.1', port, path: '/api/' + name, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, r => { let s = ''; r.on('data', c => s += c); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }); q.on('error', rej); q.end(d); });
}
async function httpDoubleTap() {
  // 1.0.11-local.4g: 5304 clashed with the Stress Tester (sims 5300-5349, regs 5350-5379) and 5214/5215 were busy on the box,
  // so default to 5400-5498 (CR_PORT_BASE overrides the start) and skip a pair that is already taken.
  const free = q => new Promise(r => { const t = http.createServer(); t.once('error', () => r(false)); t.listen(q, '127.0.0.1', () => t.close(() => r(true))); });
  const base = Number(process.env.CR_PORT_BASE || 5400); let port = 0;
  for (let i = 0; i < 20 && !port; i++) { const q = base + Math.floor(Math.random() * 50) * 2; if (await free(q) && await free(q + 1)) port = q; }
  if (!port) throw new Error('no free port pair from ' + base);
  const ch = spawn(process.execPath, [__filename, 'server'], { env: { ...process.env, CR_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; ch.stdout.on('data', d => log += d); ch.stderr.on('data', d => log += d);
  try {
    for (let i = 0; i < 100 && !/Air Max on http/.test(log); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(/Air Max on http/.test(log), 'server did not start: ' + log.slice(-400));
    const l = await post(port, 'login', { company: 'Fake Co', user: 'u', password: 'x' }); assert.ok(l.ok, l.message);
    const [a, b] = await Promise.all([post(port, 'card-refund-retry', { retId: 'ret-h' }), post(port, 'card-refund-retry', { retId: 'ret-h' })]);
    const busy = [a, b].filter(x => x.busy).length, done = [a, b].filter(x => x.ok).length;
    const counts = JSON.parse((log.match(/COUNTS (\{.*\})/g) || ['COUNTS {}']).pop().slice(7));
    assert.strictEqual(busy, 1, JSON.stringify([a.message, b.message])); assert.strictEqual(done, 1, JSON.stringify([a.message, b.message]));
    assert.strictEqual(counts.retry, 1, 'retry calls: ' + JSON.stringify(counts)); assert.strictEqual(counts.create, 0);
  } finally { ch.kill(); }
}
function serverChild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-cardref-srv-')), port = Number(process.env.CR_PORT);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port, build: 'customer', blockedCompanies: [], updateFeedUrl: 'http://updates-off-in-tests' }));
  process.env.AIRREG_CONFIG = path.join(dir, 'config.json'); process.env.AIRREG_DATA = dir;
  const { Journal } = require('../app/lib/journal');
  new Journal(dir, null, 'card-refunds.json').write({ kind: 'card-refunds', items: [{ retId: 'ret-h', orderNumber: 'T9', amount: 12, status: 'pending', company: 'Fake Co' }] });
  const { AirPos } = require('../app/lib/airpos');
  const st = { status: 0, card: 10 }, counts = { get: 0, retry: 0, create: 0 };
  const show = () => console.log('COUNTS ' + JSON.stringify(counts));
  const ok = value => ({ success: true, value });
  const H = {
    '/Identities/Login': p => { const s = JSON.parse(p.submit || '{}'); return ok({ ide: 'fake-token', corpName: s.corpName, shopName: 'Fake shop', userName: s.userName, superAdmin: true, shopId: 'shop', operatorId: 'op', stationId: 'st', currency: 2 }); },
    '/Home/Index': () => ({ terminalConfig: {}, retailConfig: { basicSetting: {}, extraChargeSetting: [] }, authorities: ['RetailManager'] }),
    '/RetailSessions/SessionCheck': () => ({ type: 10 }),
    '/ReturnOrders/RetailReturnOrderGet': async p => { counts.get++; show(); await new Promise(r => setTimeout(r, 150)); return { id: p.id, number: 'RO1', status: st.status, payments: [{ paymentType: 20, amount: 12, status: st.card }] }; },
    '/ReturnOrders/RetailReturnOrderRetry': async () => { counts.retry++; show(); await new Promise(r => setTimeout(r, 150)); st.status = 10; st.card = 20; return ok(null); },
    '/ReturnOrders/RetailReturnOrderCreate': () => { counts.create++; show(); return ok(null); },
    '/ReturnOrders/NonOrderReturnOrderCreate': () => { counts.create++; show(); return ok(null); },
  };
  AirPos.prototype.call = async function (host, p, params = {}) { const h = H[p]; return h ? h(params || {}) : { success: true, value: null, rows: [], total: 0 }; };
  require('../app/server.js');
}

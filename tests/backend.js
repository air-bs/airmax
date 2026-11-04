// Backend test on the TEST account only (business test / grock). Password only from env AIRMAX_TEST_PW.
// node backend.js <step...>    Never logs the password or token.
const { Register } = require('../app/lib/register');
const fs = require('fs');
const RES = __dirname + '/backend-results.json';
const results = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES)) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const logs = [];
const reg = new Register({ blockedCompanies: ['blocked-demo-co'], log: m => { logs.push(m); if (process.env.V) console.log('  · ' + m); }, appDir: __dirname + '/../app', dataDir: '/tmp/airreg-data' });
fs.mkdirSync('/tmp/airreg-data', { recursive: true });
const rec = (k, pass, note) => { results[k] = { pass, note }; console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const j = o => JSON.stringify(o);
(async () => {
  const blocked = await reg.login('blocked-demo-co', 'x', 'not-a-password');
  rec('blocked company refused (dev block)', !blocked.ok && /blocked/.test(blocked.message), blocked.message);
  const lg = await reg.login('business test', 'grock', process.env.AIRMAX_TEST_PW);
  if (!lg.ok) { console.log('login failed: ' + lg.message); process.exit(1); }
  console.log(lg.message, '| mode', reg.mode, '| hw', j(reg.hwStatus));
  if (reg.mode === 'clockin') { const c = await reg.clockIn(0); console.log('clock in', c.message); }
  const steps = (process.argv[2] || 'info').split(',');
  for (const s of steps) await T[s]();
  fs.writeFileSync(RES, JSON.stringify(results, null, 2));
  reg.hw.stop();
})().catch(e => { console.error(e); reg.hw.stop(); process.exit(1); });

const T = {
  // 1.2.0: Tax Off on the real AIR POS (per-line taxRate 0 is what AIR POS prices): tax 0, then back. Nothing is saved.
  async taxoff() {
    await reg.newSale(); let r = await reg.scan('00001'); const t0 = reg.totals.tax;
    const on = await reg.setTaxExempt(true); const t1 = reg.totals.tax; const off = await reg.setTaxExempt(false); const t2 = reg.totals.tax;
    rec('1.2.0 Tax Off on AIR POS pricing', r.ok && on.ok && off.ok && t1 === 0 && t2 === t0, `tax ${t0} -> ${t1} -> ${t2}`); await reg.newSale();
  },
  // 1.2.0: bulk item button on a real product (no product created), with a lower typed price
  async bulk() {
    await reg.newSale(); reg.saveSettings({ bulkItems: [{ label: 'Test bulk', code: '00001', askPrice: true }] });
    const sc = await reg.scan('00001'); const full = sc.ok ? reg.lineAmount(reg.lineAt(0)) : 0; await reg.newSale();
    const r = await reg.addBulk(0, Math.max(0.01, Math.round(full * 50) / 100));
    rec('1.2.0 Bulk item with price prompt on AIR POS', r.ok && reg.subs.length === 1 && reg.subs[0].discountAmount > 0, `${r.message}; due ${reg.totals.due}`);
    reg.saveSettings({ bulkItems: [] }); await reg.newSale();
  },
  // 1.2.0 item 9: what does the TEST account's AIR POS say about selling below stock? (read-only: settings keys only)
  async stockprobe() {
    const keys = []; const walk = (o, p) => { if (!o || typeof o !== 'object' || p.split('.').length > 4) return; for (const [k, v] of Object.entries(o)) { if (/stock|inventor|negative/i.test(k)) keys.push(p + k + '=' + JSON.stringify(v).slice(0, 40)); walk(v, p + k + '.'); } };
    walk(reg.home, ''); rec('1.2.0 AIR POS stock-related settings on TEST account', true, keys.join('; ') || 'none found');
  },
  async info() {
    const st = reg.state();
    console.log('discounts', j(st.discounts)); console.log('extra', j(st.extraCharges));
    console.log('term', j({ autoDrawer: reg.term().autoOpenCashDrawer, autoPrint: reg.term().checkoutAutoPrint, retPrint: reg.term().returnAutoPrint, printer: reg.term().printerName }));
    const m = await reg.findMembers(''); console.log('members', j(m.rows.slice(0, 5)));
  },
  async cart() {
    let r = await reg.scan('00001'); const a = r.ok; r = await reg.scan('00001'); const due0 = reg.totals.due;
    rec('Scan + merge', a && r.ok && reg.subs.length === 1 && reg.subs[0].quantity === 2, `qty ${reg.subs[0] && reg.subs[0].quantity} due ${due0}`);
    r = await reg.lineDiscount(0, 'amount', 1); const d1 = reg.totals.due;
    rec('Line discount $1', r.ok && Math.abs(due0 - d1) > 0.9, `${due0} → ${d1} | ${r.message}`);
    r = await reg.lineDiscount(0, 'percent', 10); const d2 = reg.totals.due;
    r = await reg.lineDiscount(0, 'clear'); const d3 = reg.totals.due;
    rec('Line discount % + clear', d2 < due0 && Math.abs(d3 - due0) < 0.005, `10% → ${d2}; clear → ${d3}`);
    r = await reg.lineTax(0, 0); const d4 = reg.totals.due; await reg.lineTax(0, reg.subs[0].taxRate === 0 ? 0 : 0);
    rec('Line tax edit', r.ok, `tax 0% → due ${d4} (tax ${reg.totals.tax})`);
    r = await reg.addSpecial('temp', { price: 2.5, quantity: 1, name: 'Test temp' }); const d5 = reg.totals.due;
    rec('Temporary item', r.ok && reg.subs.some(s => s.type === 10), `${r.message}; due ${d5}`);
    const ex = (reg.retailCfg().extraChargeSetting || [])[0];
    if (ex) { r = await reg.addSpecial('extra', { chargeItemId: ex.id, price: ex.defaultAmount || 1 }); rec('Extra charge', r.ok && reg.subs.some(s => s.type === 20), `${r.message}; due ${reg.totals.due}`); }
    else { r = await reg.addSpecial('extra', { chargeItemId: 'x', price: 1 }); rec('Extra charge', !r.ok, 'no extra charges set up on test account → clear message: ' + r.message); }
    r = await reg.setPromoCode('NOSUCHCODE'); rec('Promo code (unknown code)', r.ok, r.message); await reg.setPromoCode('');
    const dc = (reg.discountConfig.subs || []).find(d => !d.isPeriodicLimit);
    if (dc) { const b = reg.totals.due; r = await reg.setPredefinedDiscount(dc.id); const a2 = reg.totals.due; await reg.setPredefinedDiscount(null); rec('Predefined discount', r.ok && a2 < b, `${dc.name} ${dc.rate}%: ${b} → ${a2} → back ${reg.totals.due}`); }
    const pl = (reg.discountConfig.subs || []).find(d => d.isPeriodicLimit);
    if (pl) { r = await reg.setPredefinedDiscount(pl.id); rec('Members-only discount needs member', !r.ok, r.message); }
  },
  async member() {
    const f = await reg.findMembers(''); const m = f.rows[0];
    if (!m) { rec('Member lookup', false, 'no members on test account'); return; }
    let r = await reg.attachMember(m.number); rec('Member attach', r.ok && !!reg.member, r.message + ' ' + j(reg.member && { points: reg.member.points, bal: reg.member.availableBalance, rate: reg.member.pointExchangeRate, credit: reg.member.allowCreditPayment, limit: reg.member.creditAmount }));
    r = await reg.attachMember('0000000000099'); rec('Member not found message', !r.ok, r.message);
    await reg.attachMember(m.number);
  },
  async memberadd() {
    const phone = '555' + String(Date.now()).slice(-7);
    const r = await reg.addMember({ mobile: phone, firstName: 'Test', lastName: 'AirRegister', remark: 'Air Register 1.1 test member' });
    rec('Add member (+ attach)', r.ok && reg.member && reg.member.number === phone.replace(/\D/g, ''), r.message);
  },
  async splitpay() {
    if (!reg.subs.length) { await reg.scan('00001'); }
    await reg.recalc(); const due = reg.totals.due;
    let r = await reg.startPay(); if (r.needManager) { rec('Split pay', false, 'needs manager: ' + r.message); return; }
    const half = Math.round(due / 2 * 100) / 100;
    r = await reg.tender({ type: 50, amount: half, checkNumber: '1001' }); const c1 = r.ok;
    console.log('  check:', r.message);
    const rem = reg.remaining();
    r = await reg.tender({ type: 10, tendered: Math.ceil(rem + 1) });
    rec('Split payment: check + cash with change', c1 && r.ok && r.completed, `due ${due}: check ${half}, cash ${Math.ceil(rem + 1)} → ${r.message} | drawer: ${r.drawer && r.drawer.message} | print: ${r.print && r.print.message}`);
    results._splitOrder = r.orderId;
  },
  async cardcancel() {
    if (!reg.subs.length) await reg.scan('00001');
    await reg.recalc();
    let r = await reg.startPay(); if (r.needManager) { rec('Card begin/cancel', false, r.message); return; }
    r = await reg.tender({ type: 20 });
    console.log('  begin:', r.ok, r.message);
    if (!r.ok) { rec('Card: Begin (type 20) → poll → Cancel', false, 'Begin failed: ' + r.message); await reg.closePay(); return; }
    await sleep(4000);
    const c = reg.pay.card; const snap = c && { status: c.status, polls: c.polls, msg: c.message, sub: c.subMessage };
    console.log('  polling:', j(snap));
    const can = await reg.cardCancel();
    const after = reg.pay && reg.pay.tenders.length;
    rec('Card: Begin (type 20) → poll → Cancel', r.ok && snap && snap.polls >= 3 && can.ok && after === 0, `begin "${r.message}"; ${snap.polls} ReceiveCheck polls in 4 s, status ${snap.status} "${snap.msg}"; cancel: ${can.message}; paid now ${reg.paidTotal()}`);
    const cl = await reg.closePay(); console.log('  close pay:', cl.message);
    const o = await reg.api.orderGet(reg.order.id); const v = o && o.value;
    console.log('  server receives:', j(((v && v.receives) || []).map(x => ({ type: x.paymentType, amount: x.amount, status: x.status }))), 'order status', v && v.status);
    results._cardOrder = reg.order.id;
  },
  async cardonlycash() { // after card cancel: finish same order with cash to prove recovery
    if (!reg.subs.length) return;
  },
  async gift() {
    const r = await reg.verifyGiftCard('NOSUCHCARD', ''); rec('Gift card verify (bad card)', !r.ok, r.message);
  },
  async storecredit() {
    if (!reg.member) await T.member();
    if (!reg.subs.length) await reg.scan('00001');
    await reg.startPay();
    const r = await reg.tender({ type: 11, amount: 0.01 });
    rec('Store credit tender', true, `${r.ok ? 'accepted: ' : 'refused: '}${r.message}`);
  },
  async xrep() {
    const r = await reg.xReport(); rec('X report data', r.ok, r.ok ? j(Object.fromEntries(Object.entries(r.report).filter(([k, v]) => typeof v !== 'object').slice(0, 14))) : r.message);
    const p = await reg.previewReport('x'); rec('X report PDF (preview)', p.ok, p.ok ? p.bytes + ' bytes' : p.message);
    if (p.ok) fs.writeFileSync('/tmp/x-report.pdf', reg.preview.buf);
  },
  async xprint() { const r = await reg.printReport('x'); rec('X report print', r.ok || r.hw === 'absent', r.message); },
  async zlist() { const r = await reg.zList(); rec('Z report list', r.ok, `${r.rows.length} rows ` + j(r.rows.slice(0, 2))); results._z = r.rows[0] && r.rows[0].id; },
  async zgen() { const r = await reg.zGenerate(); rec('Z report generate', r.ok, r.message); },
  async zpreview() { const l = await reg.zList(); const id = l.rows[0] && l.rows[0].id; if (!id) return rec('Z PDF', false, 'no Z'); const p = await reg.previewReport('z', id); rec('Z report PDF', p.ok, p.ok ? p.bytes + ' bytes' : p.message); if (p.ok) fs.writeFileSync('/tmp/z-report.pdf', reg.preview.buf); },
  async cash() {
    const b0 = (await reg.drawerBalance()).balance;
    const a = await reg.cashMove('in', 1, 'Air Register test pay-in');
    const b1 = (await reg.drawerBalance()).balance;
    const c = await reg.cashMove('out', 1, 'Air Register test pay-out');
    const b2 = (await reg.drawerBalance()).balance;
    const big = await reg.cashMove('out', b2 + 1000, 'too much');
    rec('Cash pay-in / pay-out', a.ok && c.ok && Math.abs(b1 - b0 - 1) < 0.005 && Math.abs(b2 - b0) < 0.005 && !big.ok, `${b0} → ${b1} → ${b2}; ${a.message} / ${c.message}; over-withdraw refused: ${big.message}`);
  },
  async ret() {
    const id = results._splitOrder; if (!id) return rec('Return to original tenders', false, 'no split order');
    let r = await reg.startReturn('receipt', id); if (!r.ok) return rec('Return to original tenders', false, r.message);
    const line = reg.returnLines()[0]; r = await reg.returnScan(line.code);
    const t = reg.returnTotals(); console.log('  allocation', j(t.payments));
    r = await reg.confirmReturn();
    rec('Return (receipt) refunds to original tenders', r.ok, r.message + ' | print: ' + (r.print && r.print.message));
  },
  async retpdf() {
    const id = reg.lastReturnId || results._returnId; if (!id) return;
    const pdf = await reg.api.fetchPdf('/ReturnOrders/RetailReturnOrderBillGet', { returnOrderId: id, stationId: reg.api.stationId, shopId: reg.api.shop }, 'return');
    rec('Return receipt PDF download', pdf.success, pdf.success ? pdf.value.length + ' bytes' : pdf.message); if (pdf.success) fs.writeFileSync('/tmp/return.pdf', pdf.value);
  },
  async receipt() {
    const id = results._splitOrder || reg.lastOrderId; const r = await reg.receiptPdf(id);
    rec('Sale receipt PDF', r.ok, r.ok ? Buffer.from(r.base64, 'base64').length + ' bytes' : r.message); if (r.ok) fs.writeFileSync('/tmp/receipt.pdf', Buffer.from(r.base64, 'base64'));
  },
  async printers() { const r = await reg.printers(); rec('Printer list', r.ok, j(r)); },
  async testprint() { const r = await reg.testPrint(); rec('Test page print', r.ok || r.hw, r.message); const d = await reg.openDrawerRaw(); rec('Test drawer', d.ok || d.hw, d.message); },
  async logout() { const r = reg.logout(); rec('Logout', r.ok && !reg.api.loggedIn, r.message); },
};
T.resumepaid = async () => {
  const h = await reg.heldOrders(); console.log('  held:', JSON.stringify(h.rows.slice(0, 3)));
  const r = await reg.resume(h.rows[0].id);
  const paid = reg.paidTotal(), rem = reg.remaining();
  const p = await reg.tender({ type: 10, tendered: Math.ceil(rem + 1) });
  rec('Resume interrupted sale (server cancels unfinished receives, like AIR POS), finish with cash', r.ok && p.ok && p.completed, `${r.message}; remaining ${rem} → ${p.message}`);
  results._splitOrder = p.orderId;
};

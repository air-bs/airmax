// 1.0.10-local.2 (Ari 1:40 PM ET Nov 1, "receipts take way too long to print", Star TSP143, Print receipts = Windows driver).
// Times the post-sale receipt path with a mocked AIR POS and a mocked helper that, like the real hw helper, runs ONE command at
// a time. Delays are made up but typical (AIR POS Complete 250 ms, template config 200 ms, receipt PDF 350 ms; the helper's
// printer list (WMI) 2500 ms, Star drawer driver job 400 ms, PDF to the driver 900 ms). Real printer / driver / spool time can
// only be measured on the register (Save diagnostics now carries the per-step ms). No network, no printer, made-up data.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const STAR = { name: 'Star TSP100 Cutter (TSP143)', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' };
const D = { complete: 250, cfg: 200, bill: 350, printers: 2500, drawer: 400, pdf: 900 };
const wait = ms => new Promise(r => setTimeout(r, ms));
function mk({ settings = {}, warm = false, pdfFail = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-spd-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: '', printMethod: 'driver', printerType: 'auto', drawerPin: 2, drawerPulse: 200, drawerWaitSec: 5, receiptAutoPrint: 'always' }, settings);
  const ev = []; const T0 = { t: 0 }; const mark = k => ev.push({ k, t: Date.now() - T0.t });
  let chain = Promise.resolve(); const serial = (k, ms, v) => { const p = chain.then(async () => { mark(k + '>'); await wait(ms); mark(k + '<'); return v(); }); chain = p.catch(() => {}); return p; };
  const list = () => ({ ok: true, value: { printers: [STAR.name], default: STAR.name, resolved: STAR.name, details: [STAR] } });
  reg.hw = { present: true,
    printers: () => serial('printers', D.printers, list),
    renderMono: async () => ({ ok: true, value: { width: 8, height: 1, data: 'AA==' } }),
    printPdf: () => serial('pdf', D.pdf, () => (pdfFail ? { ok: false, error: "Printer 'Star' is offline" } : { ok: true, value: 'printed' })),
    request: (kind, a) => kind === 'drawerDriver' ? serial('drawer', D.drawer, () => ({ ok: true, value: { state: 'driver-drawer' } })) : serial(kind, 50, () => ({ ok: true, value: 'printed' })) };
  if (warm) reg._prnInfo = { at: Date.now() - 11 * 60 * 1000, for: '', v: { printers: [STAR.name], default: STAR.name, resolved: STAR.name, details: [STAR], one: STAR } }; // read 11 min ago (older than the old 10 min cache)
  const api = reg.api; api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: true, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } });
  api.complete = async () => { mark('complete>'); await wait(D.complete); mark('complete<'); return { success: true }; };
  // Step 0 test update: AIR POS lists the payment it took (like the strict fake / real AIR POS), so the M1 keptCheck (app/lib/register.js, up to 5 reads 0.8 s apart
  // when the order read does not list the payment) finds it on the first read and adds no delay: this test times the real print path, not the kept-check retries.
  api.orderGet = async id => ({ success: true, value: { id, status: 1, receives: ((reg.pay && reg.pay.tenders) || []).map(x => ({ id: x.id, paymentType: x.type, amount: x.amount, receiveAmount: x.receiveAmount, giveAmount: x.giveAmount, status: 20 })) } });
  api.billTemplateConfigGet = async () => { mark('cfg>'); await wait(D.cfg); mark('cfg<'); return { success: true, value: { orderPrintId: 'op', defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }] } }; };
  api.billContentGet = async () => { mark('bill>'); await wait(D.bill); mark('bill<'); return { success: true, value: { billBase64: 'JVBERi0x' } }; };
  api.printBillContent = async () => ({ success: true }); api.openCashbox = async () => ({ success: true });
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  return { reg, ev, T0, at: k => (ev.find(e => e.k === k) || { t: null }).t };
}
async function sale(t, tender, prime) {
  if (prime) await t.reg.printerInfo(); // what login now starts 1.5 s after sign-in, while nobody is printing
  await t.reg.recalc(); await t.reg.startPay();
  t.T0.t = Date.now(); const r = await t.reg.tender(tender); const shownMs = Date.now() - t.T0.t; // the done screen can show now
  const hw = r && r.hwJob ? await r.hwJob : []; return { r, hw, shownMs };
}
const fmt = t => `screen ${t.shown} ms, Complete back ${t.at('complete<')} ms, print starts ${t.at('pdf>')} ms, printed ${t.at('pdf<')} ms; helper order ${t.ev.filter(e => /^(printers|drawer|pdf)>$/.test(e.k)).map(e => e.k.slice(0, -1)).join(' > ')}`;
(async () => {
  const res = {};
  for (const [name, o, tender] of [['card, printer list older than 10 min', { warm: true }, { type: 20, amount: 10 }], ['cash, printer list older than 10 min', { warm: true }, { type: 10, tendered: 20 }], ['card, first sale after start (no list yet)', {}, { type: 20, amount: 10 }], ['card, first sale after login (list read at login)', { prime: true }, { type: 20, amount: 10 }]]) {
    const t = mk(o); const s = await sale(t, tender, o.prime); t.ev.splice(0, t.ev.findIndex(e => e.k === 'complete>')); t.shown = s.shownMs; res[name] = { shown: s.shownMs, complete: t.at('complete<'), printStart: t.at('pdf>'), printed: t.at('pdf<'), timings: t.reg.lastPrintTimings, saleTimings: t.reg.lastSaleTimings };
    console.log('TIMING ' + name + ': ' + fmt(t));
    const air = t.at('bill<'), gap = t.at('pdf>') - Math.max(air, t.at('drawer<') || 0);
    rec(`${name}: the done screen shows when Complete returns (before any printing)`, s.r && s.r.completed && s.shownMs < D.complete + 150 && t.at('pdf>') >= t.at('complete<'), `screen ${s.shownMs} ms`);
    rec(`${name}: print never starts before AIR POS Complete returned`, t.at('pdf>') >= t.at('complete<'), fmt(t));
    rec(`${name}: Save diagnostics printStartMs = when the helper got the PDF (±60 ms)`, t.reg.lastSaleTimings && Math.abs(t.reg.lastSaleTimings.printStartMs - t.at('pdf>')) <= 60, `diag ${t.reg.lastSaleTimings && t.reg.lastSaleTimings.printStartMs} vs helper ${t.at('pdf>')}`);
    if (o.warm || o.prime) rec(`${name}: print starts right after the receipt PDF arrives (no printer-list read in front of it)`, gap <= 60 && !t.ev.some(e => e.k === 'printers>' && e.t < t.at('pdf>')), `gap ${gap} ms; ${fmt(t)}`);
    if (!o.warm && !o.prime) rec(`${name}: with no printer list yet it is read first (as before; reported, needs the real PC for the true cost)`, t.ev.some(e => e.k === 'printers>' && e.t < t.at('pdf>')), fmt(t));
    rec(`${name}: Save diagnostics timings recorded (ms per step, from payment confirmed)`, !!(t.reg.lastSaleTimings && t.reg.lastSaleTimings.printStartMs != null && t.reg.lastSaleTimings.completeMs != null) && /Recent sale print timings/.test((t.reg.printDiagLines ? t.reg.printDiagLines() : []).join('\n')), JSON.stringify(t.reg.lastSaleTimings || null).slice(0, 300));
  }
  { const t = mk({ warm: true, pdfFail: true }); const s = await sale(t, { type: 20, amount: 10 });
    rec('a failed print never touches the sale: completed, same total, only a soft note', s.r.completed && s.r.due === 10 && (s.hw.find(x => x[0] === 'receipt') || [])[1].ok === false && t.reg.hwNotesRecent().some(n => n.kind === 'receipt'), JSON.stringify(s.hw.map(x => [x[0], x[1].ok]))); }
  { // login reads the printer list once in the background (1.5 s later), not during login itself
    const reg = new Register({ log: () => {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-lw-')) }); reg.settingsPath = null; let n = 0;
    reg.hw = { present: true, printers: async () => { n++; return { ok: true, value: { printers: ['P'], resolved: 'P', details: [{ name: 'P', driver: 'd' }] } }; }, request: async () => ({ ok: true, value: {} }) };
    const a = reg.api; a.login = async () => ({ success: true, value: { corpName: 'c', shopName: 's', userName: 'u' } }); a.homeIndex = async () => ({ terminalConfig: {}, retailConfig: { basicSetting: { extraChargeSetting: {} } } });
    a.discountConfigGet = async () => ({ success: true, value: { subs: [] } }); a.retailConfigGet = async () => ({ success: true, value: {} }); a.sessionCheck = async () => ({ type: 0 }); reg.deviceInfo = async () => {}; reg.loadKeyed = async () => {}; reg.recover = async () => null;
    const r = await reg.login('MadeUpCo', 'u', 'x'); const n0 = n; await wait(1700);
    rec('after login the printer list is read once in the background (not holding login), ready for the first receipt', r.ok && n0 === 0 && n === 1 && !!reg._prnInfo, `reads at login return ${n0}, after 1.7 s ${n}`);
  }
  console.log('RESULT ' + JSON.stringify(res));
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} print speed tests passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

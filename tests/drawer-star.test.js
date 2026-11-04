// 1.0.10-local.2 (Ari 1:12 / 1:36 PM ET Nov 1): the cash drawer opens by itself only when cash or a check was taken (default,
// unchanged); a card-only sale never kicks the drawer, also on the new Star path (Windows driver "Control" font letter, helper 1.2.1).
// The Open Drawer button (main screen and the Sale complete screen) kicks the drawer once, only on tap, and prints nothing.
// Offline: Register with a mocked AIR POS and a mocked helper (no network, no printer, made-up data only).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const STAR = { name: 'Star TSP100 Cutter (TSP143)', driver: 'Star TSP100 Cutter (TSP143)', port: 'USB001' };
const REFUSED = "Printer 'Star TSP100 Cutter (TSP143)' is not printing: it reports an error. The job was cancelled.";
function mk({ settings = {}, term = {}, raw } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-drw-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: '', printMethod: 'driver', printerType: 'auto', drawerPin: 2, drawerPulse: 200, drawerWaitSec: 5 }, settings);
  const calls = [];
  reg.hw = { present: true,
    printers: async () => ({ ok: true, value: { printers: [STAR.name], default: STAR.name, resolved: STAR.name, details: [STAR] } }),
    renderMono: async () => ({ ok: true, value: { width: 8, height: 1, data: 'AA==' } }),
    printPdf: async (b64, name) => { calls.push({ k: 'pdf', name }); return { ok: true, value: 'printed' }; },
    request: async (kind, a) => {
      if (kind === 'raw') { calls.push({ k: 'raw', doc: a.doc }); return raw ? raw(a) : { ok: true, value: 'printed' }; }
      if (kind === 'drawerDriver') { calls.push({ k: 'drawerDriver', name: a.printer, ch: a.ch }); return { ok: true, value: { state: 'driver-drawer' } }; }
      return { ok: true, value: [] };
    } };
  const api = reg.api; api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: false, ...term }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true });
  api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } });
  api.complete = async () => ({ success: true });
  api.orderGet = async () => ({ success: true, value: { status: 1, receives: [] } });
  api.billTemplateConfigGet = async () => ({ success: true, value: { orderPrintId: 'op', defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }] } });
  api.billContentGet = async () => ({ success: true, value: { billBase64: 'JVBERi0x' } });
  api.printBillContent = async () => { calls.push({ k: 'airpos-print' }); return { success: true }; };
  api.openCashbox = async () => { calls.push({ k: 'airpos-drawer' }); return { success: true }; };
  reg.mode = 'sale';
  reg.subs = [{ id: 'a', itemId: 'i0', productId: 'p0', number: '0001', name: 'Made-up item', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
  const kicks = () => calls.filter(c => c.k === 'drawerDriver' || c.k === 'airpos-drawer' || (c.k === 'raw' && /drawer/i.test(c.doc || ''))).length;
  return { reg, calls, kicks };
}
async function sell(t, tenders) {
  await t.reg.recalc(); await t.reg.startPay(); let r;
  for (const x of tenders) r = await t.reg.tender(x);
  if (r && r.hwJob) r.hw = await r.hwJob; // drawer / receipt run in the background after the sale
  return r;
}
const kinds = c => c.map(x => x.k + (x.ch ? ':' + x.ch : '')).join(',') || '(none)';
(async () => {
  // ---- the default ----
  let t = mk();
  rec('D1 default "Open drawer after a sale" = When cash or a check was taken (unset key)', t.reg.drawerAutoMode() === 'cash' && t.reg.state().settings.drawerAutoOpen === 'cash', t.reg.drawerAutoMode());
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
  rec('D2 Settings list keeps "When cash or a check was taken (normal)" as the first choice and falls back to it', /sel\('seC', \[\['cash', 'When cash or a check was taken \(normal\)'\]/.test(html), '');
  // ---- card-only sale: no kick (Star driver path) ----
  let r = await sell(t, [{ type: 20, amount: 10 }]);
  rec('D3 card-only sale on the Star driver path: sale completes, drawer NOT kicked', r && r.ok && r.completed && t.kicks() === 0, kinds(t.calls));
  t = mk({ term: { autoOpenCashDrawer: true } }); r = await sell(t, [{ type: 20, amount: 10 }]);
  rec('D4 card-only sale, even with AIR POS terminal "auto open cash drawer" ON: drawer NOT kicked', r && r.completed && t.kicks() === 0, kinds(t.calls));
  t = mk({ settings: { printMethod: 'auto' }, raw: () => ({ ok: false, error: REFUSED }) }); r = await sell(t, [{ type: 20, amount: 10 }]);
  rec('D5 card-only sale, Automatic print method on a queue that refuses raw: drawer NOT kicked', r && r.completed && t.kicks() === 0, kinds(t.calls));
  t = mk(); r = await sell(t, [{ type: 40, amount: 10, giftCards: [{ id: 'g', number: '7000000000002222', balance: 50 }] }]);
  rec('D6 gift-card-only sale: drawer NOT kicked', r && r.completed && t.kicks() === 0, kinds(t.calls));
  // ---- cash / check / split: one kick through the Star driver letter ----
  t = mk(); r = await sell(t, [{ type: 10, tendered: 20 }]);
  rec('D7 cash sale: drawer kicked once through the Star driver "Control" letter D (drawer 1, 200 ms)', r && r.completed && t.kicks() === 1 && t.calls.some(c => c.k === 'drawerDriver' && c.ch === 'D' && c.name === STAR.name), kinds(t.calls));
  t = mk(); t.reg.member = { id: 'm1', number: '5550001', name: 'Made-up customer', availableBalance: 0, creditAmount: 0 }; r = await sell(t, [{ type: 50, amount: 10, checkNumber: '123' }]); // checks need a customer on the sale (owner rule)
  rec('D8 check sale: drawer kicked once', r && r.completed && t.kicks() === 1, kinds(t.calls) + ' ' + (r && r.message));
  t = mk(); r = await sell(t, [{ type: 20, amount: 4 }, { type: 10, tendered: 6 }]);
  rec('D9 split card + cash: drawer kicked once (cash was taken)', r && r.completed && t.kicks() === 1, kinds(t.calls) + ' ' + (r && r.message));
  t = mk({ settings: { printMethod: 'auto' }, raw: () => ({ ok: false, error: REFUSED }) }); r = await sell(t, [{ type: 10, tendered: 10 }]);
  // 1.0.11 drawer fix (#10, Ari OK Nov 2): was 'raw,drawerDriver:D' (raw drawer try first). The receipt's own raw try (refused -> pdf) is unchanged.
  rec('D10 cash sale, Automatic on the Star futurePRNT queue that refuses raw: driver letter FIRST, no raw drawer try (opens once)', r && r.completed && t.kicks() === 1 && t.calls[0] && kinds([t.calls[0]]) === 'drawerDriver:D' && !t.calls.some(c => c.k === 'raw' && /drawer/i.test(c.doc || '')), kinds(t.calls));
  // ---- Open Drawer button: kick only on tap, nothing printed ----
  t = mk(); await new Promise(z => setTimeout(z, 50));
  rec('D11 nothing kicks the drawer until Open Drawer is tapped', t.kicks() === 0, kinds(t.calls));
  let d = await t.reg.drawer(false);
  rec('D12 main-screen Open Drawer (Ctrl+D): one Star driver kick, no receipt printed', d && d.ok && kinds(t.calls) === 'drawerDriver:D', kinds(t.calls) + ' ' + (d && d.message));
  t = mk(); r = await sell(t, [{ type: 20, amount: 10 }]); const before = t.kicks(); d = await t.reg.drawerForSale();
  rec('D13 Sale complete > Open Drawer after a card sale: opens once on tap (none before the tap)', before === 0 && d && d.ok && t.kicks() === 1, `before ${before}, after ${t.kicks()} ${kinds(t.calls)}`);
  t = mk({ settings: { printMethod: 'auto' }, raw: () => ({ ok: false, error: REFUSED }) }); d = await t.reg.drawer(false); const d2 = await t.reg.drawer(false);
  rec('D14 Open Drawer on Automatic + raw refused: every tap straight to the driver, also the first (one kick per tap; 1.0.11 drawer fix, was raw first)', d.ok && d2.ok && kinds(t.calls) === 'drawerDriver:D,drawerDriver:D', kinds(t.calls));
  t = mk({ settings: { drawerPin: 5 } }); d = await t.reg.drawer(false);
  rec('D15 drawer 2 (pin 5) uses the Control letter d', d.ok && kinds(t.calls) === 'drawerDriver:d', kinds(t.calls));
  const sj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'shortcuts.json'), 'utf8')).keys.filter(k => k.action === 'drawer');
  rec('D16 Open Drawer keeps its key and label (Ctrl+D)', sj.length === 1 && sj[0].key === 'Ctrl+D' && /Open Drawer/.test(html), JSON.stringify(sj.map(k => k.key + ' ' + k.label)));
  // ---- #1/#7 (owner, Nov 3): the drawer NEVER opens before AIR POS has completed the sale (cdr1011 early kick withdrawn) ----
  { t = mk(); const ev = []; const c0 = t.reg.api.complete; t.reg.api.complete = async x => { ev.push('complete>'); await new Promise(z => setTimeout(z, 150)); ev.push('complete<'); return c0(x); };
    const req0 = t.reg.hw.request; t.reg.hw.request = async (k, a) => { if (k === 'drawerDriver') ev.push('drawer'); return req0(k, a); };
    r = await sell(t, [{ type: 10, tendered: 10 }]);
    rec('D17 cash sale: drawer kick only AFTER AIR POS Complete answered OK, one kick', r && r.completed && t.kicks() === 1 && ev.indexOf('drawer') > ev.indexOf('complete<') && ev.indexOf('complete<') >= 0, ev.join(' ') + ' | ' + kinds(t.calls));
    rec('D18 the sale result lists the drawer job and its answer', r && (r.hwPending || []).includes('drawer') && (r.hw || []).some(([k, x]) => k === 'drawer' && x && x.ok), JSON.stringify(r && r.hwPending)); }
  { t = mk(); let n = 0; t.reg.api.complete = async () => (++n === 1 ? { success: false, message: 'The order cannot be completed.' } : { success: true });
    const r1 = await sell(t, [{ type: 10, tendered: 10 }]); await new Promise(z => setTimeout(z, 50)); const k1 = t.kicks();
    const r2 = await t.reg.finishSale(); if (r2 && r2.hwJob) await r2.hwJob;
    rec('D19 AIR POS refuses Complete: drawer stays SHUT; Finish sale again succeeds: drawer opens once', r1 && !r1.completed && k1 === 0 && r2 && r2.completed && t.kicks() === 1, `refused: completed ${!!(r1 && r1.completed)}, kicks ${k1}; retry: completed ${!!(r2 && r2.completed)}, kicks ${t.kicks()}`); }
  { t = mk({ settings: { drawerAutoOpen: 'off' } }); r = await sell(t, [{ type: 10, tendered: 10 }]);
    rec('D20 "Open drawer after a sale" = off: cash sale, no kick', r && r.completed && t.kicks() === 0, kinds(t.calls)); }
  { t = mk(); r = await sell(t, [{ type: 10, tendered: 4 }]); const k0 = t.kicks(); r = await t.reg.tender({ type: 20, amount: 6 }); if (r && r.hwJob) await r.hwJob;
    rec('D21 split: cash part first does not kick; one kick once the sale is completed', k0 === 0 && r && r.completed && t.kicks() === 1, `after cash part ${k0}, after completed ${t.kicks()}`); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} drawer tests passed`);
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

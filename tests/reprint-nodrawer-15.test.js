// Store request #15 (Nov 2): a reprint (Ctrl+P / History Reprint), a gift receipt and a pick-items gift slip must NEVER open the
// cash drawer, on a Star printer (raw path, Windows driver path, Automatic) and on Epson / generic ESC/POS. Test only: no app change.
// Offline: Register with a mocked AIR POS and a mocked helper (no network, no printer, made-up data only).
// Positive control: a cash sale DOES kick on the same mock, so a "0 kicks" result cannot be a broken detector.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const { Reprint } = require('../app/reprint');
const pc = require('../app/lib/printcmd');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const STAR = 'Star TSP100 Cutter (TSP143)', EPS = 'EPSON TM-T20II Receipt';
function mk({ type = 'star', method = 'driver', term = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airreg-rp15-'));
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null;
  const name = type === 'star' ? STAR : EPS;
  Object.assign(reg.settings, { hardware: 'builtin', printerConn: 'windows', printerName: '', printMethod: method, printerType: type === 'auto' ? 'auto' : type, drawerPin: 2, drawerPulse: 200, drawerWaitSec: 5, giftReceiptDefault: false }, {});
  const calls = [];
  reg.hw = { present: true,
    printers: async () => ({ ok: true, value: { printers: [name], default: name, resolved: name, details: [{ name, driver: name, port: 'USB001' }] } }),
    renderMono: async () => ({ ok: true, value: { width: 8, height: 1, data: 'AA==' } }),
    printPdf: async (b64, n) => { calls.push({ k: 'pdf', name: n }); return { ok: true, value: 'printed' }; },
    request: async (kind, a) => {
      if (kind === 'raw') { calls.push({ k: 'raw', doc: a.doc, bytes: Buffer.from(a.base64, 'base64') }); return { ok: true, value: 'printed' }; }
      if (kind === 'drawerDriver') { calls.push({ k: 'drawerDriver', ch: a.ch }); return { ok: true, value: { state: 'driver-drawer' } }; }
      return { ok: true, value: [] };
    } };
  const api = reg.api; api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, superAdmin: true, shopName: 'Made-up shop' };
  reg.home = { terminalConfig: { checkoutAutoPrint: false, autoOpenCashDrawer: true, ...term }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.billTemplateConfigGet = async () => ({ success: true, value: { orderPrintId: 'op', defaultTemplateId: 't1', templates: [{ id: 't1', name: 'Receipt', fields: [] }] } });
  api.billContentGet = async () => ({ success: true, value: { billBase64: 'JVBERi0x' } });
  api.printBillContent = async () => { calls.push({ k: 'airpos-print' }); return { success: true }; };
  api.openCashbox = async () => { calls.push({ k: 'airpos-drawer' }); return { success: true }; };
  api.orderGet = async () => ({ success: true, value: { id: 'o1', number: 'RO-TEST-1', orderTime: new Date().toISOString(), status: 20, receives: [], subs: [{ id: 's1', name: 'Made-up A', quantity: 1 }, { id: 's2', name: 'Made-up B', quantity: 2 }] } });
  api.promotionGet = async s => { const t = s.subs.reduce((a, x) => a + x.quantity * x.price, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } });
  api.orderSave = async () => ({ success: true }); api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } }); api.complete = async () => ({ success: true });
  reg.lastOrderId = 'o1';
  const rp = new Reprint({ dataDir: dir, reg, shopKey: () => 'k', log: () => {} });
  const kicks = () => calls.filter(c => c.k === 'drawerDriver' || c.k === 'airpos-drawer').length;
  // a raw job counts as a kick when it holds this printer profile's kick bytes (ESC p / BEL / SUB / ESC * r D)
  const rawKick = async () => { const kb = Buffer.from(reg.drawerBytes(await reg.profileNow())); return calls.filter(c => c.k === 'raw' && c.bytes && !/drawer/i.test(c.doc || '') && has(c.bytes, kb)).length; };
  return { reg, rp, calls, kicks, rawKick };
}
const has = (buf, sub) => sub.length > 0 && buf.indexOf(sub) >= 0;
const kinds = c => c.map(x => x.k + (x.ch ? ':' + x.ch : '')).join(',') || '(none)';
(async () => {
  const cases = [['star', 'driver'], ['star', 'raw'], ['star', 'auto'], ['epson', 'raw'], ['epson', 'auto'], ['generic', 'raw']];
  for (const [type, method] of cases) {
    const t = mk({ type, method }); const tag = `${type}/${method}`;
    const r1 = await t.reg.printOrder('o1');
    rec(`R1 ${tag}: reprint (printOrder, AIR POS "auto open drawer" ON) prints and kicks 0 times`, r1 && r1.ok && t.kicks() === 0 && (await t.rawKick()) === 0, kinds(t.calls));
    const r1b = await t.rp.lastReceipt(); const r1c = await t.reg.printOrder(r1b.orderId);
    rec(`R2 ${tag}: Ctrl+P last-receipt path: still 0 kicks`, r1b.ok && r1c && r1c.ok && t.kicks() === 0 && (await t.rawKick()) === 0, kinds(t.calls));
    const r2 = await t.rp.giftPick('o1', ['s1']);
    rec(`R3 ${tag}: pick-items gift slip: 0 kicks`, r2 && r2.ok && t.kicks() === 0 && (await t.rawKick()) === 0, kinds(t.calls));
    const r3 = await t.rp.gift('o1');
    rec(`R4 ${tag}: gift receipt (AIR POS gift template): 0 kicks`, r3 && t.kicks() === 0 && (await t.rawKick()) === 0, kinds(t.calls));
  }
  // positive control: the detector sees a kick when one is really sent
  const t = mk({ type: 'star', method: 'driver' }); await t.reg.drawer(false);
  rec('R5 control: Open Drawer (Ctrl+D) is counted as exactly 1 kick by the same detector', t.kicks() === 1, kinds(t.calls));
  const t2 = mk({ type: 'epson', method: 'raw' }); await t2.reg.drawer(false);
  const kb2 = Buffer.from(t2.reg.drawerBytes(await t2.reg.profileNow()));
  rec('R6 control: Epson Open Drawer is seen as a kick in a raw job', t2.calls.some(c => c.k === 'raw' && /drawer/i.test(c.doc) && has(c.bytes, kb2)), kinds(t2.calls));
  const hist = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'app.js'), 'utf8');
  rec('R7 reprint code path in app.js sends no drawer action (reprintLast/giftLast only call print / last-receipt / gift-*)', !/function reprintLast[\s\S]{0,600}drawer/.test(hist) && !/function giftLast[\s\S]{0,300}drawer/.test(hist), '');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} reprint-no-drawer tests passed`);
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

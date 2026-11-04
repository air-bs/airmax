// 1.0.11 instant scan (approved for 1.0.11): offline unit checks (no AIR POS, no server). Run: node tests/instant-scan.test.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
const { InstantScan, PAGE } = require('../app/instantscan');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function mk({ rows = 1203, fail = false } = {}) {
  const held = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-')), reg = new Register({ log: () => {} }), calls = [];
  reg.api.ide = 'x'; reg.identity = { userName: 'u', currency: 2, shopName: 'S' }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} } }; reg.mode = 'sale';
  Object.defineProperty(reg.api, 'loggedIn', { get: () => true, configurable: true });
  const all = Array.from({ length: rows }, (_, i) => ({ id: 'i' + i, number: String(5000 + i), upc: '99' + i, name: 'Item ' + i, price: 1 + i % 7, taxRate: 8, quantityStock: 3, memberName: 'NEVER SAVED', customer: 'NEVER SAVED' }));
  reg.api.productPaged = async (k, page, size) => { calls.push(['ProductPaged', k, page, size]); if (fail) return { success: false, message: 'down', unreachable: true }; return { success: true, rows: all.slice((page - 1) * size, page * size), total: all.length }; };
  reg.api.promotionGet = async q => { const t = q.subs.reduce((a, x) => a + x.price * x.quantity, 0); return { success: true, value: { subs: [], totalAmount: t, totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: t } }; };
  reg.api.scan = async c => { calls.push(['scan', c]); return { success: true, value: { id: 'x', itemId: 'i0', productId: 'p0', number: '5000', name: 'Item 0', quantity: 1, rate: 1, price: 1, taxRate: 8 } }; };
  const is = new InstantScan({ reg, dataDir: dir, log: () => {}, shopKey: () => 'shop-a', enqueue: fn => (held.push(fn), Promise.resolve()), listPrice: p => p.price });
  return { dir, reg, calls, is, held };
}
const until = async f => { for (let i = 0; i < 400 && !f(); i++) await new Promise(r => setTimeout(r, 5)); };
(async () => {
  // OFF
  let t = mk(); t.is.onLogin();
  rec('OFF by default: nothing downloaded, nothing saved, no instant scan, no instant search', !t.is.on && !t.calls.length && !fs.readdirSync(t.dir).length && !t.is.canAdd('5000') && !t.is.ready(), fs.readdirSync(t.dir).join(',') || 'empty folder');
  // ON: paged background load at login
  t = mk(); t.is.setOn(true);
  rec('Switched on: the setting is saved on this PC; the list starts loading (page 1 of ' + PAGE + ')', JSON.parse(fs.readFileSync(path.join(t.dir, 'instant-scan.json'), 'utf8')).on === true && t.calls[0][0] === 'ProductPaged' && t.calls[0][3] === PAGE, JSON.stringify(t.calls[0]));
  rec('Until the whole list is in, scans go the old way', !t.is.canAdd('5000'), 'canAdd false while loading');
  await until(() => t.is.ready());
  const f = fs.readdirSync(t.dir).find(x => /^products-/.test(x)), saved = JSON.parse(fs.readFileSync(path.join(t.dir, f), 'utf8'));
  rec('Whole list in after ' + Math.ceil(1203 / PAGE) + ' pages; saved in the app data folder', t.is.ready() && saved.count === 1203 && t.calls.filter(c => c[0] === 'ProductPaged').length === 3, `${saved.count} products, ${f}`);
  rec('Saved file has code, UPC, name, price, tax and line fields only (no stock, no customer data)', Object.keys(saved.rows[0]).sort().join() === 'cat,id,n,name,pid,price,tax,u,unit' && !/NEVER SAVED/.test(JSON.stringify(saved)), Object.keys(saved.rows[0]).sort().join());
  rec('Refreshed only when the app opens: no timer in the code, a second login of the same shop loads nothing again', !/setInterval|setTimeout\(\(\) => this\.(start)?[lL]oad/.test(rd('app/instantscan.js')) && (t.is.onLogin(), t.calls.filter(c => c[0] === 'ProductPaged').length === 3), 'ProductPaged calls stay 3');
  // instant add + the four guards in lib/register.js
  rec('Ready: a listed code goes on the sale at once, marked unconfirmed', t.is.canAdd('5003') && t.is.scanNow('5003').instant && t.reg.subs[0]._unconfirmed === true && t.reg.subs[0].price === 4, `price ${t.reg.subs[0].price}`);
  t.reg.totals.due = 4.32;
  const g = [await t.reg.startPay(), await t.reg.tender({ type: 10, tendered: 10 }), await t.reg.finishSale(), await t.reg.hold()];
  rec('lib/register.js refuses Pay, a payment, Complete and Hold while a line is unconfirmed', g.every(x => x && !x.ok && x.unconfirmed && /still checking/.test(x.message)), g.map(x => x && x.message).join(' | ').slice(0, 160));
  await t.held.shift()(); rec('After the AIR POS check (run from the request queue) the line is confirmed and Pay is allowed', !t.reg.subs[0]._unconfirmed && (await t.reg.startPay()).ok, 'confirmed');
  await t.reg.closePay?.(); t.reg.pay = null; t.reg.subs[0]._unconfirmed = true;
  rec('The unconfirmed mark is never sent to AIR POS (Save sends only its own list of fields)', !JSON.stringify(t.reg.saveSubmit(true)).includes('_unconfirmed') && !JSON.stringify(t.reg.saveSubmit(true)).includes('_code'), 'saveSubmit');
  // download failed at this opening: a saved list under 24 h is used; an older one is not
  const t2 = mk({ fail: true }); fs.copyFileSync(path.join(t.dir, f), path.join(t2.dir, f)); t2.is.setOn(true); await until(() => !t2.is.loading);
  rec('Download failed when the app opened: the saved list (under 24 h old) is used', t2.is.ready() && t2.is.status().from === 'saved', t2.is.status().from);
  const t3 = mk({ fail: true }); const old = { ...saved, at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() }; fs.writeFileSync(path.join(t3.dir, f), JSON.stringify(old)); t3.is.setOn(true); await until(() => !t3.is.loading);
  rec('Download failed and the saved list is over 24 h old: not used, scans go the old way', !t3.is.ready() && !t3.is.canAdd('5000'), 'not ready');
  // switched off: list dropped and deleted
  t.is.setOn(false);
  rec('Switched off: the saved list is deleted and nothing is used', !fs.readdirSync(t.dir).some(x => /^products-/.test(x)) && !t.is.ready() && !t.is.canAdd('5000'), fs.readdirSync(t.dir).join(','));
  // wiring, screen, packaging
  const srv = rd('app/server.js'), ui = rd('app/public/instant.js'), html = rd('app/public/index.html');
  rec('Settings switch "Instant scan" (off unless the saved setting is on), under "Warn before selling below zero stock"; existing labels untouched', /> Instant scan<\/label>/.test(ui) && /seSWnote/.test(ui) && /\$\{I\.on \? 'checked' : ''\}/.test(ui) && html.includes('<script src="/instant.js"></script>'), 'instant.js');
  rec('server.js: the scan answers from the list only when canAdd() says so; otherwise the old route runs unchanged', /name === 'scan' && reg\.api\.loggedIn && b && instant\.canAdd\(b\.code\) \? instant\.scanNow\(b\.code\) : fn\(b\)/ /* wrapped by drawerLog.run on the release branch */.test(srv) && /enqueue: fn => locked\('instant-check', fn\)\(\{\}\)/.test(srv), 'server.js');
  rec('Installer ships app/instantscan.js', /cp -r [^\n]*app\/\*\.js/.test(rd('stage-app.sh')) && fs.existsSync(path.join(__dirname, '..', 'app/instantscan.js')), 'stage-app.sh');
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

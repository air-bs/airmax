// AirMax 1.0.5 bulk item FOLDERS: offline unit tests (no AIR POS account, no network).
// Data: settings.bulkItems (unchanged shape, top-level singles, max 12), settings.bulkFolders [{id,name,items}], settings.bulkOrder ['i:n','f:<id>'].
// Run: node tests/bulkfolders-105.test.js
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { Register } = require('../app/lib/register');
let n = 0, bad = 0; const out = [];
const t = async (name, fn) => { n++; try { await fn(); out.push({ k: name, pass: true }); console.log('ok   ' + name); } catch (e) { bad++; out.push({ k: name, pass: false, note: e.message }); console.log('FAIL ' + name + '\n     ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n     ')); } };
const P = { '111': { name: 'Bulk candy', price: 10, taxRate: 8 }, '222': { name: 'Toy car', price: 5, taxRate: 8 }, '333': { name: 'Rope', price: 2, taxRate: 0 } };
function stub(reg, products = P) {
  const api = reg.api; let id = 0;
  reg.identity = { userName: 'u', currency: 2, superAdmin: true }; reg.home = { terminalConfig: {}, retailConfig: { basicSetting: {} }, authorities: [] }; reg.mode = 'sale';
  api.promotionGet = async s => { const tot = (s.subs || []).reduce((a, x) => a + x.price * x.quantity - (x.discountAmount || 0), 0); const tax = (s.subs || []).reduce((a, x) => a + (x.price * x.quantity - (x.discountAmount || 0)) * (x.taxRate || 0) / 100, 0);
    return { success: true, value: { subs: [], totalAmount: tot, totalTax: tax, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: tot } }; };
  api.scan = async code => { const p = products[code]; if (!p) return { success: false, message: 'Item not found' }; return { success: true, value: { id: 's' + (++id), itemId: 'i' + code, productId: 'p' + code, number: code, name: p.name, quantity: 1, rate: 1, price: p.price, taxRate: p.taxRate == null ? 8 : p.taxRate, discount: 0, discountAmount: 0 } }; };
  api.productPaged = async code => ({ success: true, rows: products[code] ? [{ id: 'i' + code, number: code, quantityStock: 99 }] : [] });
  return reg;
}
function mk(settings = {}) { const r = new Register({ log: () => {} }); r.settingsPath = null; Object.assign(r.settings, settings); return stub(r); }
const it = (label, code, askPrice = false) => ({ label, code, name: label, askPrice });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bf105-'));

(async () => {
  await t('Old settings (no bulkFolders / bulkOrder) load unchanged: same buttons, same order, file not rewritten', async () => {
    const d = tmp(), f = path.join(d, 'settings.json'), old = { bulkItems: [it('Candy', '111'), it('Rope', '333', true)], drawerWaitSec: 3 };
    fs.writeFileSync(f, JSON.stringify(old)); const before = fs.readFileSync(f, 'utf8');
    const r = new Register({ log: () => {}, dataDir: d }); const s = r.state().settings;
    assert.deepStrictEqual(s.bulkItems, old.bulkItems); assert.deepStrictEqual(s.bulkFolders, []); assert.deepStrictEqual(s.bulkOrder, ['i:0', 'i:1']);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), before); assert.ok(!('bulkFolders' in r.settings));
  });
  await t('Save folders: cleaned, ids kept, order kept, written to settings.json next to bulkItems', async () => {
    const d = tmp(), r = new Register({ log: () => {}, dataDir: d });
    const x = r.saveSettings({ bulkItems: [it('Rope', '333')], bulkFolders: [{ id: 'f-candy', name: '  Candy\x07 ', items: [it('Gummy', '111', true), { label: '', code: '' }] }], bulkOrder: ['f:f-candy', 'i:0'] });
    assert.ok(x.ok, x.message);
    const file = JSON.parse(fs.readFileSync(path.join(d, 'settings.json'), 'utf8'));
    assert.deepStrictEqual(file.bulkFolders, [{ id: 'f-candy', name: 'Candy', items: [{ label: 'Gummy', code: '111', name: 'Gummy', askPrice: true }] }]);
    assert.deepStrictEqual(file.bulkOrder, ['f:f-candy', 'i:0']); assert.deepStrictEqual(file.bulkItems, [it('Rope', '333')]);
  });
  await t('bulkOrder repair: unknown / duplicate refs dropped, missing ones added (singles, then folders)', async () => {
    const r = mk(); const x = r.saveSettings({ bulkItems: [it('A', '111'), it('B', '333')], bulkFolders: [{ id: 'f-a', name: 'Nuts', items: [] }, { id: 'f-b', name: 'Candy', items: [] }], bulkOrder: ['f:f-b', 'f:f-b', 'i:7', 'f:f-zz', 'i:1', 7] });
    assert.ok(x.ok, x.message); assert.deepStrictEqual(r.settings.bulkOrder, ['f:f-b', 'i:1', 'i:0', 'f:f-a']);
    // hand-edited file: bad entries skipped on load, never a crash
    r.settings.bulkFolders = [null, { id: 'f-a', name: 'Nuts', items: [null, { label: 'x' }, it('ok', '111')] }, { id: 'f-a', name: 'Dup' }, { name: 'no id' }, 5]; r.settings.bulkOrder = 'garbage';
    const s = r.state().settings; assert.deepStrictEqual(s.bulkFolders, [{ id: 'f-a', name: 'Nuts', items: [it('ok', '111')] }]); assert.deepStrictEqual(s.bulkOrder, ['i:0', 'i:1', 'f:f-a']);
  });
  await t('Limits: 24 items per folder, 24 top spots (12 singles + 12 folders ok, a 13th folder refused), 12 singles kept', async () => {
    const r = mk(); const items24 = Array.from({ length: 24 }, (_, i) => it('I' + i, '111'));
    let x = r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Big', items: items24 }] }); assert.ok(x.ok, x.message);
    x = r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Big', items: [...items24, it('I24', '111')] }] }); assert.ok(!x.ok && /Folder Big is full: up to 24 items/.test(x.message), x.message);
    const singles = Array.from({ length: 12 }, (_, i) => it('S' + i, '333')), f12 = Array.from({ length: 12 }, (_, i) => ({ id: 'f-' + i, name: 'F' + i, items: [] }));
    x = r.saveSettings({ bulkItems: singles, bulkFolders: f12 }); assert.ok(x.ok, x.message); assert.strictEqual(r.state().settings.bulkOrder.length, 24);
    x = r.saveSettings({ bulkFolders: [...f12, { id: 'f-x', name: 'F13', items: [] }] }); assert.ok(!x.ok && /Top level is full: up to 24 spots/.test(x.message), x.message);
    x = r.saveSettings({ bulkItems: Array.from({ length: 20 }, (_, i) => it('B' + i, '111')), bulkFolders: [] }); assert.ok(x.ok); assert.strictEqual(r.settings.bulkItems.length, 12, 'singles still max 12 (older versions cut to 12 too)');
  });
  await t('Folder names: required, up to 20 letters, unique ignoring case; nested folders refused; bad ids replaced', async () => {
    const r = mk();
    assert.ok(/Give every folder a name/.test(r.saveSettings({ bulkFolders: [{ id: 'f-a', name: '  ', items: [] }] }).message));
    assert.ok(/too long/.test(r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'x'.repeat(21), items: [] }] }).message));
    assert.ok(/Two folders are called/.test(r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Candy', items: [] }, { id: 'f-b', name: 'CANDY', items: [] }] }).message));
    assert.ok(/folders inside folders/.test(r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Candy', items: [{ label: 'Sub', code: '1', items: [] }] }] }).message));
    assert.ok(/pick a product/.test(r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Candy', items: [{ label: 'No code', code: '' }] }] }).message));
    assert.ok(/not valid/.test(r.saveSettings({ bulkFolders: 'x' }).message)); assert.ok(/not valid/.test(r.saveSettings({ bulkOrder: { a: 1 } }).message));
    const x = r.saveSettings({ bulkFolders: [{ id: '../bad', name: 'A', items: [] }, { id: 'f-same', name: 'B', items: [] }, { id: 'f-same', name: 'C', items: [] }] }); assert.ok(x.ok, x.message);
    const ids = r.settings.bulkFolders.map(f => f.id); assert.strictEqual(new Set(ids).size, 3); assert.ok(ids.every(i => /^f-[A-Za-z0-9]+$/.test(i))); assert.strictEqual(ids[1], 'f-same');
  });
  await t('Whole-save check: one bad part refuses the WHOLE save (bulkItems, bulkFolders, bulkOrder and other settings untouched)', async () => {
    const r = mk(); r.saveSettings({ bulkItems: [it('Rope', '333')], bulkFolders: [{ id: 'f-a', name: 'Candy', items: [it('Gummy', '111')] }] });
    const snap = JSON.stringify(r.settings);
    let x = r.saveSettings({ bulkItems: [it('New', '111'), it('Other', '222')], bulkFolders: [{ id: 'f-a', name: 'Candy', items: [{ label: 'bad', code: '' }] }], drawerWaitSec: 9 });
    assert.ok(!x.ok && /pick a product/.test(x.message)); assert.strictEqual(JSON.stringify(r.settings), snap, 'nothing applied');
    x = r.saveSettings({ bulkItems: [{ label: 'bad', code: '' }], bulkFolders: [{ id: 'f-b', name: 'Nuts', items: [] }] }); assert.ok(!x.ok); assert.strictEqual(JSON.stringify(r.settings), snap);
    x = r.saveSettings({ bulkItems: [it('A', '111')], bulkFolders: Array.from({ length: 24 }, (_, i) => ({ id: 'f-' + i, name: 'F' + i, items: [] })) }); assert.ok(!x.ok && /Top level is full/.test(x.message)); assert.strictEqual(JSON.stringify(r.settings), snap);
    x = r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Candy', items: [] }, { id: 'f-b', name: 'candy', items: [] }] }); assert.ok(!x.ok); assert.strictEqual(JSON.stringify(r.settings), snap);
  });
  await t('A bulkItems-only save (1.0.4 style) keeps the folders and repairs the order', async () => {
    const r = mk(); r.saveSettings({ bulkItems: [it('A', '111'), it('B', '333')], bulkFolders: [{ id: 'f-a', name: 'Candy', items: [it('G', '111')] }], bulkOrder: ['i:1', 'f:f-a', 'i:0'] });
    const x = r.saveSettings({ bulkItems: [it('A', '111')] }); assert.ok(x.ok); assert.strictEqual(r.settings.bulkFolders.length, 1); assert.deepStrictEqual(r.settings.bulkOrder, ['f:f-a', 'i:0']);
  });
  await t('Folder button adds the right product; empty slot / unknown folder = plain message; refused in return mode', async () => {
    const r = mk(); r.saveSettings({ bulkItems: [it('Rope', '333')], bulkFolders: [{ id: 'f-a', name: 'Candy', items: [it('Toy', '222'), it('Gummy', '111')] }] });
    let x = await r.addBulk(1, undefined, 'f-a'); assert.ok(x.ok, x.message); assert.deepStrictEqual(r.subs.map(s => s.number), ['111']);
    x = await r.addBulk(0); assert.ok(x.ok); assert.deepStrictEqual(r.subs.map(s => s.number).sort(), ['111', '333'], 'no folder = top-level single (1.0.4 call)');
    x = await r.addBulk(5, undefined, 'f-a'); assert.ok(!x.ok && /empty/.test(x.message));
    x = await r.addBulk(0, undefined, 'f-zz'); assert.ok(!x.ok && /empty/.test(x.message));
    const r2 = mk(); r2.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Candy', items: [it('Gummy', '111')] }] }); r2.mode = 'return'; x = await r2.addBulk(0, undefined, 'f-a'); assert.ok(!x.ok);
  });
  await t('Ask price inside a folder: same rules (lower = line discount, higher refused and removed)', async () => {
    const r = mk(); r.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Candy', items: [it('Gummy', '111', true)] }] });
    let x = await r.addBulk(0, undefined, 'f-a'); assert.ok(!x.ok && x.needPrice);
    x = await r.addBulk(0, 7.5, 'f-a'); assert.ok(x.ok, x.message); assert.strictEqual(r.subs[0].discountAmount, 2.5);
    const r2 = mk(); r2.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Candy', items: [it('Gummy', '111', true)] }] });
    x = await r2.addBulk(0, 12, 'f-a'); assert.ok(!x.ok && /above the AIR POS price/.test(x.message)); assert.strictEqual(r2.subs.length, 0);
  });
  await t('Totals unchanged: folder button = top-level button = plain scan of the same products', async () => {
    const folder = mk(), single = mk(), scan = mk();
    folder.saveSettings({ bulkFolders: [{ id: 'f-a', name: 'Mix', items: [it('Gummy', '111'), it('Rope', '333'), it('Toy', '222', true)] }] });
    single.saveSettings({ bulkItems: [it('Gummy', '111'), it('Rope', '333'), it('Toy', '222', true)] });
    await folder.addBulk(0, undefined, 'f-a'); await folder.addBulk(1, undefined, 'f-a'); await folder.addBulk(1, undefined, 'f-a'); await folder.addBulk(2, 4, 'f-a');
    await single.addBulk(0); await single.addBulk(1); await single.addBulk(1); await single.addBulk(2, 4);
    await scan.scan('111'); await scan.scan('333'); await scan.scan('333');
    const tf = JSON.stringify(folder.state().totals), ts = JSON.stringify(single.state().totals);
    assert.strictEqual(tf, ts); assert.deepStrictEqual(folder.subs.map(s => [s.number, s.quantity, s.price, s.discountAmount]), single.subs.map(s => [s.number, s.quantity, s.price, s.discountAmount]));
    const key = r => r.subs.filter(s => s.number !== '222').map(s => [s.number, s.quantity, s.price, s.discountAmount || 0]).sort().join('|');
    assert.strictEqual(key(folder), key(scan));
  });
  const OLD = '/workspace/air-register-1.2.3-release/app/lib/register.js';
  await t('Older version (store 1.2.3 register.js, read-only) ignores the folders and keeps them in settings.json when it saves', async () => {
    if (!fs.existsSync(OLD)) throw new Error('store 1.2.3 copy missing: ' + OLD);
    const d = tmp(), f = path.join(d, 'settings.json');
    const cur = new Register({ log: () => {}, dataDir: d }); assert.ok(cur.saveSettings({ bulkItems: [it('Rope', '333')], bulkFolders: [{ id: 'f-a', name: 'Candy', items: [it('Gummy', '111')] }], bulkOrder: ['f:f-a', 'i:0'] }).ok);
    const { Register: Old } = require(OLD); const o = new Old({ log: () => {}, dataDir: d }); o.identity = { userName: 'u', superAdmin: true };
    assert.deepStrictEqual(o.state().settings.bulkItems, [it('Rope', '333')]);
    const x = o.saveSettings({ drawerWaitSec: 4 }); assert.ok(x.ok, x.message);
    const file = JSON.parse(fs.readFileSync(f, 'utf8')); assert.strictEqual(file.drawerWaitSec, 4); assert.strictEqual(file.bulkFolders.length, 1); assert.deepStrictEqual(file.bulkOrder, ['f:f-a', 'i:0']);
    const back = new Register({ log: () => {}, dataDir: d }); assert.strictEqual(back.state().settings.bulkFolders[0].items[0].code, '111');
  });
  console.log(`\n${n - bad}/${n} bulk folder (1.0.5) unit tests passed`);
  fs.writeFileSync(path.join(__dirname, 'bulkfolders-105-results.json'), JSON.stringify(out, null, 1));
  process.exit(bad ? 1 : 0);
})();

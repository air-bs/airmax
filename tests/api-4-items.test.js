// AirMax Batch 4 (Items and stock): the six READ calls on the fake AIR POS (offline, made-up data, no real store, no browser).
//   23 ProductGet, 28 RetailQuickSellingProductPaged, 32 RetailInboundOrderPaged, 33 RetailInboundOrderGet, 34 DashboardModelGet, 143 RetailEslGet
//   node tests/api-4-items.test.js     (port: API4_PORT, default 5240; hook server on API4_PORT+5)
// Starts its OWN fake server several times (login roles: super admin, cashier, manager without / with the Product Management menu).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PORT = Number(process.env.API4_PORT || 5240), HOOK = PORT + 5, BASE = 'http://127.0.0.1:' + PORT;
const fails = []; let passes = 0;
const rec = (k, pass, note) => { if (!pass) fails.push(k); else passes++; console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' - ' + String(note).slice(0, 220) : '')); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(async r => ({ status: r.status, j: await r.json() }));
const state = () => fetch('http://127.0.0.1:' + HOOK + '/items-state').then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALLCALLS = [];

async function withServer(role, fn) {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'api4-')), log = path.join(T, 'srv.log'), data = path.join(T, 'data');
  const env = { ...process.env, FAKE_PORT: String(PORT), FAKE_HOOK_PORT: String(HOOK), FAKE_DATA_DIR: data };
  if (role) env.FAKE_ITEMS_ROLE = role; else delete env.FAKE_ITEMS_ROLE;
  const srv = cp.spawn(process.execPath, [path.join(__dirname, 'look-fake.js')], { env, stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')] });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/shortcuts'); await state(); break; } catch (e) { await sleep(250); } }
    await fn({ log: () => fs.readFileSync(log, 'utf8'), data });
    ALLCALLS.push(...(await state()).calls.map(c => c.path));
  } finally { srv.kill(); await sleep(400); fs.rmSync(T, { recursive: true, force: true }); }
}
const login = () => post('login', { company: 'fake shop', user: 'tester', password: process.env.AIRMAX_TEST_PW || 'x' });
const WRITE = /\/Products\/(ProductAdd|ProductUpdate|ProductPriceSave|QuickSellingProductAdd|QuickSellingProductRemove)$/;
const writeCount = async () => (await state()).calls.filter(c => WRITE.test(c.path)).length;
const hook = (p) => fetch('http://127.0.0.1:' + HOOK + p).then(r => r.json());
let roWrites = 0; // write calls that reached the fake in the cashier / no-permission runs (must stay 0)
const callsTo = async p => (await state()).calls.filter(c => c.path === p);

(async () => {
  try {
    // ---------------- super admin (the fake's normal login: a manager with every menu) ----------------
    await withServer('', async ({ log, data }) => {
      rec('1 the plugin loads with its 15 routes (8 reads, 7 writes / helpers)', /API plugins:.*items\.js \(15 routes\)/.test(log()), (log().match(/API plugins:[^\n]*/) || [''])[0]);
      const lo = await post('items-get', { id: 'p-1001' });
      rec('2 logged out: a plugin route needs a login (loggedOut)', lo.j.ok === false && lo.j.loggedOut === true, JSON.stringify(lo.j));
      await login();
      const ac = (await post('items-access')).j;
      rec('3 items-access (manager + permission): canEdit, canSeeCost, canSeeDashboard true; ESL off by default', ac.ok && ac.manager && ac.canEdit && ac.canSeeCost && ac.canSeeDashboard && ac.eslOn === false, JSON.stringify(ac));

      // 23 ProductGet
      const g = (await post('items-get', { id: 'p-1001' })).j, pr = g.product || {};
      rec('4 [23 ProductGet] one product: number, name, UPC, category, origin, stock, items; sent as productId', g.ok && pr.number === '1001' && pr.name === 'Bulk candy (lb)' && pr.upc === '0000000001905' && pr.categoryName === 'Candy' && pr.originName === 'Anguilla' && pr.stock === 50 && pr.items.length === 1 && pr.items[0].upcs[0] === '0000000001905' && (await callsTo('/Products/ProductGet'))[0].params.productId === 'p-1001', JSON.stringify(pr).slice(0, 200));
      rec('5 [23] shop price wins over the standard (corp) price; both shown; manager also gets the cost; tax kind read from shopTaxKindId', pr.price === 10 && pr.shop === 10 && pr.standard === 11.5 && pr.source === 'shop' && pr.costPrice === 4.25 && pr.enabled === true && pr.isRetailRefund === true && pr.taxKindId === 'tk-8' && pr.shopTaxKindId === 'tk-8' && pr.taxRate === 8, JSON.stringify({ p: pr.price, s: pr.shop, g: pr.standard, c: pr.costPrice }));
      const g2 = (await post('items-get', { id: 'p-1002' })).j.product || {};
      rec('6 [23] only a standard price: price = standard, source "standard"; zero stock stays 0; two packings and two barcodes; refundable off', g2.price === 5 && g2.source === 'standard' && g2.shop === null && g2.stock === 0 && g2.items.length === 2 && g2.items[1].unitName === 'Box' && g2.items[1].rate === 12 && g2.items[0].upcs.length === 2 && g2.isRetailRefund === false, JSON.stringify({ p: g2.price, src: g2.source, st: g2.stock }));
      const gm = (await post('items-get', { id: 'p-nope' })).j;
      rec('7 [23] AIR POS refusal (not found) -> ok:false with the reason, no crash', gm.ok === false && /not found/i.test(gm.message), JSON.stringify(gm));
      const before = (await state()).calls.length;
      const bad = await Promise.all([post('items-get', { id: '../x y' }), post('items-get', {}), post('items-get', { id: 'a'.repeat(80) })]);
      rec('8 [23] a missing / odd id is refused here and nothing is sent to AIR POS', bad.every(x => x.j.ok === false) && (await state()).calls.length === before, JSON.stringify(bad.map(x => x.j.message)));
      const fd = (await post('items-find', { keyword: 'candy' })).j;
      rec('9 items-find (existing ProductPaged search): rows carry id, number, name, price, stock', fd.ok && fd.rows.length >= 1 && fd.rows[0].id && fd.rows[0].number === '1001' && fd.rows[0].price != null && fd.rows[0].stock === 50 && fd.total >= 1, JSON.stringify(fd).slice(0, 200));

      // 28 quick-add grid
      const q = (await post('items-quick', {})).j;
      rec('10 [28 RetailQuickSellingProductPaged] the grid: 2 tiles with id, productId, number, name, price', q.ok && q.total === 2 && q.rows.length === 2 && q.rows[0].id === 'q-1' && q.rows[0].productId === 'p-1001' && q.rows[0].price === 10 && q.rows[1].number === '1003', JSON.stringify(q).slice(0, 220));
      const q2 = (await post('items-quick', { keyword: 'rope', page: 1, pageSize: 5 })).j, qc = (await callsTo('/Products/RetailQuickSellingProductPaged')).pop();
      rec('11 [28] keyword filter and paging are sent as AIR POS expects (filter + pageInfo JSON)', q2.ok && q2.rows.length === 1 && q2.rows[0].name === 'Rope (ft)' && JSON.parse(qc.params.filter).keyword === 'rope' && JSON.parse(qc.params.pageInfo).pageSize === 5, qc.params.filter + qc.params.pageInfo);
      await post('items-quick', { pageSize: 9999, page: -4 }); const qp = JSON.parse((await callsTo('/Products/RetailQuickSellingProductPaged')).pop().params.pageInfo);
      rec('12 [28] page size is capped at 100 and the page never goes below 1', qp.pageSize === 100 && qp.page === 1, JSON.stringify(qp));

      // 32 / 33 receiving orders
      const ib = (await post('items-inbound', {})).j;
      rec('13 [32 RetailInboundOrderPaged] list: 3 orders with number, status, quantity, created, creator', ib.ok && ib.total === 3 && ib.rows[0].number === 'IN-0001' && ib.rows[0].statusName === 'Completed' && ib.rows[0].quantity === 24 && ib.rows[0].creatorName && ib.rows[0].subs === undefined, JSON.stringify(ib.rows && ib.rows[0]));
      const ib2 = (await post('items-inbound', { status: 20 })).j, ib3 = (await post('items-inbound', { number: 'IN-0002' })).j, ib4 = (await post('items-inbound', { productNumber: '1003' })).j, ib5 = (await post('items-inbound', { beginDate: '2026-11-02', endDate: '2026-11-30' })).j;
      rec('14 [32] filters: status, order number, item number, date range', ib2.total === 1 && ib2.rows[0].number === 'IN-0001' && ib3.total === 1 && ib3.rows[0].id === 'in-2' && ib4.total === 1 && ib4.rows[0].id === 'in-2' && ib5.total === 1 && ib5.rows[0].number === 'IN-0002', [ib2.total, ib3.total, ib4.total, ib5.total].join());
      const nb = (await state()).calls.length, bd = (await post('items-inbound', { beginDate: 'yesterday' })).j;
      rec('15 [32] a bad date is refused here, nothing sent', bd.ok === false && /Dates/.test(bd.message) && (await state()).calls.length === nb, JSON.stringify(bd));
      const od = (await post('items-inbound-get', { id: 'in-1' })).j;
      rec('16 [33 RetailInboundOrderGet] one order with lines (read from the { success, value } reply shape)', od.ok && od.order.number === 'IN-0001' && od.order.subs.length === 1 && od.order.subs[0].name === 'Toy car' && od.order.subs[0].quantityTotal === 24 && od.order.subs[0].unitName === 'Box', JSON.stringify(od.order).slice(0, 220));
      const om = (await post('items-inbound-get', { id: 'in-zz' })).j;
      rec('17 [33] unknown order -> ok:false with the reason', om.ok === false && /not found/i.test(om.message), JSON.stringify(om));

      // 34 dashboard
      const d = (await post('items-dashboard')).j, m = d.model || {};
      rec('18 [34 DashboardModelGet] manager: today / last 30 days / stock / receiving numbers and chart points', d.ok && m.orderSumToday.amount === 120.5 && m.orderSumToday.orderCount === 6 && m.orderSumRecent.amount === 4210 && m.stockSum.lowStockCount === 3 && m.inboundOrderSum.quantity === 524 && m.saleRateSum.amountRate === -2 && m.saleChartItems.length === 2 && m.saleChartItems[0].name === '11/01', JSON.stringify(m).slice(0, 200));

      // 143 ESL (setting off, then on)
      const n0 = (await callsTo('/Esls/RetailEslGet')).length, e0 = (await post('items-esl-get', { id: 'esl-1' })).j;
      rec('19 [143 RetailEslGet] ESL setting OFF: no call is made, answer says it is off', e0.ok === false && e0.eslOff === true && (await callsTo('/Esls/RetailEslGet')).length === n0, JSON.stringify(e0));
      fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'label-settings.json'), JSON.stringify({ esl: true }));
      const ac2 = (await post('items-access')).j, e1 = (await post('items-esl-get', { id: 'esl-1' })).j;
      rec('20 [143] ESL setting ON: the label is read (code, status, product, battery) and items-access says eslOn', ac2.eslOn === true && e1.ok && e1.esl.code === 'ESL-TEST-0001' && e1.esl.productNumber === '1001' && e1.esl.battery === 87 && (await callsTo('/Esls/RetailEslGet')).pop().params.id === 'esl-1', JSON.stringify(e1).slice(0, 200));
      const e2 = (await post('items-esl-get', { id: 'esl-x' })).j, e3 = (await post('items-esl-get', {})).j;
      rec('21 [143] unknown label -> reason shown; no id -> asked for one (nothing sent)', e2.ok === false && /not found/i.test(e2.message) && e3.ok === false && /Pick a label/.test(e3.message), JSON.stringify([e2.message, e3.message]));
      fs.writeFileSync(path.join(data, 'label-settings.json'), JSON.stringify({ esl: 'yes' }));
      rec('22 [143] only a real true turns ESL on (a text "yes" = off)', (await post('items-access')).j.eslOn === false, '');

      // ================= WRITES (manager + permission) =================
      const lk = (await post('lookups-all')).j;
      rec("30 Batch 1's lookups-all feeds the form: departments (nested as \"Made-up Toys > Cars\", one disabled), origins with codes, tax kinds", lk.ok && lk.categories.flat.some(c => c.id === 'c-2') && lk.categories.flat.some(c => c.path === 'Made-up Toys > Cars' && c.id === 'c-1a') && lk.categories.flat.some(c => c.disable) && lk.origins.rows.some(o => o.code === 'AR') && lk.taxKinds.rows.some(t => t.id === 'tk-8' && t.rate === 8), JSON.stringify(Object.keys(lk)));
      const w0 = await writeCount();
      const badAdds = await Promise.all([{ number: '', name: 'x', categoryId: 'c-2' }, { number: 'ZZ', name: '', categoryId: 'c-2' }, { number: 'ZZ', name: 'x', categoryId: '' }, { number: 'N'.repeat(51), name: 'x', categoryId: 'c-2' }, { number: 'ZZ', name: 'n'.repeat(101), categoryId: 'c-2' }, { number: 'ZZ\nX', name: 'x', categoryId: 'c-2' }, { number: 'ZZ', name: 'x', categoryId: 'c-2', upc: 'u'.repeat(51) }].map(x => post('items-add', x)));
      rec('31 [25 ProductAdd] bad input (no code / name / department, too long, control character) is refused here; nothing is sent', badAdds.every(x => x.j.ok === false) && (await writeCount()) === w0, JSON.stringify(badAdds.map(x => x.j.message)).slice(0, 220));
      const ad = (await post('items-add', { number: 'ZZ-B4-TEST', name: 'Batch 4 test item', upc: '0000000009999', categoryId: 'c-2', originCode: 'AR', enabled: true, isRetailRefund: true })).j;
      const NEWID = ad.id; const addCall = (await callsTo('/Products/ProductAdd')).pop(), sub = JSON.parse(addCall.params.submit);
      rec('32 [25] a new item is added: id comes back, AIR POS got number / name / upc / categoryId / originCode / enabled / isRetailRefund (a new GUID id made here, no picture)', ad.ok && /^[0-9a-f-]{36}$/.test(ad.id) && sub.number === 'ZZ-B4-TEST' && sub.name === 'Batch 4 test item' && sub.upc === '0000000009999' && sub.categoryId === 'c-2' && sub.originCode === 'AR' && sub.enabled === true && sub.isRetailRefund === true && /^[0-9a-f-]{36}$/.test(sub.id) && sub.id === ad.id && sub.titleImageRemoved === false, JSON.stringify(ad));
      const ng = (await post('items-get', { id: ad.id })).j.product || {};
      rec('33 [25] the new item reads back with stock 0, enabled, no price yet', ng.number === 'ZZ-B4-TEST' && ng.stock === 0 && ng.enabled === true && ng.price === null, JSON.stringify({ n: ng.number, s: ng.stock, p: ng.price }));
      const dup = (await post('items-add', { number: 'ZZ-B4-TEST', name: 'again', categoryId: 'c-2' })).j;
      rec('34 [25] a duplicate lookup code: AIR POS reason shown, nothing added', dup.ok === false && /already exists/i.test(dup.message), JSON.stringify(dup));
      const up = (await post('items-update', { id: NEWID, name: 'Batch 4 test item (edited)', upc: '0000000008888' })).j, ug = (await post('items-get', { id: NEWID })).j.product, usub = JSON.parse((await callsTo('/Products/ProductUpdate')).pop().params.submit);
      rec('35 [26 ProductUpdate] edit: changed fields saved, the others keep their value (fresh 23 read first); id sent', up.ok && ug.name === 'Batch 4 test item (edited)' && ug.upc === '0000000008888' && ug.number === 'ZZ-B4-TEST' && ug.categoryId === 'c-2' && usub.id === NEWID && usub.originCode === 'AR' && usub.enabled === true, JSON.stringify(usub));
      const ko = (await post('items-update', { id: NEWID, originCode: 'AA001' })).j, kg = (await post('items-get', { id: NEWID })).j.product || {};
      rec('35b [26] an origin set to its KEY (AA001, an origin with no code) is sent as originCode and reads back as originCode AA001 / originName Anguilla (verified on TestShop: AIR POS keeps the key)', ko.ok && JSON.parse((await callsTo('/Products/ProductUpdate')).pop().params.submit).originCode === 'AA001' && kg.originCode === 'AA001' && kg.originName === 'Anguilla', JSON.stringify({ c: kg.originCode, n: kg.originName }));
      const un = (await post('items-update', { id: 'p-nope', name: 'x' })).j, ud = (await post('items-update', { id: NEWID, number: '1001' })).j, uv = (await post('items-update', { id: NEWID, name: '' })).j;
      rec('36 [26] unknown item / duplicate code / empty name: refused with the reason', un.ok === false && /not found/i.test(un.message) && ud.ok === false && /already exists/i.test(ud.message) && uv.ok === false && /Name is required/.test(uv.message), JSON.stringify([un.message, ud.message, uv.message]));
      const wd = await writeCount(), d0 = (await post('items-disable', { id: NEWID })).j;
      rec('37 [26] Disable Item needs confirm: without it nothing is sent', d0.ok === false && d0.needConfirm === true && (await writeCount()) === wd, JSON.stringify(d0));
      const d1 = (await post('items-disable', { id: NEWID, confirm: true })).j, dg = (await post('items-get', { id: NEWID })).j.product;
      rec('38 [26] Disable Item (confirmed): enabled=false saved, name / code / department unchanged', d1.ok && dg.enabled === false && dg.name === 'Batch 4 test item (edited)' && dg.number === 'ZZ-B4-TEST' && dg.categoryId === 'c-2', JSON.stringify({ e: dg.enabled }));
      const en = (await post('items-update', { id: NEWID, enabled: true })).j, eg = (await post('items-get', { id: NEWID })).j.product;
      rec('39 [26] the Enabled switch turns it back on (items-update)', en.ok && eg.enabled === true, '');

      // ---- 27 ProductPriceSave ----
      const pv = (await post('items-price-preview', { id: 'p-1001', prices: { 'i-1001': '11.00' } })).j, w1 = await writeCount();
      rec('40 [27] preview: old $10 -> new $11, +10.0%, item name; writes nothing', pv.ok && pv.lines.length === 1 && pv.lines[0].old === 10 && pv.lines[0].new === 11 && pv.lines[0].pct === 10 && pv.name === 'Bulk candy (lb)' && pv.nothingChanges === false && w1 === (await writeCount()) && !(await state()).calls.some(c => c.path.endsWith('ProductPriceSave')), JSON.stringify(pv).slice(0, 200));
      const pv2 = (await post('items-price-preview', { id: 'p-1001', prices: { 'i-1001': 10 } })).j, pv3 = (await post('items-price-preview', { id: 'p-1002', prices: { 'i-1002b': 50 }, taxKindId: 'tk-0' })).j, pv4 = (await post('items-price-preview', { id: 'p-1002', prices: { 'i-1002b': 50 } })).j;
      rec('41 [27] preview: same price -> nothingChanges; a packing with no shop price yet shows old = none (no %); an item with no tax kind and none chosen is refused', pv2.ok && pv2.nothingChanges === true && pv3.ok && pv3.lines[0].old === null && pv3.lines[0].pct === null && pv3.lines[0].unitName === 'Box' && pv3.taxKindId === 'tk-0' && pv4.ok === false && /tax kind/i.test(pv4.message), JSON.stringify([pv2.nothingChanges, pv3.lines, pv4.message]));
      const badP = await Promise.all([-1, 1.234, 'abc', '', '1e9', 99999999, null, true, '1,5'].map(v => post('items-price-preview', { id: 'p-1001', prices: { 'i-1001': v } })));
      const ok0 = (await post('items-price-preview', { id: 'p-1001', prices: { 'i-1001': 0 } })).j, ok2 = (await post('items-price-preview', { id: 'p-1001', prices: { 'i-1001': '12.5' } })).j;
      rec('42 [27] price rules: negative, 3 decimals, text, empty, huge, null, true, "1,5" refused; 0 and 12.5 accepted', badP.every(x => x.j.ok === false && /number, 0 or more/.test(x.j.message)) && ok0.ok && ok2.ok, JSON.stringify(badP.map(x => x.j.ok)));
      const bi = await Promise.all([post('items-price-preview', { id: 'p-1001', prices: { 'i-zzz': 5 } }), post('items-price-preview', { id: 'p-1001', prices: {} }), post('items-price-preview', { id: 'p-1001', prices: { 'i-1002': 5 } }), post('items-price-preview', { id: 'p-nope', prices: { 'i-1': 5 } }), post('items-price-preview', { prices: { 'i-1': 5 } }), post('items-price-preview', { id: 'p-1001', prices: { 'i-1001': 5 }, taxKindId: 'bad id!' })]);
      rec('43 [27] a packing of another item, no prices, unknown item, no id, odd tax kind id: all refused', bi.every(x => x.j.ok === false), JSON.stringify(bi.map(x => x.j.message)));
      const w2 = await writeCount();
      const n1 = (await post('items-price', { id: 'p-1001', prices: { 'i-1001': 11 } })).j, n2 = (await post('items-price', { id: 'p-1001', prices: { 'i-1001': 11 }, confirm: true })).j, n3 = (await post('items-price', { id: 'p-1001', prices: { 'i-1001': 11 }, confirm: 'true', seen: { 'i-1001': 10 } })).j;
      rec('44 [27] saving without confirm:true (or with a text "true"), or without the old prices the box showed, writes nothing', n1.ok === false && n1.needConfirm && n2.ok === false && n2.needConfirm && n3.ok === false && n3.needConfirm && (await writeCount()) === w2, JSON.stringify([n1.message, n2.message, n3.message]));
      const sv = (await post('items-price', { id: 'p-1001', prices: { 'i-1001': 11 }, confirm: true, seen: { 'i-1001': 10 } })).j, cs = (await state()).calls, pi = cs.map(c => c.path).lastIndexOf('/Products/ProductPriceSave'), psub = JSON.parse(cs[pi].params.submit);
      rec('45 [27] confirmed: AIR POS got shopId (this shop), productId, tax kind and a line per packing; ProductGet (23) was read right before', sv.ok && psub.shopId === 'shop' && psub.productId === 'p-1001' && psub.taxKindId === 'tk-8' && psub.subs.length === 1 && psub.subs[0].itemId === 'i-1001' && psub.subs[0].price === 11 && cs[pi - 1].path === '/Products/ProductGet', JSON.stringify(psub));
      rec('46 [27] the answer carries the re-read item with the new price; reading again agrees', sv.product && sv.product.price === 11 && sv.lines[0].old === 10 && sv.lines[0].new === 11 && (await post('items-get', { id: 'p-1001' })).j.product.price === 11, JSON.stringify(sv.lines));
      const n4 = (await post('items-price', { id: 'p-1001', prices: { 'i-1001': 11 }, confirm: true, seen: { 'i-1001': 11 } })).j;
      rec('47 [27] the same price again: "nothing to save", no write', n4.ok === false && n4.unchanged === true, JSON.stringify(n4));
      await hook('/items-bump-price?id=p-1001&price=12'); const w3 = await writeCount();
      const st1 = (await post('items-price', { id: 'p-1001', prices: { 'i-1001': 15 }, confirm: true, seen: { 'i-1001': 11 } })).j;
      rec('48 [27] someone changed the price after the box was shown ($11 -> $12): nothing saved, the new old price is returned', st1.ok === false && st1.changed === true && st1.lines[0].old === 12 && (await writeCount()) === w3, JSON.stringify(st1).slice(0, 200));
      await hook('/items-fail-price?on=1'); const fp = (await post('items-price', { id: 'p-1001', prices: { 'i-1001': 15 }, confirm: true, seen: { 'i-1001': 12 } })).j; await hook('/items-fail-price?on=0');
      rec('49 [27] AIR POS refuses the save: reason shown, ok:false, the old price is still there', fp.ok === false && /refused/.test(fp.message) && (await post('items-get', { id: 'p-1001' })).j.product.price === 12, JSON.stringify(fp));
      const bx = (await post('items-price', { id: 'p-1002', prices: { 'i-1002b': 50 }, taxKindId: 'tk-0', confirm: true, seen: { 'i-1002b': null } })).j, bxs = JSON.parse((await callsTo('/Products/ProductPriceSave')).pop().params.submit);
      rec('50 [27] two packings: the one that was not edited is sent with its current price (Each $5), the edited one with the new price (Box $50)', bx.ok && bxs.subs.length === 2 && bxs.subs.find(u => u.itemId === 'i-1002').price === 5 && bxs.subs.find(u => u.itemId === 'i-1002b').price === 50, JSON.stringify(bxs.subs));

      // ---- 29 / 30 Quick Add grid ----
      const qa = (await post('items-quick-add', { id: 'p-1002' })).j, ql = (await post('items-quick', {})).j, qd = (await post('items-quick-add', { id: 'p-1002' })).j, qn = (await post('items-quick-add', { id: 'p-nope' })).j;
      rec('51 [29 QuickSellingProductAdd] item added to the grid (sent as productId); a second add and an unknown item are refused with the reason', qa.ok && ql.total === 3 && ql.rows.some(r => r.productId === 'p-1002') && qd.ok === false && /Already/.test(qd.message) && qn.ok === false && JSON.parse((await callsTo('/Products/QuickSellingProductAdd'))[0].params.submit).productId === 'p-1002', JSON.stringify([qa.message, qd.message, qn.message]));
      const gid = ql.rows.find(r => r.productId === 'p-1002').id, wq = await writeCount(), qrp = (await post('items-quick-remove', { id: 'p-1002' })).j;
      rec('52 [30 QuickSellingProductRemove] removing with the PRODUCT id does not remove anything (AIR POS: tile not found)', qrp.ok === false && /not found/i.test(qrp.message) && (await post('items-quick', {})).j.total === 3, JSON.stringify(qrp));
      const qr = (await post('items-quick-remove', { id: gid })).j, ql2 = (await post('items-quick', {})).j, qno = (await post('items-quick-remove', {})).j;
      rec('53 [30] removing with the grid-entry id (from items-quick) works; the item itself stays; no id = asked for one', qr.ok && ql2.total === 2 && !ql2.rows.some(r => r.id === gid) && (await post('items-get', { id: 'p-1002' })).j.ok && qno.ok === false && JSON.parse((await callsTo('/Products/QuickSellingProductRemove')).pop().params.submit).id === gid, JSON.stringify([qr.message, qno.message]));

      // ---- every write is also refused while ESL etc. do nothing odd: odd ids never reach AIR POS ----
      const wo = await writeCount(), odd = await Promise.all([post('items-quick-add', { id: '../x' }), post('items-quick-remove', { id: 'a b' }), post('items-disable', { id: 'x'.repeat(70), confirm: true }), post('items-update', { id: '"; drop', name: 'x' })]);
      rec('54 writes with an odd id are refused here and never reach AIR POS', odd.every(x => x.j.ok === false) && (await writeCount()) === wo, JSON.stringify(odd.map(x => x.j.message)));
    });

    // ---------------- cashier ----------------
    await withServer('cashier', async ({ data }) => {
      await login();
      const ac = (await post('items-access')).j;
      rec('23 cashier: items-access says not manager, no edit, no cost, no dashboard', ac.ok && ac.manager === false && ac.canEdit === false && ac.canSeeCost === false && ac.canSeeDashboard === false, JSON.stringify(ac));
      const g = (await post('items-get', { id: 'p-1001' })).j, f = (await post('items-find', { keyword: 'candy' })).j, q = (await post('items-quick')).j, ib = (await post('items-inbound')).j, ibg = (await post('items-inbound-get', { id: 'in-1' })).j;
      rec('24 cashier may look: item, search, quick-add grid, receiving list and one order all answer', g.ok && f.ok && q.ok && ib.ok && ibg.ok, [g.ok, f.ok, q.ok, ib.ok, ibg.ok].join());
      rec('25 cashier never receives the item cost', g.product.costPrice === undefined && g.product.price === 10, JSON.stringify(Object.keys(g.product)));
      const n = (await state()).calls.length, d = (await post('items-dashboard')).j;
      fs.mkdirSync(data, { recursive: true }); fs.writeFileSync(path.join(data, 'label-settings.json'), JSON.stringify({ esl: true }));
      const e = (await post('items-esl-get', { id: 'esl-1' })).j;
      rec('26 cashier: dashboard and ESL are refused here (forbidden) and AIR POS is not called, even with ESL on', d.ok === false && d.forbidden === true && e.ok === false && e.forbidden === true && (await state()).calls.length === n, JSON.stringify([d.message, e.message]));
      const WR = [['items-add', { number: 'ZZ-X', name: 'x', categoryId: 'c-2' }], ['items-update', { id: 'p-1001', name: 'x' }], ['items-disable', { id: 'p-1001', confirm: true }], ['items-price-preview', { id: 'p-1001', prices: { 'i-1001': 1 } }], ['items-price', { id: 'p-1001', prices: { 'i-1001': 1 }, confirm: true, seen: { 'i-1001': 10 } }], ['items-quick-add', { id: 'p-1001' }], ['items-quick-remove', { id: 'q-1' }]];
      const dn = await Promise.all(WR.map(([r, b]) => post(r, b)));
      rec('55 CASHIER: every write route  answers forbidden; nothing reaches AIR POS', dn.every(x => x.j.ok === false && x.j.forbidden === true), JSON.stringify(dn.map(x => x.j.forbidden)));
      roWrites += await writeCount();
    });
    // ---------------- manager without / with the AIR POS item permission ----------------
    await withServer('manager-nomenu', async () => {
      await login(); const ac = (await post('items-access')).j, d = (await post('items-dashboard')).j;
      rec('27 manager WITHOUT the Product Management menu: manager true, canEdit false (no add / edit), dashboard still works', ac.manager === true && ac.canEdit === false && d.ok === true, JSON.stringify(ac));
      const dn = await Promise.all([['items-add', { number: 'ZZ-X', name: 'x', categoryId: 'c-2' }], ['items-update', { id: 'p-1001', name: 'x' }], ['items-disable', { id: 'p-1001', confirm: true }], ['items-price-preview', { id: 'p-1001', prices: { 'i-1001': 1 } }], ['items-price', { id: 'p-1001', prices: { 'i-1001': 1 }, confirm: true, seen: { 'i-1001': 10 } }], ['items-quick-add', { id: 'p-1001' }], ['items-quick-remove', { id: 'q-1' }], ].map(([r, b]) => post(r, b)));
      rec('56 MANAGER WITHOUT the permission: every write route is forbidden too; nothing reaches AIR POS', dn.every(x => x.j.ok === false && x.j.forbidden === true), JSON.stringify(dn.map(x => x.j.forbidden)));
      roWrites += await writeCount();
    });
    await withServer('manager-menu', async () => {
      await login(); const ac = (await post('items-access')).j;
      rec('28 manager WITH the Product Management menu (nested under Basic Data): canEdit true', ac.manager === true && ac.canEdit === true, JSON.stringify(ac));
      const a2 = (await post('items-add', { number: 'ZZ-M1', name: 'Menu manager item', categoryId: 'c-2' })).j;
      rec('57 MANAGER WITH the permission (not a super admin): a write goes through', a2.ok === true && /^[0-9a-f-]{36}$/.test(a2.id), JSON.stringify(a2));
    });
    rec('29 in the cashier and the no-permission runs the fake AIR POS received NO write call; no Delete / Adjust / stock call exists anywhere', roWrites === 0 && !ALLCALLS.some(p => /(Delete|Adjust|Stock)/.test(p)) && ALLCALLS.length > 20, 'write calls in read-only roles: ' + roWrites);
  } catch (e) { rec('EXCEPTION', false, String(e && e.stack || e).slice(0, 400)); }
  console.log(fails.length ? `${fails.length} failed: ${fails.join('; ')} (${passes} passed)` : `ALL PASSED (${passes} passed, 0 failed)`);
  process.exit(fails.length ? 1 : 0);
})();

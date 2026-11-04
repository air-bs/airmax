// Fake AIR POS answers for AirMax Batch 4 (Items and stock). Made-up data only; offline.
//   reads: 23 ProductGet, 28 RetailQuickSellingProductPaged, 32 RetailInboundOrderPaged, 33 RetailInboundOrderGet, 34 DashboardModelGet, 143 RetailEslGet
//   writes (25 ProductAdd, 26 ProductUpdate, 27 ProductPriceSave, 29 QuickSellingProductAdd, 30 QuickSellingProductRemove) change the fake's in-memory products;
//   hooks /items-fail-price?on=1 (price save refused), /items-bump-price?id=&price= (someone else changed a price);
//   hooks (hook port = FAKE_PORT+1):  /items-state  -> { calls: [{ path, params }] }  every Batch 4 call the fake received (no secrets: made-up)
//   env FAKE_ITEMS_ROLE = cashier | manager-nomenu | manager-menu   (default: the fake's normal login = super admin)
// Written files only ADD to the fake: nothing built in is replaced except the login / home answers when FAKE_ITEMS_ROLE is set.
'use strict';
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  const S = fake.items = { calls: [] };
  const rec = (path, p) => { S.calls.push({ path, params: { ...p } }); };
  const bare = (path, fn) => { handlers[path] = p => { rec(path, p); return fn(p); }; }; // AIR POS "bare value" replies (the real read calls answer this way)

  // ---------- made-up products (ProductGet shape: items[], standardPrices[] (corp) and shopPrices[] (this shop), stock) ----------
  const ORG = { AA001: 'Anguilla', AR: 'Argentina', BR: 'Brazil' }; // Batch 1's fake origins: AA001 has no code (its key is the value), AR / BR have codes
  const ZERO = '00000000-0000-0000-0000-000000000000';
  const lvl = (itemId, shopId, price) => [{ itemId, shopId, unitId: 'u-' + itemId, unitName: 'Each', rate: 1, price }];
  const P = {
    'p-1001': { id: 'p-1001', itemId: 'i-1001', number: '1001', name: 'Bulk candy (lb)', upc: '0000000001905', categoryId: 'c-2', categoryName: 'Candy', originId: '', originCode: 'AA001', originName: 'Anguilla', saleCurrencyCode: '$',
      costPrice: 4.25, shopTaxKindId: 'tk-8', standardTaxKindId: 'tk-8', taxRate: 8, enabled: true, isRetailRefund: true, quantityStock: 50, items: [{ id: 'i-1001', productId: 'p-1001', upcs: ['0000000001905'], unit: 1, unitName: 'Each', rate: 1, weight: 1, volume: 0, length: 0, width: 0, height: 0, price: 10, saleable: true }],
      standardPrices: lvl('i-1001', ZERO, 11.5), shopPrices: lvl('i-1001', 'shop', 10) },
    'p-1002': { id: 'p-1002', itemId: 'i-1002', number: '1002', name: 'Toy car', upc: '0000000001912', categoryId: 'c-1', categoryName: 'Toys', originId: '', originCode: 'AR', originName: 'Argentina', saleCurrencyCode: '$',
      costPrice: 2, enabled: true, isRetailRefund: false, quantityStock: 0, items: [{ id: 'i-1002', productId: 'p-1002', upcs: ['0000000001912', '0000000001929'], unit: 1, unitName: 'Each', rate: 1, price: 5, saleable: true }, { id: 'i-1002b', productId: 'p-1002', upcs: [], unit: 2, unitName: 'Box', rate: 12, price: 54, saleable: true }],
      standardPrices: lvl('i-1002', ZERO, 5), shopPrices: [] },
    'p-1003': { id: 'p-1003', itemId: 'i-1003', number: '1003', name: 'Rope (ft)', upc: '', categoryId: 'c-1a', categoryName: 'Hardware', saleCurrencyCode: '$', costPrice: 0.5, enabled: true, isRetailRefund: true, quantityStock: 500,
      items: [{ id: 'i-1003', productId: 'p-1003', upcs: [], unit: 1, unitName: 'Each', rate: 1, price: 2, saleable: true }], standardPrices: [], shopPrices: lvl('i-1003', 'shop', 2) },
  };
  bare('/Products/ProductGet', p => P[p.productId] || { success: false, message: 'Product not found' });
  S.quick = ['p-1001', 'p-1003'].map((pid, i) => ({ id: 'q-' + (i + 1), productId: pid, number: P[pid].number, name: P[pid].name, imagePath: '', standardPrices: P[pid].standardPrices, shopPrices: P[pid].shopPrices }));
  bare('/Products/RetailQuickSellingProductPaged', p => { const f = J(p, 'filter'), pi = J(p, 'pageInfo'), k = String(f.keyword || '').toLowerCase(); const all = S.quick.filter(x => !k || x.name.toLowerCase().includes(k) || x.number === k), sz = Number(pi.pageSize) || 20, pg = Number(pi.page) || 1; return { rows: all.slice((pg - 1) * sz, pg * sz), total: all.length }; });

  // ---------- receiving orders (made up; creator names are invented) ----------
  const IN = [
    { id: 'in-1', number: 'IN-0001', status: 20, statusName: 'Completed', feeSet: true, quantity: 24, createTime: '2026-11-01T09:30:00', creatorName: 'Sample Receiver', description: 'Weekly toys',
      subs: [{ id: 'is-1', productId: 'p-1002', number: '1002', name: 'Toy car', imagePath: '', unit: 2, unitName: 'Box', rate: 12, quantity: 2, quantityTotal: 24, weight: 3.5, volume: 0.2, weightUnitCode: 'lb', volumeUnitCode: 'ft3' }] },
    { id: 'in-2', number: 'IN-0002', status: 10, statusName: 'Pending', feeSet: false, quantity: 500, createTime: '2026-11-02T14:05:00', creatorName: 'Sample Receiver', description: '',
      subs: [{ id: 'is-2', productId: 'p-1003', number: '1003', name: 'Rope (ft)', imagePath: '', unit: 1, unitName: 'Each', rate: 1, quantity: 500, quantityTotal: 500, weight: 20, volume: 1 }] },
    { id: 'in-3', number: 'IN-0003', status: 0, statusName: 'Canceled', feeSet: false, quantity: 5, createTime: '2026-10-20T10:00:00', creatorName: 'Sample Receiver', description: 'cancelled', subs: [] },
  ];
  bare('/InboundOrders/RetailInboundOrderPaged', p => { const f = J(p, 'filter'), pi = J(p, 'pageInfo');
    const all = IN.filter(o => (!f.number || o.number.includes(f.number)) && (f.status == null || o.status === f.status) && (!f.productNumber || o.subs.some(s => s.number === f.productNumber)) && (!f.beginDate || o.createTime.slice(0, 10) >= f.beginDate) && (!f.endDate || o.createTime.slice(0, 10) <= f.endDate)),
      sz = Number(pi.pageSize) || 20, pg = Number(pi.page) || 1; return { rows: all.slice((pg - 1) * sz, pg * sz).map(({ subs, ...o }) => o), total: all.length }; });
  handlers['/InboundOrders/RetailInboundOrderGet'] = p => { rec('/InboundOrders/RetailInboundOrderGet', p); const o = IN.find(x => x.id === p.id); return o ? ok(o) : { success: false, message: 'Order not found' }; }; // answers in the { success, value } shape: AirMax reads both shapes

  // ---------- dashboard (made-up numbers) ----------
  bare('/Dashboards/DashboardModelGet', () => ({
    orderSumToday: { amount: 120.5, cashAmount: 70, creditCardAmount: 50.5, onlinePaymentAmount: 0, otherPaymentAmount: 0, quantity: 14, orderCount: 6 },
    orderSumRecent: { amount: 4210, quantity: 380, orderCount: 160 }, stockSum: { activeCount: 12, lowStockCount: 3, quantity: 1800 }, inboundOrderSum: { amount: 900, quantity: 524, orderCount: 2 },
    saleRateSum: { quantityRate: 5, amountRate: -2, orderCountRate: 1 }, stockRateSum: { quantityRate: 0, activeCountRate: 0, inboundQuantityRate: 10 },
    saleChartItems: [{ name: '11/01', amount: 100, quantity: 10 }, { name: '11/02', amount: 140, quantity: 12 }], inboundChartItems: [{ name: '11/01', amount: 900, quantity: 524 }] }));

  // ---------- ESL (one label) ----------
  bare('/Esls/RetailEslGet', p => (p.id === 'esl-1' ? { id: 'esl-1', code: 'ESL-TEST-0001', status: 10, statusName: 'Bound', productNumber: '1001', productName: 'Bulk candy (lb)', price: 10, battery: 87, templateName: 'Shelf 2.13', lastSyncTime: '2026-11-03T08:00:00' } : { success: false, message: 'Label not found' }));


  // ---------- WRITES (made-up store only; they change the fake's own in-memory products) ----------
  const wr = (path, fn) => { handlers[path] = p => { rec(path, p); const sub = J(p, 'submit'); return fn(sub, p); }; };
  S.n = 0; S.writes = [];
  wr('/Products/ProductAdd', sub => {
    if (!sub.number || !sub.name || !sub.categoryId) return { success: false, message: 'Required field missing' };
    if (Object.values(P).some(x => x.number === sub.number)) return { success: false, message: 'Lookup code already exists' };
    const id = sub.id || ('p-new' + (++S.n)), iid = 'i-' + id;
    P[id] = { id, itemId: iid, number: sub.number, name: sub.name, upc: sub.upc || '', categoryId: sub.categoryId, categoryName: 'Candy', originCode: sub.originCode, originName: ORG[sub.originCode] || '', saleCurrencyCode: '$', costPrice: 0, enabled: sub.enabled, isRetailRefund: sub.isRetailRefund, quantityStock: 0,
      shopTaxKindId: null, items: [{ id: iid, productId: id, upcs: sub.upc ? [sub.upc] : [], unit: 1, unitName: 'Each', rate: 1, price: 0, saleable: true }], standardPrices: [], shopPrices: [] };
    S.writes.push(['add', id]); return { success: true, message: 'Saved', value: id };
  });
  wr('/Products/ProductUpdate', sub => {
    const x = P[sub.id]; if (!x) return { success: false, message: 'Product not found' };
    if (Object.values(P).some(y => y.id !== x.id && y.number === sub.number)) return { success: false, message: 'Lookup code already exists' };
    Object.assign(x, { number: sub.number, name: sub.name, upc: sub.upc, categoryId: sub.categoryId, originCode: sub.originCode, originName: ORG[sub.originCode] || '', enabled: sub.enabled, isRetailRefund: sub.isRetailRefund });
    S.writes.push(['update', x.id]); return { success: true, message: 'Saved', value: x.id };
  });
  wr('/Products/ProductPriceSave', sub => {
    const x = P[sub.productId]; if (!x) return { success: false, message: 'Product not found' };
    if (S.failPrice) return { success: false, message: 'Price refused (test)' };
    x.shopTaxKindId = sub.taxKindId; x.shopPrices = []; (sub.subs || []).forEach(u => { const it = x.items.find(i => i.id === u.itemId); if (it) { it.price = u.price; x.shopPrices.push({ itemId: u.itemId, shopId: sub.shopId, unitName: it.unitName, rate: it.rate, price: u.price }); } });
    S.writes.push(['price', x.id, sub.shopId]); return { success: true, message: 'Saved', value: x.id };
  });
  wr('/Products/QuickSellingProductAdd', sub => {
    const x = P[sub.productId]; if (!x) return { success: false, message: 'Product not found' };
    if (S.quick.some(q => q.productId === x.id)) return { success: false, message: 'Already in the Quick Add grid' };
    S.quick.push({ id: 'q-' + (S.quick.length + 10), productId: x.id, number: x.number, name: x.name, imagePath: '', standardPrices: x.standardPrices, shopPrices: x.shopPrices }); S.writes.push(['qadd', x.id]); return { success: true, message: 'Added', value: null };
  });
  wr('/Products/QuickSellingProductRemove', sub => {
    const i = S.quick.findIndex(q => q.id === sub.id); if (i < 0) return { success: false, message: 'Tile not found' };
    S.quick.splice(i, 1); S.writes.push(['qremove', sub.id]); return { success: true, message: 'Removed', value: null };
  });
  hooks['/items-fail-price'] = (u, res) => { S.failPrice = u.searchParams.get('on') === '1'; res.end('{}'); };
  hooks['/items-bump-price'] = (u, res) => { const x = P[u.searchParams.get('id')]; const v = Number(u.searchParams.get('price')); if (x) { x.shopPrices = [{ itemId: x.items[0].id, shopId: 'shop', unitName: 'Each', rate: 1, price: v }]; x.items[0].price = v; } res.end('{}'); }; // "someone else changed the price" simulator


  // FAKE_ITEMS_PAGED=1 (browser test): the item search lists THESE products (same ids as ProductGet) instead of the checkout fake's catalogue.
  if (process.env.FAKE_ITEMS_PAGED === '1') handlers['/Products/ProductPaged'] = p => { const f = J(p, 'filter'), k = String(f.keyword ?? p.keyword ?? '').toLowerCase(); const all = Object.values(P).filter(x => !k || x.name.toLowerCase().includes(k) || x.number === k || x.upc === k), pi = J(p, 'pageInfo'), sz = Number(pi.pageSize) || all.length || 1, pg = Number(pi.page) || 1;
    return { success: true, total: all.length, rows: all.slice((pg - 1) * sz, pg * sz).map(x => ({ id: x.id, number: x.number, upc: x.upc, name: x.name, categoryName: x.categoryName, retailPrice: 0, standardPrices: x.standardPrices, shopPrices: x.shopPrices, quantityStock: x.quantityStock })) }; };

  // Departments (18), origins (17) and tax kinds (14) come from Batch 1's own fake (tests/fake-api/lookups.js): department ids c-1 / c-1a / c-2, origins AR / BR.

  // ---------- role switch for the permission tests ----------
  const role = process.env.FAKE_ITEMS_ROLE;
  if (role) {
    const login = handlers['/Identities/Login'], home = handlers['/Home/Index'];
    handlers['/Identities/Login'] = p => { const r = login(p); if (r.value) r.value.superAdmin = false; return r; };
    const menus = (withItems) => [{ name: 'Dashboard', uri: '/dashboard', items: [] }, { name: 'Retail Sales', items: [{ name: 'Order Checkout', uri: '/order-checkout' }] },
      { name: 'Basic Data', items: [...(withItems ? [{ name: 'Product Management', uri: '/product-manage' }] : []), { name: 'Member Management', uri: '/member-manage' }] }];
    handlers['/Home/Index'] = () => ({ ...home(), authorities: role === 'cashier' ? [] : ['RetailManager'], menus: role === 'manager-menu' ? menus(true) : menus(false) });
  }
  hooks['/items-state'] = (u, res, f) => res.end(JSON.stringify({ calls: (f.items || S).calls, writes: S.writes, role: role || 'super' }));
};

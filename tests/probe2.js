const { AirPos } = require('../app/lib/airpos');
const j = (o, n = 900) => JSON.stringify(o).slice(0, n);
(async () => {
  const a = new AirPos({ log: m => console.log('[api]', m) });
  await a.deviceInfo();
  const r = await a.login('business test', 'grock', process.env.AIRMAX_TEST_PW); if (!r.success) return console.log('login fail');
  const p = await a.productPaged('', 1, 5); console.log('paged keys', Object.keys(p), 'total', p.total ?? p.value?.total);
  const rows = p.rows || p.value?.rows || [];
  rows.forEach(x => console.log(' prod', x.number, x.upc, x.name, x.price, x.taxRate, Object.keys(x).length));
  if (rows[0]) { const s = await a.scan(rows[0].number); console.log('scan', s.success, j(s, 1500)); }
  const d = await a.discountConfigGet(); console.log('discountcfg', j(d, 300));
  const op = await a.orderPaged({ number: null, productNumber: null, memberNumber: '', orderDate: null }, 1, 3);
  console.log('orders', Object.keys(op), j((op.rows || op.value?.rows || [])[0], 900));
  const pr = await a.getPrinters(); console.log('printers', j(pr, 300));
})();

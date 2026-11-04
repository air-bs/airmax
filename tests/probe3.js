const { AirPos } = require('../app/lib/airpos');
const j = (o, n = 900) => JSON.stringify(o).slice(0, n);
(async () => {
  const a = new AirPos({ log: m => console.log('[api]', m) });
  await a.deviceInfo();
  const r = await a.login('business test', 'grock', process.env.AIRMAX_TEST_PW); if (!r.success) return console.log('login fail');
  const h = await a.retail('/Home/Index', {}, { form: false });
  console.log('home keys', Object.keys(h)); console.log('authorities', j(h.authorities, 400)); console.log('terminalConfig', j(h.terminalConfig, 900));
  console.log('basic', j(h.retailConfig && h.retailConfig.basicSetting, 1200));
  console.log('receipt', j(h.retailConfig && h.retailConfig.receiptSetting, 600));
  const op = await a.orderPaged({ number: null, productNumber: null, memberNumber: '', orderDate: null, status: 15 }, 1, 5);
  console.log('pending', op.total, (op.rows||[]).map(o => o.number + ':' + o.status).join(','));
})();

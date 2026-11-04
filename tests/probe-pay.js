// Probe payment configuration on the TEST account only. Prints shapes, never tokens/passwords.
const { AirPos } = require('../app/lib/airpos');
(async () => {
  const pw = process.env.AIRMAX_TEST_PW; if (!pw) throw new Error('set AIRMAX_TEST_PW');
  const a = new AirPos({ log: () => {} });
  const r = await a.login('business test', 'grock', pw); console.log('login', r.success, r.value && r.value.corpName);
  if (!r.success || String(r.value.corpName).toLowerCase().includes('blocked-demo-co')) return;
  const show = (n, x) => console.log(n, JSON.stringify(x).slice(0, 1500));
  show('payTypes', await a.retail('/Commons/RetailOrderPaymentTypeSelect', {}));
  show('subPayTypes', await a.retail('/Commons/RetailOrderSubPaymentTypeSelect', {}));
  for (const t of [20, 30]) show('channel' + t, await a.retail('/Commons/RetailReceiveChannelGet', { paymentType: t }));
  const term = await a.terminalConfigGet(); show('terminal', term);
  const rc = await a.retailConfigGet(); const v = rc.value || rc; show('retailConfig keys', Object.keys(v));
  for (const k of Object.keys(v)) if (/pay|card|credit|terminal|stripe|channel/i.test(k)) show('rc.' + k, v[k]);
  if (v.basicSetting) show('basic', v.basicSetting);
  show('discountCfg', await a.discountConfigGet());
})();

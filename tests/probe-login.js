// Probe: login on the TEST account only; prints shapes (keys), never tokens/passwords.
const { AirPos } = require('../app/lib/airpos');
(async () => {
  const pw = process.env.AIRMAX_TEST_PW; if (!pw) throw new Error('set AIRMAX_TEST_PW');
  const a = new AirPos({ log: m => console.log('[api]', m) });
  console.log('device', (await a.deviceInfo()).success);
  const cfg = await a.retailConfigGetByCorp('business test'); console.log('cfg keys', Object.keys(cfg.value || cfg));
  const r = await a.login('business test', 'grock', pw);
  console.log('login', r.success, r.message, r.errorCode, r.value && Object.keys(r.value));
  if (r.value) console.log(JSON.stringify({ ...r.value, authorityCodes: (r.value.authorityCodes||[]).length }).slice(0, 1500));
  const id = await a.getIdentity(); console.log('getIdentity logined', id.value && id.value.logined);
  const sc = await a.sessionCheck(); console.log('sessionCheck', JSON.stringify(sc).slice(0, 400));
})();

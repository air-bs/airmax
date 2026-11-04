// Does a second login for the same user invalidate the first token? Prints success flags only.
const { AirPos } = require('../app/lib/airpos');
(async () => {
  const a = new AirPos({ log: () => {} }), b = new AirPos({ log: () => {} });
  await a.deviceInfo(); await b.deviceInfo();
  const la = await a.login('business test', 'grock', process.env.AIRMAX_TEST_PW);
  const lb = await b.login('business test', 'grock', process.env.AIRMAX_TEST_PW);
  const ca = await a.sessionCheck(), cb = await b.sessionCheck();
  const ok = r => !!r && !(r.success === false) && !r.loggedOut;
  console.log(JSON.stringify({ loginA: !!(la && la.success), loginB: !!(lb && lb.success), tokenA_after_B: ok(ca), tokenB: ok(cb), errA: ca && ca.errorCode }));
})();

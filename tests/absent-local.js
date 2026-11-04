// Simulates "AIR POS local hardware service not installed": point the local host at a closed port.
const a = require('../app/lib/airpos'); a.HOSTS.local = 'http://127.0.0.1:20999';
const { Register } = require('../app/lib/register');
(async () => {
  const r = new Register({ blockedCompanies: [], log: () => {} });
  r.identity = { userName: 'x', superAdmin: true }; r.api.ide = 'dummy';
  const d = await r.drawer(); const p = await r.printReturn('00000000-0000-0000-0000-000000000000');
  console.log(JSON.stringify({ drawer: d, print: p }));
})();

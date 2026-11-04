// AirMax 1.0.9-local.2 double charge / refund test: starts one register (this repo's app) against sim.js over real HTTP (127.0.0.1 only).
// env: REG=R5 APP_PORT=5184 SIM_PORT=5186 ; data in $DBL_WORK/data/<REG> (default /tmp/airreg-dblpay) so a killed register reopens with its files.
'use strict';
const fs = require('fs'), path = require('path');
const REG = process.env.REG || 'R1', PORT = Number(process.env.APP_PORT || 5180), SIM = Number(process.env.SIM_PORT || 5186);
const okP = x => (x >= 5180 && x <= 5186) || (x >= 5280 && x <= 5286); if (!okP(PORT) || !okP(SIM)) throw new Error('port out of the allowed range');
const dir = path.join(process.env.DBL_WORK || '/tmp/airreg-dblpay', 'data', REG); fs.mkdirSync(dir, { recursive: true });
const cfgPath = path.join(dir, 'config.json');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
Object.assign(cfg, { port: PORT, build: 'customer', blockedCompanies: [], updateFeedUrl: 'http://127.0.0.1:9/updates-off-in-tests' });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 1));
process.env.AIRREG_CONFIG = cfgPath; process.env.AIRREG_DATA = dir; process.env.AIRREG_NO_POWER = '1';
// safety net: nothing but 127.0.0.1 / localhost may be fetched from this process
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => { const s = String(u && u.url ? u.url : u); if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(s)) { console.log('[guard] BLOCKED non-local fetch'); return Promise.reject(new TypeError('fetch failed (blocked by test guard)')); } return realFetch(u, o); };
const ap = require(path.join(__dirname, '../../../app/lib/airpos.js'));
ap.HOSTS.retail = `http://127.0.0.1:${SIM}/${REG}/retail`; ap.HOSTS.base = `http://127.0.0.1:${SIM}/${REG}/base`; ap.HOSTS.local = `http://127.0.0.1:${SIM}/${REG}/local`;
require(path.join(__dirname, '../../../app/server.js'));

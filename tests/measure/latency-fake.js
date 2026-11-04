// Step 0 measurement only (test tool, not shipped): the normal offline fake (tests/fake-server.js = real app/server.js + fake
// AIR POS in-process) with two additions for timing:
//   1. MEASURE_AIRPOS (JSON { "<path or 'default'>": ms }) adds a made-up round trip to each fake AIR POS call.
//   2. every fake AIR POS call start/end is appended to MEASURE_EVENTS (same file the fake helper writes).
// The fake helper (tests/measure/fake-hw.js) is started by the app itself: set AIRREG_HW_EXE / AIRREG_HW_WINE=1 and put
// tests/measure/bin first on PATH (the orchestrator tests/measure/step0-measure.js does this).
'use strict';
const fs = require('fs');
const { AirPos } = require('../../app/lib/airpos');
require('../fake-server.js');
const LAT = JSON.parse(process.env.MEASURE_AIRPOS || '{}');
const EV = process.env.MEASURE_EVENTS || '';
const ev = o => { if (EV) try { fs.appendFileSync(EV, JSON.stringify({ t: Date.now(), src: 'airpos', ...o }) + '\n'); } catch {} };
const inner = AirPos.prototype.call;
AirPos.prototype.call = async function (host, p, params) {
  const ms = LAT[p] != null ? LAT[p] : (LAT.default || 0);
  let pt; try { const s = params && params.submit; pt = s ? JSON.parse(typeof s === 'string' ? s : JSON.stringify(s)).paymentType : undefined; } catch {}
  ev({ path: p, phase: 'start', paymentType: pt });
  if (ms) await new Promise(r => setTimeout(r, ms));
  const r = await inner.call(this, host, p, params);
  ev({ path: p, phase: 'end', ok: !!(r && r.success !== false), completed: !!(r && r.value && r.value.isCompleted) });
  return r;
};

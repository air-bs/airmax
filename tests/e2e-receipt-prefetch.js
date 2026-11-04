// Receipt prefetch (1.0.11 speed): time from CARD APPROVAL to the receipt handed to the printer, by stage, against the OFFLINE fake AIR POS
// with a simulated AIR POS round trip per call (FAKE_LATENCY_MS, default here 700 ms). Made-up items; the card terminal is the fake's
// (/card-approve), nothing real is charged. Also checks: one receipt per completed sale, none for a sale AIR POS refused to complete.
//   FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-receipt-prefetch.js
'use strict';
const fs = require('fs');
const FP = Number(process.env.FAKE_PORT || 5180), B = 'http://127.0.0.1:' + FP, H = 'http://127.0.0.1:' + (Number(process.env.FAKE_HOOK_PORT) || FP + 1);
const LAT = Number(process.env.RP_LATENCY_MS || 700), RUNS = Number(process.env.RP_RUNS || 5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(B + '/api/state').then(r => r.json());
const hook = q => fetch(H + q).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const short = p => p.replace(/^.*\//, '');
async function cardSale(refuse) {
  await post('pay-close'); await post('new-sale'); await post('dismiss'); await hook('/latency?ms=0');
  await post('scan', { code: '1001' }); await hook('/card-approve?on=0'); await hook('/card-wait?on=1');
  const due = (await state()).totals.due; const st = await post('pay-start'); if (!st.ok) throw new Error('pay-start: ' + st.message);
  if (refuse) await hook('/complete-refuse?n=1');
  await hook('/latency?ms=' + LAT); await hook('/timeline?reset=1');
  const t = await post('pay-tender', { type: 20, amount: due }); if (!t.ok) throw new Error('card: ' + t.message);
  await hook('/card-approve?on=1&after=1');
  for (let i = 0; i < 200; i++) { const s = await state(); if (s.completed || (s.pay && s.pay.lastError)) break; await sleep(50); }
  await sleep(LAT * 4 + 500);
  const tl = await hook('/timeline'); await hook('/latency?ms=0'); await hook('/card-wait?on=0'); await hook('/card-approve?on=0');
  return tl;
}
function stages(tl) {
  const ap = tl.find(x => short(x.p) === 'RetailOrderReceiveCheck' && x.done); const at = ap ? ap.t1 : null;
  const pick = n => tl.filter(x => short(x.p) === n && (!at || x.t0 >= at - LAT - 50));
  const cmp = pick('RetailOrderComplete')[0], cfg = pick('RetailBillTemplateConfigGet')[0], pdf = pick('RetailOrderBillContentGet')[0], prn = tl.filter(x => short(x.p) === 'PrintBillContent');
  return { approvedAt: at, complete: cmp && [cmp.t0 - at, cmp.t1 - at], templateConfig: cfg && [cfg.t0 - at, cfg.t1 - at], receiptPdf: pdf && [pdf.t0 - at, pdf.t1 - at], printMs: prn[0] ? prn[0].t0 - at : null, prints: prn.length, order: tl.filter(x => x.host !== 'local' || /Print/.test(x.p)).map(x => short(x.p)) };
}
(async () => {
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'test-pw' });
    const runs = []; for (let i = 0; i < RUNS; i++) runs.push(stages(await cardSale(false)));
    const m = k => med(runs.map(r => r[k] ? r[k][1] : NaN)), ms = med(runs.map(r => r.printMs));
    const R = { latencyMs: LAT, runs: RUNS, approvalToPrintMs: ms, completeEndMs: m('complete'), templateConfigEndMs: m('templateConfig'), receiptPdfEndMs: m('receiptPdf'), stages: runs[0] };
    console.log('TIMINGS ' + JSON.stringify(R)); if (process.env.RESULT_FILE) fs.writeFileSync(process.env.RESULT_FILE, JSON.stringify(R, null, 1));
    rec(`Card approved -> receipt to the printer (median of ${RUNS}, ${LAT} ms per AIR POS call): at most two AIR POS round trips (Complete, then the receipt PDF)`, ms > 0 && ms < 2 * LAT + 400, `${ms} ms; Complete ends ${R.completeEndMs}, template config ends ${R.templateConfigEndMs}, PDF ends ${R.receiptPdfEndMs}`);
    rec('Exactly one receipt per completed card sale (release branch: the receipt + the #12 card slip = 2 print jobs; one receipt PDF asked for)', runs.every(r => r.prints === 2 && r.order.filter(x => x === 'RetailOrderBillContentGet').length === 1), runs.map(r => r.prints + '/' + r.order.filter(x => x === 'RetailOrderBillContentGet').length).join(','));
    rec('The receipt PDF is asked for only after AIR POS has completed the sale', runs.every(r => r.receiptPdf && r.complete && r.receiptPdf[0] >= r.complete[1]), runs.map(r => r.receiptPdf && r.complete && r.receiptPdf[0] - r.complete[1]).join(','));
    const bad = stages(await cardSale(true)); const sb = await state();
    rec('AIR POS refuses to complete: no receipt PDF asked for, nothing printed', bad.prints === 0 && !bad.order.includes('RetailOrderBillContentGet') && !sb.completed, bad.order.join(' '));
    await post('pay-close'); await post('new-sale');
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

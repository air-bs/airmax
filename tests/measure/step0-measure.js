// Step 0 measurement (CLAUDE.md problems 1, 2, 7, 10). Test tool only: changes no app code, never touches a real store,
// printer or card. Starts the REAL app/server.js on the offline fake AIR POS (tests/fake-server.js) with
//   - a made-up round trip per AIR POS call (MEASURE_AIRPOS profile below), and
//   - a fake hardware helper (tests/measure/fake-hw.js) that runs one command at a time like AirRegisterHw.exe,
// then rings card sales, cash sales and Ctrl+D (Open Drawer) over the same /api routes the screen uses, and times every
// step from an event log both fakes write (same clock, same box).
// Usage: node tests/measure/step0-measure.js [profile ...]     (default: all profiles)
//        MEASURE_PORT=5195 (hook = port+1), MEASURE_OUT=tests/measure/step0-results.json
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const PORT = Number(process.env.MEASURE_PORT || 5195), BASE = 'http://127.0.0.1:' + PORT, HOOK = 'http://127.0.0.1:' + (PORT + 1);
const OUT = process.env.MEASURE_OUT || path.join(__dirname, 'step0-results.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text());

// Latency profiles. "zero" = no made-up delay anywhere: what is left is the app's own sequencing and overhead (a real
// measurement). "store-*" = ASSUMED delays for the store (AIR POS cloud round trips from the register, Star TSP143 on the
// futurePRNT driver). They are NOT measured on the register: they only show how the app's order of steps adds them up.
const AIRPOS_STORE = { default: 200, '/Orders/RetailOrderReceiveCheck': 200, '/Orders/RetailOrderReceiveBegin': 400, '/Orders/RetailOrderSave': 300,
  '/Orders/RetailOrderComplete': 700, '/Commons/RetailBillTemplateConfigGet': 250, '/Orders/RetailOrderBillContentGet': 1000 };
const HW_STORE = { deviceInfo: 1500, printers: 2000, ports: 300, printPdf: 2000, drawerDriver: 1200, raw: 400, rawRefuseMs: 1000, renderMono: 300 };
const PROFILES = {
  zero: { note: 'no made-up delays (app overhead only); Print receipts = Windows driver', airpos: {}, hw: {}, raw: 'ok', settings: { printMethod: 'driver' } },
  'store-driver': { note: 'ASSUMED store delays; Print receipts = Windows driver (the store workaround today)', airpos: AIRPOS_STORE, hw: HW_STORE, raw: 'ok', settings: { printMethod: 'driver' } },
  'store-auto': { note: 'ASSUMED store delays; Print receipts = Automatic (default) and the Star queue refuses raw jobs (as on the real TSP143)', airpos: AIRPOS_STORE, hw: HW_STORE, raw: 'refuse', settings: { printMethod: 'auto' } },
  'store-auto-drawer-first': { note: 'as store-auto, but the first hardware action after start is Ctrl+D (before any receipt has found out the queue refuses raw), then a cash sale', airpos: AIRPOS_STORE, hw: HW_STORE, raw: 'refuse', settings: { printMethod: 'auto' }, drawerFirst: true },
};

function startFake(prof, evFile) {
  const env = { ...process.env, FAKE_PORT: String(PORT), MEASURE_EVENTS: evFile, MEASURE_AIRPOS: JSON.stringify(prof.airpos), MEASURE_HW: JSON.stringify(prof.hw), MEASURE_HW_RAW: prof.raw,
    AIRREG_HW_EXE: path.join(__dirname, 'fake-hw.js'), AIRREG_HW_WINE: '1', PATH: path.join(__dirname, 'bin') + path.delimiter + process.env.PATH };
  const ch = cp.spawn(process.execPath, [path.join(__dirname, 'latency-fake.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = []; ch.stdout.setEncoding('utf8'); ch.stdout.on('data', d => logs.push(...String(d).split('\n').filter(Boolean))); ch.stderr.on('data', d => logs.push('ERR ' + d));
  return { ch, logs };
}
const readEv = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const after = (E, t0, pred) => E.find(e => e.t >= t0 && pred(e));
const isPrint = e => e.src === 'hw' && (e.cmd === 'printPdf' || (e.cmd === 'raw' && !/drawer/i.test(e.doc || '')));
const isPrintDone = e => isPrint(e) && e.phase === 'end' && e.ok; // a raw job the Star queue refused is not "printed"
const isDrawer = e => e.src === 'hw' && (e.cmd === 'drawerDriver' || e.cmd === 'drawer' || (e.cmd === 'raw' && /drawer/i.test(e.doc || '')));
async function waitFor(f, ms, pred) { const end = Date.now() + ms; while (Date.now() < end) { const E = readEv(f); const x = pred(E); if (x) return x; await sleep(25); } return null; }
async function fresh() { await post('pay-close'); await post('new-sale'); await post('dismiss'); await post('member-detach'); }
async function ring(code) { await fresh(); const s = await post('scan', { code }); if (!s || s.ok === false) throw new Error('scan failed: ' + JSON.stringify(s).slice(0, 200)); const p = await post('pay-start'); if (!p || p.ok === false) throw new Error('pay-start failed: ' + JSON.stringify(p).slice(0, 200)); return (await state()).totals.due; }
const d = (a, b) => (a && b ? b.t - a.t : null);

// Card sale: payment sent to the terminal, the customer "taps" after tapMs; approval = the moment the fake terminal says
// approved. Timed from there to the receipt reaching the helper and the helper finishing the driver job.
async function cardSale(f, tapMs) {
  const due = await ring('1001');
  await hook('/card-approve?on=0'); await hook('/card-wait?on=1');
  const r = await post('pay-tender', { type: 20, amount: due }); if (!r || !r.waiting) throw new Error('card not waiting: ' + JSON.stringify(r).slice(0, 200));
  await sleep(tapMs);
  const tA = Date.now(); await hook('/card-approve?on=1&after=1'); // the terminal approves now; the app learns it at its next Receive Check
  const end = await waitFor(f, 30000, E => E.find(e => e.t >= tA && isPrintDone(e)));
  await hook('/card-wait?on=0'); await hook('/card-approve?on=0');
  const E = readEv(f).filter(e => e.t >= tA - 5000);
  const chkEnd = after(E, tA, e => e.path === '/Orders/RetailOrderReceiveCheck' && e.phase === 'end' && e.completed);
  const chkStart = chkEnd && [...E].reverse().find(e => e.t <= chkEnd.t && e.path === '/Orders/RetailOrderReceiveCheck' && e.phase === 'start');
  const prev = chkStart && [...E].reverse().find(e => e.t < chkStart.t && e.path === '/Orders/RetailOrderReceiveCheck' && e.phase === 'start');
  const o = steps(E, { t: tA }, chkStart, chkEnd, end, 'card'); o.pollPeriodMs = d(prev, chkStart); return o;
}
// Cash sale: timed from the cashier's Enter (pay-tender sent) to drawer and receipt.
async function cashSale(f) {
  const due = await ring('1001');
  const t0 = { t: Date.now() }; const rp = post('pay-tender', { type: 10, tendered: Math.ceil(due) });
  const res = await rp; const tScreen = Date.now();
  const end = await waitFor(f, 30000, E => E.find(e => e.t >= t0.t && isPrintDone(e)));
  const E = readEv(f).filter(e => e.t >= t0.t - 100);
  const s = steps(E, t0, null, null, end, 'cash'); s.screenDoneMs = tScreen - t0.t; s.saleOk = !!(res && res.completed);
  return s;
}
function steps(E, t0, chkStart, chkEnd, printEnd, kind) {
  const ev = (p, ph, from = t0.t) => after(E, from, e => e.path === p && e.phase === ph);
  const cS = ev('/Orders/RetailOrderComplete', 'start'), cE = cS && ev('/Orders/RetailOrderComplete', 'end', cS.t);
  const tS = cE && ev('/Commons/RetailBillTemplateConfigGet', 'start', cE.t), tE = tS && ev('/Commons/RetailBillTemplateConfigGet', 'end', tS.t);
  const bS = tE && ev('/Orders/RetailOrderBillContentGet', 'start', tE.t), bE = bS && ev('/Orders/RetailOrderBillContentGet', 'end', bS.t);
  const pS = after(E, t0.t, e => isPrint(e) && e.phase === 'start');
  const dS = after(E, t0.t, e => isDrawer(e) && e.phase === 'start');
  const dE = dS && E.find(e => isDrawer(e) && e.phase === 'end' && e.ok && e.t >= dS.t); // the drawer opens when a drawer command succeeds (raw refused -> driver)
  const pOk = printEnd && [...E].reverse().find(e => isPrint(e) && e.phase === 'start' && e.t <= printEnd.t); // start of the job that printed
  const hwBefore = pOk ? E.filter(e => e.src === 'hw' && e.phase === 'start' && e.t >= t0.t && e.t < pOk.t).map(e => e.cmd + (e.cmd === 'raw' ? (/drawer/i.test(e.doc || '') ? '(drawer)' : '(receipt, refused)') : '')) : [];
  const o = { kind,
    pollWaitMs: chkStart ? chkStart.t - t0.t : null, receiveCheckMs: d(chkStart, chkEnd),
    beforeCompleteMs: cS ? cS.t - (chkEnd ? chkEnd.t : t0.t) : null, completeMs: d(cS, cE),
    templateConfigMs: d(tS, tE), receiptPdfMs: d(bS, bE),
    drawerStartMs: dS ? dS.t - t0.t : null, drawerOpenMs: dE ? dE.t - t0.t : null, drawerCmds: dS ? E.filter(e => isDrawer(e) && e.phase === 'start' && e.t >= dS.t).map(e => e.cmd).join('+') : '',
    helperBusyBeforeReceipt: hwBefore.join(', '),
    waitAfterPdfMs: pS && bE ? pS.t - bE.t : null, helperPrintMs: d(pOk, printEnd), printCmd: pOk ? pOk.cmd : null,
    toFirstPrintTryMs: pS ? pS.t - t0.t : null, toReceiptHandOffMs: pOk ? pOk.t - t0.t : null, toReceiptSpooledMs: printEnd ? printEnd.t - t0.t : null };
  return o;
}
async function ctrlD(f) {
  const t0 = Date.now(); const r = await post('drawer', {}); const tR = Date.now();
  // the drawer opens when a drawer command SUCCEEDS (a refused raw kick does not open it); that can be after the screen gave up
  const okEnd = await waitFor(f, 12000, E => E.find(e => e.t >= t0 && isDrawer(e) && e.phase === 'end' && e.ok));
  const E = readEv(f).filter(e => e.t >= t0 && (!okEnd || e.t <= okEnd.t));
  const dS = E.find(e => isDrawer(e) && e.phase === 'start'), dE = okEnd;
  return { kind: 'ctrl+d', drawerStartMs: dS ? dS.t - t0 : null, drawerOpenMs: dE ? dE.t - t0 : null, drawerCmds: E.filter(e => isDrawer(e) && e.phase === 'start').map(e => e.cmd).join('+'), otherHw: E.filter(e => e.src === 'hw' && e.phase === 'start' && !isDrawer(e)).map(e => e.cmd).join(','), helperBusyAtPress: !!(readEv(f).filter(e => e.src === 'hw' && e.t < t0).reduce((n, e) => n + (e.phase === 'start' ? 1 : -1), 0) > 0), answerMs: tR - t0, ok: !!(r && r.ok), message: String((r && r.message) || '').slice(0, 140) };
}
const med = a => { const v = a.filter(x => typeof x === 'number').sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
function summarize(rows) { const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]; const o = {}; for (const k of keys) { const v = rows.map(r => r[k]); o[k] = typeof v.find(x => x != null) === 'number' ? med(v) : v.find(x => x != null && x !== '') ?? null; } o.n = rows.length; return o; }

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PROFILES);
  const results = { at: new Date().toISOString(), host: os.hostname(), node: process.version, assumptions: { AIRPOS_STORE, HW_STORE }, profiles: {} };
  for (const name of want) {
    const prof = PROFILES[name]; if (!prof) { console.log('unknown profile ' + name); continue; }
    const evFile = path.join(os.tmpdir(), `step0-ev-${name}-${process.pid}.jsonl`); try { fs.unlinkSync(evFile); } catch {}
    const { ch, logs } = startFake(prof, evFile);
    const R = { note: prof.note, cases: {} };
    try {
      let up = false; for (let i = 0; i < 100 && !up; i++) { await sleep(100); up = await state().then(() => true).catch(() => false); }
      if (!up) throw new Error('fake server did not start: ' + logs.slice(-5).join(' | '));
      const tL = Date.now(); const lg = await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' }); R.loginMs = Date.now() - tL; if (!lg || lg.ok === false) throw new Error('login failed ' + JSON.stringify(lg).slice(0, 200));
      const st = await post('settings', { hardware: 'builtin', printerName: '', printerType: 'auto', printerConn: 'windows', receiptAutoPrint: 'always', drawerAutoOpen: 'cash', ...prof.settings });
      if (!st || st.ok === false) throw new Error('settings failed ' + JSON.stringify(st).slice(0, 200));
      const run = async (label, n, fn) => { const rows = []; for (let i = 0; i < n; i++) { rows.push(await fn()); await sleep(300); } R.cases[label] = { median: summarize(rows), runs: rows }; console.log(name + ' | ' + label + ' | ' + JSON.stringify(R.cases[label].median)); };
      // order matters: the first print after a settings save has no cached Windows printer list (as after an app start)
      if (prof.drawerFirst) { await run('Ctrl+D, first in session (raw not yet known refused)', 1, () => ctrlD(evFile)); await run('Ctrl+D, later', 2, () => ctrlD(evFile)); await run('cash sale (drawer + receipt), first receipt in session', 1, () => cashSale(evFile)); throw { done: true }; }
      await run('card, first sale (cold printer list), tap at 3 s', 1, () => cardSale(evFile, 3000));
      await run('card, tap at 3 s (poll every 0.5 s)', 3, () => cardSale(evFile, 3000));
      await run('card, tap at 12 s (poll every 1 s)', 2, () => cardSale(evFile, 12000));
      await run('cash sale (drawer + receipt)', 3, () => cashSale(evFile));
      await run('Ctrl+D (Open Drawer)', 3, () => ctrlD(evFile));
      R.appTimingLines = logs.filter(l => /sale print timings|print timings|drawer|refuses raw/i.test(l)).slice(-12).map(l => l.slice(0, 600));
    } catch (e) { if (e && e.done) { R.appTimingLines = logs.filter(l => /sale print timings|drawer|refuses raw/i.test(l)).slice(-12).map(l => l.slice(0, 600)); } else { R.error = e.message; console.log(name + ' ERROR ' + e.message); R.tail = logs.slice(-15); } }
    finally { ch.kill(); await sleep(800); }
    results.profiles[name] = R;
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log('written ' + OUT);
})();

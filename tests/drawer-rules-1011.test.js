// #2/#10/#8 (approved Nov 3, branch claude/work): the cash drawer opens fast and reliably with the right command for each printer,
// ONLY after a cash sale (or check, per the store setting "When cash or a check was taken"), a cash return, or Ctrl+D (and the Sale
// complete screen's own Open Drawer button), and NEVER for card, customer account, a refused sale, or reprints. It never opens before
// AIR POS has completed the sale. Runs the REAL app/server.js on the OFFLINE fake AIR POS (tests/measure/latency-fake.js, no added
// delay) with the fake hardware helper (tests/measure/fake-hw.js), which logs every drawer command. Made-up data, no card, no printer.
// Run: node tests/drawer-rules-1011.test.js   (DRW_PORT=5241: fake on 5241/5242, one restart per printer type)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = Number(process.env.DRW_PORT || 5241), BASE = 'http://127.0.0.1:' + PORT, HOOK = 'http://127.0.0.1:' + (PORT + 1);
const MEAS = path.join(__dirname, 'measure');
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text());
let EV = '';
const events = () => { try { return fs.readFileSync(EV, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const isKick = e => e.src === 'hw' && e.phase === 'start' && (e.cmd === 'drawerDriver' || e.cmd === 'drawer' || (e.cmd === 'raw' && /drawer/i.test(e.doc || '')));
const kicksSince = t => events().filter(e => e.t >= t && isKick(e));
async function start(printer, extra = {}) {
  EV = path.join(os.tmpdir(), `drw1011-${printer}-${process.pid}.jsonl`); try { fs.unlinkSync(EV); } catch {}
  const env = { ...process.env, ...extra, FAKE_PORT: String(PORT), MEASURE_EVENTS: EV, MEASURE_HW_PRINTER: printer, AIRREG_HW_EXE: path.join(MEAS, 'fake-hw.js'), AIRREG_HW_WINE: '1', PATH: path.join(MEAS, 'bin') + path.delimiter + process.env.PATH };
  const ch = cp.spawn(process.execPath, [path.join(MEAS, 'latency-fake.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] }); ch.stdout.on('data', () => {}); ch.stderr.on('data', () => {});
  let up = false; for (let i = 0; i < 100 && !up; i++) { await sleep(100); up = await state().then(() => true).catch(() => false); }
  if (!up) throw new Error('fake server did not start');
  await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' });
  await post('settings', { hardware: 'builtin', printerName: '', printerType: 'auto', printerConn: 'windows', printMethod: 'auto', receiptAutoPrint: 'always', returnReceiptAutoPrint: 'always', drawerAutoOpen: 'cash' });
  return ch;
}
const fresh = async () => { await post('pay-close'); await post('return-cancel'); await post('return-toggle', { on: false }); await post('new-sale'); await post('dismiss'); await post('member-detach'); };
async function sale(item, tender, member) {
  await fresh(); if (member) await post('member-attach', { number: '5550100' });
  await post('scan', { code: item }); await post('pay-start'); const due = (await state()).totals.due;
  const t0 = Date.now(); const r = await post('pay-tender', tender(due)); await sleep(900); return { r, t0, kicks: kicksSince(t0) };
}
async function ret(orderId, toAccount) {
  await fresh(); await post('return-start', { kind: 'receipt', orderId }); if (toAccount) await post('return-account', { on: true });
  await post('scan', { code: '1001' }); const t0 = Date.now(); const r = await post('return-confirm'); await sleep(900); return { r, t0, kicks: kicksSince(t0) };
}
(async () => {
  let ch;
  try {
    // ---- A. when the drawer opens (Star TSP143 on its futurePRNT queue, Print receipts = Automatic) ----
    ch = await start('star', { FAKE_STRICT_COMPLETE: '1' }); // strict fake: AIR POS-like Complete, and /complete-refuse?n=1 refuses the next one
    let x = await sale('1001', due => ({ type: 10, tendered: Math.ceil(due) }));
    const cmp = events().filter(e => e.t >= x.t0 && e.src === 'airpos' && e.path === '/Orders/RetailOrderComplete' && e.phase === 'end');
    rec('A1 cash sale: drawer opens ONCE, after AIR POS Complete answered, through the Star driver (no raw try)', x.r.completed && x.kicks.length === 1 && x.kicks[0].cmd === 'drawerDriver' && cmp[0] && x.kicks[0].t >= cmp[0].t, x.kicks.map(k => k.cmd).join(',') + ` (kick ${x.kicks[0] ? x.kicks[0].t - x.t0 : '-'} ms, Complete back ${cmp[0] ? cmp[0].t - x.t0 : '-'} ms)`);
    await hook('/card-wait?on=0'); x = await sale('1001', due => ({ type: 20, amount: due }));
    rec('A2 card (card machine) sale: drawer does NOT open', x.r.completed && x.kicks.length === 0, `${x.kicks.length} kicks`);
    x = await sale('1001', due => ({ type: 11, amount: due }), true);
    rec('A3 customer account sale: drawer does NOT open', x.r.completed && x.kicks.length === 0, `${x.r.message} | ${x.kicks.length} kicks`);
    x = await sale('1001', due => ({ type: 50, amount: due, checkNumber: '1234' }), true);
    rec('A4 check sale: opens once (store setting "When cash or a check was taken", unchanged default)', x.r.completed && x.kicks.length === 1, `${x.kicks.length} kicks`);
    await hook('/complete-refuse?n=1'); x = await sale('1001', due => ({ type: 10, tendered: Math.ceil(due) }));
    rec('A5 cash sale that AIR POS refuses to complete: drawer stays SHUT', !x.r.completed && x.kicks.length === 0, `${x.r.message ? x.r.message.slice(0, 80) : ''} | ${x.kicks.length} kicks`);
    let t0 = Date.now(); let f = await post('finish-sale'); await sleep(900);
    rec('A6 ...then Finish sale goes through: drawer opens once (never twice)', f.completed && kicksSince(t0).length === 1 && kicksSince(x.t0).length === 1, `${kicksSince(t0).length} kicks`);
    t0 = Date.now(); let p = await post('print', {}); await sleep(600);
    rec('A7 Reprint Receipt: prints, drawer does NOT open', p.ok && kicksSince(t0).length === 0, `${p.message} | ${kicksSince(t0).length} kicks`);
    x = await ret('o-ret-cashonly');
    rec('A8 return refunded in cash: drawer opens once (after AIR POS recorded the return)', x.r.ok && x.kicks.length === 1, `${(x.r.message || '').slice(0, 70)} | ${x.kicks.length} kicks`);
    x = await ret('o-ret-cardonly');
    rec('A9 return refunded to the card: drawer does NOT open', x.r.ok && x.kicks.length === 0, `${(x.r.message || '').slice(0, 70)} | ${x.kicks.length} kicks`);
    x = await ret('o-ret-acct', true);
    rec('A10 return to the customer account: drawer does NOT open', x.r.ok && x.kicks.length === 0, `${(x.r.message || '').slice(0, 70)} | ${x.kicks.length} kicks`);
    t0 = Date.now(); let d = await post('drawer'); await sleep(200);
    rec('A11 Ctrl+D (Open Drawer): opens once, nothing printed', d.ok && kicksSince(t0).length === 1 && !events().some(e => e.t >= t0 && e.src === 'hw' && (e.cmd === 'printPdf' || (e.cmd === 'raw' && !/drawer/i.test(e.doc || '')))), `${d.message} | ${kicksSince(t0).length} kicks`);
    const sc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'shortcuts.json'), 'utf8')).keys.filter(k => k.action === 'drawer');
    rec('A12 Ctrl+D keeps its key and label', sc.length === 1 && sc[0].key === 'Ctrl+D' && /Open Drawer/.test(sc[0].label || ''), JSON.stringify(sc.map(k => k.key + ' ' + k.label)));
    ch.kill(); await sleep(600);
    // ---- B. the right drawer command for each printer type (Ctrl+D, Automatic) ----
    const WANT = { star: { cmd: 'drawerDriver', ch: 'A', why: 'Star driver "Control" letter A (drawer 1, 50 ms)' }, epson: { cmd: 'raw', hex: '1b700019fa', why: 'ESC p 0 25 250' },
      generic: { cmd: 'raw', hex: '1b700019fa', why: 'ESC p 0 25 250' }, staralt: { cmd: 'raw', hex: '07', why: 'Star BEL' } };
    for (const [pr, w] of Object.entries(WANT)) {
      ch = await start(pr); if (pr === 'staralt') await post('settings', { printerType: 'star' });
      t0 = Date.now(); d = await post('drawer'); await sleep(200); const k = kicksSince(t0);
      rec(`B ${pr}: Ctrl+D sends ${w.why}, once, answered at once`, d.ok && k.length === 1 && k[0].cmd === w.cmd && (!w.ch || k[0].ch === w.ch) && (!w.hex || k[0].hex === w.hex), JSON.stringify(k.map(e => ({ cmd: e.cmd, ch: e.ch, hex: e.hex }))) + ` ${d.message}`);
      ch.kill(); await sleep(600);
    }
  } catch (e) { rec('crashed', false, e.stack || e.message); try { ch && ch.kill(); } catch {} }
  const pass = out.filter(x => x.pass).length; console.log(`drawer-rules-1011: ${pass}/${out.length} passed`);
  process.exit(pass === out.length ? 0 : 1);
})();

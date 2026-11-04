// Review of origin/claude/instant-scan (12530bf) and origin/claude/receipt-prefetch (15c8510): repro tests for the findings in
// docs/REVIEW-instant-scan-prefetch.md. Each reviewed commit is taken from git into a temp folder and run there (offline: mocked
// AIR POS or the fake server, made-up data, no card, no store). "KNOWN BUG" = the finding still reproduces (printed, not counted);
// "FIXED" once it does not. PASS / FAIL lines check what the commits already do right. SKIPPED when a commit is not in this clone.
// Run: node tests/review-instant-prefetch.test.js   (fake server on REVIEW_PORT, default 5262)
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), sleep = ms => new Promise(r => setTimeout(r, ms));
const out = [], known = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const bug = (k, still, note) => { known.push({ k, still: !!still, note }); console.log((still ? 'KNOWN BUG ' : 'FIXED ') + k + ' — ' + note); };
function extract(commit) {
  try { execFileSync('git', ['cat-file', '-e', commit + '^{commit}'], { cwd: ROOT, stdio: 'ignore' }); } catch { return null; }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-' + commit + '-'));
  execFileSync('sh', ['-c', `git archive ${commit} app tests/fake-server.js tests/look-fake.js | tar -x -C "${d}"`], { cwd: ROOT });
  fs.symlinkSync(path.join(ROOT, 'tests', 'node_modules'), path.join(d, 'tests', 'node_modules')); return d;
}
function mkReg(R, dir, more = {}) {
  const { Register } = require(R + '/app/lib/register');
  const reg = new Register({ log: () => {}, dataDir: dir }); reg.settingsPath = null; const api = reg.api; api.ide = 'x'; api.shop = 'shop';
  reg.identity = { userName: 'u', currency: 2, superAdmin: true, corpName: 'Made-up corp', shopName: 'Made-up shop' };
  reg.home = { terminalConfig: { checkoutAutoPrint: true, autoOpenCashDrawer: false }, retailConfig: { basicSetting: {} }, authorities: [] };
  api.promotionGet = async s => ({ success: true, value: { subs: [], totalAmount: s.subs.reduce((a, x) => a + x.price * x.quantity, 0), totalTax: 0, totalDiscountAmount: 0, totalPromotionDiscountAmount: 0, originalTotalAmount: 0 } });
  api.authorizationCheck = async () => ({ success: true, value: { needAuthorization: false } }); api.orderSave = async () => ({ success: true });
  api.receiveBegin = async () => ({ success: true, value: { isCompleted: true } }); api.orderGet = async () => ({ success: true, value: { status: 20, receives: [] } });
  reg.printPdfBase64 = async () => ({ ok: true }); reg.drawer = async () => ({ ok: true }); reg.mode = 'sale';
  Object.assign(api, more); return reg;
}

(async () => {
  // ================= instant scan (12530bf)
  const IS = extract('12530bf');
  if (!IS) console.log('SKIPPED instant scan checks: commit 12530bf is not in this clone (git fetch origin claude/instant-scan)');
  else {
    const { InstantScan } = require(IS + '/app/instantscan');
    const LIST = [{ n: '1003', u: '', name: 'Rope (ft)', price: 2, tax: 8, unit: '', id: 'i1003', pid: 'p1003', cat: '' }, { n: '1004', u: '', name: 'Gift bag', price: 1.5, tax: 0, unit: '', id: 'i1004', pid: 'p1004', cat: '' }];
    const mkIS = (reg, dir, enqueue) => { const is = new InstantScan({ reg, dataDir: dir, shopKey: () => 'k', enqueue: enqueue || (() => Promise.resolve()) }); is.on = true; is.setList({ at: new Date().toISOString(), shop: 'k', rows: LIST.map(e => ({ ...e })) }, 'test'); Object.defineProperty(reg.api, 'loggedIn', { get: () => true }); return is; };
    // F2 (crash gap, High): a journal snapshot written while a line is still unconfirmed comes back after a restart unconfirmed, for good
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-is-')), reg = mkReg(IS, dir, { scan: () => new Promise(() => {}) }), is = mkIS(reg, dir);
    is.scanNow('1003'); reg.journalSnap('route'); // any other queued route (stock-note, qty, F4 ...) writes the journal after it runs
    const j = reg.journal.read(), reg2 = mkReg(IS, dir); reg2.subs = j.subs; // restart: recovery.js restores the cart (this.subs = j.subs)
    const p2 = await reg2.startPay(), h2 = await reg2.hold(), is2 = mkIS(reg2, dir);
    bug('F2 crash while a line is unconfirmed: after the restart Pay and Hold are refused ("still checking") and nothing ever checks the line', !p2.ok && p2.unconfirmed && !h2.ok && is2.pending() > 0, `Pay: ${p2.message} | Hold ok ${h2.ok} | pending ${is2.pending()}`);
    // F3 (crash gap, known from Step 0 / 1081035): before any snapshot, the instant line is only in memory (lost on a crash)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-is-')); reg = mkReg(IS, dir, { scan: () => new Promise(() => {}) }); is = mkIS(reg, dir);
    const before = reg.journal.read(); is.scanNow('1003'); const after = reg.journal.read();
    bug('F3 an instant line is not written to the crash journal when it is added (the screen shows it; a crash now loses it)', JSON.stringify(before) === JSON.stringify(after) && reg.subs.length === 1, `journal lines before ${(before && before.subs || []).length}, after ${(after && after.subs || []).length}, on screen ${reg.subs.length}`);
    // F4 (stale data, Medium): Product Search answers only from the list saved when the app opened
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-is-')); reg = mkReg(IS, dir); is = mkIS(reg, dir);
    const s1 = is.search('new item'), e0 = is.entry({ number: '1005', name: 'Unpriced widget', standardPrices: [], shopPrices: [] });
    bug('F4 Product Search with instant scan on: an item added in AIR POS today is not found until the app restarts (no AIR POS fallback)', s1.total === 0, `search "new item": ${s1.total} rows (from the saved list only)`);
    bug('F4b items with no price are left out of the list, so Product Search no longer shows them (master shows them with "—")', e0 === null, 'entry(): ' + JSON.stringify(e0));
    // what is right
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-is-')); reg = mkReg(IS, dir, { scan: () => new Promise(() => {}) }); is = mkIS(reg, dir); is.scanNow('1004');
    const pp = await reg.startPay(), tt = await reg.tender({ type: 10, amount: 2, tendered: 2 }), ff = await reg.finishSale();
    rec('IS-ok Pay, a tender and Finish are refused while a line is unconfirmed (an unchecked price is never charged)', !pp.ok && !tt.ok && !ff.ok && [pp, tt, ff].every(x => x.unconfirmed), pp.message);
    const saved = JSON.stringify(reg.saveSubmit(false));
    rec('IS-ok the unconfirmed mark is never sent to AIR POS (Save lists its own fields)', !/_unconfirmed|_code/.test(saved), '');
    // F1 (High): rows shift under a queued qty / Delete / F4 when an instant scan lands first (real server + fake, 150 ms per call)
    const PORT = Number(process.env.REVIEW_PORT || 5262), B = 'http://127.0.0.1:' + PORT;
    const srv = spawn(process.execPath, [path.join(IS, 'tests', 'look-fake.js')], { cwd: IS, env: { ...process.env, FAKE_PORT: String(PORT), FAKE_LATENCY_MS: '150', FAKE_HOOK_PORT: 'off' }, stdio: 'ignore' });
    const post = (r, x) => fetch(B + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(q => q.json());
    const st = () => fetch(B + '/api/state').then(q => q.json());
    try {
      for (let i = 0; i < 100; i++) { try { await st(); break; } catch { await sleep(100); } }
      await post('login', { company: 'fake shop', user: 'tester', password: 'fake-pw' }); await post('instant-scan', { on: true });
      for (let i = 0; i < 60; i++) { const s = await st(); if (s.instant && s.instant.ready) break; await sleep(200); }
      const run = async (route, body) => {
        await post('new-sale'); await post('scan', { code: '1004' }); await sleep(1200); // Gift bag, confirmed (row 0)
        const rB = post('scan', { code: '1003' }); await sleep(20);                        // Rope, instant: Gift bag is now row 1 on screen
        const q = post(route, body); await sleep(20); await post('scan', { code: '1001' }); // the cashier acts on row 1; Bulk candy lands first
        await q; await rB; await sleep(2500); return (await st()).cart;
      };
      let c = await run('qty', { row: 1, qty: 5 });
      const gb = c.find(l => l.number === '1004'), wrong = c.find(l => l.quantity === 5);
      bug('F1 qty 5 typed for row 1 (Gift bag) goes to another line when an instant scan lands while the qty waits in the queue', !(gb && gb.quantity === 5), `qty 5 went to ${wrong ? wrong.name : 'none'}; cart ${c.map(l => l.number + 'x' + l.quantity).join(' ')}`);
      c = await run('remove', { row: 1 });
      bug('F1b Delete on row 1 (Gift bag) removes another line', c.some(l => l.number === '1004'), `left: ${c.map(l => l.name).join(', ')}`);
      c = await run('line-discount', { row: 1, kind: 'percent', value: 50 });
      const disc = c.find(l => l.discountAmount > 0);
      bug('F1c F4 50% off on row 1 (Gift bag) is put on another line', !(disc && disc.number === '1004'), `discount on ${disc ? disc.name : 'none'}`);
    } finally { srv.kill(); }
  }
  // ================= receipt prefetch (15c8510)
  const RP = extract('15c8510');
  if (!RP) console.log('SKIPPED receipt prefetch checks: commit 15c8510 is not in this clone (git fetch origin claude/receipt-prefetch)');
  else {
    const sale = async R => {
      let completed = false; const bills = [];
      const reg = mkReg(R, fs.mkdtempSync(path.join(os.tmpdir(), 'rv-rp-')), {
        complete: async () => { await sleep(150); completed = true; return { success: true }; },
        billTemplateConfigGet: async () => completed ? { success: true, value: { templates: [{ id: 't1', name: 'Store receipt', fields: [{ name: 'Footer', content: 'Thank you' }] }], defaultTemplateId: 't1', orderPrintId: 'op1', orderSubs: [] } } : { success: false, message: 'Order not completed' }, // made up
        billContentGet: async (id, extra) => { bills.push(extra ? extra.templateId : 'NO TEMPLATE'); return { success: true, value: { billBase64: 'JVBERi0x' } }; } });
      Object.assign(reg.settings, { receiptAutoPrint: 'always' });
      reg.subs = [{ id: 'a', itemId: 'i', productId: 'p', number: '1', name: 'Made-up', quantity: 1, rate: 1, price: 10, discount: 0, discountAmount: 0, timestamp: 1 }];
      await reg.recalc(); await reg.startPay(); const r = await reg.tender({ type: 10, amount: 10, tendered: 10 }); if (r && r.hwJob) await r.hwJob; await sleep(300);
      return { r, bills };
    };
    const m = await sale(ROOT), p = await sale(RP);
    rec('RP-ok master (baseline): the receipt is asked for with the store template after Complete', m.r.completed && m.bills.join() === 't1', m.bills.join());
    bug('F5 prefetch: an ERROR answer to the early template request (AIR POS refusing it before Complete, or a blip) is used as "no templates": the receipt prints without the store template', p.r.completed && p.bills.join() === 'NO TEMPLATE', p.bills.join());
    rec('RP-ok one receipt per sale with the prefetch (no double print)', p.bills.length === 1, p.bills.length + ' receipt request(s)');
  }
  const pass = out.filter(x => x.pass).length; console.log(`review-instant-prefetch: ${pass}/${out.length} passed; known bugs reproducing: ${known.filter(x => x.still).length}/${known.length}`);
  fs.writeFileSync(path.join(__dirname, 'review-instant-prefetch-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out, known }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

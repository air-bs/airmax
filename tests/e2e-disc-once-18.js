// AirMax #18 "printed once" (owner, Nov 3 2026): a discounted item's discount must appear on the receipt EXACTLY ONCE, under the item:
// either the Air Max line ("33% off -$9.90") or, when the store's own AIR POS template already prints it, only the template's line.
// Real receipt PDFs from the OFFLINE fake AIR POS (FAKE_REAL_RECEIPT), made-up items, cash only (no card is ever charged). For each
// template style (none / "Discount -$x" / "You saved $x" / "-33% -$x") it rings up: % item discount, $ item discount, a multi-buy
// (3 for $5) with an item discount, a whole-sale discount plus an item discount, a receipt return, and a reprint.
//   FAKE_REAL_RECEIPT=1 FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-disc-once-18.js   (no browser needed)
'use strict';
const { _pdf } = require('../app/disclines');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (Number(process.env.FAKE_HOOK_PORT) || FP + 1);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const linesOf = b64 => { const b = Buffer.from(b64, 'base64'), pdf = _pdf.readPdf(b), ex = _pdf.extract(pdf, _pdf.pageList(pdf)[0]); return _pdf.textLines(ex.glyphs).map(l => l.text); };
// every printed line that shows THIS discount: its amount with a minus / discount word, or its % ("33%")
const shows = (lines, amt, pct) => lines.filter(t => (new RegExp('(^|[^0-9.])' + amt.toFixed(2).replace('.', '\\.') + '(?!\\d)').test(t) && /-|discount|save|off/i.test(t)) || new RegExp('(^|[^0-9.])' + String(pct).replace('.', '\\.') + '\\s?%').test(t));
async function printedAfter(n, ms = 8000) { const end = Date.now() + ms; let p = []; while (Date.now() < end) { p = (await hook('/printed')).printed || []; if (p.length > n) break; await sleep(200); } return p; }
const results = [];
async function sale(build) {
  await post('pay-close'); await post('new-sale'); await post('dismiss'); await build();
  const st = await state(), n = ((await hook('/printed')).printed || []).length;
  const r = await post('pay-cash', { tendered: Math.ceil(st.totals.due) + 20 });
  const pr = await printedAfter(n); return { r, st, lines: pr.length > n ? linesOf(pr[pr.length - 1]) : [] };
}
function check(mode, kase, lines, discs, extra = '') {
  for (const d of discs) {
    const hits = shows(lines, d.amt, d.pct), under = d.under ? lines.indexOf(d.under) : -1, after = under >= 0 ? lines.slice(under + 1, under + 4) : [];
    const once = hits.length === 1 && (!d.under || after.some(t => hits.includes(t)));
    results.push({ mode, kase, item: d.name, times: hits.length });
    rec(`${mode} | ${kase} | ${d.name}: discount printed exactly once, under the item`, once, `${hits.length}x: ${hits.join(' / ')}${extra}`);
  }
}
(async () => {
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'test-pw' });
    await hook('/real-receipt?on=1'); await hook('/multibuy?on=1');
    for (const mode of ['none', 'line', 'saved', 'pct']) {
      await hook('/receipt-disc?mode=' + mode); await hook('/printed?reset=1');
      // 1. % item discount: 3 x $10, 33% = -$9.90
      const a = await sale(async () => { await post('scan', { code: '1001' }); await post('qty', { row: 0, qty: 3 }); await post('line-discount', { row: 0, kind: 'percent', value: 33 }); });
      check(mode, '% item discount', a.lines, [{ name: 'Bulk candy', amt: 9.9, pct: 33, under: '1001 x3 $10.00 $20.10' }]);
      // 2. $ item discount: 2 x $10, $2.50 off (= 12.5%)
      const b = await sale(async () => { await post('scan', { code: '1001' }); await post('qty', { row: 0, qty: 2 }); await post('line-discount', { row: 0, kind: 'amount', value: 2.5 }); });
      check(mode, '$ item discount', b.lines, [{ name: 'Bulk candy', amt: 2.5, pct: 12.5, under: '1001 x2 $10.00 $17.50' }]);
      // 3. multi-buy (3 for $5 on Rope, AIR POS promotion -$1.00) + a 10% item discount (-$0.60): each once
      const c = await sale(async () => { await post('scan', { code: '1003' }); await post('qty', { row: 0, qty: 3 }); await post('line-discount', { row: 0, kind: 'percent', value: 10 }); });
      check(mode, 'multi-buy + item discount', c.lines, [{ name: 'Rope (10% item)', amt: 0.6, pct: 10, under: '1003 x3 $2.00 $4.40' }]);
      const promo = c.lines.filter(t => /3 for \$5/.test(t)).length;
      rec(`${mode} | multi-buy | the AIR POS promotion line is never repeated by Air Max`, promo === (mode === 'none' ? 0 : 1) && c.st.totals.promotionDiscount === 1, `${promo}x promotion line, promotion $${c.st.totals.promotionDiscount}`);
      // 4. whole-sale discount (10%) + item discount (33%): the item's once under it, the sale's once in the totals
      const d = await sale(async () => { await post('scan', { code: '1001' }); await post('qty', { row: 0, qty: 3 }); await post('line-discount', { row: 0, kind: 'percent', value: 33 }); await post('discount', { kind: 'percent', value: 10 }); });
      check(mode, 'sale discount + item discount', d.lines, [{ name: 'Bulk candy', amt: 9.9, pct: 33, under: '1001 x3 $10.00 $20.10' }]);
      rec(`${mode} | sale discount | the whole-sale discount is printed once (AIR POS total line), never as an item line`, d.lines.filter(t => /^Discount -\$2\.01$/.test(t)).length === 1, d.lines.filter(t => /Discount/.test(t)).join(' / '));
      // 5. receipt return of sale 1 (one bag of candy back, cash): the return receipt is AIR POS's own, printed unchanged
      await post('pay-close'); await post('new-sale'); await post('dismiss');
      const n5 = ((await hook('/printed')).printed || []).length, pdfs0 = ((await hook('/')).calls || []).length;
      const rs = await post('return-start', { kind: 'receipt', orderId: a.r.orderId }); await post('scan', { code: '1001' }); const rc = await post('return-confirm');
      const pr5 = await printedAfter(n5), rl = pr5.length > n5 ? linesOf(pr5[pr5.length - 1]) : [];
      const want = mode === 'none' ? 0 : 1, hits5 = shows(rl, 3.3, 33);
      results.push({ mode, kase: 'return', item: 'Bulk candy (1 of 3 back)', times: hits5.length });
      rec(`${mode} | return | the return receipt shows the returned item's discount ${want ? 'once (AIR POS template)' : 'not at all (AIR POS template has none)'}; Air Max adds nothing to return receipts`, rs.ok !== false && rc.ok && /RETURN RECEIPT/.test(rl.join('|')) && hits5.length === want && !rl.some(t => /% off/.test(t)), `${hits5.length}x ${hits5.join(' / ')} | ${rc.message || ''}`);
      // 6. reprint of sale 1 (Ctrl+P / History Reprint)
      await post('pay-close'); await post('new-sale'); await post('dismiss');
      const n6 = ((await hook('/printed')).printed || []).length; await post('print', { orderId: a.r.orderId }); const pr6 = await printedAfter(n6);
      check(mode, 'reprint', pr6.length > n6 ? linesOf(pr6[pr6.length - 1]) : [], [{ name: 'Bulk candy', amt: 9.9, pct: 33, under: '1001 x3 $10.00 $20.10' }]);
    }
    console.log('TABLE ' + JSON.stringify(results));
    await hook('/receipt-disc?mode=none'); await hook('/multibuy?on=0'); await post('new-sale');
  } catch (e) { rec('run', false, e.stack); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

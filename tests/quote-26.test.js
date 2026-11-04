// Store request #26: unit test of the quote slip text and of Quote.print() against a fake register: nothing but printSlip is ever called.
'use strict';
const { quoteLines, Quote } = require('../app/quote.js');
let pass = 0, fail = 0; const rec = (k, ok, n) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + k + (ok ? '' : ' — ' + n)); };
const st = { mode: 'sale', user: { shop: 'Test Shop' }, member: { name: 'Pat Sample' }, cart: [{ name: 'Toy Car', quantity: 2, price: 5, total: 10 }, { name: 'Bear\u0007 \n Big', quantity: 1, price: 3.5, total: 3, discountAmount: 0.5 }], totals: { itemAmount: 13, discountAmount: 0.5, tax: 1.04, due: 14.04 } };
const q = quoteLines(st, new Date(2026, 10, 3, 9, 5));
const txt = q.lines.join('\n');
rec('header says QUOTE / ESTIMATE, NOT A SALE, NOT PAID (top and bottom)', q.ok && /^QUOTE \/ ESTIMATE\nNOT A SALE\nNOT PAID/.test(txt) && /NOT A SALE\. NOT PAID\./.test(txt) && /Not valid as a receipt/.test(txt));
rec('items, estimate total and customer are on it; date is local', /Toy Car/.test(txt) && /TOTAL \(estimate\)\s+\$14\.04/.test(txt) && /Pat Sample/.test(txt) && /2026-11-03 09:05/.test(txt));
rec('control characters never reach the slip', !/[\x00-\x08\x0b-\x1f]/.test(txt) && /Bear Big/.test(txt));
rec('it does not say Thank you / Receipt # / Paid / Change / Cash', !/thank|receipt #|change due|cash|visa/i.test(txt.replace(/No receipt|Not valid as a receipt/g, '')));
rec('empty sale, return mode, total still updating: refused with a reason', !quoteLines({ cart: [], totals: {} }).ok && !quoteLines({ mode: 'return', cart: [{}], totals: {} }).ok && !quoteLines({ mode: 'sale', cart: [{}], totals: { updating: true } }).ok);
(async () => {
  const log = []; const hit = [];
  const reg = new Proxy({ state: () => st, printSlip: async (l, label) => { hit.push(['printSlip', label, l.length]); return { ok: true }; } }, { get: (t, k) => (k in t ? t[k] : (...a) => { hit.push([String(k)]); return {}; }) });
  const r = await new Quote({ reg, log: m => log.push(m) }).print();
  rec('print(): exactly one call, printSlip, nothing else (no api, no drawer, no order)', r.ok && hit.length === 1 && hit[0][0] === 'printSlip', JSON.stringify(hit));
  rec('print(): the log has counts only, never item names, prices or customer', log.length === 1 && !/Toy|Pat|14\.04|Bear/.test(log[0]), log.join('|'));
  const reg2 = { state: () => ({ ...st, pay: { tenders: [] } }), printSlip: async () => { hit.push(['x']); return { ok: true }; } };
  const r2 = await new Quote({ reg: reg2 }).print(); rec('print(): refused while a payment is open, prints nothing', !r2.ok && hit.length === 1, r2.message);
  const reg3 = { state: () => st, printSlip: async () => ({ ok: false, message: 'printer offline' }) };
  const r3 = await new Quote({ reg: reg3 }).print(); rec('print(): a printer failure is reported plainly', !r3.ok && /not printed: printer offline/.test(r3.message), r3.message);
  console.log(`${pass}/${pass + fail} quote tests passed`); process.exit(fail ? 1 : 0);
})();

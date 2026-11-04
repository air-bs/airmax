// AirMax #18 (Ari, Nov 2 2026) on the real screen against the OFFLINE fake AIR POS (made-up items only): a discounted item shows its
// discount on its own line under it, in green with the % ("33% off -$9.90"); totals, tax and what is sent to AIR POS are unchanged;
// the receipt that goes to the printer has the same line under the item (after the sale, P on the done screen and Ctrl+P Reprint).
// Labels, columns and keys unchanged. Needs the fake's real receipts: FAKE_REAL_RECEIPT=1 (or this test turns them on by hook).
//   FAKE_REAL_RECEIPT=1 FAKE_PORT=5180 node tests/look-fake.js &   FAKE_PORT=5180 node tests/e2e-disc-line-18.js   (Chrome on CHROME_URL, default 9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const { _pdf } = require('../app/disclines');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (Number(process.env.FAKE_HOOK_PORT) || FP + 1);
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.text()).then(t => { try { return JSON.parse(t); } catch { return t; } });
const pdfLines = b64 => { const buf = Buffer.from(b64, 'base64'), pdf = _pdf.readPdf(buf), ex = _pdf.extract(pdf, _pdf.pageList(pdf)[0]); return _pdf.textLines(ex.glyphs).map(l => l.text); };
const next = (arr, s) => arr[arr.indexOf(s) + 1];
async function waitPrinted(n, ms = 8000) { const end = Date.now() + ms; let p = []; while (Date.now() < end) { p = (await hook('/printed')).printed || []; if (p.length >= n) break; await sleep(250); } return p; }
(async () => {
  const b = await puppeteer.connect({ protocolTimeout: 60000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  let p;
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: 'test-pw' });
    await post('pay-close'); await post('new-sale'); await post('dismiss'); await hook('/real-receipt?on=1'); await hook('/printed?reset=1');
    p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}));
    await p.goto(BASE + '/'); await sleep(1500);
    const scan = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(1000); };
    const rows = () => p.$$eval('#cart tr.row', t => t.map(r => { const nm = r.cells[2], d = nm.querySelector('.discline'), tn = nm.firstChild, rg = document.createRange(); if (tn) rg.selectNodeContents(tn);
      const nb = tn ? rg.getBoundingClientRect() : null, db = d ? d.getBoundingClientRect() : null;
      return { name: tn ? tn.textContent : '', disc: d ? d.textContent : null, color: d ? getComputedStyle(d).color : null, under: !!(nb && db && db.top >= nb.bottom - 1 && Math.abs(db.left - nb.left) < 2),
        discCol: r.cells[5].innerText.trim(), total: r.cells[6].innerText.trim(), sel: r.classList.contains('sel'), cells: r.cells.length }; }));
    // the cashier's own way: scan, *3 for the quantity, F4 Item discount 33 %
    await scan('1001'); await p.focus('#scanInput'); await p.keyboard.type('*3'); await p.keyboard.press('Enter'); await sleep(1000);
    let r0 = await rows();
    rec('S1 no discount yet: no extra line under the item', r0.length === 1 && r0[0].disc === null && r0[0].total === '$30.00', JSON.stringify(r0));
    await p.click('#cart tr.row'); await sleep(200); await p.keyboard.press('F4'); await sleep(600);
    await p.$eval('#ldVal', e => { e.value = ''; }); await p.type('#ldVal', '33'); await p.keyboard.press('Enter'); await sleep(1500);
    await scan('1002');
    const r1 = await rows(), candy = r1.find(r => r.name === 'Bulk candy (lb)'), toy = r1.find(r => r.name === 'Toy car');
    rec('S2 F4 33% on 3 x $10.00: "33% off -$9.90" on its own line under the item name, in green', candy && candy.disc === '33% off -$9.90' && candy.under && candy.color === 'rgb(30, 123, 52)', JSON.stringify(candy));
    rec('S3 an item without a discount has no line under it', toy && toy.disc === null, JSON.stringify(toy));
    rec('S4 one row per item, same 7 cells; the Discount column and the line total are as before (−$9.90 (33%), $20.10)', r1.length === 2 && r1.every(r => r.cells === 7) && candy.discCol === '−$9.90 (33%)' && candy.total === '$20.10', `${candy && candy.discCol} / ${candy && candy.total}`);
    const heads = await p.$$eval('#cartHead th', x => x.map(e => e.textContent.trim())); // the words themselves (CSS shows them in capitals)
    rec('S5 column headings unchanged', heads.join('|') === '#|Lookup Code|Name|Qty|Price|Discount|Total', heads.join('|'));
    const s1 = await state();
    rec('S6 totals and tax are the fake AIR POS answer, unchanged by the line (25.10 + 8% = $27.11)', s1.totals.due === 27.11 && Math.abs(s1.totals.tax - 2.01) < 0.005 && s1.cart.find(c => c.number === '1001').discountAmount === 9.9, `due ${s1.totals.due} tax ${s1.totals.tax}`);
    // Step 0 draws the newest line at the BOTTOM (rows reversed in the DOM), so the just-scanned Toy car is the selected, bottom row:
    // ArrowDown has nowhere to go (stays), ArrowUp moves one line up to the discounted Bulk candy; ArrowDown goes back down.
    const sels = rs => rs.filter(r => r.sel).map(r => r.name), isGreen = r => r && r.color === 'rgb(30, 123, 52)';
    const r2a = await rows(); await p.focus('#scanInput'); await p.keyboard.press('ArrowDown'); await sleep(500); const r2b = await rows();
    await p.keyboard.press('ArrowUp'); await sleep(500); const r2 = await rows();
    await p.keyboard.press('ArrowDown'); await sleep(500); const r2d = await rows();
    await p.keyboard.press('ArrowUp'); await sleep(500); const r2e = await rows();
    rec('S7 arrow keys still move line by line (newest line at the bottom); the selected discounted line stays green',
      r2a.length === 2 && r2a[r2a.length - 1].name === 'Toy car' && r2a[0].name === 'Bulk candy (lb)' && sels(r2a).join() === 'Toy car' && sels(r2b).join() === 'Toy car' &&
      sels(r2).join() === 'Bulk candy (lb)' && isGreen(r2.find(r => r.sel)) && sels(r2d).join() === 'Toy car' && sels(r2e).join() === 'Bulk candy (lb)' && isGreen(r2e.find(r => r.sel)),
      JSON.stringify({ start: r2a.map(r => [r.name, r.sel]), down: sels(r2b), up: sels(r2), down2: sels(r2d), up2: sels(r2e) }));
    await p.screenshot({ path: SCR + 'disc-line-18-sale.png' });
    // pay cash through the real payment panel; the receipt prints by itself (Print receipt after every sale = Always)
    const c0 = (await hook('/all-calls')).length;
    await p.focus('#scanInput'); await p.keyboard.press('F12'); await sleep(1200);
    await p.click('.pline[data-i="1"] .plbl'); await sleep(300); await p.keyboard.press('+'); await sleep(300); await p.click('#payOk');
    await p.waitForFunction(() => /Sale complete/.test(document.getElementById('modalRoot').innerText), { timeout: 15000 }).catch(() => {});
    const done = await p.$eval('#modalRoot', e => e.innerText).catch(() => '');
    const pr1 = await waitPrinted(1), t1 = pr1.length ? pdfLines(pr1[pr1.length - 1]) : [];
    rec('R1 sale complete; the printed receipt has "33% off -$9.90" right under the item\'s line (1001 x3 $10.00 $20.10)', /Sale complete/.test(done) && next(t1, '1001 x3 $10.00 $20.10') === '33% off -$9.90', t1.join(' | ').slice(0, 200));
    rec('R2 nothing added under Toy car; the receipt amounts are the saved order\'s (25.10 / 2.01 / 27.11)', !/% off/.test(next(t1, '1002 x1 $5.00 $5.00') || '') && t1.includes('Sub Total $25.10') && t1.includes('Total $27.11'), `${next(t1, '1002 x1 $5.00 $5.00')} | ${t1.filter(x => /Total/.test(x)).join(' ; ')}`);
    const calls = (await hook('/all-calls')).slice(c0);
    rec('R3 AIR POS calls of the sale and receipt as before: no order look-up added (the line comes from the sale itself)', calls.includes('/Orders/RetailOrderComplete') && !calls.slice(calls.lastIndexOf('/Orders/RetailOrderComplete')).includes('/Orders/RetailOrderGet') && calls.filter(c => c === '/Orders/RetailOrderBillContentGet').length === 1, calls.join(' '));
    await p.keyboard.press('p'); const pr2 = await waitPrinted(pr1.length + 1), t2 = pr2.length > pr1.length ? pdfLines(pr2[pr2.length - 1]) : [];
    rec('R4 P on the done screen (print again): the same line under the item', next(t2, '1001 x3 $10.00 $20.10') === '33% off -$9.90', `${pr2.length} printed`);
    await sleep(800); if (await p.$('#dNew')) { await p.keyboard.press('Enter'); await sleep(800); }
    const n3 = (await waitPrinted(0, 10)).length; await p.focus('#scanInput'); await p.keyboard.down('Control'); await p.keyboard.press('p'); await p.keyboard.up('Control');
    const pr3 = await waitPrinted(n3 + 1), t3 = pr3.length > n3 ? pdfLines(pr3[pr3.length - 1]) : [];
    rec('R5 Ctrl+P Reprint Receipt (last sale): the same line under the item', next(t3, '1001 x3 $10.00 $20.10') === '33% off -$9.90', `${pr3.length} printed`);
    const s2 = await state();
    rec('R6 the next sale starts empty: no leftover line or discount', s2.cart.length === 0 && !(await rows()).length, `${s2.cart.length} lines`);
    rec('R7 no page errors', errs.length === 0, errs.join(' | ') || 'none');
    try { // picture of the printed receipt for the report (pdfium = the printer helper's engine), when python3 + pypdfium2 are here
      const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dl18e-')), f = path.join(d, 'r.pdf'); fs.writeFileSync(f, Buffer.from(pr1[pr1.length - 1], 'base64'));
      cp.execFileSync('python3', ['-I', '-c', 'import sys, pypdfium2 as p\npg = p.PdfDocument(sys.argv[1])[0]\npg.render(scale=576 / pg.get_size()[0]).to_pil().convert("L").point(lambda v: 0 if v < 128 else 255).save(sys.argv[2])', f, SCR + 'disc-line-18-receipt.png'], { stdio: 'ignore' });
    } catch { console.log('NOTE receipt picture not made (python3 pypdfium2 not installed)'); }
    await post('new-sale');
  } catch (e) { rec('run', false, e.stack); }
  finally { if (p) await p.close().catch(() => {}); b.disconnect(); }
  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} passed`); process.exit(pass === out.length ? 0 : 1);
})();

// Air Register 1.2.0: no-receipt return (Ctrl+R / Return button), outside click, sidebar reflow — OFFLINE fake AIR POS only.
// Run: node tests/fake-server.js & node tests/e2e-qr.js   (Chrome with --remote-debugging-port=9333)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const FP = Number(process.env.FAKE_PORT || 5058), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SCR = '/workspace/air-register-1.2.0-work/screens/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
(async () => {
  const b = await puppeteer.connect({ browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  const page = await b.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/'); await sleep(800);
  const st = () => page.evaluate(() => fetch('/api/state').then(r => r.json()));
  const apiP = (r, x) => page.evaluate((r, x) => fetch('/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json()), r, x);
  const calls = () => fetch(HOOK + '/').then(r => r.json()).then(j => j.calls);
  const fill = async (sel, v) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, v); };
  const scan = async c => { await page.evaluate(() => focusScan()); await page.keyboard.type(c); await page.keyboard.press('Enter'); await sleep(700); };
  const modalH = () => page.evaluate(() => { const m = document.querySelector('#modalRoot .ov, #ov'); return m ? m.innerText : ''; });
  if (!(await st()).loggedIn) { await fill('#lgCompany', 'fake shop'); await fill('#lgUser', 'tester'); await fill('#lgPw', 'fake'); await page.click('#lgBtn'); await sleep(2500); }
  await apiP('pay-close'); await apiP('new-sale'); await page.goto(BASE + '/'); await sleep(1200);
  await page.evaluate(() => localStorage.removeItem('airreg.panels')); await page.goto(BASE + '/'); await sleep(1000);

  // 1. return only, cash (default line), keyboard only
  const rb = await page.$eval('#right .rbtn[data-a="return"]', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  rec('Return button on the right panel shows its key', /Return/.test(rb) && /Ctrl \+ R/.test(rb), rb);
  await page.keyboard.down('Control'); await page.keyboard.press('r'); await page.keyboard.up('Control'); await sleep(600);
  let s = await st(); rec('Ctrl+R turns return scanning on (no dialog)', s.mix && s.mix.on && !(await modalH()), JSON.stringify(s.mix && s.mix.on));
  const on = await page.$eval('#right .rbtn[data-a="return"]', e => e.classList.contains('on'));
  rec('Return button lit while on', on, String(on));
  await scan('1001'); s = await st();
  const neg = await page.$$eval('#cart tr.neg', r => r.map(x => [getComputedStyle(x.cells[6]).color, x.innerText.replace(/\s+/g, ' ')]));
  rec('scanned item goes in as a red negative line', neg.length === 1 && /−\$/.test(neg[0][1]) && /192, 57, 43/.test(neg[0][0]), JSON.stringify(neg));
  rec('refund uses current price + tax (refundTaxNoReceipt on)', s.mix.totals.refund === 10.8 && s.mix.net === -10.8, JSON.stringify(s.mix.totals));
  await page.evaluate(() => focusScan()); await page.keyboard.press('Enter'); await sleep(800);
  let h = await modalH();
  rec('Enter opens the refund screen: Cash (default) + Card — refund on card machine, no extra text', /^Refund/.test(h.trim()) && /Cash/.test(h) && /Card — refund on card machine/.test(h) && !(await page.$('#modalRoot p.note')) && await page.$eval('.refl.hi', e => /Cash/.test(e.innerText)), h.replace(/\s+/g, ' '));
  await page.screenshot({ path: SCR + 'v120-refund-screen.png' });
  await page.keyboard.press('Enter'); await sleep(1200);
  h = await modalH(); const c1 = await calls();
  const nor = c1.filter(x => /NonOrderReturnOrderCreate/.test(x)).length;
  rec('Enter refunds through AIR POS NonOrderReturnOrderCreate', nor >= 1, c1.slice(-6).join(' '));
  rec('done screen: Give back $10.80 cash', /Give back/.test(h) && /\$10\.80/.test(h) && /cash/i.test(h), h.replace(/\s+/g, ' '));
  await page.keyboard.press('Enter'); await sleep(800); s = await st();
  rec('Enter = next sale; return cleared, return scanning off', !(await modalH()) && !s.mix.lines.length && !s.mix.on && s.mode === 'sale', JSON.stringify(s.mix));

  // 2. mixed: sale bigger than return -> normal payment for the net
  await scan('1001'); await scan('1001'); await page.click('#right .rbtn[data-a="return"]'); await sleep(500); await scan('1003'); await page.click('#right .rbtn[data-a="return"]'); await sleep(300);
  s = await st(); rec('mix: 2 sale lines qty + 1 return line, net = due − refund', s.cart.length === 1 && s.mix.lines.length === 1 && Math.abs(s.mix.net - (s.totals.due - 2.16)) < 0.001, `due ${s.totals.due} net ${s.mix.net}`);
  const tot = await page.$eval('#totals', e => e.innerText.replace(/\s+/g, ' ')); rec('totals show Return line and net Total', /Return −\$2\.16/.test(tot) && /Total \$19\.44/.test(tot), tot);
  await page.evaluate(() => focusScan()); await page.keyboard.press('Enter'); await sleep(1000);
  const due = await page.$eval('#payTotal', e => e.innerText).catch(() => ''), bal = await page.$eval('#payDue', e => e.innerText).catch(() => '');
  rec('payment screen Due/Balance are the net', due === '$19.44' && bal === '$19.44', due + ' / ' + bal);
  await page.keyboard.press('+'); await sleep(150); await page.keyboard.press('Enter'); await sleep(1800); s = await st(); h = await modalH();
  const c2 = await calls();
  rec('cash for the net completes sale + return (return recorded, sale paid)', /NonOrderReturnOrderCreate/.test(c2.join(' ')) && !s.mix.lines.length && !s.cart.length, c2.slice(-8).join(' ') + ' | ' + h.replace(/\s+/g, ' ').slice(0, 80));
  await page.keyboard.press('Escape'); await sleep(300); await apiP('new-sale'); await page.evaluate(() => refresh()); await sleep(300);

  // 3. mixed: return bigger than sale -> refund screen, Card (card machine) line by arrow
  await scan('1004'); await page.click('#right .rbtn[data-a="return"]'); await sleep(400); await scan('1001');
  s = await st(); rec('exchange with refund due: net negative', s.mix.net < 0, String(s.mix.net));
  await page.evaluate(() => focusScan()); await page.keyboard.press('Enter'); await sleep(800);
  await page.keyboard.press('ArrowUp'); await sleep(200); // owner request J: refund = payment-screen line order (Credit Card is above Cash)
  rec('Up picks Card — refund on card machine', await page.$eval('.refl.hi', e => /Card — refund on card machine/.test(e.innerText)), '');
  await page.keyboard.press('Escape'); await sleep(400); rec('Esc leaves the refund screen, nothing recorded', !(await modalH()) && (await st()).mix.lines.length === 1, '');
  await page.evaluate(() => focusScan()); await page.keyboard.press('Enter'); await sleep(800); await page.keyboard.press('Enter'); await sleep(1500);
  h = await modalH(); s = await st();
  rec('cash refund of the difference; sale paid by the return', /Give back/.test(h) && /\$9\.30/.test(h) && !s.cart.length && !s.mix.lines.length, h.replace(/\s+/g, ' '));
  await page.keyboard.press('Enter'); await sleep(500);

  // 4. Del removes a return line; hold refuses with return lines
  await page.click('#right .rbtn[data-a="return"]'); await sleep(400); await scan('1003'); await page.click('#right .rbtn[data-a="return"]'); await sleep(300);
  await page.evaluate(() => focusScan()); await page.keyboard.press('Delete'); await sleep(600); s = await st();
  rec('Del removes the return line', !s.mix.lines.length, JSON.stringify(s.mix.lines));

  // 5. outside click closes popups (not the payment screen)
  await scan('1001'); await page.keyboard.press('F6'); await sleep(600);
  const before = !!(await modalH()); await page.mouse.click(8, 300); await sleep(500);
  rec('click outside a popup closes it', before && !(await modalH()), String(before));
  await page.evaluate(() => focusScan()); await page.keyboard.press('Enter'); await sleep(900); await page.mouse.click(8, 300); await sleep(500);
  rec('payment screen stays (no outside)', !!(await page.$('#payBody')), '');
  await page.keyboard.press('Escape'); await sleep(500); await apiP('pay-close'); await apiP('new-sale'); await page.evaluate(() => { closeModal(); refresh(); }); await sleep(400);

  // 6. sidebar reflow (auto-fill grids) + drag
  const cols = () => page.evaluate(() => ({ a: getComputedStyle($('actions')).gridTemplateColumns.split(' ').length, r: getComputedStyle(document.querySelector('#right .rgrid')).gridTemplateColumns.split(' ').length, rs: $('right').scrollHeight }));
  await page.evaluate(() => setPanelWidths(110, 130)); await sleep(300); const nar = await cols();
  await page.screenshot({ path: SCR + 'v120-panels-narrow.png' });
  await page.evaluate(() => setPanelWidths(480, 420)); await sleep(300); const wid = await cols();
  await page.screenshot({ path: SCR + 'v120-panels-wide.png' });
  rec('narrow panels = one column', nar.a === 1 && nar.r === 1, JSON.stringify(nar));
  rec('wide panels = 3+ columns', wid.a >= 3 && wid.r >= 3, JSON.stringify(wid));
  const sz = await page.$eval('#sizeR', e => { const r = e.getBoundingClientRect(); return [r.x + 4, r.y + 200]; });
  await page.mouse.move(sz[0], sz[1]); await page.mouse.down(); await page.mouse.move(sz[0] + 150, sz[1], { steps: 5 }); await page.mouse.up(); await sleep(300);
  const w2 = await page.$eval('#rightAside', e => Math.round(e.getBoundingClientRect().width));
  rec('drag the right edge resizes the panel', Math.abs(w2 - 270) < 15, w2 + 'px');
  const keep = await page.evaluate(() => localStorage.getItem('airreg.panels'));
  await page.evaluate(() => { localStorage.removeItem('airreg.panels'); }); await page.goto(BASE + '/'); await sleep(900);
  rec('width remembered on this PC (localStorage airreg.panels)', /rw/.test(keep || ''), keep);
  for (const [w, hh] of [[1366, 768], [1920, 1080]]) { await page.setViewport({ width: w, height: hh }); await sleep(500); await page.screenshot({ path: SCR + `v120-sale-${w}x${hh}.png` }); }
  rec('no page errors', !errs.length, errs.join(' | '));
  fs.writeFileSync(__dirname + '/e2e-qr-results.json', JSON.stringify(out, null, 2));
  console.log(`${out.filter(x => x.pass).length}/${out.length} passed`); await page.close(); b.disconnect();
})().catch(e => { console.error(e); process.exit(1); });

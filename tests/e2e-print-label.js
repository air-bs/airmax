// Work copy (NOT released): Print Label (left column, Ctrl+Shift+P) + Add Gift Receipt moved to the left column (F10),
// Settings > Labels (Ctrl+8), against the OFFLINE fake AIR POS. Read-only labels: the sale, totals and AIR POS stay unchanged.
// Run: FAKE_SALE=1 AIRREG_DEV_PROBE=1 AIRMAX_LABEL_SINK=/tmp/look-labels FAKE_PORT=5180 node tests/look-fake.js &
//      LABEL_SINK=/tmp/look-labels FAKE_PORT=5180 node tests/e2e-print-label.js   (Chrome --remote-debugging-port=9433)
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs'), path = require('path');
const FP = Number(process.env.FAKE_PORT || 5180), BASE = 'http://127.0.0.1:' + FP, HOOK = 'http://127.0.0.1:' + (FP + 1);
const SINK = process.env.LABEL_SINK || '/tmp/look-labels';
const SCR = path.join(__dirname, '..', 'screens') + '/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const post = (r, x) => fetch(BASE + '/api/' + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(x || {}) }).then(r => r.json());
const state = () => fetch(BASE + '/api/state').then(r => r.json());
const hook = q => fetch(HOOK + q).then(r => r.json()).catch(() => ({ calls: [] }));
async function combo(p, key, mods) { for (const m of mods) await p.keyboard.down(m); await p.keyboard.press(key); for (const m of mods.slice().reverse()) await p.keyboard.up(m); }
const sinkFiles = () => { try { return fs.readdirSync(SINK).sort(); } catch { return []; } };
(async () => {
  fs.rmSync(SINK, { recursive: true, force: true }); fs.mkdirSync(SCR, { recursive: true });
  const b = await puppeteer.connect({ protocolTimeout: 30000, browserURL: (process.env.CHROME_URL || 'http://127.0.0.1:9433'), defaultViewport: { width: 1366, height: 768 } });
  try {
    if (!(await state()).loggedIn) await post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' });
    await post('pay-close'); await post('new-sale'); await post('dismiss');
    await post('label-settings-save', { settings: {} }); // defaults: no label printer = system print window
    const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.bringToFront();
    await p.goto(BASE + '/'); await sleep(1800);
    await p.evaluate(() => { window.__pl = []; window.__plDialog = x => { window.__pl.push({ name: x.item.name, copies: x.copies, svg: x.svg, w: x.w, h: x.h }); }; });
    const scanMain = async code => { await p.focus('#scanInput'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(900); };
    // 1. left column
    const col = await p.evaluate(() => [...document.querySelectorAll('#actions [data-a]')].filter(e => e.offsetParent).map(e => ({ a: e.dataset.a, t: e.innerText.replace(/\s+/g, ' ').trim(), bottom: Math.round(e.getBoundingClientRect().bottom) })));
    const ids = col.map(x => x.a), iR = ids.indexOf('return'), iP = ids.indexOf('print-label'), iG = ids.indexOf('gift-receipt');
    rec('Left column: Return, then Print Label (Ctrl + Shift + P), then Add Gift Receipt (F10)', iR >= 0 && iP === iR + 1 && iG === iP + 1 && /Print Label Ctrl \+ Shift \+ P/.test(col[iP].t) && /Add Gift Receipt F10/.test(col[iG].t), ids.join(','));
    const right = await p.$$eval('#right [data-a="gift-receipt"]', l => l.length);
    rec('Add Gift Receipt is no longer on the right side (only one on screen)', right === 0 && (await p.$$eval('[data-a="gift-receipt"]', l => l.length)) === 1, 'right ' + right);
    rec('Every left button still shows its key label', col.every(x => /(Ctrl|Alt|F\d)/.test(x.t) || x.a === 'price-change' || x.a === 'quote' /* new buttons of #23/#26 have no shortcut by design */), col.map(x => x.t).join(' | '));
    rec('Left column fits 1366 x 768 (no scrolling)', col.length && Math.max(...col.map(x => x.bottom)) <= 768 - 20, 'last bottom ' + Math.max(...col.map(x => x.bottom)));
    // 2. gift receipt from the left (same behaviour)
    await scanMain('1001');
    const cart0 = (await state()).cart.length;
    await p.focus('#scanInput'); await p.keyboard.press('F10'); await sleep(900);
    const g1 = { st: (await state()).giftReceipt, on: await p.$eval('#actions [data-a="gift-receipt"]', e => e.classList.contains('gifton')) };
    await p.screenshot({ path: SCR + 'printlabel-left-column.png' });
    await p.click('#actions [data-a="gift-receipt"]'); await sleep(900);
    const g2 = { st: (await state()).giftReceipt, on: await p.$eval('#actions [data-a="gift-receipt"]', e => e.classList.contains('gifton')) };
    rec('Gift Receipt on the left: F10 marks (highlighted), tap removes', g1.st === true && g1.on && g2.st === false && !g2.on, JSON.stringify([g1, g2]));
    // 3. Print Label mode (no label printer: system print window)
    const tot0 = JSON.stringify((await state()).totals);
    // fix/ctrl-shift-p-labels: Ctrl+Shift+P and the left button now open the several-items Print Labels screen (tested in e2e-print-labels.js);
    // the one-item screen has no key or button of its own any more, so the checks below open it through A['print-label-single'] (same code, same screen).
    await p.focus('#scanInput'); await combo(p, 'KeyP', ['Control', 'Shift']); await sleep(900);
    rec('Ctrl+Shift+P opens the several-items Print Labels screen (not the one-item screen)', await p.evaluate(() => !!document.querySelector('.plsmode') && !document.querySelector('.plmode')), 'plsmode');
    await p.keyboard.press('Escape'); await sleep(600);
    await p.evaluate(() => A['print-label-single']()); await sleep(900);
    const open1 = await p.evaluate(() => !!document.querySelector('.plmode') && document.activeElement && document.activeElement.id === 'plIn');
    rec('One-item Print Label screen opens with the cursor in its scan box', open1, String(open1));
    const scanPl = async code => { await p.focus('#plIn'); await p.keyboard.type(code); await p.keyboard.press('Enter'); await sleep(1100); };
    // 1.0.10-local.2 (Ari 11:40): no label printer = the screen says why; the print window opens only when the cashier asks (Enter / button)
    const scanPw = async code => { await scanPl(code); await p.focus('#plIn'); await p.keyboard.press('Enter'); await sleep(600); };
    { await scanPl('1002'); const why = await p.$eval('#plStatus', e => e.innerText); const btn = !!(await p.$('#plPw')); const n0 = await p.evaluate(() => (window.__pl || []).length);
      rec('No label printer: clear message why, print window NOT opened by itself, "Open print window" button shown', /no label printer is set in Settings > Labels/.test(why) && btn && n0 === 0, JSON.stringify({ why, btn, n0 }));
      await p.click('#plPw'); await sleep(600); const n1 = await p.evaluate(() => (window.__pl || []).length);
      rec('...the button still opens the print window', n1 === 1, 'labels ' + n1);
      await p.click('#plClear'); await sleep(300); await p.evaluate(() => { window.__pl.length = 0; }); }
    await scanPw('1002'); await scanPw('1001');
    const d1 = await p.evaluate(() => window.__pl.map(x => ({ name: x.name, copies: x.copies, sale: /\$3\.99/.test(x.svg), w: x.w, h: x.h })));
    rec('Each scan prints a label; on-sale item prints the SALE price $3.99; 2.25 x 1.25 in', d1.length === 2 && d1[0].name === 'Toy car' && d1[0].sale && d1[1].name === 'Bulk candy (lb)' && d1[0].w === 2.25 && d1[0].h === 1.25, JSON.stringify(d1));
    const rows = await p.$$eval('#plRows tr', l => l.map(r => r.innerText.replace(/\s+/g, ' ')));
    rec('Printed list shows both items (newest first), SALE mark, status Printed', rows.length === 2 && /Bulk candy/.test(rows[0]) && /Toy car.*SALE/.test(rows[1]) && rows.every(r => /Printed/.test(r)), rows.join(' / '));
    rec('Mode stays open after scans', await p.evaluate(() => !!document.querySelector('.plmode')), 'open');
    await p.click('#plPlus'); await p.click('#plPlus'); await sleep(200);
    const cp = await p.$eval('#plCopies', e => e.value); await scanPw('1002');
    const d2 = await p.evaluate(() => window.__pl[window.__pl.length - 1]);
    rec('+ / − copies: 3 copies of the next label', cp === '3' && d2.copies === 3, `copies ${cp} -> ${d2.copies}`);
    await p.click('#plMinus'); await sleep(200);
    rec('− lowers copies', (await p.$eval('#plCopies', e => e.value)) === '2', 'ok');
    await p.click('#plAgain'); await sleep(900); await p.focus('#plIn'); await p.keyboard.press('Enter'); await sleep(600);
    const d3 = await p.evaluate(() => ({ n: window.__pl.length, last: window.__pl[window.__pl.length - 1] }));
    rec('Print last label again', d3.n === 4 && d3.last.name === 'Toy car', 'labels ' + d3.n);
    await scanPl('nope-zz'); const bad = await p.$eval('#plStatus', e => e.innerText);
    rec('Unknown code: clear message, nothing printed', /Nothing found|not found/i.test(bad) && (await p.evaluate(() => window.__pl.length)) === 4, bad);
    await p.click('#plClear'); await sleep(300);
    rec('Clear list empties the list', (await p.$$eval('#plRows tr:not(.plnone)', l => l.length)) === 0 && (await p.$$eval('#plRows tr.plnone', l => l.length)) === 1, 'ok');
    await scanPw('1002'); await scanPw('rope');
    await p.screenshot({ path: SCR + 'printlabel-mode.png' });
    // direct to a label printer (Zebra = ZPL) through the printer helper (dev sink stands in for the printer)
    await post('label-settings-save', { settings: { printer: 'Zebra ZD220', copies: 1 } });
    const before = (await p.evaluate(() => window.__pl.length));
    await scanPl('1002');
    const files = sinkFiles(), zf = files.filter(f => f.endsWith('.zpl')), zpl = zf.length ? fs.readFileSync(path.join(SINK, zf[zf.length - 1]), 'utf8') : '', meta = zf.length ? JSON.parse(fs.readFileSync(path.join(SINK, zf[zf.length - 1].replace(/\.zpl$/, '.json')), 'utf8')) : {};
    rec('Label printer chosen: ZPL to that printer (not the screen), sale price $3.99, copies from the box (2)', zf.length === 1 && meta.printer === 'Zebra ZD220' && /\$3\.99/.test(zpl) && /\^PQ2/.test(zpl) && (await p.evaluate(() => window.__pl.length)) === before, `${zf.length} zpl, ${meta.printer}`);
    await post('label-settings-save', { settings: {} });
    // read-only
    const st1 = await state(), calls1 = (await hook('/x')).calls;
    const writes = calls1.filter(c => /Complete|Save|Update|Create|Delete|Receive|Return|Refund|Pay|Stock|Inventory|Bill/i.test(c) && !/Get$|Get\b|Paged|List$/.test(c)); // hook keeps the last 30 calls (all after the sale was rung)
    rec('Sale untouched: same cart lines and totals, no AIR POS writes', st1.cart.length === cart0 && JSON.stringify(st1.totals) === tot0 && writes.length === 0, `cart ${cart0}->${st1.cart.length}, writes ${JSON.stringify(writes)}`);
    // 1.0.10-local.2 (Ari 12:04) Quick settings inside Print Label: same label-settings as Settings > Labels
    { const q = await p.evaluate(() => ({ has: ['plqPr', 'plqSz', 'plqNs', 'plqBc', 'plqPc'].every(i => !!document.getElementById(i)), sub: (document.querySelector('.plsub') || {}).textContent || '', fs: Math.max(0, ...[...document.querySelectorAll('#plPrev [data-role="name"]')].map(e => +e.getAttribute('font-size'))) }));
      rec('Quick settings shown (printer, sticker size, name size, barcode, price); header text and Ctrl+, link kept', q.has && /Label printer:/.test(q.sub) && /Change in Settings \(Ctrl\+,\) > Labels\. The sale is not changed\./.test(q.sub), q.sub);
      await p.select('#plqNs', 'xlarge'); await sleep(900);
      const q2 = await p.evaluate(() => ({ fs: Math.max(0, ...[...document.querySelectorAll('#plPrev [data-role="name"]')].map(e => +e.getAttribute('font-size'))), msg: (document.getElementById('plqMsg') || {}).textContent || '' })), sv1 = (await post('label-settings')).settings || {};
      rec('Quick: Extra large saves to this PC\'s label settings and the preview name gets bigger', sv1.nameSize === 'xlarge' && q2.fs > q.fs && /Saved/.test(q2.msg), `${q.fs} -> ${q2.fs}, ${sv1.nameSize}`);
      await p.click('#plqBc'); await sleep(900);
      const sv2 = (await post('label-settings')).settings || {}, bars = await p.evaluate(() => !!document.querySelector('#plPrev g[data-code]'));
      rec('Quick: barcode off saves and the preview drops the barcode', sv2.show && sv2.show.barcode === false && !bars, String(bars));
      const rp = (await post('label-settings')).receiptPrinter || '';
      if (rp) { const g = await p.evaluate(async (rp) => { const s = document.getElementById('plqPr'); if (![...s.options].some(o => o.value === rp)) { const o = document.createElement('option'); o.value = rp; o.textContent = rp; s.appendChild(o); } const before = s.value; s.value = rp; s.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 900)); return { before, after: s.value, msg: document.getElementById('plqMsg').textContent }; }, rp), sv3 = (await post('label-settings')).settings || {};
        rec('Quick: the receipt printer is refused (same guard), picker goes back', /receipt printer/i.test(g.msg) && g.after === g.before && sv3.printer !== rp, g.msg); }
      else rec('Quick: receipt-printer guard (no receipt printer set in this test shop: checked in unit test Q5)', true, 'skipped here');
      await post('label-settings-save', { settings: {} }); }
    await p.keyboard.press('Escape'); await sleep(600);
    rec('Esc closes Print Label', await p.evaluate(() => !document.querySelector('.plmode')), 'closed');
    await p.click('#actions [data-a="print-label"]'); await sleep(800);
    const viaBtn = await p.evaluate(() => !!document.querySelector('.plsmode') && !document.querySelector('.plmode'));
    await p.click('#plsDone'); await sleep(600);
    rec('Left Print Label button opens the several-items screen (same as Ctrl+Shift+P); Done closes it', viaBtn && (await p.evaluate(() => !document.querySelector('.plmode') && !document.querySelector('.plsmode'))), String(viaBtn));
    // 4. Settings > Labels
    await p.focus('#scanInput'); await combo(p, 'Comma', ['Control']); await sleep(1300); await combo(p, 'Digit8', ['Control']); await sleep(1500);
    const tab = await p.evaluate(() => ({ prev: !!document.querySelector('#lbPrev svg'), txt: (document.querySelector('#lbPrev') || {}).innerHTML || '', reg: !!(document.querySelector('[data-show="regPrice"]') || {}).checked }));
    rec('Ctrl+8 opens Settings > Labels with a live preview; "Reg. $x" off by default', tab.prev && /YOU PAY/.test(tab.txt) && !tab.reg, `preview ${tab.prev}`);
    await p.click('#lbTag', { clickCount: 3 }); await p.keyboard.type('NOW ONLY'); await p.click('[data-show="regPrice"]'); await sleep(400);
    const tab2 = await p.$eval('#lbPrev', e => e.innerHTML);
    rec('Preview updates as you change it (tag text, Reg. line)', /NOW ONLY/.test(tab2) && /Reg\./.test(tab2), 'ok');
    await p.screenshot({ path: SCR + 'printlabel-settings.png' });
    await p.click('#lbSave'); await sleep(900);
    const sv = (await post('label-settings')).settings || {};
    rec('Save keeps it on this PC', sv.tag === 'NOW ONLY' && sv.show && sv.show.regPrice === true, JSON.stringify({ tag: sv.tag, reg: sv.show && sv.show.regPrice }));
    await combo(p, 'Digit6', ['Control']); await sleep(1200);
    const bt = await p.evaluate(() => ({ pl: !!document.querySelector('[data-bt="L:print-label"]'), gl: !!document.querySelector('[data-bt="L:gift-receipt"]'), gr: !!document.querySelector('[data-bt="R:gift-receipt"]') }));
    rec('Settings > Buttons lists Print Label and Add Gift Receipt under the left side', bt.pl && bt.gl && !bt.gr, JSON.stringify(bt));
    await p.keyboard.press('Escape'); await sleep(600);
    await post('label-settings-save', { settings: {} });
    // 5. 1024 x 768 fit
    await p.setViewport({ width: 1024, height: 768 }); await sleep(700);
    const fit = await p.evaluate(() => Math.max(...[...document.querySelectorAll('#actions [data-a]')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect().bottom)));
    rec('Left column fits 1024 x 768 too', fit <= 768 - 20, 'last bottom ' + Math.round(fit));
    rec('No page errors', errs.length === 0, errs.join('; ') || 'none');
    await post('new-sale'); await p.close();
  } catch (e) { rec('test run', false, e.message); }
  finally { b.disconnect(); }
  fs.writeFileSync(path.join(__dirname, 'e2e-print-label-results.json'), JSON.stringify(out, null, 1));
  const f = out.filter(x => !x.pass).length; console.log(`${out.length - f}/${out.length} passed`); process.exit(f ? 1 : 0);
})();

// AirMax Print Label (Ari OK 2:30 PM ET Oct 30, 2026): left button "Print Label" (Ctrl+Shift+P) opens a mode that stays open;
// every scan / typed code prints a sticker on the LABEL printer (Settings > Labels, Ctrl+8). READ-ONLY: it never adds a sale
// line and never changes the cart, totals, payment, inventory or AIR POS data (the server looks the price up itself).
'use strict';
(() => {
  const css = document.createElement('style');
  css.textContent = `
 .plmode { width:1180px; max-width:96vw; }
 .plmode h2 { margin:0 0 4px; } .plsub { color:#566573; font-size:13px; margin-bottom:12px; }
 .plwrap { display:grid; grid-template-columns: 1fr 330px; gap:18px; }
 .plscan { border:2px solid #2e86c1; border-radius:6px; font-size:22px; padding:12px 14px; width:100%; box-sizing:border-box; }
 .plscanlab { font-weight:700; font-size:16px; color:#1b2631; margin-bottom:6px; display:flex; justify-content:space-between; align-items:end; }
 .plcopies { display:flex; align-items:center; gap:6px; font-size:14px; font-weight:700; }
 .plcopies input { width:56px; font-size:20px; text-align:center; padding:6px; border:1px solid #aab7b8; border-radius:4px; }
 .plcopies .cbtn { display:inline-flex; align-items:center; justify-content:center; cursor:pointer; width:40px; height:40px; font-size:22px; border:0; border-radius:6px; background:#dfe6ec; color:#2c3e50; font-weight:700; }
 .pltabwrap { max-height:min(330px, calc(100vh - 380px)); overflow:auto; margin-top:12px; }
 .pltab { width:100%; border-collapse:collapse; font-size:14px; }
 .pltab th { position:sticky; top:0; text-align:left; font-size:12px; color:#566573; background:#f4f6f7; padding:7px 8px; border-bottom:1px solid #d5dbdb; }
 .pltab td { padding:8px; border-bottom:1px solid #eaeded; } .pltab td.n, .pltab th.n { text-align:right; }
 .pltab tr.last td { background:#eaf2f8; font-weight:700; } .pltab .plnone td { color:#7b8a8b; text-align:center; padding:18px; }
 .plok { color:#1e8449; font-weight:700; } .plbad { color:#c0392b; font-weight:700; } .plsale { color:#c0392b; font-size:11px; font-weight:700; margin-left:6px; }
 .plsum { margin-top:8px; font-size:14px; color:#1b2631; display:flex; justify-content:space-between; gap:10px; }
 .plprev { background:#eef1f3; border-radius:8px; padding:12px; display:flex; flex-direction:column; align-items:center; gap:10px; }
 .plprev h4, .lbprev h4 { margin:0; align-self:flex-start; font-size:13px; color:#566573; text-transform:uppercase; letter-spacing:.5px; }
 .lblbox { background:#fff; box-shadow:0 2px 8px #0003; border-radius:4px; overflow:hidden; line-height:0; }
 .lblbox.empty { display:flex; align-items:center; justify-content:center; color:#99a3a4; font-size:13px; line-height:1.3; text-align:center; }
 .plstatus { padding:8px 10px; font-weight:700; font-size:14px; margin-top:10px; border-radius:4px; min-height:20px; background:#f4f6f7; color:#566573; border-left:4px solid #aab7b8; }
 .plstatus.ok { background:#e9f7ef; color:#1e8449; border-left-color:#1e8449; } .plstatus.err { background:#fdedec; color:#c0392b; border-left-color:#c0392b; }
 .plpick { margin-top:8px; border:1px solid #d5dbdb; border-radius:6px; max-height:180px; overflow:auto; }
 .plpick button { display:flex; width:100%; justify-content:space-between; gap:10px; border:0; border-bottom:1px solid #eaeded; background:#fff; padding:8px 10px; font-size:14px; cursor:pointer; text-align:left; }
 .plpick button:hover, .plpick button:focus { background:#eaf2f8; }
 .lbgrid { display:grid; grid-template-columns: minmax(420px, 640px) 1fr; gap:28px; padding:6px 4px; }
 .lbgrid h3 { margin:14px 0 6px; font-size:14px; color:#1b2631; }
 .lbchk { display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; font-size:14px; }
 .lbchk label { display:flex; align-items:center; gap:8px; padding:7px 9px; background:#f4f6f7; border-radius:5px; cursor:pointer; }
 .lbchk input { width:18px; height:18px; }
 .lbprev { background:#eef1f3; border-radius:8px; padding:18px; display:flex; flex-direction:column; align-items:center; gap:12px; position:sticky; top:0; }
 .lbnote { font-size:12px; color:#566573; }
 .plquick { align-self:stretch; background:#fff; border-radius:6px; padding:8px 10px; display:grid; gap:6px; font-size:13px; }
 .plquick h4 { margin:0 0 2px; } .plquick label.f { font-size:12px; color:#566573; margin:0; } .plquick select { width:100%; font-size:14px; padding:4px; }
 .plquick .plqck { display:flex; gap:12px; } .plquick .plqck label { display:flex; align-items:center; gap:6px; cursor:pointer; } .plquick .plqmsg { font-size:12px; min-height:14px; }
 .row3 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
 .lbcustom { display:flex; gap:8px; align-items:center; font-size:13px; } .lbcustom input { width:70px; }`;
  document.head.appendChild(css);

  // Add Gift Receipt moved from the right panel to the left column: a PC that had hidden it keeps it hidden
  try { const k = 'airreg.hiddenButtons', h = JSON.parse(localStorage.getItem(k) || '[]'); if (Array.isArray(h) && h.includes('R:gift-receipt')) { localStorage.setItem(k, JSON.stringify([...new Set(h.map(x => (x === 'R:gift-receipt' ? 'L:gift-receipt' : x)))])); if (typeof applyButtons === 'function') applyButtons(); } } catch {}
  const L = window.AirLabel;
  let SET = null, LIST = [], LAST = null, COPIES = null, Q = [], busyQ = false, PENDING = null, QPREV = false; // PENDING: a label waiting for the print window (1.0.10-local.2)
  const ESC = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
  const box = (svg, px, s) => `<div class="lblbox" style="width:${Math.round(px * s.w)}px;height:${Math.round(px * s.h)}px">${svg}</div>`;
  const preview = (item, s, px) => box(L.toSvg(L.layout(item, s)), px, s);
  // 1.0.10-local.2: a Hebrew label is drawn here (the browser does right-to-left and has Hebrew fonts) and sent as a 1-bit picture
  async function raster(item, st) {
    const lay = L.layout(item, st), W = lay.W, H = lay.H, im = new Image();
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(L.toSvg(lay, true));
    await im.decode();
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.drawImage(im, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data, bpr = Math.ceil(W / 8), out = new Uint8Array(bpr * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114 < 160) out[y * bpr + (x >> 3)] |= 0x80 >> (x & 7); }
    let bin = ''; for (let i = 0; i < out.length; i += 8192) bin += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
    return { w: W, h: H, data: btoa(bin) };
  }
  async function labelPrint(body) {
    const r = await api('label-print', body);
    if (!r || !r.ok || !r.needImage || !r.item) return r;
    let image; try { image = await raster(r.item, (await loadSet()).settings); } catch (e) { return { ok: false, item: r.item, message: 'Could not draw the Hebrew label on this screen; nothing printed' }; }
    return api('label-print', { ...body, image });
  }
  async function loadSet() { const r = await api('label-settings'); SET = r && r.ok ? r : { settings: L.norm({}), receiptPrinter: '', direct: false }; return SET; }

  // no label printer chosen (or no printer helper on this PC): print the sticker through the Windows print window.
  // Tests replace window.__plDialog to see what would print without opening a real print window.
  function printDialog(item, s, copies) {
    const lay = L.layout(item, s), svg = L.toSvg(lay);
    if (typeof window.__plDialog === 'function') return window.__plDialog({ item, copies, svg, w: s.w, h: s.h });
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
    document.body.appendChild(f);
    const pages = Array.from({ length: copies }, () => `<div class="pg">${svg}</div>`).join('');
    f.contentDocument.open(); f.contentDocument.write(`<!doctype html><html><head><title>Label</title><style>@page{size:${s.w}in ${s.h}in;margin:0}html,body{margin:0}
      .pg{width:${s.w}in;height:${s.h}in;page-break-after:always;overflow:hidden}.pg:last-child{page-break-after:auto}svg{width:100%;height:100%}</style></head><body>${pages}</body></html>`);
    f.contentDocument.close();
    f.tabIndex = -1;
    // ls9: after the print window the focus came back to the hidden iframe, so the next scan / Esc went nowhere: give it back to the scan box
    const back = () => { try { window.focus(); const i = $('plIn'); if (i) i.focus(); } catch {} };
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch {} back(); setTimeout(back, 300); setTimeout(() => f.remove(), 60000); }, 150);
  }
  const statusEl = () => $('plStatus');
  function status(m, ok) { const e = statusEl(); if (!e) return; e.textContent = m || ''; e.className = 'plstatus' + (ok === true ? ' ok' : ok === false ? ' err' : ''); }
  function copiesNow() { const i = $('plCopies'); const n = Math.round(Number(i && i.value)); return Math.min(50, Math.max(1, Number.isFinite(n) && n > 0 ? n : 1)); }
  function render() {
    const tb = $('plRows'); if (!tb) return;
    tb.innerHTML = LIST.length ? LIST.slice().reverse().map((x, i) => `<tr class="${i === 0 ? 'last' : ''}"><td>${x.n}</td><td>${ESC(x.name)}${x.onSale ? '<span class="plsale">SALE</span>' : ''}</td><td>${ESC(x.code)}</td><td class="n">${x.price == null ? '—' : L.money(x.price)}</td><td class="n">${x.ok ? x.copies : 0}</td><td class="${x.ok ? 'plok' : 'plbad'}" title="${ESC(x.err || '')}">${x.ok ? 'Printed' : 'Failed'}</td></tr>`).join('')
      : '<tr class="plnone"><td colspan="6">Nothing printed yet. Scan an item.</td></tr>';
    const items = LIST.length, labels = LIST.reduce((a, x) => a + (x.ok ? x.copies : 0), 0);
    $('plSum').innerHTML = `<span><b>${items} item${items === 1 ? '' : 's'}</b> scanned · <b>${labels} label${labels === 1 ? '' : 's'}</b> printed</span><span style="color:#566573">Stays open: scan the next item. Done or Esc to close.</span>`;
    $('plPrev').innerHTML = LAST ? preview(LAST.item, SET.settings, 130) : QPREV ? preview(L.SAMPLE, SET.settings, 130) : `<div class="lblbox empty" style="width:${Math.round(130 * SET.settings.w)}px;height:${Math.round(130 * SET.settings.h)}px">The last label<br>shows here</div>`;
    $('plAgain').disabled = !LAST;
  }
  async function doPrint(body, codeShown) {
    const copies = body.copies;
    const r = await labelPrint( body);
    if (!$('plRows')) return r; // closed meanwhile (the label still printed)
    if (r && r.ok && r.list) return pick(r.list, codeShown);
    const it = r && r.item;
    const row = !body.test && (it || codeShown) ? { n: LIST.length + 1, name: it ? it.name : '(not found)', code: it ? (r.code || it.upc || it.number) : codeShown, price: r && r.price != null ? r.price : null, onSale: !!(r && r.onSale), copies: (r && r.copies) || copies, ok: !!(r && r.ok && !r.dialog), err: r && r.dialog ? 'Not printed yet (print window)' : r && r.message } : null;
    if (row) LIST.push(row);
    if (r && r.ok && r.dialog) { // 1.0.10-local.2: say why, the cashier opens the print window (button or Enter on the empty scan box)
      LAST = { item: it, code: body.code || it.number }; const n = r.copies || copies;
      PENDING = () => { PENDING = null; if (row) { row.ok = true; row.err = ''; } printDialog(it, SET.settings, n); status(`🖨 Sent to the print window: ${it.name} · ${L.money(r.price)}`, true); render(); };
      status(`🖨 ${r.message}: ${it.name} · ${L.money(r.price)}`, null);
      const e = statusEl(); if (e) { const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'pbtn s'; bt.id = 'plPw'; bt.style.marginLeft = '8px'; bt.textContent = 'Open print window'; bt.onclick = () => { if (PENDING) PENDING(); const i = $('plIn'); if (i) i.focus(); }; e.appendChild(bt); }
      render(); return r;
    }
    PENDING = null;
    if (r && r.ok) { LAST = { item: it, code: body.code || it.number }; status('✓ ' + `${r.message} · ${L.money(r.price)}`, true); if (typeof scanSound === 'function') try { scanSound(true); } catch {} }
    else { status('✗ ' + ((r && r.message) || 'Label did not print'), false); if (typeof scanSound === 'function') try { scanSound(false); } catch {} }
    render(); return r;
  }
  function pick(list, code) {
    status(`Several items match "${code}". Pick one:`, null);
    const p = $('plPick'); p.style.display = '';
    p.innerHTML = list.slice(0, 30).map((x, i) => `<button type="button" data-i="${i}"><span>${ESC(x.name)}</span><span>${ESC(x.number || x.upc || '')} · ${x.price == null ? '' : L.money(x.price)}</span></button>`).join('');
    p.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const x = list[+b.dataset.i]; p.style.display = 'none'; p.innerHTML = ''; enqueue(x.number || x.upc); $('plIn').focus(); });
  }
  // one scan = one print, in order; fast scanning queues, never drops
  function enqueue(code) { Q.push({ code, copies: copiesNow() }); pump(); }
  async function pump() {
    if (busyQ) return; busyQ = true;
    try { while (Q.length && $('plRows')) { const j = Q.shift(); await doPrint({ code: j.code, copies: j.copies }, j.code); } }
    finally { busyQ = false; }
  }
  // 1.0.10-local.2 (Ari 12:04 "quick settings, I could change it right away"): the same per-PC label-settings.json as Settings > Labels
  const prText = s => s.method === 'dialog' || !s.printer ? 'Windows print window (no label printer chosen)' : s.printer + (L.isZpl(s.printer, s.method) ? ' (ZPL)' : '');
  const szText = s => s.size === 'custom' ? `${s.w} × ${s.h} in` : ((L.SIZES.find(x => x[0] === s.size) || [])[1] || `${s.w} × ${s.h} in`);
  function quickHtml(s, printers, receipt) {
    const opt = (v, t, sel) => `<option value="${ESC(v)}" ${sel ? 'selected' : ''}>${ESC(t)}</option>`;
    const names = [...new Set([...(printers || []), s.printer].filter(Boolean))];
    const pr = opt('', 'None: Windows print window', !s.printer) + names.map(n => opt(n, n + (n === receipt ? ' (receipt printer, not for labels)' : ''), n === s.printer)).join('');
    const sz = L.SIZES.filter(x => x[0] !== 'custom' || s.size === 'custom').map(x => opt(x[0], x[0] === 'custom' ? `Custom ${s.w} × ${s.h} in` : x[1], x[0] === s.size)).join('');
    const ns = opt('same', 'Same as font size', s.nameSize === 'same') + opt('large', 'Large', s.nameSize === 'large') + opt('xlarge', 'Extra large', s.nameSize === 'xlarge');
    return `<div class="plquick" id="plQuick"><h4>Quick settings</h4>
      <div><label class="f" for="plqPr">Label printer</label><select id="plqPr" data-nok="1">${pr}</select></div>
      <div><label class="f" for="plqSz">Sticker size</label><select id="plqSz" data-nok="1">${sz}</select></div>
      <div><label class="f" for="plqNs">Name size</label><select id="plqNs" data-nok="1">${ns}</select></div>
      <div class="plqck"><label><input type="checkbox" id="plqBc" ${s.show.barcode ? 'checked' : ''}>Barcode</label><label><input type="checkbox" id="plqPc" ${s.show.price ? 'checked' : ''}>Price</label></div>
      <div class="plqmsg" id="plqMsg"></div></div>`;
  }
  function quickWire() {
    const q = $('plQuick'); if (!q) return;
    const save = async () => {
      const cur = (await loadSet()).settings; // fresh from this PC's file (one source of truth)
      const next = { ...cur, show: { ...cur.show, barcode: $('plqBc').checked, price: $('plqPc').checked }, printer: $('plqPr').value, size: $('plqSz').value, nameSize: $('plqNs').value };
      const x = await api('label-settings-save', { settings: next }); // same guard as Settings > Labels (never the receipt printer)
      if (!$('plQuick')) return;
      if (!x || !x.ok) { $('plqMsg').textContent = (x && x.message) || 'Not saved'; $('plqMsg').style.color = '#c0392b'; $('plqPr').value = cur.printer; $('plqSz').value = cur.size; $('plqNs').value = cur.nameSize; $('plqBc').checked = !!cur.show.barcode; $('plqPc').checked = !!cur.show.price; return; }
      await loadSet(); QPREV = true; $('plqMsg').textContent = 'Saved for this PC (also in Settings > Labels)'; $('plqMsg').style.color = '#1e8449';
      $('plPr').textContent = prText(SET.settings); $('plSz').textContent = szText(SET.settings); render(); if ($('plIn')) $('plIn').focus(); // scanner keeps typing into the scan box
    };
    q.querySelectorAll('select, input').forEach(e => e.addEventListener('change', save));
  }
  async function openMode() {
    if (S.mode === 'clockin') return;
    const [, plist] = await Promise.all([loadSet(), api('printers').catch(() => null)]); const s = SET.settings; if (COPIES == null) COPIES = s.copies;
    const pr = prText(s), sz = szText(s);
    modal(`<h2>Print Label</h2><div class="plsub">Label printer: <b id="plPr">${ESC(pr)}</b> · Sticker <span id="plSz">${ESC(sz)}</span> · Change in Settings (Ctrl+,) &gt; Labels. The sale is not changed.</div>
      <div class="plwrap"><div>
        <div class="plscanlab"><span>Scan items to print labels</span>
          <span class="plcopies">Copies per scan <button type="button" class="cbtn" id="plMinus" data-nok="1" aria-label="One copy less">−</button><input id="plCopies" inputmode="numeric" value="${COPIES}"><button type="button" class="cbtn" id="plPlus" data-nok="1" aria-label="One copy more">+</button></span></div>
        <input class="plscan" id="plIn" placeholder="Scan or type barcode, then Enter" autocomplete="off" autofocus>
        <div class="plpick" id="plPick" style="display:none"></div>
        <div class="plstatus" id="plStatus" role="status">Ready. Each scan prints a label; nothing is added to the sale.</div>
        <div class="pltabwrap"><table class="pltab"><thead><tr><th>#</th><th>Item</th><th>Code</th><th class="n">Price</th><th class="n">Labels</th><th>Status</th></tr></thead><tbody id="plRows"></tbody></table></div>
        <div class="plsum" id="plSum"></div>
      </div>
      <div class="plprev">${quickHtml(s, plist && plist.ok && plist.printers, SET.receiptPrinter)}<h4>Last label</h4><div id="plPrev"></div>
        <button class="pbtn s" id="plAgain" style="width:100%">Print last label again</button>
        <button class="pbtn s" id="plTest" style="width:100%">Test label</button></div></div>
      <div class="row2" style="margin-top:14px;justify-content:flex-end;display:flex;gap:10px"><button class="pbtn s" id="plLayouts" title="Several items, a layout per item, Label price (printout only)">Print Labels (layouts)</button><button class="pbtn s" id="plClear">Clear list</button><button class="pbtn g" id="plDone" style="min-width:160px">Done <kbd>Esc</kbd></button></div>`, () => {
      render(); quickWire();
      const ci = $('plCopies'), keep = () => { COPIES = copiesNow(); ci.value = COPIES; };
      $('plMinus').onclick = () => { ci.value = Math.max(1, copiesNow() - 1); keep(); $('plIn').focus(); };
      $('plPlus').onclick = () => { ci.value = Math.min(50, copiesNow() + 1); keep(); $('plIn').focus(); };
      ci.onchange = keep; ci.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); keep(); $('plIn').focus(); } };
      $('plIn').addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== 'Tab') return;
        const v = e.target.value.trim(); e.preventDefault(); e.target.value = ''; if (!v) { if (e.key === 'Enter' && PENDING) PENDING(); return; }
        $('plPick').style.display = 'none'; enqueue(v);
      });
      $('plAgain').onclick = () => { if (LAST) Q.push({ code: LAST.code, copies: copiesNow() }), pump(); $('plIn').focus(); };
      $('plTest').onclick = async () => { await doPrint({ test: true, copies: 1 }, ''); $('plIn') && $('plIn').focus(); };
      $('plClear').onclick = () => { LIST = []; LAST = null; render(); status('List cleared', null); $('plIn').focus(); };
      $('plDone').onclick = () => { Q = []; closeModal(); };
      $('plLayouts').onclick = () => { Q = []; closeModal(); if (A['print-labels']) A['print-labels'](); };
    }, 'plmode');
  }
  A['print-label-single'] = openMode; // fix/ctrl-shift-p-labels: the one-item-at-a-time screen, no key or button of its own any more (kept for the tests)
  A['print-label'] = () => (A['print-labels'] ? A['print-labels']() : openMode()); // Ctrl+Shift+P and the left Print Label button open the several-items Print Labels screen (one or many items)

  // ---------- Settings > Labels (Ctrl+8): saved on THIS PC only (label-settings.json), no AIR POS change ----------
  window.labelsTab = async function labelsTab() {
    const [cur, pl] = await Promise.all([loadSet(), api('printers').catch(() => null)]);
    const s = cur.settings; // any cashier may set the label printer on this PC (like the receipt printer)
    const names = [...new Set([...(pl && pl.ok && pl.printers || []), s.printer].filter(Boolean))];
    const opt = (v, t, sel) => `<option value="${ESC(v)}" ${sel ? 'selected' : ''}>${ESC(t)}</option>`;
    const prOpts = opt('', 'None: use the Windows print window', !s.printer) + names.map(n => opt(n, n + (n === cur.receiptPrinter ? ' (receipt printer, not for labels)' : ''), n === s.printer)).join('');
    const ck = (k, t) => `<label><input type="checkbox" data-show="${k}" ${s.show[k] ? 'checked' : ''}>${t}</label>`;
    modal(`<h2>Labels</h2><div class="lbgrid"><div>
      <div class="row3"><div><label class="f" for="lbPr">Label printer</label><select class="f" id="lbPr">${prOpts}</select></div>
      <div><label class="f" for="lbMe">Print method</label><select class="f" id="lbMe">${opt('auto', 'Automatic (ZPL or Windows)', s.method === 'auto')}${opt('zpl', 'Direct ZPL (Zebra)', s.method === 'zpl')}${opt('driver', 'Windows driver', s.method === 'driver')}${opt('dialog', 'Windows print window', s.method === 'dialog')}</select></div></div>
      <div class="row3"><div><label class="f" for="lbSz">Sticker size</label><select class="f" id="lbSz">${L.SIZES.map(x => opt(x[0], x[1], x[0] === s.size)).join('')}</select>
        <div class="lbcustom" id="lbCu" style="display:${s.size === 'custom' ? 'flex' : 'none'}"><input class="f" id="lbW" type="number" step="0.05" min="0.75" max="6" value="${s.w}"> × <input class="f" id="lbH" type="number" step="0.05" min="0.5" max="6" value="${s.h}"> in</div></div>
      <div><label class="f" for="lbPm">Price to print</label><select class="f" id="lbPm">${opt('sale', 'Sale price, else regular', s.priceMode === 'sale')}${opt('regular', 'Regular price only', s.priceMode === 'regular')}</select></div></div>
      <h3>What the label shows</h3>
      <div class="lbchk">${ck('name', 'Item name (capitals)')}${ck('barcode', 'Barcode')}${ck('price', 'Price')}${ck('tag', 'Price tag word')}${ck('digits', 'Numbers under barcode')}${ck('regPrice', '"Reg. $x" line (when on sale)')}${ck('sku', 'SKU / item number')}${ck('store', 'Store name')}</div>
      <div class="row3" style="margin-top:6px"><div><label class="f" for="lbTag">Price tag text</label><input class="f" id="lbTag" maxlength="24" value="${ESC(s.tag)}"></div>
      <div><label class="f" for="lbSt">Store name text</label><input class="f" id="lbSt" maxlength="40" value="${ESC(s.store)}"></div></div>
      <div class="row3"><div><label class="f" for="lbFo">Font size</label><select class="f" id="lbFo">${opt('small', 'Small', s.font === 'small')}${opt('normal', 'Normal', s.font === 'normal')}${opt('large', 'Large', s.font === 'large')}</select></div><div><label class="f" for="lbNs">Name size</label><select class="f" id="lbNs">${opt('same', 'Same as font size', s.nameSize === 'same')}${opt('large', 'Large', s.nameSize === 'large')}${opt('xlarge', 'Extra large', s.nameSize === 'xlarge')}</select></div>
      <div><label class="f" for="lbCo">Copies per scan (default)</label><input class="f" id="lbCo" type="number" min="1" max="50" value="${s.copies}"></div></div>
      <div class="row3"><div><label class="f" for="lbDk">Darkness</label><select class="f" id="lbDk">${opt('light', 'Lighter', s.darkness === 'light')}${opt('normal', 'Normal', s.darkness === 'normal')}${opt('dark', 'Darker', s.darkness === 'dark')}</select></div><div></div></div>
      <div id="lbMsg" class="msg"></div>
      <div class="row2" style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="pbtn s" id="lbTest">Print test label</button><button class="pbtn g" id="lbSave">Save</button></div>
      </div><div><div class="lbprev"><h4>Live preview (actual look)</h4><div id="lbPrev"></div>
      <div class="lbnote">Preview updates as you tick boxes or change the text. Sample item: Spinning Musical Dreidel, on sale $8.99 (regular $12.99).</div></div></div></div>`, () => {
      const md = $('modalRoot');
      const read = () => { const show = {}; md.querySelectorAll('[data-show]').forEach(c => { show[c.dataset.show] = c.checked; });
        return L.norm({ printer: $('lbPr').value, method: $('lbMe').value, size: $('lbSz').value, w: $('lbW').value, h: $('lbH').value, priceMode: $('lbPm').value, show, tag: $('lbTag').value, store: $('lbSt').value, font: $('lbFo').value, nameSize: $('lbNs').value, copies: $('lbCo').value, darkness: $('lbDk').value }); };
      const draw = () => { const n = read(); $('lbCu').style.display = n.size === 'custom' ? 'flex' : 'none'; const px = Math.min(175, 300 / n.w, 230 / n.h); $('lbPrev').innerHTML = preview(L.SAMPLE, n, px); };
      md.querySelectorAll('.lbgrid input, .lbgrid select').forEach(e => { e.addEventListener('input', draw); e.addEventListener('change', draw); });
      draw();
      const save = async () => { const x = await api('label-settings-save', { settings: read() }); if (x.ok) { SET = null; COPIES = null; } msgIn($('lbMsg'), x); return x; };
      $('lbSave').onclick = save;
      $('lbTest').onclick = async () => { const x = await save(); if (!x.ok) return; await loadSet(); const r = await labelPrint( { test: true, copies: 1 });
        msgIn($('lbMsg'), r.ok ? { ok: true, message: r.dialog ? r.message.replace(' (or Enter)', '') : 'Test label printed' } : r);
        if (r.ok && r.dialog && $('lbMsg')) { const bt = document.createElement('button'); bt.type = 'button'; bt.className = 'pbtn s'; bt.style.marginLeft = '8px'; bt.textContent = 'Open print window'; bt.onclick = () => { bt.remove(); printDialog(r.item, SET.settings, 1); }; $('lbMsg').appendChild(bt); } };
    });
  };
})();

// Air Max 1.0.11-local.9 (Ari OK 6:30 PM ET Nov 1, test build): Print Labels with layouts (First Choice "Printout" screen).
// Scan or search items into a grid, set copies, pick a layout per item, print. Opened by Ctrl+Shift+P and the left
// "Print Label" button (one item or many). READ-ONLY toward AIR POS: item lookups only. The Label price changes ONLY the printed label;
// it is never sent to AIR POS. Default layout per item / department is saved on this PC (label-layouts.json).
'use strict';
(() => {
  const css = document.createElement('style');
  css.textContent = `
 .plsmode { width:1260px; max-width:97vw; }
 .plsmode h2 { margin:0 0 2px; } .plssub { color:#566573; font-size:13px; margin-bottom:10px; }
 .plstop { display:grid; grid-template-columns: 1fr auto auto auto; gap:12px; align-items:end; }
 .plstop label.f { font-size:12px; color:#566573; display:block; margin-bottom:3px; }
 .plstop select, .plstop input.n { font-size:16px; padding:7px; border:1px solid #aab7b8; border-radius:4px; }
 .plstop input.n { width:64px; text-align:center; }
 .plswrap { display:grid; grid-template-columns: minmax(0,1fr) 310px; gap:16px; margin-top:10px; }
 .plsgrid { max-height:min(360px, calc(100vh - 360px)); overflow:auto; border:1px solid #d5dbdb; border-radius:6px; }
 .plstab { width:100%; border-collapse:collapse; font-size:13px; }
 .plstab th { position:sticky; top:0; z-index:1; text-align:left; font-size:11.5px; color:#566573; background:#f4f6f7; padding:6px; border-bottom:1px solid #d5dbdb; white-space:nowrap; }
 .plstab td { padding:5px 6px; border-bottom:1px solid #eaeded; vertical-align:middle; } .plstab .n { text-align:right; white-space:nowrap; }
 .plstab tr.sel td { background:#eaf2f8; } .plstab tr { cursor:pointer; } .plstab .none td { text-align:center; color:#7b8a8b; padding:20px; cursor:default; }
 .plstab input.lp { width:78px; font-size:14px; padding:4px; text-align:right; border:1px solid #aab7b8; border-radius:4px; }
 .plstab input.lp.bad { border-color:#c0392b; background:#fdedec; } .plstab input.cp { width:46px; font-size:14px; padding:4px; text-align:center; border:1px solid #aab7b8; border-radius:4px; }
 .plstab select { font-size:12.5px; padding:3px; max-width:210px; } .plsfrom { display:block; font-size:10.5px; color:#7b8a8b; }
 .plstab .x { border:0; background:none; color:#c0392b; font-size:16px; cursor:pointer; }
 .plsside { background:#eef1f3; border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:8px; align-items:center; }
 .plsside h4 { margin:0; align-self:flex-start; font-size:12px; color:#566573; text-transform:uppercase; letter-spacing:.5px; }
 .plsnote { font-size:11.5px; color:#7d6608; background:#fef9e7; border-radius:4px; padding:4px 7px; align-self:stretch; } .plsnote.ok { color:#1e8449; background:#e9f7ef; }
 .plsdef { align-self:stretch; display:grid; gap:5px; } .plsdef button { font-size:12.5px; padding:6px 8px; }
 .plsbottom { display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap; }
 .plsbottom select { font-size:14px; padding:6px; max-width:300px; } .plsbottom .sp { flex:1; }
 .plsmsg { font-size:12px; min-height:14px; color:#c0392b; }
@media (max-width:1200px) { .plswrap { grid-template-columns:1fr; } .plsside { flex-direction:row; flex-wrap:wrap; align-items:flex-start; } .plsside h4 { display:none; } #plsPrev { flex-direction:row !important; flex-wrap:wrap; align-items:flex-start !important; } #plsPrev .lblbox { zoom:.75; } #plsPrev .plsnote { max-width:220px; align-self:flex-start; } .plsdef { flex:1; min-width:240px; } .plsgrid { max-height:calc(100vh - 500px); min-height:120px; } }
@media (min-width:1201px) and (max-height:900px) { .plssub { margin-bottom:5px; } .plswrap { grid-template-columns:minmax(0,1fr) 280px; } .plstab select { max-width:175px; } .plsdef .lbnote { font-size:10.5px; margin:0; } .plsmsg:empty { display:none; } #plsPrev .lblbox { zoom:.5; } .plsside { gap:5px; padding:8px; } .plsdef { gap:4px; } .plsdef button { font-size:11.5px; padding:4px 6px; } .plsside .plsnote { font-size:10.5px; } }
@media (max-width:1200px) and (max-height:900px) { #plsPrev .lblbox { zoom:.6; } .plsdef { grid-template-columns:1fr 1fr; } .plsdef button { font-size:11.5px; padding:4px 6px; } .plsgrid { max-height:calc(100vh - 470px); } }`;
  document.head.appendChild(css);
  const L = window.AirLabel, X = window.AirLabelLayouts;
  const ESC = s => (typeof esc === 'function' ? esc(s) : String(s ?? ''));
  let INFO = null, ROWS = [], SEL = -1, BUSY = false, Q = [], PENDING = null;
  const lid = l => X.byId(l) || X.byId(X.DEFAULT);
  const status = (m, ok) => { const e = $('plsStatus'); if (!e) return; e.textContent = m || ''; e.className = 'plstatus' + (ok === true ? ' ok' : ok === false ? ' err' : ''); };
  const copiesNow = () => { const n = Math.round(Number($('plsCopies') && $('plsCopies').value)); return Math.min(50, Math.max(1, n > 0 ? n : 1)); };
  // what one row prints (the same drawing the server prints)
  const stickers = r => X.render(r.item, r.layout, { dpi: INFO.settings.dpi, settings: INFO.settings, store: INFO.store, date: new Date().toLocaleDateString('en-US'), labelPrice: r.lp.ok ? r.lp.value : null });
  function previewHtml(r) {
    const parts = stickers(r), lay = lid(r.layout), px = Math.min(130, 290 / lay.w, (parts.length > 1 ? 150 : 240) / lay.h);
    return parts.map(p => `<div class="lblbox" style="width:${Math.round(px * lay.w)}px;height:${Math.round(px * lay.h)}px">${L.toSvg(p)}</div>`).join('')
      + `<div class="plsnote ${lay.matched ? 'ok' : ''}">${ESC(lay.name)} · ${lay.w} × ${lay.h} in${parts.length > 1 ? ' · ' + parts.length + ' stickers per copy' : ''}<br>${ESC(lay.note)}</div>`;
  }
  const layOpts = (cur, withAuto) => (withAuto ? `<option value="" ${!cur ? 'selected' : ''}>Item's default layout</option>` : '') + INFO.layouts.map(l => `<option value="${l.id}" ${l.id === cur ? 'selected' : ''}>${ESC(l.name)}</option>`).join('');
  const FROM = { item: 'item default', department: 'department default', store: 'store default', 'built-in': 'standard', picked: 'picked' };
  function draw() {
    const tb = $('plsRows'); if (!tb) return;
    tb.innerHTML = ROWS.length ? ROWS.map((r, i) => {
      const it = r.item, sale = Number(it.regular) > Number(it.price) + 0.004;
      return `<tr data-i="${i}" class="${i === SEL ? 'sel' : ''}"><td>${ESC(INFO.store || '')}</td><td>${ESC(it.name)}</td><td>${ESC(it.number || it.upc)}</td>
        <td class="n">${it.cost == null ? '—' : L.money(it.cost)}</td><td class="n">${Number.isFinite(Number(it.price)) ? L.money(it.price) : '—'}</td>
        <td class="n">${sale ? L.money(Number(it.regular) - Number(it.price)) : '—'}</td><td>${sale ? 'Sale (Reg. ' + L.money(it.regular) + ')' : 'Regular'}</td>
        <td><input class="lp${r.lp.ok ? '' : ' bad'}" data-lp="${i}" inputmode="decimal" placeholder="${Number.isFinite(Number(it.price)) ? Number(it.price).toFixed(2) : ''}" value="${ESC(r.lpRaw)}" title="${ESC(r.lp.ok ? 'Label price: changes only this label, never AIR POS' : r.lp.reason)}" autocomplete="off"></td>
        <td><select data-lay="${i}">${layOpts(r.layout)}</select><span class="plsfrom">${FROM[r.from] || ''}</span></td>
        <td><input class="cp" data-cp="${i}" inputmode="numeric" value="${r.copies}"></td><td><button class="x" data-x="${i}" title="Remove" aria-label="Remove">✕</button></td></tr>`;
    }).join('') : '<tr class="none"><td colspan="11">Scan or search an item to add it.</td></tr>';
    const n = ROWS.reduce((a, r) => a + r.copies * lid(r.layout).parts, 0);
    $('plsSum').textContent = `${ROWS.length} item${ROWS.length === 1 ? '' : 's'} · ${n} label${n === 1 ? '' : 's'}`;
    side(); wire();
  }
  function side() {
    const r = ROWS[SEL], p = $('plsPrev'), d = $('plsDef'); if (!p) return;
    if (!r) { p.innerHTML = '<div class="lblbox empty" style="width:290px;height:160px">Pick a row to see its label</div>'; d.style.display = 'none'; return; }
    p.innerHTML = previewHtml(r); d.style.display = '';
    const it = r.item, nm = lid(r.layout).name;
    $('plsDefItem').textContent = `Default for this item (${it.number || '—'}): ${nm}`; $('plsDefItem').disabled = !it.number;
    $('plsDefDept').textContent = it.dept ? `Default for department ${it.dept}: ${nm}` : 'No department in AIR POS'; $('plsDefDept').disabled = !it.dept;
    $('plsDefAll').textContent = `Default for all items: ${nm}`;
    $('plsDefClr').disabled = !(INFO.defaults.items[it.number] || (it.dept && INFO.defaults.depts[String(it.dept).toLowerCase()]));
  }
  function wire() {
    const tb = $('plsRows');
    tb.querySelectorAll('tr[data-i]').forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('input,select,button')) return; SEL = +tr.dataset.i; draw(); }));
    tb.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { ROWS.splice(+b.dataset.x, 1); SEL = Math.min(SEL, ROWS.length - 1); draw(); $('plsIn').focus(); });
    tb.querySelectorAll('[data-lay]').forEach(s => s.onchange = () => { const r = ROWS[+s.dataset.lay]; r.layout = s.value; r.from = 'picked'; SEL = +s.dataset.lay; draw(); });
    tb.querySelectorAll('[data-cp]').forEach(c => c.onchange = () => { const r = ROWS[+c.dataset.cp], n = Math.round(Number(c.value)); r.copies = Math.min(50, Math.max(1, n > 0 ? n : 1)); draw(); });
    tb.querySelectorAll('[data-lp]').forEach(inp => {
      const i = +inp.dataset.lp, r = ROWS[i]; let times = [], idle = null;
      const check = () => { r.lpRaw = inp.value; r.lp = X.priceGuard(inp.value, r.item.price); inp.classList.toggle('bad', !r.lp.ok); inp.title = r.lp.ok ? 'Label price: changes only this label, never AIR POS' : r.lp.reason; };
      // a scanner burst (or a 6+ digit code) in the price box goes to Lookup, never onto the label
      const toLookup = why => { const v = inp.value.trim(); times = []; inp.value = ''; r.lpRaw = ''; r.lp = { ok: true, value: null }; inp.classList.remove('bad'); status(`"${v}" ${why}: it went to Lookup, not the Label price.`, false); enqueue(v); SEL = i; setTimeout(draw, 0); };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (X.isBurst(times, inp.value) || (/^\d{6,}$/.test(inp.value.trim()))) { e.preventDefault(); return toLookup('looks like a scanned barcode'); }
          check(); if (e.key === 'Enter') { e.preventDefault(); if (!r.lp.ok) return status(r.lp.reason, false); SEL = i; draw(); status(r.lp.value == null ? 'Label price cleared: the AIR POS price prints' : `Label price ${L.money(r.lp.value)} for ${r.item.name}: only the label changes, AIR POS is not changed.`, true); $('plsIn').focus(); }
          return;
        }
        if (e.key.length === 1) { times.push(performance.now()); clearTimeout(idle); idle = setTimeout(() => { if (X.isBurst(times, inp.value)) toLookup('came in as fast as a scanner'); times = []; }, 120); }
      });
      inp.addEventListener('input', check);
      inp.addEventListener('change', () => { check(); SEL = i; draw(); });
    });
  }
  // add one item (scan / search); several matches -> pick list
  function enqueue(code) { Q.push({ code, copies: copiesNow() }); pump(); }
  async function pump() {
    if (BUSY) return; BUSY = true;
    try { while (Q.length && $('plsRows')) await add(Q.shift()); } finally { BUSY = false; }
  }
  async function add(j) {
    status(`Looking up ${j.code}…`, null);
    const r = await api('labels-lookup', { code: j.code });
    if (!$('plsRows')) return;
    if (r && r.ok && r.list) return pick(r.list, j.code);
    if (!r || !r.ok || !r.item) { status('✗ ' + ((r && r.message) || 'Not found'), false); if (typeof scanSound === 'function') try { scanSound(false); } catch {} return; }
    const forced = $('plsNewLay').value;
    const row = { item: r.item, layout: forced || r.layout, from: forced ? 'picked' : r.layoutFrom, copies: j.copies, lpRaw: '', lp: { ok: true, value: null } };
    ROWS.push(row); SEL = ROWS.length - 1; draw();
    status(`Added ${r.item.name} · ${Number.isFinite(Number(r.item.price)) ? L.money(r.item.price) : 'no price'} · ${lid(row.layout).name}`, true);
    if (typeof scanSound === 'function') try { scanSound(true); } catch {}
    if ($('plsAuto').checked) await doPrint([row], false);
  }
  function pick(list, code) {
    status(`Several items match "${code}". Pick one:`, null);
    const p = $('plsPick'); p.style.display = '';
    p.innerHTML = list.slice(0, 30).map((x, i) => `<button type="button" data-i="${i}"><span>${ESC(x.name)}</span><span>${ESC(x.number || x.upc || '')} · ${x.price == null ? '' : L.money(x.price)}</span></button>`).join('');
    p.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const x = list[+b.dataset.i]; p.style.display = 'none'; p.innerHTML = ''; enqueue(x.number || x.upc); $('plsIn').focus(); });
  }
  // the print window path (no label printer / no helper / Hebrew names): one page per sticker at its own size
  function printWindow(rows) {
    const pages = []; for (const r of rows) { const parts = stickers(r), lay = lid(r.layout); for (let c = 0; c < r.copies; c++) for (const p of parts) pages.push({ svg: L.toSvg(p), w: lay.w, h: lay.h }); }
    if (typeof window.__plsDialog === 'function') return window.__plsDialog(pages);
    const sizes = [...new Set(pages.map(p => p.w + 'x' + p.h))], nm = s => 'p' + s.replace(/\./g, '_');
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'; document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(`<!doctype html><html><head><title>Labels</title><style>${sizes.map(s => { const [w, h] = s.split('x'); return `@page ${nm(s)}{size:${w}in ${h}in;margin:0}.${nm(s)}{page:${nm(s)};width:${w}in;height:${h}in}`; }).join('')}
      @page{margin:0}html,body{margin:0}.pg{page-break-after:always;overflow:hidden}.pg:last-child{page-break-after:auto}svg{width:100%;height:100%}</style></head><body>${pages.map(p => `<div class="pg ${nm(p.w + 'x' + p.h)}">${p.svg}</div>`).join('')}</body></html>`);
    f.contentDocument.close(); f.tabIndex = -1;
    const back = () => { try { window.focus(); const i = $('plsIn'); if (i) i.focus(); } catch {} };
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch {} back(); setTimeout(back, 300); setTimeout(() => f.remove(), 60000); }, 150);
  }
  const body = rows => rows.map(r => ({ code: r.item.number || r.item.upc, copies: r.copies, layout: r.layout, labelPrice: r.lpRaw || '' }));
  async function doPrint(rows, preview) {
    if (!rows.length) return status('Add an item first', false);
    const bad = rows.find(r => !r.lp.ok); if (bad) { SEL = ROWS.indexOf(bad); draw(); return status(`${bad.item.name}: ${bad.lp.reason}`, false); }
    status(preview ? 'Making the PDF…' : 'Printing…', null);
    const r = await api('labels-print', { rows: body(rows), printer: $('plsPr').value, preview: !!preview });
    if (!$('plsRows')) return r;
    if (!r || !r.ok) { status('✗ ' + ((r && r.message) || 'Not printed'), false); return r; }
    if (preview && r.pdf) { showPdf(r.pdf, r.total); status(`✓ ${r.message}. Nothing was printed.`, true); return r; }
    if (r.dialog) {
      PENDING = () => { PENDING = null; printWindow(rows); status(`🖨 Sent ${r.total} label${r.total > 1 ? 's' : ''} to the print window`, true); };
      status('🖨 ' + r.message, null);
      const e = $('plsStatus'), bt = document.createElement('button'); bt.type = 'button'; bt.className = 'pbtn s'; bt.id = 'plsPw'; bt.style.marginLeft = '8px'; bt.textContent = 'Open print window'; bt.onclick = () => PENDING && PENDING(); e.appendChild(bt);
      return r;
    }
    status('✓ ' + r.message + (r.printer ? ' on ' + r.printer : ''), true); return r;
  }
  function showPdf(b64, total) {
    const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8], { type: 'application/pdf' }));
    if (typeof window.__plsPdf === 'function') return window.__plsPdf({ url, bytes: u8.length, total });
    const w = document.createElement('div'); w.id = 'plsPdfBox'; w.style.cssText = 'position:fixed;inset:4vh 6vw;z-index:9999;background:#fff;box-shadow:0 6px 30px #0007;border-radius:8px;display:flex;flex-direction:column';
    w.innerHTML = `<div style="display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid #ddd"><b style="flex:1">Label preview (PDF, ${total} label${total > 1 ? 's' : ''}, actual sizes): not printed</b><a class="pbtn s" href="${url}" download="labels-preview.pdf">Save PDF</a><button class="pbtn g" id="plsPdfClose">Close</button></div><iframe src="${url}" style="flex:1;border:0"></iframe>`;
    document.body.appendChild(w); $('plsPdfClose').onclick = () => { w.remove(); URL.revokeObjectURL(url); $('plsIn') && $('plsIn').focus(); };
  }
  async function saveDef(kind) {
    const r = ROWS[SEL]; if (!r) return;
    const key = kind === 'item' ? r.item.number : kind === 'dept' ? r.item.dept : '';
    const x = await api('labels-default-save', { kind, key, layout: r.layout });
    if (x && x.ok) INFO.defaults = x.defaults;
    $('plsDefMsg').textContent = (x && x.message) || 'Not saved'; $('plsDefMsg').style.color = x && x.ok ? '#1e8449' : '#c0392b'; side();
  }
  async function clearDef() {
    const r = ROWS[SEL]; if (!r) return; const msgs = [];
    if (INFO.defaults.items[r.item.number]) { const x = await api('labels-default-save', { kind: 'item', key: r.item.number, layout: null }); if (x.ok) INFO.defaults = x.defaults; msgs.push('item'); }
    else if (r.item.dept && INFO.defaults.depts[String(r.item.dept).toLowerCase()]) { const x = await api('labels-default-save', { kind: 'dept', key: r.item.dept, layout: null }); if (x.ok) INFO.defaults = x.defaults; msgs.push('department'); }
    $('plsDefMsg').textContent = msgs.length ? `Removed the ${msgs[0]} default` : 'Nothing to remove'; $('plsDefMsg').style.color = '#1e8449'; side();
  }
  async function openLabels() {
    if (S.mode === 'clockin') return;
    const [info, plist] = await Promise.all([api('labels-layouts'), api('printers').catch(() => null)]);
    if (!info || !info.ok) return toast((info && info.message) || 'Print Labels is not available', false);
    INFO = info; if (typeof closeModal === 'function' && modalOpen()) closeModal();
    const names = [...new Set([...((plist && plist.ok && plist.printers) || []), info.printer].filter(Boolean))];
    const prOpts = `<option value="" ${!info.printer ? 'selected' : ''}>Windows print window (pick a printer there)</option>` + names.map(n => `<option value="${ESC(n)}" ${n === info.printer ? 'selected' : ''}>${ESC(n)}${n === info.receiptPrinter ? ' (receipt printer, not for labels)' : ''}</option>`).join('');
    modal(`<h2>Print Labels</h2><div class="plssub">Scan or search items, set copies and the layout, then Print. <b>Label price</b> changes only the printed label; the item's price in AIR POS is not changed. Nothing is added to the sale.</div>
      <div class="plstop"><div><label class="f" for="plsIn">Lookup (scan or type, then Enter)</label><input class="plscan" id="plsIn" placeholder="Scan or type barcode / item number / name" autocomplete="off" autofocus></div>
        <div><label class="f" for="plsCopies">Copies</label><input class="n" id="plsCopies" inputmode="numeric" value="${Math.max(1, (info.settings && info.settings.copies) || 1)}"></div>
        <div><label class="f" for="plsNewLay">Layout for new items</label><select id="plsNewLay" data-nok="1">${layOpts('', true)}</select></div>
        <div><label style="display:flex;gap:6px;align-items:center;font-size:14px;font-weight:700;padding-bottom:8px"><input type="checkbox" id="plsAuto"> Auto Print</label></div></div>
      <div class="plpick" id="plsPick" style="display:none"></div>
      <div class="plstatus" id="plsStatus" role="status">Ready.</div>
      <div class="plswrap"><div><div class="plsgrid"><table class="plstab"><thead><tr><th>Site</th><th>Item name</th><th>Lookup code</th><th class="n">Cost</th><th class="n">Price</th><th class="n">Discount</th><th>Price rule</th><th>Label price</th><th>Layout</th><th>Copies</th><th></th></tr></thead><tbody id="plsRows"></tbody></table></div>
        <div class="plsum"><span id="plsSum"></span><span style="color:#566573">Label price: type a price like 4.99. A scanned barcode never becomes a price.</span></div></div>
        <div class="plsside"><h4>Label preview</h4><div id="plsPrev" style="display:flex;flex-direction:column;gap:8px;align-items:center"></div>
          <div class="plsdef" id="plsDef"><button class="pbtn s" id="plsDefItem"></button><button class="pbtn s" id="plsDefDept"></button><button class="pbtn s" id="plsDefAll"></button><button class="pbtn s" id="plsDefClr">Remove this item's default</button><div class="plsmsg" id="plsDefMsg"></div><div class="lbnote">Defaults are saved on this PC only. You can still change the layout on any row before printing.</div></div></div></div>
      <div class="plsbottom"><label class="f" for="plsPr" style="font-size:13px">Printer</label><select id="plsPr" data-nok="1">${prOpts}</select><span class="lbnote" id="plsPrMsg"></span><span class="sp"></span>
        <button class="pbtn s" id="plsReset">Reset</button><button class="pbtn s" id="plsPdf">Preview PDF</button><button class="pbtn g" id="plsPrint" style="min-width:150px">Print</button><button class="pbtn s" id="plsDone">Done <kbd>Esc</kbd></button></div>`, () => {
      draw();
      $('plsIn').addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== 'Tab') return;
        const v = e.target.value.trim(); e.preventDefault(); e.target.value = ''; if (!v) { if (e.key === 'Enter' && PENDING) PENDING(); return; }
        $('plsPick').style.display = 'none'; enqueue(v);
      });
      $('plsDefItem').onclick = () => saveDef('item'); $('plsDefDept').onclick = () => saveDef('dept'); $('plsDefAll').onclick = () => saveDef('store'); $('plsDefClr').onclick = clearDef;
      $('plsPr').onchange = async () => { const x = await api('labels-default-save', { kind: 'printer', printer: $('plsPr').value }); $('plsPrMsg').textContent = x && x.ok ? 'Saved for this PC' : (x && x.message) || 'Not saved'; $('plsPrMsg').style.color = x && x.ok ? '#1e8449' : '#c0392b'; if (!(x && x.ok)) $('plsPr').value = INFO.printer || ''; else INFO.printer = $('plsPr').value; };
      $('plsReset').onclick = () => { ROWS = []; SEL = -1; Q = []; PENDING = null; draw(); status('Cleared', null); $('plsIn').focus(); };
      $('plsPdf').onclick = () => doPrint(ROWS, true);
      $('plsPrint').onclick = () => doPrint(ROWS, false);
      $('plsDone').onclick = () => { Q = []; closeModal(); };
    }, 'plsmode');
  }
  A['print-labels'] = openLabels;
  window.__plsState = () => ({ rows: ROWS.map(r => ({ number: r.item.number, layout: r.layout, from: r.from, copies: r.copies, lpRaw: r.lpRaw, lpOk: r.lp.ok, price: r.item.price })), sel: SEL }); // tests only read this
})();

// Air Register 1.2.0 side panel: quick product search that stays open, and the bulk-item buttons (set up in Settings).
// Uses the helpers from app.js (S, A, api, act, modal, toast, esc, money, focusScan, refresh).
'use strict';
// ---------- quick search (stays open: no closing on blur or clicks elsewhere) ----------
(() => {
  let rows = [], sel = 0, t = null, seq = 0;
  const box = $('qsIn'), res = $('qsRes');
  const draw = () => {
    res.innerHTML = rows.length ? rows.map((p, i) => `<div class="${i === sel ? 'sel' : ''}" data-i="${i}"><span>${esc(p.name)}<small>${esc(p.number)}${p.upc ? ' · ' + esc(p.upc) : ''}</small></span><b>${p.price == null ? '—' : money(p.price)}</b></div>`).join('')
      : box.value.trim() ? '<p class="note" style="margin:4px">No products</p>' : '';
    res.querySelectorAll('[data-i]').forEach(d => d.onclick = () => add(rows[+d.dataset.i]));
  };
  const add = async p => {
    if (!p || !S.loggedIn) return;
    const r = await act('scan', { code: p.number });
    if (r && r.ok) focusScan(); // results stay listed for the next pick
  };
  const go = async () => {
    const q = box.value.trim(); const my = ++seq;
    if (!q) { rows = []; sel = 0; return draw(); }
    const r = await api('search', { keyword: q }); if (my !== seq) return;
    rows = (r.rows || []).slice(0, 30); sel = 0; draw();
  };
  box.oninput = () => { clearTimeout(t); t = setTimeout(go, 150); }; // 1.0.11 search speed: 150 ms after the last key (was 250)
  box.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); (rows.length ? Promise.resolve() : go()).then(() => add(rows[sel])); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); box.value = ''; rows = []; draw(); focusScan(); }
  };
  window.quickSearch = { go, rows: () => rows };
})();

// ---------- bulk items: quick buttons for loose / bulk products ----------
// 1.0.5: optional FOLDERS (Ari OK 10:46 PM ET Oct 29). settings.bulkItems = the single top-level buttons (shape unchanged),
// settings.bulkFolders = [{ id, name, items: [...] }], settings.bulkOrder = top-level order ['i:0', 'f:<id>', ...].
// data-bulk = the VISIBLE spot (0-23) in the current view, so Alt+1 ... Alt+= press the first 12 visible spots.
const BF_TOP_MAX = 24, BF_ITEMS_MAX = 24, BF_SINGLES_MAX = 12;
let bfOpen = null, bfOrderKey;          // open folder id on the sale screen (null = top level)
// 1.0.9.1: an ask-price bulk item already on the sale (same number or UPC, ordinary line) is refused by the server after the
// price is typed; the same check here only decides whether to open the price box. Return mode is left to the server.
function bulkOnSale(slot) {
  if (!S || S.mode === 'return' || !slot || !slot.code) return false;
  const c = String(slot.code).trim();
  return (S.cart || []).some(l => !(l.type > 0) && (String(l.number || '') === c || (l.upc && String(l.upc) === c)));
}
function bulkPriceDialog(i, slot, folder) {
  modal(`<h2>${esc(slot.label)}</h2><p class="note">${esc(slot.name || slot.code)}</p><label class="f">Price</label><input class="f" id="bpIn" inputmode="decimal" autofocus><div id="bpMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button><button class="pbtn g" id="bpOk">Add (Enter)</button></div>`, () => {
    $('bpOk').onclick = async () => { const x = await api('bulk-add', folder != null ? { index: i, price: Number($('bpIn').value), folder } : { index: i, price: Number($('bpIn').value) }); await refresh(); if (x.ok) { closeModal(); toast(x.message, true); } else msgIn($('bpMsg'), x); };
    $('bpIn').onkeydown = e => { if (e.key === 'Enter') $('bpOk').click(); };
  });
}
// top-level order, cleaned the same way as the server (unknown/duplicate refs dropped, missing ones added: singles, then folders)
function bulkOrderOf(items, folders, order) {
  const ok = [...items.slice(0, BF_SINGLES_MAX).map((_, i) => 'i:' + i), ...folders.map(f => 'f:' + f.id)], out = [];
  (Array.isArray(order) ? order : []).forEach(r => { if (ok.includes(r) && !out.includes(r)) out.push(r); });
  ok.forEach(r => { if (!out.includes(r)) out.push(r); });
  return out;
}
function bulkKeyRange(n) { const K = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=']; n = Math.min(n, 12); return n <= 1 ? 'Alt+1' : n <= 9 ? 'Alt+1-' + n : 'Alt+1…' + K[n - 1]; } // short so it fits the panel header; each button shows its own key
function bulkToTop() { if (bfOpen === null) return; bfOpen = null; const el = $('bulkBtns'); if (el) el.dataset.sig = ''; if (window.renderBulk) window.renderBulk(); }
window.bulkToTop = bulkToTop;
window.renderBulk = () => {
  const st = S.settings || {}, list = st.bulkItems || [], folders = st.bulkFolders || [], el = $('bulkBtns'); if (!el) return;
  const okey = S.order ? S.order.id + '|' + !!S.order.resuming : ''; // new id = sale done / new sale / hold / held sale loaded
  if (bfOrderKey !== undefined && okey !== bfOrderKey) bfOpen = null;
  bfOrderKey = okey;
  const folder = bfOpen !== null ? folders.find(f => f.id === bfOpen) : null; if (!folder) bfOpen = null;
  const order = bulkOrderOf(list, folders, st.bulkOrder);
  const sig = JSON.stringify([list, folders, order, bfOpen]); if (el.dataset.sig === sig) return; el.dataset.sig = sig;
  const head = document.querySelector('#bulkPanel h3 small'); if (head && head.dataset.orig === undefined) head.dataset.orig = head.textContent;
  const itemBtn = (b, spot) => `<button class="rbtn" data-bulk="${spot}" title="${esc(b.name || b.code)}">${esc(b.label)}${b.askPrice ? '<small>price…</small>' : ''}</button>`;
  el.classList.toggle('bfmode', folders.length > 0);
  let spots = [];  // what each visible spot does
  if (!folders.length) {   // no folders: exactly the 1.0.4 buttons
    spots = order.map(r => ({ i: +r.slice(2) }));
    el.innerHTML = list.length ? spots.map((s, n) => itemBtn(list[s.i], n)).join('')
      : '<button class="rbtn" id="bulkSetup" style="grid-column:1/-1;background:#fff;color:#2c3e50">No bulk items yet<small>Set up in Settings (Ctrl+,)</small></button>';
    if (head) head.textContent = head.dataset.orig;
  } else if (!folder) {    // top level: folders and single buttons in bulkOrder
    spots = order.map(r => r.startsWith('f:') ? { f: folders.find(f => f.id === r.slice(2)) } : { i: +r.slice(2) });
    el.innerHTML = spots.map((s, n) => s.f ? `<button class="rbtn fold" data-bulk="${n}" data-bulk-folder="${esc(s.f.id)}" title="Open folder ${esc(s.f.name)}">${esc(s.f.name)}<small>Folder · ${s.f.items.length} item${s.f.items.length === 1 ? '' : 's'}</small><span class="open">OPEN</span></button>` : itemBtn(list[s.i], n)).join('');
    if (head) head.textContent = head.dataset.orig;
  } else {                 // inside one folder
    spots = folder.items.map((b, i) => ({ i, folder: folder.id }));
    el.innerHTML = `<button class="rbtn back" id="bulkBack" data-bulk-back="1">Back to folders</button><div class="fpath">${esc(folder.name)} · ${folder.items.length} item${folder.items.length === 1 ? '' : 's'}</div>`
      + (folder.items.length ? folder.items.map((b, i) => itemBtn(b, i)).join('') : '<div class="bfempty">No items in this folder yet. Add them in Settings (Ctrl+,) &gt; Bulk items.</div>');
    if (head) head.innerHTML = `<span class="bfhn">${esc(folder.name)}</span><span class="bfhk"> · ${bulkKeyRange(folder.items.length)}</span>`; // long names shorten (…), the key range always shows
  }
  el.querySelectorAll('[data-bulk]').forEach(b => b.onclick = async () => {
    const s = spots[+b.dataset.bulk]; if (!s) return;
    if (s.f) { bfOpen = s.f.id; el.dataset.sig = ''; window.renderBulk(); el.scrollTop = 0; return focusScan(); }
    const slot = s.folder ? folder.items[s.i] : list[s.i]; if (!slot) return;
    if (slot.askPrice && bulkOnSale(slot)) return toast(`${slot.label} is already on this sale. Remove that line first (or change its quantity / F4 line discount), then press ${slot.label} again.`, false); // 1.0.9.1: say so BEFORE asking the price (no price box left open to swallow the next tap); the server still checks
    if (slot.askPrice) return bulkPriceDialog(s.i, slot, s.folder);
    const r = await act('bulk-add', s.folder ? { index: s.i, folder: s.folder } : { index: s.i }); if (r && r.ok) focusScan();
  });
  if ($('bulkBack')) $('bulkBack').onclick = () => { bulkToTop(); focusScan(); };
  if ($('bulkSetup')) $('bulkSetup').onclick = () => bulkSettingsDialog();
};
A['bulk-back'] = () => { if (bfOpen !== null) { bulkToTop(); focusScan(); } };

// Settings > Bulk items: pick existing AIR POS products (search or scan), give each a button label and an optional
// price prompt. Products are never created here. 1.0.5: folders (add, rename, move, delete) and "Move to".
function bulkSettingsDialog() {
  const copy = () => { const st = S.settings || {}; return [JSON.parse(JSON.stringify(st.bulkItems || [])), JSON.parse(JSON.stringify(st.bulkFolders || [])), (st.bulkOrder || []).slice()]; };
  let [list, folders, order] = copy(), found = [], sel = 'top', delAsk = false;
  modal(`<h2>Bulk items (side buttons)</h2><p class="note" style="margin-top:0">Each button adds an existing AIR POS product. "Ask price" asks the cashier for the price (lower than the AIR POS price = line discount). Folders hold up to 24 items; the top level holds up to 24 spots (buttons and folders). Alt+1 … Alt+= press the first 12.</p>
    <div class="bftabs" id="bfTabs"></div>
    <div class="bfbar" id="bfBar"></div>
    <div id="blRows"></div>
    <label class="f">Add a product: search or scan</label><input class="f" id="blQ" placeholder="Name, number or UPC (Enter)"><div class="qsres" id="blRes"></div>
    <div id="blMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Close (Esc)</button><button class="pbtn g" id="blOk">Save</button></div>`, () => {
    const msg = (t, ok = false) => msgIn($('blMsg'), { ok, message: t });
    const fol = id => folders.find(f => f.id === id);
    const fixOrder = () => { order = bulkOrderOf(list, folders, order); };
    const removeSingle = k => { list.splice(k, 1); order = order.filter(r => r !== 'i:' + k).map(r => r.startsWith('i:') && +r.slice(2) > k ? 'i:' + (+r.slice(2) - 1) : r); };
    const roomTop = () => { fixOrder(); if (order.length >= BF_TOP_MAX) return 'Top level is full: up to 24 spots (buttons and folders together)'; return ''; };
    const roomSingle = () => roomTop() || (list.length >= BF_SINGLES_MAX ? 'Up to 12 bulk items as single buttons at the top level. Put more in a folder.' : '');
    const addSingle = b => { list.push(b); fixOrder(); };
    const draw = () => {
      fixOrder(); if (sel !== 'top' && !fol(sel)) sel = 'top';
      $('bfTabs').innerHTML = `<button class="pbtn s${sel === 'top' ? ' on' : ''}" data-tab="top">Top level (${order.length}/24)</button>`
        + folders.map(f => `<button class="pbtn s${sel === f.id ? ' on' : ''}" data-tab="${esc(f.id)}">${esc(f.name)} (${f.items.length})</button>`).join('');
      const f = fol(sel);
      $('bfBar').innerHTML = sel === 'top'
        ? `<input class="f" id="bfName" maxlength="20" placeholder="New folder name"><button class="pbtn s" id="bfAdd">Add folder</button>`
        : `<input class="f" id="bfRename" maxlength="20" value="${esc(f.name)}"><button class="pbtn s" id="bfRenameOk">Rename</button>`
          + (delAsk ? `<span class="note" style="margin:0">Delete folder ${esc(f.name)} from this PC?${f.items.length ? ` Its ${f.items.length} button${f.items.length === 1 ? '' : 's'} move${f.items.length === 1 ? 's' : ''} to the top level.` : ''} (AIR POS products are not changed.)</span><button class="pbtn r" id="bfDelYes">Yes, delete</button><button class="pbtn s" id="bfDelNo">Keep</button>`
            : `<button class="pbtn s" id="bfDel">Delete folder</button>`);
      const moveSel = (cur) => `<select class="f" data-mv="1" title="Move to"><option value="">Move to…</option>${sel !== 'top' ? '<option value="top">Top level</option>' : ''}${folders.filter(x => x.id !== cur).map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>`;
      const itemRow = (b, i, spot) => `<div class="bulkrow bfrow" data-row="${spot}"><input class="f" data-l="${i}" maxlength="30" value="${esc(b.label)}" placeholder="Button label"><span class="note" style="margin:0">${esc(b.name || b.code)} <small>(${esc(b.code)})</small></span>
        <label class="chk" style="margin:0"><input type="checkbox" data-a="${i}" ${b.askPrice ? 'checked' : ''}> Ask price</label><span><button class="pbtn s" data-up="${spot}" title="Move up">↑</button><button class="pbtn s" data-dn="${spot}" title="Move down">↓</button></span>${moveSel(sel)}<button class="pbtn s" data-x="${i}">✕</button></div>`;
      let rows;
      if (sel === 'top') rows = order.map((r, spot) => r.startsWith('i:') ? itemRow(list[+r.slice(2)], +r.slice(2), spot)
        : (x => `<div class="bulkrow bfrow isf" data-row="${spot}"><b>Folder: ${esc(x.name)}</b><span class="note" style="margin:0">${x.items.length} item${x.items.length === 1 ? '' : 's'}</span><button class="pbtn s" data-of="${esc(x.id)}">Open</button><span><button class="pbtn s" data-up="${spot}" title="Move up">↑</button><button class="pbtn s" data-dn="${spot}" title="Move down">↓</button></span><span></span><span></span></div>`)(fol(r.slice(2))));
      else rows = f.items.map((b, i) => itemRow(b, i, i));
      $('blRows').innerHTML = rows.length ? rows.join('') : `<p class="note keep">${sel === 'top' ? 'No bulk items yet.' : 'No items in this folder yet. Search or scan below to add.'}</p>`;
      const cur = () => sel === 'top' ? list : fol(sel).items;
      $('blRows').querySelectorAll('[data-l]').forEach(x => x.oninput = () => { cur()[+x.dataset.l].label = x.value; });
      $('blRows').querySelectorAll('[data-a]').forEach(x => x.onchange = () => { cur()[+x.dataset.a].askPrice = x.checked; });
      $('blRows').querySelectorAll('[data-x]').forEach(x => x.onclick = () => { if (sel === 'top') removeSingle(+x.dataset.x); else cur().splice(+x.dataset.x, 1); draw(); });
      $('blRows').querySelectorAll('[data-of]').forEach(x => x.onclick = () => { sel = x.dataset.of; delAsk = false; draw(); });
      const swap = (a, b) => { const L = sel === 'top' ? order : cur(); if (b < 0 || b >= L.length) return; [L[a], L[b]] = [L[b], L[a]]; draw(); };
      $('blRows').querySelectorAll('[data-up]').forEach(x => x.onclick = () => swap(+x.dataset.up, +x.dataset.up - 1));
      $('blRows').querySelectorAll('[data-dn]').forEach(x => x.onclick = () => swap(+x.dataset.dn, +x.dataset.dn + 1));
      $('blRows').querySelectorAll('[data-mv]').forEach(x => x.onchange = () => {
        const row = x.closest('[data-row]'), i = +row.querySelector('[data-l]').dataset.l, to = x.value; if (!to) return;
        const item = cur()[i];
        if (to === 'top') { const e = roomSingle(); if (e) { x.value = ''; return msg(e); } fol(sel).items.splice(i, 1); addSingle(item); }
        else { const t = fol(to); if (t.items.length >= BF_ITEMS_MAX) { x.value = ''; return msg(`Folder ${t.name} is full: up to 24 items`); } if (sel === 'top') removeSingle(i); else cur().splice(i, 1); t.items.push(item); }
        msg(`Moved ${item.label} to ${to === 'top' ? 'Top level' : fol(to).name}. Press Save to keep it.`, true); draw();
      });
      $('bfTabs').querySelectorAll('[data-tab]').forEach(x => x.onclick = () => { sel = x.dataset.tab; delAsk = false; draw(); });
      const nameErr = (n, except) => !n ? 'Type a folder name' : n.length > 20 ? 'Folder names are up to 20 letters' : folders.some(x => x.id !== except && x.name.toLowerCase() === n.toLowerCase()) ? `There is already a folder called ${n}` : '';
      if ($('bfAdd')) {
        $('bfAdd').onclick = () => {
          const n = $('bfName').value.replace(/\s+/g, ' ').trim(), e = nameErr(n) || roomTop(); if (e) return msg(e);
          const id = 'f-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          folders.push({ id, name: n, items: [] }); order.push('f:' + id); sel = id; draw(); msg(`Folder ${n} added. Search or scan products to put in it, then Save.`, true); $('blQ').focus();
        };
        $('bfName').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('bfAdd').click(); } };
      }
      if ($('bfRenameOk')) {
        $('bfRenameOk').onclick = () => { const n = $('bfRename').value.replace(/\s+/g, ' ').trim(), e = nameErr(n, sel); if (e) return msg(e); fol(sel).name = n; draw(); msg('Renamed. Press Save to keep it.', true); };
        $('bfRename').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('bfRenameOk').click(); } };
      }
      // delete = same rule as AirRegister: the folder's items move to the top level (as single buttons) if there is room; else nothing is deleted
      const delRoom = f => { fixOrder(); const n = f.items.length, singles = BF_SINGLES_MAX - list.length, spots = BF_TOP_MAX - (order.length - 1); return n <= Math.min(singles, spots) ? '' : `Folder ${f.name} has ${n} button${n === 1 ? '' : 's'} and the top level only has room for ${Math.max(0, Math.min(singles, spots))} (up to 12 single buttons, 24 spots). Move some items first (Move to… or ✕), then delete the folder.`; };
      if ($('bfDel')) $('bfDel').onclick = () => { const e = delRoom(fol(sel)); if (e) return msg(e); delAsk = true; draw(); };
      if ($('bfDelNo')) $('bfDelNo').onclick = () => { delAsk = false; draw(); };
      if ($('bfDelYes')) $('bfDelYes').onclick = () => {
        const f = fol(sel), e = delRoom(f); if (e) { delAsk = false; draw(); return msg(e); }
        const at = order.indexOf('f:' + sel), moved = f.items.map(b => { list.push(b); return 'i:' + (list.length - 1); });
        order.splice(at, 1, ...moved); folders = folders.filter(x => x.id !== sel); sel = 'top'; delAsk = false; draw();
        msg(`Folder ${f.name} deleted${moved.length ? `; its ${moved.length} button${moved.length === 1 ? '' : 's'} moved to the top level` : ''}. Press Save to keep this.`, true);
      };
    };
    const pick = p => {
      if (!p) return;
      const b = { label: String(p.name || p.number).slice(0, 30), code: p.number, name: p.name, askPrice: false };
      if (sel === 'top') { const e = roomSingle(); if (e) return msg(e); addSingle(b); }
      else { const f = fol(sel); if (f.items.length >= BF_ITEMS_MAX) return msg(`Folder ${f.name} is full: up to 24 items`); f.items.push(b); }
      $('blQ').value = ''; $('blRes').innerHTML = ''; draw(); $('blQ').focus();
    };
    const search = async () => {
      const q = $('blQ').value.trim(); if (!q) return;
      const r = await api('search', { keyword: q }); found = (r.rows || []).slice(0, 20);
      const exact = found.find(p => p.number === q || p.upc === q); if (exact) return pick(exact); // scanned barcode
      $('blRes').innerHTML = found.length ? found.map((p, i) => `<div data-i="${i}"><span>${esc(p.name)}<small>${esc(p.number)}</small></span><b>${p.price == null ? '—' : money(p.price)}</b></div>`).join('') : '<p class="note keep">No products found. Bulk items must already exist in AIR POS.</p>';
      $('blRes').querySelectorAll('[data-i]').forEach(d => d.onclick = () => pick(found[+d.dataset.i]));
    };
    $('blQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); search(); } };
    $('blOk').onclick = async () => {
      fixOrder();
      const x = await api('settings', { bulkItems: list, bulkFolders: folders, bulkOrder: order }); await refresh();
      if (x.ok) { [list, folders, order] = copy(); draw(); }
      msgIn($('blMsg'), x.ok ? { ok: true, message: 'Bulk items saved' } : x);
    };
    draw();
  });
}
A['bulk-settings'] = bulkSettingsDialog;
// add "Bulk items…" next to the other extra Settings buttons (pos.js adds #seMore)
(() => {
  const prev = settingsDialog;
  settingsDialog = async function () {
    await prev();
    const more = $('seMore'); if (!more || $('seBulk')) return;
    const b = document.createElement('button'); b.className = 'pbtn s'; b.id = 'seBulk'; b.textContent = 'Bulk items…'; b.onclick = bulkSettingsDialog; more.insertBefore(b, more.firstChild);
  };
  A['settings'] = settingsDialog;
})();
if (window.renderBulk && S && S.loggedIn) window.renderBulk();

// ---------- resizable side panels (owner, 1.2.0) ----------
// Drag the edge of the Actions panel or the right panel. Buttons reflow (CSS auto-fill grids): one long column when
// narrow, 2, 3+ columns when wider. Double-click an edge = default width. Widths are remembered on this PC.
(() => {
  const wrap = document.querySelector('.wrap'); if (!wrap) return;
  const LIM = { lw: [96, 640, 172], rw: [120, 720, 270] }, KEY = 'airreg.panels';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
  const set = (k, v) => { const [lo, hi, def] = LIM[k]; v = Math.round(Math.min(hi, Math.max(lo, Number(v) || def))); wrap.style.setProperty('--' + k, v + 'px'); saved[k] = v; return v; };
  const save = () => localStorage.setItem(KEY, JSON.stringify(saved));
  for (const k of Object.keys(LIM)) if (saved[k]) set(k, saved[k]);
  const zoom = () => Number(document.body.style.zoom) || 1;
  const drag = (el, k, sign) => {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag');
      const x0 = e.clientX, w0 = saved[k] || LIM[k][2];
      const mv = ev => set(k, w0 + sign * (ev.clientX - x0) / zoom());
      const up = () => { el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); save(); if (window.focusScan) focusScan(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', () => { set(k, LIM[k][2]); delete saved[k]; save(); });
  };
  drag($('sizeL'), 'lw', 1); drag($('sizeR'), 'rw', -1);
  window.setPanelWidths = (lw, rw) => { if (lw) set('lw', lw); if (rw) set('rw', rw); save(); }; // used by the screen tests
  window.resetPanelWidths = () => { for (const k of Object.keys(LIM)) { set(k, LIM[k][2]); delete saved[k]; } save(); }; // Settings > Screen
})();

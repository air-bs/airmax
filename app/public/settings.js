// 1.2.0 (owner): Settings as ONE full-screen page with tabs. Layout only: every tab reuses the existing settings
// builders (same saved keys, defaults, permissions and Save / Print test / Test drawer / Save diagnostics code).
// Helper notes are hidden; only failure messages stay inline (a success shows briefly in the page header).
const ST_TABS = [
  ['printer', 'Printer & Drawer', 'Ctrl+1'], ['returns', 'Returns', 'Ctrl+2'], ['screen', 'Screen', 'Ctrl+3'],
  ['touch', 'Touch', 'Ctrl+4'], ['bulk', 'Bulk items', 'Ctrl+5'], ['buttons', 'Buttons', 'Ctrl+6'], ['remote', 'Remote help', 'Ctrl+7'],
]; // no "Cards" tab: Air Register has no card settings of its own (card terminals are set up in AIR POS)
ST_TABS.push(['labels', 'Labels', 'Ctrl+8']); // pl+ AirMax Print Label (Ari OK Oct 30): label printer settings, built in printlabel.js
// 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31): Cards tab = one per-store switch for Sola stores (off by default, manager only) // sola109+
ST_TABS.push(['cards', 'Cards', 'Ctrl+9']); // sola109+

// ---------- on-screen buttons: show or hide per PC (any cashier) ----------
const BTN_KEY = 'airreg.hiddenButtons';
// Locked = needed to run a sale safely: always shown, can't be hidden.
const BTN_LOCKED = new Set(['T:checkout', 'T:customer', 'T:close', 'L:new-sale', 'L:logout', 'R:settings']);
function btnHidden() { try { return new Set(JSON.parse(localStorage.getItem(BTN_KEY) || '[]')); } catch { return new Set(); } }
function btnSave(set) { try { localStorage.setItem(BTN_KEY, JSON.stringify([...set].filter(k => !BTN_LOCKED.has(k)))); } catch {} applyButtons(); }
function btnId(el) { return (el.closest('#actions') ? 'L:' : el.closest('#right') ? 'R:' : el.closest('#tiles') ? 'T:' : '?:') + el.dataset.a; }
// every on-screen button, in screen order: [{ id, label, key, area }]
function btnList() {
  const out = [], seen = new Set();
  const add = (el, area) => { const id = btnId(el); if (seen.has(id)) return; seen.add(id); const k = el.querySelector('.k, small, kbd'), c = el.cloneNode(true);
    c.querySelectorAll('.k, small, kbd, .ic, .info').forEach(x => x.remove()); const label = c.textContent.replace(/\s+/g, ' ').trim();
    out.push({ id, label, key: k ? k.textContent.trim() : '', area }); };
  document.querySelectorAll('#tiles [data-a]').forEach(el => add(el, 'Top tiles'));
  document.querySelectorAll('#actions [data-a]').forEach(el => add(el, 'Left side'));
  let sec = 'Right side';
  document.querySelectorAll('#right > *').forEach(el => { if (el.tagName === 'H3') sec = el.textContent.trim(); else el.querySelectorAll('[data-a]').forEach(b => add(b, sec)); });
  if ($('bulkPanel')) out.push({ id: 'P:bulk', label: 'Bulk items panel', key: 'Alt + 1-9', area: 'Bulk items' });
  return out;
}
// ---------- on-screen buttons: move (pick which button sits in each slot), per PC (any cashier) ----------
// A slot is a fixed place on screen, named after the button that sits there by default. Buttons move only inside
// their own panel (Left side / Right side) so they keep the same look. Keys and menus stay tied to the function:
// moving a button moves the element (its data-a and click stay with it). Locked buttons never move or get replaced.
const LAY_KEY = 'airreg.buttonLayout', LAY_GROUPS = { L: '#actions', R: '#right' };
function layRead() { try { const o = JSON.parse(localStorage.getItem(LAY_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } }
// one comment-node anchor per slot, put where the button was first drawn (a redraw makes fresh buttons + anchors)
function slotAnchors(g) {
  const root = document.querySelector(LAY_GROUPS[g]); if (!root) return [];
  root.querySelectorAll('[data-a]').forEach(el => { if (!el.dataset.a || el.dataset.slot) return; el.dataset.slot = btnId(el); el.before(document.createComment('slot ' + el.dataset.slot)); });
  const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  while (w.nextNode()) if (w.currentNode.data.startsWith('slot ')) out.push({ slot: w.currentNode.data.slice(5), anchor: w.currentNode });
  return out;
}
// who sits in each slot; anything odd in the saved layout (unknown, locked, duplicate) = default layout
function layOcc(slots, lay) {
  const ids = new Set(slots), occ = {}, used = new Set(), def = () => Object.fromEntries(slots.map(s => [s, s]));
  for (const s of slots) {
    const b = BTN_LOCKED.has(s) ? s : (lay[s] || s);
    if (!ids.has(b) || (BTN_LOCKED.has(b) && b !== s) || used.has(b)) return def();
    used.add(b); occ[s] = b;
  }
  return occ;
}
function applyLayout() {
  const lay = layRead();
  for (const g of Object.keys(LAY_GROUPS)) {
    const sl = slotAnchors(g); if (!sl.length) continue;
    const els = new Map(); document.querySelectorAll(LAY_GROUPS[g] + ' [data-a]').forEach(el => { if (el.dataset.slot) els.set(el.dataset.slot, el); });
    const occ = layOcc(sl.map(s => s.slot), lay);
    sl.forEach(({ slot, anchor }) => { const el = els.get(occ[slot]); if (el && anchor.nextSibling !== el) anchor.after(el); });
  }
}
// put button `btn` in `slot`; the button that was there takes btn's old slot (a swap: no duplicates)
function laySet(slot, btn) {
  const g = slot[0]; if (!LAY_GROUPS[g] || btn[0] !== g || BTN_LOCKED.has(slot) || BTN_LOCKED.has(btn)) return false;
  const sl = slotAnchors(g).map(s => s.slot); if (!sl.includes(slot) || !sl.includes(btn)) return false;
  const lay = layRead(), occ = layOcc(sl, lay), from = sl.find(s => occ[s] === btn), was = occ[slot];
  occ[slot] = btn; occ[from] = was;
  const out = Object.fromEntries(Object.entries(lay).filter(([k]) => k[0] !== g));
  for (const s of sl) if (occ[s] !== s) out[s] = occ[s];
  try { localStorage.setItem(LAY_KEY, JSON.stringify(out)); } catch {}
  applyButtons(); return true;
}
function layReset() { try { localStorage.removeItem(LAY_KEY); } catch {} applyButtons(); }
function applyButtons() {
  applyLayout(); const hid = btnHidden();
  document.querySelectorAll('#tiles [data-a], #actions [data-a], #right [data-a]').forEach(el => { const id = btnId(el); el.classList.toggle('uhid', hid.has(id) && !BTN_LOCKED.has(id)); });
  // no gaps: a section title goes when all its buttons are hidden; a 2x2 group lets its last button span when odd
  document.querySelectorAll('#right h3').forEach(h => { const g = h.nextElementSibling; if (g) { const all = [...g.querySelectorAll('[data-a]')]; const off = all.length > 0 && all.every(b => b.classList.contains('uhid')); h.classList.toggle('uhid', off); g.classList.toggle('uhid', off); } });
  document.querySelectorAll('#actions .hgrp').forEach(g => { const vis = [...g.querySelectorAll('[data-a]')].filter(b => !b.classList.contains('uhid'));
    g.querySelectorAll('[data-a]').forEach(b => { b.style.gridColumn = ''; }); g.classList.toggle('uhid', !vis.length); if (vis.length % 2) vis[vis.length - 1].style.gridColumn = '1 / -1'; });
  const bp = $('bulkPanel'); if (bp) bp.classList.toggle('uhid', hid.has('P:bulk'));
}
// re-apply whenever the panels are drawn again
(() => { let q = 0; const mo = new MutationObserver(() => { if (!q) q = requestAnimationFrame(() => { q = 0; applyButtons(); }); });
  ['actions', 'right', 'tiles'].forEach(id => { if ($(id)) mo.observe($(id), { childList: true, subtree: true }); }); applyButtons(); })();

function btRow(slot, occ, info, hid, fixed) {
  const b = info.get(occ) || { label: occ, key: '' }, lk = BTN_LOCKED.has(slot);
  const pick = lk || fixed ? `<span class="btname">${esc(b.label)}</span>`
    : `<button type="button" class="btsel" data-slot="${esc(slot)}" aria-haspopup="listbox" title="Choose the button for this place"><span class="btname">${esc(b.label)}</span><span class="btcar">▾</span></button>`;
  return `<div class="btrow${lk ? ' lk' : ''}" data-row="${esc(slot)}"><input type="checkbox" title="Show this button" data-bt="${esc(occ)}" ${lk || !hid.has(occ) ? 'checked' : ''} ${lk ? 'disabled' : ''}>${pick}${b.key ? `<span class="btkey">${esc(b.key)}</span>` : ''}${lk ? '<span class="btlock" title="Locked: needed to run a sale (can\'t be moved or hidden)">🔒</span>' : ''}</div>`;
}
function btRender() {
  const box = $('btBox'); if (!box) return;
  const info = new Map(btnList().map(b => [b.id, b])), hid = btnHidden(), lay = layRead(), secs = [];
  const sec = (name, rows) => { if (rows.length) secs.push(`<h3>${esc(name)}</h3><div class="btlist">${rows.join('')}</div>`); };
  sec('Top tiles', [...document.querySelectorAll('#tiles [data-a]')].map(el => btRow(btnId(el), btnId(el), info, hid, true)));
  for (const g of Object.keys(LAY_GROUPS)) {
    const sl = slotAnchors(g), occ = layOcc(sl.map(s => s.slot), lay); let cur = null, rows = [];
    sl.forEach(({ slot, anchor }) => {
      const name = g === 'L' ? 'Left side' : ((anchor.parentNode.previousElementSibling || {}).textContent || 'Right side').trim();
      if (name !== cur) { if (cur) sec(cur, rows); cur = name; rows = []; }
      rows.push(btRow(slot, occ[slot], info, hid));
    });
    if (cur) sec(cur, rows);
  }
  if ($('bulkPanel')) sec('Bulk items', [btRow('P:bulk', 'P:bulk', new Map([['P:bulk', { label: 'Bulk items panel', key: 'Alt + 1-9' }]]), hid, true)]);
  box.innerHTML = secs.join('');
  box.querySelectorAll('[data-bt]').forEach(c => { c.onchange = () => { const s = btnHidden(); if (c.checked) s.delete(c.dataset.bt); else s.add(c.dataset.bt); btnSave(s); }; });
  box.querySelectorAll('.btsel').forEach(b => { b.onclick = e => { e.stopPropagation(); btDrop(b); }; });
}
// the slot's dropdown: a scrolling list of every movable button in that panel (picking one swaps the two)
function btDrop(b) {
  const open = document.querySelector('.btdrop'), same = open && open.parentNode === b.parentNode; btClose(); if (same) return;
  const slot = b.dataset.slot, sl = slotAnchors(slot[0]).map(s => s.slot), occ = layOcc(sl, layRead()), info = new Map(btnList().map(x => [x.id, x]));
  const d = document.createElement('div'); d.className = 'btdrop'; d.setAttribute('role', 'listbox');
  d.innerHTML = sl.filter(id => !BTN_LOCKED.has(id)).map(id => { const x = info.get(id) || { label: id, key: '' };
    return `<button type="button" role="option" data-pick="${esc(id)}" class="${occ[slot] === id ? 'cur' : ''}" aria-selected="${occ[slot] === id}"><span>${esc(x.label)}</span><span class="btkey">${esc(x.key)}</span></button>`; }).join('');
  b.parentNode.appendChild(d);
  d.querySelectorAll('[data-pick]').forEach(p => { p.onclick = e => { e.stopPropagation(); btClose(); if (p.dataset.pick !== occ[slot]) laySet(slot, p.dataset.pick); btRender(); }; });
  const cur = d.querySelector('.cur') || d.querySelector('[data-pick]');
  setTimeout(() => { if (cur.isConnected) { cur.scrollIntoView({ block: 'nearest' }); cur.focus(); } }, 30);
}
function btClose() { document.querySelectorAll('.btdrop').forEach(d => d.remove()); }
document.addEventListener('click', e => { if (!(e.target.closest && e.target.closest('.btdrop'))) btClose(); });
// while a dropdown is open: Up/Down move, Enter picks, Esc closes only the dropdown (not the Settings page)
window.addEventListener('keydown', e => {
  const d = document.querySelector('.btdrop'); if (!d) return;
  const items = [...d.querySelectorAll('[data-pick]')], i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { const s = d.parentNode.querySelector('.btsel'); btClose(); if (s) s.focus(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const n = items[Math.max(0, Math.min(items.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))]; n.focus(); n.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter' && i >= 0) items[i].click();
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
function buttonsTab() {
  modal(`<h2>Buttons</h2><div id="btBox"></div>
    <div class="row2" style="justify-content:flex-start"><button class="pbtn s" id="btAll">Show all buttons</button><button class="pbtn s" id="btLay">Reset to default layout</button></div>`, () => {
    btRender();
    $('btAll').onclick = () => { btnSave(new Set()); btRender(); };
    $('btLay').onclick = () => { layReset(); btRender(); };
  });
}

// ---------- the other tabs: the existing builders; parts that belong to another tab are hidden, not removed ----------
function stHide(el) { if (el) el.classList.add('sthide'); }
function lab(id) { return $(id) && $(id).closest('label'); }
function returnsTab() {
  const st = S.settings || {}, mgr = !!(S.user && S.user.manager);
  modal(`<h2>Returns</h2><label class="f chk"><input type="checkbox" id="seRT" ${mgr ? '' : 'disabled'}> Refund tax on returns without a receipt ${mgr ? '' : '<small>(manager only)</small>'}</label>
    <label class="f chk"><input type="checkbox" id="seRA" ${mgr ? '' : 'disabled'}> Return to Account (refund to the customer's AIR POS account) ${mgr ? '' : '<small>(manager only)</small>'}</label>
    <label class="f">Temporary Item tax (used when Taxable is on) ${mgr ? '' : '<small>(manager only)</small>'}</label><select class="f" id="seTT" ${mgr ? '' : 'disabled'}><option value="">Automatic (the only AIR POS sales tax)</option></select><small id="seTTi"></small>
    <div id="rtMsg" class="msg"></div><div class="row2" style="justify-content:flex-start">${mgr ? '<button class="pbtn g" id="rtOk">Save</button>' : ''}</div>`, () => {
    $('seRT').checked = st.refundTaxNoReceipt !== false; $('seRA').checked = st.returnToAccount !== false;
    // 1.0.11-local.8: which AIR POS tax a Taxable Temporary Item gets (list read from AIR POS; per company on this PC)
    api('temp-tax').then(t => { if (!t || !$('seTT')) return; for (const k of t.list || []) { const o = document.createElement('option'); o.value = k.id; o.textContent = `${k.name} ${k.rate}%`; $('seTT').appendChild(o); } $('seTT').value = t.pickedId || ''; $('seTTi').textContent = t.kind ? `Now: ${t.kind.name} ${t.kind.rate}%` : t.error || ''; });
    if ($('rtOk')) $('rtOk').onclick = async () => { let x = await api('settings', { refundTaxNoReceipt: $('seRT').checked, returnToAccount: $('seRA').checked }); if (x.ok && $('seTT') && $('seTT').options.length > 1) x = await api('temp-tax-set', { id: $('seTT').value }); await refresh(); msgIn($('rtMsg'), x); };
  });
}
function screenTab() {
  touchSettingsDialog();
  stHide($('tkK')); stHide($('tkK').previousElementSibling);
  const box = document.createElement('div'), mgr = !!(S.user && S.user.manager);
  box.innerHTML = `<label class="f chk"><input type="checkbox" id="seSnd" ${mgr ? '' : 'disabled'}> Scan sounds (beep on a good scan, a different sound when not found) ${mgr ? '' : '<small>(manager only)</small>'}</label>
    <label class="f chk"><input type="checkbox" id="seSides"> Hide sidebars <kbd>Ctrl+B</kbd></label>
    <label class="f">Zoom</label><div class="row2" style="justify-content:flex-start;margin-top:0;align-items:center"><button class="pbtn s" id="stZo">−</button><b id="stZv" style="min-width:56px;text-align:center"></b><button class="pbtn s" id="stZi">+</button><button class="pbtn s" id="stZr">100%</button><button class="pbtn s" id="stPanels">Reset sidebar sizes</button></div>`;
  $('tkK').parentNode.insertBefore(box, $('tkK').nextSibling);
  const zv = () => { $('stZv').textContent = Math.round(zoomNow() * 100) + '%'; };
  $('stZo').onclick = () => { applyZoom(zoomNow() - 0.1); zv(); }; $('stZi').onclick = () => { applyZoom(zoomNow() + 0.1); zv(); }; $('stZr').onclick = () => { applyZoom(1); zv(); }; zv();
  $('seSnd').checked = !(S.settings && S.settings.scanSound === false);
  $('seSnd').onchange = async e => { const x = await api('settings', { scanSound: e.target.checked }); await refresh(); if (!x.ok) e.target.checked = !(S.settings && S.settings.scanSound === false); stFlash(x.message); };
  $('seSides').checked = document.body.classList.contains('nosides'); $('seSides').onchange = e => setSides(e.target.checked);
  $('stPanels').onclick = () => { if (window.resetPanelWidths) window.resetPanelWidths(); stFlash('Sidebar sizes reset'); };
}
function touchTab() {
  touchSettingsDialog();
  ['tkF', 'tkCD', 'tkR', 'tkPE'].forEach(id => stHide(lab(id))); stHide($('tkPinRow')); stHide($('tkPw'));
  $('modalRoot').querySelectorAll('.modal h3').forEach(stHide);
}
function remoteTab() { // AIR POS look app: Remote Help (RustDesk) is machine-wide and belongs to the store Air Register
  modal(`<h2>Remote Help</h2><div id="rhBody"><label class="f">Status</label><p><b>Managed by the regular Air Register</b></p></div>
    <div class="row2" id="rhBtns"><button class="pbtn s" data-close>Close (Esc)</button></div>`);
  const p = Promise.resolve();
  const a = document.createElement('a'); a.className = 'pbtn s'; a.id = 'seLog'; a.href = '/export/log'; a.download = 'air-register-log.txt'; a.textContent = 'Export log';
  if ($('rhBtns')) $('rhBtns').insertBefore(a, $('rhBtns').firstChild);
  return p;
}
const ST_BUILD = { printer: () => printerSettings(), returns: returnsTab, screen: screenTab, touch: touchTab, bulk: () => bulkSettingsDialog(), buttons: buttonsTab, remote: remoteTab };
ST_BUILD.labels = () => window.labelsTab(); // pl+ AirMax Print Label: Settings > Labels (printlabel.js)
function cardsTab() { // sola109+
  modal(`<h2>Cards</h2><div id="cdBody"><p class="note">Checking this store's card channel…</p></div><div id="cdMsg" class="msg"></div>`, async () => { // sola109+
    const r = await api('sola-cards'); if (!$('cdBody')) return; if (!r.ok) return msgIn($('cdMsg'), r); // sola109+
    const mgr = !!r.manager; // sola109+
    const note = r.sola ? 'This store takes AIR POS Online Payment through <b>Sola</b>.' : r.channelType === 10 ? 'This store takes AIR POS Online Payment through <b>Stripe</b>: cards on file already work and this switch is not used here.' : 'This store has no AIR POS Online Payment channel set up, so this switch is not used here.'; // sola109+
    $('cdBody').innerHTML = `<label class="f chk"><input type="checkbox" id="seSola" ${mgr ? '' : 'disabled'}> Allow typed cards and cards on file for Sola stores (this store only) ${mgr ? '' : '<small>(manager only)</small>'}</label>` + // sola109+
      `<p class="note keep">${note} When on, Manual Credit and Add card in the customer profile send the typed card to AIR POS / Sola once (the customer must agree before a card is saved). Air Max never keeps, prints or logs the card number. Off by default.</p>`; // sola109+
    $('seSola').checked = !!r.on; // sola109+
    $('seSola').onchange = async e => { const x = await api('sola-cards-set', { on: e.target.checked }); await refresh(); if (!x.ok) e.target.checked = !e.target.checked; msgIn($('cdMsg'), x); stFlash(x.message || ''); }; // sola109+
  }); // sola109+
} // sola109+
ST_BUILD.cards = cardsTab; // sola109+
// ---------- AirMax Batch 1 begin (tests/settings-parity.test.js leaves this block out) ----------
// AirMax Batch 1: the page has a left section menu (Sales & Checkout, Receipts & Printing, Hardware & Screen, Payments & Tax, Store & Account, Users & Permissions)
// as in Gordon's 1.0.11 reference picture; every old tab keeps its name, its Ctrl+1..9 key and its builder. New sections: Terminal switches (calls 11 + 12), Payment types,
// Tax kinds, Account, Store lists, Roles & permissions (calls 14-19 + store rules): shown to a manager login, except Terminal switches (a cashier needs a manager password to save).
// ---------- the left section menu (AirMax Batch 1) ----------
// tags: pc = "this PC" (saved on this register), air = "AIR POS" (saved to AIR POS for the store), new = a new section.
const ST_NEW = { // key: [label, tags, who sees it ('all' | 'manager'), what it is]
  terminal: ['Terminal switches', ['new', 'air'], 'all', 'The switches AIR POS keeps for this register: auto-print, cash drawer, sounds, keyboard. Save sends them to AIR POS. A cashier needs a manager password to save.'],
  paytypes: ['Payment types', ['new', 'air'], 'manager', 'The payment types AIR POS keeps for this store. View only.'],
  taxkinds: ['Tax kinds', ['new', 'air'], 'manager', 'The tax kinds and rates AIR POS keeps for this store. View only.'],
  account: ['Account', ['new', 'air'], 'manager', 'The company and store settings AIR POS holds. View only: AIR POS changes them in its back office.'],
  lists: ['Store lists', ['new', 'air'], 'manager', 'Product origins, categories and states from AIR POS. View only.'],
  access: ['Roles & permissions', ['new', 'air'], 'manager', 'What AIR POS lets this login do. View only.'],
};
const ST_NAV = [['Sales & Checkout', ['returns', 'bulk', 'buttons']], ['Receipts & Printing', ['printer', 'labels']], ['Hardware & Screen', ['screen', 'touch', 'terminal']],
  ['Payments & Tax', ['paytypes', 'taxkinds', 'cards']], ['Store & Account', ['account', 'lists', 'remote']], ['Users & Permissions', ['access']]];
const ST_DESC = { printer: 'The receipt printer and the cash drawer on this PC. The buttons at the bottom print a test page and open the drawer.', returns: 'How returns work on this register.', screen: 'Sounds, sidebars and zoom on this PC.',
  touch: 'Touch screen and on-screen keyboard on this PC.', bulk: 'The quick bulk-item buttons on the sale screen.', buttons: 'Show, hide or move the buttons on the sale screen (this PC).', remote: 'Remote help and the log export.', labels: 'The label printer and label layouts on this PC.', cards: 'The card-on-file switch for Sola stores.' };
const stMgr = () => !!(S && S.user && S.user.manager);
const stShown = k => !ST_NEW[k] || ST_NEW[k][2] === 'all' || stMgr(); // anything a manager login does not need is not drawn at all for a cashier
const stLabel = k => ST_NEW[k] ? ST_NEW[k][0] : (ST_TABS.find(t => t[0] === k) || [])[1] || k;
const stKey = k => ST_NEW[k] ? '' : (ST_TABS.find(t => t[0] === k) || [])[2] || '';
const stTags = k => ST_NEW[k] ? ST_NEW[k][1] : ['pc'];
const TAG = { pc: ['this PC', 'tpc'], air: ['AIR POS', 'tair'], new: ['new', 'tnew'] };
const tagHtml = k => stTags(k).map(t => `<span class="sttg ${TAG[t][1]}">${TAG[t][0]}</span>`).join('');
(() => { if (document.getElementById('stNavStyle')) return; const st = document.createElement('style'); st.id = 'stNavStyle'; st.textContent = `
  .stpage-ov { top:56px !important; bottom:26px !important; height:auto !important; }
  .modal.stpage { width:100% !important; max-width:100% !important; height:100% !important; max-height:100% !important; background:#eef2f5; }
  .stpage .sthead { background:#fff; color:#1c2630; border-bottom:1px solid #d5dde5; padding:6px 18px; gap:12px; }
  .stpage .sthead h1 { flex:none; font-size:17px; text-transform:uppercase; letter-spacing:.3px; } .stpage .sthead .stsub { flex:1; color:#6b7782; font-size:13px; }
  .stpage #stFlash { color:#1e7b34; } .stpage .stwrap { flex:1; min-height:0; display:flex; }
  .stpage .stnav { display:block; flex:none; width:236px; background:#fff; border-right:1px solid #d5dde5; border-bottom:0; padding:6px 0 10px; overflow-x:hidden; overflow-y:auto; }
  .stpage .stnav .stgh { font-size:10.5px; font-weight:700; letter-spacing:.6px; color:#566573; text-transform:uppercase; padding:12px 12px 4px; } .stpage .stnav .stgh:first-child { padding-top:6px; }
  .stpage .stnav button { display:flex; align-items:center; gap:6px; width:100%; text-align:left; border-radius:0; border-left:3px solid transparent; padding:6px 10px 6px 12px; font-size:13px; font-weight:600; color:#2c3e50; white-space:nowrap; }
  .stpage .stnav button .stsp { flex:1; } .stpage .stnav button kbd { margin-left:auto; font-size:10px; color:#566573; background:#f4f7f9; border:1px solid #d5dde5; border-radius:3px; padding:0 4px; }
  .stpage .stnav button.on { background:#e8f1fc; color:#1e3f73; border-left-color:#2e86c1; box-shadow:none; }
  .sttg { font-size:9.5px; font-weight:700; padding:0 5px; border-radius:3px; line-height:15px; white-space:nowrap; } .sttg.tpc { background:#e3eaf0; color:#566573; } .sttg.tair { background:#dbe9fb; color:#1e57b0; } .sttg.tnew { background:#e6f4ea; color:#1e7b34; }
  .stpage .stlegend { padding:12px; font-size:11px; color:#6b7782; border-top:1px solid #eef2f5; margin-top:10px; } .stpage .stlegend div { margin:4px 0; display:flex; gap:6px; align-items:center; }
  .stpage .stmid { flex:1; min-width:0; display:flex; flex-direction:column; padding:12px 16px; } .stpage .stcard { flex:1; min-height:0; display:flex; flex-direction:column; background:#fff; border:1px solid #d5dde5; border-radius:4px; overflow:hidden; }
  .stpage .stcardh { display:flex; align-items:center; gap:8px; padding:9px 16px; border-bottom:1px solid #d5dde5; } .stpage .stcardh h2 { margin:0; font-size:16px; } .stpage .stcardh .sttd { color:#6b7782; font-size:12px; }
  .stpage .stcard .stbody { padding:12px 16px 16px; }
  .stpage .stside { flex:none; width:196px; background:#fff; border-left:1px solid #d5dde5; padding:12px; font-size:12px; color:#566573; } .stpage .stside h4 { margin:0 0 6px; font-size:10.5px; letter-spacing:.6px; color:#1e57b0; text-transform:uppercase; }
  @media (max-width:1100px) { .stpage .stside { display:none; } }
`; document.head.appendChild(st); })();

// the new sections: each is drawn by app/public/sections/lookups.js (calls 11, 12, 14-19, store rules)
function lkSection(title, fn) {
  const L = window.AirMaxLookups;
  modal(`<h2>${esc(title)}</h2><div id="lkHost"><p class="note keep">Loading…</p></div>`, () => { if (!L) { $('lkHost').innerHTML = '<p class="note keep">This section is not loaded yet. Sign in again.</p>'; return; } fn(L, $('lkHost')); });
}
ST_BUILD.terminal = () => lkSection('Terminal switches', (L, h) => L.renderTerminalEdit(h));
ST_BUILD.paytypes = () => lkSection('Payment types', (L, h) => L.renderLists(h, null, { only: ['pay', 'sub'], bare: true, open: true }));
ST_BUILD.taxkinds = () => lkSection('Tax kinds', (L, h) => L.renderLists(h, null, { only: ['tax'], bare: true, open: true }));
ST_BUILD.lists = () => lkSection('Store lists', (L, h) => L.renderLists(h, null, { only: ['origin', 'cat', 'region'], bare: true, open: false }));
ST_BUILD.account = () => lkSection('Account', (L, h) => L.renderAccount(h));
ST_BUILD.access = () => lkSection('Roles & permissions', (L, h) => L.renderAccess(h));
// ---- window.AirMaxSettings.add({ key, label, group, after?, tags?, who?, desc?, render(host, ctx) }): other batches add a Settings menu entry from their own file ----
// group = one of the six group names; after = an existing key to sit after (default: end of the group); tags = ['new'] by default (also 'air', 'pc'); who = 'manager' (default: not drawn at all for a cashier) | 'all'.
// render(host, ctx) may be async and may return a cleanup; ctx = the mount ctx (host, api, state, toast, esc, money, refresh, perms) + { manager }. A duplicate key or an unknown group is refused with a console warning.
// Works whichever file loads first: a section file that loads before settings.js can queue with `(window.AirMaxSettings = window.AirMaxSettings || { _q: [], add(e) { this._q.push(e); } }).add({...})`.
let stCleanup = null;
const stClean = () => { const f = stCleanup; stCleanup = null; try { if (typeof f === 'function') f(); } catch (e) { /* ignore */ } };
function stExtSection(e) {
  modal(`<h2>${esc(e.label)}</h2><div class="stext"></div>`, () => {
    const host = document.querySelector("#modalRoot .stext"); if (!host) return;
    const perms = async () => { const r = await api('perms'), p = r && r.ok ? r : { ok: false, manager: false, superAdmin: false, authorities: [], menus: [] }; p.menus = p.menus || []; p.hasMenu = w => { w = String(w).toLowerCase(); return !!p.superAdmin || p.menus.some(x => String(x.name).toLowerCase() === w || String(x.path).toLowerCase() === w); }; return p; };
    const ctx = { host, name: 'settings.' + e.key, where: 'settings.' + e.key, api: (n, b, o) => api(n, b, o), state: () => S, toast: (m, ok) => toast(m, ok), esc: x => esc(x), money: n => money(n), refresh: () => refresh(), perms, manager: stMgr() };
    const keep = f => { if (typeof f === 'function') stCleanup = f; };
    const fail = err => { console.warn('settings section ' + e.key + ' failed', err); host.innerHTML = ''; };
    try { const r = e.render(host, ctx); if (r && typeof r.then === 'function') r.then(keep).catch(fail); else keep(r); } catch (err) { fail(err); }
  });
}
function stAddEntry(e) {
  const bad = m => { console.warn('AirMaxSettings.add refused: ' + m); return false; };
  if (!e || typeof e !== 'object') return bad('no entry');
  const key = String(e.key || ''); if (!/^[a-z][a-z0-9-]*$/.test(key)) return bad('bad key "' + key + '"');
  if (ST_NEW[key] || ST_TABS.some(t => t[0] === key)) return bad('duplicate key "' + key + '"');
  const grp = ST_NAV.find(g => g[0] === e.group); if (!grp) return bad('unknown group "' + e.group + '"');
  if (typeof e.render !== 'function') return bad('no render function for "' + key + '"');
  const tags = (Array.isArray(e.tags) ? e.tags : ['new']).filter(t => TAG[t]); const who = e.who === 'all' ? 'all' : 'manager';
  ST_NEW[key] = [String(e.label || key), tags, who, String(e.desc || '')];
  const i = e.after ? grp[1].indexOf(e.after) : -1; grp[1].splice(i >= 0 ? i + 1 : grp[1].length, 0, key);
  ST_BUILD[key] = () => stExtSection(e);
  if ($('stTabs')) settingsPage(stTab); // Settings is open: redraw the menu now
  return true;
}
(() => { const q = window.AirMaxSettings && window.AirMaxSettings._q; window.AirMaxSettings = { add: stAddEntry, groups: () => ST_NAV.map(g => g[0]) }; (q || []).forEach(stAddEntry); })();
// ---------- AirMax Batch 1 end ----------

let stSeq = 0, stTab = 'printer';
function stFlash(m) { const f = $('stFlash'); if (!f) return; f.textContent = m; f.classList.add('on'); clearTimeout(stFlash.t); stFlash.t = setTimeout(() => f.classList.remove('on'), 4000); }
function stDecorate(tab) {
  const md = $('modalRoot').querySelector('.modal'); if (!md || md.classList.contains('stpage')) return;
  md.classList.add('stpage'); $('ov').classList.add('stpage-ov');
  const h = md.querySelector('h2'); if (h) h.remove();
  if (tab === 'printer') { stHide(lab('seRT')); stHide($('seRTnote')); } // refund tax lives on the Returns tab (Save still sends it unchanged)
  md.querySelectorAll('[data-close]').forEach(b => b.remove()); // one Close, in the header
  const body = document.createElement('div'); body.className = 'stbody'; body.dataset.tab = tab;
  while (md.firstChild) body.appendChild(md.firstChild);
  const grp = ST_NAV.map(([g, ks]) => { const on = ks.filter(stShown); return on.length ? `<div class="stgh">${esc(g)}</div>` + on.map(k => `<button role="tab" data-nok="1" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${esc(stLabel(k))}${stKey(k) ? ` <kbd>${stKey(k)}</kbd>` : ''}<span class="stsp"></span>${tagHtml(k)}</button>`).join('') : ''; }).join('');
  md.innerHTML = `<div class="sthead"><h1>Settings</h1><span class="stsub">Pick a section on the left. Each section has its own buttons at the bottom.</span><span id="stFlash" role="status"></span><button class="pbtn s" data-close>Close <kbd>Esc</kbd></button></div>
    <div class="stwrap"><div id="stTabs" class="sttabs stnav" role="tablist">${grp}<div class="stlegend"><div><span class="sttg tpc">this PC</span> saved on this register</div><div><span class="sttg tair">AIR POS</span> saved to AIR POS for the store</div><div><span class="sttg tnew">new</span> a new AirMax section</div></div></div>
    <div class="stmid"><div class="stcard"><div class="stcardh"><h2>${esc(stLabel(tab))}</h2>${tagHtml(tab)}<span class="sttd"></span></div></div></div>
    <aside class="stside"><h4>This section</h4><p>${esc(ST_NEW[tab] ? ST_NEW[tab][3] : ST_DESC[tab] || '')}</p></aside></div>`;
  md.querySelector('.stcard').appendChild(body);
  md.querySelector('[data-close]').onclick = closeModal;
  md.querySelectorAll('#stTabs [data-tab]').forEach(b => { b.onclick = () => settingsPage(b.dataset.tab); });
  // a success shows briefly in the header; failures stay where they happened
  new MutationObserver(() => body.querySelectorAll('.msg.ok').forEach(m => { if (m.textContent) stFlash(m.textContent); m.textContent = ''; m.className = 'msg'; }))
    .observe(body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
}
async function settingsPage(tab) { stClean();
  tab = ST_BUILD[tab] && stShown(tab) ? tab : (stShown(stTab) ? stTab : 'printer'); stTab = tab; const my = ++stSeq;
  const p = ST_BUILD[tab]();
  if (tab === 'remote') { stDecorate(tab); return p; } // header first; the status fills in when it arrives
  await p; if (my === stSeq) stDecorate(tab);
}
settingsDialog = () => settingsPage('printer');
A['settings'] = settingsDialog;
ST_TABS.forEach(([k]) => { A['settings-' + k] = () => settingsPage(k); });
A['touch-settings'] = () => settingsPage('screen'); A['bulk-settings'] = () => settingsPage('bulk'); A['remote-help'] = () => settingsPage('remote');

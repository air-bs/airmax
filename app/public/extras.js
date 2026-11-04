// Air Register 1.1 extras (UI): Open Drawer button, calculator, price check, Put Aside, cart search, status bar,
// zoom, sale note, customers (F3) and gift cards. Uses the helpers from app.js (S, A, api, act, modal, toast, …).
'use strict';
let flashT = null;
function flash(text, ok) {
  let f = $('flash'); if (!f) { f = document.createElement('div'); f.id = 'flash'; document.body.appendChild(f); }
  f.textContent = text; f.className = ok === false ? 'bad' : ''; f.style.display = '';
  clearTimeout(flashT); flashT = setTimeout(() => { f.style.display = 'none'; }, ok === false ? 4000 : 1800);
}
const when = t => (t ? new Date(t).toLocaleString('en-US') : '');

// ---------- Open Drawer button (one click, no dialog) ----------
if ($('drawerBtn')) $('drawerBtn').onclick = async e => { e.stopPropagation(); const b = $('drawerBtn'); if (b.disabled) return; b.disabled = true; try { await drawer(); } finally { b.disabled = false; focusScan(); } };

// ---------- zoom (remembered on this PC) ----------
const ZKEY = 'airreg.zoom';
function applyZoom(z) { z = Math.min(2, Math.max(0.6, Math.round(z * 10) / 10)); localStorage.setItem(ZKEY, String(z)); document.body.style.zoom = z; if ($('stZoom')) $('stZoom').textContent = z === 1 ? '' : 'Zoom ' + Math.round(z * 100) + '%'; return z; }
const zoomNow = () => Number(localStorage.getItem(ZKEY)) || 1;
applyZoom(zoomNow());
A['zoom-in'] = () => applyZoom(zoomNow() + 0.1); A['zoom-out'] = () => applyZoom(zoomNow() - 0.1); A['zoom-reset'] = () => applyZoom(1);
window.addEventListener('keydown', e => { // Ctrl + numpad plus/minus, and Ctrl+Shift+= ('+')
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.code === 'NumpadAdd' || e.key === '+') { e.preventDefault(); e.stopImmediatePropagation(); A['zoom-in'](); }
  else if (e.code === 'NumpadSubtract' || e.key === '_') { e.preventDefault(); e.stopImmediatePropagation(); A['zoom-out'](); }
}, true);
window.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); applyZoom(zoomNow() + (e.deltaY < 0 ? 0.1 : -0.1)); } }, { passive: false });

// ---------- status bar ----------
window.afterRefresh = () => {
  if (!S.loggedIn) return;
  const net = $('stNet'); net.textContent = S.online ? '● online' : '● OFFLINE (AIR POS server not reachable)'; net.className = 'net' + (S.online ? '' : ' off');
  $('stShop').textContent = `Shop: ${S.user.shop}`;
  $('stStation').textContent = S.station && S.station.name ? `Register: ${S.station.name}` : (S.station && S.station.device ? `PC: ${S.station.device}` : ''); $('stStation').title = S.station && S.station.name ? 'AIR POS station' + (S.station.device ? ' (this PC: ' + S.station.device + ')' : '') : 'No AIR POS station name is set for this register, so the PC name is shown';
  $('stUser').textContent = `Cashier: ${S.user.user}${S.user.manager ? ' (manager)' : ''}`;
  $('stSession').textContent = S.session && S.session.number ? `Session ${S.session.number}` : 'Not clocked in';
  $('stAside').textContent = S.asideCount ? `${S.asideCount} put aside (Ctrl+Shift+L)` : ''; asideMenu();
  $('stVer').textContent = 'v' + (S.version || '');
  const nl = $('noteLine'); nl.style.display = S.note ? '' : 'none'; nl.textContent = S.note ? '📝 Note: ' + S.note : ''; nl.onclick = () => run('note');
  const gl = $('giftLine'); if (gl) { gl.style.display = S.giftReceipt ? '' : 'none'; gl.textContent = S.giftReceipt ? '🎁 Gift receipt will print with this sale (F10 to remove)' : ''; gl.onclick = () => run('gift-receipt'); }
  document.querySelectorAll('[data-a="gift-receipt"]').forEach(b => b.classList.toggle('gifton', !!S.giftReceipt));
};

// ---------- calculator (Ctrl+Shift+C) ----------
function calcEval(src) { // + - * / % ( ) and decimals, no eval
  const t = src.replace(/×/g, '*').replace(/÷/g, '/').match(/\d*\.?\d+|[-+*/%()]/g) || []; let i = 0;
  const peek = () => t[i], next = () => t[i++];
  const prim = () => { const x = next(); if (x === '(') { const v = expr(); next(); return v; } if (x === '-') return -prim(); if (x === '+') return prim(); const n = Number(x); if (!isFinite(n)) throw 0; return n; };
  const post = () => { let v = prim(); while (peek() === '%') { next(); v = v / 100; } return v; };
  const term = () => { let v = post(); while (peek() === '*' || peek() === '/') { const o = next(), r = post(); v = o === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(), r = term(); v = o === '+' ? v + r : v - r; } return v; };
  const v = expr(); if (i < t.length || !isFinite(v)) throw 0; return Math.round(v * 1e8) / 1e8;
}
A.calculator = () => {
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '-', '0', '.', '%', '+', 'C', '(', ')', '='];
  modal(`<h2>Calculator</h2><input class="f" id="clIn" autofocus autocomplete="off" style="text-align:right;font-size:24px"><div id="clOut" class="due" style="justify-content:flex-end;min-height:30px"></div>
    <div class="calc">${keys.map(k => `<button class="${k === '=' ? 'eq' : /[÷×+\-%]/.test(k) ? 'op' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
    <p class="note">Type or click. Enter = result, Esc = close. Nothing is added to the sale.</p>`, () => {
    const inp = $('clIn'), show = () => { try { $('clOut').textContent = inp.value.trim() ? '= ' + calcEval(inp.value) : ''; } catch { $('clOut').textContent = ''; } };
    const eq = () => { try { inp.value = String(calcEval(inp.value)); } catch { $('clOut').textContent = 'Check the sum'; return; } show(); };
    $('modalRoot').querySelectorAll('.calc button').forEach(b => b.onclick = e => { e.stopPropagation(); const k = b.dataset.k; if (k === 'C') inp.value = ''; else if (k === '=') return eq(); else inp.value += k; show(); inp.focus(); });
    inp.oninput = show; inp.onkeydown = e => { if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); eq(); } };
    inp.addEventListener('click', e => e.stopPropagation());
  });
};

// ---------- price check (Ctrl+I) ----------
A['price-check'] = () => {
  modal(`<h2>Price check</h2><p class="note" style="margin-top:0">Scan or type an item. Nothing is added to the sale.</p>
    <input class="f" id="pcCode" placeholder="Scan, number, UPC or name" autofocus autocomplete="off"><div id="pcRes"></div><div id="pcMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Done (Esc)</button></div>`, () => {
    const go = async () => {
      const code = $('pcCode').value.trim(); if (!code) return; $('pcCode').select();
      const r = await api('price-check', { code });
      if (!r.ok) { $('pcRes').innerHTML = ''; return msgIn($('pcMsg'), r); }
      msgIn($('pcMsg'), { ok: true, message: '' });
      if (r.item) { const p = r.item; $('pcRes').innerHTML = `<div class="pcard"><div><b>${esc(p.name)}</b> · ${esc(p.number)}${p.upc ? ' · UPC ' + esc(p.upc) : ''}</div><div class="big">${money(p.price)}</div>
        ${p.originalPrice && p.originalPrice !== p.price ? `<div class="note">Regular ${money(p.originalPrice)}</div>` : ''}${p.bulkPrice ? `<div class="note">Bulk: ${money(p.bulkPrice)} each from ${p.bulkPriceQuantity}</div>` : ''}
        <div class="due"><span>In stock</span><b>${p.stock == null ? 'unknown' : p.stock + ' ' + esc(p.unitName || '')}</b></div>${p.taxRate != null ? `<div class="note">Tax ${p.taxRate}%</div>` : ''}</div>`; }
      else $('pcRes').innerHTML = `<table class="mini" style="margin-top:8px"><tbody>${r.list.map(p => `<tr><td>${esc(p.number)}</td><td>${esc(p.name)}</td><td class="n">${p.price == null ? '' : money(p.price)}</td><td class="n">stock ${p.stock ?? '?'}</td></tr>`).join('')}</tbody></table>`;
    };
    $('pcCode').onkeydown = e => { if (e.key === 'Enter') go(); };
  });
};

// ---------- Put Aside / Load Aside (local on this PC) ----------
A['aside-put'] = async () => { if (S.mode === 'return') return toast('Not in return mode', false); const r = await act('aside-put'); if (r && r.ok) flash('Sale put aside'); };
A['aside-load'] = async () => {
  const r = await api('aside-list'); if (!(r.rows || []).length) return toast('Nothing is put aside on this register', false);
  modal(`<h2>Load Aside</h2><p class="note" style="margin-top:0">Sales parked on this register (kept on this PC, also after a restart).</p>
    <table><thead><tr><th>When</th><th>Cashier</th><th class="n">Lines</th><th class="n">Total</th><th></th></tr></thead><tbody>${r.rows.map((a, i) => `<tr><td>${when(a.at)}${a.member ? '<div class="note" style="margin:0">👤 ' + esc(a.member) + '</div>' : ''}${a.note ? '<div class="note" style="margin:0">📝 ' + esc(a.note) + '</div>' : ''}</td><td>${esc(a.user)}</td><td class="n">${a.lines}</td><td class="n">${money(a.due)}</td>
      <td style="white-space:nowrap"><button class="pbtn g" data-load="${esc(a.id)}" ${i === 0 ? 'autofocus' : ''}>Load</button> <button class="pbtn s" data-del="${esc(a.id)}">Delete</button></td></tr>`).join('')}</tbody></table>
    <div id="laMsg" class="msg"></div><div class="row2"><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    $('modalRoot').querySelectorAll('[data-load]').forEach(b => b.onclick = async () => { const x = await api('aside-load', { id: b.dataset.load }); await refresh(); if (x.ok) { closeModal(); toast(x.message, true); } else msgIn($('laMsg'), x); });
    $('modalRoot').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api('aside-delete', { id: b.dataset.del }); await refresh(); closeModal(); A['aside-load'](); });
  });
};

// ---------- search within the cart (Ctrl+Shift+F) ----------
A['cart-search'] = () => {
  const rows = S.mode === 'return' ? (S.ret.subs || []) : (S.cart || []); if (!rows.length) return toast('The cart is empty', false);
  modal(`<h2>Find in this sale</h2><input class="f" id="csIn" placeholder="Name, number or UPC" autofocus autocomplete="off">
    <div style="max-height:50vh;overflow:auto;margin-top:8px"><table><tbody id="csRes"></tbody></table></div><p class="note">↑/↓ then Enter selects the line in the sale.</p>`, () => {
    let hits = [], sel = 0;
    const draw = () => { const q = $('csIn').value.trim().toLowerCase();
      hits = rows.map((r, i) => ({ r, i })).reverse().filter(({ r }) => !q || [r.name, r.number, r.upc].some(v => String(v || '').toLowerCase().includes(q))); sel = Math.min(sel, Math.max(hits.length - 1, 0));
      $('csRes').innerHTML = hits.map(({ r, i }, k) => `<tr class="row ${k === sel ? 'sel' : ''}" data-i="${i}"><td>${lineNo(i)}</td><td>${esc(r.number)}</td><td>${esc(r.name)}</td><td class="n">× ${r.quantity}</td><td class="n">${money(r.total ?? r.price * r.quantity)}</td></tr>`).join('') || '<tr><td class="empty">No line matches</td></tr>';
      $('csRes').querySelectorAll('tr.row').forEach(tr => tr.onclick = () => pick(+tr.dataset.i)); };
    const pick = i => { selectedRow = i; closeModal(); refresh(); toast(`Line ${lineNo(i)} selected: ${rows[i].name}`, true); };
    $('csIn').oninput = () => { sel = 0; draw(); };
    $('csIn').onkeydown = e => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, hits.length - 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); } else if (e.key === 'Enter' && hits[sel]) pick(hits[sel].i); };
    draw();
  });
};

// ---------- sale note (Ctrl+N / Alt+N) ----------
A.note = () => {
  if (S.mode === 'return') return toast('Notes are for sales', false);
  modal(`<h2>Sale note</h2><p class="note" style="margin-top:0">Prints under the receipt and shows in History on this PC. (AIR POS orders have no note field, so the note is kept on this register.)</p>
    <textarea class="f" id="snIn" rows="4" maxlength="300" style="font:inherit;font-size:16px" autofocus>${esc(S.note || '')}</textarea><div id="snMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button>${S.note ? '<button class="pbtn r" id="snClr">Remove note</button>' : ''}<button class="pbtn g" id="snOk">Save (Ctrl+Enter)</button></div>`, () => {
    const save = async text => { const x = await api('note', { text }); await refresh(); if (x.ok) { closeModal(); toast(x.message, true); } else msgIn($('snMsg'), x); };
    $('snOk').onclick = () => save($('snIn').value); if ($('snClr')) $('snClr').onclick = () => save('');
    $('snIn').onkeydown = e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('snOk').click(); } };
    $('snIn').addEventListener('click', e => e.stopPropagation());
  });
};

// ---------- customers (F3): search name / phone / e-mail / number, card, edit, past purchases ----------
function custCard(m) {
  const f = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
  return `<div class="custcard">${f('Name', esc([m.firstName, m.lastName].filter(Boolean).join(' ') || m.name))}${f('Phone', esc(m.mobile || '—'))}${f('E-mail', esc(m.email || '—'))}
    ${f('Customer #', esc(m.number))}${f('Points', m.points ?? 0)}${Math.round((Number(m.balance ?? m.availableBalance) || 0) * 100) ? f('Store credit', money(m.balance ?? m.availableBalance)) : ''}${m.allowCreditPayment ? f('Credit limit', money(m.creditAmount)) : ''}</div>${m.remark ? `<div class="note" style="margin:0">${esc(m.remark)}</div>` : ''}`;
}
A.customer = () => (S.member ? customerView(S.member.id) : customerSearch());
function customerSearch() {
  modal(`<h2>Customer</h2><label class="f">Name, phone, e-mail or customer number</label><div style="display:flex;gap:6px"><input class="f" id="mQ" autofocus autocomplete="off"><button class="pbtn" id="mGo">Find</button></div>
    <div id="mRes" style="max-height:44vh;overflow:auto;margin-top:6px"></div><div id="mMsg" class="msg"></div>
    <div class="row2"><button class="pbtn g" id="mEdit" style="display:none">Edit Customer</button><button class="pbtn g" id="mNew">New customer…</button><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    let rows = [], sel = 0;
    // request M (owner): once a customer is found / highlighted the main button is "Edit Customer"; "New customer…" is then secondary
    const mainBtn = () => { const has = rows.length > 0; $('mEdit').style.display = has ? '' : 'none'; $('mNew').className = 'pbtn ' + (has ? 's' : 'g'); if (has) $('mEdit').textContent = `Edit Customer: ${rows[sel].name || rows[sel].number}`; };
    const draw = () => { $('mRes').innerHTML = rows.length ? `<table><thead><tr><th>Name</th><th>Phone</th><th>E-mail</th><th>Customer #</th><th class="n">Points</th></tr></thead><tbody>${rows.map((r, i) => `<tr class="row ${i === sel ? 'sel' : ''}" data-i="${i}"><td>${esc(r.name)}</td><td>${esc(r.mobile)}</td><td>${esc(r.email)}</td><td>${esc(r.number)}</td><td class="n">${r.points}</td></tr>`).join('')}</tbody></table>` : '';
      $('mRes').querySelectorAll('tr.row').forEach(tr => tr.onclick = () => customerView(rows[+tr.dataset.i].id)); mainBtn(); };
    // 1.0.10-local.2 (Ari 1:36 PM ET Nov 1) one-Enter add customer: Enter searches; exactly one match = added to the sale and the
    // window closes; several = first row highlighted, Enter adds it (Up/Down pick another; a click still opens the customer card);
    // none = "No customer found" with New customer… focused (Enter opens it; typing goes back to the box). Same calls as before
    // (member-find, then member-attach like "Use on this sale"). Return mode keeps the old card step. The adding Enter never
    // reaches the sale screen (stopped here, and lastScanKey makes the empty-box Enter = Payment wait 400 ms).
    let busy = false;
    const use = async r => { if (!r || busy) return; if (S.mode === 'return') return customerView(r.id); busy = true;
      try { const x = await api('member-attach', { number: r.number }); await refresh(); if (x.ok) { closeModal(); lastScanKey = Date.now(); toast(x.message, true); focusScan(); } else if ($('mMsg')) msgIn($('mMsg'), x); } finally { busy = false; } };
    const go = async () => { const q = $('mQ').value.trim(); $('mQ').dataset.q = $('mQ').value; msgIn($('mMsg'), { ok: true, message: 'Searching…' }); const f = await api('member-find', { keyword: q }); if (!$('mRes')) return; rows = f.rows || []; sel = 0;
      if (rows.length === 1 && S.mode !== 'return') return use(rows[0]);
      draw();
      msgIn($('mMsg'), { ok: !!rows.length, message: rows.length ? `${rows.length} found — Enter adds the highlighted one (↑/↓ to pick), click one to see the card` : (f.ok === false && f.message ? f.message : `No customer found for "${q}"`) + '. Use "New customer" to add one.' });
      if (!rows.length) $('mNew').focus(); };
    $('mGo').onclick = go;
    $('mNew').addEventListener('keydown', e => { if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) $('mQ').focus(); });
    $('mQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (busy) return; if (rows.length && $('mQ').dataset.q === $('mQ').value) use(rows[sel]); else go(); } else if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); } };
    $('mNew').onclick = () => newMemberDialog($('mQ').value.trim());
    $('mEdit').onclick = async () => { const r = rows[sel]; if (!r) return; const d = await api('member-details', { id: r.id }); if (!d.ok) return msgIn($('mMsg'), d); editCustomer(d.member); };
  });
}
async function customerView(id) {
  const d = await api('member-details', { id }); if (!d.ok) return toast(d.message, false);
  const m = d.member, onSale = S.member && S.member.id === m.id;
  modal(`<h2>Customer</h2>${custCard(m)}<div id="cofWrap"></div><div id="cvMsg" class="msg"></div>
    <div class="row2" style="justify-content:flex-start">${S.mode === 'return' ? '' : onSale ? '<button class="pbtn r" id="cvDel">Remove from sale</button>' : '<button class="pbtn g" id="cvUse" autofocus>Use on this sale (Enter)</button>'}
      <button class="pbtn s" id="cvEdit">Edit Customer</button><button class="pbtn s" id="cvBuys">Past purchases</button><button class="pbtn s" id="cvFind">Find another</button><button class="pbtn s" data-close>Close (Esc)</button></div><div id="cvBuysBox"></div>`, () => {
    if ($('cvUse')) $('cvUse').onclick = async () => { const x = await api('member-attach', { number: m.number }); await refresh(); if (x.ok) { closeModal(); toast(x.message, true); } else msgIn($('cvMsg'), x); };
    if ($('cvDel')) $('cvDel').onclick = async () => { const x = await api('member-detach'); await refresh(); closeModal(); toast(x.message || 'Customer removed', x.ok); };
    $('cvEdit').onclick = () => editCustomer(m);
    if (S.keyed && (S.keyed.kind === 'stripe' || S.keyed.kind === 'sola')) cofLoad(m); // 1.0.9 cards on file (Stripe stores; Sola stores when on in Settings > Cards)
    $('cvFind').onclick = customerSearch;
    $('cvBuys').onclick = async () => {
      const r = await api('member-orders', { number: m.number }); if (!r.ok) return msgIn($('cvMsg'), r);
      $('cvBuysBox').innerHTML = `<h3 style="margin:12px 0 4px">Past purchases (${r.total})</h3><div style="max-height:34vh;overflow:auto"><table class="mini"><tbody>${r.rows.map(o => `<tr><td>${esc(o.number)}<div class="note" style="margin:0">${when(o.createTime)}</div></td><td>${esc(o.statusName)}</td><td>${esc(o.paymentTypeName || '')}</td><td class="n">${o.quantity}${o.quantityReturn ? ' (−' + o.quantityReturn + ')' : ''}</td><td class="n">${money(o.amount)}</td>
        <td style="white-space:nowrap">${o.status === 20 ? `<button class="pbtn s" data-print="${esc(o.id)}">Reprint</button> <button class="pbtn r" data-ret="${esc(o.id)}">Return</button>` : ''}</td></tr>`).join('') || '<tr><td class="note">No purchases yet</td></tr>'}</tbody></table></div>`;
      $('cvBuysBox').querySelectorAll('[data-print]').forEach(b => b.onclick = () => printOrder(b.dataset.print, $('cvMsg')));
      $('cvBuysBox').querySelectorAll('[data-ret]').forEach(b => b.onclick = async () => { if (S.cart.length) return msgIn($('cvMsg'), { ok: false, message: 'Finish, hold or put aside the current sale first' }); closeModal(); await act('return-start', { kind: 'receipt', orderId: b.dataset.ret }); });
    };
  });
}
// ---------- AirMax 1.0.9 cards on file (Ari OK 1:25 AM ET Oct 30): Stripe stores only, added only here in the customer profile ----------
// The card is typed into Stripe's own card box (an iframe); Air Register only ever holds Stripe's Element object, never the number.
const cofName = m => [m.firstName, m.lastName].filter(Boolean).join(' ') || m.name || '';
const cofLbl = c => `${esc(c.brand)} •••• ${esc(c.last4)}${c.exp ? ' exp ' + esc(c.exp) : ''}`;
const cofBadge = c => { const b = String(c.brand || '').toLowerCase(), mc = /master/.test(b); return `<span class="cofbrand ${mc ? 'mc' : ''}">${/visa/.test(b) ? 'VISA' : mc ? 'MC' : /amex|american/.test(b) ? 'AMEX' : esc(String(c.brand || 'CARD').slice(0, 4).toUpperCase())}</span>`; };
async function cofLoad(m, note) {
  const w = $('cofWrap'); if (!w) return;
  const r = await api('member-cards', { id: m.id }); if (!$('cofWrap')) return;
  const cards = r.ok ? r.cards : [];
  $('cofWrap').innerHTML = `<div class="cofbox" id="cofBox"><div class="cofhead"><b>Cards on file</b><span class="note">Kept by AIR POS and ${r.sola ? 'Sola' : 'Stripe'}. Air Max never stores card numbers.</span><button class="pbtn g" id="cofAdd">Add card…</button></div>
    ${!r.ok ? `<div class="cofempty">${esc(r.message)}</div>` : cards.length ? cards.map(c => `<div class="cofrow ${c.usable ? '' : 'off'}" data-cid="${esc(c.id)}">${cofBadge(c)}<span class="cofname">${cofLbl(c)}${c.usable ? '' : '<div class="note">Saved under another payment channel: cannot be charged here</div>'}</span><button class="pbtn r" data-cofdel="${esc(c.id)}">Remove</button></div>`).join('')
      : '<div class="cofempty">No cards on file. Press <b>Add card…</b> to save one (the customer must agree).</div>'}</div>`;
  $('cofAdd').onclick = () => cofAddDialog(m);
  $('cofWrap').querySelectorAll('[data-cofdel]').forEach(b => b.onclick = () => {
    const c = cards.find(x => String(x.id) === b.dataset.cofdel), row = b.closest('.cofrow'); if (!c || !row) return;
    row.innerHTML = `${cofBadge(c)}<span class="cofname" id="cofAsk">Remove ${cofLbl(c)} from ${esc(cofName(m))}? Are you sure?</span><button class="pbtn s" id="cofKeep">No, keep it</button><button class="pbtn r" id="cofYes">Yes, remove</button>`;
    $('cofKeep').onclick = () => cofLoad(m); $('cofKeep').focus();
    $('cofYes').onclick = async () => { $('cofYes').disabled = true; const x = await api('member-card-delete', { id: m.id, cardId: c.id }); msgIn($('cvMsg'), x); cofLoad(m); };
  });
  if (note) msgIn($('cvMsg'), note);
}
function cofAddDialog(m) {
  if (S.keyed && S.keyed.kind === 'sola') return cofSolaDialog(m); // 1.0.9 Sola: typed card fields (the Stripe dialog below is unchanged)
  const fld = (id, l, v, w) => `<div style="flex:${w}"><label class="f">${l}</label><input class="f" id="${id}" value="${esc(v || '')}" autocomplete="off"></div>`;
  modal(`<h2>Add card · ${esc(cofName(m))}</h2>
    <div style="display:flex;gap:8px">${fld('cofHolder', 'Card holder name *', cofName(m), 1.2)}${fld('cofAddr', 'Billing address *', m.address, 2)}${fld('cofZip', 'ZIP *', m.zipCode, 0.7)}</div>
    <label class="f">Card (typed into Stripe's secure card box)</label>
    <div class="cofstripe sfield" id="cofStripe"></div>
    <div class="note" style="margin:4px 0 0">${S.keyed && S.keyed.test ? '<b>Stripe TEST mode.</b> ' : ''}The card goes straight to Stripe. Air Max never sees or keeps the number.</div>
    <label class="cofconsent"><input type="checkbox" id="cofOk"> Customer agrees to save this card for future purchases</label>
    <div id="cofMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="cofCancel">Cancel (Esc)</button><button class="pbtn g" id="cofSave" disabled>Save card (Enter)</button></div>`, () => {
    let st = null, cardEl = null, busy = false;
    const back = () => customerView(m.id);
    $('cofCancel').onclick = () => { if (!busy) back(); };
    $('cofOk').onchange = () => { $('cofSave').disabled = busy || !$('cofOk').checked; };
    $('ov').querySelector('.modal').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); save(); }
    });
    (async () => {
      try { const k = await api('keyed-key'); if (!k.ok) throw new Error(k.message); await loadStripeJs(); if (!$('cofStripe')) return;
        st = window.Stripe(k.key); cardEl = st.elements().create('card', { style: { base: { fontSize: '17px', color: '#2c3e50' } }, hidePostalCode: true }); cardEl.mount('#cofStripe');
      } catch (e) { msgIn($('cofMsg'), { ok: false, message: "Could not load Stripe's secure card box (internet needed): " + (e.message || e) }); }
    })();
    const done = (ok, message) => { busy = false; if ($('cofSave')) { $('cofSave').textContent = 'Save card (Enter)'; $('cofSave').disabled = !$('cofOk').checked; $('cofCancel').disabled = false; } msgIn($('cofMsg'), { ok, message }); };
    async function save() {
      if (busy || !$('cofSave') || $('cofSave').disabled || !$('cofOk').checked) return;
      const holderName = $('cofHolder').value.trim(), billAddress = $('cofAddr').value.trim(), zipCode = $('cofZip').value.trim();
      if (!holderName || !billAddress || !zipCode) return msgIn($('cofMsg'), { ok: false, message: 'Card holder name, billing address and ZIP are needed' });
      if (!st || !cardEl) return msgIn($('cofMsg'), { ok: false, message: "Stripe's secure card box is not ready yet" });
      busy = true; $('cofSave').disabled = true; $('cofCancel').disabled = true; $('cofSave').textContent = 'Saving…';
      const b = await api('member-card-add-begin', { id: m.id }); if (!b.ok) return done(false, b.message);
      let res; try { res = await st.confirmCardSetup(b.clientSecret, { payment_method: { card: cardEl, billing_details: { name: holderName, address: { line1: billAddress, postal_code: zipCode } } } }); } catch (e) { res = { error: { message: e.message || String(e) } }; }
      b.clientSecret = ''; // memory only
      const si = res && res.setupIntent;
      if (!res || res.error || !si || si.status !== 'succeeded') return done(false, ((res && res.error && res.error.message) || 'Stripe did not accept the card') + '. Nothing was saved.');
      const x = await api('member-card-add-complete', { id: m.id, setupIntentId: si.id, holderName, billAddress, zipCode });
      if (!x.ok) return done(false, x.message);
      busy = false; await customerView(m.id); toast(x.message, true);
    }
    $('cofSave').onclick = save;
    setTimeout(() => $('cofOk') && $('cofOk').focus(), 0);
  });
}
// 1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31, local only). Same layout, buttons and keys as the Stripe Add card window, but the
// card is typed into Air Max's own boxes (Sola has no secure card box): it is sent ONCE to AIR POS (one save request), never kept,
// logged or printed, and the boxes are cleared right after the request (also on Cancel). The customer must agree first.
function cofSolaDialog(m) {
  const fld = (id, l, v, w) => `<div style="flex:${w}"><label class="f">${l}</label><input class="f" id="${id}" value="${esc(v || '')}" autocomplete="off"></div>`;
  modal(`<h2>Add card · ${esc(cofName(m))}</h2>
    <div style="display:flex;gap:8px">${fld('cofHolder', 'Card holder name *', cofName(m), 1.2)}${fld('cofAddr', 'Billing address *', m.address, 2)}${fld('cofZip', 'ZIP *', m.zipCode, 0.7)}</div>
    <label class="f">Card (Sola store: typed here, sent once to AIR POS)</label>
    <div style="display:flex;gap:8px" id="cofSola"><input class="f" id="cofNo" placeholder="Card number" inputmode="numeric" autocomplete="off" style="flex:2">
      <input class="f" id="cofExp" placeholder="MM/YY" inputmode="numeric" autocomplete="off" maxlength="5" style="max-width:100px">
      <input class="f" id="cofCvv" type="password" placeholder="CVV" inputmode="numeric" autocomplete="new-password" maxlength="4" style="max-width:90px"></div>
    <div class="note" style="margin:4px 0 0">AIR POS saves the card with Sola. Air Max never keeps, prints or logs the number; the boxes are cleared after saving.</div>
    <label class="cofconsent"><input type="checkbox" id="cofOk"> Customer agrees to save this card for future purchases</label>
    <div id="cofMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="cofCancel">Cancel (Esc)</button><button class="pbtn g" id="cofSave" disabled>Save card (Enter)</button></div>`, () => {
    let busy = false;
    const wipe = () => ['cofNo', 'cofExp', 'cofCvv'].forEach(id => { if ($(id)) $(id).value = ''; });
    const back = () => { wipe(); customerView(m.id); };
    $('cofCancel').onclick = () => { if (!busy) back(); };
    $('cofOk').onchange = () => { $('cofSave').disabled = busy || !$('cofOk').checked; };
    $('cofExp').oninput = e => { const d = e.target.value.replace(/\D/g, '').slice(0, 4); e.target.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };
    $('ov').querySelector('.modal').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); save(); }
    });
    const done = (ok, message, clear) => { busy = false; if (clear) wipe(); if ($('cofSave')) { $('cofSave').textContent = 'Save card (Enter)'; $('cofSave').disabled = !$('cofOk').checked; $('cofCancel').disabled = false; } msgIn($('cofMsg'), { ok, message }); };
    async function save() {
      if (busy || !$('cofSave') || $('cofSave').disabled || !$('cofOk').checked) return;
      const holderName = $('cofHolder').value.trim(), billAddress = $('cofAddr').value.trim(), zipCode = $('cofZip').value.trim();
      if (!holderName || !billAddress || !zipCode) return msgIn($('cofMsg'), { ok: false, message: 'Card holder name, billing address and ZIP are needed' });
      const card = { cardNo: $('cofNo').value.replace(/[\s-]/g, ''), expiration: $('cofExp').value.trim(), cvv: $('cofCvv').value.trim() };
      if (!card.cardNo || !card.expiration || !card.cvv) return msgIn($('cofMsg'), { ok: false, message: 'Type the card number, expiry (MM/YY) and CVV' });
      busy = true; $('cofSave').disabled = true; $('cofCancel').disabled = true; $('cofSave').textContent = 'Saving…';
      const body = { id: m.id, holderName, billAddress, zipCode, consent: true, card };
      let x; try { x = await api('member-card-add-complete', body); } finally { card.cardNo = card.cvv = card.expiration = ''; body.card = null; }
      if (!x.ok) return done(false, x.message, !x.cardError); // a typo (cardError) keeps the boxes so it can be fixed; anything else clears them
      wipe(); busy = false; await customerView(m.id); toast(x.message, true);
    }
    $('cofSave').onclick = save;
    setTimeout(() => $('cofNo') && $('cofNo').focus(), 0);
  });
}
function editCustomer(m) {
  const fld = (id, l, v, w) => `<div style="flex:${w || 1}"><label class="f">${l}</label><input class="f" id="${id}" value="${esc(v || '')}"></div>`;
  modal(`<h2>Edit customer ${esc(m.number)}</h2><div style="display:flex;gap:8px">${fld('ecFirst', 'First name *', m.firstName)}${fld('ecLast', 'Last name *', m.lastName)}</div>
    <div style="display:flex;gap:8px">${fld('ecPhone', 'Phone *', m.mobile)}${fld('ecEmail', 'E-mail', m.email, 1.4)}</div>
    <div style="display:flex;gap:8px">${fld('ecAddr', 'Address', m.address, 2)}${fld('ecZip', 'ZIP', m.zipCode)}</div>${fld('ecRem', 'Remark', m.remark)}
    <p class="note" id="ecNum">Customer # ${esc(m.number)} (the phone without punctuation, as in AIR POS). Points, credit and discounts are changed in AIR POS back office.</p><div id="ecMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="ecBack">Back</button><button class="pbtn s" id="ecOpen" style="display:none">Open existing customer</button><button class="pbtn g" id="ecSave">Save (Enter)</button></div>`, () => {
    $('ecBack').onclick = () => customerView(m.id);
    // request M: the customer number follows the phone; show what it will become before saving
    $('ecPhone').oninput = () => { const n = $('ecPhone').value.replace(/[^\w]/g, ''); $('ecNum').textContent = n === m.number ? `Customer # ${m.number} (the phone without punctuation, as in AIR POS). Points, credit and discounts are changed in AIR POS back office.` : `Customer # will change from ${m.number} to ${n || '?'} (the new phone without punctuation). Points and past sales stay with this customer record.`; };
    let existing = null; $('ecOpen').onclick = () => existing && customerView(existing.id);
    $('ecSave').onclick = async () => { $('ecSave').disabled = true; const x = await api('member-update', { id: m.id, firstName: $('ecFirst').value, lastName: $('ecLast').value, mobile: $('ecPhone').value, email: $('ecEmail').value, address: $('ecAddr').value, zipCode: $('ecZip').value, remark: $('ecRem').value }); $('ecSave').disabled = false;
      existing = x.duplicate && x.existing ? x.existing : null; $('ecOpen').style.display = existing ? '' : 'none'; if (existing) $('ecOpen').textContent = `Open existing customer: ${existing.name || existing.number}`;
      if (x.ok) { toast(x.message, true); await refresh(); customerView(m.id); } else msgIn($('ecMsg'), x); };
    $('modalRoot').querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('ecSave').click(); });
  });
}

// ---------- gift cards (Ctrl+G): balance, sell / activate, reload ----------
A['gift-balance'] = () => {
  modal(`<h2>Gift card</h2><label class="f">Gift card number</label><div style="display:flex;gap:6px"><input class="f" id="gNo" placeholder="Scan or type" autofocus autocomplete="off"><button class="pbtn" id="gChk">Check balance</button></div>
    <div id="gInfo"></div><div id="gMsg" class="msg"></div><div id="gList"></div><div class="row2"><button class="pbtn" id="gMulti">Multiple Gift Cards…</button><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    $('gMulti').onclick = () => { closeModal(); A['gift-multi'](); };
    // 1.0.11-local.4g (Ari 5:48 PM ET Nov 1): every Check adds the card + balance to a list with a combined total, then the box clears
    // and is ready for the next scan; a card already on the list is not added twice. Read only (gift-lookup reads AIR POS, changes nothing).
    const seen = [];
    const listHtml = () => { if (!seen.length) return ''; const live = seen.filter(x => x.isSold && !x.expired), tot = live.reduce((a, x) => a + x.balance, 0);
      return `<table class="mini" id="gTbl"><tbody>${seen.map((x, i) => `<tr><td>${esc(x.number)}</td><td class="note">${x.expired ? 'EXPIRED' : x.isSold ? '' : 'not active'}</td><td class="n">${money(x.balance)}</td><td><button class="pbtn s gRm" data-nok="1" data-i="${i}" title="Take off the list (changes nothing on the card)">✕</button></td></tr>`).join('')}</tbody></table>
        <div class="pcard"><div><b>Total of ${live.length} card${live.length === 1 ? '' : 's'}</b>${live.length < seen.length ? ' <span class="note">(expired / not active cards not counted)</span>' : ''}</div><div class="big" id="gTotal">${money(Math.round(tot * 100) / 100)}</div></div>`; };
    const drawList = () => { $('gList').innerHTML = listHtml(); $('gList').querySelectorAll('.gRm').forEach(b => b.onclick = () => { seen.splice(Number(b.dataset.i), 1); drawList(); $('gNo').focus(); }); }; // remove = list only, no AIR POS call
    const show = async () => {
      const number = $('gNo').value.trim(); if (!number) return;
      const r = await api('gift-lookup', { number }); const c = r.card;
      $('gNo').value = ''; $('gNo').focus();
      if (!r.ok && !r.notFound) { $('gInfo').innerHTML = ''; return msgIn($('gMsg'), r); }
      const dup = c && seen.some(x => x.id === c.id || String(x.number).toUpperCase() === String(c.number).toUpperCase());
      if (c && !dup) seen.push({ id: c.id, number: c.number, balance: c.balance, isSold: c.isSold, expired: c.expired });
      drawList();
      msgIn($('gMsg'), { ok: r.ok, message: !r.ok ? `No gift card ${number} yet — you can sell it as a new card.` : dup ? `Gift card ${c.number} is already on the list (not added twice).` : '' });
      const canSell = S.mode !== 'return' && !(S.pay);
      const sell = !c || !c.isSold;
      $('gInfo').innerHTML = (c ? `<div class="pcard"><div><b>Gift card ${esc(c.number)}</b>${c.member ? ' · ' + esc(c.member) : ''}</div><div class="big">${money(c.balance)}</div>
        <div class="note">${c.isSold ? 'Sold' + (c.soldOn ? ' on order ' + esc(c.soldOn) : '') + ` · used ${money(c.used)}` : 'Not sold yet (not active)'}${c.expireDate ? ' · expires ' + new Date(c.expireDate).toLocaleDateString('en-US') : ''}${c.expired ? ' · <b>EXPIRED</b>' : ''}</div></div>` : '')
        + (canSell && !(c && c.expired) ? `<h3 style="margin:14px 0 2px">${sell ? (c ? 'Sell / activate this card' : 'Sell a new card') : 'Reload this card'}</h3>
          <div style="display:flex;gap:8px">${sell && c ? '' : `<div style="flex:1"><label class="f">${sell ? 'Card value' : 'Amount to load'}</label><input class="f" id="gAmt" inputmode="decimal"></div>`}
          <div style="flex:1"><label class="f">Customer pays${sell && c ? ` (card value ${money(c.faceValue)})` : ' (blank = same)'}</label><input class="f" id="gPay" inputmode="decimal" placeholder="${sell && c ? c.faceValue.toFixed(2) : ''}"></div></div>
          <div class="row2" style="justify-content:flex-start"><button class="pbtn g" id="gAdd">${sell ? 'Add card sale to this sale' : 'Add reload to this sale'}</button></div><p class="note">The card is activated / loaded by AIR POS when the sale is paid.</p>` : '');
      if ($('gAdd')) $('gAdd').onclick = async () => {
        const x = await api('gift-line', { number, amount: $('gAmt') ? $('gAmt').value : c.faceValue, pay: $('gPay').value });
        await refresh(); if (x.ok) { closeModal(); toast(x.message, true); } else msgIn($('gMsg'), x); };
      const f = $('gAmt') || $('gPay'); if (f) { if (!c || !c.isSold) f.focus(); /* selling a new / not-active card: focus the amount as before; a sold card keeps the box ready for the next scan */ $('gInfo').querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('gAdd').click(); }); }
    };
    $('gChk').onclick = show; $('gNo').onkeydown = e => { if (e.key === 'Enter') show(); };
  });
};

// ---------- 1.2.0: sell several gift cards (Ctrl+Shift+G) ----------
// Enter the amount once, then scan cards one after another: every scan is added at once (no OK). Enter on an empty field = done.
// Optional "How many" shows a checklist N of N. Each card is its own line; AIR POS activates them all when the one checkout is paid.
A['gift-multi'] = () => giftSell(true);
A['gift-card'] = () => giftSell(false); // one card: amount, scan / type the card, Enter = added (no OK / confirm)
function giftSell(multi) {
  if (S.mode === 'return' || S.pay) return toast('Gift cards are sold in a sale (not during payment or a return)', false);
  const done = [];
  // Owner: clean and minimal. Title, Amount, Scan card, (Multiple) the list + count and total. Errors only when something fails.
  modal(`<h2>${multi ? 'Multiple Gift Cards' : 'Gift Card'}</h2>
    <label class="f">Amount</label><input class="f" id="gmAmt" inputmode="decimal" autocomplete="off">
    <label class="f">Scan card</label><input class="f" id="gmNo" autocomplete="off">
    ${multi ? '<div id="gmList" class="gmList"></div><div id="gmCount" class="due gmTot"></div>' : ''}<div id="gmMsg" class="msg"></div>
    <div class="row2"><button class="pbtn g" id="gmDone">${multi ? 'Done' : 'Add'}</button></div>`, () => {
    const amt = $('gmAmt'), no = $('gmNo'); if (multi && giftSell.lastAmt) amt.value = giftSell.lastAmt; amt.focus(); amt.select(); // last amount is offered again (type over it)
    const draw = () => {
      if (!multi) return; const ok = done.filter(d => d.ok);
      $('gmList').innerHTML = ok.map(d => `<div class="gmRow"><span>${esc(d.masked)}</span><b>${money(d.value)}</b></div>`).join('');
      $('gmCount').innerHTML = ok.length ? `<span>${ok.length} card${ok.length > 1 ? 's' : ''}</span><b>${money(ok.reduce((a, d) => a + (Number(d.value) || 0), 0))}</b>` : '';
    };
    // Done (or Enter on the empty field) = back to the sale: every card is a cart line "Gift Card **** 1234" at its amount,
    // counted in the totals; Enter / F12 then opens Payment and AIR POS activates the cards when the sale is paid.
    const finish = async () => { for (let i = 0; busy && i < 100; i++) await new Promise(r => setTimeout(r, 50)); closeModal(); if (multi && Number(amt.value) > 0) giftSell.lastAmt = amt.value;
      await refresh(); focusScan(); };
    let busy = false;
    const add = async () => {
      const number = no.value.replace(/[\r\n]/g, '').trim(); no.value = '';
      if (!number) return finish();
      if (busy) return; busy = true;
      if (multi && !(Number(amt.value) > 0)) { busy = false; amt.focus(); return msgIn($('gmMsg'), { ok: false, message: 'Enter the amount' }); }
      const x = await api('gift-line', { number, amount: amt.value }); busy = false;
      const masked = number.length > 4 ? '**** ' + number.slice(-4) : number;
      done.push(x.ok ? { ok: true, masked, value: x.gift ? x.gift.value : Number(amt.value), kind: x.gift && x.gift.kind } : { ok: false, masked, message: x.message });
      if (!x.ok) { beep(); msgIn($('gmMsg'), { ok: false, message: masked + ': ' + x.message }); } else { $('gmMsg').textContent = ''; $('gmMsg').className = 'msg'; }
      draw(); no.focus();
      if (!multi && x.ok) return finish();
    };
    amt.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); no.focus(); } };
    no.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    $('gmDone').onclick = () => (no.value.trim() ? add() : finish());
    draw();
  });
}

// ---------- buttons on the main screen ----------
// Owner (3:49 PM): the Put Aside / Load Aside BUTTONS are off the screen. The code, the keys (Ctrl+Shift+A / Ctrl+Shift+L) and
// aside.json stay. While any sale is still parked, a small "Parked sales (N)" button shows under the actions so nothing is lost.
const ASIDE_BUTTONS = [['Put Aside', 'Ctrl + Shift + A', '📥', 'aside-put'], ['Load Aside', 'Ctrl + Shift + L', '📤', 'aside-load']]; // kept, not shown
function asideMenu() {
  const acts = $('actions'); if (!acts) return;
  let b = $('asideMenu');
  if (!b) { b = document.createElement('button'); b.id = 'asideMenu'; b.className = 'abtn asidemenu'; b.type = 'button'; b.onclick = () => run('aside-load'); acts.insertAdjacentElement('afterend', b); }
  const n = S.asideCount || 0; b.style.display = n ? '' : 'none';
  b.innerHTML = `<span class="ic">📤</span><span><span class="t">Parked sales (${n})</span><span class="k">Ctrl + Shift + L</span></span>`; b.title = 'Bring back a sale that was put aside on this PC';
}
A['gift-receipt'] = async () => { // F10 / left Actions button: mark this sale for a gift receipt (toggle). Printing is AIR POS's own gift template.
  if (S.mode !== 'sale') return toast('Gift receipts are for sales', false);
  if (!S.giftReceipt && (S.cart || []).length >= 2) { // 1.0.11-local.6g: 2+ lines = pick the items (all ticked); Cancel (Esc) adds nothing
    const it = await api('gift-cart-items');
    if (it && it.ok && Array.isArray(it.items) && it.items.length >= 2) {
      const pick = await giftPicker(it.items, { title: 'Add Gift Receipt', note: 'Untick the items to leave off. It prints when the sale is finished, with no prices.' });
      if (!pick) return;
      const ex = it.items.map(i => i.id).filter(id => !pick.ids.includes(id));
      const x = await api('gift-receipt', ex.length ? { on: true, exclude: ex, of: it.items.length } : { on: true }); await refresh(); return toast(x.message, !!x.ok);
    }
  }
  const x = await api('gift-receipt', { on: !S.giftReceipt }); await refresh(); toast(x.message, !!x.ok);
};
LAYOUT.right.splice(1, 0, ['Gift Cards', [['Gift Card', 'Ctrl + G', 'gift-card'], ['Multiple Gift Cards', 'Ctrl + Shift + G', 'gift-multi'], ['Gift Card Balance', 'Ctrl + Shift + B', 'gift-balance']]] /* Add Gift Receipt (F10) moved to the left Actions column (app.js LAYOUT.actions) */, ['Lookups', [['Price Check', 'Ctrl + I', 'price-check'], ['Find in Sale', 'Ctrl + Shift + F', 'cart-search'], ['Sale Note', 'Ctrl + N / Alt + N', 'note'], ['Calculator', 'Ctrl + Shift + C', 'calculator'], ['Zoom', 'Ctrl + 0 · Ctrl + = / −', 'zoom-reset']]]);
build();

// ---------- no-receipt return: refund screen (net is a refund, or return only) ----------
// Cash is the default line; Card (refunded by the cashier on the card machine, recorded in AIR POS) is the other. Up/Down or click picks, Enter refunds. Nothing else on screen.
function refundDialog() { return refundPanel('mix'); } // owner request J: the same side-panel payment screen, labelled Refund (app.js refundPanel)
function refundDoneDialog(r) {
  document.body.classList.remove('paying'); // full width again behind the done box
  if (r.hwPending && r.hwPending.length && window.watchHw) watchHw(); // request L
  const q = r.quickReturn || {}, back = q.back ?? q.refund ?? 0;
  modal(`<div id="rdBody" tabindex="-1" style="outline:none;text-align:center"><h2>${back ? (q.backType === 'Account' ? 'Refunded' : 'Give back') : 'Done'}</h2>${back ? `<div class="refbig">${money(back)}</div><p style="font-size:18px">${q.backType === 'Card' ? 'Refund it on the card machine now (Air Max only records it)' : q.backType === 'Account' ? 'to the customer\'s account in AIR POS (store credit)' : 'cash'}</p>` : ''}
    <button class="btn" id="rdNew">Next sale <kbd>Enter</kbd></button></div>`, () => {
    const next = () => { closeModal(); refresh().then(focusScan); };
    $('rdNew').onclick = next; $('rdBody').focus();
    $('rdBody').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next(); } };
  });
}

// ---------- 1.2.3 (owner 4:27 / 4:29 PM): tap / click the version number = check for updates, then "Update now" ----------
// Uses the existing updater (latest.yml feed, sha512-checked download). The automatic checks (20 s after start, then every
// 6 h) are unchanged. "Update now" asks the launcher to close, install silently and restart; refused during a sale/payment.
function updMsg(u) {
  u = u || {};
  if (u.state === 'checking') return 'Checking…';
  if (u.state === 'current') return `You're up to date (${u.current})`;
  if (u.state === 'downloading') return `Update ${u.available} found, downloading…`;
  if (u.state === 'ready') return `Update ${u.available} is ready. Press Update now (Air Max closes and opens again), or it installs when you close Air Max.`;
  if (u.state === 'error') return "Couldn't check, no internet. Try again later.";
  return u.message || 'Updates are not set up on this PC';
}
function updPanel(text, withBtn, kind) {
  let d = $('updPanel');
  if (!d) { d = document.createElement('div'); d.id = 'updPanel'; d.setAttribute('role', 'status'); d.style.cssText = 'position:fixed;top:54px;right:14px;z-index:9000;max-width:380px;background:#fff;color:#111;border:2px solid #2563eb;border-radius:10px;padding:12px 14px;box-shadow:0 6px 24px rgba(0,0,0,.25);font-size:15px'; document.body.appendChild(d); }
  d.style.borderColor = kind === 'err' ? '#dc2626' : kind === 'ok' ? '#16a34a' : '#2563eb';
  d.innerHTML = ''; const t = document.createElement('div'); t.id = 'updText'; t.textContent = text; d.appendChild(t);
  const row = document.createElement('div'); row.style.cssText = 'margin-top:10px;display:flex;gap:8px;justify-content:flex-end';
  if (withBtn) { const b = document.createElement('button'); b.type = 'button'; b.id = 'updNow'; b.className = 'pbtn g'; b.textContent = 'Update now'; b.onclick = updateNow; row.appendChild(b); }
  const c = document.createElement('button'); c.type = 'button'; c.id = 'updClose'; c.className = 'pbtn s'; c.textContent = withBtn ? 'Later' : 'OK'; c.onclick = () => d.remove(); row.appendChild(c);
  d.appendChild(row); return d;
}
async function updateNow() {
  const b = $('updNow'); if (b) b.disabled = true;
  const x = await api('update-install').catch(() => null);
  if (x && x.ok) return updPanel(x.message || 'Installing the update…', false, 'ok');
  updPanel((x && x.message) || "Couldn't start the update. Try again.", true, 'err'); // button stays: press again after the sale is finished or held
}
let updBusy = false;
async function checkUpdatesNow() {
  if (updBusy) return; updBusy = true; updPanel('Checking…', false);
  try {
    const x = await api('update-check').catch(() => null); let u = x && x.update;
    for (let i = 0; i < 600 && u && (u.state === 'checking' || u.state === 'downloading'); i++) { // download may take a few minutes
      if (u.state === 'downloading') updPanel(updMsg(u), false);
      await new Promise(r => setTimeout(r, 1000));
      const st = await fetch('/api/state').then(r => r.json()).catch(() => null); u = (st && st.update) || u;
    }
    if (!u) return updPanel("Couldn't check, no internet. Try again later.", false, 'err');
    updPanel(updMsg(u), u.state === 'ready', u.state === 'error' ? 'err' : u.state === 'current' ? 'ok' : '');
  } finally { updBusy = false; }
}
document.addEventListener('click', e => { const t = e.target && e.target.closest && e.target.closest('#stVer, #buildPill'); if (t) checkUpdatesNow(); });
(() => { for (const id of ['stVer', 'buildPill']) { const el = document.getElementById(id); if (el) { el.title = 'Check for updates now'; el.style.cursor = 'pointer'; el.setAttribute('role', 'button'); } } })();

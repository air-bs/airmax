// AirMax Orders tab, phase 1 (PLAN-orders-tab.md). ORDERS, right after RETAIL SALES in the top bar, opens a full page that lists and
// searches AIR POS orders. VIEW AND SEARCH ONLY: the page reads /api/backoffice-orders (one read-only AIR POS list) and nothing else;
// the sale on the RETAIL SALES screen is never changed. The page is a window in #modalRoot like Settings, placed under the top bar so
// both tabs stay visible: Esc = back to the sale, the sale keys wait while it is open, and every button shows its key (dlgkeys.js).
// No new shortcut, no new setting, no global key handler. Uses app.js helpers ($, esc, money, api, modal, closeModal, modalOpen, toast, S, A, hRange).
'use strict';
(() => {
  const css = document.createElement('style');
  css.textContent = `
 .top { min-width:0; } /* the bar never grows wider than the screen: the shop name gets "…" (its own CSS asks for that) instead of pushing Settings off */
 @media (max-width:1180px) { body.ob-on .top .apnav { display:flex; } body.ob-on .top .apnav.ob-tight { display:none; } } /* narrow: RETAIL SALES shows on the Orders page when it fits */
 .top .obtab { align-self:stretch; display:flex; align-items:center; border:0; border-bottom:2px solid transparent; border-radius:0; background:none; margin:0; padding:0 6px; font:inherit; font-size:13px; font-weight:700; letter-spacing:.4px; color:var(--ap-text2); cursor:pointer; white-space:nowrap; }
 .top .obtab:hover, .top .obtab:focus-visible { color:var(--ap-blue); background:var(--ap-blue-bg); outline:none; }
 body.ob-on .top .apnav { color:var(--ap-text2); border-bottom-color:transparent; cursor:pointer; } body.ob-on .top .apnav:hover { color:var(--ap-blue); background:var(--ap-blue-bg); }
 body.ob-on .top .obtab { color:var(--ap-blue); border-bottom-color:var(--ap-blue); }
 .el-overlay.obwin-ov { top:52px; bottom:26px; align-items:stretch; justify-content:stretch; background:var(--ap-bg); }
 .modal.obwin { width:100%; max-width:none; min-width:0; height:100%; max-height:none; border-radius:0; box-shadow:none; padding:10px; background:var(--ap-bg); display:flex; flex-direction:column; overflow:hidden; }
 .obpg { flex:1; min-height:0; display:flex; flex-direction:column; gap:8px; background:#fff; border:1px solid var(--ap-line); padding:12px 14px 10px; }
 .obhead { display:flex; align-items:center; gap:14px; } .obhead .cotitle { padding:0; } .obnote { flex:1; color:var(--ap-text3); font-size:12.5px; }
 .obpg .pbtn { padding:6px 12px; font-size:13px; border-radius:2px; }
 .obform { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:6px 12px; margin:0; padding:8px 12px 10px; background:var(--ap-gray); border:1px solid var(--ap-line2); }
 .obform label.f { margin:0 0 3px; font-size:12px; } .obform input.f { font-size:14px; padding:6px 8px; border-radius:2px; } .obform .obwide { grid-column:span 2; }
 .obgroup { grid-column:1 / -1; display:flex; flex-wrap:wrap; align-items:center; gap:4px 14px; font-size:13px; }
 .obgroup b { width:58px; font-size:12px; color:var(--ap-text2); } .obgroup label { display:inline-flex; align-items:center; gap:5px; cursor:pointer; } .obgroup input { width:16px; height:16px; margin:0; }
 .obhint { color:var(--ap-text3); font-size:11.5px; }
 .obbtns { grid-column:1 / -1; display:flex; flex-wrap:wrap; align-items:center; gap:6px; } .obbtns .obsep { width:10px; }
 .obwarn { background:#fdf6ec; color:#9c640c; border:1px solid #f5dab1; padding:6px 10px; font-size:13px; font-weight:600; }
 .obbar { display:flex; align-items:center; gap:10px; font-size:13px; color:var(--ap-text2); } .obbar .sp { flex:1; } #obCount { font-weight:600; color:var(--ap-text); }
 .obtable { flex:1; min-height:0; overflow:auto; border:1px solid var(--ap-line); }
 .obtable table { font-size:13px; } .obtable th { position:sticky; top:0; z-index:1; } .obtable td { padding:7px 10px; }
 .obsm { color:var(--ap-text3); font-size:11.5px; } .obrem { max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
 #obGo.obbusy { opacity:.7; }`;
  document.head.appendChild(css);

  const sales = document.querySelector('.top .apnav'); // RETAIL SALES (text and markup unchanged)
  if (!sales || !$('modalRoot')) return;
  const tab = document.createElement('button');
  tab.type = 'button'; tab.id = 'obTab'; tab.className = 'obtab'; tab.textContent = 'ORDERS';
  tab.title = 'Orders: view and search (nothing here changes an order)';
  sales.insertAdjacentElement('afterend', tab);

  const PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['d30', 'Past 30 days'], ['any', 'Any date']];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const who = () => (S && S.user ? [S.user.company, S.user.shop, S.user.user].join('|') : '');
  const blank = () => ({ number: '', productNumber: '', customer: '', operator: '', remark: '', from: ymd(new Date()), to: ymd(new Date()), statuses: [], payments: [] }); // default: today
  const isOpen = () => !!$('obPage');
  let OPTS = null, LAST = null, SEQ = 0; // LAST = the search on screen (kept while this page is loaded; nothing is saved on the PC)

  // History's date presets (app.js hRange: weeks start Monday), as From / To days
  function preset(k) {
    if (k === 'any') return ['', ''];
    const r = typeof hRange === 'function' ? hRange(k) : null; if (!r) return null;
    const last = new Date(r[1]); last.setDate(last.getDate() - 1); return [ymd(r[0]), ymd(last)];
  }
  function blockReason() {
    if (!S || !S.loggedIn) return 'Log in first';
    if (S.mode === 'clockin') return 'Clock in first';
    if (S.pay) return 'Finish the payment first (F12). The Orders tab opens when the sale is done.'; // a started payment stays in view
    if (modalOpen()) return 'Close the open window first';
    return '';
  }
  const when = t => { const d = t ? new Date(t) : null; return d && !isNaN(d) ? d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' }) : ''; };
  const rowHtml = o => `<tr data-id="${esc(o.id)}"><td>${esc(o.number)}</td><td>${esc(when(o.time))}</td><td>${esc(o.statusName)}</td><td>${esc(o.paymentTypeName)}</td>`
    + `<td>${esc(o.customer)}${o.customerNumber ? `<div class="obsm">${esc(o.customerNumber)}</div>` : ''}</td><td>${esc(o.operator)}</td>`
    + `<td class="n">${Number(o.quantity) || 0}${o.quantityReturn ? ' (−' + Number(o.quantityReturn) + ')' : ''}</td><td class="n">${money(o.total)}</td><td class="obrem" title="${esc(o.remark)}">${esc(o.remark)}</td></tr>`;

  function pageHtml(q) {
    const box = (id, label, v, extra = '', cls = '') => `<div${cls ? ` class="${cls}"` : ''}><label class="f" for="${id}">${label}</label><input class="f" id="${id}" value="${esc(v)}" maxlength="60" autocomplete="off" spellcheck="false" ${extra}></div>`;
    const ticks = (cls, list, on) => list.map(o => `<label><input type="checkbox" class="${cls}" value="${Number(o.code)}" ${on.includes(o.code) ? 'checked' : ''}> ${esc(o.name)}</label>`).join('');
    return `<div class="obpg" id="obPage">
    <div class="obhead"><div class="cotitle"><span class="coico">&#9636;</span>ORDERS</div><span class="obnote">View and search only. Nothing on this page changes an order or the sale.</span><button type="button" class="pbtn s" id="obBack" data-close>Back to sale <kbd>Esc</kbd></button></div>
    <form class="obform" id="obForm" autocomplete="off">
      ${box('obNum', 'Order #', q.number, 'autofocus')}${box('obProd', 'Product #', q.productNumber)}${box('obCust', 'Customer # / phone', q.customer, 'inputmode="tel"')}${box('obOp', 'Operator', q.operator)}
      <div><label class="f" for="obFrom">From</label><input class="f" type="date" id="obFrom" value="${esc(q.from)}"></div>
      <div><label class="f" for="obTo">To</label><input class="f" type="date" id="obTo" value="${esc(q.to)}"></div>
      ${box('obRem', 'Remark', q.remark, '', 'obwide')}
      <div class="obgroup" id="obStatus"><b>Status</b>${ticks('obst', OPTS.statuses, q.statuses)}<span class="obhint">none ticked = all</span></div>
      <div class="obgroup" id="obPaid"><b>Paid by</b>${ticks('obpt', OPTS.payments, q.payments)}<span class="obhint">none ticked = all</span></div>
      <div class="obbtns"><button type="submit" class="pbtn" id="obGo">Search <kbd>Enter</kbd></button><button type="button" class="pbtn s" id="obClear">Clear</button><span class="obsep"></span>${PRESETS.map(([k, l]) => `<button type="button" class="pbtn s obq" data-q="${k}">${l}</button>`).join('')}</div>
    </form>
    <div class="msg err" id="obMsg" role="alert"></div>
    <div class="obwarn" id="obWarn" role="status" hidden></div>
    <div class="obbar"><span id="obCount"></span><span class="sp"></span><button type="button" class="pbtn s" id="obPrev" disabled>&#9664; Previous <kbd>PgUp</kbd></button><span id="obPg"></span><button type="button" class="pbtn s" id="obNext" disabled>Next &#9654; <kbd>PgDn</kbd></button></div>
    <div class="obtable"><table><thead><tr><th>Order #</th><th>Date / time</th><th>Status</th><th>Paid by</th><th>Customer</th><th>Operator</th><th class="n">Items</th><th class="n">Total</th><th>Remark</th></tr></thead><tbody id="obRows"></tbody></table></div>
  </div>`;
  }
  const val = id => ($(id) ? $(id).value.trim() : '');
  const ticked = cls => [...document.querySelectorAll('#obPage input.' + cls + ':checked')].map(c => Number(c.value));
  const readForm = () => ({ number: val('obNum'), productNumber: val('obProd'), customer: val('obCust'), operator: val('obOp'), remark: val('obRem'), from: val('obFrom'), to: val('obTo'), statuses: ticked('obst'), payments: ticked('obpt') });
  function fill(q) {
    [['obNum', q.number], ['obProd', q.productNumber], ['obCust', q.customer], ['obOp', q.operator], ['obRem', q.remark], ['obFrom', q.from], ['obTo', q.to]].forEach(([id, v]) => { if ($(id)) $(id).value = v; });
    document.querySelectorAll('#obPage input.obst').forEach(c => { c.checked = q.statuses.includes(Number(c.value)); });
    document.querySelectorAll('#obPage input.obpt').forEach(c => { c.checked = q.payments.includes(Number(c.value)); });
  }
  function shown(r) {
    const rows = r.rows || [], first = (r.page - 1) * r.pageSize + 1, last = (r.page - 1) * r.pageSize + rows.length;
    $('obRows').innerHTML = rows.map(rowHtml).join('') || '<tr><td colspan="9" class="empty">No orders match these filters.</td></tr>';
    $('obCount').textContent = (r.total === 1 ? '1 order' : r.total + ' orders') + (rows.length ? ` · showing ${first}–${last}` : '');
    $('obPg').textContent = `Page ${r.page} of ${r.pages}`;
    $('obPrev').disabled = r.page <= 1; $('obNext').disabled = r.page >= r.pages;
    const un = r.unapplied || [], w = $('obWarn');
    w.hidden = !un.length;
    w.textContent = un.length ? `⚠ AIR POS sent orders that do not match: ${un.join(', ')}. AIR POS may not support ${un.length > 1 ? 'these filters' : 'this filter'} yet, so this list is NOT filtered by ${un.length > 1 ? 'them' : 'it'}.` : '';
  }
  function failed(message) {
    $('obRows').innerHTML = '<tr><td colspan="9" class="empty">Not loaded</td></tr>';
    $('obCount').textContent = ''; $('obPg').textContent = ''; $('obPrev').disabled = $('obNext').disabled = true; $('obWarn').hidden = true;
    $('obMsg').textContent = message || 'The orders could not be loaded. Press Search to try again.';
  }
  // q given = page through the search on screen; no q = what the form says now (Search / Enter, presets, Clear)
  async function search(page, q) {
    if (!isOpen()) return;
    q = q || readForm(); const my = ++SEQ;
    LAST = { who: who(), q, page: page || 1 };
    $('obMsg').textContent = ''; $('obCount').textContent = 'Searching AIR POS…'; $('obGo').classList.add('obbusy');
    const r = await api('backoffice-orders', { ...q, page: LAST.page }, { timeoutMs: 40000 });
    if (my !== SEQ || !isOpen()) return; // a newer search started, or the page was closed: this late answer is dropped
    $('obGo').classList.remove('obbusy');
    if (!r || !r.ok) return failed(r && r.message);
    LAST.page = r.page; shown(r);
  }
  function mount() {
    $('obForm').onsubmit = e => { e.preventDefault(); search(1); };
    $('obClear').onclick = () => { fill(blank()); search(1); };
    document.querySelectorAll('#obPage .obq').forEach(b => { b.onclick = () => { const d = preset(b.dataset.q); if (!d) return; $('obFrom').value = d[0]; $('obTo').value = d[1]; search(1); }; });
    $('obPrev').onclick = () => { if (LAST && LAST.page > 1) search(LAST.page - 1, LAST.q); };
    $('obNext').onclick = () => { if (LAST) search(LAST.page + 1, LAST.q); };
    $('obPage').addEventListener('keydown', e => { // PgUp / PgDn = Previous / Next page (this page only)
      if ((e.key !== 'PageDown' && e.key !== 'PageUp') || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      e.preventDefault(); const b = $(e.key === 'PageDown' ? 'obNext' : 'obPrev'); if (b && !b.disabled) b.click();
    });
  }
  async function openOrders() {
    if (isOpen()) { if ($('obNum')) $('obNum').focus(); return; }
    const why = blockReason(); if (why) return toast(why, false);
    if (!OPTS) { const o = await api('backoffice-options'); if (!o || !o.ok) return toast((o && o.message) || 'The Orders tab could not open', false); OPTS = o; }
    if (blockReason()) return; // a window opened while the options loaded (also a 2nd tap that came meanwhile: its page is already open)
    if (!LAST || LAST.who !== who()) LAST = { who: who(), q: blank(), page: 1 }; // another user / shop: start over
    modal(pageHtml(LAST.q), mount, 'obwin');
    search(LAST.page, LAST.q);
  }
  // Screens up to 1180 px wide hide RETAIL SALES to save room (index.html). On the Orders page it is the way back, so it shows there
  // whenever it fits; it never pushes the Settings button off the screen (then the page's "Back to sale (Esc)" is the way back).
  function fit() {
    sales.classList.remove('ob-tight');
    const set = $('setTop'); if (isOpen() && set && set.getBoundingClientRect().right > window.innerWidth + 0.5) sales.classList.add('ob-tight');
  }
  // the active tab follows the page: open = ORDERS underlined, closed (Esc, Back to sale, RETAIL SALES, logout) = RETAIL SALES
  const sync = () => { const on = isOpen(); document.body.classList.toggle('ob-on', on); tab.toggleAttribute('aria-current', on); sales.toggleAttribute('aria-current', !on); fit(); };
  new MutationObserver(sync).observe($('modalRoot'), { childList: true }); sync();
  window.addEventListener('resize', fit);
  tab.addEventListener('click', () => { openOrders(); });
  sales.addEventListener('click', () => { if (isOpen()) closeModal(); });
  A['orders-tab'] = openOrders; // no key in phase 1 (a shortcut needs the owner's OK: PLAN-orders-tab.md)
})();

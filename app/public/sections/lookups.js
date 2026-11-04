// AirMax API batch 1 (calls 11, 12, 14-19), screen side. Reads, plus the one save (call 12, terminal switches). Plain script (no modules), loaded by topbar.js after login screen boots.
// 1. window.AirMaxLookups: one place where every screen reads the lookup lists (tax kinds, payment types, sub-types, origins, categories, regions)
//    and this terminal's settings. Items / Customers / Orders batches call  AirMaxLookups.load('taxKinds')  etc.; answers are kept in memory for
//    5 minutes per login (never written to disk) and  { refresh: true }  asks AIR POS again.
// 2. Two named mount slots the Settings layout draws when it is built (batch 1 owns settings.js; the left-menu layout waits for Gordon's OK):
//      settings.store.terminal  -> "Terminal settings" (view only)
//      settings.store.lists     -> "Lists" (view only)
//    Until a Settings screen draws those slots nothing shows anywhere: this file does NOT register the `settings` tab (that would replace the
//    existing Settings dialog) and adds nothing to Checkout.
// Both panels show only to a manager login (superAdmin or RetailManager, the rule the existing Settings use for "manager only"); a cashier sees one plain line.
(function () {
  'use strict';
  const ROUTE = { taxKinds: 'lookup-tax-kinds', paymentTypes: 'lookup-payment-types', subPaymentTypes: 'lookup-sub-payment-types', origins: 'lookup-origins', categories: 'lookup-categories', regions: 'lookup-regions', store: 'store-settings-get', terminal: 'terminal-config-get', access: 'settings-access' };
  const TTL = 5 * 60 * 1000;
  const cache = new Map(); // key -> { at, who, p }
  const who = () => { try { const u = (typeof S !== 'undefined' && S.user) || {}; return [u.company, u.shop, u.user].join('|'); } catch (e) { return ''; } };
  const E = s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  function load(name, opt) {
    const route = ROUTE[name]; if (!route) return Promise.resolve({ ok: false, message: 'Unknown list ' + name });
    const body = name === 'regions' && opt && (opt.type || opt.countryCode) ? { type: opt.type, countryCode: opt.countryCode } : {};
    const key = name + (body.type || body.countryCode ? ':' + (body.type || '') + ':' + (body.countryCode || '') : ''), w = who(), hit = cache.get(key);
    if (!(opt && opt.refresh) && hit && hit.who === w && Date.now() - hit.at < TTL) return hit.p;
    const p = api(route, body).then(r => { if (!r || r.ok !== true) cache.delete(key); return r || { ok: false, message: 'No answer' }; }, e => { cache.delete(key); return { ok: false, message: 'Could not reach the register' }; });
    cache.set(key, { at: Date.now(), who: w, p }); return p;
  }
  const clear = () => cache.clear();

  const css = `
.lk{font:14px/1.4 system-ui,Segoe UI,sans-serif;color:#2c3e50}
.lk h3{margin:0 0 4px;font-size:17px;color:#34495e}
.lk .lkview{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:10px;background:#e3eaf0;color:#566573;font-size:11.5px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;vertical-align:middle}
.lk .lknote{color:#7f8c8d;font-size:12.5px;margin:2px 0 8px}
.lk .lkbox{background:#fff;border:1px solid #d5dde5;border-radius:6px;overflow:hidden;margin-bottom:12px}
.lk .lkrow{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #eef2f5}
.lk .lkrow:last-child{border-bottom:0}
.lk .lkchip{min-width:46px;text-align:center;padding:2px 10px;border-radius:12px;font-weight:700;font-size:12.5px}
.lk .lkchip.on{background:#c7ebcf;color:#1e7b34}.lk .lkchip.off{background:#eef2f5;color:#7f8c8d}
.lk details{border-bottom:1px solid #eef2f5}.lk details:last-child{border-bottom:0}
.lk summary{cursor:pointer;padding:9px 12px;font-weight:600;display:flex;justify-content:space-between;gap:10px}
.lk summary small{color:#7f8c8d;font-weight:500}
.lk table{border-collapse:collapse;width:100%}.lk td,.lk th{padding:5px 12px;text-align:left;border-top:1px solid #eef2f5;font-size:13px}.lk th{background:#f4f7f9;color:#566573;font-size:12px}
.lk .lkcat{padding:3px 12px;font-size:13px}.lk .lkcat.dis{color:#95a5a6;text-decoration:line-through}
.lk .lklist{padding:6px 12px 10px;color:#34495e;font-size:13px;columns:3 180px;column-gap:18px}
.lk .lksw{cursor:pointer}.lk .lksw input{width:22px;height:22px}.lk .lkappr .f{max-width:260px}.lk .stbtns{display:flex;gap:10px;margin-top:12px}.lk .stbtns .pbtn small{display:block;font-weight:400;font-size:11px}
.lk h3{margin-top:14px}.lk .lkmsg{padding:10px 12px;color:#7f8c8d}.lk .lkerr{padding:10px 12px;color:#c0392b}`;
  const styled = () => { if (!document.getElementById('lkStyle')) { const s = document.createElement('style'); s.id = 'lkStyle'; s.textContent = css; document.head.appendChild(s); } };

  const SW = [['checkoutAutoPrint', 'Print the receipt automatically after a sale'], ['returnAutoPrint', 'Print the receipt automatically after a return'], ['autoOpenCashDrawer', 'Open the cash drawer automatically on a cash sale'],
    ['soundAlerts', 'Sound alerts'], ['cashCheckoutConfirm', 'Ask to confirm a cash checkout'], ['useVirtualKeyboard', 'On-screen keyboard'], ['enableShortcut', 'Keyboard shortcuts (AIR POS)']];
  const chip = on => '<span class="lkchip ' + (on ? 'on' : 'off') + '">' + (on ? 'On' : 'Off') + '</span>';

  async function gate(host, ctx) { // a manager login only; anything else gets one plain line and no AIR POS call
    let a = null; try { a = await load('access'); } catch (e) { a = null; }
    if (a && a.ok && a.canView) return true;
    host.innerHTML = '<div class="lk"><div class="lkmsg">Store settings are for a manager login. Ask a manager to open this.</div></div>'; return false;
  }

  async function renderTerminal(host, ctx) {
    styled(); host.innerHTML = '<div class="lk"><div class="lkmsg">Loading…</div></div>';
    if (!(await gate(host, ctx))) return;
    const r = await load('terminal', { refresh: true });
    if (!r.ok) { host.innerHTML = '<div class="lk"><h3>Terminal settings <span class="lkview">View only</span></h3><div class="lkbox"><div class="lkerr">' + E(r.message || 'Could not read the terminal settings.') + '</div></div></div>'; return; }
    if (r.empty) { host.innerHTML = '<div class="lk"><h3>Terminal settings <span class="lkview">View only</span></h3><div class="lkbox"><div class="lkmsg">AIR POS has no saved settings for this register yet.</div></div></div>'; return; }
    const s = r.settings;
    host.innerHTML = '<div class="lk" data-lk="terminal"><h3>Terminal settings <span class="lkview">View only</span></h3><div class="lknote">What AIR POS keeps for this register. ' + (r.registerStation ? '' : 'AIR POS shows no register id for this login, so this may be the store default. ') + 'Changing them is not available yet.</div>' +
      '<div class="lkbox">' + SW.map(([k, l]) => '<div class="lkrow" data-k="' + k + '"><span>' + E(l) + '</span>' + chip(s[k]) + '</div>').join('') +
      '<div class="lkrow" data-k="printerName"><span>Receipt printer</span><b>' + (s.printerName ? E(s.printerName) : '<span class="lkchip off">None set</span>') + '</b></div>' +
      '<div class="lkrow" data-k="shortcuts"><span>AIR POS shortcut list</span><b>' + (s.shortcuts ? E(s.shortcuts) : '<span class="lkchip off">None</span>') + '</b></div></div></div>';
  }

  const PT = { 10: 'Cash', 20: 'Card machine', 30: 'Typed card' };
  async function renderLists(host, ctx, opt) { // opt.only = ['tax','pay','sub','origin','cat','region'] to draw some of the six; opt.bare = no title (the Settings page draws its own); opt.open = lists start open
    opt = opt || {}; styled(); host.innerHTML = '<div class="lk"><div class="lkmsg">Loading…</div></div>';
    if (!(await gate(host, ctx))) return;
    const want = id => !opt.only || opt.only.includes(id), ask = (id, n) => (want(id) ? load(n) : Promise.resolve(null));
    const [tx, pt, sp, og, ct, rg] = await Promise.all([ask('tax', 'taxKinds'), ask('pay', 'paymentTypes'), ask('sub', 'subPaymentTypes'), ask('origin', 'origins'), ask('cat', 'categories'), ask('region', 'regions')]);
    const sec = (id, title, r, body) => !want(id) ? '' : '<details data-l="' + id + '"' + (opt.open ? ' open' : '') + '><summary><span>' + title + '</span><small>' + (r && r.ok ? (r.available === false ? 'not offered by AIR POS' : r.count + (r.count === 1 ? ' entry' : ' entries')) : 'could not load') + '</small></summary>' + (r && r.ok ? body : '<div class="lkerr">' + E(r && r.message || 'Could not load.') + '</div>') + '</details>';
    const taxT = r => r.count ? '<table><tr><th>Name</th><th>Rate</th><th>Tax free</th></tr>' + r.rows.map(k => '<tr><td>' + E(k.name) + '</td><td>' + (k.taxFree ? '—' : E(k.rate) + '%') + '</td><td>' + (k.taxFree ? 'Yes' : 'No') + '</td></tr>').join('') + '</table>' : '<div class="lkmsg">None set up.</div>';
    const ptT = r => r.available === false ? '<div class="lkmsg">This AIR POS server does not provide a payment-type list; AirMax uses its own Cash / Card / Gift card names.</div>' : r.count ? '<div class="lklist">' + r.rows.map(x => E(x.name)).join('<br>') + '</div>' : '<div class="lkmsg">None.</div>';
    const spT = r => r.count ? '<table><tr><th>Payment type</th><th>Sub-types</th></tr>' + Object.entries(r.byType).map(([k, v]) => '<tr><td>' + E(PT[k] || 'Type ' + k) + '</td><td>' + (v.length ? v.map(x => E(x.name)).join(', ') : '<span style="color:#95a5a6">none</span>') + '</td></tr>').join('') + '</table>' : '<div class="lkmsg">This store has no payment sub-types.</div>';
    const ogT = r => r.count ? '<div class="lklist">' + r.rows.map(x => E(x.name)).join('<br>') + '</div>' : '<div class="lkmsg">None.</div>';
    const ctT = r => r.count ? r.flat.map(c => '<div class="lkcat' + (c.disable ? ' dis' : '') + '" style="padding-left:' + (12 + c.depth * 18) + 'px">' + (c.depth ? '└ ' : '') + E(c.label) + '</div>').join('') : '<div class="lkmsg">None.</div>';
    const rgT = r => r.count ? '<div class="lklist">' + r.rows.map(x => E(x.name) + ' <small style="color:#7f8c8d">' + E(x.code) + '</small>').join('<br>') + '</div>' : '<div class="lkmsg">None.</div>';
    host.innerHTML = '<div class="lk" data-lk="lists">' + (opt.bare ? '' : '<h3>Lists <span class="lkview">View only</span></h3><div class="lknote">The lists AIR POS keeps for this store. Open one to look; nothing here can be changed.</div>') + '<div class="lkbox">' +
      sec('tax', 'Tax kinds', tx, tx && tx.ok ? taxT(tx) : '') + sec('pay', 'Payment types', pt, pt && pt.ok ? ptT(pt) : '') + sec('sub', 'Payment sub-types', sp, sp && sp.ok ? spT(sp) : '') +
      sec('origin', 'Product origins', og, og && og.ok ? ogT(og) : '') + sec('cat', 'Categories', ct, ct && ct.ok ? ctT(ct) : '') + sec('region', 'States', rg, rg && rg.ok ? rgT(rg) : '') + '</div></div>';
  }


  // ---------- Settings page sections (drawn into the Settings page by settings.js) ----------
  const human = k => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).replace(/ Id\b/, ' ID');
  const val = v => (typeof v === 'boolean' ? chip(v) : '<b>' + E(v) + '</b>');
  const MSG = t => '<div class="lk"><div class="lkmsg">' + E(t) + '</div></div>';
  const isMgr = () => { try { return !!(S && S.user && S.user.manager); } catch (e) { return false; } };

  // Terminal switches: call 11 reads, call 12 saves. A manager login saves directly; anyone else types a manager's user name and password (checked by AIR POS) beside the Save button.
  async function renderTerminalEdit(host, ctx) {
    styled(); host.innerHTML = MSG('Loading…');
    const r = await load('terminal', { refresh: true });
    if (!r.ok) { host.innerHTML = '<div class="lk"><div class="lkerr">' + E(r.message || 'Could not read the terminal settings.') + '</div></div>'; return; }
    if (r.empty || !r.config || !r.config.id) { host.innerHTML = MSG('AIR POS has no saved settings for this register yet, so they cannot be changed here.'); return; }
    const mgr = isMgr(), s = r.settings, KEYS = SW.filter(([k]) => k !== 'enableShortcut');
    host.innerHTML = '<div class="lk" data-lk="terminal-edit"><div class="lknote">What AIR POS keeps for this register. Save sends the switches to AIR POS. ' + (mgr ? '' : 'A manager types their user name and password to approve a change.') + '</div>' +
      '<div class="lkbox">' + KEYS.map(([k, l]) => '<label class="lkrow lksw" data-k="' + k + '"><span>' + E(l) + '</span><input type="checkbox" data-sw="' + k + '" ' + (s[k] ? 'checked' : '') + '></label>').join('') +
      '<div class="lkrow" data-k="printerName"><span>Receipt printer <small style="color:#7f8c8d">(AIR POS keeps this name; AirMax\'s own printer is chosen in Printer &amp; Drawer)</small></span><b>' + (s.printerName ? E(s.printerName) : '<span class="lkchip off">None set</span>') + '</b></div></div>' +
      '<div class="lkbox lkappr" id="lkAppr" hidden><div class="lkrow"><span>Manager user name</span><input class="f" id="lkMu" autocomplete="off" data-kb="text"></div><div class="lkrow"><span>Manager password</span><input class="f" id="lkMp" type="password" autocomplete="new-password" data-kb="text"></div></div>' +
      '<div id="lkMsg" class="msg"></div><div class="stbtns"><button class="pbtn g" id="lkSave" disabled><b>Save</b><small>to AIR POS</small></button><button class="pbtn s" id="lkReload"><b>Reload from AIR POS</b><small>read again</small></button></div></div>';
    const q = id => host.querySelector('#' + id), boxes = [...host.querySelectorAll('[data-sw]')];
    const changes = () => Object.fromEntries(boxes.filter(b => b.checked !== !!s[b.dataset.sw]).map(b => [b.dataset.sw, b.checked]));
    const sync = () => { const n = Object.keys(changes()).length; q('lkSave').disabled = !n; q('lkAppr').hidden = mgr || !n; };
    boxes.forEach(b => { b.onchange = sync; });
    q('lkReload').onclick = () => renderTerminalEdit(host, ctx);
    const save = async () => {
      const ch = changes(); if (!Object.keys(ch).length) return;
      const body = { ...ch }; if (!mgr) { body.user = q('lkMu').value.trim(); body.password = q('lkMp').value; q('lkMp').value = ''; }
      q('lkSave').disabled = true; if (typeof msgIn === 'function') msgIn(q('lkMsg'), { ok: true, message: 'Saving…' });
      const x = await api('terminal-config-save', body); clear();
      if (x && x.ok && !x.unchanged) { try { if (typeof refresh === 'function') await refresh(); } catch (e) { /* the page keeps what it shows */ } }
      if (x && x.ok) { await renderTerminalEdit(host, ctx); const m = host.querySelector('#lkMsg'); if (typeof msgIn === 'function' && m) msgIn(m, { ok: true, message: x.message || 'Saved to AIR POS.' }); return; }
      if (typeof msgIn === 'function') msgIn(q('lkMsg'), { ok: false, message: (x && x.message) || 'Could not save.' }); sync();
    };
    q('lkSave').onclick = save;
    host.querySelectorAll('#lkMu,#lkMp').forEach(i => { i.onkeydown = e => { if (e.key === 'Enter') save(); }; });
  }

  // Account: what AIR POS holds for the company and store (read only; a register login cannot change it, see app/api/lookups.js)
  async function renderAccount(host, ctx) {
    styled(); host.innerHTML = MSG('Loading…');
    const r = await load('store', { refresh: true });
    if (!r.ok) { host.innerHTML = r.denied ? MSG(r.message) : '<div class="lk"><div class="lkerr">' + E(r.message || 'Could not read the store settings.') + '</div></div>'; return; }
    const b = r.business || {}, u = (typeof S !== 'undefined' && S.user) || {};
    host.innerHTML = '<div class="lk" data-lk="account"><div class="lknote">' + E(r.why) + '</div>' +
      '<div class="lkbox"><div class="lkrow"><span>Business name</span><b>' + E(b.name || u.company || '') + '</b></div>' + (b.address ? '<div class="lkrow"><span>Address on receipts</span><b>' + E(b.address) + '</b></div>' : '') +
      (b.closingLine ? '<div class="lkrow"><span>Closing line on receipts</span><b>' + E(b.closingLine) + '</b></div>' : '') + '<div class="lkrow"><span>Shop</span><b>' + E(u.shop || '') + '</b></div><div class="lkrow"><span>Signed in as</span><b>' + E(u.user || u.userName || '') + '</b></div></div>' +
      r.groups.map(g => '<h3>' + E(g.title) + '</h3><div class="lkbox" data-g="' + E(g.id) + '">' + g.rows.map(x => '<div class="lkrow" data-k="' + E(x.key) + '"><span>' + E(human(x.key)) + '</span>' + val(x.value) + '</div>').join('') + '</div>').join('') + '</div>';
  }

  // Roles & permissions: what this login may do (read only)
  async function renderAccess(host, ctx) {
    styled(); host.innerHTML = MSG('Loading…');
    let p = null; try { p = await api('perms', {}); } catch (e) { p = null; }
    if (!p || !p.ok) { host.innerHTML = '<div class="lk"><div class="lkerr">Could not read this login\'s permissions.</div></div>'; return; }
    const via = p.superAdmin ? 'Super admin' : p.manager ? 'Manager (RetailManager)' : 'Cashier';
    const row = (l, v) => '<div class="lkrow"><span>' + E(l) + '</span>' + v + '</div>';
    host.innerHTML = '<div class="lk" data-lk="access"><div class="lknote">What AIR POS lets this login do. AIR POS has the last word on every change.</div><div class="lkbox">' +
      row('This login is', '<b>' + E(via) + '</b>') + row('Change terminal switches', p.manager ? chip(true) : '<b>Needs a manager password</b>') + row('See store and account settings', chip(!!p.manager)) +
      row('Change store and account settings', '<b>In the AIR POS back office only</b>') + row('AIR POS authority codes', '<b>' + (p.authorities && p.authorities.length ? E(p.authorities.join(', ')) : 'none') + '</b>') + '</div>' +
      ((p.menus || []).length ? '<h3>AIR POS menus open to this login</h3><div class="lkbox"><div class="lklist">' + p.menus.map(m => E(m.name)).join('<br>') + '</div></div>' : '') + '</div>';
  }

  window.AirMaxLookups = { load, clear, renderTerminal, renderLists, renderTerminalEdit, renderAccount, renderAccess, names: Object.keys(ROUTE) };
  if (window.AirMaxMounts) {
    window.AirMaxMounts.add('settings.store.terminal', { id: 'batch1-terminal', render: (host, ctx) => { renderTerminal(host, ctx); } });
    window.AirMaxMounts.add('settings.store.lists', { id: 'batch1-lists', render: (host, ctx) => { renderLists(host, ctx); } });
  }
})();

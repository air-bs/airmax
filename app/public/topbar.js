// AirMax top bar + section loader (Step 0). Loaded last, after app.js and the other screen files.
// The bar has 8 tabs. Checkout is the register exactly as it was. The other 7 show "coming soon" until a file in
// app/public/sections/ registers a screen for them:  AirMaxSections.register({ id, render(host, ctx), ... })  (see BATCH-INTERFACE.md).
(function () {
  'use strict';
  const IC = {
    checkout: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7H6"/>',
    orders: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    items: '<path d="M21 8l-9-5-9 5 9 5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    customers: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5a3 3 0 0 1 0 6M18 14c2 .6 3.5 2.6 3.5 5"/>',
    giftcards: '<rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M12 8v13M3 13h18M12 8c-2.5 0-4.5-1-4.5-2.8S9.5 2 12 5c2.5-3 4.5-1.8 4.5.2S14.5 8 12 8z"/>',
    reports: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    users: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    backoffice: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18"/>',
    settings: '<path d="M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0"/><circle cx="15" cy="6" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="17" cy="18" r="2.2"/>',
  };
  // the fixed list: order, names and keys. A section file can fill a tab but cannot add, rename or reorder tabs.
  const TABS = [
    { id: 'checkout', title: 'Checkout', key: '' },
    { id: 'orders', title: 'Orders', key: '' },
    { id: 'items', title: 'Items', key: '' },
    { id: 'customers', title: 'Customers', key: '' },
    { id: 'giftcards', title: 'Gift Cards', key: '' },
    { id: 'reports', title: 'Reports', key: '' },
    { id: 'users', title: 'Users', key: '' },
    { id: 'settings', title: 'Settings', key: 'Ctrl+,', legacy: true },
    // Back Office (design page 09): a 9th tab for managers (a cashier does not see it); "coming soon" until a section file registers it
    { id: 'backoffice', title: 'Back Office', key: '', optional: true },
  ];
  const byId = Object.fromEntries(TABS.map(t => [t.id, t]));
  const defs = {};          // id -> registered section
  const allowedNow = {};    // id -> true/false once the section's own permission check has answered
  let current = 'checkout', cleanup = null, loginKey = null, shown = 0;
  const g = (typeof window !== 'undefined') ? window : {};

  const ctxFor = host => ({
    host, tabs: TABS.map(t => t.id),
    api: (name, body, opt) => api(name, body, opt),   // POST /api/<name> (same wrapper the register uses)
    perms: async () => { // { ok, manager, superAdmin, authorities[], menus[{name,path}], hasMenu(nameOrPath) } from AIR POS (reg.home.menus); a super admin passes every hasMenu
      const r = await api('perms'), p = r && r.ok ? r : { ok: false, manager: false, superAdmin: false, authorities: [], menus: [] };
      p.menus = p.menus || []; p.hasMenu = w => { w = String(w).toLowerCase(); return !!p.superAdmin || p.menus.some(x => String(x.name).toLowerCase() === w || String(x.path).toLowerCase() === w); }; return p; },
    mount: (name, el, extra) => g.AirMaxMounts ? g.AirMaxMounts.fill(el, name, extra) : false, // fill a named slot that this screen drew (see mounts.js)
    state: () => S, toast: (m, ok) => toast(m, ok), esc: s => esc(s), money: n => money(n), refresh: () => refresh(), show: id => show(id),
  });

  function register(def) {
    if (!def || typeof def !== 'object' || !byId[def.id] || def.id === 'checkout') { console.warn('AirMaxSections.register: bad id', def && def.id); return false; }
    defs[def.id] = def; if (!def.allowed) allowedNow[def.id] = true;
    if (built) { paint(); if (def.allowed) check(def.id); }
    return true;
  }

  async function check(id) { // the section's own AIR POS permission check; false removes the tab (and leaves it if it is open)
    const d = defs[id]; if (!d || !d.allowed) return true;
    let ok = false;
    try { ok = !!(await Promise.race([Promise.resolve(d.allowed(ctxFor(null))), new Promise(r => setTimeout(() => r(false), 8000))])); } catch (e) { ok = false; }
    allowedNow[id] = ok; paint();
    if (!ok && current === id) show('checkout');
    return ok;
  }

  const tabState = id => { // { hidden, disabled(reason) , badge }
    const d = defs[id] || {}; let hidden = false, dis = '', badge = '';
    if (byId[id].optional && !defs[id] && !(S.user && S.user.manager)) hidden = true; // Back Office: managers see it (coming soon until a section fills it)
    try {
      if (allowedNow[id] === false || (d.allowed && allowedNow[id] === undefined)) hidden = true;
      if (!hidden && typeof d.visible === 'function' && d.visible(S) === false) hidden = true;
      if (!hidden && typeof d.disabled === 'function') { const x = d.disabled(S); if (x) dis = typeof x === 'string' ? x : 'Not available right now'; }
      if (typeof d.badge === 'function') { const b = d.badge(S); if (b) badge = String(b); }
    } catch (e) { /* a broken section never breaks the bar */ }
    if (id === 'checkout') { const n = ((S.cart || []).length) + (S.mix && S.mix.lines ? S.mix.lines.length : 0); if (current !== 'checkout' && n) badge = String(n); }
    return { hidden, dis, badge };
  };

  // the Orders page that orders.js already draws (a window over the sale; view and search only). Kept as it is: the Orders tab opens it until a section file registers its own 'orders' screen.
  const obOpen = () => !!document.getElementById('obPage'), legacyOrders = () => !defs.orders && typeof A !== 'undefined' && typeof A['orders-tab'] === 'function';
  let built = false;
  function build() {
    const box = document.getElementById('tabs'); if (!box) return;
    box.innerHTML = TABS.filter(t => !t.legacy && !t.optional).map(t => '<button type="button" class="tab" data-tab="' + t.id + '" title="' + t.title + (t.key ? ' (' + t.key + ')' : '') + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + IC[t.id] + '</svg><span class="tl">' + t.title + '</span><span class="tk">' + t.key + '</span></button>').join('');
    const end = document.getElementById('tabsEnd'); if (end) { end.innerHTML = TABS.filter(t => t.optional).map(t => '<button type="button" class="tab" data-tab="' + t.id + '" title="' + t.title + '" hidden><svg viewBox="0 0 24 24" aria-hidden="true">' + IC[t.id] + '</svg><span class="tl">' + t.title + '</span></button>').join(''); end.onclick = e => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); }; }
    box.onclick = e => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); };
    // Settings is the existing button (same id, text, key and window). If a section file registers a Settings screen it opens that; otherwise nothing changes.
    document.getElementById('tabbar').addEventListener('click', e => {
      const b = e.target.closest('#setTop'); if (!b || !defs.settings || typeof defs.settings.render !== 'function') return;
      e.stopPropagation(); e.preventDefault(); show('settings');
    }, true);
    built = true; paint();
    const mr = document.getElementById('modalRoot'); if (mr) new MutationObserver(() => paint()).observe(mr, { childList: true }); // the Orders page opening / closing moves the highlight
  }

  // top-left: the logged-in company, its shop and (when one is set in Settings) the register logo, in place of the old "AIR pos" mark
  function paintBrand() {
    const n = document.getElementById('brandName'), sh = document.getElementById('brandShop'), lg = document.getElementById('brandLogo'); if (!n) return;
    if (lg.dataset.ph === undefined) lg.dataset.ph = lg.innerHTML;
    const u = S.loggedIn && S.user ? S.user : null, co = u && u.company ? String(u.company) : '', shop = u && u.shop ? String(u.shop) : '';
    n.textContent = co || 'Air Max'; sh.textContent = shop ? shop + ' \u00b7 ' : '';
    const pic = S.screenPics && S.screenPics.saleLogo, src = pic && /^\/screen-picture\/salelogo\?v=[0-9a-f]+$/.test(pic.src) ? pic.src : '';
    if (src) { if (lg.dataset.src !== src) { lg.dataset.src = src; lg.classList.add('has'); lg.innerHTML = ''; const im = document.createElement('img'); im.alt = ''; im.src = src; im.onerror = () => { lg.classList.remove('has'); delete lg.dataset.src; lg.innerHTML = lg.dataset.ph || ''; }; lg.appendChild(im); } }
    else if (lg.dataset.src) { delete lg.dataset.src; lg.classList.remove('has'); lg.innerHTML = lg.dataset.ph || ''; }
  }

  function paint() {
    if (!built) return;
    document.querySelectorAll('#tabbar .tab').forEach(b => {
      const id = b.dataset.tab, st = tabState(id), t = byId[id];
      const on = obOpen() ? id === 'orders' : id === current; b.hidden = st.hidden; b.classList.toggle('on', on);
      b.setAttribute('aria-disabled', st.dis ? 'true' : 'false'); b.setAttribute('aria-current', on ? 'page' : 'false');
      b.title = st.dis ? t.title + ': ' + st.dis : t.title + (t.key ? ' (' + t.key + ')' : '');
      let bd = b.querySelector('.bd'); if (st.badge) { if (!bd) { bd = document.createElement('span'); bd.className = 'bd'; b.appendChild(bd); } bd.textContent = st.badge; } else if (bd) bd.remove();
    });
    const s = document.getElementById('setTop'); if (s) s.classList.toggle('on', current === 'settings');
    paintBrand();
    document.getElementById('app').classList.toggle('sec', current !== 'checkout');
  }

  function leave() { try { if (typeof cleanup === 'function') cleanup(); const d = defs[current]; if (d && typeof d.onHide === 'function') d.onHide(); } catch (e) { console.warn('section hide failed', e); } cleanup = null; }

  async function show(id) {
    if (!byId[id]) return false;
    if (!S.loggedIn || S.mode === 'clockin') return false;
    if (obOpen() && !(id === 'orders' && legacyOrders())) { if (typeof closeModal === 'function') closeModal(); if (id === 'checkout' && current === 'checkout') { paint(); focusScan(); return true; } } // leave the existing Orders page first
    if (id === 'orders' && legacyOrders()) { if (current !== 'checkout') { leave(); current = 'checkout'; const h = document.getElementById('sectionHost'); h.hidden = true; h.innerHTML = ''; paint(); } if (!modalOpen() || obOpen()) A['orders-tab'](); else toast('Close the open window first, then change screen.', false); return true; }
    if (id === current && id === 'checkout') { focusScan(); return true; }
    if (modalOpen() && id !== current) { toast('Close the open window first, then change screen.', false); return false; }
    const st = tabState(id);
    if (id !== 'checkout' && (st.hidden || st.dis)) { if (st.dis) toast(byId[id].title + ': ' + st.dis, false); return false; }
    const host = document.getElementById('sectionHost');
    if (id !== 'checkout' && defs[id] && defs[id].allowed && !(await check(id))) { toast('This login may not open ' + byId[id].title + '.', false); return false; } // asked again every time the tab opens
    if (id !== 'checkout' && modalOpen()) return false; // a window opened while the permission check was running
    leave(); current = id; shown++;
    if (id === 'checkout') { host.hidden = true; host.innerHTML = ''; paint(); focusScan(); return true; }
    host.hidden = false; host.innerHTML = ''; host.dataset.section = id; paint();
    const d = defs[id];
    if (d && typeof d.render === 'function') {
      try { const r = d.render(host, ctxFor(host)); if (typeof r === 'function') cleanup = r; else if (r && typeof r.then === 'function') r.then(f => { if (typeof f === 'function') cleanup = f; reportsSlot(id, host); }).catch(e => failed(host, e)); if (!(r && typeof r.then === 'function')) reportsSlot(id, host); }
      catch (e) { failed(host, e); }
    } else host.innerHTML = '<div class="soon"><svg viewBox="0 0 24 24" aria-hidden="true">' + IC[id] + '</svg><h2>' + byId[id].title + '</h2><p>Coming soon.</p></div>';
    return true;
  }
  // Reports screens: if the Reports section did not draw its own `reports.fixes` slot, one empty slot is added at the end so batch 8's fix buttons have a place
  function reportsSlot(id, host) {
    if (id !== 'reports' || !g.AirMaxMounts || host.dataset.section !== 'reports' || host.querySelector('[data-mount="reports.fixes"]')) return;
    const el = document.createElement('div'); el.className = 'mountrow'; host.appendChild(el); g.AirMaxMounts.fill(el, 'reports.fixes', { auto: true });
  }
  function failed(host, e) { console.warn('section failed', e); host.innerHTML = '<div class="soon"><h2>' + byId[current].title + '</h2><p>This screen could not open. Go back to Checkout and try again.</p></div>'; }

  // Esc / Ctrl+Shift+O ("back to the sale screen") also leaves a section; every other key does what it did
  const A0 = typeof A !== 'undefined' ? A : null;
  if (A0 && A0.close) { const c0 = A0.close; A0.close = () => { if (current !== 'checkout' && !modalOpen()) { show('checkout'); return; } return c0(); }; }

  // follow the register: badge on Checkout, tabs of a logged-out / clocked-out screen, permission checks at login
  const prev = window.afterRefresh;
  window.afterRefresh = () => {
    if (prev) prev();
    if (!S.loggedIn || S.mode === 'clockin') { if (current !== 'checkout') { leave(); current = 'checkout'; const h = document.getElementById('sectionHost'); h.hidden = true; h.innerHTML = ''; } Object.keys(defs).forEach(k => { if (defs[k].allowed) delete allowedNow[k]; }); loginKey = null; }
    else { const k = String(S.user && S.user.user || 'in'); if (k !== loginKey) { loginKey = k; Object.keys(defs).forEach(id => { if (defs[id].allowed) { delete allowedNow[id]; check(id); } }); } }
    paint();
  };

  g.AirMaxSections = { register, show, tabs: TABS.map(t => ({ id: t.id, title: t.title, key: t.key })), current: () => current, _defs: defs };

  async function boot() {
    build();
    let files = [];
    try { files = ((await (await fetch('/api/sections')).json()).files) || []; } catch (e) { files = []; }
    for (const f of files) { // one at a time, in name order; a broken file is skipped
      await new Promise(res => { const sc = document.createElement('script'); sc.src = '/sections/' + encodeURIComponent(f); sc.onload = sc.onerror = res; document.head.appendChild(sc); });
    }
    g.AirMaxSectionsLoaded = files.slice(); paint();
    if (S.loggedIn) window.afterRefresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

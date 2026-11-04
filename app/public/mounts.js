// AirMax named mount slots (Step 0). A batch fills a slot from its own file in app/public/sections/ without editing a shared file:
//   AirMaxMounts.add('checkout.login', { id: 'finger-login', render(host, ctx) { ... return cleanupFn; } });
// The OWNER of a place draws an empty element there and calls fill(); any other batch adds content under the slot's name, before or after.
// Slot names (full table with who draws each one: BATCH-INTERFACE.md):
//   checkout.login                the sign-in screen (#login), under the form                      (drawn in Step 0)
//   checkout.lock                 the clock-in screen of a logged-in, not clocked-in register     (drawn in Step 0)
//   checkout.manager-approval     inside every manager approval pop-up: ctx.title, ctx.text, ctx.submit(body), ctx.close()  (Step 0)
//   checkout.tx-actions           extra buttons under Transaction Actions: add(name, { id, label, key, action, style, visible(S) })  (Step 0)
//   reports.shifts.row-actions    one slot per row of Reports > Shifts: ctx.row is the row                (the Reports batch draws it)
//   reports.zreads.row-actions    one slot per row of Reports > Z-reads: ctx.row                          (the Reports batch draws it)
//   reports.fixes                 a general row of fix buttons on the Reports screens                    (the Reports batch, or the bar appends one)
//   customers.account-box         inside Customers > customer panel > Account box: ctx.customer           (the Customers batch draws it)
// Any other name of the form `tab.place` or `tab.screen.place` (lower case, digits, - and .) also works: add() creates it, fill() uses it.
// render(host, ctx) gets an empty host; it may return a cleanup function (called when the host is cleared or filled again). An empty slot takes no room.
// A render that throws shows nothing and never breaks the screen. Slot owners: AirMaxMounts.fill(el, name, extra) (extra is merged into ctx); sections use ctx.mount(name, el, extra).
(function () {
  'use strict';
  const NAMES = ['checkout.login', 'checkout.lock', 'checkout.manager-approval', 'checkout.tx-actions', 'reports.shifts.row-actions', 'reports.zreads.row-actions', 'reports.fixes', 'customers.account-box'];
  const OK = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,3}$/;
  const defs = Object.fromEntries(NAMES.map(n => [n, []]));   // name -> [def]
  const hosts = new Set();                                    // live { el, name, extra, cleanups[] }
  const TX = 'checkout.tx-actions';
  const g = typeof window !== 'undefined' ? window : {};

  const baseCtx = (host, name, extra) => ({
    host, name, where: name,
    api: (n, body, opt) => api(n, body, opt), state: () => S, toast: (m, ok) => toast(m, ok), esc: s => esc(s), money: n => money(n), refresh: () => refresh(),
    // { ok, manager, superAdmin, authorities[], menus[{name,path}], hasMenu(nameOrPath) }: AIR POS menu entries (reg.home.menus) and the manager flag for this login
    perms: async () => {
      const r = await api('perms'), p = r && r.ok ? r : { ok: false, manager: false, superAdmin: false, authorities: [], menus: [] };
      p.menus = p.menus || []; p.hasMenu = w => { w = String(w).toLowerCase(); return !!p.superAdmin || p.menus.some(x => String(x.name).toLowerCase() === w || String(x.path).toLowerCase() === w); }; return p;
    },
    ...(extra || {}),
  });

  const clean = h => { (h.cleanups || []).forEach(f => { try { f(); } catch (e) { /* ignore */ } }); h.cleanups = []; };

  function paintOne(h, only) {
    const list = defs[h.name] || [];
    if (!only) { clean(h); h.el.innerHTML = ''; }
    list.forEach(d => {
      if (only && d !== only) return;
      try {
        if (h.name === TX) { if (typeof d.visible === 'function' && !d.visible(S)) return; h.el.appendChild(txButton(d)); return; }
        if (typeof d.render !== 'function') return;
        const box = document.createElement('div'); box.className = 'mountbox'; box.dataset.mountId = d.id || ''; h.el.appendChild(box);
        const r = d.render(box, baseCtx(box, h.name, h.extra));
        const keep = f => { if (typeof f === 'function') h.cleanups.push(f); };
        if (r && typeof r.then === 'function') r.then(keep).catch(e => { console.warn('mount ' + h.name + ' failed', e); box.remove(); }); else keep(r);
      } catch (e) { console.warn('mount ' + h.name + ' failed', e); }
    });
    h.el.classList.toggle('mount-empty', !h.el.firstChild);
  }

  // one extra Transaction Actions button: same look as the built-in ones (class rbtn), click runs the register action A[action]
  function txButton(d) {
    const b = document.createElement('button'); b.className = 'rbtn ' + (d.style || ''); b.type = 'button'; b.dataset.a = d.action || ''; b.dataset.mountId = d.id || '';
    b.appendChild(document.createTextNode(String(d.label || '')));
    if (d.key) { const s = document.createElement('small'); s.textContent = String(d.key); b.appendChild(s); }
    b.onclick = () => { if (g.run) g.run(d.action); };
    return b;
  }

  // put a mount into an element (the element must have been created by the screen that owns the place)
  function fill(el, name, extra) {
    if (!el || !OK.test(String(name))) return false; defs[name] = defs[name] || [];
    for (const h of [...hosts]) { h.seen = h.seen || h.el.isConnected; if (h.el === el || (h.seen && !h.el.isConnected)) { clean(h); hosts.delete(h); } } // forget slots whose screen is gone
    const h = { el, name, extra, cleanups: [], seen: el.isConnected }; el.dataset.mount = name; el.classList.add('mount'); hosts.add(h); paintOne(h); return true;
  }

  function add(name, def) {
    if (!OK.test(String(name)) || !def || typeof def !== 'object') { console.warn('AirMaxMounts.add: bad mount', name); return false; }
    defs[name] = defs[name] || [];
    if (def.id && defs[name].some(d => d.id === def.id)) { console.warn('AirMaxMounts.add: ' + name + ' already has ' + def.id); return false; }
    defs[name].push(def);
    for (const h of hosts) { h.seen = h.seen || h.el.isConnected; if (h.name === name && (h.el.isConnected || !h.seen)) paintOne(h, h.name === TX ? null : def); }
    return true;
  }

  g.AirMaxMounts = { NAMES, add, fill, ctx: baseCtx, clear: el => { for (const h of [...hosts]) if (h.el === el) { clean(h); hosts.delete(h); el.innerHTML = ''; } } };
})();

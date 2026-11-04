// AirMax API batch 1 (calls 11, 12, 14-19): the lookup lists every later screen needs + this terminal's settings (read, and the one save: call 12).
//   14 /Commons/RetailTaxKindSelect            -> lookup-tax-kinds
//   15 /Commons/RetailOrderPaymentTypeSelect   -> lookup-payment-types      (TestShop and a live store answer HTTP 404: the route is not on the server; answered as available:false)
//   16 /Commons/RetailOrderSubPaymentTypeSelect-> lookup-sub-payment-types  ({ "10": [], "20": [], "30": [] }, keyed by payment type)
//   17 /Commons/ProductOriginSelect            -> lookup-origins
//   18 /Categories/CategorySelectAsTreeNode    -> lookup-categories         (tree + a flat list for pick-lists)
//   19 /Regions/RegionSelect (baseserv)        -> lookup-regions            (type 2 = state, countryCode US by default)
//   11 /Commons/RetailTerminalConfigGet        -> terminal-config-get
//   lookups-all                                -> 14 + 15 + 16 + 17 + 18 + 19 in one call (for Items / Customers forms)
//   settings-access                            -> who may see the Store & Account part of Settings (same rule as the old Settings "manager only" items)
//   12 /Commons/RetailTerminalConfigSave       -> terminal-config-save  (the ONLY write here; Security; Gordon OK'd Batch 1 on Nov 3. See below.)
//   /Commons/RetailConfigGet (company + store rules) -> store-settings-get  (manager only, read only; whitelisted yes/no switches and numbers, no keys, no secrets)
// Every reply is "bare" on the real server (an array / object with no success wrapper); a failure is { success:false, message }. Both are handled.
// Call 12 sends exactly what AIR POS's own Settings screen sends: { id, checkoutAutoPrint, returnAutoPrint, autoOpenCashDrawer, soundAlerts, useVirtualKeyboard, cashCheckoutConfirm, printerName }.
// The printer name is sent back as AIR POS holds it (AirMax's own printer choice lives in its Printer & Drawer tab and is never changed here). A manager login saves directly;
// anyone else needs a manager's user name and password in the same request (checked with AIR POS, like Tax Off and Price Change). Company and store settings
// (RetailConfigs/RetailConfigSave) are NOT writable from a register login (AIR POS asks the back office for its own sign-in + captcha), so there is no save for them.
// Nothing is logged by this file, and nothing from a reply is kept on disk. AIR POS is called only through reg.api.retail() / reg.api.call(); app/lib is untouched.
'use strict';

module.exports = ctx => {
  const { reg } = ctx;
  const txt = (v, n = 120) => (v == null ? '' : String(v)).slice(0, n);
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // AIR POS reply -> { ok, value, message, loggedOut, missing }
  const unwrap = r => {
    if (r && r.loggedOut) return { ok: false, loggedOut: true, message: 'Signed out. Log in again.' };
    if (r && r.success === false) {
      const missing = /HTTP 404/.test(String(r.message || ''));
      return { ok: false, missing, message: missing ? 'AIR POS does not offer this list on this server.' : txt(r.message || 'AIR POS did not answer', 160), unreachable: !!r.unreachable };
    }
    if (r && typeof r === 'object' && !Array.isArray(r) && 'success' in r && 'value' in r) return { ok: true, value: r.value };
    return { ok: true, value: r };
  };
  const fail = u => ({ ok: false, message: u.message, ...(u.loggedOut ? { loggedOut: true } : {}), ...(u.unreachable ? { unreachable: true } : {}) });

  const taxKinds = async () => {
    const u = unwrap(await reg.api.retail('/Commons/RetailTaxKindSelect', {})); if (!u.ok) return fail(u);
    const rows = (Array.isArray(u.value) ? u.value : []).map(k => ({ id: txt(k.id, 64), name: txt(k.name), rate: num(k.rate), amount: num(k.amount), taxFree: !!k.taxFree, description: txt(k.description, 200), sort: num(k.sort) }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    return { ok: true, rows, count: rows.length };
  };
  const paymentTypes = async () => {
    const u = unwrap(await reg.api.retail('/Commons/RetailOrderPaymentTypeSelect', {}));
    if (u.missing) return { ok: true, available: false, rows: [], count: 0, message: u.message }; // 404 on TestShop and a live store: AIR POS defines the call but its server has no such route
    if (!u.ok) return fail(u);
    const rows = (Array.isArray(u.value) ? u.value : []).map(p => ({ key: txt(p.key != null ? p.key : p.value != null ? p.value : p.id, 64), name: txt(p.name || p.label || p.text) }));
    return { ok: true, available: true, rows, count: rows.length };
  };
  const subPaymentTypes = async () => {
    const u = unwrap(await reg.api.retail('/Commons/RetailOrderSubPaymentTypeSelect', {})); if (!u.ok) return fail(u);
    const by = {}; let count = 0;
    if (u.value && typeof u.value === 'object' && !Array.isArray(u.value)) for (const [k, v] of Object.entries(u.value)) {
      if (!/^\d{1,4}$/.test(k)) continue;
      by[k] = (Array.isArray(v) ? v : []).map(x => (typeof x === 'object' && x ? { key: txt(x.key != null ? x.key : x.id, 64), name: txt(x.name || x.label || x.text || x.value) } : { key: txt(x, 64), name: txt(x) })); count += by[k].length;
    }
    return { ok: true, byType: by, count };
  };
  const origins = async () => {
    const u = unwrap(await reg.api.retail('/Commons/ProductOriginSelect', {})); if (!u.ok) return fail(u);
    const rows = (Array.isArray(u.value) ? u.value : []).map(o => ({ key: txt(o.key, 64), name: txt(o.name), code: txt(o.code, 16) }));
    return { ok: true, rows, count: rows.length };
  };
  const cleanNode = (n, d = 0) => ({ id: txt(n.id, 64), parentId: n.parentId ? txt(n.parentId, 64) : null, value: txt(n.value, 64), label: txt(n.label), disable: !!n.disable, sort: num(n.sort), childs: d < 8 && Array.isArray(n.childs) ? n.childs.map(c => cleanNode(c, d + 1)) : [] });
  const categories = async () => {
    const u = unwrap(await reg.api.retail('/Categories/CategorySelectAsTreeNode', {})); if (!u.ok) return fail(u);
    const tree = (Array.isArray(u.value) ? u.value : []).map(n => cleanNode(n)), flat = [];
    const walk = (list, depth, trail) => list.forEach(n => { const path = trail ? trail + ' > ' + n.label : n.label; flat.push({ id: n.id, parentId: n.parentId, value: n.value, label: n.label, path, depth, disable: n.disable, hasChildren: n.childs.length > 0 }); walk(n.childs, depth + 1, path); });
    walk(tree, 0, '');
    return { ok: true, tree, flat, count: flat.length, top: tree.length };
  };
  // baseserv, form body (the same way AIR POS sends it; a JSON body answers an empty list on TestShop)
  const regions = async body => {
    const type = [1, 2, 3].includes(Number(body && body.type)) ? Number(body.type) : 2, cc = /^[A-Za-z]{2}$/.test(String(body && body.countryCode || '')) ? String(body.countryCode).toUpperCase() : 'US';
    const u = unwrap(await reg.api.call('base', '/Regions/RegionSelect', { type, countryCode: cc })); if (!u.ok) return fail(u);
    const rows = (Array.isArray(u.value) ? u.value : []).map(x => ({ name: txt(x.name), code: txt(x.code, 16), phoneCode: txt(x.phoneCode, 8), countryCode: txt(x.countryCode, 4), stateCode: txt(x.stateCode, 8) }));
    return { ok: true, type, countryCode: cc, rows, count: rows.length };
  };
  // this terminal's settings. Fields AIR POS 1.9.11 names (TestShop and a live store): checkoutAutoPrint, returnAutoPrint, autoOpenCashDrawer, useVirtualKeyboard, cashCheckoutConfirm, soundAlerts, printerName, enableShortcut, shortcuts
  const BOOLS = ['checkoutAutoPrint', 'returnAutoPrint', 'autoOpenCashDrawer', 'useVirtualKeyboard', 'cashCheckoutConfirm', 'soundAlerts', 'enableShortcut'];
  const terminalConfig = async () => {
    const u = unwrap(await reg.api.retail('/Commons/RetailTerminalConfigGet', {})); if (!u.ok) return fail(u);
    const v = u.value && typeof u.value === 'object' && !Array.isArray(u.value) ? u.value : null;
    if (!v) return { ok: true, empty: true, settings: {}, config: null };
    const settings = {}; for (const k of BOOLS) settings[k] = !!v[k]; settings.printerName = txt(v.printerName, 200); settings.shortcuts = txt(v.shortcuts, 2000);
    // `config` = the whole record as AIR POS sent it (call 12 will need to send it back whole). The ids are only here for that; no screen shows them.
    return { ok: true, settings, config: v, registerStation: !!v.saleStationId && !/^0+(-0+)*$/.test(String(v.saleStationId)) };
  };

  // ---- call 12: save this terminal's switches ----
  const SWITCHES = ['checkoutAutoPrint', 'returnAutoPrint', 'autoOpenCashDrawer', 'useVirtualKeyboard', 'cashCheckoutConfirm', 'soundAlerts'];
  const readTerminal = async () => { const u = unwrap(await reg.api.retail('/Commons/RetailTerminalConfigGet', {})); if (!u.ok) return { fail: fail(u) }; const v = u.value && typeof u.value === 'object' && !Array.isArray(u.value) ? u.value : null; return { v }; };
  const terminalSave = async body => {
    body = body || {};
    const want = {}; for (const k of SWITCHES) if (k in body) { if (typeof body[k] !== 'boolean') return { ok: false, message: 'Each switch must be on or off.' }; want[k] = body[k]; }
    if (!Object.keys(want).length) return { ok: false, message: 'Nothing to save.' };
    let via = 'manager login';
    if (!ctx.isManager()) { // a cashier: a manager types a user name and password, AIR POS checks it
      if (!body.user && !body.password) return { ok: false, needManager: true, message: 'Changing terminal settings needs a manager. A manager logs in to approve it.' };
      const m = await reg.managerCheck({ user: body.user, password: body.password });
      if (!m.ok) return { ok: false, needManager: true, message: m.message }; via = 'manager approval';
    }
    const cur = await readTerminal(); if (cur.fail) return cur.fail;
    if (!cur.v || !cur.v.id) return { ok: false, message: 'AIR POS has no register record for this login, so its settings cannot be saved from here.' };
    const submit = { id: cur.v.id }; for (const k of SWITCHES) submit[k] = k in want ? want[k] : !!cur.v[k]; submit.printerName = txt(cur.v.printerName, 200);
    const same = SWITCHES.every(k => submit[k] === !!cur.v[k]); if (same) return { ok: true, unchanged: true, message: 'Nothing changed.', ...(await terminalConfig()) };
    const u = unwrap(await reg.api.submit('/Commons/RetailTerminalConfigSave', submit)); if (!u.ok) return fail(u);
    const now = await readTerminal(); // read it back: show what AIR POS now holds, and let the register's own auto-print / drawer rules use it
    if (now.v && reg.home) reg.home.terminalConfig = now.v;
    if (!now.v) return { ok: true, message: 'Saved to AIR POS.', via };
    const done = await terminalConfig();
    return { ...done, ok: true, saved: true, via, message: 'Saved to AIR POS.' };
  };
  // ---- company + store rules (read only, manager only) ----
  const STORE_GROUPS = { basicSetting: 'Basic', priceSetting: 'Prices and discounts', inventorySetting: 'Stock', reportSetting: 'Reports', pointSetting: 'Points' };
  const storeSettings = async () => {
    if (!ctx.isManager()) return { ok: false, denied: true, message: 'Store and account settings are for a manager login.' };
    const u = unwrap(await reg.api.retail('/Commons/RetailConfigGet', {})); if (!u.ok) return fail(u);
    const v = u.value && typeof u.value === 'object' ? u.value : {}, groups = [];
    for (const [g, title] of Object.entries(STORE_GROUPS)) { const o = v[g]; if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      const rows = Object.entries(o).filter(([k, x]) => /^[A-Za-z]{1,60}$/.test(k) && (typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)))).map(([k, x]) => ({ key: k, value: x })); if (rows.length) groups.push({ id: g, title, rows }); }
    const r = v.receiptSetting && typeof v.receiptSetting === 'object' ? v.receiptSetting : {};
    const business = { name: txt(r.corpName, 120), address: txt(r.corpAddress, 200), closingLine: txt(r.closingLine, 200), remarks: txt(r.remarks, 200) };
    const id = ctx.perms();
    return { ok: true, groups, business, canChange: false, why: 'AIR POS changes company and store settings only in its back office (own sign-in), not from a register login.', manager: id.manager };
  };
  const lookupsAll = async () => {
    const names = ['taxKinds', 'paymentTypes', 'subPaymentTypes', 'origins', 'categories', 'regions'];
    const rs = await Promise.all([taxKinds(), paymentTypes(), subPaymentTypes(), origins(), categories(), regions({})]);
    const out = { ok: true, errors: {} };
    names.forEach((n, i) => { if (rs[i].ok) out[n] = rs[i]; else { out.errors[n] = rs[i].message; if (rs[i].loggedOut) out.loggedOut = true; } });
    if (out.loggedOut) return { ok: false, loggedOut: true, message: 'Signed out. Log in again.' };
    return out;
  };
  // Who may open the Store & Account part of Settings and (later, with Gordon's OK) change it? AIR POS has no "settings" menu entry in the register's menus
  // (reg.home.menus: Dashboard, Retail Sales, Basic Data, Reports, Other Functions) and no separate permission code: the only flags are the login's superAdmin
  // and the authority code RetailManager. That is the same rule the existing Settings use for their "manager only" items (reg.isManager()). AIR POS itself still has the last word on a save.
  const settingsAccess = async () => {
    const p = ctx.perms();
    return { ok: true, canView: p.manager, canChange: p.manager, via: p.superAdmin ? 'super admin' : p.manager ? 'RetailManager' : '', manager: p.manager, superAdmin: p.superAdmin, authorities: p.authorities.slice(0, 20) };
  };

  const reads = { 'lookup-tax-kinds': taxKinds, 'lookup-payment-types': paymentTypes, 'lookup-sub-payment-types': subPaymentTypes, 'lookup-origins': origins, 'lookup-categories': categories, 'lookup-regions': regions, 'lookups-all': lookupsAll, 'terminal-config-get': terminalConfig, 'settings-access': settingsAccess };
  const routes = {};
  for (const [name, fn] of Object.entries(reads)) routes[name] = async body => { try { return await fn(body || {}); } catch (e) { return { ok: false, message: 'Could not read ' + name + ': ' + txt(e && e.message, 120) }; } };
  routes['store-settings-get'] = async () => { try { return await storeSettings(); } catch (e) { return { ok: false, message: 'Could not read the store settings: ' + txt(e && e.message, 120) }; } };
  routes['terminal-config-save'] = async body => { try { return await terminalSave(body); } catch (e) { return { ok: false, message: 'Could not save: ' + txt(e && e.message, 120) }; } };
  const names = Object.keys(reads).concat('store-settings-get');
  return { routes, unlocked: names, noSnap: names.concat('terminal-config-save'), once: ['terminal-config-save'] }; // reads skip the sale queue and the sale journal; the one save is once-at-a-time
};

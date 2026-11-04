// Ask AirMax "Do it for me": the ONLY things Ask AirMax can ever do for a cashier. A FIXED list of action ids in this file, one handler each.
// The model can only suggest an id plus params; the server (app/api/ask-airmax.js) checks it against this table and the param schema below and
// drops anything else. Nothing here is built from text the model wrote: no shell, no file path, no URL, no route name.
//
// What these handlers may touch: LOCAL AirMax settings on this PC (settings.json through the register's own saveSettings, the same call the
// Settings window makes) and the register's own printer / drawer / hardware check (testPrint, openDrawerRaw, printers, deviceInfo: the same
// calls as Settings > Test print / Test drawer / Check printers).
// What they must never touch (hard blocks, also checked by name in BLOCKED below): sales, charges, refunds, voids, returns, prices, discounts, customer or
// member data, operators / users, cash in / out, X / Z reports, gift cards, AIR POS (no reg.api call anywhere in this file, no RetailTerminalConfigSave),
// app/lib, shell / OS commands, files.
'use strict';

const BLOCKED = /(sale|order|charge|pay|tender|refund|void|return|price|discount|promo|tax|customer|member|point|gift|card|operator|user|login|password|manager|cash|z-?read|x-?read|report|shift|clock|terminal|config|cloud|airpos-write|shell|exec|command|cmd|powershell|script|eval|file|delete|remove|rm|write|path|lib|update|feed|restart|quit|exit)/i;

const ENUMS = {
  kind: { values: ['escpos', 'star', 'both'], label: { escpos: 'ESC/POS', star: 'Star', both: 'Both (ESC/POS and Star)' } },
  mode: { values: ['auto', 'builtin', 'airpos'], label: { auto: 'Automatic', builtin: 'Built-in helper', airpos: 'AIR POS service' } },
  keyboard: { values: ['keypad', 'windows', 'off'], label: { keypad: 'On-screen keypad', windows: 'Windows touch keyboard', off: 'Off' } },
};
// id -> { title, help (what the model is told), params: { name: 'printer' | enum name }, plan(p), run(p), undo(snapshot) }. Add an action = add one entry here.
function makeActions(reg) {
  const S = () => (reg && reg.settings) || {};
  const lbl = (e, v) => (ENUMS[e].label[v] || String(v));
  const hwBlocked = () => (S().hardware === 'airpos' ? 'This register prints through the AIR POS service, so I will not run a test for you. Use Settings > Printer & Drawer.' : '');
  const saveOne = (key, value) => { try { const r = reg.saveSettings({ [key]: value }); return r && r.ok === false ? { ok: false, message: String(r.message || r.error || 'The register did not save that.') } : { ok: true }; } catch (e) { return { ok: false, message: 'The register did not save that.' }; } };
  // one handler per settings-type action: change one local setting, show before -> after, undo = put the old value back
  const setting = (id, title, help, key, param, enumName, what) => ({
    title, help, params: { [param]: enumName },
    async plan(p) { const before = S()[key]; const now = key === 'drawerKind' ? (before || 'escpos') : key === 'hardware' ? (before || 'auto') : (before || 'keypad');
      if (now === p[param]) return { error: what + ' is already ' + lbl(enumName, now) + '. Nothing to change.', noop: true };
      return { changes: [{ what, before: lbl(enumName, now), after: lbl(enumName, p[param]) }], undoable: true, snapshot: { key, value: before } }; },
    async run(p, plan) { const r = saveOne(key, p[param]); if (!r.ok) return r; const after = S()[key];
      return { ok: after === p[param], message: what + ' is now ' + lbl(enumName, after) + '.', changes: [{ what, before: plan.changes[0].before, after: lbl(enumName, after) }], snapshot: plan.snapshot }; },
    async undo(snap) { const r = saveOne(snap.key, snap.value); return r.ok ? { ok: true, message: 'Put back to what it was before.' } : r; },
  });
  const A = {
    'test-print': { title: 'Print a test page', help: 'print a test page on the register printer (same as Settings > Test print)', params: {},
      async plan() { const b = hwBlocked(); if (b) return { error: b }; return { changes: [{ what: 'Printer', before: 'nothing printed', after: 'a test page prints' + (S().printerName ? ' on ' + S().printerName : '') }], undoable: false }; },
      async run() { const r = await reg.testPrint(); return { ok: !!(r && r.ok), message: String((r && r.message) || (r && r.ok ? 'Test page sent to the printer.' : 'The test page did not print.')), changes: [{ what: 'Printer', before: 'nothing printed', after: r && r.ok ? 'test page sent' : 'test page not printed' }] }; } },
    'test-drawer': { title: 'Open the cash drawer once (test)', help: 'open the cash drawer once as a test (same as Settings > Test drawer)', params: {},
      async plan() { const b = hwBlocked(); if (b) return { error: b }; return { changes: [{ what: 'Cash drawer', before: 'closed', after: 'opens once (no sale, no money moves)' }], undoable: false }; },
      async run() { const r = await reg.openDrawerRaw(); return { ok: !!(r && r.ok), message: String((r && r.message) || (r && r.ok ? 'The drawer was told to open.' : 'The drawer did not open.')), changes: [{ what: 'Cash drawer', before: 'closed', after: r && r.ok ? 'opened once' : 'did not open' }] }; } },
    'hardware-recheck': { title: 'Reconnect and re-check the printer and drawer', help: 'reconnect: look for the printer and drawer again (same as Settings > Check printers); changes nothing', params: {},
      async plan() { return { changes: [{ what: 'Printer and drawer', before: 'last check', after: 'checked again now' }], undoable: false }; },
      async run() { let ok = false, msg = ''; try { const d = await reg.deviceInfo(); const p = await reg.printers(); ok = !!(p && p.ok !== false); msg = ok ? 'Checked again. ' + ((p && p.printers && p.printers.length) || 0) + ' printer(s) found.' : 'Could not check the printers.'; void d; } catch (e) { msg = 'Could not check the printers.'; }
        return { ok, message: msg, changes: [{ what: 'Printer and drawer', before: 'last check', after: ok ? 'checked again' : 'check failed' }] }; } },
    'printer-set': { title: 'Choose the receipt printer', help: 'choose which Windows printer prints receipts: params {"printer":"<exact printer name from this PC>"}', params: { printer: 'printer' },
      async plan(p) { let list = []; try { const r = await reg.printers(); list = ((r && r.printers) || []).map(x => (typeof x === 'string' ? x : x && x.name)).filter(Boolean); } catch (e) { list = []; }
        if (!list.includes(p.printer)) return { error: 'That printer is not in the list this PC found, so I will not set it.' };
        const before = S().printerName || '';
        if (before === p.printer) return { error: 'That printer is already selected. Nothing to change.', noop: true };
        return { changes: [{ what: 'Receipt printer', before: before || '(automatic)', after: p.printer }], undoable: true, snapshot: { key: 'printerName', value: before } }; },
      async run(p, plan) { const r = saveOne('printerName', p.printer); if (!r.ok) return r; const after = S().printerName || '';
        return { ok: after === p.printer, message: 'Receipt printer is now ' + (after || '(automatic)') + '.', changes: [{ what: 'Receipt printer', before: plan.changes[0].before, after: after || '(automatic)' }], snapshot: plan.snapshot }; },
      async undo(snap) { const r = saveOne(snap.key, snap.value); return r.ok ? { ok: true, message: 'Put back to what it was before.' } : r; } },
    'drawer-kind-set': setting('drawer-kind-set', 'Set the cash drawer type', 'set the cash drawer type (escpos, star or both): params {"kind":"escpos|star|both"}', 'drawerKind', 'kind', 'kind', 'Cash drawer type'),
    'hardware-route-set': setting('hardware-route-set', 'Choose how this PC reaches the printer', 'choose how the printer and drawer are reached: params {"mode":"auto|builtin|airpos"}', 'hardware', 'mode', 'mode', 'Printer connection'),
    'touch-keyboard-set': setting('touch-keyboard-set', 'Set the touch keyboard', 'set the on-screen number pad for touch screens: params {"mode":"keypad|windows|off"}', 'touchKeyboard', 'mode', 'keyboard', 'Touch keyboard'),
  };
  // the table is fixed after this line
  for (const k of Object.keys(A)) if (BLOCKED.test(k)) throw new Error('blocked word in action id ' + k); // an id that sounds like a hard-blocked category can never be added
  return Object.freeze(A);
}
const IDS = ['test-print', 'test-drawer', 'hardware-recheck', 'printer-set', 'drawer-kind-set', 'hardware-route-set', 'touch-keyboard-set'];
const PARAMS = { 'test-print': {}, 'test-drawer': {}, 'hardware-recheck': {}, 'printer-set': { printer: 'printer' }, 'drawer-kind-set': { kind: 'kind' }, 'hardware-route-set': { mode: 'mode' }, 'touch-keyboard-set': { mode: 'keyboard' } };
// A model suggestion -> { ok, id, params } or { ok:false, reason: 'blocked' | 'unknown' | 'params' }. Never throws.
function validate(obj) {
  try {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'unknown' };
    const id = obj.id;
    if (typeof id !== 'string' || id.length > 60) return { ok: false, reason: 'unknown' };
    if (!Object.prototype.hasOwnProperty.call(PARAMS, id)) return { ok: false, reason: BLOCKED.test(id) ? 'blocked' : 'unknown' };
    const spec = PARAMS[id], given = obj.params == null ? {} : obj.params;
    if (typeof given !== 'object' || Array.isArray(given)) return { ok: false, reason: 'params' };
    for (const k of Object.keys(given)) if (!Object.prototype.hasOwnProperty.call(spec, k)) return { ok: false, reason: 'params' };
    const params = {};
    for (const [k, kind] of Object.entries(spec)) {
      const v = given[k];
      if (typeof v !== 'string') return { ok: false, reason: 'params' };
      if (kind === 'printer') { if (!v.trim() || v.length > 120 || /[\u0000-\u001f\u007f]/.test(v)) return { ok: false, reason: 'params' }; params[k] = v; }
      else { if (!ENUMS[kind].values.includes(v)) return { ok: false, reason: 'params' }; params[k] = v; }
    }
    return { ok: true, id, params };
  } catch (e) { return { ok: false, reason: 'unknown' }; }
}
// the list the model is told about (ids and what each does; nothing else)
const catalogText = () => { const a = makeActions({}); return IDS.map(i => i + ': ' + a[i].help).join('; '); };
module.exports = { makeActions, validate, catalogText, IDS, BLOCKED };

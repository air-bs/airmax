// Shared keyboard-shortcut engine. Used by the custom UI page AND injected into the AIR POS window by the bridge.
// installAirposShortcuts(keys, fire, opts) -> listens for keydown (capture phase) and calls fire(entry, combo).
(function (root) {
  function comboOf(e) {
    let k = e.key;
    if (k === ' ') k = 'Space';
    if (k.length === 1) k = k.toUpperCase();
    if (k === 'Esc') k = 'Escape';
    if (k === 'Del') k = 'Delete';
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    // Shift only counts for letters/F-keys (so '+' and '*' work whether or not Shift is needed to type them)
    if (e.shiftKey && (/^[A-Z]$/.test(k) || /^F\d+$/.test(k) || ['Delete','Escape','Enter','Tab'].includes(k))) mods.push('Shift');
    return [...mods, k].join('+');
  }
  function norm(c) { return c.split('+').map(p => p.length === 1 ? p.toUpperCase() : p).join('+'); }
  function isTyping(scanSelector) {
    const a = document.activeElement;
    if (!a) return false;
    const editable = a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName);
    if (!editable) return false;
    if (scanSelector && a.matches(scanSelector) && !a.value) return false; // empty scan box = not typing
    return true;
  }
  function dialogOpen() {
    return [...document.querySelectorAll('.el-overlay, .el-message-box__wrapper')].some(e => e.getClientRects().length > 0);
  }
  function hasSelection() {
    const a = document.activeElement;
    if (a && typeof a.selectionStart === 'number' && a.selectionStart !== a.selectionEnd) return true;
    return !!(window.getSelection && String(window.getSelection()));
  }
  function install(keys, fire, opts) {
    opts = opts || {};
    const map = {};   // one combo can have several entries; the first whose "when" matches wins
    keys.forEach(k => (map[norm(k.key)] = map[norm(k.key)] || []).push(k));
    const visible = sel => [...document.querySelectorAll(sel)].some(e => e.getClientRects().length);
    const ok = entry => {
      if (entry.when === 'noSelection' && hasSelection()) return false;   // let copy work
      if (entry.when === 'notTyping' && (isTyping(opts.scanSelector) || dialogOpen())) return false;
      if (entry.when === 'confirmBox' && !(opts.isConfirm ? opts.isConfirm() : [...document.querySelectorAll('.el-message-box')].some(b => b.getClientRects().length && ![...b.querySelectorAll('input')].some(i => i.getClientRects().length)))) return false; // Enter only for yes/no boxes
      if (entry.when === 'loginOnly' && !(opts.isLogin ? opts.isLogin() : !!document.querySelector('.login-page'))) return false;
      if (entry.when === 'paymentOpen' && !(opts.isPayment ? opts.isPayment() : visible('.pay-confirmer')) ) return false;
      if (entry.when === 'paymentOpen' && visible('.el-message-box')) return false;
      return true;
    };
    const handler = e => {
      if (e.repeat || e.isComposing) return;
      const entry = (map[comboOf(e)] || []).find(ok);
      if (!entry) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (entry.action === 'local:block') return toast(entry.label, '#334155');
      fire(entry, comboOf(e));
    };
    if (root.__airposShortcutHandler) root.removeEventListener('keydown', root.__airposShortcutHandler, true);
    root.__airposShortcutHandler = handler;
    root.addEventListener('keydown', handler, true);
  }
  function helpOverlay(keys, title) {
    let el = document.getElementById('__airpos_help');
    if (el) { el.remove(); return; }
    el = document.createElement('div');
    el.id = '__airpos_help';
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,Arial,sans-serif';
    el.innerHTML = '<div style="background:#fff;color:#0f172a;border-radius:16px;padding:24px 32px;min-width:520px;max-height:90vh;overflow:auto">' +
      '<h2 style="margin:0 0 12px">' + (title || 'Keyboard shortcuts') + '</h2><table style="font-size:18px;border-collapse:collapse">' +
      keys.map(k => '<tr><td style="padding:5px 18px 5px 0"><kbd style="background:#e2e8f0;border-radius:6px;padding:3px 9px;font-weight:700">' + k.key + '</kbd></td><td>' + k.label + '</td></tr>').join('') +
      '</table><p style="color:#64748b;margin:14px 0 0">Press F1 or Esc to close</p></div>';
    el.onclick = () => el.remove();
    document.body.appendChild(el);
  }
  function toast(msg, color) {
    let el = document.getElementById('__airpos_toast');
    if (!el) {
      el = document.createElement('div'); el.id = '__airpos_toast';
      el.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:12px 18px;border-radius:12px;color:#fff;font:600 17px Segoe UI,Arial,sans-serif;box-shadow:0 6px 20px #0005;max-width:520px;transition:opacity .3s;pointer-events:none';
      document.body.appendChild(el);
    }
    el.style.pointerEvents = 'none'; el.style.background = color || '#0f172a'; el.textContent = msg; el.style.opacity = '1';
    clearTimeout(el.__t); el.__t = setTimeout(() => el.style.opacity = '0', 3500);
  }
  root.AirposShortcuts = { install, comboOf, helpOverlay, toast, isTyping };
})(window);

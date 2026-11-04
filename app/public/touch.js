// Air Register touch screen support. Settings > Touch screen: "Air Register keypad" (default) / "Windows keyboard" / "Off".
// - The scan box ALWAYS has inputmode=none: focusing it (which Air Register does all the time) never pops the Windows keyboard.
// - keypad / off: every field gets inputmode=none; with "keypad", touching a field that needs typing opens a small keypad
//   (numbers for amounts / quantities / PINs, a mini keyboard for text). Mouse, physical keyboard and scanner are unchanged.
'use strict';
(() => {
  let mode = 'keypad', pad = null, target = null;
  const isField = el => el && ((el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'hidden', 'file', 'range', 'color'].includes(el.type)) || el.tagName === 'TEXTAREA');
  const numeric = el => el.type === 'number' || ['numeric', 'decimal'].includes(el.dataset.im || el.getAttribute('inputmode')) || el.dataset.kb === 'numeric' || /amt|amount|qty|price|pin|tender|cash/i.test(el.id || '');
  function tag(el) {
    if (!isField(el)) return;
    if (el.dataset.im === undefined) el.dataset.im = el.getAttribute('inputmode') || '';
    if (el.id === 'scanInput' || mode !== 'windows') el.setAttribute('inputmode', 'none');
    else if (el.dataset.im) el.setAttribute('inputmode', el.dataset.im); else el.removeAttribute('inputmode');
  }
  const tagAll = () => document.querySelectorAll('input, textarea').forEach(tag);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (isField(n)) tag(n); n.querySelectorAll && n.querySelectorAll('input, textarea').forEach(tag); } })
    .observe(document.documentElement, { childList: true, subtree: true });

  function insert(txt) {
    if (!target || !document.body.contains(target)) return hide();
    const el = target;
    if (txt === 'BS') {
      const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
      try { if (a !== b) el.setRangeText('', a, b, 'end'); else if (a > 0) el.setRangeText('', a - 1, a, 'end'); } catch { el.value = el.value.slice(0, -1); }
    } else if (txt === 'CLR') el.value = '';
    else if (txt === 'ENTER') { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); hide(); return; }
    else { try { el.setRangeText(txt, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end'); } catch { el.value += txt; } } // type=number has no selection API
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  let shift = false;
  function show(el) {
    target = el; if (!pad) { pad = document.createElement('div'); pad.id = 'airPad'; document.body.appendChild(pad); pad.addEventListener('pointerdown', onPad); }
    const num = numeric(el);
    const rows = num ? [['7', '8', '9', 'BS'], ['4', '5', '6', 'CLR'], ['1', '2', '3', 'ENTER'], ['0', '00', '.', 'HIDE']]
      : [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'BS'], ['SHIFT', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '@', '.'], ['HIDE', '-', 'SPACE', '_', 'ENTER']];
    const lab = { BS: '⌫', CLR: 'C', ENTER: 'Enter', HIDE: '▼', SHIFT: '⇧', SPACE: 'space' };
    pad.className = num ? 'num' : 'txt';
    pad.innerHTML = rows.map(r => `<div class="pr">${r.map(k => `<button type="button" tabindex="-1" data-k="${k}" class="${k.length > 2 ? 'w' : ''}">${lab[k] || (shift ? k.toUpperCase() : k)}</button>`).join('')}</div>`).join('');
    pad.style.display = '';
  }
  function hide() { if (pad) pad.style.display = 'none'; target = null; }
  function onPad(e) {
    e.preventDefault(); e.stopPropagation(); // keep the focus in the field
    const b = e.target.closest('button'); if (!b) return; const k = b.dataset.k;
    if (k === 'HIDE') return hide();
    if (k === 'SHIFT') { shift = !shift; return show(target); }
    insert(k === 'SPACE' ? ' ' : k.length === 1 || k === '00' ? (shift ? k.toUpperCase() : k) : k);
    if (shift && k.length === 1) { shift = false; show(target); }
  }
  // only a real touch (or pen) opens the keypad; a mouse click or the app's own focus() never does
  document.addEventListener('pointerdown', e => {
    if (pad && pad.contains(e.target)) return;
    const el = e.target.closest && e.target.closest('input, textarea');
    if (mode === 'keypad' && (e.pointerType === 'touch' || e.pointerType === 'pen') && isField(el) && el.id !== 'scanInput' && !el.disabled && !el.readOnly) { setTimeout(() => show(el), 0); return; }
    if (!el) hide();
  }, true);
  document.addEventListener('focusin', e => { if (target && e.target !== target && !(pad && pad.contains(e.target))) hide(); });
  window.AirTouch = { setMode(m) { m = ['keypad', 'windows', 'off'].includes(m) ? m : 'keypad'; if (m === mode && document.body.dataset.touch === m) return; mode = m; document.body.dataset.touch = m; if (m !== 'keypad') hide(); tagAll(); }, show, hide, get mode() { return mode; } };
  tagAll();
})();

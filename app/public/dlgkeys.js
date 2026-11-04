// 1.2.0 round 3 (owner): every button shows its own key.
//  * In a window (dialog / Settings / History / Customers / Items…): a button that does not already show a key
//    (Esc, Enter, F-key, Ctrl…) gets Alt + a letter (its first free letter), shown on the button. Alt+letter clicks it.
//    Letters used by global Alt keys (shortcuts.json: Alt+N) and the browser menu letters (F, E) are never given out.
//  * Bulk item buttons on the sale screen: Alt+1 … Alt+9, Alt+0, Alt+-, Alt+= (12 slots).
//  * Hide sidebars: Settings switch + Ctrl+B (remembered on this PC).
'use strict';
const DLG_SKIP = new Set(['N', 'F', 'E']); // tests/keys-unique.test.js checks this against shortcuts.json
const DLG_LETTERS = 'ABCDGHIJKLMOPQRSTUVWXYZ'.split('').filter(c => !DLG_SKIP.has(c));
const HAS_KEY = /\((?:Esc|Enter|Del|Delete|Tab|Space|F\d+|Ctrl[^)]*|Shift[^)]*|Alt[^)]*|[^()\s]{1,2})\)|(?:^|\s)(?:Esc|Enter|F\d+|Ctrl\s*\+\s*\S+|Del)$/;
function dlgLabel() {
  const root = $('modalRoot'); if (!root || !root.firstChild) return;
  const btns = [...root.querySelectorAll('button')].filter(b => b.getClientRects().length && !b.disabled);
  const used = new Set(btns.map(b => b.dataset.dk).filter(Boolean));
  for (const b of btns) {
    if (b.dataset.dk || b.dataset.nok) continue;
    const t = b.textContent.trim();
    if (b.querySelector('kbd, .k') || HAS_KEY.test(t) || /^[0-9.,+\-*\/×÷=%()CcX⌫←]{1,3}$/.test(t)) { b.dataset.nok = '1'; continue; } // already shows a key / keypad key
    const pref = (t.toUpperCase().match(/[A-Z0-9]/g) || []).filter(c => DLG_LETTERS.includes(c));
    const L = pref.find(c => !used.has(c)) || DLG_LETTERS.find(c => !used.has(c)); if (!L) continue;
    used.add(L); b.dataset.dk = L;
    const k = document.createElement('kbd'); k.className = 'dk'; k.textContent = 'Alt+' + L; b.appendChild(k);
  }
}
(() => {
  const root = $('modalRoot'); if (!root) return;
  let q = 0; new MutationObserver(() => { if (!q) q = requestAnimationFrame(() => { q = 0; dlgLabel(); }); }).observe(root, { childList: true, subtree: true });
  window.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey || !modalOpen()) return;
    const c = (e.code || '').replace(/^Key|^Digit/, '');
    const b = [...$('modalRoot').querySelectorAll('button[data-dk]')].find(x => x.dataset.dk === c && x.getClientRects().length && !x.disabled);
    if (b) { e.preventDefault(); e.stopPropagation(); b.click(); }
  }, true);
})();

// bulk item buttons: Alt+1 … Alt+=
const BULK_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
BULK_KEYS.forEach((k, i) => { A['bulk-' + (i + 1)] = () => { const b = document.querySelector(`[data-bulk="${i}"]`); if (b) b.click(); else toast('No bulk item ' + (i + 1), false); }; });
(() => {
  const prev = window.renderBulk; if (!prev) return;
  // 1.0.5: only the first 12 visible spots have a key (spots 13-24 are tap-only); Back = Alt+Backspace
  const tag = (b, t) => { if (!b.querySelector('.bk')) { const k = document.createElement('span'); k.className = 'bk'; k.textContent = t; b.appendChild(k); } };
  window.renderBulk = () => { prev(); document.querySelectorAll('#bulkBtns [data-bulk]').forEach(b => { const n = +b.dataset.bulk; if (n < BULK_KEYS.length) tag(b, 'Alt+' + BULK_KEYS[n]); }); const bb = $('bulkBack'); if (bb) tag(bb, 'Alt+Backspace'); };
  if (S && S.loggedIn) { const el = $('bulkBtns'); if (el) el.dataset.sig = ''; window.renderBulk(); }
})();

// hide / show the side panels (Settings switch + Ctrl+B)
const SIDES_KEY = 'airreg.hideSides';
function setSides(hide) { document.body.classList.toggle('nosides', !!hide); try { localStorage.setItem(SIDES_KEY, hide ? '1' : '0'); } catch {} const c = $('seSides'); if (c) c.checked = !!hide; }
A['sidebars'] = () => { setSides(!document.body.classList.contains('nosides')); focusScan(); };
try { setSides(localStorage.getItem(SIDES_KEY) === '1'); } catch {}
(() => {
  const prev = settingsDialog;
  settingsDialog = async function () {
    await prev();
    const more = $('seMore'); if (!more || $('seSides')) return;
    const l = document.createElement('label'); l.className = 'chk'; l.style.margin = '0 12px 0 0';
    l.innerHTML = '<input type="checkbox" id="seSides"> Hide sidebars <kbd>Ctrl+B</kbd>'; more.insertBefore(l, more.firstChild);
    $('seSides').checked = document.body.classList.contains('nosides'); $('seSides').onchange = e => setSides(e.target.checked);
  };
  A['settings'] = settingsDialog;
})();

// Air Register 1.1 POS hardening (UI side): Retry offers, crash reports, recovery notice, Register Mode (exit to Windows,
// restart / shut down the PC), Touch keyboard + full screen settings, Remote Help panel, Export log.
// Loaded after app.js and extras.js; uses their helpers (S, A, api, act, modal, toast, msgIn, refresh, focusScan…).
'use strict';

// ---------- errors in the page are reported to the local log (no data from the cart or forms) ----------
const reportErr = (message, where) => { try { fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: String(message).slice(0, 400), where: String(where || '').slice(0, 200) }) }); } catch {} };
window.addEventListener('error', e => reportErr(e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', e => reportErr('promise: ' + ((e.reason && e.reason.message) || e.reason)));

// ---------- Retry (shown next to the message after a "retryable" failure: connection drops, timeouts) ----------
window.retryOffer = fn => {
  const t = $('toast'); if (!t) return;
  const b = document.createElement('button'); b.className = 'pbtn s retrybtn'; b.textContent = 'Retry';
  b.onclick = e => { e.stopPropagation(); b.remove(); fn(); }; t.appendChild(b);
};

// ---------- recovery notice (an unfinished sale or refund restored after a restart / crash / power cut) ----------
function noticeBanner() {
  let n = $('noticeBar');
  const x = S.loggedIn && S.notice;
  if (!x) { if (n) n.remove(); return; }
  if (!n) { n = document.createElement('div'); n.id = 'noticeBar'; const anchor = $('toast'); anchor.parentNode.insertBefore(n, anchor); }
  const key = (x.message || '') + (S.recoveryPending ? 1 : 0); if (n.dataset.key === key) return; n.dataset.key = key;
  n.className = 'notice ' + (x.kind || 'info');
  n.innerHTML = `<span>${esc(x.message)}</span>${S.recoveryPending ? '<button class="pbtn s" id="nbRetry">Check again</button>' : ''}<button class="pbtn s" id="nbOk">OK</button>`;
  $('nbOk').onclick = async e => { e.stopPropagation(); await api('notice-dismiss'); n.remove(); await refresh(); focusScan(); };
  if ($('nbRetry')) $('nbRetry').onclick = async e => { e.stopPropagation(); const r = await api('recover-check'); toast(r.message, r.ok); await refresh(); };
}
// waiting card refund (receipt return to card that AIR POS has not marked Completed): stays until AIR POS says Completed
function cardRefundBar() {
  let n = $('cardRefundBar');
  const list = (S.loggedIn && S.cardRefunds) || [];
  if (!list.length) { if (n) n.remove(); return; }
  if (!n) { n = document.createElement('div'); n.id = 'cardRefundBar'; const anchor = $('toast'); anchor.parentNode.insertBefore(n, anchor); }
  const x = list[0], msg = x.message + (x.orderNumber ? ` (${x.orderNumber})` : '') + (list.length > 1 ? ` +${list.length - 1} more` : '');
  if (n.dataset.key === msg) return; n.dataset.key = msg;
  n.className = 'notice'; n.style.cssText = 'background:#fde2e2;border-color:#c0392b';
  n.innerHTML = `<span>${esc(msg)}</span><button class="pbtn r" id="crRetry">Retry card refund</button>`;
  $('crRetry').onclick = async e => {
    e.stopPropagation(); const b = $('crRetry'); if (b.disabled) return; b.disabled = true; toast('Checking the card refund with AIR POS…');
    const r = await api('card-refund-retry', { retId: x.retId }); if (!r.busy) toast(r.message, r.ok); n.dataset.key = ''; await refresh();
  };
}
const prevAfter = window.afterRefresh;
window.afterRefresh = () => { if (prevAfter) prevAfter(); noticeBanner(); cardRefundBar(); applyTouchMode(); };

// ---------- manager login (Register Mode exit, PC power, Remote Help) ----------
// The user name + password are checked by the AIR POS server (Identities/verify), the same check as manager approvals.
function managerLogin(title, text, go, { allowPin } = {}) {
  const pin = allowPin && S.settings && S.settings.exitPinEnabled;
  modal(`<h2>${esc(title)}</h2><p class="note">${esc(text)}</p>
    <label class="f">Manager user name</label><input class="f" id="mlU" autocomplete="off" data-kb="text" autofocus>
    <label class="f">Password</label><input class="f" id="mlP" type="password" autocomplete="off" data-kb="text">
    ${pin ? '<p class="note">or the exit PIN:</p><input class="f" id="mlPin" type="password" inputmode="numeric" data-kb="numeric" maxlength="8" autocomplete="off">' : ''}
    <div id="mlMount"></div>
    <div id="mlMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button><button class="pbtn g" id="mlOk">OK</button></div>`, () => {
    const ok = async () => {
      const b = { user: $('mlU').value.trim(), password: $('mlP').value }; if (pin && $('mlPin').value) b.pin = $('mlPin').value;
      $('mlP').value = ''; if ($('mlPin')) $('mlPin').value = '';
      $('mlOk').disabled = true; msgIn($('mlMsg'), { ok: true, message: 'Checking…' });
      try { const r = await go(b); if (r) msgIn($('mlMsg'), r); } finally { if ($('mlOk')) $('mlOk').disabled = false; }
    };
    $('mlOk').onclick = ok; $('modalRoot').querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') ok(); });
    // Step 0 slot: a batch can add another way to approve (e.g. a fingerprint) here; submit(body) runs the same approval as OK
    if (window.AirMaxMounts) AirMaxMounts.fill($('mlMount'), 'checkout.manager-approval', { title, text, submit: async body => { const r = await go(body); if (r && $('mlMsg')) msgIn($('mlMsg'), r); return r; }, close: () => closeModal() });
  });
}

// ---------- Exit to Windows (Register Mode): Ctrl+Shift+Q, or tap the top-left corner 5 times ----------
function exitDialog() {
  managerLogin('Exit to Windows', 'A manager logs in to close Air Max and go back to Windows.', async b => {
    const r = await api('exit-windows', b);
    if (r.ok) { modal(`<h2>Closing…</h2><p>${esc(r.message)}</p>`); setTimeout(() => { try { window.close(); } catch {} }, 1500); }
    return r;
  }, { allowPin: true });
}
window.addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && (e.key === 'Q' || e.key === 'q')) { e.preventDefault(); e.stopImmediatePropagation(); exitDialog(); } }, true);
(() => {
  const c = document.createElement('div'); c.id = 'exitCorner'; c.title = ''; document.body.appendChild(c);
  let taps = [];
  c.addEventListener('pointerdown', e => { e.preventDefault(); const t = Date.now(); taps = taps.filter(x => t - x < 3000).concat(t); if (taps.length >= 5) { taps = []; exitDialog(); } });
})();

function powerDialog() {
  const go = async (action, b = {}) => {
    if (!confirm(action === 'restart' ? 'Restart this PC now?' : 'Shut down this PC now?')) return null;
    const r = await api('power', { action, ...b });
    if (!r.ok && r.needManager) { managerLogin(action === 'restart' ? 'Restart PC' : 'Shut down PC', 'A manager must approve this.', async m => api('power', { action, ...m })); return null; }
    return r;
  };
  modal(`<h2>Restart or shut down the PC</h2><p class="note">Finish or hold the sale first. A cashier needs a manager login.</p><div id="pwMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button><button class="pbtn" id="pwR">Restart PC</button><button class="pbtn r" id="pwS">Shut down PC</button></div>`, () => {
    $('pwR').onclick = async () => { const r = await go('restart'); if (r) msgIn($('pwMsg'), r); };
    $('pwS').onclick = async () => { const r = await go('shutdown'); if (r) msgIn($('pwMsg'), r); };
  });
}
A['power'] = powerDialog; A['exit-windows'] = exitDialog;

// ---------- Settings: Touch screen & Register Mode ----------
// 1.0.9-local.5: customer screen texts per shop (display only); key, default, max length, label
const CM_FIELDS = [['itemsHead', 'Your items', 40, 'Heading over the items'], ['returnHead', 'Return', 40, 'Heading during a return'], ['cardReader', 'Please use the card reader', 60, 'While the card reader waits'], ['thankYou', 'Thank you', 40, 'After the sale']];
function touchSettingsDialog() {
  const st = S.settings || {}, mgr = !!(S.user && S.user.manager);
  modal(`<h2>Screens &amp; Register Mode</h2>
    <label class="f">On-screen keyboard (touch screens)</label>
    <select class="f" id="tkK"><option value="keypad">Air Max keypad</option><option value="windows">Windows touch keyboard</option><option value="off">Off (no on-screen keyboard)</option></select>
    <p class="note">The scan box never opens a keyboard. A physical keyboard and the barcode scanner always work.</p>
    <label class="f chk"><input type="checkbox" id="tkF"> Full screen</label>
    <label class="f chk"><input type="checkbox" id="tkCD"> Customer display (second monitor)${window.screen && window.screen.isExtended === false ? ' (no second monitor found)' : ''}</label>
    <h3>Customer screen welcome ${mgr ? '' : '<small>(manager only)</small>'}</h3>
    <input class="f" id="cwW" maxlength="40" placeholder="Welcome message (empty = Welcome)" autocomplete="off" ${mgr ? '' : 'disabled'}><small id="cwWn" class="note"></small>
    <input class="f" id="cwW2" maxlength="80" placeholder="Second line (empty = shop name)" autocomplete="off" ${mgr ? '' : 'disabled'}><small id="cwW2n" class="note"></small>
    <div class="row2"><input type="file" id="cwF" accept="image/png,image/jpeg" hidden><button class="pbtn s" id="cwPick" ${mgr ? '' : 'disabled'}>Choose logo…</button><button class="pbtn s" id="cwRm" ${mgr ? '' : 'disabled'}>Remove logo</button></div>
    <div id="cwPrev" style="background:linear-gradient(160deg,#1f3b57,#2d5f73);color:#fff;text-align:center;padding:12px;border-radius:6px;margin:6px 0"><img id="cwPI" alt="" style="max-height:70px;max-width:60%;display:none;margin:0 auto 6px"><div id="cwPW" style="font-size:24px;font-weight:300;overflow-wrap:anywhere"></div><div id="cwPW2" style="opacity:.85;overflow-wrap:anywhere"></div></div>
    <p class="note">Logo: PNG or JPG, up to 500 KB and 2000 x 2000. Shown on the customer screen's Welcome.</p>
    <h3>Customer screen messages (this shop) ${mgr ? '' : '<small>(manager only)</small>'}</h3>
    <div id="cmBox">${CM_FIELDS.map(([k, d, mx, l]) => `<label class="f">${l}</label><input class="f cmF" id="cm_${k}" data-k="${k}" maxlength="${mx}" placeholder="${d} (empty = this)" autocomplete="off" ${mgr ? '' : 'disabled'}>`).join('')}</div>
    <p class="note">Saved for this shop on this PC, with the welcome lines above. Empty means the normal text. Shown to the customer only; it does not change the sale or any amounts.</p>
    <h3>Customer screen welcome picture ${mgr ? '' : '<small>(manager only)</small>'}</h3>
    <div class="row2" style="justify-content:flex-start"><input type="file" id="wpF" accept="image/png,image/jpeg" hidden><button class="pbtn s" id="wpPick" ${mgr ? '' : 'disabled'}>Choose picture…</button><button class="pbtn s" id="wpRm" ${mgr ? '' : 'disabled'}>Remove picture</button></div>
    <label class="f">How the picture fits the screen</label>
    <select class="f" id="wpFit" ${mgr ? '' : 'disabled'}><option value="contain">Show the whole picture (bars where it doesn't fit)</option><option value="cover">Fill the whole screen (edges may be cut off)</option></select>
    <label class="f">Colour of the bars</label><input class="f" type="color" id="wpFill" style="height:34px;padding:2px" ${mgr ? '' : 'disabled'}>
    <div id="wpPrev" style="position:relative;aspect-ratio:16/9;max-height:150px;background:#1f3b57;border-radius:6px;margin:6px 0;overflow:hidden;color:#fff;display:flex;align-items:center;justify-content:center;text-align:center"><img id="wpPI" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none"><span id="wpPN" style="opacity:.85;padding:8px">No picture: the customer screen shows the welcome message above</span></div>
    <p class="note">Picture: PNG or JPG, up to 5 MB and 4096 x 4096. Shown full screen on the customer screen only when no sale is in progress, in place of the message and logo above. Saved when you press Save.</p>
    <h3>Register screen logo (above the total) ${mgr ? '' : '<small>(manager only)</small>'}</h3>
    <div class="row2" style="justify-content:flex-start"><input type="file" id="slF" accept="image/png,image/jpeg" hidden><button class="pbtn s" id="slPick" ${mgr ? '' : 'disabled'}>Choose register logo…</button><button class="pbtn s" id="slRm" ${mgr ? '' : 'disabled'}>Remove register logo</button></div>
    <div id="slPrev" style="display:flex;align-items:center;justify-content:center;height:72px;background:#fff;border:1px solid #e3e7eb;border-radius:3px;margin:6px 0;color:#5b6b78"><img id="slPI" alt="" style="max-height:60px;max-width:70%;object-fit:contain;display:none"><span id="slPN">No logo: the space above the total stays as it is</span></div>
    <p class="note">Logo: PNG or JPG, up to 5 MB and 4096 x 4096. Shown on this register's sale screen, above the total.</p>
    <h3>Register Mode ${mgr ? '' : '<small>(manager only)</small>'}</h3>
    <label class="f chk"><input type="checkbox" id="tkR" ${mgr ? '' : 'disabled'}> Register Mode (locked register)</label>
    <p class="note">Exit to Windows: Ctrl+Shift+Q or tap the top-left corner 5 times, then a manager's AIR POS login. Remote help (RustDesk) keeps working in Register Mode.</p>
    <label class="f chk"><input type="checkbox" id="tkPE" ${mgr ? '' : 'disabled'}> Backup exit PIN</label>
    <div id="tkPinRow"><input class="f" id="tkPin" type="password" inputmode="numeric" data-kb="numeric" maxlength="8" placeholder="${st.exitPinSet ? 'PIN is set — type a new one to change it' : 'New PIN, 4 to 8 digits'}" autocomplete="off" ${mgr ? '' : 'disabled'}></div>
    <div id="tkMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="tkPw">Restart / Shut down PC…</button><button class="pbtn s" data-close>Close (Esc)</button><button class="pbtn g" id="tkOk">Save</button></div>`, () => {
    $('tkK').value = st.touchKeyboard || 'keypad'; $('tkF').checked = !!st.fullScreen; $('tkCD').checked = st.customerDisplay !== false; $('tkR').checked = !!st.registerMode; $('tkPE').checked = !!st.exitPinEnabled;
    const sh = () => { $('tkPinRow').style.display = $('tkPE').checked ? '' : 'none'; }; $('tkPE').onchange = sh; sh();
    // 1.2.1 customer screen welcome message + logo: live preview, nothing is sent until Save
    let logo = null, rmLogo = false; const shop = (S.user && S.user.shop) || '';
    $('cwW').value = st.custWelcome || ''; $('cwW2').value = st.custWelcome2 || '';
    const pv = () => {
      $('cwWn').textContent = $('cwW').value.length + ' / 40'; $('cwW2n').textContent = $('cwW2').value.length + ' / 80';
      $('cwPW').textContent = $('cwW').value.trim() || 'Welcome'; $('cwPW2').textContent = $('cwW2').value.trim() || shop;
      const src = logo || (!rmLogo && st.custLogo && st.custLogo.hash ? '/customer-logo?v=' + st.custLogo.hash : null);
      $('cwPI').style.display = src ? 'block' : 'none'; if (src) { if ($('cwPI').getAttribute('src') !== src) $('cwPI').src = src; } else $('cwPI').removeAttribute('src');
    };
    $('cwW').oninput = pv; $('cwW2').oninput = pv; pv();
    api('cust-messages').then(r => { // this shop's saved texts (welcome falls back to this PC's older welcome)
      if (!r || !r.ok || !document.getElementById('cmBox')) return; const m = r.messages || {};
      if (m.welcome) $('cwW').value = m.welcome; if (m.welcome2) $('cwW2').value = m.welcome2;
      CM_FIELDS.forEach(([k]) => { $('cm_' + k).value = m[k] || ''; }); pv();
    });
    $('cwPick').onclick = () => $('cwF').click();
    $('cwF').onchange = () => {
      const f = $('cwF').files[0]; $('cwF').value = ''; if (!f) return;
      if (!/^image\/(png|jpeg)$/.test(f.type)) return msgIn($('tkMsg'), { ok: false, message: 'Only PNG or JPG pictures can be used as the logo' });
      if (f.size > 500 * 1024) return msgIn($('tkMsg'), { ok: false, message: 'The logo is too big. Use a PNG or JPG of 500 KB or less' });
      const rd = new FileReader(); rd.onload = () => { logo = String(rd.result); rmLogo = false; pv(); }; rd.readAsDataURL(f);
    };
    $('cwRm').onclick = () => { logo = null; rmLogo = true; pv(); };
    // 1.0.10 welcome picture + register logo: picked file is previewed here (blob: URL) and only uploaded on Save
    const SP = () => S.screenPics || {}, pend = { welcome: null, saleLogo: null }, rm = { welcome: false, saleLogo: false }, urls = {};
    const wp0 = SP().welcome; $('wpFit').value = wp0 && wp0.fit === 'cover' ? 'cover' : 'contain'; $('wpFill').value = wp0 && /^#[0-9a-f]{6}$/i.test(wp0.fill) ? wp0.fill : '#1f3b57';
    const srcOf = k => pend[k] ? urls[k] : (!rm[k] && SP()[k] ? SP()[k].src : null);
    const pvPics = () => {
      const a = srcOf('welcome'), b = srcOf('saleLogo');
      $('wpPI').style.display = a ? 'block' : 'none'; $('wpPN').style.display = a ? 'none' : ''; if (a) { if ($('wpPI').getAttribute('src') !== a) $('wpPI').src = a; } else $('wpPI').removeAttribute('src');
      $('wpPI').style.objectFit = $('wpFit').value; $('wpPrev').style.background = $('wpFill').value;
      $('slPI').style.display = b ? 'block' : 'none'; $('slPN').style.display = b ? 'none' : ''; if (b) { if ($('slPI').getAttribute('src') !== b) $('slPI').src = b; } else $('slPI').removeAttribute('src');
    };
    $('wpFit').onchange = pvPics; $('wpFill').oninput = pvPics; pvPics();
    const pick = (k, input) => async () => {
      const f = input.files[0]; input.value = ''; if (!f) return;
      const h = new Uint8Array(await f.slice(0, 8).arrayBuffer()), png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => h[i] === x), jpg = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff;
      if (!png && !jpg) return msgIn($('tkMsg'), { ok: false, message: 'Only PNG or JPG pictures can be used (this file is not one, whatever its name says)' });
      if (f.size > 5 * 1024 * 1024) return msgIn($('tkMsg'), { ok: false, message: 'The picture is bigger than 5 MB. Save it smaller and try again' });
      if (urls[k]) URL.revokeObjectURL(urls[k]); urls[k] = URL.createObjectURL(f); pend[k] = f; rm[k] = false; pvPics();
    };
    $('wpPick').onclick = () => $('wpF').click(); $('wpF').onchange = pick('welcome', $('wpF'));
    $('slPick').onclick = () => $('slF').click(); $('slF').onchange = pick('saleLogo', $('slF'));
    $('wpRm').onclick = () => { pend.welcome = null; rm.welcome = true; pvPics(); };
    $('slRm').onclick = () => { pend.saleLogo = null; rm.saleLogo = true; pvPics(); };
    const savePics = async () => { // returns the first problem, or null
      const up = async (k, f) => { try { const r = await fetch('/api/screen-picture?kind=' + (k === 'welcome' ? 'welcome' : 'salelogo'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-AirMax-Upload': '1' }, body: f }); return await r.json(); } catch (e) { return { ok: false, message: 'Could not send the picture (' + e.message + ')' }; } };
      let bad = null;
      for (const k of ['welcome', 'saleLogo']) {
        let r = null;
        if (pend[k]) r = await up(k, pend[k]); else if (rm[k] && SP()[k]) r = await api('screen-picture-set', { kind: k, remove: true });
        if (r && !r.ok) { bad = bad || r; continue; }
        if (r) { pend[k] = null; rm[k] = false; if (urls[k]) { URL.revokeObjectURL(urls[k]); urls[k] = null; } }
      }
      const w = (await (await fetch('/api/state')).json()).screenPics || {};
      if (w.welcome && (w.welcome.fit !== $('wpFit').value || w.welcome.fill !== $('wpFill').value.toLowerCase())) { const r = await api('screen-picture-set', { kind: 'welcome', fit: $('wpFit').value, fill: $('wpFill').value }); if (!r.ok) bad = bad || r; }
      return bad;
    };
    $('tkPw').onclick = powerDialog;
    $('tkOk').onclick = async () => {
      const b = { touchKeyboard: $('tkK').value, fullScreen: $('tkF').checked, customerDisplay: $('tkCD').checked };
      if (mgr) { b.registerMode = $('tkR').checked; b.exitPinEnabled = $('tkPE').checked; if ($('tkPin').value) b.exitPin = $('tkPin').value; }
      if (mgr) { b.custWelcome = $('cwW').value; b.custWelcome2 = $('cwW2').value; if (logo) b.custLogo = logo; else if (rmLogo) b.custLogoRemove = true; }
      $('tkPin').value = '';
      let r = await api('settings', b);
      if (r.ok && mgr) { const cm = { welcome: $('cwW').value, welcome2: $('cwW2').value }; CM_FIELDS.forEach(([k]) => { cm[k] = $('cm_' + k).value; }); const r2 = await api('cust-messages-set', cm); if (!r2.ok) r = { ok: false, message: 'Saved, but the customer screen messages were not: ' + (r2.message || 'could not save') }; }
      const pb = r.ok && mgr ? await savePics() : null; await refresh(); if (r.ok) { logo = null; rmLogo = false; Object.assign(st, (S.settings || {})); pv(); pvPics(); }
      if (pb) return msgIn($('tkMsg'), { ok: false, message: 'Saved, but the picture was not: ' + (pb.message || 'it could not be saved') });
      msgIn($('tkMsg'), r.ok ? { ok: true, message: 'Saved.' + (b.registerMode !== st.registerMode || b.fullScreen !== st.fullScreen ? ' Restart Air Max for the window change.' : '') } : r);
    };
  });
}

// ---------- Settings: Remote Help (RustDesk). Shows the ID only — never the password. ----------
async function remoteDialog() {
  modal(`<h2>Remote Help</h2><div id="rhBody"><p class="note">Checking…</p></div><div id="rhMsg" class="msg"></div>
    <p class="note keep" style="font-size:11px">Remote help uses RustDesk, free open-source software (AGPL-3.0). License: &lt;install folder&gt;\\remote\\RustDesk-LICENSE-AGPL-3.0.txt</p>
    <div class="row2" id="rhBtns"><button class="pbtn s" data-close>Close (Esc)</button></div>`);
  const r = await api('remote-status'); if (!$('rhBody')) return;
  const status = !r.ok ? (r.message || 'Could not check') : !r.installed ? 'Not set up' : r.serviceRunning ? 'On (connected to the service)' : 'Installed but service stopped';
  $('rhBody').innerHTML = `<label class="f">Status</label><p><b>${esc(status)}</b></p>` + (r.installed ? `<label class="f">ID (give this to AK Local Solutions)</label>
    <div style="display:flex;gap:10px;align-items:center"><span class="rhid">${esc(r.idPretty || 'not available yet')}</span>${r.id ? '<button class="pbtn s" id="rhCopy">Copy</button>' : ''}</div>` : '');
  if ($('rhCopy')) $('rhCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(r.id); toast('ID copied', true); };
  const b = document.createElement('button'); b.className = 'pbtn g'; b.textContent = r.installed ? 'Make a new password' : 'Turn on remote help';
  const mode = r.installed ? 'reset' : 'install';
  b.onclick = () => managerLogin(b.textContent, 'A manager logs in to ' + (mode === 'reset' ? 'make a new remote help password.' : 'turn on remote help.'), async m => {
    const x = await api('remote-setup', { ...m, mode });
    if (x.ok) modal(`<h2>Remote Help</h2><p>${esc(x.message)}</p><p>Windows will ask for permission. The new password will show once. Write it down.</p><div class="row2"><button class="pbtn g" data-close>OK</button></div>`);
    return x;
  });
  if (r.ok) $('rhBtns').appendChild(b);
}
A['touch-settings'] = touchSettingsDialog; A['remote-help'] = remoteDialog;

// ---------- add the new panels + Export log to the Settings window (Ctrl+,) without changing the printer part ----------
const printerSettings = settingsDialog;
settingsDialog = async function () {
  await printerSettings();
  const row = $('modalRoot').querySelector('.row2'); if (!row || $('seMore')) return;
  const more = document.createElement('div'); more.id = 'seMore'; more.className = 'row2'; more.style.justifyContent = 'flex-start';
  more.innerHTML = '<button class="pbtn s" id="seTouch">Screens &amp; Register Mode…</button><button class="pbtn s" id="seRemote">Remote Help…</button><a class="pbtn s" id="seLog" href="/export/log" download="air-register-log.txt">Export log</a>';
  row.parentNode.insertBefore(more, row);
  $('seTouch').onclick = touchSettingsDialog; $('seRemote').onclick = remoteDialog;
};
A['settings'] = settingsDialog;

// ---------- touch keyboard mode (see touch.js) ----------
function applyTouchMode() { if (window.AirTouch) window.AirTouch.setMode((S.settings && S.settings.touchKeyboard) || 'keypad'); }
// Ctrl+P while the "Sale complete" box is open prints that receipt (same as P)
window.addEventListener('keydown', e => { if (e.ctrlKey && !e.shiftKey && (e.key === 'p' || e.key === 'P') && document.getElementById('dPrint')) { e.preventDefault(); e.stopImmediatePropagation(); document.getElementById('dPrint').click(); } }, true);

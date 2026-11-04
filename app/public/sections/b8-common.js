// Batch 8 (gift cards, store credit, cash fixes): small helpers the three Batch 8 screens share.
// Loaded first (name order) by the top bar; it draws nothing by itself.
(function () {
  if (window.AirMaxB8) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (Number(n) < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toFixed(2);
  const when = t => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? String(t).slice(0, 16) : d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  const day = t => { if (!t) return '-'; const d = new Date(t); return isNaN(d) ? '-' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); };
  const css = `
.b8{display:flex;gap:14px;align-items:flex-start;font-size:14px;color:var(--text,#1b2330)}
.b8 .b8nav{width:210px;flex:none;display:flex;flex-direction:column;gap:6px}
.b8 .b8nav h4{margin:4px 2px;font-size:12px;letter-spacing:.06em;color:#6b7686;text-transform:uppercase}
.b8 .b8nav button{text-align:left;padding:9px 12px;border:1px solid var(--line,#d7dde6);background:#fff;border-radius:8px;cursor:pointer;font-size:14px}
.b8 .b8nav button.on{background:#e8f0fe!important;color:#1b2330!important;border-color:#7aa5f5;font-weight:600}.b8 .b8nav button .small{font-weight:400;color:#5b6676}
.b8 .b8main{flex:1;min-width:0;background:#fff;border:1px solid var(--line,#d7dde6);border-radius:10px;padding:14px 16px}
.b8 h3{margin:0 0 10px;font-size:18px}
.b8 .b8bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.b8 input,.b8 select,.b8 textarea{font-size:15px;padding:8px 10px;border:1px solid #b9c3d1;border-radius:6px;background:#fff;min-width:0}
.b8 textarea{width:100%;box-sizing:border-box;min-height:64px;font-family:inherit}
.b8 label.f{display:block;margin:10px 0 3px;font-weight:600;font-size:13px}
.b8 button.pb{padding:9px 16px;border:0;border-radius:7px;background:#1f6feb;color:#fff;font-size:15px;cursor:pointer}
.b8 button.pb.g{background:#1a8f4c}.b8 button.pb.r{background:#c0392b}.b8 button.pb.s{background:#eef1f5;color:#1b2330;border:1px solid #c5ceda}
.b8 button:disabled{opacity:.5;cursor:default}
.b8 table{border-collapse:collapse;width:100%}
.b8 th,.b8 td{text-align:left;padding:7px 8px;border-bottom:1px solid #e7ebf1;font-size:14px}
.b8 th{font-size:12px;color:#6b7686;text-transform:uppercase;letter-spacing:.04em}
.b8 td.n,.b8 th.n{text-align:right}
.b8 .tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;background:#eef1f5}
.b8 .tag.ok{background:#dff3e6;color:#17663a}.b8 .tag.warn{background:#fdf0d5;color:#8a5a00}.b8 .tag.bad{background:#fbe0dc;color:#9b2c1f}.b8 .tag.mgr{background:#fff3cd;color:#7a5a00}
.b8 .box{border:1px solid #d7dde6;border-radius:8px;padding:10px 12px;margin:10px 0;background:#f8fafc}
.b8 .box.warn{background:#fff8e6;border-color:#f0d58a}.b8 .box.bad{background:#fdecea;border-color:#f0b4ac}.b8 .box.good{background:#eaf7ef;border-color:#a8d9bb}
.b8 .m{min-height:20px;margin:8px 0;font-size:14px}.b8 .m.err{color:#b3261e}.b8 .m.ok{color:#17663a}
.b8 .small{font-size:12.5px;color:#5b6676}
.b8 dl{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;margin:6px 0}.b8 dt{color:#5b6676}.b8 dd{margin:0;text-align:right;font-weight:600}
`;
  function style() { if (document.getElementById('b8css')) return; const s = document.createElement('style'); s.id = 'b8css'; s.textContent = css; document.head.appendChild(s); }
  // A manager approves with their own typed password (the same dialog as Tax Off / Restart PC).
  // go(body) is called with {user, password}; return null/undefined when it worked (the dialog closes), or the failed reply to show it.
  // A logged-in manager (AIR POS RetailManager, S.user.manager) is never asked for the password again: they get a plain
  // confirm card saying what will happen, and the server accepts their own login. Everyone else gets the password window.
  const isMgrLogin = () => { try { return !!(typeof S !== 'undefined' && S && S.user && S.user.manager === true); } catch (e) { return false; } };
  function manager(title, text, go) {
    if (isMgrLogin() && typeof modal === 'function') {
      const t = String(text || '').replace(/\s*A manager types their password to [a-z ]+\./gi, '').trim();
      modal(`<h2>${esc(title)}</h2><p class="note">${esc(t)}</p><div id="b8mMsg" class="msg"></div><div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button><button class="pbtn g" id="b8mOk">OK</button></div>`, () => {
        const ok = document.getElementById('b8mOk'), msg = document.getElementById('b8mMsg');
        ok.onclick = async () => { if (ok.disabled) return; ok.disabled = true; msg.textContent = 'Working…';
          let r; try { r = await go({}); } catch (e) { r = { ok: false, message: 'It did not work' }; }
          if (r && r.ok === false) { msg.textContent = r.message || 'It did not work'; ok.disabled = false; return; }
          if (typeof closeModal === 'function' && document.getElementById('b8mOk')) closeModal(); };
      });
      return;
    }
    if (typeof managerLogin !== 'function') { alert('The manager login is not available on this screen.'); return; }
    managerLogin(title, text, async m => { const r = await go(m); if (r && r.ok === false) return { ok: false, message: r.message || 'It did not work' }; if (typeof closeModal === 'function') closeModal(); return null; });
  }
  // a plain confirm window (our own, so Esc closes it and it follows the app look)
  function sure(html, yes, go, no) {
    if (typeof modal !== 'function') { if (confirm(html.replace(/<[^>]+>/g, ' '))) go(); return; }
    modal(html + `<div class="row2"><button class="pbtn s" data-close>${esc(no || 'Go back')} (Esc)</button><button class="pbtn g" id="b8Yes">${esc(yes)}</button></div>`, () => { document.getElementById('b8Yes').onclick = () => { if (typeof closeModal === 'function') closeModal(); go(); }; });
  }
  window.AirMaxB8 = { esc, money, when, day, style, manager, sure, isMgrLogin };
})();

// AirMax "Ask AirMax" (screen side). Plain script, loaded by topbar.js after login. Design: ASK-AIRMAX-DESIGN.md + the owner's later changes. New file only: no shared file is edited.
//  1. A "? Ask AirMax" button inserted right after the "F1 = keys" pill, only while the switch is On (Settings > Ask AirMax; default Off = no button for anyone).
//  2. A side panel BESIDE the screen: while it is open the Checkout screen (or any other screen) is narrowed by the panel width (a body class + one CSS rule from this
//     file); nothing is covered and nothing is renamed or moved. Closing removes the class and the layout is exactly as before. No new keyboard shortcut.
//  3. Answers are text. "Show me" only draws a ring on buttons that are already on screen (never clicks). "Do it for me" is offered only when the server sends a
//     validated offer from its fixed allowlist, always with a confirm card (before -> after) and Undo where possible. Nothing else an answer says is ever run.
//  4. The Settings page (manager only): AirMaxSettings.add when the Settings menu has that hook, else an "Ask AirMax" tab in the existing Settings window.
// The key is typed into a password box, sent once to the register's own server and never shown again; this file never sees a saved key.
(function () {
  'use strict';
  const g = window;
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const call = async (name, body) => { try { const r = await api(name, body || {}); return r && typeof r === 'object' ? r : { ok: false, kind: 'offline' }; } catch (e) { return { ok: false, kind: 'offline' }; } };
  const OFFLINE = "I can't reach the help service right now. Your sale is not affected. Check that this PC is online and try again. Meanwhile, press F1 to see the list of keys.";
  const EXAMPLES = ['How do I add a customer?', 'How do I open the drawer?', 'How do I print a label?'];
  let st = { on: false, ready: false, used: 0, budget: null, allowance: null, pct: 0, amber: false, reached: false, memory: 2 }, btn = null, panel = null, items = [], loaded = false, clearArm = 0, busy = false, token = 0, lastQ = '', loginKey = null, timer = null, show = null, unlock = null;
  let SHOW_MS = 0; // "Show me" waits for Next; AskAirMax._showMs(n) makes it move on by itself (tests use it)
  const css = `
#askBtn{appearance:none;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px 0 6px;border:1px solid #1a5fd0;border-radius:999px;background:#1a5fd0;color:#fff;font:700 12px/1 inherit;font-family:inherit;cursor:pointer;white-space:nowrap;flex:none}
#askBtn:hover{background:#154fb0} #askBtn .q{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#fff;color:#1a5fd0;font-size:11px;font-weight:900}
@media (max-width:1365px){#askBtn{padding:0;width:26px;justify-content:center}#askBtn .t{display:none}#askBtn .q{width:20px;height:20px;font-size:13px}}
#askPanel{position:fixed;z-index:60;display:flex;flex-direction:column;background:#fff;border-left:1px solid var(--ap-line,#e7eaec);box-shadow:-6px 0 18px rgba(20,40,80,.12);font-size:13px;color:var(--ap-text,#262626);box-sizing:border-box}
#askPanel[hidden]{display:none}
#askPanel .ahd{display:flex;align-items:center;gap:6px;padding:10px 10px;border-bottom:1px solid var(--ap-line,#e7eaec)}
#askPanel .ahd b{color:#1a5fd0;font-size:12px;letter-spacing:.5px}
#askPanel .new{font-size:10px;font-weight:700;color:#1a8a5a;background:#e7f6ee;border-radius:3px;padding:1px 5px}
#askPanel .ahd .sp{flex:1}
#askPanel .aclose{appearance:none;border:1px solid #d5dbe3;background:#f4f6f9;border-radius:4px;padding:3px 9px;font:600 11.5px inherit;font-family:inherit;cursor:pointer;color:#333}
#askPanel .aclear{appearance:none;border:0;background:none;color:#a01818;font:600 11.5px inherit;font-family:inherit;cursor:pointer;text-decoration:underline;padding:3px 4px}
#askPanel .aclear.arm{background:#a01818;color:#fff;text-decoration:none;border-radius:4px;padding:3px 8px}
#askPanel .aclose kbd{font:inherit;color:#778;margin-left:4px;font-weight:500}
#askPanel .ahd b,#askPanel .ahd button,#askPanel .ahd .new{white-space:nowrap}
#askPanel .abody{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:9px}
#askPanel .intro{border-left:3px solid #1a5fd0;background:#eef4ff;padding:7px 9px;font-size:12px;color:#334}
#askPanel .me{align-self:flex-end;max-width:88%;background:#1a5fd0;color:#fff;padding:7px 11px;border-radius:12px 12px 2px 12px;word-wrap:break-word}
#askPanel .bot{align-self:flex-start;max-width:96%;background:#fff;border:1px solid #dfe3e8;border-radius:10px;padding:8px 10px;line-height:1.5}
#askPanel .bot ol{margin:4px 0 4px 18px;padding:0} #askPanel .bot p{margin:2px 0}
#askPanel .only{background:#fff7e0;border:1px solid #f0d58a;color:#7a5a00;padding:6px 8px;border-radius:5px;margin-bottom:6px;font-weight:600;font-size:12px}
#askPanel .kb{display:inline-block;border:1px solid #c9d1dc;background:#f4f6f9;border-radius:4px;padding:0 5px;font-size:11.5px;font-weight:600;line-height:18px}
#askPanel .from{margin-top:6px;font-size:11px;color:#778} #askPanel .from span{display:inline-block;background:#eef1f5;border-radius:9px;padding:1px 7px;margin-left:4px}
#askPanel .note{font-size:11px;color:#778;margin-top:4px}
#askPanel .err{align-self:stretch;background:#fff0f0;border:1px solid #f5c6c6;color:#7b1e1e;border-radius:6px;padding:8px 10px}
#askPanel .err b{display:block;color:#a01818;margin-bottom:3px} #askPanel .err button{margin-top:6px;appearance:none;border:1px solid #d5dbe3;background:#fff;border-radius:4px;padding:3px 10px;font:600 11.5px inherit;font-family:inherit;cursor:pointer}
#askPanel .think{align-self:flex-start;color:#778;font-style:italic;padding:2px 4px}
#askPanel .chips{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:4px 12px}
#askPanel .chips button{appearance:none;border:1px solid #c5d4ee;background:#fff;color:#1a5fd0;border-radius:999px;padding:3px 10px;font:600 11.5px inherit;font-family:inherit;cursor:pointer}
#askPanel .afoot{border-top:1px solid var(--ap-line,#e7eaec);padding:8px 12px 6px}
#askPanel .arow{display:flex;gap:8px;align-items:stretch}
#askPanel textarea{flex:1;resize:none;height:42px;border:1px solid #c9d1dc;border-radius:4px;padding:6px 8px;font:inherit;font-family:inherit;box-sizing:border-box}
#askPanel .go{appearance:none;border:0;background:#1a5fd0;color:#fff;font:700 13px inherit;font-family:inherit;border-radius:4px;padding:0 16px;cursor:pointer} #askPanel .go[disabled]{opacity:.5;cursor:default}
#askPanel .sub{margin-top:5px;font-size:10.5px;color:#778;line-height:1.3}
/* Settings page */
.aks{font-family:inherit;color:var(--ap-text,#262626);max-width:760px}
.aks h3{margin:0 0 6px;font-size:16px} .aks h3 .tg{font-size:10px;font-weight:700;color:#1a8a5a;background:#e7f6ee;border-radius:3px;padding:1px 5px;margin-left:6px;vertical-align:middle} .aks h3 .tg.pc{color:#555;background:#eceff3}
.aks p.d{color:#556;font-size:12.5px;margin:0 0 10px}
.aks .card{border:1px solid #dfe3e8;background:#fff;border-radius:5px;padding:10px 12px;margin-bottom:10px}
.aks .sw{display:flex;align-items:center;gap:10px} .aks .sw b{font-size:14px} .aks .sw small{display:block;color:#667;font-size:11.5px}
.aks .tgl{position:relative;width:40px;height:22px;flex:none} .aks .tgl input{opacity:0;position:absolute;inset:0;margin:0;cursor:pointer;z-index:1} .aks .tgl i{position:absolute;inset:0;border-radius:11px;background:#c5ccd6;transition:.15s} .aks .tgl i:after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.15s} .aks .tgl input:checked+i{background:#18a566} .aks .tgl input:checked+i:after{left:20px}
.aks h4{margin:12px 0 5px;font-size:11.5px;letter-spacing:.6px;color:#556}
.aks label{display:block;font-weight:600;font-size:12px;margin:8px 0 3px} .aks label .tg{font-weight:700;font-size:10px;color:#1a8a5a;background:#e7f6ee;border-radius:3px;padding:1px 5px;margin-left:4px} .aks label a{font-weight:500;margin-left:8px;color:#1a5fd0;cursor:pointer;text-decoration:underline}
.aks input[type=password],.aks input[type=number],.aks select{width:100%;box-sizing:border-box;border:1px solid #c9d1dc;border-radius:4px;padding:7px 9px;font:inherit;font-family:inherit;background:#fff}
.aks .two{display:grid;grid-template-columns:1fr 1fr;gap:12px} .aks .hint{font-size:11px;color:#667;margin-top:4px}
.aks .btns{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap} .aks .btns button{appearance:none;border:1px solid #c9d1dc;background:#eef1f5;border-radius:4px;padding:7px 14px;font:600 13px inherit;font-family:inherit;cursor:pointer} .aks .btns button.p{background:#1a5fd0;border-color:#1a5fd0;color:#fff}
.aks .pill{font-size:11px;font-weight:700;border-radius:10px;padding:2px 9px;background:#e7f6ee;color:#1a8a5a} .aks .pill.bad{background:#fdeaea;color:#b02020}
.aks .sent{font-size:12.5px;line-height:1.5} .aks .msg{font-size:12px;margin-top:6px;min-height:16px;color:#b02020} .aks .msg.ok{color:#1a8a5a}
.sttabs button[data-tab=askmax] kbd:empty{display:none}`;

  const css2 = `
/* beside, not over: the screen is narrowed by the panel width while it is open (removed again on close) */
body.askOpen #app > .wrap, body.askOpen #app > .sectionhost{margin-right:var(--ask-w,0px)}
#askPanel{box-shadow:none}
#askPanel .bar{margin:0 0 6px} #askPanel .bar .bl{display:flex;justify-content:space-between;gap:6px;font-size:11px;color:#556;margin-bottom:3px} #askPanel .bar .bl b{font-weight:700}
#askPanel .trk{height:7px;border-radius:4px;background:#e6eaf0;overflow:hidden} #askPanel .trk i{display:block;height:100%;width:0;background:#1a5fd0;border-radius:4px;transition:width .2s}
#askPanel .bar.amber .trk i{background:#e8a317} #askPanel .bar.amber .bl b{color:#9a6a00} #askPanel .bar.full .trk i{background:#c0392b} #askPanel .bar.full .bl b{color:#a01818}
#askPanel .tk{margin-top:5px;font-size:10.5px;color:#8a93a0}
#askPanel .lab{display:inline-block;font-size:10.5px;font-weight:700;border-radius:9px;padding:1px 8px;margin-bottom:5px} #askPanel .lab.web{background:#e9f0ff;color:#1a4fb0} #askPanel .lab.saved{background:#e7f6ee;color:#1a7a50}
#askPanel .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;align-items:center}
#askPanel .acts button,#askPanel .card button,#askPanel .lim button{appearance:none;border:1px solid #c5d4ee;background:#fff;color:#1a5fd0;border-radius:4px;padding:3px 10px;font:600 11.5px inherit;font-family:inherit;cursor:pointer}
#askPanel .acts button.p,#askPanel .card button.p,#askPanel .lim button.p{background:#1a5fd0;border-color:#1a5fd0;color:#fff} #askPanel .acts button[disabled],#askPanel .card button[disabled]{opacity:.5;cursor:default}
#askPanel .acts .sp2{flex:1} #askPanel .acts .vote{color:#445;border-color:#d5dbe3}
#askPanel .thx{font-size:11px;color:#1a7a50;font-weight:600}
#askPanel .card{border:1px solid #c5d4ee;background:#f6f9ff;border-radius:6px;padding:8px 10px;margin-top:7px;font-size:12px}
#askPanel .card h5{margin:0 0 4px;font-size:12px;color:#1a4fb0} #askPanel .card .chg{margin:4px 0;padding:5px 7px;background:#fff;border:1px solid #dfe3e8;border-radius:4px}
#askPanel .card .chg b{display:block;font-size:11.5px} #askPanel .card .chg .ba{color:#334} #askPanel .card .chg .arr{color:#1a5fd0;font-weight:800;margin:0 4px}
#askPanel .card.ok{border-color:#a9dcc2;background:#f0faf5} #askPanel .card.ok h5{color:#1a7a50} #askPanel .card.bad{border-color:#f0b8b8;background:#fff5f5} #askPanel .card.bad h5{color:#a01818}
#askPanel .card input{width:100%;box-sizing:border-box;border:1px solid #c9d1dc;border-radius:4px;padding:5px 7px;font:inherit;font-family:inherit;margin:3px 0} #askPanel .card .row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
#askPanel .contact{border:1px solid #e1d7b5;background:#fffdf3;border-radius:6px;padding:8px 10px;margin-top:7px;font-size:12px} #askPanel .contact h5{margin:0 0 3px;font-size:12px;color:#6b5a1a}
#askPanel .contact .rw{display:flex;gap:6px} #askPanel .contact .rw span:first-child{color:#778;min-width:48px} #askPanel .contact .soon{color:#7a6a30;font-style:italic}
#askPanel .lim{align-self:stretch;border:1px solid #f0b8b8;background:#fff5f5;border-radius:6px;padding:9px 11px;color:#6b1e1e} #askPanel .lim b{display:block;color:#a01818;margin-bottom:3px} #askPanel .lim .card{background:#fff;color:#223}
#askPanel .sm{align-self:stretch;border:1px solid #f1d28a;background:#fff9e8;border-radius:6px;padding:8px 10px;font-size:12px}
#askPanel .sm b{display:block;color:#8a5a00;margin-bottom:4px} #askPanel .sm .row{display:flex;gap:6px;margin-top:6px}
.askRing{position:fixed;z-index:9000;pointer-events:none;border:3px solid #f59e0b;border-radius:8px;box-shadow:0 0 0 4px rgba(245,158,11,.35),0 0 18px rgba(245,158,11,.7);animation:askPulse 1s ease-in-out infinite;box-sizing:border-box}
.askRing .n{position:absolute;top:-13px;left:-13px;width:22px;height:22px;border-radius:50%;background:#f59e0b;color:#fff;font:800 12px/22px system-ui,sans-serif;text-align:center}
@keyframes askPulse{0%,100%{box-shadow:0 0 0 3px rgba(245,158,11,.25),0 0 10px rgba(245,158,11,.5)}50%{box-shadow:0 0 0 7px rgba(245,158,11,.4),0 0 22px rgba(245,158,11,.8)}}
.aks .bar{margin:6px 0} .aks .bar .bl{display:flex;justify-content:space-between;font-size:12px;color:#445;margin-bottom:3px} .aks .trk{height:9px;border-radius:5px;background:#e6eaf0;overflow:hidden} .aks .trk i{display:block;height:100%;background:#1a5fd0;border-radius:5px}
.aks .bar.amber .trk i{background:#e8a317} .aks .bar.full .trk i{background:#c0392b}
.aks table.us{border-collapse:collapse;font-size:12.5px;width:100%;margin-top:6px} .aks table.us td,.aks table.us th{text-align:left;padding:3px 8px 3px 0;border-bottom:1px solid #eef1f5;font-weight:400} .aks table.us th{color:#667;font-size:11.5px;font-weight:600} .aks table.us td:not(:first-child),.aks table.us th:not(:first-child){text-align:right}
.aks .est{font-size:11px;color:#778;margin-top:5px}
.aks .tg2{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px} .aks .tg2 input{margin:0}
.aks select.fm{width:auto;padding:6px 8px}
`;
  const styled = () => { if (!document.getElementById('askStyle')) { const s = document.createElement('style'); s.id = 'askStyle'; s.textContent = css + css2; document.head.appendChild(s); } };

  // ---------- helpers ----------
  const num = n => (Number.isFinite(+n) ? Math.round(+n) : 0).toLocaleString('en-US');
  const short = n => { n = Math.round(+n || 0); return n < 1000 ? String(n) : n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : n < 1e6 ? Math.round(n / 1000) + 'k' : (n / 1e6).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + 'M'; };
  const usd = n => '$' + (+n || 0).toFixed((+n || 0) >= 1 ? 2 : 4);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btnEl = (text, cls, fn) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; };

  // ---------- question clean-up in the browser (first pass; the server does it again and is the one that counts) ----------
  function redact(q) {
    let s = String(q || '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' '), removed = false;
    s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, () => { removed = true; return '[email removed]'; });
    s = s.replace(/\b[A-Za-z0-9_-]{16,}\b/g, m => ((m.match(/\d/g) || []).length >= 6 ? (removed = true, '[code removed]') : m));
    s = s.replace(/[+(]?\d[\d\s().-]{3,}\d/g, m => ((m.match(/\d/g) || []).length >= 5 ? (removed = true, '[number removed]') : m));
    return { text: s.replace(/\s+/g, ' ').trim().slice(0, 300), removed };
  }
  const stFrom = r => ({ budget: r.budget == null ? null : r.budget, used: r.used || 0, allowance: r.allowance == null ? null : r.allowance, pct: r.pct || 0, amber: !!r.amber, reached: !!r.reached });

  // ---------- status + button ----------
  async function refreshStatus() {
    if (!(typeof S !== 'undefined' && S.loggedIn)) { st = { ...st, on: false }; paintBtn(); return; }
    const r = await call('ask-status');
    if (r && r.ok) st = { ...st, on: !!r.on, ready: !!r.ready, screen: !!r.screen, memory: Number.isFinite(r.memory) ? r.memory : 2, ...stFrom(r) }; // a failed check keeps the last state
    paintBtn(); if (panel && !panel.hidden) drawFoot();
  }
  function paintBtn() {
    const showIt = st.on && typeof S !== 'undefined' && S.loggedIn && S.mode !== 'clockin', help = document.getElementById('helpPill');
    if (!showIt) { if (btn) { btn.remove(); btn = null; } closePanel(true); return; }
    if (!help) return;
    if (!btn) {
      styled(); btn = document.createElement('button'); btn.id = 'askBtn'; btn.type = 'button'; btn.title = 'Ask AirMax'; btn.setAttribute('aria-label', 'Ask AirMax');
      btn.innerHTML = '<span class="q" aria-hidden="true">?</span><span class="t">Ask AirMax</span>'; btn.onclick = () => (panel && !panel.hidden ? closePanel() : openPanel());
      btn.addEventListener('mousedown', e => e.preventDefault()); // opening does not take focus away from the scan box
    }
    if (btn.previousElementSibling !== help) help.after(btn);
  }

  // ---------- panel: sits BESIDE the screen. While open, the screen is narrowed by the panel width (body.askOpen + --ask-w); nothing is covered ----------
  const panelW = () => Math.max(300, Math.min(380, Math.round(innerWidth * 0.235)));
  function place() {
    if (!panel) return; const top = document.querySelector('#app .top'), bot = document.querySelector('#app .status');
    const t = top ? top.getBoundingClientRect().bottom : 56, b = bot ? bot.getBoundingClientRect().top : innerHeight - 26, w = panelW();
    document.documentElement.style.setProperty('--ask-w', w + 'px');
    Object.assign(panel.style, { top: t + 'px', height: Math.max(200, b - t) + 'px', width: w + 'px', right: '0px' });
  }
  function build() {
    styled(); panel = document.createElement('div'); panel.id = 'askPanel'; panel.hidden = true; panel.setAttribute('role', 'complementary'); panel.setAttribute('aria-label', 'Ask AirMax');
    panel.innerHTML = '<div class="ahd"><b>ASK AIRMAX</b><span class="new">new</span><span class="sp"></span><button type="button" class="aclear" id="askClear" hidden>Clear history</button><button type="button" class="aclose" id="askClose">Close <kbd>Esc</kbd></button></div>' +
      '<div class="abody" id="askBody"></div><div class="chips" id="askChips"></div>' +
      '<div class="afoot"><div class="bar" id="askBar"></div><div class="arow"><textarea id="askIn" maxlength="300" placeholder="Type your question here" aria-label="Your question"></textarea><button type="button" class="go" id="askGo">Ask</button></div>' +
      '<div class="sub">Only your question is sent. Card and phone numbers are removed.</div><div class="sub" id="askShotNote" hidden></div></div>';
    document.body.appendChild(panel);
    document.getElementById('askClose').onclick = () => closePanel();
    document.getElementById('askGo').onclick = () => send();
    document.getElementById('askClear').onclick = clearHistory;
    document.getElementById('askIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); send(); } });
    addEventListener('resize', place);
  }
  function openPanel() {
    if (!st.on) return; if (!panel) build(); panel.hidden = false; document.body.classList.add('askOpen'); place(); draw(); loadHistory(); refreshStatus();
    if (!timer) timer = setInterval(place, 1500);
  }
  function closePanel(quiet) { // closing keeps the history: it is saved on this PC and comes back when the panel is opened again. The screen goes back to its full width.
    if (!panel || panel.hidden) return;
    stopShow(); token++; busy = false; panel.hidden = true; document.body.classList.remove('askOpen'); document.documentElement.style.removeProperty('--ask-w');
    if (timer) { clearInterval(timer); timer = null; }
    if (!quiet && typeof focusScan === 'function') focusScan(); // closing puts the cursor back in the scan box
  }
  async function loadHistory() { // the saved history lives on this PC (server side); the panel shows it again every time it opens
    const r = await call('ask-history'); if (!(r && r.ok && Array.isArray(r.entries))) return;
    if (busy) return; const keep = new Map(items.filter(i => i.t).map(i => [i.t, i]));
    items = r.entries.map(e => Object.assign({ q: e.q, answer: e.answer, howtoOnly: e.howtoOnly, howtoLine: e.howtoLine, sources: e.sources, removed: e.removed, t: e.t, origin: e.origin, lid: e.lid, tokens: e.tokens }, keep.get(e.t) ? { voted: keep.get(e.t).voted, removedSaved: keep.get(e.t).removedSaved, contact: keep.get(e.t).contact, act: keep.get(e.t).act } : {}));
    loaded = true; draw();
  }
  async function clearHistory() {
    const b = document.getElementById('askClear'); if (!clearArm) { clearArm = setTimeout(() => { clearArm = 0; if (b) { b.classList.remove('arm'); b.textContent = 'Clear history'; } }, 4000); b.classList.add('arm'); b.textContent = 'Confirm clear'; return; }
    clearTimeout(clearArm); clearArm = 0; b.classList.remove('arm'); b.textContent = 'Clear history';
    const r = await call('ask-history-clear'); if (r && r.ok) { items = []; draw(); } else { items.push({ err: true, message: (r && r.message) || OFFLINE }); draw(); }
  }
  // Esc: stops "Show me" first; otherwise closes the panel only when the cursor is in it. Anywhere else Esc does what it did before (window capture runs before the register's own key handler)
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (show) { e.preventDefault(); e.stopImmediatePropagation(); stopShow(); return; }
    if (panel && !panel.hidden && panel.contains(document.activeElement)) { e.preventDefault(); e.stopImmediatePropagation(); closePanel(); }
  }, true);
  // while the question box has the cursor the register must not pull it back to the scan box
  if (typeof g.focusScan === 'function') { const f0 = g.focusScan; g.focusScan = function () { if (panel && !panel.hidden && panel.contains(document.activeElement)) return; return f0.apply(this, arguments); }; }
  // The register's own Esc handler (shortcut-core) runs first and calls A.close, so wrap that one function the way topbar.js does: Esc stops "Show me", or closes the panel when the cursor is IN the panel; any other time it does exactly what it did.
  try {
    if (typeof A !== 'undefined' && A && typeof A.close === 'function' && !A.close.__ask) {
      const c0 = A.close; A.close = function () { if (show) { stopShow(); return; } if (panel && !panel.hidden && panel.contains(document.activeElement)) { closePanel(); return; } return c0.apply(this, arguments); }; A.close.__ask = true;
    }
  } catch (e) { console.warn('Ask AirMax: Esc hook not added', e); }

  // ---------- drawing text: plain text only; [Button] and {Key} are styled, nothing else ----------
  function rich(e, text) {
    String(text).split(/(\[[^\]\n]{1,40}\]|\{[^}\n]{1,24}\})/).forEach(part => {
      if (!part) return; const m = /^\[(.+)\]$/.exec(part) || /^\{(.+)\}$/.exec(part);
      if (m) e.appendChild(el('span', 'kb', m[1])); else e.appendChild(document.createTextNode(part));
    });
  }
  const labelsIn = text => { const out = []; String(text || '').replace(/\[([^\]\n]{1,40})\]/g, (m, l) => { if (!/removed$/i.test(l) && !out.includes(l)) out.push(l); return m; }); return out; };
  function changesNode(list) {
    const d = document.createDocumentFragment();
    (Array.isArray(list) ? list : []).slice(0, 4).forEach(c => { const x = el('div', 'chg'); x.appendChild(el('b', '', String((c && c.what) || ''))); const ba = el('div', 'ba'); ba.appendChild(document.createTextNode(String(c && c.before != null ? c.before : ''))); ba.appendChild(el('span', 'arr', '→')); ba.appendChild(document.createTextNode(String(c && c.after != null ? c.after : ''))); x.appendChild(ba); d.appendChild(x); });
    return d;
  }
  // who to contact: the data comes from app/howto/contacts.json through the server. Anything odd or missing shows "Contact details coming soon", never an error.
  function contactNode(c) {
    const d = el('div', 'contact'); d.id = 'askContact'; const ok = c && typeof c === 'object';
    d.appendChild(el('h5', '', 'Who to contact' + (ok && c.name ? ': ' + String(c.name).slice(0, 60) : '')));
    if (ok && c.what) d.appendChild(el('div', '', String(c.what).slice(0, 120)));
    const rows = ok && Array.isArray(c.rows) ? c.rows.filter(r => r && r.value && String(r.value).trim()) : [];
    if (!ok || c.soon || !rows.length) d.appendChild(el('div', 'soon', 'Contact details coming soon'));
    else rows.slice(0, 6).forEach(r => { const w = el('div', 'rw'); w.appendChild(el('span', '', String(r.label || '').slice(0, 20))); w.appendChild(el('span', '', String(r.value).slice(0, 120))); d.appendChild(w); });
    return d;
  }
  function actNode(it) { // Do it for me: confirm card -> result card (+ Undo)
    const a = it.act, d = el('div'); if (!a) return d;
    if (a.phase === 'plan') {
      const c = el('div', 'card'); c.id = 'askConfirm'; c.appendChild(el('h5', '', 'Please confirm: ' + a.title)); c.appendChild(changesNode(a.changes));
      c.appendChild(el('div', 'note', (a.undoable ? 'You can undo this afterwards.' : 'This cannot be undone from here.') + ' Nothing changes until you press Confirm.'));
      const r = el('div', 'row'); const ok = btnEl('Confirm', 'p', () => runAct(it)); ok.id = 'askActOk'; r.appendChild(ok);
      const no = btnEl('Cancel', '', () => { call('ask-action-cancel', { token: a.token }); it.act = null; it.action = null; draw(); }); no.id = 'askActNo'; r.appendChild(no); c.appendChild(r); d.appendChild(c);
    } else if (a.phase === 'done' || a.phase === 'undone') {
      const c = el('div', 'card ok'); c.id = 'askResult'; c.appendChild(el('h5', '', a.phase === 'undone' ? 'Put back' : 'Done')); if (a.message) c.appendChild(el('div', '', a.message)); if (a.phase === 'done') c.appendChild(changesNode(a.changes));
      if (a.phase === 'done' && a.runId) { const r = el('div', 'row'); const u = btnEl('Undo', '', () => undoAct(it)); u.id = 'askActUndo'; r.appendChild(u); c.appendChild(r); } d.appendChild(c);
    } else if (a.phase === 'fail') {
      const c = el('div', 'card bad'); c.id = 'askResult'; c.appendChild(el('h5', '', 'That did not work')); c.appendChild(el('div', '', a.message || 'Nothing was changed.')); d.appendChild(c); d.appendChild(contactNode(a.contact));
    }
    return d;
  }
  function answerNode(it) {
    const d = el('div', 'bot');
    if (it.origin === 'web') { const l = el('div', 'lab web', 'From the web'); l.id = 'askWebLabel'; d.appendChild(l); }
    else if (it.origin === 'saved') { const l = el('div', 'lab saved', 'Saved answer'); l.className = 'lab saved'; d.appendChild(l); }
    if (it.howtoOnly) d.appendChild(el('div', 'only', it.howtoLine || 'Steps only. Nothing was changed.'));
    let ol = null;
    String(it.answer || '').split('\n').forEach(line => {
      const l = line.trim(); if (!l) return; const m = /^(\d+)[.)]\s+(.*)$/.exec(l);
      if (m) { if (!ol) { ol = el('ol'); d.appendChild(ol); } const li = el('li'); rich(li, m[2]); ol.appendChild(li); }
      else { ol = null; const p = el('p'); rich(p, l); d.appendChild(p); }
    });
    if (it.sources && it.sources.length) { const f = el('div', 'from', 'From:'); it.sources.forEach(s => f.appendChild(el('span', '', s))); d.appendChild(f); }
    if (it.removed) d.appendChild(el('div', 'note', 'I removed a number from your question. You never need to type numbers to ask how.'));
    const acts = el('div', 'acts'), labs = labelsIn(it.answer);
    if (labs.length) { const b = btnEl('Show me', '', () => startShow(labs)); b.className = 'showme'; acts.appendChild(b); }
    if (it.action && !it.act) { const b = btnEl('Do it for me', 'p', () => planAct(it)); b.className = 'p doit'; b.title = it.action.title || ''; acts.appendChild(b); }
    if (it.t && !it.voted) { acts.appendChild(el('span', 'sp2')); const y = btnEl('Helpful', 'vote', () => vote(it, true)); y.className = 'vote yes'; const n = btnEl('Not helpful', 'vote', () => vote(it, false)); n.className = 'vote no'; acts.appendChild(y); acts.appendChild(n); }
    else if (it.voted) { acts.appendChild(el('span', 'sp2')); acts.appendChild(el('span', 'thx', it.voted === 'no' && it.removedSaved ? 'Thanks. I removed that saved answer.' : 'Thanks for letting me know.')); }
    if (acts.childNodes.length) d.appendChild(acts);
    if (it.action && !it.act) d.appendChild(el('div', 'note', 'I can do this for you: ' + String(it.action.title || '') + '. You will see exactly what changes before anything happens.'));
    d.appendChild(actNode(it));
    if (it.contact && it.voted !== 'yes') d.appendChild(contactNode(it.contact));
    if (it.tokens != null) { const t = el('div', 'tk', it.origin === 'saved' || it.tokens === 0 ? 'Saved answer: no tokens used' : num(it.tokens) + ' tokens'); t.className = 'tk'; d.appendChild(t); }
    if (it.shot) d.appendChild(el('div', 'tk', 'Screenshot with sale and customer info hidden was sent')); else if (it.shotNo) d.appendChild(el('div', 'tk', 'No screenshot was sent this time'));
    return d;
  }
  function errNode(it) {
    const d = el('div', 'err'); const msg = String(it.message || OFFLINE), i = msg.indexOf('. '), head = i > 0 ? msg.slice(0, i + 1) : msg, rest = i > 0 ? msg.slice(i + 2) : '';
    d.appendChild(el('b', '', head)); if (rest) d.appendChild(document.createTextNode(rest));
    if (it.retry && lastQ) { const r = el('div'); r.appendChild(btnEl('Try again', '', () => send(lastQ, true))); d.appendChild(r); }
    return d;
  }

  // ---------- usage bar + the "allowance used up" card with the manager unlock ----------
  function barNode() {
    const d = el('div'); d.className = 'bar' + (st.reached ? ' full' : st.amber ? ' amber' : ''); d.id = 'askBar';
    const l = el('div', 'bl'); l.appendChild(el('span', '', st.reached ? 'Today\'s allowance used up' : st.amber ? 'Almost used up today' : 'Used today'));
    l.appendChild(el('b', '', st.budget == null ? short(st.used) + ' tokens' : short(st.used) + ' of ' + short(st.allowance || st.budget) + ' tokens')); d.appendChild(l);
    const t = el('div', 'trk'), i = el('i'); i.style.width = (st.budget == null ? 0 : st.reached ? 100 : st.pct) + '%'; t.appendChild(i); d.appendChild(t); return d;
  }
  function drawFoot() {
    if (!panel) return; const old = document.getElementById('askBar'); if (old) old.replaceWith(barNode());
    const sn = document.getElementById('askShotNote'); if (sn) { sn.hidden = !st.screen; sn.textContent = 'A screenshot with sale and customer info hidden is sent with your question.'; }
    const ta = document.getElementById('askIn'), go = document.getElementById('askGo');
    if (ta) { ta.disabled = !!st.reached; ta.placeholder = st.reached ? 'Today\'s allowance is used up' : 'Type your question here'; } if (go) go.disabled = busy || !!st.reached;
  }
  function unlockNode() {
    const d = el('div', 'lim'); d.id = 'askLimit'; d.appendChild(el('b', '', 'Today\'s Ask AirMax allowance is used up.')); d.appendChild(document.createTextNode('Checkout is not affected. A manager can add more for today, or try again tomorrow.'));
    if (!unlock) { const r = el('div', 'acts'); const b = btnEl('Manager unlock', 'p', openUnlock); b.id = 'askUnlockBtn'; r.appendChild(b); d.appendChild(r); return d; }
    const c = el('div', 'card'); c.id = 'askUnlock';
    if (unlock.loading) { c.appendChild(el('div', '', 'One moment...')); d.appendChild(c); return d; }
    c.appendChild(el('h5', '', 'Add more for today'));
    const cost = el('div', '', 'This adds ' + num(unlock.extra) + ' tokens for today only. Estimated cost: about ' + usd(unlock.extraCost) + ' (an estimate, not a bill).'); cost.id = 'askUnlockCost'; c.appendChild(cost);
    if (unlock.needPassword) {
      c.appendChild(el('div', 'note', 'A manager must approve. Enter a manager user name and password.'));
      const u = el('input'); u.type = 'text'; u.id = 'askMgrUser'; u.placeholder = 'Manager user name'; u.autocomplete = 'off';
      const p = el('input'); p.type = 'password'; p.id = 'askMgrPw'; p.placeholder = 'Manager password'; p.autocomplete = 'off'; p.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doUnlock(); } });
      c.appendChild(u); c.appendChild(p);
    } else c.appendChild(el('div', 'note', 'You are logged in as a manager. Press Confirm to add it.'));
    if (unlock.msg) { const m = el('div', 'note', unlock.msg); m.id = 'askUnlockMsg'; m.style.color = '#a01818'; c.appendChild(m); }
    const r = el('div', 'row'); const ok = btnEl('Confirm and add', 'p', doUnlock); ok.id = 'askUnlockGo'; r.appendChild(ok); r.appendChild(btnEl('Cancel', '', () => { unlock = null; draw(); })); c.appendChild(r); d.appendChild(c); return d;
  }
  async function openUnlock() {
    unlock = { loading: true }; draw(); const r = await call('ask-unlock-info');
    if (r && r.ok && r.reached) unlock = { extra: r.extra, extraCost: r.extraCost, needPassword: !!r.needPassword }; else { unlock = null; if (r && r.ok) await refreshStatus(); }
    draw(); const u = document.getElementById('askMgrUser') || document.getElementById('askUnlockGo'); if (u) u.focus();
  }
  async function doUnlock() {
    if (!unlock || unlock.loading) return; const body = { confirm: true };
    if (unlock.needPassword) { body.user = (document.getElementById('askMgrUser') || {}).value || ''; body.password = (document.getElementById('askMgrPw') || {}).value || ''; }
    const r = await call('ask-unlock', body);
    if (r && r.ok) { unlock = null; st = { ...st, ...stFrom(r) }; draw(); const ta = document.getElementById('askIn'); if (ta) ta.focus(); }
    else { unlock = { ...unlock, msg: (r && r.message) || OFFLINE }; draw(); const p = document.getElementById('askMgrPw'); if (p) p.focus(); }
  }

  // ---------- Do it for me (the server only offers actions from its fixed list; every one needs this confirm) ----------
  async function planAct(it) {
    const r = await call('ask-action-plan', { token: it.action.token });
    if (r && r.ok) it.act = { phase: 'plan', token: it.action.token, title: r.title || it.action.title, changes: r.changes, undoable: r.undoable };
    else { it.act = { phase: 'fail', message: (r && r.message) || OFFLINE }; it.action = null; }
    draw();
  }
  async function runAct(it) {
    const a = it.act; if (!a || a.phase !== 'plan') return; const r = await call('ask-action-run', { token: a.token, confirm: true });
    if (r && r.ok) it.act = { phase: 'done', message: r.message, changes: r.changes, runId: r.runId };
    else { it.act = { phase: 'fail', message: (r && r.message) || OFFLINE, contact: r && r.contact }; it.action = null; }
    draw();
  }
  async function undoAct(it) {
    const a = it.act; if (!a || !a.runId) return; const r = await call('ask-action-undo', { runId: a.runId });
    if (r && r.ok) it.act = { phase: 'undone', message: r.message || 'Put back the way it was.' }; else it.act = { ...a, runId: '', message: (r && r.message) || 'I could not undo that.' };
    draw();
  }
  async function vote(it, good) {
    if (!it.t) return; const r = await call('ask-feedback', { t: it.t, helpful: good });
    if (r && r.ok) { it.voted = good ? 'yes' : 'no'; it.removedSaved = !!r.removed; if (!good) it.contact = r.contact || { soon: true }; draw(); }
  }

  // ---------- Show me: a ring on the buttons the answer names, one after another. It never clicks, renames or moves anything ----------
  const SEL = 'button,a,[role=button],[role=tab],.tab,.abtn,.rbtn,.tile,.sttab,.pbtn,[data-act]';
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  function findEl(label) {
    const want = norm(label); if (!want) return null; let best = null, bl = 1e9;
    document.querySelectorAll(SEL).forEach(e => {
      if (e.closest('#askPanel') || e.closest('.askRing')) return; const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
      const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const t = norm(e.innerText || e.textContent || ''), ti = norm(e.getAttribute('aria-label') || e.title || '');
      const hit = [t, ti].some(x => x === want || (x.startsWith(want) && !/[a-z0-9]/.test(x.charAt(want.length) || ' ')));
      if (hit && t.length < bl) { best = e; bl = t.length; }
    });
    return best;
  }
  function startShow(labels) {
    stopShow(); const steps = []; labels.forEach(l => { const e = findEl(l); if (e) steps.push({ label: l, e }); });
    const body = document.getElementById('askBody'), bar = el('div', 'sm'); bar.id = 'askShow'; show = { steps, i: 0, bar, rings: [], timer: null };
    if (!steps.length) { bar.appendChild(el('b', '', 'I cannot see those buttons on this screen right now.')); bar.appendChild(document.createTextNode('Go to the screen the steps start on, then press Show me again.')); const o = btnEl('OK', '', stopShow); o.id = 'askShowStop'; bar.appendChild(o); }
    body.appendChild(bar); body.scrollTop = body.scrollHeight; if (steps.length) showStep(0);
  }
  function showStep(i) {
    if (!show) return; show.rings.forEach(r => r.remove()); show.rings = []; clearTimeout(show.timer); show.i = i; const s = show.steps[i], bar = show.bar; bar.innerHTML = '';
    if (!s) { bar.appendChild(el('b', '', 'That is all the steps.')); const b = btnEl('Done', '', stopShow); b.id = 'askShowStop'; bar.appendChild(b); return; }
    const r = s.e.getBoundingClientRect(), ring = el('div', 'askRing'); ring.appendChild(el('span', 'n', String(i + 1)));
    Object.assign(ring.style, { left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' }); document.body.appendChild(ring); show.rings.push(ring);
    bar.appendChild(el('b', '', 'Step ' + (i + 1) + ' of ' + show.steps.length + ': ' + s.label)); bar.appendChild(document.createTextNode('This is where it is. I will not press it.'));
    const row = el('div', 'row'); const n = btnEl(i + 1 < show.steps.length ? 'Next' : 'Finish', 'p', () => showStep(i + 1)); n.id = 'askShowNext'; row.appendChild(n); const sp = btnEl('Stop', '', stopShow); sp.id = 'askShowStop'; row.appendChild(sp); bar.appendChild(row);
    if (SHOW_MS > 0) show.timer = setTimeout(() => showStep(i + 1), SHOW_MS);
  }
  function stopShow() { if (!show) return; clearTimeout(show.timer); show.rings.forEach(r => r.remove()); if (show.bar && show.bar.parentNode) show.bar.remove(); show = null; }

  function draw() {
    if (!panel) return; const body = document.getElementById('askBody'), keepShow = show && show.bar; body.innerHTML = '';
    body.appendChild(el('div', 'intro', 'I explain how to do things, show you where the buttons are, and can change a few simple settings for you after you confirm. I never make sales, take payments, refund, or touch customers.'));
    const hasH = items.some(i => i.answer != null); document.getElementById('askClear').hidden = !hasH;
    if (hasH) body.appendChild(el('div', 'note', 'Saved on this PC. Questions have card and phone numbers removed. Only the last few are used as context.'));
    items.slice(-8).forEach(it => {
      if (it.q) body.appendChild(el('div', 'me', it.q));
      if (it.think) body.appendChild(el('div', 'think', 'thinking...'));
      else if (it.err) body.appendChild(errNode(it)); else if (it.answer != null) body.appendChild(answerNode(it));
    });
    if (st.reached) body.appendChild(unlockNode());
    if (keepShow) body.appendChild(keepShow);
    const chips = document.getElementById('askChips'); chips.innerHTML = '';
    if (!items.some(i => i.answer != null)) EXAMPLES.slice(items.length ? 1 : 0).forEach(q => chips.appendChild(btnEl(q, '', () => send(q))));
    drawFoot(); body.scrollTop = body.scrollHeight;
  }
  async function send(text, again) {
    if (busy || st.reached) return; const ta = document.getElementById('askIn'), raw = text != null ? text : ta.value, r0 = redact(raw);
    if (!r0.text) return; if (text == null) ta.value = ''; lastQ = r0.text; busy = true; const my = ++token; stopShow();
    let cur = again ? items.find(i => i.err && i.q === r0.text) : null;
    if (cur) { delete cur.err; delete cur.message; delete cur.retry; } else { cur = { q: r0.text }; items.push(cur); }
    cur.think = true; draw();
    let image = '', shotNo = false; if (st.screen) { const sc = await captureScreen(); if (sc.ok) image = sc.dataUrl; else shotNo = true; } // no picture (fail closed): only the question goes
    if (my !== token) { image = ''; return; }
    const r = await call('ask', image ? { question: r0.text, image } : { question: r0.text }); image = ''; // the picture is dropped right after the call
    if (my !== token) return; busy = false; cur.think = false; cur.shot = !!(r && r.shot); cur.shotNo = !!(st.screen && !cur.shot && (shotNo || (r && r.ok && r.origin !== 'saved')));
    if (r && r.ok) {
      Object.assign(cur, { answer: r.answer, howtoOnly: r.howtoOnly, howtoLine: r.howtoLine, sources: r.sources, removed: r.removed || r0.removed, t: r.t, origin: r.origin, lid: r.lid, tokens: r.tokens ? r.tokens.total : null, contact: r.contact || null, action: r.action || null });
      st = { ...st, ...stFrom(r) }; if (r.needUnlock) st.reached = true;
    }
    else if (r && r.ignored) { items = items.filter(i => i !== cur); }
    else if (r && r.kind === 'limit') { items = items.filter(i => i !== cur); st = { ...st, ...stFrom(r), reached: true }; }
    else { cur.err = true; cur.message = (r && r.message) || OFFLINE; cur.retry = !r || r.kind === 'offline' || r.kind === 'busy' || r.kind === 'bad' || r.kind === 'wait'; if (r && (r.kind === 'off' || r.kind === 'notset')) refreshStatus(); }
    draw(); if (document.getElementById('askIn') && !panel.hidden && text == null && !st.reached) document.getElementById('askIn').focus();
  }

  // ---------- problems the screen or an API call hits: sent only to this PC's own report file (cleaned there); never anywhere else ----------
  const seenProb = new Map();
  function problem(kind, what, status, message) {
    try {
      if (!st.on || !(typeof S !== 'undefined' && S.loggedIn)) return; const k = kind + '|' + what + '|' + status + '|' + String(message).slice(0, 60), now = Date.now();
      if (now - (seenProb.get(k) || 0) < 60000) return; seenProb.set(k, now); if (seenProb.size > 100) seenProb.clear();
      call('ask-report-log', { kind, what: String(what || ''), status: status == null ? '' : String(status), message: String(message || '').slice(0, 200) });
    } catch (e) { /* never get in the way */ }
  }
  addEventListener('error', e => { const m = e && e.message; if (m && !/ResizeObserver/i.test(m)) problem('screen', (e.filename || 'page').split('/').pop().replace(/[?#].*$/, ''), 'error', m); });
  addEventListener('unhandledrejection', e => { const r = e && e.reason; problem('screen', 'promise', 'error', r && r.message ? r.message : String(r || 'rejected')); });
  if (typeof g.api === 'function' && !g.api.__ask) { // watch (never change) what every API call answers; a failed one is noted in the local report
    const a0 = g.api, w = function (name) {
      const p = a0.apply(this, arguments);
      try { const n = String(name || ''); if (!/^(ask-|state$|login$|logout$|manager)/.test(n)) Promise.resolve(p).then(r => { if (r && typeof r === 'object' && (r.ok === false || r.success === false) && (r.message || r.error)) problem('api', n, r.status || 'failed', r.message || r.error); }, e => problem('api', n, 'error', e && e.message)); } catch (e) { /* ignore */ }
      return p;
    }; w.__ask = true; g.api = w;
  }

  // ---------- screen context: a view-only picture of the Checkout screen, sent with the question ----------
  // This app is a Node server + a browser window (not Electron), so there is no webContents.capturePage. The picture is drawn here, in the page:
  // a plain copy of the visible screen (text and boxes only, no outside files) is turned into an image, then solid BLACK boxes are painted over the
  // sale lines, totals, customer box, Checkout amount and any customer / member / card / order / payment field or popup. The boxes come from
  // getBoundingClientRect at the moment of the capture, so they follow the narrowed layout. If anything needed can't be found or checked, no picture
  // is sent (fail closed) and only the question goes. The picture lives in memory for this one call: never saved, never logged. The panel is left out.
  const SHOT = {
    MAXW: 1024, MAXB64: 760000, MINCROP: 480, MAXNODES: 6000, TIMEOUT: 6000,
    ALWAYS: ['#toast', '#scanMsg', '#noteLine', '#giftLine', '#payStuck', '#retLines', '#stOrder', '#stRdid', '#stUser',
      '[id*="card" i]', '[id*="cust" i]', '[id*="member" i]', '[id*="order" i]', '[id*="pay" i]', '[id*="phone" i]', '[id*="email" i]',
      '[class*="cust" i]', '[class*="member" i]', '[class*="payment" i]', '[role="dialog"]', 'dialog', 'input[type="password"]', 'input[autocomplete^="cc-"]', '.paystuck', '.el-overlay .modal'],
    PROPS: ['display', 'position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'color', 'background-color', 'background-image', 'opacity', 'overflow-x', 'overflow-y',
      'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration', 'text-overflow', 'white-space', 'vertical-align', 'word-break', 'visibility',
      'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self', 'align-content', 'justify-content', 'order', 'gap', 'row-gap', 'column-gap',
      'grid-template-columns', 'grid-template-rows', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end', 'table-layout', 'border-collapse', 'border-spacing', 'box-shadow', 'z-index', 'transform', 'transform-origin',
      'fill', 'stroke', 'stroke-width', 'float', 'clear', 'list-style-type'],
  };
  const shotFail = why => ({ ok: false, why });
  const visEl = e => { if (!e || !e.getBoundingClientRect) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'; };
  const inAsk = e => !!(e.closest && e.closest('#askPanel, .askRing, #askShow'));
  function shotPlan() { // which elements must be black, and is this screen one we may picture at all?
    const $ = id => document.getElementById(id), cv = $('checkoutView');
    if (!cv || !visEl(cv)) return shotFail('screen');
    const sh = $('sectionHost'), lg = $('login'); if ((sh && sh.offsetWidth > 0 && sh.offsetHeight > 0) || (lg && lg.offsetWidth > 0 && lg.offsetHeight > 0)) return shotFail('screen'); // only the Checkout screen is ever pictured
    const tileOf = id => { const e = $(id); return e && e.closest ? e.closest('.tile') : null; };
    const must = [$('cart') && $('cart').closest('.gridbox'), $('totals'), tileOf('info-customer'), tileOf('info-payment')]; // sale lines, totals bar, customer box, Checkout due amount
    if (must.some(e => !e || !visEl(e))) return shotFail('selector');
    for (const c of document.body.classList) if (!/^(askOpen|nosides|paying|busy)$/.test(c)) return shotFail('screen'); // any other page mode (for example the Orders browser) is not pictured
    const mr0 = $('modalRoot'); // whatever is on top of the four boxes must belong to Checkout or to a popup (popups are painted black); anything else (an overlay, another page) means no picture
    for (const m of must) { const r = m.getBoundingClientRect(), top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))); if (!top || !(cv.contains(top) || (mr0 && mr0.contains(top)))) return shotFail('screen'); }
    const set = new Set(must), mr = $('modalRoot');
    if (mr && mr.firstElementChild) { const dl = [...mr.querySelectorAll('.modal, [role="dialog"]')].filter(visEl); if (!dl.length) return shotFail('popup'); dl.forEach(e => set.add(e)); } // an open popup is always hidden; if it can't be found, no picture
    for (const sel of SHOT.ALWAYS) { let list = []; try { list = document.querySelectorAll(sel); } catch (e) { return shotFail('selector'); } list.forEach(e => { if (!inAsk(e) && visEl(e)) set.add(e); }); }
    document.querySelectorAll('input, textarea, select').forEach(e => { if (!inAsk(e) && visEl(e) && (e.type === 'password' || String(e.value || '').length)) set.add(e); }); // anything typed on screen
    return { ok: true, els: [...set], must };
  }
  function shotSnapshot(masked, crop) { // a text-and-boxes copy of the screen: styles written inline, all other attributes dropped, panel left out, masked boxes emptied
    const P = SHOT.PROPS, SVGNS = 'http://www.w3.org/2000/svg', KEEP = new Set(['colspan', 'rowspan', 'type']), SVGKEEP = /^(viewbox|d|fill|stroke|stroke-width|points|cx|cy|r|rx|ry|x|y|x1|x2|y1|y2|width|height|transform|preserveaspectratio|fill-rule|clip-rule|stroke-linecap|stroke-linejoin)$/i;
    let n = 0; const mset = new Set(masked);
    const css = e => { const cs = getComputedStyle(e); let t = ''; for (const p of P) { const v = cs.getPropertyValue(p); if (v) t += p + ':' + v + ';'; } return t; };
    const cp = src => {
      if (n++ > SHOT.MAXNODES) throw new Error('big');
      if (src.nodeType === 3) return document.createTextNode(String(src.nodeValue).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, ''));
      if (src.nodeType !== 1 || inAsk(src) || /^(SCRIPT|STYLE|LINK|IFRAME|CANVAS|VIDEO|AUDIO|OBJECT|EMBED|NOSCRIPT|TEMPLATE|IMG|PICTURE|SOURCE|META|TITLE)$/i.test(src.tagName)) return null;
      const cs = getComputedStyle(src); if (cs.display === 'none') return null;
      const d = src.cloneNode(false), svg = src.namespaceURI === SVGNS;
      for (const a of [...d.attributes]) { const k = a.name.toLowerCase(); if (svg ? !SVGKEEP.test(k) : !KEEP.has(k)) d.removeAttribute(a.name); }
      if (!svg && src.tagName === 'INPUT' && src.type !== 'password' && !mset.has(src) && src.placeholder) d.setAttribute('placeholder', src.placeholder);
      d.setAttribute('style', css(src));
      if (mset.has(src)) { const r = src.getBoundingClientRect(); d.style.width = r.width + 'px'; d.style.height = r.height + 'px'; d.style.boxSizing = 'border-box'; d.style.overflow = 'hidden'; d.style.background = '#000'; d.style.color = '#000'; return d; } // empty, same size
      if (src.tagName === 'TEXTAREA') { d.appendChild(document.createTextNode(String(src.value || ''))); return d; }
      for (const c of src.childNodes) { const k = cp(c); if (k) d.appendChild(k); }
      return d;
    };
    const body = document.body, root = document.createElement('div'), bc = getComputedStyle(body), hc = getComputedStyle(document.documentElement);
    root.setAttribute('style', css(body) + 'position:relative;margin:0;overflow:hidden;width:' + innerWidth + 'px;height:' + innerHeight + 'px;background-color:' + (bc.backgroundColor === 'rgba(0, 0, 0, 0)' ? hc.backgroundColor : bc.backgroundColor) + ';');
    for (const c of body.childNodes) { const k = cp(c); if (k) root.appendChild(k); }
    const xml = new XMLSerializer().serializeToString(root).replace(/^<div /, '<div xmlns="http://www.w3.org/1999/xhtml" ');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + innerWidth + '" height="' + innerHeight + '"><foreignObject x="0" y="0" width="' + innerWidth + '" height="' + innerHeight + '">' + xml + '</foreignObject></svg>';
  }
  async function captureScreen() { // -> { ok:true, dataUrl, w, h, rects } or { ok:false, why }. Never throws, never stores the picture.
    try {
      const plan = shotPlan(); if (!plan.ok) return plan;
      const vw = innerWidth, vh = innerHeight, pr = panel && !panel.hidden ? panel.getBoundingClientRect() : null, cropW = Math.floor(pr ? pr.left : vw);
      if (cropW < SHOT.MINCROP || vh < 300) return shotFail('narrow'); // the panel is left out: the picture stops where the panel starts
      const rects = []; for (const e of plan.els) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0) rects.push({ x: r.left - 3, y: r.top - 3, w: r.width + 6, h: r.height + 6 }); }
      const svg = shotSnapshot(plan.els); // same moment as the measuring above, so boxes and picture agree
      const img = new Image(); img.decoding = 'sync';
      await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('timeout')), SHOT.TIMEOUT); img.onload = () => { clearTimeout(t); ok(); }; img.onerror = () => { clearTimeout(t); no(new Error('image')); }; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      const sc = Math.min(1, SHOT.MAXW / cropW), w = Math.round(cropW * sc), h = Math.round(vh * sc), cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, cropW, vh, 0, 0, w, h);
      cx.fillStyle = '#000'; const out = [];
      for (const r of rects) { const x0 = Math.max(0, Math.floor(r.x * sc)), y0 = Math.max(0, Math.floor(r.y * sc)), x1 = Math.min(w, Math.ceil((r.x + r.w) * sc)), y1 = Math.min(h, Math.ceil((r.y + r.h) * sc)); if (x1 <= x0 || y1 <= y0) continue; cx.fillRect(x0, y0, x1 - x0, y1 - y0); out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); }
      for (const m of plan.must) { const r = m.getBoundingClientRect(), mx = Math.floor((r.left + r.width / 2) * sc), my = Math.floor((r.top + r.height / 2) * sc); if (mx >= 0 && mx < w && my >= 0 && my < h) { const p = cx.getImageData(mx, my, 1, 1).data; if (p[0] > 8 || p[1] > 8 || p[2] > 8) return shotFail('mask'); } else if (r.left < cropW) return shotFail('mask'); } // check: every required box really is black
      let url = cv.toDataURL('image/png'); if (url.length > SHOT.MAXB64) url = cv.toDataURL('image/jpeg', 0.7); if (url.length > SHOT.MAXB64) return shotFail('big');
      g.AskAirMax && (g.AskAirMax._lastShot = { w, h, boxes: out, bytes: url.length, t: Date.now() }); // numbers only, to let tests check the black boxes; the picture itself is not kept
      return { ok: true, dataUrl: url, w, h, rects: out };
    } catch (e) { return shotFail('error'); }
  }

  // ---------- Settings > Ask AirMax (manager only) ----------
  const PRIVACY = 'The words you type, with card-like, phone-like numbers, emails and codes removed, plus the AirMax how-to text (version {v}), plus (when the screenshot switch is On) a picture of the Checkout screen with the sale lines, totals, customer box, Checkout amount and any customer, member, card, order or payment field or popup painted solid black, and with this panel left out. The picture is made in the page, is never saved on this PC or in a log, and is used by Grok only to see the screen: it never moves or clicks anything. Nothing else: no customers, sales, receipts, card data or settings values. The web fallback never gets the picture. The saved history stays on this PC. The last {m} questions and answers are sent as context. The web switch below, when On, lets a question the how-to text cannot answer go to the web: then ONLY that cleaned question is sent. The log keeps only counts.';
  async function renderSettings(host, ctx) {
    styled(); host.innerHTML = '<div class="aks"><p class="d">Loading…</p></div>';
    const c = await call('ask-config-get'); const box = host.querySelector('.aks') || host;
    if (!c.ok) { box.innerHTML = '<p class="d">' + E(c.managerOnly ? 'Ask AirMax settings are for a manager login. Ask a manager to open this.' : (c.message || 'Could not load the Ask AirMax settings.')) + '</p>'; return; }
    box.innerHTML = '<h3>Ask AirMax <span class="tg">new</span><span class="tg pc">this PC</span></h3>' +
      '<p class="d">Ask AirMax explains how to do things from a help file about this register, shows where the buttons are, and can change a few simple settings after a confirm. It uses the xAI Grok service. It never sees customers, sales, cards or payments, and it cannot make a sale, take a payment, refund, void or change a price. It starts Off.</p>' +
      '<div class="card sw"><label class="tgl"><input type="checkbox" id="akOn"><i></i></label><div><b id="akOnT"></b><small>The Ask AirMax button shows next to F1 = keys for every login on this PC.</small></div></div>' +
      '<h4>CONNECTION</h4><div class="card"><label>xAI API key <span class="tg" id="akSaved" hidden>saved</span><a id="akRm" hidden>Remove saved key</a></label><input type="password" id="akKey" autocomplete="off" spellcheck="false">' +
      '<div class="hint">Get a key at console.x.ai and set a spend limit there. It is stored only on this PC, never shown again, never put in the log, and never sent to the screen.</div>' +
      '<div class="two"><div><label>Model</label><select id="akModel"></select></div><div><label>Daily token budget (this PC)</label><input type="number" id="akBudget" min="0" step="1000" placeholder="no limit"><div class="hint" id="akBudgetH"></div></div></div>' +
      '<div class="two"><div><label>Extra tokens a manager unlock adds (for that day only)</label><input type="number" id="akExtra" min="1000" step="1000"></div><div></div></div>' +
      '<div class="tg2"><input type="checkbox" id="akScreen"><label for="akScreen" style="margin:0;font-weight:600">Screen context: send a screenshot (sale, customer and payment info blacked out) with each question</label></div>' +
      '<div class="tg2"><input type="checkbox" id="akWeb"><label for="akWeb" style="margin:0;font-weight:600">Web fallback: when the how-to text cannot answer, search the web</label></div>' +
      '<div class="hint">Off by default. When On, only the cleaned question is sent, a second call is made (it counts in the budget), and the answer is labelled "From the web".</div>' +
      '<div class="hint" id="akHist" style="margin-top:12px"></div>' +
      '<div class="btns"><button type="button" id="akTest">Test connection</button><button type="button" class="p" id="akSave">Save</button><span id="akRes"></span></div><div class="msg" id="akMsg" role="status"></div></div>' +
      '<h4>USAGE <span style="font-weight:400">(an estimate, not a bill)</span></h4><div class="card" id="akUsage"></div>' +
      '<h4>PROBLEMS REPORT</h4><div class="card"><div class="hint" id="akRep" style="margin:0 0 8px"></div><div class="btns" style="margin-top:0"><select id="akFmt" class="fm"><option value="json">JSON</option><option value="csv">CSV</option></select><button type="button" id="akExport">Export report</button><span id="akExRes"></span></div><div class="hint">Saved on this PC only (the Downloads folder). Nothing is uploaded. Send the file to AirMax support yourself if asked.</div></div>' +
      '<h4>WHAT IS SENT</h4><div class="card sent" id="akSent"></div>';
    const q = id => box.querySelector('#' + id); let cur = c;
    const msg = (m, ok) => { q('akMsg').textContent = m || ''; q('akMsg').className = 'msg' + (ok ? ' ok' : ''); };
    const row = (a, b, c2, d) => '<tr><td>' + E(a) + '</td><td>' + E(b) + '</td><td>' + E(c2) + '</td><td>' + E(d) + '</td></tr>';
    const paintUsage = () => {
      const u = cur.usage || {}, t = u.today || {}, m = u.month || {}, l = u.last || {};
      q('akUsage').innerHTML = '<table class="us"><tr><td></td><td><b>Questions</b></td><td><b>Tokens</b></td><td><b>Cost</b></td></tr>' + row('Today', num(t.q), num(t.tokens), usd(t.cost)) + row('This month', num(m.q), num(m.tokens), usd(m.cost)) + '</table>' +
        '<table class="us"><tr><td>Tokens per question (average this month)</td><td id="akAvg">' + E(num(u.avgPerQuestion)) + '</td></tr><tr><td>Last answer</td><td id="akLast">' + E(num(l.tokens)) + ' tokens (' + E(num(l.in)) + ' in, ' + E(num(l.out)) + ' out)</td></tr></table>' +
        '<div class="est">Estimated at $' + E(String((u.prices || {}).input)) + ' per million tokens in and $' + E(String((u.prices || {}).output)) + ' per million out. Web search tool fees are not included. Check your xAI console for the real bill.</div>';
    };
    const paint = () => {
      q('akOn').checked = !!cur.on; q('akOnT').textContent = 'Ask AirMax is ' + (cur.on ? 'On' : 'Off'); q('akSaved').hidden = !cur.keySet; q('akRm').hidden = !cur.keySet;
      q('akKey').placeholder = cur.keySet ? 'saved (type to replace)' : 'xai-…'; q('akModel').innerHTML = (cur.models || []).map(m => '<option value="' + E(m) + '">' + E(m) + (m === 'grok-4.3' ? ' — fast and low cost (recommended)' : '') + '</option>').join(''); if (cur.model) q('akModel').value = cur.model;
      q('akBudget').value = cur.budget == null ? '' : cur.budget; q('akExtra').value = cur.unlockExtra == null ? '' : cur.unlockExtra; q('akWeb').checked = !!cur.web; q('akScreen').checked = cur.screen !== false;
      const u = cur.usage || {}; q('akBudgetH').textContent = (u.used != null ? num(u.used) : '0') + ' used today' + (cur.budget ? ' of ' + num(u.allowance || cur.budget) : '') + '. Blank = no limit. Suggested: ' + num(cur.defaultBudget || 500000) + '.';
      q('akHist').textContent = 'History: ' + (cur.historyCount || 0) + ' saved on this PC (the last ' + (cur.historyMax || 200) + ' are kept). Learned answers: ' + (cur.learnedCount || 0) + '. Clear them with "Clear history" in the panel.';
      q('akRep').textContent = 'Problems report: ' + (cur.reportCount || 0) + ' entries saved on this PC (the last ' + (cur.reportMax || 500) + ' are kept). It holds questions that were not answered, "not helpful" votes and errors, with numbers removed.';
      q('akSent').textContent = PRIVACY.replace('{v}', (cur.howto && cur.howto.version) || '?').replace('{m}', String((cur.memory || 2) * 2 / 2));
      if (cur.keyBad) q('akRes').innerHTML = '<span class="pill bad">Key not accepted</span>'; paintUsage();
    };
    const apply = r => { if (r && r.ok) { cur = { ...cur, ...r }; paint(); refreshStatus(); return true; } return false; };
    paint();
    q('akOn').onchange = async e => { const r = await call('ask-config-save', { on: e.target.checked }); if (!apply(r)) { e.target.checked = !!cur.on; msg((r && r.message) || 'Could not save.'); } else msg(cur.on ? 'Ask AirMax is on.' : 'Ask AirMax is off.', true); };
    q('akRm').onclick = async () => { const r = await call('ask-config-save', { removeKey: true }); if (apply(r)) { q('akRes').textContent = ''; msg('Saved key removed. Ask AirMax is off.', true); } else msg((r && r.message) || 'Could not save.'); };
    q('akSave').onclick = async () => {
      const body = { model: q('akModel').value, budget: q('akBudget').value === '' ? null : Number(q('akBudget').value), web: q('akWeb').checked, screen: q('akScreen').checked }; if (q('akExtra').value !== '') body.unlockExtra = Number(q('akExtra').value); const k = q('akKey').value.trim(); if (k) body.key = k;
      const r = await call('ask-config-save', body); if (apply(r)) { q('akKey').value = ''; msg('Saved.', true); } else msg((r && r.message) || 'Could not save.');
    };
    q('akTest').onclick = async () => {
      q('akRes').textContent = 'Checking…'; const k = q('akKey').value.trim(), r = await call('ask-test', k ? { key: k } : {});
      if (r.ok) { q('akRes').innerHTML = '<span class="pill">Connected</span> <small>Checked just now. Uses no questions.</small>'; if (r.models) { cur.models = r.models; const keep = q('akModel').value; paint(); q('akModel').value = keep; } }
      else { q('akRes').innerHTML = '<span class="pill bad">Not connected</span>'; msg(r.message || 'Could not test.'); }
      if (r.howto && !r.howto.ok) msg('The how-to file did not load.');
    };
    q('akExport').onclick = async () => { // a manager login only (the server checks it too); writes a file in Downloads, uploads nothing
      q('akExRes').textContent = 'Saving…'; const r = await call('ask-report-export', { format: q('akFmt').value });
      q('akExRes').textContent = r && r.ok ? r.message : ((r && r.message) || 'Could not save the report.');
    };
  }
  const ENTRY = { key: 'ask-airmax', label: 'Ask AirMax', group: 'Store & Account', after: 'remote', tags: ['new', 'pc'], who: 'manager', desc: 'Help for how-to questions', render: (host, ctx) => renderSettings(host, ctx) };
  let fallbackOn = false;
  function registerSettings() {
    try {
      if (g.AirMaxSettings && typeof g.AirMaxSettings.add === 'function' && typeof g.AirMaxSettings.groups === 'function') { g.AirMaxSettings.add(ENTRY); return; } // Batch 1's Settings menu
      if (typeof ST_TABS !== 'undefined' && typeof ST_BUILD !== 'undefined') { // the existing Settings window: one more tab, shown to managers only
        ST_BUILD.askmax = () => modal('<h2>Ask AirMax</h2><div id="askSet"></div>', () => { const h = document.getElementById('askSet'); if (h) renderSettings(h, {}); });
        if (typeof A !== 'undefined') A['settings-askmax'] = () => settingsPage('askmax');
        fallbackOn = true; syncTab();
      }
    } catch (e) { console.warn('Ask AirMax settings page not added', e); }
  }
  function syncTab() { // old Settings window only: the tab is in the list only for a manager login
    if (!fallbackOn || typeof ST_TABS === 'undefined') return; const i = ST_TABS.findIndex(t => t[0] === 'askmax'), mgr = !!(typeof S !== 'undefined' && S.user && S.user.manager);
    if (mgr && i < 0) ST_TABS.push(['askmax', 'Ask AirMax', '']); else if (!mgr && i >= 0) ST_TABS.splice(i, 1);
  }

  // ---------- follow the register ----------
  function onRefresh() {
    const k = typeof S !== 'undefined' && S.loggedIn ? String((S.user && S.user.user) || 'in') : null;
    syncTab();
    if (k !== loginKey) { loginKey = k; if (k === null) { items = []; busy = false; unlock = null; stopShow(); st = { ...st, on: false }; paintBtn(); } else refreshStatus(); }
    else if (st.on && !btn) paintBtn();
  }
  const prev = g.afterRefresh;
  g.afterRefresh = () => { if (prev) prev(); try { onRefresh(); } catch (e) { console.warn('Ask AirMax', e); } };
  registerSettings();
  setInterval(() => { try { refreshStatus(); } catch (e) { /* keep going */ } }, 5 * 60 * 1000);
  g.AskAirMax = { open: openPanel, close: closePanel, refresh: refreshStatus, _capture: captureScreen, _state: () => ({ ...st }), _showMs: n => { SHOW_MS = Math.max(0, +n || 0); } };
  try { onRefresh(); } catch (e) { /* the register works without it */ }
})();

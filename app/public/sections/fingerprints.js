// Batch 6: fingerprints (screen file; fills two mount slots, edits no other file).
//  1) users.extra (Batch 3's per-row slot on the Users screen, ctx.user = the operator row): a "Fingerprints" button + the saved count, and a side panel
//     to scan / save / remove / clear fingerprints. Calls: fp-list, fp-enroll-start / status / cancel / save, fp-remove, fp-clear (all done by the AirMax server).
//  2) checkout.manager-approval (inside every manager approval pop-up): "place your finger on the reader". The server matches it and gives back
//     only a token; this file sends { user: '@fingerprint', password: token } through the pop-up's own submit(). No manager id ever comes from here.
// No fingerprint picture or data is ever drawn, stored or logged here (the server never sends any). No fingerprint login (not in this batch).
(function () {
  'use strict';
  const g = window;
  if (!g.AirMaxMounts || g.__airmaxFp6) return;
  g.__airmaxFp6 = true;

  if (!document.getElementById('fp6Css')) {
    const st = document.createElement('style'); st.id = 'fp6Css';
    st.textContent = `
      .fp6i { width:1em; height:1em; vertical-align:-.15em; stroke:currentColor; fill:none; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
      .fp6-or { display:flex; align-items:center; gap:10px; color:#7f8c8d; font-size:12px; margin:16px 0 4px; } .fp6-or:before, .fp6-or:after { content:""; flex:1; height:1px; background:#d5dde5; }
      .fp6-box { border:1px dashed #9db8ff; background:#ecf5ff; border-radius:6px; padding:12px; margin-top:10px; text-align:center; }
      .fp6-box .big { color:#146cff; font-size:46px; line-height:1; } .fp6-box b { display:block; font-size:14px; margin-top:6px; } .fp6-box small { display:block; color:#566573; margin-top:2px; }
      .fp6-stat { display:flex; align-items:center; justify-content:center; gap:8px; font-size:12.5px; color:#566573; margin-top:8px; }
      .fp6-dot { width:9px; height:9px; border-radius:50%; background:#ff8800; display:inline-block; } .fp6-dot.ok { background:#18a058; } .fp6-dot.bad { background:#c0392b; }
      .fp6-link { background:none; border:0; color:#146cff; font:inherit; font-weight:700; cursor:pointer; padding:0; }
      .fp6-pips { display:flex; justify-content:center; gap:6px; margin-top:8px; } .fp6-pips i { width:10px; height:10px; border-radius:50%; background:#c0d8ff; } .fp6-pips i.on { background:#18a058; }
      .fp6-btn { white-space:nowrap; } .fp6-cnt { display:inline-block; min-width:18px; text-align:center; border-radius:10px; padding:1px 7px; margin-left:6px; font-size:12px; font-weight:800; background:#eceff3; color:#7f8c8d; }
      .fp6-cnt.n { background:#e3f6ec; color:#18a058; }
      .fp6-ov { position:fixed; right:0; bottom:0; width:430px; max-width:100%; background:#fff; box-shadow:-8px 0 30px rgba(0,0,0,.25); padding:18px 20px; box-sizing:border-box; overflow:auto; z-index:31; }
      .fp6-ov h3 { margin:0 0 2px; font-size:19px; } .fp6-sub { color:var(--ap-text2,#666); font-size:13px; } .fp6-ok { color:#18a058; font-weight:700; font-size:13px; margin-top:8px; }
      .fp6-sec { font-size:12px; letter-spacing:.5px; color:#566573; font-weight:800; margin:16px 0 4px; text-transform:uppercase; }
      .fp6-row { display:flex; align-items:center; gap:10px; border:1px solid #d5dde5; border-radius:4px; padding:8px 10px; margin-top:6px; } .fp6-row .fp6i { font-size:24px; color:#146cff; }
      .fp6-row span { flex:1; font-weight:700; } .fp6-row small { color:#7f8c8d; font-weight:500; display:block; font-size:11.5px; }
      .fp6-acts { display:flex; gap:8px; margin-top:10px; } .fp6-acts .pbtn { padding:8px 14px; } .fp6-acts .pbtn.g { flex:1; } .fp6-acts .pbtn:disabled { opacity:.45; cursor:default; }
      .fp6-note { color:#7f8c8d; font-size:12px; margin-top:8px; } .fp6-foot { display:flex; justify-content:space-between; margin-top:18px; padding-top:14px; border-top:1px solid #eef1f4; }
      .fp6-msg { margin-top:8px; font-size:13px; font-weight:700; } .fp6-msg.err { color:#c0392b; }`;
    document.head.appendChild(st);
  }
  const FPI = '<svg class="fp6i" viewBox="0 0 24 24"><path d="M12 11v3.5c0 2-.5 3.8-1.6 5.5"/><path d="M8.2 12c0-2 1.7-3.6 3.8-3.6s3.8 1.6 3.8 3.6c0 3.1-.6 5.8-2 8"/><path d="M5 11.5C5 7.9 8.1 5 12 5s7 2.9 7 6.5c0 2.3-.2 4.4-.9 6.5"/><path d="M5.4 15.3c-.2 1.3-.7 2.5-1.4 3.5"/><path d="M8 20c.8-1.1 1.4-2.2 1.7-3.6"/></svg>';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const POLL = Number(g.AIRMAX_FP_POLL_MS) || 400;

  // ------------------------------------------------------------------ 2) manager approval pop-up
  g.AirMaxMounts.add('checkout.manager-approval', {
    id: 'fp-approve',
    render(host, ctx) {
      // Batch 6 rule: no fingerprint on the Exit to Windows / Restart / Shut down pop-ups (they share this slot). Nothing is drawn, the reader is never started.
      if (/^(Exit to Windows|Restart PC|Shut down PC)$/i.test(String(ctx.title || '').trim())) return;
      let alive = true, run = 0;
      const esc = ctx.esc;
      const paint = (kind, msg, extra) => {
        if (!alive) return;
        if (kind === 'hide') { host.innerHTML = ''; return; }
        const waiting = kind === 'waiting', okk = kind === 'ok';
        host.innerHTML = `<div class="fp6-or">or</div><div class="fp6-box">
          <div class="big">${FPI}</div>
          <b>Manager: place your finger on the reader</b><small>Checks the finger against this store's managers</small>
          <div class="fp6-stat"><span class="fp6-dot ${okk ? 'ok' : kind === 'failed' ? 'bad' : ''}"></span><span id="fp6St">${esc(msg || '')}</span>${waiting ? ' <button type="button" class="fp6-link" id="fp6Cancel">Cancel scan</button>' : ''}${kind === 'failed' || kind === 'stopped' ? ' <button type="button" class="fp6-link" id="fp6Again">Scan again</button>' : ''}</div></div>`;
        const c = host.querySelector('#fp6Cancel'), a = host.querySelector('#fp6Again');
        if (c) c.onclick = async () => { run++; await ctx.api('fp-mgr-cancel'); paint('stopped', 'Fingerprint scan stopped.'); };
        if (a) a.onclick = () => begin();
      };
      const begin = async () => {
        const me = ++run;
        const s = await ctx.api('fp-mgr-start', { tokens: ctx.title === 'Price Change' ? 2 : 1 });   // Price Change checks the manager twice: one scan, two one-time tokens
        if (me !== run || !alive) return;
        if (!s || !s.ok) { paint('hide'); return; }
        for (;;) {
          await sleep(POLL);
          if (me !== run || !alive) return;
          if (!host.isConnected) { alive = false; ctx.api('fp-mgr-cancel'); return; }   // the pop-up was closed (Cancel / Esc / OK with a password)
          const r = await ctx.api('fp-mgr-status');
          if (me !== run || !alive) return;
          if (!r || !r.ok || r.state === 'none' || r.state === 'unavailable' || r.state === 'cancelled') { paint('hide'); return; }   // no reader here: the pop-up stays exactly as it was
          if (r.state === 'loading') continue;
          if (r.state === 'waiting') { paint('waiting', 'Waiting for finger…'); continue; }
          if (r.state === 'failed') { paint('failed', r.message || 'The fingerprint was not recognised.'); return; }
          if (r.state === 'ok') {
            if (!Array.isArray(r.tokens) || !r.tokens.length) return;
            paint('ok', 'Fingerprint accepted…');
            // Every token works once. The pop-up's code reads body.password once per check (Price Change: once for price-approve, once more for price-change),
            // so each read hands out the NEXT token; when they are used up it gives '' (which is always refused). The tokens never appear on the screen.
            const list = r.tokens.slice(); let used = 0;
            const body = { user: '@fingerprint' };
            Object.defineProperty(body, 'password', { enumerable: true, get: () => (used < list.length ? list[used++] : '') });
            const res = await ctx.submit(body);   // the pop-up's own approval; null/undefined = approved and closed
            if (me !== run || !alive || !host.isConnected) return;
            if (res && res.ok === false) paint('failed', res.message || 'The approval did not go through.');
            return;
          }
        }
      };
      begin();
      return () => { alive = false; run++; ctx.api('fp-mgr-cancel'); };
    },
  });

  // ------------------------------------------------------------------ 1) Users > Fingerprints
  const queue = []; let running = 0;
  const later = fn => new Promise(res => { queue.push(() => fn().then(res, () => res(null))); pump(); });
  const pump = () => { while (running < 3 && queue.length) { running++; queue.shift()().finally(() => { running--; pump(); }); } };
  let panel = null;   // the one open side panel

  const closePanel = (cancel = true) => { const p = panel; panel = null; if (!p) return; p.alive = false; if (p.el) p.el.remove(); if (cancel) p.ctx.api('fp-enroll-cancel'); };

  function openPanel(user, ctx, onCount) {
    closePanel();
    const esc = ctx.esc, name = user.name || user.userName || 'this user';
    const top = (document.querySelector('.top') || { getBoundingClientRect: () => ({ bottom: 56 }) }).getBoundingClientRect().bottom;
    const el = document.createElement('div'); el.className = 'fp6-ov'; el.style.top = Math.max(0, Math.round(top)) + 'px';
    document.body.appendChild(el);
    const P = panel = { el, ctx, alive: true };
    let prints = [], phase = 'idle', step = 0, msg = '', msgErr = false, polling = 0;
    const $ = s => el.querySelector(s);

    const paint = () => {
      if (!P.alive) return;
      const n = prints.length;
      const rows = prints.map((p, i) => `<div class="fp6-row">${FPI}<span>Fingerprint ${i + 1}<small>${p.createTime ? 'saved ' + esc(String(p.createTime).slice(0, 10)) : 'saved'}</small></span><button class="pbtn r" style="padding:5px 12px;font-size:13px" data-rm="${i}">Remove</button></div>`).join('');
      const waiting = phase === 'waiting', ready = phase === 'ready', failed = phase === 'failed';
      const boxMsg = ready ? 'Ready to save' : waiting ? (step ? `Touch the same finger again (${step} of 3 done)` : 'Waiting for finger…') : failed ? esc(msg) : 'The reader asks for the same finger more than once';
      el.innerHTML = `<h3>Fingerprints</h3><div class="fp6-sub">${esc(name)}${user.userName ? ' · ' + esc(user.userName) : ''}</div>
        <div class="fp6-ok">${n} saved.</div>
        <div class="fp6-sec">Saved fingerprints</div>${rows || '<div class="fp6-note">None saved yet.</div>'}
        <div class="fp6-sec">Add a fingerprint</div>
        <div class="fp6-box"><div class="big">${FPI}</div><b>Ask ${esc(name)} to place a finger on the reader</b><small>${boxMsg}</small>
          ${waiting || ready ? `<div class="fp6-pips"><i class="${step >= 1 ? 'on' : ''}"></i><i class="${step >= 2 ? 'on' : ''}"></i><i class="${step >= 3 ? 'on' : ''}"></i></div>` : ''}
          <div class="fp6-stat"><span class="fp6-dot ${ready ? 'ok' : failed ? 'bad' : ''}"></span><span>${waiting ? 'Waiting for finger…' : ready ? 'All 3 touches read' : failed ? 'Not saved' : 'Not scanning'}</span></div></div>
        <div class="fp6-acts"><button class="pbtn g" id="fp6Scan"${waiting || ready ? ' disabled' : ''}>Scan finger</button><button class="pbtn s" id="fp6Cancel"${waiting || ready || failed ? '' : ' disabled'}>Cancel</button><button class="pbtn" id="fp6Save"${ready ? '' : ' disabled'}>Save fingerprint</button></div>
        <div class="fp6-msg ${msgErr ? 'err' : ''}" id="fp6Msg">${phase === 'idle' || phase === 'saved' ? esc(msg) : ''}</div>
        <div class="fp6-note">No picture of a finger is ever shown or stored here. The reader's data goes straight to AIR POS.</div>
        <div class="fp6-foot"><button class="pbtn r" id="fp6Clear" style="background:#fff;color:#c0392b;border:1px solid #ffcecf"${n ? '' : ' disabled'}>Clear all</button><button class="pbtn s" id="fp6Close">Close (Esc)</button></div>`;
      $('#fp6Close').onclick = () => closePanel();
      $('#fp6Scan').onclick = scan; $('#fp6Cancel').onclick = cancel; $('#fp6Save').onclick = save;
      $('#fp6Clear').onclick = () => confirmBox('Clear all fingerprints?', `This removes all <b>${n}</b> saved fingerprint${n === 1 ? '' : 's'} for <b>${esc(name)}</b>.`, 'Clear all', clearAll);
      el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const p = prints[Number(b.dataset.rm)]; if (p) confirmBox('Remove this fingerprint?', `This removes <b>Fingerprint ${Number(b.dataset.rm) + 1}</b> for <b>${esc(name)}</b>.`, 'Remove', () => removeOne(p)); });
    };
    const confirmBox = (title, html, label, go) => {
      if (typeof g.modal !== 'function') return;
      g.modal(`<h2>${esc(title)}</h2><p>${html}</p><p class="note">This cannot be undone.</p><div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button><button class="pbtn r" id="fp6Yes">${esc(label)}</button></div>`, () => {
        const y = document.getElementById('fp6Yes'); y.onclick = async () => { y.disabled = true; g.closeModal(); await go(); };
      });
    };
    const reload = async () => {
      const r = await ctx.api('fp-list', { operatorId: user.id });
      if (!P.alive) return;
      if (!r || !r.ok) { msg = (r && r.message) || 'Fingerprints could not be loaded.'; msgErr = true; paint(); return; }
      prints = r.prints || []; onCount(prints.length); paint();
    };
    const poll = async () => {
      const me = ++polling;
      for (;;) {
        await sleep(POLL);
        if (!P.alive || me !== polling) return;
        const s = await ctx.api('fp-enroll-status', { operatorId: user.id });
        if (!P.alive || me !== polling) return;
        if (!s || !s.ok) { phase = 'failed'; msg = (s && s.message) || 'Lost contact with the register.'; paint(); return; }
        step = s.step || 0;
        if (s.state === 'waiting') { phase = 'waiting'; paint(); continue; }
        if (s.state === 'ready') { phase = 'ready'; paint(); return; }
        if (s.state === 'failed') { phase = 'failed'; msg = s.message || 'The fingerprint was not read.'; msgErr = true; paint(); return; }
        phase = 'idle'; step = 0; paint(); return;   // none / cancelled
      }
    };
    const scan = async () => {
      msg = ''; msgErr = false; step = 0; phase = 'waiting'; paint();
      const r = await ctx.api('fp-enroll-start', { operatorId: user.id });
      if (!P.alive) return;
      if (!r || !r.ok) { phase = 'failed'; msg = (r && r.message) || 'Scanning could not start.'; msgErr = true; paint(); return; }
      poll();
    };
    const cancel = async () => { polling++; await ctx.api('fp-enroll-cancel'); phase = 'idle'; step = 0; msg = ''; paint(); };
    const save = async () => {
      polling++; $('#fp6Save').disabled = true;
      const r = await ctx.api('fp-enroll-save');
      if (!P.alive) return;
      if (!r || !r.ok) { phase = 'failed'; msg = (r && r.message) || 'The fingerprint could not be saved.'; msgErr = true; paint(); return; }
      phase = 'idle'; step = 0; msg = r.message || 'Fingerprint saved.'; msgErr = false; if (ctx.toast) ctx.toast(msg, true); await reload();
    };
    const removeOne = async p => {
      const r = await ctx.api('fp-remove', { operatorId: user.id, fingerprintId: p.id, confirm: true });
      msg = r && r.ok ? 'Fingerprint removed.' : (r && r.message) || 'The fingerprint could not be removed.'; msgErr = !(r && r.ok); await reload();
    };
    const clearAll = async () => {
      const r = await ctx.api('fp-clear', { operatorId: user.id, confirm: true });
      msg = r && r.ok ? 'All fingerprints cleared.' : (r && r.message) || 'The fingerprints could not be cleared.'; msgErr = !(r && r.ok); await reload();
    };
    paint(); reload();
    // leaving the Users screen (the row that opened this panel is gone) or Esc closes the panel and stops the reader
    const watch = setInterval(() => { if (!P.alive) return clearInterval(watch); if (!ctx.host.isConnected) { clearInterval(watch); closePanel(); } }, 700);
    const esc2 = e => { if (e.key === 'Escape' && P.alive && !(document.getElementById('modalRoot') || {}).firstChild) { document.removeEventListener('keydown', esc2, true); closePanel(); } };
    document.addEventListener('keydown', esc2, true);
  }

  g.AirMaxMounts.add('users.extra', {
    id: 'fp-users',
    render(host, ctx) {
      const u = ctx.user;
      if (!u || !u.id) return;
      let alive = true;
      later(async () => {
        const r = await ctx.api('fp-list', { operatorId: u.id });
        if (!alive || !host.isConnected || !r || !r.ok || !r.canEdit) return;          // not allowed here: no button, the row stays as it is
        const b = document.createElement('button'); b.type = 'button'; b.className = 'pbtn s fp6-btn'; b.dataset.fp = u.id;
        const cnt = document.createElement('span'); cnt.className = 'fp6-cnt';
        const setN = n => { cnt.textContent = String(n); cnt.classList.toggle('n', n > 0); };
        b.innerHTML = FPI + ' Fingerprints'; b.appendChild(cnt); setN(r.count || 0);
        b.onclick = () => openPanel(u, ctx, setN);
        host.appendChild(b);
      });
      return () => { alive = false; };
    },
  });
})();

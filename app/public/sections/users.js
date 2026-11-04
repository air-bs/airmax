// Batch 3: Users tab (operators). Opens behind a manager unlock; nothing is drawn or loaded before it.
//  - A logged-in manager opens it straight away. Anyone else gets the existing manager pop-up (managerLogin) first; Cancel goes back to Checkout.
//  - The server keeps the manager session in memory only (app/api/users.js). Leaving the screen, 5 minutes without use, logout: it is dropped and the screen clears.
//  - Labels follow AIR POS Operator Management: Add Operator, Edit, Save. No View button, no delete, no lock screen.
//  - Add Operator / Edit are not drawn at all when the manager lacks the Operator Management menu.
//  - Each row gets a slot container: ctx.mount('users.extra', el, { user }) (see docs/batch-3-slots.md).
(function () {
  const g = window;
  if (!g.AirMaxSections) return;
  if (g.AirMaxSections._defs && g.AirMaxSections._defs.users) return; // a screen another file registered first (the Step 0 slot tests do) keeps the tab

  if (!document.getElementById('usersCss')) {
    const st = document.createElement('style'); st.id = 'usersCss';
    st.textContent = `
      .us { max-width:1100px; margin:0 auto; position:relative; }
      .us-head { display:flex; align-items:baseline; gap:14px; margin-bottom:10px; } .us-head h2 { margin:0; font-size:22px; } .us-by { color:var(--ap-text2); font-size:13px; }
      .us-wait { max-width:520px; margin:14vh auto 0; text-align:center; color:var(--ap-text2); font-size:15px; }
      .us-bar { display:flex; gap:8px; align-items:center; margin-bottom:8px; } .us-bar input.f { width:320px; }
      .us-bar .sp { flex:1; }
      .us-t { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--ap-line); }
      .us-t th, .us-t td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--ap-line2); font-size:14px; } .us-t th { background:var(--ap-gray); color:var(--ap-text2); font-weight:700; }
      .us-t td.us-act { white-space:nowrap; } .us-t td.us-act .pbtn { padding:5px 12px; font-size:13px; margin-right:6px; } .us-extra { display:inline-flex; gap:6px; }
      .us-empty { padding:18px; text-align:center; color:var(--ap-text2); }
      .us-pg { display:flex; gap:10px; align-items:center; justify-content:flex-end; margin-top:8px; color:var(--ap-text2); font-size:13px; } .us-pg .pbtn { padding:5px 12px; font-size:13px; }
      .us-ov { position:fixed; left:0; right:0; bottom:0; top:var(--us-top, 96px); background:rgba(0,0,0,.35); z-index:30; display:flex; justify-content:flex-end; }
      .us-card { width:460px; max-width:100%; background:#fff; padding:18px 22px; overflow:auto; box-shadow:-4px 0 16px rgba(0,0,0,.2); }
      .us-card h3 { margin:0 0 6px; font-size:18px; } .us-card textarea.f { width:100%; font-size:15px; padding:8px 10px; border:1px solid #b9c7d2; border-radius:6px; min-height:60px; font-family:inherit; }
      .us-card .row2 { display:flex; gap:10px; justify-content:flex-end; margin-top:14px; } .us-card .us-un { font-size:15px; padding:6px 0; }
      .us-pick { max-height:220px; overflow:auto; border:1px solid var(--ap-line); margin-top:6px; } .us-pick table { width:100%; border-collapse:collapse; } .us-pick td { padding:6px 10px; border-bottom:1px solid var(--ap-line2); font-size:14px; }
      .us-sum { margin:8px 0; font-size:15px; line-height:1.6; }`;
    document.head.appendChild(st);
  }

  function render(host, ctx) {
    const esc = ctx.esc;
    let alive = true, unlocked = false, pending = false, canEdit = false, manager = '', idleMs = 300000;
    let ours = null, undo = null, idleT = null, cancelT = null, lastTouch = 0, page = 1, total = 0, pageSize = 20, query = '', rows = [], panel = null;
    const $ = id => host.querySelector('#' + id);
    const home = () => { if (alive) ctx.show('checkout'); };

    host.innerHTML = '<div class="us-wait">Manager approval needed.</div>';

    // ---- unlock
    async function start() {
      await ctx.api('users-lock'); // every visit starts locked
      if (!alive) return;
      let p = null; try { p = await ctx.perms(); } catch (e) { p = null; }
      if (!alive) return;
      if (p && p.manager) { // already a manager: no pop-up
        const r = await ctx.api('users-unlock', {});
        if (!alive) return;
        if (r && r.ok) return open(r);
        ctx.toast((r && r.message) || 'Could not open Users.', false); return home();
      }
      if (typeof managerLogin !== 'function') { ctx.toast('Manager approval is not available.', false); return home(); }
      managerLogin('Manager approval', 'Users and operators need a manager. Enter a manager user name and password.', async b => {
        pending = true;
        try {
          const r = await ctx.api('users-unlock', { user: b.user, password: b.password });
          if (!alive) return;
          if (r && r.ok) { unlocked = true; if (typeof closeModal === 'function') closeModal(); open(r); return; }
          return r || { ok: false, message: 'No answer. Try again.' };
        } finally { pending = false; }
      });
      // Cancel / Esc closes the pop-up with no answer: back to Checkout
      cancelT = setInterval(() => { if (!alive || unlocked) return clearInterval(cancelT); if (!pending && !document.getElementById('mlOk')) { clearInterval(cancelT); home(); } }, 250);
    }

    function open(r) {
      if (!alive) return;
      unlocked = true; canEdit = !!r.canEdit; manager = r.manager || ''; idleMs = r.idleMs || idleMs; clearInterval(cancelT);
      host.innerHTML = `<div class="us"><div class="us-head"><h2>Operator Management</h2><span class="us-by">Approved by <b>${esc(manager)}</b></span></div>
        <div class="us-bar"><input class="f" id="usQ" placeholder="Operator Name" data-kb="text" autocomplete="off"><button class="pbtn" id="usSearch">Search</button><span class="sp"></span>${canEdit ? '<button class="pbtn g" id="usAdd">Add Operator</button>' : ''}</div>
        <div class="msg" id="usMsg"></div>
        <table class="us-t"><thead><tr><th>Operator Name</th><th>Username</th><th>Position</th><th>Create Time</th><th>Actions</th></tr></thead><tbody id="usRows"></tbody></table>
        <div class="us-pg" id="usPg"></div><div id="usPanel"></div></div>`;
      $('usSearch').onclick = () => { query = $('usQ').value.trim(); load(1); };
      $('usQ').onkeydown = e => { if (e.key === 'Enter') { query = $('usQ').value.trim(); load(1); } };
      if (canEdit) $('usAdd').onclick = () => form(null);
      ['pointerdown', 'keydown', 'input'].forEach(t => host.addEventListener(t, bump, true));
      if (typeof A !== 'undefined' && A.close) { const c0 = A.close; ours = () => (panel ? closePanel() : c0()); A.close = ours; undo = () => { if (A.close === ours) A.close = c0; }; } // Esc closes an open form first, as the register's windows do
      bump(true); load(1);
    }

    // ---- idle: 5 minutes without a touch or key on this screen closes it (the server drops its session by the same clock)
    function bump(first) {
      if (!alive || !unlocked) return;
      clearTimeout(idleT); idleT = setTimeout(() => { ctx.toast('Users closed: no activity for ' + Math.round(idleMs / 60000 * 10) / 10 + ' minutes.', false); home(); }, idleMs);
      const now = Date.now();
      if (first !== true && now - lastTouch > Math.min(30000, idleMs / 3)) { lastTouch = now; ctx.api('users-touch').then(r => { if (alive && r && r.needUnlock) { ctx.toast(r.message, false); home(); } }); }
      else if (first === true) lastTouch = now;
    }

    // ---- list (144)
    async function load(pg) {
      const m = $('usMsg'); if (!m) return; m.className = 'msg'; m.textContent = 'Loading…';
      const r = await ctx.api('users-list', { name: query, page: pg });
      if (!alive || !$('usMsg')) return;
      if (r && r.needUnlock) { ctx.toast(r.message, false); return home(); }
      if (!r || !r.ok) { m.className = 'msg err'; m.textContent = (r && r.message) || 'Could not load the operators.'; return; }
      m.textContent = ''; page = r.page; total = r.total; pageSize = r.pageSize || 20; rows = r.rows || [];
      drawRows();
    }
    function drawRows() {
      const tb = $('usRows'); if (!tb) return;
      tb.innerHTML = rows.length ? rows.map((o, i) => `<tr data-i="${i}"><td>${esc(o.name)}</td><td>${esc(o.userName)}</td><td>${esc(o.position)}</td><td>${esc(o.createTime)}</td><td class="us-act">${canEdit ? '<button class="pbtn s" data-edit>Edit</button>' : ''}<span class="us-extra"></span></td></tr>`).join('') : '<tr><td colspan="5" class="us-empty">No operators found.</td></tr>';
      tb.querySelectorAll('tr[data-i]').forEach(tr => {
        const o = rows[Number(tr.dataset.i)], eb = tr.querySelector('[data-edit]');
        if (eb) eb.onclick = () => form(o);
        ctx.mount('users.extra', tr.querySelector('.us-extra'), { user: { id: o.id, name: o.name, userName: o.userName, position: o.position, createTime: o.createTime, fingerPrintCount: o.fingerPrintCount || 0, fingerPrints: Array.isArray(o.fingerPrints) ? o.fingerPrints : [] } });
      });
      const pages = Math.max(1, Math.ceil(total / pageSize));
      $('usPg').innerHTML = `<span>${total} operator${total === 1 ? '' : 's'}</span><button class="pbtn s" id="usPrev"${page <= 1 ? ' disabled' : ''}>Previous</button><span>Page ${page} of ${pages}</span><button class="pbtn s" id="usNext"${page >= pages ? ' disabled' : ''}>Next</button>`;
      $('usPrev').onclick = () => load(page - 1); $('usNext').onclick = () => load(page + 1);
    }

    // ---- Add Operator / Edit (Edit loads the operator with 145)
    function closePanel() { panel = null; const p = $('usPanel'); if (p) p.innerHTML = ''; }
    function shell(html) {
      const p = $('usPanel'); if (!p) return null; panel = panel || {};
      const top = Math.max(0, Math.round(host.getBoundingClientRect().top)); // overlay starts under the top bar
      p.innerHTML = `<div class="us-ov" style="--us-top:${top}px"><div class="us-card" id="usCard">${html}</div></div>`;
      return p.querySelector('#usCard');
    }
    async function form(row) {
      if (!canEdit) return;
      let op = { id: '', name: '', phone: '', email: '', position: '', description: '', userId: '', userName: '' };
      const edit = !!row;
      if (edit) {
        panel = { edit: true }; shell('<h3>Edit</h3><p class="note">Loading…</p>');
        const r = await ctx.api('users-get', { id: row.id });
        if (!alive || !panel) return;
        if (r && r.needUnlock) { ctx.toast(r.message, false); return home(); }
        if (!r || !r.ok) { closePanel(); const m = $('usMsg'); if (m) { m.className = 'msg err'; m.textContent = (r && r.message) || 'Could not load this operator.'; } return; }
        op = { ...op, ...r.operator };
      }
      panel = { edit, op };
      draw();
      function draw(msg) {
        const c = shell(`<h3>${edit ? 'Edit' : 'Add Operator'}</h3>
          <label class="f">Operator Name</label><input class="f" id="fName" maxlength="100" data-kb="text" autocomplete="off" value="${esc(op.name)}">
          <label class="f">Username</label>${edit ? `<div class="us-un" id="fUser">${esc(op.userName)}</div>` : `<div class="us-un"><span id="fUser">${op.userName ? esc(op.userName) : '<i>none chosen</i>'}</span> <button class="pbtn s" id="fPick" style="padding:5px 12px;font-size:13px">Select User</button></div>`}
          <label class="f">Phone</label><input class="f" id="fPhone" maxlength="40" data-kb="text" autocomplete="off" value="${esc(op.phone)}">
          <label class="f">Email</label><input class="f" id="fEmail" maxlength="120" data-kb="text" autocomplete="off" value="${esc(op.email)}">
          <label class="f">Position</label><input class="f" id="fPos" maxlength="80" data-kb="text" autocomplete="off" value="${esc(op.position)}">
          <label class="f">Remark</label><textarea class="f" id="fDesc" maxlength="500" data-kb="text">${esc(op.description)}</textarea>
          <div class="msg ${msg ? 'err' : ''}" id="fMsg">${esc(msg || '')}</div>
          <div class="row2"><button class="pbtn s" id="fCancel">Cancel</button><button class="pbtn g" id="fSave">Save</button></div>`);
        if (!c) return;
        const read = () => { op = { ...op, name: c.querySelector('#fName').value.trim(), phone: c.querySelector('#fPhone').value.trim(), email: c.querySelector('#fEmail').value.trim(), position: c.querySelector('#fPos').value.trim(), description: c.querySelector('#fDesc').value.trim() }; };
        c.querySelector('#fCancel').onclick = closePanel;
        if (!edit) c.querySelector('#fPick').onclick = () => { read(); pick(); };
        c.querySelector('#fSave').onclick = () => {
          read();
          if (!op.name) return draw('Enter the operator name.');
          if (!edit && !op.userId) return draw('Select the user for this operator.');
          if (op.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(op.email)) return draw('Enter a valid email.');
          confirm();
        };
        c.querySelector('#fName').focus();
      }
      // confirm step before anything is saved
      function confirm(msg) {
        const c = shell(`<h3>${edit ? 'Edit' : 'Add Operator'}</h3><div class="us-sum">${edit ? 'Save the changes to' : 'Add'} <b>${esc(op.name)}</b> (${esc(op.userName)})${op.position ? ', ' + esc(op.position) : ''}?</div>
          <div class="msg ${msg ? 'err' : ''}" id="fMsg">${esc(msg || '')}</div><div class="row2"><button class="pbtn s" id="fBack">Back</button><button class="pbtn g" id="fOk">Confirm</button></div>`);
        if (!c) return;
        c.querySelector('#fBack').onclick = () => draw();
        c.querySelector('#fOk').onclick = async () => {
          const b = c.querySelector('#fOk'); b.disabled = true; c.querySelector('#fBack').disabled = true; c.querySelector('#fMsg').textContent = 'Saving…';
          const r = await ctx.api(edit ? 'users-change' : 'users-create', { ...op, confirm: true });
          if (!alive || !panel) return;
          if (r && r.needUnlock) { ctx.toast(r.message, false); return home(); }
          if (r && r.ok) { closePanel(); ctx.toast(edit ? 'Saved.' : 'Operator added.', true); return load(edit ? page : 1); }
          if (r && r.uncertain) return confirm((r.message || 'Not sure it saved.') + ' Check the list before trying again.');
          confirm((r && r.message) || 'Could not save.');
        };
      }
      // login picker (call 20): Add Operator only
      function pick(text, pg) {
        const c = shell(`<h3>Select User</h3><div class="us-bar"><input class="f" id="pQ" placeholder="Username" data-kb="text" autocomplete="off" style="width:240px" value="${esc(text || '')}"><button class="pbtn" id="pGo">Search</button></div>
          <div class="msg" id="fMsg"></div><div class="us-pick" id="pList"></div><div class="us-pg" id="pPg"></div><div class="row2"><button class="pbtn s" id="pBack">Back</button></div>`);
        if (!c) return;
        c.querySelector('#pBack').onclick = () => draw();
        const run = async (p2) => {
          const t = c.querySelector('#pQ').value.trim(); c.querySelector('#fMsg').textContent = 'Loading…';
          const r = await ctx.api('users-pick', { text: t, page: p2 });
          if (!alive || !panel || !c.isConnected) return;
          if (r && r.needUnlock) { ctx.toast(r.message, false); return home(); }
          if (!r || !r.ok) { c.querySelector('#fMsg').className = 'msg err'; c.querySelector('#fMsg').textContent = (r && r.message) || 'Could not load the users.'; return; }
          c.querySelector('#fMsg').textContent = '';
          const pgs = Math.max(1, Math.ceil(r.total / (r.pageSize || 20)));
          c.querySelector('#pList').innerHTML = r.rows.length ? '<table>' + r.rows.map((u, i) => `<tr><td>${esc(u.userName)}</td><td>${esc(u.realName)}</td><td><button class="pbtn s" data-i="${i}" style="padding:4px 10px;font-size:13px">Select</button></td></tr>`).join('') + '</table>' : '<div class="us-empty">No users found.</div>';
          c.querySelectorAll('#pList [data-i]').forEach(b => b.onclick = () => { const u = r.rows[Number(b.dataset.i)]; op = { ...op, userId: u.id, userName: u.userName }; draw(); });
          c.querySelector('#pPg').innerHTML = `<button class="pbtn s" id="pPrev"${r.page <= 1 ? ' disabled' : ''}>Previous</button><span>Page ${r.page} of ${pgs}</span><button class="pbtn s" id="pNext"${r.page >= pgs ? ' disabled' : ''}>Next</button>`;
          c.querySelector('#pPrev').onclick = () => run(r.page - 1); c.querySelector('#pNext').onclick = () => run(r.page + 1);
        };
        c.querySelector('#pGo').onclick = () => run(1); c.querySelector('#pQ').onkeydown = e => { if (e.key === 'Enter') run(1); };
        run(pg || 1);
      }
    }

    start();
    return () => { // leaving the screen (tab, Esc, logout, idle): drop the manager session; nothing stays in the page
      alive = false; clearTimeout(idleT); clearInterval(cancelT);
      if (undo) undo();
      ctx.api('users-lock');
      if (!unlocked && typeof closeModal === 'function' && document.getElementById('mlOk')) closeModal();
    };
  }

  g.AirMaxSections.register({ id: 'users', render });
})();

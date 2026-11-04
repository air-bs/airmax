// Batch 8: cash fixes for managers (calls 111, 106, 117) in the Reports screens' slots:
//   reports.shifts.row-actions  (extra: { row })  -> "Mark short/over handled" for a shift (106)
//   reports.zreads.row-actions  (extra: { row })  -> "Cancel Z-read" (117)
//   reports.fixes               (no extra)        -> list of cash short/over records, "Mark handled" one by one (111)
// Cashiers never see these buttons (and the server refuses them). A reason is always written, then a manager types their password.
(function () {
  const H = window.AirMaxB8; if (!H || !window.AirMaxMounts) return;
  const { esc, money, when } = H;
  const isMgr = async ctx => { const p = await Promise.resolve(ctx.perms && ctx.perms()).catch(() => null); return !!(p && p.manager); };

  // reason first, then the manager's password, then the call
  function fix(ctx, { title, text, route, body, okMsg, after, typeNo }) {
    if (typeof modal !== 'function') return;
    modal(`<h2>${esc(title)}</h2><p class="note">${esc(text)}</p><label class="f">Reason (required, 3 to 200 letters)</label><textarea class="f" id="b8rs" maxlength="200" data-kb="text" style="width:100%;min-height:70px" autofocus></textarea>${typeNo ? `<label class="f">Type the Z-read number to confirm (${esc(typeNo)})</label><input class="f" id="b8zn" autocomplete="off" data-kb="text">` : ''}<div id="b8rm" class="msg"></div><div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button><button class="pbtn g" id="b8rn">Continue</button></div>`, () => {
      document.getElementById('b8rn').onclick = () => {
        const reason = document.getElementById('b8rs').value.trim();
        if (reason.length < 3) { document.getElementById('b8rm').textContent = 'Write a reason first.'; return; }
        const zn = typeNo ? document.getElementById('b8zn').value.trim() : undefined;
        if (typeNo && zn.toUpperCase() !== String(typeNo).trim().toUpperCase()) { document.getElementById('b8rm').textContent = 'Type the Z-read number exactly (' + typeNo + ').'; return; }
        H.manager(title, text + ' A manager types their password to approve it.', async m => {
          const r = await ctx.api(route, { ...body, reason, ...(typeNo ? { zNumber: zn } : {}), ...m });
          if (r.ok) { if (ctx.toast) ctx.toast(r.message || okMsg, true); if (after) after(r); return null; }
          if (r.notAvailable || r.unknown) { if (ctx.toast) ctx.toast(r.message, false); if (typeof closeModal === 'function') closeModal(); return null; }
          return r;
        });
      };
    });
  }
  // Batch 2's Reports rows have no hasNewOrder; ask AIR POS (118 via cf-zreads) once per few seconds and look the row up
  let zc = null, zt = 0;
  const zInfo = async (ctx, id) => { if (!zc || Date.now() - zt > 5000) { zt = Date.now(); zc = Promise.resolve(ctx.api('cf-zreads', {})).catch(() => null); } const r = await zc; return r && r.ok ? (r.rows || []).find(z => String(z.id) === id) : null; };
  // after a fix: redraw Batch 2's table (its own Search button) and the app
  const redraw = ctx => { zc = null; const g = document.getElementById('rpGo'); if (g) g.click(); else if (ctx.refresh) ctx.refresh(); };
  const btn = (host, label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rbtn'; b.textContent = label; b.onclick = fn; host.appendChild(b); return b; };

  AirMaxMounts.add('reports.shifts.row-actions', {
    id: 'b8-shift-fix',
    async render(host, ctx) {
      const row = ctx.row || {}, sid = String(row.id || row.sessionId || ''); if (!sid || !(await isMgr(ctx))) return;
      btn(host, 'Mark short/over handled', () => fix(ctx, { title: 'Mark shift short/over handled', text: 'Marks the cash short/over of shift ' + (row.number || row.sessionNumber || '') + ' as handled. No money moves.', route: 'cf-session-handle', body: { sessionId: sid }, okMsg: 'Marked as handled.', after: () => redraw(ctx) }));
    }
  });
  AirMaxMounts.add('reports.zreads.row-actions', {
    id: 'b8-zread-fix',
    async render(host, ctx) {
      const row = ctx.row || {}, id = String(row.id || ''); if (!id || row.hasNewOrder || !(await isMgr(ctx))) return;
      if (row.hasNewOrder === undefined) { const z = await zInfo(ctx, id); if (z && z.hasNewOrder) return; }
      btn(host, 'Cancel Z-read', () => fix(ctx, { title: 'Cancel Z-read', text: 'Cancels Z-read ' + (row.number || '') + '. Only possible while no sale has been made after it.', route: 'cf-zread-cancel', body: { id }, typeNo: String(row.number || ''), okMsg: 'Z-read cancelled.', after: () => redraw(ctx) }));
    }
  });
  AirMaxMounts.add('reports.fixes', {
    id: 'b8-cash-diffs',
    async render(host, ctx) {
      if (!(await isMgr(ctx))) return; H.style();
      const wrap = document.createElement('div'); wrap.className = 'b8'; wrap.style.display = 'block'; host.appendChild(wrap);
      const open = btn(wrap, 'Cash short/over records', load);
      const out = document.createElement('div'); wrap.appendChild(out);
      async function load() {
        out.innerHTML = '<div class="small">Looking…</div>'; const r = await ctx.api('cf-diffs', {});
        if (!r.ok) { out.innerHTML = `<div class="m err">${esc(r.message || 'Could not load')}</div>`; return; }
        out.innerHTML = `<table><tr><th>When</th><th>Shift</th><th class="n">Short / over</th><th>Status</th><th></th></tr>${(r.rows || []).map(t => `<tr><td>${esc(when(t.createTime || t.time))}</td><td>${esc(t.sessionNumber || '')}</td><td class="n">${money(t.diffAmount)}</td><td>${t.diffHandled ? '<span class="tag ok">Handled</span>' + (t.diffHandledRemark ? ' <span class="small">' + esc(t.diffHandledRemark) + '</span>' : '') : '<span class="tag warn">Open</span>'}</td><td>${t.diffHandled ? '' : `<button class="pb s" data-id="${esc(t.id)}">Mark handled</button>`}</td></tr>`).join('') || '<tr><td colspan="5">No short/over records.</td></tr>'}</table>`;
        out.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => fix(ctx, { title: 'Mark short/over handled', text: 'Marks this cash short/over record as handled. No money moves.', route: 'cf-tx-handle', body: { id: b.dataset.id }, okMsg: 'Marked as handled.', after: load }));
      }
      return () => { open.onclick = null; };
    }
  });
})();

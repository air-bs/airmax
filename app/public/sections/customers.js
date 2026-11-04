// AirMax Batch 5: Customers tab. Search a customer, see their files (list, upload, remove).
// Calls (app/api/customers.js): cust-files-list (83), cust-file-add (31 + 84), cust-file-remove (85); cust-tx-list (80), cust-bal-list (81), cust-pts-list (82);
// cust-credit-get / cust-credit-save (manager only). The customer search is the register's own member-find.
// Who sees what: the tab needs the AIR POS "Member Management" menu; the Credit box needs that AND the manager flag. Nothing is shown disabled: what a login may not use is not drawn.
// Customer files can be private documents: names are only shown on this screen, never logged or kept. The Checkout screen and Customer add (F3) are not touched.
// Reserved for Batch 8: the slot customers.account-box (inside the customer panel) is drawn empty here and filled by that batch.
(function () {
  'use strict';
  if (!window.AirMaxSections) return;
  const MAX_BYTES = 650 * 1024;
  const CSS = `
  .cu-wrap { display:grid; grid-template-columns:minmax(260px, 340px) 1fr; gap:12px; height:100%; min-height:0; padding:12px; font-size:14px; }
  .cu-left, .cu-right { background:#fff; border:1px solid var(--ap-line, #dcdfe6); border-radius:3px; min-height:0; display:flex; flex-direction:column; }
  .cu-left .cu-search { display:flex; gap:6px; padding:10px; border-bottom:1px solid var(--ap-line, #dcdfe6); }
  .cu-left input { flex:1; min-width:0; height:34px; border:1px solid var(--ap-line, #dcdfe6); border-radius:3px; padding:0 10px; font:inherit; }
  .cu-btn { border:1px solid var(--ap-blue-bd, #c0d8ff); background:#fff; color:var(--ap-blue, #146cff); border-radius:3px; padding:0 14px; min-height:34px; font:inherit; font-weight:600; cursor:pointer; }
  .cu-btn:hover { background:var(--ap-blue-bg, #ecf5ff); } .cu-btn:disabled { opacity:.5; cursor:default; }
  .cu-btn.pri { background:var(--ap-blue, #146cff); color:#fff; border-color:var(--ap-blue, #146cff); } .cu-btn.pri:hover { background:var(--ap-blue-l, #488afd); }
  .cu-btn.red { color:var(--ap-red, #ff0849); border-color:var(--ap-red-bd, #ffcecf); } .cu-btn.red:hover { background:var(--ap-red-bg, #fff2f2); }
  .cu-list { overflow:auto; flex:1; min-height:0; }
  .cu-row { display:block; width:100%; text-align:left; border:0; border-bottom:1px solid #edf1f4; background:#fff; padding:9px 12px; font:inherit; cursor:pointer; }
  .cu-row:hover { background:#f5f7f9; } .cu-row.on { background:var(--ap-blue-bg, #ecf5ff); box-shadow:inset 3px 0 0 var(--ap-blue, #146cff); }
  .cu-row b { display:block; font-weight:600; } .cu-row small { color:#6b7785; }
  .cu-empty { color:#7f8c8d; text-align:center; padding:40px 12px; }
  .cu-head { padding:12px 16px; border-bottom:1px solid var(--ap-line, #dcdfe6); } .cu-head h2 { margin:0 0 2px; font-size:20px; font-weight:600; } .cu-head small { color:#6b7785; }
  .cu-body { overflow:auto; flex:1; min-height:0; padding:12px 16px; display:flex; flex-direction:column; gap:14px; }
  .cu-box { border:1px solid var(--ap-line, #dcdfe6); border-radius:3px; } .cu-box > h3 { margin:0; padding:9px 12px; font-size:14px; font-weight:600; background:#f4f7f9; border-bottom:1px solid var(--ap-line, #dcdfe6); display:flex; align-items:center; gap:10px; }
  .cu-box > h3 .sp { flex:1; }
  .cu-files table { width:100%; border-collapse:collapse; } .cu-files td, .cu-files th { padding:8px 12px; border-bottom:1px solid #edf1f4; text-align:left; } .cu-files th { font-size:12.5px; color:#566573; background:#fff; }
  .cu-files td.act { text-align:right; white-space:nowrap; width:1%; }
  .cu-ask { background:var(--ap-red-bg, #fff2f2); }
  .cu-note { padding:8px 12px; color:#566573; font-size:12.5px; }
  .cu-hide { display:none; }
  .cu-tabs { display:flex; gap:4px; border-bottom:1px solid var(--ap-line, #dcdfe6); }
  .cu-tab { border:1px solid transparent; border-bottom:0; background:none; padding:8px 14px; font:inherit; font-weight:600; color:#566573; cursor:pointer; border-radius:3px 3px 0 0; margin-bottom:-1px; }
  .cu-tab.on { color:var(--ap-blue, #146cff); background:#fff; border-color:var(--ap-line, #dcdfe6); }
  .cu-filters { display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:10px 12px; border-bottom:1px solid #edf1f4; }
  .cu-filters label { display:flex; gap:6px; align-items:center; color:#566573; font-size:13px; }
  .cu-filters input[type=text], .cu-filters input[type=date], .cu-filters select { height:32px; border:1px solid var(--ap-line, #dcdfe6); border-radius:3px; padding:0 8px; font:inherit; }
  .cu-hist table { width:100%; border-collapse:collapse; } .cu-hist td, .cu-hist th { padding:7px 12px; border-bottom:1px solid #edf1f4; text-align:left; } .cu-hist th { font-size:12.5px; color:#566573; }
  .cu-hist .num { text-align:right; white-space:nowrap; } .cu-neg { color:var(--ap-red, #ff0849); } .cu-pos { color:#1b8a4b; }
  .cu-pager { display:flex; gap:10px; align-items:center; justify-content:flex-end; padding:8px 12px; color:#566573; font-size:13px; }
  .cu-credit { border-color:#d9c4ee; } .cu-credit > h3 { background:#f8f2fd; }
  .cu-credit .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; padding:10px 12px; }
  .cu-credit .row label { display:flex; gap:8px; align-items:center; } .cu-credit input[type=text] { width:120px; height:32px; border:1px solid var(--ap-line, #dcdfe6); border-radius:3px; padding:0 8px; font:inherit; text-align:right; }
  .cu-tag { font-size:11px; font-weight:600; color:#fff; background:#7a3fb5; border-radius:3px; padding:1px 6px; }
  `;
  let cleanupFn = null;

  AirMaxSections.register({
    id: 'customers',
    allowed: async c => { const p = await c.perms(); return !!(p && p.ok !== false && p.hasMenu('Member Management')); },
    render(host, ctx) {
      if (!document.getElementById('cuStyle')) { const s = document.createElement('style'); s.id = 'cuStyle'; s.textContent = CSS; document.head.appendChild(s); }
      const E = ctx.esc;
      host.innerHTML = `<div class="cu-wrap" id="cuWrap">
        <div class="cu-left"><div class="cu-search"><input id="cuQ" type="search" placeholder="Name, phone, number or e-mail" autocomplete="off"><button class="cu-btn pri" id="cuGo">Search</button></div>
          <div class="cu-list" id="cuList"><div class="cu-empty">Loading…</div></div></div>
        <div class="cu-right" id="cuRight"><div class="cu-empty">Pick a customer on the left.</div></div></div>`;
      const $ = id => host.querySelector('#' + id);
      let cur = null, alive = true, seq = 0, listSeq = 0;

      const showList = async () => {
        const my = ++listSeq; $('cuList').innerHTML = '<div class="cu-empty">Searching…</div>';
        const r = await ctx.api('member-find', { keyword: $('cuQ').value });
        if (!alive || my !== listSeq) return;
        if (!r || r.ok === false) { $('cuList').innerHTML = `<div class="cu-empty">${E((r && r.message) || 'Could not load customers')}</div>`; return; }
        const rows = r.rows || [];
        $('cuList').innerHTML = rows.length ? rows.map(m => `<button class="cu-row${cur && cur.id === m.id ? ' on' : ''}" data-id="${E(m.id)}"><b>${E(m.name || '(no name)')}</b><small>${E(m.mobile || m.number || '')}</small></button>`).join('') : `<div class="cu-empty">${E(r.message || 'No customers found')}</div>`;
        $('cuList').querySelectorAll('.cu-row').forEach(b => b.onclick = () => pick(rows.find(m => m.id === b.dataset.id)));
      };

      const pick = m => {
        if (!m) return; cur = m;
        $('cuList').querySelectorAll('.cu-row').forEach(b => b.classList.toggle('on', b.dataset.id === m.id));
        $('cuRight').innerHTML = `<div class="cu-head"><h2>${E(m.name || '(no name)')}</h2><small>${E([m.mobile, m.email].filter(Boolean).join(' · ') || m.number || '')}</small></div>
          <div class="cu-body"><div id="cuCredit"></div><div id="cuAcct"></div>
            <div class="cu-tabs" id="cuTabs"><button class="cu-tab on" data-t="files">Files</button><button class="cu-tab" data-t="tx">Transaction Records</button><button class="cu-tab" data-t="bal">Account Balance</button><button class="cu-tab" data-t="pts">Point Records</button></div>
            <div class="cu-box cu-files" id="cuFiles"><h3>Files <span class="sp"></span><button class="cu-btn" id="cuUp">Upload File</button><input type="file" id="cuPick" multiple class="cu-hide"></h3>
              <div id="cuFilesBody"><div class="cu-note">Loading…</div></div></div>
            <div class="cu-box cu-hist cu-hide" id="cuHist"></div></div>`;
        $('cuTabs').querySelectorAll('.cu-tab').forEach(b => b.onclick = () => tab(m, b.dataset.t));
        showCredit(m);
        ctx.mount('customers.account-box', $('cuAcct'), { customer: m.id });
        $('cuUp').onclick = () => $('cuPick').click();
        $('cuPick').onchange = ev => upload(m, [...ev.target.files], ev.target);
        loadFiles(m);
      };

      // ---- sub tabs
      const tab = (m, t) => {
        $('cuTabs').querySelectorAll('.cu-tab').forEach(b => b.classList.toggle('on', b.dataset.t === t));
        $('cuFiles').classList.toggle('cu-hide', t !== 'files'); $('cuHist').classList.toggle('cu-hide', t === 'files');
        if (t !== 'files') history(m, t);
      };

      // ---- manager only: Allow Credit Payment + Credit Amount (AIR POS customer record). Not drawn at all for anyone else.
      let perm = null;
      ctx.perms().then(p => { perm = p; if (alive && cur) showCredit(cur); }).catch(() => {});
      const fmt = x => ctx.money(Number(x) || 0);
      const showCredit = async m => {
        const box = $('cuCredit'); if (!box) return;
        if (!perm || !perm.manager || !perm.hasMenu('Member Management')) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="cu-box cu-credit"><h3>Credit <span class="cu-tag">MANAGER</span></h3><div class="cu-note">Loading…</div></div>';
        const r = await ctx.api('cust-credit-get', { retailMemberId: m.id });
        if (!alive || !cur || cur.id !== m.id || !$('cuCredit')) return;
        if (!r || r.ok === false) { $('cuCredit').innerHTML = r && r.forbidden ? '' : `<div class="cu-box cu-credit"><h3>Credit <span class="cu-tag">MANAGER</span></h3><div class="cu-note">${E((r && r.message) || 'Could not load credit')}</div></div>`; return; }
        $('cuCredit').innerHTML = `<div class="cu-box cu-credit"><h3>Credit <span class="cu-tag">MANAGER</span></h3>
          <div id="cuDiscHost"></div>
          <div class="row"><label><input type="checkbox" id="cuAllow"> Allow Credit Payment</label><label>Credit Amount <input type="text" id="cuAmt" inputmode="decimal" autocomplete="off"></label><button class="cu-btn pri" id="cuCrSave" disabled>Save credit</button></div>
          <div class="cu-note" id="cuCrNote">Store credit balance: ${E(fmt(r.balance))} (read only, changed by recharges and sales). The most this customer can put on account is the balance plus the Credit Amount.</div></div>`;
        if (window.AirMaxCreditDiscount) AirMaxCreditDiscount.draw($('cuDiscHost'), m, ctx, { balance: fmt(r.balance) });   // Extra 12: the customer's Discount, top strip (credit-discount.js)
        const al = $('cuAllow'), am = $('cuAmt'), sv = $('cuCrSave'); al.checked = !!r.allow; am.value = Number(r.amount || 0).toFixed(2);
        const dirty = () => { sv.disabled = (al.checked === !!r.allow && Number(am.value) === Number(r.amount)); };
        al.onchange = am.oninput = dirty;
        sv.onclick = () => {
          const amt = am.value.trim();
          if (!/^\d{1,7}(\.\d{1,2})?$/.test(amt)) { ctx.toast('Credit Amount must be a number like 250.00', false); return; }
          $('cuCrNote').innerHTML = `Set Credit Amount to ${E(fmt(amt))} and Allow Credit Payment to ${al.checked ? 'On' : 'Off'} for ${E(m.name || 'this customer')}? <button class="cu-btn pri" data-yes>Save</button> <button class="cu-btn" data-no>Cancel</button>`;
          $('cuCrNote').querySelector('[data-no]').onclick = () => showCredit(m);
          $('cuCrNote').querySelector('[data-yes]').onclick = async () => {
            // Gordon (Nov 3): a logged-in manager (RetailManager) is never asked for the manager password again; the confirm above is enough
            if (perm && perm.manager) {
              const w = await ctx.api('cust-credit-save', { retailMemberId: m.id, allow: al.checked, amount: Number(amt), confirmed: true });
              if (w && w.ok) { ctx.toast(w.message || 'Saved', true); if (alive && cur && cur.id === m.id) showCredit(m); }
              else ctx.toast((w && w.message) || 'Could not save credit', false);
              return;
            }
            if (typeof managerLogin !== 'function') { ctx.toast('The manager password window is not available', false); return; }
            // the manager unlocks the change by typing their user name + password (the register's own manager approval window)
            managerLogin('Change customer credit', `A manager types their password to set Credit Amount to ${fmt(amt)} and Allow Credit Payment ${al.checked ? 'On' : 'Off'} for ${m.name || 'this customer'}.`, async b => {
              const w = await ctx.api('cust-credit-save', { retailMemberId: m.id, allow: al.checked, amount: Number(amt), confirmed: true, user: b.user, password: b.password });
              if (w && w.ok) { if (typeof closeModal === 'function') closeModal(); ctx.toast(w.message || 'Saved', true); if (alive && cur && cur.id === m.id) showCredit(m); return null; }
              return { ok: false, message: (w && w.message) || 'Could not save credit' };
            });
          };
        };
      };

      // ---- read-only history: 80 Transaction Records, 81 Account Balance, 82 Point Records (20 per page)
      const TYPES3 = [[10, 'Expense'], [20, 'Recharge'], [30, 'Refund']], DEFS = {
        tx: { route: 'cust-tx-list', head: ['Transaction NO.', 'Type', 'Transaction Time', 'Payments', 'Transaction Amount', 'Balance Affected', 'Balance'], none: 'No transaction records.', num: [4, 5, 6],
          filters: `<label><select id="hfType"><option value="">All types</option>${TYPES3.map(t => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select></label><label>From <input type="date" id="hfFrom"></label><label>To <input type="date" id="hfTo"></label><label><input type="checkbox" id="hfOnly" checked> Only Balance Affected</label>`,
          body: () => ({ transactionType: v('hfType'), beginDate: v('hfFrom'), endDate: v('hfTo'), onlyBalanceAffected: $('hfOnly').checked }),
          row: r => `<td>${E(r.number)}</td><td>${E(r.typeName)}</td><td>${E(when(r.time))}</td><td>${E(r.payments.map(p => p.name + ' ' + fmt(p.amount)).join(', '))}</td><td class="num ${cls(r.type)}">${E(fmt(r.amount))}</td><td class="num ${cls(r.type)}">${E(fmt(r.balanceAffected))}</td><td class="num">${r.balance ? E(fmt(r.balance)) : ''}</td>` },
        bal: { route: 'cust-bal-list', head: ['Order NO.', 'Type', 'Amount', 'Create Time'], none: 'No account balance records.', num: [2],
          filters: `<label><input type="text" id="hfNum" placeholder="Search by Order NO." autocomplete="off"></label><label><select id="hfType"><option value="">All types</option>${TYPES3.map(t => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select></label>`,
          body: () => ({ targetNumber: v('hfNum'), type: v('hfType') }),
          row: r => `<td>${E(r.target)}</td><td>${E(r.typeName)}</td><td class="num ${cls(r.type)}">${E(fmt(r.amount))}</td><td>${E(when(r.time))}</td>` },
        pts: { route: 'cust-pts-list', head: ['Order NO.', 'Type', 'Status', 'Points', 'Used Points', 'Create Time', 'Expired Time'], none: 'No point records.', num: [3, 4],
          filters: `<label><input type="text" id="hfNum" placeholder="Search by Order NO." autocomplete="off"></label><label><select id="hfType"><option value="">All types</option><option value="1">Order Recharge Points</option><option value="2">Order Expense Points</option><option value="3">Refund Expense Points</option><option value="4">Refund Recharge Points</option></select></label><label><select id="hfStatus"><option value="">All statuses</option><option value="1">Enabled</option><option value="2">Expired</option><option value="3">Used</option></select></label>`,
          body: () => ({ targetNumber: v('hfNum'), type: v('hfType'), status: v('hfStatus') }),
          row: r => `<td>${E(r.target)}</td><td>${E(r.typeName)}</td><td>${E(r.statusName)}</td><td class="num">${E(r.points)}</td><td class="num">${E(r.usedPoints)}</td><td>${E(when(r.time))}</td><td>${E(when(r.expires))}</td>` } };
      const v = id => { const el = $(id); return el && el.value !== '' ? el.value : null; };
      const cls = t => (t === 10 ? 'cu-neg' : t === 20 ? 'cu-pos' : '');
      const when = t => { const d = new Date(String(t || '').replace(' ', 'T')); return isNaN(d) ? String(t || '') : d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }); };
      let hseq = 0, paneGen = 0;
      const history = (m, t, page = 1) => {
        const d = DEFS[t], pane = $('cuHist'); const ownFilters = pane.dataset.t === t && pane.dataset.m === m.id;
        if (!ownFilters) { const gen = ++paneGen; pane.dataset.t = t; pane.dataset.m = m.id; pane.innerHTML = `<div class="cu-filters">${d.filters}</div><div id="cuHistBody"><div class="cu-note">Loading…</div></div>`; // a filter that is removed while it has focus fires 'change' once more: only the pane that is on screen may answer
          pane.querySelectorAll('.cu-filters input, .cu-filters select').forEach(el => { const go = () => { if (gen === paneGen && el.isConnected) history(m, t, 1); }; el.onchange = go; if (el.type === 'text') el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }; }); }
        load(m, t, page);
      };
      const load = async (m, t, page) => {
        const d = DEFS[t], my = ++hseq, body = $('cuHistBody'); if (!body) return;
        const r = await ctx.api(d.route, { retailMemberId: m.id, page, pageSize: 20, ...d.body() });
        if (!alive || my !== hseq || !$('cuHistBody') || !cur || cur.id !== m.id) return;
        if (!r || r.ok === false) { $('cuHistBody').innerHTML = `<div class="cu-note">${E((r && r.message) || 'Could not load the records')}</div>`; return; }
        const pages = Math.max(1, Math.ceil((r.total || 0) / (r.pageSize || 20)));
        $('cuHistBody').innerHTML = r.rows.length ? `<table><thead><tr>${d.head.map((h, i) => `<th${d.num.includes(i) ? ' class="num"' : ''}>${E(h)}</th>`).join('')}</tr></thead><tbody>${r.rows.map(x => `<tr>${d.row(x)}</tr>`).join('')}</tbody></table>
          <div class="cu-pager"><span>${r.total} record${r.total === 1 ? '' : 's'} · page ${r.page} of ${pages}</span><button class="cu-btn" id="hPrev"${r.page <= 1 ? ' disabled' : ''}>Previous</button><button class="cu-btn" id="hNext"${r.page >= pages ? ' disabled' : ''}>Next</button></div>` : `<div class="cu-note">${E(d.none)}</div>`;
        if (r.rows.length) { $('hPrev').onclick = () => load(m, t, r.page - 1); $('hNext').onclick = () => load(m, t, r.page + 1); }
      };

      const loadFiles = async (m, note) => {
        const my = ++seq, box = $('cuFilesBody'); if (!box) return;
        const r = await ctx.api('cust-files-list', { retailMemberId: m.id });
        if (!alive || my !== seq || !cur || cur.id !== m.id) return;
        if (!r || r.ok === false) { box.innerHTML = `<div class="cu-note">${E((r && r.message) || 'Could not load the files')}</div>`; return; }
        const rows = r.rows || [];
        box.innerHTML = (note ? `<div class="cu-note">${E(note)}</div>` : '') + (rows.length ? `<table><thead><tr><th>Name</th><th>Type</th><th></th></tr></thead><tbody>${rows.map(f => `<tr data-id="${E(f.id)}"><td>${E(f.name)}</td><td>${E(String(f.extension || '').replace(/^\./, '').toUpperCase())}</td><td class="act"><button class="cu-btn red" data-rm="${E(f.id)}">Remove</button></td></tr>`).join('')}</tbody></table>` : '<div class="cu-note">No files for this customer.</div>');
        box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => ask(m, rows.find(f => f.id === b.dataset.rm), b.closest('tr')));
      };

      // Remove asks first (AIR POS's own screen does not; AirMax does, by Gordon's decision)
      const ask = (m, f, tr) => {
        if (!f || !tr) return;
        tr.classList.add('cu-ask');
        tr.innerHTML = `<td colspan="2">Remove “${E(f.name)}” from this customer?</td><td class="act"><button class="cu-btn red" data-yes>Remove</button> <button class="cu-btn" data-no>Keep</button></td>`;
        tr.querySelector('[data-no]').onclick = () => loadFiles(m);
        tr.querySelector('[data-yes]').onclick = async ev => {
          ev.target.disabled = true;
          const r = await ctx.api('cust-file-remove', { retailMemberId: m.id, attachmentId: f.id, confirmed: true });
          ctx.toast((r && r.message) || (r && r.ok ? 'Removed' : 'Could not remove the file'), !!(r && r.ok));
          await loadFiles(m);
        };
      };

      const b64 = file => new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(new Error('read')); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(file); });
      const upload = async (m, files, input) => {
        if (!files.length) return;
        const big = files.find(f => f.size > MAX_BYTES), empty = files.find(f => !f.size);
        if (big || empty) { ctx.toast(big ? `“${big.name}” is too big here (limit ${Math.floor(MAX_BYTES / 1024)} KB per file)` : `“${empty.name}” is empty`, false); input.value = ''; return; }
        $('cuUp').disabled = true; let done = 0, last = '';
        for (const f of files) {
          $('cuFilesBody').insertAdjacentHTML('afterbegin', `<div class="cu-note" id="cuProg">Uploading ${E(f.name)}…</div>`);
          let r; try { r = await ctx.api('cust-file-add', { retailMemberId: m.id, files: [{ name: f.name, data: await b64(f) }] }); } catch (e) { r = { ok: false, message: 'Could not read the file' }; }
          if (r && r.ok) { done++; last = r.message || ''; } else { ctx.toast(`${f.name}: ${(r && r.message) || 'upload failed'}`, false); break; }
        }
        input.value = ''; const up = $('cuUp'); if (up) up.disabled = false;
        if (done) ctx.toast(done === 1 ? (last || 'File added') : `${done} files added`, true);
        if (alive && cur && cur.id === m.id) await loadFiles(m);
      };

      $('cuGo').onclick = showList;
      $('cuQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); showList(); } };
      showList();
      cleanupFn = () => { alive = false; };
      return cleanupFn;
    },
  });
})();

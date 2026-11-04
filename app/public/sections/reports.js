// AirMax API Batch 2: the Reports tab (manager only). Sub-screens: Shifts, Cash in / out, Z-reads, Sales report, E-sales by product, E-journal, Discount types.
// Reads first; the two "Generate" buttons (134 E-journal, 137 Discount types) sit behind a confirm box that locks while it runs, then the list is re-read.
// PDFs go to the printer the same way X / Z reports do (no in-app viewer: not decided yet). Routes: app/api/reports.js. No label or shortcut is added or changed elsewhere.
(function () {
  'use strict';
  const MENU = [
    { id: 'sales', label: 'Sales report', sub: 'filters + rows' },
    { id: 'esales', label: 'E-sales by product', sub: 'list · PDF' },
    { id: 'ejournal', label: 'E-journal', sub: 'list · PDF · generate' },
    { id: 'discount', label: 'Discount types', sub: 'list · PDF · generate' },
    { id: 'shifts', label: 'Shifts', sub: 'list · open one' },
    { id: 'cash', label: 'Cash in / out', sub: 'list' },
    { id: 'zreads', label: 'Z-reads', sub: 'list · saved copies' },
  ];
  const CSS = `
  .rp { display:flex; height:100%; min-height:0; background:var(--ap-bg,#f0f2f5); color:var(--ap-text,#262626); font-size:13px; }
  .rp * { box-sizing:border-box; }
  .rp-menu { width:210px; flex:none; background:#fff; border-right:1px solid var(--ap-line,#e7eaec); padding:12px 8px; overflow:auto; }
  .rp-menu h4 { margin:2px 8px 10px; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--ap-text3,#999); font-weight:600; }
  .rp-mi { display:block; width:100%; text-align:left; border:0; background:none; padding:9px 10px; margin-bottom:2px; border-radius:4px; cursor:pointer; border-left:3px solid transparent; font:inherit; color:inherit; }
  .rp-mi b { display:block; font-size:13px; } .rp-mi small { color:var(--ap-text3,#999); font-size:11px; }
  .rp-mi:hover { background:var(--ap-gray,#f7f8f9); } .rp-mi.on { background:var(--ap-blue-bg,#ecf5ff); border-left-color:var(--ap-blue,#146cff); color:var(--ap-blue,#146cff); }
  .rp-main { flex:1; min-width:0; padding:16px 18px; overflow:auto; }
  .rp-head { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
  .rp-head h2 { margin:0; font-size:18px; } .rp-head .sq { width:14px; height:14px; border-radius:3px; background:var(--ap-green,#18bea4); }
  .rp-head .sp { flex:1; }
  .rp-bar { display:flex; flex-wrap:wrap; align-items:center; gap:10px; background:#fff; border:1px solid var(--ap-line,#e7eaec); padding:10px 12px; border-radius:4px; margin-bottom:12px; }
  .rp-bar label { color:var(--ap-text2,#666); font-size:12px; display:flex; align-items:center; gap:6px; }
  .rp-bar input, .rp-bar select { height:30px; border:1px solid #dcdfe6; border-radius:4px; padding:0 8px; font:inherit; background:#fff; }
  .rp-btn { height:30px; padding:0 14px; border-radius:4px; border:1px solid var(--ap-blue,#146cff); background:var(--ap-blue,#146cff); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  .rp-btn.ghost { background:#fff; color:var(--ap-blue,#146cff); } .rp-btn.sm { height:24px; padding:0 10px; font-size:12px; }
  .rp-btn:disabled { opacity:.55; cursor:not-allowed; }
  .rp-tbl { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--ap-line,#e7eaec); }
  .rp-tbl th { text-align:left; background:var(--ap-gray,#f7f8f9); color:var(--ap-text2,#666); font-weight:600; font-size:12px; padding:9px 10px; border-bottom:1px solid var(--ap-line,#e7eaec); }
  .rp-tbl td { padding:9px 10px; border-bottom:1px solid var(--ap-line2,#f2f3f4); }
  .rp-tbl .n { text-align:right; font-variant-numeric:tabular-nums; } .rp-tbl th.n { text-align:right; }
  .rp-tbl tr.rp-click { cursor:pointer; } .rp-tbl tr.rp-click:hover td { background:var(--ap-gray,#f7f8f9); } .rp-tbl tr.sel td { background:var(--ap-blue-bg,#ecf5ff); }
  .rp-neg { color:#e5243b; font-weight:600; } .rp-pos { color:#18a058; font-weight:600; }
  .rp-tag { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; font-weight:600; background:#eef0f2; color:#555; }
  .rp-tag.g { background:#dff5e8; color:#18a058; } .rp-tag.o { background:#ffe9cc; color:#c26a00; }
  .rp-foot { display:flex; align-items:center; gap:8px; padding:8px 4px; color:var(--ap-text2,#666); font-size:12px; }
  .rp-foot .sp { flex:1; } .rp-pg { border:1px solid #dcdfe6; background:#fff; border-radius:3px; min-width:28px; height:26px; cursor:pointer; font:inherit; } .rp-pg:disabled { opacity:.5; cursor:default; }
  .rp-empty, .rp-err, .rp-load { background:#fff; border:1px solid var(--ap-line,#e7eaec); padding:26px; text-align:center; color:var(--ap-text2,#666); }
  .rp-err { color:#c0392b; }
  .rp-side { width:340px; flex:none; background:#fff; border-left:1px solid var(--ap-line,#e7eaec); padding:16px; overflow:auto; }
  .rp-side h3 { margin:0 0 2px; font-size:16px; } .rp-side .kv { display:flex; justify-content:space-between; padding:5px 0; } .rp-side .kv span:first-child { color:var(--ap-text2,#666); }
  .rp-side h5 { margin:16px 0 6px; font-size:13px; }
  .rp-note { color:var(--ap-text3,#999); font-size:12px; margin:8px 0; }
  .rp-ov { position:fixed; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:9000; }
  .rp-box { background:#fff; width:min(440px,92vw); border-radius:6px; padding:20px 22px; box-shadow:0 10px 40px rgba(0,0,0,.3); }
  .rp-box h3 { margin:0 0 8px; font-size:17px; } .rp-box p { margin:0 0 8px; line-height:1.4; } .rp-box .fine { color:var(--ap-text3,#999); font-size:12px; }
  .rp-box .acts { display:flex; justify-content:flex-end; gap:10px; margin-top:14px; } .rp-box input { height:30px; border:1px solid #dcdfe6; border-radius:4px; padding:0 8px; font:inherit; width:100%; margin-top:6px; }
  .rp-box .msg { color:#c0392b; min-height:18px; font-size:12px; margin-top:6px; }
  .rp-box .rp-dates label { display:inline-block; margin-right:10px; } .rp-box .rp-dates input { width:auto; }
  .rp-notice { margin:0 0 10px; padding:10px 14px; border-radius:4px; font-size:13px; line-height:1.4; display:flex; gap:10px; align-items:flex-start; } .rp-notice[hidden] { display:none; }
  .rp-notice.ok { background:#e6f6ec; color:#14703f; border:1px solid #b7e3c8; } .rp-notice.err { background:#fdecea; color:#a93226; border:1px solid #f1b9b2; } .rp-notice .x { margin-left:auto; border:0; background:none; font-size:16px; line-height:1; cursor:pointer; color:inherit; }
  .rp-act { white-space:nowrap; } .rp-act:empty { display:none; }
  `;
  const day = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const fmtDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); if (!m) return '—'; return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + (+m[3]); };
  const fmtTime = s => { const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? fmtDay(m[1]) + ', ' + m[2] + ':' + m[3] : '—'; }; // the time AIR POS wrote, as written (no zone shift)
  const hm = s => { const m = /T(\d{2}):(\d{2})/.exec(String(s || '')); return m ? m[1] + ':' + m[2] : '—'; };

  AirMaxSections.register({
    id: 'reports',
    allowed: async c => { const p = await c.perms(); return !!(p && p.ok && p.manager); }, // managers only; any other login does not see the tab
    render(host, ctx) {
      const E = ctx.esc, M = v => (Number(v) < 0 ? '-' + ctx.money(-Number(v)) : ctx.money(v)), api = ctx.api;
      if (!document.getElementById('rpStyle')) { const st = document.createElement('style'); st.id = 'rpStyle'; st.textContent = CSS; document.head.appendChild(st); }
      const today = new Date(), wk = new Date(today.getTime() - 6 * 864e5);
      const S = { screen: 'shifts', from: day(wk), to: day(today), operator: '', number: '', tab: 'Shift', vendor: '', page: 1, size: 10, token: 0, sel: null, side: null, side0: 0, busy: false };
      host.innerHTML = '<div class="rp" id="rp"><div class="rp-menu" id="rpMenu"></div><div class="rp-main"><div id="rpMain"></div><div class="mountrow" id="rpFix"></div></div><div class="rp-side" id="rpSide" hidden></div></div>';
      const $ = id => host.querySelector('#' + id), main = $('rpMain'), side = $('rpSide'), menu = $('rpMenu');
      const cleanups = []; let overlay = null;
      const fresh = () => ++S.token;

      function drawMenu() {
        menu.innerHTML = '<h4>Reports (manager only)</h4>' + MENU.map(m => '<button type="button" class="rp-mi' + (m.id === S.screen ? ' on' : '') + '" data-s="' + m.id + '"><b>' + E(m.label) + '</b><small>' + E(m.sub) + '</small></button>').join('');
        menu.querySelectorAll('.rp-mi').forEach(b => { b.onclick = () => go(b.dataset.s); });
      }
      function go(id) { if (S.busy) return; S.screen = id; S.notice = null; S.page = 1; S.sel = null; closeSide(); drawMenu(); draw(); }
      function closeSide() { S.side0++; side.hidden = true; side.innerHTML = ''; S.sel = null; S.side = null; }

      const title = () => (MENU.find(m => m.id === S.screen) || {}).label || '';
      const bar = opts => '<div class="rp-bar">' + (opts.tabs ? '<label>View <select id="rpTab"><option value="Shift">By shift</option><option value="Vendor">By vendor</option><option value="Product">By product</option><option value="ProductCategory">By category</option></select></label>' : '') +
        '<label>From <input type="date" id="rpFrom" value="' + E(S.from) + '"></label><label>To <input type="date" id="rpTo" value="' + E(S.to) + '"></label>' +
        (opts.op ? '<label>Operator <input type="text" id="rpOp" size="12" value="' + E(S.operator) + '" placeholder="All"></label>' : '') +
        (opts.num ? '<label>' + E(opts.num) + ' <input type="text" id="rpNum" size="14" value="' + E(S.number) + '" placeholder="All"></label>' : '') +
        (opts.tabs ? '<label id="rpVenL">Vendor <select id="rpVen"><option value="">All</option></select></label>' : '') +
        '<button type="button" class="rp-btn" id="rpGo">Search</button>' + (opts.extra || '') + '</div>';
      function wireBar() {
        const f = $('rpFrom'), t = $('rpTo'), o = $('rpOp'), n = $('rpNum'), tb = $('rpTab'), v = $('rpVen'); if (tb) tb.value = S.tab;
        const showVen = () => { const l = $('rpVenL'); if (l) l.hidden = !(tb && (tb.value === 'Vendor' || tb.value === 'Product')); }; showVen(); if (tb) tb.onchange = showVen;
        const go1 = () => { S.from = f.value; S.to = t.value; if (o) S.operator = o.value.trim(); if (n) S.number = n.value.trim(); if (tb) S.tab = tb.value; if (v) S.vendor = (tb && (tb.value === 'Vendor' || tb.value === 'Product')) ? v.value : ''; S.page = 1; closeSide(); load(); };
        $('rpGo').onclick = go1; [f, t, o, n].forEach(x => { if (x) x.onkeydown = e => { if (e.key === 'Enter') go1(); }; });
      }

      // ---- the screens: one table definition each ----
      const cell = (v, cls) => '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td>';
      const diffCell = d => d == null ? '—' : d < 0 ? '<span class="rp-neg">' + M(d) + '</span>' : d > 0 ? '<span class="rp-pos">+' + M(d) + '</span>' : M(0);
      const DT = [[10, 'SC', 'Senior citizen'], [20, 'PWD', 'Person with disability'], [30, 'SP', 'Solo parent'], [50, 'NAAC', 'National athlete and coach']];
      const pdfBtn = (id, extra, label, tip) => '<button type="button" class="rp-btn ghost sm" data-pdf="' + E(id) + '"' + (extra || '') + ' title="' + E(tip || 'Sends the PDF to the receipt printer, the same way X / Z reports print') + '">' + E(label || 'PDF') + '</button> ';
      const dash = (v, f) => v == null ? '—' : f ? f(v) : v;
      const SCREENS = {
        shifts: { route: 'reports-shifts', op: true, num: 'Shift no.', click: 'shift', slot: 'reports.shifts.row-actions',
          cols: ['Shift no.', 'Operator', 'Clock in', 'Clock out', ['Opening', 1], ['Counted at clock-out', 1], 'Status'],
          row: r => cell(E(r.number)) + cell(E(r.operator)) + cell(E(fmtTime(r.clockIn))) + cell(r.clockOut ? E(fmtTime(r.clockOut)) : '—') + cell(M(r.opening), 'n') + cell(r.counted == null ? '—' : M(r.counted), 'n') + cell('<span class="rp-tag ' + (r.statusCode === 0 ? 'g' : r.statusCode === 20 ? 'o' : '') + '">' + E(r.status || '') + '</span>') },
        cash: { route: 'reports-cash', op: true, num: 'Shift no.',
          cols: ['Record', 'Type', 'Shift', ['Difference', 1], ['Amount', 1], ['Balance', 1], 'Note', 'Time', 'Operator'],
          row: r => cell(E(r.number)) + cell(E(r.type)) + cell(E(r.shiftNumber || '—')) + cell(diffCell(r.hasDiff ? r.difference : 0) + (r.hasDiff ? ' <small>' + (r.handled ? 'handled' : 'not handled') + '</small>' : ''), 'n') + cell(M(r.amount), 'n') + cell(r.balance == null ? '—' : M(r.balance), 'n') + cell(E(r.note)) + cell(E(fmtTime(r.time))) + cell(E(r.operator)) },
        zreads: { route: 'reports-zreads', num: 'Z-read no.', click: 'zread', slot: 'reports.zreads.row-actions',
          cols: ['Z-read no.', 'Date', 'Period end', 'Operator', ['Orders', 1], ['Gross', 1], ['Net', 1]],
          row: r => cell(E(r.number)) + cell(E(fmtDay(r.date))) + cell(E(fmtTime(r.to))) + cell(E(r.operator)) + cell(String(r.orders), 'n') + cell(M(r.gross), 'n') + cell(M(r.net), 'n') },
        sales: { route: 'reports-sales', tabs: true,
          cols: ['Line', ['Orders', 1], ['Qty', 1], ['Gross', 1], ['Discounts', 1], ['Returns', 1], ['Net', 1]],
          row: r => cell(E(r.label) + (r.label2 ? ' <small>' + E(S.tab === 'Shift' ? fmtTime(r.label2) : r.label2) + '</small>' : '')) + cell(r.orders, 'n') + cell(r.quantity, 'n') + cell(M(r.gross), 'n') + cell(M(r.discount), 'n') + cell(M(r.returns), 'n') + cell(M(r.net), 'n') },
        esales: { route: 'reports-esales', num: 'Report no.', pdf: 'reports-print-esales',
          cols: ['Report date', 'Report no.', 'Created', ['Orders', 1], ['Products sold', 1], ['Total', 1], ['Open', 1]],
          row: r => cell(E(fmtDay(r.date))) + cell(E(r.number)) + cell(E(fmtTime(r.created))) + cell(dash(r.orders), 'n') + cell(dash(r.products), 'n') + cell(dash(r.total, M), 'n') + cell(pdfBtn(r.id), 'n') },
        ejournal: { route: 'reports-ejournal', num: 'Report no.', pdf: 'reports-print-ejournal', gen: { route: 'reports-ejournal-generate', label: 'Generate E-journal', what: 'E-journal', call: 134, dates: true },
          cols: ['Report no.', 'From', 'To', 'Created', ['Total', 1], ['Taxable', 1], ['Tax', 1], ['Open', 1]],
          row: r => cell(E(r.number)) + cell(E(fmtDay(r.from || r.date))) + cell(E(fmtDay(r.to || r.date))) + cell(E(fmtTime(r.created))) + cell(dash(r.total, M), 'n') + cell(dash(r.taxable, M), 'n') + cell(dash(r.tax, M), 'n') + cell(pdfBtn(r.id), 'n') },
        discount: { route: 'reports-discount', num: 'Report no.', pdf: 'reports-print-discount', gen: { route: 'reports-discount-generate', label: 'Generate report', what: 'discount-type report', call: 137 },
          cols: ['Report no.', 'Report date', 'Created', ['Open the PDF for', 1]],
          row: r => cell(E(r.number)) + cell(E(fmtDay(r.date))) + cell(E(fmtTime(r.created))) + cell(DT.map(d => pdfBtn(r.id, ' data-dt="' + d[0] + '"', d[1], d[2] + ' discount report: sent to the receipt printer')).join(''), 'n') },
      };

      // the app's own toast sits on the Checkout screen and is not visible here, so a result is shown in this screen (and also sent to the toast)
      function showNotice() { const n = $('rpNotice'); if (!n) return; const v = S.notice && S.notice.screen === S.screen ? S.notice : null; n.hidden = !v; n.className = 'rp-notice' + (v ? (v.ok ? ' ok' : ' err') : ''); n.innerHTML = '';
        if (v) { const t = document.createElement('span'); t.textContent = v.m; const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '×'; x.onclick = () => { S.notice = null; showNotice(); }; n.append(t, x); } }
      function notice(m, ok) { S.notice = { m: String(m || ''), ok: !!ok, screen: S.screen }; showNotice(); try { ctx.toast(m, !!ok); } catch (e) {} }
      function draw() {
        const sc = SCREENS[S.screen], gen = sc.gen;
        main.innerHTML = '<div class="rp-head"><span class="sq"></span><h2>' + E(title()) + '</h2><span class="sp"></span>' + (gen ? '<button type="button" class="rp-btn" id="rpGen">' + E(gen.label) + '</button>' : '') + '</div>' +
          '<div class="rp-notice" id="rpNotice" role="status" hidden></div>' + bar(sc) + '<div id="rpList"><div class="rp-load">Loading…</div></div>';
        wireBar(); showNotice();
        if (gen) $('rpGen').onclick = () => confirmGen(gen);
        load();
        if (S.screen === 'sales') api('reports-sales-model').then(r => { const v = $('rpVen'); if (v && r && r.ok) { v.innerHTML = '<option value="">All</option>' + (r.vendors || []).map(x => '<option value="' + E(x.id) + '">' + E(x.name) + '</option>').join(''); v.value = S.vendor; } });
      }

      async function load() {
        const sc = SCREENS[S.screen], my = fresh(), box = $('rpList'); if (!box) return;
        box.innerHTML = '<div class="rp-load">Loading…</div>';
        const r = await api(sc.route, { page: S.page, pageSize: S.size, from: S.from, to: S.to, operator: S.operator, number: S.number, tab: S.tab, vendorId: S.vendor }).catch(() => null);
        if (my !== S.token || !$('rpList')) return; // another screen or search started meanwhile
        if (!r || !r.ok) { box.innerHTML = '<div class="rp-err">' + E((r && r.message) || 'Could not load this list.') + '</div>'; return; }
        const rows = r.rows || [], pages = Math.max(1, Math.ceil((r.total || 0) / S.size));
        if (!rows.length) { box.innerHTML = '<div class="rp-empty">Nothing to show for these dates.</div>'; return; }
        box.innerHTML = '<table class="rp-tbl"><thead><tr>' + sc.cols.map(c => Array.isArray(c) ? '<th class="n">' + E(c[0]) + '</th>' : '<th>' + E(c) + '</th>').join('') + (sc.slot ? '<th></th>' : '') + '</tr></thead><tbody>' +
          rows.map((x, i) => '<tr data-i="' + i + '"' + (sc.click ? ' class="rp-click' + (S.sel === x.id ? ' sel' : '') + '"' : '') + '>' + sc.row(x) + (sc.slot ? '<td class="rp-act" data-slot="' + i + '"></td>' : '') + '</tr>').join('') + '</tbody></table>' +
          '<div class="rp-foot"><span>Rows ' + ((S.page - 1) * S.size + 1) + '–' + ((S.page - 1) * S.size + rows.length) + ' of ' + r.total + '</span><span class="sp"></span><button type="button" class="rp-pg" id="rpPrev"' + (S.page <= 1 ? ' disabled' : '') + '>‹</button><span>Page ' + S.page + ' of ' + pages + '</span><button type="button" class="rp-pg" id="rpNext"' + (S.page >= pages ? ' disabled' : '') + '>›</button></div>';
        $('rpPrev').onclick = () => { if (S.page > 1) { S.page--; load(); } }; $('rpNext').onclick = () => { if (S.page < pages) { S.page++; load(); } };
        box.querySelectorAll('[data-pdf]').forEach(b => { b.onclick = e => { e.stopPropagation(); printPdf(sc.pdf, b.dataset.dt ? { id: b.dataset.pdf, discountType: Number(b.dataset.dt) } : { id: b.dataset.pdf }, b); }; });
        box.querySelectorAll('tbody tr').forEach(tr => {
          const row = rows[+tr.dataset.i];
          if (sc.click) tr.onclick = e => { if (e.target.closest('.rp-act,button')) return; box.querySelectorAll('tr.sel').forEach(t => t.classList.remove('sel')); tr.classList.add('sel'); S.sel = row.id; open(sc.click, row); };
          const sl = tr.querySelector('[data-slot]'); if (sl) { sl.onclick = e => e.stopPropagation(); ctx.mount(sc.slot, sl, { row }); } // batch 8 fills these (fix buttons); empty until then
        });
      }

      // ---- side panels: one shift (104 + its cash records), the records of one Z-read (119) ----
      async function open(kind, row) {
        const my = ++S.side0; side.hidden = false; side.innerHTML = '<div class="rp-load">Loading…</div>';
        if (kind === 'shift') {
          const r = await api('reports-shift', { id: row.id }).catch(() => null); if (my !== S.side0 || side.hidden) return;
          if (!r || !r.ok) { side.innerHTML = '<div class="rp-err">' + E((r && r.message) || 'Could not open this shift.') + '</div>'; return; }
          const s = r.shift, hasDiff = r.cash.some(c => c.hasDiff);
          side.innerHTML = '<h3>Shift ' + E(s.number) + '</h3><div class="rp-note">Opened from the row you clicked</div>' +
            kv('Operator in / out', E(s.operator) + (s.operatorOut && s.operatorOut !== s.operator ? ' / ' + E(s.operatorOut) : '')) + kv('Clock in', E(fmtTime(s.clockIn))) + kv('Clock out', s.clockOut ? E(fmtTime(s.clockOut)) : '—') +
            kv('Opening cash', M(s.opening)) + kv('Counted at clock-out', s.counted == null ? '—' : M(s.counted)) + kv('Difference at the count', s.clockOut ? diffCell(hasDiff ? r.difference : 0) : '—') + kv('Status', E(s.status)) +
            '<h5>Cash records in this shift</h5>' + (r.cash.length ? '<table class="rp-tbl"><thead><tr><th>Time</th><th>Type</th><th class="n">Amount</th><th class="n">Diff.</th></tr></thead><tbody>' + r.cash.map(c => '<tr><td>' + E(hm(c.time)) + '</td><td>' + E(c.type) + '</td><td class="n">' + M(c.amount) + '</td><td class="n">' + (c.hasDiff ? diffCell(c.difference) : '') + '</td></tr>').join('') + '</tbody></table>' : '<div class="rp-note">No cash records.</div>');
        } else {
          const r = await api('reports-zrecords', { number: row.number, page: 1, pageSize: 50 }).catch(() => null); if (my !== S.side0 || side.hidden) return;
          if (!r || !r.ok) { side.innerHTML = '<div class="rp-err">' + E((r && r.message) || 'Could not open this Z-read.') + '</div>'; return; }
          side.innerHTML = '<h3>Z-read ' + E(row.number) + '</h3><div class="rp-note">' + E(row.station) + (row.station ? ' · ' : '') + E(fmtDay(row.date)) + '</div>' +
            kv('Orders', String(row.orders)) + kv('Gross sales', M(row.gross)) + kv('Discounts', M(row.discount)) + kv('Returns', M(row.returns)) + kv('Net sales', M(row.net)) + kv('Tax', M(row.tax)) + kv('Cash in drawer', row.cashInDrawer == null ? '—' : M(row.cashInDrawer)) +
            '<h5>Saved copies of this Z-read</h5>' + (r.rows.length ? '<table class="rp-tbl"><thead><tr><th>Saved at</th><th class="n">Reset no.</th><th class="n">Net</th></tr></thead><tbody>' + r.rows.map(c => '<tr><td>' + E(fmtTime(c.time)) + '</td><td class="n">' + c.reset + '</td><td class="n">' + M(c.net) + '</td></tr>').join('') + '</tbody></table>' : '<div class="rp-note">No saved copies.</div>');
        }
      }
      const kv = (a, b) => '<div class="kv"><span>' + E(a) + '</span><span>' + b + '</span></div>';

      // ---- PDF: fetched by the server and sent to the printer; the button locks while it runs ----
      async function printPdf(route, body, btn) {
        if (btn.disabled) return; btn.disabled = true; const t0 = btn.textContent;
        try { const r = await api(route, body); notice((r && r.message) || (r && r.ok ? 'Sent to printer' : 'Could not print the report'), !!(r && r.ok)); }
        catch (e) { notice('Could not print the report', false); } finally { btn.disabled = false; btn.textContent = t0; }
      }

      // ---- Generate (134 / 137): confirm box, then lock while it runs, then re-read the list ----
      function confirmGen(gen) {
        if (overlay && overlay.isConnected) return; const ov = document.createElement('div'); ov.className = 'rp-ov'; overlay = ov;
        ov.innerHTML = '<div class="rp-box" role="dialog" aria-modal="true"><h3>' + E(gen.label) + '?</h3><p>This asks AIR POS to <b>create a new ' + E(gen.what) + ' record</b> for this register. It does not change any sale, payment or cash amount.</p>' +
          '<p class="fine">It cannot be undone from here. Pressing it twice cannot make two records: the button locks while it runs and the list is re-read afterwards to confirm.</p>' + (gen.dates ? '<div class="rp-dates"><p>Which days should the E-journal cover? AIR POS needs both dates.</p><label>From <input type="date" id="rpGf" value="' + E(day(new Date())) + '"></label> <label>To <input type="date" id="rpGt" value="' + E(day(new Date())) + '"></label></div>' : '') + '<div id="rpMgr" hidden><p>A manager must approve this:</p><input id="rpMu" placeholder="Manager user name" autocomplete="off"><input id="rpMp" type="password" placeholder="Manager password" autocomplete="off"></div><div class="msg" id="rpMsg"></div>' +
          '<div class="acts"><button type="button" class="rp-btn ghost" id="rpNo">Cancel</button><button type="button" class="rp-btn" id="rpYes">' + E(gen.label) + '</button></div></div>';
        // inside the app's own modal holder: Esc then closes it like every other window, other keys are held back, and the bar will not change screen under it
        const mr = document.getElementById('modalRoot'); (mr || document.body).appendChild(ov);
        const yes = ov.querySelector('#rpYes'), no = ov.querySelector('#rpNo'), msg = ov.querySelector('#rpMsg');
        const close = () => { if (S.busy) return; ov.remove(); overlay = null; };
        no.onclick = close; ov.onclick = e => { if (e.target === ov) close(); };
        yes.onclick = async () => {
          if (S.busy) return; S.busy = true; yes.disabled = true; no.disabled = true; yes.textContent = 'Generating…'; msg.textContent = '';
          const body = {}; if (gen.dates) { body.from = ov.querySelector('#rpGf').value; body.to = ov.querySelector('#rpGt').value; } const u = ov.querySelector('#rpMu'), p = ov.querySelector('#rpMp'); if (!ov.querySelector('#rpMgr').hidden) { body.user = u.value.trim(); body.password = p.value; }
          let r = null; try { r = await api(gen.route, body); } catch (e) { r = null; }
          S.busy = false; // (Esc while it runs hides this box only: the request still finishes below and the list is re-read)
          if (r && r.needManager && !ov.isConnected) { r = null; }
          if (r && r.needManager) { yes.disabled = false; no.disabled = false; yes.textContent = gen.label; ov.querySelector('#rpMgr').hidden = false; msg.textContent = r.message || 'A manager must approve this.'; return; }
          close(); notice((r && r.message) || (r && r.ok ? gen.what + ' generated' : 'Could not generate the ' + gen.what), !!(r && r.ok));
          S.page = 1; if (SCREENS[S.screen] && SCREENS[S.screen].gen === gen) load(); // the list is re-read either way: it shows what AIR POS really has
        };
        yes.focus();
      }

      drawMenu(); draw();
      // one empty place for batch 8's fix buttons (the bar adds one too if a Reports screen does not draw it)
      ctx.mount('reports.fixes', $('rpFix'), {});
      cleanups.push(() => { if (overlay) { overlay.remove(); overlay = null; } fresh(); S.side0++; });
      return () => cleanups.forEach(f => f());
    },
  });
})();

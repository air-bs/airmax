// AirMax Batch 4: the ITEMS tab (look up price and stock, Quick Add grid, receiving orders, manager dashboard; item add / edit / price / Quick Add controls for managers with the Product Management permission).
// Plain script. Fills the "items" tab (Checkout and its Items button are not touched). Cashiers and managers without the permission can only look:
// Write controls (New item, Save item, Disable Item, Save price… + confirm box, Add to Quick Add, × on a Quick Add tile) are drawn ONLY when items-access says canEdit
// (manager + AIR POS Product Management permission); the server checks the same rule on every write.
// Server side: app/api/items.js (routes items-access, items-find, items-get, items-quick, items-inbound, items-inbound-get, items-dashboard).
(function () {
  if (!window.AirMaxSections) return;
  if (!document.getElementById('b4-items-css')) {
    const st = document.createElement('style'); st.id = 'b4-items-css';
    st.textContent = `
.b4{padding:14px 18px;height:100%;overflow:auto;box-sizing:border-box;font-family:inherit;color:#262626}
.b4 h2{margin:0;font-size:20px;letter-spacing:.3px}.b4 .b4note{color:#999;font-size:13px;margin-left:10px}
.b4 .b4head{display:flex;align-items:baseline;gap:6px;margin-bottom:8px}
.b4 .b4seg{display:flex;gap:6px;margin:6px 0 10px}.b4 .b4seg button,.b4 .b4bar button{border:1px solid #d9dee4;background:#fff;border-radius:3px;padding:7px 14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;color:#1f2933}
.b4 .b4seg button.on{box-shadow:inset 6px 0 0 #146cff;background:#ecf5ff;color:#1a5fb4}.b4 .b4bar button.go{background:#146cff;color:#fff;border-color:#146cff}
.b4 .b4bar{display:flex;gap:8px;align-items:center;margin-bottom:10px;background:#f7f8f9;border:1px solid #e7eaec;padding:8px 10px}
.b4 .b4bar input,.b4 .b4bar select{font:inherit;font-size:15px;padding:7px 10px;border:1px solid #d9dee4;border-radius:3px}.b4 .b4bar input{flex:1;max-width:520px}
.b4 .b4cols{display:flex;gap:12px;align-items:flex-start}.b4 .b4card{background:#fff;border:1px solid #e7eaec;border-radius:3px;flex:1;min-width:0}
.b4 .b4card h4{margin:0;padding:9px 12px;font-size:12px;letter-spacing:.4px;text-transform:uppercase;background:#f7f8f9;border-bottom:1px solid #e7eaec}
.b4 .b4bd{padding:10px 12px}.b4 table{width:100%;border-collapse:collapse;font-size:14px}.b4 th{text-align:left;font-size:11px;text-transform:uppercase;color:#666;padding:7px 8px;border-bottom:1px solid #e7eaec}
.b4 td{padding:7px 8px;border-bottom:1px solid #f2f3f4}.b4 .n{text-align:right}.b4 tr.row{cursor:pointer}.b4 tr.row:hover{background:#f5f7f9}.b4 tr.sel{background:#ecf5ff;box-shadow:inset 3px 0 0 #146cff}
.b4 .dl{display:grid;grid-template-columns:150px 1fr;gap:5px 10px;font-size:14px}.b4 .dl span:nth-child(odd){color:#666}.b4 .tag{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:3px;background:#e6f6ec;color:#1e7b34}
.b4 .tag.red{background:#fff2f2;color:#e5243b}.b4 .hint{font-size:12.5px;color:#666;margin-top:8px}.b4 .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;padding:10px}
.b4 .tile{border:1px solid #d9dee4;border-radius:3px;padding:9px 10px 8px 16px;box-shadow:inset 8px 0 0 #18a058;background:#fff}.b4 .tile b{display:block;font-size:14px}.b4 .tile small{color:#666}.b4 .tile .px{font-weight:700;font-size:15px;margin-top:3px}
.b4 .num{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.b4 .num div{border:1px solid #e7eaec;border-radius:3px;padding:10px 12px;background:#fff}.b4 .num small{display:block;color:#666;font-size:12px;text-transform:uppercase}.b4 .num b{font-size:22px}
.b4 .err{color:#c0392b;padding:10px 0}.b4 .ok{color:#1e7b34;padding:6px 0;font-weight:600}
.b4 .frm{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}.b4 .frm .w2{grid-column:1/3}.b4 .frm label{display:block;font-size:12px;font-weight:700;color:#444;margin-bottom:3px}
.b4 .frm input[type=text],.b4 .frm select{width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:7px 9px;border:1px solid #d9dee4;border-radius:3px}.b4 .frm input[readonly]{background:#f2f3f4}
.b4 .frm .chk{display:flex;gap:6px;align-items:center;font-size:14px}.b4 .step{font-size:11px;font-weight:800;letter-spacing:.4px;color:#5f6b78;margin:14px 0 6px;border-top:1px solid #e7eaec;padding-top:10px;text-transform:uppercase}
.b4 .acts{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.b4 .acts button,.b4 .b4head button{border:1px solid #d9dee4;background:#fff;border-radius:3px;padding:8px 14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;color:#1f2933}
.b4 .acts button.g,.b4 .b4head button.g{box-shadow:inset 6px 0 0 #18a058;padding-left:18px}.b4 .acts button.r{box-shadow:inset 6px 0 0 #e5243b;padding-left:18px}.b4 .b4head .sp{flex:1}
.b4 .tile{position:relative}.b4 .tile .rm{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:#fff2f2;border:1px solid #ffc4cc;color:#e5243b;font-weight:800;cursor:pointer;line-height:18px;padding:0;text-align:center}
.b4dim{position:fixed;inset:0;background:rgba(20,30,45,.45);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding-top:15vh}.b4dlg{background:#fff;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:18px 20px;width:min(470px,92vw);font-family:inherit}
.b4dlg h5{margin:0 0 8px;font-size:17px}.b4dlg .chg{background:#fff7e6;border:1px solid #ffd8a8;border-radius:4px;padding:10px 12px;margin:8px 0;font-size:15px}.b4dlg .bt{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.b4dlg .bt button{border:1px solid #d9dee4;background:#fff;border-radius:3px;padding:9px 16px;font:inherit;font-size:14px;font-weight:700;cursor:pointer}.b4dlg .bt button.g{background:#1e8449;color:#fff;border-color:#1e8449}.b4dlg .bt button.r{background:#c0392b;color:#fff;border-color:#c0392b}`;
    document.head.appendChild(st);
  }
  AirMaxSections.register({
    id: 'items',
    render(host, c) {
      const esc = c.esc, m = n => (n == null ? '' : c.money(n));
      let view = 'items', acc = { manager: false }, sel = '', dead = false, selOrder = '';
      host.innerHTML = '<div class="b4"><div class="b4head"><h2>ITEMS</h2><span class="b4note" id="b4note">Look up price and stock.</span><span class="sp"></span><span id="b4new"></span></div><div class="b4seg" id="b4seg"></div><div id="b4body"></div></div>';
      const body = host.querySelector('#b4body'), seg = host.querySelector('#b4seg');
      const stock = v => (v == null ? '' : v <= 0 ? '<span class="tag red">Out</span>' : String(v));

      let lk = null, flash = '';
      const num2 = v => /^\d{1,7}(\.\d{1,2})?$/.test(String(v).trim());
      const confirmBox = (title, html, okLabel, cls) => new Promise(res => {
        const d = document.createElement('div'); d.className = 'b4dim';
        d.innerHTML = '<div class="b4dlg" role="dialog"><h5>' + esc(title) + '</h5>' + html + '<div class="bt"><button data-n>Cancel</button><button class="' + (cls || 'g') + '" data-y>' + esc(okLabel) + '</button></div></div>';
        const done = v => { d.remove(); res(v); }; d.querySelector('[data-n]').onclick = () => done(false); d.querySelector('[data-y]').onclick = () => done(true);
        d.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }; host.appendChild(d); d.querySelector('[data-n]').focus();
      });
      // Origin option value = AIR POS's code when it has one, else its key (verified on TestShop: ProductUpdate with originCode = the origin's key is kept and ProductGet answers originCode = key, originName = name)
      // the pick-lists come from Batch 1's read route "lookups-all" (14 tax kinds, 17 origins, 18 departments); departments AIR POS marks disabled are left out
      const loadLookups = async () => { if (lk) return lk; const r = await c.api('lookups-all'); if (!r || !r.ok || !r.categories || !r.taxKinds) return null;
        lk = { categories: (r.categories.flat || []).filter(x => !x.disable).map(x => ({ id: x.id, label: x.path || x.label })), origins: ((r.origins && r.origins.rows) || []).filter(x => x.code || x.key).map(x => ({ value: x.code || x.key, name: x.name })), taxKinds: (r.taxKinds.rows || []).map(x => ({ id: x.id, name: x.name, rate: x.rate })) }; return lk; };
      const opts = (list, val, key, lab, blank) => (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(x => '<option value="' + esc(x[key]) + '"' + (String(x[key]) === String(val) ? ' selected' : '') + '>' + esc(lab(x)) + '</option>').join('');
      const paintNew = () => { const n = host.querySelector('#b4new'); if (!n) return; n.innerHTML = acc.canEdit ? '<button class="g" id="b4newbtn">New item</button>' : ''; if (acc.canEdit) n.querySelector('button').onclick = () => { view = 'items'; sel = ''; paintSeg(); viewItems(true); }; };
      // the item form (add: p = null; edit: p = product from items-get). Shown ONLY when items-access says canEdit.
      function itemForm(p, L) {
        const add = !p; p = p || { number: '', name: '', upc: '', categoryId: '', originCode: '', enabled: true, isRetailRefund: true, items: [], shop: null, standard: null, stock: 0 };
        const cur = p.categoryId, rows = p.items || [];
        let h = '<div class="step" style="border:0;margin-top:0">' + (add ? 'New item' : 'Item details') + '</div><div class="frm">'
          + '<div><label>Lookup code*</label><input type="text" id="f-number" maxlength="50" value="' + esc(p.number) + '"></div><div><label>Barcode (UPC)</label><input type="text" id="f-upc" maxlength="50" value="' + esc(p.upc) + '"></div>'
          + '<div class="w2"><label>Name*</label><input type="text" id="f-name" maxlength="100" value="' + esc(p.name) + '" placeholder="Item name (max 100 characters)"></div>'
          + '<div><label>Department*</label><select id="f-cat">' + opts(L.categories, cur, 'id', x => x.label, 'Choose a department…') + '</select></div>'
          + '<div><label>Origin</label><select id="f-org">' + opts(p.originCode && !L.origins.some(x => x.value === p.originCode) ? L.origins.concat([{ value: p.originCode, name: p.originName || p.originCode }]) : L.origins, p.originCode, 'value', x => x.name, '(none)') + '</select></div>'
          + '<label class="chk"><input type="checkbox" id="f-en"' + (p.enabled !== false ? ' checked' : '') + '> Enabled</label><label class="chk"><input type="checkbox" id="f-ref"' + (p.isRetailRefund !== false ? ' checked' : '') + '> Refundable</label></div>'
          + '<div class="acts"><button class="g" id="b-save">Save item</button>' + (add ? '<button id="b-cancel">Cancel</button>' : '<button class="r" id="b-dis">Disable Item</button><button class="g" id="b-qadd">Add to Quick Add</button>') + '</div><div id="b-msg"></div>';
        if (!add) {
          h += '<div class="step">Price</div><div class="frm"><div><label>Tax kind*</label><select id="p-tax">' + opts(L.taxKinds, p.taxKindId, 'id', x => x.name + (x.rate == null ? '' : ' (' + x.rate + '%)'), 'Choose a tax kind…') + '</select></div><div></div>'
            + rows.map(i => '<div><label>Shop price (' + esc(i.unitName || 'Each') + (rows.length > 1 ? ', ' + esc(i.rate) + ' per' : '') + ')</label><input type="text" class="p-in" data-id="' + esc(i.id) + '" data-old="' + (shopOf(p, i.id) == null ? '' : shopOf(p, i.id)) + '" value="' + (shopOf(p, i.id) == null ? '' : shopOf(p, i.id)) + '" inputmode="decimal" placeholder="0.00"></div>').join('')
            + '<div><label>Standard price (read-only)</label><input type="text" readonly value="' + (p.standard == null ? '' : esc(m(p.standard))) + '"></div><div><label>Stock (read-only)</label><input type="text" readonly value="' + (p.stock == null ? '' : esc(p.stock)) + '"></div>'
            + (p.costPrice !== undefined && p.costPrice !== null ? '<div><label>Cost (manager)</label><input type="text" readonly value="' + esc(m(p.costPrice)) + '"></div>' : '') + '</div>'
            + '<div class="hint">Stock is set by receiving or counting in AIR POS. A price change asks to confirm first.</div><div class="acts"><button class="g" id="b-price">Save price…</button></div><div id="b-pmsg"></div>';
        } else h += '<div class="hint">Stock is set by receiving or counting in AIR POS; a new item starts at 0. After you save the item you can set its price.</div>';
        return h;
      }
      const shopOf = (p, itemId) => { const a = (p.shopPrices || []).find(x => String(x.itemId) === String(itemId)); return a && a.price != null ? a.price : null; };
      const formFields = () => ({ number: body.querySelector('#f-number').value.trim(), upc: body.querySelector('#f-upc').value.trim(), name: body.querySelector('#f-name').value.trim(), categoryId: body.querySelector('#f-cat').value, originCode: body.querySelector('#f-org').value, enabled: body.querySelector('#f-en').checked, isRetailRefund: body.querySelector('#f-ref').checked });
      const say = (id, ok, t) => { const e = body.querySelector(id); if (e) e.innerHTML = '<div class="' + (ok ? 'ok' : 'err') + '">' + esc(t) + '</div>'; };
      function wireForm(p, onSaved) {
        const add = !p, sv = body.querySelector('#b-save'); let busy = false;
        const guard = fn => async () => { if (busy) return; busy = true; try { await fn(); } finally { busy = false; } };
        sv.onclick = guard(async () => {
          const f = formFields(); if (!f.number || !f.name) return say('#b-msg', false, 'Lookup code and name are required.'); if (!f.categoryId) return say('#b-msg', false, 'Pick a department.');
          const r = await c.api(add ? 'items-add' : 'items-update', add ? f : { id: p.id, ...f }); if (dead) return;
          if (!r || !r.ok) return say('#b-msg', false, (r && r.message) || 'Could not save');
          flash = add ? 'Item saved. Now set its price.' : 'Item saved.'; onSaved(add ? r.id : p.id, add ? r.number : null);
        });
        if (add) { const cb = body.querySelector('#b-cancel'); cb.onclick = () => { sel = ''; body.querySelector('#b4det').innerHTML = '<div class="hint">Pick an item on the left.</div>'; }; return; }
        body.querySelector('#b-dis').onclick = guard(async () => {
          if (!await confirmBox('Disable this item?', '<div>Item <b>' + esc(p.number) + ' · ' + esc(p.name) + '</b></div><div class="hint">It stops showing up for sale. You can turn Enabled back on later.</div>', 'Disable Item', 'r')) return;
          const r = await c.api('items-disable', { id: p.id, confirm: true }); if (dead) return;
          if (!r || !r.ok) return say('#b-msg', false, (r && r.message) || 'Could not disable'); flash = 'Item disabled.'; onSaved(p.id);
        });
        body.querySelector('#b-qadd').onclick = guard(async () => {
          if (!await confirmBox('Add to the Quick Add grid?', '<div>Item <b>' + esc(p.number) + ' · ' + esc(p.name) + '</b></div>', 'Add to Quick Add')) return;
          const r = await c.api('items-quick-add', { id: p.id }); if (dead) return; say('#b-msg', !!(r && r.ok), (r && r.message) || 'Could not add');
        });
        body.querySelector('#b-price').onclick = guard(async () => {
          const ins = [...body.querySelectorAll('.p-in')], prices = {}, seen = {};
          for (const i of ins) { const v = i.value.trim(); if (v === i.dataset.old) continue; if (!num2(v)) return say('#b-pmsg', false, 'A price must be a number, 0 or more, with at most 2 decimals.'); prices[i.dataset.id] = v; seen[i.dataset.id] = i.dataset.old === '' ? null : Number(i.dataset.old); }
          if (!Object.keys(prices).length) return say('#b-pmsg', false, 'Type a new price first.');
          const taxKindId = body.querySelector('#p-tax').value; if (!taxKindId) return say('#b-pmsg', false, 'Pick a tax kind.');
          const pv = await c.api('items-price-preview', { id: p.id, prices, taxKindId }); if (dead) return; if (!pv || !pv.ok) return say('#b-pmsg', false, (pv && pv.message) || 'Could not check the price');
          if (pv.nothingChanges) return say('#b-pmsg', false, 'The price is the same as before.');
          const money = v => (v == null ? 'none' : m(v));
          const lines = pv.lines.map(x => '<div class="chg">Shop price (' + esc(x.unitName) + ') for this shop<br><span style="color:#999;text-decoration:line-through">' + esc(money(x.old)) + '</span> &nbsp;→&nbsp; <b style="font-size:20px;color:#146cff">' + esc(m(x.new)) + '</b>' + (x.pct == null ? '' : ' &nbsp; <span style="color:#a65f00">' + (x.pct > 0 ? '+' : '') + x.pct.toFixed(1) + '%</span>') + '</div>').join('');
          if (!await confirmBox('Change this price?', '<div>Item <b>' + esc(pv.number) + ' · ' + esc(pv.name) + '</b></div>' + lines + '<div class="hint">This changes what every register in this shop charges from now on. Open sales are not changed.</div>', 'Confirm price change')) return;
          const r = await c.api('items-price', { id: p.id, prices, taxKindId, seen, confirm: true }); if (dead) return;
          if (!r || !r.ok) { if (r && r.changed) say('#b-pmsg', false, r.message); else say('#b-pmsg', false, (r && r.message) || 'Could not save the price'); if (r && r.changed) setTimeout(() => detail(p.id), 1500); return; }
          flash = 'Price saved.'; onSaved(p.id);
        });
      }
      const paintSeg = () => {
        const tabs = [['items', 'Items'], ['quick', 'Quick Add grid'], ['inbound', 'Receiving']].concat(acc.manager ? [['dash', 'Dashboard']] : []);
        seg.innerHTML = tabs.map(t => '<button data-v="' + t[0] + '" class="' + (view === t[0] ? 'on' : '') + '">' + esc(t[1]) + '</button>').join('');
        seg.querySelectorAll('button').forEach(b => b.onclick = () => { view = b.dataset.v; paintSeg(); go(); });
      };
      const bad = r => '<div class="err">' + esc((r && r.message) || 'Could not load') + '</div>';
      async function go() {
        if (view === 'items') return viewItems(); if (view === 'quick') return viewQuick(); if (view === 'inbound') return viewInbound(); return viewDash();
      }
      function viewItems(newMode) {
        body.innerHTML = '<div class="b4bar"><b style="font-size:12px">FIND ITEM</b><input id="b4q" placeholder="Name, barcode or lookup code" autocomplete="off"><button class="go" id="b4go">Search</button></div><div class="b4cols"><div class="b4card" style="flex:1.2"><h4>Search results <span id="b4cnt"></span></h4><div id="b4res"></div></div><div class="b4card"><h4>Item</h4><div class="b4bd" id="b4det"><div class="hint">Pick an item on the left.</div></div></div></div>';
        const q = body.querySelector('#b4q'), run = async () => {
          const res = body.querySelector('#b4res'); res.innerHTML = '<div class="b4bd">Searching…</div>';
          const r = await c.api('items-find', { keyword: q.value, page: 1, pageSize: 30 }); if (dead) return;
          if (!r || !r.ok) { res.innerHTML = bad(r); return; }
          body.querySelector('#b4cnt').textContent = r.total + ' items';
          res.innerHTML = '<table><thead><tr><th>Lookup code</th><th>Name</th><th>Department</th><th class="n">Price</th><th class="n">Stock</th></tr></thead><tbody>' + r.rows.map(x => '<tr class="row' + (x.id === sel ? ' sel' : '') + '" data-id="' + esc(x.id) + '"><td>' + esc(x.number) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.categoryName) + '</td><td class="n">' + m(x.price) + '</td><td class="n">' + stock(x.stock) + '</td></tr>').join('') + '</tbody></table>' + (r.rows.length ? '' : '<div class="b4bd hint">No items found.</div>');
          res.querySelectorAll('tr.row').forEach(tr => tr.onclick = () => { sel = tr.dataset.id; res.querySelectorAll('tr.sel').forEach(e => e.classList.remove('sel')); tr.classList.add('sel'); detail(sel); });
        };
        body.querySelector('#b4go').onclick = run; q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); run(); } }; q.focus(); run(); if (newMode) newItem(); else if (sel) detail(sel);
      }
      async function newItem() {
        const d = body.querySelector('#b4det'); if (!d) return; const L = await loadLookups(); if (!L) { d.innerHTML = bad({ message: 'Could not load the department list' }); return; }
        d.innerHTML = itemForm(null, L); wireForm(null, (id) => { sel = id; detail(id); });
      }
      async function detail(id) {
        const d = body.querySelector('#b4det'); if (!d) return; d.innerHTML = 'Loading…';
        const r = await c.api('items-get', { id }); if (dead || !body.querySelector('#b4det')) return;
        if (!r || !r.ok) { d.innerHTML = bad(r); return; }
        const p = r.product, row = (a, b) => '<span>' + a + '</span><span>' + b + '</span>';
        if (acc.canEdit) { // manager with the AIR POS Product Management permission: the edit form (items-access decided; the server checks again on every save)
          const L = await loadLookups(); if (dead || !body.querySelector('#b4det')) return;
          if (L) { d.innerHTML = itemForm(p, L); if (flash) { say('#b-msg', true, flash); flash = ''; } wireForm(p, (nid) => { detail(nid); }); return; }
        }
        d.innerHTML = '<div class="dl">' + row('Name', esc(p.name)) + row('Lookup code', esc(p.number)) + row('Barcode', esc(p.upc)) + row('Department', esc(p.categoryName)) + row('Origin', esc(p.originName))
          + row('Shop price', m(p.shop)) + row('Standard price', m(p.standard)) + (p.costPrice !== undefined ? row('Cost (manager)', m(p.costPrice)) : '') + row('Tax rate', p.taxRate == null ? '' : esc(p.taxRate) + '%') + row('Stock', p.stock == null ? '' : esc(p.stock))
          + row('Status', p.enabled ? '<span class="tag">Enabled</span>' : '<span class="tag red">Disabled</span>') + row('Refundable', p.isRetailRefund ? 'Yes' : 'No') + '</div>'
          + (p.items.length > 1 || (p.items[0] && p.items[0].upcs.length > 1) ? '<table style="margin-top:10px"><thead><tr><th>Packing</th><th class="n">Qty</th><th>Barcodes</th><th class="n">Price</th></tr></thead><tbody>' + p.items.map(i => '<tr><td>' + esc(i.unitName) + '</td><td class="n">' + esc(i.rate) + '</td><td>' + esc(i.upcs.join(', ')) + '</td><td class="n">' + m(i.price) + '</td></tr>').join('') + '</tbody></table>' : '')
          + '<div class="hint">Look-up only. Stock is set by receiving or counting in AIR POS.</div>';
      }
      async function viewQuick() {
        body.innerHTML = '<div class="b4card"><h4>Quick Add grid <span id="b4cnt"></span></h4><div id="b4res" class="b4bd">Loading…</div></div>';
        const r = await c.api('items-quick', { page: 1, pageSize: 60 }); if (dead || !body.querySelector('#b4res')) return;
        const res = body.querySelector('#b4res'); if (!r || !r.ok) { res.innerHTML = bad(r); return; }
        body.querySelector('#b4cnt').textContent = r.total + ' tiles'; res.className = '';
        res.innerHTML = r.rows.length ? '<div class="tiles">' + r.rows.map(x => '<div class="tile">' + (acc.canEdit ? '<button class="rm" data-id="' + esc(x.id) + '" data-n="' + esc(x.name) + '" title="Remove from grid" aria-label="Remove from grid">×</button>' : '') + '<b>' + esc(x.name) + '</b><small>' + esc(x.number) + '</small><div class="px">' + m(x.price) + '</div></div>').join('') + '</div>' + (acc.canEdit ? '<div class="b4bd hint">× removes a tile from the AIR POS Quick Add grid (the item stays). To add one, open it in Items and press Add to Quick Add.</div><div id="b4qmsg" class="b4bd"></div>' : '') : '<div class="b4bd hint">The Quick Add grid is empty.</div>';
        res.querySelectorAll('button.rm').forEach(b => b.onclick = async () => {
          if (!await confirmBox('Remove from the Quick Add grid?', '<div><b>' + esc(b.dataset.n) + '</b></div><div class="hint">The item itself is not deleted.</div>', 'Remove from grid', 'r')) return;
          const r2 = await c.api('items-quick-remove', { id: b.dataset.id }); if (dead) return; if (r2 && r2.ok) viewQuick(); else { const e = body.querySelector('#b4qmsg'); if (e) e.innerHTML = '<div class="err">' + esc((r2 && r2.message) || 'Could not remove') + '</div>'; }
        });
      }
      async function viewInbound() {
        body.innerHTML = '<div class="b4cols"><div class="b4card" style="flex:1.2"><h4>Receiving orders <span id="b4cnt"></span></h4><div id="b4res" class="b4bd">Loading…</div></div><div class="b4card"><h4>Order</h4><div class="b4bd" id="b4det"><div class="hint">Pick an order on the left.</div></div></div></div>';
        const r = await c.api('items-inbound', { page: 1, pageSize: 30 }); if (dead || !body.querySelector('#b4res')) return;
        const res = body.querySelector('#b4res'); if (!r || !r.ok) { res.innerHTML = bad(r); return; }
        body.querySelector('#b4cnt').textContent = r.total + ' orders'; res.className = '';
        res.innerHTML = '<table><thead><tr><th>Number</th><th>Status</th><th class="n">Qty</th><th>Created</th></tr></thead><tbody>' + r.rows.map(x => '<tr class="row' + (x.id === selOrder ? ' sel' : '') + '" data-id="' + esc(x.id) + '"><td>' + esc(x.number) + '</td><td>' + esc(x.statusName) + '</td><td class="n">' + esc(x.quantity) + '</td><td>' + esc(String(x.createTime).replace('T', ' ').slice(0, 16)) + '</td></tr>').join('') + '</tbody></table>' + (r.rows.length ? '' : '<div class="b4bd hint">No receiving orders.</div>');
        res.querySelectorAll('tr.row').forEach(tr => tr.onclick = async () => {
          selOrder = tr.dataset.id; res.querySelectorAll('tr.sel').forEach(e => e.classList.remove('sel')); tr.classList.add('sel');
          const d = body.querySelector('#b4det'); d.innerHTML = 'Loading…'; const o = await c.api('items-inbound-get', { id: selOrder }); if (dead || !body.querySelector('#b4det')) return;
          if (!o || !o.ok) { d.innerHTML = bad(o); return; }
          d.innerHTML = '<div class="dl"><span>Number</span><span>' + esc(o.order.number) + '</span><span>Status</span><span>' + esc(o.order.statusName) + '</span></div><table style="margin-top:10px"><thead><tr><th>Item</th><th>Name</th><th>Unit</th><th class="n">Qty</th></tr></thead><tbody>' + o.order.subs.map(s => '<tr><td>' + esc(s.number) + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.unitName) + '</td><td class="n">' + esc(s.quantity) + '</td></tr>').join('') + '</tbody></table>';
        });
      }
      async function viewDash() {
        body.innerHTML = '<div class="b4card"><h4>Dashboard (managers)</h4><div class="b4bd" id="b4res">Loading…</div></div>';
        const r = await c.api('items-dashboard'); if (dead || !body.querySelector('#b4res')) return;
        const res = body.querySelector('#b4res'); if (!r || !r.ok) { res.innerHTML = bad(r); return; }
        const t = r.model, tile = (a, b) => '<div><small>' + esc(a) + '</small><b>' + b + '</b></div>';
        res.innerHTML = '<div class="num">' + tile('Sales today', m(t.orderSumToday.amount)) + tile('Orders today', esc(t.orderSumToday.orderCount)) + tile('Items sold today', esc(t.orderSumToday.quantity)) + tile('Sales, recent days', m(t.orderSumRecent.amount))
          + tile('Active items', esc(t.stockSum.activeCount)) + tile('Low stock', esc(t.stockSum.lowStockCount)) + tile('Units in stock', esc(t.stockSum.quantity)) + tile('Received, recent', esc(t.inboundOrderSum.quantity)) + '</div>';
      }
      (async () => { const a = await c.api('items-access'); if (dead) return; if (a && a.ok) acc = a; paintNew(); paintSeg(); go(); })();
      return () => { dead = true; };
    },
  });
})();

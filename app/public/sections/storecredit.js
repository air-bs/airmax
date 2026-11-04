// Batch 8: store credit for a customer (calls 86, 87, 88, 89, 92, 93, 94) in the Customers screen's Account box
// (slot customers.account-box, extra: { customer }). Not built: 90 (cancel payment) and 91.
(function () {
  const H = window.AirMaxB8; if (!H || !window.AirMaxMounts) return;
  const { esc, money, when } = H;
  const STEP = { saving: 'Starting…', 'unknown-saving': 'Unclear: press "Check what happened"', saved: 'Started: waiting for the payment', receiving: 'Waiting for the card payment', paid: 'Paid: ready to finish', completing: 'Finishing…', 'unknown-completing': 'Unclear: press "Check what happened"', done: 'Finished' };

  AirMaxMounts.add('customers.account-box', {
    id: 'b8-store-credit',
    async render(host, ctx) {
      H.style();
      const cu0 = ctx && ctx.customer, cu = typeof cu0 === 'string' || typeof cu0 === 'number' ? { id: String(cu0) } : (cu0 || {}), // Batch 5 passes the member id string
         memberId = String(cu.id || cu.memberId || ''), who = String(cu.name || cu.memberName || 'this customer');
      if (!memberId) return;
      const pm = await Promise.resolve(ctx.perms && ctx.perms()).catch(() => null), mgr = !!(pm && pm.manager);
            const wrap = document.createElement('div'); wrap.className = 'b8'; wrap.style.display = 'block'; host.appendChild(wrap);
      let busy = false, timer = null, allowCard = false, open = null;
      const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
      const $ = id => wrap.querySelector('#' + id);
      const say = (t, ok) => { const m = $('b8cm'); if (m) { m.textContent = t || ''; m.className = 'm ' + (ok === false ? 'err' : ok ? 'ok' : ''); } };

      async function draw() {
        stop();
        const r = await ctx.api('sc-open', {}); open = (r.ok && r.open || []).find(p => p.memberId === memberId) || null;
        const other = (r.ok && r.open || []).find(p => p.memberId !== memberId);
        if (!allowCard) { const s = await ctx.api('gc-settings', {}); allowCard = !!(s && s.ok && s.settings && s.settings.allowCardPay); }
        wrap.innerHTML = `<div class="box"><b>Store credit</b> <span class="small">for ${esc(who)}</span><div class="m" id="b8cm"></div><div id="b8cb"></div></div>`;
        if (open) return drawOpen(open);
        if (other) { $('b8cb').innerHTML = '<div class="small">Another store credit is open on this register. Finish it first.</div>'; return; }
        $('b8cb').innerHTML = `<div class="b8bar"><input id="b8ca" placeholder="amount" inputmode="decimal" data-kb="numeric" style="width:110px"><select id="b8cp"><option value="cash">Cash</option>${allowCard ? '<option value="card">Card (terminal)</option>' : ''}</select><button class="pb" id="b8cs">Add store credit</button>${mgr ? '<button class="pb s" id="b8cl">Credit orders</button>' : ''}</div><div class="small">$1.00 to $1000.00. Nothing is added until the payment is taken and you press Finish.</div><div id="b8cx"></div>`;
        $('b8cs').onclick = async () => {
          if (busy) return; busy = true; $('b8cs').disabled = true; say('Starting…', true);
          try { const x = await ctx.api('sc-start', { memberId, amount: $('b8ca').value, method: $('b8cp').value }); if (!x.ok) { say(x.message || 'Could not start', false); if (x.open) draw(); return; } draw(); }
          finally { busy = false; if ($('b8cs')) $('b8cs').disabled = false; }
        };
        if ($('b8cl')) $('b8cl').onclick = list;
      }
      function drawOpen(p) {
        const unk = /^unknown/.test(p.step), cash = p.method === 'cash', b = [];
        if (p.step === 'saved') b.push(`<button class="pb" id="b8pay">${cash ? 'Cash received' : 'Take card payment'}</button>`);
        if (p.step === 'paid') b.push('<button class="pb g" id="b8fin">Finish: add it to the account</button>');
        if (unk) b.push('<button class="pb" id="b8res">Check what happened</button>');
        if (p.step === 'receiving') b.push('<button class="pb s" id="b8res">Check now</button>');
        if (p.step === 'saved') b.push('<button class="pb s" id="b8del">Drop this credit (nothing taken)</button>');
        $('b8cb').innerHTML = `<div class="box ${unk ? 'warn' : ''}">${money(p.amount)} · ${cash ? 'Cash' : 'Card'}<div>${esc(STEP[p.step] || p.step)}</div></div>${cash && p.step === 'saved' ? '<p class="small">Take the cash and put it in the drawer first, then press Cash received. AirMax does not check the cash.</p>' : ''}${unk ? '<p class="small">AIR POS did not answer clearly. AirMax will not send it again: it reads the order and the account and tells you what AIR POS holds.</p>' : ''}<div class="b8bar">${b.join('')}</div>`;
        const run = async (name, after) => { if (busy) return; busy = true; say('Working…', true); try { const r = await ctx.api(name, { id: p.id }); if (!r.ok) { say(r.message || 'It did not work', false); return r.unknown || r.hold || r.busy ? null : draw(); } return after ? after(r) : draw(); } finally { busy = false; } };
        const on = (id, name, after) => { const e = $(id); if (e) e.onclick = () => run(name, after); };
        on('b8pay', 'sc-pay'); on('b8res', 'sc-resolve', r => r.done ? done(r) : draw()); on('b8fin', 'sc-finish', done); on('b8del', 'sc-delete');
        if (p.step === 'receiving') timer = setInterval(async () => { if (busy || !wrap.isConnected) return stop(); const r = await ctx.api('sc-pay-check', { id: p.id }); if (r && r.paid) draw(); }, 2000);
      }
      function done(r) {
        stop(); const f = x => 'balance ' + money(x.balance) + ' · shop credit ' + money(x.shopBalance);
        $('b8cb').innerHTML = `<div class="box ${r.balanceMatches === false ? 'bad' : 'good'}"><b>Store credit added</b>${r.message ? `<div>${esc(r.message)}</div>` : ''}<dl><dt>Added</dt><dd>${money(r.amount)}</dd><dt>Before</dt><dd>${esc(f(r.before))}</dd><dt>Now</dt><dd>${esc(f(r.after))}</dd><dt>Order</dt><dd>${esc(r.number || '')}</dd></dl></div><button class="pb" id="b8more">Add more</button>`;
        say(''); $('b8more').onclick = draw;
      }
      async function list() { // 94 (manager): this customer's credit orders; delete (92) an unfinished one
        say('Looking…', true); const r = await ctx.api('sc-orders', { memberId }); if (!r.ok) return say(r.message || 'Could not load', false); say('');
        $('b8cx').innerHTML = `<table><tr><th>Order</th><th class="n">Amount</th><th>Status</th><th>When</th><th></th></tr>${r.rows.map(o => `<tr><td>${esc(o.number)}</td><td class="n">${money(o.amount)}</td><td>${o.status === 20 ? '<span class="tag ok">Completed</span>' : '<span class="tag warn">' + esc(o.statusName || 'New') + '</span>'}</td><td>${esc(when(o.completedTime || o.createTime))}</td><td>${o.status !== 20 ? `<button class="pb s" data-id="${esc(o.id)}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">No credit orders.</td></tr>'}</table>`;
        $('b8cx').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => H.manager('Delete a credit order', 'Delete this unfinished credit order. Nothing is added to the account. A manager types their password to approve.', async m => { const x = await ctx.api('sc-delete', { id: b.dataset.id, ...m }); if (x.ok) { list(); return null; } return x; }));
      }
      draw();
    }
  });
})();

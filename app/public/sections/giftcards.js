// Batch 8: the Gift Cards tab (calls 57, 60, 62*, 64, 65, 66, 67, 68, 69*, 70, 71, 72 + "Add credit, no payment").
// * 62 (edit a card) is off by default and has no button; 69 (cancel) is not offered (it is not available on the test server).
// Checkout's Gift Card / Multiple Gift Cards / Gift Card Balance are not touched.
(function () {
  const H = window.AirMaxB8; if (!H || !window.AirMaxSections) return;
  const { esc, money, when, day } = H;
  const STEP = { saving: 'Starting…', 'unknown-saving': 'Unclear: press "Check what happened"', saved: 'Started: waiting for the payment', receiving: 'Waiting for the card payment', paid: 'Paid: ready to finish', completing: 'Finishing…', 'unknown-completing': 'Unclear: press "Check what happened"', done: 'Finished' };

  AirMaxSections.register({
    id: 'giftcards',
    async render(host, ctx) {
      H.style();
      const pm = await ctx.perms().catch(() => null), mgr = !!(pm && pm.manager);
      const S = { view: 'cards', number: '', settings: null, open: null, timer: null, busy: false, last: null };
      host.innerHTML = '<div class="b8" id="b8gc"><div class="b8nav" id="b8nav"></div><div class="b8main" id="b8main"></div></div>';
      const nav = host.querySelector('#b8nav'), main = host.querySelector('#b8main');
      const $ = id => host.querySelector('#' + id);
      const stop = () => { if (S.timer) { clearInterval(S.timer); S.timer = null; } };
      const say = (t, ok) => { const m = $('b8m'); if (m) { m.textContent = t || ''; m.className = 'm ' + (ok === false ? 'err' : ok ? 'ok' : ''); } };
      const go = v => { stop(); S.view = v; S.last = null; draw(); };

      function drawNav() {
        const items = [['cards', 'Cards', 'list · check balance'], ['topup', 'Sell / reload a card', 'start · pay · finish']];
        if (mgr) items.push(['free', 'Add credit, no payment', 'manager · free credit']);
        items.push(['orders', 'Top-up orders', 'list · delete']);
        nav.innerHTML = '<h4>Gift cards</h4>' + items.map(([id, t, s]) => `<button data-v="${id}" class="${S.view === id ? 'on' : ''}">${esc(t)}<div class="small">${esc(s)}</div></button>`).join('');
        nav.querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.v));
      }
      function draw() { drawNav(); ({ cards: drawCards, topup: drawTopup, free: drawFree, orders: drawOrders }[S.view] || drawCards)(); }

      // ---------- Cards (60, 57) ----------
      function drawCards() {
        main.innerHTML = `<h3>Cards</h3><div class="b8bar"><input id="b8q" placeholder="scan or type a card number" autocomplete="off" data-kb="text" style="width:260px"><button class="pb" id="b8go">Search</button><button class="pb s" id="b8bal">Check balance</button></div><div class="m" id="b8m"></div><div id="b8out"></div><p class="small">Card numbers show only the last 4. Searching and checking are reads: nothing changes on a card.</p>`;
        const q = $('b8q'); q.value = S.number; q.focus();
        const list = async (page) => {
          say('Looking…', true); const r = await ctx.api('gc-cards', { keyword: q.value.trim(), page });
          if (!r.ok) return say(r.message || 'Could not load the cards', false); say('');
          $('b8out').innerHTML = `<table><tr><th>Card</th><th>Status</th><th class="n">Face value</th><th class="n">Balance</th><th>Issued</th><th>Expires</th><th>Customer</th><th></th></tr>${r.rows.map(c => `<tr><td>${esc(c.cardMask)}</td><td>${statusTag(c)}</td><td class="n">${money(c.faceValue)}</td><td class="n"><b>${money(c.balance)}</b></td><td>${day(c.issueDate)}</td><td>${c.expireDate ? day(c.expireDate) : ''}</td><td>${esc(c.member || '-')}</td><td>${c.isSold && !c.expired ? `<button class="pb s" data-id="${esc(c.id)}">Sell / reload</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8">No cards found.</td></tr>'}</table><div class="small">${r.total} card${r.total === 1 ? '' : 's'}${r.total > r.rows.length ? ' (first ' + r.rows.length + ' shown; type more of the number to narrow it)' : ''}</div>`;
          $('b8out').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => { S.cardId = b.dataset.id; S.number = ''; go('topup'); });
        };
        $('b8go').onclick = () => { S.number = q.value.trim(); list(1); };
        q.onkeydown = e => { if (e.key === 'Enter') $('b8go').click(); };
        $('b8bal').onclick = async () => {
          const n = q.value.trim(); if (!n) return say('Type or scan the card number first', false); S.number = n;
          const r = await ctx.api('gc-card', { number: n }); if (!r.ok) return say(r.message || 'Not found', false);
          const c = r.card; say(''); $('b8out').innerHTML = `<div class="box ${c.isSold && !c.expired ? 'good' : 'warn'}"><b>${esc(c.cardMask)}</b> ${statusTag(c)}<dl><dt>Balance</dt><dd>${money(c.balance)}</dd><dt>Face value</dt><dd>${money(c.faceValue)}</dd><dt>Expires</dt><dd>${c.expireDate ? day(c.expireDate) : ''}</dd></dl></div>`;
        };
        $('b8go').click();
      }
      const statusTag = c => c.expired ? '<span class="tag bad">Expired</span>' : c.isSold ? '<span class="tag ok">Sold</span>' : '<span class="tag warn">Unsold</span>';

      // ---------- Sell / reload (64, 65, 66, 67, 68, 70) ----------
      async function loadOpen() { const r = await ctx.api('gc-open', {}); S.settings = r.settings || S.settings || {}; S.open = (r.ok && r.open || [])[0] || null; }
      async function drawTopup() {
        main.innerHTML = '<h3>Sell / reload a card</h3><div class="m" id="b8m">Looking…</div><div id="b8body"></div>';
        await loadOpen(); if (S.view !== 'topup') return; say('');
        if (S.open) return drawOpen(S.open);
        const cardOpt = (S.settings && S.settings.allowCardPay) ? '<option value="card">Card (terminal)</option>' : '';
        $('b8body').innerHTML = `<div class="box">Step 1 · Start the reload. Nothing is added to the card until the payment is taken and you press Finish.</div>
          <label class="f">Card number</label><div class="b8bar"><input id="b8n" autocomplete="off" data-kb="text" style="width:240px"><button class="pb s" id="b8chk">Check card</button><span id="b8ci" class="small"></span></div>
          <label class="f">Amount to add ($1.00 to $1000.00)</label><input id="b8a" inputmode="decimal" data-kb="numeric" style="width:140px">
          <label class="f">How is the customer paying?</label><select id="b8pm"><option value="cash">Cash</option>${cardOpt}</select>
          <div style="margin-top:14px"><button class="pb" id="b8st">Start</button></div>`;
        const n = $('b8n'); n.value = S.number; n.focus();
        const chk = async () => { const r = await ctx.api('gc-card', S.cardId && !n.value.trim() ? { id: S.cardId } : { number: n.value.trim() }); $('b8ci').textContent = r.ok ? `${r.card.cardMask} · balance ${money(r.card.balance)}${r.card.expired ? ' · EXPIRED' : ''}` : (r.message || ''); return r; };
        $('b8chk').onclick = chk; if (S.cardId) chk();
        $('b8st').onclick = async () => {
          if (S.busy) return; S.busy = true; $('b8st').disabled = true; say('Starting…', true);
          try { const body = { amount: $('b8a').value, method: $('b8pm').value }; if (n.value.trim()) body.number = n.value.trim(); else if (S.cardId) body.cardId = S.cardId;
            const r = await ctx.api('gc-topup-start', body); if (!r.ok) { say(r.message || 'Could not start', false); if (r.open) return drawTopup(); return; }
            S.cardId = null; S.number = ''; drawTopup();
          } finally { S.busy = false; if ($('b8st')) $('b8st').disabled = false; }
        };
      }
      function drawOpen(p) {
        const unk = /^unknown/.test(p.step), free = p.kind === 'free', cash = p.method === 'cash';
        const btn = [];
        if (free) { btn.push('<button class="pb" id="b8res">Check what happened</button>'); }
        else if (p.step === 'saved') btn.push(cash ? '<button class="pb" id="b8pay">Cash received</button>' : '<button class="pb" id="b8pay">Take card payment</button>');
        if (!free && p.step === 'paid') btn.push('<button class="pb g" id="b8fin">Finish: add it to the card</button>');
        if (unk && !free) btn.push('<button class="pb" id="b8res">Check what happened</button>');
        if (p.step === 'receiving') btn.push('<button class="pb s" id="b8res">Check now</button>');
        if (!free && p.step === 'saved') btn.push('<button class="pb s" id="b8ab">Drop this top-up (nothing taken)</button>');
        if (!free && (p.step === 'receiving' || p.step === 'paid')) btn.push('<button class="pb r" id="b8cp">Cancel payment</button>');
        $('b8body').innerHTML = `<div class="box ${unk ? 'warn' : ''}"><b>${esc(p.cardMask)}</b> · ${money(p.amount)} · ${free ? 'FREE credit (no payment)' : cash ? 'Cash' : 'Card'}<div>${esc(STEP[p.step] || p.step)}</div></div>
          ${free ? '<p class="small">A free-credit step did not finish cleanly. Press Check what happened. If it still says started, a manager can delete it under Top-up orders.</p>' : ''}
          ${!free && cash && p.step === 'saved' ? '<p class="small">Take the cash from the customer and put it in the drawer first, then press Cash received. AirMax does not check the cash.</p>' : ''}
          ${unk ? '<p class="small">AIR POS did not answer clearly. AirMax will not send it again: it reads the top-up and the card, then tells you what AIR POS holds.</p>' : ''}
          <div class="b8bar">${btn.join('')}</div>`;
        const run = async (name, ok) => { if (S.busy) return; S.busy = true; say('Working…', true); try { const r = await ctx.api(name, { id: p.id }); if (!r.ok) { say(r.message || 'It did not work', false); if (r.unknown || r.hold || r.busy) { /* keep the screen */ } return ok ? ok(r, true) : drawTopup(); } return ok ? ok(r) : drawTopup(); } finally { S.busy = false; } };
        const on = (id, name, fn) => { const b = $(id); if (b) b.onclick = () => run(name, fn); };
        on('b8pay', 'gc-topup-pay'); on('b8res', 'gc-topup-resolve', (r, bad) => bad ? drawTopup() : (r.done ? doneView(r) : drawTopup()));
        on('b8fin', 'gc-topup-finish', (r, bad) => bad ? drawTopup() : doneView(r));
        on('b8ab', 'gc-topup-abandon'); on('b8cp', 'gc-pay-cancel');
        if (p.step === 'receiving') { stop(); S.timer = setInterval(async () => { if (S.busy || S.view !== 'topup') return; const r = await ctx.api('gc-pay-check', { id: p.id }); if (r && r.paid) { stop(); drawTopup(); } }, 2000); }
      }
      function doneView(r) {
        stop(); const free = r.kind === 'free';
        $('b8body').innerHTML = `<div class="box ${r.balanceMatches === false ? 'bad' : 'good'}"><b>${free ? 'Free credit added' : 'Gift card topped up'}</b>${r.message ? `<div>${esc(r.message)}</div>` : ''}<dl><dt>Card</dt><dd>${esc(r.card ? r.card.cardMask : '')}</dd><dt>Balance before</dt><dd>${money(r.balBefore)}</dd><dt>Added</dt><dd>${money(r.amount)}</dd><dt>Balance now</dt><dd>${money(r.balAfter)}</dd><dt>Top-up order</dt><dd>${esc(r.number || '')}</dd></dl></div><button class="pb" id="b8new">${free ? 'Add more credit' : 'Reload another card'}</button>`;
        say(''); $('b8new').onclick = () => go(free ? 'free' : 'topup');
        if (free) { $('b8body').insertAdjacentHTML('beforeend', '<h3 style="margin-top:18px">Free credit given</h3><div id="b8fl" class="small">Loading…</div>'); loadFree(); }
      }

      // ---------- Add credit, no payment (manager) ----------
      async function drawFree() {
        main.innerHTML = '<h3>Add credit, no payment <span class="tag mgr">manager only</span></h3><div class="m" id="b8m">Looking…</div><div id="b8body"></div>';
        await loadOpen(); if (S.view !== 'free') return;
        const st = S.settings || {}; say('');
        if (S.open) { $('b8body').innerHTML = '<div class="box warn">A top-up is already open on this register. Finish it or drop it under Sell / reload first.</div>'; return; }
        $('b8body').innerHTML = `<div class="box warn"><b>No money is taken.</b> This gives value to a gift card for free. It is recorded as free credit, not as a sale. The drawer does not open.</div>
          <label class="f">Card number</label><div class="b8bar"><input id="b8n" autocomplete="off" data-kb="text" style="width:240px"><button class="pb s" id="b8chk">Check card</button><span id="b8ci" class="small"></span></div>
          <label class="f">Credit to add (no payment)</label><input id="b8a" inputmode="decimal" data-kb="numeric" style="width:140px">
          <label class="f">Type the amount again</label><input id="b8a2" inputmode="decimal" data-kb="numeric" style="width:140px">
          <label class="f">Reason (required)</label><textarea id="b8r" maxlength="200" data-kb="text" placeholder="for example: apology credit, order damaged"></textarea>
          <div class="b8bar" style="margin-top:12px"><button class="pb" id="b8rev">Review…</button></div>
          <div class="box small"><b>Rules on this screen</b><br>• Only a manager can do this; the server asks for the manager's password and refuses anyone else.<br>• No limit per credit: check the amount carefully, you type it twice.<br>• Cards AIR POS marks as expired are blocked. Cards with no expiry in AIR POS never expire.<br>• The reason is saved in AirMax's own free-credit log (AIR POS has no reason field we know of).<br>• <b>The X-read and Z-read do not count free credit.</b> Only this list does.</div>
          <h3 style="margin-top:18px">Free credit given</h3><div id="b8fl" class="small">Loading…</div>`;
        const n = $('b8n'); n.focus();
        $('b8chk').onclick = async () => { const r = await ctx.api('gc-card', { number: n.value.trim() }); $('b8ci').textContent = r.ok ? `${r.card.cardMask} · ${r.card.isSold ? 'Sold' : 'Unsold'} · balance ${money(r.card.balance)}${r.card.expired ? ' · EXPIRED' : ''}` : (r.message || ''); };
        $('b8rev').onclick = async () => {
          const body = { number: n.value.trim(), amount: $('b8a').value, amount2: $('b8a2').value, reason: $('b8r').value };
          if (!body.number) return say('Type or scan the card number', false);
          const a = Number(String(body.amount).replace(/[$,\s]/g, '')); if (!(a > 0)) return say('Type the amount to add', false);
          if (body.amount.trim() !== body.amount2.trim() && Number(String(body.amount2).replace(/[$,\s]/g, '')) !== a) return say('The two amounts do not match', false);
          if (body.reason.trim().length < 3) return say('Write a reason', false);
          const c = await ctx.api('gc-card', { number: body.number }); if (!c.ok) return say(c.message || 'No such card', false);
          say('');
          H.manager('Add free credit', `Add ${money(a)} of FREE credit to ${c.card.cardMask} (balance now ${money(c.card.balance)}, after ${money(c.card.balance + a)}). Nothing is charged. Reason: ${body.reason.trim()}. A manager types their password to approve.`, async m => {
            const r = await ctx.api('gc-free-credit', { ...body, ...m });
            if (r.ok) { doneView(r); loadFree(); return null; }
            if (r.unknown) { toastMsg(r.message); drawTopup2(); return null; }
            return r;
          });
        };
        loadFree();
      }
      const toastMsg = m => { if (ctx.toast) ctx.toast(m, false); };
      const drawTopup2 = () => { S.view = 'topup'; closeAnyModal(); draw(); };
      const closeAnyModal = () => { if (typeof closeModal === 'function') closeModal(); };
      async function loadFree() {
        const r = await ctx.api('gc-free-list', {}); const el = $('b8fl'); if (!el) return;
        if (!r.ok) { el.textContent = r.needManager ? 'The list shows for a manager.' : (r.message || 'Could not load'); return; }
        el.innerHTML = r.rows.length ? `<table><tr><th>When</th><th>Card</th><th class="n">Credit</th><th>Reason</th><th>By</th></tr>${r.rows.map(x => `<tr><td>${esc(when(x.at))}</td><td>${esc(x.cardMask)}</td><td class="n">${money(x.amount)}</td><td>${esc(x.reason)}</td><td>${esc(x.by)}</td></tr>`).join('')}<tr><td colspan="2"><b>Total</b></td><td class="n"><b>${money(r.total)}</b></td><td colspan="2"></td></tr></table>` : 'No free credit has been given yet.';
      }
      // ---------- Top-up orders (72, 71, 70) ----------
      async function drawOrders() {
        main.innerHTML = `<h3>Top-up orders</h3><div class="b8bar"><input id="b8q" placeholder="card number (optional)" autocomplete="off" data-kb="text" style="width:240px"><button class="pb" id="b8go">Search</button></div><div class="m" id="b8m"></div><div id="b8out"></div>`;
        const load = async () => {
          say('Looking…', true); const r = await ctx.api('gc-orders', { keyword: $('b8q').value.trim() }); if (!r.ok) return say(r.message || 'Could not load', false); say('');
          $('b8out').innerHTML = `<table><tr><th>Order</th><th>Card</th><th class="n">Amount</th><th>Status</th><th>How</th><th>When</th><th></th></tr>${r.rows.map(o => `<tr><td>${esc(o.number)}</td><td>${esc(o.cardMask)}</td><td class="n">${money(o.amount)}</td><td>${o.status === 20 ? '<span class="tag ok">Completed</span>' : '<span class="tag warn">' + esc(o.statusName || 'New') + '</span>'}${o.free ? ' <span class="tag mgr">free credit</span>' : ''}</td><td>${esc(o.paymentTypeName || '')}</td><td>${esc(when(o.completedTime || o.createTime))}</td><td>${mgr && o.status !== 20 ? `<button class="pb s" data-id="${esc(o.id)}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No top-up orders.</td></tr>'}</table><div class="small">${r.total} order${r.total === 1 ? '' : 's'}${r.total > r.rows.length ? ' (newest ' + r.rows.length + ' shown)' : ''}</div>`;
          $('b8out').querySelectorAll('button[data-id]').forEach(b => b.onclick = () => H.manager('Delete a top-up', 'Delete this unfinished top-up. Nothing is added to the card. A manager types their password to approve.', async m => { const x = await ctx.api('gc-order-delete', { id: b.dataset.id, ...m }); if (x.ok) { load(); return null; } return x; }));
        };
        $('b8go').onclick = load; $('b8q').onkeydown = e => { if (e.key === 'Enter') load(); }; load();
      }

      draw();
      return stop;
    }
  });
})();

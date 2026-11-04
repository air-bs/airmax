// AirMax Extra 12: the customer's Discount, the top strip of the Customers > Credit box (manager only; the box itself is only drawn for a manager).
//   "Store credit now $12.50 | Discount [ 10 ] % (customer record)   [Save discount]"
// It is the discount stored on the customer in AIR POS (a percent, 0-100). The register does NOT apply it to a sale, so the screen says "customer record".
// Customers (customers.js) calls  AirMaxCreditDiscount.draw(el, { id, name }, ctx, { balance, onSaved })  when it draws the Credit box. This file registers no tab.
// Save asks first ("Change Discount from 10% to 15% for <name>?  Save / Cancel"), then cust-discount-save (confirmed:true). A logged-in manager is not asked for a password.
(function () {
  'use strict';
  const CSS = `
  .cu-strip { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:10px 12px 0; }
  .cu-strip .k { color:#566573; } .cu-strip .v { font-weight:600; } .cu-strip .sep { color:#c0c4cc; }
  .cu-strip label { display:flex; gap:6px; align-items:center; }
  .cu-strip input[type=text] { width:72px; height:32px; border:1px solid var(--ap-line, #dcdfe6); border-radius:3px; padding:0 8px; font:inherit; text-align:right; }
  .cu-strip .src { color:#7f8c8d; font-size:12.5px; }
  .cu-strip-note { padding:6px 12px 0; color:#566573; font-size:12.5px; } .cu-strip-note:empty { display:none; }
  `;
  const RX = /^\d{1,3}(\.\d{1,2})?$/;                                         // whole or decimal, 0-100, at most 2 decimals (the server checks the same)
  const pct = n => String(Number(n)) + '%';
  function draw(host, m, ctx, opt) {
    opt = opt || {};
    if (!host || !m) return;
    if (!document.getElementById('cuDiscStyle')) { const s = document.createElement('style'); s.id = 'cuDiscStyle'; s.textContent = CSS; document.head.appendChild(s); }
    const E = ctx.esc;
    host.innerHTML = `<div class="cu-strip"><span><span class="k">Store credit now</span> <span class="v">${E(opt.balance == null ? '' : opt.balance)}</span></span><span class="sep">|</span>
      <label><span class="k">Discount</span> <input type="text" id="cuDisc" inputmode="decimal" autocomplete="off" aria-label="Discount percent"> <span>%</span></label>
      <span class="src">(customer record)</span><button class="cu-btn pri" id="cuDiscSave" disabled>Save discount</button></div><div class="cu-strip-note" id="cuDiscNote"></div>`;
    const inp = host.querySelector('#cuDisc'), sv = host.querySelector('#cuDiscSave'), note = host.querySelector('#cuDiscNote');
    let cur = null, dead = false, busy = false;
    const dirty = () => { sv.disabled = cur == null || busy || inp.value.trim() === String(cur); };
    const msg = (t, ok) => { if (ctx.toast) ctx.toast(t, ok); };
    ctx.api('cust-discount-get', { retailMemberId: m.id }).then(r => {
      if (dead || !host.isConnected) return;
      if (!r || r.ok === false) { host.innerHTML = r && r.forbidden ? '' : `<div class="cu-strip-note" style="display:block">${E((r && r.message) || 'Could not load the discount')}</div>`; return; }
      cur = Number(r.discount) || 0; inp.value = String(cur); inp.disabled = false; dirty();
    }).catch(() => {});
    inp.disabled = true; inp.oninput = () => { note.innerHTML = ''; dirty(); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); if (!sv.disabled) sv.click(); } };
    sv.onclick = () => {
      const t = inp.value.trim();
      if (!RX.test(t) || Number(t) > 100) { msg('Discount must be a number from 0 to 100, like 10 or 12.5', false); return; }
      note.innerHTML = `Change Discount from <b>${E(pct(cur))}</b> to <b>${E(pct(t))}</b> for ${E(m.name || 'this customer')}? It is saved on the customer in AIR POS; the register does not apply it to a sale. <button class="cu-btn pri" data-yes>Save</button> <button class="cu-btn" data-no>Cancel</button>`;
      note.querySelector('[data-no]').onclick = () => { note.innerHTML = ''; inp.value = String(cur); dirty(); };
      note.querySelector('[data-yes]').onclick = async ev => {
        if (busy) return; busy = true; ev.target.disabled = true; sv.disabled = true;
        const w = await ctx.api('cust-discount-save', { retailMemberId: m.id, discount: t, confirmed: true });
        busy = false; if (dead || !host.isConnected) return;
        if (w && w.ok) { cur = Number(w.discount); inp.value = String(cur); note.innerHTML = ''; msg((w.message || 'Saved') + ': Discount ' + pct(cur), true); if (opt.onSaved) opt.onSaved(w); }
        else { note.innerHTML = ''; if (w && w.discount != null) { cur = Number(w.discount); inp.value = String(cur); } msg((w && w.message) || 'Could not save the discount', false); }
        dirty();
      };
    };
    return () => { dead = true; };
  }
  window.AirMaxCreditDiscount = { draw };
})();

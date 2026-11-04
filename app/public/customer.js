// Customer display (second monitor). Read-only: it only GETs /api/customer-state and draws it.
// No buttons, no inputs, no POST calls, so nothing on this screen can change the sale.
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DEF = { itemsHead: 'Your items', returnHead: 'Return', cardReader: 'Please use the card reader', thankYou: 'Thank you' }; // 1.0.9-local.5: per-shop texts, these when empty
  let msgs = { ...DEF };
  let cur = '$', last = '', fails = 0, brand = { welcome: '', welcome2: '', logo: null, pic: null, fit: 'contain', fill: '' }, logoSrc = null, picSrc = null, picBad = null;
  const money = n => (n < 0 ? '−' : '') + cur + Math.abs(Number(n) || 0).toFixed(2);
  const row = (l, v, cls = '') => `<div class="${cls}"><span>${l}</span><span>${v}</span></div>`;
  const show = id => ['idle', 'sale', 'done'].forEach(x => $(x).classList.toggle('on', x === id));
  function draw(c) {
    cur = c.currency || '$';
    if (c.msgs && typeof c.msgs === 'object') for (const k of Object.keys(DEF)) msgs[k] = typeof c.msgs[k] === 'string' && c.msgs[k].trim() ? c.msgs[k] : DEF[k]; // offline: keep the last ones
    if (c.view === 'sale' || c.view === 'pay' || c.view === 'return') {
      const ret = c.view === 'return';
      $('head').textContent = ret ? msgs.returnHead : msgs.itemsHead; $('head').classList.toggle('ret', ret);
      $('list').innerHTML = c.lines.slice(-14).map(x => `<div class="row${x.ret ? ' ret' : ''}"><span>${esc(x.name)}${x.discount ? `<span class="d">Saved ${money(x.discount)}</span>` : ''}</span>`
        + `<span class="q">${Math.abs(x.quantity)} × ${money(x.price)}</span><span class="t">${money(x.total)}</span></div>`).join('');
      const t = c.totals || {}, p = c.pay;
      const up = !ret && !p && c.updating, mo = v => up ? '…' : money(v); // 1.0.11-speed.1: total still being checked after a scan: never show an old total
      const cw = !ret && c.cardWait ? `<div class="cardmsg" id="cardmsg">${esc(msgs.cardReader)}<b>${money(c.cardWait.amount)}</b></div>` : ''; // 1.0.10: display only
      $('side').innerHTML = cw + (ret ? row('Tax', money(t.tax)) + row('Refund', money(t.refund), 'big ret')
        : row('Subtotal', mo(t.subtotal)) + (t.discount && !up ? row('Savings', money(-t.discount)) : '') + row(t.taxOff ? 'Tax (none)' : 'Tax', mo(t.tax), t.taxOff ? 'off' : '')
          + (t.returned ? row('Returned', money(-t.returned), 'ret') : '')
          + row(t.net != null && t.net < 0 ? 'Refund' : 'Total', up ? 'Updating…' : money(t.net != null ? Math.abs(t.net) : t.total), 'big')
          + (p ? (p.paid ? row('Paid', money(p.paid)) : '') + (p.change ? row('Change', money(p.change), 'chg') : row('Amount due', money(p.due), 'due')) : ''));
      show('sale');
      const l = $('list'); while (l.children.length > 1 && l.scrollHeight > l.clientHeight) l.firstElementChild.remove(); // newest lines always visible
    } else if (c.view === 'done') {
      const p = c.pay || {};
      $('sum').innerHTML = `<span>Total</span><b>${money(p.total)}</b>` + (p.paid ? `<span>Paid</span><b>${money(p.paid)}</b>` : '') + (p.change ? `<span>Change</span><b class="chg">${money(p.change)}</b>` : '');
      $('thx').textContent = msgs.thankYou;
      show('done');
    } else { // Welcome: the store's own message and logo (1.2.1), always as plain text; falls back to today's Welcome + shop name
      if (!c.offline) brand = { welcome: c.welcome || '', welcome2: c.welcome2 || '', logo: c.logo || null, pic: c.welcomePic || null, fit: c.welcomePicFit === 'cover' ? 'cover' : 'contain', fill: /^#[0-9a-f]{6}$/i.test(c.welcomePicFill || '') ? c.welcomePicFill : '' }; // offline: keep the last ones
      $('wel').textContent = brand.welcome || 'Welcome';
      $('shop').textContent = brand.welcome2 || c.shop || $('shop').textContent || '';
      const img = $('logo');
      if (brand.logo !== logoSrc) { logoSrc = brand.logo; if (logoSrc) { img.hidden = false; img.src = logoSrc; } else { img.hidden = true; img.removeAttribute('src'); } }
      // 1.0.10 welcome picture: full screen instead of the message/logo; a broken file falls back to the Welcome above
      const wp = $('wp');
      if (brand.pic !== picSrc) { picSrc = brand.pic; picBad = null; if (picSrc) wp.src = picSrc; else wp.removeAttribute('src'); }
      const on = !!picSrc && picBad !== picSrc;
      wp.hidden = !on; wp.style.objectFit = brand.fit; $('idle').classList.toggle('pic', on); $('idle').style.setProperty('--wp-fill', brand.fill || '#1f3b57');
      show('idle');
    }
  }
  async function tick() {
    try {
      const r = await fetch('/api/customer-state', { cache: 'no-store' }); const txt = await r.text(); fails = 0;
      if (txt !== last) { last = txt; draw(JSON.parse(txt)); }
    } catch { if (++fails > 6 && last !== 'idle') { last = 'idle'; draw({ view: 'idle', offline: true }); } } // server restarting: show Welcome, keep trying
    setTimeout(tick, 400);
  }
  $('logo').onerror = () => { $('logo').hidden = true; }; // missing / broken logo: plain Welcome
  $('wp').onerror = () => { picBad = picSrc; $('wp').hidden = true; $('idle').classList.remove('pic'); }; // 1.0.10 broken welcome picture: normal Welcome
  // nothing to click, select or type here
  ['contextmenu', 'selectstart', 'dragstart', 'wheel'].forEach(e => document.addEventListener(e, ev => ev.preventDefault(), { passive: false }));
  document.addEventListener('keydown', ev => { if (ev.key !== 'F11') ev.preventDefault(); });
  tick();
})();

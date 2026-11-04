'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = n => (S.currency || '$') + (Number(n) || 0).toFixed(2);
// AirMax #18 (Ari, Nov 2): a discounted item shows its discount on its own line under it, in green with the % ("33% off -$9.90").
// Display only: made from the line's own discount % and $ (discline.js, the same text the receipt prints); no total changes.
const discLineHtml = r => { const t = typeof window.discLineText === 'function' ? window.discLineText(r, S.currency || '$') : ''; return t ? `<div class="discline">${esc(t)}</div>` : ''; };
let S = {}, selectedRow = null, keys = [], busy = false;
const lid = row => (S.mode === 'return' ? undefined : (S.lineIds || [])[row]); // 1.0.11 (F1): the line's own id, so a qty / Delete / F4 / tax change hits THAT line even when a scan moves the rows meanwhile
const SUBTAG = { temp: 10, extra: 20 };

// Every call has a time limit, so the screen can never freeze on a hung request. A local server that is gone
// (restarting after a crash: the launcher watchdog brings it back) shows "Reconnecting…" and is retried for reads.
const API_SLOW = new Set(['pay-tender', 'pay-cash', 'finish-sale', 'pay-recheck', 'return-confirm', 'card-retry', 'z-generate', 'x-report', 'report-print', 'print', 'print-return', 'test-print', 'test-drawer', 'drawer', 'drawer-sale', 'login', 'clock-out']);
function reconnecting(on) {
  let o = $('reconn'); if (!o && on) { o = document.createElement('div'); o.id = 'reconn'; o.innerHTML = '<div>Reconnecting to Air Max…<small>Your sale is saved on this PC. Nothing is lost.</small><span id="reconnId" class="rdid-big"></span></div>'; document.body.appendChild(o); }
  if (o) { o.style.display = on ? '' : 'none'; if (on) rdidShow(); }
}
// AirMax 1.0.4: this PC's RustDesk remote help ID (ID ONLY, the password is never asked for or shown). Read once after login and
// kept in the page, so it stays on screen even when Air Register stops answering; re-read every few minutes. Not set up = nothing shown.
const RDID = { id: '', pretty: '', at: 0, busy: false };
function rdidShow() {
  const t = RDID.id ? 'Remote ID ' + RDID.pretty : '';
  const sb = $('stRdid'); if (sb) { sb.textContent = t; sb.style.display = t ? '' : 'none'; sb.classList.toggle('on', !!t); }
  const big = $('reconnId'); if (big) { big.textContent = t ? 'Remote help ID: ' + RDID.pretty : ''; big.style.display = t ? '' : 'none'; }
}
async function rdidFetch() {
  if (RDID.busy || RDID.at && Date.now() - RDID.at < 4 * 60000) return; RDID.busy = true;
  try { // plain fetch (not api()): never shows "Reconnecting" or logs anyone out; a failed read keeps the last ID on screen
    const r = await (await fetch('/api/remote-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) })).json();
    if (r && r.ok) { const id = r.installed && /^\d{6,12}$/.test(String(r.id || '')) ? String(r.id) : ''; RDID.id = id; RDID.pretty = id.replace(/(\d{3})(?=\d)/g, '$1 '); RDID.at = Date.now(); } else RDID.at = Date.now() - 3 * 60000; // could not check: try again in a minute
  } catch { RDID.at = Date.now() - 3 * 60000; /* server not answering: keep the cached ID, try again in a minute */ } finally { RDID.busy = false; rdidShow(); }
}
// Store request #14 (Nov 2): never look frozen when AIR POS (or the printer) is slow or gone. After 3 s of waiting a small banner says so, the
// sale stays on screen (nothing is cleared, nothing is resent), and it goes away by itself when the answer comes. A lost-connection answer from
// AIR POS gets a plain-words message. Screen only: no call, amount or button changes.
const PRINTERISH = /^(print|print-return|test-print|test-drawer|drawer|drawer-sale|label-print|report-print|reprint|gift-reprint|gift-pick-print)$/;
function awaitBanner(on, name) {
  let o = $('awaitpos');
  if (!o && on) { o = document.createElement('div'); o.id = 'awaitpos'; o.setAttribute('role', 'status'); document.body.appendChild(o); }
  if (o) { o.style.display = on ? '' : 'none'; if (on) o.innerHTML = PRINTERISH.test(name || '') ? 'Still working… waiting for the printer.<small>Your sale stays on screen.</small>' : 'Still working… waiting for AIR POS.<small>Your sale stays on screen. Nothing is lost or sent twice.</small>'; }
}
const LOST_CONN = /Network error: ?([A-Za-z_]+)/;
function lostConnMsg(t) { // wording only, in place: the rest of the server's message (e.g. what was or wasn't paid) is kept as it is
  if (typeof t !== 'string' || /Local hardware/.test(t) || !LOST_CONN.test(t)) return t;
  const r = t.replace(LOST_CONN, (m, c) => "Can't reach AIR POS (" + c + ")");
  return r.length < 90 ? r.replace(/[.\s]*$/, '') + '. Your sale is still on screen; try again in a moment (check the internet / WiFi).' : r;
}
async function api(name, body, opt = {}) {
  const t = name === 'state' ? 0 : setTimeout(() => awaitBanner(true, name), 3000);
  try { const j = await apiCall(name, body, opt); if (j && typeof j === 'object' && typeof j.message === 'string') j.message = lostConnMsg(j.message); return j; }
  finally { clearTimeout(t); if (t) awaitBanner(false); }
}
async function apiCall(name, body, opt = {}) {
  const ms = opt.timeoutMs || (name === 'state' ? 8000 : API_SLOW.has(name) ? 100000 : 30000);
  for (let attempt = 0; ; attempt++) {
    let r;
    try { r = await fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms) }); }
    catch (e) {
      const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      // a money call that timed out may still be running on the server: never resend it blindly; the server checks before charging again
      if (timeout || attempt >= 20 || name !== 'state' && !opt.retry) { reconnecting(false); return { ok: false, retryable: true, message: timeout ? 'Air Max is taking too long to answer. Press Retry (it checks first, nothing is taken twice).' : 'Air Max is restarting. Press Retry in a moment.' }; }
      reconnecting(true); await new Promise(res => setTimeout(res, 1500)); continue;
    }
    reconnecting(false);
    const j = await r.json().catch(() => ({ ok: false, retryable: true, message: 'Bad reply from Air Max (HTTP ' + r.status + '). Press Retry.' }));
    if (name !== 'state' && (j.loggedOut || j.loggedIn === false && name !== 'login')) await refresh();
    return honestReply(j);
  }
}
// 1.0.9-local.5 (display only, Ari OK 4:20 PM ET Oct 30): app/lib is frozen, so two of its messages are re-worded here on the way
// to the screen. They said "nothing was paid" even when AIR POS only failed to answer clearly (stress report 1c / 5b / 8f).
// Wording only: no amount, button or payment step changes.
const HONEST = [
  [/AIR POS has no record of this sale yet\. Nothing was paid there; take the payment again\./g, 'AIR POS has no record of this sale yet. Payments already taken on this screen are kept. Check what the customer has already paid before taking any payment again.'],
  [/\. Nothing was paid yet; continue or press New sale\./g, '. No payment was found for it. Check that the customer has not already paid before taking payment; then continue or press New sale.'],
  [/; nothing was paid yet\./g, '; no payment was found for it. Check that the customer has not already paid before taking payment.'],
];
function honestMsg(t) { if (typeof t !== 'string' || !/othing was paid/.test(t)) return t; for (const [re, to] of HONEST) t = t.replace(re, to); return t; }
function honestReply(j) {
  if (!j || typeof j !== 'object') return j;
  if (typeof j.message === 'string') j.message = honestMsg(j.message);
  if (typeof j.notice === 'string') j.notice = honestMsg(j.notice); else if (j.notice && typeof j.notice.message === 'string') j.notice.message = honestMsg(j.notice.message);
  return j;
}
function toast(m, ok) { const t = $('toast'); t.textContent = m || ''; t.className = 'msg ' + (ok === false ? 'err' : ok ? 'ok' : ''); }
async function act(name, body, opts = {}) {
  if (busy) return; busy = true; document.body.classList.add('busy');
  try {
    const r = await api(name, body); if (!opts.silent || !r.ok) toast(r.message, r.ok);
    if (!r.ok && r.retryable && window.retryOffer) window.retryOffer(() => act(name, body, opts));
    await refresh(); return r;
  } finally { busy = false; document.body.classList.remove('busy'); }
}

// F5 Tax Off: a cashier who is not an AIR POS manager needs a manager's login (same dialog as Restart PC)
async function taxOff() {
  const r = await act('tax-exempt', {});
  if (r && !r.ok && r.needManager) managerLogin('Tax Off', 'A manager must approve Tax Off for this sale.', async m => {
    const x = await api('tax-exempt', { on: true, ...m }); if (!x.ok) return x;
    closeModal(); toast(x.message, true); await refresh(); return null;
  });
}
// ---------- modal helper ----------
function closeModal() { $('modalRoot').innerHTML = ''; document.body.classList.remove('paying'); focusScan(); }
function modalOpen() { return !!$('modalRoot').firstChild; }
function modal(html, onMount, cls = '') {
  $('modalRoot').innerHTML = `<div class="el-overlay ${cls ? cls.split(' ').map(c => c + '-ov').join(' ') : ''}" id="ov"><div class="modal ${cls}" role="dialog">${html}</div></div>`;
  // Owner: a click / tap OUTSIDE the window closes it, exactly like Esc (each window's own Esc rule applies: the payment
  // screen goes back one step and never drops a running card payment or a paid amount).
  // (the full-screen payment screen has no "outside")
  if (!/\bfullpay\b/.test(cls)) $('ov').addEventListener('mousedown', e => { if (e.target !== e.currentTarget) return; e.preventDefault(); (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); });
  $('modalRoot').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  if (onMount) onMount();
  const f = $('modalRoot').querySelector('[autofocus]'); if (f) { f.focus(); f.select && f.select(); }
}
function focusScan() { if (!modalOpen() && S.loggedIn && S.mode !== 'clockin') $('scanInput').focus(); }

// ---------- login ----------
const LS_CO = 'airreg.lastCompany', LS_US = 'airreg.lastUser';
function showLogin(show) {
  $('login').style.display = show ? 'flex' : 'none';
  if (show && !$('login').dataset.init) {
    $('login').dataset.init = 1;
    $('lgCompany').value = localStorage.getItem(LS_CO) || ''; $('lgUser').value = localStorage.getItem(LS_US) || '';
    ($('lgCompany').value ? ($('lgUser').value ? $('lgPw') : $('lgUser')) : $('lgCompany')).focus();
    if (window.AirMaxMounts) AirMaxMounts.fill($('mountLogin'), 'checkout.login'); // Step 0 slot: a batch adds sign-in / fingerprint content here
  }
}
$('loginForm').onsubmit = async e => {
  e.preventDefault(); $('lgMsg').textContent = ''; $('lgBtn').disabled = true; $('lgBtn').textContent = 'Logging in…';
  const company = $('lgCompany').value.trim(), user = $('lgUser').value.trim(), pwEl = $('lgPw');
  try {
    const r = await api('login', { company, user, password: pwEl.value });
    pwEl.value = ''; // never kept in the page
    if (r.ok) { localStorage.setItem(LS_CO, company); localStorage.setItem(LS_US, user); delete $('login').dataset.init; toast(r.message, true); }
    else { $('lgMsg').textContent = r.message; pwEl.focus(); }
  } finally { $('lgBtn').disabled = false; $('lgBtn').textContent = 'Log In'; await refresh(); }
};

// ---------- clock in / out ----------
// 1.0.9 (Team Kit): Number("1,250.00") and Number("$100") are NaN, so the count went to AIR POS as $0. Read "$", spaces and
// thousands commas; anything else that is not a plain amount (blank, "1.250,00", "-5", "12.345") is refused, never sent as $0.
function cashNum(v) {
  const t = String(v == null ? '' : v).replace(/^\s*\$?\s*/, '').replace(/\s+$/, '');
  return /^(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$|^\.\d{1,2}$/.test(t) ? Number(t.replace(/,/g, '')) : NaN;
}
const CASH_BAD = 'Enter the cash amount as a number, like 1250.00 or $100.';
function clockInDialog() {
  if (modalOpen()) return;
  const exp = S.session && S.session.expectedAmount;
  modal(`<h2>Clock In</h2><p>Count the cash in the drawer and enter the starting amount.</p>
    ${exp != null ? `<p class="note">Expected: ${money(exp)}</p>` : ''}
    <label class="f">Starting cash</label><input class="f" id="ciAmt" inputmode="decimal" value="0" autofocus>
    <div id="mountLock"></div>
    <div class="row2"><button class="pbtn s" id="ciOut">Log out</button><button class="pbtn g" id="ciOk">Clock In (Enter)</button></div>`, () => {
    $('ciOk').onclick = async () => { const a = cashNum($('ciAmt').value); if (isNaN(a)) return toast(CASH_BAD, false); const r = await act('clock-in', { amount: a }); if (r && r.ok) closeModal(); };
    $('ciOut').onclick = async () => { closeModal(); await act('logout'); };
    $('ciAmt').onkeydown = e => { if (e.key === 'Enter') $('ciOk').click(); };
    if (window.AirMaxMounts) AirMaxMounts.fill($('mountLock'), 'checkout.lock'); // Step 0 slot (clock-in / unlock screen)
  });
}
async function clockOutDialog() {
  const e = await api('clock-out-expected');
  modal(`<h2>Clock Out</h2><p>Count the drawer. Expected cash: <b>${money(e.expected)}</b></p>
    <label class="f">Counted cash</label><input class="f" id="coAmt" inputmode="decimal" value="${(e.expected || 0).toFixed(2)}" autofocus>
    <p class="note">Clocking out ends the register session and logs you out.</p>
    <div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button><button class="pbtn r" id="coOk">Clock Out</button></div>`, () => {
    $('coOk').onclick = async () => { const a = cashNum($('coAmt').value); if (isNaN(a)) return toast(CASH_BAD, false); const r = await act('clock-out', { amount: a }); if (r && r.ok) closeModal(); };
    $('coAmt').onkeydown = ev => { if (ev.key === 'Enter') $('coOk').click(); };
  });
}

// ---------- dialogs ----------
const msgIn = (el, x) => { if (el && document.body.contains(el)) { el.textContent = x.message || ''; el.className = 'msg ' + (x.ok ? 'ok' : 'err'); } else toast(x.message, x.ok); };
// 1.2.0 payment keyboard rule (owner may change): true = when the typed amounts cover the sale (nothing left to pay), Enter finishes it.
// false = Enter only ever moves to the next line; the Pay button finishes.
const PAY_ENTER_COMPLETES = true;
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// One payment screen for every tender. Any mix: cash, card, gift card, check, store credit, points.
let payTimer = null, payAside = false; // payAside: cashier went back to items in the middle of a payment (paid part kept)
const MC_OFF = 'Manual Credit not set up';
const CHK_OFF = 'Add a customer to pay by check'; const ACC_OFF = 'Add a customer to put the sale on account'; // owner rules F (Check) and I (Put on Account) need a customer/member on the sale
function nextBills(left) { // the next round bills above the amount due
  const out = []; [1, 5, 10, 20, 50, 100].forEach(b => { const v = Math.ceil((left + 1e-9) / b) * b; if (v > left + 0.004 && !out.includes(v) && v <= left + 100) out.push(v); });
  return out.sort((a, b) => a - b).slice(0, 4);
}
let stripeJs = null;
function loadStripeJs() {
  if (window.Stripe) return Promise.resolve();
  return stripeJs = stripeJs || new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = ok; s.onerror = () => { stripeJs = null; bad(new Error('Stripe.js did not load')); }; document.head.appendChild(s); });
}
async function checkoutDialog() {
  if (S.mode === 'return') return returnConfirmDialog();
  if (S.mix && S.mix.lines.length && (!S.cart.length || S.mix.net <= 0)) return refundDialog(); // no-receipt return (extras.js)
  if (!S.cart.length) return toast('The order is empty — scan items first', false);
  const r = await api('pay-start'); await refresh();
  if (!r.ok) return toast(r.message, false);
  const payStartLast = S.lastOrderId;
  let mc = { no: '', exp: '', cvv: '' }; // Sola Online Payment card fields: memory only, cleared after the payment
  let gift = [], keyed = null, hi = 0, amounts = {}, extra = { chkNo: '', gcNo: '' }, queue = [], running = false; // keyed = { clientSecret, stripe, num, mounted } (memory only, never stored)
  let cof = { mid: null, cards: null, pick: '' }; // 1.0.9 saved cards of the customer on the sale (brand / last 4 / exp / AIR POS id only); pick '' = none picked (no preselection)
  // 1.2.0: full-screen payment view (layout knobs: the --pay-* variables + .fullpay rules in index.html)
  // side panel (work copy): the payment opens on the LEFT (owner 3:45 PM: back on the left, as first built); the sale screen stays visible on the right. A tap there = back to items.
  payAside = false; document.body.classList.add('paying');
  modal(`<div class="payhead"><h2>Payment</h2><span class="note">Press Back (Esc) to add items</span></div><div id="payBody"></div>`, () => { renderPay(); }, 'fullpay sidepay');
  function amountLeft() { return S.pay ? S.pay.remaining : S.totals.due; }
  function renderPay() {
    const p = S.pay; if (!$('payBody')) return;
    if (!p && S.completed && S.completed.result && S.completed.orderId !== payStartLast) { stopPayTimer(); return doneDialog(S.completed.result); } // card poll finished the sale
    if (!p) { // ls9 (seed 110161): no payment open any more (it closed on the server) -> never an empty window: say so, Back (Esc) closes it
      if (!$('payNone')) { $('payBody').innerHTML = `<p class="note" id="payNone">There is no payment open on this sale any more. Nothing was charged here. Press Back (Esc) to go back to the sale.</p><div id="payMsg" class="msg"></div><div class="row2"><button class="pbtn s" id="payBack">Back (Esc)</button></div>`;
        $('payBack').onclick = () => { stopPayTimer(); closeModal(); refresh(); }; }
      return;
    }
    if (p.result && p.result.completed) { stopPayTimer(); return doneDialog(p.result); }
    const left = amountLeft(), m = S.member;
    const card = p.card;
    const tl = p.tenders.length ? `<table class="mini"><tbody>${p.tenders.map(t => `<tr><td>${esc(t.type === 30 ? 'Manual Credit' : t.name)}</td><td class="n">${money(t.amount)}</td><td class="n st-${t.status}">${t.status === 'done' ? '✔ paid' : t.status === 'waiting' ? '… waiting' : '✖ ' + t.status}</td></tr>`).join('')}</tbody></table>` : '';
    // worker 2 (1.2.0): the three big numbers the cashier reads — Due / Paid / Balance (+ Change when cash is over)
    const nums = `<div class="pn total"><span>${p.paid > 0.004 ? `Due (of ${money(p.net != null && S.mix && (S.mix.lines.length || p.exchangeCredit) ? p.net : S.totals.due)})` : 'Due'}</span><b id="payTotal">${money(p.paid > 0.004 ? left : (p.net != null && S.mix && (S.mix.lines.length || p.exchangeCredit) ? p.net : S.totals.due))}</b></div><div class="pn tend"><span>Paid</span><b id="payTend">${money(p.paid)}</b></div>
      <div class="pn left"><span>Balance</span><b id="payDue">${money(left)}</b></div><div class="pn chg"><span>Change</span><b id="chg">$0.00</b></div>`;
    let body = `${p.stockWarning ? `<div class="msg err" id="payStock" style="margin:0 0 6px">⚠ ${esc(p.stockWarning)}</div>` : ''}${tl}`;
    if (p.needManager) {
      body += `<div class="banner">Manager approval needed</div>
        <label class="f">Manager user</label><input class="f" id="mgUser" autocomplete="off" autofocus>
        <label class="f">Manager password</label><input class="f" id="mgPw" type="password" autocomplete="new-password">
        <div id="payMsg" class="msg"></div><div class="row2"><button class="pbtn s" id="payBack">Back (Esc)</button><button class="pbtn g" id="mgOk">Approve</button></div>`;
    } else if (card && card.kind === 'keyed' && card.status === 'keyed') {
      if (keyed && keyed.mounted && $('kForm')) return; // keep Stripe's iframes alive while the cashier types
      body += `<div class="cardbox" id="kForm"><div class="big">Manual Credit ${money(card.amount)}</div>
        ${keyed && keyed.clientSecret ? `${S.keyed && S.keyed.test ? '<div class="note"><b>Stripe TEST mode</b></div>' : ''}
        <label class="f" style="text-align:left">Card number</label><div class="sfield" id="kNum"></div>
        <div style="display:flex;gap:8px"><div style="flex:1"><label class="f" style="text-align:left">Expiry</label><div class="sfield" id="kExp"></div></div><div style="flex:1"><label class="f" style="text-align:left">CVC</label><div class="sfield" id="kCvc"></div></div></div>` : '<div class="msg err">Card form closed: press Cancel and start again</div>'}</div>
        <div id="payMsg" class="msg"></div><div class="row2"><button class="pbtn r" id="cardCancel"${keyed && keyed.charging ? ' disabled' : ''}>Cancel card (Esc)</button>${keyed && keyed.clientSecret ? '<button class="pbtn g" id="kCharge">Charge card</button>' : ''}</div>`;
    } else if (card) {
      const decl = card.status === 'declined';
      body += `<div class="cardbox ${decl ? 'bad' : ''}"><div class="big">${decl ? 'Card not approved' : 'Card ' + money(card.amount)}</div>
        <div>${esc(card.message || '')}</div>${card.subMessage ? `<div class="note">${esc(card.subMessage)}</div>` : ''}${decl ? '' : `<div class="note">${card.seconds}s</div>`}</div>
        <div id="payMsg" class="msg"></div><div class="row2"><button class="pbtn r" id="cardCancel">${decl ? 'Use another payment' : 'Cancel card (Esc)'}</button>${decl ? '<button class="pbtn g" id="cardRetry" autofocus>Try card again (Enter)</button>' : ''}</div>`;
    } else if (left <= 0.004 && (p.tenders.length || (S.cart.length && S.totals && S.totals.due <= 0.004))) { // mny109g: a $0.00 sale with items can be finished too
      body += `<div class="cardbox"><div class="big">Fully paid</div></div>
        <div id="payMsg" class="msg"></div>
        <div class="row2"><button class="pbtn g" id="payFinish" autofocus>Finish sale (Enter)</button></div>
        <div class="row2"><button class="pbtn s" id="payKeepBack" title="Closes this screen only. Nothing is cancelled or sent again.">Back to sale (payments kept) (Esc)</button><button class="pbtn" id="payRecheck" title="Reads the sale from AIR POS again. Never takes a payment.">Check AIR POS again</button></div>`;
    } else {
      const ls = payLines(), due = typedDue();
      if (hi >= ls.length) hi = 0;
      body += `<div class="plist" id="plist">${ls.map(([t, l], i) => `<div class="pline ${i === hi ? 'on' : ''}" data-i="${i}" data-t="${t}"><span class="plbl">${l}</span><input class="pamt" id="${t === 10 ? 'cashIn' : 'pa-' + t}" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(amounts[t] || '')}"></div>`
        + (i === hi && t === 40 ? `<div class="pextra"><input class="f" id="gcNo" placeholder="Gift card" value="${esc(extra.gcNo)}" autocomplete="off"><input class="f" id="gcPw" type="password" placeholder="PIN (if any)" autocomplete="new-password" style="max-width:150px"><button class="pbtn" id="gcAdd">Check</button><div id="gcList" style="width:100%">${gift.map(c => `<div class="gmRow"><span>${esc(String(c.number).length > 4 ? '**** ' + String(c.number).slice(-4) : c.number)}</span><b>${money(c.balance)}</b></div>`).join('')}</div></div>` : '')
        + (i === hi && t === 10 ? (() => { const r = Math.max(0, round2(amountLeft() - (typed() - (onceDone(10) ? 0 : Number(amounts[10]) || 0)))); return `<div class="pextra quick"><button class="pbtn s" data-l="Exact" data-v="${r.toFixed(2)}">Exact</button><span id="nextBills">${nextBills(r).filter(v => ![5, 10, 20, 50, 100].includes(v)).map(v => `<button class="pbtn s nb" data-l="Exact" data-v="${v.toFixed(2)}">${money(v)}</button>`).join('')}</span>${[5, 10, 20, 50, 100].map(v => `<button class="pbtn s" data-l="${v}" data-v="${v}">$${v}</button>`).join('')}</div>`; })() : '')
        + (i === hi && t === 30 && S.keyed && S.keyed.kind === 'sola' && !cofCur() ? `<div class="pextra" id="mcBox"><input class="f" id="mcNo" placeholder="Card number" inputmode="numeric" autocomplete="off" value="${esc(mc.no)}"><input class="f" id="mcExp" placeholder="MM/YY" inputmode="numeric" autocomplete="off" maxlength="5" style="max-width:90px" value="${esc(mc.exp)}"><input class="f" id="mcCvv" type="password" placeholder="CVV" inputmode="numeric" autocomplete="new-password" maxlength="4" style="max-width:80px" value="${esc(mc.cvv)}"><div class="note" style="width:100%">AIR POS Online Payment: the card goes straight to AIR POS; Air Max does not keep it.</div></div>` : '')
        + (i === hi && t === 30 ? cofPickHtml() : '')
        + (i === hi && t === 50 ? `<div class="pextra"><input class="f" id="chkNo" placeholder="Check number" value="${esc(extra.chkNo)}" autocomplete="off"></div>` : '')).join('')}</div>
        ${m && m.points > 0 && m.pointExchangeRate > 0 && !p.tenders.length ? `<div class="note"><a href="#" id="usePts">Use points (${m.points})</a>${m.usingPoints ? ' · ' + m.usingPoints + ' used' : ''}</div>` : ''}
        <div id="payMsg" class="msg"></div>
        <div class="row2"><button class="pbtn s" id="payBack">Back (Esc)</button><button class="pbtn g" id="payOk">${due <= 0.004 ? 'Pay — finish sale' : 'Pay ' + money(left - due)}</button></div>`;
    }
    const keep = {}; $('payBody').querySelectorAll('input').forEach(i => { if (i.id && i.type !== 'password') keep[i.id] = i.value; });
    $('payBody').innerHTML = `<div class="paygrid"><div class="paynums">${nums}</div><div class="payact">${body}</div></div>`;
    const back = $('payBack'); if (back) back.onclick = async () => { if (S.pay && S.pay.paid > 0 && !S.pay.card) return keepBack(); const x = await api('pay-close'); if (x.ok) { stopPayTimer(); closeModal(); refresh(); } else msgIn($('payMsg'), x); };
    if (p.needManager) {
      $('mgOk').onclick = async () => { const pw = $('mgPw').value; $('mgPw').value = ''; const x = await api('manager-approve', { user: $('mgUser').value, password: pw }); await refresh(); if (x.ok) renderPay(); else msgIn($('payMsg'), x); };
      $('mgPw').onkeydown = e => { if (e.key === 'Enter') $('mgOk').click(); };
      setTimeout(() => $('mgUser') && $('mgUser').focus(), 0); return;
    }
    if (card && card.kind === 'keyed' && card.status === 'keyed') {
      $('cardCancel').onclick = async () => { keyed = null; queue = []; const x = await api('card-cancel'); await refresh(); renderPay(); msgIn($('payMsg'), x); };
      if (keyed && keyed.clientSecret) mountKeyed();
      return;
    }
    if (card) {
      $('cardCancel').onclick = async () => { queue = []; let x = await api('card-cancel');
        // local.9 (Stress Tester M3): keyed card Stripe accepted, AIR POS has no record after 2 min -> confirmed release only
        if (x && x.canRelease && confirm('AIR POS still has no record of this keyed card payment (' + money(card.amount || 0) + ').\n\nRelease it ONLY if the Stripe dashboard shows no charge for it, or you refunded it there. Otherwise press Cancel and keep waiting.\n\nRelease this card payment?')) x = await api('card-cancel', { release: true });
        await refresh(); renderPay(); msgIn($('payMsg'), x); };
      if ($('cardRetry')) $('cardRetry').onclick = async () => { const x = await api('card-retry'); await refresh(); renderPay(); if (!x.ok) msgIn($('payMsg'), x); };
      startPayTimer(); return;
    }
    stopPayTimer();
    if ($('payFinish')) {
      $('payFinish').onclick = async () => { const b = $('payFinish'); b.disabled = true; const x = await api('finish-sale'); await refresh(); if (x.ok && x.completed) { stopPayTimer(); doneDialog(x); } else { renderPay(); msgIn($('payMsg'), x); } };
      if (S.pay.lastError) msgIn($('payMsg'), { ok: false, message: S.pay.lastError });
      if ($('payKeepBack')) $('payKeepBack').onclick = keepBack;
      if ($('payRecheck')) $('payRecheck').onclick = async () => { const b = $('payRecheck'); b.disabled = true; const x = await recheckPay(); if (x.ok && x.completed) { stopPayTimer(); doneDialog(x); } else { renderPay(); msgIn($('payMsg'), x); } };
      setTimeout(() => $('payFinish') && $('payFinish').focus(), 0); return;
    }
    if ($('usePts')) $('usePts').onclick = e => { e.preventDefault(); pointsDialog(); };
    wireLines(keep);
    $('payOk').onclick = commit;
    if (queue.length && !running) { if (S.pay && S.pay.paid > paidAtCard + 0.004) runQueue(); else queue = []; } // a card finished: go on with the next line of a split; 1.0.11-local.1: only if the card really added to what is paid (a failed / cancelled card drops the rest)
  }
  // ---- 1.2.0 tender list: Credit Card, Cash, then the others ----
  function payLines() { return [[20, 'Credit Card'], [10, 'Cash'], [40, 'Gift Card'], [50, 'Check'], [30, 'Manual Credit'], [11, acctName()]]; }
  // Put on Account (owner request I) = AIR POS's own MemberAccount tender (11): always listed; needs a customer; draws store balance then the house-account credit
  function acctName() { return S.member && !S.member.allowCreditPayment ? 'Store credit' : 'Put on Account'; }
  function acctMax() { const m = S.member; return m ? round2((m.availableBalance || 0) + (m.allowCreditPayment ? m.creditAmount || 0 : 0)) : 0; }
  // ONE Enter puts the whole sale on the customer's account (owner: "customer-account sale takes one Enter and never posts twice").
  // Only when the Put on Account line is empty, nothing else is typed and the customer can cover what is due. A held-down / repeated Enter
  // or an Enter while the payment is still going to AIR POS does nothing (commit() and the server's own one-at-a-time guard also stop a 2nd post).
  function acctOneEnter(e, inp) {
    if (!S.member || (Number(inp.value) > 0) || typed() > 0 || onceDone(11)) return false;
    e.preventDefault(); if (e.repeat || running) return true;
    const due = round2(amountLeft()), cap = acctMax(); if (!(due > 0) || !(cap > 0)) return false;
    const amt = Math.min(due, cap); amounts[11] = amt.toFixed(2); inp.value = amounts[11]; updNums();
    if (amt + 0.004 >= due) { commit(); return true; }
    msgIn($('payMsg'), { ok: true, message: `${S.member.name || 'This customer'} can put ${money(amt)} on account (${money(due)} is due). Press Pay to take ${money(amt)}, then take the rest another way` }); return true;
  }
  function acctMsg() { const m = S.member; if (!m) return { ok: false, message: ACC_OFF };
    const cr = m.allowCreditPayment ? m.creditAmount || 0 : 0, mx = round2((m.availableBalance || 0) + cr);
    return mx > 0 ? { ok: true, message: `${m.name}: can put up to ${money(mx)} on account` + (cr ? ` (store credit ${money(m.availableBalance || 0)} + house account ${money(cr)})` : '') } : { ok: false, message: 'This customer has no house account or store credit in AIR POS (turn on "Allow Credit Payment" for them in AIR POS)' }; }
  // 1.0.9 card on file: under Manual Credit, when this is a Stripe store and a customer is on the sale, list their saved cards.
  // Nothing is preselected; cards saved under another payment channel are shown greyed and cannot be picked. Picking one only
  // adds its AIR POS card id to the same Manual Credit payment (register.js checks the card again before charging).
  function cofOn() { return !!(S.keyed && (S.keyed.kind === 'stripe' || S.keyed.kind === 'sola') && S.member); } // 1.0.9 Sola card on file: Sola stores too (when on in Settings > Cards)
  function cofCur() { const c = cof.cards && cof.pick && cof.pick !== 'new' ? cof.cards.find(x => String(x.id) === cof.pick && x.usable) : null; return cofOn() && cof.mid === S.member.id ? c || null : null; }
  function cofLabel(c) { return `${c.brand} •••• ${c.last4}${c.exp ? ' exp ' + c.exp : ''}`; } // plain text: esc() it for HTML
  function cofChgText() { const c = cofCur(); if (!c) return cof.pick === 'new' ? (S.keyed.kind === 'sola' ? 'Type the new card in the boxes above (it is not saved)' : 'Type the new card into the secure Stripe box after Pay (it is not saved)') : ''; const a = Number(amounts[30]) || 0;
    return `${cofLabel(c)} will be charged ${a > 0 ? money(a) : 'the amount on this line'} when you press Pay`; }
  function cofPickHtml() {
    if (!cofOn()) return '';
    const mid = S.member.id;
    if (cof.mid !== mid) { cof = { mid, cards: null, pick: '' }; api('member-cards', { id: mid }).then(r => { if (cof.mid !== mid) return; cof.cards = r && r.ok ? r.cards : []; if (cof.cards.length && $('payBody') && $('plist')) { payKeep(); renderPay(); } }); }
    if (!cof.cards || !cof.cards.length) return '';
    return `<div class="pextra cofpick" id="cofPick"><div class="cofhint">Saved cards for ${esc(S.member.name || '')}: pick one, or type a new card (new cards are typed, not saved; add cards in Customers)</div>
      <div class="cofopts">${cof.cards.map(c => `<div class="cofopt ${cof.pick === String(c.id) ? 'on' : ''} ${c.usable ? '' : 'off'}" data-c="${esc(c.id)}"${c.usable ? '' : ' aria-disabled="true" title="Saved under another payment channel: cannot be charged here"'}><span class="dot"></span>${esc(cofLabel(c))}</div>`).join('')}<div class="cofopt ${cof.pick === 'new' ? 'on' : ''}" data-c="new"><span class="dot"></span>Type a new card</div></div>
      <div id="cofChg">${esc(cofChgText())}</div></div>`;
  }
  // local.10 (Stress Tester local.9 L6): AIR POS keeps one cash and one check payment per sale (register.js refuses a 2nd one).
  // Once one is taken, an amount typed on that line again is not counted, so the window never offers "Pay — finish sale" for it.
  function onceDone(t) { return (t === 10 || t === 50 || t === 40) && !!(S.pay && (S.pay.tenders || []).some(x => x.status === 'done' && x.type === t)); } // mgc1011: gift card is one payment per sale too
  function onceMsg() { const t = [10, 50, 40].find(t => onceDone(t) && Number(amounts[t]) > 0); if (!t) return ''; // mgc1011: gift card too (AIR POS keeps one gift card payment per sale)
    if (t === 40) { const g = S.pay.tenders.find(x => x.status === 'done' && x.type === 40); return `Gift card ${money(g.amount)} is already taken on this sale. AIR POS keeps only one gift card payment per sale, so this amount is not counted. Take the ${money(typedDue())} left another way (cash, card, check or store credit).`; } // mgc1011
    const d = S.pay.tenders.find(x => x.status === 'done' && x.type === t), nm = t === 10 ? 'cash' : 'check';
    return `${t === 10 ? 'Cash' : 'Check'} ${money(d.amount)} is already taken on this sale. AIR POS keeps only one ${nm} payment per sale, so this amount is not counted. Take the ${money(typedDue())} left another way (${t === 10 ? 'card, check, store credit or gift card' : 'cash, card, store credit or gift card'}).`; }
  function typed() { return payLines().reduce((a, [t]) => a + (onceDone(t) ? 0 : Number(amounts[t]) || 0), 0); }
  function typedDue() { return Math.max(0, round2(amountLeft() - typed())); }
  function updNums() {
    const left = amountLeft(), tp = typed(), cash = onceDone(10) ? 0 : Number(amounts[10]) || 0, other = tp - cash;
    if ($('payDue')) $('payDue').textContent = money(typedDue());
    if ($('payTend')) $('payTend').textContent = money((S.pay ? S.pay.paid : 0) + tp);
    if ($('chg')) $('chg').textContent = money(Math.max(0, round2(cash - Math.max(0, left - other))));
    const bal = $('payDue'); if (bal && bal.parentElement) bal.parentElement.classList.toggle('zero', typedDue() <= 0.004);
    if ($('payOk')) $('payOk').textContent = typedDue() <= 0.004 && tp > 0 ? 'Pay — finish sale' : tp > 0 ? 'Pay ' + money(tp) : 'Pay';
    if ($('cofChg')) $('cofChg').textContent = cofChgText();
    const om = onceMsg(), pm = $('payMsg'); if (pm && om) { msgIn(pm, { ok: false, message: om }); pm.dataset.once = '1'; } else if (pm && pm.dataset.once) { pm.dataset.once = ''; msgIn(pm, { ok: true, message: '' }); }
  }
  function move(to) { const ls = payLines(); hi = (to + ls.length) % ls.length; payKeep(); renderPay(); if (ls[hi][0] === 30 && !keyedOn()) msgIn($('payMsg'), { ok: false, message: MC_OFF }); if (ls[hi][0] === 50 && !S.member) msgIn($('payMsg'), { ok: false, message: CHK_OFF }); if (ls[hi][0] === 11) msgIn($('payMsg'), acctMsg()); }
  // Gift card amount (owner request G): the cashier may type how much to take from the card(s); never more than the
  // lower of the card balance and what is still owed. The tender itself is unchanged (pay-tender type 40 with that amount).
  function giftBal() { return round2(gift.reduce((a, c) => a + (Number(c.balance) || 0), 0)); }
  function giftCap() { return Math.max(0, Math.min(giftBal(), round2(amountLeft() - (typed() - (Number(amounts[40]) || 0))))); }
  function giftCapMsg() { return `Gift card can pay at most ${money(giftCap())} (card balance ${money(giftBal())}, still owed ${money(Math.max(0, round2(amountLeft() - (typed() - (Number(amounts[40]) || 0)))))}). To use another gift card too, press Check for it before paying: all cards go in one payment.`; } // mgc1011
  function keyedOn() { return !!(S.keyed && S.keyed.enabled); } // Manual Credit (keyed card, type 30): shown always, usable only when set up
  function payKeep() { payLines().forEach(([t]) => { const i = $(t === 10 ? 'cashIn' : 'pa-' + t); if (i) amounts[t] = i.value; }); if ($('gcNo')) extra.gcNo = $('gcNo').value; if ($('chkNo')) extra.chkNo = $('chkNo').value; if ($('mcNo')) { mc.no = $('mcNo').value; mc.exp = $('mcExp').value; mc.cvv = $('mcCvv').value; } }
  function wireLines() {
    const ls = payLines();
    $('payBody').querySelectorAll('.pline').forEach(row => row.onclick = e => { const i = +row.dataset.i; if (i !== hi) move(i); });
    ls.forEach(([t], i) => {
      const inp = $(t === 10 ? 'cashIn' : 'pa-' + t); if (!inp) return;
      inp.oninput = () => { amounts[t] = inp.value; if (t === 40 && gift.length && Number(inp.value) > giftCap() + 0.004) { amounts[40] = inp.value = giftCap().toFixed(2); msgIn($('payMsg'), { ok: false, message: giftCapMsg() }); } updNums(); };
      inp.onkeydown = e => {
        if (e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); let rest = Math.max(0, round2(amountLeft() - (typed() - (Number(amounts[t]) || 0)))); if (t === 40 && gift.length) rest = Math.min(rest, giftBal()); amounts[t] = rest ? rest.toFixed(2) : ''; inp.value = amounts[t]; updNums(); return; }
        if (e.key === 'Enter' && t === 40 && !gift.length && Number(inp.value) > 0) { // local.8 (Ari OK 8:29 PM Oct 31): gift amount typed but no card checked yet -> Enter only moves to the gift card box; nothing is paid
          e.preventDefault(); amounts[t] = inp.value; const gi = ls.findIndex(([x]) => x === 40); if (hi !== gi || !$('gcNo')) { hi = gi; payKeep(); renderPay(); }
          msgIn($('payMsg'), { ok: false, message: 'Scan the gift card, then Enter' }); return setTimeout(() => { const g = $('gcNo'); if (g) g.focus(); }, 0);
        }
        if (e.key === 'Enter' && t === 11 && acctOneEnter(e, inp)) return; // fix/account-sale-one-enter: ONE Enter on an empty Put on Account line takes the whole amount due, once
        if (e.key === 'Enter') { e.preventDefault(); amounts[t] = inp.value; if (PAY_ENTER_COMPLETES && typed() > 0 && typedDue() <= 0.004) return commit(); move(hi + 1); }
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { // 1.2.1: Up / Down = previous / next tender (stops at both ends); never pays or changes an amount
          e.preventDefault(); amounts[t] = inp.value; const to = Math.max(0, Math.min(ls.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
          if (to !== hi) { move(to); const r = $('payBody') && $('payBody').querySelector('.pline.on'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
        }
      };
      if (i === hi) setTimeout(() => { if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.pextra')) return; inp.focus(); inp.select(); }, 0);
    });
    if ($('gcAdd')) {
      $('gcAdd').onclick = async () => { if (onceDone(40)) { $('gcPw').value = ''; return msgIn($('payMsg'), { ok: false, message: 'A gift card payment is already taken on this sale. AIR POS keeps only one gift card payment per sale, so another card cannot be added now. Nothing was taken. Take the rest another way (cash, card, check or store credit).' }); } // mgc1011
        const pw = $('gcPw').value; $('gcPw').value = ''; const x = await api('gift-verify', { number: $('gcNo').value, secret: pw }); msgIn($('payMsg'), x);
        if (x.ok && !gift.some(g => g.id === x.card.id)) { gift.push(x.card); extra.gcNo = ''; const bal = gift.reduce((a, c) => a + c.balance, 0); if (!(Number(amounts[40]) > 0)) amounts[40] = Math.min(bal, Math.max(0, round2(amountLeft() - (typed() - (Number(amounts[40]) || 0))))).toFixed(2); else if (Number(amounts[40]) > giftCap()) amounts[40] = giftCap().toFixed(2); renderPay(); msgIn($('payMsg'), { ok: true, message: x.message + ` — type the amount to take (up to ${money(giftCap())}), then Enter. More than one gift card? Press Check for each one first: they all go in one payment.` }); setTimeout(() => { const a = $('pa-40'); if (a) { a.focus(); a.select(); } }, 0); } };
      $('gcNo').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('gcAdd').click(); } };
    }
    $('payBody').querySelectorAll('.quick button[data-v]').forEach(b => b.onclick = e => { e.stopPropagation(); const c = $('cashIn'); amounts[10] = b.dataset.v; if (c) { c.value = b.dataset.v; c.focus(); } updNums(); });
    $('payBody').querySelectorAll('.cofopt').forEach(o => o.onclick = e => { e.stopPropagation(); if (o.classList.contains('off')) return msgIn($('payMsg'), { ok: false, message: 'That card was saved under another payment channel and cannot be charged here' }); payKeep(); cof.pick = o.dataset.c; renderPay(); });
    if ($('chkNo')) $('chkNo').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); payKeep(); if (typed() > 0 && typedDue() <= 0.004) commit(); else move(hi + 1); } };
    updNums();
  }
  // Pay every line that has an amount: card / gift / check / store credit first (in list order), cash last so change is right.
  async function commit() {
    payKeep(); if (running) return msgIn($('payMsg'), { ok: true, message: 'Still sending the payment to AIR POS… one moment' });
    const left = amountLeft(), ls = payLines().filter(([t]) => Number(amounts[t]) > 0);
    if (!ls.length) return msgIn($('payMsg'), { ok: false, message: 'Type an amount on a line, or press + to put the whole amount due on it' });
    if (ls.some(([t]) => t === 30) && !keyedOn()) { amounts[30] = ''; hi = payLines().findIndex(([t]) => t === 30); renderPay(); return msgIn($('payMsg'), { ok: false, message: MC_OFF }); } // nothing is sent
    const other = ls.filter(([t]) => t !== 10).reduce((a, [t]) => a + Number(amounts[t]), 0);
    if (other > left + 0.004) return msgIn($('payMsg'), { ok: false, message: `Only cash can be more than the amount due (${money(left)})` });
    if (Number(amounts[11]) > 0 && !S.member) { amounts[11] = ''; hi = payLines().findIndex(([t]) => t === 11); renderPay(); return msgIn($('payMsg'), { ok: false, message: ACC_OFF }); } // nothing is sent
    if (Number(amounts[50]) > 0 && !S.member) { amounts[50] = ''; hi = payLines().findIndex(([t]) => t === 50); renderPay(); return msgIn($('payMsg'), { ok: false, message: CHK_OFF }); } // nothing is sent
    if (Number(amounts[40]) > 0 && gift.length && Number(amounts[40]) > giftCap() + 0.004) { amounts[40] = giftCap().toFixed(2); hi = payLines().findIndex(([t]) => t === 40); renderPay(); return msgIn($('payMsg'), { ok: false, message: giftCapMsg() }); } // nothing is sent
    if (Number(amounts[50]) > 0 && !String(extra.chkNo || '').trim()) { hi = payLines().findIndex(([t]) => t === 50); renderPay(); msgIn($('payMsg'), { ok: false, message: 'Type the check number, then Enter' }); return setTimeout(() => $('chkNo') && $('chkNo').focus(), 0); }
    if (Number(amounts[40]) > 0 && onceDone(40)) { hi = payLines().findIndex(([t]) => t === 40); renderPay(); return msgIn($('payMsg'), { ok: false, message: onceMsg() }); } // mgc1011: a 2nd gift card payment is never sent
    if (amounts[40] > 0 && !gift.length) { hi = payLines().findIndex(([t]) => t === 40); renderPay(); return msgIn($('payMsg'), { ok: false, message: 'Scan the gift card and press Check first' }); }
    queue = [...ls.filter(([t]) => t !== 10), ...ls.filter(([t]) => t === 10)].map(([t]) => t);
    return runQueue();
  }
  let stockOk = false;
  let paidAtCard = 0; // 1.0.11-local.1: paid before the card of a split was sent
  async function runQueue() {
    if (running || !queue.length) return; running = true; let cardOut = false; // 1.0.11-local.1: a card answered while this ran
    try {
      while (queue.length) {
        const t = queue.shift(), b = { type: t };
        if (t === 10) b.tendered = Number(amounts[t]) || 0; else b.amount = Number(amounts[t]) || 0;
        if (t === 50) b.checkNumber = extra.chkNo;
        if (t === 40) b.giftCards = gift;
        if (t === 30 && S.keyed && S.keyed.kind === 'sola' && !cofCur()) b.card = { cardNo: mc.no, expiration: mc.exp, cvv: mc.cvv };
        if (t === 30 && cofCur()) b.savedCardId = cofCur().id; // 1.0.9: charge the picked saved card (only its AIR POS id is sent)
        if (stockOk) b.stockOk = true; // AR-16: the cashier pressed "Take payment anyway" for a short-stock sale
        const ok = $('payOk'); if (ok) ok.disabled = true;
        const paid0 = (S.pay && S.pay.paid) || 0; // 1.0.11-local.1
        const x = await api('pay-tender', b); await refresh();
        if (t === 30 && b.card) b.card = null;
        if (x.completed) { queue = []; mc = { no: '', exp: '', cvv: '' }; stopPayTimer(); return doneDialog(x); }
        if (!x.ok && x.needStockOk) { // AR-16: warned BEFORE the card / gift card is charged; nothing was taken
          const rest = queue; queue = []; renderPay(); msgIn($('payMsg'), x); const m = $('payMsg'); // 1.0.10-local.2: keep the lines queued behind it (e.g. cash after the card)
          if (m) { const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pbtn r'; btn.id = 'payStockOk'; btn.style.marginTop = '6px'; btn.textContent = 'Take payment anyway'; btn.onclick = () => { stockOk = true; queue = [t, ...rest]; runQueue(); }; m.appendChild(document.createElement('br')); m.appendChild(btn); btn.scrollIntoView({ block: 'center' }); btn.focus(); }
          return; }
        if (!x.ok) { queue = []; renderPay(); msgIn($('payMsg'), x); return; }
        amounts[t] = ''; if (t === 40) gift = []; if (t === 30) { mc = { no: '', exp: '', cvv: '' }; cof.pick = ''; }
        if (x.keyed && x.clientSecret) { paidAtCard = paid0; keyed = { clientSecret: x.clientSecret }; renderPay(); return; } // Stripe form; the rest continues after
        if (x.waiting || (S.pay && S.pay.card)) { paidAtCard = paid0; cardOut = true; renderPay(); return; } // card terminal; the poll re-renders and resumes the queue
      }
      renderPay();
    } finally { running = false; if (cardOut && queue.length && S.pay && !S.pay.card && !keyed) renderPay(); } // 1.0.11-local.1: card approved before this ended (first poll): renderPay resumes the rest now; while it waits, the poll does
  }
  // Stripe Elements  // Stripe Elements: card fields are Stripe's own iframes; we only ever hold the Element objects.
  async function mountKeyed() {
    if (keyed.mounted) return;
    try {
      if (!keyed.stripe) {
        const k = await api('keyed-key'); if (!k.ok) throw new Error(k.message);
        await loadStripeJs(); keyed.stripe = window.Stripe(k.key); // key = publishable key from AIR POS (RetailReceiveChannelGet)
      }
      if (!$('kNum')) return;
      const el = keyed.stripe.elements(), style = { base: { fontSize: '18px', color: '#2c3e50' } };
      keyed.num = el.create('cardNumber', { style, showIcon: true }); keyed.num.mount('#kNum');
      el.create('cardExpiry', { style }).mount('#kExp'); el.create('cardCvc', { style }).mount('#kCvc');
      keyed.mounted = true; keyed.num.on('ready', () => keyed.num.focus());
      $('kCharge').onclick = chargeKeyed;
    } catch (e) { msgIn($('payMsg'), { ok: false, message: 'Could not load the secure card form (internet needed): ' + (e.message || e) }); }
  }
  async function chargeKeyed() {
    const b = $('kCharge'); if (!b || b.disabled) return; b.disabled = true; b.textContent = 'Charging…'; $('cardCancel').disabled = true; keyed.charging = true; // mny109d: Cancel and Esc stay off while Stripe is charging, even if the screen redraws
    let res; try { res = await keyed.stripe.confirmCardPayment(keyed.clientSecret, { payment_method: { card: keyed.num } }); } catch (e) { res = { error: { message: e.message || String(e) } }; }
    const st = res && res.paymentIntent && res.paymentIntent.status;
    if (res && !res.error && (st === 'requires_capture' || st === 'succeeded')) { // same success test as AIR POS
      keyed = null; await api('keyed-confirmed'); await refresh(); renderPay(); return;
    }
    const why = (res && res.error && res.error.message) || 'Card not accepted (' + (st || 'no status') + ')';
    if (res && res.error && ['validation_error'].includes(res.error.type)) { keyed.charging = false; b.disabled = false; b.textContent = 'Charge card'; $('cardCancel').disabled = false; return msgIn($('payMsg'), { ok: false, message: why }); } // typo in the form: let them fix it
    keyed = null; const x = await api('keyed-failed', { message: why }); await refresh(); renderPay(); msgIn($('payMsg'), x);
  }
  function startPayTimer() { if (payTimer) return; payTimer = setInterval(async () => { if (!$('payBody')) return stopPayTimer(); await refresh(); renderPay(); }, 700); }
  function stopPayTimer() { clearInterval(payTimer); payTimer = null; }
  A.__payItems = async () => { // side panel: a tap on the sale screen = back to items
    const p = S.pay; if (!$('payBody')) return;
    if ($('cardCancel') || (p && p.card)) return msgIn($('payMsg'), { ok: false, message: 'A card payment is open. Finish or cancel it first, then add items.' });
    if (!p || !(p.paid > 0)) { const b = $('payBack'); if (b) return b.click(); return; } // nothing paid: same as Back (unchanged)
    payKeep(); stopPayTimer(); payAside = true; closeModal(); // the payment stays open on the server; nothing is cancelled
    toast(`${money(p.paid)} paid is kept. Add items, then Payment (F12) for the rest.`, true);
  };
  // 1.2.3.1: way out of a paid-but-not-finished sale. Only closes this screen: nothing is cancelled, re-sent or re-totalled.
  function keepBack() { const p = S.pay; payKeep(); stopPayTimer(); payAside = true; closeModal(); refresh(); toast(`${money(p ? p.paid : 0)} paid is kept. Payment (F12) to finish the sale.`, true); }
  A.__payEsc = () => { if ($('cardCancel')) return $('cardCancel').click(); if ($('payKeepBack')) return keepBack(); if ($('payBack')) $('payBack').click(); };
  A.__payEnter = () => { if ($('cardRetry')) $('cardRetry').click(); else if ($('payFinish')) $('payFinish').click(); else if ($('kCharge')) $('kCharge').click(); };
}
function pointsDialog() {
  const m = S.member; const rate = m.pointExchangeRate / 100;
  const max = Math.min(Math.floor(m.points), Math.ceil(S.totals.orderAmount / rate));
  modal(`<h2>Use points</h2><p>${esc(m.name)} has <b>${m.points}</b> points. 1 point = ${money(rate)}. Max on this sale: ${max}.</p>
    <input class="f" id="ptIn" inputmode="numeric" value="${m.usingPoints || max}" autofocus><div id="ptMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="ptBack">Back</button><button class="pbtn g" id="ptOk">Apply (Enter)</button></div>`, () => {
    $('ptOk').onclick = async () => { const x = await api('points', { points: Number($('ptIn').value) || 0 }); await refresh(); if (x.ok) { toast(x.message, true); closeModal(); checkoutDialog(); } else msgIn($('ptMsg'), x); };
    $('ptBack').onclick = () => { closeModal(); checkoutDialog(); };
    $('ptIn').onkeydown = e => { if (e.key === 'Enter') $('ptOk').click(); };
  });
}
// worker 2 (1.2.0): done screen. The receipt already printed on the server when Settings > Printer & Drawer "Print receipt
// after every sale" says so (1.0.10-local.2: Always by default; or Follow AIR POS = checkoutAutoPrint; register.js autoPrintOn), so nothing prints twice. The change stays big on screen, Enter = next sale,
// P = print, and scanning the next item (a digit) closes this and starts the next sale at once.
// Owner requests K / L: small notes that fade by themselves. Never a popup, never takes focus, never blocks a tap.
function softNote(text, kind) {
  let box = $('softNotes'); if (!box) { box = document.createElement('div'); box.id = 'softNotes'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const d = document.createElement('div'); d.className = 'softnote ' + (kind || ''); d.textContent = text; box.appendChild(d);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.classList.add('fade'), 5000); setTimeout(() => d.remove(), 6000); return d;
}
// K: after an item is added, a read-only stock look-up; zero or negative stock shows "Out of stock (qty 0)". The item stays in the sale.
// 1.0.11-speed.1: the look-up can start together with the add (stockPeekStart) and is shown only once the add went in (stockPeekShow).
function stockPeekStart(code) { return (S.mode !== 'sale' || S.retOn) ? null : api('stock-note', { code }).catch(() => null); }
async function stockPeekShow(p) { const x = p && await p; if (x && x.ok && x.out) softNote(`${x.name ? x.name + ': ' : ''}${x.message}`, 'warn'); }
async function stockPeek(code) { return stockPeekShow(stockPeekStart(code)); }
// L: drawer / receipt run in the background after the sale. Watch for a failure for a while and show it as a soft note.
let hwSeen = 0, hwPollT = null;
function watchHw(ms = 45000) {
  const end = Date.now() + ms; clearInterval(hwPollT);
  hwPollT = setInterval(async () => {
    if (Date.now() > end) return clearInterval(hwPollT);
    const x = await api('hw-notes').catch(() => null);
    for (const n of (x && x.notes) || []) if (n.id > hwSeen) { hwSeen = n.id; softNote(n.message, 'err'); }
  }, 1200);
}
function doneDialog(r) {
  toast(''); scanOk(); // ls9: a message from this sale (e.g. "Candy is already on this sale") does not stay on the next, empty sale
  document.body.classList.remove('paying'); // the side panel is gone: the sale screen uses the full width again behind the done box
  if (r.hwPending && r.hwPending.length) watchHw();
  const hw = [r.drawer, r.print, r.giftReceipt].filter(Boolean).map(x => `<div class="${x.ok ? 'note' : 'banner'}">${esc(x.message)}</div>`).join('');
  const tl = (r.tenders || []).map(t => `<div class="due"><span>${esc(t.name)}</span><b>${money(t.receiveAmount && t.receiveAmount > t.amount ? t.receiveAmount : t.amount)}</b></div>`).join('');
  const gr = (r.hwPending || []).includes('gift') ? '<div class="note" id="doneGiftRcpt">Gift receipt: prints right after the receipt (if it can\'t, a small note says why).</div>' : '';
  const gc = (r.giftCards || []).length ? `<div class="note" id="doneGifts"><b>Gift cards activated (${r.giftCards.length}):</b> ${r.giftCards.map(c => esc(c.masked) + ' ' + money(c.value)).join(' · ')}</div>` : '';
  modal(`<h2>Sale complete</h2><div class="due"><span>Total</span><b>${money(r.due)}</b></div>${tl}${gc}${gr}
    <div class="due donechg"><span>Change due</span><span class="big" style="color:#1e7b34">${money(r.change)}</span></div>${hw}<div id="doneMsg" class="msg"></div>
    <p class="note">Enter = next sale · scan the next item to start right away · P = print again</p>
    <div class="row2"><button class="pbtn s" id="dDrawer">Open Drawer</button><button class="pbtn" id="dPrint">Print Receipt (P)</button><button class="pbtn g" id="dNew" autofocus>New Sale (Enter)</button></div>`, () => {
    let gone = false;
    // 1.0.10-local.2 (Ari 12:17): ONE Enter to the next sale from anywhere on this screen (also after Open Drawer was tapped or focus
    // left the window). A failure shown here (print / drawer) comes along as a small fading note on the next sale, not a popup.
    const fails = () => [...document.querySelectorAll('#modalRoot .banner, #doneMsg.err')].map(e => e.textContent.trim()).filter(Boolean);
    const onDoc = e => { if (!$('dNew')) return document.removeEventListener('keydown', onDoc, true); if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return; e.preventDefault(); e.stopPropagation(); next(); };
    const next = async () => { if (gone) return; gone = true; document.removeEventListener('keydown', onDoc, true); const f = fails(); closeModal(); api('dismiss').then(() => refresh()); focusScan(); f.forEach(t => { if (![...document.querySelectorAll('#softNotes .softnote')].some(d => d.textContent === t)) softNote(t, 'warn'); }); };
    document.addEventListener('keydown', onDoc, true);
    setTimeout(() => { const a = document.activeElement; if (!gone && $('dNew') && (!a || a === document.body || !a.closest('#modalRoot'))) $('dNew').focus(); }, 0); // card poll: make sure the box has the focus
    // 1.2.0: after a manual print, go straight back to a new sale (no Esc needed). If printing fails the box stays with the reason.
    $('dPrint').onclick = () => printOrder(r.orderId, $('doneMsg'), async x => { gone = true; await api('dismiss'); closeModal(); await refresh(); focusScan(); }); // printed: straight to the next sale, nothing shown
    $('dDrawer').onclick = async () => { msgIn($('doneMsg'), { ok: true, message: 'Opening drawer…' }); const x = await api('drawer-sale'); msgIn($('doneMsg'), x.needPassword ? { ok: false, message: 'Close this window and press Open Drawer (Ctrl+D) to open with a password.' } : x); };
    $('dNew').onclick = next;
    const box = $('dNew').closest('.modal') || $('modalRoot');
    box.addEventListener('keydown', e => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); return $('dPrint').click(); }
      if (/^[0-9]$/.test(e.key) && !gone) { // a scanner (or the cashier) is already on the next item
        e.preventDefault(); e.stopPropagation(); next(); const si = $('scanInput'); if (si) { si.value = e.key; si.focus(); }
      }
    });
  });
}
// Customer (member): look up by number/phone, search, add new, remove from sale
function memberDialog() {
  const m = S.member;
  modal(`<h2>Customer</h2>${m ? `<div class="cardbox"><b>${esc(m.name)}</b> · ${esc(m.number)}<div class="note">Points ${m.points}${Math.round((Number(m.availableBalance) || 0) * 100) ? ' · Store credit ' + money(m.availableBalance) : ''}${m.allowCreditPayment ? ' (+ limit ' + money(m.creditAmount) + ')' : ''}</div></div>` : ''}
    <label class="f">Customer number, phone or name</label><div style="display:flex;gap:6px"><input class="f" id="mQ" autofocus><button class="pbtn" id="mGo">Find</button></div>
    <div id="mRes" style="max-height:38vh;overflow:auto;margin-top:6px"></div><div id="mMsg" class="msg"></div>
    <div class="row2">${m ? '<button class="pbtn r" id="mDel">Remove from sale</button>' : ''}<button class="pbtn s" id="mNew">New customer…</button><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    const go = async () => {
      const q = $('mQ').value.trim(); if (!q) return;
      const x = await api('member-attach', { number: q });
      if (x.ok) { toast(x.message, true); closeModal(); return refresh(); }
      const f = await api('member-find', { keyword: q });
      $('mRes').innerHTML = (f.rows || []).length ? `<table><tbody>${f.rows.map(r => `<tr class="row" data-n="${esc(r.number)}"><td>${esc(r.name)}</td><td>${esc(r.number)}</td><td>${esc(r.mobile || '')}</td></tr>`).join('')}</tbody></table>` : '';
      $('mRes').querySelectorAll('tr').forEach(tr => tr.onclick = async () => { const y = await api('member-attach', { number: tr.dataset.n }); if (y.ok) { toast(y.message, true); closeModal(); refresh(); } else msgIn($('mMsg'), y); });
      msgIn($('mMsg'), { ok: false, message: (f.rows || []).length ? 'Pick a customer' : 'No customer found. Use "New customer" to add one.' });
    };
    $('mGo').onclick = go; $('mQ').onkeydown = e => { if (e.key === 'Enter') go(); };
    if ($('mDel')) $('mDel').onclick = async () => { await act('member-detach'); closeModal(); };
    $('mNew').onclick = () => newMemberDialog($('mQ').value.trim());
  });
}
function newMemberDialog(pre) {
  const phone = /^[\d\s()+-]+$/.test(pre || '') ? pre : '';
  modal(`<h2>New customer</h2><label class="f">Phone (becomes the customer number) *</label><input class="f" id="nmPhone" value="${esc(phone)}" autofocus>
    <div style="display:flex;gap:8px"><div style="flex:1"><label class="f">First name *</label><input class="f" id="nmFirst"></div><div style="flex:1"><label class="f">Last name *</label><input class="f" id="nmLast"></div></div>
    <label class="f">Email</label><input class="f" id="nmEmail"><div id="nmMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel</button><button class="pbtn s" id="nmOpen" style="display:none">Open existing customer</button><button class="pbtn g" id="nmOk">Add and use (Enter)</button></div>`, () => {
    let existing = null; $('nmOpen').onclick = () => existing && window.customerView && customerView(existing.id); // request M: phone already used -> offer that customer
    $('nmOk').onclick = async () => { const x = await api('member-add', { mobile: $('nmPhone').value, firstName: $('nmFirst').value, lastName: $('nmLast').value, email: $('nmEmail').value });
      existing = x.duplicate && x.existing ? x.existing : null; $('nmOpen').style.display = existing ? '' : 'none'; if (existing) $('nmOpen').textContent = `Open existing customer: ${existing.name || existing.number}`;
      if (x.ok) { toast(x.message, true); closeModal(); refresh(); } else msgIn($('nmMsg'), x); };
    $('modalRoot').querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('nmOk').click(); });
  });
}
// Store request #18 (Nov 2): while an order discount (F6) is on, every item line shows it in green with the %, not only the Discount total.
// Display only: AIR POS applies the order discount as ONE % over all lines (register.js recalc: od = orderDiscount% x items; a $ discount is
// turned into its effective %), so each line's share is that same % of its line total. Nothing is sent, saved or added to a total here.
function orderDiscTag(r) {
  const pct = Number(S.order && S.order.orderDiscount); if (!(pct > 0) || !(Number(r.total) > 0)) return '';
  const p = String(Math.round(Math.min(pct, 100) * 100) / 100), amt = Math.round(Number(r.total) * pct) / 100;
  return `<div class="odisc" title="Order discount ${esc(p)}% of this line: about ${esc(money(amt))} off">−${esc(p)}% order</div>`;
}
// AirMax Step 0b C1 (Batch 11): the Discount cell shows what the line got. Display only: nothing here is sent, saved or added to a total.
// Own discount (F4 %, F4 $, New price, customer type): "−$x" with " (n%)" when a percent is known (before: only for F4) and the discount's name when it has one.
// Sale / Multi-buy / promo code (green, same green as the line under the name): the name AIR POS gave it and its amount. S.lineDisc[i] comes from the
// server (app/linedisc.js), same order as S.cart[i]; the promotion amount is PROVISIONAL (a split of the sale-level promotion total), see linedisc.js.
function discCell(r, i) {
  const d = (S.lineDisc || [])[i] || {}, own = Number(r.discountAmount) || 0, pa = Number(d.promoAmount) || 0, parts = [], plain = [];
  if (own) { const t = (d.name ? d.name + ' ' : '') + '−' + money(r.discountAmount) + (r.discount ? ` (${r.discount}%)` : ''); parts.push(`<span class="dx">${esc(t)}</span>`); plain.push(t); }
  if (d.promoName) { parts.push(`<span class="promo pn">${esc(d.promoName)}</span>`); plain.push(d.promoName); }
  if (pa > 0) { parts.push(`<span class="promo pa">${esc('−' + money(pa))}</span>`); plain.push('−' + money(pa)); }
  // .dc adds NO width to the column: when the text is too long for the column the NAME gets "…" first (the dollars stay whole) and the full text is the
  // tooltip. The column is sized, as in 1.0.11, by the line's own "−$x" (+ "(n%)" for F4) only: .dsz holds exactly that old text, invisible and zero
  // high, so every column stays where it is today.
  const sz = own ? '−' + money(r.discountAmount) + (r.custom && r.discount ? ` (${r.discount}%)` : '') : '';
  return parts.length ? `${sz ? `<div class="dsz" aria-hidden="true">${esc(sz)}</div>` : ''}<div class="dc" title="${esc(plain.join(' '))}">${parts.join(' ')}</div>` : '';
}
// Batch 11 (Gordon, Nov 3): Qty and Price edited right in the cell. A click turns the cell into a number box with the value selected; Enter applies it through the
// SAME calls as the windows: Qty = act('qty') like qtyDialog, Price = price-approve (+ the manager login for a cashier, never for a logged-in manager) then
// price-change like lineDialog's New price (this sale only, only lower: the server refuses a higher price with the window's own message). Esc, a click away or a
// change of the sale cancels; a value that is not a number puts the old one back. Not while paying, not in return mode. A scanner typing into the box
// (fast keys + Enter) is not taken as a value: the code goes to the scan box as usual.
let cellEd = null;
function cellEditEnd() { const c = cellEd; cellEd = null; if (c && c.td.isConnected) { c.td.classList.remove('cedon'); const b = c.td.querySelector(':scope > input.ced'); if (b) b.remove(); } return c; } // the cell's own text was never touched, so nothing to put back
async function cellEditStart(row, kind) {
  if (cellEd) cellEditEnd();
  if (S.mode === 'return' || modalOpen() || busy) return;
  if (S.pay) return toast('Close the payment first', false);
  selectedRow = row; await refresh(); if (S.pay || S.mode === 'return' || !S.cart[row]) return;
  if (kind !== 'price') return cellEditOpen(row, kind, null);
  const r = await api('price-approve', {});
  if (r && r.ok) return cellEditOpen(row, kind, null);
  if (r && r.needManager) return managerLogin('Price Change', 'A manager must approve a price change for this sale.', async m => {
    const x = await api('price-approve', m); if (!x.ok) return x;
    closeModal(); cellEditOpen(row, kind, { user: m.user, password: m.password }); return null;
  });
  toast((r && r.message) || 'Price Change not available', false);
}
function cellEditOpen(row, kind, mgr) {
  const l = S.cart[row], lineId = lid(row), td = document.querySelector(`#cart tr.row[data-row="${row}"] td[data-c="${kind}"]`); if (!l || !td || S.pay || S.mode === 'return') return;
  const v0 = kind === 'qty' ? String(l.quantity) : (Number(l.price) || 0).toFixed(2);
  cellEd = { row, kind, td, html: td.innerHTML }; const me = cellEd;
  td.classList.add('cedon'); td.insertAdjacentHTML('beforeend', `<input class="ced" size="1" inputmode="decimal" autocomplete="off" value="${esc(v0)}" aria-label="${kind === 'qty' ? 'Quantity' : 'New price each'}">`); // laid over the cell's text (kept, hidden) so no column or row moves
  const box = td.querySelector('input'), keys = []; box.focus(); box.select();
  let cred = mgr || null; mgr = null; // manager login: for this one price-change only, never logged
  const done = () => { cred = null; if (cellEd === me) cellEditEnd(); };
  const drop = () => { cred = null; };
  box.addEventListener('blur', () => setTimeout(() => { if (cellEd === me && document.activeElement !== box) { drop(); done(); } }, 0));
  box.addEventListener('keydown', async e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); drop(); done(); focusScan(); return; }
    if (e.key.length === 1) keys.push(Date.now());
    if (e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation(); const v = box.value.trim();
    const fast = keys.length >= 4 && keys.slice(1).every((t, i) => t - keys[i] < 50) && Date.now() - keys[keys.length - 1] < 150;
    if (fast) { done(); focusScan(); window.queueScan(v); return; } // a scanner, not a person: scan the code as usual
    const n = Number(v);
    if (v === '' || !Number.isFinite(n) || n < 0 || (kind === 'qty' && n <= 0)) { done(); focusScan(); return toast(kind === 'qty' ? 'Not a quantity: nothing changed' : 'Not a price: nothing changed', false); }
    if (v === v0 || n === Number(v0)) { done(); focusScan(); return; }
    const once = cred; drop(); done(); focusScan();
    if (kind === 'qty') { await act('qty', { row, lineId, qty: n }); return; } // same call as the Quantity window (act shows AIR POS's message)
    const x = await api('price-change', { row, lineId, value: v, ...(once || {}) }); // same call as the Price Change window's New price
    toast(x.message, !!x.ok); refresh();
  });
}
// Store request #21: the note saved on the customer's account shows as soon as the customer is on the sale (once per attach; Enter or Esc closes it).
// The text comes from AIR POS (read only) and goes through esc(); the sale stays as it is behind the window.
let noteShownFor = null;
function customerNoteAlert() {
  if (!S.member || S.mode === 'return') { noteShownFor = null; return; }
  const n = S.memberNote; if (!n || n.id !== S.member.id || noteShownFor === n.id) return;
  if (!n.ready) { clearTimeout(customerNoteAlert.t); if ((customerNoteAlert.tries = (customerNoteAlert.tries || 0) + 1) <= 12) customerNoteAlert.t = setTimeout(() => { if (!busy) refresh().catch(() => {}); }, 400); return; } // look-up still running: look again in a moment
  customerNoteAlert.tries = 0; if (!n.remark || modalOpen() || S.pay) return;
  noteShownFor = n.id;
  modal(`<h2>Customer note</h2><p><b>${esc(S.member.name)}</b></p><div class="note custnote" id="cnText" style="white-space:pre-wrap;font-size:18px;margin:10px 0;padding:10px;border:2px solid #b8860b;background:#fff8e1;color:#333">${esc(n.remark)}</div>
    <div class="row2"><button class="pbtn g" id="cnOk" data-close>OK (Enter)</button></div>`, () => {
    $('cnOk').focus(); $('modalRoot').querySelector('.modal').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closeModal(); } });
  });
}
// Selected line: discount (% or $), tax rate
// Store request #23/#6 (Gordon Nov 3): Price Change is manager-only. A manager opens the window at once; a cashier gets the manager login first (same dialog as Tax Off).
async function priceChangeButton() {
  if (S.mode === 'return') return toast('Not in return mode', false);
  if (!S.cart[selectedRow ?? 0]) return toast('Select a line first', false);
  const r = await api('price-approve', {});
  if (r && r.ok) return lineDialog('price');
  if (r && r.needManager) return managerLogin('Price Change', 'A manager must approve a price change for this sale.', async m => {
    const x = await api('price-approve', m); if (!x.ok) return x;
    closeModal(); lineDialog('price', { user: m.user, password: m.password }); return null;
  });
  toast((r && r.message) || 'Price Change not available', false);
}
function lineDialog(startKind, mgr) { // startKind 'price' = the left-column Price Change button (store request #23): opens on New price
  const row = selectedRow ?? 0, l = S.cart[row], lineId = lid(row); if (!l) return toast('Select a line first', false);
  // 1.0.11-local.3: a line that already has its own discount opens on that discount (to change or remove it); New price = original - new, sent as $ off
  const k0 = startKind === 'price' ? 'price' : l.custom && l.dm === 20 ? 'amount' : 'percent', v0 = l.custom && k0 !== 'price' ? String(k0 === 'amount' ? l.discountAmount : l.discount) : '';
  const ph = { percent: 'e.g. 10', amount: 'e.g. 2.50 off this line', price: `new price each, at most ${money(l.price)}` };
  const hint = { percent: '', amount: '', price: `Original price ${money(l.price)} each. The difference is the discount; the item price in AIR POS is not changed.` };
  modal(`<h2>Item discount</h2><p><b>${esc(l.name)}</b> · ${l.quantity} × ${money(l.price)} = ${money(l.price * l.quantity)}${l.discountAmount ? ` · now ${money(l.discountAmount)} off` : ''}</p>
    <div class="tabs"><button class="tab${k0 === 'percent' ? ' on' : ''}" data-k="percent">% off</button><button class="tab${k0 === 'amount' ? ' on' : ''}" data-k="amount">$ off</button><button class="tab${k0 === 'price' ? ' on' : ''}" data-k="price">New price</button></div>
    <input class="f" id="ldVal" inputmode="decimal" value="${v0}" placeholder="${ph[k0]}" autofocus>
    <p class="note" id="ldHint"></p>
    <label class="f">Tax rate % for this line</label><input class="f" id="ldTax" inputmode="decimal" value="${l.taxRate ?? ''}">
    <div id="ldMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel</button>${l.custom ? '<button class="pbtn r" id="ldClr">Remove item discount</button>' : ''}<button class="pbtn g" id="ldOk">Apply (Enter)</button></div>`, () => {
    let kind = k0; $('ldHint').textContent = hint[kind];
    $('modalRoot').querySelectorAll('.tab').forEach(b => b.onclick = () => { if (b.dataset.k !== kind) $('ldVal').value = b.dataset.k === k0 ? v0 : ''; kind = b.dataset.k; $('modalRoot').querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b)); $('ldVal').placeholder = ph[kind]; $('ldHint').textContent = hint[kind]; $('ldVal').focus(); });
    if (v0) $('ldVal').select();
    $('ldOk').onclick = async () => {
      const v = $('ldVal').value.trim(), t = $('ldTax').value.trim();
      if (v && !(kind === k0 && v === v0)) { const x = startKind === 'price' && kind === 'price' ? await api('price-change', { row, lineId, value: v, ...(mgr || {}) }) : await api('line-discount', { row, lineId, kind, value: kind === 'price' ? v : Number(v) }); if (!x.ok) return msgIn($('ldMsg'), x); toast(x.message, true); } // Price Change button: manager-only (server checks again)
      if (t !== '' && Number(t) !== l.taxRate) { const y = await api('line-tax', { row, lineId, rate: Number(t) }); if (!y.ok) return msgIn($('ldMsg'), y); }
      closeModal(); refresh();
    };
    if ($('ldClr')) $('ldClr').onclick = async () => { await act('line-discount', { row, kind: 'clear' }); closeModal(); };
    $('modalRoot').querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('ldOk').click(); });
  });
}
function tempItemDialog() { // Temporary Item (was "Open Item", Ari 11:05 PM Oct 31): price (and an optional name, default "Item"); Enter adds it. AIR POS temporary item (type 10).
  modal(`<h2>Temporary Item</h2><label class="f">Price</label><input class="f" id="tiPrice" inputmode="decimal" autocomplete="off" autofocus>
    <label class="f">Name</label><input class="f" id="tiName" placeholder="Item" autocomplete="off">
    <label class="f chk"><input type="checkbox" id="tiTax" checked> Taxable <small id="tiTaxInfo"></small></label><div id="tiMsg" class="msg"></div>
    <div class="row2"><button class="pbtn g" id="tiOk">Add (Enter)</button></div>`, () => {
    let busy = false;
    // 1.0.11-local.8 (Ari OK 6:26 PM ET Nov 1): Taxable, on by default = the store's sales tax from AIR POS; off = no tax. Tax Off (F5) still wins.
    api('temp-tax').then(t => { const el = $('tiTaxInfo'); if (!el || !t) return; el.textContent = t.taxOff ? '(Tax Off is on for this sale: no tax)' : t.kind ? `(${t.kind.name} ${t.kind.rate}%)` : t.error ? `(${t.error})` : ''; });
    $('tiOk').onclick = async () => { if (busy) return; busy = true; const x = await api('temp-item', { name: $('tiName').value, price: Number($('tiPrice').value), quantity: 1, taxable: $('tiTax').checked }); busy = false; if (x.ok) { closeModal(); refresh(); } else msgIn($('tiMsg'), x); };
    $('modalRoot').querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('tiOk').click(); } });
  });
}
function extraChargeDialog() {
  const list = S.extraCharges || []; if (!list.length) return toast('No extra charges are set up (AIR POS back office → settings → extra charge)', false);
  modal(`<h2>Extra charge</h2><label class="f">Charge</label><select class="f" id="ecId">${list.map(x => `<option value="${esc(x.id)}" data-a="${x.defaultAmount || ''}">${esc(x.name)}</option>`).join('')}</select>
    <label class="f">Amount</label><input class="f" id="ecAmt" inputmode="decimal" value="${list[0].defaultAmount || ''}" autofocus><div id="ecMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel</button><button class="pbtn g" id="ecOk">Add (Enter)</button></div>`, () => {
    $('ecId').onchange = () => { $('ecAmt').value = $('ecId').selectedOptions[0].dataset.a; };
    $('ecOk').onclick = async () => { const x = await api('extra-charge', { chargeItemId: $('ecId').value, price: Number($('ecAmt').value) }); if (x.ok) { toast(x.message, true); closeModal(); refresh(); } else msgIn($('ecMsg'), x); };
    $('ecAmt').onkeydown = e => { if (e.key === 'Enter') $('ecOk').click(); };
  });
}
// End of day: X report (any time), Z report (closes the day), cash pay-in / pay-out
async function eodDialog() {
  const [x, z, dl] = await Promise.all([api('x-report'), api('z-list'), api('drawer-log')]);
  const r = x.report || {}, f = (l, v) => `<div class="due"><span>${l}</span><b>${v}</b></div>`;
  const when = t => t ? new Date(t).toLocaleString('en-US') : '';
  modal(`<h2>End of day</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
    <div><h3 style="margin:0">X report (now)</h3>${x.ok ? f('Gross sales', money(r.grossAmount)) + f('Net sales', money(r.amount)) + f('Returns', money(r.returnAmount)) : `<div class="banner">${esc(x.message)}</div>`}
      <div class="row2" style="justify-content:flex-start"><button class="pbtn s" id="xPrev">Preview</button><button class="pbtn" id="xPrint">Print X</button></div>
      <h3 style="margin:16px 0 0">Cash</h3><div class="row2" style="justify-content:flex-start"><button class="pbtn s" id="cIn">Pay in…</button><button class="pbtn s" id="cOut">Pay out…</button><button class="pbtn s" id="cOutClk">Clock out…</button></div>
      <h3 style="margin:16px 0 0">Drawer opens today (this PC)</h3><div class="note" style="margin:2px 0">${(dl.rows || []).filter(d => d.ok).length} opens, ${dl.noSale || 0} without a sale</div>
      <div style="max-height:18vh;overflow:auto" id="eodDrawer"><table class="mini"><tbody>${(dl.rows || []).slice(0, 50).map(d => `<tr><td>${new Date(d.at).toLocaleTimeString('en-US')}</td><td>${esc(d.user)}</td><td>${esc(d.reason)}</td><td class="${d.ok ? 'st-done' : 'st-declined'}">${d.ok ? 'opened' : 'failed'}</td></tr>`).join('') || '<tr><td class="note">None yet</td></tr>'}</tbody></table></div></div>
    <div><h3 style="margin:0">Z reports</h3><div style="max-height:34vh;overflow:auto"><table class="mini"><tbody>${(z.rows || []).map(row => `<tr><td>${esc(row.number)}<div class="note" style="margin:0">${when(row.time)}</div></td><td class="n">${money(row.net)}</td><td><button class="pbtn s" data-zp="${esc(row.id)}">View</button> <button class="pbtn" data-zr="${esc(row.id)}">Print</button></td></tr>`).join('') || '<tr><td class="empty" style="padding:20px">No Z reports yet</td></tr>'}</tbody></table></div>
      <div class="row2" style="justify-content:flex-start"><button class="pbtn r" id="zGen">Run Z (close the day)…</button></div></div></div>
    <div id="eMsg" class="msg"></div><div class="row2"><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    const prev = async (kind, id) => { msgIn($('eMsg'), { ok: true, message: 'Loading…' }); const p = await api('report-preview', { kind, id }); if (!p.ok) return msgIn($('eMsg'), p); msgIn($('eMsg'), { ok: true, message: '' }); pdfView(p.url, kind === 'z' ? 'Z report' : 'X report', () => eodDialog()); };
    const prn = async (kind, id) => { msgIn($('eMsg'), { ok: true, message: 'Printing…' }); msgIn($('eMsg'), await api('report-print', { kind, id })); };
    $('xPrev').onclick = () => prev('x'); $('xPrint').onclick = () => prn('x');
    $('modalRoot').querySelectorAll('[data-zp]').forEach(b => b.onclick = () => prev('z', b.dataset.zp));
    $('modalRoot').querySelectorAll('[data-zr]').forEach(b => b.onclick = () => prn('z', b.dataset.zr));
    $('zGen').onclick = async () => { if (!confirm('Run the Z report now? This closes the sales day for this register.')) return; const g = await api('z-generate'); msgIn($('eMsg'), g); if (g.ok) setTimeout(eodDialog, 700); };
    $('cIn').onclick = () => cashDialog('in'); $('cOut').onclick = () => cashDialog('out'); $('cOutClk').onclick = () => clockOutDialog();
  });
}
function pdfView(url, title, back) {
  modal(`<h2>${esc(title)}</h2><iframe src="${esc(url)}" style="width:min(900px,86vw);height:70vh;border:1px solid #ccd"></iframe><div class="row2"><button class="pbtn s" id="pvBack">Back (Esc)</button></div>`, () => { $('pvBack').onclick = () => back ? back() : closeModal(); });
}
async function cashChooser() { // Ctrl+K: pick Pay In or Pay Out (I / O keys, or click)
  const b = await api('drawer-balance');
  modal(`<h2>Cash in / out</h2><p class="note">Cash in drawer now: ${money(b.balance)}</p>
    <div class="row2"><button class="pbtn g" id="ccIn">Pay In (I)<br><small>add cash to drawer</small></button><button class="pbtn r" id="ccOut">Pay Out (O)<br><small>take cash from drawer</small></button></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel (Esc)</button></div>`, () => {
    $('ccIn').onclick = () => cashDialog('in'); $('ccOut').onclick = () => cashDialog('out');
    const kh = e => { if (!$('ccIn')) return document.removeEventListener('keydown', kh, true); const k = e.key.toLowerCase(); if (k === 'i' || k === 'o') { e.preventDefault(); e.stopPropagation(); document.removeEventListener('keydown', kh, true); cashDialog(k === 'i' ? 'in' : 'out'); } };
    document.addEventListener('keydown', kh, true); setTimeout(() => $('ccIn') && $('ccIn').focus(), 0);
  });
}
async function cashDialog(kind) {
  const b = await api('drawer-balance');
  modal(`<h2>${kind === 'in' ? 'Pay in (add cash to drawer)' : 'Pay out (take cash from drawer)'}</h2><p class="note">Cash in drawer now: ${money(b.balance)}</p>
    <label class="f">Amount</label><input class="f" id="cmAmt" inputmode="decimal" autofocus><label class="f">Reason</label><input class="f" id="cmRem" placeholder="e.g. change for the day, bought supplies">
    <div id="cmMsg" class="msg"></div><div class="row2"><button class="pbtn s" id="cmBack">Back</button><button class="pbtn g" id="cmOk">${kind === 'in' ? 'Pay in' : 'Pay out'} (Enter)</button></div>`, () => {
    $('cmOk').onclick = async () => { $('cmOk').disabled = true; const x = await api('cash-move', { kind, amount: Number($('cmAmt').value), remark: $('cmRem').value }); $('cmOk').disabled = false; if (x.ok) { toast(x.message, true); closeModal(); } else msgIn($('cmMsg'), x); };
    $('cmBack').onclick = () => cashChooser();
    $('modalRoot').querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') $('cmOk').click(); });
  });
}
async function settingsDialog() {
  const p = await api('printers'), st = S.settings || {};
  const ps = { printerType: 'auto', printerConn: 'windows', printerHost: '', printerPort: 9100, serialPort: '', serialBaud: 9600, printMethod: 'auto', printerCols: 48, printerCut: true, drawerPin: 2, codePage: 'pc437', imageMode: 'gsv0', printDarkness: 'normal', ...st, ...(p.printer || {}) };
  const det = p.details || [], typeName = { epson: 'Epson', star: 'Star', generic: 'Generic ESC/POS' };
  const tOf = n => { const d = det.find(x => x.name === n); return d ? ' (' + (d.virtual ? 'virtual, skipped by Automatic' : d.receipt ? typeName[d.type] + ' receipt' : 'office / other: prints through its Windows driver') + (d.isDefault ? ', Windows default' : '') + (d.workOffline ? ', set to offline' : d.problem ? ', ' + d.problem : '') + ')' : ''; };
  const opts = [''].concat(p.printers || []);
  const sel = (id, list, v) => `<select class="f" id="${id}">${list.map(([k, t]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const ports = (p.ports || []).map(x => [x.port, x.port + (x.epsonVirtual ? ' (Epson TM Virtual Port)' : x.device ? ' (' + x.device.replace(/^\\Device\\/, '') + ')' : '')]);
  if (ps.serialPort && !ports.some(x => x[0] === ps.serialPort)) ports.push([ps.serialPort, ps.serialPort + ' (not found)']);
  modal(`<h2>Printer &amp; cash drawer</h2>
    <label class="f">Connection</label>${sel('seCn', [['windows', 'Windows printer (USB, installed in Windows)'], ['network', 'Network printer (IP address, port 9100)'], ['serial', 'COM port / Epson TM Virtual Port']], ps.printerConn)}
    <div id="seWin"><label class="f">Receipt printer</label><select class="f" id="seP">${opts.map(n => `<option value="${esc(n)}" ${n === st.printerName ? 'selected' : ''}>${n ? esc(n + tOf(n)) : 'Automatic' + (p.resolved ? ' (' + esc(p.resolved) + ')' : ' (receipt printer or Windows default)')}</option>`).join('')}
      ${st.printerName && !opts.includes(st.printerName) ? `<option selected value="${esc(st.printerName)}">${esc(st.printerName)} (not found)</option>` : ''}</select>
      ${(p.printers || []).length ? (p.reason ? `<p class="note" id="seWhy">Automatic pick: ${esc(p.resolved || '')} — ${esc(p.reason)}${p.method ? ' · prints ' + (p.method === 'driver' ? 'through the Windows driver' : 'direct (ESC/POS)') : ''}</p>` : '') : `<p class="note keep">${esc(p.message || 'No printers found on this PC.')}</p>`}</div>
    <div id="seNet"><label class="f">Printer IP address and port</label><div style="display:flex;gap:8px"><input class="f" id="seIP" placeholder="192.168.1.50" value="${esc(ps.printerHost)}" style="flex:3"><input class="f" id="sePort" type="number" value="${esc(ps.printerPort)}" style="flex:1"></div></div>
    <div id="seSer"><label class="f">Port</label>${ports.length ? sel('seCom', ports, ps.serialPort) : '<input class="f" id="seCom" placeholder="COM3" value="' + esc(ps.serialPort) + '">'}
      <label class="f">Speed (baud)</label>${sel('seBd', [9600, 19200, 38400, 57600, 115200].map(x => [x, x]), ps.serialBaud)}</div>
    <label class="f">Printer type</label>${sel('seT', [['auto', 'Auto (pick from the printer name)'], ['epson', 'Epson (TM-T20II / M267D, other TM)'], ['generic', 'Generic ESC/POS (M804, POS-80, Xprinter...)'], ['star', 'Star (TSP100 / TSP143)']], ps.printerType)}
    <p class="note" id="seDet">${p.detected ? 'Using: ' + esc(p.detected.label) + (p.detected.auto ? ' (picked automatically)' : '') : ''}</p>
    <div id="seGen"><label class="f">Characters per line</label>${sel('seCols', [[48, '48 (80 mm paper, normal)'], [42, '42 (80 mm, wider margins)'], [32, '32 (58 mm paper)']], ps.printerCols)}
      <label class="f">Paper cutter</label>${sel('seCut', [['1', 'Cut the paper after each receipt'], ['0', 'No cutter (tear off)']], ps.printerCut === false ? '0' : '1')}
      <label class="f">Code page (accents, €)</label>${sel('seCP', [['pc437', 'PC437 (USA, default)'], ['pc850', 'PC850 (Latin)'], ['pc858', 'PC858 (Latin + €)'], ['wpc1252', 'Windows-1252']], ps.codePage)}
      <label class="f">Picture command</label>${sel('seImg', [['gsv0', 'GS v 0 (most printers)'], ['escstar', 'ESC * (older printers that print garbage)']], ps.imageMode)}</div>
    <label class="f">Cash drawer</label>${sel('seDP', [[2, 'Drawer 1 (pin 2, normal)'], [5, 'Drawer 2 (pin 5)']], ps.drawerPin)}
    <label class="f">Open drawer after a sale</label>${sel('seC', [['cash', 'When cash or a check was taken (normal)'], ['every', 'After every sale'], ['airpos', 'Follow the AIR POS terminal setting'], ['off', 'Never (Open Drawer button only)']], st.drawerAutoOpen || 'cash')}
    <label class="f">Print receipt after every sale</label>${sel('seAP', [['always', 'Always (recommended)'], ['airpos', 'Follow the AIR POS terminal setting'], ['never', 'Never (Print Receipt / Reprint only)']], st.receiptAutoPrint || 'always')}
    <label class="f">Print receipt after every return</label>${sel('seAPR', [['always', 'Always (recommended)'], ['airpos', 'Follow the AIR POS terminal setting'], ['never', 'Never (reprint from History only)']], st.returnReceiptAutoPrint || 'always')}
    <label class="f chk" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="seSW" style="width:20px;height:20px" ${st.stockWarn === true ? 'checked' : ''}> Warn before selling below zero stock</label>
    <p class="note" id="seSWnote">Off (default): payment opens straight away, even when AIR POS shows 0 in stock. On: a card or gift card on a short-stock sale first shows "Check first" and Take payment anyway (Alt+T). Either way a card is never charged twice; if AIR POS refuses to finish, the payment is kept and Finish sale retries it.</p>
    <label class="f">Drawer wait (seconds)</label><input class="f" id="seDW" type="number" min="1" max="30" step="1" value="${esc(st.drawerWaitSec || 5)}">
    <p class="note" style="margin-top:2px">How long the register waits for the printer to confirm the drawer kick (1-30, default 5). After that the sale carries on with a short message.</p>
    <details id="seAdv"><summary class="note" style="cursor:pointer">Advanced: drawer pulse</summary>
      <label class="f">Drawer kick pulse</label>${sel('sePL', [[50, 'Standard (Epson ESC p 25/250: 50 ms on, 500 ms off; Star: printer default)'], [100, '100 ms'], [200, '200 ms'], [250, '250 ms (heavy / older drawers)']], st.drawerPulse || 50)}
      <p class="note">Leave on Standard unless the drawer clicks but does not pop open. Check the drawer's label for its rated pulse.</p></details>
    <label class="f chk" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="seRT" style="width:20px;height:20px" ${S.user && S.user.manager ? '' : 'disabled'}> Refund tax on returns without a receipt</label>
    <p class="note" id="seRTnote">On: the customer gets the price plus sales tax back. AIR POS reports won't show that refunded part as tax.${S.user && S.user.manager ? '' : ' Only a manager can change this.'}</p>
    <label class="f">Printing engine</label><select class="f" id="seH"><option value="auto">Built-in (fallback: AIR POS service if running)</option><option value="builtin">Built-in only</option><option value="airpos">AIR POS hardware service only (old way)</option></select>
    <div id="seMeth"><label class="f">Print receipts</label>${sel('seM', [['auto', 'Automatic (receipt printers direct, any other printer through its Windows driver)'], ['raw', 'Direct to printer (cut + drawer by Air Max)'], ['driver', 'Through the Windows printer driver']], ps.printMethod)}</div>
    <label class="f">Receipt darkness (direct printing)</label>${sel('seDark', [['normal', 'Normal (recommended)'], ['light', 'Light'], ['dark', 'Dark (old setting, 1.2.1 and before)']], ps.printDarkness)}
    <p class="note">${esc((S.hw && S.hw.message) || '')}. Receipts print by themselves after each sale and return (Print receipt after every sale / return above, this PC). "Follow the AIR POS terminal setting" uses the AIR POS back office terminal settings. Each sale prints once.</p><div id="seMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="seTP">Print test page</button><button class="pbtn s" id="seTD">Test drawer</button><button class="pbtn s" id="seDiag">Save diagnostics</button><button class="pbtn s" id="seChk">Check printers</button><button class="pbtn s" data-close>Close (Esc)</button><button class="pbtn g" id="seOk">Save</button></div>`, () => {
    $('seH').value = st.hardware || 'auto';  $('seRT').checked = st.refundTaxNoReceipt !== false;
    const show = () => {
      const cn = $('seCn').value, ty = $('seT').value, d = det.find(x => x.name === ($('seP').value || p.resolved));
      $('seWin').style.display = cn === 'windows' ? '' : 'none'; $('seNet').style.display = cn === 'network' ? '' : 'none'; $('seSer').style.display = cn === 'serial' ? '' : 'none';
      $('seMeth').style.display = cn === 'windows' ? '' : 'none';
      const eff = ty !== 'auto' ? ty : cn === 'windows' ? (d ? d.type : (p.detected && p.detected.type)) : cn === 'serial' && (p.ports || []).some(x => x.port === $('seCom').value && x.epsonVirtual) ? 'epson' : 'generic';
      $('seGen').style.display = eff === 'generic' ? '' : 'none';
      $('seDet').textContent = eff ? 'Using: ' + ({ epson: 'Epson TM-T20II (ESC/POS)', generic: 'Generic ESC/POS', star: 'Star TSP100 (raster)' }[eff] || eff) + (ty === 'auto' ? ' (picked automatically)' : '') : '';
    };
    ['seCn', 'seT', 'seP', 'seCom'].forEach(id => { if ($(id)) $(id).onchange = show; }); show();
    const save = async () => {
      const x = await api('settings', { printerName: $('seP').value, hardware: $('seH').value, drawerAutoOpen: $('seC').value, receiptAutoPrint: $('seAP').value, returnReceiptAutoPrint: $('seAPR').value, stockWarn: $('seSW').checked, drawerWaitSec: Number($('seDW').value) || 5, drawerPulse: Number($('sePL').value) || 50, ...(S.user && S.user.manager ? { refundTaxNoReceipt: $('seRT').checked } : {}),
        printerConn: $('seCn').value, printerType: $('seT').value, printerHost: $('seIP').value, printerPort: Number($('sePort').value) || 9100, serialPort: $('seCom').value, serialBaud: Number($('seBd').value),
        printMethod: $('seM').value, printerCols: Number($('seCols').value), printerCut: $('seCut').value === '1', codePage: $('seCP').value, imageMode: $('seImg').value, printDarkness: $('seDark').value, drawerPin: Number($('seDP').value) });
      await refresh(); return x;
    };
    $('seOk').onclick = async () => { const x = await save(); msgIn($('seMsg'), x); };
    $('seTP').onclick = async () => { await save(); msgIn($('seMsg'), { ok: true, message: 'Printing…' }); msgIn($('seMsg'), await api('test-print')); };
    $('seChk').onclick = () => printerCheckDialog();
    $('seDiag').onclick = async () => { msgIn($('seMsg'), { ok: true, message: 'Checking printers…' }); const x = await api('printer-diagnostics'); msgIn($('seMsg'), x); };
    $('seTD').onclick = async () => { await save(); msgIn($('seMsg'), { ok: true, message: 'Opening drawer…' }); const x = await api('test-drawer'); msgIn($('seMsg'), x.ok ? { ...x, message: x.message + ' (pin ' + $('seDP').value + ')' } : x); };
  });
}
async function promoDialog() {
  modal(`<h2>Promo code</h2><input class="f" id="pcIn" value="${esc(S.order.promotionalCode || '')}" autofocus><div id="pcMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" data-close>Cancel</button>${S.order.promotionalCode ? '<button class="pbtn r" id="pcClr">Remove</button>' : ''}<button class="pbtn g" id="pcOk">Apply (Enter)</button></div>`, () => {
    $('pcOk').onclick = async () => { const x = await api('promo-code', { code: $('pcIn').value }); await refresh(); if (x.ok) { toast(x.message, true); closeModal(); } else msgIn($('pcMsg'), x); };
    if ($('pcClr')) $('pcClr').onclick = async () => { await act('promo-code', { code: '' }); closeModal(); };
    $('pcIn').onkeydown = e => { if (e.key === 'Enter') $('pcOk').click(); };
  });
}
function qtyDialog() {
  const line = S.cart[selectedRow ?? 0], lineId = lid(selectedRow ?? 0); if (!line) return toast('No line selected', false);
  modal(`<h2>Quantity</h2><p>${esc(line.name)}</p><input class="f" id="qIn" inputmode="decimal" value="${line.quantity}" autofocus>
    <div class="row2"><button class="pbtn s" data-close>Cancel</button><button class="pbtn g" id="qOk">OK (Enter)</button></div>`, () => {
    $('qOk').onclick = async () => { const r = await act('qty', { row: selectedRow ?? 0, lineId, qty: Number($('qIn').value) }); if (r && r.ok) closeModal(); };
    $('qIn').onkeydown = e => { if (e.key === 'Enter') $('qOk').click(); };
  });
}
function discountDialog() {
  if (!S.cart.length) return toast('The order is empty', false);
  const o = S.order;
  modal(`<h2>Order Discount</h2><p class="note">Items total ${money(S.totals.itemAmount)} (before order discount)</p>
    ${(S.discounts || []).length ? `<label class="f">Predefined discount</label><select class="f" id="dPre"><option value="">None</option>${S.discounts.map(d => `<option value="${esc(d.id)}" ${d.id === o.discountConfigSubId ? 'selected' : ''}>${esc(d.name)} — ${d.rate}%${d.membersOnly ? ' (members)' : ''}</option>`).join('')}</select>` : ''}
    <label class="f">Extra order discount</label><select class="f" id="dType"><option value="percent">Percentage (%)</option><option value="amount">Amount ($)</option></select>
    <label class="f">Value</label><input class="f" id="dVal" inputmode="decimal" value="${o.orderDiscountMethod === 20 ? o.orderDiscountAmount : o.orderDiscount}" autofocus>
    <div class="row2"><button class="pbtn s" data-close>Cancel</button><button class="pbtn r" id="dClr">Clear</button><button class="pbtn g" id="dOk">Apply (Enter)</button></div>`, () => {
    $('dType').value = o.orderDiscountMethod === 20 ? 'amount' : 'percent';
    if ($('dPre')) $('dPre').onchange = async () => { const r = await api('predefined-discount', { id: $('dPre').value || null }); toast(r.message, r.ok); await refresh(); if (!r.ok) $('dPre').value = S.order.discountConfigSubId || ''; };
    $('dOk').onclick = async () => { const r = await act('discount', { kind: $('dType').value, value: Number($('dVal').value) }); if (r && r.ok) closeModal(); };
    $('dClr').onclick = async () => { await act('discount', { kind: 'clear' }); closeModal(); };
    $('dVal').onkeydown = e => { if (e.key === 'Enter') $('dOk').click(); };
  });
}
function searchDialog() {
  modal(`<h2>Product Search</h2><input class="f" id="sIn" placeholder="Name, number or UPC" autofocus>
    <div style="max-height:52vh;overflow:auto;margin-top:8px"><table><thead><tr><th>Number</th><th>UPC</th><th>Name</th><th class="n">Price</th></tr></thead><tbody id="sRes"></tbody></table></div>
    <p class="note">↑/↓ to choose, Enter to add, Esc to close.</p>`, () => {
    let rows = [], sel = 0, t, seq = 0; const res = $('sRes'), gone = () => !res.isConnected; // 1.0.11 search speed: seq = only the answer to the newest typing is shown // 1.0.9.1: Esc can close the box while a search is still out
    const draw = () => { if (gone()) return; $('sRes').innerHTML = rows.map((p, i) => `<tr class="row ${i === sel ? 'sel' : ''}" data-i="${i}"><td>${esc(p.number)}</td><td>${esc(p.upc)}</td><td>${esc(p.name)}</td><td class="n">${p.price == null ? '—' : money(p.price)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No products</td></tr>';
      $('sRes').querySelectorAll('tr.row').forEach(tr => tr.onclick = () => add(rows[+tr.dataset.i])); };
    const add = async p => { if (!p) return; closeModal(); const sp = stockPeekStart(p.number); const r = await act('scan', { code: p.number }); if (r && r.ok) stockPeekShow(sp); };
    const go = async () => { if (gone()) return; const my = ++seq; const r = await api('search', { keyword: $('sIn').value.trim() }); if (gone() || my !== seq) return; rows = r.rows || []; sel = 0; draw(); }; // late reply after close: nothing to draw (was PAGE_ERROR null innerHTML)
    $('sIn').oninput = () => { clearTimeout(t); t = setTimeout(go, 150); }; // 1.0.11: 150 ms after the last key (was 300)
    $('sIn').onkeydown = e => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, rows.length - 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); } else if (e.key === 'Enter') add(rows[sel]); };
    go();
  });
}
async function heldDialog() {
  const r = await api('held');
  if (!(r.rows || []).length) return toast('No held orders', false);
  modal(`<h2>Held Orders</h2><table><thead><tr><th>Order</th><th class="n">Qty</th><th class="n">Amount</th><th></th></tr></thead><tbody>${r.rows.map((o, i) => `<tr><td>${esc(o.number)}</td><td class="n">${o.quantity}</td><td class="n">${money((o.amount || 0) + (o.tax || 0))}</td>
    <td><button class="pbtn g" data-res="${esc(o.id)}" ${i === 0 ? 'autofocus' : ''}>Resume</button> <button class="pbtn s" data-void="${esc(o.id)}">Void</button></td></tr>`).join('')}</tbody></table>
    <div class="row2"><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    $('modalRoot').querySelectorAll('[data-res]').forEach(b => b.onclick = async () => {
      if (S.cart.length && !confirm('The current sale will be cleared. Resume the held order?')) return;
      closeModal(); await act('resume', { orderId: b.dataset.res }); });
    $('modalRoot').querySelectorAll('[data-void]').forEach(b => b.onclick = async () => { if (!confirm('Void this held order?')) return; const x = await api('void-held', { orderId: b.dataset.void }); toast(x.message || (x.ok ? 'Voided' : 'Void failed'), x.ok); closeModal(); heldDialog(); });
  });
}
// 1.2.0: date presets + totals + CSV export (opens in Excel)
const H_PRESETS = [['recent', 'Latest orders'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['d30', 'Past 30 days'], ['d90', 'Past 90 days'], ['quarter', 'This quarter'], ['year', 'This year'], ['day', 'One date…']];
function hRange(p, day) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const D = (y, m, d) => new Date(y, m, d); const y = d0.getFullYear(), m = d0.getMonth(), dd = d0.getDate(), wd = (d0.getDay() + 6) % 7; // weeks start Monday
  const r = { today: [d0, D(y, m, dd + 1)], yesterday: [D(y, m, dd - 1), d0], week: [D(y, m, dd - wd), D(y, m, dd + 1)], lastweek: [D(y, m, dd - wd - 7), D(y, m, dd - wd)], month: [D(y, m, 1), D(y, m, dd + 1)], lastmonth: [D(y, m - 1, 1), D(y, m, 1)],
    d30: [D(y, m, dd - 29), D(y, m, dd + 1)], d90: [D(y, m, dd - 89), D(y, m, dd + 1)], quarter: [D(y, m - m % 3, 1), D(y, m, dd + 1)], year: [D(y, 0, 1), D(y, m, dd + 1)] }[p];
  if (p === 'day' && day) { const [a, b, c] = day.split('-').map(Number); return [D(a, b - 1, c), D(a, b - 1, c + 1)]; }
  return r || null;
}
async function historyDialog(q = '', preset = 'recent', day = '') {
  const rg = hRange(preset, day);
  const r = await api('orders', { number: q || null, ...(rg ? { from: rg[0].toISOString(), to: rg[1].toISOString() } : {}) });
  const rows = r.rows || [], done = rows.filter(o => o.status === 20), sum = done.reduce((a, o) => a + (o.amount || 0) + (o.tax || 0), 0);
  modal(`<h2>Order History</h2><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="f" id="hQ" placeholder="Order number (Enter to search)" value="${esc(q)}" style="flex:2">
    <select class="f" id="hP" style="flex:1">${H_PRESETS.map(([k, l]) => `<option value="${k}" ${k === preset ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input class="f" id="hD" type="date" value="${esc(day)}" style="flex:1;${preset === 'day' ? '' : 'display:none'}"><button class="pbtn s" id="hCsv">Export CSV</button></div>
    <div class="note" id="hSum">${rows.length} order${rows.length === 1 ? '' : 's'}${rg ? ` · ${done.length} completed · ${money(sum)}` : ''}${r.capped ? ' · showing the newest 750 only' : ''}</div>
    <div style="max-height:56vh;overflow:auto;margin-top:8px"><table><thead><tr><th>Order</th><th>Time</th><th>Status</th><th>Paid by</th><th class="n">Qty</th><th class="n">Total</th><th></th></tr></thead>
    <tbody>${rows.map(o => `<tr><td>${esc(o.number)}</td><td>${o.time ? esc(new Date(o.time).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</td><td>${esc(o.statusName)}</td><td>${esc(o.paymentTypeName)}</td><td class="n">${o.quantity}${o.quantityReturn ? ' (−' + o.quantityReturn + ')' : ''}</td><td class="n">${money((o.amount || 0) + (o.tax || 0))}</td>
    <td style="white-space:nowrap">${o.status === 20 ? `<button class="pbtn s" data-print="${esc(o.id)}">Reprint</button> <button class="pbtn s" data-gift="${esc(o.id)}">Gift receipt</button>${(o.quantityReturn || 0) < (o.quantity || 0) ? ` <button class="pbtn r" data-ret="${esc(o.id)}">Return</button>` : ''}` : ''}${o.status === 15 ? `<button class="pbtn g" data-res="${esc(o.id)}">Resume</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No orders</td></tr>'}</tbody></table></div>
    <div id="hMsg" class="msg"></div><div class="row2"><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    $('hQ').onkeydown = e => { if (e.key === 'Enter') historyDialog($('hQ').value.trim(), $('hP').value, $('hD').value); };
    $('hP').onchange = () => { if ($('hP').value === 'day') { $('hD').style.display = ''; $('hD').focus(); return; } historyDialog($('hQ').value.trim(), $('hP').value); };
    $('hD').onchange = () => { if ($('hD').value) historyDialog($('hQ').value.trim(), 'day', $('hD').value); };
    $('hCsv').onclick = () => {
      const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const csv = [['Order', 'Time', 'Status', 'Paid by', 'Qty', 'Returned', 'Amount', 'Tax', 'Total'].map(cell).join(',')].concat(rows.map(o => [o.number, o.time ? new Date(o.time).toLocaleString('en-US') : '', o.statusName, o.paymentTypeName, o.quantity, o.quantityReturn || 0, (o.amount || 0).toFixed(2), (o.tax || 0).toFixed(2), ((o.amount || 0) + (o.tax || 0)).toFixed(2)].map(cell).join(','))).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = `orders-${preset}${day ? '-' + day : ''}.csv`; document.body.appendChild(a); a.click(); a.remove();
    };
    $('modalRoot').querySelectorAll('[data-print]').forEach(b => b.onclick = () => printOrder(b.dataset.print, $('hMsg')));
    $('modalRoot').querySelectorAll('[data-gift]').forEach(b => b.onclick = async () => { const m = $('hMsg'); await giftPickOrder({ orderId: b.dataset.gift }, r => { if (m && document.body.contains(m)) { m.textContent = r.message || (r.ok ? 'Gift receipt printed' : 'Gift receipt not printed'); m.className = 'msg ' + (r.ok ? 'ok' : 'err'); } else toast(r.message, r.ok); }); }); // 1.0.11-local.6g: 2+ items = pick screen
    $('modalRoot').querySelectorAll('[data-ret]').forEach(b => b.onclick = async () => { if (S.cart.length) return toast('Finish or hold the current sale first', false); closeModal(); await act('return-start', { kind: 'receipt', orderId: b.dataset.ret }); });
    $('modalRoot').querySelectorAll('[data-res]').forEach(b => b.onclick = async () => { if (S.cart.length && !confirm('The current sale will be cleared. Resume the held order?')) return; closeModal(); await act('resume', { orderId: b.dataset.res }); });
    $('hQ').focus();
  });
}
function returnConfirmDialog() { if (!S.ret.subs.length) return toast('Scan or tap the items being returned first', false); return refundPanel('return'); }
// Owner request J: the refund screen IS the payment screen — same LEFT side panel, same lines in the same order (Credit Card, Cash,
// Gift Card, Check, Manual Credit, Account), labelled Refund, amounts = what goes back to the customer. Refund rules and math are
// unchanged (the server decides every amount): receipt = back the way the customer paid; no receipt = Cash (quick return: or the
// card machine). Account = AIR POS's own Member Account refund ("Return to Account", on by default, customer required).
const REF_LINES = [[20, 'Credit Card'], [10, 'Cash'], [40, 'Gift Card'], [50, 'Check'], [30, 'Manual Credit'], [11, 'Account']];
function refundPanel(kind) { // kind: 'return' (F8 / receipt or no-receipt return mode) | 'mix' (quick return inside a sale)
  let hi = -1, busy = false, mixType = 10, note = null;
  document.body.classList.add('paying');
  const acct = () => kind === 'mix' ? (S.settings && S.settings.returnToAccount === false ? { allowed: false, why: 'Return to Account is turned off in Settings (manager)' } : S.member ? { allowed: true, name: S.member.name } : { allowed: false, why: 'Add a customer to refund to their account' }) : (S.ret.account || { allowed: false, why: '' });
  const total = () => kind === 'mix' ? Math.max(0, -(S.mix ? S.mix.net : 0)) : S.ret.totals.refund;
  const plan = () => { const a = {}; if (kind === 'mix') a[mixType] = total(); else (S.ret.totals.payments || []).forEach(p => { if (p.amount > 0) a[p.paymentType] = round2((a[p.paymentType] || 0) + p.amount); }); return a; };
  const orig = () => new Set(S.ret.origTypes || []); // the lines the sale was paid with (AIR POS allocation, unchanged)
  const why = t => { // can this line take the refund? null = yes, otherwise the reason (same rules as before + Return to Account)
    if (t === 11) { const a = acct(); return a.allowed ? null : a.why; }
    if (kind === 'mix') return t === 10 || t === 20 ? null : 'Refunds without a receipt go back in Cash, on the card machine, or to the customer\'s account';
    if (S.ret.kind === 'receipt') return orig().has(t) ? null : 'Refunds go back the way the customer paid (AIR POS rule): this sale was not paid this way';
    return t === 10 ? null : 'Refunds without a receipt go back in Cash or to the customer\'s account';
  };
  const label = (t, l) => t === 20 && kind === 'mix' ? 'Credit Card — refund on card machine' : t === 11 && acct().allowed && acct().name ? `Account (${esc(acct().name)})` : l;
  const curType = () => kind === 'mix' ? mixType : S.ret.toAccount ? 11 : null;
  async function pick(i) {
    hi = i; const t = REF_LINES[i][0], w = why(t); note = w ? { ok: false, message: w } : null;
    if (!w) {
      if (kind === 'mix') mixType = t;
      else if (t === 11 && !S.ret.toAccount) { const x = await api('return-account', { on: true }); await refresh(); note = x; }
      else if (t !== 11 && S.ret.toAccount) { const x = await api('return-account', { on: false }); await refresh(); note = x; }
    }
    draw();
  }
  function draw() {
    if (!$('refBody')) return;
    const a = plan(), tot = total(), ct = curType();
    if (hi < 0) hi = Math.max(0, REF_LINES.findIndex(([t]) => ct != null ? t === ct : a[t] > 0));
    const nums = `<div class="pn total"><span>Refund</span><b id="refTotal">${money(tot)}</b></div><div class="pn tend"><span>Items</span><b>${kind === 'mix' ? S.mix.lines.reduce((x, l) => x + l.quantity, 0) : S.ret.totals.quantity}</b></div>
      <div class="pn left"><span>Back to customer</span><b id="refAmt">${money(tot)}</b></div><div class="pn chg"><span>${a[10] ? 'Cash back' : 'Cash'}</span><b>${money(a[10] || 0)}</b></div>`;
    const lines = `<div class="plist" id="refLines">${REF_LINES.map(([t, l], i) => `<div class="pline refl ${i === hi ? 'on hi' : ''} ${why(t) ? 'off' : ''}" data-i="${i}" data-t="${t}"><span class="plbl">${label(t, l)}</span><input class="pamt" readonly tabindex="-1" value="${a[t] ? money(a[t]) : ''}" placeholder="0.00"></div>`).join('')}</div>`;
    const where = ct === 11 ? `Goes to ${esc(acct().name || 'the customer')}'s account in AIR POS (store credit)` : kind === 'return' && S.ret.kind === 'receipt' ? 'Goes back the way the customer paid' + ((a[20] || a[30]) ? ' · card part: Air Max checks it with AIR POS' : '') : kind === 'mix' && mixType === 20 ? 'Refund it on the card machine (Air Max records it)' : '';
    $('refBody').innerHTML = `<div class="paygrid"><div class="paynums">${nums}</div><div class="payact">${lines}<div class="msg" id="refWhere" style="color:#34495e">${where}</div>
      <div id="refMsg" class="msg ${note && !note.ok ? 'err' : ''}">${note ? esc(note.message || '') : ''}</div>
      <div class="row2"><button class="pbtn s" id="refBack">Back (Esc)</button><button class="pbtn r" id="rOk">Refund ${money(tot)} (Enter)</button></div></div></div>`;
    $('refLines').querySelectorAll('[data-i]').forEach(d => d.onclick = () => pick(+d.dataset.i));
    $('refBack').onclick = back; $('rOk').onclick = go;
  }
  function back() { closeModal(); refresh(); }
  async function go() {
    if (busy) return; busy = true; const b = $('rOk'); if (b) b.disabled = true;
    if (kind === 'mix') {
      const r = await api('mix-refund', { type: mixType }); busy = false; await refresh();
      if (!r || !r.ok) { note = { ok: false, message: (r && r.message) || 'Refund failed' }; return draw(); }
      return refundDoneDialog(r);
    }
    const pays = S.ret.totals.payments || [], cash = pays.some(p => p.paymentType === 10);
    const r = await act('return-confirm'); busy = false;
    if (r && r.ok) { document.body.classList.remove('paying'); return retDoneDialog(r, pays, cash); }
    note = r; draw();
  }
  modal(`<div class="payhead"><h2>Refund</h2><span class="note">Money goes back to the customer · press Back (Esc) to change items</span></div><div id="refBody" tabindex="-1" style="outline:none"></div>`, () => { draw(); $('refBody').focus({ preventScroll: true }); keys(); }, 'fullpay sidepay refpanel');
  function keys() { $('refBody').onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); pick((hi + (e.key === 'ArrowDown' ? 1 : REF_LINES.length - 1)) % REF_LINES.length); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); back(); }
  }; }
  refundPanel.redraw = draw;
}
function retDoneDialog(r, pays = [], cash = true) {
  if (r.hwPending && r.hwPending.length) watchHw();
  const hw = [r.drawer, r.print].filter(Boolean).map(x => `<div class="${x.ok ? 'note' : 'banner'}">${esc(x.message)}</div>`).join('');
  const cashAmt = pays.filter(p => p.paymentType === 10).reduce((a, p) => a + p.amount, 0);
  const cd = r.card; // receipt return to card: AIR POS status check (Completed / not finished)
  const cardHtml = cd ? `<div id="rdCard" class="${cd.done ? 'note' : 'banner'}" style="font-weight:700">${esc(cd.message)}</div>${cd.done ? '' : '<button class="pbtn r" id="rdCardRetry">Retry card refund</button>'}` : '';
  modal(`<h2>${cd && !cd.done ? 'Return recorded — card refund NOT finished' : 'Return complete'}</h2>${pays.map(p => `<div class="due"><span>${p.paymentType === 10 ? 'Give back cash' : esc(p.name)}</span><b>${money(p.amount)}</b></div>`).join('')}
    <div class="due"><span>${cash ? 'Cash to hand back' : 'Total refunded'}</span><span class="big" style="color:#c0392b">${money(cash ? cashAmt : r.refund)}</span></div>${cardHtml}${hw}<div id="rdMsg" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="rdDrawer">Open Drawer</button><button class="pbtn" id="rdPrint">Print Return Receipt</button><button class="pbtn g" data-close autofocus>Done (Enter)</button></div>`, () => {
    $('rdPrint').onclick = async () => msgIn($('rdMsg'), await api('print-return', { returnId: r.returnId }));
    if ($('rdCardRetry')) $('rdCardRetry').onclick = async () => {
      const b = $('rdCardRetry'); b.disabled = true; $('rdCard').textContent = 'Checking the card refund with AIR POS…';
      const x = await api('card-refund-retry', { retId: cd.retId });
      if (x.busy) return; // a tap that arrived while the first was still running: the first one's answer shows
      $('rdCard').textContent = x.message; $('rdCard').className = x.ok ? 'note' : 'banner'; b.disabled = false; if (x.ok) b.remove(); refresh();
    };
    $('rdDrawer').onclick = async () => { msgIn($('rdMsg'), { ok: true, message: 'Opening drawer…' }); const x = await api('drawer-sale'); msgIn($('rdMsg'), x.needPassword ? { ok: false, message: 'Close this window and press Open Drawer (Ctrl+D) to open with a password.' } : x); };
  });
}
async function drawer() {
  const r = await act('drawer');
  if (r && !r.needPassword) flash(r.ok ? '💵 Drawer opened' : r.hw === 'timeout' ? '⚠ Drawer: no answer (see message below)' : '⚠ Drawer did not open (see message below)', r.ok);
  if (r && r.needPassword) modal(`<h2>Open Drawer</h2><label class="f">Your password</label><input class="f" type="password" id="dpw" autocomplete="new-password" autofocus>
    <div class="row2"><button class="pbtn s" data-close>Cancel</button><button class="pbtn g" id="dpOk">Open</button></div>`, () => {
    $('dpOk').onclick = async () => { const pw = $('dpw').value; $('dpw').value = ''; closeModal(); await act('drawer', { password: pw }); };
    $('dpw').onkeydown = e => { if (e.key === 'Enter') $('dpOk').click(); };
  });
}
async function logout() {
  if (S.cart && S.cart.length && !(S.pay && S.pay.paid > 0) && !confirm('The current sale is not finished and will be lost. Log out anyway?')) return; // 1.0.10-local.2: payments taken -> Air Max explains (kept, press again)
  await act('logout');
}


// Print / reprint an order receipt: ONE action, nothing on screen. The store's default template (with its default
// field text) goes straight to the default/auto-picked receipt printer. Only a FAILED print shows a short error.
async function printOrder(orderId, msgEl, onDone) {
  let r = await api('print', { orderId });
  if (r && r.needTemplate) r = await api('print', { orderId: r.orderId, choice: { templateIds: [r.defaultTemplateId || (r.templates[0] || {}).id].filter(Boolean) } });
  if (r && r.ok) return onDone ? onDone(r) : r;
  const m = 'Not printed: ' + ((r && r.message) || 'printer did not answer');
  if (msgEl && document.body.contains(msgEl)) { msgEl.textContent = m; msgEl.className = 'msg err'; } else toast(m, false);
  return r;
}

// 1.0.10-local.2 (Ari 11:45 / 11:46): Reprint Receipt and Gift Receipt print the LAST sale straight away (this session, else the id
// saved on this register, else a read-only look-up in AIR POS order history). Nothing found = a short message; History never opens.
// Store request #26: Print Quote = the items on screen printed as "QUOTE / ESTIMATE - NOT A SALE - NOT PAID". Nothing is saved, held or paid; no drawer.
async function printQuote() {
  if (!S.cart || !S.cart.length) return toast('Nothing on the sale to quote', false);
  if (S.pay) return toast('Close the payment first', false);
  const r = await api('quote-print');
  return toast((r && r.message) || 'Quote not printed', !!(r && r.ok));
}
async function reprintLast() {
  if (S.lastOrderId) return printOrder(S.lastOrderId, null, r => { receiptPanel(S.lastOrderId, (r && r.message) || 'Receipt sent to printer'); return r; });
  const x = await api('last-receipt');
  if (!x || !x.ok) return toast((x && x.message) || 'No recent receipt to reprint', false);
  return printOrder(x.orderId, null, r => { toast((r.message || 'Receipt sent to printer') + (x.number ? ' (order ' + x.number + ')' : ''), true); receiptPanel(x.orderId, r.message || 'Receipt sent to printer'); return r; });
}
// Store request #17 (Nov 2): after Reprint Receipt (Ctrl+P) the last receipt stays on screen and does NOT close by itself, so the cashier can
// print more copies or a gift receipt for picked items. Esc / Close ends it. Read only (items and quantities, no money); prints use the same
// 'print' / gift paths as before, one press = one print (a second press while one is printing is ignored).
async function receiptPanel(orderId, first) {
  const it = await api('gift-items', { orderId }); if (modalOpen()) return;
  const items = it && it.ok && Array.isArray(it.items) ? it.items : [], num = (it && it.number) || '';
  let msg = first, working = false;
  const show = () => modal(`<h2>Last receipt${num ? ' - order ' + esc(num) : ''}</h2>
    <div class="note" id="rpMsg" style="min-height:22px">${esc(msg || '')}</div>
    <div id="rpItems" style="max-height:40vh;overflow:auto;margin:8px 0;font-size:16px">${items.length ? items.map(i => `<div style="padding:3px 4px">${esc(i.quantity != null ? i.quantity + ' × ' : '')}${esc(i.name)}</div>`).join('') : '<div class="note">Items not available.</div>'}</div>
    <div class="row2"><button class="pbtn g" id="rpCopy">Print another copy (Enter)</button><button class="pbtn s" id="rpGift">Gift receipt…</button><button class="pbtn s" id="rpClose" data-close>Close (Esc)</button></div>`, () => {
    const say = (m, ok) => { msg = m; const e = $('rpMsg'); if (e) { e.textContent = m; e.className = 'note' + (ok === false ? ' err' : ''); } };
    $('rpCopy').onclick = async () => { if (working) return; working = true; say('Printing…'); try { const r = await printOrder(orderId, $('rpMsg'), x => x); if (r && r.ok) say((r.message || 'Receipt sent to printer') + ' (copy)'); else if (!r || !r.ok) msg = $('rpMsg') ? $('rpMsg').textContent : msg; } finally { working = false; } };
    $('rpGift').onclick = async () => { if (working) return; working = true; closeModal(); try { await giftPickOrder({ orderId }, r => { msg = (r && r.message) || 'Gift receipt not printed'; }); } finally { working = false; } if (!modalOpen()) show(); };
    $('modalRoot').querySelector('.modal').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && !(e.target && e.target.id === 'rpClose')) { e.preventDefault(); e.stopPropagation(); $('rpCopy').click(); } });
    $('rpCopy').focus();
  });
  show();
}
async function giftLast() {
  const args = S.lastOrderId ? { orderId: S.lastOrderId } : {};
  return giftPickOrder(args, r => toast((r && r.message) || 'Gift receipt not printed', !!(r && r.ok)));
}
// 1.0.11-local.6g (Ari OK 6:06 PM ET Nov 1, test build): pick which items go on the gift receipt. Every item is ticked; Print (Enter)
// prints the ticked ones with no prices (all ticked = the store's AIR POS gift template, exactly as before); Cancel (Esc) prints nothing.
function giftPicker(items, { title = 'Gift receipt', okText = 'Print (Enter)', note = '' } = {}) {
  return new Promise(resolve => {
    let done = false; const finish = v => { if (done) return; done = true; resolve(v); };
    modal(`<h2>${esc(title)}</h2><div class="note">${esc(note || 'Untick the items to leave off. The gift receipt shows no prices.')}</div>
      <div id="gpList" style="max-height:50vh;overflow:auto;margin:8px 0">${items.map((i, k) => `<label class="gp-row" style="display:flex;gap:10px;align-items:center;padding:6px 4px;font-size:16px;cursor:pointer"><input type="checkbox" class="gp-cb" data-id="${esc(i.id)}" ${k === 0 ? 'id="gpFirst"' : ''} checked style="width:20px;height:20px"><span style="flex:1">${esc(i.name)}</span><span class="n">× ${esc(i.quantity)}</span></label>`).join('')}</div>
      <div id="gpMsg" class="msg"></div><div class="row2"><button class="pbtn g" id="gpOk">${esc(okText)}</button><button class="pbtn s" id="gpCancel" data-close>Cancel (Esc)</button></div>`, () => {
      const root = $('modalRoot'), box = root.querySelector('.modal'), ok = $('gpOk');
      const ticked = () => [...root.querySelectorAll('.gp-cb')].filter(c => c.checked).map(c => c.dataset.id);
      const upd = () => { ok.disabled = !ticked().length; $('gpMsg').textContent = ticked().length ? '' : 'Tick at least one item'; };
      root.querySelectorAll('.gp-cb').forEach(c => c.onchange = upd);
      ok.onclick = () => { const ids = ticked(); if (!ids.length) return upd(); closeModal(); finish({ ids, all: ids.length === items.length }); };
      $('gpCancel').onclick = () => { closeModal(); finish(null); };
      box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.shiftKey && e.target !== $('gpCancel')) { e.preventDefault(); e.stopPropagation(); ok.click(); } });
      new MutationObserver((m, o) => { if (!document.body.contains(ok)) { o.disconnect(); finish(null); } }).observe(root, { childList: true }); // Esc / click outside = Cancel
      ($('gpFirst') || ok).focus();
    });
  });
}
async function giftPickOrder(args, show) { // Ctrl+Alt+P and History's Gift receipt button
  const it = await api('gift-items', args);
  if (!it || !it.ok || !Array.isArray(it.items) || it.items.length < 2) return show(await api('gift-reprint', args)); // one item / not found: as before
  const pick = await giftPicker(it.items, { title: 'Gift receipt' + (it.number ? ' - order ' + it.number : '') });
  if (!pick) return; // Cancel: nothing printed
  return show(pick.all ? await api('gift-reprint', { orderId: it.orderId }) : await api('gift-pick-print', { orderId: it.orderId, ids: pick.ids }));
}
// 1.0.10-local.2 Check printers (Ari OK 11:40): read-only list of the Windows queues + test slips. Air Max only changes ITS OWN
// receipt printer setting, and only after the cashier confirms. The drawer opens only from its own button.
async function printerCheckDialog() {
  modal(`<h2>Check printers</h2><div id="pcMsg" class="msg">Reading the Windows printers…</div>`);
  const r = await api('printer-check'); if (!$('pcMsg')) return;
  const flagTxt = q => q.flags.map(f => `<div class="${f.bad ? 'err' : 'note'}" style="font-size:12px">${esc(f.text)}</div>`).join('');
  const rows = (r.queues || []).map(q => `<tr${q.current ? ' style="font-weight:600"' : ''}><td>${esc(q.name)}${q.current ? ' <span class="note">(Air Max uses this)</span>' : ''}${flagTxt(q)}</td><td>${esc(q.driver || '?')}</td><td>${esc(q.port || '?')}</td><td>${esc(q.datatype || '-')}</td><td>${esc(q.printProcessor || '-')}</td></tr>`).join('');
  const sg = r.suggest;
  modal(`<h2>Check printers</h2><div id="pcMsg" class="msg ${r.ok && !(sg && sg.name) && !r.problem ? 'ok' : 'err'}">${esc(r.message || '')}</div>
    ${rows ? `<div style="max-height:34vh;overflow:auto"><table><thead><tr><th>Windows printer</th><th>Driver</th><th>Port</th><th>Datatype</th><th>Processor</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Read from Windows only: Air Max changes nothing in Windows.${r.richDetails ? '' : ' (Datatype / processor: not reported by this printer helper.)'}</p>` : ''}
    ${sg ? (sg.name ? `<div class="banner" id="pcSug">Suggested: <b>${esc(sg.name)}</b>. ${esc(sg.why)} <button class="pbtn g" id="pcUse">Use this printer for receipts</button></div>` : `<div class="banner">${esc(sg.why)}</div>`) : ''}
    <label class="f">Test slips (each slip prints its number)</label>
    <div class="row2"><button class="pbtn s" id="pcAll">Print test slips (both ways)</button><button class="pbtn s" id="pcRaw">Direct only</button><button class="pbtn s" id="pcDrv">Windows driver only</button><button class="pbtn s" id="pcKick">Open drawer (test)</button></div>
    <div id="pcRes" class="msg"></div>
    <div class="row2"><button class="pbtn s" id="pcDiag">Save diagnostics</button><button class="pbtn s" id="pcBack">Back to Settings</button><button class="pbtn s" data-close>Close (Esc)</button></div>`, () => {
    const res = $('pcRes');
    const show = x => { res.className = 'msg ' + (x.ok ? 'ok' : 'err'); res.innerHTML = (x.steps && x.steps.length ? x.steps.map(t => `<div>${t.n}. ${esc(t.name)} (${esc(t.modeName)}): ${t.ok ? 'sent' : 'FAILED: ' + esc(t.error)}</div>`).join('') : '') + `<div style="margin-top:6px">${esc(x.message || '').replace(/\n/g, '<br>')}</div>` + (x.note ? `<div class="note">${esc(x.note)}</div>` : ''); };
    const run = modes => async () => { res.className = 'msg'; res.textContent = 'Printing test slips…'; show(await api('printer-check-print', { modes })); };
    $('pcAll').onclick = run(['raw', 'driver']); $('pcRaw').onclick = run(['raw']); $('pcDrv').onclick = run(['driver']);
    $('pcKick').onclick = async () => { res.className = 'msg'; res.textContent = 'Opening the drawer…'; const x = await api('test-drawer'); res.className = 'msg ' + (x.ok ? 'ok' : 'err'); res.textContent = x.message || (x.ok ? 'Drawer command sent' : 'Drawer did not open'); };
    $('pcDiag').onclick = async () => { res.className = 'msg'; res.textContent = 'Saving…'; const x = await api('printer-diagnostics'); res.className = 'msg ' + (x.ok ? 'ok' : 'err'); res.textContent = x.message; };
    $('pcBack').onclick = () => settingsDialog();
    if ($('pcUse')) $('pcUse').onclick = async () => {
      const b = $('pcUse');
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = `Yes, print receipts on '${sg.name}'`; return; } // cashier confirms first
      const x = await api('settings', { printerName: sg.name });
      $('pcSug').innerHTML = esc(x.ok === false ? 'Not changed: ' + (x.message || '') : `Air Max now prints receipts on '${sg.name}'. Print a test slip to check. (Windows was not changed.)`);
    };
  });
}

// ---------- actions ----------
const A = {
  'checkout': checkoutDialog, 'new-sale': () => (S.mode === 'return' ? act('return-cancel') : act('new-sale')),
  'hold': () => (S.mode === 'return' ? toast('Not in return mode', false) : act('hold')), 'load-hold': heldDialog, 'drawer': drawer,
  'return': () => (S.mode === 'return' ? act('return-cancel') : act('return-toggle', {}, { silent: true })), // no receipt: toggles return scanning (red lines)
  'history': () => historyDialog(), 'search': searchDialog, 'reprint': () => reprintLast(), 'reprint-gift': () => giftLast(), // 1.0.10-local.2: always the last sale, never opens History
  'discount': discountDialog, 'qty-plus': () => act('qty-plus', { row: selectedRow ?? 0, lineId: lid(selectedRow ?? 0) }, { silent: true }), 'qty-minus': () => act('qty-minus', { row: selectedRow ?? 0, lineId: lid(selectedRow ?? 0) }, { silent: true }),
  'qty-edit': qtyDialog, 'remove': () => { const r = selectedRow ?? 0, n = S.mode === 'return' ? 0 : S.cart.length; return S.mix && r >= n && S.mix.lines[r - n] ? act('mix-remove', { row: r - n }) : act('remove', { row: r, lineId: lid(r) }); }, 'close': () => { const h = $('__airpos_help'); if (h) return h.remove(); if ($('payBody') && A.__payEsc) return A.__payEsc(); if ($('cofCancel')) return $('cofCancel').click(); /* 1.0.9 Add card: Esc = back to the profile */ if (modalOpen()) return closeModal(); focusScan(); },
  'logout': logout, 'clock-out': clockOutDialog, 'card': checkoutDialog,
  'customer': memberDialog, 'item-discount': () => lineDialog(), 'quote': printQuote, 'price-change': priceChangeButton, 'open-item': () => (S.mode === 'return' ? toast('Not in return mode', false) : tempItemDialog()),
  'extra-charge': () => (S.mode === 'return' ? toast('Not in return mode', false) : extraChargeDialog()), 'promo': () => (S.mode === 'return' ? toast('Not in return mode', false) : promoDialog()),
  'end-of-day': eodDialog, 'cash-move': () => cashChooser(), 'settings': settingsDialog,
  'clear-customer': () => (S.member ? act('member-detach') : toast('No customer on this sale', false)),
  'local:help': () => AirposShortcuts.helpOverlay(keys, 'Air Max keys'),
  'tax-off': () => (S.mode === 'return' ? toast('Tax Off is for sales', false) : !S.cart.length && !(S.order && S.order.taxExempt) ? toast('Scan items first, then F5 = Tax Off for this sale', false) : taxOff()),
  'qty-star': () => { const i = $('scanInput'); if (!i || modalOpen()) return; i.value = '*'; i.focus(); },
  'quick-search': () => { const q = $('qsIn'); if (q) { q.focus(); q.select(); } },
};
const LAYOUT = {
  actions: [
    ['New', 'Ctrl + Shift + N', '⊕', 'new-sale'], ['History', 'Ctrl + L', '🧾', 'history'], ['Hold', 'Ctrl + H', '🕒', 'hold'], ['Load Hold', 'Ctrl + Shift + H', '👥', 'load-hold'],
    ['Open Drawer', 'Ctrl + D', '💵', 'drawer'], ['Return', 'Ctrl + R', '↩', 'return', 'red'],
    ['Print Label', 'Ctrl + Shift + P', '🏷', 'print-label'], ['Add Gift Receipt', 'F10', '🎁', 'gift-receipt'], // Ari OK 2:30 PM ET Oct 30: both in the left column (Gift Receipt moved from the right Gift Cards panel)
    ['Temporary Item', 'F7', '✎', 'open-item'], // Ari 11:05 PM Oct 31: also in the left column (same F7 action as the right-side button)
    ['Price Change', 'Manager · New price', '＄', 'price-change'], ['Print Quote', 'Estimate · not a sale', '≡', 'quote'], // store requests #23/#26 (new buttons, no shortcut)
    ['Customer', 'F3', '👤', 'customer'], ['End of Day', 'Ctrl + E', '📊', 'end-of-day'], ['Clock Out', 'Ctrl + Shift + X', '⏱', 'clock-out'], ['Log Out', 'Ctrl + Shift + U', '⏻', 'logout', 'red'],
  ],
  right: [
    ['Transaction Actions', [['Temporary Item', 'F7', 'open-item'], ['Return', 'Ctrl + R', 'return', 'red'], ['Take Return', 'receipt · Ctrl + L', 'history'], ['Reprint Receipt', 'Ctrl + P', 'reprint'], ['Gift Receipt', 'Ctrl + Alt + P', 'reprint-gift'], ['Open Finder', 'Ctrl + F', 'search'], ['Sale Discount', 'F6', 'discount'], ['Tax Off', 'F5', 'tax-off'], ['Promo Code', 'F9', 'promo'], ['Extra Charge', 'F8', 'extra-charge'], ['Clear Customer', 'Shift + F3', 'clear-customer']]],
    ['Items', [['Qty +', '+', 'qty-plus'], ['Qty −', '−', 'qty-minus'], ['Set Qty', '* then number', 'qty-edit'], ['Remove Line', 'Del', 'remove', 'red'], ['Item Discount', 'F4', 'item-discount']]],
    ['Register', [['Cash In / Out', 'Ctrl + K', 'cash-move'], ['Settings', 'Ctrl + ,', 'settings'], ['Keys', 'F1', 'local:help'], ['Hardware check', 'Ctrl + Shift + D', 'hw']]],
  ],
};
A.hw = async () => { const r = await api('hardware'); toast(r.message, r.ok); refresh(); };
function run(a) { if (!a) return; if (!S.loggedIn) return; (A[a] || (() => toast('Unknown action', false)))(); }
function build() {
  const ab = ([l, k, ic, a, st]) => `<button class="abtn ${st || ''} ${a ? '' : 'na'}" data-a="${a || ''}" title="${a ? esc(l) : 'Not in Air Max yet'}"><span class="ic">${ic}</span><span><span class="t">${l}</span>${k ? `<span class="k">${k}</span>` : ''}</span></button>`;
  const HG = ['hold', 'load-hold', 'aside-put', 'aside-load'], hg = HG.map(a => LAYOUT.actions.find(b => b[3] === a)).filter(Boolean); // Hold | Load Hold side by side; Put Aside / Load Aside are not in LAYOUT.actions any more (owner 3:46 PM), so they never show
  $('actions').innerHTML = LAYOUT.actions.map(b => (hg.length && b[3] === hg[0][3] ? `<div class="hgrp">${hg.map(ab).join('')}</div>` : HG.includes(b[3]) ? '' : ab(b))).join('');
  $('right').innerHTML = LAYOUT.right.map(([g, bs]) => `<h3>${g}</h3><div class="rgrid">${bs.map(([l, k, a, st]) => `<button class="rbtn ${st || ''} ${a ? '' : 'na'}" data-a="${a || ''}" title="${a ? '' : 'Not in Air Max yet'}">${l}${k ? `<small>${k}</small>` : ''}</button>`).join('')}</div>${g === 'Transaction Actions' ? '<div class="rgrid" id="mountTx"></div>' : ''}`).join('');
  $('tiles').innerHTML = [['customer', 'Customer add', '👤', 'customer', 'F3'], ['items', 'Items', '🛒', 'close', 'Esc'], ['payment', 'Checkout', '💳', 'checkout', 'F12']] // top row: ONLY these three (F6 discount, F5 tax off, Ctrl+L History stay on keys + sidebars)
    .map(([id, l, ic, a, k]) => `<div class="tile ${id === 'items' ? 'active' : ''}" data-a="${a}"><span class="k">${k || ''}</span><span class="ic">${ic}</span>${l}<span class="info" id="info-${id}"></span></div>`).join('');
  document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { run(b.dataset.a || null); });
  if (window.AirMaxMounts && $('mountTx')) AirMaxMounts.fill($('mountTx'), 'checkout.tx-actions'); // Step 0 slot: extra Transaction Actions buttons from a batch file
}

const maskNo = n => { n = String(n || ''); return n.length > 4 ? '**** ' + n.slice(-4) : n; };
// ---------- render ----------
// 1.0.7 (Ari OK 12:30 AM ET Oct 30, option A): Customer add box shows the attached customer's card. Display only: name, Account
// (availableBalance read by MemberInfoGet when the customer was attached; green above $0, red at $0 or less), Phone, Points.
function tileCustCard() {
  const el = $('info-customer'), m = S.member, t = document.querySelector('#tiles .tile[data-a="customer"]');
  if (t) t.classList.toggle('hascust', !!m); el.classList.add('has');
  if (!m) { el.textContent = 'Scan card, phone or tap to add'; return; }
  const bal = Number(m.availableBalance) || 0, zero = Math.abs(bal) < 0.005; // ls9: no red "ACCOUNT $0.00" for a customer without an account balance
  el.innerHTML = `<div class="custc"><div class="nm">${esc(m.name)}</div>${zero ? '' : `<span>Account<b class="bal${bal < 0 ? ' neg' : ''}">${money(bal)}</b></span>`}`
    + `<span>Phone<b>${esc(m.mobile || '—')}</b></span><span>Points<b>${esc(m.points || 0)}</b></span></div>`;
}
// 1.2.3.1: red bar on the sale screen while a paid sale is not finished (after Esc / Back to sale)
async function recheckPay() { const x = await api('pay-recheck'); await refresh(); return x; }
function payStuckBar() {
  const el = $('payStuck'); if (!el) return;
  const p = S.loggedIn && S.pay; const on = !!(p && payAside && p.paid > 0);
  el.style.display = on ? '' : 'none'; if (!on) { el.innerHTML = ''; return; }
  el.innerHTML = `<span>Paid ${money(p.paid)}: sale not finished.${p.remaining > 0.004 ? ' ' + money(p.remaining) + ' still owed.' : ''}${p.lastError ? ' ' + esc(String(p.lastError).slice(0, 320)) : ''}</span><button class="pbtn g" id="psBack">Back to payment (F12)</button><button class="pbtn" id="psCheck">Check AIR POS again</button>`;
  $('psBack').onclick = () => run('checkout');
  $('psCheck').onclick = async () => { $('psCheck').disabled = true; const x = await recheckPay(); if (x.ok && x.completed) { payAside = false; doneDialog(x); } else { toast(x.message, !!x.ok); payStuckBar(); } };
}
// speed (claude/speed-general): a sale-screen region is rewritten only when its content changed. Rewriting 60 sale lines costs
// ~90 ms of browser layout; refresh() runs after every scan and every 15 s, so an unchanged sale no longer re-lays out the screen.
const putHtml = (el, html) => { if (el.__html !== html) { el.innerHTML = html; el.__html = html; } };
async function refresh() {
  try { S = await (await fetch('/api/state', { signal: AbortSignal.timeout(8000) })).json(); reconnecting(false); }
  catch { reconnecting(true); clearTimeout(refresh.t); refresh.t = setTimeout(() => refresh().then(() => { if (S.loggedIn) focusScan(); }), 2000); return; } // the launcher restarts the service; keep trying
  showLogin(!S.loggedIn);
  if (!S.loggedIn) { closeModal(); return; }
  rdidFetch();
  if (S.mode === 'clockin') clockInDialog();
  if (!S.pay) payAside = false;
  payStuckBar();
  if (S.pay && !payAside && S.mode !== 'clockin' && !modalOpen()) setTimeout(() => { if (!modalOpen() && S.pay && !payAside) checkoutDialog(); }, 0); // payment in progress (e.g. after a reload) reopens itself
  $('subtitle').textContent = `${S.user.company} · ${S.user.shop}`;
  const hw = S.hw || {}; $('hwPill').textContent = hw.via === 'builtin' ? 'printer/drawer: built-in' : hw.via === 'airpos' ? 'printer/drawer: AIR POS service' : 'printer/drawer: not found';
  $('hwPill').title = hw.message || ''; $('hwPill').className = 'pill ' + (hw.via ? 'ok' : 'warn'); $('hwPill').onclick = () => run('settings');
  $('sessPill').textContent = S.session && S.session.number ? 'Clocked in ' + S.session.number : 'not clocked in'; $('sessPill').className = 'pill ' + (S.session && S.session.number ? 'ok' : 'warn');
  const u = S.update || {}; const ready = u.state === 'ready';
  $('buildPill').textContent = (S.build === 'dev' ? 'DEV BUILD ' : '') + 'v' + (S.version || '') + (ready ? ' · update ' + u.available + ' ready' : '');
  $('buildPill').title = (u.message ? u.message + ' · ' : '') + 'Check for updates now'; $('buildPill').className = 'pill ' + (S.build === 'dev' ? 'bad' : ready ? 'ok' : '');
  const ret = S.mode === 'return';
  $('gridhead').className = 'gridhead' + (ret ? ' ret' : '');
  const mx = !ret && S.mix ? S.mix : { on: false, lines: [] }; $('gridhead').classList.toggle('ret', ret || mx.on);
  document.querySelectorAll('[data-a="return"]').forEach(b => b.classList.toggle('on', !!mx.on));
  $('gridTitle').textContent = ret ? (S.ret.kind === 'receipt' ? `RETURN for ${S.ret.order.number} — scan returned items` : 'RETURN MODE (no receipt) — scan returned items') : mx.on ? 'RETURN — scan returned items (Ctrl+R = back to sale)' : (S.order.resuming ? `Resumed order ${S.order.number || ''}` : 'Sale');
  $('gridInfo').innerHTML = ret ? (S.ret.order ? `Paid by ${esc(S.ret.order.payments)} · ` : '') + 'F12 = refund · Ctrl+R = cancel return'
    : (S.order && S.order.taxExempt ? '<span class="taxoff" title="F5 turns tax back on">TAX OFF</span> ' : '') + (S.member ? `<span class="memchip" id="memChip">👤 ${esc(S.member.name)} · ${S.member.points} pts${S.member.availableBalance ? ' · credit ' + money(S.member.availableBalance) : ''}</span>` : '');
  if ($('memChip')) $('memChip').onclick = () => run('customer');
  customerNoteAlert();
  const rl = ret ? (S.ret.lines || []) : [];
  $('retLines').style.display = rl.length ? '' : 'none';
  $('retLines').innerHTML = rl.length ? `<b>On this receipt</b> (tap to return one): ` + rl.map(l => `<button class="rl ${l.left > 0 && l.refundable ? '' : 'na'}" data-code="${esc(l.code)}" title="${l.refundable ? '' : 'Not refundable'}">${esc(l.name)} · ${money(l.price)} <small>${l.left} left</small></button>`).join('') : '';
  $('retLines').querySelectorAll('button.rl:not(.na)').forEach(b => b.onclick = () => act('scan', { code: b.dataset.code }));
  const rows = ret ? S.ret.subs : S.cart, all = rows.length + mx.lines.length;
  if (selectedRow != null && selectedRow >= all) selectedRow = all ? all - 1 : null;
  putHtml($('cartHead'), `<tr><th>#</th><th>Lookup Code</th><th>Name</th><th class="n">Qty</th><th class="n">Price</th><th class="n">${ret ? 'Max' : 'Discount'}</th><th class="n">Total</th></tr>`);
  // AirMax Step 0 (Gordon OK 1:26 PM ET Nov 3): the NEWEST scanned item is the BOTTOM line and line 1 stays at the top. Display only: the register still lists
  // newest first, so row i is drawn at place n-i. data-row, selectedRow and every action keep the register's own row number (see lineNo / moveCartSel).
  putHtml($('cart'), all ? rows.map((r, i) => `<tr class="row ${i === (selectedRow ?? 0) ? 'sel' : ''}" data-row="${i}"><td>${rows.length - i}</td><td>${esc(!ret && (r.type === 30 || r.type === 40) ? maskNo(r.number) : r.number)}</td><td>${esc(r.name)}${!ret && (r.type === 20 || r.type === 40) ? ` <span class="tag">${r.type === 20 ? 'charge' : 'reload'}</span>` : ''}${ret ? '' : discLineHtml(r)}</td><td class="n"${ret ? '' : ' data-c="qty"'}>${r.quantity}</td><td class="n"${ret ? '' : ' data-c="price"'}>${money(r.price)}</td><td class="n"${ret ? '' : ' data-c="disc"'}>${ret ? (r.max ?? '') : discCell(r, i)}${ret ? '' : orderDiscTag(r)}</td><td class="n">${money(ret ? r.price * r.quantity : r.total)}</td></tr>`).reverse().join('')
      + mx.lines.map((r, j) => { const i = rows.length + j; return `<tr class="row neg ${i === (selectedRow ?? 0) ? 'sel' : ''}" data-row="${i}"><td>${i + 1}</td><td>${esc(r.number)}</td><td>${esc(r.name)} <span class="tag">return</span></td><td class="n">−${r.quantity}</td><td class="n">${money(r.price)}</td><td class="n"></td><td class="n">−${money(-r.total)}</td></tr>`; }).join('')
    : mx.lines.length ? '' : `<tr><td colspan="7" class="empty">${ret ? 'Return' : ''}</td></tr>`);
  // AirMax Step 0b C1 / C2 (Gordon request, Nov 3; screenshots to Gordon before any merge): a click on a line's Discount cell opens the item discount (same window as F4).
  // Batch 11 (Gordon, Nov 3): a click on its Qty or Price cell edits the value right in the cell (cellEditStart: same rules and code paths as the Quantity / Price Change windows).
  // The click selects THAT line first (data-row = the register's own row, see C3). Any other cell just selects the line, as before. Return mode has no data-c cells.
  document.querySelectorAll('#cart tr.row').forEach(tr => tr.onclick = e => {
    if (e && e.target && e.target.closest && e.target.closest('input.ced')) return; // a click inside the box being edited
    selectedRow = +tr.dataset.row; const c = S.mode !== 'return' && e && e.target && e.target.closest ? e.target.closest('td[data-c]') : null;
    if (c) { if (c.dataset.c === 'disc') refresh().then(() => lineDialog()); else cellEditStart(+tr.dataset.row, c.dataset.c); return; }
    refresh(); focusScan();
  });
  { const keep = () => { const st = document.querySelector('#cart tr.row.sel'); if (st && st.scrollIntoView) st.scrollIntoView({ block: 'nearest' }); }; keep(); requestAnimationFrame(keep); } // newest line (bottom) stays in view and selected after every scan
  const t = S.totals, up = !ret && !!t.updating, mu = v => up ? '…' : money(v); // 1.0.11-speed.1: the line shows at once; the total follows a moment later
  const c = (l, v, cls = '') => `<div class="${cls}"><span>${l}</span><span>${v}</span></div>`;
  putHtml($('totals'), ret ? c('Items', S.ret.totals.quantity) + c('Amount', money(S.ret.totals.amount)) + c('Tax', money(S.ret.totals.tax)) + c('Refund', money(S.ret.totals.refund), 'total')
    : c('Subtotal', mu(t.itemAmount)) + c('Rows', S.cart.length) + c('Discount', mu(t.discountAmount) + (S.order.orderDiscount ? ` (${S.order.orderDiscount}%)` : '')) + c('Quantity', up ? '…' : t.quantity) + (t.pointDiscount ? c('Points used', '−' + money(t.pointDiscount)) : '') + (S.order.promotionalCode ? c('Promo', esc(S.order.promotionalCode)) : '')
      + c('Before tax', mu(Math.max(0, (t.orderAmount || 0) - (t.pointDiscount || 0))), 'pretax') + c(S.order.taxExempt ? 'Tax (OFF)' : 'Tax', mu(t.tax), S.order.taxExempt ? 'taxoffline' : '') + (mx.lines.length ? c('Return', '−' + money(mx.totals.refund), 'negline') + c(mx.net < 0 ? 'Refund' : 'Total', up ? 'updating…' : money(Math.abs(mx.net)), 'total' + (mx.net < 0 ? ' neg' : '')) : c('Total', up ? 'updating…' : money(t.due), 'total' + (up ? ' updating' : ''))));
  if (up) { clearTimeout(refresh.up); refresh.up = setTimeout(() => { if (!busy) refresh().catch(() => {}); }, 150); } // one more look when the total is in
  drawSaleLogo(); // 1.0.10: owner's logo above the total (picture only, no numbers)
  tileCustCard(); $('info-items').textContent = S.cart.length ? (up ? `${S.cart.length} rows` : `${t.quantity} items`) : ''; 
  document.querySelectorAll('[data-a="tax-off"]').forEach(b => b.classList.toggle('on', !!S.order.taxExempt)); if (window.renderBulk) window.renderBulk(); $('info-payment').textContent = up ? 'Due: updating…' : t.due ? (S.pay && S.pay.paid > 0.004 ? 'Due ' + money(S.pay.remaining) + ' (of ' + money(t.due) + ')' : 'Due ' + money(t.due)) : ''; // 1.0.11-local.4g: part-paid shows what is still owed (display only)
  $('stUser').textContent = `User: ${S.user.user}${S.user.manager ? ' (manager)' : ''}`; $('stSession').textContent = S.session && S.session.number ? `Session ${S.session.number}` : '';
  $('stOrder').textContent = S.lastOrderId ? 'Last sale saved' : '';
  if (window.afterRefresh) window.afterRefresh();
}

// Wrong / unknown barcode: a short message next to the scan box and a beep. No popup, focus stays in the scan box.
let lastScanKey = 0, beepCtx = null, scanMsgT = null;
function beep() {
  try { beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)(); const o = beepCtx.createOscillator(), g = beepCtx.createGain();
    o.type = 'square'; o.frequency.value = 330; g.gain.value = 0.08; o.connect(g); g.connect(beepCtx.destination); o.start(); o.stop(beepCtx.currentTime + 0.25); window.__beeps = (window.__beeps || 0) + 1; } catch {}
}
// Scan sounds (owner request H): own short tones built into the app (app/public/sounds, generated for Air Register).
// On by default; only a manager can turn them off (Settings → Screen). window.__scanSounds counts what played (tests).
const SND = {};
function scanSound(ok) {
  if (S.settings && S.settings.scanSound === false) return;
  const k = ok ? 'ok' : 'bad'; window.__scanSounds = window.__scanSounds || { ok: 0, bad: 0 }; window.__scanSounds[k]++;
  try { const a = SND[k] = SND[k] || new Audio('/sounds/scan-' + k + '.wav'); a.currentTime = 0; const pr = a.play(); if (pr && pr.catch) pr.catch(() => { if (!ok) beep(); }); } catch { if (!ok) beep(); }
}
function scanError(code, why) {
  scanSound(false); toast(''); const m = $('scanMsg'); if (!m) return;
  m.textContent = `✖ Not found: ${String(code).slice(0, 40)}${why && !/not found/i.test(why) ? ' (' + why + ')' : ''} — check the barcode or press Ctrl+F to search`; m.style.display = '';
  $('scanInput').classList.add('bad'); clearTimeout(scanMsgT); scanMsgT = setTimeout(scanOk, 6000);
}
// 1.2.1: Up / Down in the scan box move the selected sale line (clamped at top / bottom, scrolled into view).
// Only the highlight moves; + / - / * / Delete / qty act on whichever line is selected, as before. The scan box keeps focus.
// Line number shown for a register row: sale / return-receipt rows count up from 1 at the top (oldest) to n at the bottom (newest); no-receipt return lines continue after them.
function lineNo(row) { const n = S.mode === 'return' ? ((S.ret && S.ret.subs) || []).length : (S.cart || []).length; return row < n ? n - row : row + 1; }
function moveCartSel(d) {
  const trs = [...document.querySelectorAll('#cart tr.row')]; if (!trs.length) return false;
  // Up / Down follow what is on the screen (rows are drawn in line order, 1 at the top); selectedRow stays the register's own row number
  const at = Math.max(0, trs.findIndex(tr => +tr.dataset.row === (selectedRow ?? 0))), to = Math.max(0, Math.min(trs.length - 1, at + d));
  selectedRow = +trs[to].dataset.row;
  trs.forEach(tr => tr.classList.toggle('sel', +tr.dataset.row === selectedRow));
  const s = trs[to]; if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' });
  return true;
}
function scanOk() { clearTimeout(scanMsgT); const m = $('scanMsg'); if (m) { m.style.display = 'none'; m.textContent = ''; } $('scanInput').classList.remove('bad'); }
const MODAL_OK = new Set(['zoom-in', 'zoom-out', 'zoom-reset', 'calculator']);
async function init() {
  build();
  keys = (await (await fetch('/api/shortcuts')).json()).keys;
  AirposShortcuts.install(keys, entry => {
    if (!S.loggedIn) return;
    if (S.mode === 'clockin' && entry.action !== 'local:help') return;
    if (entry.action !== 'close' && entry.action !== 'local:help' && !MODAL_OK.has(entry.action) && !(/^settings(-|$)/.test(entry.action) && $('stTabs')) && modalOpen()) {
      if (!$('dNew')) return; // a window is open: only Esc / F1 / zoom / calculator
      $('dNew').click(); // the sale-done screen: a shortcut (Ctrl+L, Ctrl+F…) closes it and starts the next step
    }
    run(entry.action);
  }, { scanSelector: '#scanInput', isLogin: () => !S.loggedIn, isConfirm: () => false, isPayment: () => false });
  // belt and braces: reload/close keys never reach the browser
  window.addEventListener('keydown', e => { if (e.key === 'F5' || (e.ctrlKey && ['r', 'R', 'w', 'W'].includes(e.key))) e.preventDefault(); }, true);
  window.addEventListener('beforeunload', e => { if (S.cart && S.cart.length) { e.preventDefault(); e.returnValue = ''; } });
  // Scanner: Enter or Tab suffix ends a code. Codes scanned while the register is busy are queued, never dropped.
  const scanQ = []; let scanning = false;
  const pump = async () => {
    if (scanning) return; scanning = true;
    try { while (scanQ.length) { while (busy) await new Promise(r => setTimeout(r, 30)); const code = scanQ.shift(); selectedRow = 0; const sp = stockPeekStart(code); const r = await act('scan', { code }); if (r && !r.ok && !r.retryable && !r.busy) scanError(code, r.message); else if (r && r.ok) { scanOk(); scanSound(true); stockPeekShow(sp); } else if (r && !r.ok && r.retryable) scanSound(false); } }
    finally { scanning = false; }
  };
  window.queueScan = code => { scanQ.push(code); pump(); };
  $('scanInput').addEventListener('keydown', e => {
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { // 1.2.1: move the selected line (not while a window, the payment screen or help is open)
      if (S.loggedIn && S.mode !== 'clockin' && !modalOpen() && !$('__airpos_help') && moveCartSel(e.key === 'ArrowUp' ? -1 : 1)) e.preventDefault();
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && !e.target.value) { // Left / Right = qty - / + on the highlighted line (empty scan box only)
      if (!S.loggedIn || S.mode === 'clockin' || modalOpen() || $('__airpos_help') || !S.cart || !S.cart.length) return;
      e.preventDefault(); const r = selectedRow ?? 0, n = S.mode === 'return' ? 0 : S.cart.length; if (r >= n) return; // return lines: unchanged
      if (e.key === 'ArrowLeft') { if (!(Number(S.cart[r] && S.cart[r].quantity) > 1)) return; run('qty-minus'); } else run('qty-plus'); // Left never below 1
      return;
    }
    if (e.key !== 'Enter' && e.key !== 'Tab') return; const code = e.target.value.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (e.key === 'Tab') { if (!code) return; e.preventDefault(); }
    if (!code) { // 1.2.0: Enter on an empty scan box with items on the sale = Payment (same as F12). A scanner's Enter after a code still adds the item.
      if (e.key === 'Enter' && !e.repeat && S.mode === 'sale' && S.cart && (S.cart.length || (S.mix && S.mix.lines.length)) && !scanQ.length && !scanning && !busy && !modalOpen() && Date.now() - lastScanKey > 400) { e.preventDefault(); run('checkout'); }
      return;
    }
    const qm = /^\*\s*(\d{1,4}(?:\.\d{1,3})?)$/.exec(code) || /^(\d{1,4}(?:\.\d{1,3})?)\s*\*$/.exec(code);
    if (qm) { e.preventDefault(); e.target.value = ''; if (!S.cart.length) return toast('Scan an item first, then *N sets its quantity', false); act('qty', { row: selectedRow ?? 0, lineId: lid(selectedRow ?? 0), qty: Number(qm[1]) }); return; } // *5 = quantity 5 on the last / selected line
    lastScanKey = Date.now(); e.target.value = ''; window.queueScan(code);
  });
  // clicks go back to the scan box, except in the side panels (quick search, bulk items) and other text boxes
  document.addEventListener('click', e => { const t = e.target; if (t && t.closest && (t.closest('#qsPanel') || t.closest('#bulkPanel') || t.closest('input, select, textarea'))) return; setTimeout(focusScan, 0); });
  $('app').addEventListener('click', e => { if (document.body.classList.contains('paying') && $('refBody') && !(e.target.closest && e.target.closest('[data-a="checkout"]'))) { e.preventDefault(); e.stopPropagation(); closeModal(); refresh(); return; } }, true);
  $('app').addEventListener('click', e => { if (!document.body.classList.contains('paying') || !$('payBody') || !A.__payItems || (e.target.closest && e.target.closest('[data-a="checkout"]'))) return; e.preventDefault(); e.stopPropagation(); A.__payItems(); }, true); // side panel: tap the sale = back to items
  $('helpPill').onclick = () => run('local:help');
  $('setTop').onclick = () => run('settings'); // always-visible Settings in the top bar (also with sidebars hidden)
  setInterval(() => $('stTime').textContent = new Date().toLocaleString('en-US') , 1000);
  await refresh(); focusScan();
  setInterval(() => { if (!busy && !modalOpen()) refresh().catch(() => {}); }, 15000);
}
init();

// 1.0.10 (Ari): owner's logo in the empty band above the total. Only when a logo is set in Settings; fixed same-origin URL.
function drawSaleLogo() {
  const tot = $('totals'); if (!tot) return;
  const l = S.screenPics && S.screenPics.saleLogo, src = l && /^\/screen-picture\/salelogo\?v=[0-9a-f]+$/.test(l.src) ? l.src : null;
  let box = $('saleLogo');
  if (!src) { if (box) box.hidden = true; return; }
  if (!box) { box = document.createElement('div'); box.id = 'saleLogo'; box.className = 'salelogo'; const img = document.createElement('img'); img.alt = ''; img.onerror = () => { box.hidden = true; box.dataset.bad = img.getAttribute('src') || ''; }; box.appendChild(img); tot.parentNode.insertBefore(box, tot); }
  const img = box.firstChild; if (img.getAttribute('src') !== src) img.src = src;
  box.hidden = box.dataset.bad === src;
}

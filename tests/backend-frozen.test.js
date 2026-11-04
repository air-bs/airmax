// Guard: the AIR POS look app changes the LOOK only. Every money / API file in app/lib must stay byte-identical
// to store Air Register 1.2.3 (published Oct 29, 5:01 PM ET) (totals, payment, refund, inventory, AIR POS API, device id handling).
// The only allowed app/lib change is updater.js (own-feed safety checks), and it may only ADD lines.
// Run: node tests/backend-frozen.test.js
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const LIB = path.join(__dirname, '..', 'app', 'lib');
const STORE_1_2_3 = {
  "airpos.js": "3b8e64fdbb9e347d9d35db369fa30cb316ce9eba0c244e6c2a954895b0da1573",
  "cardrefund.js": "d39c4c5ab122c674e3a3874fe67206b35790791c02aae7fc6dcc0391f7b5a1fc",
  "customer.js": "c4f67dbee245d83a7824bbad8d34c0de5e9be8ec6c62d2544cf90a6a6b4f2898",
  "extras.js": "7196b38b238ca03ecf3c45905ec0a6cd12117f0007b7748d2608018ddbfc76f5",
  "hardware.js": "579a56f87bb77ba2ad535f8ea706452839a629f397214b3e0554ecfc76bb5ebb",
  "journal.js": "0af59aa98906e68d54adac65f416692e5e34a9fc82ae96be0a79c5c840c55c40",
  "kiosk.js": "994ce142e98438abe33df95fcac3094f17bb71c4a40b959a87c3358fdcff9120",
  "logfile.js": "fb625a74ad6c31adc6e187e99815683a95e8061819fc09d782c1477f41254f05",
  "printcmd.js": "dd9b8e8f0c5cfbab60951d9b80e2b2c26f0e3aae392e641e6763dd6eccb7e81e",
  "printing.js": "6bbc69e5127bdac211faf9077996d5831156eac2ac2b4966ade6e2e49db96e7d",
  "quickreturn.js": "808446327c9581b749756dae4537392527b25d7a1841ab40367923a0c7f2b042",
  "recovery.js": "36ddd35ee9b004ba497605172f54b3dcfc7d2525792da735d6d20ae042cc4246",
  "register.js": "81e5baf71cc1d098dbfb646ccc04ec0089a5f3c44fe641b3a8d5e5988a4d2ba7",
  "remote.js": "1a3ffba0b92eda5213d52844be83a8ab21c4e228be92e177a8ad1a588e637775",
};
let pass = 0, fail = 0;
const rec = (name, ok, d = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (d ? ' — ' + d : '')); };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
// AirMax 1.0.5 (Ari OK 10:46 PM ET Oct 29): register.js gets the bulk item FOLDERS lines and nothing else. Every added line
// sits between "// bf105 begin" / "// bf105 end" or ends with "// bf105+"; the 3 changed lines end with "// bf105~" and are
// listed below with their exact store text. Taking the 1.0.5 lines out and putting the 3 store lines back must give the
// byte-identical store 1.2.3 file (same sha256), so no money / payment / refund / tax line can have changed.
const BF105_WAS = [
  "  async addBulk(i, price) {",
  "    const slot = (this.settings.bulkItems || [])[Number(i)]; if (!slot) return fail('That bulk item button is empty. Set it up in Settings (Ctrl+,) > Bulk items.');",
  "      settings: (({ exitPinHash, ...x }) => ({ ...x, exitPinSet: !!exitPinHash, bulkItems: x.bulkItems || [], drawerAutoOpen: this.drawerAutoMode(), drawerWaitSec: this.drawerWaitMs() / 1000, drawerPulse: this.printerSettings ? this.printerSettings().drawerPulse : 50 }))(this.settings),",
];
// AirMax 1.0.6 (Ari OK 10:48 PM ET Oct 29): Coach's 1.2.3.1 hotfix lines (way out of "paid, sale not finished"). Added lines sit
// between "// hf1231 begin" / "// hf1231 end" or end with "// hf1231+"; the 4 changed lines end with "// hf1231~" and their store
// text is listed below. Same rule: taking them out must give the byte-identical store 1.2.3 file.
const HF1231_WAS = [
  "    return fail(`AIR POS says ${money(left)} is still owed on this sale (total ${money(this.totals.due)}). The ${money(this.paidTotal())} already taken is kept. Take the remaining ${money(left)}; the sale finishes after that.`, { owed: left, remaining: left });",
  "      else if (pay && SHORT_RE.test(msgOf(c))) return this.shortRefused(pay, o);",
  "      if (pay) pay.lastError = 'The server did not finish the sale: ' + why;",
  "      return fail('Payment taken, but the server did not finish the sale: ' + why + ' Fix it, then press Finish sale.', { completeFailed: true });",
];
// AirMax 1.0.9 (Ari OK 1:25 AM ET Oct 30): card on file. airpos.js only ADDS the 4 card-on-file calls (lines end "// cof109+").
// register.js: the card-on-file methods sit between "// cof109 begin" / "// cof109 end", one added line in the tender ends
// "// cof109+", and the ONE changed payment line (it now passes retailMemberCardId + the masked card) ends "// cof109~"; its store
// text is below. Same rule: taking them out must give the byte-identical store 1.2.3 files.
const COF109_WAS = [
  "      amount, receiveAmount, giveAmount, retailGiftCards: gift.map(c => c.id), recordCreditCard: false, retailMemberCardId: null, creditCard: type === PaymentType.Online ? { cardNo: '', expiration: '', cvv: '' } : null, checkNumber };",
];
let cofAdded = 0;
// AirMax 1.0.9 Remove card fix (Ari OK 2:41 AM ET Oct 30): the cof109+ RetailMemberCardDelete line sends cardId (was id; real AIR POS ignored it).
// AirMax 1.0.9 Team Kit money fix (Ari OK 2:07 AM ET Oct 30): ONE added line in register.js recalc ends "// mon109+" (an amount
// order discount re-works its % from the current items so tax is not cut by an old %). Taking it out must give the same store files.
function stripCof(text, was) { // removes the cof109 lines; returns { lines, k, bad, added }
  const out = []; let inB = false, k = 0, bad = '', added = 0, mon = 0;
  for (const l of text.split('\n')) {
    if (/^\s*\/\/ cof109 begin\s*$/.test(l)) { if (inB) bad = 'cof nested begin'; inB = true; continue; }
    if (/^\s*\/\/ cof109 end\s*$/.test(l)) { if (!inB) bad = 'cof end without begin'; inB = false; continue; }
    if (!inB && / \/\/ mon109\+$/.test(l)) { mon++; continue; }
    if (inB || / \/\/ cof109\+$/.test(l)) { added++; continue; }
    if (/ \/\/ cof109~$/.test(l)) { if (!was || k >= was.length) bad = 'unexpected cof109~'; else out.push(was[k++]); continue; }
    out.push(l);
  }
  if (inB) bad = 'cof block not closed';
  return { lines: out, k, bad, added, mon };
}
// AirMax 1.0.9-local.2 double charge / double refund fix (Ari OK 10:56 AM ET Oct 30, local only; see PLAN-double-charge-refund.md).
// Deliberate change of frozen money files: airpos.js, recovery.js, register.js, quickreturn.js. Added lines end "// dbl109+",
// changed lines end "// dbl109~" and their exact store text is listed below in file order. Taking the dbl109 lines out and putting
// these store lines back must give the files as they were before (then the older rules below give the store 1.2.3 bytes).
const DBL109_WAS = {
  'airpos.js': [],
  'recovery.js': [
    "    if (g && g.unreachable) return 'unknown';",
    "    if (g && g.unreachable) { this.recoveryRetry = true; return { ok: false, notice: 'An unfinished sale was found, but AIR POS cannot be reached to check it. Do not ring it up again yet; Air Register checks again automatically.' }; }",
  ],
  'register.js': [
    "    if (rb && rb.unreachable) {",
    "    return pdf.success ? 'yes' : (pdf.unreachable || pdf.loggedOut || !(pdf.status < 500) || pdf.status === 401 || pdf.status === 403) ? 'unknown' : 'no';",
    "    if (r && r.unreachable) {",
  ],
  'quickreturn.js': [
    "    this.resetReturn(); this.ret.kind = 'nonorder'; this.ret.subs = list.map(x => ({ ...x })); this.ret.payments = pays;",
    "    if (!r.ok) { this.resetReturn(); return r; }",
  ],
};
const DBL109_ADDED = { 'airpos.js': 1, 'recovery.js': 2, 'register.js': 4, 'quickreturn.js': 0 };
function stripFam(tag, label, WASm, ADDm, f, text) {
  const was = WASm[f]; if (!was) { rec(f + ' has no ' + tag + ' lines', !new RegExp(tag).test(text)); return text; }
  const out = []; let k = 0, added = 0, bad = '';
  const reA = new RegExp(' // ' + tag + '\\+$'), reC = new RegExp(' // ' + tag + '~$'), reT = new RegExp(tag);
  for (const l of text.split('\n')) {
    if (reA.test(l)) { added++; continue; }
    if (reC.test(l)) { if (k >= was.length) bad = 'unexpected ' + tag + '~'; else out.push(was[k++]); continue; }
    if (reT.test(l)) bad = 'stray ' + tag + ' tag: ' + l.trim().slice(0, 60);
    out.push(l);
  }
  rec(f + ' ' + label + ' markers well formed (' + was.length + ' changed, ' + ADDm[f] + ' added)', !bad && k === was.length && added === ADDm[f], bad || k + ' changed, ' + added + ' added');
  return out.join('\n');
}
// Part 2 money fixes (Ari OK 11:12 AM ET Oct 30, local only; PLAN-double-charge-refund.md part 2). One tag family per item,
// "// mny109X+" added / "// mny109X~" changed (store text below in file order); stripped newest first, then dbl109.
const MNY109 = [
  ['mny109a', '1.0.9-local.2 (a) one cash/check payment per sale', {
    'register.js': [
      "    // AIR POS keeps ONE cash receive per order: a second cash tender replaces the first, so send the running cash total",
      "    // (bug found in hardening: cash $10 + cash $22.30 was stored as $22.30 only).",
      "    const prevCash = type === PaymentType.Cash ? pay.tenders.find(t => t.status === 'done' && t.type === PaymentType.Cash) : null;",
    ] }, { 'register.js': 2 }],
  ['mny109b', '1.0.9-local.2 (b) no duplicate cash pay-in/out or Z', {
    'register.js': [
      "    if (!r || !r.success) return fail('Z report failed: ' + msgOf(r));",
      "    const bal = Number(val(await this.api.latestBalanceGet())) || 0;",
      "    const r = await this.api.cashTransactionAccess({ id: newGuid(), type, amount, remark: String(remark || '').trim(), balance: expected });",
      "    if (r && r.unreachable) { // reply lost: the drawer balance tells whether it was recorded",
      "      const nb = val(await this.api.latestBalanceGet());",
      "      if (nb == null || (nb && nb.unreachable)) return fail('The connection dropped. Check the drawer balance (Ctrl+K) before trying again, so it is not recorded twice.', { retryable: true });",
      "      if (round(Number(nb)) !== expected) return fail('The connection dropped and AIR POS has no record of it, so nothing was recorded. Press Retry.', { retryable: true });",
      "    } else if (!r || !r.success) return fail('Cash ' + (kind === 'out' ? 'pay-out' : 'pay-in') + ' failed: ' + msgOf(r));",
    ] }, { 'register.js': 24 }],
  ['mny109c', '1.0.9-local.2 (c) exchange credit kept when its payment fails', {
    'quickreturn.js': [
      "    const list = this.mixList(); if (!list.length) return fail('No returned items');",
      "      const t = await this.tender({ type: Cash, tendered: credit, _mix: true });",
      "      if (!t.ok) return { ...t, quickReturn: info, message: `Return recorded (${money(R)}). Exchange credit not taken on the sale: ${t.message}` };",
      "  P.resetOrder = function () { resetOrder.call(this); this.mix = []; this.retOn = false; };",
      "  P.remaining = function () { const r = remaining.call(this); return this.mixPending && this.mixPending() ? Math.max(round(r - this.mixTotals().refund), 0) : r; };",
      "      if (!(this.remaining() > 0)) return this.finishSale();",
      "  P.state = function () { const st = state.call(this); st.mix = this.mixState(); if (st.pay) st.pay.net = st.mix.net; return st; };",
    ] }, { 'quickreturn.js': 32 }],
  ['mny109d', '1.0.9-local.2 (d) keyed card not cancelled after Stripe accepted it', {
    'extras.js': [
      "    c.status = 'waiting'; c.message = 'Card accepted by Stripe. Waiting for AIR POS to record it\u2026'; c.startedAt = Date.now();",
    ],
    'register.js': [

    ],
  }, { 'extras.js': 12, 'register.js': 2 }],
  ['mny109e', '1.0.9-local.2 (e) store credit, points and credit limit per shop (pointSetting.pointByShop)', {
    'extras.js': [
      "    const rows = [...map.values()].slice(0, 50).map(m => ({ id: m.id, number: m.number, name: memberName(m), mobile: m.mobile || m.phone || '', email: m.email || '', points: m.point ?? m.points ?? 0, balance: m.balance ?? 0, status: m.statusName || '' }));",
      "      points: m.point, balance: m.balance, creditAmount: m.creditAmount, allowCreditPayment: m.allowCreditPayment, status: m.statusName, createTime: m.createTime } };",
    ],
  }, { 'extras.js': 12 }],
  // Part 3 smaller bugs (Ari OK 12:32 PM ET Oct 30, local only; PLAN-double-charge-refund.md part 3)
  ['mny109f', '1.0.9-local.2 (f) no empty $0 order from Finish', { 'register.js': [] }, { 'register.js': 1 }],
  ['mny109h', '1.0.9-local.2 (h) no duplicate held order after a bad reply', { 'register.js': [] }, { 'register.js': 3 }],
  ['mny109i', '1.0.9-local.2 (i) clock in/out recheck the session after a bad reply', { 'register.js': [
      "    const r = await this.api.clockIn(a);",
    ] }, { 'register.js': 5 }],
  ['mny109j', '1.0.9-local.2 (j) X report reprint not recorded twice', { 'register.js': [] }, { 'register.js': 16 }],
  ['mny109k', '1.0.9-local.2 (k) gift card top-up/new card after a bad reply (no "already exists")', { 'extras.js': [
      "        const a = await this.api.giftCardAdd(submit); if (!a || !a.success) return fail('Could not create the gift card in AIR POS: ' + msgOf(a));",
    ] }, { 'extras.js': 4 }],
  // 1.0.9-local.7 payment bugs (Ari OK Oct 31 "Yes, everything.", local only; PLAN-double-charge-refund.md part 4)
  ['pb109a', '1.0.9-local.7 (1) terminal card open at a crash / expired login is resumed, never taken again', { 'recovery.js': [
      "      else if (rc && !rc.unreachable && !v.shouldReissue && jc.status === 'waiting' && jc.type === PaymentType.CreditCard) resumeCard = jc;",
    ], 'register.js': [] }, { 'recovery.js': 0, 'register.js': 1 }],
  ['pb109b', '1.0.9-local.7 (2) recovery never replaces a sale being rung (no orphaned payment)', { 'recovery.js': [], 'register.js': [
      "    this.resetOrder(); this.journal.clear('sale complete ' + orderId); // final on the server: nothing to recover any more",
    ] }, { 'recovery.js': 7, 'register.js': 0 }],
  ['pb109c', '1.0.9-local.7 (3) closed while the terminal card was starting: open payment checked', { 'recovery.js': [
      "    const jc = j.pay && j.pay.card; let cardNote = '', resumeCard = null;",
    ] }, { 'recovery.js': 2 }],
  ['pb109d', '1.0.9-local.7 (4) save card: unclear reply read back, no duplicate card', { 'register.js': [
      "    if (!r || r.success === false || (val(r) && val(r).success === false)) return fail('AIR POS did not save the card: ' + (msgOf(r) || 'no reply'));",
    ] }, { 'register.js': 13 }],
  ['pb109e', '1.0.9-local.7 real AIR POS: a Pending order is checked payment by payment (RetailOrderGet refuses it)', { 'recovery.js': [
      "    if (this.replyUnclear(g)) return 'unknown'; // dbl109~",
      "    const g = await this.api.orderGet(j.order.id);",
    ] }, { 'recovery.js': 12 }],
  // 1.0.9-local.9 Stress Tester local.7 fixes (Ari OK 9:24 PM ET Oct 31 "Fix everything, money ones too", local only)
  ['ls9a', '1.0.9-local.9 (a) total went up after the cashier saw it (coupon no longer valid): stop before charging', { 'register.js': [] }, { 'register.js': 18 }], // 13 + 5 (local.9 suite: a cashier change during payment, or an owed total AIR POS already reported, is not a surprise rise)
  ['ls9b', '1.0.9-local.9 (b) promo code AIR POS refused / could not check: honest message, code not left on the sale', { 'register.js': [
      "    code = String(code || '').trim() || null; this.order.promotionalCode = code;",
      "    const before = this.totals.due; await this.recalc();",
      "    return { ok: true, message: code ? `Promo code ${code} applied${this.totals.due < before ? ' (' + money(before - this.totals.due) + ' off)' : ' — no change in price'}` : 'Promo code removed' };",
    ] }, { 'register.js': 9 }],
  ['ls9c', '1.0.9-local.9 (c) amount order discount lowered to the items when an item is removed / quantity lowered: total never below $0', { 'register.js': [] }, { 'register.js': 1 }],
  ['ls9c2', '1.0.10 (Stress Tester S1) ls9c follow-up: the cashier\'s amount order discount is kept; only the applied amount is lowered to the items at each recalc (item added back = full discount again)', { 'register.js': [] }, { 'register.js': 3 }],
  ['ls9d', '1.0.9-local.9 (d) Air Max closed while a pay-in / pay-out was being recorded: told at next login, redo not recorded twice', { 'register.js': [], 'recovery.js': [] }, { 'register.js': 14, 'recovery.js': 2 }],
  // ls9n: user-facing name only ("Air Register" -> "Air Max" in messages/notices/test pages). Each changed line ends "// ls9n~"; its old text is below. No logic changed.
  ['ls9n', '1.0.9-local.9 (n) app name in messages: Air Max (text only)', {"cardrefund.js":["    return `${NOT_DONE} Air Register could not confirm the card refund of ${money(amount)} with AIR POS. Press Retry card refund (it checks first; it never refunds twice).`;"],"extras.js":["      note: stripe || sola ? '' : c.channelType === 0 ? 'No online/keyed card channel is set up in AIR POS back office.' : c.channelType === 20 ? 'This store uses the Sola channel for keyed cards; Air Register only supports Stripe (card data never touches the app).' : 'Keyed card channel is not usable.' };","    if (!r || r.unreachable || r.uncertain || r.loggedOut || (c.accepted && r.success === false)) { if (c.status === 'waiting') this.pollCard(); return fail('Air Register could not check this card payment with AIR POS, so it was not cancelled (the card may have been charged). Wait a moment and try again.', { retryable: true }); } // mny109d+"],"kiosk.js":["  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { error: 'That file is not a picture Air Register can use (PNG or JPG only)' };","    return { ok: true, message: 'Closing Air Register…', exiting: true };","    execFile('shutdown', [act === 'restart' ? '/r' : '/s', '/t', '5', '/c', 'Air Register: ' + (act === 'restart' ? 'restarting' : 'shutting down') + ' the PC'], { windowsHide: true }, e => { if (e) this.log('shutdown failed: ' + e.message); });"],"printcmd.js":["  return Buffer.from(b(init(p), align(1), big(true), encode('TEST PAGE\\n', p.codePage), big(false), bold(true), encode('Air Register\\n', p.codePage), bold(false), align(0),"],"printing.js":["    const lines = ['TEST PAGE - Air Register', ...pc.testLines(p, info), 'If you can read this, printing works.'];","    L.push('Air Register printer diagnostics — ' + new Date().toString());"],"recovery.js":["    if (st === 'unknown') { this.recoveryRetry = true; return { ok: false, notice: `A refund (${money(j.refund)}) was being sent when Air Register closed. AIR POS cannot be reached to check it. Do not refund again yet; Air Register checks again automatically.` }; }","    if (st === 'yes' && j.card > 0) { this.lastReturnId = j.retId; const cash = Math.round((j.refund - j.card) * 100) / 100; return { ok: true, notice: `The refund of ${money(j.refund)}${j.orderNumber ? ' for ' + j.orderNumber : ''} was recorded by AIR POS before Air Register closed. ${cash > 0 ? `Give the ${money(cash)} cash part if not done yet. ` : ''}The card part (${money(j.card)}) is checked with AIR POS now; don't give cash for it.` }; }","    if (st === 'yes') { this.lastReturnId = j.retId; return { ok: true, notice: `The refund of ${money(j.refund)}${j.orderNumber ? ' for ' + j.orderNumber : ''} was recorded by AIR POS before Air Register closed. Give the refund if not done yet; reprint the return receipt from History.` }; }","    return { ok: true, notice: `A refund of ${money(j.refund)} was being sent when Air Register closed, and AIR POS has no record of it: nothing was refunded. Do the return again.` };","    if (this.replyUnclear(g)) { this.recoveryRetry = true; return { ok: false, notice: 'An unfinished sale was found, but AIR POS ' + (g && g.unreachable ? 'cannot be reached' : 'did not give a clear answer') + ' to check it. Do not ring it up again yet; Air Register checks again automatically.' }; } // dbl109~","      return { ok: true, notice: `Sale ${o.number || ''} was already completed before Air Register closed (${money(o.amount + (o.tax || 0))}). Nothing more to do; reprint it from History if needed.` };","      return { ok: true, notice: `Recovered the unfinished sale. The card payment of ${money(resumeCard.submit.amount)} is still open on the terminal: Air Register keeps checking it (it is not charged twice).` };"],"register.js":["    if (!r || r.unreachable || r.uncertain || !(s0 && typeof s0.type === 'number')) return fail('No clear answer from AIR POS about the clock-out (' + (msgOf(r) || 'no reply') + '). Press Clock out again: Air Register checks first.', { retryable: true }); // mny109i+","    if (!r || r.unreachable || r.uncertain || (o && o.id)) return fail('No clear answer from AIR POS about the hold (' + (msgOf(r) || 'no reply') + '). The sale is still here. Press Hold again: Air Register checks first and will not hold it twice.', { retryable: true }); // same id kept: a re-press updates this order, never a second one // mny109h+","    if (pend) { const now = await this.cofIds(id); if (!now) return fail('Air Register could not check yet whether the card from the last try was saved (AIR POS did not answer clearly). Nothing new was started. Try again in a moment.', { retryable: true }); // pb109d+","      if (!clear && !(now && before)) { (this.cofPending = this.cofPending || {})[id] = { ids: before ? before.map(c => c.id) : null, at: Date.now() }; return fail('The connection dropped while saving the card, and Air Register could not check yet whether AIR POS saved it. Do not add it again now: open the customer\\'s cards in a moment. Add card checks this first.', { unknown: true }); } // pb109d+","      if (st === 'unknown') return fail('Still no connection to AIR POS. Air Register will check the earlier payment before taking it again. Press Retry when the connection is back.', { retryable: true });","      if (st === 'unknown') return fail('The connection dropped while sending the payment. Air Register will check with AIR POS before taking it again, so it can never be charged twice. Press Retry.', { retryable: true });","    if (c.kind === 'keyed' && c.accepted) { const v = await this.keyedVerify(c); if (v) return v; if (!this.cardTimer) this.pollCard(); return fail('Stripe already accepted this card, so it cannot be cancelled here (the customer would be charged with nothing on the sale). Air Register keeps checking AIR POS; the sale finishes as soon as AIR POS records it.', { keyedAccepted: true }); } // mny109d+","    const b64 = testPagePdf(['Air Register test page', id.shopName ? 'Shop: ' + id.shopName : '', 'Printer: ' + (this.printerName() || '(automatic)'), new Date().toLocaleString('en-US'), 'If you can read this, printing works.'].filter(Boolean));","      return fail('No clear answer from AIR POS about the Z report (' + (msgOf(r) || 'no reply') + '). It may have been made. Press Generate Z again: Air Register checks first and will not make a second one.', { retryable: true, unknown: true }); } // mny109b+","      if (st === 'unknown') return fail(`No clear answer from AIR POS about the ${word(kind)} of ${money(amount)}. It may have been recorded. Press it again: Air Register checks first and will not record it twice.`, { retryable: true, unknown: true }); // mny109b~","    if (this.ret.sent && !force) return fail('A refund was sent but its reply was lost. Press Refund (Retry) first so Air Register can check whether AIR POS recorded it.', { needForce: true });","      if (st === 'unknown') return fail('Still no connection to AIR POS. Do not hand out the refund yet; press Retry when the connection is back (Air Register checks first, so it is never refunded twice).', { retryable: true });","      if (st === 'unknown') return fail('The connection dropped while sending the refund. Do not hand out money yet: press Retry when the connection is back. Air Register checks first, so it is never refunded twice.', { retryable: true });","    else if (card > 0) res.message += ` Refund ${money(card)} on the card machine now (Air Register only records it in AIR POS).`;"],"remote.js":["    if (!fs.existsSync(script)) return { ok: false, message: 'Remote help files are missing; reinstall Air Register.' };"]}, {"cardrefund.js":0,"extras.js":0,"kiosk.js":0,"printcmd.js":0,"printing.js":0,"recovery.js":0,"register.js":0,"remote.js":0}],
  // ls9r: refund reply was an HTTP error (not a lost connection) and AIR POS has no record: say so instead of "connection dropped" (text only).
  ['ls9r', '1.0.9-local.9 (r) refund error reply worded as an error, not a dropped connection', { 'register.js': ["      if (st === 'unknown') return fail('The connection dropped while sending the refund. Do not hand out money yet: press Retry when the connection is back. Air Max checks first, so it is never refunded twice.', { retryable: true }); // ls9n~","      this.journal.clear('return not recorded'); return fail('The connection dropped and AIR POS has no record of this refund, so nothing was refunded. Press Retry.', { retryable: true });"] }, { 'register.js': 1 }],
  // ls9k: keyed card Stripe accepted, AIR POS never recorded it (Stress Tester M3, seed 6601013): keyed 2-minute message (no terminal),
  // and after 2 minutes + a clear 'not recorded' from AIR POS, Cancel card offers a cashier-confirmed release (AIR POS cancel must agree).
  ['ls9k', '1.0.9-local.9 (k) keyed card stuck after Stripe accepted: correct message + confirmed release', { 'register.js': ["      if (el >= POLL.warnAfter && !c.subMessage) { c.slow = true; c.subMessage = 'Still waiting after 2 minutes. Check the terminal screen: if it shows Approved, wait a moment; otherwise press Cancel card.'; }", "  async cardCancel() {", "    if (c.kind === 'keyed' && c.accepted) { const v = await this.keyedVerify(c); if (v) return v; if (!this.cardTimer) this.pollCard(); return fail('Stripe already accepted this card, so it cannot be cancelled here (the customer would be charged with nothing on the sale). Air Max keeps checking AIR POS; the sale finishes as soon as AIR POS records it.', { keyedAccepted: true }); } // mny109d+ // ls9n~"] , 'extras.js': [] }, { 'register.js': 2, 'extras.js': 15 }],
  // sola109 (Ari OK 9:33 PM ET Oct 31, local only): Sola card on file. Per-store switch in extras.js keyedInfo, Sola add/charge in the
  // register.js cof block + tender, recovery.js keeps checking an open Sola payment after a lost reply / restart (never cancels it).
  ['sola109', '1.0.9 Sola card on file (Ari OK 9:33 PM ET Oct 31, local only)', {
    'extras.js': [
      "    const sola = c.channelType === 20 && this.solaKeyedOn === true;",
      "      note: stripe || sola ? '' : c.channelType === 0 ? 'No online/keyed card channel is set up in AIR POS back office.' : c.channelType === 20 ? 'This store uses the Sola channel for keyed cards; Air Max only supports Stripe (card data never touches the app).' : 'Keyed card channel is not usable.' }; // ls9n~",
    ],
    'register.js': [
      "  // AirMax 1.0.9 card on file (Ari OK 1:25 AM ET Oct 30). Stripe stores only; the Sola route stays blocked. Cards are added only from",
      "  cofStripeOnly() { const k = this.keyedInfo(); if (k.kind === 'stripe') return null;",
      "    return fail(k.channelType === 20 ? 'Cards on file work with Stripe stores only. This store uses the Sola channel, so cards cannot be saved or charged here.' : (k.note || 'Keyed card (Stripe) is not set up in AIR POS back office.'), { notStripe: true }); }",
      "    return { ok: true, stripe: k.kind === 'stripe', test: !!k.test, note: k.kind === 'stripe' ? '' : (this.cofStripeOnly() || {}).message, cards: list.map(c => this.cofCard(c)).filter(c => c.id != null) };",
      "      if (k.kind === 'sola') { const ce = keyedCardError(typedCard); if (ce) return fail(ce + ' Nothing was charged.', { cardError: true }); } }",
      "    const solaCard = type === PaymentType.Online && this.keyedInfo().kind === 'sola' ? typedCard : null;",
      "      if (!cs) { pay.card = { kind: 'keyed', type, submit, tenderId: t.id, status: 'waiting', message: 'Waiting for the server to confirm the keyed card\u2026', subMessage: '', startedAt: Date.now(), polls: 0 }; this.pollCard(); return { ok: true, waiting: true }; }",
    ],
    'recovery.js': [
      "    if (st === 'begun' && ps.type === PaymentType.Online) { // keyed card: nothing is charged until the Stripe form is confirmed, so start it fresh",
      "    const jc0 = j.pay && j.pay.card, jc = jc0 && jc0.submit && (jc0.status === 'waiting' || jc0.status === 'keyed') ? jc0 : jpOpen ? { type: jps.type, submit: jps.submit, status: jps.type === PaymentType.CreditCard ? 'waiting' : 'keyed' } : jc0; let cardNote = '', resumeCard = null; // pb109c~",
      "      else if (!v.shouldReissue && jc.status === 'waiting' && jc.type === PaymentType.CreditCard) resumeCard = jc; // no clear answer: keep checking the same terminal payment, never cancel it and ask to take it again // pb109a~",
      "      this.pay.card = { type: resumeCard.type, submit: resumeCard.submit, tenderId: resumeCard.submit.id, status: 'waiting', message: 'Reconnected: still waiting for the card terminal\u2026', subMessage: '', startedAt: Date.now(), polls: 0 };",
      "      return { ok: true, notice: `Recovered the unfinished sale. The card payment of ${money(resumeCard.submit.amount)} is still open on the terminal: Air Max keeps checking it (it is not charged twice).` }; // ls9n~",
    ],
  }, { 'extras.js': 15, 'register.js': 45, 'recovery.js': 0 }],
  ['ls10h', '1.0.9-local.10 (Stress Tester local.9 LOW Hold): Air Max closed during Hold after AIR POS saved it: told it WAS held, redo not parked twice', { 'register.js': [], 'recovery.js': [] }, { 'register.js': 3, 'recovery.js': 7 }],
  ['ls10d', '1.0.9 (Stress Tester local.10 Hold-differs): Air Max closed during Hold, AIR POS copy differs: told it WAS held, cart kept, Hold updates the same order', { 'register.js': [], 'recovery.js': [] }, { 'register.js': 1, 'recovery.js': 3 }],
  // star110 (1.0.10-local.1, Nov 1, printing only, no money): Star TSP143IIIBI futurePRNT queue refuses RAW jobs. Automatic retries once
  // through the Windows driver and remembers the printer for the session; the Star drawer opens through the driver (Control font).
  ['star110', '1.0.10-local.1 Star futurePRNT: driver retry + driver drawer (printing.js only, no money)', { 'printing.js': ["    if (m === 'driver') { const td = Date.now(); const r = await this.hw.printPdf(b64, this.printerName()); if (this._pt) this._pt.driverPrintMs = Date.now() - td; this.diag(`${label}: driver -> ${r.ok ? 'ok ' + JSON.stringify(r.value) : 'FAIL ' + r.error}`); return r; }", "    if (r.ok || ps.printerConn !== 'windows' || ps.printMethod === 'raw' || r.timeout || r.crashed || r.unavailable || /offline|out of paper|cover|paused|not printing|jam/i.test(r.error || '')) return r;", "    const tf = Date.now(); const d = await this.hw.printPdf(b64, this.printerName()); if (this._pt) { this._pt.driverFallbackMs = Date.now() - tf; this._pt.rawFailed = String(r.error || '').slice(0, 120); }", "    return this.hw.request('raw', { base64: buf.toString('base64'), printer: this.rawPrinterName(), doc: doc || 'Air Register', waitMs: String(waitMs) }, waitMs + 40000);", "      this.diag(`drawer (${p.type}, pin ${p.pin}): ${r.ok ? 'ok ' + JSON.stringify(r.value) : 'FAIL ' + r.error}`); return r;"] }, { 'printing.js': 52 }],
  // cp1010 (1.0.10-local.2, Nov 1, printing messages only, no money): a Star printer on a "Generic / Text Only" queue is refused for
  // direct jobs too (Star raster prints as rows of 'b'); the failed-print notes name Reprint Receipt (Ctrl+P) / Gift Receipt (Ctrl+Alt+P).
  ['cp1010', '1.0.10-local.2 Check printers: Star on a text-only queue + reprint notes + auto print after sale/return + stock warning switch (no money)', {"printing.js": ["  async textOnlyQueue(label) { // star110+", "    const e = `Printer '${one.name}' uses the Windows \"Generic / Text Only\" driver, which prints receipts through the Windows driver as random symbols, so nothing was sent. In Settings > Printer choose ${alt.length ? \"'\" + alt[0] + \"'\" : 'the printer that has its own driver (Star: the futurePRNT \"Star TSP100\" queue)'}, or set Print receipts to Direct to printer`; // star110+", "    this.diag(`${label}: driver path refused on a text-only queue: ${e}`); if (this.log) this.log(`${label}: ${e}`); return { ok: false, error: e, textOnly: true }; // star110+"], "register.js": ["    const [auth, st] = await Promise.all([this.authCheck(), this.stockShort().catch(() => null)]);", "    const pay = this.pay, rule = this.stockRule(); if (rule === 'allows') return null;", "    const TXT = { drawer: \"Cash drawer didn't open — press Open Drawer (Ctrl+D)\", receipt: \"Receipt didn't print, reprint later (History, Ctrl+L)\", gift: \"Gift receipt didn't print, reprint later (History, Ctrl+L)\", return: \"Return receipt didn't print, reprint later (History)\" };", "    if (this.term().checkoutAutoPrint) this.prefetchReceipt(orderId); // 4:01 PM: AIR POS builds the receipt PDF WHILE the drawer kicks", "    if (this.term().checkoutAutoPrint) jobs.push(['receipt', async () => { if (giftBal) await giftBal(); return this.printOrder(orderId); }, this.hwPrintMs || 30000]); // balances are read from AIR POS AFTER Complete, then printed", "    if (this.term().returnAutoPrint) jobs.push(['return', () => this.printReturn(id), this.hwPrintMs || 30000]);"]}, {"printing.js": 11, "register.js": 0}],
  // spd1010 (1.0.10-local.2, Ari 1:40 PM ET Nov 1, printing/timing only, no money): the print path uses the last printer list (re-read AFTER
  // the job, and once after login) so no helper printer-list read sits in front of the receipt; ms per step from payment confirmed in Save diagnostics.
  ['spd1010', '1.0.10-local.2 receipt speed: no printer-list read in front of the receipt + per-step timings (no money)', {"printing.js": ["    const c = this._prnInfo; return c && c.for === '' && Date.now() - c.at < PRN_CACHE_MS && c.v && c.v.resolved ? c.v.resolved : '';", "      type = ps.printerConn === 'network' ? 'generic' : this.detectType(ps.printerConn === 'windows' ? await this.printerInfo() : null);", "    const info = await this.printerInfo(); const one = info && info.one;", "    if (m === 'driver') { const to = await this.textOnlyQueue(label); if (to) return to; const td = Date.now(); const r = await this.hw.printPdf(b64, this.rawPrinterName()); if (this._pt) this._pt.driverPrintMs = Date.now() - td; this.diag(`${label}: driver -> ${r.ok ? 'ok ' + JSON.stringify(r.value) : 'FAIL ' + r.error}`); return r; } // star110~", "    const info = await this.printerInfo(); const one = info && info.one; if (!one || !TEXT_ONLY_RE.test(one.driver || '')) return null; // star110+", "    if (this.lastPrintTimings) L.push('Last receipt timings (ms): ' + JSON.stringify(this.lastPrintTimings));"], "register.js": ["  hwBackground(jobs, ref) {", "    result.hwPending = jobs.map(j => j[0]); Object.defineProperty(result, 'hwJob', { value: this.hwBackground(jobs, orderId), enumerable: false }); // not sent to the screen; tests can await it", "    if (this.printerInfo && this.hw && this.hw.present && this.settings.hardware !== 'airpos') this.printerInfo().catch(() => null);", "    for (const x of got.pdfs) { if (!x.ok) { out.push(x); continue; } this._pt = {}; const t1 = Date.now(); out.push(await this.printPdfBase64(x.b64, x.label)); T.prints.push({ ...this._pt, totalMs: Date.now() - t1 }); this._pt = null; }"]}, {"printing.js": 20, "register.js": 9}],
  ['scf1010', '1.0.10-local.2 split card: card approved for part of the sale closes the card box (Ari OK 2:03 PM ET Nov 1; no amounts or API calls changed)', {"extras.js": ["    if (r && r.success && v.isCompleted) { c.status = 'approved'; c.message = 'Card approved'; c.subMessage = ''; const t = this.pay.tenders.find(x => x.id === c.tenderId); if (t) t.status = 'done'; const res = await this.afterTender(t); if (this.pay) this.pay.result = res; return { ...res, ok: res.ok !== false, alreadyPaid: true, message: 'AIR POS already recorded this card payment, so it was not cancelled. ' + (res.message || '') }; } // mny109d+"], "register.js": []}, {"extras.js": 0, "register.js": 2}],
  ['stk1010', '1.0.10-local.2 out-of-stock: the store rule is learned per store, and the refused-Finish message names the item (Ari OK via parent 2:32 PM ET Nov 1; no amounts, payments or API calls changed)', {"register.js":["  stockRule() { if (this._stockRule) return this._stockRule.rule; try { this._stockRule = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'stock-rule.json'), 'utf8')); } catch { this._stockRule = { rule: 'unknown' }; } return this._stockRule.rule || 'unknown'; }", "    if (this.stockRule() === rule) return; this._stockRule = { rule, at: new Date().toISOString(), why: String(why || '').slice(0, 160) }; this.log(`stock rule learned: ${rule} (${why})`);", "      const why = friendlyComplete(msgOf(c));"]}, {"register.js":4}],
  ['lgo1010', '1.0.10-local.2 logout with payments taken: asks for a second press (no amounts, payments or API calls changed)', {"register.js":[]}, {"register.js":3}],
  ['lgo1011', '1.0.11-local.1 hotfix: the logout second-press OK belongs to one sale (order id + payment) and 30 s, cleared when the sale is reset (no amounts, payments or API calls changed)', {"register.js":["    if (paidOpen && !(this._logoutOk && Date.now() - this._logoutOk < 30000)) { this._logoutOk = Date.now(); return fail(`Payments were already taken on this sale ($${this.paidTotal().toFixed(2)}) and it is not finished. Press Finish sale first. To log out anyway, press Log out again: the payments are kept and the sale comes back after you log in.`, { paidOpen: true }); } // lgo1010+"]}, {"register.js":1}],
  ['f4p1011', '1.0.11-local.3 F4 New price: sent as the existing $-off line discount (discount = original - new), a higher new price is refused, equal = no discount; the cart reports the discount type so the dialog opens prefilled (no new API fields, item price never changed)', {"register.js":["      cart: this.sorted().map(s => { const up = unitPrice(s.quantity * s.rate, s.bulkPriceQuantity, s.price, s.bulkPrice); return { number: s.number, upc: s.upc, name: s.name, type: s.type || 0, quantity: s.quantity, unitName: s.unitName, price: up, discount: round(s.discount || 0, 2), discountAmount: s.discountAmount || 0, custom: !!s.isCustomDiscount, taxRate: s.taxRate, total: round(up * s.quantity * s.rate - (s.discountAmount || 0)) }; }),"]}, {"register.js":1}],
  // gp1011 (1.0.11-local.6g, Ari OK 6:06 PM ET Nov 1, test build, print only): pick-items gift receipt. One added line reads the ticked
  // lines before the cart is cleared; the gift job line picks the no-price slip when some lines are unticked. No totals/payments/API calls.
  ['gp1011', '1.0.11-local.6g pick-items gift receipt (print only, no money)', {"register.js":["    if (giftRcpt) jobs.push(['gift', () => this.printGiftReceipt(orderId), this.hwPrintMs || 30000]); // the store's own AIR POS gift template; nothing invented"]}, {"register.js":1}],
  // airmax-fix-stock (live-store stuck paid sale, Nov 2 2026; build + test only, Ari must approve before it ships): the reason a failed Finish sale gave
  // (refusal / server error / no reply) is kept in pay.refusal, logged, put first in the red box and journalled; no amounts, tenders or API calls change.
  ['airmax-fix-stock', 'airmax-fix-stock (Nov 2): Finish sale failure reason kept (pay.refusal), logged, shown first after Check AIR POS again and after a restart', {"register.js":["      else { if (pay) pay.lastError = 'No connection to AIR POS. The payment is safe; press Finish sale when the connection is back.'; return fail('Payment taken, but the connection to AIR POS dropped before the sale was finished. Nothing is lost: press Finish sale (Retry) when the connection is back.', { completeFailed: true, retryable: true }); }"],"recovery.js":["      pay: p ? { tenders: p.tenders, pendingSubmit: p.pendingSubmit || null,"]}, { 'register.js': 43, 'recovery.js': 1 }],
  // mgc1011 (1.0.11-local.7, Ari OK 6:07 PM ET Nov 1, local test build): one gift card payment per sale (a 2nd gift tender is refused
  // before anything is sent, like GiftCardConfirmer.vue), and after a cash / check / gift / store credit payment the order is read back so
  // only what AIR POS really kept is counted (TestShop RO11052: AIR POS answered OK for a 2nd gift receive and dropped it). Added lines only.
  ['mgc1011', '1.0.11-local.7 one gift card payment per sale + count only what AIR POS kept (added lines only)', {"register.js":[]}, {"register.js":26}],
  ['add1011', '1.0.11-speed.1 adding items: latest-wins total check, the line shows at once and every other step waits for the total (same AIR POS calls and money math)', {"register.js": ["    await this.recalc();", "  async recalc() {"]}, {"register.js": 23}],
  ['tt1011', '1.0.11-local.8 Temporary Item Taxable switch (Ari OK 6:26 PM ET Nov 1): a taxable temp line gets the AIR POS sales tax rate (tax list read from AIR POS, never typed in), Tax Off still clears it; CHANGES TOTALS of taxable temp items only (no payment or refund code changed)', {"register.js":[]}, {"register.js":26}],
  // drw1011 (1.0.11 drawer fix #10, built Nov 2 at Ari's request on claude/step0-measure; APPROVED by Ari Nov 3 2026, branch only until merged, printing only, no money):
  // Star futurePRNT queue: driver drawer first on Automatic too; "queue refuses raw" note saved across restarts (30 days).
  ['drw1011', '1.0.11 drawer fix: Star futurePRNT driver drawer first + raw-refused note kept (printing.js only, no money)', { 'printing.js': ["    if (b.printerName !== undefined || b.printerType !== undefined || b.printMethod !== undefined || b.printerConn !== undefined) { this._rawRejected = null; this._drawerViaDriver = null; } // star110+","  rawRejected() { const x = this._rawRejected; return x && x.for === this.printerName() ? x : null; }, // star110+","    const line = `printer ${this.printerName() || '(automatic)'} refuses raw jobs; it uses the Windows driver (receipts) and the driver drawer signal (Star) for the rest of this session. ${why}`; // star110+","  starDrawerViaDriver(p) { const ps = this.printerSettings(); return p.type === 'star' && ps.printerConn === 'windows' && ps.printMethod !== 'raw' && (ps.printMethod === 'driver' || !!this.rawRejected() || (this._drawerViaDriver && this._drawerViaDriver.for === this.printerName())); }, // star110+"] }, { 'printing.js': 14 }],
  // rcp1011 (#1/#7 receipt right after card approval, approved Nov 3, branch claude/work; card status checks only, no money): every 0.5 s for the first
  // 60 s of a card wait (was 10 s) and the gap counted from the start of the previous check (was from its answer). Never sends a payment.
  ['rcp1011', '1.0.11 card approval seen sooner: 0.5 s checks for 60 s, gap from check start (read-only checks, no money)', { 'register.js': ["const POLL = { fast: 500, slow: 1000, idle: 2000, fastFor: 10000, warnAfter: 120000 };", "      this.cardTimer = setTimeout(once, el < POLL.fastFor ? POLL.fast : (el < POLL.warnAfter ? POLL.slow : POLL.idle));"] }, { 'register.js': 1 }],
  // f4m1011 (F4 New price on multi-buy and weighed items, approved Nov 3, branch claude/f4-multibuy; line discount amount only, item price never changed):
  // the typed price per item is kept when the quantity changes (also across a multi-buy price point) and worked out in whole cents.
  // approved Nov 3 (1.0.11): the typed price also survives Put Aside / Load Aside, Hold / Load Hold and a restart: kept on this PC in
  // f4-prices.json (line id -> price; no customer data, never sent to AIR POS). Same 1 changed line; 20 added lines (was 4).
  ['f4m1011', '1.0.11 F4 New price kept per item across qty / multi-buy changes, whole-cent target (line discount amount only)', { 'register.js': ["    if (kind === 'price') { const per = sub.quantity * sub.rate, orig = per > 0 ? round(amt / per, 2) : 0, raw = arguments[2], np = round(Number(raw), 2); if (raw === '' || raw == null || !Number.isFinite(Number(raw))) return fail('Type the new price'); if (np < 0) return fail('The new price cannot be below $0.00'); if (np > orig + 0.004) return fail(`New price ${money(np)} is higher than the original ${money(orig)}. A new price can only lower the price.`); if (np >= orig - 0.004) { if (sub.isCustomDiscount) { sub.isCustomDiscount = false; sub.discountMethod = DiscountMethod.Percentage; this.applySubDiscount(sub); await this.recalc(); } return { ok: true, message: `${sub.name}: same as the original price ${money(orig)}, no discount` }; } kind = 'amount'; value = round(amt - np * per, 2); } // New price (F4): discount = original - new, sent as the existing $-off line discount; item price never changed // f4p1011+"] }, { 'register.js': 20 }],
  // is1011 (1.0.11 instant scan, approved for 1.0.11): 4 ADDED guard lines, one at the top of startPay, tender, finishSale and hold:
  // while any sale line is still unconfirmed by AIR POS (app/instantscan.js), they refuse with a retry message. No line changed.
  ['is1011', '1.0.11 instant scan: Pay / payment / Complete / Hold refused while a line is unconfirmed (guards only)', { 'register.js': [] }, { 'register.js': 4 }],
  // rp1011 (1.0.11 receipt prefetch, speed only, no money): finishSale asks AIR POS for the receipt template list WHILE Complete runs (1 added
  // line); receiptPdfs uses that answer for the same order instead of asking again after Complete (1 changed line, store text below).
  ['rp1011', '1.0.11 receipt prefetch: template list fetched during Complete (print timing only)', { 'register.js': ["    const cfg = await this.templateConfig(orderId); T.templateConfigMs = Date.now() - t0;"] }, { 'register.js': 1 }],
  // su1011 (1.0.11 startup and search speed, no value changed): login reads the discount list, retail config, session check and card channel
  // together after Home/Index (4 changed lines in login, store text below); customer search starts the shop-points setting read at the same time
  // as the search (1 added + 1 changed line in findMembers; its store text is the mny109e line, stripped next).
  ['su1011', '1.0.11 startup / search speed: independent reads run together (no value changed)', { 'register.js': ["    const dc = await this.api.discountConfigGet(); this.discountConfig = (val(dc) && val(dc).subs) ? val(dc) : { subs: [] };","    if (!this.retailCfg().extraChargeSetting) { const rc = val(await this.api.retailConfigGet()); if (rc && this.home) this.home.retailConfig = { ...rc, ...this.retailCfg() }; }","    await this.checkSession();","    await this.loadKeyed();"], 'extras.js': ["    const shop = await this.pointByShop(); // mny109e~"] }, { 'register.js': 0, 'extras.js': 1 }],
  // rcv1011 (approved 6:41 PM ET Nov 3 2026; branch fix/recovery-receive-verify): recoverSale, when the order read lists no receive for the payment the
  // journal says was being sent, asks AIR POS about that one payment with RetailOrderReceiveCheck (read-only) before saying nothing was paid. Done = adopted
  // (never re-sent); pending card = existing wait/poll; unclear answer = sale stays blocked + notice. Never a ReceiveBegin. Added lines only (12).
  ['rcv1011', '1.0.11 recovery verifies a journaled payment with ReceiveCheck when the order read does not list it (added lines only)', { 'recovery.js': [] }, { 'recovery.js': 12 }],
];
function stripDbl(f, text) {
  for (const [tag, label, W, A] of MNY109.slice().reverse()) text = stripFam(tag, label, W, A, f, text);
  return stripFam('dbl109', '1.0.9-local.2 double charge/refund', DBL109_WAS, DBL109_ADDED, f, text);
}
// Fix #12 (card brand + last 4 slip after the receipt; Ari's request Nov 2, branch claude/receipt-card-brand, print only, no money):
// whole lines between '// airmax-fix-12+' and '// airmax-fix-12-' are ADDED code and are stripped first. Allowlist = exact block and
// line counts per file; any other file with the tag, a nested / unclosed block, or a different count fails.
const FIX12_ALLOW = { 'register.js': { blocks: 3, lines: 6 }, 'extras.js': { blocks: 2, lines: 26 } };
function stripFix12(f, text, quiet) {
  const out = []; let open = false, blocks = 0, lines = 0, bad = '';
  for (const l of text.split('\n')) {
    if (/^\s*\/\/ airmax-fix-12\+\s*$/.test(l)) { if (open) bad = 'nested airmax-fix-12+'; open = true; blocks++; continue; }
    if (/^\s*\/\/ airmax-fix-12-\s*$/.test(l)) { if (!open) bad = 'airmax-fix-12- without +'; open = false; continue; }
    if (open) { lines++; continue; }
    if (/airmax-fix-12/.test(l)) bad = 'stray airmax-fix-12 tag: ' + l.trim().slice(0, 60);
    out.push(l);
  }
  if (open) bad = 'airmax-fix-12 block not closed';
  const a = FIX12_ALLOW[f] || { blocks: 0, lines: 0 };
  if (!quiet) rec(f + ' fix #12 card slip blocks well formed (' + a.blocks + ' blocks, ' + a.lines + ' added lines)', !bad && blocks === a.blocks && lines === a.lines, bad || blocks + ' blocks, ' + lines + ' lines');
  return out.join('\n');
}
// AirMax #18 (Ari, Nov 2 2026; display / print only, nothing about the sale changes): each discounted item's "33% off -$9.90" line on
// the receipt. register.js gets exactly two tagged blocks, each "// airmax-fix-18+" ... "// airmax-fix-18-" around ONE added line
// (finishSale: the sale's lines are read for its receipt before the cart is cleared; printOrderCore: the receipt's print copy gets the
// lines). The blocks only ADD lines: taking them out, markers included, must give the file exactly as before, so every older rule
// below still proves the store 1.2.3 bytes. No other app/lib file may have them, and the added lines call no AIR POS API and touch no
// total, payment or cart field. Stripped first (newest change).
const FIX18 = { 'register.js': { blocks: 2, lines: 2 } };
function strip18(f, text, record) {
  const want = FIX18[f] || { blocks: 0, lines: 0 }, out = [], added = []; let inB = false, blocks = 0, bad = '';
  for (const l of text.split('\n')) {
    if (/^\s*\/\/ airmax-fix-18\+\s*$/.test(l)) { if (inB) bad = 'nested airmax-fix-18+'; inB = true; blocks++; continue; }
    if (/^\s*\/\/ airmax-fix-18-\s*$/.test(l)) { if (!inB) bad = 'airmax-fix-18- without a +'; inB = false; continue; }
    if (inB) { added.push(l); continue; }
    if (/airmax-fix-18/.test(l)) bad = 'stray airmax-fix-18 tag: ' + l.trim().slice(0, 60);
    out.push(l);
  }
  if (inB) bad = bad || 'airmax-fix-18 block not closed';
  if (record && (f in FIX18 || blocks || bad)) {
    rec(f + ' #18 airmax-fix-18 blocks well formed (' + want.blocks + ' blocks, ' + want.lines + ' added lines, no changed line)', !bad && blocks === want.blocks && added.length === want.lines, bad || blocks + ' blocks, ' + added.length + ' lines');
    rec(f + ' #18 added lines make no AIR POS call and touch no total, payment, order or cart field', !/this\.api\b|this\.(totals|pay|order|subs|member|usingPoints|completed)\b|\.tender\(|recalc\(|saveSubmit|this\.ret\b/.test(added.join('\n')), added.map(l => l.trim().slice(0, 50)).join(' | '));
  }
  return out.join('\n');
}
// #19 (owner, Nov 2026; print only, not merged until he approves): gift card last 4 + balance on the receipt's print copy. extras.js
// printGiftSlip gets ONE tagged block "// gc19+" ... "// gc19-" around ONE added line (no slip when that receipt was stamped). Blocks only
// add lines: taking them out, markers included, must give the file exactly as before. No other app/lib file has them; the added line
// makes no AIR POS call and touches no total, payment or cart field. Stripped first (newest change).
const GC19 = { 'extras.js': { blocks: 1, lines: 1 } };
function stripGc19(f, text, record) {
  const want = GC19[f] || { blocks: 0, lines: 0 }, out = [], added = []; let inB = false, blocks = 0, bad = '';
  for (const l of text.split('\n')) {
    if (/^\s*\/\/ gc19\+\s*$/.test(l)) { if (inB) bad = 'nested gc19+'; inB = true; blocks++; continue; }
    if (/^\s*\/\/ gc19-\s*$/.test(l)) { if (!inB) bad = 'gc19- without a +'; inB = false; continue; }
    if (inB) { added.push(l); continue; }
    if (/gc19/.test(l)) bad = 'stray gc19 tag: ' + l.trim().slice(0, 60);
    out.push(l);
  }
  if (inB) bad = bad || 'gc19 block not closed';
  if (record && (f in GC19 || blocks || bad)) {
    rec(f + ' #19 gc19 blocks well formed (' + want.blocks + ' block, ' + want.lines + ' added line, no changed line)', !bad && blocks === want.blocks && added.length === want.lines, bad || blocks + ' blocks, ' + added.length + ' lines');
    rec(f + ' #19 added line makes no AIR POS call and touches no total, payment, order or cart field', !/this\.api\b|this\.(totals|pay|order|subs|member|usingPoints|completed)\b|\.tender\(|recalc\(|saveSubmit|this\.ret\b/.test(added.join('\n')), added.map(l => l.trim().slice(0, 50)).join(' | '));
  }
  return out.join('\n');
}
// #fp6 (AirMax Batch 6, approved Nov 3 2026): manager approval by fingerprint. kiosk.js managerCheck gets ONE tagged block "// fp6+" ... "// fp6-"
// around ONE added line: a body with the user name "@fingerprint" is approved only when this.fpApproval (set by app/api/fingerprints.js, which asked
// the AIR POS server and the :20001 service itself) knows the one-time token sent as the password. Blocks only add lines: taking them out, markers
// included, must give the file exactly as before. No other app/lib file has them; the added line makes no AIR POS call and touches no total,
// payment, order or cart field. Stripped first (newest change).
const FP6 = { 'kiosk.js': { blocks: 1, lines: 1 } };
function stripFp6(f, text, record) {
  const want = FP6[f] || { blocks: 0, lines: 0 }, out = [], added = []; let inB = false, blocks = 0, bad = '';
  for (const l of text.split('\n')) {
    if (/^\s*\/\/ fp6\+\s*$/.test(l)) { if (inB) bad = 'nested fp6+'; inB = true; blocks++; continue; }
    if (/^\s*\/\/ fp6-\s*$/.test(l)) { if (!inB) bad = 'fp6- without a +'; inB = false; continue; }
    if (inB) { added.push(l); continue; }
    if (/fp6/.test(l)) bad = 'stray fp6 tag: ' + l.trim().slice(0, 60);
    out.push(l);
  }
  if (inB) bad = bad || 'fp6 block not closed';
  if (record && (f in FP6 || blocks || bad)) {
    rec(f + ' #fp6 fp6 blocks well formed (' + want.blocks + ' block, ' + want.lines + ' added line, no changed line)', !bad && blocks === want.blocks && added.length === want.lines, bad || blocks + ' blocks, ' + added.length + ' lines');
    rec(f + ' #fp6 added line makes no AIR POS call and touches no total, payment, order or cart field', !/this\.api\b|this\.(totals|pay|order|subs|member|usingPoints|completed)\b|\.tender\(|recalc\(|saveSubmit|this\.ret\b/.test(added.join('\n')), added.map(l => l.trim().slice(0, 50)).join(' | '));
  }
  return out.join('\n');
}
function storeOf(f) {
  const buf = Buffer.from(stripDbl(f, strip18(f, stripFix12(f, stripGc19(f, stripFp6(f, fs.readFileSync(path.join(LIB, f), 'utf8'), true), true)), true)), 'utf8');
  if (f === 'airpos.js') { const c = stripCof(buf.toString('utf8'), []); rec('airpos.js 1.0.9 card-on-file lines only added (4 calls + 1 note, no changed line)', !c.bad && c.k === 0 && c.added === 5 && c.mon === 0, c.bad || c.added + ' added'); { const del = buf.toString('utf8').split('\n').filter(l => /RetailMemberCardDelete/.test(l)); rec('airpos.js 1.0.9 Remove card sends { retailMemberId, cardId } like the real AIR POS app (cofdel fix, Ari OK 2:41 AM)', del.length === 1 && /\{ retailMemberId, cardId \}/.test(del[0]) && !/\bid \}/.test(del[0]) && / \/\/ cof109\+$/.test(del[0]), del.join(' | ').trim().slice(0, 160)); } return Buffer.from(c.lines.join('\n'), 'utf8'); }
  if (f !== 'register.js') return buf;
  const out = []; let inBlock = false, k = 0, bad = '';
  let hBlock = false, hk = 0; // hf1231 (1.0.6)
  const cof = stripCof(buf.toString('utf8'), COF109_WAS);
  rec('register.js 1.0.9 card-on-file markers well formed (1 changed payment line, block closed)', !cof.bad && cof.k === COF109_WAS.length, cof.bad || cof.k + ' changed lines');
  rec('register.js 1.0.9 money fix: exactly 1 added recalc line (// mon109+), nothing else', cof.mon === 1 && (buf.toString('utf8').match(/mon109/g) || []).length === 1, cof.mon + ' mon109 lines');
  for (const l of cof.lines) {
    if (/^\s*\/\/ hf1231 begin/.test(l)) { if (hBlock || inBlock) bad = 'nested begin'; hBlock = true; continue; }
    if (/^\s*\/\/ hf1231 end\s*$/.test(l)) { if (!hBlock) bad = 'hf end without begin'; hBlock = false; continue; }
    if (hBlock || / \/\/ hf1231\+$/.test(l)) continue;
    if (/ \/\/ hf1231~$/.test(l)) { out.push(HF1231_WAS[hk++]); continue; }
    if (/^\s*\/\/ bf105 begin/.test(l)) { if (inBlock) bad = 'nested begin'; inBlock = true; continue; }
    if (/^\s*\/\/ bf105 end\s*$/.test(l)) { if (!inBlock) bad = 'end without begin'; inBlock = false; continue; }
    if (inBlock || /\/\/ bf105\+/.test(l)) continue;
    if (/ \/\/ bf105~$/.test(l)) { out.push(BF105_WAS[k++]); continue; }
    out.push(l);
  }
  rec('register.js 1.0.5 bulk-folder markers well formed (3 changed lines, blocks closed)', !bad && !inBlock && k === BF105_WAS.length, bad || k + ' changed lines');
  rec('register.js 1.0.6 hotfix markers well formed (4 changed lines, blocks closed)', !bad && !hBlock && hk === HF1231_WAS.length, bad || hk + ' changed lines');
  return Buffer.from(out.join('\n'), 'utf8');
}
const shaB = b => crypto.createHash('sha256').update(b).digest('hex');
for (const [f, h] of Object.entries(STORE_1_2_3)) rec('app/lib/' + f + (f === 'register.js' ? ' = store 1.2.3 + only the 1.0.5 bulk-folder lines + the 1.0.6 hotfix lines + the 1.0.9 card-on-file lines' : f === 'airpos.js' ? ' = store 1.2.3 + only the 1.0.9 card-on-file calls' : ' identical to store 1.2.3'), fs.existsSync(path.join(LIB, f)) && shaB(storeOf(f)) === h);
const extra = fs.readdirSync(LIB).filter(f => !(f in STORE_1_2_3) && f !== 'updater.js');
rec('no new files in app/lib', extra.length === 0, extra.join(','));
// updater.js: every store line still present in order, except the one comment that named the store installer
const store = '/workspace/air-register-1.2.3-release/app/lib/updater.js';
if (fs.existsSync(store)) {
  const a = fs.readFileSync(store, 'utf8').split('\n').filter(l => !/AirRegister-Standalone-Setup/.test(l)), b = fs.readFileSync(path.join(LIB, 'updater.js'), 'utf8').split('\n');
  let j = 0; for (const l of b) if (j < a.length && l === a[j]) j++;
  rec('updater.js only adds lines to the store version (read-only compare)', j === a.length, j + '/' + a.length + ' store lines kept');
} else console.log('NOTE store 1.2.3 folder not found; updater.js compare not run');
// 1.0.6: the hf1231 lines are exactly Coach's 1.2.3.1 hotfix (read-only compare): AirMax register.js with the 1.0.5 lines taken out
// and the hf1231 tags removed must equal the hotfix register.js byte for byte.
const HOTFIX = '/workspace/air-register-1.2.3.1-hotfix/app/lib/register.js';
if (fs.existsSync(HOTFIX)) {
  const o = []; let inB = false, k2 = 0;
  for (const l of stripCof(stripDbl('register.js', strip18('register.js', stripFix12('register.js', fs.readFileSync(path.join(LIB, 'register.js'), 'utf8'), true))), COF109_WAS).lines) {
    if (/^\s*\/\/ hf1231 (begin|end)\s*$/.test(l)) continue;
    if (/^\s*\/\/ bf105 begin/.test(l)) { inB = true; continue; } if (/^\s*\/\/ bf105 end\s*$/.test(l)) { inB = false; continue; }
    if (inB || /\/\/ bf105\+/.test(l)) continue; if (/ \/\/ bf105~$/.test(l)) { o.push(BF105_WAS[k2++]); continue; }
    o.push(l.replace(/ \/\/ hf1231[+~]$/, ''));
  }
  rec('register.js 1.0.6 lines = Coach 1.2.3.1 hotfix register.js exactly (read-only compare)', o.join('\n') === fs.readFileSync(HOTFIX, 'utf8'));
} else console.log('NOTE 1.2.3.1 hotfix folder not found; hotfix compare not run');
console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);

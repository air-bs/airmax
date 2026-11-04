'use strict';
// Store request #21 (Nov 2): a note saved on the customer account (AIR POS member "remark", e.g. "account locked", "needs approval from ...")
// pops up as soon as that customer is on the sale. READ ONLY: one RetailMemberGet look-up per customer attached (the call the Customer
// window already makes), the answer is kept in memory only. Nothing is saved, nothing is written to disk, the note text is never logged.
// Lives outside the frozen app/lib (tests/backend-frozen.test.js), like reprint.js / labels.js.
const MAX = 600;
const clean = v => String(v == null ? '' : v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, MAX);
class MemberNote {
  constructor({ reg, log }) { this.reg = reg; this.log = log || (() => {}); this.cache = null; this.busy = null; this.fails = 0; }
  // called on every /api/state: cheap compare; the look-up itself runs in the background, never delays the screen
  current() { // { id, ready, remark }: ready=false while the look-up runs (the screen asks again a moment later)
    const m = this.reg.member, id = m && m.id;
    if (!id) { this.cache = null; this.fails = 0; return null; }
    if (this.cache && this.cache.id === id) return { id, ready: true, remark: this.cache.remark };
    if (this.fails >= 3) return { id, ready: true, remark: '' };
    if (!this.busy) this.fetch(id);
    return { id, ready: false, remark: '' };
  }
  fetch(id) {
    this.busy = id;
    Promise.resolve().then(() => this.reg.api.memberGet(id)).then(r => {
      const m = r && r.success === false ? null : (r && typeof r === 'object' && 'value' in r ? r.value : r);
      if (this.reg.member && this.reg.member.id === id) { this.cache = { id, remark: m && m.id ? clean(m.remark) : '' }; if (!m || !m.id) this.fails++; }
    }).catch(e => { this.fails++; this.log('customer note look-up failed: ' + String(e && e.message || e).slice(0, 120)); }).finally(() => { if (this.busy === id) this.busy = null; });
  }
}
module.exports = { MemberNote, clean };

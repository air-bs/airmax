// AirMax Batch 5 (Customers: files and history), server side. Loaded by server.js from app/api/ (Step 0 loader); adds routes only.
//   83 RetailMemberAttachmentSelect  -> cust-files-list     (read)
//   31 FileMultipleUpload (baseserv) -> cust-file-upload    (write: stores the file on AIR POS, links nothing)
//   84 RetailMemberAttachmentAdd     -> cust-file-attach    (write: links uploaded files to one customer)
//   31 + 84 in one go (what the screen uses, like AIR POS's own Upload Attachment button) -> cust-file-add
//   85 RetailMemberAttachmentDelete  -> cust-file-remove    (write: needs confirmed:true; the screen asks first, AIR POS does not)
//   80 RetailMemberTransactionPaged  -> cust-tx-list        (read, paged: the customer's transaction records)
//   81 RetailBalanceRecordPaged      -> cust-bal-list       (read, paged: the customer's account balance records)
//   82 RetailPointRecordPaged        -> cust-pts-list       (read, paged: the customer's point records)
//   RetailMemberGet / #78 RetailMemberUpdate -> cust-credit-get / cust-credit-save   (MANAGER ONLY editor: Allow Credit Payment + Credit Amount)
// Who may use what: every route needs the AIR POS "Member Management" menu (the screen's own permission; a super admin has it). The credit editor also
// needs the manager flag (RetailManager). Checked here on the server, not only by hiding the screen.
// Customer files can hold private documents: file names and contents are NEVER logged (only counts and the outcome), nothing is kept on this PC.
// AIR POS is called through reg.api.retail() / reg.api.submit(). The one exception is the upload: reg.api.call() can only send text form
// fields, so call 31 builds its multipart request here and sends it with the register's own headers (reg.api.headers(), the session token stays in
// memory and is never logged). app/lib is not touched.
'use strict';
const crypto = require('crypto');
const { HOSTS } = require('../lib/airpos');

const MAX_FILES = 10, MAX_BYTES = 650 * 1024, MAX_NAME = 120;                     // one JSON request is capped at 1,000,000 characters in server.js
const val = r => (r && typeof r === 'object' && !Array.isArray(r) && 'success' in r && 'value' in r ? r.value : r); // reads may come bare or as { success, value }
const bad = r => !r || (typeof r === 'object' && !Array.isArray(r) && r.success === false);
const msgOf = r => String((r && r.message) || 'AIR POS did not answer').slice(0, 200);
const failure = r => ({ ok: false, message: msgOf(r), ...(r && r.loggedOut ? { loggedOut: true } : {}), ...(r && r.uncertain ? { uncertain: true } : {}), ...(r && r.unreachable ? { unreachable: true } : {}) });
const idOk = s => typeof s === 'string' && /^[\w-]{1,64}$/.test(s);
const cleanName = n => String(n == null ? '' : n).replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').trim().slice(0, MAX_NAME);
const extOf = n => { const m = /\.([A-Za-z0-9]{1,10})$/.exec(n); return m ? m[1].toLowerCase() : ''; };

module.exports = ctx => {
  const { reg, log } = ctx;

  // call 31: multipart POST of the picked files to baseserv, field name "files" (MemberAttachmentDrawer.vue handleFileSelect)
  async function upload(files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', new Blob([f.buf], { type: 'application/octet-stream' }), f.name);
    let res, data;
    try {
      res = await fetch(HOSTS.base + '/Files/FileMultipleUpload', { method: 'POST', headers: reg.api.headers(), body: fd, signal: AbortSignal.timeout(60000) });
      const text = await res.text();
      try { data = JSON.parse(text); } catch (e) { data = { success: false, message: 'Non-JSON reply (HTTP ' + res.status + ')' }; }
      if (res.status >= 500) data = Object.assign(data && typeof data === 'object' ? data : { success: false, message: 'HTTP ' + res.status }, { uncertain: true });
    } catch (e) { data = { success: false, message: 'Network error: ' + ((e.cause && e.cause.code) || e.name || e.message), unreachable: true }; }
    if (data && (data.errorCode === 1003 || data.errorCode === 1004)) { reg.api.reset(); data.loggedOut = true; }
    log('BASE /Files/FileMultipleUpload (' + files.length + ' file(s)) -> ' + (res ? res.status : 'ERR') + ' ' + (data && data.success === false ? 'FAIL: ' + msgOf(data).slice(0, 100) : 'ok'));
    return data;
  }

  // body.files = [{ name, data }]  data = base64 of the file. Returns { files:[{name, buf}] } or { error }
  function readFiles(list) {
    if (!Array.isArray(list) || !list.length) return { error: 'Choose at least one file' };
    if (list.length > MAX_FILES) return { error: 'At most ' + MAX_FILES + ' files at a time' };
    const out = [];
    for (const f of list) {
      const name = cleanName(f && f.name);
      if (!name) return { error: 'A file has no name' };
      if (!f || typeof f.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)) return { error: 'The file could not be read' };
      const buf = Buffer.from(f.data, 'base64');
      if (!buf.length) return { error: 'The file is empty' };
      if (buf.length > MAX_BYTES) return { error: 'A file is too big here (limit ' + Math.floor(MAX_BYTES / 1024) + ' KB each)' };
      out.push({ name, buf });
    }
    return { files: out };
  }

  const uploaded = r => (Array.isArray(val(r)) ? val(r) : []).filter(x => x && typeof x === 'object');

  // call 84: link uploaded files to one customer. Each gets a new GUID id, like AIR POS (utils.newGuid()).
  async function attach(retailMemberId, items) {
    const files = items.map(x => ({ id: crypto.randomUUID(), name: x.name, path: x.path, extension: x.extension }));
    return reg.api.submit('/RetailMembers/RetailMemberAttachmentAdd', { retailMemberId, files });
  }

  // ---- permissions (server side; the screen also hides what is not allowed)
  const MENU = 'Member Management';
  const noMenu = () => (ctx.hasMenu(MENU) ? null : { ok: false, forbidden: true, message: 'This login does not have Member Management in AIR POS' });
  const noManager = () => noMenu() || (ctx.isManager() ? null : { ok: false, forbidden: true, message: 'Only a manager can change credit' });
  const gate = (fn, strict) => async b => { const no = strict ? noManager() : noMenu(); return no || fn(b || {}); };

  const num = x => (typeof x === 'number' && isFinite(x) ? x : Number(x) || 0);
  const round2 = x => Math.round(num(x) * 100) / 100;
  const pointByShop = async () => { try { return typeof reg.pointByShop === 'function' ? !!(await reg.pointByShop()) : true; } catch (e) { return true; } };
  const ymd = (s, endOfDay) => { // 'YYYY-MM-DD' -> the instant AIR POS's date picker sends (local midnight, as ISO text); null = no limit
    if (s == null || s === '') return { v: null };
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s)); if (!m) return { error: 'The date should look like 2026-11-02' };
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); if (isNaN(d) || d.getMonth() !== Number(m[2]) - 1) return { error: 'That date does not exist' };
    return { v: d.toISOString() };
  };
  const pickInt = (x, allowed, what) => { if (x == null || x === '') return { v: null }; const n = Number(x); return Number.isInteger(n) && allowed.includes(n) ? { v: n } : { error: 'Unknown ' + what }; };
  const pickTarget = x => { if (x == null || x === '') return { v: null }; const t = String(x).trim(); return t.length <= 40 && !/[\u0000-\u001f]/.test(t) ? { v: t || null } : { error: 'That order number is not valid' }; };
  // one paged read: filter + pageInfo as AIR POS's drawers send them (two JSON texts), rows mapped to what the screen shows
  async function paged(path, b, filterExtra, mapRow) {
    if (!idOk(b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
    if (filterExtra.error) return { ok: false, message: filterExtra.error };
    const page = Math.min(Math.max(parseInt(b.page, 10) || 1, 1), 100000), pageSize = Math.min(Math.max(parseInt(b.pageSize, 10) || 20, 1), 100);
    const r = await reg.api.retail(path, { filter: JSON.stringify({ retailMemberId: b.retailMemberId, ...filterExtra.f }), pageInfo: JSON.stringify({ page, pageSize, amount: 0 }) });
    if (bad(r)) return failure(r);
    const v = val(r) || {}, rows = Array.isArray(v.rows) ? v.rows : Array.isArray(v) ? v : [];
    const byShop = await pointByShop();
    return { ok: true, rows: rows.filter(x => x && typeof x === 'object').map(x => mapRow(x, byShop)), total: Number(v.total) || rows.length, page, pageSize, pointByShop: byShop };
  }
  const money2 = x => round2(x);
  const s80 = (x, byShop) => ({ id: String(x.id || ''), number: String(x.transactionNumber || ''), time: String(x.transactionTime || ''), type: x.transactionType, typeName: String(x.transactionTypeName || ''), shop: String(x.retailShopName || ''),
    payments: (Array.isArray(x.payments) ? x.payments : []).map(q => ({ name: String(q.paymentTypeName || ''), amount: money2(q.amount) })), amount: money2(x.transactionAmount), balanceAffected: money2(x.balanceAffected), balance: money2(byShop ? x.shopBalanceSnap : x.balanceSnap) });
  const s81 = x => ({ id: String(x.id || ''), target: String(x.targetNumber || ''), type: x.type, typeName: String(x.typeName || ''), amount: money2(x.amount), time: String(x.createTime || ''), shop: String(x.retailShopName || '') });
  const s82 = x => ({ id: String(x.id || ''), target: String(x.targetNumber || ''), type: x.type, typeName: String(x.typeName || ''), points: num(x.points), usedPoints: num(x.usedPoints), time: String(x.createTime || ''), expires: String(x.expiredTime || ''), status: x.status, statusName: String(x.statusName || '') });

  // the credit fields of one customer: the shop's own when the shop keeps points per shop (AIR POS: MemberManage handleEditMember / AccountDetailsDrawer)
  const creditOf = (m, byShop) => ({ allow: !!(byShop ? m.shopAllowCreditPayment : m.allowCreditPayment), amount: round2(byShop ? m.shopCreditAmount : m.creditAmount), balance: round2(byShop ? m.shopBalance : m.balance) });

  const routes = {
    // 80: transaction records (Only Balance Affected is ON by default, like AIR POS)
    'cust-tx-list': gate(b => { const t = pickInt(b.transactionType, [10, 20, 30], 'type'), bg = ymd(b.beginDate), en = ymd(b.endDate);
      return paged('/RetailMembers/RetailMemberTransactionPaged', b, t.error || bg.error || en.error ? { error: t.error || bg.error || en.error } : { f: { transactionType: t.v, beginDate: bg.v, endDate: en.v, onlyBalanceAffected: b.onlyBalanceAffected !== false } }, s80); }),
    // 81: account balance records (type: 10 Expense, 20 Recharge, 30 Refund)
    'cust-bal-list': gate(b => { const t = pickInt(b.type, [10, 20, 30], 'type'), n = pickTarget(b.targetNumber);
      return paged('/RetailBalanceRecords/RetailBalanceRecordPaged', b, t.error || n.error ? { error: t.error || n.error } : { f: { targetNumber: n.v, type: t.v, status: null } }, s81); }),
    // 82: point records (type 1..4, status 1 Enabled, 2 Expired, 3 Used)
    'cust-pts-list': gate(b => { const t = pickInt(b.type, [1, 2, 3, 4], 'type'), st = pickInt(b.status, [1, 2, 3], 'status'), n = pickTarget(b.targetNumber);
      return paged('/RetailPointRecords/RetailPointRecordPaged', b, t.error || st.error || n.error ? { error: t.error || st.error || n.error } : { f: { targetNumber: n.v, type: t.v, status: st.v } }, s82); }),
    // manager editor, read: the current Allow Credit Payment / Credit Amount (and the store credit balance, read only)
    'cust-credit-get': gate(async b => {
      if (!idOk(b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
      const r = await reg.api.memberGet(b.retailMemberId), m = val(r);
      if (bad(r) || !m || !m.id) return failure(r || { message: 'Customer not found' });
      const byShop = await pointByShop(); return { ok: true, ...creditOf(m, byShop), pointByShop: byShop };
    }, true),
    // manager editor, write (needs confirmed:true AND the manager's user name + password): sends the WHOLE customer record back with only the two credit fields changed (what AIR POS's own save does), after a fresh read
    'cust-credit-save': gate(async b => {
      if (!idOk(b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
      if (typeof b.allow !== 'boolean') return { ok: false, message: 'Choose Allow Credit Payment on or off' };
      const amount = typeof b.amount === 'number' ? b.amount : /^\d{1,9}(\.\d{1,2})?$/.test(String(b.amount == null ? '' : b.amount).trim()) ? Number(String(b.amount).trim()) : NaN;
      if (!isFinite(amount) || amount < 0 || amount > 9999999 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return { ok: false, message: 'Credit Amount must be a number from 0 to 9,999,999 with at most 2 decimals' };
      if (b.confirmed !== true) return { ok: false, needsConfirm: true, message: 'Confirm before changing credit' };
      // the manager unlocks the change by typing their AIR POS user name + password (checked by AIR POS, same as manager approvals; no PIN here). Never logged.
      // the owner (Nov 3): the session user is a manager -> no password re-check; anyone else must still pass the manager check
      const mc = ctx.isManager() ? { ok: true } : await reg.managerCheck({ user: b.user, password: b.password });
      if (!mc || !mc.ok) return { ok: false, needManager: true, message: (mc && mc.message) || 'Manager login failed' };
      const r = await reg.api.memberGet(b.retailMemberId), m = val(r);
      if (bad(r) || !m || !m.id) return failure(r || { message: 'Customer not found' });
      const submit = { id: m.id, number: m.number, mobile: m.mobile, phone: m.phone, firstName: m.firstName, middleName: m.middleName, lastName: m.lastName, company: m.company, email: m.email, receiveAutoEmail: m.receiveAutoEmail,
        province: m.province, city: m.city, address: m.address, zipCode: m.zipCode, discount: m.discount, remark: m.remark, status: m.status, creditAmount: round2(amount), allowCreditPayment: b.allow };
      const u = await reg.api.memberUpdate(submit);
      if (!u || u.success === false) return failure(u);
      log('customers: credit settings changed for 1 customer');
      return { ok: true, message: String(u.message || 'Saved'), allow: b.allow, amount: round2(amount) };
    }, true),
    // 83: [{ id, name, path, extension }] for one customer (no file contents)
    'cust-files-list': async b => {
      if (!idOk(b && b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
      const r = await reg.api.retail('/RetailMembers/RetailMemberAttachmentSelect', { retailMemberId: b.retailMemberId });
      if (bad(r)) return failure(r);
      const rows = (Array.isArray(val(r)) ? val(r) : []).filter(x => x && typeof x === 'object').map(x => ({ id: String(x.id || ''), name: String(x.name || ''), path: String(x.path || x.filePath || ''), extension: String(x.extension || extOf(String(x.name || ''))) }));
      return { ok: true, rows };
    },
    // 31 alone: upload only (returns what AIR POS stored; nothing is linked to a customer yet)
    'cust-file-upload': async b => {
      const p = readFiles(b && b.files); if (p.error) return { ok: false, message: p.error };
      const r = await upload(p.files); if (bad(r)) return failure(r);
      return { ok: true, files: uploaded(r).map(x => ({ name: String(x.name || ''), path: String(x.filePath || x.path || ''), extension: String(x.extension || '') })) };
    },
    // 84 alone: link files that call 31 already stored
    'cust-file-attach': async b => {
      if (!idOk(b && b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
      const list = Array.isArray(b.files) ? b.files : [];
      if (!list.length || list.length > MAX_FILES || list.some(x => !x || !cleanName(x.name) || typeof x.path !== 'string' || !x.path || x.path.length > 400 || /\.\./.test(x.path))) return { ok: false, message: 'Nothing to attach' };
      const r = await attach(b.retailMemberId, list.map(x => ({ name: cleanName(x.name), path: x.path, extension: String(x.extension || extOf(cleanName(x.name))) })));
      if (bad(r)) return failure(r);
      log('customers: attached ' + list.length + ' file(s) to a customer');
      return { ok: true, message: String(r.message || 'Attached'), attached: list.length };
    },
    // 31 then 84 (the screen's Upload button). If the upload works and the link fails, the file is on AIR POS but not on the customer: say so, never retry on its own.
    'cust-file-add': async b => {
      if (!idOk(b && b.retailMemberId)) return { ok: false, message: 'Pick a customer first' };
      const p = readFiles(b.files); if (p.error) return { ok: false, message: p.error };
      const u = await upload(p.files); if (bad(u)) return failure(u);
      const got = uploaded(u).filter(x => x.filePath || x.path);
      if (got.length !== p.files.length) return { ok: false, message: 'AIR POS stored ' + got.length + ' of ' + p.files.length + ' files. Nothing was attached; try again.' };
      const r = await attach(b.retailMemberId, got.map((x, i) => ({ name: String(x.name || p.files[i].name), path: String(x.filePath || x.path), extension: String(x.extension || extOf(p.files[i].name)) })));
      if (bad(r)) return { ...failure(r), message: 'Uploaded, but could not attach to the customer: ' + msgOf(r), uploaded: true };
      log('customers: uploaded and attached ' + got.length + ' file(s) to a customer');
      return { ok: true, message: String(r.message || 'Attached'), attached: got.length };
    },
    // 85: the screen asks "Remove this file?" first; the server insists (confirmed must be true)
    'cust-file-remove': async b => {
      if (!idOk(b && b.retailMemberId) || !idOk(b && b.attachmentId)) return { ok: false, message: 'Pick a customer and a file first' };
      if (b.confirmed !== true) return { ok: false, needsConfirm: true, message: 'Confirm before removing a file' };
      const r = await reg.api.retail('/RetailMembers/RetailMemberAttachmentDelete', { retailMemberId: b.retailMemberId, attachmentId: b.attachmentId });
      if (bad(r)) return failure(r);
      log('customers: removed 1 file from a customer');
      return { ok: true, message: String((r && r.message) || 'Removed') };
    },
  };
  for (const k of ['cust-files-list', 'cust-file-upload', 'cust-file-attach', 'cust-file-add', 'cust-file-remove']) { const f = routes[k]; routes[k] = gate(f, false); }
  const writes = ['cust-file-upload', 'cust-file-attach', 'cust-file-add', 'cust-file-remove', 'cust-credit-save'];
  return { routes, unlocked: [], once: writes, noSnap: Object.keys(routes) };
};

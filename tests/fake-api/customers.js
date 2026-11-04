// Fake AIR POS answers for Batch 5 (customer files). Made-up data only; offline.
//   83 RetailMemberAttachmentSelect (bare array, like TestShop), 84 RetailMemberAttachmentAdd, 85 RetailMemberAttachmentDelete,
//   31 /Files/FileMultipleUpload on baseserv: the app sends a real multipart POST with fetch(), so this file answers fetch() for the
//   (fake) baseserv host only; every other URL goes to the real fetch untouched (nothing leaves the box).
// Hook (FAKE_PORT+1)  /cust-state          -> { files, uploads, adds, deletes, calls, bad }   (counts, never names)
//                     /cust-fail?op=upload|add|delete|tx|credit&n=1&mode=error|http500   -> the next n calls of that kind fail
//                     /cust-slow?ms=300     -> every upload takes that long (to test two at once)
//                     /cust-role?mode=super|manager|nomenu|cashier  -> who the NEXT login is (super = the fake's usual super admin; manager = RetailManager + Member
//                                              Management menu; nomenu = manager without that menu; cashier = no manager flag, menu present). Log in again after.
//                     /cust-shop?on=1      -> RetailConfig says points are kept per shop (like TestShop); log in again after
//                     /cust-credit-seed?id=m-edit2&allow=0&amount=0&shopAllow=1&shopAmount=100  -> credit fields for that customer
//                     /cust-reset          -> clear the log, the made-up files, history, credit and role
const path = require('path');
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  const { HOSTS } = require(path.join(__dirname, '..', '..', 'app', 'lib', 'airpos.js'));
  const st = fake.cust = { files: {}, stored: {}, uploads: 0, adds: 0, deletes: 0, listCalls: 0, bad: [], fail: {}, lastUploadNames: [] };
  const seed = () => { st.files = { 'm-edit2': [{ id: 'att-1', name: 'sample-photo.png', path: 'fake/att-1/sample-photo.png', extension: '.png' }, { id: 'att-2', name: 'agreement.pdf', path: 'fake/att-2/agreement.pdf', extension: '.pdf' }] }; };
  seed();
  const failNow = op => { const f = st.fail[op]; if (!f || !(f.n > 0)) return null; f.n--; return f.mode; };
  handlers['/RetailMembers/RetailMemberAttachmentSelect'] = p => { st.listCalls++; if (!p.retailMemberId) st.bad.push('select without retailMemberId'); return (st.files[p.retailMemberId] || []).map(x => ({ ...x })); };
  handlers['/RetailMembers/RetailMemberAttachmentAdd'] = p => {
    st.adds++; const f = failNow('add'); if (f === 'error') return { success: false, message: 'Could not add the attachments (fake)' }; if (f === 'http500') return { success: false, message: 'HTTP 500', uncertain: true };
    const x = J(p, 'submit');
    if (!x.retailMemberId || !Array.isArray(x.files) || !x.files.length) { st.bad.push('add: bad body'); return { success: false, message: 'Bad request' }; }
    for (const fl of x.files) { if (!/^[0-9a-f-]{36}$/.test(String(fl.id)) || !fl.name || !fl.path || fl.extension == null) { st.bad.push('add: file entry not as AIR POS sends it'); return { success: false, message: 'Bad file entry' }; } if (!st.stored[fl.path]) return { success: false, message: 'Bad file entry (path was never uploaded)' }; }
    (st.files[x.retailMemberId] = st.files[x.retailMemberId] || []).push(...x.files.map(fl => ({ id: fl.id, name: fl.name, path: fl.path, extension: fl.extension })));
    return { success: true, message: 'Added successfully' };
  };
  handlers['/RetailMembers/RetailMemberAttachmentDelete'] = p => {
    const f = failNow('delete'); if (f === 'error') return { success: false, message: 'Could not remove the file (fake)' };
    st.deletes++; if (!p.retailMemberId || !p.attachmentId) st.bad.push('delete: missing field');
    const l = st.files[p.retailMemberId] || [], i = l.findIndex(x => x.id === p.attachmentId);
    if (i < 0) return { success: false, message: 'Attachment not found' };
    l.splice(i, 1); return { success: true, message: 'Removed successfully' };
  };
  // ---- 80 / 81 / 82 history (made-up rows for m-edit2: 45 transactions so paging shows) and the manager credit editor
  st.role = 'super'; st.byShop = false; st.credit = {}; st.hist = { calls: { tx: 0, bal: 0, pts: 0 }, last: {} }; st.creditSaves = 0;
  const T0 = Date.UTC(2026, 9, 1, 15, 0, 0);
  const tx = []; for (let i = 0; i < 45; i++) { const t = [10, 20, 30][i % 3], aff = i % 4 === 3 ? 0 : (t === 10 ? -1 : 1) * (5 + i); tx.push({ id: 'tx' + i, corpId: 'c', retailMemberId: 'm-edit2', retailShopId: 's', retailShopName: 'Fake shop', transactionNumber: 'T-' + (100300 - i), transactionTime: new Date(T0 + i * 86400000 / 2).toISOString().slice(0, 19), transactionType: t, transactionTypeName: ['Expense', 'Recharge', 'Refund'][t / 10 - 1], amount: 5 + i, tax: 0, transactionAmount: 5 + i, payments: [{ paymentType: 10, paymentTypeName: 'Cash', amount: 5 + i }], balanceSnap: 100 - i, shopBalanceSnap: 40 - i, balanceAffected: aff }); }
  const bal = []; for (let i = 0; i < 6; i++) { const t = [10, 20, 30][i % 3]; bal.push({ id: 'b' + i, corpId: 'c', retailShopId: 's', retailShopName: 'Fake shop', retailMemberId: 'm-edit2', type: t, typeName: ['Expense', 'Recharge', 'Refund'][t / 10 - 1], targetId: 'x', targetNumber: 'T-' + (100300 - i), amount: 10 + i, createTime: new Date(T0 + i * 86400000).toISOString().slice(0, 19), currency: 2, currencyCode: 'USD' }); }
  const pts = []; for (let i = 0; i < 5; i++) { const t = [1, 3][i % 2], sts = [1, 3, 2][i % 3]; pts.push({ id: 'p' + i, corpId: 'c', retailMemberId: 'm-edit2', retailShopId: 's', retailShopName: 'Fake shop', type: t, typeName: t === 1 ? 'Order Recharge Points' : 'Refund Expense Points', targetId: 'x', targetNumber: 'T-' + (100300 - i), points: 10 + i, usedPoints: i, createTime: new Date(T0 + i * 86400000).toISOString().slice(0, 19), expiredTime: new Date(T0 + 365 * 86400000).toISOString().slice(0, 19), status: sts, statusName: ['', 'Enabled', 'Expired', 'Used'][sts] }); }
  const pg = (p, kind, need) => { const f = J(p, 'filter'), pi = J(p, 'pageInfo'); st.hist.calls[kind]++; st.hist.last[kind] = { filter: f, pageInfo: pi };
    if (!f.retailMemberId || !(pi.page >= 1) || !(pi.pageSize >= 1) || need.some(k => !(k in f))) st.bad.push(kind + ': filter/pageInfo not as AIR POS sends them (' + Object.keys(f).join(',') + ')'); return { f, pi }; };
  const slice = (rows, pi) => ({ rows: rows.slice((pi.page - 1) * pi.pageSize, pi.page * pi.pageSize), total: rows.length });
  handlers['/RetailMembers/RetailMemberTransactionPaged'] = p => { const { f, pi } = pg(p, 'tx', ['transactionType', 'beginDate', 'endDate', 'onlyBalanceAffected']); if (failNow('tx')) { return { success: false, message: 'Records are not available (fake)' }; }
    let r = f.retailMemberId === 'm-edit2' ? tx : []; if (f.transactionType) r = r.filter(x => x.transactionType === f.transactionType); if (f.onlyBalanceAffected) r = r.filter(x => x.balanceAffected !== 0);
    if (f.beginDate) r = r.filter(x => Date.parse(x.transactionTime + 'Z') >= Date.parse(f.beginDate)); if (f.endDate) r = r.filter(x => Date.parse(x.transactionTime + 'Z') <= Date.parse(f.endDate)); return slice(r, pi); };
  handlers['/RetailBalanceRecords/RetailBalanceRecordPaged'] = p => { const { f, pi } = pg(p, 'bal', ['targetNumber', 'type', 'status']); let r = f.retailMemberId === 'm-edit2' ? bal : []; if (f.type) r = r.filter(x => x.type === f.type); if (f.targetNumber) r = r.filter(x => x.targetNumber.includes(f.targetNumber)); return slice(r, pi); };
  handlers['/RetailPointRecords/RetailPointRecordPaged'] = p => { const { f, pi } = pg(p, 'pts', ['targetNumber', 'type', 'status']); let r = f.retailMemberId === 'm-edit2' ? pts : []; if (f.type) r = r.filter(x => x.type === f.type); if (f.status) r = r.filter(x => x.status === f.status); if (f.targetNumber) r = r.filter(x => x.targetNumber.includes(f.targetNumber)); return slice(r, pi); };
  // who is logged in: only when a test sets a role (default = the fake's usual login, nothing changes for other tests)
  const MENUS = withMember => [{ name: 'Dashboard', uri: '/dashboard', items: [] }, { name: 'Basic Data', uri: '', items: [{ name: 'Product Management', uri: '/product-manage', items: [] }].concat(withMember ? [{ name: 'Member Management', uri: '/member-manage', items: [] }] : []) }];
  { const login = handlers['/Identities/Login'], home = handlers['/Home/Index'], cfg = handlers['/Commons/RetailConfigGet'];
    handlers['/Identities/Login'] = p => { const r = login(p); if (r.value && st.role !== 'super') r.value.superAdmin = false; return r; };
    handlers['/Home/Index'] = p => { const h = home(p); return st.role === 'super' ? h : { ...h, authorities: st.role === 'cashier' ? [] : ['RetailManager'], menus: MENUS(st.role !== 'nomenu') }; };
    if (cfg) handlers['/Commons/RetailConfigGet'] = p => { const r = cfg(p); return st.byShop && r && r.value ? { ...r, value: { ...r.value, pointSetting: { pointByShop: true } } } : r; }; }
  const CF = ['allowCreditPayment', 'creditAmount', 'shopAllowCreditPayment', 'shopCreditAmount', 'balance', 'shopBalance'];
  if (!handlers['/Identities/verify']) handlers['/Identities/verify'] = p => { const x = J(p, 'submit'); return x.userName === 'boss' && x.password === 'boss-pw' ? ok('mgr-1') : { success: false, message: 'Wrong user name or password' }; }; // made-up manager login for the credit editor
  { const get = handlers['/RetailMembers/RetailMemberGet'], upd = handlers['/RetailMembers/RetailMemberUpdate'];
    const BASE19 = { middleName: '', phone: '', company: '', province: '', city: '', receiveAutoEmail: false }; // what the real record always carries (the fake's tiny members leave them out)
    handlers['/RetailMembers/RetailMemberGet'] = p => { const r = get(p); const c = st.credit[p.id]; if (c && r && r.success) return { ...r, value: { ...BASE19, ...r.value, ...c } }; return r; };
    handlers['/RetailMembers/RetailMemberUpdate'] = p => { const x = J(p, 'submit'), c = st.credit[x.id], before = c && { ...c }; if (c) { st.creditSaves++; if (failNow('credit')) { return { success: false, message: 'Credit could not be saved (fake)' }; } }
      const r = upd(p);
      if (c && r && r.success) { const need = ['id', 'number', 'mobile', 'phone', 'firstName', 'middleName', 'lastName', 'company', 'email', 'receiveAutoEmail', 'province', 'city', 'address', 'zipCode', 'discount', 'remark', 'status', 'creditAmount', 'allowCreditPayment'];
        if (need.some(k => !(k in x))) st.bad.push('credit save: record not whole (' + need.filter(k => !(k in x)).join(',') + ')'); st.lastCredit = { allow: x.allowCreditPayment, amount: x.creditAmount, keys: Object.keys(x).length, other: [x.firstName, x.lastName, x.email].join('|') };
        if (st.byShop) { c.shopAllowCreditPayment = !!x.allowCreditPayment; c.shopCreditAmount = x.creditAmount; } else { c.allowCreditPayment = !!x.allowCreditPayment; c.creditAmount = x.creditAmount; } CF.forEach(k => { delete FM_REC(x.id)[k]; }); if (before.balance !== c.balance) st.bad.push('credit save changed the balance'); }
      return r; }; }
  function FM_REC(id) { return fake.members && fake.members[id] ? fake.members[id] : {}; }
  const realFetch = globalThis.fetch;
  if (!globalThis.__custFakeFetch) {
    globalThis.__custFakeFetch = true;
    globalThis.fetch = async (url, o = {}) => {
      if (!String(url).startsWith(HOSTS.base)) return realFetch(url, o);
      const json = (code, j) => new Response(JSON.stringify(j), { status: code, headers: { 'content-type': 'application/json' } });
      if (!String(url).endsWith('/Files/FileMultipleUpload')) return json(404, { success: false, message: 'fake baseserv: unknown path' });
      st.uploads++; if (st.slow > 0) await new Promise(r => setTimeout(r, st.slow));
      const f = failNow('upload'); if (f === 'http500') return json(500, { success: false, message: 'Server error (fake)' }); if (f === 'error') return json(200, { success: false, message: 'Upload failed (fake)' });
      const h = o.headers || {}; if (!h.ide) { st.bad.push('upload: no session header'); return json(200, { success: false, errorCode: 1003, message: 'Not logged in' }); }
      if (h['Content-Type'] || h['content-type']) st.bad.push('upload: Content-Type was set by hand (breaks the multipart boundary)');
      if (!(o.body instanceof FormData)) { st.bad.push('upload: body is not multipart'); return json(200, { success: false, message: 'Bad request' }); }
      const files = o.body.getAll('files'); st.lastUploadNames = files.map(x => x.name);
      if (!files.length || files.some(x => typeof x === 'string' || !x.name || !(x.size > 0))) { st.bad.push('upload: field "files" missing or not file parts'); return json(200, { success: false, message: 'No files' }); }
      const out = files.map(x => { const id = 'u' + Math.random().toString(16).slice(2, 10), p = `fake/${id}/${x.name}`; st.stored[p] = x.size; return { name: x.name, filePath: p, extension: '.' + (/\.([^.]+)$/.exec(x.name) || [0, ''])[1] }; });
      return json(200, { success: true, value: out });
    };
  }
  hooks['/cust-state'] = (u, res) => res.end(JSON.stringify({ files: Object.fromEntries(Object.entries(st.files).map(([k, v]) => [k, v.length])), uploads: st.uploads, adds: st.adds, deletes: st.deletes, listCalls: st.listCalls, calls: fake.calls.filter(c => /MemberAttachment/.test(c)).length, bad: st.bad, lastUploadNames: st.lastUploadNames }));
  hooks['/cust-fail'] = (u, res) => { st.fail[u.searchParams.get('op')] = { n: Number(u.searchParams.get('n') || 1), mode: u.searchParams.get('mode') || 'error' }; res.end('{}'); };
  hooks['/cust-slow'] = (u, res) => { st.slow = Number(u.searchParams.get('ms') || 0); res.end('{}'); };
  hooks['/cust-role'] = (u, res) => { st.role = u.searchParams.get('mode') || 'super'; res.end('{}'); };
  hooks['/cust-shop'] = (u, res) => { st.byShop = u.searchParams.get('on') === '1'; res.end('{}'); };
  hooks['/cust-credit-seed'] = (u, res) => { const q = k => u.searchParams.get(k); st.credit[q('id')] = { allowCreditPayment: q('allow') === '1', creditAmount: Number(q('amount') || 0), shopAllowCreditPayment: q('shopAllow') === '1', shopCreditAmount: Number(q('shopAmount') || 0), balance: 12.5, shopBalance: 7.25 }; res.end('{}'); };
  hooks['/cust-hist'] = (u, res) => res.end(JSON.stringify({ calls: st.hist.calls, last: st.hist.last, credit: st.credit, creditSaves: st.creditSaves, lastCredit: st.lastCredit || null, role: st.role, bad: st.bad }));
  hooks['/cust-reset'] = (u, res) => { st.role = 'super'; st.byShop = false; st.credit = {}; st.creditSaves = 0; st.lastCredit = null; st.hist.calls = { tx: 0, bal: 0, pts: 0 }; st.hist.last = {}; Object.values(fake.members || {}).forEach(m => CF.forEach(k => { delete m[k]; })); st.uploads = st.adds = st.deletes = st.listCalls = 0; st.bad = []; st.fail = {}; st.stored = {}; st.slow = 0; seed(); res.end('{}'); };
};

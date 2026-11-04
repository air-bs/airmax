// Orders tab phase 1 (PLAN-orders-tab.md): app/backoffice.js offline, with the real AirPos client whose network call() is replaced
// (every AirPos method used is logged), plus static guards on the wiring. VIEW AND SEARCH ONLY: the module may make exactly one
// read-only AIR POS call (/Orders/RetailOrderPaged through api.retail) and nothing else.
// Run: node tests/orders-tab.test.js
'use strict';
const fs = require('fs'), path = require('path');
const { AirPos } = require('../app/lib/airpos');
const { BackOffice, parseQuery, buildFilter, unapplied, mapRow, PATH, PAGE_SIZE, STATUSES, PAYMENTS } = require('../app/backoffice');
const APP = path.join(__dirname, '..', 'app'), rd = f => fs.readFileSync(path.join(APP, f), 'utf8');
const out = []; const rec = (k, pass, note) => { out.push({ k, pass: !!pass, note }); console.log((pass ? 'PASS ' : 'FAIL ') + k + ' — ' + note); };
const J = x => JSON.stringify(x);

function mk(reply) {
  const api = new AirPos({ log: () => {} }); api.ide = 'test-session';
  const calls = [], used = [], logs = [];
  for (const k of Object.getOwnPropertyNames(AirPos.prototype)) {
    if (k === 'constructor' || k === 'call' || typeof Object.getOwnPropertyDescriptor(AirPos.prototype, k).value !== 'function') continue;
    const f = api[k].bind(api); api[k] = (...a) => { used.push(k); return f(...a); };
  }
  api.call = async (host, p, params, o) => { calls.push({ host, path: p, params, o }); return typeof reply === 'function' ? reply(params) : reply; };
  return { bo: new BackOffice({ reg: { api }, log: m => logs.push(m) }), calls, used, logs };
}
const local = (y, m, d, hh = 12, mm = 0) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
const ROWS = [
  { id: 'a', number: 'RO1001', status: 20, statusName: 'Completed', paymentType: 10, paymentTypeName: 'Cash', quantity: 3, quantityReturn: 1, amount: 10, tax: 0.8, createTime: local(2026, 11, 2, 9), retailMemberName: 'Dana Sample', retailMemberNumber: '5559876543', operatorName: 'Dana Ops', bak: 'gift wrap' },
  { id: 'b', number: 'RO1002', status: -5, paymentType: 99, quantity: 1, amount: 2.5, tax: 0.2, orderTime: local(2026, 11, 1, 18), memberName: 'Old Field Name', bak: null },
];

(async () => {
  // ---- parseQuery: what the screen sends is checked before AIR POS is asked
  let p = parseQuery({});
  rec('Empty search: no filters, page 1', !p.error && J(p.q) === J({ number: '', productNumber: '', customer: '', operator: '', remark: '', statuses: [], payments: [], from: '', to: '', page: 1 }), J(p.q));
  p = parseQuery({ number: '  RO10\u000759  ', operator: 'x'.repeat(200), remark: '\tgift\n' });
  rec('Text is trimmed, control characters dropped, 60 characters at most', p.q.number === 'RO1059' && p.q.operator.length === 60 && p.q.remark === 'gift', J([p.q.number, p.q.operator.length, p.q.remark]));
  p = parseQuery({ customer: '(555) 987-6543' });
  rec('Customer typed as a phone becomes the AIR POS customer # (no punctuation, MemberSaveDrawer rule)', p.q.customer === '5559876543' && parseQuery({ customer: 'M-12 34' }).q.customer === 'M1234', p.q.customer);
  p = parseQuery({ statuses: [-10, '20', 20, 99, 'x', null], payments: ['11', 7, 10, 99] });
  rec('Status / payment codes: only known ones, no repeats, in screen order', J(p.q.statuses) === '[20,-10]' && J(p.q.payments) === '[10,11,99]', J([p.q.statuses, p.q.payments]));
  rec('A date that is not a real day is refused', !!parseQuery({ from: '2026-02-30' }).error && !!parseQuery({ to: '11/02/2026' }).error && !parseQuery({ from: '2028-02-29' }).error, parseQuery({ from: '2026-02-30' }).error);
  rec('From after To is refused', parseQuery({ from: '2026-11-03', to: '2026-11-02' }).error === 'The From date is after the To date.' && !parseQuery({ from: '2026-11-02', to: '2026-11-02' }).error, '');
  rec('Page: whole number from 1 to 10000', parseQuery({ page: '2' }).q.page === 2 && parseQuery({ page: 0 }).q.page === 1 && parseQuery({ page: -3 }).q.page === 1 && parseQuery({ page: 'x' }).q.page === 1 && parseQuery({ page: 2.7 }).q.page === 2 && parseQuery({ page: 1e9 }).q.page === 10000, '');
  rec('Bad input never throws', !parseQuery(null).error && !parseQuery('x').error && !parseQuery({ statuses: 'x', payments: { a: 1 } }).error, '');

  // ---- buildFilter: the known store shape; the unverified keys only when used
  const held = (rd('lib/register.js').match(/async heldOrders\(\) \{\s*const r = await this\.api\.orderPaged\(\{([^}]*)\}/) || [, ''])[1];
  const heldKeys = held.split(',').map(s => s.split(':')[0].trim()).filter(Boolean);
  const f0 = buildFilter(parseQuery({}).q);
  rec('No filters = the frozen store call\'s keys, in its order (register.js heldOrders, AIR POS 1.9.11 OrderCheckout)', heldKeys.length === 8 && J(Object.keys(f0)) === J(heldKeys), heldKeys.join(','));
  rec('...with the store\'s empty values (\'\' for the numbers, null for the rest; no status = all)', J(f0) === J({ number: '', productNumber: '', memberNumber: '', status: null, operatorName: null, paymentType: null, beginDate: null, endDate: null }), J(f0));
  let f = buildFilter(parseQuery({ number: 'RO1', productNumber: '1004', customer: '555-0100', operator: 'dana', statuses: [20], payments: [10], from: '2026-11-01', to: '2026-11-02', remark: 'gift' }).q);
  rec('Every filter goes in its own key; one status / payment also as status / paymentType', J(f) === J({ number: 'RO1', productNumber: '1004', memberNumber: '5550100', status: 20, operatorName: 'dana', paymentType: 10, beginDate: '2026-11-01T00:00:00', endDate: '2026-11-02T23:59:59', statuses: [20], paymentTypes: [10], bak: 'gift' }), J(f));
  f = buildFilter(parseQuery({ statuses: [-5, -10], payments: [10, 20] }).q);
  rec('Several statuses / payments: lists only (status / paymentType null)', f.status === null && J(f.statuses) === '[-5,-10]' && f.paymentType === null && J(f.paymentTypes) === '[10,20]', J(f));
  rec('Dates: whole days in local time (From 00:00:00, To 23:59:59, ISO form)', f0.beginDate === null && buildFilter(parseQuery({ from: '2026-11-01' }).q).beginDate === '2026-11-01T00:00:00' && buildFilter(parseQuery({ to: '2026-11-01' }).q).endDate === '2026-11-01T23:59:59', '');

  // ---- orders(): one read-only call, the right fields, rows mapped
  let t = mk({ success: true, rows: ROWS, total: 55 });
  let r = await t.bo.orders({ customer: '555-987-6543', page: 2 });
  const c = t.calls[0] || {}, pi = c.params ? JSON.parse(c.params.pageInfo) : {};
  rec('Exactly one AIR POS call: RetailOrderPaged on the retail server, through api.retail()', t.calls.length === 1 && c.host === 'retail' && c.path === '/Orders/RetailOrderPaged' && PATH === c.path && J(t.used) === '["retail"]', `${t.calls.length} call(s): ${c.host} ${c.path}; AirPos methods used: ${t.used.join(',')}`);
  rec('Sent as form fields filter + pageInfo (JSON), 50 per page, like AIR POS / History', c.params && J(Object.keys(c.params)) === '["filter","pageInfo"]' && J(pi) === J({ page: 2, pageSize: 50, amount: 0 }) && PAGE_SIZE === 50 && JSON.parse(c.params.filter).memberNumber === '5559876543' && c.o === undefined, c.params && c.params.pageInfo);
  rec('Answer: page, pages (55 orders = 2 pages), total', r.ok && r.page === 2 && r.pages === 2 && r.total === 55 && r.pageSize === 50 && r.rows.length === 2, J({ ok: r.ok, page: r.page, pages: r.pages, total: r.total }));
  const m0 = r.rows[0], m1 = r.rows[1];
  rec('Row: total = amount + tax (as History), returned items, customer name and #, operator, remark', m0.total === 10.8 && m0.quantityReturn === 1 && m0.customer === 'Dana Sample' && m0.customerNumber === '5559876543' && m0.operator === 'Dana Ops' && m0.remark === 'gift wrap' && m0.time === ROWS[0].createTime, J(m0));
  rec('Row: missing names fall back (status / payment names, orderTime, memberName), null remark = ""', m1.statusName === 'Void' && m1.paymentTypeName === 'Split (2+ payments)' && m1.time === ROWS[1].orderTime && m1.customer === 'Old Field Name' && m1.remark === '' && m1.total === 2.7, J(m1));
  rec('Row: only display fields go to the screen (no raw AIR POS object)', J(Object.keys(mapRow(ROWS[0])).sort()) === J(['amount', 'amountReturn', 'customer', 'customerNumber', 'id', 'number', 'operator', 'paymentType', 'paymentTypeName', 'quantity', 'quantityReturn', 'remark', 'status', 'statusName', 'tax', 'time', 'total'].sort()), Object.keys(m0).join(','));
  t = mk({ success: true, value: { rows: ROWS.slice(0, 1), total: 1 } }); r = await t.bo.orders({});
  rec('An answer with rows under value is read too', r.ok && r.total === 1 && r.pages === 1 && r.rows.length === 1, J({ total: r.total }));
  t = mk({ success: true, rows: [], total: 0 }); r = await t.bo.orders({});
  rec('No orders: ok, 0 orders, page 1 of 1', r.ok && r.total === 0 && r.pages === 1 && !r.rows.length && !r.unapplied.length, J({ total: r.total, pages: r.pages }));
  t = mk({ success: true, rows: ROWS }); r = await t.bo.orders({ page: 3 });
  rec('No total in the answer: at least what was seen (page 3 = 102)', r.ok && r.total === 102 && r.pages === 3, J({ total: r.total }));

  // ---- the answer is checked: a filter AIR POS visibly did not apply is named
  const q = x => parseQuery(x).q;
  rec('Rows that match every filter: nothing flagged', unapplied(q({ number: 'ro100', customer: '5559876543', operator: 'dana', statuses: [20], payments: [10], from: '2026-11-02', to: '2026-11-02', remark: 'GIFT' }), ROWS.slice(0, 1)).length === 0, '');
  const un = unapplied(q({ statuses: [20], payments: [10], from: '2026-11-02', to: '2026-11-02', number: 'RO1001' }), ROWS);
  rec('A row with another status / payment / day / number is flagged by filter name', J(un) === J(['Order #', 'Status', 'Paid by', 'Dates']), un.join(', '));
  rec('Customer / operator / remark: flagged only when the row carries that field', J(unapplied(q({ customer: '5550100', operator: 'sam', remark: 'wrap' }), ROWS.slice(1))) === J([]) && J(unapplied(q({ customer: '5550100', operator: 'sam', remark: 'zzz' }), ROWS.slice(0, 1))) === J(['Customer', 'Operator', 'Remark']), '');
  rec('A walk-in row (customer # "") under a customer filter is flagged', J(unapplied(q({ customer: '5550100' }), [{ retailMemberNumber: '' }])) === '["Customer"]', '');
  rec('Dates: the To day is included up to midnight; the next day is not', unapplied(q({ to: '2026-11-02' }), [{ createTime: local(2026, 11, 2, 23, 59) }]).length === 0 && J(unapplied(q({ to: '2026-11-02' }), [{ createTime: local(2026, 11, 3, 0, 0) }])) === '["Dates"]' && J(unapplied(q({ from: '2026-11-02' }), [{ createTime: local(2026, 11, 1, 23, 59) }])) === '["Dates"]', '');
  rec('Product # is never flagged (an order row carries no lines)', unapplied(q({ productNumber: '9999' }), ROWS).length === 0, '');
  t = mk({ success: true, rows: ROWS, total: 2 }); r = await t.bo.orders({ statuses: [20] });
  rec('orders() returns the flagged filters to the screen', r.ok && J(r.unapplied) === '["Status"]', J(r.unapplied));

  // ---- failures and refusals: clear message, nothing pretended
  t = mk({ success: false, message: 'Filter not valid' }); r = await t.bo.orders({});
  rec('AIR POS refuses: not ok, its message shown, "Nothing was changed"', !r.ok && /AIR POS did not send the orders \(Filter not valid\)\. Nothing was changed\. Press Search to try again\./.test(r.message) && !r.retryable, r.message);
  t = mk({ success: false, message: 'Network error: ETIMEDOUT', unreachable: true }); r = await t.bo.orders({});
  rec('AIR POS not reachable: not ok, marked retryable', !r.ok && r.retryable && /ETIMEDOUT/.test(r.message), r.message);
  t = mk({ success: false, message: 'Session expired', errorCode: 1003, loggedOut: true }); r = await t.bo.orders({});
  rec('Session ended on AIR POS: loggedOut goes back to the screen (it shows the login)', !r.ok && r.loggedOut === true, J(r));
  t = mk({ success: true }); r = await t.bo.orders({});
  rec('An answer without rows is not shown as "0 orders"', !r.ok && /did not send the orders/.test(r.message), r.message);
  t = mk(() => { throw new Error('must not be called'); }); r = await t.bo.orders({ from: '2026-11-03', to: '2026-11-01' });
  rec('A refused search never asks AIR POS', !r.ok && r.bad && t.calls.length === 0 && t.used.length === 0, r.message);
  t = mk({ success: true, rows: ROWS, total: 2 }); await t.bo.orders({ customer: '5559876543', operator: 'Dana Ops', remark: 'secret remark text', number: 'RO1001' });
  rec('The log names the filters used, never their values (no customer #, operator, remark, order #)', t.logs.length === 1 && /Order #, Customer, Operator, Remark/.test(t.logs[0]) && !/5559876543|Dana Ops|secret|RO1001/.test(t.logs[0]), t.logs[0]);
  rec('options(): the status and payment choices the screen shows (codes = AIR POS codes)', J(new BackOffice({}).options()) === J({ ok: true, pageSize: 50, statuses: STATUSES.map(([code, name]) => ({ code, name })), payments: PAYMENTS.map(([code, name]) => ({ code, name })) })
    && J(STATUSES.map(s => s[0])) === '[20,15,17,10,-5,-10]' && J(PAYMENTS.map(s => s[0])) === '[10,20,30,40,50,11,99]', PAYMENTS.map(s => s[1]).join(', '));
  rec('Payment codes match AIR POS\'s PaymentType in register.js; status codes match OrderStatus', (() => { const s = rd('lib/register.js'); const pt = /const PaymentType = \{ Cash: 10, MemberAccount: 11, CreditCard: 20, Online: 30, GiftCard: 40, Check: 50, Combination: 99 \}/.test(s), os = /const OrderStatus = \{ Canceled: -10, Void: -5, New: 10, Pending: 15, Paid: 17, Completed: 20 \}/.test(s); return pt && os; })(), '');

  // ---- static guards: read-only module, wiring, the screen file
  const src = rd('backoffice.js');
  const apiUses = [...new Set([...src.matchAll(/\bapi\.(\w+)/g)].map(m => m[1]))], retailCalls = (src.match(/\.api\.retail\(/g) || []).length;
  rec('backoffice.js: read-only (its only AIR POS use is one api.retail(PATH) call; no file system, no other module)', J(apiUses) === '["retail"]' && retailCalls === 1 && /this\.reg\.api\.retail\(PATH,/.test(src) && !/require\(/.test(src) && !/writeFile|appendFile|unlink|\.save\(|fetch\(/.test(src), 'api uses: ' + apiUses.join(','));
  const srv = rd('server.js'), unl = (srv.match(/const UNLOCKED = new Set\(\[([\s\S]*?)\]\);/) || [, ''])[1];
  rec('server.js: both routes need a login and are UNLOCKED (never wait for the sale queue, never journalled)', /'backoffice-options': needLogin\(async \(\) => backoffice\.options\(\)\)/.test(srv) && /'backoffice-orders': needLogin\(b => backoffice\.orders\(b\)\)/.test(srv) && /'backoffice-options'/.test(unl) && /'backoffice-orders'/.test(unl), '');
  const ui = rd('public/orders.js');
  const apiCalls = [...ui.matchAll(/\bapi\('([^']+)'/g)].map(m => m[1]);
  rec('orders.js: the screen calls only the two Orders routes (no sale / money route, no act())', J([...new Set(apiCalls)].sort()) === '["backoffice-options","backoffice-orders"]' && !/\bact\(/.test(ui), apiCalls.join(','));
  rec('orders.js: no global key handler, no settings-style ids (se… / st…), no <option value=…> or data-tab tokens (settings-parity / keys-unique)', !/(?:window|document)\.addEventListener\('keydown'/.test(ui) && !/id="(se|st)/.test(ui) && !/<option value=/.test(ui) && !/data-tab=/.test(ui), '');
  const sc = JSON.parse(rd('shortcuts.json')).keys;
  rec('No new keyboard shortcut in phase 1 (shortcuts.json has no Orders key)', !sc.some(k => /order/i.test(k.action) || /^Orders/i.test(k.label)), sc.length + ' keys');
  const html = rd('public/index.html');
  rec('index.html: RETAIL SALES markup unchanged; orders.js loads after the other screen scripts', (html.match(/<span class="apnav">RETAIL SALES<\/span>/g) || []).length === 1 && /<script src="\/printlabels\.js"><\/script>\n<script src="\/orders\.js"><\/script>\n<\/body>/.test(html), '');
  rec('app/lib (frozen) does not know about the Orders tab', fs.readdirSync(path.join(APP, 'lib')).every(f => !/backoffice|orders-tab|obTab/.test(rd('lib/' + f))), '');
  const fk = fs.readFileSync(path.join(__dirname, 'fake-server.js'), 'utf8');
  rec('Fake AIR POS: the Orders data is opt-in (FAKE_ORDERS=1); the default fake answers as before', /if \(process\.env\.FAKE_ORDERS === '1'\) \{[\s\S]*handlers\['\/Orders\/RetailOrderPaged'\] = p =>/.test(fk) && /'\/Orders\/RetailOrderPaged': p => \{ const pi = J\(p, 'pageInfo'\); const all = Object\.values\(fake\.orders\)/.test(fk), '');

  const pass = out.filter(x => x.pass).length; console.log(`${pass}/${out.length} orders tab tests passed`);
  fs.writeFileSync(path.join(__dirname, 'orders-tab-results.json'), JSON.stringify({ at: new Date().toISOString(), pass, total: out.length, out }, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });

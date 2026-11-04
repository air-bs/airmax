// 1.0.9-local.5 (Ari OK 4:17 PM ET Oct 30 2026): customer screen messages per shop (app/custmsg.js) + the two
// display-only items asked at 4:20 PM ET: no "$0.00 store credit" line, and no "Nothing was paid" claim from frozen lib text.
// Offline: no AIR POS, no network.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { CustMessages, FIELDS, shopKey, clean } = require('../app/custmsg');
let n = 0, pass = 0; const rec = (k, ok, note = '') => { n++; if (ok) pass++; console.log((ok ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custmsg-'));
try {
  const m = new CustMessages(dir);
  const A = shopKey('Business Test', 'S1'), B = shopKey('Business Test', 'S2');
  rec('1 shop key = company + shop id, lowercased', A === 'business test|s1' && shopKey('x', '') === '', A);
  let s = m.shown(A);
  rec('2 defaults are today\'s texts', s.welcome === 'Welcome' && s.itemsHead === 'Your items' && s.returnHead === 'Return' && s.cardReader === 'Please use the card reader' && s.thankYou === 'Thank you', JSON.stringify(s));
  let r = m.set(A, { cardReader: 'Tap or insert your card', thankYou: 'Thanks, come again!', welcome: 'Hi from S1' });
  rec('3 save for shop S1', r.ok && m.shown(A).cardReader === 'Tap or insert your card' && m.shown(A).thankYou === 'Thanks, come again!', r.message);
  rec('4 shop S2 is not affected', m.shown(B).cardReader === 'Please use the card reader' && m.shown(B).welcome === 'Welcome');
  rec('5 untouched fields keep their default', m.shown(A).itemsHead === 'Your items');
  r = m.set(A, { cardReader: '   ' });
  rec('6 empty value = default again', m.shown(A).cardReader === 'Please use the card reader' && m.saved(A).cardReader === '' && m.shown(A).thankYou === 'Thanks, come again!');
  rec('7 kept after restart (own file, re-read)', new CustMessages(dir).shown(A).thankYou === 'Thanks, come again!' && fs.existsSync(path.join(dir, 'customer-messages.json')));
  rec('8 logged out shows the last shop that logged in', new CustMessages(dir).shown('').thankYou === 'Thanks, come again!');
  m.set(A, { thankYou: 'x'.repeat(500), itemsHead: 'Line1\nLine2\u0007<b>' });
  const sv = m.saved(A);
  rec('9 length limited, control characters removed (plain text)', sv.thankYou.length === FIELDS.thankYou.max && sv.itemsHead === 'Line1 Line2 <b>', JSON.stringify(sv.itemsHead));
  rec('10 no shop = refused', m.set('', { thankYou: 'a' }).ok === false);
  fs.writeFileSync(path.join(dir, 'customer-messages.json'), '{broken');
  rec('11 damaged file = defaults, no crash', new CustMessages(dir).shown(A).thankYou === 'Thank you');
  rec('12 __proto__ as a shop is harmless', (() => { const x = new CustMessages(fs.mkdtempSync(path.join(os.tmpdir(), 'cm2-'))); x.set('__proto__', { thankYou: 'p' }); return ({}).thankYou === undefined && x.shown('other|z').thankYou === 'Thank you'; })());
  rec('13 clean() keeps normal text', clean('  Hello   world ', 40) === 'Hello world');
} catch (e) { rec('crash', false, e.stack); }

// ---- statics: wiring, display only, frozen files ----
const srv = rd('app/server.js'), cj = rd('app/public/customer.js'), ch = rd('app/public/customer.html'), pos = rd('app/public/pos.js'), app = rd('app/public/app.js'), ex = rd('app/public/extras.js');
rec('20 change route is manager only', /'cust-messages-set'\] = needLogin\(b => picMgr\(\) \?/.test(srv));
rec('21 customer-state carries msgs (read-only GET)', /x\.msgs = \{/.test(srv) && /customer-state.*custExtras\(\)/.test(srv));
rec('22 customer screen uses the texts as plain text', /\$\('head'\)\.textContent = ret \? msgs\.returnHead : msgs\.itemsHead/.test(cj) && /\$\{esc\(msgs\.cardReader\)\}/.test(cj) && /\$\('thx'\)\.textContent = msgs\.thankYou/.test(cj) && /<h1 id="thx">Thank you<\/h1>/.test(ch));
rec('23 customer screen still has no POST / inputs', !/method:\s*'POST'/.test(cj) && !/<(input|button|form|select|textarea)/.test(ch));
rec('24 money labels stay fixed', /row\('Subtotal'/.test(cj) && /row\('Refund'/.test(cj) && /'Amount due'/.test(cj) && /'Total'/.test(cj));
rec('25 Settings has the 4 fields + saves them', /CM_FIELDS = \[\['itemsHead'.*\['returnHead'.*\['cardReader'.*\['thankYou'/.test(pos) && /api\('cust-messages-set', cm\)/.test(pos));
rec('26 build ships app/custmsg.js', /cp -r [^\n]*app\/\*\.js/.test(rd('stage-app.sh')) && fs.existsSync(path.join(__dirname, '../app/custmsg.js')));
rec('27 nothing new in app/lib', !fs.readdirSync(path.join(__dirname, '../app/lib')).includes('custmsg.js') && !/custmsg/.test(fs.readdirSync(path.join(__dirname, '../app/lib')).map(f => rd('app/lib/' + f)).join('')));
// ---- 4:20 PM item (a): no "$0.00 store credit" ----
rec('30 Customer box (F2 dialog) hides a zero store credit', /Points \$\{m\.points\}\$\{Math\.round\(\(Number\(m\.availableBalance\) \|\| 0\) \* 100\) \? ' · Store credit '/.test(app));
rec('31 Customer card (F3) hides a zero store credit', /Math\.round\(\(Number\(m\.balance \?\? m\.availableBalance\) \|\| 0\) \* 100\) \? f\('Store credit'/.test(ex));
// ---- item (b): the frozen lib's "Nothing was paid" texts are re-worded on the way to the screen ----
try {
  const i = app.indexOf('const HONEST = ['), j = app.indexOf('function toast(m, ok) {');
  const ctx = {}; vm.createContext(ctx); vm.runInContext(app.slice(i, j) + ';this.honestMsg = honestMsg; this.honestReply = honestReply;', ctx);
  const reg = rd('app/lib/register.js'), recv = rd('app/lib/recovery.js');
  const m1 = 'AIR POS has no record of this sale yet. Nothing was paid there; take the payment again.';
  rec('40 the frozen payRecheck text is still the one we re-word', reg.includes(m1));
  const o1 = ctx.honestMsg(m1);
  rec('41 payRecheck: no "Nothing was paid", says payments are kept', !/othing was paid/.test(o1) && /Payments already taken on this screen are kept/.test(o1), o1);
  const m2 = 'Recovered the unfinished sale (2 lines). Nothing was paid yet; continue or press New sale.';
  rec('42 the frozen recovery text is still the one we re-word', recv.includes('). Nothing was paid yet; continue or press New sale.') && recv.includes("; nothing was paid yet'"));
  const o2 = ctx.honestReply({ ok: true, notice: m2 }).notice, o3 = ctx.honestReply({ ok: true, notice: { message: 'Recovered the unfinished sale (1 line); nothing was paid yet.' } }).notice.message;
  rec('43 recovery notices: no "nothing was paid", the line count stays', !/othing was paid/i.test(o2 + o3) && /\(2 lines\)\. No payment was found/.test(o2) && /\(1 line\); no payment was found/.test(o3), o2 + ' | ' + o3);
  const other = 'Recovered the unfinished sale (1 line): $2.00 already paid, $3.00 left.';
  rec('44 other messages unchanged', ctx.honestMsg(other) === other && ctx.honestMsg(null) === null);
  rec('45 api() returns the re-worded reply', /return honestReply\(j\);/.test(app));
} catch (e) { rec('crash (b)', false, e.stack); }
console.log(`\n${pass}/${n} passed`); process.exit(pass === n ? 0 : 1);

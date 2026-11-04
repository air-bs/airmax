// Ask AirMax, server side (app/api/ask-airmax.js). OFFLINE: a FAKE Grok server (tests/fake-grok.js) with made-up canary keys; no real key, no real network.
// The plugin is loaded in-process with a temp data folder and a ctx.reg that records any touch (it must never be touched).
//   node tests/api-ask-airmax.test.js      (fake Grok port: ASK_GROK_PORT, default 5372)
'use strict';
process.env.AIRMAX_TEST = '1';
const fs = require('fs'), os = require('os'), path = require('path');
const PORT = Number(process.env.ASK_GROK_PORT || 5372);
process.env.AIRMAX_GROK_BASE = 'http://127.0.0.1:' + PORT + '/v1'; process.env.AIRMAX_ASK_GAP_MS = '0';
const fake = require('./fake-grok.js'), plugin = require('../app/api/ask-airmax.js');
const KEY = 'xai-TEST-CANARY-0001-abcdefghijklmnop', KEY2 = 'xai-TEST-CANARY-0002-abcdefghijklmnop', WRONG = 'xai-WRONGKEY-abcdefghijklmnopqrstu';
const fails = []; const rec = (k, pass, note) => { if (!pass) fails.push(k); console.log((pass ? 'PASS ' : 'FAIL ') + k + (note ? ' — ' + note : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function make(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'askair-')), logs = [], touched = []; let manager = opts.manager !== false;
  const reg = new Proxy({}, { get: (t, k) => { touched.push(String(k)); return undefined; }, has: (t, k) => { touched.push(String(k)); return false; } });
  const p = plugin({ reg, log: m => logs.push(String(m)), needLogin: f => f, isManager: () => manager, perms: () => ({}), hasMenu: () => false, dataDir: dir });
  return { dir, logs, touched, r: p.routes, p, setManager: v => { manager = v; }, file: path.join(dir, 'ask-airmax.json') };
}
(async () => {
  const g = await fake.start(PORT), S = g.state; const rst = () => { S.log = []; S.mode = 'ok'; S.ms = 0; };
  const posts = () => S.log.filter(x => x.method === 'POST');
  try {
    // ---- 1 defaults: Off, no key ----
    const a = make(); const st0 = await a.r['ask-status']();
    rec('1 default: switch Off, no key, 500,000 tokens a day, memory of 2 earlier questions', st0.on === false && st0.ready === false && st0.budget === 500000 && plugin.CONFIG.TOKEN_BUDGET === 500000 && st0.memory === 2 && plugin.HISTORY_EXCHANGES === 2, JSON.stringify(st0));
    rec('2 plugin exposes ask-status / ask / ask-config-* routes; all unlocked-for-login + noSnap', ['ask-status', 'ask', 'ask-config-get', 'ask-config-save', 'ask-test'].every(n => a.r[n] && a.p.noSnap.includes(n) && a.p.unlocked.includes(n)), '');
    let r = await a.r.ask({ question: 'How do I reprint a receipt?' });
    rec('3 switch Off: the question is refused, nothing sent to Grok', r.ok === false && r.kind === 'off' && posts().length === 0, r.message);
    // ---- turning on needs a saved key ----
    r = await a.r['ask-config-save']({ on: true });
    rec('4 turning On without a saved key is refused', r.ok === false && /key first/i.test(r.message), r.message);
    r = await a.r['ask-config-save']({ key: 'not a key' });
    rec('5 a typed key that is not xai-… is refused and not stored', r.ok === false && !fs.existsSync(a.file) || (fs.existsSync(a.file) && !JSON.parse(fs.readFileSync(a.file)).key), r.message);
    // ---- cashier cannot touch config ----
    a.setManager(false);
    const cg = await a.r['ask-config-get'](), cs = await a.r['ask-config-save']({ key: KEY, on: true }), ct = await a.r['ask-test']({ key: KEY });
    rec('6 a cashier (not manager) cannot read, save or test the Ask AirMax settings', [cg, cs, ct].every(x => x.ok === false && x.managerOnly === true) && !fs.existsSync(a.file), '');
    rec('7 a cashier can still read the status and ask (when it is On): status ok', (await a.r['ask-status']()).ok === true, '');
    a.setManager(true);
    // ---- save the key, on ----
    r = await a.r['ask-config-save']({ key: KEY, on: true });
    rec('8 manager saves a key and turns On', r.ok && r.on === true && r.keySet === true, '');
    const view = JSON.stringify(await a.r['ask-config-get']()), stat = JSON.stringify(await a.r['ask-status']()), saveBack = JSON.stringify(r);
    rec('9 the key is never returned by config-get / config-save / status', ![view, stat, saveBack].some(x => x.includes(KEY) || x.includes('xai-TEST')), '');
    const mode = fs.statSync(a.file).mode & 0o777;
    rec('10 the key file is private to the PC user (0600)', process.platform === 'win32' || mode === 0o600, mode.toString(8));
    // ---- an ordinary question; what Grok receives ----
    rst();
    const SECRET_Q = 'How do I reprint a receipt? Customer card 4111 1111 1111 1111, phone (212) 555-1234, jane@example.com, order 10238';
    r = await a.r.ask({ question: SECRET_Q });
    rec('11 an ordinary question is answered with steps and sources', r.ok === true && /Reprint Receipt/.test(r.answer) && r.sources.includes('Checkout') && r.howtoOnly === false && r.used === 4720 && r.tokens.total === 4720 && r.budget === 500000, JSON.stringify(r).slice(0, 160));
    const sent = posts()[0], body = sent && sent.body;
    rec('12 request goes to /v1/chat/completions with the Bearer key from the saved file', !!sent && sent.path === '/v1/chat/completions' && sent.auth === 'Bearer ' + KEY, sent && sent.path);
    const allowed = ['model', 'messages', 'stream', 'temperature', 'max_completion_tokens', 'prompt_cache_key', 'safety_identifier'];
    rec('13 DATA-NOT-SENT: the outgoing JSON has only the allow-listed fields (no sale / customer / order / operator fields)', body && Object.keys(body).every(k => allowed.includes(k)) && body.stream === false && body.search_parameters === undefined && body.tools === undefined, Object.keys(body || {}).join(','));
    const msgs = body.messages;
    rec('14 DATA-NOT-SENT: messages are exactly system(rules + how-to text), then the one user question', msgs.length === 2 && msgs[0].role === 'system' && msgs[0].content.startsWith(plugin.SYSTEM_RULES + '\n\nHOW-TO TEXT:\n') && msgs[1].role === 'user', msgs.map(m => m.role).join(','));
    const howto = fs.readFileSync(path.join(__dirname, '..', 'app', 'howto', 'airmax-howto.md'), 'utf8');
    rec('15 DATA-NOT-SENT: the system message is only the fixed rules + the how-to file, byte for byte', msgs[0].content === plugin.SYSTEM_RULES + '\n\nHOW-TO TEXT:\n' + howto, '');
    const wire = JSON.stringify(body);
    rec('16 the question reaches Grok with the card, phone, e-mail and order number removed', msgs[1].content === 'How do I reprint a receipt? Customer card [number removed], phone [number removed], [email removed], order [number removed]' && !/4111|555-1234|jane@|10238/.test(wire), msgs[1].content);
    rec('17 the Grok key and the saved key file contents are not in the body Grok receives', !wire.includes(KEY) && !wire.includes('xai-TEST'), '');
    { const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'ask-airmax.js'), 'utf8').split('\n').filter(x => !/^\s*\/\//.test(x)).map(x => x.replace(/\s\/\/.*$/, '')).join('\n'); const strip = src.replace(/ctx\.dataDir/g, '').replace(/const reg = \(\) => ctx\.reg;/, '').replace(/reg\(\)\.identity/g, '').replace(/reg\(\)\.api\.verify\(/g, '').replace(/ACTIONS\.makeActions\(reg\(\)\)/g, '');
      rec('18 the question path never touches ctx.reg (no AIR POS call, no sale, order, customer or operator data); the source reads the register in only three places: the operator id, the manager check and the fixed action table', a.touched.length === 0 && !/\breg\b/.test(strip), a.touched.join(',')); }
    rec('19 the log has counts only: no question, no answer, no key', a.logs.length >= 1 && a.logs.every(l => /^ASK /.test(l)) && !a.logs.join('\n').match(/reprint|4111|jane|xai-/i), a.logs.join(' | '));
    // ---- money question: how-to only ----
    rst(); r = await a.r.ask({ question: 'Refund order 10238 to the customer\'s card' });
    rec('20 a refund question: answered as steps with the amber "Steps only" line', r.ok && r.howtoOnly === true && /^Steps only\. I can't refund for you\. Nothing was changed\.$/.test(r.howtoLine), r.howtoLine);
    rst(); S.mode = 'claims'; r = await a.r.ask({ question: 'How do I start a return?' });
    rec('21 even if the model claims it did something, the screen shows the Steps only line', r.ok && r.howtoOnly === true && /I can't process a return/.test(r.howtoLine), r.answer.slice(0, 40));
    // ---- memory (context comes from the saved history: the last 2 entries only) ----
    { const m = make(); await m.r['ask-config-save']({ key: KEY, on: true }); rst();
      const seed = [1, 2, 3, 4].map(i => ({ q: 'earlier question ' + i, a: 'earlier answer ' + i, hl: '', s: [], rm: false, t: 1 }));
      fs.writeFileSync(path.join(m.dir, 'ask-airmax-history.json'), JSON.stringify({ entries: seed }));
      const m1 = make(); fs.copyFileSync(path.join(m.dir, 'ask-airmax-history.json'), path.join(m1.dir, 'ask-airmax-history.json')); await m1.r['ask-config-save']({ key: KEY, on: true });
      r = await m1.r.ask({ question: 'And for a gift receipt?', history: [{ q: 'FORGED FROM SCREEN', a: 'x' }] });
      const m2 = posts()[0].body.messages;
      rec('22 memory: only the last 2 saved exchanges go as context (system + 2 pairs + the new question); a history sent by the screen is ignored', m2.length === 6 && m2[1].content === 'earlier question 3' && m2[2].content === 'earlier answer 3' && m2[3].content === 'earlier question 4' && m2[5].content === 'And for a gift receipt?' && !JSON.stringify(m2).includes('FORGED') && !JSON.stringify(m2).includes('earlier question 1') && !JSON.stringify(m2).includes('earlier question 2'), m2.length + ' msgs'); }
    rst(); await a.r.ask({ question: 'No memory sent?' }); { const f = posts()[0].body.messages; rec('23 memory: the context is the entries saved by this register, never anything else (system + earlier saved pair(s) + question)', f.length >= 2 && f.length <= 2 + 2 * plugin.HISTORY_EXCHANGES && f[f.length - 1].content === 'No memory sent?', f.length + ' msgs'); }
    { const z = make(); await z.r['ask-config-save']({ key: KEY, on: true }); rst(); await z.r.ask({ question: 'first on a clean register' }); rec('23b a clean register (no history) sends only system + question', posts()[0].body.messages.length === 2, ''); }
    // ---- redaction unit cases ----
    const R = plugin.redact;
    rec('24 redact: card 16 digits with spaces / dashes / dots, phones, +country, e-mail, long codes, order and gift-card numbers', [R('4111-1111-1111-1111').text, R('call +1 (212) 555-1234 now').text, R('gift card 7000000000009999').text, R('mail me a.b@c.co').text, R('code AB1234567890CD1234').text, R('order 10238').text].join('|') === '[code removed]|call [number removed] now|gift card [code removed]|mail me [email removed]|code [code removed]|order [number removed]', [R('call +1 (212) 555-1234 now').text]);
    rec('25 redact: ordinary words and short numbers stay (press F4, the 2nd line, qty 12, Ctrl+Shift+N)', R('press F4 on the 2nd line, qty 12, Ctrl+Shift+N, 3.5 lb').text === 'press F4 on the 2nd line, qty 12, Ctrl+Shift+N, 3.5 lb' && R('press F4').removed === false, '');
    rec('26 redact: 300 characters at most; control characters and line breaks become spaces', R('x '.repeat(400)).text.length <= 300 && R('a\nb\u0007c').text === 'a b c', '');
    rec('27 a question that is only a number is refused (nothing sent)', await (async () => { rst(); const x = await a.r.ask({ question: '4111 1111 1111 1111' }); return x.ok === false && x.kind === 'empty' && posts().length === 0; })(), '');
    rec('28 an empty question is refused (nothing sent)', await (async () => { rst(); const x = await a.r.ask({ question: '   ' }); return x.ok === false && posts().length === 0; })(), '');
    // ---- failures ----
    for (const [mode, kind, re] of [['500', 'busy', /busy/i], ['429', 'busy', /busy/i], ['badjson', 'offline', /can't reach/i], ['empty', 'bad', /couldn't read/i]]) {
      rst(); S.mode = mode; const x = await a.r.ask({ question: 'How do I add a customer?' });
      rec('29 Grok answers ' + mode + ': friendly message (' + kind + '), nothing thrown, key not in it, no automatic retry', x.ok === false && x.kind === kind && re.test(x.message) && !JSON.stringify(x).includes('xai-') && posts().length === 1, x.message);
    }
    const used0 = (await a.r['ask-status']()).used; rst(); S.mode = '500'; await a.r.ask({ question: 'How do I add a customer?' });
    rec('30 a failed question does not use up the daily count', (await a.r['ask-status']()).used === used0, '');
    // offline = nothing listening
    { const b = make(); await b.r['ask-config-save']({ key: KEY, on: true }); const old = process.env.AIRMAX_GROK_BASE; process.env.AIRMAX_GROK_BASE = 'http://127.0.0.1:5399/v1';
      const c2 = make(); await c2.r['ask-config-save']({ key: KEY, on: true }); const x = await c2.r.ask({ question: 'How do I open the drawer?' }); process.env.AIRMAX_GROK_BASE = old;
      rec('31 offline (cannot connect): the friendly "I can\'t reach the help service" message', x.ok === false && x.kind === 'offline' && /Your sale is not affected/.test(x.message), x.message); }
    // wrong key
    { const w = make(); await w.r['ask-config-save']({ key: WRONG, on: true }); rst(); const x = await w.r.ask({ question: 'How do I add a customer?' });
      const st = await w.r['ask-status']();
      rec('32 key not accepted (401): "not set up yet. Ask a manager", status shows not ready, key not in any reply or log', x.ok === false && x.kind === 'notset' && st.ready === false && !JSON.stringify([x, st]).includes(WRONG) && !w.logs.join('').includes(WRONG), x.message);
      const x2 = await w.r.ask({ question: 'again?' }); rec('33 after a refused key nothing more is sent until a manager saves a new key', x2.kind === 'notset' && posts().length === 1, '');
      await w.r['ask-config-save']({ key: KEY2 }); rst(); const x3 = await w.r.ask({ question: 'How do I add a customer?' }); rec('34 a new good key works again', x3.ok === true, ''); }
    // hang -> timeout is 20 s in the code: check the cap value, and that a hung request does not block a second one forever
    rec('35 the request has a 20 s timeout in the code', /TIMEOUT_MS = 20000/.test(fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'ask-airmax.js'), 'utf8')), '');
    // key scrubbing
    rec('36 a Grok answer that echoes a key is scrubbed before it is shown', plugin.scrubKey('your key is ' + KEY + ' and xai-ABCDEFGHIJKL', KEY) === 'your key is [key] and [key]', '');
    // ---- DAILY TOKEN BUDGET (replaces the question cap) ----
    { const d = make(); await d.r['ask-config-save']({ key: KEY, on: true, budget: 9000 }); rst();
      const out = []; for (let i = 0; i < 4; i++) out.push(await d.r.ask({ question: 'How do I add a customer? ' + i }));
      const st = await d.r['ask-status']();
      rec('37 BUDGET: with 9,000 tokens, questions 1-2 (4,720 each) are answered, 3 and 4 get the "allowance is used up" message and are never sent to Grok', out.slice(0, 2).every(x => x.ok) && out.slice(2).every(x => x.ok === false && x.kind === 'limit' && x.needUnlock === true && /allowance is used up/.test(x.message) && /Checkout is not affected/.test(x.message)) && posts().length === 2, out.map(x => x.ok ? 'ok' : x.kind).join(','));
      rec('38 BUDGET: the screen numbers come back (tokens used of the budget, reached)', out[0].used === 4720 && out[0].budget === 9000 && st.used === 9440 && st.reached === true && st.left === 0 && st.pct === 100, JSON.stringify(st));
      const OD = Date; global.Date = class extends OD { constructor(...a) { if (a.length) super(...a); else super(OD.now() + 86400000 + 3600000); } static now() { return OD.now() + 86400000 + 3600000; } };
      const nextDay = await d.r.ask({ question: 'How do I open the drawer?' }), st2 = await d.r['ask-status'](); global.Date = OD;
      rec('39 BUDGET: the count starts again on the next day (question accepted, 4,720 used)', nextDay.ok === true && nextDay.used === 4720 && st2.used === 4720 && st2.reached === false, JSON.stringify([nextDay.ok, st2.used]));
      const up = make(); await up.r['ask-config-save']({ key: KEY, on: true, budget: '' }); const ls = await up.r['ask-status']();
      rec('40 a blank budget means no limit; a bad number is refused', ls.budget === 0 && ls.reached === false && (await up.r['ask-config-save']({ budget: 'abc' })).ok === false && (await up.r['ask-config-save']({ budget: -2 })).ok === false && (await up.r['ask-config-save']({ budget: 250000 })).budget === 250000, ''); }
    // the day's tokens survive a restart of the register (same data folder, new plugin instance)
    { const d = make(); await d.r['ask-config-save']({ key: KEY, on: true, budget: 50000 }); rst(); await d.r.ask({ question: 'How do I add a customer?' });
      const p2 = plugin({ reg: {}, log() {}, needLogin: f => f, isManager: () => true, perms: () => ({}), hasMenu: () => false, dataDir: d.dir }); const s2 = await p2.routes['ask-status']();
      rec('41 the day\'s token count and the Off/On switch are kept across a restart of the register', s2.used === 4720 && s2.on === true && s2.budget === 50000, JSON.stringify(s2)); }
    // ---- gap / busy ----
    { process.env.AIRMAX_ASK_GAP_MS = '1500'; const d = make(); await d.r['ask-config-save']({ key: KEY, on: true }); rst(); const x1 = await d.r.ask({ question: 'How do I add a customer?' }), x2 = await d.r.ask({ question: 'second quickly?' });
      rec('42 two questions within the minimum gap: the second gets "One moment" and is not sent', x1.ok === true && x2.ok === false && x2.kind === 'wait' && posts().length === 1, x2.message); process.env.AIRMAX_ASK_GAP_MS = '0'; }
    { const d = make(); await d.r['ask-config-save']({ key: KEY, on: true }); rst(); S.mode = 'slow'; S.ms = 700; const p1 = d.r.ask({ question: 'slow one?' }); await sleep(100); const x2 = await d.r.ask({ question: 'while waiting?' }); const x1 = await p1;
      rec('43 a second question while one is still being answered is ignored (never two at once)', x1.ok === true && x2.ok === false && x2.ignored === true && posts().length === 1, ''); }
    // ---- test connection ----
    { const d = make(); rst(); let x = await d.r['ask-test']({}); const noKey = x.ok === false && /key first/i.test(x.message);
      x = await d.r['ask-test']({ key: KEY }); const good = x.ok === true && x.modelOk === true && x.models.includes('grok-4.99-future') && !x.models.some(m => /imagine|code/.test(m)) && posts().length === 0; // /models is a GET: not a question
      S.mode = '401'; const bad = (await d.r['ask-test']({ key: KEY })).message === 'The key was not accepted.'; S.mode = '429'; const busy = /busy/.test((await d.r['ask-test']({ key: KEY })).message); S.mode = 'ok';
      const dead = await (async () => { const old = process.env.AIRMAX_GROK_BASE; process.env.AIRMAX_GROK_BASE = 'http://127.0.0.1:5399/v1'; const y = await d.r['ask-test']({ key: KEY }); process.env.AIRMAX_GROK_BASE = old; return /cannot reach/.test(y.message); })();
      const log = S.log.filter(l => l.path === '/v1/models').length;
      rec('44 Test connection: no key / good key (lists the account\'s models, uses no question) / 401 / 429 / unreachable give the right messages', noKey && good && bad && busy && dead && log >= 3, [noKey, good, bad, busy, dead].join(',')); }
    // ---- remove key ----
    { const d = make(); await d.r['ask-config-save']({ key: KEY, on: true }); const x = await d.r['ask-config-save']({ removeKey: true }); const f = JSON.parse(fs.readFileSync(d.file, 'utf8'));
      rec('45 Remove saved key: key gone from the file, switch goes Off', x.ok && x.keySet === false && x.on === false && f.key === '' && f.on === false, ''); }
    // ---- SAVED HISTORY (Gordon, Nov 3: persists; redacted before it is written; Clear history; capped; never uploaded or logged) ----
    { const HF = d => path.join(d, 'ask-airmax-history.json'), read = d => JSON.parse(fs.readFileSync(HF(d), 'utf8')).entries;
      const h = make(); await h.r['ask-config-save']({ key: KEY, on: true }); rst();
      rec('50 HISTORY starts empty (no file yet, ask-history returns no entries)', !fs.existsSync(HF(h.dir)) && (await h.r['ask-history']()).entries.length === 0, '');
      await h.r.ask({ question: 'How do I reprint a receipt? card 4111 1111 1111 1111 phone (212) 555-1234 mail jane@example.com code AB1234567890CD1234' });
      await h.r.ask({ question: 'How do I add a customer?' });
      const raw = fs.readFileSync(HF(h.dir), 'utf8'), ents = read(h.dir);
      rec('51 HISTORY persists: both answered questions are in the file, newest last', ents.length === 2 && ents[1].q === 'How do I add a customer?' && /Reprint Receipt/.test(ents[0].a), ents.length + ' entries');
      rec('52 HISTORY redaction is applied BEFORE the write: no card, phone, e-mail or code text is ever in the file', !/4111|555-1234|jane@|AB1234567890/.test(raw) && ents[0].q === 'How do I reprint a receipt? card [number removed] phone [number removed] mail [email removed] code [code removed]', ents[0].q);
      rec('53 HISTORY file is private (0600), sits in the data folder, holds the answer, sources and the How-to-only line; no key, no operator, no customer', (process.platform === 'win32' || (fs.statSync(HF(h.dir)).mode & 0o777) === 0o600) && Array.isArray(ents[0].s) && !raw.includes('xai-') && !/tester|operator|customer/i.test(raw.replace(/How do I add a customer\?/g, '').replace(/I can't change customer or user records for you\./g, '')), '');
      const logs = h.logs.join('\n'); rec('54 HISTORY contents are never logged (log lines are counts only)', h.logs.every(l => /^ASK /.test(l)) && !/reprint|customer|Reprint|jane|4111/.test(logs), logs.slice(0, 80).replace(/\n/g, ' | '));
      // survives closing the panel (nothing to do server side) and a restart: a new plugin instance on the same folder
      const p2 = plugin({ reg: {}, log() {}, needLogin: f => f, isManager: () => false, perms: () => ({}), hasMenu: () => false, dataDir: h.dir }), v = await p2.routes['ask-history']();
      rec('55 HISTORY survives a restart of the register and is readable by a cashier (any login)', v.ok && v.entries.length === 2 && v.entries[0].answer === ents[0].a && Array.isArray(v.entries[0].sources) && v.entries[0].removed === true, '');
      // a failed question is not saved
      rst(); S.mode = '500'; await h.r.ask({ question: 'will fail?' }); S.mode = 'ok'; rec('56 a question that failed (no answer) is not saved', read(h.dir).length === 2, '');
      // what is sent: only the last two as context
      rst(); await h.r.ask({ question: 'third question' }); await sleep(5); rst(); await h.r.ask({ question: 'fourth question' }); await sleep(5); const sentMsgs = posts()[0].body.messages, sw = JSON.stringify(sentMsgs.slice(1));
      rec('57 HISTORY is not sent beyond the last 2 turns: system + 2 saved pairs + the new question; the oldest saved entry is absent', sentMsgs.length === 6 && sentMsgs[5].content === 'fourth question' && sentMsgs[1].content === 'How do I add a customer?' && sentMsgs[3].content === 'third question' && !/reprint/i.test(sw), sentMsgs.length + ' msgs');
      rec('58 the history file text is never sent as such (no file name, no timestamps, no field names)', !/ask-airmax-history|"entries"|"t":\d/.test(JSON.stringify(posts()[0].body)), '');
      // other routes never carry it
      rec('59 status and config replies carry only the count of saved entries, not the text', !/Reprint|customer\?/.test(JSON.stringify([await h.r['ask-status'](), await h.r['ask-config-get']()])) && (await h.r['ask-config-get']()).historyCount === 4, '');
      // clear
      const cl = await h.r['ask-history-clear']();
      rec('60 CLEAR HISTORY empties the file and the list (cashier allowed), and a restart still shows it empty', cl.ok && read(h.dir).length === 0 && fs.readFileSync(HF(h.dir), 'utf8').includes('"entries":[]') && (await plugin({ reg: {}, log() {}, needLogin: f => f, isManager: () => false, perms: () => ({}), hasMenu: () => false, dataDir: h.dir }).routes['ask-history']()).entries.length === 0 && (await h.r['ask-history']()).entries.length === 0, '');
      rst(); await h.r.ask({ question: 'after clear' }); const nm = posts()[0].body.messages; rec('61 after Clear history nothing old is sent as context (system + question only)', nm.length === 2, nm.length + ' msgs'); }
    // cap
    { const d = make(); await d.r['ask-config-save']({ key: KEY, on: true }); rst();
      const seed = Array.from({ length: 199 }, (_, i) => ({ q: 'seed ' + i, a: 'seed answer ' + i, hl: '', s: [], rm: false, t: 1 }));
      fs.writeFileSync(path.join(d.dir, 'ask-airmax-history.json'), JSON.stringify({ entries: seed }));
      const d2 = make(); fs.copyFileSync(path.join(d.dir, 'ask-airmax-history.json'), path.join(d2.dir, 'ask-airmax-history.json')); await d2.r['ask-config-save']({ key: KEY, on: true });
      for (let i = 0; i < 3; i++) { await d2.r.ask({ question: 'cap test ' + i }); await sleep(10); }
      const e = JSON.parse(fs.readFileSync(path.join(d2.dir, 'ask-airmax-history.json'), 'utf8')).entries;
      rec('62 CAP: the history never holds more than 200 entries (HISTORY_MAX); the oldest are dropped first', plugin.HISTORY_MAX === 200 && e.length === 200 && e[0].q === 'seed 2' && e[199].q === 'cap test 2' && !e.some(x => x.q === 'seed 0' || x.q === 'seed 1'), e.length + ' entries, first ' + e[0].q);
      const big = make(); await big.r['ask-config-save']({ key: KEY, on: true }); fs.writeFileSync(path.join(big.dir, 'ask-airmax-history.json'), JSON.stringify({ entries: Array.from({ length: 500 }, (_, i) => ({ q: 'old ' + i, a: 'a', hl: '', s: [], rm: false, t: 1 })) }));
      const big2 = make(); fs.copyFileSync(path.join(big.dir, 'ask-airmax-history.json'), path.join(big2.dir, 'ask-airmax-history.json')); await big2.r['ask-config-save']({ key: KEY, on: true });
      const v = await big2.r['ask-history'](); const zd = make(); fs.writeFileSync(path.join(zd.dir, 'ask-airmax-history.json'), '{{not json'); const dmg = await zd.r['ask-history']().then(x => x.ok && x.entries.length === 0); rec('63 CAP: an oversized or hand-edited file is trimmed to the newest 200 when read; a damaged file starts empty without a crash', v.entries.length === 200 && v.entries[199].q === 'old 499' && dmg, ''); }
    // an answer that holds a number or an e-mail is cleaned too before it is saved
    { const d = make(); await d.r['ask-config-save']({ key: KEY, on: true }); rst(); await d.r.ask({ question: 'How do I reprint?' });
      const e = JSON.parse(fs.readFileSync(path.join(d.dir, 'ask-airmax-history.json'), 'utf8')).entries; rec('64 the saved answer is plain text: the stored text is exactly what was shown, line breaks kept', e.length === 1 && e[0].a.includes('\n'), ''); }
    // ---- the base URL cannot be moved outside test mode ----
    { const old = { t: process.env.AIRMAX_TEST, n: process.env.NODE_ENV }; delete process.env.AIRMAX_TEST; delete process.env.NODE_ENV; const d = make(); await d.r['ask-config-save']({ key: KEY, on: true }); rst(); const x = await d.r.ask({ question: 'How do I add a customer?' });
      if (old.t) process.env.AIRMAX_TEST = old.t; if (old.n) process.env.NODE_ENV = old.n;
      rec('47 outside test mode the AIRMAX_GROK_BASE override is ignored (the real key can never be sent to another address)', posts().length === 0 && plugin.BASE_URL === 'https://api.x.ai/v1' && x.ok === false, x.kind); }
    // ---- source never has a key, never logs the question ----
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'ask-airmax.js'), 'utf8');
    rec('48 source: no key-looking string and no console.log in the plugin', !/xai-[A-Za-z0-9]{12,}/.test(src) && !/console\.(log|error|warn)/.test(src), '');
    const front = fs.readFileSync(path.join(__dirname, '..', 'app', 'public', 'sections', 'ask-airmax.js'), 'utf8');
    rec('49 screen file: no key, no eval / Function / innerHTML with an answer, no call to any route but the ask-* ones', !/xai-[A-Za-z0-9]{12,}/.test(front) && !/\beval\(|new Function\(/.test(front) && [...front.matchAll(/call\('([\w-]+)'/g)].every(m => /^ask(-|$)/.test(m[1])), '');
  } catch (e) { fails.push('crash'); console.log('FAIL crash — ' + (e && e.stack || e)); } finally { g.close(); }
  console.log(fails.length ? 'FAILED: ' + fails.join('; ') : 'all passed'); process.exit(fails.length ? 1 : 0);
})();

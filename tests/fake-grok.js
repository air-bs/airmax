// A tiny FAKE api.x.ai for Ask AirMax tests. Offline, made-up answers. No real key, no real network.
//   node tests/fake-grok.js            listens on GROK_PORT (default 5372), 127.0.0.1 only
//   POST /v1/chat/completions   -> a made-up answer (recorded)        GET /v1/models -> a made-up model list
//   GET /__imgtok?n=  tokens added for an attached picture (default 1100)
//   GET  /__log                 -> every request received so far (method, path, auth header, body)        GET /__reset -> clear the log + mode
//   POST /v1/responses          -> the web search fallback answer (recorded)     GET /__usage?in=&out= sets the token counts returned; GET /__webfail?on=1|0
//   GET  /__mode?m=ok|401|403|429|500|hang|slow|badjson|claims|html|empty   (slow = ms from &ms=)
// A key is accepted only if it starts with "xai-TEST-CANARY" (made-up canary keys), otherwise 401, like a wrong key would.
'use strict';
const http = require('http');
function start(port, host = '127.0.0.1') {
  const state = { log: [], mode: 'ok', ms: 0, tin: 4500, tout: 220, webfail: false, imgTok: 1100 };
  // question keywords -> made-up answers. "ACTION-ECHO {json}" makes the model echo an ACTION line (a stand-in for a prompt injection that worked).
  const answer = q => {
    const echo = /ACTION-ECHO (\{.*\})/.exec(q);
    if (echo) return '1. Done as asked.\nACTION: ' + echo[1] + '\nSource: Checkout';
    if (/drawer type|drawer kind|drawer to star|change the drawer/i.test(q)) return '1. Open [Settings], then Printer & Drawer.\n2. Set the cash drawer type to Star.\nACTION: {"id":"drawer-kind-set","params":{"kind":"star"}}\nSource: Settings';
    if (/test print|print a test/i.test(q)) return '1. Open [Settings], Printer & Drawer.\n2. Press Test print.\nACTION: {"id":"test-print","params":{}}\nSource: Settings, Printer problems';
    if (/weather|capital of|president|recipe|bitcoin/i.test(q)) return 'NO_ANSWER';
    if (/reprint/i.test(q)) return 'Two ways:\n1. Last sale: [Reprint Receipt] {Ctrl+P}\n2. Older order: [History] {Ctrl+L}, pick it, press Reprint.\nSource: Checkout, Order history';
    if (/refund|return/i.test(q)) return "To do it yourself:\n1. [Return] {Ctrl+L}, pick the order.\n2. Choose the items coming back.\n3. [Checkout] {F12} to finish. A manager may need to approve.\nSource: Returns, Checkout";
    return 'Open [Settings] and look under the Printer & Drawer tab.\nSource: Settings';
  };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let raw = '';
    req.on('data', d => { raw += d; if (raw.length > 2e6) req.destroy(); });
    req.on('end', () => {
      const j = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
      if (u.pathname === '/__log') return j(200, state.log);
      if (u.pathname === '/__reset') { state.log = []; state.mode = 'ok'; state.ms = 0; state.tin = 4500; state.tout = 220; state.webfail = false; state.imgTok = 1100; return j(200, { ok: true }); }
      if (u.pathname === '/__usage') { state.tin = Number(u.searchParams.get('in') || 4500); state.tout = Number(u.searchParams.get('out') || 220); return j(200, { ok: true }); }
      if (u.pathname === '/__imgtok') { state.imgTok = Number(u.searchParams.get('n') || 1100); return j(200, { ok: true }); }
      if (u.pathname === '/__webfail') { state.webfail = u.searchParams.get('on') !== '0'; return j(200, { ok: true }); }
      if (u.pathname === '/__mode') { state.mode = u.searchParams.get('m') || 'ok'; state.ms = Number(u.searchParams.get('ms') || 0); return j(200, { ok: true, mode: state.mode }); }
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = { _unparsed: raw.slice(0, 200) }; }
      state.log.push({ method: req.method, path: u.pathname, auth: req.headers.authorization || '', body });
      const key = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!/^xai-TEST-CANARY/.test(key)) return j(401, { error: 'bad key' });
      const m = state.mode;
      if (m === '401' || m === '403' || m === '429' || m === '500') return j(Number(m), { error: 'forced ' + m });
      if (m === 'hang') return; // never answers
      const go = () => {
        if (u.pathname === '/v1/models' && req.method === 'GET') return j(200, { data: [{ id: 'grok-4.3' }, { id: 'grok-4.7' }, { id: 'grok-4.99-future' }, { id: 'grok-imagine-image' }, { id: 'grok-code-fast-1' }] });
        if (u.pathname === '/v1/chat/completions' && req.method === 'POST') {
          if (m === 'badjson') return j(200, '{not json');
          if (m === 'empty') return j(200, { choices: [{ message: { content: '' } }] });
          const msgs = (body && body.messages) || [], lastC = (msgs[msgs.length - 1] || {}).content, hasImg = Array.isArray(lastC) && lastC.some(x => x && x.type === 'image_url'), q = Array.isArray(lastC) ? (lastC.find(x => x && x.type === 'text') || {}).text || '' : lastC || '';
          const text = m === 'claims' ? 'I have refunded the order for you. It is done.\nSource: Checkout' : m === 'html' ? '1. Press <b>Reprint</b> <img src=x onerror=alert(1)> [Reprint Receipt] {Ctrl+P}\nSource: Checkout' : answer(q);
          return j(200, { choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: state.tin + (hasImg ? state.imgTok : 0), completion_tokens: state.tout } }); // an attached picture costs input tokens, like the real service
        }
        if (u.pathname === '/v1/responses' && req.method === 'POST') { // the web search fallback (Responses API)
          if (state.webfail) return j(500, { error: 'web search down' });
          const text = 'Paris is the capital of France. [[1]](https://example.com/a)\n- It is on the Seine.\n**Source:** web';
          return j(200, { output: [{ type: 'web_search_call' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [{ type: 'url_citation', url: 'https://www.example.com/a', title: 'A' }, { type: 'url_citation', url: 'https://news.example.org/b' }] }] }], usage: { input_tokens: 700, output_tokens: 90 } });
        }
        return j(404, { error: 'no route' });
      };
      if (m === 'slow') setTimeout(go, state.ms || 1500); else go();
    });
  });
  return new Promise(r => srv.listen(port, host, () => r({ srv, state, close: () => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); } })));
}
module.exports = { start };
if (require.main === module) start(Number(process.env.GROK_PORT || 5372)).then(() => console.log('fake Grok on ' + (process.env.GROK_PORT || 5372)));

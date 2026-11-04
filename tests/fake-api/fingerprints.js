// Batch 6 fake: AIR POS fingerprint answers (made-up operators and made-up "templates") and a FAKE reader service (the :20001 service).
// The fake reader service starts only when env AIRMAX_FP_HW_PORT is set (the app reads the same variable, so it talks to this fake, never a real reader).
// Fake AIR POS state: fake.fp = { ops: { operatorId: [{ id, index, contents[], createTime }] }, managers: [{ operatorId, fingerprints: [{ index, contents[] }] }], log: [...] }
// Hooks (hook port): /fp-state (counts only), /fp-reset, /fp-ops?on=0|1 (what the next FingerprintSelect says), /fp-calls
// Reader control (on the reader port itself, GET): /__fp/mode?m=ok|hold|nofinger|nomatch|dup  /__fp/finger?i=N  /__fp/who?id=mgr-1  /__fp/delay?ms=N  /__fp/state  /__fp/reset
module.exports = ({ handlers, hooks, fake, ok, J }) => {
  const mk = () => ({
    ops: { 'op-ann': [{ id: 'fp-a1', index: 1, contents: ['FAKE-TPL-ANN-1A', 'FAKE-TPL-ANN-1B', 'FAKE-TPL-ANN-1C'], createTime: '2026-10-02T10:00:00Z' }, { id: 'fp-a2', index: 2, contents: ['FAKE-TPL-ANN-2A', 'FAKE-TPL-ANN-2B', 'FAKE-TPL-ANN-2C'], createTime: '2026-10-02T10:05:00Z' }], 'op-bob': [], 'op-cy': [{ id: 'fp-c1', index: 1, contents: ['FAKE-TPL-CY-1A', 'FAKE-TPL-CY-1B', 'FAKE-TPL-CY-1C'], createTime: '2026-10-03T09:00:00Z' }],
      // the same data under the operator ids of Batch 3's fake Users list (tests/fake-api/users.js: op-1 Alice, op-2 Bob, op-3 Carol), so the real Users screen can be used in the browser test
      'op-1': [{ id: 'fp-11', index: 1, contents: ['FAKE-TPL-A1-1A', 'FAKE-TPL-A1-1B', 'FAKE-TPL-A1-1C'], createTime: '2026-10-02T10:00:00Z' }, { id: 'fp-12', index: 2, contents: ['FAKE-TPL-A1-2A', 'FAKE-TPL-A1-2B', 'FAKE-TPL-A1-2C'], createTime: '2026-10-02T10:05:00Z' }], 'op-2': [], 'op-3': [{ id: 'fp-31', index: 1, contents: ['FAKE-TPL-C3-1A', 'FAKE-TPL-C3-1B', 'FAKE-TPL-C3-1C'], createTime: '2026-10-03T09:00:00Z' }] },
    managers: [{ operatorId: 'mgr-1', fingerprints: [{ index: 1, contents: ['FAKE-MGR-TPL-1A', 'FAKE-MGR-TPL-1B', 'FAKE-MGR-TPL-1C'] }] }, { operatorId: 'mgr-2', fingerprints: [{ index: 3, contents: ['FAKE-MGR-TPL-2A', 'FAKE-MGR-TPL-2B', 'FAKE-MGR-TPL-2C'] }] }],
    log: [], noManagers: false, down: false,
  });
  fake.fp = mk();
  const P = () => fake.fp, rec = (path, extra) => P().log.push({ path, ...(extra || {}) });
  const opId = p => String(p.operatorId || '');
  handlers['/Operators/FingerprintsGet'] = () => { rec('148'); return ok(P().ops['op-ann'].flatMap(x => x.contents.map(c => ({ index: x.index, fingerprint: c })))); };
  handlers['/Operators/FingerprintSelect'] = p => { rec('149', { operatorId: opId(p) }); return ok((P().ops[opId(p)] || []).map(x => ({ ...x, contents: [...x.contents] }))); };
  handlers['/Operators/FingerPrintRegister'] = p => { const s = J(p, 'submit'); rec('150', { operatorId: s.operatorId, fingerIndex: s.fingerIndex, n: (s.contents || []).length, hasId: !!s.fingerPrintId });
    if (!s.operatorId || !Array.isArray(s.contents) || s.contents.length !== 3) return { success: false, message: 'Fingerprint contents are not valid' };
    const l = P().ops[s.operatorId] = P().ops[s.operatorId] || []; const old = l.findIndex(x => x.index === s.fingerIndex); const row = { id: s.fingerPrintId, index: s.fingerIndex, contents: s.contents, createTime: new Date().toISOString() }; if (old >= 0) l[old] = row; else l.push(row); return ok({}); };
  handlers['/Operators/FingerprintClear'] = p => { rec('151', { operatorId: opId(p) }); P().ops[opId(p)] = []; return ok({}); };
  handlers['/Operators/FingerprintRemove'] = p => { rec('152', { operatorId: opId(p), fingerprintId: String(p.fingerprintId) }); const l = P().ops[opId(p)] || []; const i = l.findIndex(x => x.id === String(p.fingerprintId)); if (i < 0) return { success: false, message: 'Fingerprint not found' }; l.splice(i, 1); return ok({}); };
  handlers['/Operators/ManagerFingerprintSelect'] = () => { rec('8'); if (P().down) return { success: false, message: 'Not allowed' }; return ok(P().noManagers ? [] : P().managers.map(m => ({ operatorId: m.operatorId, fingerprints: m.fingerprints.map(f => ({ index: f.index, contents: [...f.contents] })) }))); };
  hooks['/fp-state'] = (u, res, f) => res.end(JSON.stringify({ ops: Object.fromEntries(Object.entries(f.fp.ops).map(([k, v]) => [k, v.map(x => ({ id: x.id, index: x.index, n: x.contents.length }))])), log: f.fp.log }));
  hooks['/fp-reset'] = (u, res, f) => { f.fp = mk(); res.end('{"ok":true}'); };
  hooks['/fp-managers'] = (u, res, f) => { f.fp.noManagers = u.searchParams.get('none') === '1'; f.fp.down = u.searchParams.get('down') === '1'; res.end('{"ok":true}'); };

  // ---- the fake reader service
  const port = Number(process.env.AIRMAX_FP_HW_PORT || 0);
  if (!port || process.env.FP_FAKE_HW === 'off') return;   // FP_FAKE_HW=off: nothing listens on the port (a PC without a reader service)
  const http = require('http');
  const hw = { mode: 'ok', finger: 1, who: '', delay: 250, calls: [], held: [], seq: 0 };
  const field = (buf) => { const m = /name="input"\r\n\r\n([\s\S]*?)\r\n--/.exec(buf); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } };
  http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x'); const out = o => { s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/__fp/')) {
      const k = u.pathname.slice(6);
      if (k === 'mode') hw.mode = u.searchParams.get('m') || 'ok'; if (k === 'finger') hw.finger = Number(u.searchParams.get('i')) || 1; if (k === 'who') hw.who = u.searchParams.get('id') || ''; if (k === 'delay') hw.delay = Number(u.searchParams.get('ms')) || 0;
      if (k === 'reset') { hw.mode = 'ok'; hw.finger = 1; hw.who = ''; hw.delay = 250; hw.calls = []; hw.held.forEach(f => f()); hw.held = []; }
      return out({ ok: true, mode: hw.mode, calls: hw.calls });
    }
    const chunks = []; q.on('data', c => chunks.push(c)); q.on('end', () => {
      const inp = field(Buffer.concat(chunks).toString('utf8'));
      const name = u.pathname.replace('/Hardwares/', '');
      hw.calls.push({ name, n: inp ? (inp.fingerprintList || inp.managerFingerprints || []).length : 0 });
      if (name === 'FingerPrintRegistStop') { hw.held.splice(0).forEach(f => f()); return out({ success: true, value: null }); }
      const later = (fn) => { const t = setTimeout(() => { hw.held = hw.held.filter(x => x !== rel); fn(); }, hw.delay); const rel = () => { clearTimeout(t); out({ success: false, message: 'Fingerprint capture was stopped' }); }; hw.held.push(rel); };
      if (name === 'FingerPrintInput') {
        if (hw.mode === 'hold') { const rel = () => out({ success: false, message: 'Fingerprint capture was stopped' }); hw.held.push(rel); return; }
        if (hw.mode === 'nofinger') return later(() => out({ success: false, message: 'No finger was detected on the reader' }));
        if (hw.mode === 'dup') return later(() => out({ success: false, message: 'This fingerprint is already registered' }));
        return later(() => { const n = ++hw.seq; const i = hw.mode === 'differ' && n % 3 === 2 ? hw.finger + 1 : hw.finger; out({ success: true, value: { operatorId: '', fingerIndex: i, fingerprintBuffer: 'FAKE-BUF-' + n, captureTemplate: 'FAKE-TPL-NEW-' + n, remainingCollectedCount: 0 } }); });
      }
      if (name === 'ManagerAuthorization') {
        const list = (inp && inp.managerFingerprints) || [];
        if (hw.mode === 'hold') { const rel = () => out({ success: false, message: 'Fingerprint capture was stopped' }); hw.held.push(rel); return; }
        if (hw.mode === 'nomatch') return later(() => out({ success: false, message: 'The fingerprint does not match any manager' }));
        if (hw.mode === 'rogue') return later(() => out({ success: true, value: 'mgr-evil' }));   // the service names someone AIR POS never listed
        const who = hw.who || (list[0] && list[0].operatorId) || '';
        return later(() => out(list.some(m => m.operatorId === who) && list.every(m => (m.fingerprints || []).every(f => typeof f.fingerprint === 'string')) ? { success: true, value: who } : { success: false, message: 'The fingerprint does not match any manager' }));
      }
      out({ success: false, message: 'unknown call' });
    });
  }).listen(port);
};

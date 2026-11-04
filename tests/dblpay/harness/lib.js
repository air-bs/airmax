'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const DEEP = path.join(__dirname, '..'), WORK = process.env.DBL_WORK || '/tmp/airreg-dblpay', TMP = path.join(WORK, 'tmp'), REP = path.join(WORK, 'reports'); [TMP, REP, path.join(REP, 'evidence')].forEach(d => fs.mkdirSync(d, { recursive: true }));
const SIM_PORT = Number(process.env.SIM_PORT || 5186); // dblpay copy: own ports 5180-5186
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const PIDS = path.join(TMP, 'pids.txt');
function spawnLogged(name, script, env) {
  const out = fs.openSync(path.join(TMP, name + '.log'), 'a');
  const ch = cp.spawn(process.execPath, [script], { cwd: DEEP, env: { ...process.env, ...env }, stdio: ['ignore', out, out], detached: true });
  ch.unref(); fs.appendFileSync(PIDS, `${ch.pid} ${name} ${new Date().toISOString()}\n`); return ch.pid;
}
async function waitUp(url, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (r.status < 500) return true; } catch {} await sleep(150); } throw new Error('not up: ' + url); }
async function startSim(name = 'sim') { const pid = spawnLogged(name, 'sim/sim.js', { SIM_PORT: String(SIM_PORT) }); await waitUp(`http://127.0.0.1:${SIM_PORT}/__/health`); return pid; }
const regPort = reg => { const n = Number(String(reg).slice(1)); if (!(n >= 1 && n <= 6)) throw new Error('reg out of range'); return Number(process.env.DBL_PORT_BASE || 5179) + n; }; // R1..R6 = 5180..5185, sim 5186
async function startReg(reg, opts = {}) { const port = regPort(reg); if (opts.wipe) fs.rmSync(path.join(WORK, 'data', reg), { recursive: true, force: true });
  const pid = spawnLogged(reg, 'sim/app-run.js', { REG: reg, APP_PORT: String(port), SIM_PORT: String(SIM_PORT), ...(opts.env || {}) }); await waitUp(`http://127.0.0.1:${port}/api/state`); return pid; }
function kill(pid, sig = 'SIGKILL') { try { process.kill(pid, sig); return true; } catch { return false; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function rssKb(pid) { try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/); return m ? Number(m[1]) : null; } catch { return null; } }
async function sim(p, q = {}) { const u = `http://127.0.0.1:${SIM_PORT}/__${p}?` + new URLSearchParams(q); const r = await fetch(u); return r.json(); }
class Reg {
  constructor(name) { this.name = name; this.port = regPort(name); this.times = []; }
  async post(route, body = {}, ms = 90000) { const t0 = Date.now(); const r = await fetch(`http://127.0.0.1:${this.port}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    const txt = await r.text(); const dt = Date.now() - t0; this.times.push({ route, dt }); if (this.times.length > 5000) this.times.splice(0, 2500); try { return JSON.parse(txt); } catch { return { ok: false, http: r.status, raw: txt.slice(0, 200) }; } }
  async state() { const r = await fetch(`http://127.0.0.1:${this.port}/api/state`, { signal: AbortSignal.timeout(20000) }); return r.json(); }
  async login() { return this.post('login', { company: 'fake shop', user: 'tester', password: '<redacted>' }); }
  // 1.0.11-speed: scan answers before the total is back (totals.updating); a cashier waits for the total before reading the due, so do the same
  async scan(code) { const r = await this.post('scan', { code }); for (let i = 0; i < 200; i++) { const s = await this.state(); if (!(s.totals && s.totals.updating)) break; await sleep(25); } return r; }
  async cashExact() { const s = await this.state(); return this.post('pay-tender', { type: 10, tendered: s.pay ? s.pay.remaining : s.totals.due }); }
  async waitCard(ms = 30000) { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await this.state(); const c = s.pay && s.pay.card; if (!c || c.status !== 'waiting') return s; await sleep(250); } return s; }
}
// ledger helpers
async function ledger(since, reg) { return sim('/ledger', { since: String(since || 0), ...(reg ? { reg } : {}) }); }
async function seq() { return (await sim('/seq')).seq; }
// money oracle for one order (sim = what AIR POS recorded)
async function orderCheck(orderId, exp = {}) {
  const o = await sim('/order', { id: orderId }); const out = { issues: [], o };
  if (!o) { if (exp.done) out.issues.push('ORDER_MISSING'); return out; }
  const good = o.rcv.filter(x => x.status === 20), got = r2(good.reduce((a, x) => a + x.amount, 0));
  if (o.done && o.srv) o.srvDue = o.srv; /* completed: judge by the due AIR POS used at Complete, not today's coupon state */
  out.got = got; out.due = o.srvDue.due; out.done = !!o.done;
  if (exp.done === true && !o.done) out.issues.push('NOT_COMPLETED');
  if (exp.done === false && o.done) out.issues.push('UNEXPECTED_COMPLETE');
  if (o.done && got > o.srvDue.due + 0.004) out.issues.push(`OVERCHARGE got ${got} due ${o.srvDue.due}`);
  if (o.done && got + 0.004 < o.srvDue.due) out.issues.push(`UNDERCHARGE got ${got} due ${o.srvDue.due}`);
  if (exp.due != null && Math.abs(exp.due - o.srvDue.due) > 0.004) out.issues.push(`DUE_MISMATCH expected ${exp.due} server ${o.srvDue.due}`);
  const cardDone = good.filter(x => x.paymentType === 20 || x.paymentType === 30); if (cardDone.length > 1 && !exp.multiCard) out.issues.push(`MULTI_CARD x${cardDone.length}`);
  if (o.done && !(o.subs || []).length) out.issues.push('EMPTY_ORDER_COMPLETED');
  return out;
}
async function completesFor(orderId) { const l = await ledger(0); return l.filter(e => e.orderId === orderId && e.path === 'OrderComplete' && e.success).length; }
// results
const RES = path.join(REP, 'results.jsonl');
function record(r) { r.at = new Date().toISOString(); fs.appendFileSync(RES, JSON.stringify(r) + '\n'); return r; }
function counts() { const rows = fs.existsSync(RES) ? fs.readFileSync(RES, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; const c = { RUN: rows.length, PASSED: 0, FAILED: 0, INVALID: 0 }; rows.forEach(x => { c[x.result === 'PASS' ? 'PASSED' : x.result === 'FAIL' ? 'FAILED' : 'INVALID']++; }); return { c, rows }; }
const etNow = () => new Date().toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' ET';
function progress(phase, serious) { const { c } = counts(); const f = path.join(REP, 'PROGRESS.md'); const ser = serious || (fs.existsSync(path.join(REP, 'serious.txt')) ? fs.readFileSync(path.join(REP, 'serious.txt'), 'utf8').trim() : '(none yet)');
  fs.writeFileSync(f, `UPDATED: ${etNow()}\nPHASE: ${phase}\nRUN: ${c.RUN} PASSED: ${c.PASSED} FAILED: ${c.FAILED} INVALID: ${c.INVALID}\nSERIOUS:\n${ser || '(none yet)'}\n`); }
module.exports = { DEEP, TMP, REP, SIM_PORT, sleep, r2, mulberry32, startSim, startReg, kill, alive, rssKb, sim, Reg, ledger, seq, orderCheck, completesFor, record, counts, progress, regPort, waitUp, etNow };

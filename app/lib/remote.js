'use strict';
// lib/remote.js - Air Register "Settings > Remote Help" (RustDesk on the free public servers).
// Copy to app/lib/remote.js. Windows only; on other OSes status() returns {installed:false}.
// Never reads or returns the remote password: that file is Administrators-only by design.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PF = process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files';
const RD_EXE = path.join(PF, 'RustDesk', 'rustdesk.exe');
const DATA = path.join(process.env.ProgramData || 'C:\\ProgramData', 'AirRegister', 'remote');
const ID_CACHE = path.join(DATA, 'remote-id.txt');

function run(file, args, ms = 15000) {
  return new Promise(resolve => {
    execFile(file, args, { windowsHide: true, timeout: ms }, (err, stdout) => resolve({ err, out: String(stdout || '').trim() }));
  });
}

class RemoteHelp {
  constructor({ scriptsDir, log } = {}) {
    this.scriptsDir = scriptsDir;           // e.g. path.join(INSTALL_DIR, 'remote')
    this.log = log || (() => {});
  }

  async status() {
    if (process.platform !== 'win32' || !fs.existsSync(RD_EXE)) return { ok: true, installed: false };
    const r = await run(RD_EXE, ['--get-id']);
    let id = /^\d{6,}$/.test(r.out) ? r.out : '';
    if (!id && fs.existsSync(ID_CACHE)) id = fs.readFileSync(ID_CACHE, 'utf8').trim();
    const sc = await run('sc.exe', ['query', 'RustDesk'], 5000);
    const running = /STATE\s*:\s*4\s+RUNNING/i.test(sc.out);
    return { ok: true, installed: true, id, idPretty: id.replace(/(\d{3})(?=\d)/g, '$1 '), serviceRunning: running };
  }

  // Opens ONE Windows permission (UAC) prompt, then the script shows the new ID + password once.
  // mode: 'install' (first time) or 'reset' (new password). Call only after a manager login.
  elevate(mode) {
    if (process.platform !== 'win32') return { ok: false, message: 'Windows only' };
    const script = path.join(this.scriptsDir, 'install-remote.ps1');
    if (!fs.existsSync(script)) return { ok: false, message: 'Remote help files are missing; reinstall Air Max.' }; // ls9n~
    const inner = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"` + (mode === 'reset' ? ' -ResetPassword' : '');
    const cmd = `Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '${inner.replace(/'/g, "''")}'`;
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, detached: true, stdio: 'ignore' });
    p.unref();
    this.log('remote help: ' + mode + ' requested');
    return { ok: true, message: 'Windows will ask for permission. The ID and password will appear in a box once.' };
  }
}

module.exports = { RemoteHelp, RD_EXE };

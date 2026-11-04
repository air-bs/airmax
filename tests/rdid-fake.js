// AirMax 1.0.4 test only: the offline fake AIR POS (tests/fake-server.js) with a FAKED RustDesk status, since RustDesk cannot run
// on the Linux test box. FAKE_RDID=<digits> = installed with that ID; FAKE_RDID=absent = RustDesk not installed.
// A made-up "password" file (RDID_SENTINEL) sits next to the ID file in a temp ProgramData, so tests can prove it never leaks.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const pd = fs.mkdtempSync(path.join(os.tmpdir(), 'rdid-pd-')), rd = path.join(pd, 'AirRegister', 'remote');
fs.mkdirSync(rd, { recursive: true });
const SENT = process.env.RDID_SENTINEL || 'PW-SENTINEL-never-shown-7Qx';
fs.writeFileSync(path.join(rd, 'remote-access.txt'), 'ID: 123456789\r\nPassword: ' + SENT + '\r\n');
if (process.env.FAKE_RDID && process.env.FAKE_RDID !== 'absent') fs.writeFileSync(path.join(rd, 'remote-id.txt'), process.env.FAKE_RDID);
process.env.ProgramData = pd;
const { RemoteHelp } = require('../app/lib/remote');
RemoteHelp.prototype.status = async function () { // same reply shape as lib/remote.js status() on Windows
  const id = process.env.FAKE_RDID && process.env.FAKE_RDID !== 'absent' ? process.env.FAKE_RDID : null;
  if (!id) return { ok: true, installed: false };
  return { ok: true, installed: true, id, idPretty: id.replace(/(\d{3})(?=\d)/g, '$1 '), serviceRunning: true };
};
require('./fake-server.js');

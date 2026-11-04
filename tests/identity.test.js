// Static identity checks: Air Register (AIR POS look) must never share a name, folder, port, mutex, autostart
// value, uninstall key, shortcut, update feed or Remote Help with the store Air Register. Also run by build.sh.
// Run: node tests/identity.test.js
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const R = path.join(__dirname, '..'); const rd = f => fs.readFileSync(path.join(R, f), 'utf8');
let pass = 0, fail = 0;
const rec = (name, ok, d = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (d ? ' — ' + d : '')); };
const nsi = rd('pkg/installer.nsi'), ps = rd('pkg/stage/AirRegister.ps1'), build = rd('build.sh'), vbs = rd('pkg/stage/Air Register.vbs');
const code = l => l.replace(/;.*$/, '');   // NSIS comments
const nsiCode = nsi.split('\n').map(code).join('\n');
rec('installer: APPID AirRegisterAirposLook (unchanged), shown name "Air Max" (Oct 30 rename)', /!define APPID "AirRegisterAirposLook"/.test(nsi) && /!define APPNAME "Air Max"/.test(nsi));
rec('installer: upgrade removes only OUR old-name shortcuts "Air Register (AIR POS look)" (never the store "Air Register")', /!define OLDNAME "Air Register \(AIR POS look\)"/.test(nsi) && /Delete "\$DESKTOP\\\$\{OLDNAME\}\.lnk"/.test(nsiCode) && /RMDir \/r "\$SMPROGRAMS\\\$\{OLDNAME\}"/.test(nsiCode));
rec('launcher: window / message-box name "Air Max"', /\$AppName = 'Air Max'/.test(ps));
rec('installer: uninstall key = ...\\Uninstall\\${APPID}', /!define REGKEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{APPID\}"/.test(nsi));
rec('installer: install folder %LOCALAPPDATA%\\Programs\\${APPID}', /InstallDir "\$LOCALAPPDATA\\Programs\\\$\{APPID\}"/.test(nsi));
rec('installer: output AirRegister-AirposLook-Setup-<v>.exe', /OutFile "out\/\$\{VERSION\}\/AirRegister-AirposLook-Setup-\$\{VERSION\}\.exe"/.test(nsi));
rec('installer: no "Standalone" anywhere in code (folder, key, data, output)', !/Standalone/i.test(nsiCode), (nsiCode.match(/.*Standalone.*/i) || [''])[0]);
rec('installer: no Remote Help (include, page, run, uninstall)', !/REMOTEHELP|remote-help\.nsh/i.test(nsiCode));
rec('uninstall removes only OUR desktop shortcut', /Delete "\$DESKTOP\\\$\{APPNAME\}\.lnk"/.test(nsi) && !/Delete "\$DESKTOP\\Air Register\.lnk"/.test(nsiCode));
rec('uninstall removes only OUR Start-menu folder (never "$SMPROGRAMS\\Air Register")', /RMDir \/r "\$SMPROGRAMS\\\$\{APPNAME\}"/.test(nsi) && !/"\$SMPROGRAMS\\Air Register"/.test(nsiCode));
rec('uninstall removes only OUR Run value (never "AirRegister")', /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "\$\{APPID\}"/.test(nsi) && !/\\Run" "AirRegister"/.test(nsiCode));
rec('installer: data folder %LOCALAPPDATA%\\${APPID}', /CreateDirectory "\$LOCALAPPDATA\\\$\{APPID\}"/.test(nsi));
// launcher: store identity only allowed on the lines that DETECT the store app
const psLines = ps.split('\n').filter(l => !/store-app-detect/.test(l) && !/^\s*#/.test(l));
const psCode = psLines.join('\n');
rec('launcher: data folder AirRegisterAirposLook', /Join-Path \$env:LOCALAPPDATA 'AirRegisterAirposLook'/.test(ps));
rec('launcher: default port 5157', /else \{ 5157 \}/.test(ps) && !/5057/.test(psCode));
rec('launcher: own mutex Local\\AirRegisterAirposLookLauncher', /Mutex\(\$false, 'Local\\AirRegisterAirposLookLauncher'\)/.test(ps));
rec('launcher: own autostart value AirRegisterAirposLook (set + remove)', (ps.match(/-Name 'AirRegisterAirposLook'/g) || []).length === 2 && !/-Name 'AirRegister'\s/.test(psCode));
rec('launcher: no store names outside store detection', !/Standalone/i.test(psCode), (psCode.match(/.*Standalone.*/i) || [''])[0]);
rec('launcher: refuses to start while the store app is open (mutex or port 5057)', /function Store-AppRunning/.test(ps) && /TryOpenExisting\('Local\\AirRegisterStandaloneLauncher'/.test(ps) && /PortOpen 5057/.test(ps) && /if \(Store-AppRunning\) \{[^}]*Fail /.test(ps));
rec('launcher: store check happens before the server starts', ps.indexOf('if (Store-AppRunning)') > 0 && ps.indexOf('if (Store-AppRunning)') < ps.indexOf('Start-Server', ps.indexOf('if ($first)')));
rec('vbs: names this app', /Air Max/.test(vbs));
// server / configs
rec('server.js default port 5157', /Object\.assign\(\{ port: 5157,/.test(rd('app/server.js')));
rec('config.customer.json port 5157, customer build, no blocked companies', (c => c.port === 5157 && c.build === 'customer' && !c.blockedCompanies.length)(JSON.parse(rd('app/config.customer.json'))));
rec('server: remote-setup never elevates (Remote Help belongs to the store app)', !/remote\.elevate\(/.test(rd('app/server.js')));
// feed / short link nowhere except the refusal lists
const allow = { 'app/lib/updater.js': /^const STORE_FEED/, 'build.sh': /store feed\/link found|ar-7e2b62e7c5c4\) or behind is\.gd\/airbiz_dl/ };
const files = ['app/update.json', 'app/server.js', 'app/lib/updater.js', 'pkg/installer.nsi', 'pkg/stage/AirRegister.ps1', 'pkg/Read Me.txt', 'build.sh', 'app/config.customer.json'].concat(fs.readdirSync(path.join(R, 'app/public')).filter(f => /\.(js|html|json)$/.test(f)).map(f => 'app/public/' + f));
const hits = [];
for (const f of files) rd(f).split('\n').forEach((l, i) => { if (/ar-7e2b62e7c5c4|airbiz_dl/i.test(l) && !(allow[f] && allow[f].test(l.trim()))) hits.push(f + ':' + (i + 1)); });
rec('store repo ar-7e2b62e7c5c4 / is.gd/airbiz_dl used nowhere (only in refusal checks)', hits.length === 0, hits.join(', '));
// build is self-contained
const bCode = build.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
rec('build.sh reads nothing outside this folder (no ../)', !/\.\.\//.test(bCode));
rec('build.sh names: AirRegister-AirposLook-Setup-$V.exe + stable AirRegister-AirposLook-Setup.exe', /EXE="AirRegister-AirposLook-Setup-\$V\.exe"/.test(build) && /AirRegister-AirposLook-Setup\.exe"/.test(build) && !/AirRegister-Setup\.exe"/.test(build) && !/Standalone/.test(bCode));
// device id handling untouched (shared with AIR POS / store app on purpose)
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(R, f))).digest('hex');
// 1.0.10-local.2 (Ari OK 11:44 AM ET Nov 1: "Yes, OK to update Air Max's printer helper for the Star drawer and fit-to-width"):
// only the device id handling stays locked: the "deviceInfo" command + the whole Device class must equal the store 1.2.1 helper
// (that part of the store file, whose whole-file sha was 44cb9267...). The printing code around it may change.
const devSection = src => { const L = src.replace(/\r/g, '').split('\n'); const a = L.findIndex(l => /^\s*case "deviceInfo":/.test(l)); const s = L.findIndex(l => /^    static class Device\b/.test(l)); if (a < 0 || s < 0) return ''; let e = s; while (e < L.length && L[e] !== '    }') e++; return L.slice(a, a + 4).join('\n') + '\n' + L.slice(s, e + 1).join('\n'); };
const devSrc = devSection(rd('hw/Program.cs'));
rec('hardware helper device id handling (deviceInfo command + Device class) identical to store 1.2.1', crypto.createHash('sha256').update(devSrc).digest('hex') === 'ec105a5605e2d1e67740f02c62850a371494c081c174ac69edff9e2711674b31' && devSrc.split('\n').length === 102);
rec('helper: no other code reads or writes the device id file', (rd('hw/Program.cs').match(/device_id\.txt/g) || []).length === (devSrc.match(/device_id\.txt/g) || []).length + 1);
rec('icon is NOT the store icon (blue AIR POS look icon)', sha('pkg/stage/AirRegister.ico') !== '8350d3908a06d869896d3602120bed66b199d74614897333dde67b08116cf57f' && sha('app/public/icon.ico') === sha('pkg/stage/AirRegister.ico'));
// UI names
rec('window titles name this app (Air Max)', /<title>Air Max<\/title>/.test(rd('app/public/index.html')) && /<title>Air Max customer display/.test(rd('app/public/customer.html')) && JSON.parse(rd('app/public/manifest.json')).name === 'Air Max');
console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);

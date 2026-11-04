// 1.0.10-local.2: runs the helper's PrintFit (fit-to-width) math tests (tests/hwfit, .NET) when dotnet is on this machine.
// No dotnet = SKIPPED (never reported as a pass). Usage: node tests/hwfit.test.js
'use strict';
const { spawnSync } = require('child_process'), fs = require('fs'), path = require('path');
const dn = [process.env.DOTNET, '/home/box/dotnet/dotnet', 'dotnet'].find(d => d && (d === 'dotnet' || fs.existsSync(d)));
const r = spawnSync(dn, ['run', '--project', path.join(__dirname, 'hwfit')], { encoding: 'utf8', timeout: 240000, env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
if (r.error && r.error.code === 'ENOENT') { console.log('SKIPPED hwfit: dotnet not found'); process.exit(0); }
process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
const m = /hwfit: (\d+)\/(\d+) passed/.exec(r.stdout || '');
console.log(m ? `${m[1]}/${m[2]} helper fit-to-width tests passed` : 'FAIL hwfit: no result line');
process.exit(r.status === 0 && m && m[1] === m[2] ? 0 : 1);

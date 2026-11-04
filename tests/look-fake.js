// Same fake AIR POS as tests/fake-server.js, under its own process name so a global `pkill -f tests/fake-server.js`
// by another agent's test runner (the box is shared) does not stop this app's test server mid-run.
require('./fake-server.js');

'use strict';
// Batch 6: tiny client for the AIR POS local hardware service (default http://localhost:20001), fingerprint calls only:
//   160 FingerPrintInput, 162 FingerPrintRegistStop, 163 ManagerAuthorization.
// (7 FingerprintSelectByUserName and 161 FingerPrintVerification are NOT here: no fingerprint login in this batch.)
// The port comes from env AIRMAX_FP_HW_PORT (tests use a fake service), read at call time; default 20001. The host is always this PC.
// Fingerprint templates travel only in the request body to this PC's service and are never logged, cached or returned to the browser.
// Every call answers { success, message, value, unreachable? }; it never throws. Nothing from a body or an answer is logged here.
const http = require('http'), crypto = require('crypto');

const port = () => Number(process.env.AIRMAX_FP_HW_PORT) || 20001;
const HOST = process.env.AIRMAX_FP_HW_HOST || 'localhost';

// POST multipart/form-data { input: <json string> } like the AIR POS app does ("isFormData" with params { input }).
function post(path, input, timeoutMs) {
  return new Promise(resolve => {
    const unreachable = why => resolve({ success: false, unreachable: true, message: 'The fingerprint reader service on this PC did not answer (' + why + ').' });
    let done = false; const fin = r => { if (done) return; done = true; resolve(r); };
    try {
      const boundary = '----airmax' + crypto.randomBytes(12).toString('hex');
      const body = input == null ? Buffer.alloc(0) : Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="input"\r\n\r\n${typeof input === 'string' ? input : JSON.stringify(input)}\r\n--${boundary}--\r\n`, 'utf8');
      const req = http.request({ host: HOST, port: port(), path, method: 'POST', headers: input == null ? { 'Content-Length': 0 } : { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length } }, res => {
        const chunks = []; let n = 0;
        res.on('data', c => { n += c.length; if (n > 1e6) { req.destroy(); return unreachable('answer too large'); } chunks.push(c); });
        res.on('end', () => {
          let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return fin({ success: false, message: 'The fingerprint reader service sent an answer this app cannot read (HTTP ' + res.statusCode + ').' }); }
          if (!j || typeof j !== 'object') return fin({ success: false, message: 'The fingerprint reader service sent an answer this app cannot read.' });
          fin({ success: j.success === true, message: typeof j.message === 'string' ? j.message.slice(0, 200) : '', value: j.value });
        });
      });
      req.setTimeout(timeoutMs, () => { req.destroy(); unreachable('timed out'); });
      req.on('error', e => unreachable(e && e.code ? e.code : 'error'));
      req.end(body);
    } catch (e) { unreachable('error'); }
  });
}

module.exports = {
  // 160: wait for one finger on the reader; list = [{ index, fingerprint }] of prints that already exist (the reader refuses a repeat)
  input: (list, timeoutMs = 45000) => post('/Hardwares/FingerPrintInput', { fingerprintList: list }, timeoutMs),
  // 162: stop whatever the reader is waiting for (cancel / time-out / closed window)
  stop: () => post('/Hardwares/FingerPrintRegistStop', null, 5000),
  // 163: 1-to-N match against the managers' saved prints; value = the matching manager's id
  managerAuthorization: (list, timeoutMs = 45000) => post('/Hardwares/ManagerAuthorization', { managerFingerprints: list }, timeoutMs),
  port,
};

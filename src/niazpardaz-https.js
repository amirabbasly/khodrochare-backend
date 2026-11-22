const https = require('node:https');

// Same REST payload as the SDK, using Node's HTTP/1.1 HTTPS client instead of
// fetch/Undici. Opt-in transport; no automatic retries or redirects.
function createHttpsSmsClient(key, options = {}, request = https.request) {
  const base = options.baseUrl || 'https://login.niazpardaz.ir/api/v2/RestWebApi';
  const url = new URL(base.replace(/\/+$/, '') + '/SendBatchSms');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid SMS HTTPS endpoint');
  return { send(fromNumber, toNumber, messageContent) {
    const body = JSON.stringify({ fromNumber, messageContent, toNumbers: toNumber, isFlash: false });
    return new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const req = request(url, { method: 'POST', headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'X-API-Key': key,
        'Content-Length': Buffer.byteLength(body),
      } }, res => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error('SMS_HTTP_ERROR'); error.errorCode = res.statusCode;
          finish(error); res.destroy(); return;
        }
        let bytes = 0; const chunks = [];
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 65536) { finish(new Error('SMS_RESPONSE_TOO_LARGE')); res.destroy(); return; }
          chunks.push(chunk);
        });
        res.on('error', error => finish(error));
        res.on('aborted', () => finish(new Error('SMS_RESPONSE_ABORTED')));
        res.on('end', () => {
          if (settled) return;
          try {
            const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (envelope.success !== true) { finish(new Error('SMS_PROVIDER_FAILURE')); return; }
            finish(null, envelope.result);
          } catch { finish(new Error('SMS_INVALID_RESPONSE')); }
        });
      });
      req.on('error', error => finish(error));
      timer = setTimeout(() => {
        const error = new Error('SMS timeout');
        finish(error); req.destroy(error);
      }, options.timeout || 10000);
      req.end(body);
    });
  } };
}
module.exports = { createHttpsSmsClient };

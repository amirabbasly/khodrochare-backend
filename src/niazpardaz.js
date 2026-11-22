const { NiazpardazSmsClient, SendResultCode } = require('niazpardazsms');
const { HttpError } = require('./domain');
const OTP_TEMPLATE = 'کد تأیید شما برای ورود به اپلیکیشن خودروچاره:\n{code}\nلطفاً این کد را در اختیار دیگران قرار ندهید.';
function createNiazpardaz(config, createClient = (key, options) => new NiazpardazSmsClient(key, options), report = detail => console.error('Customer OTP SMS:', detail)) {
  const key = (config.NIAZPARDAZ_API_KEY || '').trim();
  const template = (config.NIAZPARDAZ_OTP_TEMPLATE || OTP_TEMPLATE).replace(/\\n/g, '\n');
  const enabled = Boolean(key && template.includes('{code}'));
  const client = enabled ? createClient(key, { timeout: 10000, ...(config.NIAZPARDAZ_BASE_URL ? { baseUrl: config.NIAZPARDAZ_BASE_URL } : {}) }) : null;
  return { enabled, async sendCode(phone, code) {
    if (!enabled) throw new HttpError(503, 'ارسال کد تأیید هنوز در سرور تنظیم نشده است.');
    try {
      // The official SDK sends complete text. The shared service line accepts
      // approved templates; never invent a separate, undocumented pattern API.
      const result = await client.send(config.NIAZPARDAZ_SENDER || '10009611', phone, template.replaceAll('{code}', code));
      if (result?.resultCode !== SendResultCode.SendWasSuccessful || !result.batchSmsId || Number(result.batchSmsId) <= 0) {
        const error = new Error('SMS_NOT_ACCEPTED');
        error.providerResultCode = result?.resultCode;
        throw error;
      }
    } catch (error) {
      // Never log SDK messages: provider/network errors can contain private data.
      const detail = { reason: 'PROVIDER_OR_NETWORK_FAILURE' };
      if (Number.isInteger(error?.providerResultCode)) {
        detail.reason = 'PROVIDER_REJECTED';
        detail.resultCode = error.providerResultCode;
      } else if (Number.isInteger(error?.errorCode)) {
        detail.reason = 'PROVIDER_HTTP_ERROR';
        detail.httpStatus = error.errorCode;
      } else if (/تایم.?اوت|timeout|timed out/i.test(error?.message || '')) detail.reason = 'TIMEOUT';
      else if (/ENOTFOUND|EAI_AGAIN/.test(error?.message || '')) detail.reason = 'DNS_ERROR';
      else if (/fetch failed|ECONNREFUSED|ECONNRESET/.test(error?.message || '')) detail.reason = 'CONNECTION_ERROR';
      try { report(detail); } catch { /* Diagnostics must not alter authentication. */ }
      throw new HttpError(503, 'ارسال پیامک تأیید انجام نشد؛ کمی بعد دوباره تلاش کنید.');
    }
  } };
}
module.exports = { createNiazpardaz, OTP_TEMPLATE };

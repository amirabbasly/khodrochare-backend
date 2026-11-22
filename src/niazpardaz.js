const { NiazpardazSmsClient, SendResultCode } = require('niazpardazsms');
const { HttpError } = require('./domain');
const OTP_TEMPLATE = 'کد تأیید شما برای ورود به اپلیکیشن خودروچاره:\n{code}\nلطفاً این کد را در اختیار دیگران قرار ندهید.';
function createNiazpardaz(config, createClient = (key, options) => new NiazpardazSmsClient(key, options)) {
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
      if (result?.resultCode !== SendResultCode.SendWasSuccessful || !result.batchSmsId || Number(result.batchSmsId) <= 0) throw new Error('SMS_NOT_ACCEPTED');
    } catch { throw new HttpError(503, 'ارسال پیامک تأیید انجام نشد؛ کمی بعد دوباره تلاش کنید.'); }
  } };
}
module.exports = { createNiazpardaz, OTP_TEMPLATE };

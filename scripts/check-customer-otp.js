// Default: configuration only. SMS requires the explicit --send-test-sms flag.
require('dotenv').config({ quiet: true });
const { randomInt } = require('node:crypto');
const { OTP_TEMPLATE, createNiazpardaz } = require('../src/niazpardaz');
const base = process.env.NIAZPARDAZ_BASE_URL || 'https://login.niazpardaz.ir/api/v2/RestWebApi';
const transportArg = process.argv.slice(2).find(arg => arg.startsWith('--transport='));
const transport = transportArg ? transportArg.slice(12) : process.env.NIAZPARDAZ_TRANSPORT || 'sdk';
let endpoint = 'INVALID_URL';
try {
  const url = new URL(base);
  endpoint = url.origin + url.pathname.replace(/\/+$/, '') + '/SendBatchSms';
} catch {}
const template = (process.env.NIAZPARDAZ_OTP_TEMPLATE || OTP_TEMPLATE).replace(/\\n/g, '\n');
console.log(JSON.stringify({
  apiKeyConfigured: Boolean(process.env.NIAZPARDAZ_API_KEY?.trim()),
  sender: process.env.NIAZPARDAZ_SENDER || '10009611',
  endpoint,
  matchesSuccessfulPostmanEndpoint: endpoint === 'https://login.niazpardaz.ir/api/v2/RestWebApi/SendBatchSms',
  usesDefaultTemplate: template === OTP_TEMPLATE,
  templateHasCode: template.includes('{code}'),
  nodeVersion: process.version,
  transport,
  smsSent: false,
}, null, 2));

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) return;
  const phoneArg = args.find(arg => arg.startsWith('--phone='));
  if (!args.includes('--send-test-sms') || args.length !== (transportArg ? 3 : 2) || !['sdk','https'].includes(transport) || !phoneArg || !/^09\d{9}$/.test(phoneArg.slice(8))) {
    console.error('Usage: node scripts/check-customer-otp.js --send-test-sms --phone=09XXXXXXXXX [--transport=https|sdk]');
    process.exitCode = 1;
    return;
  }
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    console.error('Invalid HTTPS SMS base URL. No SMS sent.');
    process.exitCode = 1;
    return;
  }
  const provider = createNiazpardaz({ ...process.env, NIAZPARDAZ_TRANSPORT: transport });
  if (!provider.enabled) {
    console.error('SMS configuration incomplete. No SMS sent.');
    process.exitCode = 1;
    return;
  }
  const started = Date.now();
  try {
    await provider.sendCode(phoneArg.slice(8), String(randomInt(100000, 1000000)));
    console.log(JSON.stringify({ test: 'actual-api-sms-adapter', providerAccepted: true, durationMs: Date.now() - started, usableForLogin: false }));
  } catch {
    // The adapter reports only safe status/reason fields; never print SDK payloads.
    console.error(JSON.stringify({ test: 'actual-api-sms-adapter', providerAccepted: false, durationMs: Date.now() - started }));
    process.exitCode = 1;
  }
}
main().catch(() => { console.error('Diagnostic failed. Check the configuration.'); process.exitCode = 1; });

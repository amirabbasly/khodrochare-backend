const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { hashPassword } = require('../src/domain');
async function main() {
  const root = path.resolve(__dirname, '..');
  const target = path.join(root, '.env');
  const content = fs.readFileSync(target, 'utf8');
  if (/^ADMIN_PASSWORD_HASH=.+$/m.test(content)) { console.log('Admin configuration already exists; preserved.'); return; }
  if (fs.existsSync(path.join(root, 'ADMIN-CREDENTIALS.txt'))) throw new Error('Existing credentials file found; preserve it before creating a new login.');
  const password = randomBytes(24).toString('base64url');
  const hash = await hashPassword(password);
  const clean = content.replace(/^ADMIN_(USERNAME|PASSWORD_HASH)=.*\r?\n?/gm, '');
  fs.writeFileSync(target, clean + `\nADMIN_USERNAME=admin\nADMIN_PASSWORD_HASH=${hash}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(root, 'ADMIN-CREDENTIALS.txt'), `Username: admin\nPassword: ${password}\n`, { flag: 'wx', mode: 0o600 });
  console.log('Admin login created. Credentials are in the ignored ADMIN-CREDENTIALS.txt file.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

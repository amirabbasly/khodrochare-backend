const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  console.log('.env already exists; preserved existing configuration.');
} else {
  const password = randomBytes(32).toString('hex');
  const redisPassword = randomBytes(32).toString('hex');
  let content = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  content = content.replace(/CHANGE_WITH_SETUP_SCRIPT/g, password);
  content = content.replace(/^REDIS_PASSWORD=.*$/m, `REDIS_PASSWORD=${redisPassword}`).replace(/^REDIS_URL=.*$/m, `REDIS_URL=redis://:${redisPassword}@redis:6379`);
  fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with random database and Redis credentials. Configure CORS_ORIGINS and your towing tariff before deployment.');
}

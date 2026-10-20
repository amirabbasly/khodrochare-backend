// Run only when authoring this migration, not at each deployment.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { MODELS, TARIFFS, VERSION, normalize } = require('../src/pricing');
const sql = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;
const titles = { GROUP_1: 'گروه اول', GROUP_2: 'گروه دوم', GROUP_3: 'گروه سوم', GROUP_4: 'گروه چهارم', GROUP_5: 'گروه پنجم ـ توافقی', NISSAN_PICKUP: 'نیسان وانت/یخچال' };
const lines = ['\n-- Initial vehicle groups and aliases from the supplied tariff reference.'];
for (const [id, title] of Object.entries(titles)) {
  const rate = TARIFFS[id] || {};
  lines.push(`INSERT INTO "TariffGroup" (id,title,"nissanBaseToman","nissanPerKmToman","flatbedBaseToman","flatbedPerKmToman",version) VALUES (${[id, title, rate.NISSAN?.[0], rate.NISSAN?.[1], rate.FLATBED?.[0], rate.FLATBED?.[1], VERSION].map(sql).join(',')});`);
}
const seen = new Set();
const models = { ...MODELS, GROUP_5: [...MODELS.GROUP_5, 'سایر خودروها'] };
for (const [groupId, names] of Object.entries(models)) {
  for (const name of names) {
    const normalizedName = normalize(name);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const id = 'vm_' + crypto.createHash('sha256').update(normalizedName).digest('hex').slice(0, 24);
    const aliases = [...new Set([normalizedName, normalizedName.replace(/^پژو/, ''), normalizedName.replace(/^مزدا/, '')])];
    lines.push(`INSERT INTO "VehicleModel" (id,name,"normalizedName",aliases,"searchText","groupId") VALUES (${[id, name, normalizedName].map(sql).join(',')},ARRAY[${aliases.map(sql).join(',')}],${sql(aliases.join('|'))},${sql(groupId)});`);
  }
}
const target = 'prisma/migrations/202610200002_catalog_addresses_payments/migration.sql';
const current = fs.readFileSync(target, 'utf8');
if (current.includes('-- Initial vehicle groups')) throw new Error('Seed already present; do not regenerate an applied migration');
fs.appendFileSync(target, lines.join('\n') + '\n');
console.log(`Seeded ${Object.keys(titles).length} tariff groups and ${seen.size} searchable vehicle names.`);

// Authoring helper for this new migration; never rewrite a migration already deployed.
const {expandedCars}=require('../src/vehicle-catalog');
const{createHash}=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
const quote=v=>"'"+v.replace(/'/g,"''")+"'";
const lines=['-- Curated name taxonomy; no engine, fitment or maintenance interval is inferred.'];
for(const car of expandedCars()){
 const id='car_'+createHash('sha256').update(car.key).digest('hex').slice(0,24);
 const values=[id,car.key,car.maker,car.model,car.trim].map(quote).join(',');
 lines.push(`INSERT INTO "MarketCar" (id,"key",maker,model,trim,aliases) VALUES (${values},ARRAY[${car.aliases.map(quote).join(',')}]::text[]) ON CONFLICT ("key") DO UPDATE SET aliases=ARRAY(SELECT DISTINCT unnest("MarketCar".aliases || EXCLUDED.aliases));`);
}
const target=path.join(__dirname,'../prisma/migrations/202611190003_vehicle_names/migration.sql');
const expected=lines.join('\n')+'\n';
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==expected)throw new Error('Vehicle migration differs from curated data');console.log('Vehicle taxonomy matches migration');}else if(process.argv.includes('--author'))fs.writeFileSync(target,expected);else throw new Error('Use --check or --author (only before deploying this migration)');

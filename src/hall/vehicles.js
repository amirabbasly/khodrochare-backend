const {Prisma}=require('@prisma/client');
const {normalize}=require('./domain');
function vehicleSearchSql({q='',make,model}){
  const words=normalize(q).split(' ').filter(Boolean).slice(0,12);
  const clauses=words.map(word=>Prisma.sql`(strpos(replace(lower("key"),' ',''),${word})>0 OR EXISTS(SELECT 1 FROM unnest(aliases) AS alias WHERE strpos(replace(lower(alias),' ',''),${word})>0))`);
  if(make)clauses.push(Prisma.sql`maker=${make}`);
  if(model)clauses.push(Prisma.sql`model=${model}`);
  return Prisma.sql`SELECT id,maker,model,trim FROM "MarketCar" ${clauses.length?Prisma.sql`WHERE ${Prisma.join(clauses,' AND ')}`:Prisma.empty} ORDER BY "key" ASC LIMIT 40`;
}
module.exports={vehicleSearchSql};

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publicLocation}=require('../src/hall/location');
const {listingDto}=require('../src/hall/service');
const {draftSchema,publicationDetails}=require('../src/hall/domain');
const {vehicleSearchSql}=require('../src/hall/vehicles');
const point={latitude:35.712345,longitude:51.423456,visibility:'AREA',address:'Private street and building 27'};
test('area locations publish only a stable coarse 2 km circle; the exact point and address stay private',()=>{
  const row={id:'test',status:'PUBLISHED',draft:{location:point,fuelType:'بنزین',gearboxType:'اتوماتیک'},photos:[],orders:[]};
  const publicRow=listingDto(row),privateRow=listingDto(row,true);
  assert.equal(publicRow.location.radiusMeters,2000);assert.equal(publicRow.location.visibility,'AREA');
  assert.notEqual(publicRow.location.latitude,point.latitude);assert.notEqual(publicRow.location.longitude,point.longitude);
  assert.equal(publicRow.location.address,undefined);assert.equal(publicRow.details,undefined);
  assert.ok(!JSON.stringify(publicRow).includes(point.address));assert.ok(!JSON.stringify(publicRow).includes(String(point.latitude)));
  assert.deepEqual(privateRow.details.location,point);assert.deepEqual(privateRow.location,point);
  assert.deepEqual(publicLocation({...point,latitude:35.719,longitude:51.429}),publicRow.location);
  const distance=Math.hypot((point.latitude-publicRow.location.latitude)*111320,(point.longitude-publicRow.location.longitude)*111320*Math.cos(point.latitude*Math.PI/180));assert.ok(distance<2000);
  const exact=publicLocation({...point,visibility:'EXACT'});assert.equal(exact.latitude,point.latitude);assert.equal(exact.longitude,point.longitude);assert.equal(exact.address,point.address);assert.equal(exact.radiusMeters,0);
});
test('drafts support partial data, while publication requires fuel, gearbox, a valid point and a privacy choice',()=>{
  assert.deepEqual(draftSchema.parse({}),{});
  for(const patch of [{latitude:NaN},{latitude:91},{longitude:181},{visibility:'OTHER'},{radiusMeters:20}])assert.throws(()=>draftSchema.parse({location:{...point,...patch}}));
  assert.throws(()=>draftSchema.parse({fuelType:'invalid'}));assert.throws(()=>draftSchema.parse({gearboxType:'invalid'}));
  const input={make:'پژو',model:'207',trim:'پانوراما',year:1403,mileage:20000,color:'سفید',bodyCondition:'سالم',technicalCondition:'سالم',city:'تهران',description:'خودروی سالم با سابقه سرویس و نگهداری منظم',contactPhone:'09901234567',priceToman:3500000000,fuelType:'بنزین',gearboxType:'اتوماتیک',location:point};
  assert.equal(publicationDetails.parse(input).fuelType,'بنزین');
  for(const field of ['fuelType','gearboxType','location']){const copy={...input};delete copy[field];assert.throws(()=>publicationDetails.parse(copy));}
  assert.equal(listingDto({status:'PUBLISHED',draft:{},photos:[],orders:[]}).location,undefined,'legacy ads do not invent a location');
});
test('vehicle search normalizes Persian digits and binds all user input as SQL values',()=>{
  const query=vehicleSearchSql({q:'پژو ۲۰۷'});assert.ok(query.values.includes('207'));assert.ok(query.values.includes('پژو'));assert.ok(query.sql.includes('unnest'));assert.ok(query.sql.includes('LIMIT 40'));assert.ok(!query.sql.includes('پژو'));
  const hostile=vehicleSearchSql({q:"207' OR 1=1--"});assert.ok(!hostile.sql.includes("207'"));assert.ok(hostile.values.length>0);
});

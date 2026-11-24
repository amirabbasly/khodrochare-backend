const {test}=require('node:test');const assert=require('node:assert/strict');
const {catalog,estimate,schema,defaults}=require('../src/onsite-services');const {splitAmount}=require('../src/payments');
test('onsite prices are server-calculated, dated and discounted exactly once; free sales package stays unavailable',()=>{
 const c=catalog(),input={options:['FULL'],vehicleClass:'SEDAN',tariffVersion:c.version};
 assert.equal(estimate('MOBILE_CARWASH',input).priceToman,560000);
 assert.equal(estimate('MOBILE_CARWASH',{...input,options:['FULL','TIRE_WAX']}).priceToman,686000);
 assert.equal(estimate('INSPECTION',{...input,options:['FULL_INSPECTION']}).priceToman,2800000);
 assert.equal(estimate('PERIODIC_SERVICE',{...input,options:['ENGINE_OIL','AIR_FILTER']}).priceToman,0);
 for(const options of [['FREE_SALE_24H'],['FULL','FULL'],['FULL','INTERIOR']])assert.throws(()=>estimate('MOBILE_CARWASH',{...input,options}),{status:400});
 assert.throws(()=>estimate('INSPECTION',{...input,options:['BODY'],tariffVersion:'stale'}),{status:409});
 assert.equal(schema.safeParse({...input,vehicleName:'test car',vehiclePlate:'12345',origin:{latitude:35,longitude:51},priceToman:1}).success,false);
 const invalid=structuredClone(defaults);invalid.services.INSPECTION[0].prices.SEDAN=-1;assert.throws(()=>catalog({ON_SITE_TARIFFS_JSON:JSON.stringify(invalid)}));
 for(const service of ['MOBILE_CARWASH','PERIODIC_SERVICE','INSPECTION']){const split=splitAmount(service,100000,50000);assert.equal(split.amountToman,150000);assert.equal(split.commissionToman,45000);assert.equal(split.driverShareToman,105000);}
 assert.equal(splitAmount('PERIODIC_SERVICE',0,0).amountToman,0);assert.throws(()=>splitAmount('REPAIR',0,0));
});

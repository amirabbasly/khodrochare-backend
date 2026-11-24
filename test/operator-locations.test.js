const {test}=require('node:test');
const assert=require('node:assert/strict');
const {point,currentLocations}=require('../src/operator/locations');
test('request location reads distinguish origin from device GPS and select the newest valid driver sample',async()=>{
 const now=new Date('2026-11-24T10:00:00Z'),old=new Date(now-180000),recent=new Date(now-10000);
 const request={customerId:'c',driverId:'d',originLat:35.7,originLng:51.4,createdAt:old};
 const db={userLocation:{findUnique:async({where})=>where.userId==='c'?null:{latitude:35.8,longitude:51.5,recordedAt:recent}},driverLocation:{findUnique:async()=>({latitude:35.9,longitude:51.6,recordedAt:old})}};
 const locations=await currentLocations(db,request,120,now);
 assert.equal(locations.customer,null);assert.equal(locations.origin.source,'REQUEST_ORIGIN');
 assert.equal(locations.driver.latitude,35.8);assert.equal(locations.driver.fresh,true);
 assert.equal(point({latitude:35,longitude:51,recordedAt:old},'GPS',now,120).fresh,false);
 assert.equal(point({latitude:91,longitude:51,recordedAt:recent},'GPS',now,120),null);
 assert.equal(point({latitude:35,longitude:51,recordedAt:new Date(now.getTime()+60000)},'GPS',now,120),null);
 const noDriver=await currentLocations(db,{...request,driverId:null},120,now);assert.equal(noDriver.driver,null);
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {driverRegistration}=require('../src/domain');const {assertCompleteDocuments}=require('../src/verification-documents');
test('one identity document and either a license or explicit absence suffice; vehicle evidence is optional',async()=>{
 const reference={id:'00000000-0000-4000-8000-000000000001',token:'a'.repeat(64)},base={fullName:'Test Driver',phone:'09121234567',password:'password123',nationalId:'1234567891',activityCity:'Tehran',vehicleType:'Truck',vehiclePlate:'12345',services:['REPAIR'],identityDocument:reference};
 assert(driverRegistration.safeParse({...base,noDrivingLicense:true}).success);assert(driverRegistration.safeParse({...base,drivingLicense:reference}).success);assert(!driverRegistration.safeParse(base).success);assert(!driverRegistration.safeParse({...base,noDrivingLicense:true,drivingLicense:reference}).success);
 for(const kind of ['NATIONAL_ID','BIRTH_CERTIFICATE'])for(const noDrivingLicense of [true,false]){const docs=[{verificationKind:kind},...(!noDrivingLicense?[{verificationKind:'DRIVING_LICENSE'}]:[])];const db={user:{findUnique:async()=>({noDrivingLicense})},document:{findMany:async()=>docs}};assert.equal((await assertCompleteDocuments(db,'driver')).length,docs.length);}
 await assert.rejects(()=>assertCompleteDocuments({user:{findUnique:async()=>({noDrivingLicense:true})},document:{findMany:async()=>[]}},'driver'),{status:409});
 await assert.rejects(()=>assertCompleteDocuments({user:{findUnique:async()=>({noDrivingLicense:false})},document:{findMany:async()=>[{verificationKind:'BIRTH_CERTIFICATE'}]}},'driver'),{status:409});
});

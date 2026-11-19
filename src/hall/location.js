// Area mode never publishes the private point or address. A 0.02-degree grid
// puts the selected point within 1.6 km of the public center, inside the 2 km circle.
function publicLocation(value){
  if(!value)return undefined;
  if(value.visibility==='EXACT')return {latitude:value.latitude,longitude:value.longitude,visibility:'EXACT',radiusMeters:0,address:value.address};
  return {latitude:Number((Math.round(value.latitude/.02)*.02).toFixed(2)),longitude:Number((Math.round(value.longitude/.02)*.02).toFixed(2)),visibility:'AREA',radiusMeters:2000};
}
module.exports={publicLocation};

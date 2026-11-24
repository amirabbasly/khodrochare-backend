const sharp=require('sharp');
const {HttpError}=require('../domain');
const MAX_PHOTO_BYTES=8*1024*1024;
const MAX_PHOTO_PIXELS=64*1000*1000;
const MAX_PHOTO_EDGE=2560;
const photoSizeMessage='حجم هر تصویر باید کمتر از ۸ مگابایت باشد.';
const photoFormatMessage='تصویر معتبر JPG، PNG، WebP، AVIF، GIF یا TIFF انتخاب کنید. فایل HEIC را ابتدا به JPG تبدیل کنید.';
function supportedSignature(buffer){
 if(buffer.subarray(0,3).equals(Buffer.from([255,216,255])))return true;
 if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return true;
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return true;
 if(['GIF87a','GIF89a'].includes(buffer.toString('ascii',0,6)))return true;
 if(['49492a00','4d4d002a','49492b00','4d4d002b'].includes(buffer.subarray(0,4).toString('hex')))return true;
 return buffer.toString('ascii',4,8)==='ftyp'&&/avif|avis/.test(buffer.toString('ascii',8,Math.min(buffer.length,64)));
}
async function prepareHallPhoto(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length)throw new HttpError(400,photoFormatMessage);
 if(buffer.length>=MAX_PHOTO_BYTES)throw new HttpError(400,photoSizeMessage);
 if(!supportedSignature(buffer))throw new HttpError(400,photoFormatMessage);
 try{
  const source=sharp(buffer,{limitInputPixels:MAX_PHOTO_PIXELS,failOn:'warning',animated:false});
  const metadata=await source.metadata();
  if(!['jpeg','png','webp','gif','tiff'].includes(metadata.format)&&!(metadata.format==='heif'&&metadata.compression==='av1'))throw new Error('Unsupported image');
  // One high-quality encode; auto-orient phone photos, keep aspect/alpha, never
  // enlarge, and remove EXIF/GPS/XMP rather than publishing private metadata.
  const {data,info}=await source.rotate().resize({width:MAX_PHOTO_EDGE,height:MAX_PHOTO_EDGE,fit:'inside',withoutEnlargement:true}).webp({quality:92,effort:5,smartSubsample:true}).toBuffer({resolveWithObject:true});
  // Do not grow an already efficient, browser-compatible image. A retained
  // original must be fully decoded above, small, correctly oriented, static and
  // free of EXIF/XMP/IPTC; phone photos carrying private metadata are re-encoded.
  const originalMime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heif:'image/avif'}[metadata.format];
  if(originalMime&&buffer.length<data.length&&metadata.width<=MAX_PHOTO_EDGE&&metadata.height<=MAX_PHOTO_EDGE&&(!metadata.orientation||metadata.orientation===1)&&(!metadata.pages||metadata.pages===1)&&!metadata.exif&&!metadata.xmp&&!metadata.iptc){
   return {buffer,mimeType:originalMime,width:metadata.width,height:metadata.height,originalBytes:buffer.length,storedBytes:buffer.length};
  }
  if(data.length>=MAX_PHOTO_BYTES)throw new HttpError(400,photoSizeMessage);
  return {buffer:data,mimeType:'image/webp',width:info.width,height:info.height,originalBytes:buffer.length,storedBytes:data.length};
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,photoFormatMessage);}
}
module.exports={prepareHallPhoto,MAX_PHOTO_BYTES,MAX_PHOTO_PIXELS,MAX_PHOTO_EDGE,photoSizeMessage,photoFormatMessage};

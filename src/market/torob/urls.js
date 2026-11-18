const {HttpError}=require('../../domain');
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
function torobUrl(value,kind){
  let url;try{url=new URL(value,'https://torob.com');}catch{throw new HttpError(400,'Invalid Torob URL');}
  if(url.origin!=='https://torob.com'||url.username||url.password)throw new HttpError(400,'Only Torob HTTPS URLs are allowed');
  const pattern=kind==='browse'?/^\/browse\/(\d+)\/(?:[^/?#]+\/)?$/:new RegExp(`^/p/(${UUID})/(?:[^/?#]+/)?$`,'i');
  const match=url.pathname.match(pattern);if(!match)throw new HttpError(400,kind==='browse'?'A Torob browse category URL is required':'A Torob product URL is required');
  url.search='';url.hash='';return{url:url.href,id:match[1].toLowerCase()};
}
function sellerUrl(value){
  let url;try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
  if(url.hostname==='api.torob.com'&&url.pathname==='/v4/product-page/redirect/'){
    const key=url.searchParams.get('prk');if(!new RegExp(`^${UUID}$`,'i').test(key||''))return null;
    // Strip browser/session tracking. Keep the offer selector needed for the purchase link.
    const safe=new URL(url.origin+url.pathname);for(const field of ['prk','btn','installment']){const value=url.searchParams.get(field);if(value&&value.length<=2000)safe.searchParams.set(field,value);}
    return{url:safe.href,externalId:key};
  }
  // We do not fetch arbitrary seller URLs or guess the shop behind a Torob redirect.
  return null;
}
module.exports={torobUrl,sellerUrl};

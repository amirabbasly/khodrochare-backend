// One ladder ad, then three ordinary ads. Page boundaries do not reset the mix.
function feedWindow(ladders,ordinary,offset,limit){
 const slots=[];let l=0,n=0,pos=0;
 const add=(kind,index)=>{if(pos>=offset&&slots.length<limit)slots.push({kind,index});pos++;};
 while((l<ladders||n<ordinary)&&slots.length<limit){
  if(l<ladders)add('ladder',l++);
  for(let i=0;i<3&&n<ordinary;i++)add('ordinary',n++);
 }
 return slots;
}
async function hallFeed(prisma,where,q,include){
 const now=new Date(),ladderWhere={AND:[where,{ladderUntil:{gt:now}}]},ordinaryWhere={AND:[where,{OR:[{ladderUntil:null},{ladderUntil:{lte:now}}]}]};
 const [l,n]=await Promise.all([prisma.hallListing.count({where:ladderWhere}),prisma.hallListing.count({where:ordinaryWhere})]);
 const slots=feedWindow(l,n,(q.page-1)*q.limit,q.limit);
 const normalSort=q.sort==='price_asc'?{priceToman:'asc'}:q.sort==='price_desc'?{priceToman:'desc'}:q.sort==='mileage'?{mileage:'asc'}:{publishedAt:'desc'};
 async function rows(kind,filter,sort){const indices=slots.filter(s=>s.kind===kind).map(s=>s.index);return indices.length?prisma.hallListing.findMany({where:filter,include,skip:indices[0],take:indices.length,orderBy:[sort,{id:'desc'}]}):[];}
 const [ladderRows,normalRows,featured]=await Promise.all([
  rows('ladder',ladderWhere,{bumpedAt:'desc'}),rows('ordinary',ordinaryWhere,normalSort),
  prisma.hallListing.findMany({where:{AND:[where,{featuredUntil:{gt:now}}]},include,take:6,orderBy:[{featuredUntil:'desc'},{id:'desc'}]}),
 ]);
 let li=0,ni=0;
 return {items:slots.map(s=>s.kind==='ladder'?ladderRows[li++]:normalRows[ni++]).filter(Boolean),featured,total:l+n};
}
module.exports={feedWindow,hallFeed};

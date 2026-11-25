const test=require('node:test'),assert=require('node:assert/strict');
const {feedWindow}=require('../src/hall/feed');
test('ladder feed stays unique across page boundaries and handles exhausted categories',()=>{
 const all=feedWindow(6,17,0,100);
 assert.deepEqual(all.slice(0,9).map(s=>s.kind),['ladder','ordinary','ordinary','ordinary','ladder','ordinary','ordinary','ordinary','ladder']);
 assert.equal(new Set(all.map(s=>s.kind+s.index)).size,23);
 assert.deepEqual([...feedWindow(6,17,0,5),...feedWindow(6,17,5,5)],all.slice(0,10));
 assert.deepEqual(feedWindow(0,3,0,12).map(s=>s.index),[0,1,2]);
 assert.deepEqual(feedWindow(3,0,0,12).map(s=>s.index),[0,1,2]);
 assert.deepEqual(feedWindow(3,2,99,12),[]);
});

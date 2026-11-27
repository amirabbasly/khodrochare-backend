const {test}=require('node:test'),assert=require('node:assert/strict');const {walletSummary}=require('../src/wallet-summary');
test('reported driver receipts are credited and remaining negative balance reconciles exactly',async()=>{
 const entries=[12000000,-15240000,2000000,-1740000];const db={walletEntry:{aggregate:async({where})=>({_sum:{amountToman:entries.filter(v=>!where.amountToman||v>0).reduce((a,b)=>a+b,0)}})},driverEarning:{aggregate:async()=>({_sum:{amountToman:0}})},walletDebit:{aggregate:async()=>({_sum:{amountToman:0}})}};
 assert.deepEqual(await walletSummary(db,'driver'),{topupsToman:14000000,earningsToman:0,deductionsToman:16980000,spendingToman:0,balanceToman:-2980000});
});

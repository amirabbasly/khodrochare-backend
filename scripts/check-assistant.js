// Run inside the API container. Never prints credentials or provider response bodies.
require('dotenv').config({quiet:true});
const {createAssistant}=require('../src/assistant');
const config={GAPGPT_API_KEY:process.env.GAPGPT_API_KEY,GAPGPT_MODEL:process.env.GAPGPT_MODEL||'gpt-4o',ASSISTANT_SUPPORT_PHONE:process.env.ASSISTANT_SUPPORT_PHONE||'09123022064'};
const assistant=createAssistant(config);
console.log(JSON.stringify({configured:assistant.enabled,model:config.GAPGPT_MODEL}));
if(!assistant.enabled){console.error('GAPGPT_API_KEY is missing in this API process. Update the backend env file and recreate the API container.');process.exitCode=2;}
else if(process.argv.includes('--probe'))assistant.reply({messages:[{role:'user',content:'How can I maintain a car battery safely?'}]}).then(()=>console.log(JSON.stringify({provider:'ready'}))).catch(error=>{console.error(JSON.stringify({provider:'unavailable',status:error.status||500}));process.exitCode=1;});

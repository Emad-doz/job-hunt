import assert from 'node:assert/strict';
import {structuredOpenAi,cleanBase,baseFor,NO_KEY} from '../server/model-openai.mjs';
import {saveAiSettings,publicAi,route,assessJob} from '../server/analyst-ai.mjs';

// A choice of AI provider. Synthetic keys and answers only; an injected fetcher stands in for every service, so nothing is contacted.
const schema={type:'object',properties:{verdict:{type:'string'}},required:['verdict'],additionalProperties:false};
const answer=(content,extra={})=>Response.json({model:'synthetic-model-2',choices:[{finish_reason:'stop',message:{content},...extra}],usage:{prompt_tokens:120,completion_tokens:30}});
const ask=(replies,options={})=>{const calls=[];return {calls,run:structuredOpenAi({provider:'openai',apiKey:'synthetic-key-12345678',model:'synthetic-model',system:'Synthetic instructions.',reference:'<cv>Synthetic CV</cv>',request:'Synthetic vacancy',schema,name:'OpenAI',fetcher:async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});const reply=replies[calls.length-1];if(reply instanceof Error)throw reply;return reply;},...options})};};

// The request: the provider's own address, the key in a header only, the schema as response format and in the instructions, CV and vacancy in the user turn.
{const {calls,run}=ask([answer('{"verdict":"plausible"}')]),result=await run;
  assert.deepEqual([calls.length,calls[0].url,calls[0].init.method,calls[0].init.headers.Authorization],[1,'https://api.openai.com/v1/chat/completions','POST','Bearer synthetic-key-12345678']);
  assert.deepEqual(calls[0].body.response_format,{type:'json_schema',json_schema:{name:'answer',strict:true,schema}});assert.equal(calls[0].body.model,'synthetic-model');
  assert(calls[0].body.messages[0].content.includes('Synthetic instructions.')&&calls[0].body.messages[0].content.includes('"verdict"'));assert.equal(calls[0].body.messages[1].content,'<cv>Synthetic CV</cv>\n\nSynthetic vacancy');assert(!calls[0].init.body.includes('synthetic-key'));
  assert.deepEqual(result,{text:'{"verdict":"plausible"}',servedBy:'synthetic-model-2',fallback:false,usage:{input:120,output:30,cacheRead:0,cacheWrite:0}});}
// Other addresses: Gemini's compatible one, a local service without a key, and nothing but https elsewhere.
assert.equal(baseFor('gemini',''),'https://generativelanguage.googleapis.com/v1beta/openai');assert.equal(cleanBase(' http://localhost:11434/v1/ '),'http://localhost:11434/v1');assert.equal(cleanBase('https://ai.example.test/api/v1'),'https://ai.example.test/api/v1');
for(const bad of ['','not an address','http://ai.example.test/v1','ftp://localhost/v1','https://user:secret@ai.example.test/v1','https://ai.example.test/v1?key=1'])assert.throws(()=>cleanBase(bad),/address/i,bad);
{const {calls,run}=ask([answer('```json\n{"verdict":"strong"}\n```')],{provider:'compatible',baseUrl:'http://127.0.0.1:11434/v1',apiKey:NO_KEY});assert.equal((await run).text,'{"verdict":"strong"}');assert.equal(calls[0].url,'http://127.0.0.1:11434/v1/chat/completions');assert.equal(calls[0].init.headers.Authorization,undefined);}
// A service that refuses a strict schema is asked once more in plain JSON mode.
{const {calls,run}=ask([Response.json({error:{message:'schema not supported'}},{status:400}),answer('{"verdict":"stretch"}')]);assert.equal((await run).text,'{"verdict":"stretch"}');assert.deepEqual([calls.length,calls[1].body.response_format],[2,{type:'json_object'}]);}
// Failures are said plainly, and only an answer that was produced counts as billed.
for(const [replies,pattern,billed] of [[[new Response('',{status:401})],/OpenAI rejected the saved API key/,false],[[new Response('',{status:404})],/does not know the model "synthetic-model"/,false],[[new Response('',{status:429})],/rate or spending limit/,false],[[new Response('',{status:503})],/HTTP 503/,false],[[new TypeError('fetch failed')],/could not be reached/,false],[[Object.assign(new Error('late'),{name:'TimeoutError'})],/timed out/,false],
  [[Response.json({error:{message:'bad field'}},{status:400}),Response.json({error:{message:'bad field'}},{status:400})],/did not accept the request: bad field/,false],[[answer('')],/no answer/,true],[[Response.json({choices:[{finish_reason:'length',message:{content:'{"ver'}}]})],/cut off/,true],[[Response.json({choices:[{finish_reason:'content_filter',message:{content:''}}]})],/declined/,true],[[answer('',{})],/no answer/,true]]){
  await assert.rejects(ask(replies).run,error=>{assert.match(error.message,pattern);assert.equal(error.billed,billed,error.message);assert(!error.message.includes('synthetic-key'));return true;});}

// Settings: Anthropic unchanged by default; another provider needs its own key and a model name; consent names the recipient and is asked again when the recipient changes.
const claude=saveAiSettings({},{apiKey:'sk-ant-'+'a'.repeat(30),enabled:true,consent:true});assert.deepEqual([claude.provider,claude.baseUrl,claude.model,claude.enabled],['anthropic','','claude-opus-5-5',true]);assert.deepEqual(route({}),{provider:'anthropic',baseUrl:''});
assert.throws(()=>saveAiSettings(claude,{provider:'nobody'}),/supported AI provider/);
assert.throws(()=>saveAiSettings(claude,{provider:'openai',model:'synthetic-model'}),/Enter your OpenAI API key/,'the Anthropic key is not reused for another provider');
assert.throws(()=>saveAiSettings(claude,{provider:'openai',apiKey:'synthetic-key-12345678'}),/model name/,'the Claude model name is not carried over');
assert.throws(()=>saveAiSettings(claude,{provider:'openai',apiKey:'has a space in it',model:'synthetic-model'}),/without spaces/);
assert.throws(()=>saveAiSettings(claude,{provider:'openai',apiKey:'synthetic-key-12345678',model:'synthetic-model',enabled:true}),/may be sent to OpenAI/);
const open=saveAiSettings(claude,{provider:'openai',apiKey:'synthetic-key-12345678',model:'synthetic-model',enabled:true,consent:true});assert.deepEqual([open.provider,open.model,open.apiKey,open.enabled],['openai','synthetic-model','synthetic-key-12345678',true]);assert(open.consentAt);
const kept=saveAiSettings(open,{enabled:true,consent:true,dailyLimit:5});assert.deepEqual([kept.apiKey,kept.model,kept.consentAt,kept.dailyLimit],[open.apiKey,'synthetic-model',open.consentAt,5]);
assert.throws(()=>saveAiSettings(open,{provider:'compatible',model:'synthetic-local'}),/address of the service/);
const local=saveAiSettings(open,{provider:'compatible',baseUrl:'http://localhost:11434/v1/',model:'synthetic-local:7b'});assert.deepEqual([local.provider,local.baseUrl,local.apiKey,local.model,local.enabled,local.consentAt],['compatible','http://localhost:11434/v1',NO_KEY,'synthetic-local:7b',false,null]);
assert.throws(()=>saveAiSettings(local,{baseUrl:'https://ai.example.test/v1',model:'synthetic-local:7b',enabled:true}),/may be sent to the service at the address you entered/);
const shown=publicAi(open);assert.deepEqual([shown.provider,shown.webSearch,shown.providers.gemini,shown.configured,shown.apiKey],['openai',false,'Google Gemini',true,undefined]);assert.equal(publicAi(claude).webSearch,true);assert(!JSON.stringify(shown).includes('synthetic-key'));

// The provider travels with every request, and a model without a listed price has no cost estimate.
{let seen;const review=await assessJob({job:{id:'SYNTHETIC-1',title:'Synthetic analyst',employer:'Synthetic employer',location:'Remote',salary:'Unknown',source:'Synthetic',description:'Synthetic vacancy text that is long enough to be assessed by the model in this check. '.repeat(4)},profile:null,material:{scope:'evidence',text:'Synthetic CV evidence.'},model:open.model,apiKey:open.apiKey,...route(open),call:async request=>{seen=request;return {text:JSON.stringify({verdict:'plausible',summary:'Synthetic summary.',strengths:[],gaps:[],unverified:[],letter:'',questions:[]}),servedBy:'synthetic-model-2',usage:{input:1,output:1}};}}).catch(error=>error);
  assert.deepEqual([seen.provider,seen.baseUrl,seen.model],['openai','','synthetic-model']);if(!(review instanceof Error))assert.equal(review.costUsd,null);}
console.log('Provider checks passed: the OpenAI chat format with the key in a header only, Gemini and local addresses, https elsewhere, plain JSON fallback, plain failures, a key never reused across providers, consent naming the recipient and asked again when it changes, no key shown. Synthetic values only; no service was contacted.');

// The same schema-constrained request as model-client.mjs, for services that speak the OpenAI chat-completions format: OpenAI itself, Google Gemini through its compatible address, or one the owner names (a local Ollama, OpenRouter and the like). Node built-ins only.
const fail=(message,billed=false)=>Object.assign(new Error(message),{billed});
export const OPENAI_BASES={openai:'https://api.openai.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta/openai'};
export const NO_KEY='no-key';
const LOCAL=new Set(['localhost','127.0.0.1','[::1]']);
// An address the owner typed: https anywhere, plain http only on this machine.
export function cleanBase(value){
  let url;try{url=new URL(String(value||'').trim());}catch{throw new Error('Enter the address of the service, for example http://localhost:11434/v1.');}
  if(url.username||url.password||url.search||url.hash)throw new Error('Enter the address without a user name, query or fragment.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&LOCAL.has(url.hostname)))throw new Error('The address must start with https://. Plain http:// is accepted only for a service on this machine.');
  return (url.origin+url.pathname).replace(/\/+$/,'');
}
export const baseFor=(provider,baseUrl)=>OPENAI_BASES[provider]||cleanBase(baseUrl);
const unfenced=text=>String(text).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
export async function structuredOpenAi({provider,baseUrl,apiKey,model,system,reference,request,schema,fetcher=fetch,timeout=180000,name='The AI service'}){
  const url=baseFor(provider,baseUrl)+'/chat/completions',headers={'Content-Type':'application/json',...(apiKey&&apiKey!==NO_KEY?{Authorization:'Bearer '+apiKey}:{})};
  // The schema travels twice: as the response format where the service enforces one, and in the instructions for those that do not.
  const messages=[{role:'system',content:system+'\n\nAnswer with one JSON object that matches this JSON Schema, and nothing else:\n'+JSON.stringify(schema)},{role:'user',content:reference+'\n\n'+request}];
  const send=async format=>{try{return await fetcher(url,{method:'POST',headers,body:JSON.stringify({model,messages,response_format:format}),signal:AbortSignal.timeout(timeout)});}catch(error){throw fail(error?.name==='TimeoutError'?'The request timed out before '+name+' answered. Nothing was recorded.':name+' could not be reached. Nothing was recorded.');}};
  let response=await send({type:'json_schema',json_schema:{name:'answer',strict:true,schema}});
  // Not every service or model accepts a strict schema; plain JSON mode is the fallback, and the answer is checked by the caller either way.
  if(response.status===400||response.status===422)response=await send({type:'json_object'});
  if(response.status===401||response.status===403)throw fail(name+' rejected the saved API key. Enter a current key in Settings.');
  if(response.status===404)throw fail(name+' does not know the model "'+model+'", or the address is wrong. Check both in Settings.');
  if(response.status===429)throw fail(name+' rate or spending limit reached. Wait a few minutes, or check your balance there.');
  if(!response.ok){let detail='';try{detail=String((await response.json())?.error?.message||'').slice(0,300);}catch{}throw fail(response.status===400||response.status===422?name+' did not accept the request'+(detail?': '+detail:'.'):name+' returned an error (HTTP '+response.status+'). Nothing was recorded.');}
  let body;try{body=await response.json();}catch{throw fail(name+' returned an unreadable answer. Nothing was recorded.',true);}
  const choice=body?.choices?.[0],text=typeof choice?.message?.content==='string'?unfenced(choice.message.content):'';
  if(choice?.finish_reason==='content_filter'||choice?.message?.refusal)throw fail('The model declined this request. Nothing was recorded.',true);
  if(choice?.finish_reason==='length')throw fail('The answer was cut off before it finished. Nothing was recorded.',true);
  if(!text)throw fail('The model returned no answer. Nothing was recorded.',true);
  return {text,servedBy:String(body.model||model),fallback:false,usage:{input:Number(body.usage?.prompt_tokens)||0,output:Number(body.usage?.completion_tokens)||0,cacheRead:0,cacheWrite:0}};
}

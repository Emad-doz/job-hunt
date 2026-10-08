// Bundled into dist/server/model-client.mjs; the hosted runtime has no installed packages.
import Anthropic from '@anthropic-ai/sdk';

const fail=(message,billed=false)=>Object.assign(new Error(message),{billed});
// A safety classifier can decline a harmless vacancy; let the API continue on its recommended substitute.
const fallback={betas:['server-side-fallback-2026-07-01'],fallbacks:'default'};
const connect=(apiKey,fetcher,timeout)=>new Anthropic({apiKey,maxRetries:2,timeout,...(fetcher?{fetch:fetcher}:{})});
function explain(error){
  if(error instanceof Anthropic.AuthenticationError)return fail('Anthropic rejected the saved API key. Enter a current key in Settings.');
  if(error instanceof Anthropic.PermissionDeniedError)return fail('This Anthropic API key is not permitted to use the selected model or tool.');
  if(error instanceof Anthropic.RateLimitError)return fail('Anthropic rate limit reached. Wait a few minutes before the next request.');
  if(error instanceof Anthropic.BadRequestError)return fail('Anthropic did not accept the request: '+String(error.message).slice(0,300));
  if(error instanceof Anthropic.APIConnectionTimeoutError)return fail('The request timed out before Anthropic answered. Nothing was recorded.');
  if(error instanceof Anthropic.APIConnectionError)return fail('Anthropic could not be reached. Nothing was recorded.');
  if(error instanceof Anthropic.APIError)return fail('Anthropic returned an error (HTTP '+error.status+'). Nothing was recorded.');
  return error;
}
const declined=response=>fail('The model declined this request'+(response.stop_details?.category?' ('+response.stop_details.category+')':'')+'. Nothing was recorded.',true);
const spent=(total,usage={})=>({input:total.input+(usage.input_tokens||0),output:total.output+(usage.output_tokens||0),cacheRead:total.cacheRead+(usage.cache_read_input_tokens||0),cacheWrite:total.cacheWrite+(usage.cache_creation_input_tokens||0)});
const none={input:0,output:0,cacheRead:0,cacheWrite:0};
const served=response=>({servedBy:response.model,fallback:(response.usage?.iterations??[]).some(entry=>entry.type==='fallback_message')});
// One schema-constrained answer from stable instructions, a cacheable reference block and a request.
async function structured({apiKey,model,system,reference,request,schema,fetcher}){
  let response;
  try{
    response=await connect(apiKey,fetcher,180000).beta.messages.create({model,max_tokens:16000,...fallback,output_config:{effort:'medium',format:{type:'json_schema',schema}},
      // Stable instructions and CV first, so repeated requests can reuse the cached prefix.
      system:[{type:'text',text:system},{type:'text',text:reference,cache_control:{type:'ephemeral'}}],messages:[{role:'user',content:request}]});
  }catch(error){throw explain(error);}
  if(response.stop_reason==='refusal')throw declined(response);
  if(response.stop_reason==='max_tokens')throw fail('The answer was cut off before it finished. Nothing was recorded.',true);
  const text=response.content.find(block=>block.type==='text')?.text;
  if(!text)throw fail('The model returned no answer. Nothing was recorded.',true);
  return {text,...served(response),usage:spent(none,response.usage)};
}
export const requestAssessment=({cvMaterial,vacancy,...rest})=>structured({...rest,reference:cvMaterial,request:vacancy});
// The owner's whole CV text as the reference; the answer is the fixed set of CV fields.
export const requestProfile=({cvText,...rest})=>structured({...rest,reference:cvText,request:'Copy this CV into the fields.'});
// The owner's saved CV details as the reference, the vacancy as the request; the answer selects and orders them.
export const requestTailoredCv=({profileJson,vacancy,...rest})=>structured({...rest,reference:profileJson,request:vacancy});
export const requestMotivation=({cvMaterial,vacancy,...rest})=>structured({...rest,reference:cvMaterial,request:vacancy});
// Employer research: the model searches the public web itself and hands back what it read through one strict tool call. No CV material is part of this request.
export async function requestCompanyResearch({apiKey,model,system,brief,schema,maxSearches,fetcher}){
  const client=connect(apiKey,fetcher,300000),messages=[{role:'user',content:brief}];let usage=none,searches=0;
  const tools=[{type:'web_search_20260209',name:'web_search',max_uses:maxSearches},{name:'record_company',description:'Record what you found about the employer. Call this exactly once, after your searches.',strict:true,input_schema:schema}];
  for(let turn=0;turn<4;turn++){
    let response;
    // Streamed so a run of searches cannot hit an idle HTTP timeout.
    try{response=await client.beta.messages.stream({model,max_tokens:8000,...fallback,output_config:{effort:'low'},system,tools,messages}).finalMessage();}catch(error){throw explain(error);}
    usage=spent(usage,response.usage);searches+=response.usage?.server_tool_use?.web_search_requests||0;
    if(response.stop_reason==='refusal')throw declined(response);
    const call=response.content.find(block=>block.type==='tool_use'&&block.name==='record_company');
    if(call)return {found:call.input,...served(response),usage,searches};
    if(response.stop_reason==='max_tokens')throw fail('The employer research ran out of room before recording what it found. Nothing was recorded.',true);
    // The server pauses a long search turn; sending the paused turn back resumes it.
    if(response.stop_reason!=='pause_turn')return {found:{identified:false,about:'',facts:[]},...served(response),usage,searches};
    messages.push({role:'assistant',content:response.content});
  }
  return {found:{identified:false,about:'',facts:[]},servedBy:model,fallback:false,usage,searches};
}
export const requestTriage=({cvMaterial,listings,...rest})=>structured({...rest,reference:cvMaterial,request:listings});

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMail} from '../server/mail.mjs';

const clientId='00000000-0000-4000-8000-000000000002';
const clientSecret='synthetic-private-app-secret-32';
const origin='https://hq.test',callback=origin+'/api/mail/callback';
let now=Date.parse('2026-10-03T09:00:00Z'),stored={},tokenCalls=0,graphCalls=0,deniedGraph=false,tokenError='',returnedScope='Mail.Read',lastChallenge='';
const connections={settings:async()=>({SCOUT_CONFIG:stored}),updateScout:async fn=>{stored=fn(stored);}};
const fetcher=async(url,options)=>{
  if(url==='https://login.microsoftonline.com/common/oauth2/v2.0/token'){
    tokenCalls++;const p=new URLSearchParams(options.body);
    assert.equal(options.redirect,'error');assert.equal(p.get('client_id'),clientId);assert.equal(p.get('client_secret'),clientSecret);
    assert.equal(p.get('scope'),'https://graph.microsoft.com/Mail.Read offline_access');
    if(p.get('grant_type')==='authorization_code'){
      assert.equal(p.get('redirect_uri'),callback);assert.equal(p.get('code'),'synthetic-auth-code');
      assert.match(p.get('code_verifier'),/^[A-Za-z0-9_-]{43}$/);
      assert.equal(createHash('sha256').update(p.get('code_verifier')).digest('base64url'),lastChallenge);
    }else assert.equal(p.get('grant_type'),'refresh_token');
    if(tokenError)return Response.json({error:tokenError,error_description:'Do not expose synthetic-private-app-secret-32 or provider diagnostics.'},{status:400});
    return Response.json({access_token:'synthetic-web-access',refresh_token:'synthetic-web-refresh',scope:returnedScope,expires_in:3600});
  }
  assert(url.startsWith('https://graph.microsoft.com/v1.0/me/messages?'));
  graphCalls++;assert.equal(options.headers.Authorization,'Bearer synthetic-web-access');assert.equal(options.redirect,'error');
  assert.equal(new URL(url).searchParams.get('$select'),'id');assert.equal(new URL(url).searchParams.get('$top'),'1');
  return deniedGraph?Response.json({}, {status:403}):Response.json({value:[]});
};
const api=createMail(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-access-password',HQ_PUBLIC_ORIGIN:origin},{fetcher,clock:()=>now});
const post=(body,source=origin)=>api.handle(new Request(origin+'/api/mail',{method:'POST',headers:{host:'hq.test',origin:source,'content-type':'application/json'},body:JSON.stringify(body)}));
const visible=async()=>await(await api.handle(new Request(origin+'/api/mail'))).json();
const finish=(login,changes={})=>{
  const params=new URLSearchParams({state:login.state,code:'synthetic-auth-code',...changes});
  return api.handle(new Request(callback+'?'+params,{headers:{cookie:login.cookie}}));
};
async function start(){
  const response=await post({action:'connect-browser'});assert.equal(response.status,200);
  const v=await response.json(),u=new URL(v.url);assert.equal(v.status,'redirect');
  assert.equal(u.origin,'https://login.microsoftonline.com');assert.equal(u.pathname,'/common/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('redirect_uri'),callback);assert.equal(u.searchParams.get('response_type'),'code');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('response_mode'),'query');
  assert.equal(u.searchParams.get('scope'),'https://graph.microsoft.com/Mail.Read offline_access');
  assert.equal(u.searchParams.get('prompt'),'select_account');assert(!v.url.includes(clientSecret));
  lastChallenge=u.searchParams.get('code_challenge');
  const setCookie=response.headers.get('set-cookie');assert.match(setCookie,/^__Host-hq-outlook-login=/);
  for(const flag of ['HttpOnly','Secure','SameSite=Lax','Path=/'])assert(setCookie.includes(flag));
  return {state:u.searchParams.get('state'),cookie:setCookie.split(';')[0]};
}
assert.equal((await post({action:'connect-browser'})).status,400);
assert.equal((await post({action:'save',clientId,clientSecret},'https://attacker.test')).status,403);
assert.equal((await post({action:'save',clientId,clientSecret:'too-short'})).status,400);
assert.equal((await post({action:'save',clientId,clientSecret})).status,200);
assert.equal((await visible()).redirectUri,callback);assert.equal((await visible()).browserReady,true);
const login=await start();
assert.equal((await finish(login,{state:'forged'})).status,400);
assert.equal((await finish({...login,cookie:''})).status,400);assert.equal(tokenCalls,0);
assert.equal((await api.handle(new Request('https://attacker.test/api/mail/callback?state='+login.state+'&code=synthetic-auth-code',{headers:{cookie:login.cookie}}))).status,400);
assert.equal((await api.handle(new Request(callback+'?state='+login.state+'&state='+login.state+'&code=synthetic-auth-code',{headers:{cookie:login.cookie}}))).status,400);assert.equal(tokenCalls,0);
const connected=await finish(login);assert.equal(connected.status,303);
assert.equal(connected.headers.get('location'),origin+'/?outlook=connected#connections');assert.equal(graphCalls,1);
assert(connected.headers.get('set-cookie').includes('Max-Age=0'));assert.equal(connected.headers.get('referrer-policy'),'no-referrer');
assert.equal((await finish(login)).status,400);assert.equal(tokenCalls,1);
let state=await visible();assert.equal(state.connected,true);assert.equal(stored.outlook.tokens.flow,'web');
for(const secret of [clientSecret,'synthetic-web-access','synthetic-web-refresh',login.state,login.cookie])assert(!JSON.stringify(state).includes(secret));
const previous=state.verifiedAt;
const denied=await start();const deniedResponse=await finish(denied,{error:'access_denied'});
assert.equal(deniedResponse.headers.get('location'),origin+'/?outlook=failed#connections');assert.equal(tokenCalls,1);
assert.equal((await visible()).connected,true);assert.equal((await visible()).verifiedAt,previous);
const expired=await start();now+=900001;assert.equal((await finish(expired)).status,400);assert.equal(tokenCalls,1);
const replaced=await start();const newest=await start();assert.equal((await finish(replaced)).status,400);
assert.notEqual(replaced.state,newest.state);
deniedGraph=true;assert.equal((await finish(newest)).status,303);assert.equal((await visible()).verifiedAt,previous);
assert((await visible()).signInError.includes('Outlook access unavailable'));deniedGraph=false;
tokenError='invalid_client';const badCredential=await start();await finish(badCredential);
assert((await visible()).signInError.includes('app credential'));assert(!JSON.stringify(await visible()).includes(clientSecret));tokenError='';
returnedScope='Mail.Read Mail.Send';const broader=await start();await finish(broader);assert((await visible()).signInError.includes('Read-only'));returnedScope='Mail.Read';
const retry=await start();const beforeRefresh=tokenCalls;await finish(retry);assert.equal(tokenCalls,beforeRefresh+1);assert.equal((await visible()).signInError,null);
// Force the production refresh path with a synthetic tracked application.
const refreshFetcher=async(url,options)=>{
  if(url==='hq-records:operation')return Response.json({ok:true,recordId:'JOB-0099',status:'Applied',appliedOn:'2026-10-02'});
  if(url.includes('/mailFolders/sentitems?'))return Response.json({id:'synthetic-sent-folder'});
  if(url.startsWith('https://graph.microsoft.com/'))return Response.json({value:[]});
  return fetcher(url,options);
};

stored.outlook.tokens.expiresAt=now;const refreshApi=createMail(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-access-password'},{fetcher:refreshFetcher,clock:()=>now});
const checked=await refreshApi.handle(new Request(origin+'/api/mail',{method:'POST',headers:{host:'hq.test',origin,'content-type':'application/json'},body:JSON.stringify({action:'check',recordId:'JOB-0099'})}));
assert.equal(checked.status,200);assert.equal(stored.outlook.tokens.flow,'web');
assert.equal((await post({action:'disconnect'})).status,200);assert.equal((await visible()).connected,false);
const unprotected=createMail(connections,{}, {fetcher,clock:()=>now});assert.equal((await unprotected.handle(new Request(callback))).status,403);
console.log('Browser Outlook tests passed: PKCE, browser-bound state, single-use/expiry, private credentials, exact callback, read-only verification, refresh and retained prior connection.');

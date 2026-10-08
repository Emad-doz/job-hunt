import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMail,gmailShape,emailMatch} from '../server/mail.mjs';

// Gmail beside Outlook. Synthetic credentials and messages only; an injected fetcher stands in for Google, so nothing is contacted.
const clientId='123456789012-syntheticclientid0000.apps.googleusercontent.com',clientSecret='synthetic-google-secret-0001',origin='http://localhost:3000',callback=origin+'/api/mail/callback',READ='https://www.googleapis.com/auth/gmail.readonly';
let now=Date.parse('2026-10-08T09:00:00Z'),stored={},grantedScope=READ,lastChallenge='',tokenCalls=[],apiCalls=[];
const connections={settings:async()=>({SCOUT_CONFIG:stored}),updateScout:async fn=>{stored=fn(stored);}};
const b64=text=>Buffer.from(text).toString('base64url');
const raw=(id,{from,subject,text,html,labels=['INBOX'],at='2026-10-07T10:00:00Z'})=>({id,labelIds:labels,internalDate:String(Date.parse(at)),snippet:(text||'').slice(0,80),payload:{mimeType:'multipart/alternative',headers:[{name:'From',value:from},{name:'Subject',value:subject},{name:'Message-ID',value:'<'+id+'@mail.example.test>'}],parts:[...(text?[{mimeType:'text/plain',body:{data:b64(text)}}]:[]),...(html?[{mimeType:'text/html',body:{data:b64(html)}}]:[]),{mimeType:'application/pdf',filename:'synthetic.pdf',body:{data:b64('not read')}}]}});
const mailbox={
  msgreject01:raw('msgreject01',{from:'"Synthetic Retail Careers" <careers@synthetic-retail.example.test>',subject:'Your application for Digital Analyst',text:'Dear candidate, thank you for your interest in Synthetic Retail. Unfortunately we have decided not to proceed with your application for the Digital Analyst role.'}),
  msghtml0002:raw('msghtml0002',{from:'news@elsewhere.example.test',subject:'Weekly news',html:'<style>.x{color:red}</style><p>Nothing about any <b>application</b> here.</p>'}),
  msgsent0003:raw('msgsent0003',{from:'me@example.test',subject:'Re: Digital Analyst at Synthetic Retail',text:'My own message to Synthetic Retail about the Digital Analyst role.',labels:['SENT']}),
};
const fetcher=async(url,options)=>{
  assert.equal(options.redirect,'error');
  if(url==='https://oauth2.googleapis.com/token'){const p=new URLSearchParams(options.body);tokenCalls.push(Object.fromEntries(p));assert.equal(p.get('client_id'),clientId);assert.equal(p.get('client_secret'),clientSecret);
    if(p.get('grant_type')==='authorization_code'){assert.equal(p.get('redirect_uri'),callback);assert.equal(createHash('sha256').update(p.get('code_verifier')).digest('base64url'),lastChallenge);}
    return Response.json({access_token:'synthetic-google-access',refresh_token:'synthetic-google-refresh',scope:grantedScope,expires_in:3600});}
  const u=new URL(url);assert.equal(u.origin,'https://gmail.googleapis.com');assert.equal(options.headers.Authorization,'Bearer synthetic-google-access');assert.equal(options.method||'GET','GET','Gmail is only ever read');apiCalls.push(u.pathname+u.search);
  if(u.pathname==='/gmail/v1/users/me/profile')return Response.json({emailAddress:'me@example.test'});
  if(u.pathname==='/gmail/v1/users/me/messages'){assert.match(u.searchParams.get('q'),/^after:\d+ -in:sent -in:drafts -in:chats$/);return Response.json({messages:Object.keys(mailbox).map(id=>({id}))});}
  const id=u.pathname.split('/').at(-1);assert.equal(u.searchParams.get('format'),'full');return mailbox[id]?Response.json(mailbox[id]):Response.json({},{status:404});
};
const api=createMail(connections,{HQ_ACCESS_PASSWORD:'synthetic-owner-access-password',HQ_PUBLIC_ORIGIN:origin},{fetcher,clock:()=>now});
const post=body=>api.handle(new Request(origin+'/api/mail',{method:'POST',headers:{host:'localhost:3000',origin,'content-type':'application/json'},body:JSON.stringify(body)}));
const visible=async()=>await(await api.handle(new Request(origin+'/api/mail'))).json();
async function signIn(){const response=await post({action:'connect-browser'}),v=await response.json();assert.equal(response.status,200,v.error);const u=new URL(v.url);lastChallenge=u.searchParams.get('code_challenge');
  return {u,finish:()=>api.handle(new Request(callback+'?'+new URLSearchParams({state:u.searchParams.get('state'),code:'synthetic-auth-code'}),{headers:{cookie:response.headers.get('set-cookie').split(';')[0]}}))};}

// A Gmail message is read into the shape the matching already understands: plain text first, HTML without its styling, attachments never.
const shaped=gmailShape(mailbox.msgreject01);assert.deepEqual([shaped.mailbox,shaped.subject,shaped.from.emailAddress.address,shaped.from.emailAddress.name,shaped.receivedDateTime,shaped.webLink,shaped.parentFolderId,shaped.isDraft],['gmail','Your application for Digital Analyst','careers@synthetic-retail.example.test','Synthetic Retail Careers','2026-10-07T10:00:00.000Z','https://mail.google.com/mail/u/0/#all/msgreject01','INBOX',false]);
assert(shaped.body.content.includes('decided not to proceed')&&!shaped.body.content.includes('not read'));assert(!gmailShape(mailbox.msghtml0002).body.content.includes('color:red'));assert.equal(gmailShape(mailbox.msgsent0003).parentFolderId,'SENT');assert.equal(gmailShape({id:'../etc'}),null);assert.equal(gmailShape(null),null);
const evidence=emailMatch(shaped,{employer:'Synthetic Retail',role:'Digital Analyst',appliedOn:'2026-10-01'});assert.deepEqual([evidence.kind,evidence.url,evidence.reference.startsWith('Gmail · ')],['gmail-message','https://mail.google.com/mail/u/0/#all/msgreject01',true]);

// Settings: Gmail is a choice, with Google's own form of client ID, and its secret is required.
assert.deepEqual([(await visible()).provider,Object.keys((await visible()).providers)],['outlook',['outlook','gmail']]);
assert.match((await(await post({action:'save',provider:'gmail',clientId:'00000000-0000-4000-8000-000000000002',clientSecret})).json()).error,/apps\.googleusercontent\.com/);
assert.match((await(await post({action:'save',provider:'gmail',clientId})).json()).error,/Client secret/);assert.match((await(await post({action:'save',provider:'other',clientId})).json()).error,/Outlook or Gmail/);
const saved=await post({action:'save',provider:'gmail',clientId,clientSecret});assert.equal(saved.status,200);assert(!JSON.stringify(await saved.json()).includes('Microsoft'),'answers are worded for Google');
const shown=await visible();assert.deepEqual([shown.provider,shown.browserReady,shown.redirectUri,shown.connected],['gmail',true,callback,false]);assert(!JSON.stringify(shown).includes(clientSecret));
assert.match((await(await post({action:'connect'})).json()).error,/browser sign-in/);

// Sign-in: Google's address, reading only, PKCE, offline access with consent; a wider permission is refused and nothing is kept.
{const {u}=await signIn();assert.deepEqual([u.origin+u.pathname,u.searchParams.get('scope'),u.searchParams.get('access_type'),u.searchParams.get('prompt'),u.searchParams.get('code_challenge_method'),u.searchParams.get('redirect_uri'),u.searchParams.get('client_id')],['https://accounts.google.com/o/oauth2/v2/auth',READ,'offline','consent select_account','S256',callback,clientId]);assert(!u.href.includes(clientSecret));}
for(const wide of [READ+' https://mail.google.com/','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.modify '+READ,'']){grantedScope=wide;const {finish}=await signIn(),back=await finish();assert.equal(back.status,303);assert(back.headers.get('location').includes('outlook=failed'));const after=await visible();assert.equal(after.connected,false);assert.match(after.signInError,/Read-only Gmail permission was not confirmed/);assert.equal(stored.outlook.tokens,undefined);}
grantedScope=READ;tokenCalls=[];apiCalls=[];
{const {finish}=await signIn(),back=await finish();assert.equal(back.status,303);assert(back.headers.get('location').includes('outlook=connected'));assert.deepEqual([tokenCalls.length,tokenCalls[0].grant_type,tokenCalls[0].scope,apiCalls],[1,'authorization_code',undefined,['/gmail/v1/users/me/profile']]);const after=await visible();assert.deepEqual([after.connected,after.signInError],[true,null]);assert(!JSON.stringify(after).includes('synthetic-google-'));}

// Reading replies: received mail only, each message read in full, the same proposals as with Outlook, and nothing written anywhere.
apiCalls=[];const scan=await post({action:'scan',jobs:[{recordId:'JOB-001',employer:'Synthetic Retail',role:'Digital Analyst',status:'Applied',appliedOn:'2026-10-01'},{recordId:'JOB-002',employer:'Another Synthetic Employer',role:'Data Lead',status:'Applied',appliedOn:'2026-10-02'}]}),found=await scan.json();
assert.equal(scan.status,200,found.error);assert.deepEqual([found.result.scanned,found.result.proposals.length,found.result.proposals[0].recordId,found.result.proposals[0].status,found.result.proposals[0].url,found.result.proposals[0].sender],[2,1,'JOB-001','Rejected','https://mail.google.com/mail/u/0/#all/msgreject01','careers@synthetic-retail.example.test']);
assert.equal(apiCalls.length,4);assert(apiCalls[0].startsWith('/gmail/v1/users/me/messages?q=after'));assert(!/Outlook|Microsoft/.test(found.message));
// An expired access token is renewed with the refresh token, without a scope parameter, and a refused renewal asks for a new sign-in.
now+=2*3600000;tokenCalls=[];const again=await post({action:'scan',jobs:[{recordId:'JOB-001',employer:'Synthetic Retail',role:'Digital Analyst',status:'Applied',appliedOn:'2026-10-01'}]});assert.equal(again.status,200);assert.deepEqual([tokenCalls.length,tokenCalls[0].grant_type,tokenCalls[0].refresh_token,tokenCalls[0].scope],[1,'refresh_token','synthetic-google-refresh',undefined]);
// Going back to Outlook starts clean: the Google secret and sign-in are not carried over.
assert.equal((await post({action:'save',provider:'outlook',clientId:'00000000-0000-4000-8000-000000000002'})).status,200);const back=await visible();assert.deepEqual([back.provider,back.connected,back.clientSecretConfigured],['outlook',false,false]);assert.equal(stored.outlook.tokens,undefined);
console.log('Gmail checks passed: messages read into the shared shape, Google client settings, PKCE sign-in with reading only, wider permissions refused, verified reading, replies proposed from received mail, renewal, a clean change of mailbox. Synthetic values only; Google was not contacted.');

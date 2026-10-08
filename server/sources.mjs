import {createHash} from 'node:crypto';
import {overlap} from './cv-reader.mjs';
// No employer is watched until the owner adds one: a broad search should not look tied to particular companies.
export const defaultBoards=[];
const named={lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'\u2019',lsquo:'\u2018',rdquo:'\u201d',ldquo:'\u201c',ndash:'\u2013',mdash:'\u2014',hellip:'\u2026',bull:'\u2022',euro:'\u20ac',eacute:'\u00e9',euml:'\u00eb',iuml:'\u00ef'};
const decode=text=>text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi,(whole,decimal,hex,name)=>{if(name)return name.toLowerCase()==='amp'?'&':named[name.toLowerCase()]??whole;const code=decimal?Number(decimal):parseInt(hex,16);return code>31&&code<=0x10ffff&&(code<0xd800||code>0xdfff)?String.fromCodePoint(code):' ';});
// Employer feeds escape their HTML, so decode before removing tags; otherwise tag names are left behind as words.
export const plain=value=>decode(decode(String(value||'')).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
export function vacancyUrl(value){
  const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|.*\.local|.*\.internal)$/.test(u.hostname)||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':'))throw new Error('Use a public HTTPS vacancy link.');
  for(const key of [...u.searchParams.keys()])if(!['jk','currentJobId','gh_jid','jobId','job_id','id','jid','vacancyId','reqId','pid'].includes(key))u.searchParams.delete(key);u.hash='';return u.href;
}
export const canonical=value=>{try{return vacancyUrl(value).toLowerCase().replace(/\/$/,'');}catch{return '';}};
export function parseBoards(value){
  const lines=String(value||'').split('\n').map(s=>s.trim()).filter(Boolean);if(lines.length>8)throw new Error('Use at most eight employer boards.');
  return lines.map(line=>{const [link,label]=line.split('|').map(s=>s.trim()),u=new URL(link);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)throw new Error('Use a clean employer job-board URL.');const parts=u.pathname.split('/').filter(Boolean);let provider,board;
    if(['boards.greenhouse.io','job-boards.greenhouse.io'].includes(u.hostname)&&parts.length===1)provider='greenhouse';
    else if(u.hostname==='jobs.ashbyhq.com'&&parts.length===1)provider='ashby';
    else if(['jobs.lever.co','jobs.eu.lever.co'].includes(u.hostname)&&parts.length===1)provider=u.hostname==='jobs.eu.lever.co'?'lever-eu':'lever';
    else throw new Error('Supported boards: Greenhouse, Ashby, Lever and Lever EU. Use the employer board URL, not a single vacancy.');
    board=parts[0];if(!/^[A-Za-z0-9_-]{1,80}$/.test(board))throw new Error('Invalid employer board identifier.');return {provider,board,employer:plain(label||board).slice(0,100)};
  });
}
export const boardText=boards=>boards.map(b=>`https://${b.provider==='greenhouse'?'job-boards.greenhouse.io':b.provider==='ashby'?'jobs.ashbyhq.com':b.provider==='lever-eu'?'jobs.eu.lever.co':'jobs.lever.co'}/${b.board} | ${b.employer}`).join('\n');
export function sourceEndpoint(b){
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(b.board))throw new Error('Invalid employer board.');
  if(b.provider==='greenhouse')return `https://boards-api.greenhouse.io/v1/boards/${b.board}/jobs?content=true`;
  if(b.provider==='ashby')return `https://api.ashbyhq.com/posting-api/job-board/${b.board}?includeCompensation=true`;
  if(['lever','lever-eu'].includes(b.provider))return `https://${b.provider==='lever-eu'?'api.eu.lever.co':'api.lever.co'}/v0/postings/${b.board}?mode=json&limit=500`;
  throw new Error('Unsupported board provider.');
}
async function boundedJson(response){let size=0,text='';const decoder=new TextDecoder();for await(const part of response.body){size+=part.byteLength;if(size>5*1024*1024)throw new Error('Employer feed exceeded the 5 MB safety limit.');text+=decoder.decode(part,{stream:true});}return JSON.parse(text+decoder.decode());}
export async function readBoard(b,profile,location,fetcher=fetch,at=new Date().toISOString()){
  const response=await fetcher(sourceEndpoint(b),{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(18000)});if(!response.ok)throw new Error('Employer feed unavailable (HTTP '+response.status+').');
  const data=await boundedJson(response),items=Array.isArray(data)?data:data.jobs;if(!Array.isArray(items))throw new Error('Unexpected employer feed format.');
  const result=[];for(const item of items.slice(0,1000)){
    if(item.isListed===false)continue;
    const title=plain(item.title||item.text),description=plain(item.content||item.descriptionPlain||item.descriptionHtml||item.description)+' '+plain((item.lists||[]).map(l=>l.text+' '+l.content).join(' '));
    const place=plain(typeof item.location==='string'?item.location:item.location?.name||[item.categories?.location,...(item.categories?.allLocations||[])].filter(Boolean).join(' / '));
    let url;try{url=vacancyUrl(item.absolute_url||item.jobUrl||item.hostedUrl);}catch{continue;}
    const host=new URL(url).hostname;if(!['job-boards.greenhouse.io','boards.greenhouse.io','jobs.ashbyhq.com','jobs.lever.co','jobs.eu.lever.co'].includes(host))continue;
    const id=String(item.id||new URL(url).pathname.split('/').filter(Boolean).at(-1)||'');if(!id||!title)continue;
    const skills=overlap(profile.skills,title+' '+description);
    // Public ATS feeds use their declared location; this is not a geocoded radius search.
    const area=String(location||'').toLowerCase().split(',')[0].trim();
    if(!place.toLowerCase().includes(area))continue;
    const roleTokens=(profile.terms||[]).flatMap(t=>t.toLowerCase().split(/\W+/)).filter(t=>t.length>3&&!['specialist','manager'].includes(t));
    // A broad source candidate remains available for the Analyst's explained hold.
    // It will not become a recommendation solely because a generic skill appears.
    if(!skills.length&&!roleTokens.some(t=>title.toLowerCase().includes(t)))continue;
    result.push({id:b.provider.toUpperCase()+'-'+b.board+'-'+id,sourceId:id,originalPostingId:id,source:b.provider==='greenhouse'?'Greenhouse':b.provider==='ashby'?'Ashby':b.provider==='lever-eu'?'Lever EU':'Lever',board:b.board,title,employer:b.employer,location:place||'Not supplied',url,description:description.trim().slice(0,18000),skills,salary:plain(item.compensation?.scrapeableCompensationSalarySummary||item.compensation?.compensationTierSummary)||'Unknown',publishedAt:item.publishedAt||null,readAt:at,sourceUpdatedAt:item.updated_at||null,availability:'Published on employer ATS feed at source-read time; may change',completeness:'Employer feed description',stale:false});
  }return result;
}
export function importedListing(body,profile,at){
  const url=vacancyUrl(body.url),title=plain(body.title).slice(0,180),employer=plain(body.employer).slice(0,120),description=plain(body.description).slice(0,18000),location=plain(body.location).slice(0,120);
  if(!title||!employer||description.length<80)throw new Error('Supply employer, role and at least 80 characters copied from the vacancy.');
  const u=new URL(url),provider=/(^|\.)linkedin\.com$/.test(u.hostname)?'LinkedIn':/(^|\.)indeed\.[a-z.]+$/.test(u.hostname)?'Indeed':'Owner import';
  const fromReport=body.importMethod==='daily-report';
  if(fromReport&&(/(^|\.)(?:google\.com|microsoftonline\.com|live\.com|outlook\.com)$/.test(u.hostname)||/^\/(?:|careers\/?|jobs\/?|search\/?|login\/?|signin\/?)$/.test(u.pathname)&&![...u.searchParams.keys()].length||provider==='LinkedIn'&&!/\/jobs\/view\//.test(u.pathname)&&!u.searchParams.has('currentJobId')||provider==='Indeed'&&!u.searchParams.has('jk')&&!/\/viewjob\/\d+/.test(u.pathname)))throw new Error('Supply an original single-vacancy link, not a homepage, search page or private document.');
  const originalPostingId=u.searchParams.get('jk')||u.searchParams.get('currentJobId')||u.pathname.match(/(?:jobs\/view|viewjob)\/(\d+)/)?.[1]||'';
  const sourceId=originalPostingId||'URL-'+createHash('sha256').update(url).digest('hex').slice(0,20);
  return {id:provider.toUpperCase().replace(/\W/g,'')+'-'+sourceId,sourceId,originalPostingId,source:provider,title,employer,location:location||'Not supplied',url,description,skills:overlap(profile.skills,title+' '+description),salary:plain(body.salary).slice(0,150)||'Unknown',publishedAt:null,readAt:at,availability:fromReport?'Owner-provided daily report; source claims and availability not independently verified':'Owner-provided excerpt; availability not independently verified',completeness:fromReport?'Owner-provided daily report excerpt':'Owner-provided excerpt',stale:false};
}

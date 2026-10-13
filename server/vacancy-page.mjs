// Reads one vacancy from the public page the owner gives a link to: the structured job data most career sites publish, or failing that the page's own title and text. One request the owner starts; nothing is saved here. Node built-ins only.
import {lookup as dnsLookup} from 'node:dns/promises';
import {plain} from './sources.mjs';

const LIMIT=1_500_000,HOPS=4;
// Only public web addresses: https, a real host name, and no address that resolves to this machine or a private network.
function publicAddress(value){
  let u;try{u=new URL(String(value||'').trim());}catch{throw new Error('Paste the full link to the vacancy, starting with https://.');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(u.hostname)||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':'))throw new Error('Use a public HTTPS vacancy link.');
  u.hash='';return u;
}
const privateIp=ip=>/^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)||/^(?:::1?$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|::ffff:)/i.test(ip);
const first=value=>Array.isArray(value)?value[0]:value;
const text=value=>typeof value==='string'?plain(value):typeof value==='number'?String(value):'';
function findPosting(node,depth=0){
  if(!node||typeof node!=='object'||depth>6)return null;
  if(Array.isArray(node)){for(const item of node.slice(0,60)){const found=findPosting(item,depth+1);if(found)return found;}return null;}
  const type=node['@type'];if(type==='JobPosting'||Array.isArray(type)&&type.includes('JobPosting'))return node;
  return findPosting(node['@graph'],depth+1)||findPosting(node.mainEntity,depth+1);
}
function place(posting){
  const names=[];for(const spot of (Array.isArray(posting.jobLocation)?posting.jobLocation:[posting.jobLocation]).filter(Boolean).slice(0,3)){const a=spot.address;const name=typeof a==='string'?text(a):[a?.addressLocality,a?.addressRegion,a?.addressCountry?.name||a?.addressCountry].map(text).filter(Boolean).join(', ')||text(spot.name);if(name&&!names.includes(name))names.push(name);}
  if(/telecommute/i.test(String(posting.jobLocationType||'')))names.push('Remote');
  return names.join(' · ').slice(0,120);
}
function pay(posting){
  const base=first(posting.baseSalary)||first(posting.estimatedSalary);if(!base)return '';if(typeof base!=='object')return text(base).slice(0,150);
  const v=base.value&&typeof base.value==='object'?base.value:base,amounts=[v.minValue,v.maxValue].map(Number).filter(n=>Number.isFinite(n)&&n>0),single=Number(v.value);
  const shown=amounts.length?[...new Set(amounts)].map(n=>n.toLocaleString('en-GB')).join('–'):Number.isFinite(single)&&single>0?single.toLocaleString('en-GB'):'';
  return shown?[text(base.currency||v.currency),shown,text(v.unitText)?'per '+text(v.unitText).toLowerCase():''].filter(Boolean).join(' ').slice(0,150):'';
}
const meta=(html,name)=>{const tag=html.match(new RegExp('<meta[^>]+(?:property|name)=["\']'+name+'["\'][^>]*>','i'))?.[0]||'';return plain(tag.match(/content=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(v=>v!==undefined)||'');};
// What a page says about one vacancy. Nothing is guessed: a field the page does not give stays empty for the owner to fill in.
export function parseVacancyPage(html,url){
  const page=String(html||'');let posting=null;
  for(const block of page.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{posting=findPosting(JSON.parse(block[1].trim()));}catch{}if(posting)break;}
  const heading=plain(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||''),titleTag=plain(page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),site=meta(page,'og:site_name');
  // Without structured data the readable part of the page is used: scripts, styling and navigation taken out, the main content preferred.
  const body=page.replace(/<(script|style|noscript|svg|template|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi,' '),main=body.match(/<main\b[\s\S]*?<\/main>/i)?.[0]||body.match(/<article\b[\s\S]*?<\/article>/i)?.[0]||body.match(/<body\b[\s\S]*$/i)?.[0]||body;
  const structured=posting?{title:text(posting.title).slice(0,180),employer:text(first(posting.hiringOrganization)?.name||first(posting.hiringOrganization)).slice(0,120),location:place(posting),salary:pay(posting),description:text(posting.description).slice(0,18000),posted:text(posting.datePosted).slice(0,40),closes:text(posting.validThrough).slice(0,40)}:null;
  const fallback={title:(meta(page,'og:title')||heading||titleTag).slice(0,180),employer:site.slice(0,120),location:'',salary:'',description:(plain(main)||meta(page,'og:description')||meta(page,'description')).slice(0,18000),posted:'',closes:''};
  const found=structured&&structured.title&&structured.description.length>=80?structured:null,vacancy=found?{...found,employer:found.employer||fallback.employer}:{...fallback,...(structured?.title?{title:structured.title}:{}),...(structured?.employer?{employer:structured.employer}:{}),...(structured?.location?{location:structured.location}:{})};
  return {...vacancy,url,basis:found?'structured':'page'};
}
export async function readVacancyPage(value,{fetcher=fetch,lookup=dnsLookup,timeout=15000}={}){
  let u=publicAddress(value),response;
  for(let hop=0;;hop++){
    let addresses;try{addresses=await lookup(u.hostname,{all:true});}catch{throw new Error('That address could not be found. Check the link.');}
    if(!addresses.length||addresses.some(a=>privateIp(a.address)))throw new Error('Use a public HTTPS vacancy link.');
    try{response=await fetcher(u.href,{headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'en,*;q=0.5','User-Agent':'JobHunt/0.1 (personal job tracker; one page at the owner\'s request)'},redirect:'manual',signal:AbortSignal.timeout(timeout)});}
    catch(error){throw new Error(error?.name==='TimeoutError'?'The site took too long to answer. Try again, or paste the vacancy text below.':'The site could not be reached. Check the link, or paste the vacancy text below.');}
    if(response.status<300||response.status>=400)break;
    const next=response.headers.get('location');if(!next||hop>=HOPS)throw new Error('The link keeps redirecting. Open it in your browser and paste the address you end up at.');
    try{u=publicAddress(new URL(next,u).href);}catch{throw new Error('The link leads to an address the app does not read. Paste the vacancy text below.');}
  }
  if(response.status===401||response.status===403||response.status===429||response.status===999)throw new Error('This site does not let the app read its pages (HTTP '+response.status+'). Open the vacancy in your browser and paste its text below.');
  if(response.status===404||response.status===410)throw new Error('The site says this vacancy page no longer exists (HTTP '+response.status+').');
  if(!response.ok)throw new Error('The site answered with an error (HTTP '+response.status+'). Paste the vacancy text below.');
  if(!/html/i.test(response.headers.get('content-type')||''))throw new Error('That link is not a web page (it may be a PDF or a download). Paste the vacancy text below.');
  const chunks=[];let size=0;if(response.body)for await(const chunk of response.body){const room=LIMIT-size;size+=chunk.length;chunks.push(chunk.length>room?chunk.subarray(0,room):chunk);if(size>=LIMIT)break;}
  const vacancy=parseVacancyPage(Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('utf8'),u.href);
  if(!vacancy.title&&vacancy.description.length<80)throw new Error('The page gave no readable vacancy. It may need a sign-in or build its content in the browser. Paste the vacancy text below.');
  return vacancy;
}

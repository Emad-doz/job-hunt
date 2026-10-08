const clean=s=>String(s||'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*_`]/g,'').trim();
export function parseDailyReport(text){
 const input=String(text||'').slice(0,20000),lines=input.split(/\r?\n/),rows=[],seen=new Map();
 for(let i=0;i<lines.length;i++){let line=lines[i].trim();if(!line||/^\[(?:Certain|Likely|Unknown)\]/i.test(line))continue;
  line=line.replace(/^\|\s*/,'').replace(/^\d+[.)]?\s*(?:\||\t|\s)\s*/,'').replace(/^[-*]\s+/,'');
  const cell=line.split(/\t|\s+\|\s+/)[0],m=clean(cell).match(/^(.{2,70}?)\s+[—–]\s+(.{2,180})$/);if(!m||m[1].split(/\s+/).length>7)continue;
  const employer=m[1].trim(),parts=m[2].split(/,\s*/),title=parts.shift().trim(),location=parts.join(', ')||'';if(!title||/^(?:status|risk|pipeline|summary)$/i.test(employer))continue;
  const fields=[];for(const next of lines.slice(i+1,i+4)){if(!/^\s*(?:https?:\/\/|(?:Link|URL|Vacancy|Requirements|Description|Location|Salary|Salaris)\s*:)/i.test(next))break;fields.push(next);}
  const nearby=[lines[i],...fields].join('\n');
  const url=nearby.match(/https:\/\/[^\s)>\]]+/)?.[0]?.replace(/[.,;]$/,'')||'',salary=(nearby.match(/(?:Salary|Salaris)\s*:\s*([^\n]+)/i)?.[1]||'').split(/\t|\s+\|\s*/)[0].trim(),requirements=nearby.match(/(?:Requirements|Description)\s*:\s*([^\n]+)/i)?.[1];
  const key=(employer+'|'+title).toLocaleLowerCase().replace(/[^\p{L}\p{N}|]/gu,'');if(seen.has(key)){const previous=seen.get(key);if(!previous.url&&url)previous.url=url;continue;}
  const row={id:'REPORT-'+(rows.length+1),employer,title,location,url,salary,description:requirements||clean(lines[i]),reportExcerpt:clean(lines[i]),sourceLine:i+1};seen.set(key,row);rows.push(row);if(rows.length>=30)break;
 }
 return {rows,limit:30,truncated:String(text||'').length>20000,notice:rows.length?'Review each extracted vacancy. Report statements are owner-provided claims, not independent verification.':'No structured vacancies recognised. Use “Employer — Role, Location” lines and include original vacancy links, or add a vacancy manually.'};
}
export function reportIdentity(value){try{const u=new URL(value);for(const k of [...u.searchParams.keys()])if(!['jk','currentJobId','gh_jid','jobId','job_id'].includes(k))u.searchParams.delete(k);u.hash='';return u.href.toLowerCase().replace(/^https?:\/\/(?:www\.)?/,'').replace(/\/$/,'');}catch{return '';}}
const words=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function compareReportJob(row,tracker,discoveries){const url=reportIdentity(row.url),jobs=[...tracker.map(j=>({id:j.id,employer:j.employer,title:j.role,url:j.url,kind:'Tracker'})),...discoveries.map(j=>({id:j.id,employer:j.employer,title:j.title,url:j.url,kind:'HQ discovery'}))],exact=url?jobs.find(j=>reportIdentity(j.url)===url):undefined;if(exact)return {status:'exists',matches:[exact]};const matches=jobs.filter(j=>words(j.employer)===words(row.employer)&&words(j.title)===words(row.title));return {status:matches.length?'possible':'missing',matches};}

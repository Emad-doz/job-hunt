import {zone as defaultZone} from './zone';
import {zone} from './zone';
// Google-formatted wall times must not be parsed in the browser's timezone.
const calendar=(y:number,m:number,d:number)=>{const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;};
export function normalizeActivityDate(raw:string,locale='en_US',zone=defaultZone()){
 const value=String(raw||'').trim();
 const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(iso)return calendar(+iso[1],+iso[2],+iso[3])?value:raw;
 const stamp=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/);
 if(stamp&&calendar(+stamp[1],+stamp[2],+stamp[3])&&+stamp[4]<24&&+stamp[5]<60&&+(stamp[6]||0)<60&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();
 if(locale!=='en_US')return raw;
 const us=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);if(!us)return raw;
 const [,month,day,year,hour,minute,second]=us,y=+year,m=+month,d=+day;
 if(!calendar(y,m,d)||y<1900||hour!==undefined&&(+hour>23||+minute>59||+(second||0)>59))return raw;
 const date=[year,month.padStart(2,'0'),day.padStart(2,'0')].join('-');if(hour===undefined)return date;
 const wall=Date.UTC(y,m-1,d,+hour,+minute,+(second||0));
 try{
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const clock=(at:number)=>{const p=Object.fromEntries(formatter.formatToParts(new Date(at)).map(p=>[p.type,p.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);};
  const offsets=[...new Set([-86400000,0,86400000].map(delta=>clock(wall+delta)-(wall+delta)))];
  const matches=offsets.map(offset=>wall-offset).filter(at=>clock(at)===wall);
  // Preserve ambiguous or nonexistent DST wall times instead of inventing one.
  return matches.length===1?new Date(matches[0]).toISOString():raw;
 }catch{return raw;}
}
export function activityDay(value:string){const day=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);if(!day||!calendar(+day[1],+day[2],+day[3]))return '';if(value.length===10)return value;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:zone(),year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function compareActivityDates(a:{date:string;id:string},b:{date:string;id:string}){const ad=activityDay(a.date),bd=activityDay(b.date);return ad.localeCompare(bd)||(ad&&bd?a.date.localeCompare(b.date):0)||a.id.localeCompare(b.id);}

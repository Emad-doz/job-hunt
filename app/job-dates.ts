import {activityDay,normalizeActivityDate} from './activity-dates';
import type {JobItem} from './daily-model';
import {zone} from './zone';
export type JobDateBasis='found'|'applied';
export type JobDatePeriod='All dates'|'Today'|'Past 7 days'|'Past 30 days'|'Custom range'|'Date missing';
export const calendarDate=(value:string|undefined)=>activityDay(String(value||''));
export const sheetCalendarDate=(value:string,locale:string,zone:string)=>calendarDate(normalizeActivityDate(value,locale,zone));
export function jobDateInfo(item:JobItem,basis:JobDateBasis){
 const raw=item.job?(basis==='found'?item.job.found:item.job.applied):basis==='found'?item.foundAt||item.discovery?.readAt||item.review?.job.readAt||'':'';
 const normal=item.job?(basis==='found'?item.job.foundDate:item.job.appliedDate):undefined;
 return {date:normal===undefined?calendarDate(raw):normal||'',raw,source:item.job?'Tracker · '+(basis==='found'?'Date found':'Applied on'):basis==='found'?'Earliest recorded HQ discovery':'No application recorded'};
}
export function dateLabel(item:JobItem,basis:JobDateBasis){const info=jobDateInfo(item,basis);return info.date||(info.raw?'Date needs checking':'Not recorded');}
export function matchesJobDate(value:string|undefined,period:JobDatePeriod,from='',to='',now=new Date()){
 if(period==='All dates')return true;const date=calendarDate(value);if(period==='Date missing')return !date;if(!date)return false;
 if(period==='Custom range'){if(!from&&!to)return true;const start=calendarDate(from),end=calendarDate(to);if(from&&!start||to&&!end||start&&end&&start>end)return false;return (!start||date>=start)&&(!end||date<=end);}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone(),year:'numeric',month:'2-digit',day:'2-digit'}).format(now),days=period==='Today'?1:period==='Past 7 days'?7:30,start=new Date(today+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-(days-1));return date>=start.toISOString().slice(0,10)&&date<=today;
}
export function earliestDiscovery(id:string,url:string,records:{id:string;url:string;readAt:string;createdAt?:string}[]){
 return records.filter(r=>r.id===id||url&&r.url===url).flatMap(r=>[r.readAt,r.createdAt]).filter((v):v is string=>!!v&&!!calendarDate(v)).sort((a,b)=>Date.parse(a)-Date.parse(b))[0]||'';
}

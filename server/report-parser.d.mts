export type ReportRow={id:string;employer:string;title:string;location:string;url:string;salary:string;description:string;reportExcerpt:string;sourceLine:number};
export function parseDailyReport(text:string):{rows:ReportRow[];limit:number;truncated:boolean;notice:string};
export function reportIdentity(url:string):string;
export function compareReportJob(row:ReportRow,tracker:{id:string;employer:string;role:string;url:string}[],discoveries:{id:string;employer:string;title:string;url:string}[]):{status:string;matches:{id:string;employer:string;title:string;url:string;kind:string}[]};

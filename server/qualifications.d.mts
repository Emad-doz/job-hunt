export type QualificationProfile={skills?:string[];evidence?:string[];qualificationMentions?:string[];readAt?:string;sourceUrl?:string};
export type QualificationItem={key:string;label:string;status:'documented'|'check'|'unknown';vacancyEvidence:string;cvEvidence:string;note:string};
export type QualificationOverview={version:string;items:QualificationItem[];documented:number;total:number;cvReadAt:string|null;cvSource:string|null;hasProfile:boolean};
export const QUALIFICATION_VERSION:string;
export function cvQualificationMentions(text:string):string[];
export function qualificationOverview(description:string,profile?:QualificationProfile|null):QualificationOverview;

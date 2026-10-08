// What an export holds of the settings: everything the owner chose or decided, and none of the secrets. Keys, passwords and sign-in tokens stay behind and are entered again where the export is imported.
export const EXPORT_FORMAT='job-hunt-export',EXPORT_VERSION=1;
export function portableSettings(config){
  const {appKey,bridgeUrl,bridgeSecret,database,applicationRequests,...rest}=config||{};
  const out={...rest};
  if(rest.ai){const {apiKey,consentAt,consentVersion,enabled,...ai}=rest.ai;out.ai=ai;}
  if(rest.jsearch){const {apiKey,...jsearch}=rest.jsearch;out.jsearch=jsearch;}
  if(rest.outlook){const {clientSecret,tokens,webOrigin,signInError,error,verifiedAt,...outlook}=rest.outlook;out.outlook=outlook;}
  // The hourly check is off after a move until the owner switches it on again, and nothing is mid-task.
  out.enabled=false;if(out.state)out.state={...out.state,activeAgent:null,task:null,taskAt:null,taskContext:null,status:'paused',nextCheck:null};
  return out;
}
export const exportFile=({records,cv,settings,at,source})=>({format:EXPORT_FORMAT,version:EXPORT_VERSION,exportedAt:at,source,records,cv,settings:portableSettings(settings)});

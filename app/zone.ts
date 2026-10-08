// The time zone dates are shown in: the one of the browser the app is opened in.
export const zone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return 'UTC';}};

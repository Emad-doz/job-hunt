import { makeDemo } from '../app/data';

export type Settings={};
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
// The records live in the owner's database and are served from there (server/database.mjs). This is what a visitor sees before a database is connected: the isolated fictional demo.
export async function getSnapshot(_request:Request,_settings:Settings){
return response({...makeDemo(),error:'Your records database is not connected yet. These are fictional demo records.'});
}

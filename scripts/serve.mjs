import worker from '../dist/server/index.js';
import {createHqServer} from '../server/node-host.mjs';
const host=process.env.HOST||'127.0.0.1';
const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
const server=createHqServer(worker,process.env,'dist/client');
server.listen(port,host,()=>console.log('Job Hunt is running. Open http://'+(host==='0.0.0.0'?'localhost':host)+':'+port+' in your browser.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));

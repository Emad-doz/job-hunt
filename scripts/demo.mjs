import worker from '../dist/server/index.js';
import {createHqServer} from '../server/node-host.mjs';
// Preview is deliberately isolated from production credentials and private settings.
createHqServer(worker,{},'dist/client').listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'));

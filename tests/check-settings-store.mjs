import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,readFileSync,mkdirSync} from 'node:fs';
import {createConnections} from '../server/connections.mjs';

// The encrypted settings file: written with one key per start, readable by the next start, unreadable with another password. Synthetic values in a throwaway folder.
const dir=mkdtempSync(path.join(os.tmpdir(),'hq-settings-')),file=path.join(dir,'connections.enc'),root=path.join(dir,'public');mkdirSync(root);
const environment={HQ_ACCESS_PASSWORD:'synthetic-owner-password-123',HQ_CONFIG_FILE:file};
const first=createConnections(environment,root);
assert.deepEqual((await first.settings()).SCOUT_CONFIG,undefined);
await first.updateScout(c=>({...c,terms:['synthetic analyst']}));const one=JSON.parse(readFileSync(file,'utf8'));
await first.updateScout(c=>({...c,location:'Amsterdam'}));const two=JSON.parse(readFileSync(file,'utf8'));
assert.equal(one.salt,two.salt,'the key is derived once per start');assert.notEqual(one.iv,two.iv,'every save has its own nonce');assert.notEqual(one.data,two.data);
assert(!readFileSync(file,'utf8').includes('synthetic analyst'),'the file does not hold the settings in the clear');
// A new start reads what the last one wrote, and keeps writing in a way the next one can read.
const second=createConnections(environment,root);assert.deepEqual((await second.settings()).SCOUT_CONFIG,{terms:['synthetic analyst'],location:'Amsterdam'});
await second.updateScout(c=>({...c,distance:25}));
const third=createConnections(environment,root);assert.deepEqual((await third.settings()).SCOUT_CONFIG,{terms:['synthetic analyst'],location:'Amsterdam',distance:25});
// Another password cannot open it, and does not overwrite it.
const wrong=createConnections({...environment,HQ_ACCESS_PASSWORD:'another-synthetic-password-456'},root);await assert.rejects(()=>wrong.settings(),/could not be unlocked/);await assert.rejects(()=>wrong.updateScout(c=>c),/could not be unlocked/);
assert.deepEqual((await createConnections(environment,root).settings()).SCOUT_CONFIG,{terms:['synthetic analyst'],location:'Amsterdam',distance:25});
console.log('Settings store checks passed: one key per start, a fresh nonce per save, readable by the next start, closed to another password. Synthetic values only.');

import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'nyaa-http-r1-'));
const mock=createServer((req,res)=>{let body='';req.on('data',x=>body+=x);req.on('end',()=>{
  const n=JSON.parse(body).input.length;res.end(JSON.stringify({data:Array.from({length:n},(_,index)=>({index,embedding:[1,0,0]}))}));
});});
await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));
const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));
const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
const child=spawn(process.execPath,['server/dist/index.js'],{env:{...process.env,DATA_DIR:dir,APP_PORT:String(port),HOST:'127.0.0.1',
  EMBEDDING_BASE_URL:`http://127.0.0.1:${(mock.address() as {port:number}).port}`,EMBEDDING_MODEL:'test',EMBEDDING_DIM:'3',
  AUTH_USERNAME:'test',AUTH_PASSWORD:'test-only-password',AUTH_SECRET:'test-only-secret',KB_SERVER_TOKEN:'test-only-token',MCP_API_KEY:'test-only-mcp'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
const base=`http://127.0.0.1:${port}`;
async function request(path:string,method='GET',body?:unknown,owner='smoke',token='test-only-token') {
  const res=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'X-Sender-Id':owner,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json()};
}
try {
  for(let i=0;;i++) {try{await fetch(base+'/health');break;}catch{assert.ok(i<100,logs);await new Promise(r=>setTimeout(r,50));}}
  assert.equal((await request('/api/memory/profile')).status,404);
  assert.equal((await request('/api/memory/profile','GET',undefined,'smoke','bad')).status,401);
  assert.equal((await request('/api/memory/profile','PUT',{profile_patch:{zero:0,no:false}})).status,200);
  assert.equal((await request('/api/memory/write','POST',{content:'喜欢喝茶',salience:.3})).status,201);
  assert.equal((await request('/ready')).status,200);
  const snap=await request('/api/memory/v2/snapshot','POST',{query:'喝茶',sources:[{id:'one',author:'smoke',role:'user',content:'喜欢喝茶'}]});
  assert.equal(snap.status,200);
  const input={operation_id:'http-test',snapshot_id:snap.body.snapshot_id,profile_patch:{nested:{x:0}},memory_entries:[{content:'喜欢猫咪',salience:.3}]};
  assert.equal((await request('/api/memory/v2/batches','POST',input)).status,202);
  for(let i=0;;i++) {const op=await request('/api/memory/v2/batches/http-test');if(op.body.state==='committed')break;assert.ok(i<100,logs);await new Promise(r=>setTimeout(r,50));}
  assert.equal((await request('/api/memory/v2/batches','POST',input)).status,200);
  assert.equal((await request('/api/memory/v2/batches','POST',{...input,nickname:'changed'})).status,409);
  assert.equal((await request('/api/memory/v2/batches/http-test','GET',undefined,'other')).status,404);
  assert.equal((await request('/api/memory/forget','POST',{hints:['茶']})).status,409);
  assert.equal((await request('/api/memory/search','POST',{query:'猫咪',top_k:5})).body.channels.dense.status,'ok');
  const malformed=await fetch(base+'/api/memory/write',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});
  assert.equal(malformed.status,400);
  writeFileSync(join(dir,'.r1-maintenance.json'),JSON.stringify({smoke_owner:'smoke'}));
  assert.equal((await request('/api/memory/write','POST',{content:'blocked'},'other')).status,503);
  assert.equal((await request('/api/memory/profile')).status,200);
  assert.equal((await request('/api/memory/write','POST',{content:'allowed'})).status,201);
  assert.ok(logs.includes('Nyaa be with you.'));
  assert.ok(!logs.includes('test-only-token'));
  console.log('R1 HTTP integration PASS: auth, owners, batch, replay, ready, JSON, maintenance');
} finally {
  child.kill('SIGTERM');
  await new Promise<void>(r=>child.once('exit',()=>r()));
  mock.closeAllConnections();await new Promise<void>(r=>mock.close(()=>r()));
  rmSync(dir,{recursive:true,force:true});
}

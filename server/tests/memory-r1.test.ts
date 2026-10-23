import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

// This process owns a new data directory; never use an existing application DB.
const dir=mkdtempSync(join(tmpdir(),"nyaalibrary-r1-"));
let embeddingDelay=0;
const mock=createServer((req,res)=>{
  req.resume();req.on("end",()=>{setTimeout(()=>res.end(JSON.stringify({data:[{index:0,embedding:[1,0,0]}]})),embeddingDelay);});
});
await new Promise<void>(r=>mock.listen(0,"127.0.0.1",r));
const address=mock.address() as {port:number};
Object.assign(process.env,{DATA_DIR:dir,EMBEDDING_BASE_URL:`http://127.0.0.1:${address.port}`,EMBEDDING_MODEL:"test-model",EMBEDDING_DIM:"3",MAX_RETRIES:"0"});
const {db}=await import("../src/db/index.js");
const {getProfile,writeMemory,upsertProfile,deleteExactMemory,searchMemoryDetailed,insertMemory,ftsExpression,ftsTerms}=await import("../src/services/memory.js");
const {createSnapshot,acceptBatch,processOperation,getOperation,startMemoryWorker}=await import("../src/services/memoryBatches.js");
const {mergeProfile,entrySchema,searchSchema}=await import("../src/services/memoryProtocol.js");
const {ensureMemorySpace,vectorBuffer,decodeVector}=await import("../src/services/memorySpace.js");
async function runOperation(owner:string,id:string) {
  const row=db.prepare("SELECT * FROM memory_operations WHERE owner=? AND operation_id=?").get(owner,id);
  await processOperation(row as Parameters<typeof processOperation>[0]);
}
async function snap(owner:string) {return await createSnapshot(owner,{query:"tea",sources:[{id:"msg",author:owner,role:"user",content:"please delete tea: I no longer like tea"}]}) as {snapshot_id:string};}
try {
  await db.backup(join(dir,"test-before-writes.db"));
  assert.deepEqual(decodeVector(vectorBuffer([1,0.5,-1],3),3),[1,0.5,-1]);
  assert.throws(()=>vectorBuffer([1e100,0,0],3));
  assert.throws(()=>decodeVector(Buffer.alloc(3),3));
  assert.deepEqual(mergeProfile({x:{a:1,b:2},ok:true},{x:{a:0},ok:false},["/x/b"]),{x:{a:0},ok:false});
  assert.throws(()=>mergeProfile({}, {x:0},["/x/a"]));
  assert.throws(()=>mergeProfile({},JSON.parse('{"__proto__":{}}'),[]));
  for(const salience of [-1,1.1,Infinity]) assert.equal(entrySchema.safeParse({content:"x",salience}).success,false);
  for(const top_k of [0,1.5,Infinity,51]) assert.equal(searchSchema.safeParse({query:"x",top_k}).success,false);
  assert.throws(()=>mergeProfile({}, {x:null},[]));
  ensureMemorySpace();
  // Other owners must not consume the target owner's dense candidate budget.
  db.transaction(()=>{
    for(let i=0;i<180;i++) insertMemory('noise','noise '+i,.5,[1,0,0]);
    insertMemory('target','喜欢猫咪，也喜欢喝茶',.5,[1,0,0]);
  })();
  let found=await searchMemoryDetailed('target','完全不同的语句',5);
  assert.equal(found.channels.dense.status,'ok');assert.equal(found.hits.length,1);
  assert.equal(found.hits[0].content,'喜欢猫咪，也喜欢喝茶');
  for(const query of ['猫咪','猫咪 喝茶','"猫咪" (喝茶) OR NOT','猫']) {
    const result=await searchMemoryDetailed('target',query,5);
    assert.equal(result.channels.cjk.status,'ok');assert.equal(result.hits.length,1);
  }
  assert.equal(ftsExpression(ftsTerms('" OR (猫咪)')), '"OR" OR "猫咪"');
  embeddingDelay=2500;
  found=await searchMemoryDetailed('target','猫咪',5);
  assert.ok(found.elapsed_ms<3000);assert.ok(found.degraded.some(x=>x.startsWith('dense:')));
  assert.equal(found.hits.length,1);embeddingDelay=0;
  const old=await writeMemory("a","tea",0.9);
  const same=await writeMemory("a"," tea ",0.3);assert.equal(same.id,old.id);
  assert.equal(deleteExactMemory("b",old.id),false);
  const s=await snap("a");
  const request={operation_id:"one",snapshot_id:s.snapshot_id,profile_patch:{nested:{a:0,b:false}},memory_entries:[{content:"coffee",salience:0.3}],removals:[{id:old.id,version:1,source_id:"msg",evidence:"please delete tea: I no longer like tea",reason:"retraction"}]};
  acceptBatch("a",request);assert.equal(acceptBatch("a",request).state,"pending");
  assert.throws(()=>acceptBatch("a",{...request,nickname:"changed"}));assert.equal(getOperation("b","one"),null);
  await runOperation("a","one");assert.equal(getOperation("a","one")!.state,"committed");
  assert.equal(acceptBatch("a",request).state,"committed");
  assert.equal((db.prepare("SELECT count(*) n FROM memory_entries WHERE owner_key='a'").get() as {n:number}).n,1);
  assert.equal((db.prepare("SELECT request_json FROM memory_operations WHERE operation_id='one'").get() as {request_json:null}).request_json,null);
  assert.deepEqual(JSON.parse(getProfile("a")!.profile_json),{nested:{a:0,b:false}});
  const conflict=await snap("a");upsertProfile("a",undefined,{other:1});
  assert.throws(()=>acceptBatch("a",{operation_id:"cas",snapshot_id:conflict.snapshot_id}));
  const rollback=await snap("a");
  acceptBatch("a",{operation_id:"rollback",snapshot_id:rollback.snapshot_id,profile_patch:{bad:true},memory_entries:[{content:"rollback me",salience:0.5}]});
  // A real SQLite failure after profile update must roll back profile and all indices.
  db.exec("CREATE TRIGGER fail_mem BEFORE INSERT ON memory_entries BEGIN SELECT RAISE(ABORT,'test'); END");
  await runOperation("a","rollback");assert.equal(getOperation("a","rollback")!.state,"retry_wait");
  assert.equal(JSON.parse(getProfile("a")!.profile_json).bad,undefined);
  db.exec("DROP TRIGGER fail_mem");
  db.prepare("UPDATE memory_operations SET state='processing' WHERE operation_id='rollback'").run();
  const stop=startMemoryWorker();
  for(let n=0;n<100 && getOperation("a","rollback")!.state!=="committed";n++) await new Promise(r=>setTimeout(r,50));
  await stop();assert.equal(getOperation("a","rollback")!.state,"committed");
  const count=(db.prepare("SELECT count(*) n FROM vec_mem").get() as {n:number}).n;
  db.prepare("UPDATE settings SET value='other-space' WHERE key='mem_vec_space'").run();
  assert.throws(()=>ensureMemorySpace());assert.equal((db.prepare("SELECT count(*) n FROM vec_mem").get() as {n:number}).n,count);
  // sqlite-vec DDL is transactional on the actual native extension.
  assert.throws(()=>db.transaction(()=>{db.exec("DROP TABLE vec_mem");throw Error("rollback");})());
  assert.equal((db.prepare("SELECT count(*) n FROM vec_mem").get() as {n:number}).n,count);
  assert.throws(()=>db.transaction(()=>{
    db.exec("ALTER TABLE mem_fts RENAME TO hidden_fts");
    deleteExactMemory("a",same.id);
    // same.id was already removed; exercise a current ID instead.
    const current=db.prepare("SELECT id FROM memory_entries WHERE owner_key='a' LIMIT 1").get() as {id:number};
    deleteExactMemory("a",current.id);
  })());
  assert.equal((db.prepare("SELECT count(*) n FROM vec_mem").get() as {n:number}).n,count);
  async function rebuild(activate:boolean) {
    const child=spawn(process.execPath,["--import","tsx","server/src/tools/rebuildMemoryIndex.ts",...(activate?["--activate"]:[])],{env:{...process.env,MEMORY_MAINTENANCE:"1"},stdio:["ignore","pipe","pipe"]});
    let output="";child.stdout.on("data",x=>output+=x);child.stderr.on("data",x=>output+=x);
    const code=await new Promise<number|null>(r=>child.on("exit",r));assert.equal(code,0,output);return output;
  }
  assert.match(await rebuild(false),/prepared/);
  assert.match(await rebuild(true),/activated/);
  assert.match(await rebuild(true),/"rebuilt":0/);
  assert.equal((db.prepare("SELECT count(*) n FROM vec_mem").get() as {n:number}).n,count);
  assert.equal(db.pragma("quick_check",{simple:true}),"ok");
  console.log("R1 native protocol: PASS (atomicity, idempotency, CAS, restart, owner, schema, space, vector)");
} finally {
  db.close();await new Promise<void>(r=>mock.close(()=>r()));rmSync(dir,{recursive:true,force:true});
}

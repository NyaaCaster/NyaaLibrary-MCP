import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { embedMany } from "./embedding.js";
import { getEmbeddingSettings } from "./settings.js";
import { getProfile, upsertProfile, searchMemory, insertMemory, deleteExactMemory } from "./memory.js";
import { ensureMemorySpace, vectorBuffer } from "./memorySpace.js";
import { snapshotSchema, batchSchema, hash, MemoryError, mergeProfile, type BatchRequest } from "./memoryProtocol.js";
import { maintenance } from "./memoryMaintenance.js";

type Snapshot = {id:string;owner:string;revision:number;candidates_json:string|null;sources_json:string|null};
type Operation = {owner:string;operation_id:string;request_hash:string;request_json:string|null;state:string;attempts:number;result_json:string|null;error_code:string|null;created_at:string;updated_at:string};
function revision(owner:string):number {
  return (db.prepare("SELECT revision FROM memory_owner_revisions WHERE owner=?").get(owner) as {revision:number}|undefined)?.revision ?? 0;
}
function snapshot(owner:string,id:string):Snapshot {
  const s = db.prepare("SELECT * FROM memory_snapshots WHERE owner=? AND id=?").get(owner,id) as Snapshot|undefined;
  if (!s || s.candidates_json === null || s.sources_json === null) throw new MemoryError("SNAPSHOT_UNAVAILABLE",409);
  return s;
}
export async function createSnapshot(owner:string,raw:unknown):Promise<unknown> {
  const input = snapshotSchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify(input.sources)) > 32768) throw new MemoryError("SNAPSHOT_TOO_LARGE");
  if (input.sources.some(s => s.author !== owner)) throw new MemoryError("SOURCE_OWNER_MISMATCH");
  if (new Set(input.sources.map(s => s.id)).size !== input.sources.length) throw new MemoryError("DUPLICATE_SOURCE_ID");
  const hits = await searchMemory(owner,input.query,50);
  const candidates:{id:number;version:number;content:string}[]=[];
  let bytes=0;
  for (const hit of hits) {
    const row=db.prepare("SELECT id,version,content FROM memory_entries WHERE id=? AND owner_key=?").get(hit.id,owner) as {id:number;version:number;content:string}|undefined;
    if (!row) continue;
    const size=Buffer.byteLength(row.content);
    if (bytes+size>16384) continue;
    bytes+=size;candidates.push(row);
  }
  const id=randomUUID(), rev=revision(owner), profile=getProfile(owner);
  db.prepare("INSERT INTO memory_snapshots(id,owner,revision,candidates_json,sources_json,created_at) VALUES(?,?,?,?,?,?)")
    .run(id,owner,rev,JSON.stringify(candidates),JSON.stringify(input.sources),new Date().toISOString());
  return {snapshot_id:id,profile_revision:rev,profile,candidates};
}
export function getOperation(owner:string,id:string):Record<string,unknown>|null {
  const row=db.prepare("SELECT * FROM memory_operations WHERE owner=? AND operation_id=?").get(owner,id) as Operation|undefined;
  return row ? {operation_id:row.operation_id,state:row.state,attempts:row.attempts,error_code:row.error_code,result:row.result_json ? JSON.parse(row.result_json):null,created_at:row.created_at,updated_at:row.updated_at}:null;
}
export function acceptBatch(owner:string,raw:unknown):Record<string,unknown> {
  const input=batchSchema.parse(raw), digest=hash(input);
  const prior=db.prepare("SELECT * FROM memory_operations WHERE owner=? AND operation_id=?").get(owner,input.operation_id) as Operation|undefined;
  if (prior) {
    if(prior.request_hash!==digest) throw new MemoryError("OPERATION_ID_REUSED",409);
    return getOperation(owner,input.operation_id)!;
  }
  const s=snapshot(owner,input.snapshot_id);
  if (revision(owner)!==s.revision) throw new MemoryError("PROFILE_REVISION_CONFLICT",409);
  mergeProfile(JSON.parse(getProfile(owner)?.profile_json??"{}"),input.profile_patch,input.delete_paths);
  if(input.parent_id) {
    const parent=getOperation(owner,input.parent_id);
    if(!parent || parent.state!=="parked") throw new MemoryError("PARENT_NOT_CONFIRMED_UNCOMMITTED",409);
  }
  const now=new Date().toISOString();
  db.prepare("INSERT INTO memory_operations(owner,operation_id,parent_id,request_hash,request_json,state,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?)")
    .run(owner,input.operation_id,input.parent_id??null,digest,JSON.stringify(input),now,now);
  return getOperation(owner,input.operation_id)!;
}
export async function processOperation(row:Operation):Promise<void> {
  const input=JSON.parse(row.request_json!) as BatchRequest;
  db.prepare("UPDATE memory_operations SET state='processing',attempts=attempts+1,updated_at=? WHERE owner=? AND operation_id=?")
    .run(new Date().toISOString(),row.owner,row.operation_id);
  try {
    const space=input.memory_entries.length ? ensureMemorySpace():null;
    const vectors=await embedMany(input.memory_entries.map(e=>e.content));
    vectors.forEach(v=>vectorBuffer(v,getEmbeddingSettings().dim));
    if(vectors.length!==input.memory_entries.length) throw new MemoryError("INVALID_EMBEDDING",502);
    db.transaction(()=>{
      const s=snapshot(row.owner,input.snapshot_id);
      if(revision(row.owner)!==s.revision) throw new MemoryError("PROFILE_REVISION_CONFLICT",409);
      if(space && ensureMemorySpace()!==space) throw new MemoryError("MEMORY_SPACE_CHANGED",409);
      const candidates=JSON.parse(s.candidates_json!) as {id:number;version:number;content:string}[];
      const sources=JSON.parse(s.sources_json!) as {id:string;author:string;content:string}[];
      const approved:number[]=[],ignored:number[]=[];
      for(const removal of input.removals) {
        const candidate=candidates.find(c=>c.id===removal.id && c.version===removal.version);
        const source=sources.find(c=>c.id===removal.source_id && c.author===row.owner);
        // Conservative evidence gate: a verbatim user correction/retraction, never similarity alone.
        if(!candidate || !source || !source.content.includes(removal.evidence) || !removal.evidence.includes(candidate.content) || !/(不再|不是|不喜欢|改为|改成|更正|纠正|撤回|忘掉|删除|不要记|现在|no longer|not |instead|correction|forget|delete)/iu.test(removal.evidence)) {ignored.push(removal.id);continue;}
        const current=db.prepare("SELECT version FROM memory_entries WHERE owner_key=? AND id=?").get(row.owner,removal.id) as {version:number}|undefined;
        if(!current || current.version!==removal.version) throw new MemoryError("ENTRY_VERSION_CONFLICT",409);
        approved.push(removal.id);
      }
      const merged=mergeProfile(JSON.parse(getProfile(row.owner)?.profile_json??"{}"),input.profile_patch,input.delete_paths);
      if(Object.keys(input.profile_patch).length || input.delete_paths.length || input.nickname!==undefined) upsertProfile(row.owner,input.nickname,merged,"replace");
      // Delete only pre-existing validated IDs, before insert, inside this same rollback boundary.
      for(const id of approved) deleteExactMemory(row.owner,id);
      const ids=input.memory_entries.map((e,i)=>insertMemory(row.owner,e.content,e.salience,vectors[i]));
      const result={ids,deleted:approved.length,ignored_removals:ignored};
      db.prepare("UPDATE memory_operations SET state='committed',request_json=NULL,result_json=?,error_code=NULL,updated_at=? WHERE owner=? AND operation_id=?")
        .run(JSON.stringify(result),new Date().toISOString(),row.owner,row.operation_id);
      db.prepare("UPDATE memory_snapshots SET candidates_json=NULL,sources_json=NULL WHERE id=? AND owner=?").run(input.snapshot_id,row.owner);
    })();
  } catch(error) {
    const code=error instanceof MemoryError ? error.code : "DEPENDENCY_OR_INDEX_FAILURE";
    const terminal=(error instanceof MemoryError && error.status===409) || row.attempts+1>=5;
    const delay=[5000,15000,45000,120000][Math.min(row.attempts,3)]+Math.floor(Math.random()*1000);
    db.prepare("UPDATE memory_operations SET state=?,error_code=?,next_attempt=?,updated_at=? WHERE owner=? AND operation_id=?")
      .run(terminal?"parked":"retry_wait",code,Date.now()+delay,new Date().toISOString(),row.owner,row.operation_id);
    console.warn("[memory-batch]",row.operation_id,terminal?"parked":"retry_wait",code);
  }
}
export function operationMetrics():unknown {
  return db.prepare("SELECT state,count(*) count,min(created_at) oldest FROM memory_operations GROUP BY state").all();
}
export function retryOperation(owner:string,id:string):boolean {
  return db.prepare("UPDATE memory_operations SET state='pending',attempts=0,error_code=NULL,next_attempt=0 WHERE owner=? AND operation_id=? AND state='parked'").run(owner,id).changes>0;
}
export function startMemoryWorker():()=>Promise<void> {
  db.prepare("UPDATE memory_operations SET state='pending' WHERE state='processing'").run();
  let stopping=false;
  const active=new Map<string,Promise<void>>();
  function tick():void {
    if(stopping) return;
    const mode=maintenance();
    const rows=db.prepare("SELECT * FROM memory_operations WHERE state IN ('pending','retry_wait') AND next_attempt<=? ORDER BY created_at LIMIT 100").all(Date.now()) as Operation[];
    for(const row of rows) {
      if(mode.active && row.owner!==mode.smokeOwner) continue;
      if(active.size>=2) break;
      if(active.has(row.owner)) continue;
      const task=processOperation(row).catch(()=>console.error("[memory-batch] worker persistence failure")).finally(()=>active.delete(row.owner));
      active.set(row.owner,task);
    }
  }
  const timer=setInterval(tick,500);timer.unref();tick();
  return async()=>{stopping=true;clearInterval(timer);await Promise.allSettled(active.values());};
}

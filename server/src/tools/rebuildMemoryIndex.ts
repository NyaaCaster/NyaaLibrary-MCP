/** Explicit maintenance only. Preparation never activates a new vector space. */
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { db, memVecTableExists } from "../db/index.js";
import { config } from "../config.js";
import { getEmbeddingSettings } from "../services/settings.js";
import { embedMany } from "../services/embedding.js";
import { configuredSpace, vectorBuffer } from "../services/memorySpace.js";
import { hash, MemoryError } from "../services/memoryProtocol.js";
import { maintenance } from "../services/memoryMaintenance.js";
import { bigram } from "../utils/bigram.js";

const artifactPath=resolve(process.env.MEMORY_INDEX_ARTIFACT ?? resolve(config.dataDir,"memory-index-r1.db"));
const exists=existsSync(artifactPath);
const artifact=new Database(artifactPath);
try {
if(exists) await artifact.backup(`${artifactPath}.pre-${Date.now()}.db`);
artifact.exec("CREATE TABLE IF NOT EXISTS vectors(id INTEGER PRIMARY KEY,content_hash TEXT NOT NULL,version INTEGER NOT NULL,space TEXT NOT NULL,embedding BLOB NOT NULL)");
const space=configuredSpace(),dim=getEmbeddingSettings().dim;
const activate=process.argv.includes("--activate");
if(activate && !maintenance().active) throw new MemoryError("MAINTENANCE_REQUIRED",409);
await db.backup(resolve(config.dataDir,`library-before-index-${Date.now()}.db`));
let cursor=0,rebuilt=0,failures=0;
while(true) {
  const rows=db.prepare("SELECT id,content,version FROM memory_entries WHERE id>? ORDER BY id LIMIT 2").all(cursor) as {id:number;content:string;version:number}[];
  if(!rows.length) break;
  for(const row of rows) {
    const prior=artifact.prepare("SELECT content_hash,version,space FROM vectors WHERE id=?").get(row.id) as {content_hash:string;version:number;space:string}|undefined;
    if(prior?.content_hash===hash(row.content) && prior.version===row.version && prior.space===space) {cursor=row.id;continue;}
    let done=false;
    while(!done) {
      try {
        const [vector]=await embedMany([row.content]);
        artifact.prepare("INSERT INTO vectors(id,content_hash,version,space,embedding) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content_hash=excluded.content_hash,version=excluded.version,space=excluded.space,embedding=excluded.embedding")
          .run(row.id,hash(row.content),row.version,space,vectorBuffer(vector,dim));
        failures=0;done=true;rebuilt++;cursor=row.id;
        if(rebuilt%50===0) console.log(JSON.stringify({stage:"prepare",cursor,rebuilt}));
      } catch {
        if(++failures>=5) throw new MemoryError("INDEX_PREPARATION_PAUSED",503);
        await new Promise(r=>setTimeout(r,1000));
      }
    }
  }
}
if(activate) {
  // No concurrent writer is allowed during activation. The caller stops AstrBot
  // and the old Library before invoking this command under maintenance.
  db.transaction(()=>{
    const rows=db.prepare("SELECT id,content,version FROM memory_entries ORDER BY id").all() as {id:number;content:string;version:number}[];
    const vectors=rows.map(row=>{
      const v=artifact.prepare("SELECT * FROM vectors WHERE id=? AND space=? AND version=? AND content_hash=?").get(row.id,space,row.version,hash(row.content)) as {embedding:Buffer}|undefined;
      if(!v || v.embedding.length!==dim*4) throw new MemoryError("SHADOW_INDEX_VERIFICATION_FAILED",409);
      return {id:row.id,embedding:v.embedding,content:row.content};
    });
    if(memVecTableExists()) {
      db.exec("CREATE TABLE IF NOT EXISTS memory_vector_archive(generation TEXT NOT NULL,id INTEGER NOT NULL,embedding BLOB NOT NULL,PRIMARY KEY(generation,id))");
      const generation=`legacy-${Date.now()}`;
      db.prepare("INSERT INTO memory_vector_archive SELECT ?,rowid,embedding FROM vec_mem").run(generation);
      db.exec("DROP TABLE vec_mem");
    }
    db.exec(`CREATE VIRTUAL TABLE vec_mem USING vec0(embedding float[${dim}])`);
    db.exec("DELETE FROM mem_fts; DELETE FROM mem_fts_cjk;");
    for(const row of vectors) {
      db.prepare("INSERT INTO vec_mem(rowid,embedding) VALUES(?,?)").run(BigInt(row.id),row.embedding);
      db.prepare("INSERT INTO mem_fts(rowid,content) VALUES(?,?)").run(row.id,row.content);
      db.prepare("INSERT INTO mem_fts_cjk(rowid,content) VALUES(?,?)").run(row.id,bigram(row.content));
    }
    for(const [key,value] of [["mem_vec_dim",String(dim)],["mem_vec_space",space]])
      db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,value);
    for(const table of ["vec_mem","mem_fts","mem_fts_cjk"]) {
      const count=(db.prepare(`SELECT count(*) n FROM ${table}`).get() as {n:number}).n;
      if(count!==rows.length) throw new MemoryError("INDEX_COUNT_MISMATCH",409);
      const missing=db.prepare(`SELECT m.id FROM memory_entries m LEFT JOIN ${table} v ON v.rowid=m.id WHERE v.rowid IS NULL LIMIT 1`).get();
      if(missing) throw new MemoryError("INDEX_ROWID_MISMATCH",409);
    }
  })();
}
console.log(JSON.stringify({stage:activate?"activated":"prepared",cursor,rebuilt,space}));
} finally { artifact.close();db.close(); }

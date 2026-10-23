import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";

export function maintenance(): {active:boolean;smokeOwner?:string} {
  if(process.env.MEMORY_MAINTENANCE==="1") return {active:true};
  const file=resolve(config.dataDir,".r1-maintenance.json");
  if(!existsSync(file)) return {active:false};
  try {
    const input=JSON.parse(readFileSync(file,"utf8"));
    return {active:true,smokeOwner:typeof input.smoke_owner==="string"?input.smoke_owner:undefined};
  } catch {return {active:true};}
}

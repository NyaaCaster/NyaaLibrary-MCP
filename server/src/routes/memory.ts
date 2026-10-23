import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireMemoryAuth, requireSenderId } from "../auth/memory.js";
import { getProfile, upsertProfile, writeMemory, searchMemoryDetailed, forgetMemories } from "../services/memory.js";
import { createSnapshot, acceptBatch, getOperation } from "../services/memoryBatches.js";
import { searchSchema, entrySchema, MemoryError, validateProfile } from "../services/memoryProtocol.js";
import { config } from "../config.js";

export const memoryRouter = Router();
memoryRouter.use(requireMemoryAuth, requireSenderId);
const owner = (r: Request): string => (r as Request & {ownerKey:string}).ownerKey;
const safe = (fn:(r:Request,s:Response)=>unknown) => (r:Request,s:Response,n:NextFunction):void => {Promise.resolve().then(()=>fn(r,s)).catch(n);};
export const legacyProfileSchema = z.object({nickname:z.string().max(200).optional(),profile_patch:z.record(z.unknown()).optional(),merge_mode:z.enum(["merge","replace"]).default("merge")}).strict();
memoryRouter.get("/profile",safe((req,res)=>{
  const profile=getProfile(owner(req));
  return profile ? res.json(profile):res.status(404).json({error:"未找到画像",code:"PROFILE_NOT_FOUND"});
}));
memoryRouter.put("/profile",safe((req,res)=>{
  const input=legacyProfileSchema.parse(req.body);
  if(input.profile_patch!==undefined) validateProfile(input.profile_patch);
  return res.json(upsertProfile(owner(req),input.nickname,input.profile_patch,input.merge_mode));
}));
memoryRouter.post("/write",safe(async(req,res)=>{
  const input=entrySchema.parse(req.body);
  return res.status(201).json(await writeMemory(owner(req),input.content,input.salience));
}));
memoryRouter.post("/search",safe(async(req,res)=>{
  const input=searchSchema.parse(req.body);
  return res.json(await searchMemoryDetailed(owner(req),input.query,input.top_k??Math.min(50,config.retrieval.topK)));
}));
memoryRouter.post("/forget",safe((req,_res)=>forgetMemories(owner(req),[])));
memoryRouter.post("/v2/snapshot",safe(async(req,res)=>res.json(await createSnapshot(owner(req),req.body))));
memoryRouter.post("/v2/batches",safe((req,res)=>{
  const result=acceptBatch(owner(req),req.body);
  return res.status(result.state==="committed"?200:202).json(result);
}));
memoryRouter.get("/v2/batches/:id",safe((req,res)=>{
  const result=getOperation(owner(req),req.params.id);
  if(!result) throw new MemoryError("OPERATION_NOT_FOUND",404);
  return res.json(result);
}));

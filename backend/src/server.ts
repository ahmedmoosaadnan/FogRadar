import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {Server as SocketServer, Socket} from 'socket.io';
import {createClient} from 'redis';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {bearingDegrees,headingDelta,isAhead,metersBetween} from './geo.js';
import {issueToken,verifyToken} from './security.js';
import {buildDeterministicInsights,normalizeRouteParam,requestLlmInsights,type InsightsResponse} from './insights.js';

const secret=(process.env.TOKEN_SECRET||process.env.SESSION_SECRET)??'';
if(secret.length<32 || secret.startsWith('CHANGE_ME'))throw new Error('Set a random 32+ character TOKEN_SECRET (or SESSION_SECRET) environment variable');
const redisUrl=process.env.REDIS_URL;
if(!redisUrl)throw new Error('REDIS_URL environment variable is required');
const rawDbUrl=process.env.DATABASE_URL;
if(!rawDbUrl)throw new Error('DATABASE_URL environment variable is required');
const port=Number(process.env.PORT||4000);
const corsOrigin=!process.env.CORS_ORIGIN||process.env.CORS_ORIGIN==='*'?true:process.env.CORS_ORIGIN.split(',').map(s=>s.trim());
const app=Fastify({logger:true,bodyLimit:16*1024});
await app.register(cors,{origin:corsOrigin});
const redis=createClient({
 url:redisUrl,
 ...(redisUrl.startsWith('rediss://')?{socket:{tls:true}}:{}),
});
redis.on('error',e=>app.log.error(e,'Redis error'));
await redis.connect();
const isLocalDb=/@(localhost|127\.0\.0\.1|db)(:|\/|$)/i.test(rawDbUrl)||/sslmode=disable/i.test(rawDbUrl);
const dbUrl=/sslmode=/i.test(rawDbUrl)&&!/uselibpqcompat=/i.test(rawDbUrl)?`${rawDbUrl}${rawDbUrl.includes('?')?'&':'?'}uselibpqcompat=true`:rawDbUrl;
const pool=new pg.Pool({
 connectionString:dbUrl,
 max:10,
 ...(!isLocalDb||process.env.DATABASE_SSL==='true'?{ssl:{rejectUnauthorized:false}}:{}),
});
await pool.query('SELECT postgis_version()'); // Fail fast when DB isn't ready.
const io=new SocketServer(app.server,{cors:{origin:corsOrigin},transports:['websocket','polling'],maxHttpBufferSize:16*1024});
const routes=new Set(['M-1 Motorway','M-2 Motorway','M-3 Motorway','M-4 Motorway','M-5 Motorway','M-9 Motorway']);
const hazardTypes=new Set(['Stopped traffic','Accident','Heavy fog','Vehicle breakdown']);
const GEO_KEY='fog:live:geo',ACTIVE_KEY='fog:live:active';
type Fix={latitude:number;longitude:number;speedKmh:number|null;heading:number|null;accuracyMeters:number;timestamp:number;route:string;seenAt:number};
type AuthedSocket=Socket & {data:{vehicleId:string;lastReportAt?:number}};
const sessionLimit=new Map<string,{count:number;until:number}>();
const insightsCache=new Map<string,InsightsResponse>();
app.get('/health',async()=>({ok:true,service:'FogRadar MVP',phase:'FIELD-TEST-ONLY',time:Date.now()}));
app.get('/v1/insights',async(req)=>{
 const query=(req.query&&typeof req.query==='object'?req.query:{}) as {route?:unknown};
 const route=normalizeRouteParam(query.route);
 const now=Date.now();
 const cached=insightsCache.get(route);
 if(cached && now-cached.generatedAt<60_000)return cached;
 try{
  const [dbRes,activeIds]=await Promise.all([
   pool.query<{type:string;latitude:number;longitude:number;report_count:number;created_at:Date}>(
    `SELECT type,latitude,longitude,report_count,created_at FROM hazards
     WHERE route=$1 AND status='corroborated' AND expires_at>NOW()
     ORDER BY created_at DESC LIMIT 20`,
    [route]
   ),
   redis.zRangeByScore(ACTIVE_KEY,now-12_000,'+inf',{LIMIT:{offset:0,count:200}}),
  ]);
  let liveVehicles=0;
  if(activeIds.length){
   const records=await redis.mGet(activeIds.map(id=>`fog:live:vehicle:${id}`));
   for(const raw of records){
    if(!raw)continue;
    try{
     const fix=JSON.parse(raw) as Fix;
     if(now-fix.seenAt<=12_000 && fix.route===route)liveVehicles+=1;
    }catch{ /* ignore malformed ephemeral entries */ }
   }
  }
  const hazards=dbRes.rows.map(r=>({
   type:r.type,
   latitude:Number(r.latitude),
   longitude:Number(r.longitude),
   ageMinutes:Math.max(1,Math.round((now-new Date(r.created_at).getTime())/60_000)),
   reportCount:Number(r.report_count),
  }));
  const result=await requestLlmInsights({route,liveVehicles,hazards},process.env.LLM_API_KEY,process.env.LLM_MODEL,now);
  insightsCache.set(route,result);
  return result;
 }catch(e){
  app.log.warn(e,'Insights generation fell back to deterministic template');
  const fallback=buildDeterministicInsights({route,liveVehicles:0,hazards:[]},now);
  return fallback;
 }
});
app.post('/v1/session',async(req,reply)=>{
 const ip=req.ip,now=Date.now(),entry=sessionLimit.get(ip);
 if(entry&&entry.until>now&&entry.count>=15)return reply.code(429).send({error:'Too many sessions. Try later.'});
 sessionLimit.set(ip,{count:entry&&entry.until>now?entry.count+1:1,until:now+60_000});
 const info=issueToken(secret);
 return {...info,warning:'EXPERIMENTAL DATA: NOT AN APPROVED ROAD SAFETY SERVICE'};
});
const validNum=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
function parseFix(raw:unknown):Fix|null{
 if(!raw || typeof raw!=='object')return null;
 const x=raw as Record<string,unknown>,now=Date.now();
 if(!validNum(x.latitude,-90,90)||!validNum(x.longitude,-180,180)||!validNum(x.accuracyMeters,0,2500)||!validNum(x.timestamp,now-15_000,now+5000)||typeof x.route!=='string'||!routes.has(x.route))return null;
 if(x.speedKmh!==null&&!validNum(x.speedKmh,0,220))return null;
 if(x.heading!==null&&!validNum(x.heading,0,360))return null;
 return {latitude:x.latitude,longitude:x.longitude,accuracyMeters:x.accuracyMeters,timestamp:x.timestamp,route:x.route,speedKmh:x.speedKmh as number|null,heading:x.heading as number|null,seenAt:now};
}
async function getFix(id:string):Promise<Fix|null>{
 const data=await redis.get(`fog:live:vehicle:${id}`);
 if(!data)return null;
 try {const fix=JSON.parse(data) as Fix;return Date.now()-fix.seenAt<=12_000?fix:null;}catch{return null;}
}
async function putFix(id:string,fix:Fix){
 const updates=redis.multi();
 updates.geoAdd(GEO_KEY,{longitude:fix.longitude,latitude:fix.latitude,member:id});
 updates.set(`fog:live:vehicle:${id}`,JSON.stringify(fix),{EX:20});
 updates.zAdd(ACTIVE_KEY,{score:fix.seenAt,value:id});
 await updates.exec();
}
async function removeFix(id:string){
 await redis.multi().zRem(GEO_KEY,id).zRem(ACTIVE_KEY,id).del(`fog:live:vehicle:${id}`).exec();
}
async function nearby(id:string,own:Fix){
 const ids=(await redis.sendCommand(['GEOSEARCH',GEO_KEY,'FROMLONLAT',String(own.longitude),String(own.latitude),'BYRADIUS','1000','m','COUNT','150'])) as string[];
 const others=ids.filter(v=>v!==id);
 if(!others.length)return [];
 const records=await redis.mGet(others.map(v=>`fog:live:vehicle:${v}`));
 const visible: Array<{id:string;distanceMeters:number;bearing:number;speedKmh:number|null;heading:number|null;accuracyMeters:number;ageMs:number}>=[];
 records.forEach((raw,index)=>{
  if(!raw)return;
  try{const v=JSON.parse(raw) as Fix,age=Date.now()-v.seenAt;
   if(age>12_000 || v.route!==own.route)return;
   const distance=metersBetween(own,v);
   if(distance>1000)return;
   visible.push({id:others[index],distanceMeters:Math.round(distance),bearing:Math.round(bearingDegrees(own,v)),speedKmh:v.speedKmh,heading:v.heading,accuracyMeters:v.accuracyMeters,ageMs:age});
  }catch{ /* ignore corrupted ephemeral entries */ }
 });
 return visible.sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,80);
}
type HazardRow={id:string;type:string;route:string;latitude:number;longitude:number;heading:number;report_count:number;expires_at:Date};
async function hazardsAhead(own:Fix){
 const rows=await pool.query<HazardRow>(`SELECT id,type,route,latitude,longitude,heading,report_count,expires_at
 FROM hazards WHERE route=$1 AND status='corroborated' AND expires_at>NOW()
 AND ST_DWithin(position,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,1000)
 ORDER BY created_at DESC LIMIT 30`,[own.route,own.longitude,own.latitude]);
 return rows.rows.filter(v=>own.heading===null?true:isAhead({...own,heading:own.heading},v)).map(v=>({
   id:v.id,type:v.type,distanceMeters:Math.round(metersBetween(own,v)),reportCount:v.report_count,
   expiresAt:new Date(v.expires_at).getTime(),status:'corroborated-experimental' as const,
 })).sort((a,b)=>a.distanceMeters-b.distanceMeters);
}
async function snapshot(socket:AuthedSocket){
 const own=await getFix(socket.data.vehicleId);
 if(!own){socket.emit('radar:snapshot',{vehicles:[],serverTime:Date.now()});socket.emit('hazards:snapshot',{hazards:[],serverTime:Date.now()});return;}
 const [vehicles,hazards]=await Promise.all([nearby(socket.data.vehicleId,own),hazardsAhead(own)]);
 if(socket.connected){socket.emit('radar:snapshot',{vehicles,serverTime:Date.now()});socket.emit('hazards:snapshot',{hazards,serverTime:Date.now()});}
}
type Ack=(response:{ok:boolean;error?:string;id?:string;status?:string;reportCount?:number})=>void;
async function reportHazard(socket:AuthedSocket,body:unknown){
 if(!body||typeof body!=='object'||!hazardTypes.has((body as {type?:string}).type??''))throw Error('Invalid hazard type');
 const type=(body as {type:string}).type;
 const current=await getFix(socket.data.vehicleId);
 if(!current || current.accuracyMeters>2500 || Date.now()-current.timestamp>15_000)throw Error('Recent GPS fix required');
 const heading=current.heading??0;
 if(socket.data.lastReportAt && Date.now()-socket.data.lastReportAt<60_000)throw Error('Please wait before reporting again');
 // Single-person reports are never sent as critical warnings. A second distinct trip is necessary.
 const client=await pool.connect();
 let outcome:{id:string;status:string;reportCount:number};
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[current.route]);
  const existing=await client.query<HazardRow>(`SELECT h.id,h.report_count,h.status FROM hazards h
    WHERE h.route=$1 AND h.type=$2 AND h.expires_at>NOW()
      AND ABS(MOD((h.heading-$3+540)::numeric,360)-180)<45
      AND ST_DWithin(h.position,ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,150)
    ORDER BY h.created_at DESC LIMIT 1`,[current.route,type,heading,current.longitude,current.latitude]);
  if(existing.rows.length){
   const id=existing.rows[0].id;
   const inserted=await client.query(`INSERT INTO hazard_reports(hazard_id,reporter_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING hazard_id`,[id,socket.data.vehicleId]);
   if(!inserted.rowCount)throw Error('This trip already reported this hazard');
   const updated=await client.query<{report_count:number;status:string}>(`UPDATE hazards SET report_count=report_count+1,
      status=CASE WHEN report_count+1>=2 THEN 'corroborated' ELSE 'candidate' END
      WHERE id=$1 RETURNING report_count,status`,[id]);
   outcome={id,reportCount:updated.rows[0].report_count,status:updated.rows[0].status};
  }else{
   const id=randomUUID(),ttl=type==='Stopped traffic'?8:15;
   await client.query(`INSERT INTO hazards(id,type,route,heading,position,latitude,longitude,expires_at)
    VALUES($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326)::geography,$6,$5,NOW()+($7::int*INTERVAL '1 minute'))`,[id,type,current.route,heading,current.longitude,current.latitude,ttl]);
   await client.query('INSERT INTO hazard_reports(hazard_id,reporter_id) VALUES($1,$2)',[id,socket.data.vehicleId]);
   outcome={id,reportCount:1,status:'candidate'};
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 socket.data.lastReportAt=Date.now();
 if(outcome.status==='corroborated'){
  // Push fresh relevance-filtered advisory snapshots to active participants, not raw reports.
  void Promise.allSettled([...io.sockets.sockets.values()].map(s=>snapshot(s as AuthedSocket)));
 }
 return outcome;
}
io.use((socket,next)=>{
 const claims=verifyToken(secret,socket.handshake.auth?.token);
 if(!claims)return next(new Error('Invalid or expired journey session'));
 socket.data.vehicleId=claims.sub;
 next();
});
io.on('connection',base=>{
 const socket=base as AuthedSocket;
 socket.on('telemetry:update',async(raw:unknown,ack?:Ack)=>{
  try{
   const fix=parseFix(raw);if(!fix){ack?.({ok:false,error:'Invalid GPS data or age/accuracy'});return;}
   const previous=await getFix(socket.data.vehicleId);
   if(previous && fix.timestamp<=previous.timestamp){ack?.({ok:false,error:'Out-of-order update'});return;}
   if(previous && fix.timestamp-previous.timestamp<500){ack?.({ok:false,error:'Update rate exceeded'});return;}
   if(previous && fix.timestamp-previous.timestamp<20_000 && metersBetween(fix,previous)/Math.max(0.5,(fix.timestamp-previous.timestamp)/1000)>75){ack?.({ok:false,error:'GPS jump rejected'});return;}
   await putFix(socket.data.vehicleId,fix);
   ack?.({ok:true});await snapshot(socket);
  }catch(e){app.log.error(e);ack?.({ok:false,error:'Server processing failed'});}
 });
 socket.on('hazard:report',async(body:unknown,ack?:Ack)=>{
  try{const r=await reportHazard(socket,body);ack?.({ok:true,...r});}
  catch(e){ack?.({ok:false,error:e instanceof Error?e.message:'Report rejected'});}
 });
 socket.on('disconnect',()=>{void removeFix(socket.data.vehicleId).catch(e=>app.log.error(e));});
});
// Redis GEO is an index, not a TTL structure. Purge stale members periodically.
// Small field-test cohort only: refresh every connected phone's snapshot every 2 seconds.
// A production rollout must replace this O(N²) polling with geo-sharded fan-out.
const refresh=setInterval(()=>{
 const sockets=[...io.sockets.sockets.values()].slice(0,30);
 void Promise.allSettled(sockets.map(s=>snapshot(s as AuthedSocket))).catch(e=>app.log.error(e));
},2000);
const sweep=setInterval(async()=>{
 try{const ids=await redis.zRangeByScore(ACTIVE_KEY,0,Date.now()-20_000,{LIMIT:{offset:0,count:500}});
  if(ids.length){const tx=redis.multi();for(const id of ids){tx.zRem(ACTIVE_KEY,id);tx.zRem(GEO_KEY,id);tx.del(`fog:live:vehicle:${id}`);}await tx.exec();}
  for(const [ip,v] of sessionLimit)if(v.until<Date.now())sessionLimit.delete(ip);
 }catch(e){app.log.error(e,'Stale position sweep failed');}
},10_000);
await app.listen({port,host:process.env.HOST||'0.0.0.0'});
const shutdown=async()=>{clearInterval(refresh);clearInterval(sweep);await new Promise<void>(resolve=>io.close(()=>resolve()));await app.close();await redis.quit();await pool.end();process.exit(0);};
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());

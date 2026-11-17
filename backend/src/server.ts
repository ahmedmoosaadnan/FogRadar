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
import {
 computePairwiseRoadDistance,
 detectDirectionWithHysteresis,
 extractUpcomingRoadShape,
 snapFixToSegments,
 type MotorwaySegmentRecord,
 type RoadDirection,
 type RoadShapePoint,
} from './roadMatching.js';

const secret=(process.env.TOKEN_SECRET||process.env.SESSION_SECRET)??'';
if(secret.length<32 || secret.startsWith('CHANGE_ME'))throw new Error('Set a random 32+ character TOKEN_SECRET (or SESSION_SECRET) environment variable');
const redisUrl=process.env.REDIS_URL;
if(!redisUrl)throw new Error('REDIS_URL environment variable is required');
const rawDbUrl=process.env.DATABASE_URL;
if(!rawDbUrl)throw new Error('DATABASE_URL environment variable is required');
const port=Number(process.env.PORT||4000);
const corsOrigin=!process.env.CORS_ORIGIN||process.env.CORS_ORIGIN==='*'?true:process.env.CORS_ORIGIN.split(',').map(s=>s.trim());
const app=Fastify({logger:{level:process.env.LOG_LEVEL||'info'},bodyLimit:16*1024});
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
const io=new SocketServer(app.server,{cors:{origin:corsOrigin},transports:['websocket'],perMessageDeflate:false,pingInterval:10_000,pingTimeout:5_000,maxHttpBufferSize:16*1024});
const routes=new Set(['M-1 Motorway','M-2 Motorway','M-3 Motorway','M-4 Motorway','M-5 Motorway','M-9 Motorway']);
const hazardTypes=new Set(['Stopped traffic','Accident','Heavy fog','Vehicle breakdown']);
const GEO_KEY='fog:live:geo',ACTIVE_KEY='fog:live:active';
type Fix={
 latitude:number;longitude:number;speedKmh:number|null;heading:number|null;accuracyMeters:number;
 timestamp:number;fixTime:number;route:string;seenAt:number;
 matched?:boolean;segmentId?:number|null;chainageMeters?:number|null;offsetMeters?:number|null;roadDirection?:RoadDirection;
};
type AuthedSocket=Socket & {data:{vehicleId:string;lastReportAt?:number;lastSnapshotAt?:number;route?:string}};
const sessionLimit=new Map<string,{count:number;until:number}>();
type CachedInsights={response:InsightsResponse;liveVehicles:number;hazardSig:string;isLlm:boolean};
const insightsCache=new Map<string,CachedInsights>();
const insightsInFlight=new Set<string>();

function pushInsightsToRoute(route:string,payload:InsightsResponse){
 for(const base of io.sockets.sockets.values()){
  const s=base as AuthedSocket;
  if(s.connected && s.data.route===route){
   s.emit('insights:update',payload);
  }
 }
}

async function gatherRouteInsights(route:string,now=Date.now()){
 const [dbRes,activeIds]=await Promise.all([
  pool.query<{id:string;type:string;latitude:number;longitude:number;report_count:number;created_at:Date}>(
   `SELECT id,type,latitude,longitude,report_count,created_at FROM hazards
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
 const hazardSig=dbRes.rows.map(r=>`${r.id}:${r.report_count}`).join('|');
 return {liveVehicles,hazards,hazardSig};
}

function triggerLlmRefresh(
 route:string,
 data:{route:string;liveVehicles:number;hazards:Array<{type:string;latitude:number;longitude:number;ageMinutes:number;reportCount:number}>},
 hazardSig:string
){
 if(insightsInFlight.has(route))return;
 if((data.liveVehicles===0 && data.hazards.length===0)||!process.env.LLM_API_KEY||!process.env.LLM_MODEL)return;
 insightsInFlight.add(route);
 void requestLlmInsights(data,process.env.LLM_API_KEY,process.env.LLM_MODEL,Date.now())
  .then(llmRes=>{
   const latest=insightsCache.get(route);
   if(latest && latest.hazardSig===hazardSig && Math.abs(latest.liveVehicles-data.liveVehicles)<=1){
    insightsCache.set(route,{response:llmRes,liveVehicles:data.liveVehicles,hazardSig,isLlm:true});
    pushInsightsToRoute(route,llmRes);
   }
  })
  .catch(()=>{ /* deterministic summary is already cached and served */ })
  .finally(()=>{insightsInFlight.delete(route);});
}

async function getOrComputeInsights(route:string):Promise<InsightsResponse>{
 const now=Date.now();
 try{
  const {liveVehicles,hazards,hazardSig}=await gatherRouteInsights(route,now);
  const cached=insightsCache.get(route);
  const valid=
   cached &&
   now-cached.response.generatedAt<10_000 &&
   Math.abs(liveVehicles-cached.liveVehicles)<=1 &&
   cached.hazardSig===hazardSig;
  if(valid)return cached.response;

  const deterministic=buildDeterministicInsights({route,liveVehicles,hazards},now);
  insightsCache.set(route,{response:deterministic,liveVehicles,hazardSig,isLlm:false});
  triggerLlmRefresh(route,{route,liveVehicles,hazards},hazardSig);
  return deterministic;
 }catch(e){
  app.log.warn(e,'Insights generation fell back to deterministic template');
  return buildDeterministicInsights({route,liveVehicles:0,hazards:[]},now);
 }
}

async function invalidateAndPushInsights(route:string){
 insightsCache.delete(route);
 const payload=await getOrComputeInsights(route);
 pushInsightsToRoute(route,payload);
}

app.get('/health',async()=>({ok:true,service:'FogRadar MVP',phase:'FIELD-TEST-ONLY',time:Date.now()}));
app.get('/v1/insights',async(req)=>{
 const query=(req.query&&typeof req.query==='object'?req.query:{}) as {route?:unknown};
 const route=normalizeRouteParam(query.route);
 return getOrComputeInsights(route);
});
app.post('/v1/session',async(req,reply)=>{
 const ip=req.ip,now=Date.now(),entry=sessionLimit.get(ip);
 if(entry&&entry.until>now&&entry.count>=15)return reply.code(429).send({error:'Too many sessions. Try later.'});
 sessionLimit.set(ip,{count:entry&&entry.until>now?entry.count+1:1,until:now+60_000});
 const info=issueToken(secret);
 return {...info,warning:'EXPERIMENTAL DATA: NOT AN APPROVED ROAD SAFETY SERVICE'};
});
const validNum=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
function normalizeRoute(raw:unknown):string|null{
 if(typeof raw!=='string')return null;
 const trimmed=raw.trim();
 if(routes.has(trimmed))return trimmed;
 const shortMatch=/^(M-[123459])(?:\s+Motorway)?$/i.exec(trimmed);
 if(shortMatch){
  const canonical=`${shortMatch[1].toUpperCase()} Motorway`;
  if(routes.has(canonical))return canonical;
 }
 return null;
}
function parseFix(raw:unknown):Fix|null{
 if(!raw || typeof raw!=='object')return null;
 const x=raw as Record<string,unknown>,now=Date.now();
 const route=normalizeRoute(x.route);
 if(!validNum(x.latitude,-90,90)||!validNum(x.longitude,-180,180)||!validNum(x.accuracyMeters,0,50000)||!validNum(x.timestamp,now-300_000,now+300_000)||!route)return null;
 if(x.speedKmh!==null&&!validNum(x.speedKmh,0,220))return null;
 if(x.heading!==null&&!validNum(x.heading,0,360))return null;
 const fixTime=validNum(x.fixTime,now-300_000,now+300_000)?x.fixTime:x.timestamp;
 return {latitude:x.latitude,longitude:x.longitude,accuracyMeters:x.accuracyMeters,timestamp:x.timestamp,fixTime,route,speedKmh:x.speedKmh as number|null,heading:x.heading as number|null,seenAt:now};
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
const segmentCache=new Map<number,MotorwaySegmentRecord>();
const vehicleSegmentCache=new Map<string,number>();
let motorwayTableAvailable=true;

async function matchFixToMotorway(vehicleId:string,fix:Fix,previous:Fix|null,routeOverride=false):Promise<Fix>{
 if(fix.accuracyMeters>50 || !motorwayTableAvailable){
  return {...fix,matched:false,segmentId:null,chainageMeters:null,offsetMeters:null,roadDirection:'unknown'};
 }
 const cachedSegId=vehicleSegmentCache.get(vehicleId);
 if(cachedSegId!==undefined){
  const cachedSeg=segmentCache.get(cachedSegId);
  if(cachedSeg){
   const localSnap=snapFixToSegments(fix.latitude,fix.longitude,fix.accuracyMeters,[cachedSeg],60);
   if(localSnap.matched){
    const dir=detectDirectionWithHysteresis(
     previous?.roadDirection??'unknown',
     previous?.segmentId===cachedSeg.id?previous?.chainageMeters??null:null,
     localSnap.chainageMeters,
     8
    );
    return {
     ...fix,
     route:routeOverride?fix.route:localSnap.route,
     matched:true,
     segmentId:cachedSeg.id,
     chainageMeters:localSnap.chainageMeters,
     offsetMeters:localSnap.offsetMeters,
     roadDirection:dir,
    };
   }
  }
 }

 try{
  const res=await pool.query<{id:number;route:string;direction:string;geojson:string;length_m:number}>(
   `SELECT id,route,direction,ST_AsGeoJSON(geometry) AS geojson,length_m
    FROM motorway_segments
    WHERE ST_DWithin(geometry::geography,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,60)
    ORDER BY ST_Distance(geometry::geography,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)
    LIMIT 1`,
   [fix.longitude,fix.latitude]
  );
  if(!res.rows.length){
   vehicleSegmentCache.delete(vehicleId);
   return {...fix,matched:false,segmentId:null,chainageMeters:null,offsetMeters:null,roadDirection:'unknown'};
  }
  const row=res.rows[0];
  const parsed=JSON.parse(row.geojson) as {coordinates?:Array<[number,number]>};
  const seg:MotorwaySegmentRecord={
   id:Number(row.id),
   route:row.route,
   direction:row.direction,
   coords:Array.isArray(parsed.coordinates)?parsed.coordinates:[],
   lengthMeters:Number(row.length_m),
  };
  segmentCache.set(seg.id,seg);
  vehicleSegmentCache.set(vehicleId,seg.id);
  const snap=snapFixToSegments(fix.latitude,fix.longitude,fix.accuracyMeters,[seg],60);
  if(!snap.matched){
   return {...fix,matched:false,segmentId:null,chainageMeters:null,offsetMeters:null,roadDirection:'unknown'};
  }
  const dir=detectDirectionWithHysteresis(
   previous?.roadDirection??'unknown',
   previous?.segmentId===seg.id?previous?.chainageMeters??null:null,
   snap.chainageMeters,
   8
  );
  return {
   ...fix,
   route:routeOverride?fix.route:snap.route,
   matched:true,
   segmentId:seg.id,
   chainageMeters:snap.chainageMeters,
   offsetMeters:snap.offsetMeters,
   roadDirection:dir,
  };
 }catch(e:unknown){
  const msg=e instanceof Error?e.message:'';
  if(/motorway_segments/i.test(msg))motorwayTableAvailable=false;
  return {...fix,matched:false,segmentId:null,chainageMeters:null,offsetMeters:null,roadDirection:'unknown'};
 }
}

type SnapshotVehicle={id:string;distanceMeters:number;bearing:number;speedKmh:number|null;heading:number|null;accuracyMeters:number;ageMs:number;fixTime:number;oncoming?:boolean};
function filterNearbyFromPool(id:string,own:Fix,candidates:Array<{id:string;fix:Fix}>):SnapshotVehicle[]{
 const now=Date.now();
 const visible:SnapshotVehicle[]=[];
 for(const item of candidates){
  if(item.id===id)continue;
  const age=now-item.fix.seenAt;
  if(age>12_000 || item.fix.route!==own.route)continue;
  const pair=computePairwiseRoadDistance(own,item.fix);
  if(pair.distanceMeters>1000)continue;
  visible.push({
   id:item.id,
   distanceMeters:Math.round(pair.distanceMeters),
   bearing:Math.round(bearingDegrees(own,item.fix)),
   speedKmh:item.fix.speedKmh,
   heading:item.fix.heading,
   accuracyMeters:item.fix.accuracyMeters,
   ageMs:age,
   fixTime:item.fix.fixTime,
   ...(pair.oncoming?{oncoming:true}:{}),
  });
 }
 return visible.sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,80);
}
async function fetchGeoCandidates(lon:number,lat:number,radiusMeters=1000):Promise<Array<{id:string;fix:Fix}>>{
 const ids=(await redis.sendCommand(['GEOSEARCH',GEO_KEY,'FROMLONLAT',String(lon),String(lat),'BYRADIUS',String(radiusMeters),'m','COUNT','200'])) as string[];
 if(!ids.length)return [];
 const records=await redis.mGet(ids.map(v=>`fog:live:vehicle:${v}`));
 const out:Array<{id:string;fix:Fix}>=[];
 records.forEach((raw,index)=>{
  if(!raw)return;
  try{
   const fix=JSON.parse(raw) as Fix;
   out.push({id:ids[index],fix});
  }catch{ /* ignore corrupted ephemeral entries */ }
 });
 return out;
}
async function nearby(id:string,own:Fix){
 const candidates=await fetchGeoCandidates(own.longitude,own.latitude,1000);
 return filterNearbyFromPool(id,own,candidates);
}
type HazardRow={id:string;type:string;route:string;latitude:number;longitude:number;heading:number;report_count:number;expires_at:Date};
type CachedHazard={id:string;type:string;route:string;latitude:number;longitude:number;heading:number;report_count:number;expiresAtMs:number};
const hazardCache=new Map<string,CachedHazard[]>();
const hazardSignatures=new Map<string,string>();
async function refreshHazardCache(){
 try{
  const rows=await pool.query<HazardRow>(
   `SELECT id,type,route,latitude,longitude,heading,report_count,expires_at
    FROM hazards WHERE status='corroborated' AND expires_at>NOW()
    ORDER BY created_at DESC LIMIT 200`
  );
  const next=new Map<string,CachedHazard[]>();
  for(const r of rows.rows){
   const list=next.get(r.route)??[];
   list.push({
    id:r.id,type:r.type,route:r.route,latitude:Number(r.latitude),longitude:Number(r.longitude),
    heading:Number(r.heading),report_count:Number(r.report_count),expiresAtMs:new Date(r.expires_at).getTime(),
   });
   next.set(r.route,list);
  }
  const changedRoutes=new Set<string>();
  for(const r of routes){
   const nextSig=(next.get(r)??[]).map(h=>`${h.id}:${h.report_count}`).join('|');
   const prevSig=hazardSignatures.get(r)??'';
   if(nextSig!==prevSig){
    hazardSignatures.set(r,nextSig);
    changedRoutes.add(r);
   }
  }
  hazardCache.clear();
  for(const [k,v] of next)hazardCache.set(k,v);
  for(const r of changedRoutes)void invalidateAndPushInsights(r);
 }catch(e){
  app.log.warn(e,'Hazard cache refresh failed');
 }
}
await refreshHazardCache();
function hazardsAhead(own:Fix){
 const now=Date.now();
 const cached=(hazardCache.get(own.route)??[]).filter(h=>h.expiresAtMs>now && metersBetween(own,h)<=1000);
 return cached.filter(v=>own.heading===null?true:isAhead({...own,heading:own.heading},v)).map(v=>({
   id:v.id,type:v.type,distanceMeters:Math.round(metersBetween(own,v)),reportCount:v.report_count,
   expiresAt:v.expiresAtMs,status:'corroborated-experimental' as const,
 })).sort((a,b)=>a.distanceMeters-b.distanceMeters);
}
async function snapshot(socket:AuthedSocket,preloadedOwn?:Fix,preloadedPool?:Array<{id:string;fix:Fix}>){
 const now=Date.now();
 if(now-(socket.data.lastSnapshotAt??0)<500)return;
 const own=preloadedOwn??await getFix(socket.data.vehicleId);
 if(!own){
  socket.data.lastSnapshotAt=now;
  if(socket.connected){
   socket.volatile.emit('radar:snapshot',{vehicles:[],serverTime:now});
   socket.emit('hazards:snapshot',{hazards:[],serverTime:now});
  }
  return;
 }
 const vehicles=preloadedPool?filterNearbyFromPool(socket.data.vehicleId,own,preloadedPool):await nearby(socket.data.vehicleId,own);
 const hazards=hazardsAhead(own);
 let roadShape:RoadShapePoint[]=[];
 if(own.matched && own.segmentId!=null && own.chainageMeters!=null && own.roadDirection && own.roadDirection!=='unknown'){
  const seg=segmentCache.get(own.segmentId);
  if(seg){
   roadShape=extractUpcomingRoadShape(own.latitude,own.longitude,own.heading,seg.coords,own.chainageMeters,own.roadDirection,1000,100);
  }
 }
 if(socket.connected){
  const emitTime=Date.now();
  socket.data.lastSnapshotAt=emitTime;
  socket.volatile.emit('radar:snapshot',{vehicles,roadShape,serverTime:emitTime});
  socket.emit('hazards:snapshot',{hazards,serverTime:emitTime});
 }
}
type Ack=(response:{ok:boolean;error?:string;serverTime?:number;id?:string;status?:string;reportCount?:number})=>void;
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
  await refreshHazardCache();
  // Push fresh relevance-filtered advisory snapshots to active participants, not raw reports.
  void Promise.allSettled([...io.sockets.sockets.values()].map(s=>snapshot(s as AuthedSocket)));
 }
 void invalidateAndPushInsights(current.route);
 return outcome;
}
let telemetrySampleCount=0;
io.use((socket,next)=>{
 const claims=verifyToken(secret,socket.handshake.auth?.token);
 if(!claims)return next(new Error('Invalid or expired journey session'));
 socket.data.vehicleId=claims.sub;
 next();
});
io.on('connection',base=>{
 const socket=base as AuthedSocket;
 socket.on('telemetry:update',async(raw:unknown,ack?:Ack)=>{
  const vehicleId=socket.data.vehicleId;
  const rawRoute=raw&&typeof raw==='object'?(raw as {route?:unknown}).route:undefined;
  const normalizedRoute=normalizeRoute(rawRoute)??String(rawRoute??'');
  try{
   const fix=parseFix(raw);
   if(!fix){
    app.log.debug({vehicleId,route:normalizedRoute,accepted:false,reason:'Invalid GPS data or age/accuracy'},'telemetry:update');
    ack?.({ok:false,error:'Invalid GPS data or age/accuracy'});return;
   }
   const previous=await getFix(vehicleId);
   if(previous && fix.timestamp<=previous.timestamp){
    app.log.debug({vehicleId,route:fix.route,accepted:false,reason:'Out-of-order update'},'telemetry:update');
    ack?.({ok:false,error:'Out-of-order update'});return;
   }
   if(previous && fix.timestamp-previous.timestamp<500){
    app.log.debug({vehicleId,route:fix.route,accepted:false,reason:'Update rate exceeded'},'telemetry:update');
    ack?.({ok:false,error:'Update rate exceeded'});return;
   }
   if(previous && fix.timestamp-previous.timestamp<20_000 && metersBetween(fix,previous)/Math.max(0.5,(fix.timestamp-previous.timestamp)/1000)>75){
    app.log.debug({vehicleId,route:fix.route,accepted:false,reason:'GPS jump rejected'},'telemetry:update');
    ack?.({ok:false,error:'GPS jump rejected'});return;
   }
   const routeOverride=Boolean(raw&&typeof raw==='object'&&(raw as {routeOverride?:unknown}).routeOverride===true);
   const matchedFix=await matchFixToMotorway(vehicleId,fix,previous,routeOverride);
   await putFix(vehicleId,matchedFix);
   const prevRoute=socket.data.route;
   socket.data.route=matchedFix.route;
   const receivedAt=Date.now();
   telemetrySampleCount+=1;
   if(telemetrySampleCount%20===1){
    const sentAtRaw=raw&&typeof raw==='object'?(raw as {sentAt?:unknown}).sentAt:undefined;
    const sentAt=typeof sentAtRaw==='number'&&Number.isFinite(sentAtRaw)?sentAtRaw:matchedFix.timestamp;
    app.log.info({vehicleId,route:matchedFix.route,matched:Boolean(matchedFix.matched),uploadLatencyMs:receivedAt-sentAt,fixToReceiveMs:receivedAt-matchedFix.fixTime},'telemetry:update latency sample');
   }
   ack?.({ok:true,serverTime:receivedAt});
   await snapshot(socket,matchedFix);
   if(prevRoute!==matchedFix.route){
    const insightsPayload=await getOrComputeInsights(matchedFix.route);
    if(socket.connected)socket.emit('insights:update',insightsPayload);
   }else{
    const cachedInsights=insightsCache.get(matchedFix.route);
    if(cachedInsights){
     let routeActiveCount=0;
     for(const s of io.sockets.sockets.values()){
      if((s as AuthedSocket).data.route===matchedFix.route)routeActiveCount+=1;
     }
     if(Math.abs(routeActiveCount-cachedInsights.liveVehicles)>1){
      void invalidateAndPushInsights(matchedFix.route);
     }
    }
   }
  }catch(e){
   app.log.debug({vehicleId,route:normalizedRoute,accepted:false,reason:'Server processing failed'},'telemetry:update');
   app.log.error(e);ack?.({ok:false,error:'Server processing failed'});
  }
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
const hazardRefreshTimer=setInterval(()=>void refreshHazardCache(),3000);
// 1-second radar loop: one GEOSEARCH per route group per tick, reusing fetched results
const refresh=setInterval(async()=>{
 try{
  const sockets=[...io.sockets.sockets.values()] as AuthedSocket[];
  if(!sockets.length)return;
  const ownFixes=await Promise.all(sockets.map(s=>getFix(s.data.vehicleId)));
  const byRoute=new Map<string,Array<{socket:AuthedSocket;own:Fix}>>();
  for(let i=0;i<sockets.length;i++){
   const own=ownFixes[i];
   if(!own){
    await snapshot(sockets[i]);
    continue;
   }
   const list=byRoute.get(own.route)??[];
   list.push({socket:sockets[i],own});
   byRoute.set(own.route,list);
  }
  await Promise.allSettled(
   [...byRoute.entries()].map(async([,group])=>{
    const anchor=group[0].own;
    const pool=await fetchGeoCandidates(anchor.longitude,anchor.latitude,2500);
    await Promise.allSettled(group.map(({socket,own})=>snapshot(socket,own,pool)));
   })
  );
 }catch(e){app.log.error(e);}
},1000);
const sweep=setInterval(async()=>{
 try{const ids=await redis.zRangeByScore(ACTIVE_KEY,0,Date.now()-20_000,{LIMIT:{offset:0,count:500}});
  if(ids.length){const tx=redis.multi();for(const id of ids){tx.zRem(ACTIVE_KEY,id);tx.zRem(GEO_KEY,id);tx.del(`fog:live:vehicle:${id}`);}await tx.exec();}
  for(const [ip,v] of sessionLimit)if(v.until<Date.now())sessionLimit.delete(ip);
 }catch(e){app.log.error(e,'Stale position sweep failed');}
},10_000);
await app.listen({port,host:process.env.HOST||'0.0.0.0'});
const shutdown=async()=>{clearInterval(hazardRefreshTimer);clearInterval(refresh);clearInterval(sweep);await new Promise<void>(resolve=>io.close(()=>resolve()));await app.close();await redis.quit();await pool.end();process.exit(0);};
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());

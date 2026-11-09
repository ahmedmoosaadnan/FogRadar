/**
 * LOCAL DEV ONLY: injects 2 synthetic virtual phones to verify server transport.
 * Never run on a production or traffic safety server. No real cars are detected.
 */
import {io} from 'socket.io-client';
const endpoint=(process.env.EXPO_PUBLIC_API_URL||'http://127.0.0.1:4000').replace(/\/$/,'');
console.log('TEST-ONLY SYNTHETIC TELEMETRY — NOT REAL TRAFFIC');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const session=async()=>{
 const r=await fetch(endpoint+'/v1/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 if(!r.ok)throw Error('Session HTTP '+r.status);
 return (await r.json()).token;
};
const connect=async(token)=>{
 const s=io(endpoint,{auth:{token},transports:['websocket'],reconnection:false,timeout:6000});
 await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
 return s;
};
const send=async(s,latitude,longitude)=>{
 const point={latitude,longitude,speedKmh:0,heading:null,accuracyMeters:5,timestamp:Date.now(),route:'M-2 Motorway'};
 const ack=await s.timeout(4000).emitWithAck('telemetry:update',point);
 if(!ack?.ok)throw Error('Telemetry was rejected: '+ack?.error);
};
let A,B;
try{
 A=await connect(await session());
 B=await connect(await session());
 // Deliberately synthetic: two positions about 67m apart. They must never be
 // shown on a live driving server; this script is an isolated development smoke test.
 await send(A,31.6000,74.3000);await sleep(550);
 await send(B,31.6006,74.3000);
 const sees=async(sock)=>{
  for(let i=0;i<12;i++){
   const payload=await new Promise(resolve=>{
    let done=false;const timer=setTimeout(()=>{if(!done){done=true;resolve(null);}},700);
    sock.once('radar:snapshot',data=>{if(!done){done=true;clearTimeout(timer);resolve(data);}});
   });
   if(payload?.vehicles?.length) return payload.vehicles;
  }
  return [];
 };
 const [a,b]=await Promise.all([sees(A),sees(B)]);
 console.log('Client A sees:',a.map(v=>`${v.distanceMeters}m`).join(', ')||'NONE');
 console.log('Client B sees:',b.map(v=>`${v.distanceMeters}m`).join(', ')||'NONE');
 if(!a.length||!b.length)throw Error('Real-time snapshots failed. Both virtual phones must see each other.');
 console.log('PASS: 2 simulated connections exchanged real WebSocket/Redis data. Now test 2 ACTUAL phones.');
} catch(e){console.error('FAIL:',e);process.exitCode=1;}
finally {A?.disconnect();B?.disconnect();}

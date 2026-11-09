import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {io, type Socket} from 'socket.io-client';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import {useJourney, type HazardType} from '../context/JourneyContext';

export type NearbyVehicle = {id:string;distanceMeters:number;bearing:number;speedKmh:number|null;heading:number|null;accuracyMeters:number;ageMs:number};
export type LiveHazard = {id:string;type:HazardType;distanceMeters:number;reportCount:number;expiresAt:number;status:'corroborated-experimental'};
type CloudStatus = 'not-configured'|'idle'|'connecting'|'online'|'offline';
type HazardAck = {ok:boolean;error?:string;id?:string;status?:string;reportCount?:number};
type TelemetryAck = {ok:boolean;error?:string};
type ProbeResult = {ok:boolean;message:string;latencyMs:number|null};
type CloudState = {
 status:CloudStatus;error:string|null;vehicles:NearbyVehicle[];hazards:LiveHazard[];
 updatedAt:number|null;lastUploadAt:number|null;lastUploadError:string|null;
 apiUrl:string;setServerUrl:(url:string)=>void;probeServer:(url?:string)=>Promise<ProbeResult>;
 reportHazard:(type:HazardType)=>Promise<HazardAck>;
};
const CloudContext = createContext<CloudState|null>(null);
// Static dot-property access is required for Expo to inline the variable into the JS bundle.
const compiledUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://fogradar.onrender.com').trim().replace(/\/+$/,'');
const normalize = (url:string) => url.trim().replace(/\/+$/,'');
const fresh = (timestamp:number) => Number.isFinite(timestamp) && Date.now()-timestamp <= 10_000 && timestamp <= Date.now()+3_000;

export function CloudProvider({children}:{children:React.ReactNode}) {
 const {startedAt,gpsState,location,route,voiceEnabled,vibrationEnabled} = useJourney();
 // This override is for recovery/testing within the current app session. .env is persistent.
 const [apiUrl,setApiUrl] = useState(compiledUrl);
 const [status,setStatus] = useState<CloudStatus>(compiledUrl?'idle':'not-configured');
 const [error,setError] = useState<string|null>(null);
 const [vehicles,setVehicles] = useState<NearbyVehicle[]>([]);
 const [hazards,setHazards] = useState<LiveHazard[]>([]);
 const [updatedAt,setUpdatedAt] = useState<number|null>(null);
 const [lastUploadAt,setLastUploadAt] = useState<number|null>(null);
 const [lastUploadError,setLastUploadError] = useState<string|null>(null);
 const socketRef = useRef<Socket|null>(null);
 const lastSentRef = useRef(0);
 const alertedRef = useRef(new Set<string>());
 const preferencesRef = useRef({voiceEnabled,vibrationEnabled});
 preferencesRef.current = {voiceEnabled,vibrationEnabled};

 const setServerUrl = useCallback((url:string) => setApiUrl(normalize(url)),[]);
 const probeServer = useCallback(async (url?:string):Promise<ProbeResult> => {
  const target=normalize(url??apiUrl);
  if(!/^https?:\/\/[^/]+(?::\d+)?$/i.test(target)) return {ok:false,message:'Use http://PC-LAN-IP:4000 (or HTTPS on deployed server)',latencyMs:null};
  const start=Date.now(),controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6000);
  try {
   const response=await fetch(`${target}/health`,{signal:controller.signal});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const body=await response.json() as {ok?:boolean;service?:string};
   if(body.ok!==true)throw Error('Server returned unexpected health response');
   return {ok:true,message:`Backend reachable (${body.service??'FogRadar'})`,latencyMs:Date.now()-start};
  } catch(e) {return {ok:false,message:e instanceof Error?e.message:'Network request failed',latencyMs:null};}
  finally {clearTimeout(timer);}
 },[apiUrl]);

 useEffect(()=>{
  if(!startedAt || gpsState!=='tracking') {
   socketRef.current?.disconnect();socketRef.current=null;
   setVehicles([]);setHazards([]);setUpdatedAt(null);setLastUploadAt(null);
   setStatus(apiUrl?'idle':'not-configured');setError(null);
   alertedRef.current.clear();lastSentRef.current=0;
   return;
  }
  if(!apiUrl) {setStatus('not-configured');setError('Server URL missing: open Settings → Server Connection');return;}
  if(!/^https?:\/\/[^/]+(?::\d+)?$/i.test(apiUrl)){setStatus('offline');setError('Invalid server URL. Use http://192.168.x.x:4000');return;}
  let cancelled=false;let sock:Socket|null=null;let retry:ReturnType<typeof setTimeout>|null=null;
  let controller:AbortController|null=null;
  setStatus('connecting');setError(null);setLastUploadError(null);
  async function connect(){
   try {
    controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),6500);
    let response:Response;
    try {response=await fetch(`${apiUrl}/v1/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});}
    finally {clearTimeout(timeout);}
    if(!response.ok)throw Error(`Session API HTTP ${response.status}`);
    const data=await response.json() as {token?:string};
    if(!data.token)throw Error('Session API returned no token');
    if(cancelled)return;
    sock=io(apiUrl,{auth:{token:data.token},transports:['websocket'],reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:5000,timeout:6500});
    socketRef.current=sock;
    sock.on('connect',()=>{if(!cancelled){setStatus('online');setError(null);setLastUploadError(null);lastSentRef.current=0;}});
    sock.on('disconnect',(reason:string)=>{if(!cancelled){setStatus('offline');setError(`Socket disconnected: ${reason}`);setVehicles([]);setHazards([]);setUpdatedAt(null);}});
    sock.on('connect_error',(e:Error)=>{if(!cancelled){setStatus('offline');setError(`WebSocket: ${e.message}`);}});
    sock.on('radar:snapshot',(payload:{vehicles?:NearbyVehicle[]})=>{
     if(cancelled)return;
     const valid=(Array.isArray(payload?.vehicles)?payload.vehicles:[]).filter(v=>Number.isFinite(v.distanceMeters)&&v.distanceMeters>=0&&v.distanceMeters<=1000&&v.ageMs<=12_000);
     setVehicles(valid);setUpdatedAt(Date.now());
    });
    sock.on('hazards:snapshot',(payload:{hazards?:LiveHazard[]})=>{
     if(cancelled)return;
     const active=(Array.isArray(payload?.hazards)?payload.hazards:[]).filter(h=>h.expiresAt>Date.now());
     setHazards(active);
     for(const hazard of active){
      if(alertedRef.current.has(hazard.id))continue;
      alertedRef.current.add(hazard.id);
      if(preferencesRef.current.vibrationEnabled)void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(()=>{});
      if(preferencesRef.current.voiceEnabled)void Speech.getAvailableVoicesAsync().then(voices=>{
       const ur=voices.find(v=>v.language.toLowerCase().startsWith('ur'));
       Speech.speak(ur?'آگے ممکنہ خطرہ ہے۔ احتیاط سے رفتار کم کریں۔':'Unverified hazard report ahead. Slow down carefully.',{language:ur?.language??'en-US',...(ur?{voice:ur.identifier}:{}),rate:0.9});
      }).catch(()=>{});
     }
    });
   }catch(e){
    if(cancelled)return;
    setStatus('offline');setError(e instanceof Error?e.message:'Cannot connect to server');
    retry=setTimeout(()=>void connect(),6000);
   }
  }
  void connect();
  return ()=>{cancelled=true;controller?.abort();if(retry)clearTimeout(retry);sock?.disconnect();if(socketRef.current===sock)socketRef.current=null;};
 },[startedAt,gpsState,apiUrl]);

 useEffect(()=>{
  const socket=socketRef.current;
  if(!socket?.connected || status!=='online'||!location||!fresh(location.timestamp))return;
  if(location.accuracyMeters===null||location.accuracyMeters>150)return;
  if(location.timestamp<=lastSentRef.current)return;
  lastSentRef.current=location.timestamp;
  socket.timeout(5000).emit('telemetry:update',{
   latitude:location.latitude,longitude:location.longitude,
   speedKmh:location.speedKmh,heading:location.heading,
   accuracyMeters:location.accuracyMeters,timestamp:location.timestamp,route,
  },(timeout:Error|null,result?:TelemetryAck)=>{
   if(timeout){setLastUploadError('GPS upload timeout');return;}
   if(!result?.ok){setLastUploadError(result?.error??'GPS update rejected');return;}
   setLastUploadAt(Date.now());setLastUploadError(null);
  });
 },[location,status,route]);

 const reportHazard=useCallback(async(type:HazardType):Promise<HazardAck>=>{
  const socket=socketRef.current;
  if(!socket?.connected)return {ok:false,error:'Cloud offline: report NOT sent'};
  if(!location||!fresh(location.timestamp)||location.accuracyMeters===null||location.accuracyMeters>35||location.heading===null)return {ok:false,error:'Fresh GPS (±35 m or better) and motion heading needed'};
  return new Promise(resolve=>socket.timeout(8000).emit('hazard:report',{type},(e:Error|null,result?:HazardAck)=>{
   resolve(e?{ok:false,error:'Server timeout; status unknown, do not immediately retry'}:result??{ok:false,error:'No response'});
  }));
 },[location]);
 const value=useMemo(()=>({status,error,vehicles,hazards,updatedAt,lastUploadAt,lastUploadError,apiUrl,setServerUrl,probeServer,reportHazard}),[status,error,vehicles,hazards,updatedAt,lastUploadAt,lastUploadError,apiUrl,setServerUrl,probeServer,reportHazard]);
 return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}
export function useCloud():CloudState {const value=useContext(CloudContext);if(!value)throw Error('useCloud requires CloudProvider');return value;}

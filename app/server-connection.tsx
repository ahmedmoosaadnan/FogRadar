import React, {useEffect,useState} from 'react';
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {router} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useCloud} from '../src/cloud/CloudContext';
import {useJourney} from '../src/context/JourneyContext';
import {C} from '../src/theme/colors';

export default function ServerConnection(){
 const {apiUrl,setServerUrl,probeServer,status,error,lastUploadAt,lastUploadError,updatedAt}=useCloud();
 const {gpsState,location,startedAt}=useJourney();
 const [draft,setDraft]=useState(apiUrl);
 const [checking,setChecking]=useState(false);
 const [testResult,setTestResult]=useState<string|null>(null);
 useEffect(()=>setDraft(apiUrl),[apiUrl]);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[]);
 async function check(){setChecking(true);const result=await probeServer(draft);setTestResult(`${result.ok?'✅':'❌'} ${result.message}${result.latencyMs===null?'':` · ${result.latencyMs} ms`}`);setChecking(false);}
 const age=(time:number|null)=>time?`${Math.max(0,Math.floor((now-time)/1000))}s ago`:'Not yet';
 return <SafeAreaView style={s.safe} edges={['top']}><ScrollView contentContainerStyle={s.body}>
  <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ Back</Text></Pressable>
  <Text style={s.title}>Server Connection</Text>
  <Text style={s.info}>Real cloud diagnostics. Test the backend independently of GPS. Local Wi-Fi testing only.</Text>
  <Text style={s.label}>BACKEND URL</Text>
  <TextInput style={s.input} value={draft} onChangeText={setDraft} autoCorrect={false} autoCapitalize="none" keyboardType="url" placeholder="http://192.168.0.217:4000" placeholderTextColor="#85988B" />
  <Pressable onPress={()=>void check()} style={s.button}>{checking?<ActivityIndicator color="white"/>:<Text style={s.buttonText}>Test backend /health</Text>}</Pressable>
  {testResult?<Text style={s.info}>{testResult}</Text>:null}
  <Pressable onPress={()=>{setServerUrl(draft);setTestResult('URL applied for this app session. Active journey will reconnect.');}} style={[s.button,{backgroundColor:C.forest}]}><Text style={s.buttonText}>Apply URL to FogRadar</Text></Pressable>
  <Text style={s.help}>For a persistent URL set E:\\FogRadar\\.env to EXPO_PUBLIC_API_URL=http://YOUR-PC-IP:4000, restart Expo and reload iPhone app. This manual override only lasts until the app fully restarts.</Text>
  <View style={s.card}>
   <Text style={s.cardTitle}>Live Diagnostics</Text>
   <Text style={s.row}>API URL: {apiUrl||'MISSING'}</Text>
   <Text style={s.row}>Journey: {startedAt?'Started':'Not started'}</Text>
   <Text style={s.row}>GPS: {gpsState}</Text>
   <Text style={s.row}>GPS fix: {location?age(location.timestamp):'None'}</Text>
   <Text style={s.row}>GPS accuracy: {location?.accuracyMeters??'—'} m</Text>
   <Text style={s.row}>Socket: {status}</Text>
   <Text style={s.row}>Last accepted upload: {age(lastUploadAt)}</Text>
   <Text style={s.row}>Last radar snapshot: {age(updatedAt)}</Text>
   {error?<Text style={s.error}>Connection: {error}</Text>:null}
   {lastUploadError?<Text style={s.error}>Upload: {lastUploadError}</Text>:null}
  </View>
  <Text style={s.help}>Phone + PC must share an accessible LAN. Backend must listen on 0.0.0.0. Only authenticated connected phones with accurate recent GPS are shown; this is not a collision warning system.</Text>
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.cream},body:{padding:20,paddingBottom:45},back:{color:C.emerald,fontWeight:'800',fontSize:16,marginBottom:20},title:{fontSize:29,fontWeight:'900',color:C.text},info:{color:C.muted,fontSize:14,marginVertical:12},label:{marginTop:15,fontWeight:'900',color:C.text,fontSize:11},input:{backgroundColor:'white',borderWidth:1,borderColor:C.border,borderRadius:15,padding:16,marginTop:10,color:C.text,fontSize:15},button:{borderRadius:14,backgroundColor:C.emerald,marginTop:12,padding:16,alignItems:'center'},buttonText:{color:'white',fontWeight:'800'},help:{fontSize:12,color:C.muted,lineHeight:19,marginTop:18},card:{backgroundColor:'white',borderRadius:16,borderWidth:1,borderColor:C.border,padding:17,marginTop:22},cardTitle:{fontSize:18,fontWeight:'900',color:C.forest,marginBottom:10},row:{fontSize:13,color:C.text,marginVertical:5},error:{fontSize:12,color:C.red,marginTop:9}});

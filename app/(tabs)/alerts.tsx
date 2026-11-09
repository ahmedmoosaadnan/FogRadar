import React,{useEffect,useState} from 'react';
import {router} from 'expo-router';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Icon} from '../../src/components/Icons';
import {Card,PageTitle,Pill} from '../../src/components/UI';
import {useCloud} from '../../src/cloud/CloudContext';
import {useJourney} from '../../src/context/JourneyContext';
import {C} from '../../src/theme/colors';

type RoadInsights={summary_en:string;summary_ur:string;generatedAt:number};

export default function Alerts(){
 const {status,hazards,updatedAt,apiUrl}=useCloud();
 const {startedAt,gpsState,route}=useJourney();
 const [clock,setClock]=useState(Date.now());
 const [insights,setInsights]=useState<RoadInsights|null>(null);
 const [insightsLoading,setInsightsLoading]=useState(false);
 const journeyActive=Boolean(startedAt)&&gpsState==='tracking';

 useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[]);

 useEffect(()=>{
  if(!journeyActive || !apiUrl || !/^https?:\/\/[^/]+(?::\d+)?$/i.test(apiUrl)){
   setInsights(null);
   setInsightsLoading(false);
   return;
  }
  let cancelled=false;
  let controller:AbortController|null=null;
  async function fetchInsights(){
   controller?.abort();
   controller=new AbortController();
   const timeout=setTimeout(()=>controller?.abort(),5500);
   if(!cancelled)setInsightsLoading(true);
   try{
    const res=await fetch(`${apiUrl}/v1/insights?route=${encodeURIComponent(route)}`,{signal:controller.signal});
    if(!res.ok)return;
    const data=(await res.json()) as Partial<RoadInsights>;
    if(!cancelled && typeof data.summary_en==='string' && typeof data.summary_ur==='string' && typeof data.generatedAt==='number'){
     // Informational display only: never triggers voice or vibration alerts.
     setInsights({summary_en:data.summary_en,summary_ur:data.summary_ur,generatedAt:data.generatedAt});
    }
   }catch{
    // Silent fallback; never disrupts the Alerts screen.
   }finally{
    clearTimeout(timeout);
    if(!cancelled)setInsightsLoading(false);
   }
  }
  void fetchInsights();
  const interval=setInterval(()=>void fetchInsights(),30_000);
  return()=>{cancelled=true;controller?.abort();clearInterval(interval);};
 },[journeyActive,apiUrl,route]);

 const live=status==='online'&&updatedAt!==null&&clock-updatedAt<12_000;
 return <SafeAreaView style={{flex:1,backgroundColor:C.cream}} edges={['top']}><ScrollView contentContainerStyle={s.body}>
 <PageTitle title="Hazard Advisories" subtitle="Real crowdsourced reports from connected FogRadar devices."/>
 <Card style={s.insightsCard}>
  <View style={s.insightsHeader}>
   <View style={{flexDirection:'row',alignItems:'center',gap:8,flex:1}}>
    <Icon name="cloud" color={C.emerald} size={22}/>
    <Text style={s.insightsTitle}>AI Road Insights ({route})</Text>
   </View>
   <Pill label={journeyActive?(insightsLoading&&!insights?'UPDATING…':'30S AUTO'):'IDLE'} tone={journeyActive?'green':'amber'}/>
  </View>
  {journeyActive&&insights?(
   <View style={{marginTop:10,gap:8}}>
    <Text style={s.insightsText}>{insights.summary_en}</Text>
    <Text style={s.insightsUrdu}>{insights.summary_ur}</Text>
    <Text style={s.insightsMeta}>Generated {new Date(insights.generatedAt).toLocaleTimeString()} · Informational summary only (no audio/haptic triggers)</Text>
   </View>
  ):(
   <Text style={s.insightsPlaceholder}>
    {!journeyActive?'Start a journey on the Home tab to receive 30-second AI road summaries for your motorway.':!apiUrl?'Configure your backend URL in Settings → Server Connection.':'Fetching latest route summary…'}
   </Text>
  )}
 </Card>
 <Pill label={live?'LIVE EXPERIMENTAL FEED':'NO FRESH LIVE FEED'} tone="amber"/>
 <Card style={s.note}><Icon name="shield" color={C.emerald} size={30}/><Text style={s.noteText}>A hazard appears only after reports from 2 distinct trips near the same location and direction. This is not independent verification of an accident. Do not rely on these reports for driving safety.</Text></Card>
 {live&&hazards.length?hazards.map(h=><Card style={s.report} key={h.id}><Text style={s.name}>⚠ {h.type}</Text><Text style={s.meta}>~{h.distanceMeters} m ahead · {h.reportCount} independent trip reports</Text><Text style={s.meta}>Experimental corroboration · expires {new Date(h.expiresAt).toLocaleTimeString()}</Text></Card>):<Card style={s.empty}><Text style={s.name}>{live?'No corroborated reports ahead':'Waiting for network + fresh GPS'}</Text><Text style={s.meta}>No alert does NOT mean the road is clear. Vehicles without the app are invisible.</Text></Card>}
 <Pressable onPress={()=>router.push('/report-hazard')} style={s.button}><Icon name="alert" color="white"/><Text style={s.buttonText}>Report a real hazard (passenger only)</Text></Pressable>
 <Text style={s.warning}>Never operate this screen while driving. Reporting requires live GPS and an active journey. Use official emergency channels for actual emergencies.</Text>
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({
 body:{padding:20,paddingTop:25,paddingBottom:50},
 insightsCard:{marginBottom:16,backgroundColor:'#F2FAF5',borderColor:'#CBE6D6'},
 insightsHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
 insightsTitle:{fontSize:15,fontWeight:'900',color:C.forest},
 insightsText:{fontSize:13,lineHeight:19,color:C.text,fontWeight:'600'},
 insightsUrdu:{fontSize:13,lineHeight:21,color:C.forest,fontWeight:'700'},
 insightsMeta:{fontSize:11,color:C.muted,marginTop:2},
 insightsPlaceholder:{marginTop:8,fontSize:12,lineHeight:18,color:C.muted},
 note:{marginTop:16,flexDirection:'row',gap:12,alignItems:'center'},
 noteText:{flex:1,fontSize:12,lineHeight:19,color:C.muted},
 report:{marginTop:14,backgroundColor:'#EDFAF1'},
 empty:{marginTop:20,padding:25},
 name:{fontSize:17,color:C.text,fontWeight:'900'},
 meta:{fontSize:12,color:C.muted,marginTop:8,lineHeight:18},
 button:{marginTop:18,padding:17,borderRadius:15,backgroundColor:C.emerald,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},
 buttonText:{color:'white',fontWeight:'900',fontSize:13},
 warning:{fontSize:12,color:C.muted,lineHeight:19,marginTop:22}
});
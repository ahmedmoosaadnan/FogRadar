import React,{useState} from 'react';
import {router} from 'expo-router';
import {Alert,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Card,Pill} from '../src/components/UI';
import {Icon} from '../src/components/Icons';
import {type HazardType,useJourney} from '../src/context/JourneyContext';
import {useCloud} from '../src/cloud/CloudContext';
import {useGpsHealth} from '../src/hooks/useGpsHealth';
import {C} from '../src/theme/colors';
const TYPES:HazardType[]=['Stopped traffic','Accident','Heavy fog','Vehicle breakdown'];
export default function ReportHazardScreen(){
 const [selected,setSelected]=useState<HazardType>('Stopped traffic');const [sending,setSending]=useState(false);
 const {route}=useJourney();const {reportHazard,status}=useCloud();const {isFresh,location}=useGpsHealth();
 const canSend=status==='online'&&isFresh&&location?.heading!=null&&location.accuracyMeters!=null&&location.accuracyMeters<=35&&!sending;
 const send=async()=>{
  setSending(true);
  try{
   const result=await reportHazard(selected);
   if(!result.ok){Alert.alert('Not submitted',result.error||'Cannot submit hazard.');return;}
   Alert.alert('Report received by server',result.status==='candidate'?
    'Your report is pending. Other drivers are NOT alerted until another distinct device corroborates nearby.':
    'Two or more distinct trip reports nearby. Other devices may now receive an experimental advisory.',
    [{text:'View hazard feed',onPress:()=>router.replace('/(tabs)/alerts')}]);
  }finally{setSending(false);}
 };
 return <SafeAreaView style={s.safe} edges={['top']}><ScrollView contentContainerStyle={s.body}>
  <Pressable style={s.back} onPress={()=>router.back()}><Icon name="back" color={C.forest}/><Text style={{color:C.forest,fontWeight:'800'}}>Back</Text></Pressable>
  <Text style={s.title}>Report a Hazard</Text><Text style={s.subtitle}>This sends an actual report to the FogRadar backend. Passenger only; do not interact while driving.</Text>
  <Pill label={status==='online'?'CONNECTED · EXPERIMENTAL':'CLOUD OFFLINE · CANNOT REPORT'} tone="amber"/>
  <Text style={s.label}>CHOOSE TYPE</Text><Card style={{padding:9}}>{TYPES.map(type=><Pressable key={type} style={s.option} onPress={()=>setSelected(type)}><View style={[s.circle,selected===type&&s.selected]}>{selected===type?<Icon name="check" color="white" size={17}/>:null}</View><Text style={s.optionText}>{type}</Text></Pressable>)}</Card>
  <Text style={s.label}>LIVE LOCATION CONDITIONS</Text><Card style={{gap:9}}><Text style={s.meta}>Selected route (unverified): {route}</Text><Text style={s.meta}>GPS: {isFresh?`${location?.latitude.toFixed(5)}, ${location?.longitude.toFixed(5)}`:'Stale / missing'}</Text><Text style={s.meta}>Accuracy: {isFresh?`±${location?.accuracyMeters??'—'} m`:'—'} · Heading: {location?.heading??'—'}°</Text><Text style={s.meta}>Cloud: {status}</Text></Card>
  <Pressable disabled={!canSend} onPress={()=>void send()} style={[s.button,!canSend&&{opacity:0.45}]}><Text style={s.buttonText}>{sending?'Sending…':'Submit real report'}</Text></Pressable>
  <Text style={s.warning}>Reports are unverified user input. Two independent reports only provide corroboration, NOT official accident confirmation. Use motorway emergency services for emergencies.</Text>
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.cream},body:{padding:20,paddingBottom:45},back:{flexDirection:'row',gap:8,alignItems:'center',marginBottom:20},title:{fontSize:28,fontWeight:'900',color:C.text},subtitle:{fontSize:13,color:C.muted,lineHeight:20,marginTop:7,marginBottom:16},label:{fontSize:11,color:C.muted,letterSpacing:1,fontWeight:'900',marginTop:22,marginBottom:10},option:{flexDirection:'row',alignItems:'center',gap:12,padding:14,borderBottomColor:C.border,borderBottomWidth:1},circle:{width:24,height:24,borderWidth:2,borderColor:C.emerald,borderRadius:12},selected:{backgroundColor:C.emerald,alignItems:'center',justifyContent:'center'},optionText:{fontSize:15,fontWeight:'800',color:C.text},meta:{fontSize:12,color:C.muted},button:{marginTop:20,backgroundColor:C.emerald,borderRadius:13,minHeight:54,alignItems:'center',justifyContent:'center'},buttonText:{fontSize:15,fontWeight:'900',color:'white'},warning:{fontSize:12,lineHeight:20,color:C.muted,marginTop:20}});

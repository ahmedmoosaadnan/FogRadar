import React,{useEffect,useState} from 'react';
import {router} from 'expo-router';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Icon} from '../../src/components/Icons';
import {Card,PageTitle,Pill} from '../../src/components/UI';
import {useCloud} from '../../src/cloud/CloudContext';
import {C} from '../../src/theme/colors';
export default function Alerts(){
 const {status,hazards,updatedAt}=useCloud();const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[]);
 const live=status==='online'&&updatedAt!==null&&clock-updatedAt<12_000;
 return <SafeAreaView style={{flex:1,backgroundColor:C.cream}} edges={['top']}><ScrollView contentContainerStyle={s.body}>
 <PageTitle title="Hazard Advisories" subtitle="Real crowdsourced reports from connected FogRadar devices."/>
 <Pill label={live?'LIVE EXPERIMENTAL FEED':'NO FRESH LIVE FEED'} tone="amber"/>
 <Card style={s.note}><Icon name="shield" color={C.emerald} size={30}/><Text style={s.noteText}>A hazard appears only after reports from 2 distinct trips near the same location and direction. This is not independent verification of an accident. Do not rely on these reports for driving safety.</Text></Card>
 {live&&hazards.length?hazards.map(h=><Card style={s.report} key={h.id}><Text style={s.name}>⚠ {h.type}</Text><Text style={s.meta}>~{h.distanceMeters} m ahead · {h.reportCount} independent trip reports</Text><Text style={s.meta}>Experimental corroboration · expires {new Date(h.expiresAt).toLocaleTimeString()}</Text></Card>):<Card style={s.empty}><Text style={s.name}>{live?'No corroborated reports ahead':'Waiting for network + fresh GPS'}</Text><Text style={s.meta}>No alert does NOT mean the road is clear. Vehicles without the app are invisible.</Text></Card>}
 <Pressable onPress={()=>router.push('/report-hazard')} style={s.button}><Icon name="alert" color="white"/><Text style={s.buttonText}>Report a real hazard (passenger only)</Text></Pressable>
 <Text style={s.warning}>Never operate this screen while driving. Reporting requires live GPS and an active journey. Use official emergency channels for actual emergencies.</Text>
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({body:{padding:20,paddingTop:25,paddingBottom:50},note:{marginTop:16,flexDirection:'row',gap:12,alignItems:'center'},noteText:{flex:1,fontSize:12,lineHeight:19,color:C.muted},report:{marginTop:14,backgroundColor:'#EDFAF1'},empty:{marginTop:20,padding:25},name:{fontSize:17,color:C.text,fontWeight:'900'},meta:{fontSize:12,color:C.muted,marginTop:8,lineHeight:18},button:{marginTop:18,padding:17,borderRadius:15,backgroundColor:C.emerald,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},buttonText:{color:'white',fontWeight:'900',fontSize:13},warning:{fontSize:12,color:C.muted,lineHeight:19,marginTop:22}});

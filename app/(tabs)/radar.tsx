import React, {useEffect,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {router} from 'expo-router';
import {SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {RadarCanvas,ProximityLegend,proximityColor} from '../../src/components/RadarCanvas';
import {Icon} from '../../src/components/Icons';
import {useJourney} from '../../src/context/JourneyContext';
import {useCloud} from '../../src/cloud/CloudContext';
import {C} from '../../src/theme/colors';

export default function Radar(){
 const {gpsState,location,startedAt,refreshLocation}=useJourney();
 const {status,vehicles,updatedAt,error,hazards,apiUrl,lastUploadAt,lastUploadError}=useCloud();
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),500);return()=>clearInterval(timer);},[]);
 const fixAge=location?Math.max(0,clock-location.timestamp):null;
 const freshFix=gpsState==='tracking'&&location!==null&&fixAge!==null&&fixAge<=15000;
 const feedAge=updatedAt?Math.max(0,clock-updatedAt):null;
 const freshFeed=status==='online'&&updatedAt!==null&&feedAge!==null&&feedAge<=15000&&freshFix;
 const liveVehicles=freshFeed?vehicles:[];
 const ownAccuracy=freshFix?location?.accuracyMeters??null:null;
 return <SafeAreaView style={s.safe} edges={['top']}><StatusBar style="light"/><ScrollView contentContainerStyle={s.body}>
  <View style={s.header}><View><Text style={s.title}>Live Radar</Text><Text style={s.sub}>Real connected phones · 1 km</Text></View><View style={s.range}><Text style={s.rangeText}>1.0 km</Text><Text style={s.rangeSub}>RANGE</Text></View></View>
  <Pressable onPress={()=>router.push('/server-connection')} style={[s.banner,{backgroundColor:freshFeed?'#C2F7D4':C.gold}]}><Text style={s.bannerText}>{freshFeed?'● LIVE GPS + CLOUD':'● '+(status==='not-configured'?'SERVER URL MISSING':!startedAt?'START JOURNEY':status==='online'?'WAITING FOR FRESH GPS':status.toUpperCase())}  ·  SETUP ›</Text></Pressable>
  {freshFeed&&hazards.length>0?<View style={s.hazardBanner}><Icon name="alert" color="white" size={22}/><View style={{flex:1}}><Text style={s.hazardHeading}>UNVERIFIED HAZARD REPORT</Text><Text style={s.hazardLabel}>{hazards[0].type} · about {hazards[0].distanceMeters} m · FIELD TEST</Text></View></View>:null}
  <RadarCanvas vehicles={liveVehicles} heading={freshFix?location?.heading??null:null} ownAccuracy={ownAccuracy}/>
  <ProximityLegend/>
  <View style={s.cardRow}>
   <View style={s.dataCard}><Icon name="car" color={C.emerald}/><Text style={s.dataValue}>{freshFeed?liveVehicles.length:'—'}</Text><Text style={s.dataLabel}>Nearby phones</Text></View>
   <View style={s.dataCard}><Icon name="radar" color={C.emerald}/><Text style={s.dataValue}>{freshFix&&location?.speedKmh!=null?location.speedKmh:'—'} km/h</Text><Text style={s.dataLabel}>Real GPS speed</Text></View>
   <View style={s.dataCard}><Icon name="road" color={C.emerald}/><Text style={s.dataValue}>{freshFix&&location?.heading!=null?`${location.heading}°`:'—'}</Text><Text style={s.dataLabel}>Travel heading</Text></View>
  </View>
  <Text style={s.subnote}>GPS: {fixAge===null?'no fix':`${(fixAge/1000).toFixed(1)}s old`} · Accuracy ±{ownAccuracy??'—'}m · Radar: {feedAge===null?'none':`${(feedAge/1000).toFixed(1)}s old`}</Text>
  <Text style={s.subnote}>Last GPS server upload: {lastUploadAt?new Date(lastUploadAt).toLocaleTimeString():'Not accepted yet'}</Text>
  {liveVehicles.length>0?<View style={s.listCard}><Text style={s.listTitle}>Nearby connected devices ({liveVehicles.length})</Text>{liveVehicles.slice(0,12).map((v,index)=>{
   const cat=proximityColor(v.distanceMeters,ownAccuracy,v.accuracyMeters);
   const color={red:'#EF4452',yellow:'#F9C846',green:'#49D489',uncertain:'#9EAEB0'}[cat];
   return <View key={v.id} style={s.row}><View style={[s.dot,{backgroundColor:color}]}/><Text style={s.rowName}>Phone {index+1}</Text><Text style={s.rowDistance}>{v.distanceMeters} m</Text><Text style={s.rowMeta}>±{Math.round((ownAccuracy??0)+v.accuracyMeters)} m · {v.speedKmh??'—'} km/h</Text></View>;
  })}</View>:<Text style={s.subnote}>{freshFeed?'No other connected phones within 1 km on this test route.':'No validated live radar feed. Open Server Connection / GPS Diagnostics.'}</Text>}
  {gpsState==='tracking'&&!freshFix?<Pressable onPress={()=>void refreshLocation()} style={s.link}><Text style={s.linkText}>Retry GPS fix (outdoors / Precise Location enabled)</Text></Pressable>:null}
  {error?<Text style={s.error}>Cloud: {error}</Text>:null}
  {lastUploadError?<Text style={s.error}>Upload: {lastUploadError}</Text>:null}
  {!apiUrl?<Text style={s.error}>EXPO_PUBLIC_API_URL missing. Open Server Connection to enter URL.</Text>:null}
  <Text style={s.disclaimer}>Distance is between GPS estimates, NOT vehicle bumpers. GPS error, direction, and lanes are unresolved. Color means rough proximity only; not safe/unsafe guidance. Connected phones only. Do not depend on this field-test system while driving.</Text>
 </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.dark},body:{padding:17,paddingBottom:38},header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16},title:{color:'white',fontWeight:'900',fontSize:25},sub:{color:'#B8DFCB',fontSize:12,marginTop:4},range:{alignItems:'flex-end'},rangeText:{fontWeight:'900',color:'white',fontSize:17},rangeSub:{fontSize:9,color:'#B8DFCB',letterSpacing:1},banner:{padding:10,borderRadius:25,alignItems:'center',alignSelf:'center',marginBottom:12},bannerText:{fontSize:10,color:'#19472B',fontWeight:'900',letterSpacing:.3},hazardBanner:{backgroundColor:'#A72E36',borderRadius:14,padding:13,marginBottom:14,flexDirection:'row',alignItems:'center',gap:10},hazardHeading:{fontSize:13,fontWeight:'900',color:'white'},hazardLabel:{fontSize:11,color:'#FFE2E3',marginTop:3},cardRow:{flexDirection:'row',gap:8,marginTop:15},dataCard:{flex:1,backgroundColor:'#0E5B39',borderColor:'#1C7850',borderWidth:1,borderRadius:15,padding:11,alignItems:'center',gap:6},dataValue:{color:'white',fontSize:13,fontWeight:'900'},dataLabel:{color:'#BDE8CF',fontSize:9,textAlign:'center'},disclaimer:{color:'#ABD8C0',fontSize:12,lineHeight:19,textAlign:'center',marginTop:20},subnote:{textAlign:'center',color:'white',fontSize:12,marginTop:14},error:{color:'#FFCFD5',fontSize:12,textAlign:'center',marginTop:12},listCard:{backgroundColor:'#0B4C32',borderColor:'#2F8059',borderWidth:1,borderRadius:14,padding:13,marginTop:12},listTitle:{fontWeight:'800',color:'white',fontSize:13,marginBottom:5},row:{flexDirection:'row',alignItems:'center',gap:9,paddingVertical:10,borderBottomWidth:.5,borderColor:'#398A64'},dot:{width:11,height:11,borderRadius:6},rowName:{fontSize:12,color:'white',fontWeight:'800',minWidth:62},rowDistance:{fontSize:14,color:'white',fontWeight:'900'},rowMeta:{flex:1,fontSize:10,color:'#C1F1D7',textAlign:'right'},link:{marginTop:14,alignItems:'center',padding:12,backgroundColor:'#175E42',borderRadius:12},linkText:{color:'white',fontWeight:'800',fontSize:13}});

import React from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../src/components/Icons';
import { Card, Pill } from '../src/components/UI';
import { C } from '../src/theme/colors';

export default function Offline() {
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.body}>
    <Pressable onPress={()=>router.back()} style={s.back}><Icon name="back" color={C.forest}/><Text style={s.backText}>Back</Text></Pressable>
    <View style={s.hero}><View style={s.bigIcon}><Icon name="offline" size={50} color={C.forest}/></View><Text style={s.title}>Offline Mode</Text><Text style={s.desc}>Keep the app useful when mobile coverage becomes unreliable.</Text></View>
    <Card style={s.card}><Pill label="NOT YET AVAILABLE" tone="amber"/><Text style={s.cardTitle}>No cached hazards</Text><Text style={s.cardText}>This connected MVP currently requires an active network connection; it does not provide offline hazard warnings. Predictive caching is a planned implementation milestone.</Text></Card>
    <Card style={s.card}><Text style={s.cardTitle}>Planned behavior</Text><View style={s.line}><Icon name="check" color={C.emerald}/><Text style={s.cardText}>Pre-download validated hazards for the next 50–100 km</Text></View><View style={s.line}><Icon name="check" color={C.emerald}/><Text style={s.cardText}>Match offline GPS positions to recently cached hazards</Text></View><View style={s.line}><Icon name="check" color={C.emerald}/><Text style={s.cardText}>Label cached hazard age and uncertainty clearly</Text></View></Card>
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:C.cream},body:{padding:20},back:{flexDirection:'row',gap:6,alignItems:'center',marginVertical:9},backText:{color:C.forest,fontWeight:'800'},hero:{alignItems:'center',paddingVertical:30},bigIcon:{width:100,height:100,borderRadius:50,backgroundColor:C.pale,alignItems:'center',justifyContent:'center'},title:{fontSize:28,fontWeight:'900',color:C.text,marginTop:15},desc:{fontSize:14,textAlign:'center',lineHeight:22,color:C.muted,marginTop:8,maxWidth:280},card:{marginBottom:14,gap:10,padding:20},cardTitle:{fontSize:18,fontWeight:'800',color:C.text,marginTop:5},cardText:{color:C.muted,fontSize:13,lineHeight:21,flex:1},line:{flexDirection:'row',alignItems:'flex-start',gap:10,marginTop:7}});

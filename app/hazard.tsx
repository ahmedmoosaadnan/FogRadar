import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { C } from '../src/theme/colors';
import { Icon } from '../src/components/Icons';
import { useJourney } from '../src/context/JourneyContext';

export default function HazardDemo() {
  const {voiceEnabled, vibrationEnabled} = useJourney();
  const preview = useCallback(async () => {
    if (vibrationEnabled) {
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    }
    if (voiceEnabled) {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        const urduVoice = voices.find(v => v.language.toLowerCase().startsWith('ur'));
        if (urduVoice) Speech.speak('آگے ٹریفک رکی ہوئی ہے۔ رفتار آہستہ کریں۔', { language: urduVoice.language, voice: urduVoice.identifier, rate:.87 });
        else Speech.speak('Demo alert. Traffic stopped ahead. Slow down safely.', { language:'en-US', rate:.87 });
      } catch { /* Device TTS may not have installed voice engines. */ }
    }
  }, [voiceEnabled,vibrationEnabled]);
  useEffect(() => { void preview(); return () => { Speech.stop(); }; }, [preview]);
  return <SafeAreaView style={s.safe}><StatusBar style="light" /><View style={s.top}><Pressable onPress={() => router.back()} style={s.back}><Icon name="back" color="white" /><Text style={s.backText}>Back</Text></Pressable><View style={s.badge}><Text style={s.badgeText}>SIMULATED ALERT — NOT REAL TRAFFIC DATA</Text></View></View>
    <View style={s.center}><View style={s.warningCircle}><Icon name="alert" color="white" size={76} strokeWidth={1.5} /></View><Text style={s.main}>Traffic Stopped{'\n'}Ahead</Text><Text style={s.approx}>Example hazard · approximately 900 m</Text><View style={s.distance}><Icon name="car" color="#FFF" size={28}/><Text style={s.distanceText}>900 m</Text></View><Text style={s.advice}>Example safety message: reduce speed carefully and follow official road instructions.</Text><View style={s.audio}><Icon name="sound" color="white"/><Text style={s.audioText}>Voice: {voiceEnabled ? 'ON' : 'OFF'}</Text><View style={{flex:1}}/><Icon name="check" color={voiceEnabled ? '#4FE08F' : '#BFC0C0'}/></View><View style={s.audio}><Icon name="radar" color="white"/><Text style={s.audioText}>Vibration: {vibrationEnabled ? 'ON' : 'OFF'}</Text><View style={{flex:1}}/><Icon name="check" color={vibrationEnabled ? '#4FE08F' : '#BFC0C0'}/></View></View>
    <View style={s.footer}><Pressable style={s.replay} onPress={()=>void preview()}><Icon name="sound" color="white" /><Text style={s.replayText}>Replay test alert</Text></Pressable><Pressable style={s.close} onPress={()=>router.back()}><Icon name="check" color={C.forest}/><Text style={s.closeText}>Got it</Text></Pressable></View>
  </SafeAreaView>;
}
const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.darkRed,paddingHorizontal:22},top:{gap:18,paddingTop:20},back:{flexDirection:'row',alignItems:'center',gap:7,alignSelf:'flex-start'},backText:{color:'white',fontSize:13,fontWeight:'700'},badge:{backgroundColor:C.gold,borderRadius:9,alignSelf:'center',padding:9},badgeText:{fontSize:10,fontWeight:'900',color:'#533B00',textAlign:'center'},
  center:{flex:1,justifyContent:'center',alignItems:'center'},warningCircle:{borderColor:'#EA3A47',borderWidth:3,width:138,height:138,borderRadius:69,alignItems:'center',justifyContent:'center',backgroundColor:'#841923'},main:{color:'white',fontSize:36,fontWeight:'900',textAlign:'center',letterSpacing:-1.5,lineHeight:41,marginTop:22},approx:{color:'#FFD1D3',textAlign:'center',fontSize:13,marginTop:8},distance:{marginTop:22,backgroundColor:'#B42332',borderColor:'#EF6774',borderWidth:1,borderRadius:16,paddingVertical:11,paddingHorizontal:32,flexDirection:'row',gap:17,alignItems:'center'},distanceText:{fontSize:30,fontWeight:'900',color:'white'},advice:{color:'#FFDEE1',marginTop:18,textAlign:'center',lineHeight:21,fontSize:13,maxWidth:290,marginBottom:14},audio:{width:'100%',maxWidth:300,borderColor:'#D6636D',borderWidth:1,borderRadius:13,paddingVertical:12,paddingHorizontal:15,flexDirection:'row',gap:11,alignItems:'center',marginTop:8},audioText:{color:'white',fontWeight:'700'},
  footer:{paddingBottom:18,gap:10},replay:{backgroundColor:'#9D2630',height:47,borderRadius:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},replayText:{color:'white',fontWeight:'800'},close:{backgroundColor:'white',height:55,borderRadius:15,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},closeText:{fontWeight:'900',color:C.forest,fontSize:16}
});

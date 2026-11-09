import React from 'react';
import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icons';
import { Card, PageTitle, SettingRow } from '../../src/components/UI';
import { useJourney } from '../../src/context/JourneyContext';
import { C } from '../../src/theme/colors';
import { useCloud } from '../../src/cloud/CloudContext';

export default function Settings() {
  const {voiceEnabled,vibrationEnabled,setVoiceEnabled,setVibrationEnabled} = useJourney();
  const {status,error,apiUrl,lastUploadAt} = useCloud();
  return <SafeAreaView style={{flex:1,backgroundColor:C.cream}} edges={['top']}><ScrollView contentContainerStyle={s.body}>
    <PageTitle title="Settings" subtitle="Customize FogRadar for your journey." />
    <Card style={s.card}>
      <SettingRow icon="sound" label="Voice Alerts" subtitle="Urdu voice when available, English fallback" right={<Switch value={voiceEnabled} onValueChange={setVoiceEnabled} trackColor={{true:'#62D496'}} thumbColor="white" />} />
      <SettingRow icon="radar" label="Vibration Alerts" subtitle="Haptic feedback on experimental hazard advisories" right={<Switch value={vibrationEnabled} onValueChange={setVibrationEnabled} trackColor={{true:'#62D496'}} thumbColor="white" />} />
      <SettingRow icon="radar" label="GPS Diagnostics" subtitle="Check speed, accuracy and stale data" onPress={() => router.push('/gps-diagnostics')} />
      <SettingRow icon="network" label="Server Connection" subtitle={apiUrl || "Missing server URL — configure here"} onPress={() => router.push('/server-connection')} />
      <SettingRow icon="pin" label="Location Permission" subtitle="Foreground GPS only in this MVP" onPress={()=>void Linking.openSettings()} />
      <SettingRow icon="shield" label="Data & Privacy" subtitle="Coordinates uploaded to configured FogRadar server during journeys; temporary trip ID" />
      <SettingRow icon="offline" label="Offline Cache" subtitle="Not available; requires a later milestone" />
    </Card>
    <View style={s.about}><Icon name="shield" color={C.emerald} size={28}/><Text style={s.aboutTitle}>FogRadar Connected MVP v0.5</Text><Text style={s.aboutText}>Live connection: {status} · {error??'No connection error'} · Last upload: {lastUploadAt?new Date(lastUploadAt).toLocaleTimeString():'none'} · Not verified for traffic safety.</Text></View>
  </ScrollView></SafeAreaView>;
}
const s=StyleSheet.create({body:{padding:20,paddingTop:25,paddingBottom:40},card:{paddingHorizontal:16,paddingVertical:3},about:{alignItems:'center',marginTop:35,paddingHorizontal:22},aboutTitle:{fontSize:14,fontWeight:'900',color:C.text,marginTop:12},aboutText:{fontSize:12,color:C.muted,lineHeight:19,textAlign:'center',marginTop:8}});

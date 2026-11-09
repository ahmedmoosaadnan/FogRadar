import React, { useState } from 'react';
import { router } from 'expo-router';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '../../src/components/BrandMark';
import { Icon } from '../../src/components/Icons';
import { Card, MainButton, PageTitle, Pill } from '../../src/components/UI';
import { useJourney } from '../../src/context/JourneyContext';
import { useGpsHealth } from '../../src/hooks/useGpsHealth';
import { formatDuration, useTripStats } from '../../src/hooks/useTripStats';
import { C } from '../../src/theme/colors';
import { useCloud } from '../../src/cloud/CloudContext';

const ROUTES = ['M-1 Motorway', 'M-2 Motorway', 'M-3 Motorway', 'M-4 Motorway', 'M-5 Motorway', 'M-9 Motorway'];
export default function Home() {
  const { gpsState, location, error, route, setRoute, startJourney, stopJourney, refreshLocation, lastTrip } = useJourney();
  const [showRoutes, setShowRoutes] = useState(false);
  const cloud = useCloud();
  const { isFresh, quality, safeSpeedKmh, safeHeading } = useGpsHealth();
  const running = gpsState === 'tracking';
  const { elapsedSeconds, distanceMeters, gpsSamples } = useTripStats();
  async function start() {
    if (running) { stopJourney(); router.push('/trip-summary'); return; }
    const ok = await startJourney();
    if (ok) router.push('/(tabs)/radar');
    else Alert.alert('GPS unavailable', 'Check location permission and device GPS, then try again.');
  }
  const speedText = safeSpeedKmh != null ? `${safeSpeedKmh}` : '—';
  return <SafeAreaView style={s.safe} edges={['top']}><ScrollView contentContainerStyle={s.body}>
    <View style={s.brand}><BrandMark size={49} /><View><Text style={s.brandName}>FogRadar</Text><Text style={s.brandTag}>EARLY WARNING. SAFER JOURNEYS.</Text></View><View style={{flex:1}}/><Pill label="FIELD TEST" tone="amber" /></View>
    <PageTitle title="Ready for your journey?" subtitle="Your motorway companion for low-visibility drives." />
    <View style={s.statusRow}>
      <Card style={s.statusCard}><Icon name="pin" color={running ? C.emerald : C.muted} /><Text style={s.statusTitle}>GPS STATUS</Text><Text style={[s.statusValue, {color:running ? C.emerald : C.muted}]}>{running ? (isFresh ? quality === 'poor' ? 'Poor signal' : 'GPS active' : 'Waiting / stale') : gpsState === 'requesting' ? 'Requesting…' : 'Not active'}</Text></Card>
      <Card style={s.statusCard}><Icon name="network" color={C.muted} /><Text style={s.statusTitle}>CLOUD STATUS</Text><Text style={[s.statusValue,{color:cloud.status==='online'?C.emerald:C.muted}]}>{cloud.status==='online'?'Connected':cloud.status==='not-configured'?'Not configured':cloud.status}</Text></Card>
    </View>
    <Pressable onPress={() => setShowRoutes(true)} style={s.route}><View style={s.routeIcon}><Icon name="road" /></View><View style={{ flex:1 }}><Text style={s.routeLabel}>SELECT MOTORWAY</Text><Text style={s.routeName}>{route}</Text></View><Icon name="arrow" color={C.muted} size={20} /></Pressable>
    <Card style={s.speedCard}><Icon name="radar" size={45} color={C.emerald} /><View><Text style={s.speedLabel}>CURRENT SPEED</Text><Text style={s.speedNumber}>{speedText}<Text style={s.speedUnit}> km/h</Text></Text></View></Card>
    {location && isFresh ? <Text style={s.gpsDetail}>GPS accuracy: ±{location.accuracyMeters ?? '—'} m  ·  Heading: {safeHeading ?? '—'}°</Text> : <Text style={s.gpsDetail}>{running ? 'Waiting for a fresh, usable GPS reading…' : 'Start a journey to request live GPS location.'}</Text>}
    {running ? <View style={s.metricsRow}>
      <Card style={s.metric}><Text style={s.metricLabel}>TRIP TIME</Text><Text style={s.metricValue}>{formatDuration(elapsedSeconds)}</Text></Card>
      <Card style={s.metric}><Text style={s.metricLabel}>GPS DISTANCE*</Text><Text style={s.metricValue}>{(distanceMeters / 1000).toFixed(2)} km</Text></Card>
      <Card style={s.metric}><Text style={s.metricLabel}>GPS FIXES</Text><Text style={s.metricValue}>{gpsSamples}</Text></Card>
    </View> : lastTrip ? <Pressable onPress={() => router.push('/trip-summary')} style={s.gpsLink}><Icon name="clock" color={C.emerald}/><Text style={s.gpsLinkText}>View last journey summary</Text><Icon name="arrow" color={C.muted}/></Pressable> : null}
    <MainButton label={running ? 'End Journey' : gpsState === 'requesting' ? 'Requesting GPS…' : 'Start Journey'} icon={running ? 'stop' : 'play'} onPress={start} disabled={gpsState === 'requesting'} />
    {error ? <Text style={s.error}>{error}</Text> : null}
    {running&&!isFresh ? <Pressable onPress={()=>void refreshLocation()} style={s.gpsLink}><Icon name="pin" color={C.emerald}/><Text style={s.gpsLinkText}>Retry actual GPS fix (can take seconds)</Text></Pressable> : null}
    {cloud.lastUploadError?<Text style={s.error}>Cloud upload: {cloud.lastUploadError}</Text>:null}
    <Pressable onPress={()=>router.push('/server-connection')} style={s.gpsLink}><Icon name="network" color={C.emerald}/><Text style={s.gpsLinkText}>Server connection & live diagnostics</Text><Icon name="arrow" color={C.muted}/></Pressable>
    <Pressable onPress={() => router.push('/report-hazard')} style={s.gpsLink}><Icon name="alert" size={20} color={C.emerald} /><Text style={s.gpsLinkText}>Report an actual hazard</Text><Icon name="arrow" color={C.muted} size={18}/></Pressable>
    <Pressable onPress={() => router.push('/gps-diagnostics')} style={s.gpsLink}><Icon name="pin" size={20} color={C.emerald} /><Text style={s.gpsLinkText}>Open GPS Diagnostics</Text><Icon name="arrow" color={C.muted} size={18} /></Pressable>
    <Pressable onPress={() => router.push('/offline')} style={s.offline}><Icon name="offline" /><View style={{flex:1}}><Text style={s.offlineTitle}>Offline status</Text><Text style={s.offlineDesc}>Cloud connectivity required; offline cache not yet active</Text></View><Icon name="arrow" color={C.muted} size={18} /></Pressable>
    <View style={s.footerNote}><Icon name="alert" size={18} color="#906800" /><Text style={s.footerText}>Connected phones are live. Hazard corroboration is experimental and not a verified safety alert. Do not rely on it for driving decisions.</Text></View>
  </ScrollView>
  <Modal transparent visible={showRoutes} animationType="slide" onRequestClose={() => setShowRoutes(false)}><View style={s.modalOverlay}><View style={s.modalBody}><Text style={s.modalTitle}>Choose Motorway</Text><Text style={s.modalDesc}>Manual route selection is NOT GPS map-matched. Choose carefully before starting the trip.</Text>{ROUTES.map(r => <Pressable key={r} style={s.modalItem} onPress={() => { setRoute(r); setShowRoutes(false); }}><Icon name="road" size={19} color={C.emerald} /><Text style={s.modalItemText}>{r}</Text>{r === route ? <Icon name="check" color={C.emerald} /> : null}</Pressable>)}<Pressable style={s.close} onPress={() => setShowRoutes(false)}><Text style={{color:C.white,fontWeight:'800'}}>Close</Text></Pressable></View></View></Modal>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  safe: { flex:1, backgroundColor:C.cream }, body:{ paddingHorizontal:19, paddingTop:18, paddingBottom:25 },
  brand: {flexDirection:'row', alignItems:'center', gap:11, marginBottom:25}, brandName:{ fontSize:23, fontWeight:'900', color:C.forest,letterSpacing:-1 }, brandTag:{fontSize:8,letterSpacing:.8,fontWeight:'800',color:C.muted},
  statusRow:{flexDirection:'row',gap:11,marginBottom:13}, statusCard:{flex:1, padding:16, minHeight:137, gap:7}, statusTitle:{fontSize:10,color:C.muted,fontWeight:'800',letterSpacing:.8}, statusValue:{fontSize:14,fontWeight:'800', color:C.text},
  route:{backgroundColor:C.white, borderColor:C.border,borderWidth:1,borderRadius:18,padding:15,flexDirection:'row',alignItems:'center',gap:12, marginBottom:14}, routeIcon:{backgroundColor:C.pale,borderRadius:12,padding:12}, routeLabel:{fontSize:10,fontWeight:'800',color:C.muted,letterSpacing:.8},routeName:{fontSize:16,fontWeight:'800',color:C.text,marginTop:4},
  speedCard:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:23,backgroundColor:'#EDF7F0',paddingVertical:20,marginBottom:7},speedLabel:{fontSize:10,color:C.muted,fontWeight:'800',letterSpacing:1},speedNumber:{fontWeight:'900',fontSize:35,color:C.text,letterSpacing:-1},speedUnit:{fontSize:15,fontWeight:'700'},
  gpsDetail:{fontSize:12,color:C.muted,marginBottom:19,textAlign:'center'},
  metricsRow:{flexDirection:'row',gap:6,marginBottom:14},metric:{flex:1,paddingHorizontal:8,paddingVertical:12,alignItems:'center'},metricLabel:{fontSize:8,fontWeight:'900',color:C.muted},metricValue:{fontSize:14,fontWeight:'900',color:C.text,marginTop:5},error:{fontSize:12,color:C.red,marginTop:12,textAlign:'center'},
  gpsLink:{marginTop:12, flexDirection:'row',alignItems:'center',gap:10, padding:14, backgroundColor:C.white,borderColor:C.border,borderWidth:1,borderRadius:14},gpsLinkText:{flex:1,color:C.text,fontWeight:'800',fontSize:13},
  offline:{flexDirection:'row',gap:13,alignItems:'center',backgroundColor:C.white,borderColor:C.border,borderWidth:1,borderRadius:16,marginTop:18,padding:15},offlineTitle:{fontSize:14,fontWeight:'800',color:C.text},offlineDesc:{fontSize:12,color:C.muted,marginTop:2},
  footerNote:{marginTop:19,flexDirection:'row',gap:10,alignItems:'flex-start',paddingHorizontal:5},footerText:{fontSize:12,color:C.muted,flex:1,lineHeight:18},
  modalOverlay:{flex:1,backgroundColor:'#0008',justifyContent:'flex-end'},modalBody:{backgroundColor:C.white,borderTopRightRadius:26,borderTopLeftRadius:26,padding:23,paddingBottom:35},modalTitle:{fontWeight:'900',fontSize:23,color:C.text},modalDesc:{color:C.muted,fontSize:12,marginTop:6,marginBottom:10},modalItem:{height:49,borderBottomColor:C.border,borderBottomWidth:1,flexDirection:'row',alignItems:'center',gap:13},modalItemText:{color:C.text,fontWeight:'700',flex:1},close:{height:48,marginTop:18,backgroundColor:C.forest,borderRadius:14,alignItems:'center',justifyContent:'center'}
});

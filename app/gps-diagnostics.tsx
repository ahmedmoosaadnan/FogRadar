import React from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Pill } from '../src/components/UI';
import { Icon } from '../src/components/Icons';
import { useJourney } from '../src/context/JourneyContext';
import { useGpsHealth } from '../src/hooks/useGpsHealth';
import { formatDuration, useTripStats } from '../src/hooks/useTripStats';
import { C } from '../src/theme/colors';

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={s.metric}><Text style={s.label}>{label}</Text><Text style={s.value}>{value}</Text></View>;
}

export default function GPSDiagnostics() {
  const { error, startJourney, stopJourney, refreshLocation } = useJourney();
  const { gpsState, location, ageSeconds, callbackAgeMs, fixLatencyMs, isFresh, quality, safeSpeedKmh, safeHeading } = useGpsHealth();
  const { elapsedSeconds, distanceMeters, gpsSamples } = useTripStats();
  const active = gpsState === 'tracking';
  const lat = isFresh && location ? location.latitude.toFixed(6) : '—';
  const lon = isFresh && location ? location.longitude.toFixed(6) : '—';
  return <SafeAreaView style={s.safe} edges={['top']}>
    <ScrollView contentContainerStyle={s.content}>
      <Pressable style={s.back} onPress={() => router.back()}><Icon name="arrow" size={20} color={C.forest} /><Text style={s.backText}>Back</Text></Pressable>
      <Text style={s.title}>GPS Diagnostics</Text>
      <Text style={s.sub}>Verify real iPhone / Android location data before cloud integration.</Text>
      <View style={s.badges}>
        <Pill label={gpsState.toUpperCase()} tone={isFresh ? 'green' : 'amber'} />
        <Pill label={isFresh ? `GPS ${quality.toUpperCase()}` : 'NO FRESH GPS FIX'} tone={isFresh && quality === 'good' ? 'green' : 'amber'} />
      </View>
      <Card style={s.card}>
        <Metric label="Live speed" value={safeSpeedKmh === null ? '—' : `${safeSpeedKmh} km/h`} />
        <Metric label="Heading (GPS course)" value={safeHeading === null ? '—' : `${safeHeading}°`} />
        <Metric label="GPS accuracy (estimate)" value={isFresh && location?.accuracyMeters != null ? `±${location.accuracyMeters} m` : '—'} />
        <Metric label="Latitude" value={lat} />
        <Metric label="Longitude" value={lon} />
        <Metric label="Age of last GPS reading" value={active && ageSeconds !== null ? `${ageSeconds} seconds` : '—'} />
        <Metric label="GPS fix → JS callback latency" value={fixLatencyMs === null ? '—' : `${fixLatencyMs} ms`} />
        <Metric label="Time since callback" value={callbackAgeMs === null ? '—' : `${(callbackAgeMs / 1000).toFixed(1)} seconds`} />
        <Metric label="Trip duration" value={active ? formatDuration(elapsedSeconds) : '—'} />
        <Metric label="Estimated trip distance" value={active ? `${(distanceMeters / 1000).toFixed(2)} km` : '—'} />
        <Metric label="Received GPS fixes" value={String(gpsSamples)} />
        <Metric label="Last update (device local time)" value={isFresh && location ? new Date(location.timestamp).toLocaleTimeString() : '—'} />
      </Card>
      {error ? <Text style={s.error}>GPS error: {error}</Text> : null}
      <Pressable style={[s.button, active && s.stopButton]} onPress={() => { if (active) { stopJourney(); router.push('/trip-summary'); } else void startJourney(); }}>
        <Text style={s.buttonText}>{active ? 'End Journey / Stop GPS' : gpsState === 'requesting' ? 'Requesting permission…' : 'Start GPS Test'}</Text>
      </Pressable>
      {active ? <Pressable style={[s.button,{backgroundColor:C.forest}]} onPress={()=>void refreshLocation()}><Text style={s.buttonText}>Request fresh GPS fix (iPhone / Android)</Text></Pressable> : null}
      <View style={s.note}>
        <Icon name="alert" size={18} color="#805D00" />
        <Text style={s.noteText}>TEST ONLY — This screen does not detect road hazards. Distance is estimated and speed updates depend on the operating system. Location accuracy does not guarantee lane detection. Keep app foregrounded; Expo Go cannot validate background tracking. Test safely while stationary or as a passenger.</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 45 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  backText: { color: C.forest, fontWeight: '800' },
  title: { fontSize: 29, fontWeight: '900', color: C.text },
  sub: { color: C.muted, marginTop: 6, fontSize: 14, lineHeight: 20 },
  badges: { marginTop: 18, marginBottom: 16, flexDirection: 'row', gap: 9, flexWrap: 'wrap' },
  card: { paddingVertical: 2, paddingHorizontal: 16 },
  metric: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: .3 },
  value: { fontSize: 19, fontWeight: '800', color: C.text, marginTop: 5 },
  button: { backgroundColor: C.emerald, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 15, marginTop: 20 },
  stopButton: { backgroundColor: C.darkRed },
  buttonText: { color: 'white', fontWeight: '800', fontSize: 15 },
  error: { color: C.red, marginTop: 14 },
  note: { flexDirection: 'row', backgroundColor: '#FFF5D4', borderRadius: 12, gap: 10, padding: 14, marginTop: 18 },
  noteText: { flex: 1, fontSize: 12, color: '#6F5300', lineHeight: 18 },
});

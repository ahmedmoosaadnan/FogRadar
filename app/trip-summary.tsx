import React from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Pill } from '../src/components/UI';
import { Icon } from '../src/components/Icons';
import { useJourney } from '../src/context/JourneyContext';
import { formatDuration } from '../src/hooks/useTripStats';
import { C } from '../src/theme/colors';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

export default function TripSummaryScreen() {
  const { lastTrip } = useJourney();
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.body}>
        <Pressable onPress={() => router.replace('/(tabs)/home')} style={s.back}>
          <Icon name="back" />
          <Text style={s.backText}>Home</Text>
        </Pressable>
        <Text style={s.title}>Journey Summary</Text>
        <Text style={s.subtitle}>Saved to your on-device trip history.</Text>
        <Pill label="SAVED ON DEVICE" tone="green" />
        {lastTrip ? (
          <Card style={s.card}>
            <Row label="Motorway route" value={lastTrip.route} />
            <Row
              label="Duration"
              value={formatDuration(Math.max(0, Math.floor((lastTrip.endedAt - lastTrip.startedAt) / 1000)))}
            />
            <Row label="Distance covered" value={`${(lastTrip.distanceMeters / 1000).toFixed(2)} km`} />
            <Row
              label="Maximum speed"
              value={lastTrip.maxSpeedKmh === null ? 'Unavailable' : `${lastTrip.maxSpeedKmh} km/h`}
            />
            <Row label="GPS readings" value={String(lastTrip.gpsSamples)} />
          </Card>
        ) : (
          <Card style={s.card}>
            <Text style={s.subtitle}>No completed journey recorded yet.</Text>
          </Card>
        )}
        <Pressable style={s.button} onPress={() => router.replace('/(tabs)/home')}>
          <Text style={s.buttonText}>Return to Home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  body: { padding: 20, paddingTop: 23, paddingBottom: 36 },
  back: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 24 },
  backText: { color: C.forest, fontWeight: '800' },
  title: { fontSize: 29, fontWeight: '900', color: C.text },
  subtitle: { fontSize: 13, color: C.muted, lineHeight: 20, marginTop: 6, marginBottom: 19 },
  card: { marginTop: 18, paddingVertical: 4 },
  row: { paddingVertical: 15, borderBottomColor: C.border, borderBottomWidth: 1 },
  label: { fontSize: 12, color: C.muted, fontWeight: '700' },
  value: { fontSize: 17, fontWeight: '800', color: C.text, marginTop: 5 },
  button: {
    marginTop: 22,
    backgroundColor: C.emerald,
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 14,
  },
  buttonText: { fontWeight: '900', color: C.white, fontSize: 15 },
});

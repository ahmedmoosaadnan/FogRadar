import React from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '../src/components/UI';
import { Icon } from '../src/components/Icons';
import { useJourney } from '../src/context/JourneyContext';
import { formatDuration } from '../src/hooks/useTripStats';
import { C } from '../src/theme/colors';

export default function TripHistoryScreen() {
  const { tripHistory, clearTripHistory } = useJourney();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.body}>
        <Pressable onPress={() => router.back()} style={s.back}>
          <Icon name="back" color={C.forest} />
          <Text style={s.backText}>Back</Text>
        </Pressable>

        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Trip History</Text>
            <Text style={s.subtitle}>Last {tripHistory.length} saved journeys on this device</Text>
          </View>
          {tripHistory.length > 0 ? (
            <Pressable onPress={clearTripHistory} style={s.clearBtn}>
              <Text style={s.clearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        {tripHistory.length === 0 ? (
          <Card style={s.empty}>
            <Text style={s.emptyTitle}>No saved journeys yet</Text>
            <Text style={s.emptySub}>
              Completed journeys will appear here automatically. / مکمل شدہ سفر یہاں محفوظ ہوں گے۔
            </Text>
          </Card>
        ) : (
          tripHistory.map((trip, idx) => {
            const durationSec = Math.max(0, Math.floor((trip.endedAt - trip.startedAt) / 1000));
            return (
              <Card key={`${trip.startedAt}-${idx}`} style={s.tripCard}>
                <View style={s.tripTop}>
                  <Text style={s.route}>{trip.route}</Text>
                  <Text style={s.date}>{new Date(trip.startedAt).toLocaleString()}</Text>
                </View>
                <View style={s.metrics}>
                  <View style={s.metricItem}>
                    <Text style={s.metricLabel}>DURATION</Text>
                    <Text style={s.metricVal}>{formatDuration(durationSec)}</Text>
                  </View>
                  <View style={s.metricItem}>
                    <Text style={s.metricLabel}>DISTANCE</Text>
                    <Text style={s.metricVal}>{(trip.distanceMeters / 1000).toFixed(2)} km</Text>
                  </View>
                  <View style={s.metricItem}>
                    <Text style={s.metricLabel}>MAX SPEED</Text>
                    <Text style={s.metricVal}>
                      {trip.maxSpeedKmh === null ? '—' : `${trip.maxSpeedKmh} km/h`}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  body: { padding: 20, paddingBottom: 40 },
  back: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 18 },
  backText: { color: C.forest, fontWeight: '800' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 12 },
  title: { fontSize: 28, fontWeight: '900', color: C.text },
  subtitle: { fontSize: 13, color: C.muted, marginTop: 4 },
  clearBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#FCE8E8' },
  clearText: { color: C.red, fontWeight: '800', fontSize: 12 },
  empty: { padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: C.text },
  emptySub: { fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 18 },
  tripCard: { marginBottom: 12, padding: 16 },
  tripTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  route: { fontSize: 16, fontWeight: '900', color: C.forest },
  date: { fontSize: 11, color: C.muted },
  metrics: { flexDirection: 'row', gap: 10 },
  metricItem: { flex: 1, backgroundColor: C.cream, borderRadius: 10, padding: 10 },
  metricLabel: { fontSize: 9, fontWeight: '800', color: C.muted },
  metricVal: { fontSize: 14, fontWeight: '900', color: C.text, marginTop: 4 },
});


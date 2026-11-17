import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icons';
import { Card, PageTitle, Pill } from '../../src/components/UI';
import { useCloud, type RoadInsights } from '../../src/cloud/CloudContext';
import { useJourney } from '../../src/context/JourneyContext';
import { C } from '../../src/theme/colors';

export default function Advisories() {
  const { status, hazards, insights: socketInsights, updatedAt, apiUrl } = useCloud();
  const { startedAt, gpsState, route } = useJourney();
  const [clock, setClock] = useState(Date.now());
  const [polledInsights, setPolledInsights] = useState<RoadInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const journeyActive = Boolean(startedAt) && gpsState === 'tracking';

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!journeyActive || !apiUrl || !/^https?:\/\/[^/]+(?::\d+)?$/i.test(apiUrl)) {
      setPolledInsights(null);
      setInsightsLoading(false);
      return;
    }
    let cancelled = false;
    let controller: AbortController | null = null;
    async function fetchInsights() {
      controller?.abort();
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 8000);
      if (!cancelled) setInsightsLoading(true);
      try {
        const res = await fetch(`${apiUrl}/v1/insights?route=${encodeURIComponent(route)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<RoadInsights>;
        if (
          !cancelled &&
          typeof data.summary_en === 'string' &&
          typeof data.summary_ur === 'string' &&
          typeof data.generatedAt === 'number'
        ) {
          // Informational display only: never triggers voice or vibration alerts.
          setPolledInsights({ summary_en: data.summary_en, summary_ur: data.summary_ur, generatedAt: data.generatedAt });
        }
      } catch {
        // Silent fallback; never disrupts the Advisories screen.
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setInsightsLoading(false);
      }
    }
    void fetchInsights();
    // 15s fallback poll; primary updates arrive instantaneously via Socket.IO insights:update
    const interval = setInterval(() => void fetchInsights(), 15_000);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(interval);
    };
  }, [journeyActive, apiUrl, route]);

  const insights =
    socketInsights && (!polledInsights || socketInsights.generatedAt >= polledInsights.generatedAt)
      ? socketInsights
      : polledInsights;

  const live = status === 'online' && updatedAt !== null && clock - updatedAt < 15_000;
  const feedPillLabel = live
    ? 'LIVE ADVISORIES'
    : status === 'connecting'
      ? 'CONNECTING TO FOGRADAR…'
      : status === 'offline'
        ? 'CLOUD OFFLINE'
        : 'STANDBY';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.cream }} edges={['top']}>
      <ScrollView contentContainerStyle={s.body}>
        <PageTitle
          title="Road Advisories"
          subtitle="Automatic hazard detections and route summaries for your motorway."
        />

        <Card style={s.insightsCard}>
          <View style={s.insightsHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <Icon name="cloud" color={C.emerald} size={22} />
              <Text style={s.insightsTitle}>AI Road Insights ({route})</Text>
            </View>
            <Pill
              label={journeyActive ? (insightsLoading && !insights ? 'LOADING…' : 'LIVE') : 'IDLE'}
              tone={journeyActive ? 'green' : 'amber'}
            />
          </View>
          {journeyActive && insights ? (
            <View style={{ marginTop: 10, gap: 8 }}>
              <Text style={s.insightsText}>{insights.summary_en}</Text>
              <Text style={s.insightsUrdu}>{insights.summary_ur}</Text>
              <Text style={s.insightsMeta}>
                Updated {new Date(insights.generatedAt).toLocaleTimeString()}
              </Text>
            </View>
          ) : (
            <Text style={s.insightsPlaceholder}>
              {!journeyActive
                ? 'Start a journey on the Home tab to receive live route summaries. / روٹ کی معلومات کے لیے سفر شروع کریں۔'
                : 'Connecting to FogRadar for route insights… / روٹ کی معلومات لوڈ ہو رہی ہیں…'}
            </Text>
          )}
        </Card>

        <Pill label={feedPillLabel} tone={live ? 'green' : 'amber'} />

        {live && hazards.length > 0 ? (
          hazards.map(h => (
            <Card style={s.report} key={h.id}>
              <Text style={s.name}>⚠ {h.type}</Text>
              <Text style={s.meta}>
                ~{h.distanceMeters} m ahead · {h.reportCount} confirming vehicles
              </Text>
              <Text style={s.meta}>
                Active until {new Date(h.expiresAt).toLocaleTimeString()}
              </Text>
            </Card>
          ))
        ) : (
          <Card style={s.empty}>
            <Text style={s.name}>
              {live
                ? 'No hazards reported on your route'
                : status === 'connecting'
                  ? 'Connecting to FogRadar…'
                  : status === 'offline'
                    ? 'Cloud offline'
                    : 'Start a journey to view live advisories'}
            </Text>
            <Text style={s.meta}>
              {live
                ? 'آپ کے روٹ پر اس وقت کوئی خطرہ رپورٹ نہیں ہوا۔'
                : status === 'offline'
                  ? 'انٹرنیٹ یا سرور سے رابطہ نہیں ہو سکا۔'
                  : 'لائیو انتباہات دیکھنے کے لیے ہوم ٹیب سے سفر شروع کریں۔'}
            </Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  body: { padding: 20, paddingTop: 25, paddingBottom: 50 },
  insightsCard: { marginBottom: 16, backgroundColor: '#F2FAF5', borderColor: '#CBE6D6' },
  insightsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  insightsTitle: { fontSize: 15, fontWeight: '900', color: C.forest },
  insightsText: { fontSize: 13, lineHeight: 19, color: C.text, fontWeight: '600' },
  insightsUrdu: { fontSize: 13, lineHeight: 21, color: C.forest, fontWeight: '700' },
  insightsMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  insightsPlaceholder: { marginTop: 8, fontSize: 12, lineHeight: 18, color: C.muted },
  report: { marginTop: 14, backgroundColor: '#EDFAF1' },
  empty: { marginTop: 16, padding: 24 },
  name: { fontSize: 16, color: C.text, fontWeight: '900' },
  meta: { fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 18 },
});

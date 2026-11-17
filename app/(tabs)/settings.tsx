import React, { useState } from 'react';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../src/components/Icons';
import { Card, PageTitle, SettingRow } from '../../src/components/UI';
import { useJourney } from '../../src/context/JourneyContext';
import { C } from '../../src/theme/colors';
import { useCloud } from '../../src/cloud/CloudContext';

export default function Settings() {
  const {
    voiceEnabled,
    vibrationEnabled,
    showOncoming,
    tripHistory,
    setVoiceEnabled,
    setVibrationEnabled,
    setShowOncoming,
  } = useJourney();
  const { status, apiUrl } = useCloud();
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.cream }} edges={['top']}>
      <ScrollView contentContainerStyle={s.body}>
        <PageTitle title="Settings" subtitle="Customize FogRadar for your journey." />

        <Card style={s.card}>
          <SettingRow
            icon="sound"
            label="Voice Alerts"
            subtitle="Urdu voice when available, English fallback"
            right={
              <Switch
                value={voiceEnabled}
                onValueChange={setVoiceEnabled}
                trackColor={{ true: '#62D496' }}
                thumbColor="white"
              />
            }
          />
          <SettingRow
            icon="radar"
            label="Vibration Alerts"
            subtitle="Haptic feedback on hazard advisories"
            right={
              <Switch
                value={vibrationEnabled}
                onValueChange={setVibrationEnabled}
                trackColor={{ true: '#62D496' }}
                thumbColor="white"
              />
            }
          />
          <SettingRow
            icon="car"
            label="Show Oncoming Vehicles"
            subtitle="Display opposite-carriageway vehicles on radar"
            right={
              <Switch
                value={showOncoming}
                onValueChange={setShowOncoming}
                trackColor={{ true: '#62D496' }}
                thumbColor="white"
              />
            }
          />
          <SettingRow
            icon="clock"
            label="Trip History"
            subtitle={`${tripHistory.length} saved ${tripHistory.length === 1 ? 'journey' : 'journeys'}`}
            onPress={() => router.push('/trip-history')}
          />
          <SettingRow
            icon="pin"
            label="Location Permission"
            subtitle="Precise location required during active journeys"
            onPress={() => void Linking.openSettings()}
          />
          <SettingRow
            icon="shield"
            label="Data & Privacy"
            subtitle="Anonymous session telemetry shared only while a journey is active"
          />
        </Card>

        <Pressable
          onPress={() => setShowAdvanced(v => !v)}
          style={s.advancedHeader}
        >
          <Text style={s.advancedTitle}>
            {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
          </Text>
        </Pressable>

        {showAdvanced ? (
          <Card style={s.card}>
            <SettingRow
              icon="network"
              label="Server Connection"
              subtitle={apiUrl}
              onPress={() => router.push('/server-connection')}
            />
            <SettingRow
              icon="radar"
              label="GPS Diagnostics"
              subtitle="Inspect speed, accuracy and fix latency"
              onPress={() => router.push('/gps-diagnostics')}
            />
          </Card>
        ) : null}

        <View style={s.about}>
          <Icon name="shield" color={C.emerald} size={28} />
          <Text style={s.aboutTitle}>FogRadar v1.0</Text>
          <Text style={s.aboutText}>Cloud status: {status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  body: { padding: 20, paddingTop: 25, paddingBottom: 40 },
  card: { paddingHorizontal: 16, paddingVertical: 3 },
  advancedHeader: { marginTop: 18, marginBottom: 8, paddingHorizontal: 4 },
  advancedTitle: { fontSize: 13, fontWeight: '800', color: C.muted, letterSpacing: 0.4 },
  about: { alignItems: 'center', marginTop: 32, paddingHorizontal: 22 },
  aboutTitle: { fontSize: 14, fontWeight: '900', color: C.text, marginTop: 10 },
  aboutText: { fontSize: 12, color: C.muted, lineHeight: 19, textAlign: 'center', marginTop: 6 },
});

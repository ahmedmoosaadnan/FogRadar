import React from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../src/components/Icons';
import { Card, Pill } from '../src/components/UI';
import { C } from '../src/theme/colors';

export default function Offline() {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body}>
        <Pressable onPress={() => router.back()} style={s.back}>
          <Icon name="back" color={C.forest} />
          <Text style={s.backText}>Back</Text>
        </Pressable>
        <View style={s.hero}>
          <View style={s.bigIcon}>
            <Icon name="offline" size={50} color={C.forest} />
          </View>
          <Text style={s.title}>Network &amp; Connectivity</Text>
          <Text style={s.desc}>
            FogRadar requires an active internet connection for real-time vehicle radar and hazard advisories.
          </Text>
        </View>
        <Card style={s.card}>
          <Pill label="ONLINE CONNECTION REQUIRED" tone="amber" />
          <Text style={s.cardTitle}>Live Telemetry</Text>
          <Text style={s.cardText}>
            When mobile coverage drops temporarily, FogRadar automatically reconnects as soon as signal returns.
          </Text>
          <Text style={s.cardText}>
            انٹرنیٹ منقطع ہونے کی صورت میں سگنل بحال ہوتے ہی ایپ خودکار طور پر دوبارہ جڑ جائے گی۔
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  body: { padding: 20 },
  back: { flexDirection: 'row', gap: 6, alignItems: 'center', marginVertical: 9 },
  backText: { color: C.forest, fontWeight: '800' },
  hero: { alignItems: 'center', paddingVertical: 30 },
  bigIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: C.pale,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 26, fontWeight: '900', color: C.text, marginTop: 15, textAlign: 'center' },
  desc: { fontSize: 14, textAlign: 'center', lineHeight: 22, color: C.muted, marginTop: 8, maxWidth: 300 },
  card: { marginBottom: 14, gap: 10, padding: 20 },
  cardTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginTop: 5 },
  cardText: { color: C.muted, fontSize: 13, lineHeight: 21 },
});

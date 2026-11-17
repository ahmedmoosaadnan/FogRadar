import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { router } from 'expo-router';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line, Path } from 'react-native-svg';
import { BrandMark } from '../src/components/BrandMark';
import { C } from '../src/theme/colors';
import { Icon } from '../src/components/Icons';

export default function Welcome() {
  const w = Dimensions.get('window').width;
  return (
    <SafeAreaView style={s.page}>
      <StatusBar style="light" />
      <View style={s.top}>
        <Text style={s.eyebrow}>PAKISTAN MOTORWAY SAFETY</Text>
        <Text style={s.muted}>REAL-TIME FOG &amp; TRAFFIC RADAR</Text>
      </View>
      <View style={s.hero}>
        <BrandMark size={130} />
        <Text style={s.name}>FogRadar</Text>
        <Text style={s.tagline}>Early warning. Safer journeys.</Text>
        <Text style={s.intro}>
          Live motorway radar and bilingual road advisories for low-visibility fog conditions.
        </Text>
        <Text style={s.introUr}>دھند میں محفوظ سفر کے لیے لائیو موٹروے ریڈار اور بروقت انتباہ۔</Text>
      </View>
      <View style={[s.road, { width: w }]} pointerEvents="none">
        <Svg width={w} height="180" viewBox="0 0 360 180">
          <Path d="M10 180 155 15 205 15 350 180" fill="#0A6F43" />
          <Line x1="180" y1="25" x2="180" y2="50" stroke="#fff" strokeWidth="3" />
          <Line x1="180" y1="73" x2="180" y2="110" stroke="#fff" strokeWidth="4" />
          <Line x1="180" y1="132" x2="180" y2="180" stroke="#fff" strokeWidth="5" />
        </Svg>
      </View>
      <View style={s.bottom}>
        <Pressable style={s.button} onPress={() => router.replace('/(tabs)/home')}>
          <Text style={s.buttonText}>Get Started</Text>
          <Icon name="arrow" color={C.forest} size={21} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.forest, overflow: 'hidden' },
  top: { alignItems: 'center', paddingTop: 17 },
  eyebrow: { color: '#C0E8CF', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  muted: { color: '#9ABDAA', fontSize: 9, marginTop: 5, letterSpacing: 1.3 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30, paddingBottom: 80, zIndex: 2 },
  name: { color: C.white, fontSize: 43, fontWeight: '900', marginTop: 24, letterSpacing: -2 },
  tagline: { color: C.white, fontSize: 18, fontWeight: '600', marginTop: 4 },
  intro: { color: '#C8E4D4', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 20, maxWidth: 280 },
  introUr: { color: '#A7DFC0', fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 10, maxWidth: 280 },
  road: { position: 'absolute', alignItems: 'center', bottom: 0, opacity: 0.33 },
  bottom: { paddingHorizontal: 26, paddingBottom: 30, zIndex: 2 },
  button: { backgroundColor: C.white, borderRadius: 17, minHeight: 59, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 18 },
  buttonText: { color: C.forest, fontSize: 17, fontWeight: '900' },
});

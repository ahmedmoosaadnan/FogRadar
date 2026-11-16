import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  RoadRadarView,
  ProximityLegend,
  proximityColor,
} from '../../src/components/RoadRadarView';
import { Icon } from '../../src/components/Icons';
import { useJourney } from '../../src/context/JourneyContext';
import { useCloud } from '../../src/cloud/CloudContext';
import { C } from '../../src/theme/colors';
import {
  createHeadingTrackerState,
  updateHeadingTracker,
} from '../../src/utils/roadGeometry';

export default function Radar() {
  const { gpsState, location, startedAt, refreshLocation } = useJourney();
  const {
    status,
    vehicles,
    updatedAt,
    error,
    hazards,
    apiUrl,
    lastUploadAt,
    lastUploadError,
    snapshotReceivedCount,
  } = useCloud();
  const [clock, setClock] = useState(Date.now());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const trackerRef = useRef(createHeadingTrackerState());
  const [headingState, setHeadingState] = useState<{
    effectiveHeading: number | null;
    yawRateDegPerSec: number;
  }>({ effectiveHeading: null, yawRateDegPerSec: 0 });

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const fixAge = location ? Math.max(0, clock - location.timestamp) : null;
  const freshFix = gpsState === 'tracking' && location !== null && fixAge !== null && fixAge <= 15000;
  const feedAge = updatedAt ? Math.max(0, clock - updatedAt) : null;
  const freshFeed = status === 'online' && updatedAt !== null && feedAge !== null && feedAge <= 15000 && freshFix;
  const liveVehicles = freshFeed ? vehicles : [];
  const liveHazards = freshFeed ? hazards : [];
  const ownAccuracy = freshFix ? location?.accuracyMeters ?? null : null;

  useEffect(() => {
    if (!freshFix || !location) {
      const res = updateHeadingTracker(trackerRef.current, {
        speedMps: null,
        headingDeg: null,
        accuracyMeters: null,
        now: Date.now(),
      });
      trackerRef.current = res.state;
      setHeadingState({
        effectiveHeading: res.effectiveHeading,
        yawRateDegPerSec: res.yawRateDegPerSec,
      });
      return;
    }

    const res = updateHeadingTracker(trackerRef.current, {
      speedMps: location.speedKmh !== null ? location.speedKmh / 3.6 : null,
      headingDeg: location.heading,
      accuracyMeters: location.accuracyMeters,
      now: Date.now(),
    });
    trackerRef.current = res.state;
    setHeadingState({
      effectiveHeading: res.effectiveHeading,
      yawRateDegPerSec: res.yawRateDegPerSec,
    });
  }, [freshFix, location, clock]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Live Radar</Text>
            <Text style={s.sub}>Tesla-style Road View · 1 km</Text>
          </View>
          <View style={s.range}>
            <Text style={s.rangeText}>1.0 km</Text>
            <Text style={s.rangeSub}>RANGE</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/server-connection')}
          style={[s.banner, { backgroundColor: freshFeed ? '#C2F7D4' : C.gold }]}
        >
          <Text style={s.bannerText}>
            {freshFeed
              ? '● LIVE GPS + CLOUD'
              : '● ' +
                (status === 'not-configured'
                  ? 'SERVER URL MISSING'
                  : !startedAt
                    ? 'START JOURNEY'
                    : status === 'online'
                      ? 'WAITING FOR FRESH GPS'
                      : status.toUpperCase())}{' '}
            · SETUP ›
          </Text>
        </Pressable>

        {freshFeed && liveHazards.length > 0 ? (
          <View style={s.hazardBanner}>
            <Icon name="alert" color="white" size={22} />
            <View style={{ flex: 1 }}>
              <Text style={s.hazardHeading}>UNVERIFIED HAZARD REPORT</Text>
              <Text style={s.hazardLabel}>
                {liveHazards[0].type} · about {liveHazards[0].distanceMeters} m · FIELD TEST
              </Text>
            </View>
          </View>
        ) : null}

        <RoadRadarView
          vehicles={liveVehicles}
          hazards={liveHazards}
          effectiveHeading={headingState.effectiveHeading}
          ownAccuracy={ownAccuracy}
          yawRateDegPerSec={headingState.yawRateDegPerSec}
        />
        <ProximityLegend />

        <View style={s.cardRow}>
          <View style={s.dataCard}>
            <Icon name="car" color="#34D399" />
            <Text style={s.dataValue}>{freshFeed ? liveVehicles.length : '—'}</Text>
            <Text style={s.dataLabel}>Nearby phones</Text>
          </View>
          <View style={s.dataCard}>
            <Icon name="radar" color="#34D399" />
            <Text style={s.dataValue}>
              {freshFix && location?.speedKmh != null ? location.speedKmh : '—'} km/h
            </Text>
            <Text style={s.dataLabel}>Real GPS speed</Text>
          </View>
          <View style={s.dataCard}>
            <Icon name="road" color="#34D399" />
            <Text style={s.dataValue}>
              {headingState.effectiveHeading !== null
                ? `${Math.round(headingState.effectiveHeading)}°`
                : 'Unknown'}
            </Text>
            <Text style={s.dataLabel}>Travel heading</Text>
          </View>
        </View>

        {liveVehicles.length > 0 ? (
          <View style={s.listCard}>
            <Text style={s.listTitle}>
              Nearby connected devices ({liveVehicles.length})
            </Text>
            {liveVehicles.slice(0, 12).map((v, index) => {
              const cat = proximityColor(v.distanceMeters, ownAccuracy, v.accuracyMeters);
              const color = {
                red: '#EF4444',
                yellow: '#FBBF24',
                green: '#34D399',
                uncertain: '#94A3B8',
              }[cat];
              return (
                <View key={v.id} style={s.row}>
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <Text style={s.rowName}>Phone {index + 1}</Text>
                  <Text style={s.rowDistance}>{v.distanceMeters} m</Text>
                  <Text style={s.rowMeta}>
                    ±{Math.round((ownAccuracy ?? 0) + v.accuracyMeters)} m · {v.speedKmh ?? '—'} km/h
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={s.subnote}>
            {freshFeed
              ? 'No other connected phones within 1 km on this test route.'
              : 'No validated live radar feed. Open Server Connection / GPS Diagnostics.'}
          </Text>
        )}

        {/* Collapsible Advanced diagnostics (collapsed by default) */}
        <Pressable
          onPress={() => setShowAdvanced(v => !v)}
          style={s.advancedToggle}
        >
          <Text style={s.advancedToggleText}>
            {showAdvanced ? '▾ Hide Advanced Diagnostics' : '▸ Advanced Diagnostics'}
          </Text>
        </Pressable>

        {showAdvanced ? (
          <View style={s.advancedBox}>
            <Text style={s.advancedText}>
              Snapshot: {feedAge === null ? 'none' : `${(feedAge / 1000).toFixed(1)}s old`} · Received: {snapshotReceivedCount} · Drawn: {liveVehicles.length}
            </Text>
            <Text style={s.advancedText}>
              GPS: {fixAge === null ? 'no fix' : `${(fixAge / 1000).toFixed(1)}s old`} · Accuracy ±{ownAccuracy ?? '—'}m · Radar: {feedAge === null ? 'none' : `${(feedAge / 1000).toFixed(1)}s old`}
            </Text>
            <Text style={s.advancedText}>
              Last GPS server upload: {lastUploadAt ? new Date(lastUploadAt).toLocaleTimeString() : 'Not accepted yet'}
            </Text>
          </View>
        ) : null}

        {gpsState === 'tracking' && !freshFix ? (
          <Pressable onPress={() => void refreshLocation()} style={s.link}>
            <Text style={s.linkText}>Retry GPS fix (outdoors / Precise Location enabled)</Text>
          </Pressable>
        ) : null}
        {error ? <Text style={s.error}>Cloud: {error}</Text> : null}
        {lastUploadError ? <Text style={s.error}>Upload: {lastUploadError}</Text> : null}
        {!apiUrl ? (
          <Text style={s.error}>EXPO_PUBLIC_API_URL missing. Open Server Connection to enter URL.</Text>
        ) : null}

        <Text style={s.disclaimer}>
          Distance is between GPS estimates, NOT vehicle bumpers. GPS error, direction, and lanes are unresolved. Color means rough proximity only; not safe/unsafe guidance. Connected phones only. Do not depend on this field-test system while driving.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#060B10' },
  body: { padding: 14, paddingBottom: 38 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 26 },
  sub: { color: '#94A3B8', fontSize: 12, marginTop: 3 },
  range: { alignItems: 'flex-end' },
  rangeText: { fontWeight: '900', color: '#34D399', fontSize: 18 },
  rangeSub: { fontSize: 9, color: '#94A3B8', letterSpacing: 1 },
  banner: { padding: 10, borderRadius: 25, alignItems: 'center', alignSelf: 'center', marginBottom: 12 },
  bannerText: { fontSize: 10, color: '#19472B', fontWeight: '900', letterSpacing: 0.3 },
  hazardBanner: {
    backgroundColor: '#991B1B',
    borderRadius: 14,
    padding: 13,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hazardHeading: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  hazardLabel: { fontSize: 11, color: '#FEE2E2', marginTop: 3 },
  cardRow: { flexDirection: 'row', gap: 8, marginTop: 15 },
  dataCard: {
    flex: 1,
    backgroundColor: '#0D1722',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 15,
    padding: 12,
    alignItems: 'center',
    gap: 6,
  },
  dataValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  dataLabel: { color: '#94A3B8', fontSize: 10, textAlign: 'center' },
  disclaimer: { color: '#64748B', fontSize: 11.5, lineHeight: 18, textAlign: 'center', marginTop: 20 },
  subnote: { textAlign: 'center', color: '#CBD5E1', fontSize: 12, marginTop: 14 },
  error: { color: '#FCA5A5', fontSize: 12, textAlign: 'center', marginTop: 12 },
  listCard: {
    backgroundColor: '#0D1722',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginTop: 12,
  },
  listTitle: { fontWeight: '800', color: '#FFFFFF', fontSize: 13, marginBottom: 5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderColor: '#1E293B',
  },
  dot: { width: 11, height: 11, borderRadius: 6 },
  rowName: { fontSize: 13, color: '#FFFFFF', fontWeight: '800', minWidth: 64 },
  rowDistance: { fontSize: 15, color: '#FFFFFF', fontWeight: '900' },
  rowMeta: { flex: 1, fontSize: 11, color: '#94A3B8', textAlign: 'right' },
  advancedToggle: {
    marginTop: 14,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#0D1722',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  advancedToggleText: { color: '#94A3B8', fontSize: 11, fontWeight: '800' },
  advancedBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0D1722',
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 4,
  },
  advancedText: { color: '#CBD5E1', fontSize: 11, textAlign: 'center' },
  link: { marginTop: 14, alignItems: 'center', padding: 12, backgroundColor: '#175E42', borderRadius: 12 },
  linkText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
});

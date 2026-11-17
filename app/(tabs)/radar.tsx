import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import {
  formatVehicleDistance,
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
  type HeadingSource,
} from '../../src/utils/roadGeometry';

const TAB_BAR_HEIGHT = 66;

export default function Radar() {
  const insets = useSafeAreaInsets();
  const { gpsState, location, startedAt, refreshLocation, showOncoming } = useJourney();
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

  const compassRef = useRef<number | null>(null);
  const trackerRef = useRef(createHeadingTrackerState());
  const [headingState, setHeadingState] = useState<{
    effectiveHeading: number | null;
    source: HeadingSource;
    yawRateDegPerSec: number;
  }>({ effectiveHeading: null, source: 'unknown', yawRateDegPerSec: 0 });

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // Native-only device compass fallback via expo-location watchHeadingAsync
  useEffect(() => {
    if (Platform.OS === 'web' || gpsState !== 'tracking') {
      compassRef.current = null;
      return;
    }
    let active = true;
    let sub: Location.LocationSubscription | null = null;
    void Location.watchHeadingAsync(h => {
      if (!active) return;
      const heading =
        Number.isFinite(h.trueHeading) && h.trueHeading >= 0
          ? h.trueHeading
          : Number.isFinite(h.magHeading) && h.magHeading >= 0
            ? h.magHeading
            : null;
      compassRef.current = heading;
    })
      .then(subscription => {
        if (!active) subscription.remove();
        else sub = subscription;
      })
      .catch(() => {
        compassRef.current = null;
      });
    return () => {
      active = false;
      sub?.remove();
      compassRef.current = null;
    };
  }, [gpsState]);

  const fixAge = location ? Math.max(0, clock - location.timestamp) : null;
  const freshFix = gpsState === 'tracking' && location !== null && fixAge !== null && fixAge <= 15000;
  const feedAge = updatedAt ? Math.max(0, clock - updatedAt) : null;
  const freshFeed = status === 'online' && updatedAt !== null && feedAge !== null && feedAge <= 15000 && freshFix;
  const liveVehicles = freshFeed ? vehicles : [];
  const liveHazards = freshFeed ? hazards : [];
  const ownAccuracy = freshFix ? location?.accuracyMeters ?? null : null;

  useEffect(() => {
    const compassHeadingDeg = Platform.OS === 'web' ? null : compassRef.current;
    if (!freshFix || !location) {
      const res = updateHeadingTracker(trackerRef.current, {
        speedMps: null,
        headingDeg: null,
        accuracyMeters: null,
        compassHeadingDeg,
        now: Date.now(),
      });
      trackerRef.current = res.state;
      setHeadingState({
        effectiveHeading: res.effectiveHeading,
        source: res.source,
        yawRateDegPerSec: res.yawRateDegPerSec,
      });
      return;
    }

    const res = updateHeadingTracker(trackerRef.current, {
      speedMps: location.speedKmh !== null ? location.speedKmh / 3.6 : null,
      headingDeg: location.heading,
      accuracyMeters: location.accuracyMeters,
      compassHeadingDeg,
      now: Date.now(),
    });
    trackerRef.current = res.state;
    setHeadingState({
      effectiveHeading: res.effectiveHeading,
      source: res.source,
      yawRateDegPerSec: res.yawRateDegPerSec,
    });
  }, [freshFix, location, clock]);

  const statusLabel = freshFeed
    ? '● LIVE · Cloud connected'
    : status === 'not-configured'
      ? '● Server URL missing'
      : !startedAt
        ? '● Journey not started'
        : status === 'connecting'
          ? '● Connecting to cloud…'
          : status === 'online'
            ? '● Waiting for fresh GPS'
            : '● Cloud offline';

  const headingChipLabel =
    headingState.source === 'gps'
      ? 'Heading: GPS'
      : headingState.source === 'compass'
        ? 'Heading: Compass'
        : 'Heading: Unknown';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[s.body, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <View>
            <Text style={s.title}>Live Radar</Text>
            <Text style={s.sub}>Top-Down Road View · 1 km</Text>
          </View>
          <View style={s.range}>
            <Text style={s.rangeText}>1.0 km</Text>
            <Text style={s.rangeSub}>RANGE</Text>
          </View>
        </View>

        <View style={s.chipRow}>
          <Pressable
            onPress={() => router.push('/server-connection')}
            style={[s.banner, { backgroundColor: freshFeed ? '#064E3B' : '#451A03', borderColor: freshFeed ? '#10B981' : '#F59E0B' }]}
          >
            <Text style={[s.bannerText, { color: freshFeed ? '#A7F3D0' : '#FDE68A' }]}>{statusLabel}</Text>
          </Pressable>
          <View
            style={[
              s.headingChip,
              {
                borderColor:
                  headingState.source === 'gps'
                    ? '#10B981'
                    : headingState.source === 'compass'
                      ? '#F59E0B'
                      : '#475569',
              },
            ]}
          >
            <Text
              style={[
                s.headingChipText,
                {
                  color:
                    headingState.source === 'gps'
                      ? '#6EE7B7'
                      : headingState.source === 'compass'
                        ? '#FDE68A'
                        : '#94A3B8',
                },
              ]}
            >
              {headingChipLabel}
            </Text>
          </View>
        </View>

        {freshFeed && liveHazards.length > 0 ? (
          <View style={s.hazardBanner}>
            <Icon name="alert" color="white" size={22} />
            <View style={{ flex: 1 }}>
              <Text style={s.hazardHeading}>HAZARD DETECTED AHEAD</Text>
              <Text style={s.hazardLabel}>
                {liveHazards[0].type} · about {liveHazards[0].distanceMeters} m
              </Text>
            </View>
          </View>
        ) : null}

        <RoadRadarView
          vehicles={liveVehicles}
          hazards={liveHazards}
          effectiveHeading={headingState.effectiveHeading}
          headingSource={headingState.source}
          ownAccuracy={ownAccuracy}
          yawRateDegPerSec={headingState.yawRateDegPerSec}
          showOncoming={showOncoming}
        />
        <ProximityLegend />

        <View style={s.cardRow}>
          <View style={s.dataCard}>
            <Icon name="car" color="#34D399" />
            <Text style={s.dataValue}>{freshFeed ? liveVehicles.length : '—'}</Text>
            <Text style={s.dataLabel}>Nearby vehicles</Text>
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

        <View style={s.listCard}>
          <Text style={s.listTitle}>
            Nearby vehicles {freshFeed ? `(${liveVehicles.length})` : ''}
          </Text>
          {liveVehicles.length > 0 ? (
            liveVehicles.slice(0, 12).map((v, index) => {
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
                  <Text style={s.rowName}>Vehicle {index + 1}</Text>
                  <Text style={s.rowDistance}>{formatVehicleDistance(v.distanceMeters)}</Text>
                  <Text style={s.rowMeta}>
                    {v.speedKmh ?? '—'} km/h · ±{v.accuracyMeters} m · {(v.ageMs / 1000).toFixed(1)}s
                  </Text>
                </View>
              );
            })
          ) : (
            <Text style={s.emptyListText}>
              {freshFeed
                ? 'No other FogRadar vehicles within 1 km'
                : 'Waiting for live GPS and cloud connection.'}
            </Text>
          )}
        </View>

        {/* Collapsible Advanced diagnostics (collapsed by default) */}
        <Pressable onPress={() => setShowAdvanced(v => !v)} style={s.advancedToggle}>
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
          Distance is between GPS estimates. Unconnected vehicles are not visible. Color indicates proximity zone only.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#060B10' },
  body: { padding: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { color: '#FFFFFF', fontWeight: '900', fontSize: 26 },
  sub: { color: '#94A3B8', fontSize: 12, marginTop: 3 },
  range: { alignItems: 'flex-end' },
  rangeText: { fontWeight: '900', color: '#34D399', fontSize: 18 },
  rangeSub: { fontSize: 9, color: '#94A3B8', letterSpacing: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 12 },
  banner: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  bannerText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  headingChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: '#0D1722', borderWidth: 1 },
  headingChipText: { fontSize: 11, fontWeight: '800' },
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
  cardRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
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
  disclaimer: { color: '#64748B', fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 16 },
  error: { color: '#FCA5A5', fontSize: 12, textAlign: 'center', marginTop: 12 },
  listCard: {
    backgroundColor: '#0D1722',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
  },
  listTitle: { fontWeight: '800', color: '#FFFFFF', fontSize: 13, marginBottom: 6 },
  emptyListText: { color: '#94A3B8', fontSize: 12, paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderColor: '#1E293B',
  },
  dot: { width: 11, height: 11, borderRadius: 6 },
  rowName: { fontSize: 13, color: '#FFFFFF', fontWeight: '800', minWidth: 74 },
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

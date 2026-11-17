import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { Accelerometer, Magnetometer } from 'expo-sensors';
import {
  formatVehicleDistance,
  RoadRadarView,
  ProximityLegend,
  proximityColor,
} from '../../src/components/RoadRadarView';
import { Icon } from '../../src/components/Icons';
import { useJourney } from '../../src/context/JourneyContext';
import { useCloud } from '../../src/cloud/CloudContext';
import {
  createHeadingTrackerState,
  updateHeadingTracker,
  type HeadingSource,
} from '../../src/utils/roadGeometry';
import { computeTiltCompensatedHeading, type Vec3 } from '../../src/utils/compassFallback';
import { computeDataAgeMs } from '../../src/utils/deadReckoning';

const TAB_BAR_HEIGHT = 66;

type HeadingDebugInfo = {
  permStatus: string;
  permAccuracy: string;
  watchActive: boolean;
  sensorFallbackActive: boolean;
  watchError: string | null;
  rawTrueHeading: number | null;
  rawMagHeading: number | null;
  rawAccuracy: number | null;
  rawTimestamp: number | null;
};

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
    gpsToServerMs,
    serverToClientMs,
    clockOffsetMs,
  } = useCloud();
  const [clock, setClock] = useState(Date.now());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showHeadingDebug, setShowHeadingDebug] = useState(false);

  const compassRef = useRef<{ heading: number | null; uncalibrated: boolean }>({
    heading: null,
    uncalibrated: false,
  });
  const trackerRef = useRef(createHeadingTrackerState());
  const [compassTick, setCompassTick] = useState(0);
  const [compassUncalibrated, setCompassUncalibrated] = useState(false);
  const [headingDebug, setHeadingDebug] = useState<HeadingDebugInfo>({
    permStatus: Platform.OS === 'web' ? 'web' : 'checking…',
    permAccuracy: 'unknown',
    watchActive: false,
    sensorFallbackActive: false,
    watchError: null,
    rawTrueHeading: null,
    rawMagHeading: null,
    rawAccuracy: null,
    rawTimestamp: null,
  });

  const [headingState, setHeadingState] = useState<{
    effectiveHeading: number | null;
    source: HeadingSource;
    yawRateDegPerSec: number;
  }>({ effectiveHeading: null, source: 'unknown', yawRateDegPerSec: 0 });

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // Start device compass as soon as Radar screen mounts (native only; on web keep heading unknown)
  useEffect(() => {
    if (Platform.OS === 'web') {
      compassRef.current = { heading: null, uncalibrated: false };
      setHeadingDebug(prev => ({
        ...prev,
        permStatus: 'web',
        permAccuracy: 'n/a',
        watchActive: false,
        sensorFallbackActive: false,
      }));
      return;
    }

    let active = true;
    let headingSub: Location.LocationSubscription | null = null;
    let magSub: { remove: () => void } | null = null;
    let accelSub: { remove: () => void } | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let gotWatchHeading = false;
    let lastAccel: Vec3 | null = null;

    const startSensorFallback = () => {
      if (!active || gotWatchHeading) return;
      try {
        Accelerometer.setUpdateInterval(200);
        Magnetometer.setUpdateInterval(200);
        accelSub = Accelerometer.addListener(data => {
          lastAccel = data;
        });
        magSub = Magnetometer.addListener(mag => {
          if (!active || gotWatchHeading) return;
          const computed = computeTiltCompensatedHeading(mag, lastAccel);
          if (computed !== null) {
            compassRef.current = { heading: computed, uncalibrated: true };
            setCompassUncalibrated(true);
            setCompassTick(t => (t + 1) % 100000);
            setHeadingDebug(prev => ({
              ...prev,
              sensorFallbackActive: true,
              rawMagHeading: Math.round(computed),
              rawAccuracy: 0,
              rawTimestamp: Date.now(),
            }));
          }
        });
        setHeadingDebug(prev => ({ ...prev, sensorFallbackActive: true }));
      } catch (e) {
        if (active) {
          setHeadingDebug(prev => ({
            ...prev,
            watchError: `Sensors: ${e instanceof Error ? e.message : 'unavailable'}`,
          }));
        }
      }
    };

    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (!active) return;

        const permAny = perm as unknown as {
          status: string;
          android?: { accuracy?: string };
          ios?: { scope?: string };
        };
        const accuracyScope =
          permAny.android?.accuracy ?? permAny.ios?.scope ?? (perm.granted ? 'granted' : 'denied');
        setHeadingDebug(prev => ({
          ...prev,
          permStatus: perm.status,
          permAccuracy: String(accuracyScope),
        }));

        if (perm.status !== 'granted') {
          setHeadingDebug(prev => ({
            ...prev,
            watchActive: false,
            watchError: 'Foreground location permission not granted',
          }));
          return;
        }

        // Fallback to expo-sensors if watchHeadingAsync yields nothing within 5 seconds
        fallbackTimer = setTimeout(startSensorFallback, 5000);

        const sub = await Location.watchHeadingAsync(h => {
          if (!active) return;
          const rawTrue = Number.isFinite(h.trueHeading) ? h.trueHeading : null;
          const rawMag = Number.isFinite(h.magHeading) ? h.magHeading : null;
          const rawAcc = Number.isFinite(h.accuracy) ? h.accuracy : null;

          // trueHeading is -1 when unavailable -> fall back to magHeading
          const chosen =
            rawTrue !== null && rawTrue >= 0
              ? rawTrue
              : rawMag !== null && rawMag >= 0
                ? rawMag
                : null;

          if (chosen !== null) {
            gotWatchHeading = true;
            if (fallbackTimer) {
              clearTimeout(fallbackTimer);
              fallbackTimer = null;
            }
            magSub?.remove();
            magSub = null;
            accelSub?.remove();
            accelSub = null;

            // accuracy <= 0 means uncalibrated: still use it, mark uncalibrated
            const uncal = rawAcc === null || rawAcc <= 0;
            compassRef.current = { heading: chosen, uncalibrated: uncal };
            setCompassUncalibrated(uncal);
            setCompassTick(t => (t + 1) % 100000);
            setHeadingDebug(prev => ({
              ...prev,
              watchActive: true,
              sensorFallbackActive: false,
              watchError: null,
              rawTrueHeading: rawTrue,
              rawMagHeading: rawMag,
              rawAccuracy: rawAcc,
              rawTimestamp: Date.now(),
            }));
          }
        });

        if (!active) {
          sub.remove();
          return;
        }
        headingSub = sub;
        setHeadingDebug(prev => ({ ...prev, watchActive: true, watchError: null }));
      } catch (e) {
        if (!active) return;
        setHeadingDebug(prev => ({
          ...prev,
          watchActive: false,
          watchError: e instanceof Error ? e.message : 'watchHeadingAsync failed',
        }));
        startSensorFallback();
      }
    })();

    return () => {
      active = false;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      headingSub?.remove();
      magSub?.remove();
      accelSub?.remove();
      compassRef.current = { heading: null, uncalibrated: false };
    };
  }, []);

  const fixAge = location ? Math.max(0, clock - location.timestamp) : null;
  const freshFix = gpsState === 'tracking' && location !== null && fixAge !== null && fixAge <= 15000;
  const feedAge = updatedAt ? Math.max(0, clock - updatedAt) : null;
  const freshFeed = status === 'online' && updatedAt !== null && feedAge !== null && feedAge <= 15000 && freshFix;
  const liveVehicles = freshFeed ? vehicles : [];
  const liveHazards = freshFeed ? hazards : [];
  const ownAccuracy = freshFix ? location?.accuracyMeters ?? null : null;

  useEffect(() => {
    const compassHeadingDeg = Platform.OS === 'web' ? null : compassRef.current.heading;
    const speedMps =
      freshFix && location && location.speedKmh !== null ? location.speedKmh / 3.6 : null;
    const gpsHeadingDeg = freshFix && location ? location.heading : null;
    const gpsAcc = freshFix && location ? location.accuracyMeters : null;

    const res = updateHeadingTracker(trackerRef.current, {
      speedMps,
      headingDeg: gpsHeadingDeg,
      accuracyMeters: gpsAcc,
      compassHeadingDeg,
      now: Date.now(),
    });
    trackerRef.current = res.state;
    setHeadingState({
      effectiveHeading: res.effectiveHeading,
      source: res.source,
      yawRateDegPerSec: res.yawRateDegPerSec,
    });
  }, [freshFix, location, clock, compassTick]);

  const statusLabel = freshFeed
    ? '● LIVE · Cloud connected'
    : status === 'not-configured'
      ? '● Server URL missing'
      : !startedAt
        ? '● Journey not started'
        : status === 'connecting'
          ? '● Connecting to FogRadar…'
          : status === 'online'
            ? '● Waiting for fresh GPS'
            : '● Cloud offline';

  const headingChipLabel =
    headingState.source === 'gps'
      ? 'Heading: GPS'
      : headingState.source === 'compass'
        ? compassUncalibrated
          ? 'Heading: Compass (uncalibrated)'
          : 'Heading: Compass'
        : 'Heading: Unknown';

  const unknownReason =
    headingState.source !== 'unknown'
      ? null
      : Platform.OS === 'web'
        ? 'Web browser (compass disabled; move ≥ 3 m/s for GPS course)'
        : headingDebug.permStatus !== 'granted'
          ? `Permission ${headingDebug.permStatus}`
          : headingDebug.watchError
            ? headingDebug.watchError
            : 'Waiting for compass or GPS course (≥ 3 m/s)';

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
            style={[
              s.banner,
              {
                backgroundColor: freshFeed ? '#064E3B' : '#451A03',
                borderColor: freshFeed ? '#10B981' : '#F59E0B',
              },
            ]}
          >
            <Text style={[s.bannerText, { color: freshFeed ? '#A7F3D0' : '#FDE68A' }]}>
              {statusLabel}
            </Text>
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

        {headingState.source === 'compass' && compassUncalibrated ? (
          <Text style={s.calHint}>Move phone in a figure-8 to calibrate compass</Text>
        ) : null}

        {freshFeed && liveHazards.length > 0 ? (
          <View style={s.hazardBanner}>
            <Icon name="alert" color="white" size={22} />
            <View style={{ flex: 1 }}>
              <Text style={s.hazardHeading}>
                HAZARD AHEAD · {formatVehicleDistance(liveHazards[0].distanceMeters)}
              </Text>
              <Text style={s.hazardLabel}>
                {liveHazards[0].type} · {liveHazards[0].reportCount} confirming vehicles
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
          ownSpeedKmh={freshFix && location?.speedKmh != null ? location.speedKmh : null}
          yawRateDegPerSec={headingState.yawRateDegPerSec}
          showOncoming={showOncoming}
          clockOffsetMs={clockOffsetMs}
        />
        <ProximityLegend />

        <View style={s.cardRow}>
          <View style={[s.dataCard, s.speedHudCard]}>
            <Text style={s.speedHudValue}>
              {freshFix && location?.speedKmh != null ? location.speedKmh : '—'}
            </Text>
            <Text style={s.speedHudUnit}>km/h · OWN SPEED</Text>
          </View>
          <View style={s.dataCard}>
            <Icon name="car" color="#34D399" />
            <Text style={s.dataValue}>{freshFeed ? liveVehicles.length : '—'}</Text>
            <Text style={s.dataLabel}>Vehicles in range</Text>
          </View>
          <View style={s.dataCard}>
            <Icon name="road" color="#34D399" />
            <Text style={s.dataValue}>
              {headingState.effectiveHeading !== null
                ? `${Math.round(headingState.effectiveHeading)}°`
                : 'Unknown'}
            </Text>
            <Text style={s.dataLabel}>Heading</Text>
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
              const dataAgeMs = computeDataAgeMs(v.fixTime, clock, clockOffsetMs) ?? v.ageMs;
              return (
                <View key={v.id} style={s.row}>
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <Text style={s.rowName}>Vehicle {index + 1}</Text>
                  <Text style={s.rowDistance}>{formatVehicleDistance(v.distanceMeters)}</Text>
                  <Text style={s.rowMeta}>
                    {v.speedKmh ?? '—'} km/h · ±{v.accuracyMeters} m · {(dataAgeMs / 1000).toFixed(1)}s age
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
              GPS→Server: {gpsToServerMs === null ? '—' : `${gpsToServerMs} ms`} · Server→Client: {serverToClientMs === null ? '—' : `${serverToClientMs} ms`} · Offset: {clockOffsetMs} ms
            </Text>
            <Text style={s.advancedText}>
              GPS: {fixAge === null ? 'no fix' : `${(fixAge / 1000).toFixed(1)}s old`} · Accuracy ±{ownAccuracy ?? '—'}m · Radar: {feedAge === null ? 'none' : `${(feedAge / 1000).toFixed(1)}s old`}
            </Text>
            <Text style={s.advancedText}>
              Last GPS server upload: {lastUploadAt ? new Date(lastUploadAt).toLocaleTimeString() : 'Not accepted yet'}
            </Text>

            <Pressable onPress={() => setShowHeadingDebug(v => !v)} style={s.subDebugToggle}>
              <Text style={s.subDebugToggleText}>
                {showHeadingDebug ? '▾ Heading debug' : '▸ Heading debug'}
              </Text>
            </Pressable>

            {showHeadingDebug ? (
              <View style={s.subDebugBox}>
                <Text style={s.debugLine}>
                  Platform: {Platform.OS} {String(Platform.Version)}
                </Text>
                <Text style={s.debugLine}>
                  Permission: {headingDebug.permStatus} ({headingDebug.permAccuracy})
                </Text>
                <Text style={s.debugLine}>
                  watchHeadingAsync: {headingDebug.watchActive ? 'active' : 'inactive'} · sensorFallback: {headingDebug.sensorFallbackActive ? 'active' : 'off'}
                </Text>
                {headingDebug.watchError ? (
                  <Text style={s.debugError}>Compass error: {headingDebug.watchError}</Text>
                ) : null}
                <Text style={s.debugLine}>
                  Raw compass: true={headingDebug.rawTrueHeading ?? '—'} · mag={headingDebug.rawMagHeading ?? '—'} · acc={headingDebug.rawAccuracy ?? '—'} · {headingDebug.rawTimestamp ? new Date(headingDebug.rawTimestamp).toLocaleTimeString() : 'no sample'}
                </Text>
                <Text style={s.debugLine}>
                  GPS course={location?.heading ?? '—'}° · speed={location?.speedKmh ?? '—'} km/h · acc=±{location?.accuracyMeters ?? '—'}m
                </Text>
                <Text style={s.debugLine}>
                  Chosen source: {headingState.source === 'compass' && compassUncalibrated ? 'compass (uncalibrated)' : headingState.source}
                  {unknownReason ? ` (${unknownReason})` : ''}
                </Text>
              </View>
            ) : null}
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 8 },
  banner: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  bannerText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  headingChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: '#0D1722', borderWidth: 1 },
  headingChipText: { fontSize: 11, fontWeight: '800' },
  calHint: { color: '#FDE68A', fontSize: 11, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
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
  dataValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  dataLabel: { color: '#94A3B8', fontSize: 10, textAlign: 'center' },
  speedHudCard: { justifyContent: 'center', borderColor: '#10B981', backgroundColor: '#091922' },
  speedHudValue: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', letterSpacing: -1 },
  speedHudUnit: { color: '#6EE7B7', fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
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
  subDebugToggle: { marginTop: 8, alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 10 },
  subDebugToggleText: { color: '#93C5FD', fontSize: 11, fontWeight: '800' },
  subDebugBox: {
    marginTop: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#070D14',
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 3,
  },
  debugLine: { color: '#94A3B8', fontSize: 10.5 },
  debugError: { color: '#FCA5A5', fontSize: 10.5 },
  link: { marginTop: 14, alignItems: 'center', padding: 12, backgroundColor: '#175E42', borderRadius: 12 },
  linkText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
});

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';

type GPSState = 'idle' | 'requesting' | 'tracking' | 'denied' | 'error';
export type Telemetry = {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number | null;
  timestamp: number; // GNSS / OS fix timestamp
  receivedAt: number; // When JavaScript received the callback
};
export type TripSummary = {
  route: string;
  startedAt: number;
  endedAt: number;
  distanceMeters: number;
  maxSpeedKmh: number | null;
  gpsSamples: number;
};
export type HazardType = 'Stopped traffic' | 'Accident' | 'Heavy fog' | 'Vehicle breakdown';
export type TestHazardReport = {
  id: string;
  type: HazardType;
  route: string;
  createdAt: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  status: 'local-test-only';
};

type JourneyState = {
  gpsState: GPSState;
  location: Telemetry | null;
  error: string | null;
  route: string;
  voiceEnabled: boolean;
  vibrationEnabled: boolean;
  startedAt: number | null;
  distanceMeters: number;
  gpsSamples: number;
  lastTrip: TripSummary | null;
  testReports: TestHazardReport[];
  setRoute: (v: string) => void;
  setVoiceEnabled: (v: boolean) => void;
  setVibrationEnabled: (v: boolean) => void;
  startJourney: () => Promise<boolean>;
  stopJourney: () => void;
  refreshLocation: () => Promise<boolean>;
  createTestReport: (type: HazardType) => boolean;
  clearTestReports: () => void;
};
const JourneyContext = createContext<JourneyState | null>(null);

function metersBetween(a: Telemetry, b: Telemetry): number {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function JourneyProvider({ children }: { children: React.ReactNode }) {
  const [gpsState, setGpsState] = useState<GPSState>('idle');
  const [location, setLocation] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState('M-2 Motorway');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [gpsSamples, setGpsSamples] = useState(0);
  const [lastTrip, setLastTrip] = useState<TripSummary | null>(null);
  const [testReports, setTestReports] = useState<TestHazardReport[]>([]);

  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const activeRef = useRef(false);
  const generationRef = useRef(0);
  const lastFixRef = useRef<Telemetry | null>(null);
  const distanceRef = useRef(0);
  const samplesRef = useRef(0);
  const maxSpeedRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const routeRef = useRef(route);
  const latestFixRef = useRef<Telemetry | null>(null);
  routeRef.current = route;

  const applyLocation = useCallback((point: Location.LocationObject) => {
    if (!activeRef.current) return;
    const { latitude, longitude, speed, heading, accuracy } = point.coords;
    const receivedAt = Date.now();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    // Reject unusable fixes; clamp slightly stale OS cached timestamps during stationary tracking.
    if (!Number.isFinite(point.timestamp)) return;
    const effectiveTimestamp = Math.min(receivedAt, Math.max(point.timestamp, receivedAt - 4000));
    const fix: Telemetry = {
      latitude,
      longitude,
      speedKmh: speed != null && Number.isFinite(speed) && speed >= 0 ? Math.round(speed * 3.6) : null,
      heading: heading != null && Number.isFinite(heading) && heading >= 0 ? Math.round(heading) : null,
      accuracyMeters: accuracy != null && Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
      timestamp: effectiveTimestamp,
      receivedAt,
    };
    latestFixRef.current = fix;
    setLocation(fix);
    setError(null); // A fresh valid fix clears a transient Core Location error.
    samplesRef.current += 1;
    setGpsSamples(samplesRef.current);
    if (fix.speedKmh !== null && fix.accuracyMeters !== null && fix.accuracyMeters <= 150) {
      maxSpeedRef.current = Math.max(maxSpeedRef.current ?? 0, fix.speedKmh);
    }
    const previous = lastFixRef.current;
    if (previous && previous.accuracyMeters !== null && previous.accuracyMeters <= 150 && fix.accuracyMeters !== null && fix.accuracyMeters <= 150) {
      const seconds = (fix.timestamp - previous.timestamp) / 1000;
      const meters = metersBetween(previous, fix);
      const moving = (fix.speedKmh ?? 0) >= 7 || (previous.speedKmh ?? 0) >= 7;
      // Trip distance is approximate; exclude jitter, unrealistic jumps and gaps.
      if (seconds > 30 || (seconds > 0 && meters / seconds > 70)) {
        lastFixRef.current = fix; // Don't bridge stale gaps or GPS jumps.
      } else if (seconds > 0 && meters >= 8) {
        if (moving) {
          distanceRef.current += meters;
          setDistanceMeters(Math.round(distanceRef.current));
        }
        lastFixRef.current = fix;
      }
    } else if (fix.accuracyMeters !== null && fix.accuracyMeters <= 150) {
      lastFixRef.current = fix;
    }
  }, []);

  const stopJourney = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    watchRef.current?.remove();
    watchRef.current = null;
    if (startedAtRef.current !== null) {
      setLastTrip({
        route: routeRef.current,
        startedAt: startedAtRef.current,
        endedAt: Date.now(),
        distanceMeters: Math.round(distanceRef.current),
        maxSpeedKmh: maxSpeedRef.current,
        gpsSamples: samplesRef.current,
      });
    }
    startedAtRef.current = null;
    setStartedAt(null);
    setGpsState('idle');
    setLocation(null);
    latestFixRef.current = null;
    lastFixRef.current = null;
    setError(null);
  }, []);

  const startJourney = useCallback(async () => {
    if (activeRef.current) return true;
    activeRef.current = true;
    const generation = ++generationRef.current;
    setGpsState('requesting');
    setError(null);
    setLocation(null);
    latestFixRef.current = null;
    lastFixRef.current = null;
    distanceRef.current = 0;
    samplesRef.current = 0;
    maxSpeedRef.current = null;
    setDistanceMeters(0);
    setGpsSamples(0);
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      if (!activeRef.current || generation !== generationRef.current) return false;
      if (result.status !== 'granted') {
        activeRef.current = false;
        setGpsState('denied');
        setError('Location permission denied. Enable precise location in phone settings.');
        return false;
      }
      const available = await Location.hasServicesEnabledAsync();
      if (!activeRef.current || generation !== generationRef.current) return false;
      if (!available) throw new Error('GPS is disabled. Please turn on device location services.');
      // High accuracy is more tolerant of an initial indoor/weak-signal GPS fix.
      // iOS controls callback timing; there is NO guaranteed 1-second interval.
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 0, timeInterval: 1000 },
        applyLocation,
        reason => { if (activeRef.current && generation === generationRef.current) setError(`GPS: ${reason}`); },
      );
      if (!activeRef.current || generation !== generationRef.current) {
        subscription.remove();
        return false;
      }
      watchRef.current = subscription;
      // An up-to-date cached GPS fix can seed the display; never fabricate a position.
      void Location.getLastKnownPositionAsync({maxAge:15000,requiredAccuracy:2500}).then(point=>{
        if(point&&activeRef.current&&generation===generationRef.current)applyLocation(point);
      }).catch(()=>{});
      const now = Date.now();
      startedAtRef.current = now;
      setStartedAt(now);
      setGpsState('tracking');
      return true;
    } catch (e) {
      if (generation !== generationRef.current) return false;
      activeRef.current = false;
      setGpsState('error');
      setError(e instanceof Error ? e.message : 'Unable to start GPS tracking');
      return false;
    }
  }, [applyLocation]);

  const refreshLocation = useCallback(async (): Promise<boolean> => {
    if (!activeRef.current) return false;
    try {
      // Explicit one-shot refresh while foregrounded; it can take several seconds.
      const fix=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
      if (!activeRef.current) return false;
      applyLocation(fix);
      return true;
    } catch(e) {
      if(activeRef.current)setError(`GPS refresh failed: ${e instanceof Error?e.message:'Position unavailable'}. Try outdoors and turn on Precise Location.`);
      return false;
    }
  },[applyLocation]);

  const createTestReport = useCallback((type: HazardType) => {
    const fix = latestFixRef.current;
    if (!activeRef.current || !fix || Date.now() - fix.timestamp > 5000 || fix.accuracyMeters === null || fix.accuracyMeters > 100) return false;
    const report: TestHazardReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type, route: routeRef.current, createdAt: Date.now(),
      latitude: fix.latitude, longitude: fix.longitude,
      accuracyMeters: fix.accuracyMeters, status: 'local-test-only',
    };
    setTestReports(current => [report, ...current].slice(0, 10));
    return true;
  }, []);

  useEffect(() => {
    if (gpsState !== 'tracking') return;
    // Keep stationary devices alive when OS/browser suppresses duplicate callbacks
    const keepAlive = setInterval(() => {
      const latest = latestFixRef.current;
      if (!activeRef.current || !latest) return;
      const now = Date.now();
      if (now - latest.receivedAt >= 3000) {
        const refreshed: Telemetry = { ...latest, timestamp: now, receivedAt: now };
        latestFixRef.current = refreshed;
        setLocation(refreshed);
      }
    }, 3000);
    return () => clearInterval(keepAlive);
  }, [gpsState]);

  useEffect(() => () => {
    activeRef.current = false;
    generationRef.current += 1;
    watchRef.current?.remove();
  }, []);

  const state = useMemo(() => ({
    gpsState, location, error, route, voiceEnabled, vibrationEnabled,
    startedAt, distanceMeters, gpsSamples, lastTrip, testReports,
    setRoute, setVoiceEnabled, setVibrationEnabled,
    startJourney, stopJourney, refreshLocation, createTestReport,
    clearTestReports: () => setTestReports([]),
  }), [gpsState, location, error, route, voiceEnabled, vibrationEnabled, startedAt, distanceMeters, gpsSamples, lastTrip, testReports, startJourney, stopJourney, refreshLocation, createTestReport]);
  return <JourneyContext.Provider value={state}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyState {
  const value = useContext(JourneyContext);
  if (!value) throw new Error('useJourney requires JourneyProvider');
  return value;
}

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

type GPSState = 'idle' | 'requesting' | 'tracking' | 'denied' | 'error';
export type Telemetry = {
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number | null;
  timestamp: number;
  fixTime: number;
  receivedAt: number;
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

type PersistedSettings = {
  route?: string;
  voiceEnabled?: boolean;
  vibrationEnabled?: boolean;
  showOncoming?: boolean;
};

const SETTINGS_KEY = 'fogradar:settings';
const HISTORY_KEY = 'fogradar:tripHistory';
const MAX_HISTORY = 20;

type JourneyState = {
  gpsState: GPSState;
  location: Telemetry | null;
  error: string | null;
  route: string;
  voiceEnabled: boolean;
  vibrationEnabled: boolean;
  showOncoming: boolean;
  startedAt: number | null;
  distanceMeters: number;
  gpsSamples: number;
  lastTrip: TripSummary | null;
  tripHistory: TripSummary[];
  setRoute: (v: string) => void;
  setVoiceEnabled: (v: boolean) => void;
  setVibrationEnabled: (v: boolean) => void;
  setShowOncoming: (v: boolean) => void;
  clearTripHistory: () => void;
  startJourney: () => Promise<boolean>;
  stopJourney: () => void;
  refreshLocation: () => Promise<boolean>;
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
  const [hydrated, setHydrated] = useState(false);
  const [gpsState, setGpsState] = useState<GPSState>('idle');
  const [location, setLocation] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRouteState] = useState('M-2 Motorway');
  const [voiceEnabled, setVoiceState] = useState(true);
  const [vibrationEnabled, setVibrationState] = useState(true);
  const [showOncoming, setShowOncomingState] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [gpsSamples, setGpsSamples] = useState(0);
  const [lastTrip, setLastTrip] = useState<TripSummary | null>(null);
  const [tripHistory, setTripHistory] = useState<TripSummary[]>([]);

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [rawSettings, rawHistory] = await Promise.all([
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(HISTORY_KEY),
        ]);
        if (!mounted) return;
        if (rawSettings) {
          const parsed = JSON.parse(rawSettings) as PersistedSettings;
          if (typeof parsed.route === 'string') setRouteState(parsed.route);
          if (typeof parsed.voiceEnabled === 'boolean') setVoiceState(parsed.voiceEnabled);
          if (typeof parsed.vibrationEnabled === 'boolean') setVibrationState(parsed.vibrationEnabled);
          if (typeof parsed.showOncoming === 'boolean') setShowOncomingState(parsed.showOncoming);
        }
        if (rawHistory) {
          const parsedHistory = JSON.parse(rawHistory) as TripSummary[];
          if (Array.isArray(parsedHistory)) {
            setTripHistory(parsedHistory.slice(0, MAX_HISTORY));
            if (parsedHistory.length > 0) setLastTrip(parsedHistory[0]);
          }
        }
      } catch {
        // Ignore storage read errors; keep defaults.
      } finally {
        if (mounted) setHydrated(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const persistSettings = useCallback((next: PersistedSettings) => {
    void AsyncStorage.getItem(SETTINGS_KEY)
      .then(raw => {
        const current = raw ? (JSON.parse(raw) as PersistedSettings) : {};
        return AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...next }));
      })
      .catch(() => {});
  }, []);

  const setRoute = useCallback(
    (v: string) => {
      setRouteState(v);
      persistSettings({ route: v });
    },
    [persistSettings]
  );

  const setVoiceEnabled = useCallback(
    (v: boolean) => {
      setVoiceState(v);
      persistSettings({ voiceEnabled: v });
    },
    [persistSettings]
  );

  const setVibrationEnabled = useCallback(
    (v: boolean) => {
      setVibrationState(v);
      persistSettings({ vibrationEnabled: v });
    },
    [persistSettings]
  );

  const setShowOncoming = useCallback(
    (v: boolean) => {
      setShowOncomingState(v);
      persistSettings({ showOncoming: v });
    },
    [persistSettings]
  );

  const clearTripHistory = useCallback(() => {
    setTripHistory([]);
    setLastTrip(null);
    void AsyncStorage.removeItem(HISTORY_KEY).catch(() => {});
  }, []);

  const applyLocation = useCallback((point: Location.LocationObject) => {
    if (!activeRef.current) return;
    const { latitude, longitude, speed, heading, accuracy } = point.coords;
    const receivedAt = Date.now();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if (!Number.isFinite(point.timestamp)) return;
    const effectiveTimestamp = Math.min(receivedAt, Math.max(point.timestamp, receivedAt - 4000));
    const fix: Telemetry = {
      latitude,
      longitude,
      speedKmh: speed != null && Number.isFinite(speed) && speed >= 0 ? Math.round(speed * 3.6) : null,
      heading: heading != null && Number.isFinite(heading) && heading >= 0 ? Math.round(heading) : null,
      accuracyMeters: accuracy != null && Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
      timestamp: effectiveTimestamp,
      fixTime: point.timestamp,
      receivedAt,
    };
    latestFixRef.current = fix;
    setLocation(fix);
    setError(null);
    samplesRef.current += 1;
    setGpsSamples(samplesRef.current);
    if (fix.speedKmh !== null && fix.accuracyMeters !== null && fix.accuracyMeters <= 150) {
      maxSpeedRef.current = Math.max(maxSpeedRef.current ?? 0, fix.speedKmh);
    }
    const previous = lastFixRef.current;
    if (
      previous &&
      previous.accuracyMeters !== null &&
      previous.accuracyMeters <= 150 &&
      fix.accuracyMeters !== null &&
      fix.accuracyMeters <= 150
    ) {
      const seconds = (fix.timestamp - previous.timestamp) / 1000;
      const meters = metersBetween(previous, fix);
      const moving = (fix.speedKmh ?? 0) >= 7 || (previous.speedKmh ?? 0) >= 7;
      if (seconds > 30 || (seconds > 0 && meters / seconds > 70)) {
        lastFixRef.current = fix;
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
      const summary: TripSummary = {
        route: routeRef.current,
        startedAt: startedAtRef.current,
        endedAt: Date.now(),
        distanceMeters: Math.round(distanceRef.current),
        maxSpeedKmh: maxSpeedRef.current,
        gpsSamples: samplesRef.current,
      };
      setLastTrip(summary);
      setTripHistory(prev => {
        const next = [summary, ...prev].slice(0, MAX_HISTORY);
        void AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
        return next;
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
        setError(
          'Location permission denied. Enable Precise Location in Settings. / لوکیشن کی اجازت نہیں ملی۔ براہ کرم سیٹنگز میں پریسائز لوکیشن آن کریں۔'
        );
        return false;
      }
      const available = await Location.hasServicesEnabledAsync();
      if (!activeRef.current || generation !== generationRef.current) return false;
      if (!available) {
        throw new Error(
          'GPS is disabled. Please turn on device location services. / جی پی ایس بند ہے۔ براہ کرم لوکیشن سروسز آن کریں۔'
        );
      }
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 1000 },
        applyLocation,
        reason => {
          if (activeRef.current && generation === generationRef.current) setError(`GPS: ${reason}`);
        }
      );
      if (!activeRef.current || generation !== generationRef.current) {
        subscription.remove();
        return false;
      }
      watchRef.current = subscription;
      void Location.getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 2500 })
        .then(point => {
          if (point && activeRef.current && generation === generationRef.current) applyLocation(point);
        })
        .catch(() => {});
      const now = Date.now();
      startedAtRef.current = now;
      setStartedAt(now);
      setGpsState('tracking');
      return true;
    } catch (e) {
      if (generation !== generationRef.current) return false;
      activeRef.current = false;
      setGpsState('error');
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to start GPS tracking. / جی پی ایس شروع نہیں ہو سکا۔'
      );
      return false;
    }
  }, [applyLocation]);

  const refreshLocation = useCallback(async (): Promise<boolean> => {
    if (!activeRef.current) return false;
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (!activeRef.current) return false;
      applyLocation(fix);
      return true;
    } catch (e) {
      if (activeRef.current) {
        setError(
          `GPS refresh failed: ${e instanceof Error ? e.message : 'Position unavailable'}. / لوکیشن اپڈیٹ نہیں ہو سکی۔`
        );
      }
      return false;
    }
  }, [applyLocation]);

  useEffect(() => {
    if (gpsState !== 'tracking') return;
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

  useEffect(
    () => () => {
      activeRef.current = false;
      generationRef.current += 1;
      watchRef.current?.remove();
    },
    []
  );

  const state = useMemo(
    () => ({
      gpsState,
      location,
      error,
      route,
      voiceEnabled,
      vibrationEnabled,
      showOncoming,
      startedAt,
      distanceMeters,
      gpsSamples,
      lastTrip,
      tripHistory,
      setRoute,
      setVoiceEnabled,
      setVibrationEnabled,
      setShowOncoming,
      clearTripHistory,
      startJourney,
      stopJourney,
      refreshLocation,
    }),
    [
      gpsState,
      location,
      error,
      route,
      voiceEnabled,
      vibrationEnabled,
      showOncoming,
      startedAt,
      distanceMeters,
      gpsSamples,
      lastTrip,
      tripHistory,
      setRoute,
      setVoiceEnabled,
      setVibrationEnabled,
      setShowOncoming,
      clearTripHistory,
      startJourney,
      stopJourney,
      refreshLocation,
    ]
  );

  if (!hydrated) return null;
  return <JourneyContext.Provider value={state}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyState {
  const value = useContext(JourneyContext);
  if (!value) throw new Error('useJourney requires JourneyProvider');
  return value;
}

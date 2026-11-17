import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { useJourney, type HazardType, type Telemetry } from '../context/JourneyContext';

export type NearbyVehicle = {
  id: string;
  distanceMeters: number;
  bearing: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number;
  ageMs: number;
  fixTime?: number;
};
export type LiveHazard = {
  id: string;
  type: HazardType;
  distanceMeters: number;
  reportCount: number;
  expiresAt: number;
  status: string;
};
export type RoadInsights = {
  summary_en: string;
  summary_ur: string;
  generatedAt: number;
};
type CloudStatus = 'not-configured' | 'idle' | 'connecting' | 'online' | 'offline';
type TelemetryAck = { ok: boolean; error?: string; serverTime?: number };
type ProbeResult = { ok: boolean; message: string; latencyMs: number | null };
type CloudState = {
  status: CloudStatus;
  error: string | null;
  vehicles: NearbyVehicle[];
  hazards: LiveHazard[];
  insights: RoadInsights | null;
  updatedAt: number | null;
  lastUploadAt: number | null;
  lastUploadError: string | null;
  snapshotReceivedCount: number;
  gpsToServerMs: number | null;
  serverToClientMs: number | null;
  clockOffsetMs: number;
  apiUrl: string;
  setServerUrl: (url: string) => void;
  probeServer: (url?: string) => Promise<ProbeResult>;
};
const CloudContext = createContext<CloudState | null>(null);
const SERVER_URL_KEY = 'fogradar:serverUrl';
// Static dot-property access is required for Expo to inline the variable into the JS bundle.
const compiledUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://fogradar.onrender.com').trim().replace(/\/+$/, '');
const normalize = (url: string) => url.trim().replace(/\/+$/, '');

export function CloudProvider({ children }: { children: React.ReactNode }) {
  const { startedAt, gpsState, location, route, voiceEnabled, vibrationEnabled } = useJourney();
  const [hydrated, setHydrated] = useState(false);
  const [apiUrl, setApiUrl] = useState(compiledUrl);
  const [status, setStatus] = useState<CloudStatus>(compiledUrl ? 'idle' : 'not-configured');
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<NearbyVehicle[]>([]);
  const [hazards, setHazards] = useState<LiveHazard[]>([]);
  const [insights, setInsights] = useState<RoadInsights | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [lastUploadAt, setLastUploadAt] = useState<number | null>(null);
  const [lastUploadError, setLastUploadError] = useState<string | null>(null);
  const [snapshotReceivedCount, setSnapshotReceivedCount] = useState(0);
  const [gpsToServerMs, setGpsToServerMs] = useState<number | null>(null);
  const [serverToClientMs, setServerToClientMs] = useState<number | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const clockOffsetRef = useRef(0);
  const socketRef = useRef<Socket | null>(null);
  const lastSentRef = useRef(0);
  const alertedRef = useRef(new Set<string>());
  const preferencesRef = useRef({ voiceEnabled, vibrationEnabled });
  const locationRef = useRef<Telemetry | null>(location);
  const routeRef = useRef(route);
  preferencesRef.current = { voiceEnabled, vibrationEnabled };
  locationRef.current = location;
  routeRef.current = route;

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(SERVER_URL_KEY)
      .then(saved => {
        if (!mounted) return;
        const trimmed = saved ? normalize(saved) : '';
        if (trimmed) {
          setApiUrl(trimmed);
          setStatus('idle');
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setHydrated(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setServerUrl = useCallback((url: string) => {
    const next = normalize(url) || compiledUrl;
    setApiUrl(next);
    if (next === compiledUrl) {
      void AsyncStorage.removeItem(SERVER_URL_KEY).catch(() => {});
    } else {
      void AsyncStorage.setItem(SERVER_URL_KEY, next).catch(() => {});
    }
  }, []);

  const probeServer = useCallback(
    async (url?: string): Promise<ProbeResult> => {
      const target = normalize(url ?? apiUrl);
      if (!/^https?:\/\/[^/]+(?::\d+)?$/i.test(target)) {
        return { ok: false, message: 'Enter a valid http:// or https:// server URL', latencyMs: null };
      }
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(`${target}/health`, { signal: controller.signal });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { ok?: boolean; service?: string };
        if (body.ok !== true) throw Error('Unexpected health response');
        return { ok: true, message: `Connected (${body.service ?? 'FogRadar'})`, latencyMs: Date.now() - start };
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : 'Unable to reach FogRadar cloud',
          latencyMs: null,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    [apiUrl]
  );

  const sendTelemetry = useCallback((loc: Telemetry | null) => {
    const socket = socketRef.current;
    if (!socket?.connected || !loc) return;
    const now = Date.now();
    // Upload every fresh fix (max 1 per second)
    if (now - lastSentRef.current < 950) return;
    const sendTs = Math.max(now, lastSentRef.current + 950);
    lastSentRef.current = sendTs;
    const wireAccuracy =
      loc.accuracyMeters !== null && Number.isFinite(loc.accuracyMeters)
        ? Math.min(45, Math.max(1, Math.round(loc.accuracyMeters)))
        : 25;
    const fixTime = loc.fixTime ?? loc.timestamp;
    const sentAt = Date.now();
    socket.timeout(5000).emit(
      'telemetry:update',
      {
        latitude: loc.latitude,
        longitude: loc.longitude,
        speedKmh: loc.speedKmh,
        heading: loc.heading,
        accuracyMeters: wireAccuracy,
        timestamp: sendTs,
        fixTime,
        sentAt,
        route: routeRef.current,
      },
      (timeout: Error | null, result?: TelemetryAck) => {
        if (timeout) {
          setLastUploadError('GPS upload timeout');
          return;
        }
        if (!result?.ok) {
          setLastUploadError(result?.error ?? 'GPS update rejected');
          return;
        }
        const ackAt = Date.now();
        setLastUploadAt(ackAt);
        setLastUploadError(null);
        if (typeof result.serverTime === 'number' && Number.isFinite(result.serverTime)) {
          const rtt = Math.max(0, ackAt - sentAt);
          const sampleOffset = result.serverTime - (sentAt + rtt / 2);
          const nextOffset =
            clockOffsetRef.current === 0
              ? sampleOffset
              : clockOffsetRef.current * 0.75 + sampleOffset * 0.25;
          clockOffsetRef.current = nextOffset;
          setClockOffsetMs(Math.round(nextOffset));
          setGpsToServerMs(Math.max(0, Math.round(result.serverTime - nextOffset - fixTime)));
        }
      }
    );
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!startedAt || gpsState !== 'tracking') {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setVehicles([]);
      setHazards([]);
      setInsights(null);
      setUpdatedAt(null);
      setLastUploadAt(null);
      setSnapshotReceivedCount(0);
      setStatus(apiUrl ? 'idle' : 'not-configured');
      setError(null);
      alertedRef.current.clear();
      lastSentRef.current = 0;
      return;
    }
    if (!apiUrl) {
      setStatus('not-configured');
      setError('Server URL missing: open Settings → Advanced → Server Connection');
      return;
    }
    if (!/^https?:\/\/[^/]+(?::\d+)?$/i.test(apiUrl)) {
      setStatus('offline');
      setError('Invalid server URL configured.');
      return;
    }

    let cancelled = false;
    let sock: Socket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let attempt = 0;

    setStatus('connecting');
    setError(null);
    setLastUploadError(null);

    async function connect() {
      try {
        controller = new AbortController();
        // 35s timeout to gracefully handle Render free-tier cold start (~30-60s)
        const timeout = setTimeout(() => controller?.abort(), 35_000);
        let response: Response;
        try {
          response = await fetch(`${apiUrl}/v1/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) throw Error(`Session API HTTP ${response.status}`);
        const data = (await response.json()) as { token?: string };
        if (!data.token) throw Error('Session API returned no token');
        if (cancelled) return;

        sock = io(apiUrl, {
          auth: { token: data.token },
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: 1500,
          reconnectionDelayMax: 8000,
          timeout: 20_000,
        });
        socketRef.current = sock;
        sock.on('connect', () => {
          if (!cancelled) {
            attempt = 0;
            setStatus('online');
            setError(null);
            setLastUploadError(null);
            lastSentRef.current = 0;
            if (locationRef.current) sendTelemetry(locationRef.current);
          }
        });
        sock.on('disconnect', (reason: string) => {
          if (!cancelled) {
            setStatus('offline');
            setError(`Disconnected: ${reason}`);
            setVehicles([]);
            setHazards([]);
            setInsights(null);
            setUpdatedAt(null);
            setSnapshotReceivedCount(0);
          }
        });
        sock.on('connect_error', (e: Error) => {
          if (!cancelled) {
            setStatus('connecting');
            setError(`Connecting to FogRadar… (${e.message})`);
          }
        });
        sock.on('radar:snapshot', (payload: { vehicles?: NearbyVehicle[]; serverTime?: number }) => {
          if (cancelled) return;
          const clientNow = Date.now();
          const rawList = Array.isArray(payload?.vehicles) ? payload.vehicles : [];
          const valid: NearbyVehicle[] = [];
          for (const v of rawList) {
            if (!Number.isFinite(v.distanceMeters) || v.distanceMeters < 0 || v.distanceMeters > 1000) continue;
            if (!Number.isFinite(v.ageMs) || v.ageMs > 15_000) continue;
            valid.push(v);
          }
          if (typeof payload?.serverTime === 'number' && Number.isFinite(payload.serverTime)) {
            const s2c = Math.max(0, Math.round(clientNow + clockOffsetRef.current - payload.serverTime));
            setServerToClientMs(s2c);
          }
          setSnapshotReceivedCount(rawList.length);
          setVehicles(valid);
          setUpdatedAt(clientNow);
        });
        sock.on('insights:update', (payload: Partial<RoadInsights>) => {
          if (cancelled) return;
          if (
            typeof payload?.summary_en === 'string' &&
            typeof payload?.summary_ur === 'string' &&
            typeof payload?.generatedAt === 'number'
          ) {
            // Informational display only: never triggers voice or vibration alerts.
            setInsights({
              summary_en: payload.summary_en,
              summary_ur: payload.summary_ur,
              generatedAt: payload.generatedAt,
            });
          }
        });
        sock.on('hazards:snapshot', (payload: { hazards?: LiveHazard[] }) => {
          if (cancelled) return;
          const active = (Array.isArray(payload?.hazards) ? payload.hazards : []).filter(
            h => h.expiresAt > Date.now()
          );
          setHazards(active);
          for (const hazard of active) {
            if (alertedRef.current.has(hazard.id)) continue;
            alertedRef.current.add(hazard.id);
            if (preferencesRef.current.vibrationEnabled) {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            }
            if (preferencesRef.current.voiceEnabled) {
              void Speech.getAvailableVoicesAsync()
                .then(voices => {
                  const ur = voices.find(v => v.language.toLowerCase().startsWith('ur'));
                  Speech.speak(
                    ur
                      ? 'آگے ممکنہ خطرہ ہے۔ احتیاط سے رفتار کم کریں۔'
                      : 'Hazard reported ahead. Slow down carefully.',
                    { language: ur?.language ?? 'en-US', ...(ur ? { voice: ur.identifier } : {}), rate: 0.9 }
                  );
                })
                .catch(() => {});
            }
          }
        });
      } catch (e) {
        if (cancelled) return;
        attempt += 1;
        const backoffMs = Math.min(15_000, 3000 * attempt);
        if (attempt <= 2) {
          // Keep status='connecting' without alarming error during cold-start window
          setStatus('connecting');
          setError(null);
        } else {
          setStatus('offline');
          setError(
            e instanceof Error
              ? `Cloud unreachable (${e.message}). Retrying… / سرور سے رابطہ نہیں ہو سکا، دوبارہ کوشش جاری ہے۔`
              : 'Cloud unreachable. Retrying…'
          );
        }
        retry = setTimeout(() => void connect(), backoffMs);
      }
    }
    void connect();
    return () => {
      cancelled = true;
      controller?.abort();
      if (retry) clearTimeout(retry);
      sock?.disconnect();
      if (socketRef.current === sock) socketRef.current = null;
    };
  }, [hydrated, startedAt, gpsState, apiUrl, sendTelemetry]);

  useEffect(() => {
    setInsights(null);
    if (status !== 'online' || !location) return;
    sendTelemetry(location);
  }, [route]);

  useEffect(() => {
    if (status !== 'online' || !location) return;
    sendTelemetry(location);
  }, [location, status, sendTelemetry]);

  useEffect(() => {
    if (status !== 'online' || !startedAt || gpsState !== 'tracking') return;
    const timer = setInterval(() => {
      if (locationRef.current) sendTelemetry(locationRef.current);
    }, 2500);
    return () => clearInterval(timer);
  }, [status, startedAt, gpsState, sendTelemetry]);

  const value = useMemo(
    () => ({
      status,
      error,
      vehicles,
      hazards,
      insights,
      updatedAt,
      lastUploadAt,
      lastUploadError,
      snapshotReceivedCount,
      gpsToServerMs,
      serverToClientMs,
      clockOffsetMs,
      apiUrl,
      setServerUrl,
      probeServer,
    }),
    [
      status,
      error,
      vehicles,
      hazards,
      insights,
      updatedAt,
      lastUploadAt,
      lastUploadError,
      snapshotReceivedCount,
      gpsToServerMs,
      serverToClientMs,
      clockOffsetMs,
      apiUrl,
      setServerUrl,
      probeServer,
    ]
  );

  if (!hydrated) return null;
  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud(): CloudState {
  const value = useContext(CloudContext);
  if (!value) throw Error('useCloud requires CloudProvider');
  return value;
}

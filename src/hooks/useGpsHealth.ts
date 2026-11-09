import { useEffect, useState } from 'react';
import { useJourney } from '../context/JourneyContext';

/** Real GPS telemetry only. No interpolation or synthetic speed. */
export function useGpsHealth() {
  const { gpsState, location } = useJourney();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const ageMs = location ? Math.max(0, now - location.timestamp) : null;
  const ageSeconds = ageMs === null ? null : Math.floor(ageMs / 1000);
  const callbackAgeMs = location ? Math.max(0, now - location.receivedAt) : null;
  const fixLatencyMs = location ? Math.max(0, location.receivedAt - location.timestamp) : null;
  const isFresh = gpsState === 'tracking' && ageMs !== null && ageMs <= 15000;
  const accuracy = location?.accuracyMeters ?? null;
  const quality = !isFresh ? 'unavailable'
    : accuracy === null ? 'unknown'
    : accuracy <= 25 ? 'good'
    : accuracy <= 250 ? 'limited'
    : 'poor';
  const valid = isFresh && accuracy !== null && accuracy <= 2500;
  return {
    gpsState, location, ageSeconds, callbackAgeMs, fixLatencyMs, isFresh, quality,
    safeSpeedKmh: valid ? location?.speedKmh ?? null : null,
    safeHeading: valid ? location?.heading ?? null : null,
  } as const;
}

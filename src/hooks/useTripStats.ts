import { useEffect, useState } from 'react';
import { useJourney } from '../context/JourneyContext';

export function useTripStats() {
  const { startedAt, distanceMeters, gpsSamples } = useJourney();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const elapsedSeconds = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  return { elapsedSeconds, distanceMeters, gpsSamples };
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${String(secs).padStart(2, '0')}s`;
}

import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Exact Color Tokens from src/theme/colors.ts & src/components/RadarCanvas.tsx
 */
export const C = {
  forest: '#06472D',
  dark: '#033622',
  emerald: '#008A45',
  bright: '#00AD57',
  pale: '#E9F6EE',
  cream: '#F7FAF8',
  white: '#FFFFFF',
  text: '#14291F',
  muted: '#6B8077',
  border: '#E1E9E4',
  red: '#D92D39',
  darkRed: '#5E1017',
  gold: '#F9C846',
} as const;

export const MOTORWAY_ROUTES = [
  'M-1 Motorway',
  'M-2 Motorway',
  'M-3 Motorway',
  'M-4 Motorway',
  'M-5 Motorway',
  'M-9 Motorway',
] as const;

export type MotorwayRoute = (typeof MOTORWAY_ROUTES)[number];
export type HazardType = 'Stopped traffic' | 'Accident' | 'Heavy fog' | 'Vehicle breakdown';
export type ProximityColor = 'red' | 'yellow' | 'green' | 'uncertain';

export interface NearbyVehicle {
  id: string;
  label: string;
  distanceMeters: number;
  bearing: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number;
  ageMs: number;
}

export interface LiveHazard {
  id: string;
  type: HazardType;
  distanceMeters: number;
  reportCount: number;
  expiresAt: number;
  status: 'corroborated-experimental';
}

/**
 * Exact proximityColor heuristic from src/utils/proximity.ts
 * Display-only heuristic. NOT a traffic safety / collision risk classification.
 */
export function proximityColor(
  distanceMeters: number,
  ownAccuracy: number | null,
  otherAccuracy: number
): ProximityColor {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || distanceMeters > 1000) return 'uncertain';
  if (ownAccuracy === null || ownAccuracy > 35 || otherAccuracy > 35) return 'uncertain';
  const uncertainty = ownAccuracy + otherAccuracy;
  if (distanceMeters <= 80) return distanceMeters + uncertainty <= 80 ? 'red' : 'uncertain';
  if (distanceMeters <= 250) return distanceMeters - uncertainty > 80 && distanceMeters + uncertainty <= 250 ? 'yellow' : 'uncertain';
  return distanceMeters - uncertainty > 250 ? 'green' : 'uncertain';
}

/**
 * Exact Marker Palette from src/components/RadarCanvas.tsx & app/(tabs)/radar.tsx
 */
const PALETTE: Record<
  ProximityColor,
  { bg: string; border: string; ink: string; dot: string; label: string }
> = {
  red: { bg: '#FFDFE0', border: '#FF5966', ink: '#AB1028', dot: '#EF4452', label: 'RED ≤80m' },
  yellow: { bg: '#FFF0B8', border: '#FFB522', ink: '#805700', dot: '#F9C846', label: 'YELLOW 80–250m' },
  green: { bg: '#C8FFDC', border: '#5BF49E', ink: '#06472D', dot: '#49D489', label: 'GREEN 250–1000m' },
  uncertain: { bg: '#E4E9EA', border: '#9EAEB0', ink: '#566569', dot: '#9EAEB0', label: 'GRAY Uncertain' },
};

/**
 * Exact BrandMark SVG from src/components/BrandMark.tsx
 */
function BrandMarkSvg({ size = 36 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        overflow: 'hidden',
        backgroundColor: C.forest,
        flexShrink: 0,
      }}
      className="shadow-md border border-emerald-500/30"
    >
      <svg width={size} height={size} viewBox="0 0 120 120">
        <rect x="0" y="0" width="120" height="120" fill={C.forest} />
        <path d="M15 113 44 62h32l29 51" fill="#008B48" />
        <path d="M40 113 53 66h14l13 47" fill="#0B3527" />
        <path d="M60 69v10M60 90v13" stroke="#FFF" strokeWidth="3" strokeLinecap="round" />
        <path
          d="M34 59c-11-1-19-8-19-19 0-11 8-19 19-19 4 0 8 1 11 3C51 10 62 7 73 12c11 4 17 13 18 23 10 0 17 8 17 17 0 6-4 11-9 14"
          fill="none"
          stroke="#FFF"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M47 75 51 65c1-3 3-4 7-4h9c4 0 6 1 7 4l4 10v10h-6v-3H53v3h-6z" fill="#FFF" />
        <rect x="53" y="67" width="19" height="7" rx="2" fill={C.forest} />
        <line x1="51" y1="79" x2="74" y2="79" stroke={C.forest} strokeWidth="2" />
        <circle cx="53" cy="79" r="2" fill={C.forest} />
        <circle cx="72" cy="79" r="2" fill={C.forest} />
      </svg>
    </div>
  );
}

/**
 * Exact Vector Icons from src/components/Icons.tsx
 */
function AppIcon({
  name,
  size = 18,
  color = '#00AD57',
}: {
  name: 'car' | 'radar' | 'road' | 'alert' | 'shield' | 'home' | 'settings' | 'play';
  size?: number;
  color?: string;
}) {
  const p = {
    stroke: color,
    strokeWidth: 2.1,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
      {name === 'car' && (
        <>
          <path {...p} d="m4 15 2-7a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 7v5h-3v-2H7v2H4z" />
          <path {...p} d="M4 14h16M6 10h12" />
          <circle cx="7" cy="16.5" r="1" fill={color} />
          <circle cx="17" cy="16.5" r="1" fill={color} />
        </>
      )}
      {name === 'radar' && (
        <>
          <circle {...p} cx="12" cy="12" r="9" />
          <circle {...p} cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="2" fill={color} />
          <path {...p} d="M12 12 18.5 5.5" />
        </>
      )}
      {name === 'road' && <path {...p} d="M9 3 4 21M15 3l5 18M12 5v3M12 12v3M12 19v2" />}
      {name === 'alert' && (
        <>
          <path {...p} d="M12 3 22 21H2z" />
          <line {...p} x1="12" y1="9" x2="12" y2="14" />
          <circle cx="12" cy="17" r="1" fill={color} />
        </>
      )}
      {name === 'shield' && (
        <>
          <path {...p} d="M12 2 21 6v6c0 5-4 8-9 10-5-2-9-5-9-10V6z" />
          <polyline {...p} points="8,12 11,15 20,6" />
        </>
      )}
      {name === 'home' && <path {...p} d="M3 11.5 12 4l9 7.5V21H14v-7h-4v7H3z" />}
      {name === 'settings' && (
        <>
          <circle {...p} cx="12" cy="12" r="3" />
          <path {...p} d="m10 2-1 3-3 1-3-1-2 3 2 3v2l-2 3 2 3 3-1 3 1 1 3h4l1-3 3-1 3 1 2-3-2-3v-2l2-3-2-3-3 1-3-1-1-3z" />
        </>
      )}
      {name === 'play' && <path d="M7 4 21 12 7 20z" fill={color} />}
    </svg>
  );
}

export default function IgniteTelemetryPreview() {
  const [route, setRoute] = useState<MotorwayRoute>('M-2 Motorway');
  const [ownSpeed, setOwnSpeed] = useState<number>(88);
  const [ownHeading] = useState<number>(38);
  const [ownAccuracy, setOwnAccuracy] = useState<number>(4);
  const [hazardType, setHazardType] = useState<HazardType>('Heavy fog');
  const [showHazardBanner, setShowHazardBanner] = useState<boolean>(true);
  const [showDemoModal, setShowDemoModal] = useState<boolean>(false);

  // Two active nearby connected phones + optional third to demonstrate Red / Yellow / Green / Uncertain zones
  const [vehicles, setVehicles] = useState<NearbyVehicle[]>([
    {
      id: 'veh-a91f',
      label: 'Phone 1',
      distanceMeters: 58,
      bearing: 24, // Ahead-left relative to 38° heading
      speedKmh: 62,
      heading: 36,
      accuracyMeters: 5,
      ageMs: 800,
    },
    {
      id: 'veh-c402',
      label: 'Phone 2',
      distanceMeters: 174,
      bearing: 56, // Ahead-right relative to 38° heading
      speedKmh: 79,
      heading: 40,
      accuracyMeters: 6,
      ageMs: 1200,
    },
  ]);

  const [presetMode, setPresetMode] = useState<'red-yellow' | 'red-green' | 'uncertain'>('red-yellow');

  const applyPreset = (mode: 'red-yellow' | 'red-green' | 'uncertain') => {
    setPresetMode(mode);
    if (mode === 'red-yellow') {
      setOwnAccuracy(4);
      setVehicles([
        { id: 'veh-a91f', label: 'Phone 1', distanceMeters: 58, bearing: 24, speedKmh: 62, heading: 36, accuracyMeters: 5, ageMs: 800 },
        { id: 'veh-c402', label: 'Phone 2', distanceMeters: 174, bearing: 56, speedKmh: 79, heading: 40, accuracyMeters: 6, ageMs: 1200 },
      ]);
    } else if (mode === 'red-green') {
      setOwnAccuracy(4);
      setVehicles([
        { id: 'veh-a91f', label: 'Phone 1', distanceMeters: 62, bearing: 32, speedKmh: 58, heading: 38, accuracyMeters: 4, ageMs: 700 },
        { id: 'veh-c402', label: 'Phone 2', distanceMeters: 480, bearing: 12, speedKmh: 94, heading: 37, accuracyMeters: 7, ageMs: 1100 },
      ]);
    } else {
      // Ambiguous GPS accuracy (>35m or crossing threshold) -> GRAY ('uncertain') per src/utils/proximity.ts
      setOwnAccuracy(28);
      setVehicles([
        { id: 'veh-a91f', label: 'Phone 1', distanceMeters: 74, bearing: 24, speedKmh: 62, heading: 36, accuracyMeters: 16, ageMs: 900 },
        { id: 'veh-c402', label: 'Phone 2', distanceMeters: 242, bearing: 56, speedKmh: 79, heading: 40, accuracyMeters: 18, ageMs: 1400 },
      ]);
    }
  };

  // Real-time Node Activity Feed logs matching backend/src/server.ts & src/cloud/CloudContext.tsx
  const [logs, setLogs] = useState<Array<{ id: number; ts: string; tag: string; text: string; tone: 'emerald' | 'amber' | 'crimson' }>>([
    {
      id: 1,
      ts: '00:00.12',
      tag: 'AUTH',
      text: 'POST /v1/session -> 200 OK (HMAC-SHA256 8h anonymous trip token issued)',
      tone: 'emerald',
    },
    {
      id: 2,
      ts: '00:00.48',
      tag: 'SOCKET.IO',
      text: `telemetry:update dispatched { route: "${route}", speedKmh: 88, heading: 38°, accuracy: ±4m }`,
      tone: 'emerald',
    },
    {
      id: 3,
      ts: '00:01.05',
      tag: 'REDIS 7',
      text: 'Redis 7 GEOSEARCH fog:live:geo BYRADIUS 1000 m COUNT 150 -> 2 active vehicles',
      tone: 'emerald',
    },
    {
      id: 4,
      ts: '00:01.62',
      tag: 'POSTGIS',
      text: 'PostGIS ST_DWithin(150m) Dual-trip Corroboration state: Verified (report_count: 2 -> corroborated)',
      tone: 'amber',
    },
    {
      id: 5,
      ts: '00:02.00',
      tag: 'TTS+HAPTIC',
      text: 'hazards:snapshot -> Urdu TTS: "آگے ممکنہ خطرہ ہے۔ احتیاط سے رفتار کم کریں۔"',
      tone: 'crimson',
    },
  ]);

  const logIdRef = useRef(6);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const ts = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(
        Math.floor(now.getMilliseconds() / 10)
      ).padStart(2, '0')}`;

      // Subtle realistic GPS jitter (±1m distance, ±1 km/h speed)
      setVehicles(prev =>
        prev.map((v, idx) => {
          const delta = idx === 0 ? (Math.random() > 0.5 ? 1 : -1) : Math.random() > 0.5 ? 2 : -2;
          const baseMin = idx === 0 ? 44 : presetMode === 'red-green' ? 420 : 145;
          const baseMax = idx === 0 ? 68 : presetMode === 'red-green' ? 540 : 210;
          const nextDist = Math.min(baseMax, Math.max(baseMin, v.distanceMeters + delta));
          return { ...v, distanceMeters: nextDist, ageMs: Math.floor(400 + Math.random() * 900) };
        })
      );
      setOwnSpeed(s => Math.min(96, Math.max(82, s + (Math.random() > 0.5 ? 1 : -1))));

      const candidates: Array<{ tag: string; text: string; tone: 'emerald' | 'amber' | 'crimson' }> = [
        {
          tag: 'SOCKET.IO',
          text: `telemetry:update dispatched -> ACK { ok: true } · accuracy: ±${ownAccuracy}m · route: "${route}"`,
          tone: 'emerald',
        },
        {
          tag: 'REDIS 7',
          text: `Redis 7 GEOSEARCH sweep active (TTL 20s, stale cutoff 12s) -> radar:snapshot pushed`,
          tone: 'emerald',
        },
        {
          tag: 'POSTGIS',
          text: `PostGIS Dual-trip Corroboration state: Verified (${hazardType} · headingDelta <= 50° · cone ±60°)`,
          tone: 'amber',
        },
        {
          tag: 'PROXIMITY',
          text: `proximityColor() matrix evaluated: uncertainty ±${ownAccuracy + (vehicles[0]?.accuracyMeters ?? 5)}m applied`,
          tone: 'crimson',
        },
      ];
      const next = candidates[logIdRef.current % candidates.length];
      const id = logIdRef.current++;
      setLogs(curr => [...curr.slice(-6), { id, ts, ...next }]);
    }, 2200);

    return () => clearInterval(interval);
  }, [route, ownAccuracy, hazardType, presetMode, vehicles]);

  // Exact RadarCanvas geometry from src/components/RadarCanvas.tsx
  const SIZE = 296;
  const CENTER = SIZE / 2;
  const RADIUS = CENTER - 16;

  const renderedMarkers = useMemo(() => {
    return vehicles.map(vehicle => {
      const angle = (((vehicle.bearing - ownHeading + 360) % 360) * Math.PI) / 180;
      const physicalR = Math.min(RADIUS - 15, (vehicle.distanceMeters / 1000) * RADIUS);
      const r = Math.max(42, physicalR);
      const x = CENTER + r * Math.sin(angle);
      const y = CENTER - r * Math.cos(angle);
      const category = proximityColor(vehicle.distanceMeters, ownAccuracy, vehicle.accuracyMeters);
      const colors = PALETTE[category];
      return { vehicle, x, y, category, colors };
    });
  }, [vehicles, ownHeading, ownAccuracy, CENTER, RADIUS]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 md:p-6 font-mono selection:bg-emerald-500 selection:text-slate-950">
      {/* Subtle Automotive Telemetry Grid Backdrop */}
      <div
        className="fixed inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 15%, rgba(0, 173, 87, 0.28), transparent 55%), linear-gradient(to right, rgba(16, 185, 129, 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(16, 185, 129, 0.06) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 32px 32px, 32px 32px',
        }}
      />

      {/* Top Ignite Evaluation Context Strip */}
      <div className="relative z-10 w-full max-w-[440px] mb-3 flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900/90 border border-emerald-500/25 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
          <span className="text-[11px] font-bold tracking-wider text-emerald-400 uppercase">
            Ignite Interactive Core Telemetry Node
          </span>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Expo 58 · Fastify · PostGIS
        </span>
      </div>

      {/* 1. SLEEK MOBILE-VIEWPORT DEVICE FRAME */}
      <div className="relative z-10 w-full max-w-[430px] rounded-[44px] p-3 bg-gradient-to-b from-slate-800 via-slate-900 to-slate-950 border-[3px] border-slate-700/80 shadow-[0_25px_80px_-15px_rgba(0,173,87,0.35)]">
        {/* Hardware Speaker & Dynamic Island Notch */}
        <div className="flex items-center justify-between px-6 pt-1 pb-2 text-[10px] text-emerald-200/80">
          <span>9:41</span>
          <div className="w-24 h-4 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500/80 animate-pulse" />
            <span className="text-[8px] text-emerald-400 tracking-tighter">GNSS HIGH</span>
          </div>
          <span>5G · 100%</span>
        </div>

        {/* Inner Mobile Screen matching app/(tabs)/radar.tsx background (C.dark = #033622) */}
        <div
          className="rounded-[34px] overflow-hidden border border-emerald-500/25 flex flex-col"
          style={{ backgroundColor: C.dark }}
        >
          {/* 2. UPPER TELEMETRY HEADER */}
          <div className="p-3.5 pb-3 border-b border-emerald-500/20 bg-slate-950/55 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <BrandMarkSvg size={38} />
                <div>
                  <div className="flex items-center gap-1.5">
                    <h1 className="text-sm font-black tracking-tight text-white">FogRadar v0.5 Engine</h1>
                    <span
                      className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: '#FFF3CE', color: '#9F6A00' }}
                    >
                      FIELD TEST
                    </span>
                  </div>
                  <p className="text-[10px] text-emerald-300/80 tracking-wide">
                    EARLY WARNING. SAFER JOURNEYS.
                  </p>
                </div>
              </div>

              {/* Render Cloud API Operational Badge */}
              <div className="px-2 py-1 rounded-lg bg-emerald-950/90 border border-emerald-500/40 text-right">
                <div className="text-[9px] font-bold text-emerald-300">Render Cloud API: Operational</div>
                <div className="text-[8px] text-emerald-400/80">GET /health 200 · TLS + PostGIS</div>
              </div>
            </div>

            {/* Animated Pulsing Emerald Status Line */}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wide"
                style={{ backgroundColor: '#C2F7D4', color: '#19472B' }}
              >
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                <span>● LIVE SOCKET CONTEXT CONNECTED</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-200">1.0 km RANGE</span>
            </div>

            {/* Dropdown Preset for Pakistan Motorways (M-1, M-2, M-3, M-4, M-5, M-9) + Interactive Matrix Preset */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[9px] text-emerald-300/80 font-bold mb-0.5 uppercase">
                  SELECT MOTORWAY (ROUTE)
                </label>
                <select
                  value={route}
                  onChange={e => setRoute(e.target.value as MotorwayRoute)}
                  className="w-full rounded-lg bg-[#0B4C32] border border-[#2F8059] text-white text-[11px] font-bold px-2 py-1.5 focus:outline-none focus:border-emerald-400"
                >
                  {MOTORWAY_ROUTES.map(r => (
                    <option key={r} value={r} className="bg-slate-900 text-white">
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[9px] text-emerald-300/80 font-bold mb-0.5 uppercase">
                  PROXIMITY MATRIX PRESET
                </label>
                <select
                  value={presetMode}
                  onChange={e => applyPreset(e.target.value as 'red-yellow' | 'red-green' | 'uncertain')}
                  className="w-full rounded-lg bg-[#0B4C32] border border-[#2F8059] text-white text-[11px] font-bold px-2 py-1.5 focus:outline-none focus:border-emerald-400"
                >
                  <option value="red-yellow" className="bg-slate-900 text-white">
                    Red (≤80m) + Yellow (80-250m)
                  </option>
                  <option value="red-green" className="bg-slate-900 text-white">
                    Red (≤80m) + Green (250-1000m)
                  </option>
                  <option value="uncertain" className="bg-slate-900 text-white">
                    High GPS Error → Gray Uncertain
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* Main Mobile Body matching app/(tabs)/radar.tsx */}
          <div className="px-3.5 py-3 space-y-2.5">
            {/* Corroborated Experimental Hazard Banner from app/(tabs)/radar.tsx */}
            {showHazardBanner && (
              <div
                onClick={() =>
                  setHazardType(curr =>
                    curr === 'Heavy fog'
                      ? 'Stopped traffic'
                      : curr === 'Stopped traffic'
                        ? 'Accident'
                        : curr === 'Accident'
                          ? 'Vehicle breakdown'
                          : 'Heavy fog'
                  )
                }
                title="Click to cycle 4 project HazardTypes"
                className="cursor-pointer rounded-[14px] p-2.5 flex items-center gap-2.5 shadow-md border border-red-400/30 transition hover:brightness-110"
                style={{ backgroundColor: '#A72E36' }}
              >
                <AppIcon name="alert" color="#FFFFFF" size={20} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-black text-white leading-tight">
                    UNVERIFIED HAZARD REPORT · 2 TRIPS CORROBORATED
                  </div>
                  <div className="text-[10px] text-[#FFE2E3] truncate mt-0.5">
                    {hazardType} · about 140 m ahead · {route} (tap to cycle type)
                  </div>
                </div>
              </div>
            )}

            {/* 3. CIRCULAR RADAR CANVAS (Exact SVG + Polar Math from src/components/RadarCanvas.tsx) */}
            <div className="flex flex-col items-center">
              <div className="relative" style={{ width: SIZE, height: SIZE }}>
                <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block">
                  <defs>
                    <radialGradient id="radarFill">
                      <stop offset="0%" stopColor="#108D51" />
                      <stop offset="100%" stopColor="#004228" />
                    </radialGradient>
                    <linearGradient id="sweepGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#73FFD2" stopOpacity="0.42" />
                      <stop offset="100%" stopColor="#108D51" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Outer Radar Circle */}
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={RADIUS}
                    fill="url(#radarFill)"
                    stroke="#39C278"
                    strokeWidth="1.7"
                  />

                  {/* Concentric Range Rings: 330m (.33), 660m (.66), 1000m (1.0) */}
                  {[0.33, 0.66, 1].map(v => (
                    <circle
                      key={v}
                      cx={CENTER}
                      cy={CENTER}
                      r={RADIUS * v}
                      stroke="#5AF2A0"
                      strokeOpacity={0.48}
                      strokeWidth={1.15}
                      fill="none"
                    />
                  ))}

                  {/* Crosshair Lines */}
                  <line
                    x1={15}
                    x2={SIZE - 15}
                    y1={CENTER}
                    y2={CENTER}
                    stroke="#49CF88"
                    strokeOpacity={0.27}
                  />
                  <line
                    x1={CENTER}
                    x2={CENTER}
                    y1={15}
                    y2={SIZE - 15}
                    stroke="#49CF88"
                    strokeOpacity={0.27}
                  />

                  {/* Forward Heading Cone (±60° ahead cone from RadarCanvas.tsx) */}
                  <path
                    d={`M${CENTER} ${CENTER} L${CENTER - 42} ${CENTER - 105} A${RADIUS} ${RADIUS} 0 0 1 ${CENTER + 42} ${CENTER - 105}Z`}
                    fill="#73FFD2"
                    fillOpacity={0.12}
                  />

                  {/* 360-Degree Spinning Radar Sweep Line & Sector */}
                  <g
                    style={{
                      transformOrigin: `${CENTER}px ${CENTER}px`,
                      animation: 'spin 4s linear infinite',
                    }}
                  >
                    <path
                      d={`M${CENTER} ${CENTER} L${CENTER} ${CENTER - RADIUS} A${RADIUS} ${RADIUS} 0 0 1 ${CENTER + 58} ${CENTER - RADIUS + 14} Z`}
                      fill="url(#sweepGrad)"
                    />
                    <line
                      x1={CENTER}
                      y1={CENTER}
                      x2={CENTER}
                      y2={CENTER - RADIUS}
                      stroke="#73FFD2"
                      strokeWidth="2"
                    />
                  </g>
                </svg>

                {/* Ring Distance Labels (330m / 660m / 1000m) */}
                <span
                  className="absolute text-[8px] font-bold text-emerald-200/70 pointer-events-none"
                  style={{ left: CENTER + 4, top: CENTER - RADIUS * 0.33 + 2 }}
                >
                  330m
                </span>
                <span
                  className="absolute text-[8px] font-bold text-emerald-200/70 pointer-events-none"
                  style={{ left: CENTER + 4, top: CENTER - RADIUS * 0.66 + 2 }}
                >
                  660m
                </span>
                <span
                  className="absolute text-[8px] font-bold text-emerald-200/70 pointer-events-none"
                  style={{ left: CENTER + 4, top: CENTER - RADIUS + 16 }}
                >
                  1000m
                </span>

                {/* HEADING ↑ Indicator from RadarCanvas.tsx */}
                <div className="absolute inset-x-0 top-2.5 flex justify-center pointer-events-none">
                  <span className="text-[9px] font-extrabold tracking-[1.4px] text-[#C3F8DC]">
                    HEADING ↑ ({ownHeading}°)
                  </span>
                </div>

                {/* Vehicle Blips using exact proximityColor() matrix */}
                {renderedMarkers.map(({ vehicle, x, y, colors }) => (
                  <div
                    key={vehicle.id}
                    className="absolute flex flex-col items-center transition-all duration-700"
                    style={{ width: 64, left: x - 32, top: y - 18 }}
                  >
                    <div
                      className="rounded-[12px] p-1.5 border-2 shadow-md flex items-center justify-center"
                      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                    >
                      <AppIcon name="car" size={15} color={colors.ink} />
                    </div>
                    <div
                      className="mt-0.5 px-1.5 py-0.5 rounded-[7px] border text-center leading-tight shadow"
                      style={{ backgroundColor: '#022F20', borderColor: colors.border }}
                    >
                      <div className="text-[10px] font-black text-white">{vehicle.distanceMeters} m</div>
                      <div className="text-[8px] text-[#DBFFEB]">{vehicle.speedKmh ?? '—'} km/h</div>
                    </div>
                  </div>
                ))}

                {/* Central "YOU" Car + Arrow Icon matching RadarCanvas.tsx */}
                <div
                  className="absolute flex flex-col items-center bg-white rounded-[12px] pt-1 pb-0.5 border-2 shadow-lg"
                  style={{
                    width: 48,
                    left: CENTER - 24,
                    top: CENTER - 25,
                    borderColor: '#69EBA0',
                  }}
                >
                  <AppIcon name="car" color={C.forest} size={22} />
                  <span className="text-[8px] font-black" style={{ color: C.forest }}>
                    YOU ▲
                  </span>
                </div>
              </div>

              {/* ProximityLegend from src/components/RadarCanvas.tsx */}
              <div className="text-center pt-1.5">
                <div className="text-[10px] font-bold text-[#D5F9E2]">
                  ● Red ≤80 m · ● Yellow 80–250 m · ● Green 250–1000 m
                </div>
                <div className="text-[9px] text-[#A6DABF] mt-0.5">
                  Gray = position accuracy uncertain (&gt;35m or boundary overlap). Color ≠ collision-risk score.
                </div>
              </div>
            </div>

            {/* 3 Telemetry Cards Row from app/(tabs)/radar.tsx */}
            <div className="grid grid-cols-3 gap-2">
              <div
                className="rounded-[14px] p-2 flex flex-col items-center border"
                style={{ backgroundColor: '#0E5B39', borderColor: '#1C7850' }}
              >
                <AppIcon name="car" color={C.bright} size={16} />
                <span className="text-xs font-black text-white mt-1">{vehicles.length}</span>
                <span className="text-[9px] text-[#BDE8CF]">Nearby phones</span>
              </div>
              <div
                className="rounded-[14px] p-2 flex flex-col items-center border"
                style={{ backgroundColor: '#0E5B39', borderColor: '#1C7850' }}
              >
                <AppIcon name="radar" color={C.bright} size={16} />
                <span className="text-xs font-black text-white mt-1">{ownSpeed} km/h</span>
                <span className="text-[9px] text-[#BDE8CF]">Real GPS speed</span>
              </div>
              <div
                className="rounded-[14px] p-2 flex flex-col items-center border"
                style={{ backgroundColor: '#0E5B39', borderColor: '#1C7850' }}
              >
                <AppIcon name="road" color={C.bright} size={16} />
                <span className="text-xs font-black text-white mt-1">{ownHeading}°</span>
                <span className="text-[9px] text-[#BDE8CF]">Travel heading</span>
              </div>
            </div>

            {/* Nearby Connected Devices List from app/(tabs)/radar.tsx */}
            <div
              className="rounded-[14px] p-2.5 border"
              style={{ backgroundColor: '#0B4C32', borderColor: '#2F8059' }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-extrabold text-white">
                  Nearby connected devices ({vehicles.length})
                </span>
                <span className="text-[9px] text-[#C1F1D7]">
                  Own GPS: ±{ownAccuracy}m · Fix age: 0.4s
                </span>
              </div>
              <div className="divide-y divide-[#398A64]/60">
                {renderedMarkers.map(({ vehicle, category, colors }, idx) => (
                  <div key={vehicle.id} className="py-1.5 flex items-center gap-2 text-[11px]">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: colors.dot }}
                    />
                    <span className="font-extrabold text-white min-w-[54px]">Phone {idx + 1}</span>
                    <span className="font-black text-white">{vehicle.distanceMeters} m</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-950/50 text-emerald-200 uppercase">
                      {category}
                    </span>
                    <span className="flex-1 text-right text-[10px] text-[#C1F1D7]">
                      ±{ownAccuracy + vehicle.accuracyMeters} m · {vehicle.speedKmh} km/h
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. REAL-TIME NODE ACTIVITY FEED (Socket.IO + Redis 7 GEO + PostGIS) */}
            <div className="rounded-[14px] bg-slate-950/90 border border-emerald-500/30 p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400">
                    Real-Time Node Activity Feed (Socket.IO / Redis 7 / PostGIS)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowHazardBanner(b => !b)}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                >
                  {showHazardBanner ? 'Hide Hazard' : 'Trigger Hazard'}
                </button>
              </div>
              <div className="h-28 overflow-y-auto space-y-1 pr-1 text-[10px] leading-relaxed">
                {logs.map(item => (
                  <div key={item.id} className="flex items-start gap-1.5 font-mono">
                    <span className="text-slate-500 shrink-0">[{item.ts}]</span>
                    <span
                      className={`px-1 rounded text-[9px] font-bold shrink-0 ${
                        item.tone === 'crimson'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                          : item.tone === 'amber'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {item.tag}
                    </span>
                    <span className="text-slate-200 break-all">{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 5. BOTTOM CTA CALLOUT */}
            <button
              type="button"
              onClick={() => setShowDemoModal(true)}
              className="w-full py-3 px-4 rounded-[15px] font-black text-xs uppercase tracking-wider text-white shadow-lg bg-gradient-to-r from-[#D92D39] via-rose-600 to-teal-500 hover:brightness-110 active:scale-[0.99] transition flex items-center justify-center gap-2 border border-white/20"
            >
              <AppIcon name="play" color="#FFFFFF" size={16} />
              <span>Launch 30s MVP System Demo Video</span>
            </button>
          </div>

          {/* Bottom Tab Bar matching app/(tabs)/_layout.tsx (Home, Live Radar, Alerts, Settings) */}
          <div className="bg-white border-t border-[#E1E9E4] px-4 py-2 flex items-center justify-around text-[10px] font-extrabold">
            <div className="flex flex-col items-center gap-0.5 text-[#6B8077]">
              <AppIcon name="home" size={17} color="#6B8077" />
              <span>Home</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 text-[#008A45]">
              <AppIcon name="radar" size={17} color="#008A45" />
              <span>Live Radar</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 text-[#6B8077]">
              <AppIcon name="alert" size={17} color="#6B8077" />
              <span>Alerts</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 text-[#6B8077]">
              <AppIcon name="settings" size={17} color="#6B8077" />
              <span>Settings</span>
            </div>
          </div>
        </div>
      </div>

      {/* Modal for 30s MVP System Demo Video Callout */}
      {showDemoModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-emerald-500/40 p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black text-white uppercase tracking-wide">
                FogRadar v0.5 — 30s MVP Field-Test Walkthrough
              </h2>
              <button
                type="button"
                onClick={() => setShowDemoModal(false)}
                className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white"
              >
                ✕ Close
              </button>
            </div>
            <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
              <p>
                <strong className="text-emerald-400">00s–10s (Handshake):</strong> Two phones on{' '}
                <span className="text-white font-bold">{route}</span> obtain 8-hour HMAC-SHA256 tokens via{' '}
                <code>POST /v1/session</code> and connect via Socket.IO WebSocket.
              </p>
              <p>
                <strong className="text-emerald-400">10s–20s (Redis 7 GEO Radar):</strong> Foreground GNSS fixes (≤50m
                accuracy) stream via <code>telemetry:update</code>; Redis <code>GEOSEARCH</code> broadcasts 1000m
                bearing-rotated snapshots every 2s with uncertainty-aware Red/Yellow/Green/Gray zones.
              </p>
              <p>
                <strong className="text-emerald-400">20s–30s (PostGIS Dual-Trip Corroboration):</strong> First passenger
                report records as <code>candidate</code>; second independent trip within 150m &amp; &lt;45° heading
                delta upgrades state to <code>corroborated</code>, triggering Urdu TTS &amp; Haptic alerts.
              </p>
            </div>
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowDemoModal(false)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
              >
                Back to Live Telemetry Node
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


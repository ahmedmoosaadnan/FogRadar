import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import type { LiveHazard, NearbyVehicle } from '../cloud/CloudContext';
import { proximityColor, type ProximityColor } from '../utils/proximity';
import {
  LANE_WIDTH_METERS,
  projectVehicleToRoad,
  scaleDistanceNorm,
  type HeadingSource,
  type ProjectedVehicle,
} from '../utils/roadGeometry';
import { extrapolateVehiclePosition } from '../utils/deadReckoning';

export { proximityColor } from '../utils/proximity';

const SVG_FONT = Platform.select({
  web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  ios: 'System',
  android: 'sans-serif',
  default: 'sans-serif',
});

const WIDTH = Math.min(Dimensions.get('window').width - 28, 400);
const HEIGHT = 430;
const TOP_Y = 30;
const OWN_Y = HEIGHT - 84;
const ROAD_LEN = OWN_Y - TOP_Y;
const OWN_X = WIDTH * 0.44;
const LANE_W0 = 50;

const ZONE_STYLE: Record<
  ProximityColor,
  { fill: string; stroke: string; badgeBg: string; text: string; dot: string }
> = {
  red: { fill: '#450A0A', stroke: '#EF4444', badgeBg: '#7F1D1D', text: '#FEE2E2', dot: '#EF4444' },
  yellow: { fill: '#451A03', stroke: '#F59E0B', badgeBg: '#78350F', text: '#FEF3C7', dot: '#FBBF24' },
  green: { fill: '#022C22', stroke: '#10B981', badgeBg: '#064E3B', text: '#D1FAE5', dot: '#34D399' },
  uncertain: { fill: '#1E293B', stroke: '#94A3B8', badgeBg: '#334155', text: '#E2E8F0', dot: '#94A3B8' },
};

const DISTANCE_RINGS = [
  { meters: 100, label: '100 m' },
  { meters: 250, label: '250 m' },
  { meters: 500, label: '500 m' },
  { meters: 1000, label: '1 km' },
];

export function formatVehicleDistance(distanceMeters: number): string {
  const rounded = Math.round(distanceMeters);
  return rounded < 10 ? '< 10 m' : `${rounded} m`;
}

function perspScale(t: number): number {
  return 1 - 0.56 * Math.max(0, Math.min(1, t));
}

function roadCenterX(t: number, curvePx: number): number {
  return OWN_X + curvePx * t * t;
}

function roadPoint(
  t: number,
  laneOffset: number,
  curvePx: number
): { x: number; y: number; scale: number } {
  const s = perspScale(t);
  const cx = roadCenterX(t, curvePx);
  const y = OWN_Y - t * ROAD_LEN;
  const x = cx + laneOffset * LANE_W0 * s;
  return { x, y, scale: s };
}

function buildCurvePath(laneOffset: number, curvePx: number, steps = 16): string {
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const { x, y } = roadPoint(t, laneOffset, curvePx);
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
}

function buildRoadPolygon(leftLane: number, rightLane: number, curvePx: number, steps = 16): string {
  const leftPts: string[] = [];
  const rightPts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const l = roadPoint(t, leftLane, curvePx);
    const r = roadPoint(t, rightLane, curvePx);
    leftPts.push(`${i === 0 ? 'M' : 'L'}${l.x.toFixed(1)} ${l.y.toFixed(1)}`);
    rightPts.unshift(`L${r.x.toFixed(1)} ${r.y.toFixed(1)}`);
  }
  return `${leftPts.join(' ')} ${rightPts.join(' ')} Z`;
}

type AnimState = {
  from: Record<string, { forwardMeters: number; laneOffset: number; distanceMeters: number }>;
  to: Record<string, ProjectedVehicle>;
  startedAt: number;
};

export function ProximityLegend() {
  return (
    <View style={s.legend}>
      <Text style={s.legendText}>
        ● Red ≤80 m · ● Yellow 80–250 m · ● Green 250–1000 m · ● Gray Uncertain
      </Text>
      <Text style={s.legendDetail}>
        Centered halo = GPS uncertainty exceeds lane offset. Color indicates proximity zone only.
      </Text>
    </View>
  );
}

/**
 * Clean top-down car silhouette SVG path with cabin, windshield, and tail lights.
 */
function CarSilhouette({
  w,
  h,
  fill,
  stroke,
  oncoming = false,
  isOwn = false,
}: {
  w: number;
  h: number;
  fill: string;
  stroke: string;
  oncoming?: boolean;
  isOwn?: boolean;
}) {
  const hw = w / 2;
  const hh = h / 2;
  // Aerodynamic top-down silhouette path
  const bodyPath = [
    `M 0 ${-hh}`,
    `C ${hw * 0.72} ${-hh}, ${hw} ${-hh * 0.68}, ${hw} ${-hh * 0.28}`,
    `L ${hw} ${hh * 0.66}`,
    `C ${hw} ${hh * 0.92}, ${hw * 0.65} ${hh}, 0 ${hh}`,
    `C ${-hw * 0.65} ${hh}, ${-hw} ${hh * 0.92}, ${-hw} ${hh * 0.66}`,
    `L ${-hw} ${-hh * 0.28}`,
    `C ${-hw} ${-hh * 0.68}, ${-hw * 0.72} ${-hh}, 0 ${-hh} Z`,
  ].join(' ');

  return (
    <G rotation={oncoming ? 180 : 0}>
      {/* Car body */}
      <Path d={bodyPath} fill={fill} stroke={stroke} strokeWidth={isOwn ? 2.2 : 1.7} />
      {/* Front windshield */}
      <Path
        d={`M ${-hw * 0.64} ${-hh * 0.36} Q 0 ${-hh * 0.54} ${hw * 0.64} ${-hh * 0.36} L ${hw * 0.56} ${-hh * 0.04} Q 0 ${-hh * 0.14} ${-hw * 0.56} ${-hh * 0.04} Z`}
        fill={isOwn ? '#06472D' : stroke}
        fillOpacity={isOwn ? 0.92 : 0.38}
      />
      {/* Rear window */}
      <Path
        d={`M ${-hw * 0.52} ${hh * 0.28} Q 0 ${hh * 0.22} ${hw * 0.52} ${hh * 0.28} L ${hw * 0.44} ${hh * 0.56} Q 0 ${hh * 0.62} ${-hw * 0.44} ${hh * 0.56} Z`}
        fill={isOwn ? '#06472D' : stroke}
        fillOpacity={isOwn ? 0.65 : 0.25}
      />
      {/* Tail lights */}
      <Rect x={-hw * 0.76} y={hh * 0.78} width={hw * 0.42} height={2.4} rx={1} fill={oncoming ? '#FDE68A' : '#EF4444'} />
      <Rect x={hw * 0.34} y={hh * 0.78} width={hw * 0.42} height={2.4} rx={1} fill={oncoming ? '#FDE68A' : '#EF4444'} />
    </G>
  );
}

function VehicleCarSvg({
  x,
  y,
  scale,
  proj,
  color,
  closingKmh,
  pulsePhase,
  lowPerf,
}: {
  x: number;
  y: number;
  scale: number;
  proj: ProjectedVehicle;
  color: ProximityColor;
  closingKmh: number | null;
  pulsePhase: number;
  lowPerf: boolean;
}) {
  const style = ZONE_STYLE[color];
  const carW = Math.max(16, 23 * (0.56 + 0.44 * scale));
  const carH = carW * 1.72;
  const oncoming = proj.direction === 'oncoming';
  const strokeColor = oncoming ? '#FBBF24' : style.stroke;
  const fastClosing = closingKmh !== null && closingKmh >= 15 && proj.distanceMeters <= 300;

  return (
    <G transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}>
      {/* Proximity glow */}
      {!lowPerf ? (
        <Circle cx={0} cy={0} r={carH * 0.68} fill={strokeColor} fillOpacity={0.14} />
      ) : null}

      {/* Fast-closing red pulse */}
      {fastClosing && !lowPerf ? (
        <Circle
          cx={0}
          cy={0}
          r={carH * (0.65 + 0.35 * pulsePhase)}
          fill="none"
          stroke="#EF4444"
          strokeOpacity={0.85 * (1 - pulsePhase)}
          strokeWidth={2}
        />
      ) : null}

      {/* Uncertainty halo */}
      {proj.hasUncertaintyHalo ? (
        <Circle
          cx={0}
          cy={0}
          r={carH * 0.76}
          fill={style.stroke}
          fillOpacity={0.08}
          stroke={style.stroke}
          strokeOpacity={0.55}
          strokeWidth={1.2}
          strokeDasharray="3 3"
        />
      ) : null}

      <CarSilhouette w={carW} h={carH} fill={style.fill} stroke={strokeColor} oncoming={oncoming} />

      {/* Closing-speed cue above nearest same-direction vehicle ahead */}
      {closingKmh !== null && closingKmh >= 3 ? (
        <G transform={`translate(0, ${(-carH * 0.55 - 16).toFixed(1)})`}>
          <Rect
            x={-36}
            y={-8}
            width={72}
            height={16}
            rx={6}
            fill={fastClosing ? '#991B1B' : '#1E293B'}
            stroke={fastClosing ? '#EF4444' : '#F59E0B'}
            strokeWidth={1}
          />
          <SvgText
            x={0}
            y={3}
            fill={fastClosing ? '#FEE2E2' : '#FDE68A'}
            fontSize={8.5}
            fontWeight="900"
            fontFamily={SVG_FONT}
            textAnchor="middle"
          >
            ▼ closing {closingKmh} km/h
          </SvgText>
        </G>
      ) : null}

      {/* Distance + speed badge */}
      <Rect
        x={-32}
        y={carH * 0.52 + 2}
        width={64}
        height={25}
        rx={6}
        fill="#070D14"
        fillOpacity={0.92}
        stroke={strokeColor}
        strokeWidth={0.9}
      />
      <SvgText
        x={0}
        y={carH * 0.52 + 13}
        fill="#FFFFFF"
        fontSize={10.5}
        fontWeight="900"
        fontFamily={SVG_FONT}
        textAnchor="middle"
      >
        {formatVehicleDistance(proj.distanceMeters)}
      </SvgText>
      <SvgText
        x={0}
        y={carH * 0.52 + 23.5}
        fill={style.text}
        fontSize={8.5}
        fontWeight="700"
        fontFamily={SVG_FONT}
        textAnchor="middle"
      >
        {proj.speedKmh !== null ? `${proj.speedKmh} km/h` : '— km/h'}
      </SvgText>
    </G>
  );
}

export function RoadRadarView({
  vehicles = [],
  hazards = [],
  effectiveHeading = null,
  headingSource = 'unknown',
  ownAccuracy = null,
  ownSpeedKmh = null,
  yawRateDegPerSec = 0,
  showOncoming = true,
  clockOffsetMs = 0,
}: {
  vehicles?: NearbyVehicle[];
  hazards?: LiveHazard[];
  effectiveHeading?: number | null;
  headingSource?: HeadingSource;
  ownAccuracy?: number | null;
  ownSpeedKmh?: number | null;
  yawRateDegPerSec?: number;
  showOncoming?: boolean;
  clockOffsetMs?: number;
}) {
  const extrapolatedVehicles = useMemo(() => {
    const now = Date.now();
    return vehicles.map(v => {
      const ex = extrapolateVehiclePosition(v, now, clockOffsetMs);
      return { ...v, distanceMeters: Math.round(ex.distanceMeters), bearing: ex.bearing };
    });
  }, [vehicles, clockOffsetMs]);

  const projected = useMemo(() => {
    if (effectiveHeading === null) return [];
    const list: ProjectedVehicle[] = [];
    for (const v of extrapolatedVehicles) {
      const p = projectVehicleToRoad(v, effectiveHeading, ownAccuracy);
      if (p && (showOncoming || p.direction !== 'oncoming')) list.push(p);
    }
    return list;
  }, [extrapolatedVehicles, effectiveHeading, ownAccuracy, showOncoming]);

  const animRef = useRef<AnimState>({ from: {}, to: {}, startedAt: Date.now() });
  const currentRef = useRef<Record<string, { forwardMeters: number; laneOffset: number; distanceMeters: number }>>({});
  const trailsRef = useRef<Record<string, Array<{ x: number; y: number }>>>({});
  const dashOffsetRef = useRef(0);
  const ownSpeedRef = useRef(ownSpeedKmh ?? 0);
  ownSpeedRef.current = ownSpeedKmh ?? 0;

  const [renderTick, setRenderTick] = useState(0);
  const [smoothCurvePx, setSmoothCurvePx] = useState(0);
  const [lowPerf, setLowPerf] = useState(false);
  const slowFramesRef = useRef(0);
  const targetCurvePx = Math.max(-72, Math.min(72, yawRateDegPerSec * 7.5));

  useEffect(() => {
    const nextTo: Record<string, ProjectedVehicle> = {};
    const nextFrom: Record<string, { forwardMeters: number; laneOffset: number; distanceMeters: number }> = {};
    for (const p of projected) {
      nextTo[p.id] = p;
      nextFrom[p.id] = currentRef.current[p.id] ?? {
        forwardMeters: p.forwardMeters,
        laneOffset: p.laneOffset,
        distanceMeters: p.distanceMeters,
      };
    }
    animRef.current = { from: nextFrom, to: nextTo, startedAt: Date.now() };
  }, [projected]);

  useEffect(() => {
    let raf = 0;
    let lastFrame = 0;
    const DURATION_MS = 500;

    const step = (ts: number) => {
      const frameInterval = lowPerf ? 66 : 33; // 30fps normal, 15fps performance guard
      if (lastFrame > 0) {
        const dt = ts - lastFrame;
        if (dt > 58) {
          slowFramesRef.current += 1;
          if (slowFramesRef.current >= 6 && !lowPerf) setLowPerf(true);
        } else if (dt < 40 && slowFramesRef.current > 0) {
          slowFramesRef.current = Math.max(0, slowFramesRef.current - 1);
        }
      }

      if (ts - lastFrame >= frameInterval) {
        const dtSec = lastFrame > 0 ? Math.min(0.1, (ts - lastFrame) / 1000) : 0.033;
        lastFrame = ts;

        // Animate lane dashes proportional to real own speed (stationary when speed is 0)
        const speedMps = Math.max(0, ownSpeedRef.current / 3.6);
        if (speedMps > 0.2) {
          dashOffsetRef.current = (dashOffsetRef.current - speedMps * dtSec * 3.8) % 16;
        }

        const elapsed = Date.now() - animRef.current.startedAt;
        const rawT = Math.min(1, elapsed / DURATION_MS);
        const ease = 1 - Math.pow(1 - rawT, 2);

        const nextCur: Record<string, { forwardMeters: number; laneOffset: number; distanceMeters: number }> = {};
        for (const [id, target] of Object.entries(animRef.current.to)) {
          const start = animRef.current.from[id] ?? target;
          nextCur[id] = {
            forwardMeters: start.forwardMeters + (target.forwardMeters - start.forwardMeters) * ease,
            laneOffset: start.laneOffset + (target.laneOffset - start.laneOffset) * ease,
            distanceMeters: start.distanceMeters + (target.distanceMeters - start.distanceMeters) * ease,
          };
        }
        currentRef.current = nextCur;
        setSmoothCurvePx(prev => prev + (targetCurvePx - prev) * 0.14);
        setRenderTick(t => (t + 1) % 100000);
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [targetCurvePx, lowPerf]);

  const pulsePhase = (Date.now() % 1400) / 1400;

  // Distance-only mode (heading unknown): glowing rings + car icons/dots + badges
  if (effectiveHeading === null) {
    const center = WIDTH / 2;
    const cy = HEIGHT / 2 + 12;
    const maxR = Math.min(WIDTH, HEIGHT) * 0.4;

    return (
      <View style={[s.container, { width: WIDTH, height: HEIGHT }]}>
        <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Defs>
            <RadialGradient id="youGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#10B981" stopOpacity="0.48" />
              <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={22} fill="#070D14" stroke="#1E3A2F" strokeWidth={1.5} />
          <SvgText
            x={center}
            y={24}
            fill="#FBBF24"
            fontSize={10.5}
            fontWeight="800"
            fontFamily={SVG_FONT}
            textAnchor="middle"
          >
            DISTANCE-ONLY · DIRECTION UNAVAILABLE
          </SvgText>

          {DISTANCE_RINGS.map(ring => {
            const r = scaleDistanceNorm(ring.meters) * maxR;
            return (
              <G key={ring.meters}>
                <Circle
                  cx={center}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="#10B981"
                  strokeOpacity={0.28}
                  strokeWidth={1.4}
                  strokeDasharray="4 4"
                />
                <SvgText
                  x={center}
                  y={cy - r + 13}
                  fill="#94A3B8"
                  fontSize={11}
                  fontWeight="800"
                  fontFamily={SVG_FONT}
                  textAnchor="middle"
                >
                  {ring.label}
                </SvgText>
              </G>
            );
          })}

          <Circle cx={center} cy={cy} r={36} fill="url(#youGlow)" />
          <G transform={`translate(${center}, ${cy})`}>
            <CarSilhouette w={24} h={40} fill="#FFFFFF" stroke="#10B981" isOwn />
            <SvgText x={0} y={4} fill="#FFFFFF" fontSize={8.5} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
              YOU
            </SvgText>
          </G>

          {extrapolatedVehicles.map((v, idx) => {
            const baseR = Math.max(46, scaleDistanceNorm(v.distanceMeters) * maxR);
            const count = Math.max(1, extrapolatedVehicles.length);
            const angle = (35 * Math.PI) / 180 + (idx * 2 * Math.PI) / count;
            const r = baseR + (count > 4 ? (idx % 2 === 0 ? 0 : 12) : 0);
            const vx = center + r * Math.sin(angle);
            const vy = cy - r * Math.cos(angle);
            const pillOffsetY = Math.cos(angle) > 0.55 ? 15 : 12;
            const style = ZONE_STYLE[proximityColor(v.distanceMeters, ownAccuracy, v.accuracyMeters)];
            return (
              <G key={v.id} transform={`translate(${vx.toFixed(1)}, ${vy.toFixed(1)})`}>
                <Circle cx={0} cy={0} r={14} fill={style.dot} fillOpacity={0.18} />
                <Circle cx={0} cy={0} r={8.5} fill={style.dot} stroke="#070D14" strokeWidth={2} />
                <Rect x={-30} y={pillOffsetY} width={60} height={24} rx={6} fill="#070D14" stroke={style.stroke} strokeWidth={1} />
                <SvgText x={0} y={pillOffsetY + 11.5} fill="#FFFFFF" fontSize={10} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
                  {formatVehicleDistance(v.distanceMeters)}
                </SvgText>
                <SvgText x={0} y={pillOffsetY + 21} fill={style.text} fontSize={8} fontWeight="700" fontFamily={SVG_FONT} textAnchor="middle">
                  {v.speedKmh !== null ? `${v.speedKmh} km/h` : '— km/h'}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
    );
  }

  // Known heading: Tesla-style curved perspective road view
  void renderTick;
  const animatedVehicles = projected.map(p => {
    const cur = currentRef.current[p.id] ?? p;
    return {
      ...p,
      forwardMeters: cur.forwardMeters,
      laneOffset: cur.laneOffset,
      distanceMeters: cur.distanceMeters,
    };
  });

  // Nearest same-direction vehicle ahead for closing-speed cue
  let nearestAheadId: string | null = null;
  let nearestAheadClosingKmh: number | null = null;
  let nearestForward = Infinity;
  for (const v of animatedVehicles) {
    if (v.forwardMeters > 0 && v.direction === 'same' && v.forwardMeters < nearestForward) {
      nearestForward = v.forwardMeters;
      nearestAheadId = v.id;
      if (ownSpeedKmh !== null && v.speedKmh !== null) {
        const diff = Math.round(ownSpeedKmh - v.speedKmh);
        nearestAheadClosingKmh = diff >= 3 ? diff : null;
      } else {
        nearestAheadClosingKmh = null;
      }
    }
  }

  const mainRoadPath = buildRoadPolygon(-1.5, 1.5, smoothCurvePx);
  const oppositeRoadPath = buildRoadPolygon(1.65, 2.55, smoothCurvePx);
  const leftEdge = buildCurvePath(-1.5, smoothCurvePx);
  const laneDivLeft = buildCurvePath(-0.5, smoothCurvePx);
  const laneDivRight = buildCurvePath(0.5, smoothCurvePx);
  const medianLine = buildCurvePath(1.57, smoothCurvePx);
  const rightEdge = buildCurvePath(2.55, smoothCurvePx);

  return (
    <View style={[s.container, { width: WIDTH, height: HEIGHT }]}>
      <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <Defs>
          <LinearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#04080E" />
            <Stop offset="100%" stopColor="#0B1520" />
          </LinearGradient>
          <LinearGradient id="asphaltGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0B131C" />
            <Stop offset="100%" stopColor="#162332" />
          </LinearGradient>
          <LinearGradient id="horizonFog" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#04080E" stopOpacity="0.96" />
            <Stop offset="32%" stopColor="#04080E" stopOpacity="0.45" />
            <Stop offset="100%" stopColor="#04080E" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="headlightCone" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0%" stopColor="#34D399" stopOpacity="0.32" />
            <Stop offset="100%" stopColor="#34D399" stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="ownCarGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#10B981" stopOpacity="0.5" />
            <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={22} fill="url(#bgGrad)" stroke="#1E3A2F" strokeWidth={1.5} />

        {/* Short rear strip behind own car */}
        <Polygon
          points={`${OWN_X - 1.5 * LANE_W0},${OWN_Y} ${OWN_X + 1.5 * LANE_W0},${OWN_Y} ${OWN_X + 1.65 * LANE_W0},${HEIGHT - 8} ${OWN_X - 1.65 * LANE_W0},${HEIGHT - 8}`}
          fill="#0E1722"
        />

        {/* Gradient asphalt carriageways */}
        <Path d={mainRoadPath} fill="url(#asphaltGrad)" />
        <Path d={oppositeRoadPath} fill="#141C27" />

        {/* Glowing shoulder lines + animated speed-scaled lane dashes + median */}
        <Path d={leftEdge} stroke="#38BDF8" strokeOpacity={0.35} strokeWidth={2.2} fill="none" />
        <Path
          d={laneDivLeft}
          stroke="#94A3B8"
          strokeOpacity={0.62}
          strokeWidth={1.5}
          strokeDasharray="8 8"
          strokeDashoffset={dashOffsetRef.current}
          fill="none"
        />
        <Path
          d={laneDivRight}
          stroke="#94A3B8"
          strokeOpacity={0.62}
          strokeWidth={1.5}
          strokeDasharray="8 8"
          strokeDashoffset={dashOffsetRef.current}
          fill="none"
        />
        <Path d={medianLine} stroke="#F59E0B" strokeOpacity={0.85} strokeWidth={2.2} fill="none" />
        <Path d={rightEdge} stroke="#38BDF8" strokeOpacity={0.28} strokeWidth={1.8} fill="none" />

        {/* Distance fog vignette towards the horizon */}
        <Rect x={0} y={0} width={WIDTH} height={HEIGHT * 0.42} rx={22} fill="url(#horizonFog)" />

        {/* Distance rings & labels drawn behind vehicles */}
        {DISTANCE_RINGS.map(ring => {
          const t = scaleDistanceNorm(ring.meters);
          const left = roadPoint(t, -1.5, smoothCurvePx);
          const right = roadPoint(t, 2.55, smoothCurvePx);
          return (
            <G key={ring.meters}>
              <Line
                x1={left.x - 10}
                y1={left.y}
                x2={right.x + 10}
                y2={right.y}
                stroke="#34D399"
                strokeOpacity={0.28}
                strokeWidth={1.1}
                strokeDasharray="4 4"
              />
              <SvgText
                x={Math.max(32, left.x - 14)}
                y={left.y + 4}
                fill="#CBD5E1"
                fontSize={11}
                fontWeight="800"
                fontFamily={SVG_FONT}
                textAnchor="end"
              >
                {ring.label}
              </SvgText>
            </G>
          );
        })}

        {/* Map-pin hazard markers with subtle pulse */}
        {hazards.map(h => {
          const t = scaleDistanceNorm(h.distanceMeters);
          const pt = roadPoint(t, 0, smoothCurvePx);
          return (
            <G key={h.id} transform={`translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`}>
              {!lowPerf ? (
                <Circle
                  cx={0}
                  cy={-10}
                  r={14 + 12 * pulsePhase}
                  fill="none"
                  stroke="#EF4444"
                  strokeOpacity={0.8 * (1 - pulsePhase)}
                  strokeWidth={1.8}
                />
              ) : null}
              {/* Map-pin body */}
              <Path
                d="M 0 0 C -8 -10 -12 -16 -12 -22 A 12 12 0 1 1 12 -22 C 12 -16 8 -10 0 0 Z"
                fill="#DC2626"
                stroke="#FCA5A5"
                strokeWidth={1.6}
              />
              <SvgText x={0} y={-18} fill="#FFFFFF" fontSize={12} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
                !
              </SvgText>
              <Rect x={-32} y={4} width={64} height={17} rx={6} fill="#450A0A" stroke="#EF4444" strokeWidth={1} />
              <SvgText x={0} y={16} fill="#FEE2E2" fontSize={9.5} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
                {formatVehicleDistance(h.distanceMeters)}
              </SvgText>
            </G>
          );
        })}

        {/* Nearby vehicles + short motion trails */}
        {(() => {
          const placed: Array<{ x: number; y: number; scale: number; proj: ProjectedVehicle; color: ProximityColor }> = [];
          for (const v of animatedVehicles) {
            const color = proximityColor(v.distanceMeters, ownAccuracy, v.accuracyMeters);
            let x: number;
            let y: number;
            let scale: number;
            if (v.forwardMeters >= 0) {
              const t = scaleDistanceNorm(v.forwardMeters);
              const pt = roadPoint(t, v.laneOffset, smoothCurvePx);
              x = pt.x;
              y = Math.min(pt.y, OWN_Y - 58);
              scale = pt.scale;
            } else {
              const rearRatio = Math.min(1, Math.abs(v.forwardMeters) / 150);
              y = Math.max(OWN_Y + 46, OWN_Y + 46 + rearRatio * (HEIGHT - OWN_Y - 74));
              x = OWN_X + Math.max(-1.2, Math.min(1.2, v.laneOffset)) * LANE_W0;
              scale = 0.95;
            }
            let fanStep = 0;
            while (placed.some(p => Math.abs(p.x - x) < 42 && Math.abs(p.y - y) < 38) && fanStep < 6) {
              fanStep += 1;
              const dir = fanStep % 2 === 1 ? 1 : -1;
              const mag = Math.ceil(fanStep / 2);
              x += dir * mag * 34;
              y -= mag * 10;
            }
            // Record short motion trail (last 3 distinct positions)
            const trail = trailsRef.current[v.id] ?? [];
            const lastPt = trail[trail.length - 1];
            if (!lastPt || Math.hypot(lastPt.x - x, lastPt.y - y) >= 3) {
              trailsRef.current[v.id] = [...trail, { x, y }].slice(-3);
            }
            placed.push({ x, y, scale, proj: v, color });
          }

          return placed.map(item => {
            const trail = lowPerf ? [] : trailsRef.current[item.proj.id] ?? [];
            const style = ZONE_STYLE[item.color];
            return (
              <G key={item.proj.id}>
                {trail.slice(0, -1).map((tp, idx) => (
                  <Circle
                    key={idx}
                    cx={tp.x}
                    cy={tp.y}
                    r={3 + idx * 1.2}
                    fill={style.stroke}
                    fillOpacity={0.18 + idx * 0.14}
                  />
                ))}
                <VehicleCarSvg
                  x={item.x}
                  y={item.y}
                  scale={item.scale}
                  proj={item.proj}
                  color={item.color}
                  closingKmh={item.proj.id === nearestAheadId ? nearestAheadClosingKmh : null}
                  pulsePhase={pulsePhase}
                  lowPerf={lowPerf}
                />
              </G>
            );
          });
        })()}

        {/* Own car at bottom center with headlight cone + glow */}
        <G transform={`translate(${OWN_X}, ${OWN_Y})`}>
          {!lowPerf ? <Circle cx={0} cy={0} r={42} fill="url(#ownCarGlow)" /> : null}
          <Polygon points="-12,-24 12,-24 34,-112 -34,-112" fill="url(#headlightCone)" />
          <CarSilhouette w={30} h={50} fill="#FFFFFF" stroke="#10B981" isOwn />
          <SvgText x={0} y={5} fill="#FFFFFF" fontSize={8.5} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
            YOU
          </SvgText>
        </G>

        {/* Top header tag */}
        <SvgText
          x={OWN_X}
          y={18}
          fill={headingSource === 'compass' ? '#FBBF24' : '#6EE7B7'}
          fontSize={10}
          fontWeight="800"
          fontFamily={SVG_FONT}
          textAnchor="middle"
          letterSpacing={0.8}
        >
          HEADING {Math.round(effectiveHeading)}° ↑ ({headingSource === 'compass' ? 'COMPASS' : 'GPS'}) · {LANE_WIDTH_METERS}m LANES
        </SvgText>
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    alignSelf: 'center',
    borderRadius: 22,
    overflow: 'hidden',
  },
  legend: {
    alignItems: 'center',
    paddingTop: 10,
  },
  legendText: {
    fontSize: 11,
    color: '#D5F9E2',
    fontWeight: '700',
    textAlign: 'center',
  },
  legendDetail: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 4,
    textAlign: 'center',
  },
});

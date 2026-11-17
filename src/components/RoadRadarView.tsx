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

export { proximityColor } from '../utils/proximity';

const SVG_FONT = Platform.select({
  web: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  ios: 'System',
  android: 'sans-serif',
  default: 'sans-serif',
});

const WIDTH = Math.min(Dimensions.get('window').width - 28, 400);
const HEIGHT = 420;
const TOP_Y = 28;
const OWN_Y = HEIGHT - 82;
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
        Centered halo = GPS uncertainty exceeds lane offset. Color ≠ collision-risk score.
      </Text>
    </View>
  );
}

export function formatVehicleDistance(distanceMeters: number): string {
  const rounded = Math.round(distanceMeters);
  return rounded < 10 ? '< 10 m' : `${rounded} m`;
}

function VehicleCarSvg({
  x,
  y,
  scale,
  proj,
  color,
}: {
  x: number;
  y: number;
  scale: number;
  proj: ProjectedVehicle;
  color: ProximityColor;
}) {
  const style = ZONE_STYLE[color];
  const carW = Math.max(15, 22 * (0.55 + 0.45 * scale));
  const carH = carW * 1.65;
  const oncoming = proj.direction === 'oncoming';

  return (
    <G transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}>
      {proj.hasUncertaintyHalo ? (
        <Circle
          cx={0}
          cy={0}
          r={carH * 0.72}
          fill={style.stroke}
          fillOpacity={0.12}
          stroke={style.stroke}
          strokeOpacity={0.55}
          strokeWidth={1.2}
          strokeDasharray="3 3"
        />
      ) : null}
      <G rotation={oncoming ? 180 : 0}>
        <Polygon
          points={`${-carW * 0.35},${-carH * 0.48} ${carW * 0.35},${-carH * 0.48} ${carW * 0.6},${-carH * 0.88} ${-carW * 0.6},${-carH * 0.88}`}
          fill={oncoming ? '#FBBF24' : style.stroke}
          fillOpacity={oncoming ? 0.28 : 0.18}
        />
        <Rect
          x={-carW / 2}
          y={-carH / 2}
          width={carW}
          height={carH}
          rx={carW * 0.28}
          fill={style.fill}
          stroke={oncoming ? '#FBBF24' : style.stroke}
          strokeWidth={1.8}
        />
        <Rect
          x={-carW * 0.34}
          y={-carH * 0.22}
          width={carW * 0.68}
          height={carH * 0.28}
          rx={2}
          fill={style.stroke}
          fillOpacity={0.35}
        />
      </G>
      <Rect
        x={-32}
        y={carH * 0.52 + 2}
        width={64}
        height={25}
        rx={6}
        fill="#070D14"
        fillOpacity={0.92}
        stroke={style.stroke}
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
  yawRateDegPerSec = 0,
  showOncoming = true,
}: {
  vehicles?: NearbyVehicle[];
  hazards?: LiveHazard[];
  effectiveHeading?: number | null;
  headingSource?: HeadingSource;
  ownAccuracy?: number | null;
  yawRateDegPerSec?: number;
  showOncoming?: boolean;
}) {
  const projected = useMemo(() => {
    if (effectiveHeading === null) return [];
    const list: ProjectedVehicle[] = [];
    for (const v of vehicles) {
      const p = projectVehicleToRoad(v, effectiveHeading, ownAccuracy);
      if (p && (showOncoming || p.direction !== 'oncoming')) list.push(p);
    }
    return list;
  }, [vehicles, effectiveHeading, ownAccuracy, showOncoming]);

  const animRef = useRef<AnimState>({ from: {}, to: {}, startedAt: Date.now() });
  const currentRef = useRef<Record<string, { forwardMeters: number; laneOffset: number; distanceMeters: number }>>({});
  const [renderTick, setRenderTick] = useState(0);
  const [smoothCurvePx, setSmoothCurvePx] = useState(0);
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
    const DURATION_MS = 1800;

    const step = (ts: number) => {
      if (ts - lastFrame >= 33) {
        lastFrame = ts;
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
  }, [targetCurvePx]);

  // Unknown heading: Distance-only ring view (never guesses left/right)
  if (effectiveHeading === null) {
    const center = WIDTH / 2;
    const cy = HEIGHT / 2 + 12;
    const maxR = Math.min(WIDTH, HEIGHT) * 0.4;

    return (
      <View style={[s.container, { width: WIDTH, height: HEIGHT }]}>
        <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Defs>
            <RadialGradient id="youGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#10B981" stopOpacity="0.45" />
              <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={22} fill="#081018" stroke="#1E3A2F" strokeWidth={1.5} />
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

          {/* Distance rings and labels drawn first (behind YOU and vehicle dots/pills) */}
          {DISTANCE_RINGS.map(ring => {
            const r = scaleDistanceNorm(ring.meters) * maxR;
            return (
              <G key={ring.meters}>
                <Circle
                  cx={center}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke="#1E3A2F"
                  strokeWidth={1.3}
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

          {/* Subtle glow + Own car at center */}
          <Circle cx={center} cy={cy} r={34} fill="url(#youGlow)" />
          <Rect x={center - 13} y={cy - 19} width={26} height={38} rx={7} fill="#FFFFFF" stroke="#10B981" strokeWidth={2.2} />
          <SvgText x={center} y={cy + 4} fill="#06472D" fontSize={9.5} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
            YOU
          </SvgText>

          {/* Plot each vehicle just outside YOU (minR=46), offset from top-center ring labels, fanned out if overlapping */}
          {vehicles.map((v, idx) => {
            const baseR = Math.max(46, scaleDistanceNorm(v.distanceMeters) * maxR);
            const count = Math.max(1, vehicles.length);
            // Start at 35° so vehicles avoid the 0° top-center ring label corridor ("100 m")
            const angle = (35 * Math.PI) / 180 + (idx * 2 * Math.PI) / count;
            // Subtle radial stagger if many vehicles share a similar ring
            const r = baseR + (count > 4 ? (idx % 2 === 0 ? 0 : 12) : 0);
            const vx = center + r * Math.sin(angle);
            const vy = cy - r * Math.cos(angle);
            const pillOffsetY = Math.cos(angle) > 0.55 ? 14 : 11;
            const style = ZONE_STYLE[proximityColor(v.distanceMeters, ownAccuracy, v.accuracyMeters)];
            return (
              <G key={v.id} transform={`translate(${vx.toFixed(1)}, ${vy.toFixed(1)})`}>
                <Circle cx={0} cy={0} r={8.5} fill={style.dot} stroke="#070D14" strokeWidth={2} />
                <Rect x={-27} y={pillOffsetY} width={54} height={18} rx={6} fill="#070D14" stroke={style.stroke} strokeWidth={1} />
                <SvgText x={0} y={pillOffsetY + 12.5} fill="#FFFFFF" fontSize={10} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
                  {formatVehicleDistance(v.distanceMeters)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
    );
  }

  // Known heading (GPS or Compass): Tesla-style curved perspective road view
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
            <Stop offset="0%" stopColor="#050A10" />
            <Stop offset="100%" stopColor="#0B1520" />
          </LinearGradient>
          <RadialGradient id="ownCarGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#10B981" stopOpacity="0.45" />
            <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={22} fill="url(#bgGrad)" stroke="#1E3A2F" strokeWidth={1.5} />

        {/* Short rear strip behind own car */}
        <Polygon
          points={`${OWN_X - 1.5 * LANE_W0},${OWN_Y} ${OWN_X + 1.5 * LANE_W0},${OWN_Y} ${OWN_X + 1.65 * LANE_W0},${HEIGHT - 8} ${OWN_X - 1.65 * LANE_W0},${HEIGHT - 8}`}
          fill="#0E1722"
        />

        {/* Main 3-lane carriageway + opposite oncoming carriageway */}
        <Path d={mainRoadPath} fill="#121E2B" />
        <Path d={oppositeRoadPath} fill="#161D28" />

        {/* Lane markings & median */}
        <Path d={leftEdge} stroke="#334155" strokeWidth={2} fill="none" />
        <Path d={laneDivLeft} stroke="#64748B" strokeOpacity={0.65} strokeWidth={1.4} strokeDasharray="8 8" fill="none" />
        <Path d={laneDivRight} stroke="#64748B" strokeOpacity={0.65} strokeWidth={1.4} strokeDasharray="8 8" fill="none" />
        <Path d={medianLine} stroke="#F59E0B" strokeOpacity={0.85} strokeWidth={2.2} fill="none" />
        <Path d={rightEdge} stroke="#334155" strokeWidth={1.6} fill="none" />

        {/* Larger, high-contrast distance rings (100 m, 250 m, 500 m, 1 km) */}
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
                strokeOpacity={0.32}
                strokeWidth={1.1}
                strokeDasharray="4 4"
              />
              <SvgText
                x={Math.max(30, left.x - 14)}
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

        {/* Hazards ahead plotted on the road at real distance */}
        {hazards.map(h => {
          const t = scaleDistanceNorm(h.distanceMeters);
          const pt = roadPoint(t, 0, smoothCurvePx);
          const shortType =
            h.type === 'Stopped traffic'
              ? 'STOPPED'
              : h.type === 'Vehicle breakdown'
                ? 'BREAKDOWN'
                : h.type === 'Heavy fog'
                  ? 'FOG'
                  : 'ACCIDENT';
          return (
            <G key={h.id} transform={`translate(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`}>
              <Polygon points="0,-13 13,10 -13,10" fill="#DC2626" stroke="#FCA5A5" strokeWidth={1.6} />
              <SvgText x={0} y={6} fill="#FFFFFF" fontSize={10} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
                !
              </SvgText>
              <Rect x={-36} y={13} width={72} height={22} rx={6} fill="#450A0A" stroke="#EF4444" strokeWidth={1} />
              <SvgText x={0} y={23} fill="#FEE2E2" fontSize={8.5} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
                {shortType}
              </SvgText>
              <SvgText x={0} y={32} fill="#FCA5A5" fontSize={8.5} fontWeight="800" fontFamily={SVG_FONT} textAnchor="middle">
                {h.distanceMeters} m
              </SvgText>
            </G>
          );
        })}

        {/* Nearby vehicles ahead and behind (clamped outside YOU, fanned out when overlapping) */}
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
              // Keep ahead vehicles and their pills clear above YOU (OWN_Y - 58)
              y = Math.min(pt.y, OWN_Y - 58);
              scale = pt.scale;
            } else {
              const rearRatio = Math.min(1, Math.abs(v.forwardMeters) / 150);
              y = Math.max(OWN_Y + 46, OWN_Y + 46 + rearRatio * (HEIGHT - OWN_Y - 74));
              x = OWN_X + Math.max(-1.2, Math.min(1.2, v.laneOffset)) * LANE_W0;
              scale = 0.95;
            }
            // Fan out slightly if overlapping an already-placed vehicle
            let fanStep = 0;
            while (placed.some(p => Math.abs(p.x - x) < 42 && Math.abs(p.y - y) < 38) && fanStep < 6) {
              fanStep += 1;
              const dir = fanStep % 2 === 1 ? 1 : -1;
              const mag = Math.ceil(fanStep / 2);
              x += dir * mag * 34;
              y -= mag * 10;
            }
            placed.push({ x, y, scale, proj: v, color });
          }
          return placed.map(item => (
            <VehicleCarSvg key={item.proj.id} x={item.x} y={item.y} scale={item.scale} proj={item.proj} color={item.color} />
          ));
        })()}

        {/* Own car at bottom center with subtle glow */}
        <G transform={`translate(${OWN_X}, ${OWN_Y})`}>
          <Circle cx={0} cy={0} r={38} fill="url(#ownCarGlow)" />
          <Polygon points="-14,-22 14,-22 22,-54 -22,-54" fill="#10B981" fillOpacity={0.16} />
          <Rect x={-14} y={-22} width={28} height={44} rx={8} fill="#FFFFFF" stroke="#10B981" strokeWidth={2.5} />
          <Rect x={-9} y={-11} width={18} height={11} rx={3} fill="#06472D" />
          <SvgText x={0} y={13} fill="#06472D" fontSize={9.5} fontWeight="900" fontFamily={SVG_FONT} textAnchor="middle">
            YOU
          </SvgText>
        </G>

        {/* Top header tag */}
        <SvgText
          x={OWN_X}
          y={17}
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

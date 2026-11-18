import { metersBetween } from './geo.js';

export type RoadDirection = 'dir-a' | 'dir-b' | 'forward' | 'backward' | 'unknown';

export type MotorwaySegmentRecord = {
  id: number;
  route: string;
  direction: string;
  kind?: 'main' | 'ramp-or-sliver';
  coords: Array<[number, number]>; // [lon, lat] oriented in travel direction
  lengthMeters: number;
  bearing?: number | null;
};

export type SnapResult =
  | {
      matched: true;
      segmentId: number;
      route: string;
      direction: string;
      chainageMeters: number;
      offsetMeters: number;
      localBearingDeg: number;
    }
  | {
      matched: false;
      ambiguous?: boolean;
    };

export type RoadShapePoint = {
  forwardMeters: number;
  lateralMeters: number;
};

const EARTH_R = 6371000;
const RAD = Math.PI / 180;

function toLocalEnu(
  originLat: number,
  originLon: number,
  targetLon: number,
  targetLat: number
): { e: number; n: number } {
  const cosLat = Math.cos(originLat * RAD);
  return {
    e: (targetLon - originLon) * RAD * EARTH_R * cosLat,
    n: (targetLat - originLat) * RAD * EARTH_R,
  };
}

function angleDeltaDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Projects a WGS84 point onto a LineString ([lon, lat][]) and returns
 * perpendicular offset (meters), chainage along the polyline (meters),
 * local segment bearing (0..360 deg), and snapped WGS84 point.
 */
export function projectPointToPolyline(
  latitude: number,
  longitude: number,
  coords: Array<[number, number]>
): {
  offsetMeters: number;
  chainageMeters: number;
  localBearingDeg: number;
  snapLat: number;
  snapLon: number;
} {
  if (coords.length < 2) {
    return { offsetMeters: Infinity, chainageMeters: 0, localBearingDeg: 0, snapLat: latitude, snapLon: longitude };
  }

  let bestDist = Infinity;
  let bestChainage = 0;
  let bestBearing = 0;
  let bestSnapLat = latitude;
  let bestSnapLon = longitude;
  let cumulative = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const pa = toLocalEnu(latitude, longitude, a[0], a[1]);
    const pb = toLocalEnu(latitude, longitude, b[0], b[1]);
    const dx = pb.e - pa.e;
    const dy = pb.n - pa.n;
    const segLenSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(segLenSq);

    let t = 0;
    if (segLenSq > 1e-9) {
      t = Math.max(0, Math.min(1, (-pa.e * dx - pa.n * dy) / segLenSq));
    }
    const projE = pa.e + t * dx;
    const projN = pa.n + t * dy;
    const dist = Math.hypot(projE, projN);

    if (dist < bestDist) {
      bestDist = dist;
      bestChainage = cumulative + t * segLen;
      bestBearing = segLen > 1e-6 ? ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 : 0;
      bestSnapLon = a[0] + t * (b[0] - a[0]);
      bestSnapLat = a[1] + t * (b[1] - a[1]);
    }
    cumulative += segLen;
  }

  return {
    offsetMeters: bestDist,
    chainageMeters: bestChainage,
    localBearingDeg: bestBearing,
    snapLat: bestSnapLat,
    snapLon: bestSnapLon,
  };
}

/**
 * Heading-aware snapping to motorway segments within maxOffsetMeters (default 60 m):
 * - Excludes ramp-or-sliver segments and fixes with poor accuracy (> 50 m).
 * - When vehicle heading is known and speed >= 3 m/s, prefers candidates whose local bearing
 *   differs from vehicle heading by < 60 deg.
 * - When heading is unknown (or cannot disambiguate), if two opposite-direction candidates
 *   have snap points within ~15 m of each other, marks the match "ambiguous" (unmatched).
 */
export function snapFixToSegments(
  latitude: number,
  longitude: number,
  accuracyMeters: number,
  segments: MotorwaySegmentRecord[],
  maxOffsetMeters = 60,
  vehicleHeadingDeg: number | null = null,
  vehicleSpeedMps: number | null = null
): SnapResult {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters > 50 || !segments.length) {
    return { matched: false };
  }

  const candidates: Array<{
    seg: MotorwaySegmentRecord;
    offsetMeters: number;
    chainageMeters: number;
    localBearingDeg: number;
    snapLat: number;
    snapLon: number;
  }> = [];

  for (const seg of segments) {
    if (seg.kind === 'ramp-or-sliver') continue;
    const proj = projectPointToPolyline(latitude, longitude, seg.coords);
    if (proj.offsetMeters <= maxOffsetMeters) {
      candidates.push({ seg, ...proj });
    }
  }

  if (!candidates.length) {
    return { matched: false };
  }

  candidates.sort((a, b) => a.offsetMeters - b.offsetMeters);

  const headingReliable =
    vehicleHeadingDeg !== null &&
    Number.isFinite(vehicleHeadingDeg) &&
    vehicleSpeedMps !== null &&
    Number.isFinite(vehicleSpeedMps) &&
    vehicleSpeedMps >= 3;

  if (headingReliable) {
    const aligned = candidates.filter(c => angleDeltaDeg(c.localBearingDeg, vehicleHeadingDeg) < 60);
    if (aligned.length > 0) {
      const best = aligned[0];
      return {
        matched: true,
        segmentId: best.seg.id,
        route: best.seg.route,
        direction: best.seg.direction,
        chainageMeters: best.chainageMeters,
        offsetMeters: best.offsetMeters,
        localBearingDeg: best.localBearingDeg,
      };
    }
    return { matched: false };
  }

  // Heading unknown: check if two opposite-direction candidates are within ~15 m of each other
  const best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const other = candidates[i];
    if (other.seg.direction !== best.seg.direction) {
      const sep = metersBetween(
        { latitude: best.snapLat, longitude: best.snapLon },
        { latitude: other.snapLat, longitude: other.snapLon }
      );
      if (sep <= 15) {
        return { matched: false, ambiguous: true };
      }
    }
  }

  return {
    matched: true,
    segmentId: best.seg.id,
    route: best.seg.route,
    direction: best.seg.direction,
    chainageMeters: best.chainageMeters,
    offsetMeters: best.offsetMeters,
    localBearingDeg: best.localBearingDeg,
  };
}

/**
 * Detects travel direction along an undirected segment from consecutive chainage changes with hysteresis.
 */
export function detectDirectionWithHysteresis(
  prevDirection: RoadDirection,
  prevChainage: number | null,
  newChainage: number,
  hysteresisMeters = 8
): RoadDirection {
  if (prevChainage === null || !Number.isFinite(prevChainage)) {
    return prevDirection;
  }
  const delta = newChainage - prevChainage;
  if (delta >= hysteresisMeters) return 'forward';
  if (delta <= -hysteresisMeters) return 'backward';
  return prevDirection;
}

/**
 * Computes road distance along chainage when both vehicles are matched to the same directed chain,
 * detects oncoming vehicles on opposite-direction chains of the same route,
 * and falls back to Haversine straight-line distance when unmatched or on different chains.
 */
export function computePairwiseRoadDistance(
  own: {
    latitude: number;
    longitude: number;
    route?: string;
    matched?: boolean;
    segmentId?: number | null;
    chainageMeters?: number | null;
    roadDirection?: string;
  },
  other: {
    latitude: number;
    longitude: number;
    route?: string;
    matched?: boolean;
    segmentId?: number | null;
    chainageMeters?: number | null;
    roadDirection?: string;
  }
): {
  usedRoadDistance: boolean;
  distanceMeters: number;
  aheadMeters: number | null;
  oncoming: boolean;
} {
  if (own.matched && other.matched && own.route && own.route === other.route) {
    const ownDir = own.roadDirection ?? 'unknown';
    const otherDir = other.roadDirection ?? 'unknown';

    if (
      own.segmentId != null &&
      own.segmentId === other.segmentId &&
      own.chainageMeters != null &&
      other.chainageMeters != null &&
      ownDir === otherDir
    ) {
      const chainageDiff = other.chainageMeters - own.chainageMeters;
      const distanceMeters = Math.abs(chainageDiff);
      const aheadMeters = ownDir === 'backward' ? -chainageDiff : chainageDiff;
      return { usedRoadDistance: true, distanceMeters, aheadMeters, oncoming: false };
    }

    if (ownDir !== 'unknown' && otherDir !== 'unknown' && ownDir !== otherDir) {
      return {
        usedRoadDistance: false,
        distanceMeters: metersBetween(own, other),
        aheadMeters: null,
        oncoming: true,
      };
    }
  }

  return {
    usedRoadDistance: false,
    distanceMeters: metersBetween(own, other),
    aheadMeters: null,
    oncoming: false,
  };
}

function interpolatePolylineAtChainage(
  coords: Array<[number, number]>,
  targetChainage: number,
  originLat: number,
  originLon: number
): { e: number; n: number } | null {
  if (coords.length < 2) return null;
  let cumulative = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const pa = toLocalEnu(originLat, originLon, coords[i][0], coords[i][1]);
    const pb = toLocalEnu(originLat, originLon, coords[i + 1][0], coords[i + 1][1]);
    const segLen = Math.hypot(pb.e - pa.e, pb.n - pa.n);
    if (targetChainage <= cumulative + segLen || i === coords.length - 2) {
      const t = segLen > 1e-6 ? Math.max(0, Math.min(1, (targetChainage - cumulative) / segLen)) : 0;
      return {
        e: pa.e + t * (pb.e - pa.e),
        n: pa.n + t * (pb.n - pa.n),
      };
    }
    cumulative += segLen;
  }
  return null;
}

/**
 * Extracts the next ~1 km of the matched directed chain ahead of the vehicle in local (forward, lateral) meters.
 */
export function extractUpcomingRoadShape(
  ownLat: number,
  ownLon: number,
  ownHeadingDeg: number | null,
  coords: Array<[number, number]>,
  chainageMeters: number,
  direction: string,
  maxRangeMeters = 1000,
  stepMeters = 100
): RoadShapePoint[] {
  if (coords.length < 2 || direction === 'unknown' || ownHeadingDeg === null) {
    return [];
  }

  const hRad = (ownHeadingDeg * Math.PI) / 180;
  const hEast = Math.sin(hRad);
  const hNorth = Math.cos(hRad);
  const sign = direction === 'backward' ? -1 : 1;

  const points: RoadShapePoint[] = [];
  for (let d = 0; d <= maxRangeMeters; d += stepMeters) {
    const targetC = Math.max(0, chainageMeters + sign * d);
    const enu = interpolatePolylineAtChainage(coords, targetC, ownLat, ownLon);
    if (!enu) break;
    const forwardMeters = enu.e * hEast + enu.n * hNorth;
    const lateralMeters = enu.e * hNorth - enu.n * hEast;
    points.push({
      forwardMeters: Math.round(forwardMeters),
      lateralMeters: Number(lateralMeters.toFixed(1)),
    });
  }
  return points;
}

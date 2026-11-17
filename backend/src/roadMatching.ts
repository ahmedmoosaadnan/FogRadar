import { metersBetween } from './geo.js';

export type RoadDirection = 'forward' | 'backward' | 'unknown';

export type MotorwaySegmentRecord = {
  id: number;
  route: string;
  direction: string;
  coords: Array<[number, number]>; // [lon, lat]
  lengthMeters: number;
};

export type SnapResult = {
  matched: true;
  segmentId: number;
  route: string;
  chainageMeters: number;
  offsetMeters: number;
} | {
  matched: false;
};

export type RoadShapePoint = {
  forwardMeters: number;
  lateralMeters: number;
};

const EARTH_R = 6371000;
const RAD = Math.PI / 180;

function toLocalEnu(originLat: number, originLon: number, targetLon: number, targetLat: number): { e: number; n: number } {
  const cosLat = Math.cos(originLat * RAD);
  return {
    e: (targetLon - originLon) * RAD * EARTH_R * cosLat,
    n: (targetLat - originLat) * RAD * EARTH_R,
  };
}

/**
 * Projects a WGS84 point onto a LineString ([lon, lat][]) and returns
 * perpendicular offset (meters) and chainage along the polyline (meters).
 */
export function projectPointToPolyline(
  latitude: number,
  longitude: number,
  coords: Array<[number, number]>
): { offsetMeters: number; chainageMeters: number } {
  if (coords.length < 2) {
    return { offsetMeters: Infinity, chainageMeters: 0 };
  }

  let bestDist = Infinity;
  let bestChainage = 0;
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
    }
    cumulative += segLen;
  }

  return { offsetMeters: bestDist, chainageMeters: bestChainage };
}

/**
 * Snaps a fix to a list of candidate motorway segments within maxOffsetMeters (default 60 m).
 * Poor-accuracy fixes (> 50 m) are marked unmatched.
 */
export function snapFixToSegments(
  latitude: number,
  longitude: number,
  accuracyMeters: number,
  segments: MotorwaySegmentRecord[],
  maxOffsetMeters = 60
): SnapResult {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters > 50 || !segments.length) {
    return { matched: false };
  }

  let best: SnapResult = { matched: false };
  let bestOffset = maxOffsetMeters;

  for (const seg of segments) {
    const { offsetMeters, chainageMeters } = projectPointToPolyline(latitude, longitude, seg.coords);
    if (offsetMeters <= bestOffset) {
      bestOffset = offsetMeters;
      best = {
        matched: true,
        segmentId: seg.id,
        route: seg.route,
        chainageMeters,
        offsetMeters,
      };
    }
  }

  return best;
}

/**
 * Detects travel direction along a segment from consecutive chainage changes with hysteresis.
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
 * Computes road distance along chainage when both vehicles are matched to the same segment;
 * otherwise falls back to Haversine straight-line distance.
 */
export function computePairwiseRoadDistance(
  own: {
    latitude: number;
    longitude: number;
    matched?: boolean;
    segmentId?: number | null;
    chainageMeters?: number | null;
    roadDirection?: RoadDirection;
  },
  other: {
    latitude: number;
    longitude: number;
    matched?: boolean;
    segmentId?: number | null;
    chainageMeters?: number | null;
    roadDirection?: RoadDirection;
  }
): {
  usedRoadDistance: boolean;
  distanceMeters: number;
  aheadMeters: number | null;
  oncoming: boolean;
} {
  if (
    own.matched &&
    other.matched &&
    own.segmentId != null &&
    own.segmentId === other.segmentId &&
    own.chainageMeters != null &&
    other.chainageMeters != null
  ) {
    const chainageDiff = other.chainageMeters - own.chainageMeters;
    const distanceMeters = Math.abs(chainageDiff);
    const ownDir = own.roadDirection ?? 'unknown';
    const otherDir = other.roadDirection ?? 'unknown';
    const oncoming = ownDir !== 'unknown' && otherDir !== 'unknown' && ownDir !== otherDir;
    const aheadMeters = ownDir === 'backward' ? -chainageDiff : chainageDiff;
    return { usedRoadDistance: true, distanceMeters, aheadMeters, oncoming };
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
 * Extracts the next ~1 km of the matched segment ahead of the vehicle in local (forward, lateral) meters.
 */
export function extractUpcomingRoadShape(
  ownLat: number,
  ownLon: number,
  ownHeadingDeg: number | null,
  coords: Array<[number, number]>,
  chainageMeters: number,
  direction: RoadDirection,
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


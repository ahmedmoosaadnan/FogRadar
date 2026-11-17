export type ProximityColor = 'red' | 'yellow' | 'green' | 'uncertain';

export const LANE_WIDTH_METERS = 3.6;
export const MIN_HEADING_SPEED_MPS = 3.0;
export const MAX_HEADING_ACCURACY_METERS = 35;
export const HEADING_HOLD_MS = 10_000;
export const YAW_WINDOW_MS = 15_000;
export const EMA_ALPHA = 0.35;

export type HeadingSample = {
  headingDeg: number;
  timestamp: number;
};

export type HeadingSource = 'gps' | 'compass' | 'unknown';

export type HeadingTrackerState = {
  smoothedHeading: number | null;
  lastGoodAt: number | null;
  source: HeadingSource;
  compassSmoothed: number | null;
  history: HeadingSample[];
};

export type VehicleRoadInput = {
  id: string;
  distanceMeters: number;
  bearing: number;
  speedKmh: number | null;
  heading: number | null;
  accuracyMeters: number;
  ageMs: number;
};

export type ProjectedVehicle = {
  id: string;
  distanceMeters: number;
  forwardMeters: number;
  lateralMeters: number;
  /** Normalized lane offset in lane widths (0 = own lane center; + = right; - = left). */
  laneOffset: number;
  lateralKnown: boolean;
  hasUncertaintyHalo: boolean;
  direction: 'same' | 'oncoming' | 'unknown';
  speedKmh: number | null;
  accuracyMeters: number;
};

export function createHeadingTrackerState(): HeadingTrackerState {
  return { smoothedHeading: null, lastGoodAt: null, source: 'unknown', compassSmoothed: null, history: [] };
}

export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function signedAngleDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

export function circularEma(prevDeg: number | null, nextDeg: number, alpha = EMA_ALPHA): number {
  const nextRad = (normalizeDegrees(nextDeg) * Math.PI) / 180;
  if (prevDeg === null || !Number.isFinite(prevDeg)) {
    return normalizeDegrees(nextDeg);
  }
  const prevRad = (normalizeDegrees(prevDeg) * Math.PI) / 180;
  const e = (1 - alpha) * Math.sin(prevRad) + alpha * Math.sin(nextRad);
  const n = (1 - alpha) * Math.cos(prevRad) + alpha * Math.cos(nextRad);
  if (Math.hypot(e, n) < 1e-6) return normalizeDegrees(nextDeg);
  return normalizeDegrees((Math.atan2(e, n) * 180) / Math.PI);
}

/**
 * Updates the own-heading tracker:
 * - Prefers GPS course when speed >= 3 m/s and accuracy <= 35 m (source = 'gps').
 * - Holds last good GPS heading for up to 10 s when speed is lower or accuracy is poor.
 * - Falls back to smoothed device compass heading (source = 'compass') when GPS course is unavailable.
 * - Otherwise marks heading unknown (null, source = 'unknown').
 */
export function updateHeadingTracker(
  state: HeadingTrackerState,
  input: {
    speedMps: number | null;
    headingDeg: number | null;
    accuracyMeters: number | null;
    compassHeadingDeg?: number | null;
    now: number;
  }
): {
  state: HeadingTrackerState;
  effectiveHeading: number | null;
  source: HeadingSource;
  yawRateDegPerSec: number;
} {
  const { speedMps, headingDeg, accuracyMeters, compassHeadingDeg = null, now } = input;
  const goodCourse =
    speedMps !== null &&
    Number.isFinite(speedMps) &&
    speedMps >= MIN_HEADING_SPEED_MPS &&
    headingDeg !== null &&
    Number.isFinite(headingDeg) &&
    accuracyMeters !== null &&
    Number.isFinite(accuracyMeters) &&
    accuracyMeters <= MAX_HEADING_ACCURACY_METERS;

  let nextCompass = state.compassSmoothed;
  if (compassHeadingDeg !== null && Number.isFinite(compassHeadingDeg)) {
    nextCompass = circularEma(state.compassSmoothed, compassHeadingDeg, 0.25);
  }

  let nextState: HeadingTrackerState;
  if (goodCourse) {
    const smoothed = circularEma(state.smoothedHeading, headingDeg);
    const cutoff = now - YAW_WINDOW_MS;
    const pruned = state.history.filter(h => h.timestamp >= cutoff);
    const history = [...pruned, { headingDeg: smoothed, timestamp: now }].slice(-30);
    nextState = {
      smoothedHeading: smoothed,
      lastGoodAt: now,
      source: 'gps',
      compassSmoothed: nextCompass,
      history,
    };
  } else {
    const stillValid = state.lastGoodAt !== null && now - state.lastGoodAt <= HEADING_HOLD_MS;
    if (stillValid && state.smoothedHeading !== null) {
      nextState = {
        smoothedHeading: state.smoothedHeading,
        lastGoodAt: state.lastGoodAt,
        source: 'gps',
        compassSmoothed: nextCompass,
        history: state.history.filter(h => h.timestamp >= now - YAW_WINDOW_MS),
      };
    } else if (nextCompass !== null) {
      nextState = {
        smoothedHeading: nextCompass,
        lastGoodAt: null,
        source: 'compass',
        compassSmoothed: nextCompass,
        history: [],
      };
    } else {
      nextState = {
        smoothedHeading: null,
        lastGoodAt: null,
        source: 'unknown',
        compassSmoothed: null,
        history: [],
      };
    }
  }

  let yawRateDegPerSec = 0;
  if (nextState.source === 'gps' && nextState.history.length >= 2) {
    const first = nextState.history[0];
    const last = nextState.history[nextState.history.length - 1];
    const dtSec = (last.timestamp - first.timestamp) / 1000;
    if (dtSec >= 1) {
      const dAngle = signedAngleDelta(first.headingDeg, last.headingDeg);
      yawRateDegPerSec = Math.max(-15, Math.min(15, dAngle / dtSec));
    }
  }

  return {
    state: nextState,
    effectiveHeading: nextState.smoothedHeading,
    source: nextState.source,
    yawRateDegPerSec,
  };
}

/**
 * Local ENU displacement (East, North) in meters from distance & compass bearing.
 */
export function enuFromDistanceBearing(distanceMeters: number, bearingDeg: number): { east: number; north: number } {
  const rad = (bearingDeg * Math.PI) / 180;
  return {
    east: distanceMeters * Math.sin(rad),
    north: distanceMeters * Math.cos(rad),
  };
}

/**
 * Local ENU displacement (East, North) in meters from two WGS84 coordinates.
 */
export function enuFromLatLon(
  own: { latitude: number; longitude: number },
  other: { latitude: number; longitude: number }
): { east: number; north: number } {
  const R = 6371000;
  const rad = Math.PI / 180;
  const meanLat = ((own.latitude + other.latitude) / 2) * rad;
  const north = (other.latitude - own.latitude) * rad * R;
  const east = (other.longitude - own.longitude) * rad * R * Math.cos(meanLat);
  return { east, north };
}

/**
 * Computes forward (along own heading) and lateral (right positive, cross product) in meters.
 * forward = dot(delta, ownHeadingUnit)
 * lateral = delta.east * ownHeadingUnit.north - delta.north * ownHeadingUnit.east
 */
export function forwardLateralFromEnu(
  delta: { east: number; north: number },
  ownHeadingDeg: number
): { forwardMeters: number; lateralMeters: number } {
  const rad = (ownHeadingDeg * Math.PI) / 180;
  const hEast = Math.sin(rad);
  const hNorth = Math.cos(rad);
  const forwardMeters = delta.east * hEast + delta.north * hNorth;
  const lateralMeters = delta.east * hNorth - delta.north * hEast;
  return { forwardMeters, lateralMeters };
}

/**
 * Non-linear distance scale (sqrt) so 0..1000 m fits the screen while 0..100 m is well separated.
 */
export function scaleDistanceNorm(distanceMeters: number, maxRangeMeters = 1000): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0;
  return Math.sqrt(Math.min(maxRangeMeters, distanceMeters) / maxRangeMeters);
}

/**
 * Projects a nearby vehicle onto the Tesla-style road view when own heading is known.
 * Returns null if ownHeading is null (caller must render distance-only mode).
 */
export function projectVehicleToRoad(
  vehicle: VehicleRoadInput,
  ownHeadingDeg: number | null,
  ownAccuracyMeters: number | null
): ProjectedVehicle | null {
  if (ownHeadingDeg === null || !Number.isFinite(ownHeadingDeg)) {
    return null;
  }

  const delta = enuFromDistanceBearing(vehicle.distanceMeters, vehicle.bearing);
  const { forwardMeters, lateralMeters } = forwardLateralFromEnu(delta, ownHeadingDeg);

  const combinedUncertainty =
    ownAccuracyMeters !== null && Number.isFinite(ownAccuracyMeters)
      ? Math.hypot(ownAccuracyMeters, vehicle.accuracyMeters)
      : Infinity;

  const absLateral = Math.abs(lateralMeters);
  const absForward = Math.abs(forwardMeters);
  const laneThreshold = combinedUncertainty + 1.5 * LANE_WIDTH_METERS;

  let laneOffset = 0;
  let lateralKnown = false;
  let hasUncertaintyHalo = false;

  if (absForward <= combinedUncertainty || absLateral <= combinedUncertainty) {
    // Forward or lateral offset is within combined GPS uncertainty -> center in own lane with uncertainty halo
    laneOffset = 0;
    lateralKnown = false;
    hasUncertaintyHalo = true;
  } else if (absLateral <= laneThreshold) {
    // Not enough separation beyond uncertainty + 1.5 lane widths to place in adjacent lane
    laneOffset = 0;
    lateralKnown = false;
    hasUncertaintyHalo = true;
  } else {
    lateralKnown = true;
    hasUncertaintyHalo = false;
    laneOffset = Math.max(-1.6, Math.min(2.2, lateralMeters / LANE_WIDTH_METERS));
  }

  let direction: 'same' | 'oncoming' | 'unknown' = 'unknown';
  if (vehicle.heading !== null && Number.isFinite(vehicle.heading)) {
    const deltaDeg = Math.abs(signedAngleDelta(ownHeadingDeg, vehicle.heading));
    direction = deltaDeg > 120 ? 'oncoming' : 'same';
  }

  // Oncoming vehicles belong on the opposite carriageway side (right of median for left-hand drive PK motorways)
  if (direction === 'oncoming') {
    laneOffset = Math.max(1.85, laneOffset);
  }

  return {
    id: vehicle.id,
    distanceMeters: vehicle.distanceMeters,
    forwardMeters,
    lateralMeters,
    laneOffset,
    lateralKnown,
    hasUncertaintyHalo,
    direction,
    speedKmh: vehicle.speedKmh,
    accuracyMeters: vehicle.accuracyMeters,
  };
}

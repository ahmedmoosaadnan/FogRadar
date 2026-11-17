export const MAX_EXTRAPOLATION_SECONDS = 3.0;

export type ExtrapolatableVehicle = {
  distanceMeters: number;
  bearing: number;
  speedKmh: number | null;
  heading: number | null;
  fixTime?: number;
};

/**
 * Computes corrected data age in ms: (now + clockOffsetMs) - fixTime, clamped >= 0.
 */
export function computeDataAgeMs(
  fixTime: number | undefined,
  now: number,
  clockOffsetMs = 0
): number | null {
  if (fixTime === undefined || !Number.isFinite(fixTime)) return null;
  return Math.max(0, Math.round(now + clockOffsetMs - fixTime));
}

/**
 * Dead reckoning: extrapolates a vehicle forward by (now + clockOffsetMs - fixTime)
 * using its real GPS speed and heading, capped at 3 seconds.
 */
export function extrapolateVehiclePosition(
  vehicle: ExtrapolatableVehicle,
  now: number,
  clockOffsetMs = 0
): { distanceMeters: number; bearing: number; extrapolatedSec: number } {
  const ageMs = computeDataAgeMs(vehicle.fixTime, now, clockOffsetMs);
  if (
    ageMs === null ||
    ageMs <= 0 ||
    vehicle.speedKmh === null ||
    !Number.isFinite(vehicle.speedKmh) ||
    vehicle.speedKmh <= 0 ||
    vehicle.heading === null ||
    !Number.isFinite(vehicle.heading)
  ) {
    return {
      distanceMeters: vehicle.distanceMeters,
      bearing: vehicle.bearing,
      extrapolatedSec: 0,
    };
  }

  const dtSec = Math.min(MAX_EXTRAPOLATION_SECONDS, ageMs / 1000);
  const speedMps = vehicle.speedKmh / 3.6;
  const travelM = speedMps * dtSec;

  const bRad = (vehicle.bearing * Math.PI) / 180;
  const baseEast = vehicle.distanceMeters * Math.sin(bRad);
  const baseNorth = vehicle.distanceMeters * Math.cos(bRad);
  const hRad = (vehicle.heading * Math.PI) / 180;
  const nextEast = baseEast + travelM * Math.sin(hRad);
  const nextNorth = baseNorth + travelM * Math.cos(hRad);

  const nextDist = Math.hypot(nextEast, nextNorth);
  const rawBearing = (Math.atan2(nextEast, nextNorth) * 180) / Math.PI;
  const nextBearing = nextDist < 1e-6 ? vehicle.bearing : ((rawBearing % 360) + 360) % 360;

  return {
    distanceMeters: nextDist,
    bearing: nextBearing,
    extrapolatedSec: dtSec,
  };
}

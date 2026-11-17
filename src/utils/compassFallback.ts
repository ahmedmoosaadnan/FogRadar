import { normalizeDegrees } from './roadGeometry';

export type Vec3 = { x: number; y: number; z: number };

/**
 * Computes tilt-compensated magnetic heading (0..360 deg clockwise from North)
 * from expo-sensors Magnetometer (uT) and optional Accelerometer (g) readings.
 */
export function computeTiltCompensatedHeading(mag: Vec3, accel: Vec3 | null): number | null {
  if (!Number.isFinite(mag.x) || !Number.isFinite(mag.y) || !Number.isFinite(mag.z)) {
    return null;
  }
  if (Math.hypot(mag.x, mag.y, mag.z) < 1e-3) {
    return null;
  }

  let pitch = 0;
  let roll = 0;
  if (
    accel &&
    Number.isFinite(accel.x) &&
    Number.isFinite(accel.y) &&
    Number.isFinite(accel.z) &&
    Math.hypot(accel.x, accel.y, accel.z) > 0.1
  ) {
    pitch = Math.atan2(accel.y, Math.hypot(accel.x, accel.z));
    roll = Math.atan2(-accel.x, Math.hypot(accel.y, accel.z));
  }

  const xh = mag.x * Math.cos(roll) + mag.z * Math.sin(roll);
  const yh =
    mag.x * Math.sin(pitch) * Math.sin(roll) +
    mag.y * Math.cos(pitch) -
    mag.z * Math.sin(pitch) * Math.cos(roll);

  if (Math.hypot(xh, yh) < 1e-6) {
    return null;
  }
  return normalizeDegrees((Math.atan2(-xh, yh) * 180) / Math.PI);
}


import assert from 'node:assert/strict';
import { computeDataAgeMs, extrapolateVehiclePosition } from '../src/utils/deadReckoning.ts';

// 1. Vehicle 100 m North moving North at 72 km/h (20 m/s), 1.5 s elapsed -> 130 m North
const northRes = extrapolateVehiclePosition(
  { distanceMeters: 100, bearing: 0, speedKmh: 72, heading: 0, fixTime: 10_000 },
  11_500,
  0
);
assert.ok(Math.abs(northRes.distanceMeters - 130) < 1e-6);
assert.ok(Math.abs(northRes.bearing) < 1e-6);
assert.equal(northRes.extrapolatedSec, 1.5);

// 2. Extrapolation is capped at 3 seconds (even if age is 10 s)
const cappedRes = extrapolateVehiclePosition(
  { distanceMeters: 100, bearing: 0, speedKmh: 36, heading: 0, fixTime: 10_000 },
  20_000,
  0
);
assert.equal(cappedRes.extrapolatedSec, 3.0);
assert.ok(Math.abs(cappedRes.distanceMeters - 130) < 1e-6); // 10 m/s * 3 s = 30 m

// 3. Clock offset correction: server clock 2000 ms ahead of client -> 1 s true age
const offsetRes = extrapolateVehiclePosition(
  { distanceMeters: 50, bearing: 90, speedKmh: 36, heading: 90, fixTime: 11_000 },
  10_000,
  2_000
);
assert.equal(offsetRes.extrapolatedSec, 1.0);
assert.ok(Math.abs(offsetRes.distanceMeters - 60) < 1e-6);
assert.ok(Math.abs(offsetRes.bearing - 90) < 1e-6);

// 4. Stationary or missing heading -> zero extrapolation
const stationaryRes = extrapolateVehiclePosition(
  { distanceMeters: 80, bearing: 45, speedKmh: 0, heading: 45, fixTime: 10_000 },
  12_000,
  0
);
assert.equal(stationaryRes.extrapolatedSec, 0);
assert.equal(stationaryRes.distanceMeters, 80);

// 5. Data age helper
assert.equal(computeDataAgeMs(10_000, 11_200, 500), 1700);
assert.equal(computeDataAgeMs(undefined, 11_200, 0), null);

console.log('PASS: all dead reckoning extrapolation checks');


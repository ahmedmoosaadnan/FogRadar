import assert from 'node:assert/strict';
import {
  createHeadingTrackerState,
  enuFromDistanceBearing,
  forwardLateralFromEnu,
  projectVehicleToRoad,
  scaleDistanceNorm,
  updateHeadingTracker,
} from '../src/utils/roadGeometry.ts';

// 1. Vehicle 10 m directly ahead with heading known (0°, 90°, 225°) -> straight ahead, lateral = 0
for (const heading of [0, 90, 225]) {
  const delta = enuFromDistanceBearing(10, heading);
  const { forwardMeters, lateralMeters } = forwardLateralFromEnu(delta, heading);
  assert.ok(Math.abs(forwardMeters - 10) < 1e-6, `Expected forward=10 for heading ${heading}, got ${forwardMeters}`);
  assert.ok(Math.abs(lateralMeters) < 1e-6, `Expected lateral=0 for heading ${heading}, got ${lateralMeters}`);

  const projected = projectVehicleToRoad(
    { id: 'v1', distanceMeters: 10, bearing: heading, speedKmh: 60, heading, accuracyMeters: 4, ageMs: 500 },
    heading,
    4
  );
  assert.ok(projected !== null);
  assert.equal(projected.laneOffset, 0);
  assert.equal(projected.direction, 'same');
}

// 2. Vehicle 10 m directly ahead with heading unknown (null) -> returns null (no guessed left/right position)
const unknownProj = projectVehicleToRoad(
  { id: 'v1', distanceMeters: 10, bearing: 45, speedKmh: 60, heading: 45, accuracyMeters: 4, ageMs: 500 },
  null,
  4
);
assert.equal(unknownProj, null);

// 3. Lateral sign: right is positive, left is negative (heading North = 0°)
const rightDelta = enuFromDistanceBearing(15, 90);
const rightFL = forwardLateralFromEnu(rightDelta, 0);
assert.ok(Math.abs(rightFL.forwardMeters) < 1e-6);
assert.ok(Math.abs(rightFL.lateralMeters - 15) < 1e-6);

const leftDelta = enuFromDistanceBearing(15, 270);
const leftFL = forwardLateralFromEnu(leftDelta, 0);
assert.ok(Math.abs(leftFL.forwardMeters) < 1e-6);
assert.ok(Math.abs(leftFL.lateralMeters + 15) < 1e-6);

// 4. Heading tracker: speed >= 3 m/s & acc <= 35m updates, circular EMA wraps 355° -> 5°, holds up to 10s, then null
let tracker = createHeadingTrackerState();
let res = updateHeadingTracker(tracker, { speedMps: 10, headingDeg: 355, accuracyMeters: 10, now: 1000 });
tracker = res.state;
assert.equal(res.effectiveHeading, 355);

res = updateHeadingTracker(tracker, { speedMps: 10, headingDeg: 5, accuracyMeters: 10, now: 2000 });
tracker = res.state;
assert.ok(res.effectiveHeading !== null && (res.effectiveHeading > 355 || res.effectiveHeading < 5), 'Circular EMA should stay near North (0°)');

// Low speed (< 3 m/s) within 10s keeps last good heading
res = updateHeadingTracker(tracker, { speedMps: 1.5, headingDeg: 180, accuracyMeters: 10, now: 8000 });
tracker = res.state;
assert.ok(res.effectiveHeading !== null);

// Low speed beyond 10s marks heading unknown (null)
res = updateHeadingTracker(tracker, { speedMps: 1.5, headingDeg: 180, accuracyMeters: 10, now: 12500 });
assert.equal(res.effectiveHeading, null);

// 5. GPS uncertainty halo & lane threshold:
// ownAcc=10, otherAcc=10 -> combined=14.14m. Lateral=10m <= 14.14m -> centered in own lane with uncertainty halo
const uncertainLane = projectVehicleToRoad(
  { id: 'v2', distanceMeters: 50, bearing: Math.atan2(10, 48.99) * (180 / Math.PI), speedKmh: 70, heading: 0, accuracyMeters: 10, ageMs: 500 },
  0,
  10
);
assert.ok(uncertainLane !== null);
assert.equal(uncertainLane.lateralKnown, false);
assert.equal(uncertainLane.hasUncertaintyHalo, true);
assert.equal(uncertainLane.laneOffset, 0);

// ownAcc=2, otherAcc=2 -> combined=2.83m, threshold=2.83 + 5.4 = 8.23m. Lateral=10m > 8.23m -> distinct lane
const clearLane = projectVehicleToRoad(
  { id: 'v3', distanceMeters: 50, bearing: Math.atan2(10, 48.99) * (180 / Math.PI), speedKmh: 70, heading: 0, accuracyMeters: 2, ageMs: 500 },
  0,
  2
);
assert.ok(clearLane !== null);
assert.equal(clearLane.lateralKnown, true);
assert.equal(clearLane.hasUncertaintyHalo, false);
assert.ok(clearLane.laneOffset > 1.5);

// 6. Oncoming classification (> 120° delta)
const oncoming = projectVehicleToRoad(
  { id: 'v4', distanceMeters: 120, bearing: 10, speedKmh: 85, heading: 180, accuracyMeters: 5, ageMs: 400 },
  0,
  5
);
assert.ok(oncoming !== null);
assert.equal(oncoming.direction, 'oncoming');

// 7. Non-linear sqrt distance scale
assert.ok(Math.abs(scaleDistanceNorm(100) - Math.sqrt(0.1)) < 1e-6);
assert.equal(scaleDistanceNorm(1000), 1);

console.log('PASS: all road geometry, heading, uncertainty, and lane projection checks');


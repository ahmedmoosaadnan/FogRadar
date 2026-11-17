import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePairwiseRoadDistance,
  detectDirectionWithHysteresis,
  extractUpcomingRoadShape,
  snapFixToSegments,
  type MotorwaySegmentRecord,
} from './roadMatching.js';

// Synthetic straight North-bound segment along lon=74.3000 from lat=31.5000 to 31.5200 (~2.22 km)
const SEGMENT: MotorwaySegmentRecord = {
  id: 1,
  route: 'M-2 Motorway',
  direction: 'carriageway-1',
  coords: [
    [74.3, 31.5],
    [74.3, 31.51],
    [74.3, 31.52],
  ],
  lengthMeters: 2224,
};

test('snapFixToSegments matches within 60m and rejects >60m or poor accuracy', () => {
  // ~10m East of segment
  const near = snapFixToSegments(31.505, 74.3001, 10, [SEGMENT], 60);
  assert.equal(near.matched, true);
  if (near.matched) {
    assert.equal(near.route, 'M-2 Motorway');
    assert.ok(near.offsetMeters < 15);
    assert.ok(near.chainageMeters > 500 && near.chainageMeters < 600);
  }

  // ~190m East of segment -> unmatched
  const far = snapFixToSegments(31.505, 74.302, 10, [SEGMENT], 60);
  assert.equal(far.matched, false);

  // Poor GPS accuracy (>50m) -> unmatched
  const poorAcc = snapFixToSegments(31.505, 74.3001, 80, [SEGMENT], 60);
  assert.equal(poorAcc.matched, false);
});

test('detectDirectionWithHysteresis classifies forward/backward and holds within hysteresis band', () => {
  let dir = detectDirectionWithHysteresis('unknown', 500, 520, 8);
  assert.equal(dir, 'forward');

  // Small 3m jitter backward -> stays forward
  dir = detectDirectionWithHysteresis(dir, 520, 517, 8);
  assert.equal(dir, 'forward');

  // Clear -15m move -> flips to backward
  dir = detectDirectionWithHysteresis(dir, 517, 502, 8);
  assert.equal(dir, 'backward');
});

test('computePairwiseRoadDistance uses chainage for matched same-segment vehicles and falls back to Haversine', () => {
  const sameDir = computePairwiseRoadDistance(
    { latitude: 31.505, longitude: 74.3, matched: true, segmentId: 1, chainageMeters: 500, roadDirection: 'forward' },
    { latitude: 31.507, longitude: 74.3, matched: true, segmentId: 1, chainageMeters: 720, roadDirection: 'forward' }
  );
  assert.equal(sameDir.usedRoadDistance, true);
  assert.equal(sameDir.distanceMeters, 220);
  assert.equal(sameDir.aheadMeters, 220);
  assert.equal(sameDir.oncoming, false);

  const oppDir = computePairwiseRoadDistance(
    { latitude: 31.505, longitude: 74.3, matched: true, segmentId: 1, chainageMeters: 500, roadDirection: 'forward' },
    { latitude: 31.507, longitude: 74.3, matched: true, segmentId: 1, chainageMeters: 720, roadDirection: 'backward' }
  );
  assert.equal(oppDir.oncoming, true);

  const unmatched = computePairwiseRoadDistance(
    { latitude: 31.505, longitude: 74.3, matched: false },
    { latitude: 31.506, longitude: 74.3, matched: false }
  );
  assert.equal(unmatched.usedRoadDistance, false);
  assert.ok(unmatched.distanceMeters > 100 && unmatched.distanceMeters < 120);
});

test('extractUpcomingRoadShape returns forward local coordinates for 1 km', () => {
  const shape = extractUpcomingRoadShape(31.505, 74.3, 0, SEGMENT.coords, 555, 'forward', 1000, 200);
  assert.ok(shape.length >= 4);
  assert.ok(Math.abs(shape[0].forwardMeters) < 5);
  assert.ok(shape[shape.length - 1].forwardMeters >= 900);
  assert.ok(Math.abs(shape[shape.length - 1].lateralMeters) < 2);
});


import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePairwiseRoadDistance,
  detectDirectionWithHysteresis,
  extractUpcomingRoadShape,
  snapFixToSegments,
  type MotorwaySegmentRecord,
} from './roadMatching.js';

// Synthetic two-carriageway fixture with a crossover (within 10m), a gap, and a sliver
const DIR_A_CHAIN_1: MotorwaySegmentRecord = {
  id: 1,
  route: 'M-2 Motorway',
  direction: 'dir-a',
  kind: 'main',
  coords: [
    [74.3, 31.5],
    [74.3, 31.51],
  ],
  lengthMeters: 1112,
};

// Opposite carriageway ~10m East at lat=31.505 (within 15m crossover ambiguity zone)
const DIR_B_CHAIN_1: MotorwaySegmentRecord = {
  id: 2,
  route: 'M-2 Motorway',
  direction: 'dir-b',
  kind: 'main',
  coords: [
    [74.3001, 31.51],
    [74.3001, 31.5],
  ],
  lengthMeters: 1112,
};

// Second chain of dir-a after a ~220m gap
const DIR_A_CHAIN_2: MotorwaySegmentRecord = {
  id: 3,
  route: 'M-2 Motorway',
  direction: 'dir-a',
  kind: 'main',
  coords: [
    [74.3, 31.512],
    [74.3, 31.522],
  ],
  lengthMeters: 1112,
};

const SLIVER: MotorwaySegmentRecord = {
  id: 4,
  route: 'M-2 Motorway',
  direction: 'sliver',
  kind: 'ramp-or-sliver',
  coords: [
    [74.3, 31.505],
    [74.3005, 31.5055],
  ],
  lengthMeters: 75,
};

const FIXTURE = [DIR_A_CHAIN_1, DIR_B_CHAIN_1, DIR_A_CHAIN_2, SLIVER];

test('heading-aware snapping disambiguates opposite carriageways and excludes slivers', () => {
  // Moving North (0 deg, 10 m/s) near crossover -> snaps to dir-a
  const northSnap = snapFixToSegments(31.505, 74.30005, 8, FIXTURE, 60, 0, 10);
  assert.equal(northSnap.matched, true);
  if (northSnap.matched) {
    assert.equal(northSnap.segmentId, 1);
    assert.equal(northSnap.direction, 'dir-a');
  }

  // Moving South (180 deg, 10 m/s) near crossover -> snaps to dir-b
  const southSnap = snapFixToSegments(31.505, 74.30005, 8, FIXTURE, 60, 180, 10);
  assert.equal(southSnap.matched, true);
  if (southSnap.matched) {
    assert.equal(southSnap.segmentId, 2);
    assert.equal(southSnap.direction, 'dir-b');
  }

  // Unknown heading at crossover (opposite carriageways <= 15m apart) -> ambiguous -> unmatched
  const ambiguous = snapFixToSegments(31.505, 74.30005, 8, FIXTURE, 60, null, null);
  assert.equal(ambiguous.matched, false);
  if (!ambiguous.matched) {
    assert.equal(ambiguous.ambiguous, true);
  }

  // Sliver is excluded even if closest
  const sliverOnly = snapFixToSegments(31.5052, 74.3003, 8, [SLIVER], 60, 45, 10);
  assert.equal(sliverOnly.matched, false);

  // Poor GPS accuracy (>50m) -> unmatched
  const poorAcc = snapFixToSegments(31.505, 74.3, 80, FIXTURE, 60, 0, 10);
  assert.equal(poorAcc.matched, false);
});

test('detectDirectionWithHysteresis classifies forward/backward and holds within hysteresis band', () => {
  let dir = detectDirectionWithHysteresis('unknown', 500, 520, 8);
  assert.equal(dir, 'forward');

  dir = detectDirectionWithHysteresis(dir, 520, 517, 8);
  assert.equal(dir, 'forward');

  dir = detectDirectionWithHysteresis(dir, 517, 502, 8);
  assert.equal(dir, 'backward');
});

test('computePairwiseRoadDistance uses chainage on same chain, marks opposite dir oncoming, and falls back across gaps', () => {
  // Same chain & same direction -> chainage distance
  const sameChain = computePairwiseRoadDistance(
    { latitude: 31.503, longitude: 74.3, route: 'M-2 Motorway', matched: true, segmentId: 1, chainageMeters: 333, roadDirection: 'dir-a' },
    { latitude: 31.507, longitude: 74.3, route: 'M-2 Motorway', matched: true, segmentId: 1, chainageMeters: 777, roadDirection: 'dir-a' }
  );
  assert.equal(sameChain.usedRoadDistance, true);
  assert.equal(sameChain.distanceMeters, 444);
  assert.equal(sameChain.aheadMeters, 444);
  assert.equal(sameChain.oncoming, false);

  // Opposite direction chains on same route -> oncoming
  const oppDir = computePairwiseRoadDistance(
    { latitude: 31.503, longitude: 74.3, route: 'M-2 Motorway', matched: true, segmentId: 1, chainageMeters: 333, roadDirection: 'dir-a' },
    { latitude: 31.507, longitude: 74.3001, route: 'M-2 Motorway', matched: true, segmentId: 2, chainageMeters: 333, roadDirection: 'dir-b' }
  );
  assert.equal(oppDir.oncoming, true);

  // Across a gap (dir-a chain 1 vs dir-a chain 2) -> falls back to Haversine
  const acrossGap = computePairwiseRoadDistance(
    { latitude: 31.509, longitude: 74.3, route: 'M-2 Motorway', matched: true, segmentId: 1, chainageMeters: 1000, roadDirection: 'dir-a' },
    { latitude: 31.513, longitude: 74.3, route: 'M-2 Motorway', matched: true, segmentId: 3, chainageMeters: 111, roadDirection: 'dir-a' }
  );
  assert.equal(acrossGap.usedRoadDistance, false);
  assert.ok(acrossGap.distanceMeters > 400 && acrossGap.distanceMeters < 480);
});

test('extractUpcomingRoadShape returns forward local coordinates for 1 km', () => {
  const shape = extractUpcomingRoadShape(31.501, 74.3, 0, DIR_A_CHAIN_1.coords, 111, 'dir-a', 900, 200);
  assert.ok(shape.length >= 4);
  assert.ok(Math.abs(shape[0].forwardMeters) < 5);
  assert.ok(shape[shape.length - 1].forwardMeters >= 750);
  assert.ok(Math.abs(shape[shape.length - 1].lateralMeters) < 2);
});

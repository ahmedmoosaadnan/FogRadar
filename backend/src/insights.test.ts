import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicInsights, normalizeRouteParam, requestLlmInsights } from './insights.js';

test('normalizeRouteParam maps shorthand and full motorway names', () => {
  assert.equal(normalizeRouteParam('M-2'), 'M-2 Motorway');
  assert.equal(normalizeRouteParam('m-1'), 'M-1 Motorway');
  assert.equal(normalizeRouteParam('M-9 Motorway'), 'M-9 Motorway');
  assert.equal(normalizeRouteParam('invalid'), 'M-2 Motorway');
});

test('when there are no vehicles and no hazards, states No FogRadar data and never claims road is clear or safe', () => {
  const emptyRes = buildDeterministicInsights(
    { route: 'M-2 Motorway', liveVehicles: 0, hazards: [] },
    1700000000000
  );
  assert.equal(emptyRes.generatedAt, 1700000000000);
  assert.match(emptyRes.summary_en, /No FogRadar data for this route right now/);
  assert.doesNotMatch(emptyRes.summary_en, /\b(clear|safe)\b/i);
  assert.match(emptyRes.summary_ur, /کوئی FogRadar ڈیٹا موجود نہیں/);
});

test('deterministic fallback with vehicles or hazards reports only observed telemetry', async () => {
  const withHazards = await requestLlmInsights(
    {
      route: 'M-2 Motorway',
      liveVehicles: 4,
      hazards: [
        {
          type: 'Heavy fog',
          latitude: 31.5204,
          longitude: 74.3587,
          ageMinutes: 3,
          reportCount: 2,
        },
      ],
    },
    undefined,
    undefined,
    1700000001000
  );
  assert.equal(withHazards.generatedAt, 1700000001000);
  assert.match(withHazards.summary_en, /M-2 Motorway/);
  assert.match(withHazards.summary_en, /Heavy fog/);
  assert.match(withHazards.summary_en, /4 connected vehicle/);
  assert.doesNotMatch(withHazards.summary_en, /\b(clear|safe)\b/i);
  assert.match(withHazards.summary_ur, /M-2 Motorway/);
  assert.match(withHazards.summary_ur, /شدید دھند/);

  const vehiclesOnly = buildDeterministicInsights(
    { route: 'M-3 Motorway', liveVehicles: 2, hazards: [] },
    1700000005000
  );
  assert.match(vehiclesOnly.summary_en, /2 connected vehicle\(s\) and 0 corroborated hazard reports/);
  assert.doesNotMatch(vehiclesOnly.summary_en, /\b(clear|safe)\b/i);
  assert.match(vehiclesOnly.summary_ur, /M-3 Motorway/);
});

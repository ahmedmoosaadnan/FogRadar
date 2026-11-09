import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicInsights, normalizeRouteParam, requestLlmInsights } from './insights.js';

test('normalizeRouteParam maps shorthand and full motorway names', () => {
  assert.equal(normalizeRouteParam('M-2'), 'M-2 Motorway');
  assert.equal(normalizeRouteParam('m-1'), 'M-1 Motorway');
  assert.equal(normalizeRouteParam('M-9 Motorway'), 'M-9 Motorway');
  assert.equal(normalizeRouteParam('invalid'), 'M-2 Motorway');
});

test('deterministic fallback returns English and Urdu summaries without errors', async () => {
  const res = await requestLlmInsights(
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
    1700000000000
  );
  assert.equal(res.generatedAt, 1700000000000);
  assert.match(res.summary_en, /M-2 Motorway/);
  assert.match(res.summary_en, /Heavy fog/);
  assert.match(res.summary_en, /4 live connected vehicle/);
  assert.match(res.summary_ur, /M-2 Motorway/);
  assert.match(res.summary_ur, /شدید دھند/);

  const clearRes = buildDeterministicInsights(
    { route: 'M-3 Motorway', liveVehicles: 2, hazards: [] },
    1700000005000
  );
  assert.match(clearRes.summary_en, /No corroborated hazards/);
  assert.match(clearRes.summary_ur, /M-3 Motorway/);
});


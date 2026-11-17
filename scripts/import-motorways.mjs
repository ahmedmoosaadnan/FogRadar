/**
 * Downloads Pakistan motorway geometries (M-1, M-2, M-3, M-4, M-5, M-9) from OpenStreetMap
 * via the Overpass API, stitches contiguous ways per carriageway/direction, simplifies lightly,
 * and stores them in PostGIS table `motorway_segments`.
 *
 * Attribution: © OpenStreetMap contributors (ODbL)
 *
 * Overpass QL Query used:
 *   [out:json][timeout:120];
 *   area["ISO3166-1"="PK"][admin_level=2]->.pk;
 *   (
 *     way["highway"="motorway"]["ref"~"^M[- ]?(1|2|3|4|5|9)$"](area.pk);
 *     relation["highway"="motorway"]["ref"~"^M[- ]?(1|2|3|4|5|9)$"](area.pk);
 *   );
 *   out geom;
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/import-motorways.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const ATTRIBUTION = '© OpenStreetMap contributors';

const OVERPASS_QUERY = `
[out:json][timeout:120];
area["ISO3166-1"="PK"][admin_level=2]->.pk;
(
  way["highway"="motorway"]["ref"~"^M[- ]?(1|2|3|4|5|9)$"](area.pk);
  relation["highway"="motorway"]["ref"~"^M[- ]?(1|2|3|4|5|9)$"](area.pk);
);
out geom;
`.trim();

function normalizeRouteRef(rawRef) {
  if (!rawRef) return null;
  const m = /M[- ]?(1|2|3|4|5|9)\b/i.exec(String(rawRef));
  return m ? `M-${m[1]} Motorway` : null;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Light Douglas-Peucker simplification in degrees (~0.0001 deg ≈ 10 m). */
function simplifyLine(coords, epsilon = 0.0001) {
  if (coords.length <= 2) return coords;
  let maxDist = 0;
  let index = 0;
  const start = coords[0];
  const end = coords[coords.length - 1];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < coords.length - 1; i++) {
    const p = coords[i];
    const dist =
      lenSq === 0
        ? Math.hypot(p[0] - start[0], p[1] - start[1])
        : Math.abs(dy * p[0] - dx * p[1] + end[0] * start[1] - end[1] * start[0]) / Math.sqrt(lenSq);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyLine(coords.slice(0, index + 1), epsilon);
    const right = simplifyLine(coords.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

/** Stitch contiguous ways whose endpoints are within 40 m into continuous LineStrings. */
function stitchWays(wayCoordLists) {
  const remaining = wayCoordLists.filter(w => w.length >= 2).map(w => [...w]);
  const stitched = [];

  while (remaining.length > 0) {
    let current = remaining.shift();
    let changed = true;
    while (changed) {
      changed = false;
      const head = current[0];
      const tail = current[current.length - 1];
      for (let i = 0; i < remaining.length; i++) {
        const cand = remaining[i];
        const cHead = cand[0];
        const cTail = cand[cand.length - 1];
        if (haversineMeters(tail, cHead) <= 40) {
          current = [...current, ...cand.slice(1)];
          remaining.splice(i, 1);
          changed = true;
          break;
        }
        if (haversineMeters(cTail, head) <= 40) {
          current = [...cand, ...current.slice(1)];
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    stitched.push(simplifyLine(current, 0.0001));
  }
  return stitched;
}

async function main() {
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  console.log('Fetching Pakistan motorways from Overpass API...');
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
  });
  if (!res.ok) {
    throw new Error(`Overpass API failed with HTTP ${res.status}`);
  }
  const json = await res.json();
  const elements = Array.isArray(json.elements) ? json.elements : [];
  console.log(`Received ${elements.length} OSM elements.`);

  const byRoute = new Map();
  for (const el of elements) {
    const route = normalizeRouteRef(el.tags?.ref);
    if (!route) continue;
    if (el.type === 'way' && Array.isArray(el.geometry)) {
      const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
      const list = byRoute.get(route) ?? [];
      list.push(coords);
      byRoute.set(route, list);
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const m of el.members) {
        if (m.type === 'way' && Array.isArray(m.geometry)) {
          const coords = m.geometry.map(pt => [pt.lon, pt.lat]);
          const list = byRoute.get(route) ?? [];
          list.push(coords);
          byRoute.set(route, list);
        }
      }
    }
  }

  const isLocalDb = /@(localhost|127\.0\.0\.1|db)(:|\/|$)/i.test(rawDbUrl) || /sslmode=disable/i.test(rawDbUrl);
  const dbUrl = /sslmode=/i.test(rawDbUrl) && !/uselibpqcompat=/i.test(rawDbUrl)
    ? `${rawDbUrl}${rawDbUrl.includes('?') ? '&' : '?'}uselibpqcompat=true`
    : rawDbUrl;

  const pool = new pg.Pool({
    connectionString: dbUrl,
    ...(!isLocalDb || process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  const importedAt = new Date().toISOString();
  let insertedCount = 0;

  try {
    await pool.query('BEGIN');
    await pool.query('TRUNCATE TABLE motorway_segments RESTART IDENTITY;');

    for (const [route, ways] of byRoute.entries()) {
      const stitched = stitchWays(ways);
      for (let i = 0; i < stitched.length; i++) {
        const coords = stitched[i];
        if (coords.length < 2) continue;
        const geojson = JSON.stringify({ type: 'LineString', coordinates: coords });
        await pool.query(
          `INSERT INTO motorway_segments (route, direction, geometry, length_m, attribution, imported_at)
           VALUES (
             $1,
             $2,
             ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
             ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)::geography),
             $4,
             $5::timestamptz
           )`,
          [route, `carriageway-${i + 1}`, geojson, ATTRIBUTION, importedAt]
        );
        insertedCount += 1;
      }
    }

    await pool.query('COMMIT');
    console.log(`Imported ${insertedCount} motorway segments (${ATTRIBUTION}, imported_at=${importedAt}).`);
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


/**
 * Downloads Pakistan motorway geometries (M-1, M-2, M-3, M-4, M-5, M-9) from OpenStreetMap
 * via the Overpass API with per-route bounding boxes and disk caching, builds a directed graph
 * per route, stitches maximal continuous directed chains by shared node IDs (rejecting >90 deg
 * turns), bridges small same-direction gaps (<= 150 m and < 30 deg), splits any chain exceeding
 * 1.3x expected length or containing a bearing reversal (>120 deg), flags short slivers (< 300 m)
 * as kind='ramp-or-sliver', classifies opposite carriageways as 'dir-a' / 'dir-b', and stores
 * them idempotently in PostGIS table `motorway_segments`.
 *
 * Attribution: © OpenStreetMap contributors (ODbL)
 *
 * CLI flags:
 *   --route=M-2    Import only a single route
 *   --refresh      Force fresh Overpass download (ignore disk cache)
 *   --from-cache   Use disk cache only; never hit the network
 *   --dry-run      Run stitching and print validation tables without writing to PostgreSQL
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/import-motorways.mjs [--route=M-2] [--refresh] [--from-cache] [--dry-run]
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const OVERPASS_ENDPOINTS = [
  ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const USER_AGENT = 'FogRadar/1.0 (contact: moosaalvi963@gmail.com)';
const ATTRIBUTION = '© OpenStreetMap contributors';

const MOTORWAY_ORDER = ['9', '2', '3', '4', '5', '1'];

const ROUTE_BBOX = {
  '1': '33.40,71.25,34.28,73.15',
  '2': '31.20,72.45,33.88,74.50',
  '3': '30.35,71.90,32.10,74.45',
  '4': '29.95,71.25,32.15,73.45',
  '5': '27.45,68.60,30.45,71.75',
  '9': '24.65,66.85,25.68,68.65',
};

const APPROX_LENGTH_KM = {
  'M-1 Motorway': 155,
  'M-2 Motorway': 367,
  'M-3 Motorway': 230,
  'M-4 Motorway': 309,
  'M-5 Motorway': 392,
  'M-9 Motorway': 136,
};

const REQUEST_TIMEOUT_MS = 150_000;
const MAX_ATTEMPTS_PER_ENDPOINT = 3;
const BACKOFF_MS = [5_000, 15_000, 45_000];
const ROUND_COOLDOWN_MS = 60_000;
const RETRYABLE_STATUSES = new Set([406, 429, 502, 504]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '.cache');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseCliArgs(argv) {
  let refresh = false;
  let fromCache = false;
  let dryRun = false;
  let routeFilter = null;

  for (const arg of argv) {
    if (arg === '--refresh') refresh = true;
    else if (arg === '--from-cache') fromCache = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--route=')) {
      const val = arg.slice('--route='.length).trim().toUpperCase();
      const m = /^(?:M-?)?(1|2|3|4|5|9)$/i.exec(val);
      if (!m) throw new Error(`Invalid --route value "${val}". Expected M-1, M-2, M-3, M-4, M-5, or M-9.`);
      routeFilter = m[1];
    }
  }
  return { refresh, fromCache, dryRun, routeFilter };
}

function buildRouteQuery(num) {
  const bbox = ROUTE_BBOX[num];
  return `
[out:json][timeout:120];
(
  way["highway"="motorway"]["ref"~"^M[- ]?${num}$"](${bbox});
);
out body;
>;
out skel qt;
`.trim();
}

function haversineMeters(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDeg(a, b) {
  const rad = Math.PI / 180;
  const dLon = (b[0] - a[0]) * rad;
  const y = Math.sin(dLon) * Math.cos(b[1] * rad);
  const x =
    Math.cos(a[1] * rad) * Math.sin(b[1] * rad) -
    Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDelta(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function chainLengthMeters(coords) {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineMeters(coords[i], coords[i + 1]);
  }
  return total;
}

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

async function fetchOverpassWithRetry(query, label) {
  let lastError = null;

  for (let round = 1; round <= 2; round++) {
    if (round === 2) {
      console.warn(`[${label}] All endpoints failed in round 1; waiting 60 s before round 2...`);
      await sleep(ROUND_COOLDOWN_MS);
    }

    for (const endpoint of OVERPASS_ENDPOINTS) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_ENDPOINT; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'User-Agent': USER_AGENT,
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ data: query }).toString(),
            signal: controller.signal,
          });

          const bodyText = await res.text();
          if (!res.ok) {
            const preview = bodyText.slice(0, 300).replace(/\s+/g, ' ');
            const msg = `Overpass ${endpoint} (${label}) HTTP ${res.status}: ${preview}`;
            console.warn(msg);
            lastError = new Error(msg);
            if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
              await sleep(BACKOFF_MS[attempt - 1] ?? 45_000);
              continue;
            }
            break;
          }

          try {
            const parsed = JSON.parse(bodyText);
            console.log(`[${label}] Downloaded successfully from ${endpoint}`);
            return parsed;
          } catch {
            const preview = bodyText.slice(0, 300).replace(/\s+/g, ' ');
            lastError = new Error(`Invalid JSON from ${endpoint} (${label}): ${preview}`);
            console.warn(lastError.message);
            break;
          }
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.warn(
            `Overpass ${endpoint} (${label}) round ${round} attempt ${attempt} failed: ${lastError.message}`
          );
          if (attempt < MAX_ATTEMPTS_PER_ENDPOINT) {
            await sleep(BACKOFF_MS[attempt - 1] ?? 45_000);
          }
        } finally {
          clearTimeout(timer);
        }
      }
    }
  }

  throw lastError ?? new Error(`All Overpass endpoints failed for ${label}`);
}

async function loadRouteElements(num, routeLabel, { refresh, fromCache }) {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = resolve(CACHE_DIR, `M-${num}.json`);

  if (!refresh && existsSync(cachePath)) {
    console.log(`[${routeLabel}] Using disk cache: ${cachePath}`);
    const raw = await readFile(cachePath, 'utf8');
    const json = JSON.parse(raw);
    return Array.isArray(json.elements) ? json.elements : [];
  }

  if (fromCache) {
    throw new Error(`Cache miss for ${routeLabel} (--from-cache set, missing ${cachePath})`);
  }

  console.log(`[${routeLabel}] Fetching from Overpass API (bbox=${ROUTE_BBOX[num]})...`);
  const json = await fetchOverpassWithRetry(buildRouteQuery(num), routeLabel);
  await writeFile(cachePath, JSON.stringify(json), 'utf8');
  return Array.isArray(json.elements) ? json.elements : [];
}

/**
 * Splits a chain if it exceeds 1.3x expected route length or contains a bearing reversal (>120 deg).
 */
function splitChainOnReversalsOrLength(coords, nodeIds, maxLengthMeters, routeLabel) {
  if (coords.length < 3) return [{ coords, nodeIds }];

  const splitIndices = [];
  for (let i = 1; i < coords.length - 1; i++) {
    const b1 = bearingDeg(coords[i - 1], coords[i]);
    const b2 = bearingDeg(coords[i], coords[i + 1]);
    const delta = angleDelta(b1, b2);
    if (delta > 120) {
      console.log(
        `[${routeLabel}] Bearing reversal (${Math.round(delta)} deg) at node ${nodeIds[i] ?? 'n/a'} [${coords[i][0].toFixed(5)}, ${coords[i][1].toFixed(5)}]`
      );
      splitIndices.push(i);
    }
  }

  // If still > 1.3x expected route length with no >120 deg single-vertex reversal, split at sharpest turn > 75 deg
  const totalLen = chainLengthMeters(coords);
  if (splitIndices.length === 0 && maxLengthMeters > 0 && totalLen > 1.3 * maxLengthMeters) {
    let bestIdx = -1;
    let bestDelta = 75;
    for (let i = 1; i < coords.length - 1; i++) {
      const b1 = bearingDeg(coords[i - 1], coords[i]);
      const b2 = bearingDeg(coords[i], coords[i + 1]);
      const d = angleDelta(b1, b2);
      if (d > bestDelta) {
        bestDelta = d;
        bestIdx = i;
      }
    }
    if (bestIdx !== -1) {
      console.log(
        `[${routeLabel}] Splitting oversized chain (${(totalLen / 1000).toFixed(1)} km > 1.3x) at node ${nodeIds[bestIdx] ?? 'n/a'} [${coords[bestIdx][0].toFixed(5)}, ${coords[bestIdx][1].toFixed(5)}] (turn ${Math.round(bestDelta)} deg)`
      );
      splitIndices.push(bestIdx);
    }
  }

  if (splitIndices.length === 0) return [{ coords, nodeIds }];

  const parts = [];
  let start = 0;
  for (const idx of splitIndices) {
    if (idx - start >= 1) {
      parts.push({
        coords: coords.slice(start, idx + 1),
        nodeIds: nodeIds.slice(start, idx + 1),
      });
    }
    start = idx;
  }
  if (coords.length - start >= 2) {
    parts.push({
      coords: coords.slice(start),
      nodeIds: nodeIds.slice(start),
    });
  }
  return parts;
}

/**
 * Builds directed chains for a route from Overpass elements using shared node IDs.
 */
function buildDirectedChains(elements, routeLabel) {
  const nodes = new Map();
  const ways = new Map();
  const relationOrder = new Map();
  let relIdx = 0;

  for (const el of elements) {
    if (el.type === 'node' && typeof el.lon === 'number' && typeof el.lat === 'number') {
      nodes.set(el.id, [el.lon, el.lat]);
    } else if (el.type === 'way' && Array.isArray(el.nodes) && el.nodes.length >= 2) {
      ways.set(el.id, el);
    } else if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const m of el.members) {
        if (m.type === 'way' && !relationOrder.has(m.ref)) {
          relationOrder.set(m.ref, relIdx++);
        }
      }
    }
  }

  const edges = [];
  const undirectedWays = [];
  const nodeOutgoingBearings = new Map();

  for (const way of ways.values()) {
    const validNodes = way.nodes.filter(nid => nodes.has(nid));
    if (validNodes.length < 2) continue;
    const oneway = way.tags?.oneway;
    const order = relationOrder.get(way.id) ?? Number.MAX_SAFE_INTEGER;

    const addEdge = (nids, suffix) => {
      const coords = nids.map(id => nodes.get(id));
      const sb = bearingDeg(coords[0], coords[1]);
      const eb = bearingDeg(coords[coords.length - 2], coords[coords.length - 1]);
      edges.push({
        key: `${way.id}:${suffix}`,
        wayId: way.id,
        nodeIds: nids,
        coords,
        startNode: nids[0],
        endNode: nids[nids.length - 1],
        startBearing: sb,
        endBearing: eb,
        order,
        used: false,
      });
      const list = nodeOutgoingBearings.get(nids[0]) ?? [];
      list.push(sb);
      nodeOutgoingBearings.set(nids[0], list);
    };

    if (oneway === '-1') {
      addEdge([...validNodes].reverse(), 'rev');
    } else if (oneway === 'yes' || oneway === 'true' || oneway === '1') {
      addEdge(validNodes, 'fwd');
    } else {
      undirectedWays.push({ way, validNodes, order });
    }
  }

  // Orient ways without a oneway tag using neighbor bearings (never blindly adding reverse to connect carriageways)
  if (undirectedWays.length > 0) {
    console.warn(
      `[${routeLabel}] ${undirectedWays.length} motorway way(s) lacked oneway tag; orienting from neighbours.`
    );
    for (const { way, validNodes, order } of undirectedWays) {
      const fwdCoords = validNodes.map(id => nodes.get(id));
      const fwdEndB = bearingDeg(fwdCoords[fwdCoords.length - 2], fwdCoords[fwdCoords.length - 1]);
      const fwdNext = nodeOutgoingBearings.get(validNodes[validNodes.length - 1]) ?? [];
      const revNodes = [...validNodes].reverse();
      const revCoords = revNodes.map(id => nodes.get(id));
      const revEndB = bearingDeg(revCoords[revCoords.length - 2], revCoords[revCoords.length - 1]);
      const revNext = nodeOutgoingBearings.get(revNodes[revNodes.length - 1]) ?? [];

      const bestDelta = (b, cands) => (cands.length ? Math.min(...cands.map(c => angleDelta(b, c))) : 999);
      const useFwd = bestDelta(fwdEndB, fwdNext) <= bestDelta(revEndB, revNext);
      const chosenNodes = useFwd ? validNodes : revNodes;
      const coords = chosenNodes.map(id => nodes.get(id));
      edges.push({
        key: `${way.id}:oriented`,
        wayId: way.id,
        nodeIds: chosenNodes,
        coords,
        startNode: chosenNodes[0],
        endNode: chosenNodes[chosenNodes.length - 1],
        startBearing: bearingDeg(coords[0], coords[1]),
        endBearing: bearingDeg(coords[coords.length - 2], coords[coords.length - 1]),
        order,
        used: false,
      });
    }
  }

  const outEdges = new Map();
  const inDegree = new Map();
  for (const e of edges) {
    const list = outEdges.get(e.startNode) ?? [];
    list.push(e);
    outEdges.set(e.startNode, list);
    inDegree.set(e.endNode, (inDegree.get(e.endNode) ?? 0) + 1);
  }

  const startCandidates = [...edges].sort((a, b) => {
    const aIn = inDegree.get(a.startNode) ?? 0;
    const bIn = inDegree.get(b.startNode) ?? 0;
    if ((aIn === 0) !== (bIn === 0)) return aIn === 0 ? -1 : 1;
    return a.order - b.order;
  });

  const rawChains = [];
  for (const startEdge of startCandidates) {
    if (startEdge.used) continue;
    startEdge.used = true;
    const chainCoords = [...startEdge.coords];
    const chainNodeIds = [...startEdge.nodeIds];
    let curEndNode = startEdge.endNode;
    let curEndBearing = startEdge.endBearing;

    while (true) {
      const candidates = (outEdges.get(curEndNode) ?? []).filter(e => !e.used);
      if (!candidates.length) break;

      // Never connect a chain end to a way whose start bearing differs by > 90 deg
      const validNext = candidates.filter(e => {
        const delta = angleDelta(curEndBearing, e.startBearing);
        if (delta > 90) {
          const pt = nodes.get(curEndNode);
          console.log(
            `[${routeLabel}] Rejected >90 deg junction turn (${Math.round(delta)} deg) at node ${curEndNode} [${pt?.[0]?.toFixed(5)}, ${pt?.[1]?.toFixed(5)}]`
          );
          return false;
        }
        return true;
      });
      if (!validNext.length) break;

      validNext.sort((a, b) => {
        const da = angleDelta(curEndBearing, a.startBearing);
        const db = angleDelta(curEndBearing, b.startBearing);
        if (Math.abs(da - db) > 5) return da - db;
        return a.order - b.order;
      });
      const chosen = validNext[0];
      chosen.used = true;
      chainCoords.push(...chosen.coords.slice(1));
      chainNodeIds.push(...chosen.nodeIds.slice(1));
      curEndNode = chosen.endNode;
      curEndBearing = chosen.endBearing;
    }

    rawChains.push({
      coords: chainCoords,
      nodeIds: chainNodeIds,
      startBearing: bearingDeg(chainCoords[0], chainCoords[1]),
      endBearing: bearingDeg(chainCoords[chainCoords.length - 2], chainCoords[chainCoords.length - 1]),
    });
  }

  // Bridge same-direction gaps <= 150 m if bearings are within < 30 deg
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rawChains.length && !merged; i++) {
      for (let j = 0; j < rawChains.length && !merged; j++) {
        if (i === j) continue;
        const a = rawChains[i];
        const b = rawChains[j];
        const gapM = haversineMeters(a.coords[a.coords.length - 1], b.coords[0]);
        if (gapM <= 150 && angleDelta(a.endBearing, b.startBearing) < 30) {
          if (gapM > 60) {
            const p1 = a.coords[a.coords.length - 1];
            const p2 = b.coords[0];
            console.log(
              `[${routeLabel}] Bridged ${Math.round(gapM)} m gap between [${p1[0].toFixed(5)}, ${p1[1].toFixed(5)}] and [${p2[0].toFixed(5)}, ${p2[1].toFixed(5)}]`
            );
          }
          a.coords = [...a.coords, ...b.coords.slice(1)];
          a.nodeIds = [...a.nodeIds, ...b.nodeIds.slice(1)];
          a.endBearing = b.endBearing;
          rawChains.splice(j, 1);
          merged = true;
        }
      }
    }
  }

  // Split any chain exceeding 1.3x expected length or containing a bearing reversal (> 120 deg)
  const expectedMeters = (APPROX_LENGTH_KM[routeLabel] ?? 0) * 1000;
  const splitChains = [];
  for (const c of rawChains) {
    const parts = splitChainOnReversalsOrLength(c.coords, c.nodeIds, expectedMeters, routeLabel);
    for (const p of parts) {
      splitChains.push(p);
    }
  }

  const mainChains = [];
  const slivers = [];
  for (const c of splitChains) {
    const lengthM = chainLengthMeters(c.coords);
    const meanBearing = bearingDeg(c.coords[0], c.coords[c.coords.length - 1]);
    const item = {
      coords: simplifyLine(c.coords, 0.0001),
      lengthM,
      meanBearing,
      startLon: c.coords[0][0],
      startLat: c.coords[0][1],
      endLon: c.coords[c.coords.length - 1][0],
      endLat: c.coords[c.coords.length - 1][1],
    };
    if (lengthM < 300) {
      slivers.push({ ...item, kind: 'ramp-or-sliver', direction: 'sliver', chainIndex: 0 });
    } else {
      mainChains.push({ ...item, kind: 'main' });
    }
  }

  if (mainChains.length > 0) {
    const longest = [...mainChains].sort((a, b) => b.lengthM - a.lengthM)[0];
    const refBearing = longest.meanBearing;
    const g1 = [];
    const g2 = [];
    for (const c of mainChains) {
      if (angleDelta(c.meanBearing, refBearing) <= 90) g1.push(c);
      else g2.push(c);
    }

    const minScore = grp =>
      grp.length ? Math.min(...grp.map(c => c.startLat + 0.1 * c.startLon)) : Infinity;
    const [dirAChains, dirBChains] = minScore(g1) <= minScore(g2) ? [g1, g2] : [g2, g1];

    dirAChains.forEach((c, idx) => {
      c.direction = 'dir-a';
      c.chainIndex = idx;
    });
    dirBChains.forEach((c, idx) => {
      c.direction = 'dir-b';
      c.chainIndex = idx;
    });
  }

  const gaps = [];
  for (const dir of ['dir-a', 'dir-b']) {
    const grp = mainChains.filter(c => c.direction === dir);
    for (let i = 0; i < grp.length; i++) {
      for (let j = i + 1; j < grp.length; j++) {
        const g1 = haversineMeters([grp[i].endLon, grp[i].endLat], [grp[j].startLon, grp[j].startLat]);
        const g2 = haversineMeters([grp[j].endLon, grp[j].endLat], [grp[i].startLon, grp[i].startLat]);
        const minGap = Math.min(g1, g2);
        if (minGap > 100 && minGap < 20_000) {
          gaps.push({
            direction: dir,
            gapMeters: Math.round(minGap),
            lat: Number(grp[i].endLat.toFixed(5)),
            lon: Number(grp[i].endLon.toFixed(5)),
          });
        }
      }
    }
  }

  return { mainChains, slivers, gaps };
}

async function main() {
  const { refresh, fromCache, dryRun, routeFilter } = parseCliArgs(process.argv.slice(2));
  const rawDbUrl = process.env.DATABASE_URL;
  if (!dryRun && !rawDbUrl) {
    throw new Error('DATABASE_URL environment variable is required (or pass --dry-run)');
  }

  const targetNums = routeFilter ? [routeFilter] : MOTORWAY_ORDER;

  let pool = null;
  if (!dryRun) {
    const isLocalDb = /@(localhost|127\.0\.0\.1|db)(:|\/|$)/i.test(rawDbUrl) || /sslmode=disable/i.test(rawDbUrl);
    const dbUrl = /sslmode=/i.test(rawDbUrl) && !/uselibpqcompat=/i.test(rawDbUrl)
      ? `${rawDbUrl}${rawDbUrl.includes('?') ? '&' : '?'}uselibpqcompat=true`
      : rawDbUrl;

    pool = new pg.Pool({
      connectionString: dbUrl,
      ...(!isLocalDb || process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }

  const importedAt = new Date().toISOString();
  const validationRows = [];
  const succeededRoutes = [];
  const failedRoutes = [];

  try {
    for (let idx = 0; idx < targetNums.length; idx++) {
      const num = targetNums[idx];
      const route = `M-${num} Motorway`;
      try {
        const elements = await loadRouteElements(num, route, { refresh, fromCache });
        const { mainChains, slivers, gaps } = buildDirectedChains(elements, route);
        const allRecords = [...mainChains, ...slivers];

        if (pool) {
          await pool.query('BEGIN');
          try {
            await pool.query('DELETE FROM motorway_segments WHERE route = $1;', [route]);
            for (const seg of allRecords) {
              if (seg.coords.length < 2) continue;
              const geojson = JSON.stringify({ type: 'LineString', coordinates: seg.coords });
              await pool.query(
                `INSERT INTO motorway_segments
                  (route, direction, kind, chain_index, bearing, start_lat, start_lon, end_lat, end_lon, geometry, length_m, attribution, imported_at)
                 VALUES (
                   $1, $2, $3, $4, $5, $6, $7, $8, $9,
                   ST_SetSRID(ST_GeomFromGeoJSON($10), 4326),
                   ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)::geography),
                   $11, $12::timestamptz
                 )`,
                [
                  route,
                  seg.direction,
                  seg.kind,
                  seg.chainIndex,
                  seg.meanBearing,
                  seg.startLat,
                  seg.startLon,
                  seg.endLat,
                  seg.endLon,
                  geojson,
                  ATTRIBUTION,
                  importedAt,
                ]
              );
            }
            await pool.query('COMMIT');
          } catch (dbErr) {
            await pool.query('ROLLBACK');
            throw dbErr;
          }
        }

        succeededRoutes.push(`M-${num}`);
        const approxKm = APPROX_LENGTH_KM[route] ?? 0;
        for (const dir of ['dir-a', 'dir-b']) {
          const dirChains = mainChains.filter(c => c.direction === dir);
          const totalKm = Number((dirChains.reduce((s, c) => s + c.lengthM, 0) / 1000).toFixed(2));
          const longestKm = Number((dirChains.reduce((m, c) => Math.max(m, c.lengthM), 0) / 1000).toFixed(2));
          validationRows.push({
            route,
            direction: dir,
            chains: dirChains.length,
            total_km: totalKm,
            longest_chain_km: longestKm,
            approx_expected_km: `~${approxKm}`,
            slivers: slivers.length,
          });
          if (approxKm > 0 && totalKm < approxKm * 0.9) {
            console.warn(
              `[WARN] ${route} (${dir}) total ${totalKm} km is < 90% of approximate expected ~${approxKm} km`
            );
          }
        }
        if (gaps.length > 0) {
          console.log(`[${route}] Gaps > 100 m:`, gaps);
        }
      } catch (routeErr) {
        const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
        console.error(`[ERROR] Failed to import ${route}: ${msg}`);
        failedRoutes.push(`M-${num}`);
      }

      if (!fromCache && idx < targetNums.length - 1) {
        await sleep(1500);
      }
    }

    if (validationRows.length > 0) {
      console.log(`\nValidation Summary (${ATTRIBUTION}, imported_at=${importedAt}${dryRun ? ', DRY RUN' : ''}):`);
      console.table(validationRows);
    }

    console.log('Succeeded routes:', succeededRoutes.length ? succeededRoutes.join(', ') : 'none');
    if (failedRoutes.length > 0) {
      console.warn(
        `Failed routes (${failedRoutes.length}) — retry individually with: ${failedRoutes
          .map(r => `node scripts/import-motorways.mjs --route=${r}`)
          .join(' ; ')}`
      );
    }

    if (succeededRoutes.length === 0) {
      process.exitCode = 1;
    }
  } finally {
    if (pool) await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

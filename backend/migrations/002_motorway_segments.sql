CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS motorway_segments (
  id SERIAL PRIMARY KEY,
  route TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'forward',
  geometry GEOMETRY(LineString, 4326) NOT NULL,
  length_m DOUBLE PRECISION NOT NULL,
  attribution TEXT NOT NULL DEFAULT '© OpenStreetMap contributors',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS motorway_segments_geom_idx ON motorway_segments USING GIST (geometry);
CREATE INDEX IF NOT EXISTS motorway_segments_route_idx ON motorway_segments (route, direction);


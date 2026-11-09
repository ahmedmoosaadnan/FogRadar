CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS hazards (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('Stopped traffic','Accident','Heavy fog','Vehicle breakdown')),
  route TEXT NOT NULL,
  heading DOUBLE PRECISION NOT NULL,
  position GEOGRAPHY(POINT, 4326) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','corroborated')),
  report_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS hazards_position_idx ON hazards USING GIST (position);
CREATE INDEX IF NOT EXISTS hazards_active_idx ON hazards(route, status, expires_at);
CREATE TABLE IF NOT EXISTS hazard_reports (
  hazard_id UUID NOT NULL REFERENCES hazards(id) ON DELETE CASCADE,
  reporter_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(hazard_id, reporter_id)
);


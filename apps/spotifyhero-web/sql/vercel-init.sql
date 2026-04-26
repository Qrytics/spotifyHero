CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sh_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sh_song_charts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id TEXT UNIQUE NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  chart_json JSONB NOT NULL,
  spectrogram_json JSONB NOT NULL,
  generator_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sh_chart_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sh_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES sh_players(id) ON DELETE CASCADE,
  chart_id UUID NOT NULL REFERENCES sh_song_charts(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  accuracy NUMERIC(5,4) NOT NULL,
  max_combo INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sh_scores_chart_score_idx ON sh_scores(chart_id, score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS sh_scores_player_chart_unique ON sh_scores(player_id, chart_id);

-- spotifyHero: public leaderboard via PostgREST (Supabase anon key).
-- Apply once: Supabase Dashboard → SQL Editor → paste → Run.
-- Or: supabase link + supabase db push (Supabase CLI).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique,
  track_id text not null,
  difficulty text not null,
  score integer not null,
  max_combo integer not null,
  accuracy real not null,
  played_at timestamptz not null,
  player_name text not null,
  judgements jsonb not null,
  created_at timestamptz default now(),
  spotify_user_id text,
  user_id uuid
);

create index if not exists leaderboard_entries_track_difficulty_score_idx
  on public.leaderboard_entries (track_id, difficulty, score desc);

create index if not exists leaderboard_entries_spotify_user_id_idx
  on public.leaderboard_entries (spotify_user_id)
  where spotify_user_id is not null;

alter table public.leaderboard_entries enable row level security;

drop policy if exists "leaderboard_entries_select_public" on public.leaderboard_entries;
drop policy if exists "leaderboard_entries_insert_public" on public.leaderboard_entries;

create policy "leaderboard_entries_select_public"
  on public.leaderboard_entries for select
  using (true);

create policy "leaderboard_entries_insert_public"
  on public.leaderboard_entries for insert
  with check (true);

grant select, insert on public.leaderboard_entries to anon, authenticated;

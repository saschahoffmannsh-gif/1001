-- Tausendundeins (1001): Tabellen mit Präfix tu_ im gemeinsamen Projekt.
-- Zugriff nur über die Edge Function "tu" (Service-Role). RLS an, keine Policies = kein Direktzugriff für anon/authenticated.
create table if not exists public.tu_schema_migrations (name text primary key, applied_at timestamptz not null default now());
create table if not exists public.tu_rate_limit (bucket text not null, key_hash text not null, window_start timestamptz not null, hits integer not null default 0, primary key (bucket, key_hash, window_start));
create table if not exists public.tu_profiles (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  display_name text not null default 'Spieler' check (char_length(display_name) between 1 and 20),
  matches_played integer not null default 0, wins integer not null default 0, losses integer not null default 0,
  deals_played integer not null default 0, best_total integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.tu_matches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.tu_profiles(id) on delete cascade,
  opponent text not null default 'computer' check (opponent in ('computer')),
  human_total integer not null check (human_total between -5000 and 5000),
  computer_total integer not null check (computer_total between -5000 and 5000),
  winner text not null check (winner in ('human','computer')),
  deals integer not null check (deals between 1 and 200),
  bids_won integer not null default 0 check (bids_won between 0 and 200),
  bids_made integer not null default 0 check (bids_made between 0 and 200),
  highest_bid integer not null default 0 check (highest_bid between 0 and 400),
  melds integer not null default 0 check (melds between 0 and 1000),
  deal_log jsonb not null default '[]'::jsonb check (jsonb_typeof(deal_log) = 'array' and pg_column_size(deal_log) < 20000),
  duration_s integer not null default 0 check (duration_s between 0 and 86400),
  created_at timestamptz not null default now());
create index if not exists tu_matches_profile_created_idx on public.tu_matches (profile_id, created_at desc);
create index if not exists tu_profiles_wins_idx on public.tu_profiles (wins desc, best_total desc);
alter table public.tu_schema_migrations enable row level security;
alter table public.tu_rate_limit enable row level security;
alter table public.tu_profiles enable row level security;
alter table public.tu_matches enable row level security;
revoke all on public.tu_schema_migrations, public.tu_rate_limit, public.tu_profiles, public.tu_matches from anon, authenticated;
insert into public.tu_schema_migrations(name) values ('0001_tu_init') on conflict do nothing;
